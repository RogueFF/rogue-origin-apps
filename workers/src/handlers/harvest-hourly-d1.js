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
 * - cron: runHarvestHourlyTick(env) from the isFiveMinCron branch
 *   (the every-5-minute schedule; written out because the cron string's own
 *   slash-star spelling would close this comment)
 */
import { query, queryOne, execute } from '../lib/db.js';
import { successResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { sendTelegramMessage } from '../lib/telegram.js';
import { sendSms, verifyTwilioSignature } from '../lib/sms.js';
import { pacificDay, pacificParts, justEndedHour, sqliteUtc } from '../lib/pacific.js';
import {
  COUNT_FIELDS, BARN_LABELS, validateCounts, missingFields, classifyInbound,
  promptText, reminderText, helpText, confirmText, askMissingText, notUnderstoodText,
  normalizeNotes, tickDecision, shouldAutoStop,
} from '../lib/harvest-hourly.js';
import { parseReply } from '../lib/harvest-hourly-parse.js';

export const HOURLY_ACTIONS = new Set(['hourly', 'foremen', 'foreman_set', 'hourly_simulate', 'hourly_test']);

const isTestMode = (env) => env.HARVEST_TEST_MODE !== 'false';
// The season is the harvest date's own year, not the wall-clock year: a row
// written just after midnight UTC still belongs to the Pacific day it reports.
const seasonOf = (day) => Number(day.slice(0, 4));

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

async function setForeman(db, body) {
  const phone = String(body.phone || '').trim();
  const name = String(body.name || '').trim();
  const barn = String(body.barn || '').trim();
  if (!/^\+1\d{10}$/.test(phone)) throw createError('VALIDATION_ERROR', 'phone must be E.164, e.g. +15415551234');
  if (!name) throw createError('VALIDATION_ERROR', 'name is required');
  if (!BARN_LABELS[barn]) throw createError('VALIDATION_ERROR', 'barn must be upper or bottom');
  const active = body.active ? 1 : 0;
  await execute(db, `
    INSERT INTO harvest_foremen (phone, name, barn, active, active_since)
    VALUES (?, ?, ?, ?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END)
    ON CONFLICT(phone) DO UPDATE SET name = excluded.name, barn = excluded.barn, active = excluded.active,
      active_since = CASE WHEN excluded.active = 1 AND harvest_foremen.active = 0 THEN datetime('now') ELSE harvest_foremen.active_since END
  `, [phone, name, barn, active, active]);
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
    const day = pacificDay(now);
    const tot = await queryOne(db, `SELECT COALESCE(SUM(racks), 0) AS racks FROM harvest_hourly
      WHERE harvest_date = ? AND barn = ? AND is_test = ?`, [day, foreman.barn, isTest]);
    say(`Ok, paramos. Hoy ${BARN_LABELS[foreman.barn]}: ${tot.racks} racks. Gracias.`);
  } else if (c.kind === 'help') {
    say(helpText(foreman.barn));
  } else {
    await answer(db, env, { foreman, hour: c.hour, text: c.text, from, isTest, now, say });
  }

  if (deliver) {
    for (const t of replies) await sendSms(env, { to: from, body: t });
  }
  return replies;
}

async function answer(db, env, { foreman, hour, text, from, isTest, now, say }) {
  const day = pacificDay(now);
  const barn = foreman.barn;

  let row;
  if (hour) {
    row = await getOrCreateRow(db, { day, hour, barn, isTest, season: seasonOf(day) });
  } else {
    if (!foreman.active) { say('Escribe EMPEZAR para comenzar el dia.'); return; }
    row = await queryOne(db, `SELECT * FROM harvest_hourly WHERE harvest_date = ? AND barn = ? AND is_test = ?
      AND status IN ('pending', 'nudged') ORDER BY hour_start DESC LIMIT 1`, [day, barn, isTest]);
    if (!row) {
      const je = justEndedHour(now);
      if (!je) { say('Todavia no hay hora que reportar.'); return; }
      row = await getOrCreateRow(db, { day: je.harvest_date, hour: je.hour_start, barn, isTest, season: seasonOf(je.harvest_date) });
    }
  }

  const parsed = await parseReply(text, { barn, hour_start: row.hour_start, missing: missingFields(row) }, env);
  if (!parsed) { say(notUnderstoodText()); return; }

  // A model-detected hour ("las 9") retargets only when the text had no prefix.
  if (!hour && parsed.hour_override && /^\d{2}:00$/.test(parsed.hour_override) && parsed.hour_override !== row.hour_start) {
    row = await getOrCreateRow(db, { day, hour: parsed.hour_override, barn, isTest, season: seasonOf(day) });
  }

  const { values, invalid } = validateCounts(parsed);
  const merged = { ...row };
  for (const f of COUNT_FIELDS) if (values[f] !== null) merged[f] = values[f];
  // "Sin novedad" is not a note — normalizeNotes drops it, so a day summary is
  // not padded with six copies of "nothing to report".
  const note = normalizeNotes(parsed.notes);
  if (note) merged.notes = row.notes ? `${row.notes}; ${note}` : note;

  const still = missingFields(merged);
  const status = still.length ? (row.status === 'missing' ? 'nudged' : row.status === 'complete' ? 'complete' : row.status) : 'complete';
  await execute(db, `
    UPDATE harvest_hourly SET cutters = ?, cutter_water_spiders = ?, drivers = ?, hangers = ?, hanging_water_spiders = ?,
      racks = ?, notes = ?, raw_reply = ?, reported_by = ?, answered_at = ?, status = ?
    WHERE id = ?
  `, [merged.cutters, merged.cutter_water_spiders, merged.drivers, merged.hangers, merged.hanging_water_spiders,
      merged.racks, merged.notes ?? null, text, from, sqliteUtc(now), status, row.id]);

  if (still.length) {
    const why = invalid.length ? `Numero fuera de rango: ${invalid.join(', ')}. ` : '';
    say(why + askMissingText({ ...merged, hour_start: row.hour_start }));
  } else {
    say(confirmText({ ...merged, hour_start: row.hour_start, barn }));
  }
}

async function getOrCreateRow(db, { day, hour, barn, isTest, season }) {
  const existing = await queryOne(db, `SELECT * FROM harvest_hourly WHERE harvest_date = ? AND hour_start = ? AND barn = ? AND is_test = ?`,
    [day, hour, barn, isTest]);
  if (existing) return existing;
  await execute(db, `INSERT INTO harvest_hourly (season, harvest_date, hour_start, barn, status, asked_at, is_test)
    VALUES (?, ?, ?, ?, 'pending', datetime('now'), ?)`, [season, day, hour, barn, isTest]);
  return await queryOne(db, `SELECT * FROM harvest_hourly WHERE harvest_date = ? AND hour_start = ? AND barn = ? AND is_test = ?`,
    [day, hour, barn, isTest]);
}

// ─── CRON: every 5 minutes ─────────────────────────────────────────────

export async function runHarvestHourlyTick(env, now = new Date()) {
  const db = env.DB;
  const isTest = isTestMode(env) ? 1 : 0;
  const foremen = await query(db, `SELECT * FROM harvest_foremen WHERE active = 1`);
  if (!foremen.length) return { acted: 0 };

  const { hour: hourNow } = pacificParts(now);
  const je = justEndedHour(now);
  const day = pacificDay(now);
  let acted = 0;

  for (const f of foremen) {
    // One barn's bad phone number must not stop the other barn's hour. Each
    // foreman is isolated; the write still lands before the send, so a failed
    // text leaves a row that the next tick can move forward.
    try {
      const recent = await query(db, `SELECT status, asked_at FROM harvest_hourly WHERE harvest_date = ? AND barn = ? AND is_test = ?
        AND status IN ('complete', 'missing') ORDER BY hour_start DESC LIMIT 3`, [day, f.barn, isTest]);
      // active_since scopes the three-missed rule to the current run, so a
      // foreman who texts EMPEZAR again is not stopped by the run before it.
      if (shouldAutoStop({ hourNow, recent, activeSince: f.active_since })) {
        await execute(db, `UPDATE harvest_foremen SET active = 0 WHERE phone = ?`, [f.phone]);
        await sendSms(env, { to: f.phone, body: 'Paramos por hoy. Escribe EMPEZAR manana.' });
        acted++;
        continue;
      }
      if (!je) continue;

      const row = await queryOne(db, `SELECT * FROM harvest_hourly WHERE harvest_date = ? AND hour_start = ? AND barn = ? AND is_test = ?`,
        [je.harvest_date, je.hour_start, f.barn, isTest]);
      const d = tickDecision(row, now, { activeSince: f.active_since });
      if (!d) continue;
      acted++;

      if (d.type === 'ask') {
        await execute(db, `INSERT OR IGNORE INTO harvest_hourly (season, harvest_date, hour_start, barn, status, asked_at, is_test)
          VALUES (?, ?, ?, ?, 'pending', ?, ?)`, [seasonOf(je.harvest_date), je.harvest_date, je.hour_start, f.barn, sqliteUtc(now), isTest]);
        await sendSms(env, { to: f.phone, body: promptText(f.barn, je.hour_start) });
      } else if (d.type === 'nudge') {
        await execute(db, `UPDATE harvest_hourly SET status = 'nudged', nudged_at = ? WHERE id = ? AND status = 'pending'`, [sqliteUtc(now), row.id]);
        await sendSms(env, { to: f.phone, body: reminderText(f.barn, je.hour_start) });
      } else if (d.type === 'missing') {
        await execute(db, `UPDATE harvest_hourly SET status = 'missing' WHERE id = ? AND status = 'nudged'`, [row.id]);
        await sendTelegramMessage(env, {
          chatId: env.TELEGRAM_HARVEST_HOURLY_CHAT_ID || env.TELEGRAM_TEST_CHAT_ID,
          text: `⏰ Sin respuesta: ${BARN_LABELS[f.barn]} ${je.hour_start} (${f.name})`,
        });
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
    const sum = (f) => done.reduce((s, r) => s + (r[f] || 0), 0);
    const personHours = ['cutters', 'cutter_water_spiders', 'drivers', 'hangers', 'hanging_water_spiders'].reduce((s, f) => s + sum(f), 0);
    const hangerHours = sum('hangers');
    barns[barn] = {
      label: BARN_LABELS[barn],
      rows: mine,
      total_racks: sum('racks'),
      person_hours: personHours,
      racks_per_hanger_hour: hangerHours ? Math.round((sum('racks') / hangerHours) * 100) / 100 : null,
      missing_hours: mine.filter(r => r.status === 'missing').map(r => r.hour_start),
      latest: mine.filter(r => r.status === 'complete').slice(-1)[0] || null,
    };
  }
  return { date, is_test: isTest, roster, barns };
}
