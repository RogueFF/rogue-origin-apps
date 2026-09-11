/**
 * Harvest hourly crew log — SMS bot handler (D1).
 *
 * One Spanish text per barn per hour to its foreman; one free-form reply,
 * parsed by Claude, stored as one harvest_hourly row per barn-hour.
 * Design: wiki/operations/plans/2026-09-11-harvest-hourly-sms-bot-design.md
 *
 * Endpoints (dispatched from index.js):
 * - POST /sms/inbound                              Twilio webhook (signature-verified)
 * - GET  /api/harvest?action=hourly&date=YYYY-MM-DD   rows + day summary   [password]
 * - GET  /api/harvest?action=foremen               registry                 [password]
 * - POST /api/harvest?action=foreman_set           {phone,name,barn,active} [password]
 * - POST /api/harvest?action=hourly_simulate       {from, body} -> replies  [password]
 * - GET  /api/harvest?action=hourly_test           health
 * - cron: runHarvestHourlyTick(env) from the five-minute branch (isFiveMinCron
 *   in index.js). Spelled out in words: the cron string's own slash-star form
 *   would close this comment block.
 */
import { query, queryOne, execute } from '../lib/db.js';
import { successResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { sendTelegramMessage } from '../lib/telegram.js';
import { sendSms, verifyTwilioSignature } from '../lib/sms.js';
import { pacificDay, pacificParts, justEndedHour, sqliteUtc } from '../lib/pacific.js';
import {
  BARN_LABELS, FIELD_ES, validateCounts, missingFields, classifyInbound,
  promptText, reminderText, helpText, confirmText, askMissingText, notUnderstoodText,
  temporaryErrorText, futureHourText, normalizeNotes, tickDecision, shouldAutoStop,
} from '../lib/harvest-hourly.js';
import { parseReply } from '../lib/harvest-hourly-parse.js';

export const HOURLY_ACTIONS = new Set(['hourly', 'foremen', 'foreman_set', 'hourly_simulate', 'hourly_test']);

const isTestMode = (env) => env.HARVEST_TEST_MODE !== 'false';
// The season is the harvest date's own year, not the wall-clock year: a row
// written just after midnight UTC still belongs to the Pacific day it reports.
const seasonOf = (day) => Number(day.slice(0, 4));
// One definition of "racks today", shared by the PARAR reply and the day read:
// every row for the barn, whatever its status. Two places computing this
// differently is how a foreman's total stops matching the dashboard's.
const sumRacks = (rows) => rows.reduce((s, r) => s + (r.racks || 0), 0);

// ─── HTTP: /api/harvest?action=hourly* ─────────────────────────────────

export async function handleHarvestHourly(request, env, ctx) {
  const body = request.method === 'POST' ? await parseBody(request) : {};
  const action = getAction(request, body);
  const params = getQueryParams(request);
  const db = env.DB;

  switch (action) {
    case 'hourly_test':
      return successResponse({ success: true, message: 'Harvest hourly API operational' });
    case 'hourly':
      requireAuth(request, body, env, 'harvest-hourly');
      return successResponse(await readDay(db, env, params.date || pacificDay(new Date())));
    case 'foremen':
      requireAuth(request, body, env, 'harvest-foremen');
      return successResponse({ foremen: await query(db, `SELECT * FROM harvest_foremen ORDER BY barn, name`) });
    case 'foreman_set':
      requireAuth(request, body, env, 'harvest-foreman-set');
      return successResponse(await setForeman(db, body));
    case 'hourly_simulate': {
      requireAuth(request, body, env, 'harvest-hourly-simulate');
      if (!body.from || !body.body) throw createError('VALIDATION_ERROR', 'from and body are required');
      const replies = await processInbound(env, {
        from: String(body.from), text: String(body.body), sid: `SIM-${Date.now()}`, deliver: false,
      });
      return successResponse({ replies });
    }
    default:
      throw createError('NOT_FOUND', `Unknown hourly action: ${action}`);
  }
}

/**
 * Strictly true. A JSON body may send `active` as a boolean or as a string,
 * and every non-empty string is truthy — `Boolean('false')` and `Boolean('0')`
 * would both activate a foreman who was being deactivated.
 */
function isTrue(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : v;
  return s === true || s === 1 || s === 'true' || s === '1';
}

async function setForeman(db, body) {
  const phone = String(body.phone || '').trim();
  const name = String(body.name || '').trim();
  const barn = String(body.barn || '').trim();
  if (!/^\+1\d{10}$/.test(phone)) throw createError('VALIDATION_ERROR', 'phone must be E.164, e.g. +15415551234');
  if (!name) throw createError('VALIDATION_ERROR', 'name is required');
  if (!BARN_LABELS[barn]) throw createError('VALIDATION_ERROR', 'barn must be upper or bottom');
  const active = isTrue(body.active) ? 1 : 0;
  await execute(db, `
    INSERT INTO harvest_foremen (phone, name, barn, active, active_since)
    VALUES (?, ?, ?, ?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END)
    ON CONFLICT(phone) DO UPDATE SET name = excluded.name, barn = excluded.barn, active = excluded.active,
      active_since = CASE WHEN excluded.active = 1 AND harvest_foremen.active = 0 THEN datetime('now') ELSE harvest_foremen.active_since END
  `, [phone, name, barn, active, active]);
  // One active foreman per barn, on this path too — the same rule EMPEZAR
  // enforces. Two active phones would mean two prompts for one hour and two
  // half-answers racing for one row.
  if (active) {
    await execute(db, `UPDATE harvest_foremen SET active = 0 WHERE barn = ? AND phone <> ?`, [barn, phone]);
  }
  return { foreman: await queryOne(db, `SELECT * FROM harvest_foremen WHERE phone = ?`, [phone]) };
}

// ─── HTTP: POST /sms/inbound (Twilio) ──────────────────────────────────

export async function handleSmsInbound(request, env, ctx) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const form = await parseBody(request);            // application/x-www-form-urlencoded

  if (env.TWILIO_AUTH_TOKEN) {
    // Twilio signs the URL it was configured with. Behind a custom domain or a
    // proxy, request.url is the worker's own URL and every signature fails —
    // TWILIO_WEBHOOK_URL pins the string Twilio actually signed.
    const signedUrl = env.TWILIO_WEBHOOK_URL || request.url;
    const ok = await verifyTwilioSignature(env.TWILIO_AUTH_TOKEN, signedUrl, form,
      request.headers.get('x-twilio-signature'));
    if (!ok) {
      console.warn(`[sms] bad Twilio signature (verified against ${signedUrl})`);
      return new Response('Forbidden', { status: 403 });
    }
  } else {
    console.warn('[sms] TWILIO_AUTH_TOKEN unset — inbound is unauthenticated');
  }

  // Reply over the REST API, not TwiML, so the simulate path and the real path
  // share one code path. Twilio just needs a 200 with an empty <Response/>.
  ctx.waitUntil(processInbound(env, {
    from: String(form.From || ''), text: String(form.Body || ''), sid: String(form.MessageSid || ''), deliver: true,
  }).catch(e => console.error(`[sms] inbound failed: ${e.message}`)));

  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    { status: 200, headers: { 'Content-Type': 'text/xml' } });
}

// ─── CORE: one inbound text ────────────────────────────────────────────

/**
 * @returns string[] the texts sent (or, with deliver=false, that would be sent)
 */
export async function processInbound(env, { from, text, sid, deliver, now = new Date() }) {
  const db = env.DB;
  const isTest = isTestMode(env) ? 1 : 0;

  // Dedupe on Twilio's message id: a redelivery must not write twice.
  if (sid) {
    const { changes } = await execute(db,
      `INSERT OR IGNORE INTO harvest_sms_inbox (message_sid, from_phone, body) VALUES (?, ?, ?)`, [sid, from, text]);
    if (changes === 0) return [];
  }

  const foreman = await queryOne(db, `SELECT * FROM harvest_foremen WHERE phone = ?`, [from]);
  if (!foreman) {
    console.log(`[sms] ignored text from unregistered ${from}: ${text.slice(0, 80)}`);
    return [];
  }

  const replies = [];
  const say = (t) => replies.push(t);
  const c = classifyInbound(text);

  if (c.kind === 'start') {
    await execute(db, `UPDATE harvest_foremen SET active = 1, active_since = ? WHERE phone = ?`, [sqliteUtc(now), from]);
    // One active foreman per barn — the last EMPEZAR wins, so a handover does
    // not leave two phones being texted for the same hour.
    await execute(db, `UPDATE harvest_foremen SET active = 0 WHERE barn = ? AND phone <> ?`, [foreman.barn, from]);
    say('Listo. Te pregunto cada hora en punto. PARAR para terminar el dia.');
  } else if (c.kind === 'stop') {
    await execute(db, `UPDATE harvest_foremen SET active = 0 WHERE phone = ?`, [from]);
    const rows = await query(db, `SELECT racks FROM harvest_hourly
      WHERE harvest_date = ? AND barn = ? AND is_test = ?`, [pacificDay(now), foreman.barn, isTest]);
    say(`Ok, paramos. Hoy ${BARN_LABELS[foreman.barn]}: ${sumRacks(rows)} racks. Gracias.`);
  } else if (c.kind === 'help') {
    say(helpText(foreman.barn));
  } else {
    // c.text is the parse input (hour prefix stripped); text is what the
    // foreman actually sent, and that is what raw_reply has to preserve.
    await answer(db, env, { foreman, hour: c.hour, text: c.text, rawText: text, from, isTest, now, say });
  }

  if (deliver) {
    for (const t of replies) await sendSms(env, { to: from, body: t });
  }
  return replies;
}

async function answer(db, env, { foreman, hour, text, rawText, from, isTest, now, say }) {
  const day = pacificDay(now);
  const barn = foreman.barn;
  const je = justEndedHour(now);
  // A bare hour below 6 is read as PM, so "5: 4 2 3 8 1 12" sent at 10 AM
  // means 17:00 — an hour that has not happened. Creating that row would give
  // the day a future hour that swallows every later un-prefixed answer and
  // gets nudged and flagged missing hours before the crew reaches it.
  const isFuture = (h) => !je || h > je.hour_start;

  let row;
  if (hour) {
    if (isFuture(hour)) { say(futureHourText()); return; }
    // A named past hour is a backfill: the bot never asked for it, so asked_at
    // stays null rather than claiming a prompt that was never sent.
    row = await getOrCreateRow(db, { day, hour, barn, isTest, season: seasonOf(day), now, asked: false });
  } else {
    row = je ? await openRow(db, { day, barn, isTest, maxHour: je.hour_start }) : null;
    if (!row) {
      // An open row is answerable even after the auto-stop — that is how the
      // reply to the 19:00 prompt still lands. Only with nothing open does an
      // inactive foreman get told to start the day.
      if (!foreman.active) { say('Escribe EMPEZAR para comenzar el dia.'); return; }
      if (!je) { say('Todavia no hay hora que reportar.'); return; }
      row = await getOrCreateRow(db, { day: je.harvest_date, hour: je.hour_start, barn, isTest, season: seasonOf(je.harvest_date), now, asked: true });
    }
  }

  let parsed;
  try {
    parsed = await parseReply(text, { barn, hour_start: row.hour_start, missing: missingFields(row) }, env);
  } catch (e) {
    // A network fault or the 20 s timeout — the foreman's text was fine, so
    // telling him "no entendi" would send him rewriting a correct message.
    console.error(`[hourly] parse call failed for ${from}: ${e.message}`);
    say(temporaryErrorText());
    return;
  }
  if (!parsed) { say(notUnderstoodText()); return; }

  // A model-detected hour ("las 9") retargets only when the text had no prefix.
  if (!hour && parsed.hour_override && /^\d{2}:00$/.test(parsed.hour_override) && parsed.hour_override !== row.hour_start) {
    if (isFuture(parsed.hour_override)) { say(futureHourText()); return; }
    row = await getOrCreateRow(db, { day, hour: parsed.hour_override, barn, isTest, season: seasonOf(day), now, asked: false });
  }

  const { values, invalid } = validateCounts(parsed);
  // "Sin novedad" is not a note — normalizeNotes drops it, so a day summary is
  // not padded with six copies of "nothing to report".
  const note = normalizeNotes(parsed.notes);

  // Additive, in SQL rather than read-modify-write: two texts seconds apart
  // both read the same row, and a full-row UPDATE from the second would erase
  // what the first wrote. COALESCE lets each write land only the fields it
  // actually carries, so the counts merge instead of racing. Notes append for
  // the same reason — the latest reply must not drop an earlier one.
  await execute(db, `
    UPDATE harvest_hourly SET
      cutters = COALESCE(?, cutters),
      cutter_water_spiders = COALESCE(?, cutter_water_spiders),
      drivers = COALESCE(?, drivers),
      hangers = COALESCE(?, hangers),
      hanging_water_spiders = COALESCE(?, hanging_water_spiders),
      racks = COALESCE(?, racks),
      notes = CASE WHEN ? IS NULL THEN notes WHEN notes IS NULL THEN ? ELSE notes || '; ' || ? END,
      raw_reply = ?, reported_by = ?, answered_at = ?
    WHERE id = ?
  `, [values.cutters, values.cutter_water_spiders, values.drivers, values.hangers,
      values.hanging_water_spiders, values.racks, note, note, note,
      rawText, from, sqliteUtc(now), row.id]);

  // Re-read rather than reason about what the row now holds: the write above
  // merged against whatever was on disk, which may include a concurrent reply.
  const fresh = await queryOne(db, `SELECT * FROM harvest_hourly WHERE id = ?`, [row.id]);
  const still = missingFields(fresh);

  // A partial answer on a row already flagged missing goes back to nudged —
  // and must restamp nudged_at, or the stale one makes the next tick flip it
  // straight back to missing and alert Telegram a second time.
  const status = still.length ? (fresh.status === 'missing' ? 'nudged' : fresh.status) : 'complete';
  const nudgedAt = still.length && fresh.status === 'missing' ? sqliteUtc(now) : null;
  // `status <> 'complete'` for the same reason the counts use COALESCE: a reply
  // racing this one may have completed the row between the re-read and here,
  // and writing 'nudged' over it would un-finish a finished hour and earn it a
  // spurious reminder plus a Telegram alert. A row never goes backwards.
  await execute(db, `UPDATE harvest_hourly SET status = ?, nudged_at = COALESCE(?, nudged_at)
    WHERE id = ? AND status <> 'complete'`, [status, nudgedAt, row.id]);

  // Out of range is worth saying even when the row came out complete: the old
  // value survived (COALESCE kept it) and the foreman should know his did not.
  const why = invalid.length ? `Numero fuera de rango: ${invalid.map(f => FIELD_ES[f]).join(', ')}. ` : '';
  if (still.length) {
    say(why + askMissingText(fresh));
  } else {
    say(why + (invalid.length ? 'Se mantiene el valor anterior. ' : '') + confirmText(fresh));
  }
}

/**
 * The newest finished hour still awaiting an answer today, or null.
 * `maxHour` is the last hour that has actually ended: a stray future row left
 * by an earlier bug would otherwise sort first and swallow every answer.
 */
function openRow(db, { day, barn, isTest, maxHour }) {
  return queryOne(db, `SELECT * FROM harvest_hourly WHERE harvest_date = ? AND barn = ? AND is_test = ?
    AND status IN ('pending', 'nudged') AND hour_start <= ? ORDER BY hour_start DESC LIMIT 1`,
    [day, barn, isTest, maxHour]);
}

/**
 * @param asked true when the bot is the one asking for this hour (asked_at is
 *   the prompt's clock); false for a backfill the foreman volunteered, where
 *   there is no prompt to timestamp.
 */
async function getOrCreateRow(db, { day, hour, barn, isTest, season, now, asked }) {
  const find = () => queryOne(db, `SELECT * FROM harvest_hourly WHERE harvest_date = ? AND hour_start = ? AND barn = ? AND is_test = ?`,
    [day, hour, barn, isTest]);
  const existing = await find();
  if (existing) return existing;
  // OR IGNORE: an inbound text can race the tick's own INSERT for the same
  // barn-hour. The loser must not throw — it re-reads the winner's row, which
  // is the row it wanted either way.
  await execute(db, `INSERT OR IGNORE INTO harvest_hourly (season, harvest_date, hour_start, barn, status, asked_at, is_test)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)`, [season, day, hour, barn, asked ? sqliteUtc(now) : null, isTest]);
  return await find();
}

// ─── CRON: every 5 minutes ─────────────────────────────────────────────

export async function runHarvestHourlyTick(env, now = new Date()) {
  const db = env.DB;
  const isTest = isTestMode(env) ? 1 : 0;
  const { hour: hourNow } = pacificParts(now);
  const je = justEndedHour(now);
  const day = pacificDay(now);
  let acted = 0;

  // ── (a) Every open row today, driven by the rows rather than by the roster.
  // An open row is the barn's business whether or not anyone is on shift: the
  // 20:00 tick asks for 19:00 and then auto-stops, and a foreman-driven pass
  // would never come back for that row — it would never nudge, never go
  // missing, never reach Telegram, never show in missing_hours. Same story
  // after PARAR with a nudged row still open.
  const open = await query(db, `SELECT * FROM harvest_hourly WHERE harvest_date = ? AND is_test = ?
    AND status IN ('pending', 'nudged') ORDER BY barn, hour_start`, [day, isTest]);

  // Whoever is on the barn now, else whoever was on it last — one lookup per
  // barn, not per row.
  const contacts = new Map();
  for (const row of open) {
    // Per row, not per barn: one bad phone number must not abandon the rest.
    try {
      if (!contacts.has(row.barn)) {
        contacts.set(row.barn, await queryOne(db, `SELECT phone, name, active_since FROM harvest_foremen
          WHERE barn = ? ORDER BY active DESC, active_since DESC LIMIT 1`, [row.barn]));
      }
      const f = contacts.get(row.barn);
      if (!f) {
        console.warn(`[hourly-tick] no foreman registered for barn ${row.barn} — ${row.hour_start} left open`);
        continue;
      }
      const d = tickDecision(row, now, { activeSince: f.active_since });
      if (!d) continue;
      // Every send is gated on its own guarded write winning. A doubled or
      // retried tick loses the WHERE-clause race, writes nothing, and so
      // sends nothing — the row state is what makes a text at-most-once.
      if (d.type === 'nudge') {
        const { changes } = await execute(db,
          `UPDATE harvest_hourly SET status = 'nudged', nudged_at = ? WHERE id = ? AND status = 'pending'`, [sqliteUtc(now), row.id]);
        if (!changes) continue;
        acted++;
        await sendSms(env, { to: f.phone, body: reminderText(row.barn, row.hour_start) });
      } else if (d.type === 'missing') {
        const { changes } = await execute(db,
          `UPDATE harvest_hourly SET status = 'missing' WHERE id = ? AND status = 'nudged'`, [row.id]);
        if (!changes) continue;
        acted++;
        await sendTelegramMessage(env, {
          chatId: env.TELEGRAM_HARVEST_HOURLY_CHAT_ID || env.TELEGRAM_TEST_CHAT_ID,
          text: `⏰ Sin respuesta: ${BARN_LABELS[row.barn]} ${row.hour_start} (${f.name})`,
        });
      }
    } catch (e) {
      console.error(`[hourly-tick] ${row.barn} ${row.hour_start}: ${e.message}`);
    }
  }

  // ── (b) ask and (c) auto-stop stay on the active roster: only a foreman who
  // is on shift gets asked for a new hour or told the day is over.
  const foremen = await query(db, `SELECT * FROM harvest_foremen WHERE active = 1`);

  for (const f of foremen) {
    // One barn's bad phone number must not stop the other barn's hour.
    try {
      // (b) The just-ended hour, when it has no row at all. A row that exists
      // was already handled above, or is finished and needs nothing.
      if (je) {
        const exists = await queryOne(db, `SELECT id FROM harvest_hourly WHERE harvest_date = ? AND hour_start = ? AND barn = ? AND is_test = ?`,
          [je.harvest_date, je.hour_start, f.barn, isTest]);
        if (!exists && tickDecision(null, now, { activeSince: f.active_since })) {
          const { changes } = await execute(db, `INSERT OR IGNORE INTO harvest_hourly (season, harvest_date, hour_start, barn, status, asked_at, is_test)
            VALUES (?, ?, ?, ?, 'pending', ?, ?)`, [seasonOf(je.harvest_date), je.harvest_date, je.hour_start, f.barn, sqliteUtc(now), isTest]);
          if (changes) {
            acted++;
            await sendSms(env, { to: f.phone, body: promptText(f.barn, je.hour_start) });
          }
        }
      }

      // (c) Auto-stop last on purpose: at 20:00 the 19:00 hour still gets its
      // prompt above before this tick says "Paramos por hoy". active_since
      // scopes the three-missed rule to the current run, so a foreman who
      // texts EMPEZAR again is not stopped by the run before it.
      const recent = await query(db, `SELECT status, asked_at FROM harvest_hourly WHERE harvest_date = ? AND barn = ? AND is_test = ?
        AND status IN ('complete', 'missing') ORDER BY hour_start DESC LIMIT 3`, [day, f.barn, isTest]);
      if (shouldAutoStop({ hourNow, recent, activeSince: f.active_since })) {
        const { changes } = await execute(db, `UPDATE harvest_foremen SET active = 0 WHERE phone = ? AND active = 1`, [f.phone]);
        if (changes) {
          acted++;
          await sendSms(env, { to: f.phone, body: 'Paramos por hoy. Escribe EMPEZAR manana.' });
        }
      }
    } catch (e) {
      console.error(`[hourly-tick] ${f.phone}: ${e.message}`);
    }
  }
  return { acted };
}

// ─── READ ──────────────────────────────────────────────────────────────

async function readDay(db, env, date) {
  const isTest = isTestMode(env) ? 1 : 0;
  const rows = await query(db, `SELECT * FROM harvest_hourly WHERE harvest_date = ? AND is_test = ? ORDER BY barn, hour_start`, [date, isTest]);
  const roster = await queryOne(db, `SELECT * FROM harvest_crew_roster WHERE effective_to IS NULL AND is_test = ? ORDER BY effective_from DESC LIMIT 1`, [isTest]);

  const barns = {};
  for (const barn of Object.keys(BARN_LABELS)) {
    const mine = rows.filter(r => r.barn === barn);
    const done = mine.filter(r => r.status === 'complete');
    // Crew rates need whole hours to divide by, so person-hours and the
    // racks-per-hanger-hour ratio stay over complete rows only. Racks do not:
    // a rack hung is a rack hung even if the crew counts never came in.
    const sum = (f) => done.reduce((s, r) => s + (r[f] || 0), 0);
    const personHours = ['cutters', 'cutter_water_spiders', 'drivers', 'hangers', 'hanging_water_spiders'].reduce((s, f) => s + sum(f), 0);
    const hangerHours = sum('hangers');
    barns[barn] = {
      label: BARN_LABELS[barn],
      rows: mine,
      total_racks: sumRacks(mine),
      person_hours: personHours,
      racks_per_hanger_hour: hangerHours ? Math.round((sum('racks') / hangerHours) * 100) / 100 : null,
      missing_hours: mine.filter(r => r.status === 'missing').map(r => r.hour_start),
      latest: done[done.length - 1] || null,
    };
  }
  return { date, is_test: isTest, roster, barns };
}
