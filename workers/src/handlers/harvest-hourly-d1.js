/**
 * Harvest hourly crew log — SMS bot handler (D1).
 *
 * One Spanish text per barn per hour to its foreman; the reply is understood by
 * the Capataz relay on FERN and written back through hourly_set, as one
 * harvest_hourly row per barn-hour. The worker keeps the clock, the rows and
 * the Twilio credentials, and never calls a model itself: EMPEZAR / PARAR /
 * AYUDA are answered inline, everything else is queued in harvest_sms_inbox for
 * the relay to drain.
 * Design: wiki/operations/plans/2026-09-11-harvest-hourly-sms-bot-design.md (v2)
 *
 * Endpoints (dispatched from index.js):
 * - POST /sms/inbound                              Twilio webhook (signature-verified)
 * - GET  /api/harvest?action=hourly&date=YYYY-MM-DD   rows + day summary   [password]
 * - GET  /api/harvest?action=foremen               registry                 [password]
 * - POST /api/harvest?action=foreman_set           {phone,name,barn,active} [password]
 * - POST /api/harvest?action=hourly_simulate       {from, body} -> replies  [password]
 *   (commands always; a chat text only while HARVEST_TEST_MODE is true, or the
 *   simulated text joins the real queue and the live relay answers a real phone)
 * - GET  /api/harvest?action=hourly_test           health
 * - GET  /api/harvest?action=sms_poll&limit=N      queued chat texts + context  [sms key]
 * - POST /api/harvest?action=sms_send              {to, text}                   [sms key]
 * - POST /api/harvest?action=hourly_set            {phone, hour_start?, counts} [sms key]
 * - cron: runHarvestHourlyTick(env) from the five-minute branch (isFiveMinCron
 *   in index.js). Spelled out in words: the cron string's own slash-star form
 *   would close this comment block.
 */
import { query, queryOne, execute } from '../lib/db.js';
import { successResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { requireAuth, requireBearer } from '../lib/auth.js';
import { sendTelegramMessage } from '../lib/telegram.js';
import { sendSms, verifyTwilioSignature } from '../lib/sms.js';
import { pacificDay, pacificParts, justEndedHour, sqliteUtc, parseSqliteUtc } from '../lib/pacific.js';
import {
  BARN_LABELS, COUNT_FIELDS, FIELD_ES, validateCounts, missingFields, classifyInbound,
  promptText, reminderText, helpText, confirmText, askMissingText, futureHourText,
  normalizeNotes, tickDecision, shouldAutoStop, STOP_HOUR,
  gsmSafe, smsSegments, buildPollContext,
} from '../lib/harvest-hourly.js';

export const HOURLY_ACTIONS = new Set([
  'hourly', 'foremen', 'foreman_set', 'hourly_simulate', 'hourly_test',
  'sms_poll', 'sms_send', 'hourly_set',
]);

// The relay's own bearer, not the farm password: a key sitting on a bot host
// must not also unlock orders. One secret for all three host endpoints.
const SMS_KEY = 'HARVEST_SMS_KEY';

const POLL_LIMIT_DEFAULT = 20;
const POLL_LIMIT_MAX = 100;
// Three GSM-7 segments — 459 characters once concatenated, not 480: past the
// first segment every one of them gives up 7 characters to the header. A reply
// this long is a relay bug, not a message to a foreman standing in a barn.
const MAX_SMS_SEGMENTS = 3;

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
      // A simulated chat text on production goes into the real queue, and the
      // live relay answers it with a real SMS to a real foreman. Commands are
      // safe (the worker answers them inline and nothing leaves the process
      // unless deliver=true), so only the queueing path is gated.
      if (classifyInbound(String(body.body)).kind === 'answer' && !isTestMode(env)) {
        throw createError('VALIDATION_ERROR',
          'simulate only queues chat texts while HARVEST_TEST_MODE is true');
      }
      // Same shape as the real path: { replies } for a command, { queued } for
      // a chat text the relay will answer.
      return successResponse(await processInbound(env, {
        from: String(body.from), text: String(body.body), sid: `SIM-${Date.now()}`, deliver: false,
      }));
    }
    case 'sms_poll':
      requireBearer(request, body, env, SMS_KEY, 'harvest-sms-poll');
      return successResponse(await pollSms(db, env, params.limit));
    case 'sms_send':
      requireBearer(request, body, env, SMS_KEY, 'harvest-sms-send');
      return successResponse(await sendToForeman(db, env, body));
    case 'hourly_set':
      requireBearer(request, body, env, SMS_KEY, 'harvest-hourly-set');
      return successResponse(await setHourly(db, env, body));
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
 * @returns {{ replies: string[], queued: boolean, message_sid: string|null }}
 *   `replies` are the texts sent (or, with deliver=false, that would be sent);
 *   `queued` is true when the text was left in the inbox for the Capataz relay,
 *   which is what answers everything that is not a command.
 */
export async function processInbound(env, { from, text, sid, deliver, now = new Date() }) {
  const db = env.DB;
  const isTest = isTestMode(env) ? 1 : 0;
  const out = (replies = [], queued = false) => ({ replies, queued, message_sid: sid || null });

  // Dedupe on Twilio's message id: a redelivery must not write twice.
  //
  // Inserted processed=1 — CLAIMED BY THE WORKER — and released to the relay
  // only once this function has decided the text is chat. Inserted at 0, the
  // row would be pollable for the three round-trips it takes to classify it,
  // and the relay would answer an EMPEZAR the worker is also answering: the
  // foreman gets two texts. The narrow cost is that a worker that dies between
  // here and the release leaves a chat row claimed and unanswerable; a lost
  // text beats a doubled one, and the row keeps the foreman's words either way.
  if (sid) {
    const { changes } = await execute(db,
      `INSERT OR IGNORE INTO harvest_sms_inbox (message_sid, from_phone, body, processed) VALUES (?, ?, ?, 1)`,
      [sid, from, text]);
    if (changes === 0) return out();
  }

  const foreman = await queryOne(db, `SELECT * FROM harvest_foremen WHERE phone = ?`, [from]);
  if (!foreman) {
    console.log(`[sms] ignored text from unregistered ${from}: ${text.slice(0, 80)}`);
    // Closed out here, not left queued: the relay must never be handed a number
    // it cannot attribute, and an unanswerable row would sit in the queue
    // forever tripping the tick's staleness watchdog.
    await markInbox(db, { sid, kind: 'ignored', now });
    return out();
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
    // v2: a chat text is not understood here. The day never starts or stops on
    // a model, but everything else belongs to the Capataz relay. Release the
    // row it has been holding claimed since the INSERT — this is the only place
    // processed goes back to 0, and after it the text is the relay's.
    if (!sid) {
      console.warn(`[sms] chat text from ${from} has no MessageSid — nothing to queue`);
      return out([], false);
    }
    await execute(db, `UPDATE harvest_sms_inbox SET kind = 'chat', processed = 0 WHERE message_sid = ?`, [sid]);
    return out([], true);
  }

  await markInbox(db, { sid, kind: 'command', now, replied: true });

  if (deliver) {
    for (const t of replies) await sendSms(env, { to: from, body: t });
  }
  return out(replies);
}

/**
 * Close an inbox row the worker itself dealt with, so the relay never sees it.
 *
 * For the W3 watchdog: `replied_at` stays NULL on an 'ignored' row, because no
 * reply was sent and recording one would be a lie. So "the relay took a text
 * and never answered" has to be asked as delivered_at IS NOT NULL AND
 * replied_at IS NULL — never as processed=1 AND replied_at IS NULL, which
 * would count every ignored row forever. (And the staleness clause's
 * population, processed=0, includes the rows pollSms deliberately leaves
 * behind when a phone has no foreman: a deleted foreman would otherwise make
 * Capataz look permanently stalled.)
 */
function markInbox(db, { sid, kind, now, replied = false }) {
  if (!sid) return Promise.resolve({ changes: 0 });
  return execute(db, `UPDATE harvest_sms_inbox SET kind = ?, processed = 1, replied_at = ? WHERE message_sid = ?`,
    [kind, replied ? sqliteUtc(now) : null, sid]);
}

/**
 * The write core of an hourly report: pick the hour, merge the counts, settle
 * the status, and produce the Spanish line to text back.
 *
 * v1 called this from the inbound path with the output of an inline Anthropic
 * parse; v2 calls it only from hourly_set, where the Capataz relay supplies the
 * numbers through the farm-bridge tool. Every rule below is unchanged — which
 * is the point of it being one function: the worker's idea of an hour must not
 * differ depending on who is writing it.
 *
 * @param hour 'HH:00' when an hour was named, else null (target the open hour)
 * @param values the six counts as given, unvalidated — validateCounts range-checks
 * @returns {{ row, missing, invalid, reply, refused }} `refused` is
 *   'future_hour' | 'not_started' | 'no_hour_yet' with a null row when no hour
 *   could be targeted at all. `reply` is always the text to send back.
 */
export async function applyHourlyReport(db, env, { foreman, hour, values: given, notes, rawText, now = new Date() }) {
  const isTest = isTestMode(env) ? 1 : 0;
  const day = pacificDay(now);
  const barn = foreman.barn;
  const je = justEndedHour(now);
  const refuse = (reason, reply) => ({ row: null, missing: [], invalid: [], reply, refused: reason });
  // A bare hour below 6 is read as PM, so "5: 4 2 3 8 1 12" sent at 10 AM
  // means 17:00 — an hour that has not happened. Creating that row would give
  // the day a future hour that swallows every later un-prefixed answer and
  // gets nudged and flagged missing hours before the crew reaches it.
  const isFuture = (h) => !je || h > je.hour_start;

  let row;
  if (hour) {
    if (isFuture(hour)) return refuse('future_hour', futureHourText());
    // A named past hour is a backfill: the bot never asked for it, so asked_at
    // stays null rather than claiming a prompt that was never sent.
    row = await getOrCreateRow(db, { day, hour, barn, isTest, season: seasonOf(day), now, asked: false });
  } else {
    row = je ? await openRow(db, { day, barn, isTest, maxHour: je.hour_start }) : null;
    if (!row) {
      // An open row is answerable even after the auto-stop — that is how the
      // reply to the 19:00 prompt still lands. Only with nothing open does an
      // inactive foreman get told to start the day. This check comes first on
      // purpose: during the 00:xx hour an inactive foreman should be told to
      // text EMPEZAR, not that there is no hour yet.
      if (!foreman.active) return refuse('not_started', 'Escribe EMPEZAR para comenzar el dia.');
      if (!je) return refuse('no_hour_yet', 'Todavia no hay hora que reportar.');
      row = await getOrCreateRow(db, { day: je.harvest_date, hour: je.hour_start, barn, isTest, season: seasonOf(je.harvest_date), now, asked: true });
    }
  }

  const { values, invalid } = validateCounts(given || {});
  // "Sin novedad" is not a note — normalizeNotes drops it, so a day summary is
  // not padded with six copies of "nothing to report".
  const note = normalizeNotes(notes);

  // Additive, in SQL rather than read-modify-write: two texts seconds apart
  // both read the same row, and a full-row UPDATE from the second would erase
  // what the first wrote. COALESCE lets each write land only the fields it
  // actually carries, so the counts merge instead of racing. Notes append for
  // the same reason — the latest reply must not drop an earlier one.
  // raw_reply is COALESCEd rather than overwritten because raw_text is optional
  // on hourly_set: a tool call made without it must not erase the foreman's
  // words that an earlier call did carry.
  await execute(db, `
    UPDATE harvest_hourly SET
      cutters = COALESCE(?, cutters),
      cutter_water_spiders = COALESCE(?, cutter_water_spiders),
      drivers = COALESCE(?, drivers),
      hangers = COALESCE(?, hangers),
      hanging_water_spiders = COALESCE(?, hanging_water_spiders),
      racks = COALESCE(?, racks),
      notes = CASE WHEN ? IS NULL THEN notes WHEN notes IS NULL THEN ? ELSE notes || '; ' || ? END,
      raw_reply = COALESCE(?, raw_reply), reported_by = ?, answered_at = ?
    WHERE id = ?
  `, [values.cutters, values.cutter_water_spiders, values.drivers, values.hangers,
      values.hanging_water_spiders, values.racks, note, note, note,
      rawText || null, foreman.phone, sqliteUtc(now), row.id]);

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
  const wrote = await execute(db, `UPDATE harvest_hourly SET status = ?, nudged_at = COALESCE(?, nudged_at)
    WHERE id = ? AND status <> 'complete'`, [status, nudgedAt, row.id]);

  // Out of range is worth saying even when the row came out complete: the old
  // value survived (COALESCE kept it) and the foreman should know his did not.
  const why = invalid.length ? `Numero fuera de rango: ${invalid.map(f => FIELD_ES[f]).join(', ')}. ` : '';
  const reply = still.length
    ? why + askMissingText(fresh)
    : why + (invalid.length ? 'Se mantiene el valor anterior. ' : '') + confirmText(fresh);
  // Report the row as it actually stands. When the guarded write found nothing
  // it is because a reply racing this one completed the hour between the
  // re-read and here — so read it once more rather than hand the relay a
  // 'nudged' row and have it chase numbers that are already in.
  const settled = wrote.changes
    ? { ...fresh, status }
    : (await queryOne(db, `SELECT * FROM harvest_hourly WHERE id = ?`, [row.id])) || fresh;
  return { row: settled, missing: still, invalid, reply, refused: null };
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

// ─── HOST ENDPOINTS: the Capataz relay on FERN ─────────────────────────

/**
 * Hand the relay the chat texts nobody has answered yet, each with everything
 * needed to answer it. Rows are claimed as they go out — two overlapping polls
 * (or a retry after a dropped response) must not give one text to two sessions,
 * which would answer the foreman twice.
 */
async function pollSms(db, env, limitRaw) {
  const isTest = isTestMode(env) ? 1 : 0;
  const limit = Math.min(Math.max(Number(limitRaw) || POLL_LIMIT_DEFAULT, 1), POLL_LIMIT_MAX);
  const now = new Date();
  const day = pacificDay(now);
  // The foreman filter is in the SQL, not the loop: an orphaned row (its sender
  // deleted from the roster) is one nobody can ever answer, and left in the
  // window it would consume a slot on every poll forever and starve the real
  // texts behind it.
  const pending = await query(db, `SELECT message_sid, from_phone, body, received_at FROM harvest_sms_inbox
    WHERE kind = 'chat' AND processed = 0 AND from_phone IN (SELECT phone FROM harvest_foremen)
    ORDER BY received_at LIMIT ?`, [limit]);

  const foremen = new Map();      // phone -> row | null
  const dayRows = new Map();      // barn  -> today's harvest_hourly rows
  const messages = [];

  for (const m of pending) {
    // Per row: one text whose context cannot be built must not cost the relay
    // the rest of the batch, and must not stay claimed — it is released below
    // so the next poll retries it rather than losing it.
    let claimed = false;
    try {
      if (!foremen.has(m.from_phone)) {
        foremen.set(m.from_phone, await queryOne(db, `SELECT * FROM harvest_foremen WHERE phone = ?`, [m.from_phone]));
      }
      const foreman = foremen.get(m.from_phone);
      // Unreachable now that the SELECT filters on the roster, and it stays
      // here anyway: never hand the relay a number it cannot attribute.
      if (!foreman) {
        console.warn(`[sms-poll] no foreman for ${m.from_phone} — leaving ${m.message_sid} queued`);
        continue;
      }

      // Claim the row before returning it: two overlapping polls (or a retry
      // after a dropped response) must not hand one text to two sessions.
      const { changes } = await execute(db, `UPDATE harvest_sms_inbox SET processed = 1, delivered_at = ?
        WHERE message_sid = ? AND processed = 0`, [sqliteUtc(now), m.message_sid]);
      if (!changes) continue;
      claimed = true;

      if (!dayRows.has(foreman.barn)) {
        dayRows.set(foreman.barn, await query(db, `SELECT * FROM harvest_hourly
          WHERE harvest_date = ? AND barn = ? AND is_test = ? ORDER BY hour_start`, [day, foreman.barn, isTest]));
      }
      messages.push({
        message_sid: m.message_sid,
        from_phone: m.from_phone,
        body: m.body,
        received_at: m.received_at,
        context: buildPollContext(dayRows.get(foreman.barn), foreman, now),
      });
    } catch (e) {
      console.error(`[sms-poll] ${m.message_sid}: ${e.message}`);
      if (claimed) {
        // Put it back. A row claimed and then dropped on the floor is a text
        // the foreman sent that nobody will ever answer, and the watchdog's
        // "delivered, never replied" clause would blame the relay for it.
        await execute(db, `UPDATE harvest_sms_inbox SET processed = 0, delivered_at = NULL WHERE message_sid = ?`,
          [m.message_sid]).catch(() => {});
      }
    }
  }
  return { messages };
}

/**
 * The relay's only way to reach a phone: Twilio's credentials stay on the
 * worker. Registered numbers only, and gsmSafe on the way out — the text was
 * written by a model, and one accent turns a one-segment confirmation into a
 * three-segment UCS-2 message.
 */
async function sendToForeman(db, env, body) {
  const to = String(body.to || '').trim();
  if (!to) throw createError('VALIDATION_ERROR', 'to is required');
  const foreman = await queryOne(db, `SELECT phone FROM harvest_foremen WHERE phone = ?`, [to]);
  if (!foreman) throw createError('NOT_FOUND', `No foreman registered for ${to}`);

  const text = gsmSafe(body.text);
  if (!text) throw createError('VALIDATION_ERROR', 'text is required');
  const segments = smsSegments(text);
  if (segments > MAX_SMS_SEGMENTS) {
    throw createError('VALIDATION_ERROR',
      `text is ${text.length} characters (${segments} segments); the limit is 3 segments (459 chars)`);
  }

  const sent = await sendSms(env, { to, body: text });
  // Best-effort marker for the tick watchdog: this phone's delivered texts are
  // no longer "taken by the relay and never answered". Which row it was is not
  // worth tracking — the watchdog only counts.
  await execute(db, `UPDATE harvest_sms_inbox SET replied_at = ?
    WHERE from_phone = ? AND replied_at IS NULL AND processed = 1`, [sqliteUtc(new Date()), to]);
  return { sent, text, segments: smsSegments(text) };
}

/** The six counts plus the fields the relay's model should see — no ids, no raw text. */
const publicRow = (r) => ({
  harvest_date: r.harvest_date, hour_start: r.hour_start, barn: r.barn, status: r.status,
  ...Object.fromEntries(COUNT_FIELDS.map(f => [f, r[f] ?? null])),
  notes: r.notes ?? null,
});

/**
 * The farm-bridge tool's endpoint: the relay has understood a foreman's text
 * and is writing the numbers. Refusals come back 200 with ok:false and a ready
 * Spanish reply — a refused hour is a normal conversational outcome, not an
 * HTTP fault, and the model has to relay the wording either way.
 */
async function setHourly(db, env, body) {
  const phone = String(body.phone || '').trim();
  if (!phone) throw createError('VALIDATION_ERROR', 'phone is required');
  const foreman = await queryOne(db, `SELECT * FROM harvest_foremen WHERE phone = ?`, [phone]);
  if (!foreman) throw createError('NOT_FOUND', `No foreman registered for ${phone}`);

  const rawHour = body.hour_start === undefined || body.hour_start === null ? '' : String(body.hour_start).trim();
  if (rawHour && !/^\d{2}:00$/.test(rawHour)) {
    throw createError('VALIDATION_ERROR', 'hour_start must be HH:00, e.g. 09:00');
  }

  // '' is the model's way of saying "not given" — treated as absent, or
  // validateCounts would call it invalid and the foreman would be told his
  // cortadores were out of range when he never mentioned them.
  const given = {};
  for (const f of COUNT_FIELDS) {
    const v = body[f];
    if (v !== undefined && v !== null && v !== '') given[f] = v;
  }
  const notes = body.notes;
  // An empty call would still target (or create) the hour's row and stamp
  // answered_at, which quietly cancels that hour's nudge without a single
  // number having been reported. Nothing to act on is a caller bug, not a
  // report. A count that is present but out of range IS something to act on:
  // it earns the "Numero fuera de rango" reply, which is how the foreman finds
  // out his number did not stick.
  const probe = validateCounts(given);
  const usable = COUNT_FIELDS.some(f => probe.values[f] !== null) || probe.invalid.length > 0;
  if (!usable && !String(notes ?? '').trim()) {
    throw createError('VALIDATION_ERROR', 'at least one count or notes is required');
  }

  const r = await applyHourlyReport(db, env, {
    foreman, hour: rawHour || null, values: given, notes, rawText: body.raw_text ?? null,
  });
  return r.refused
    ? { ok: false, reason: r.refused, reply: r.reply }
    : { ok: true, row: publicRow(r.row), missing: r.missing, invalid: r.invalid, reply: r.reply };
}

// ─── CRON: every 5 minutes ─────────────────────────────────────────────

// Strip the characters Telegram's Markdown parser chokes on, so a foreman
// name is never the reason an alert 400s.
const tgSafe = (s) => String(s).replace(/[_*\[\]`]/g, '');

// The Capataz relay is a process on another machine, and the failure it has
// that the worker does not is simply being down: texts queue up and the foreman
// is answered by nobody. Nothing is lost — but somebody has to be told.
const CAPATAZ_ALERT_KEY = 'capataz_stale_alert_at';
const CAPATAZ_STALE_MS = 3 * 60 * 1000;         // queued, nobody has polled it
const CAPATAZ_UNANSWERED_MS = 5 * 60 * 1000;    // polled, no reply ever sent
const CAPATAZ_ALERT_EVERY_MS = 30 * 60 * 1000;

/**
 * Is the relay draining the inbox? Two distinct failures, one alert.
 *
 * Both queries join harvest_foremen. A row whose sender has since been deleted
 * from the roster is one pollSms will never hand out and nobody will ever
 * answer: counted, it would pin the alert on forever and train Koa to ignore
 * it. The staleness population is exactly those un-polled rows, so the join
 * belongs there most of all.
 *
 * "Delivered but never answered" is asked as delivered_at IS NOT NULL AND
 * replied_at IS NULL — never as processed = 1 AND replied_at IS NULL, which
 * would also catch every 'ignored' row (processed by the worker, never replied
 * to by design) and alert forever.
 *
 * Either condition alone fires: a relay that polls and then dies mid-session
 * leaves nothing queued and everything unanswered, which is the failure the
 * staleness count cannot see.
 */
async function capatazWatchdog(db, env, now) {
  const t = now.getTime();
  const stale = await queryOne(db, `SELECT COUNT(*) AS n, MIN(i.received_at) AS oldest
    FROM harvest_sms_inbox i JOIN harvest_foremen f ON f.phone = i.from_phone
    WHERE i.kind = 'chat' AND i.processed = 0`);
  const mute = await queryOne(db, `SELECT COUNT(*) AS n
    FROM harvest_sms_inbox i JOIN harvest_foremen f ON f.phone = i.from_phone
    WHERE i.kind = 'chat' AND i.delivered_at IS NOT NULL AND i.replied_at IS NULL
      AND i.delivered_at < ?`, [sqliteUtc(new Date(t - CAPATAZ_UNANSWERED_MS))]);

  const waiting = stale?.n || 0;
  const unanswered = mute?.n || 0;
  const oldestMs = stale?.oldest ? t - parseSqliteUtc(stale.oldest).getTime() : 0;
  const stalled = waiting > 0 && oldestMs >= CAPATAZ_STALE_MS;
  if (!stalled && !unanswered) return 0;

  // At most one of these every 30 minutes: the tick runs every 5, and a relay
  // that is down is down for a while. A missing or unreadable timestamp falls
  // through to sending — an alert too many beats a silent outage.
  const last = await queryOne(db, `SELECT value FROM system_config WHERE key = ?`, [CAPATAZ_ALERT_KEY]);
  if (last?.value && t - parseSqliteUtc(last.value).getTime() < CAPATAZ_ALERT_EVERY_MS) return 0;
  // Claimed before the send, not after: sendTelegramMessage can be slow or
  // throw, and a doubled tick must not get past this on the retry.
  await execute(db, `
    INSERT INTO system_config (key, value, value_type, category, description, updated_at)
    VALUES (?, ?, 'string', 'harvest', 'Last Capataz relay staleness alert (SQLite UTC)', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `, [CAPATAZ_ALERT_KEY, sqliteUtc(now)]);

  const parts = [];
  if (stalled) parts.push(`${waiting} pendientes, el mas viejo ${Math.floor(oldestMs / 60000)} min`);
  if (unanswered) parts.push(`${unanswered} sin respuesta`);
  await sendTelegramMessage(env, {
    chatId: env.TELEGRAM_HARVEST_HOURLY_CHAT_ID || env.TELEGRAM_TEST_CHAT_ID,
    text: `⚠️ Capataz no esta drenando SMS (${parts.join(', ')})`,
  });
  return 1;
}

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
        // No reminders at night. The row still ages through nudged to missing
        // so the hour lands on the dashboard and in Telegram — it just does
        // not light up the foreman's phone while he is off the clock.
        if (hourNow < STOP_HOUR) {
          await sendSms(env, { to: f.phone, body: reminderText(row.barn, row.hour_start) });
        }
      } else if (d.type === 'missing') {
        const { changes } = await execute(db,
          `UPDATE harvest_hourly SET status = 'missing' WHERE id = ? AND status = 'nudged'`, [row.id]);
        if (!changes) continue;
        acted++;
        await sendTelegramMessage(env, {
          chatId: env.TELEGRAM_HARVEST_HOURLY_CHAT_ID || env.TELEGRAM_TEST_CHAT_ID,
          // sendTelegramMessage defaults to Markdown: an unescaped _ * [ ] ` in a
          // foreman's name makes Telegram 400 and the alert is lost.
          text: `⏰ Sin respuesta: ${BARN_LABELS[row.barn]} ${row.hour_start} (${tgSafe(f.name)})`,
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

  // ── (d) Is the Capataz relay alive? Its own failure mode, not the barn's:
  // wrapped so a watchdog fault never costs the tick its prompts and nudges.
  try {
    acted += await capatazWatchdog(db, env, now);
  } catch (e) {
    console.error(`[capataz-watchdog] ${e.message}`);
  }
  return { acted };
}

// ─── READ ──────────────────────────────────────────────────────────────

async function readDay(db, env, date) {
  const isTest = isTestMode(env) ? 1 : 0;
  const rows = await query(db, `SELECT * FROM harvest_hourly WHERE harvest_date = ? AND is_test = ? ORDER BY barn, hour_start`, [date, isTest]);
  const roster = await queryOne(db, `SELECT * FROM harvest_crew_roster WHERE effective_to IS NULL AND is_test = ? ORDER BY effective_from DESC LIMIT 1`, [isTest]);
  // Queue depth, not a count for this date: the inbox has no harvest_date, and
  // what the dashboard card is reporting is "texts Capataz has not picked up",
  // which is a right-now number whatever day is being read.
  const pending = await queryOne(db, `SELECT COUNT(*) AS n FROM harvest_sms_inbox WHERE kind = 'chat' AND processed = 0`);

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
  return { date, is_test: isTest, roster, barns, pending_sms: pending?.n || 0 };
}
