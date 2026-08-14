/**
 * Harvest Zone-Entry & Barn-Intake API Handler — D1
 *
 * TEST/PROTOTYPE BUILD. Lets cutters scan a per-zone QR code ("entering this
 * zone now" — auto-closes whatever zone was previously open) and lets barn
 * staff log trailer loads against whichever zone is currently active. All
 * writes are tagged is_test=1 by default (see isTestMode below) so they can
 * be bulk-deleted before the real October 2026 harvest.
 *
 * Endpoints:
 * - GET  ?zone=Z4&action=enter                          - Zone-entry scan (HTML)
 * - GET  ?zone=Z4&action=headcount&session_id=&count=    - Headcount tap (HTML)
 * - GET  ?action=barn_intake                             - Barn-intake form (HTML)
 * - POST ?action=barn_log            (body: zone, bins)  - Barn-intake submit (HTML)
 * - GET  ?action=test                                    - Health check (JSON)
 * - GET  ?action=status                                  - Current active zone (JSON)
 * - GET  ?action=logs&zone=&event_type=&limit=            - Raw rows (JSON)
 *
 * Supersack tags (see docs/plans/2026-08-06-supersack-tag-design.md):
 * - GET  ?action=sack_print                              - Lot picker, starts a takedown session (HTML)
 * - POST ?action=sack_session_start (session_id,cultivar) - Enter the session screen (HTML)
 * - GET  ?action=sack_session&session_id=&cultivar=      - The session screen itself (HTML)
 * - POST ?action=sack_alloc      (session_id,cultivar,qty) - Allocate serial(s) (JSON, called by fetch)
 * - POST ?action=sack_void       (sack_id)               - Void a mis-printed tag (JSON)
 * - GET  ?action=sack_label&id=|ids=                     - Label sheet; reprint reuses SAME serial (HTML)
 * - POST ?action=sack_weigh      (sack_id,tops,smalls)   - Record weights at bucking (HTML)
 * - GET  ?action=sacks&...                               - Raw sack rows (JSON)
 * The scan target /s/<sack_id> is routed in index.js and handled by
 * handleSackScan below (short URL = denser, more scannable QR).
 *
 * Design: wiki/operations/plans/2026-07-06-seed-to-sale-harvest-tracking.md
 */

import { query, queryOne, execute, transaction } from '../lib/db.js';
import { successResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { createError, formatError } from '../lib/errors.js';
import { VALID_ZONES, normalizeZone } from '../lib/zones.js';
import { cultivarsFor, isMultiCultivar } from '../lib/zone-cultivars.js';
import { zoneFacts, plantCountFor, PLANTS_PER_ACRE, PLANT_SPACING_FT } from '../lib/zone-facts.js';
import { sendTelegramMessage } from '../lib/telegram.js';

const DEBOUNCE_MS = 5 * 60 * 1000;       // re-scanning the same active zone within this window is a no-op
const CUT_RESUME_GRACE_HOURS = 8;        // re-entering a zone within this many hours of its last close = same cut
const HEADCOUNT_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1); // 1-12, plus a 13+ link

const MAX_PRINT_QTY = 40;                // sanity cap on one print run
const LOT_PICKER_DAYS = 45;              // how far back the takedown lot picker looks

// Drying window, used only to sanity-check the takedown lot pick (advisory,
// never blocking). 10 days/batch confirmed by Koa 2026-08-04; the min/max are
// generous bounds around it, not targets.
const DRY_DAYS_TYPICAL = 10;
const DRY_DAYS_MIN = 6;
const DRY_DAYS_MAX = 21;

// Flat field-to-barn round trip. Varies by zone (farther zones take longer) and
// the per-zone breakdown is expected to fall out of real harvest data — treat
// this as directional until then. Used only for the implied-driver estimate.
const ROUND_TRIP_MIN = 12.5;

/**
 * Standing constants for the rollup.
 *
 * `value: null` means NOT YET MEASURED. Anything derived from a null constant
 * renders as pending rather than as a number — a fabricated figure here would
 * get quoted back as real months later, and the whole point of the ledger is
 * that its numbers can be trusted. Fill these in and the columns light up with
 * no code change.
 */
const CONSTANTS = {
  binWeightLbsWet: {
    value: null,
    label: '1 bin = ? lbs wet',
    unblocks: 'wet lbs, wet:dry ratio',
    how: 'spot-weigh ~10 full bins at season start',
  },
  wageRateByRole: {
    value: null,
    label: 'harvest wage rate by role',
    unblocks: 'labor cost, cost/rack, cost/lb',
    how: 'set by the labor contractor; not the trim crew BASE_WAGE_RATE',
  },
  supersackLbs: { value: 37, label: '1 supersack = 37 lbs', unblocks: null, how: 'confirmed 2026-08-03' },
  binsPerTrailer: { value: 22, label: '1 trailer = 22 bins', unblocks: null, how: 'recalibrate once 2026 trailers run' },
  plantsPerBin: { value: 1, label: '1 bin = 1 plant', unblocks: null, how: 'recalibrate once real' },
};
const PUBLIC_BASE = 'https://rogue-origin-api.roguefamilyfarms.workers.dev';

const HTML_ACTIONS = new Set([
  'enter', 'headcount', 'barn_intake', 'barn_log',
  'sack_print', 'sack_session_start', 'sack_session', 'sack_label', 'sack_weigh',
  'crew', 'crew_set',
]);

export async function handleHarvestD1(request, env, ctx) {
  const body = request.method === 'POST' ? await parseBody(request) : {};
  const action = getAction(request, body);
  const params = getQueryParams(request);
  const db = env.DB;

  // HTML-rendering actions are phone/tablet-facing — never let an error
  // fall through to the JSON errorResponse in index.js's global catch.
  if (HTML_ACTIONS.has(action)) {
    try {
      switch (action) {
        case 'enter':
          return await handleEnter(db, env, ctx, params);
        case 'headcount':
          return await handleHeadcount(db, env, ctx, params);
        case 'barn_intake':
          return await handleBarnIntakeForm(db, env, ctx);
        case 'barn_log':
          return await handleBarnLog(db, env, ctx, body);
        case 'sack_print':
          return await handleSackPrintForm(db, env);
        case 'sack_session_start':
          return await handleSackSession(db, env, body);
        case 'sack_session':
          return await handleSackSession(db, env, params);
        case 'sack_label':
          return await handleSackLabel(db, env, params);
        case 'sack_weigh':
          return await handleSackWeigh(db, env, ctx, body);
        case 'crew':
          return await handleCrewForm(db, env);
        case 'crew_set':
          return await handleCrewSet(db, env, ctx, body);
      }
    } catch (e) {
      const { message, status } = formatError(e);
      return errorPage(message, status);
    }
  }

  switch (action) {
    case 'test':
      return successResponse({ success: true, message: 'Harvest API operational (TEST MODE)' });
    case 'status':
      return await getStatus(db, env);
    case 'logs':
      return await getLogs(db, env, params);
    case 'sacks':
      return await getSacks(db, env, params);
    case 'rollup':
      return await getRollup(db, env, params);
    case 'sack_alloc':
      return await handleSackAlloc(db, env, ctx, body);
    case 'sack_void':
      return await handleSackVoid(db, env, ctx, body);
    default:
      throw createError('NOT_FOUND', `Unknown harvest action: ${action}`);
  }
}

/**
 * GET /z/<zone> — the zone-sign QR target, e.g. /z/Z4. Same behaviour as
 * ?action=enter, but the short path keeps the printed QR low-version with
 * chunky modules. These signs are laminated and staked outdoors for a whole
 * season, so scan robustness against dust, glare and fading matters more than
 * anywhere else in the system — and the URL can't be changed after printing.
 */
export async function handleZoneScan(request, env, ctx) {
  try {
    const url = new URL(request.url);
    const zone = normalizeZone(url.pathname.replace(/^\/z\//, '').trim());
    if (!zone || !VALID_ZONES.has(zone)) {
      throw createError('VALIDATION_ERROR', `Unknown zone "${zone ?? ''}". Check the QR code and try again.`);
    }

    const params = { zone };
    const picked = url.searchParams.get('cultivar');
    if (url.searchParams.get('test_cut')) params.test_cut = url.searchParams.get('test_cut');

    const options = cultivarsFor(zone);
    if (isMultiCultivar(zone) && !picked) {
      // Trial / split zone: a lot is zone x cultivar x cut, so we can't open a
      // session until we know which cultivar is being cut. One sign per zone
      // with a picker beats a separate QR per cultivar — no wrong code to scan.
      return renderPage(`${zone} — pick cultivar`, cultivarPickerBody(zone, options));
    }
    if (picked) {
      if (!options.includes(picked)) {
        throw createError('VALIDATION_ERROR', `"${picked}" isn't planted in ${zone}.`);
      }
      params.cultivar = picked;
    } else {
      params.cultivar = options[0] || null;   // single-cultivar zone: auto-fill
    }

    return await handleEnter(env.DB, env, ctx, params);
  } catch (e) {
    const { message, status } = formatError(e);
    return errorPage(message, status);
  }
}

/**
 * GET /s/<sack_id> — the QR scan target. Routed separately in index.js so the
 * encoded URL stays short: a shorter payload means a lower-version QR with
 * bigger modules, which is what survives a scuffed label in barn lighting.
 */
export async function handleSackScan(request, env, ctx) {
  try {
    const sackId = new URL(request.url).pathname.replace(/^\/s\//, '').trim();
    const sack = await queryOne(env.DB, `SELECT * FROM harvest_sacks WHERE sack_id = ?`, [sackId]);
    if (!sack) {
      return errorPage(`No sack found with ID "${sackId}". Check the tag and try again.`, 404);
    }
    return renderPage(`Sack ${sack.sack_id}`, sackDetailBody(sack));
  } catch (e) {
    const { message, status } = formatError(e);
    return errorPage(message, status);
  }
}

// ─── MODE ───────────────────────────────────────────────
// Defaults to test mode (is_test=1) so this build stays isolated from real
// harvest data. Flip HARVEST_TEST_MODE="false" (env var, not secret) once
// this graduates to the real October build — no code change needed.
function isTestMode(env) {
  return env.HARVEST_TEST_MODE !== 'false';
}

function getSeason() {
  return new Date().getUTCFullYear();
}

// SQLite's datetime('now') returns "YYYY-MM-DD HH:MM:SS" (UTC, no offset).
function parseSqliteUtc(ts) {
  return new Date(ts.replace(' ', 'T') + 'Z');
}

// ─── ZONE-ENTRY (cutters) ───────────────────────────────

async function handleEnter(db, env, ctx, params) {
  const zone = normalizeZone(params.zone);
  if (!zone || !VALID_ZONES.has(zone)) {
    throw createError('VALIDATION_ERROR', `Unknown zone "${params.zone ?? ''}". Check the QR code and try again.`);
  }

  const isTest = isTestMode(env) ? 1 : 0;
  const season = getSeason();
  const active = await getActiveSession(db, isTest);
  const now = new Date();

  // Cultivar comes from the picker (multi-cultivar zones) or auto-fills from
  // the planting record. A lot is zone x cultivar x cut throughout.
  const cultivar = params.cultivar || cultivarsFor(zone)[0] || null;

  // Idempotency guard: a phone refresh/back-button/link-preview re-hitting
  // the same zone's URL moments later shouldn't open a second session. Keyed on
  // cultivar too, so switching cultivar inside one trial zone still opens a new
  // lot rather than being swallowed as a duplicate scan.
  if (active && active.zone === zone && active.cultivar === cultivar &&
      (now - parseSqliteUtc(active.occurred_at)) < DEBOUNCE_MS) {
    return renderPage('Already entered', alreadyEnteredBody(active));
  }

  if (active) {
    await execute(db, `UPDATE harvest_scan_log SET closed_at = datetime('now') WHERE id = ?`, [active.id]);
  }

  const cutNumber = await computeCutNumber(db, zone, cultivar, season, isTest, params.test_cut);

  const result = await execute(db, `
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, is_test)
    VALUES ('enter', ?, ?, ?, ?, ?)
  `, [zone, cultivar, season, cutNumber, isTest]);
  const sessionId = result.lastRowId;

  const prevNote = active
    ? `Previous lot *${active.zone}${active.cultivar ? ` ${active.cultivar}` : ''}* auto-closed.`
    : 'No prior zone was open.';
  ctx.waitUntil(sendTelegramMessage(env, {
    chatId: env.TELEGRAM_TEST_CHAT_ID,
    text: `🌿 Entered *${zone}*${cultivar ? ` — ${cultivar}` : ''} — Cut ${cutNumber}\n${prevNote}`,
  }).catch(e => console.error('[harvest][telegram]', e)));

  return renderPage(`Entered ${zone}`, enterBody({
    zone, cultivar, cutNumber, sessionId,
    prevZone: active ? `${active.zone}${active.cultivar ? ` ${active.cultivar}` : ''}` : null,
  }));
}

async function getActiveSession(db, isTest) {
  return queryOne(db, `
    SELECT * FROM harvest_scan_log
    WHERE event_type = 'enter' AND closed_at IS NULL AND is_test = ?
    ORDER BY occurred_at DESC, id DESC LIMIT 1
  `, [isTest]);
}

async function getLastClosedSession(db, zone, cultivar, season, isTest) {
  return queryOne(db, `
    SELECT * FROM harvest_scan_log
    WHERE event_type = 'enter' AND zone = ? AND cultivar IS ? AND season = ?
      AND closed_at IS NOT NULL AND is_test = ?
    ORDER BY closed_at DESC, id DESC LIMIT 1
  `, [zone, cultivar, season, isTest]);
}

// Same-day grace window: a lot re-entered within CUT_RESUME_GRACE_HOURS of its
// last close is a resumption of the same cut, not a new one — fixes the gap
// where a crew finishes part of a zone, works elsewhere, then returns
// same-shift (see 2025 log: "Finished Z8, partial Z7, partial Z5").
//
// Keyed on (zone, cultivar): in a trial zone, Z10 "Lemon" cut 1 is independent
// of Z10 "Rocket Sauce" cut 1.
async function computeCutNumber(db, zone, cultivar, season, isTest, testCutParam) {
  const forced = parseInt(testCutParam, 10);
  if (Number.isInteger(forced) && forced >= 1 && forced <= 9) return forced;

  const last = await getLastClosedSession(db, zone, cultivar, season, isTest);
  if (!last) return 1;

  const hoursSinceClose = (Date.now() - parseSqliteUtc(last.closed_at).getTime()) / (1000 * 60 * 60);
  return hoursSinceClose <= CUT_RESUME_GRACE_HOURS ? last.cut_number : last.cut_number + 1;
}

// ─── HEADCOUNT (cutters, one-tap follow-up) ────────────

async function handleHeadcount(db, env, ctx, params) {
  const sessionId = parseInt(params.session_id, 10);
  const count = parseInt(params.count, 10);

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    throw createError('VALIDATION_ERROR', 'Missing or invalid session_id.');
  }
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw createError('VALIDATION_ERROR', 'Headcount must be a number between 1 and 20.');
  }

  const session = await queryOne(db, `SELECT * FROM harvest_scan_log WHERE id = ? AND event_type = 'enter'`, [sessionId]);
  if (!session) {
    throw createError('NOT_FOUND', `No zone-entry session found for id ${sessionId}.`);
  }

  await execute(db, `UPDATE harvest_scan_log SET headcount = ?, headcount_at = datetime('now') WHERE id = ?`, [count, sessionId]);

  ctx.waitUntil(sendTelegramMessage(env, {
    chatId: env.TELEGRAM_TEST_CHAT_ID,
    text: `👥 ${count} cutter${count === 1 ? '' : 's'} in *${session.zone}* (cut ${session.cut_number})`,
  }).catch(e => console.error('[harvest][telegram]', e)));

  return renderPage('Headcount logged', headcountBody({ zone: session.zone, cutNumber: session.cut_number, sessionId, count }));
}

// ─── BARN INTAKE ────────────────────────────────────────

async function handleBarnIntakeForm(db, env, ctx) {
  const isTest = isTestMode(env) ? 1 : 0;
  const active = await getActiveSession(db, isTest);
  return renderPage('Barn Intake', barnIntakeFormBody(active));
}

async function handleBarnLog(db, env, ctx, body) {
  const zone = normalizeZone(body.zone);
  if (!zone || !VALID_ZONES.has(zone)) {
    throw createError('VALIDATION_ERROR', `Unknown zone "${body.zone ?? ''}".`);
  }
  const bins = parseInt(body.bins, 10);
  if (!Number.isInteger(bins) || bins < 1 || bins > 500) {
    throw createError('VALIDATION_ERROR', 'Bins must be a number between 1 and 500.');
  }

  const isTest = isTestMode(env) ? 1 : 0;
  const zoneSession = await queryOne(db, `
    SELECT * FROM harvest_scan_log
    WHERE event_type = 'enter' AND zone = ? AND closed_at IS NULL AND is_test = ?
    ORDER BY occurred_at DESC LIMIT 1
  `, [zone, isTest]);

  await execute(db, `
    INSERT INTO harvest_scan_log (event_type, zone, season, bins, attributed_zone_session_id, is_test)
    VALUES ('barn_load', ?, ?, ?, ?, ?)
  `, [zone, getSeason(), bins, zoneSession ? zoneSession.id : null, isTest]);

  const todayCount = await queryOne(db, `
    SELECT COUNT(*) as n FROM harvest_scan_log
    WHERE event_type = 'barn_load' AND zone = ? AND date(occurred_at) = date('now') AND is_test = ?
  `, [zone, isTest]);
  const loadNumber = (todayCount?.n) || 1;

  const cutNote = zoneSession ? `cut ${zoneSession.cut_number}` : 'no active session for this zone';
  ctx.waitUntil(sendTelegramMessage(env, {
    chatId: env.TELEGRAM_TEST_CHAT_ID,
    text: `🚚 Load: ${bins} bins → *${zone}* (${cutNote}). Load #${loadNumber} today for this zone.`,
  }).catch(e => console.error('[harvest][telegram]', e)));

  return renderPage('Load logged', barnLogConfirmBody({ zone, bins, loadNumber, hasActiveSession: !!zoneSession }));
}

// ─── SUPERSACK TAGS ─────────────────────────────────────
// Sacks are filled at TAKEDOWN, ~10 days after the material was cut — while
// the crew may be out cutting a different zone entirely. So none of this may
// ever attribute a sack to the "currently active" zone the way barn intake
// does; the operator explicitly picks which lot is coming down.

async function handleSackPrintForm(db, env) {
  const isTest = isTestMode(env) ? 1 : 0;
  const lots = await getRecentLots(db, isTest);
  return renderPage('Print Sack Tags', sackPrintFormBody(lots));
}

/**
 * Candidate lots for takedown, ordered by how likely each is to be the one
 * actually coming down.
 *
 * The takedown lot pick is the highest-stakes single input in the system: pick
 * wrong and every sack off that rack carries the wrong lineage, and nobody
 * finds out until analysis months later. The physical defence is the coloured
 * tape marking lot boundaries in the barn — this query exists to make the
 * screen agree with what the tape says, and to argue when it doesn't.
 *
 * Ready-first ordering, then longest-drying: a lot at the right age with no
 * sacks yet is almost always the answer; a lot cut two days ago almost never is.
 */
async function getRecentLots(db, isTest) {
  return query(db, `
    SELECT
      l.id, l.zone, l.cultivar, l.cut_number, l.occurred_at,
      CAST(julianday('now') - julianday(l.occurred_at) AS INTEGER) AS days_since_cut,
      COALESCE((
        SELECT COUNT(*) FROM harvest_sacks s
        WHERE s.zone_session_id = l.id AND s.is_test = l.is_test AND s.voided_at IS NULL
      ), 0) AS sacks_printed,
      (
        SELECT MAX(s.printed_at) FROM harvest_sacks s
        WHERE s.zone_session_id = l.id AND s.is_test = l.is_test AND s.voided_at IS NULL
      ) AS last_printed_at
    FROM harvest_scan_log l
    WHERE l.event_type = 'enter' AND l.is_test = ?
      AND julianday('now') - julianday(l.occurred_at) <= ?
    ORDER BY
      CASE
        WHEN CAST(julianday('now') - julianday(l.occurred_at) AS INTEGER) < ${DRY_DAYS_MIN} THEN 3  -- too green
        WHEN COALESCE((SELECT COUNT(*) FROM harvest_sacks s
                       WHERE s.zone_session_id = l.id AND s.is_test = l.is_test
                         AND s.voided_at IS NULL), 0) > 0 THEN 2                                    -- already started
        WHEN CAST(julianday('now') - julianday(l.occurred_at) AS INTEGER) > ${DRY_DAYS_MAX} THEN 1  -- overdue
        ELSE 0                                                                                      -- ready, untouched
      END,
      l.occurred_at ASC
  `, [isTest, LOT_PICKER_DAYS]);
}

/**
 * How plausible is it that this lot is the one physically coming down now?
 * Advisory only — the operator can always override, because the tape and their
 * eyes beat our heuristic. We warn, we don't block.
 */
function lotPlausibility(lot) {
  const d = lot.days_since_cut;
  if (d < DRY_DAYS_MIN) {
    return { level: 'green', note: `only ${d}d drying — too green to be coming down (dry cycle ~${DRY_DAYS_TYPICAL}d)` };
  }
  if (lot.sacks_printed > 0) {
    return { level: 'started', note: `${lot.sacks_printed} sack${lot.sacks_printed === 1 ? '' : 's'} already tagged from this lot` };
  }
  if (d > DRY_DAYS_MAX) {
    return { level: 'old', note: `${d}d drying — past the usual window, check this is right` };
  }
  return { level: 'ready', note: `${d}d drying — ready` };
}

/**
 * The takedown session screen. Picked once per lot, then it stays up while the
 * worker fills sack after sack — the PRINT TAG button allocates and prints
 * without navigating, so nobody loses their place mid-rack with gloves on.
 */
async function handleSackSession(db, env, input) {
  const sessionId = parseInt(input.session_id, 10);
  const cultivar = String(input.cultivar || '').trim().substring(0, 60);

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    throw createError('VALIDATION_ERROR', 'Pick which lot is coming down before printing.');
  }
  if (!cultivar) {
    throw createError('VALIDATION_ERROR', 'Cultivar is required — it prints on the tag.');
  }

  const lot = await requireLot(db, sessionId);
  const isTest = isTestMode(env) ? 1 : 0;
  const stats = await getLotTagStats(db, sessionId, isTest);

  return renderPage(`Takedown — ${lot.zone}`, sackSessionBody({ lot, cultivar, stats }));
}

async function requireLot(db, sessionId) {
  const lot = await queryOne(db, `SELECT * FROM harvest_scan_log WHERE id = ? AND event_type = 'enter'`, [sessionId]);
  if (!lot) throw createError('NOT_FOUND', `No harvest lot found for session ${sessionId}.`);
  return lot;
}

// Voided tags are excluded from the count — they were never a sack.
async function getLotTagStats(db, sessionId, isTest) {
  const row = await queryOne(db, `
    SELECT COUNT(*) AS printed,
           MAX(CASE WHEN voided_at IS NULL THEN sack_id END) AS last_sack_id
    FROM harvest_sacks
    WHERE zone_session_id = ? AND is_test = ? AND voided_at IS NULL
  `, [sessionId, isTest]);
  return { printed: row?.printed || 0, lastSackId: row?.last_sack_id || null };
}

/**
 * Allocate serial(s). Called by fetch() from the session screen, so it answers
 * JSON — the screen updates in place rather than navigating to the labels.
 */
async function handleSackAlloc(db, env, ctx, body) {
  const sessionId = parseInt(body.session_id, 10);
  const cultivar = String(body.cultivar || '').trim().substring(0, 60);
  const qty = parseInt(body.qty, 10) || 1;

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    throw createError('VALIDATION_ERROR', 'Missing lot.');
  }
  if (!cultivar) throw createError('VALIDATION_ERROR', 'Missing cultivar.');
  if (qty < 1 || qty > MAX_PRINT_QTY) {
    throw createError('VALIDATION_ERROR', `Quantity must be between 1 and ${MAX_PRINT_QTY}.`);
  }

  const lot = await requireLot(db, sessionId);
  const isTest = isTestMode(env) ? 1 : 0;
  const season = getSeason();
  const harvestDate = String(lot.occurred_at).substring(0, 10);

  // MAX+1 per season. The UNIQUE(season, serial) index means two simultaneous
  // allocations fail loudly rather than silently issuing two physical tags
  // carrying the same number.
  const row = await queryOne(db, `SELECT COALESCE(MAX(serial), 0) AS max_serial FROM harvest_sacks WHERE season = ?`, [season]);
  const startSerial = (row?.max_serial || 0) + 1;

  const ids = [];
  const statements = [];
  for (let i = 0; i < qty; i++) {
    const serial = startSerial + i;
    const sackId = formatSackId(season, serial);
    ids.push(sackId);
    statements.push({
      sql: `INSERT INTO harvest_sacks
              (sack_id, season, serial, zone, cultivar, cut_number, harvest_date, zone_session_id, is_test)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [sackId, season, serial, lot.zone, cultivar, lot.cut_number, harvestDate, lot.id, isTest],
    });
  }
  await transaction(db, statements);

  const stats = await getLotTagStats(db, sessionId, isTest);

  ctx.waitUntil(sendTelegramMessage(env, {
    chatId: env.TELEGRAM_TEST_CHAT_ID,
    text: `🏷️ ${qty} sack tag${qty === 1 ? '' : 's'} — *${cultivar}* ${lot.zone} cut ${lot.cut_number} (${ids[0]}${qty > 1 ? `–${ids[ids.length - 1]}` : ''}). ${stats.printed} for this lot.`,
  }).catch(e => console.error('[harvest][telegram]', e)));

  return successResponse({ success: true, ids, printed: stats.printed, last_sack_id: stats.lastSackId });
}

/**
 * Void a tag — the double-tap case: two serials issued, one sack. Voided
 * serials are never reused; a gap in the sequence is safe, a duplicate is not.
 */
async function handleSackVoid(db, env, ctx, body) {
  const sackId = String(body.sack_id || '').trim();
  const sack = await queryOne(db, `SELECT * FROM harvest_sacks WHERE sack_id = ?`, [sackId]);
  if (!sack) throw createError('NOT_FOUND', `No sack found with ID "${sackId}".`);
  if (sack.opened_at) {
    throw createError('VALIDATION_ERROR', `Sack ${sackId} already has weights recorded — it can't be voided.`);
  }

  await execute(db, `UPDATE harvest_sacks SET voided_at = datetime('now') WHERE sack_id = ? AND voided_at IS NULL`, [sackId]);

  const isTest = isTestMode(env) ? 1 : 0;
  const stats = await getLotTagStats(db, sack.zone_session_id, isTest);

  ctx.waitUntil(sendTelegramMessage(env, {
    chatId: env.TELEGRAM_TEST_CHAT_ID,
    text: `🚫 Voided tag *${sackId}* (${sack.cultivar || '?'} ${sack.zone}). ${stats.printed} for this lot.`,
  }).catch(e => console.error('[harvest][telegram]', e)));

  return successResponse({ success: true, voided: sackId, printed: stats.printed, last_sack_id: stats.lastSackId });
}

// Reprint path — looks the sack up and reuses its EXISTING serial. Never
// allocates a new one: two physical tags carrying different IDs for the same
// sack is unrecoverable once they're in the barn.
async function handleSackLabel(db, env, params) {
  // ?id= for a single reprint, ?ids=a,b,c for a freshly-allocated run. The
  // session screen loads this into a hidden iframe, which prints itself.
  const raw = String(params.ids || params.id || '').trim();
  const ids = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, MAX_PRINT_QTY);
  if (!ids.length) throw createError('VALIDATION_ERROR', 'No sack ID given.');

  const placeholders = ids.map(() => '?').join(',');
  const rows = await query(db, `SELECT * FROM harvest_sacks WHERE sack_id IN (${placeholders})`, ids);
  if (!rows.length) throw createError('NOT_FOUND', `No sack found with ID "${ids[0]}".`);

  // Preserve the requested order (SQL IN doesn't guarantee it).
  const byId = new Map(rows.map(r => [r.sack_id, r]));
  const sacks = ids.map(id => byId.get(id)).filter(Boolean);

  // ?preview=1 renders without firing the print dialog — for eyeballing a
  // label (or checking a long cultivar name fits) before committing paper.
  return renderLabelSheet(sacks, null, { autoPrint: params.preview !== '1' });
}

async function handleSackWeigh(db, env, ctx, body) {
  const sackId = String(body.sack_id || '').trim();
  const tops = parseFloat(body.tops_lbs);
  const smalls = parseFloat(body.smalls_lbs);

  if (!Number.isFinite(tops) || tops < 0 || tops > 500) {
    throw createError('VALIDATION_ERROR', 'Tops lbs must be a number between 0 and 500.');
  }
  if (!Number.isFinite(smalls) || smalls < 0 || smalls > 500) {
    throw createError('VALIDATION_ERROR', 'Smalls lbs must be a number between 0 and 500.');
  }

  const sack = await queryOne(db, `SELECT * FROM harvest_sacks WHERE sack_id = ?`, [sackId]);
  if (!sack) throw createError('NOT_FOUND', `No sack found with ID "${sackId}".`);

  await execute(db, `
    UPDATE harvest_sacks SET tops_lbs = ?, smalls_lbs = ?, opened_at = datetime('now') WHERE sack_id = ?
  `, [tops, smalls, sackId]);

  ctx.waitUntil(sendTelegramMessage(env, {
    chatId: env.TELEGRAM_TEST_CHAT_ID,
    text: `⚖️ Sack *${sackId}* opened — ${tops} lb tops / ${smalls} lb smalls (${sack.cultivar || '?'} ${sack.zone} cut ${sack.cut_number})`,
  }).catch(e => console.error('[harvest][telegram]', e)));

  const updated = await queryOne(db, `SELECT * FROM harvest_sacks WHERE sack_id = ?`, [sackId]);
  return renderPage(`Sack ${sackId}`, sackDetailBody(updated, 'Weights recorded.'));
}

function formatSackId(season, serial) {
  return `${String(season).slice(-2)}-${String(serial).padStart(4, '0')}`;
}

function qrUrlFor(sackId) {
  const target = `${PUBLIC_BASE}/s/${sackId}`;
  // 203px ≈ 1in at the ZP-450's 203dpi head, so the QR maps ~1:1 to printer
  // dots instead of being resampled.
  return `https://api.qrserver.com/v1/create-qr-code/?size=203x203&margin=0&data=${encodeURIComponent(target)}`;
}

// ─── JSON ACTIONS ───────────────────────────────────────

async function getStatus(db, env) {
  const isTest = isTestMode(env) ? 1 : 0;
  const active = await getActiveSession(db, isTest);
  return successResponse({
    success: true,
    season: getSeason(),
    is_test: !!isTest,
    active_zone: active ? {
      id: active.id,
      zone: active.zone,
      cultivar: active.cultivar,
      cut_number: active.cut_number,
      occurred_at: active.occurred_at,
      headcount: active.headcount,
      headcount_at: active.headcount_at,
    } : null,
  });
}

async function getLogs(db, env, params) {
  const { zone, event_type, limit: rawLimit } = params;
  const limit = Math.min(Math.max(parseInt(rawLimit, 10) || 200, 1), 1000);
  const isTest = isTestMode(env) ? 1 : 0;

  let sql = 'SELECT * FROM harvest_scan_log WHERE is_test = ?';
  const binds = [isTest];

  if (zone) {
    sql += ' AND zone = ?';
    binds.push(normalizeZone(zone));
  }
  if (event_type) {
    sql += ' AND event_type = ?';
    binds.push(String(event_type));
  }
  sql += ' ORDER BY occurred_at DESC, id DESC LIMIT ?';
  binds.push(limit);

  const rows = await query(db, sql, binds);
  return successResponse({ success: true, data: rows });
}

async function getSacks(db, env, params) {
  const { zone, sack_id, opened, limit: rawLimit } = params;
  const limit = Math.min(Math.max(parseInt(rawLimit, 10) || 200, 1), 1000);
  const isTest = isTestMode(env) ? 1 : 0;

  let sql = 'SELECT * FROM harvest_sacks WHERE is_test = ?';
  const binds = [isTest];

  if (zone) {
    sql += ' AND zone = ?';
    binds.push(normalizeZone(zone));
  }
  if (sack_id) {
    sql += ' AND sack_id = ?';
    binds.push(String(sack_id).trim());
  }
  if (opened === 'true') sql += ' AND opened_at IS NOT NULL';
  if (opened === 'false') sql += ' AND opened_at IS NULL';
  if (params.include_voided !== 'true') sql += ' AND voided_at IS NULL';

  sql += ' ORDER BY serial DESC LIMIT ?';
  binds.push(limit);

  const rows = await query(db, sql, binds);
  const totals = await queryOne(db, `
    SELECT SUM(CASE WHEN voided_at IS NULL THEN 1 ELSE 0 END) AS total,
           SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
           SUM(CASE WHEN voided_at IS NOT NULL THEN 1 ELSE 0 END) AS voided
    FROM harvest_sacks WHERE is_test = ?
  `, [isTest]);

  return successResponse({ success: true, season: getSeason(), totals, data: rows });
}

// ─── CREW ROSTER ────────────────────────────────────────
// Drivers, hangers, and the two water-spider roles — everyone the zone scan
// doesn't already count. Chain of periods, not a daily number: crew size is
// usually steady but genuinely changes mid-day, so a new roster closes the
// previous one and person-hours accrue per interval. Update on change, never
// on a timer.

const CREW_ROLES = [
  { key: 'drivers',               label: 'Drivers',               where: 'Field ↔ barn' },
  { key: 'cutter_water_spiders',  label: 'Cutter water spiders',  where: 'Field — bins to trailer' },
  { key: 'hangers',               label: 'Hangers',               where: 'Barn' },
  { key: 'hanging_water_spiders', label: 'Hanging water spiders', where: 'Barn — bins to hangers' },
];

async function getOpenRoster(db, isTest) {
  return queryOne(db, `
    SELECT * FROM harvest_crew_roster
    WHERE effective_to IS NULL AND is_test = ?
    ORDER BY effective_from DESC, id DESC LIMIT 1
  `, [isTest]);
}

async function handleCrewForm(db, env) {
  const isTest = isTestMode(env) ? 1 : 0;
  const current = await getOpenRoster(db, isTest);
  return renderPage('Crew', crewFormBody(current));
}

async function handleCrewSet(db, env, ctx, body) {
  const isTest = isTestMode(env) ? 1 : 0;
  const current = await getOpenRoster(db, isTest);

  const counts = {};
  for (const r of CREW_ROLES) {
    const raw = body[r.key];
    // Blank means "unchanged" rather than zero — the form pre-fills current
    // values so an operator changing one role doesn't have to retype the rest.
    if (raw === undefined || String(raw).trim() === '') {
      counts[r.key] = current ? current[r.key] : null;
      continue;
    }
    const n = parseInt(raw, 10);
    if (!Number.isInteger(n) || n < 0 || n > 99) {
      throw createError('VALIDATION_ERROR', `${r.label} must be a whole number from 0 to 99.`);
    }
    counts[r.key] = n;
  }

  const unchanged = current && CREW_ROLES.every(r => current[r.key] === counts[r.key]);
  if (unchanged) {
    return renderPage('Crew', crewConfirmBody(counts, 'No change — roster left as it was.'));
  }

  if (current) {
    await execute(db, `UPDATE harvest_crew_roster SET effective_to = datetime('now') WHERE id = ?`, [current.id]);
  }
  const note = body.note ? String(body.note).trim().substring(0, 200) : null;
  await execute(db, `
    INSERT INTO harvest_crew_roster
      (season, drivers, cutter_water_spiders, hangers, hanging_water_spiders, note, is_test)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [getSeason(), counts.drivers, counts.cutter_water_spiders, counts.hangers,
      counts.hanging_water_spiders, note, isTest]);

  const summary = CREW_ROLES.map(r => `${r.label}: ${counts[r.key] ?? '—'}`).join(' · ');
  ctx.waitUntil(sendTelegramMessage(env, {
    chatId: env.TELEGRAM_TEST_CHAT_ID,
    text: `👷 Crew updated\n${summary}${note ? `\n_${note}_` : ''}`,
  }).catch(e => console.error('[harvest][telegram]', e)));

  return renderPage('Crew', crewConfirmBody(counts, 'Crew updated.'));
}

/**
 * Person-hours per role across a day.
 *
 * Roster periods are clipped to the day's ACTIVE window (first to last capture
 * event) rather than run against wall-clock. Nobody clocks out, so an open
 * roster left overnight would otherwise bill 24 hours per person — this makes
 * over-counting structurally impossible instead of relying on discipline.
 */
async function crewPersonHours(db, isTest, dayIso) {
  const bounds = await queryOne(db, `
    SELECT MIN(occurred_at) AS first_event, MAX(occurred_at) AS last_event
    FROM harvest_scan_log WHERE date(occurred_at) = ? AND is_test = ?
  `, [dayIso, isTest]);
  if (!bounds?.first_event || !bounds?.last_event) return null;

  const periods = await query(db, `
    SELECT * FROM harvest_crew_roster
    WHERE is_test = ?
      AND date(effective_from) <= ?
      AND (effective_to IS NULL OR date(effective_to) >= ?)
    ORDER BY effective_from ASC
  `, [isTest, dayIso, dayIso]);
  if (!periods.length) return null;

  const winStart = parseSqliteUtc(bounds.first_event).getTime();
  const winEnd = parseSqliteUtc(bounds.last_event).getTime();
  const out = { active_hours: +((winEnd - winStart) / 3600000).toFixed(2) };
  for (const r of CREW_ROLES) out[r.key] = 0;

  for (const p of periods) {
    const s = Math.max(parseSqliteUtc(p.effective_from).getTime(), winStart);
    const e = Math.min(p.effective_to ? parseSqliteUtc(p.effective_to).getTime() : winEnd, winEnd);
    const hrs = (e - s) / 3600000;
    if (hrs <= 0) continue;
    for (const r of CREW_ROLES) out[r.key] += (p[r.key] || 0) * hrs;
  }
  for (const r of CREW_ROLES) out[r.key] = +out[r.key].toFixed(1);
  return out;
}

/**
 * Drivers implied by how fast loads actually arrive — free, no capture.
 *
 * Measures utilisation, which the roster cannot: if the roster says 3 drivers
 * but cadence implies 1.8, drivers are idling, and that is the number you want
 * before staffing a fourth. Roster = payroll, this = throughput.
 */
async function impliedDrivers(db, isTest, dayIso, rosteredAvg) {
  const loads = await query(db, `
    SELECT occurred_at FROM harvest_scan_log
    WHERE event_type = 'barn_load' AND date(occurred_at) = ? AND is_test = ?
    ORDER BY occurred_at ASC
  `, [dayIso, isTest]);
  if (loads.length < 3) return null;   // too few gaps to say anything honest

  const t = loads.map(l => parseSqliteUtc(l.occurred_at).getTime());
  const gaps = [];
  for (let i = 1; i < t.length; i++) {
    const g = (t[i] - t[i - 1]) / 60000;
    if (g > 0 && g < 120) gaps.push(g);      // drop overnight / break-length gaps
  }
  if (gaps.length < 2) return null;

  gaps.sort((a, b) => a - b);
  const medianGap = gaps[Math.floor(gaps.length / 2)];

  // Drivers needed to sustain the observed load cadence. Below 1 means a single
  // driver keeps up with room to spare — i.e. drivers are not the constraint.
  const required = ROUND_TRIP_MIN / medianGap;

  return {
    loads: loads.length,
    median_gap_min: +medianGap.toFixed(1),
    round_trip_min: ROUND_TRIP_MIN,
    drivers_required_for_cadence: +required.toFixed(2),
    drivers_rostered_avg: rosteredAvg !== null ? +rosteredAvg.toFixed(2) : null,
    utilisation_pct: rosteredAvg ? Math.round((required / rosteredAvg) * 100) : null,
    reading: rosteredAvg
      ? (required / rosteredAvg < 0.5
          ? 'Drivers have slack — cutting or hanging is the constraint, not transport.'
          : required / rosteredAvg > 0.9
            ? 'Drivers are saturated — transport is likely the bottleneck.'
            : 'Drivers roughly matched to cadence.')
      : 'No roster set for this day, so utilisation is unknown.',
    caveat: 'Cadence-derived: idle time between loads reads as fewer drivers needed.',
  };
}

// ─── ROLLUP LEDGER ──────────────────────────────────────
// Turns the raw capture stream into one row per LOT (zone x cultivar x cut),
// joined against the field record (acres, plant date) so the ratios Koa
// actually wants — grow time, yield/acre, yield/plant, tops:smalls — fall out.
//
// Feeds seasons/2026/harvest.md. Deliberately derived, never authored: the raw
// rows stay in D1 / farm/harvest-log.md per the wiki's §7a raw-vs-derived split.

async function getRollup(db, env, params) {
  const isTest = isTestMode(env) ? 1 : 0;
  const season = parseInt(params.season, 10) || getSeason();

  const lots = await query(db, `
    SELECT
      l.id, l.zone, l.cultivar, l.cut_number, l.occurred_at, l.closed_at, l.headcount,
      (SELECT COUNT(*) FROM harvest_scan_log b
        WHERE b.event_type = 'barn_load' AND b.attributed_zone_session_id = l.id AND b.is_test = l.is_test) AS loads,
      (SELECT COALESCE(SUM(b.bins), 0) FROM harvest_scan_log b
        WHERE b.event_type = 'barn_load' AND b.attributed_zone_session_id = l.id AND b.is_test = l.is_test) AS bins,
      (SELECT COUNT(*) FROM harvest_sacks s
        WHERE s.zone_session_id = l.id AND s.is_test = l.is_test AND s.voided_at IS NULL) AS sacks,
      (SELECT COUNT(*) FROM harvest_sacks s
        WHERE s.zone_session_id = l.id AND s.is_test = l.is_test AND s.voided_at IS NULL
          AND s.opened_at IS NOT NULL) AS sacks_opened,
      (SELECT COALESCE(SUM(s.tops_lbs), 0) FROM harvest_sacks s
        WHERE s.zone_session_id = l.id AND s.is_test = l.is_test AND s.voided_at IS NULL) AS tops_lbs,
      (SELECT COALESCE(SUM(s.smalls_lbs), 0) FROM harvest_sacks s
        WHERE s.zone_session_id = l.id AND s.is_test = l.is_test AND s.voided_at IS NULL) AS smalls_lbs
    FROM harvest_scan_log l
    WHERE l.event_type = 'enter' AND l.season = ? AND l.is_test = ?
    ORDER BY l.occurred_at ASC
  `, [season, isTest]);

  const rows = lots.map(l => buildLotRow(l));

  // Crew is captured per-period, not per-lot — a roster change doesn't line up
  // with lot boundaries — so it rolls up by day alongside the lots.
  const days = [...new Set(rows.map(r => r.cut_date))].sort();
  const crewByDay = [];
  for (const d of days) {
    const hours = await crewPersonHours(db, isTest, d);
    // Time-weighted average drivers on the clock, so utilisation compares like
    // with like when the roster changed part-way through the day.
    const rosteredAvg = hours && hours.active_hours > 0 ? hours.drivers / hours.active_hours : null;
    const implied = await impliedDrivers(db, isTest, d, rosteredAvg);
    if (hours || implied) crewByDay.push({ date: d, person_hours: hours, driver_utilisation: implied });
  }

  return successResponse({
    success: true,
    season,
    is_test: !!isTest,
    generated_at: new Date().toISOString(),
    crew_by_day: crewByDay,
    constants: summarizeConstants(),
    plants_per_acre: { value: PLANTS_PER_ACRE, derivation: `43,560 sq ft/ac ÷ (${PLANT_SPACING_FT.inRow} ft × ${PLANT_SPACING_FT.bed} ft)` },
    totals: rollupTotals(rows),
    lots: rows,
  });
}

function buildLotRow(l) {
  const facts = zoneFacts(l.zone);
  const cutDate = String(l.occurred_at).substring(0, 10);
  const plantDate = facts?.plantDate || null;
  const acres = facts?.acres ?? null;
  const plants = plantCountFor(l.zone);

  const growDays = plantDate
    ? Math.round((new Date(cutDate + 'T00:00:00Z') - new Date(plantDate + 'T00:00:00Z')) / 86400000)
    : null;

  // Cutter person-hours: headcount x how long the lot stayed open. Only
  // meaningful once the session is closed, so an in-progress lot reports null
  // rather than a number that keeps growing.
  const hoursOpen = l.closed_at
    ? (parseSqliteUtc(l.closed_at) - parseSqliteUtc(l.occurred_at)) / 3600000
    : null;
  const cutterHours = (hoursOpen !== null && l.headcount) ? +(hoursOpen * l.headcount).toFixed(1) : null;

  const tops = round1(l.tops_lbs);
  const smalls = round1(l.smalls_lbs);
  const finished = round1(tops + smalls);

  // Yields are only honest once every tagged sack has actually been weighed —
  // a partially-opened lot would read as a catastrophic yield miss.
  const complete = l.sacks > 0 && l.sacks_opened === l.sacks;

  return {
    lot_id: lotId(l),
    session_id: l.id,
    zone: l.zone,
    cultivar: l.cultivar,
    cut_number: l.cut_number,
    plant_date: plantDate,
    plant_date_approx: !!facts?.multiDay,
    cut_date: cutDate,
    grow_days: growDays,
    acres,
    plants,
    headcount: l.headcount,
    cutter_person_hours: cutterHours,
    loads: l.loads,
    bins: l.bins,
    // Blocked on the uncalibrated bin constant — see CONSTANTS.
    wet_lbs: CONSTANTS.binWeightLbsWet.value === null ? null : round1(l.bins * CONSTANTS.binWeightLbsWet.value),
    sacks: l.sacks,
    sacks_opened: l.sacks_opened,
    tops_lbs: tops,
    smalls_lbs: smalls,
    finished_lbs: finished,
    tops_smalls_ratio: smalls > 0 ? +(tops / smalls).toFixed(2) : null,
    yield_complete: complete,
    lbs_per_acre: complete && acres ? round1(finished / acres) : null,
    lbs_per_plant: complete && plants ? +(finished / plants).toFixed(3) : null,
  };
}

function lotId(l) {
  const cv = (l.cultivar || '').split(/\s+/).map(w => w[0] || '').join('').toUpperCase() || 'XX';
  return `LOT-${l.season || getSeason()}-${l.zone}-${cv}-C${l.cut_number}`;
}

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

function rollupTotals(rows) {
  const complete = rows.filter(r => r.yield_complete);
  const sum = (a, k) => round1(a.reduce((t, r) => t + (r[k] || 0), 0));
  return {
    lots: rows.length,
    lots_with_complete_yield: complete.length,
    acres: round1(rows.reduce((t, r) => t + (r.acres || 0), 0)),
    bins: rows.reduce((t, r) => t + (r.bins || 0), 0),
    sacks: rows.reduce((t, r) => t + (r.sacks || 0), 0),
    tops_lbs: sum(rows, 'tops_lbs'),
    smalls_lbs: sum(rows, 'smalls_lbs'),
    finished_lbs: sum(rows, 'finished_lbs'),
  };
}

function summarizeConstants() {
  const out = {};
  for (const [k, c] of Object.entries(CONSTANTS)) {
    out[k] = { value: c.value, label: c.label, pending: c.value === null, unblocks: c.unblocks, how: c.how };
  }
  return out;
}

// ─── HTML RENDERING ─────────────────────────────────────

function renderPage(title, bodyHtml, status = 200) {
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>${escapeHtml(title)} — Harvest Test</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 24px 20px; background: #14251a; color: #f2f6f2; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; }
  .sub { color: #9fc2ac; margin: 0 0 20px; }
  .note { color: #cfe3d6; margin: 8px 0; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 12px; }
  a.btn, button.btn { display: block; text-align: center; padding: 18px 8px; font-size: 1.2rem; font-weight: 600;
    background: #2f7a4f; color: #fff; text-decoration: none; border-radius: 10px; border: none; }
  a.btn.alt { background: #3a5f4c; }
  .footer { margin-top: 28px; font-size: 0.9rem; }
  .footer a { color: #9fc2ac; }
  select, input[type=number], input[type=text], input:not([type]) { font-size: 1.2rem; padding: 12px; width: 100%; box-sizing: border-box; margin: 8px 0 16px; border-radius: 8px; border: none; }
  label { font-size: 1rem; color: #cfe3d6; }

  /* Takedown session screen — big targets, gloves on, one job per press. */
  .lot { border-left: 4px solid #2f7a4f; padding-left: 12px; margin-bottom: 22px; }
  .lot-cultivar { font-size: 1.7rem; font-weight: 700; line-height: 1.15; }
  .lot-meta { color: #9fc2ac; margin-top: 2px; }
  .bigbtn {
    display: block; width: 100%; min-height: 150px; font-size: 2.1rem; font-weight: 800;
    letter-spacing: 0.04em; background: #2f7a4f; color: #fff; border: none; border-radius: 14px;
    cursor: pointer; -webkit-tap-highlight-color: transparent;
  }
  .bigbtn:active { background: #276843; }
  .bigbtn:disabled { background: #3a5f4c; color: #cfe3d6; }
  .status { margin-top: 18px; font-size: 1.05rem; }
  .status strong { font-size: 1.25rem; }
  .last { color: #cfe3d6; margin-top: 6px; }
  .lastActions { margin-top: 10px; display: flex; gap: 10px; }
  a.mini { display: inline-block; padding: 10px 16px; background: #3a5f4c; color: #fff;
           text-decoration: none; border-radius: 8px; font-size: 0.95rem; }
  a.mini.danger { background: #7a3a3a; }
  .batch { margin-top: 26px; color: #9fc2ac; }
  .batch summary { cursor: pointer; padding: 8px 0; }
  .batchrow { display: flex; gap: 10px; align-items: center; }
  .batchrow input { margin: 0; max-width: 110px; }
  .batchrow .btn { margin: 0; white-space: nowrap; padding: 12px 18px; font-size: 1rem; }
  .hint { color: #9fc2ac; font-size: 0.85rem; font-weight: normal; }

  /* Cultivar picker — trial zones can hold 15 cultivars, so a single column of
     full-width targets beats a cramped grid for a gloved thumb. */
  .cvgrid { display: grid; grid-template-columns: 1fr; gap: 10px; margin-top: 14px; }
  a.cvbtn { padding: 20px 14px; font-size: 1.15rem; text-align: left; }

  /* Takedown lot picker — the highest-stakes input in the system, so each
     candidate carries its own plausibility rather than being one line in a
     dropdown the operator scrolls past. */
  .lotlist { display: grid; gap: 10px; margin: 14px 0 20px; }
  label.lot { display: flex; gap: 12px; align-items: flex-start; padding: 14px;
              background: #1b3123; border: 1px solid #2c4a36; border-radius: 10px; cursor: pointer; }
  label.lot input { margin: 3px 0 0; width: auto; flex: none; transform: scale(1.4); }
  label.lot:has(input:checked) { border-color: #4a9d6a; background: #21402c; }
  label.lot.green { opacity: 0.72; }
  .lotbody { display: block; min-width: 0; }
  .lothead { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 1.1rem; }
  .lotmeta { display: block; color: #9fc2ac; font-size: 0.88rem; margin-top: 4px; }
  .badge { font-size: 0.68rem; font-weight: 800; letter-spacing: 0.06em;
           padding: 3px 7px; border-radius: 4px; white-space: nowrap; }
  .badge.ok   { background: #2f7a4f; color: #fff; }
  .badge.warn { background: #8a6d1f; color: #fff; }
  .badge.bad  { background: #7a3a3a; color: #fff; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function errorPage(message, status = 400) {
  return renderPage('Error', `<h1>⚠️ ${escapeHtml(message)}</h1><p class="note">Check the QR code / link and try again.</p>`, status);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function headcountGrid(zone, sessionId) {
  const cells = HEADCOUNT_OPTIONS
    .map(n => `<a class="btn" href="?zone=${zone}&action=headcount&session_id=${sessionId}&count=${n}">${n}</a>`)
    .join('');
  return `${cells}<a class="btn alt" href="?zone=${zone}&action=headcount&session_id=${sessionId}&count=13">13+</a>`;
}

/**
 * Cultivar picker — shown after scanning a trial/split zone's sign, before the
 * session opens. Big tap targets: this is a gloved thumb in a field.
 */
function cultivarPickerBody(zone, options) {
  const buttons = options.map(cv =>
    `<a class="btn cvbtn" href="/z/${encodeURIComponent(zone)}?cultivar=${encodeURIComponent(cv)}">${escapeHtml(cv)}</a>`
  ).join('');
  return `
<h1>${escapeHtml(zone)}</h1>
<p class="sub">${options.length} cultivars planted here</p>
<p class="note">Which one are you cutting?</p>
<div class="cvgrid">${buttons}</div>`;
}

function enterBody({ zone, cultivar, cutNumber, sessionId, prevZone }) {
  return `
<h1>✅ Entered ${zone}</h1>
<p class="sub">${cultivar ? `${escapeHtml(cultivar)} · ` : ''}Cut ${cutNumber}</p>
${prevZone ? `<p class="note">Previous lot <strong>${escapeHtml(prevZone)}</strong> auto-closed.</p>` : `<p class="note">No prior zone was open.</p>`}
<p class="note">How many cutters here now?</p>
<div class="grid">${headcountGrid(zone, sessionId)}</div>
<div class="footer"><a href="?action=logs&zone=${zone}">View log →</a></div>`;
}

function alreadyEnteredBody(active) {
  return `
<h1>Already entered ${active.zone}</h1>
<p class="sub">${active.cultivar ? `${escapeHtml(active.cultivar)} · ` : ''}Cut ${active.cut_number}</p>
<p class="note">Entered at ${active.occurred_at} UTC — scan again in a few minutes if you meant to re-enter.</p>
<p class="note">How many cutters here now?</p>
<div class="grid">${headcountGrid(active.zone, active.id)}</div>`;
}

function headcountBody({ zone, cutNumber, sessionId, count }) {
  return `
<h1>Logged: ${count} cutter${count === 1 ? '' : 's'}</h1>
<p class="sub">${zone} — Cut ${cutNumber}</p>
<p class="note">Wrong number? Tap the right one:</p>
<div class="grid">${headcountGrid(zone, sessionId)}</div>
<div class="footer"><a href="?action=status">View status →</a></div>`;
}

function barnIntakeFormBody(active) {
  const options = [...VALID_ZONES].sort().map(z =>
    `<option value="${z}" ${active && active.zone === z ? 'selected' : ''}>${z}</option>`
  ).join('');
  const activeNote = active
    ? `<p class="note">Currently active: <strong>${active.zone}${active.cultivar ? ` · ${escapeHtml(active.cultivar)}` : ''}</strong> (cut ${active.cut_number})</p>`
    : `<p class="note">No zone is currently open — pick one below.</p>`;
  return `
<h1>Barn Intake</h1>
${activeNote}
<form method="POST" action="?action=barn_log" onsubmit="this.querySelector('button').disabled=true">
  <label for="zone">Zone</label>
  <select id="zone" name="zone" required>${options}</select>
  <label for="bins">Bins on this load</label>
  <input id="bins" name="bins" type="number" min="1" max="500" required autofocus>
  <button class="btn" type="submit">Log load</button>
</form>`;
}

function barnLogConfirmBody({ zone, bins, loadNumber, hasActiveSession }) {
  return `
<h1>Logged: ${bins} bins → ${zone}</h1>
<p class="sub">Load #${loadNumber} today for ${zone}</p>
${hasActiveSession ? '' : `<p class="note">⚠️ No active session was open for ${zone} — logged with no zone-session attribution.</p>`}
<div class="footer"><a href="?action=barn_intake">Log another load →</a> · <a href="?action=crew">Crew changed? →</a></div>`;
}

// ─── CREW ROSTER RENDERING ──────────────────────────────

function crewFormBody(current) {
  const fields = CREW_ROLES.map(r => `
  <label for="${r.key}">${r.label} <span class="hint">${r.where}</span></label>
  <input id="${r.key}" name="${r.key}" type="number" min="0" max="99" inputmode="numeric"
         value="${current && current[r.key] !== null ? current[r.key] : ''}">`).join('');

  const since = current
    ? `<p class="note">Current roster, set ${escapeHtml(current.effective_from)} UTC. Change only what changed.</p>`
    : `<p class="note">No roster set yet today. Fill in who's working.</p>`;

  return `
<h1>Crew</h1>
<p class="sub">Update when it changes — not on a schedule</p>
${since}
<form method="POST" action="?action=crew_set" onsubmit="this.querySelector('button').disabled=true">
  ${fields}
  <label for="note">Note <span class="hint">(optional — e.g. "driver pulled to trim")</span></label>
  <input id="note" name="note" maxlength="200" autocomplete="off">
  <button class="btn" type="submit">Save crew</button>
</form>
<p class="note"><span class="hint">Cutters aren't here — they're counted by the zone-entry scan.</span></p>`;
}

function crewConfirmBody(counts, flash) {
  const rows = CREW_ROLES.map(r =>
    `<div class="lotmeta"><strong>${r.label}:</strong> ${counts[r.key] ?? '—'} <span class="hint">${r.where}</span></div>`
  ).join('');
  return `
<h1>✅ ${escapeHtml(flash)}</h1>
<div class="status">${rows}</div>
<div class="footer"><a href="?action=crew">Change again →</a> · <a href="?action=barn_intake">Barn intake →</a></div>`;
}

// ─── SUPERSACK TAG RENDERING ────────────────────────────

function sackPrintFormBody(lots) {
  if (!lots.length) {
    return `
<h1>Print Sack Tags</h1>
<p class="note">No harvest lots recorded in the last ${LOT_PICKER_DAYS} days, so there's nothing to take down yet. Scan a zone QR to open a lot first.</p>`;
  }

  const BADGE = {
    ready:   { cls: 'ok',    text: 'READY' },
    started: { cls: 'warn',  text: 'STARTED' },
    green:   { cls: 'bad',   text: 'TOO GREEN' },
    old:     { cls: 'warn',  text: 'OVERDUE' },
  };

  // Pre-select ONLY when the best candidate is genuinely plausible. If the top
  // of the list is overdue/green/already-started, pre-filling it would make the
  // dangerous option the default — force a deliberate choice instead.
  const topIsReady = lots.length > 0 && lotPlausibility(lots[0]).level === 'ready';

  const cards = lots.map((l, i) => {
    const p = lotPlausibility(l);
    const b = BADGE[p.level];
    const cv = l.cultivar || '';
    return `
    <label class="lot ${p.level}">
      <input type="radio" name="session_id" value="${l.id}"
             data-cultivar="${escapeHtml(cv)}" data-level="${p.level}"
             data-desc="${escapeHtml(`${l.zone}${cv ? ` · ${cv}` : ''} cut ${l.cut_number}`)}"
             data-note="${escapeHtml(p.note)}" ${i === 0 && topIsReady ? 'checked' : ''} required>
      <span class="lotbody">
        <span class="lothead">
          <strong>${escapeHtml(l.zone)}${cv ? ` · ${escapeHtml(cv)}` : ''}</strong>
          <span class="badge ${b.cls}">${b.text}</span>
        </span>
        <span class="lotmeta">Cut ${l.cut_number} · cut ${escapeHtml(String(l.occurred_at).substring(0, 10))} · ${escapeHtml(p.note)}</span>
      </span>
    </label>`;
  }).join('');

  const firstCv = topIsReady ? (lots[0].cultivar || '') : '';

  return `
<h1>Print Sack Tags</h1>
<p class="note">Pick the lot that's <strong>coming down now</strong> — match it against the tape on the rack. This is not the zone being cut today; material bags ~${DRY_DAYS_TYPICAL} days after it was cut.</p>

<form method="POST" action="?action=sack_session_start" id="lotForm">
  <div class="lotlist">${cards}</div>
  <label for="cultivar">Cultivar <span class="hint">(from the lot — change only if wrong)</span></label>
  <input id="cultivar" name="cultivar" required autocomplete="off" value="${escapeHtml(firstCv)}" placeholder="e.g. Sour Lifter">
  <button class="btn" type="submit">Start takedown →</button>
</form>

<script>
(function () {
  var form = document.getElementById('lotForm');
  var cv = document.getElementById('cultivar');

  function selected() { return form.querySelector('input[name=session_id]:checked'); }

  // Cultivar was captured at the zone scan, so it carries through rather than
  // being retyped at takedown — one less place for a mismatch.
  form.addEventListener('change', function (e) {
    if (e.target.name !== 'session_id') return;
    var v = e.target.getAttribute('data-cultivar');
    if (v) cv.value = v;
  });

  // Advisory guard, never a block: the tape and the operator's eyes beat our
  // heuristic, so an implausible pick asks for confirmation and then proceeds.
  form.addEventListener('submit', function (e) {
    var r = selected();
    if (!r) return;
    var lvl = r.getAttribute('data-level');
    if (lvl === 'green' || lvl === 'old') {
      var msg = r.getAttribute('data-desc') + '\\n' + r.getAttribute('data-note') +
                '\\n\\nTag sacks against this lot anyway?';
      if (!confirm(msg)) { e.preventDefault(); return; }
    }
    form.querySelector('button').disabled = true;
  });
})();
</script>`;
}

/**
 * The screen the worker actually lives on during a takedown. Quantity is
 * deliberately NOT asked up front — you don't know how many sacks a rack
 * yields until it's empty, and pre-printing leaves orphan serials that can end
 * up on the next rack's sacks.
 */
function sackSessionBody({ lot, cultivar, stats }) {
  const q = `session_id=${lot.id}&cultivar=${encodeURIComponent(cultivar)}`;
  return `
<div class="lot">
  <div class="lot-cultivar">${escapeHtml(cultivar)}</div>
  <div class="lot-meta">${escapeHtml(lot.zone)} · Cut ${escapeHtml(String(lot.cut_number ?? '?'))} · cut ${escapeHtml(formatTagDate(String(lot.occurred_at).substring(0, 10)))}</div>
</div>

<button id="printBtn" class="bigbtn">PRINT TAG</button>

<div class="status">
  <div id="count"><strong>${stats.printed}</strong> tag${stats.printed === 1 ? '' : 's'} printed for this lot</div>
  <div id="last" class="last">${stats.lastSackId ? `Last: <strong>#&nbsp;${escapeHtml(stats.lastSackId)}</strong>` : 'No tags printed yet'}</div>
  <div id="lastActions" class="lastActions" ${stats.lastSackId ? '' : 'hidden'}>
    <a id="reprintLink" class="mini" href="#">Reprint</a>
    <a id="voidLink" class="mini danger" href="#">Void</a>
  </div>
</div>

<details class="batch">
  <summary>Print several at once</summary>
  <p class="note">Only if you're tagging a batch of already-filled sacks. Extra tags with no sack must be voided, or the lot count drifts.</p>
  <div class="batchrow">
    <input id="batchQty" type="number" min="2" max="${MAX_PRINT_QTY}" value="5">
    <button id="batchBtn" class="btn">Print batch</button>
  </div>
</details>

<div class="footer"><a href="?action=sack_print">← Change lot</a> · <a href="?action=sacks&limit=20">View tags →</a></div>

<iframe id="printFrame" title="print" style="position:absolute;width:0;height:0;border:0;left:-9999px"></iframe>

<script>
(function () {
  var Q = '${q}';
  var btn = document.getElementById('printBtn');
  var batchBtn = document.getElementById('batchBtn');
  var frame = document.getElementById('printFrame');
  var countEl = document.getElementById('count');
  var lastEl = document.getElementById('last');
  var actions = document.getElementById('lastActions');
  var reprint = document.getElementById('reprintLink');
  var voidLink = document.getElementById('voidLink');
  var lastId = ${stats.lastSackId ? JSON.stringify(stats.lastSackId) : 'null'};
  var busy = false;

  function setBusy(b, label) {
    busy = b;
    btn.disabled = b; batchBtn.disabled = b;
    btn.textContent = b ? (label || 'PRINTING…') : 'PRINT TAG';
  }

  function refresh(data) {
    var n = data.printed;
    countEl.innerHTML = '<strong>' + n + '</strong> tag' + (n === 1 ? '' : 's') + ' printed for this lot';
    lastId = data.last_sack_id;
    if (lastId) {
      lastEl.innerHTML = 'Last: <strong>#&nbsp;' + lastId + '</strong>';
      actions.hidden = false;
      reprint.href = '?action=sack_label&id=' + encodeURIComponent(lastId);
    } else {
      lastEl.textContent = 'No tags printed yet';
      actions.hidden = true;
    }
  }

  function print(ids) { frame.src = '?action=sack_label&ids=' + encodeURIComponent(ids.join(',')); }

  function alloc(qty) {
    if (busy) return;           // guards the double-tap: two serials, one sack
    setBusy(true);
    fetch('?action=sack_alloc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: ${lot.id}, cultivar: ${JSON.stringify(cultivar)}, qty: qty })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.success) throw new Error(d.error || 'Print failed');
        print(d.ids); refresh(d); setBusy(false);
      })
      .catch(function (e) {
        setBusy(false);
        alert('Could not print: ' + e.message + '\\n\\nNothing was tagged — try again.');
      });
  }

  btn.addEventListener('click', function () { alloc(1); });
  batchBtn.addEventListener('click', function () {
    var n = parseInt(document.getElementById('batchQty').value, 10);
    if (n >= 2) alloc(n);
  });

  reprint.addEventListener('click', function (e) {
    e.preventDefault();
    if (lastId) print([lastId]);
  });

  voidLink.addEventListener('click', function (e) {
    e.preventDefault();
    if (!lastId || busy) return;
    if (!confirm('Void tag # ' + lastId + '?\\n\\nUse this if a tag printed with no sack to put it on. The number is retired, not reused.')) return;
    setBusy(true, 'VOIDING…');
    fetch('?action=sack_void', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sack_id: lastId })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.success) throw new Error(d.error || 'Void failed');
        refresh(d); setBusy(false);
      })
      .catch(function (e) { setBusy(false); alert('Could not void: ' + e.message); });
  });
})();
</script>`;
}

/**
 * Printable label sheet — one 4x2in page per sack. Auto-fires window.print()
 * once every QR image has loaded; with Chrome's --kiosk-printing flag on the
 * barn PC that goes straight to the ZP-450 with no dialog to dismiss.
 */
function renderLabelSheet(sacks, printCtx, opts = {}) {
  const autoPrint = opts.autoPrint !== false;
  const labels = sacks.map(s => `
  <div class="label">
    <div class="cultivar" style="font-size:${cultivarFontPt(s.cultivar)}pt">${escapeHtml(s.cultivar || '')}</div>
    <div class="row">
      <div class="left">
        <div class="bagno">#&nbsp;${escapeHtml(s.sack_id)}</div>
        <div class="meta">${escapeHtml(formatTagDate(s.harvest_date))} · ${escapeHtml(s.zone)} · Cut ${escapeHtml(String(s.cut_number ?? '?'))}</div>
      </div>
      <img class="qr" src="${qrUrlFor(s.sack_id)}" alt="">
    </div>
  </div>`).join('');

  const backLink = printCtx
    ? `<a href="?action=sack_print">← Print more tags</a>`
    : `<a href="?action=sack_print">← Print tags</a>`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Sack tags</title>
<style>
  @page { size: 4in 2in; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #eee; }
  .label {
    width: 4in; height: 2in; padding: 0.11in 0.13in;
    background: #fff; color: #000; overflow: hidden;
    display: flex; flex-direction: column;
  }
  .cultivar { font-size: 25pt; font-weight: 800; line-height: 1.0; letter-spacing: -0.01em;
              white-space: nowrap; overflow: hidden; }
  .row { display: flex; align-items: flex-end; justify-content: space-between; flex: 1; gap: 0.08in; }
  .left { min-width: 0; }
  .bagno { font-size: 30pt; font-weight: 800; line-height: 1.05; white-space: nowrap; }
  .meta { font-size: 10.5pt; margin-top: 0.03in; white-space: nowrap; }
  .qr { width: 1in; height: 1in; flex: none; }
  .toolbar { padding: 14px; font: 14px system-ui; }
  .toolbar a { color: #036; }
  @media screen { .label { margin: 12px auto; box-shadow: 0 1px 6px rgba(0,0,0,.3); } }
  @media print {
    .toolbar { display: none; }
    body { background: #fff; }
    .label { margin: 0; page-break-after: always; box-shadow: none; }
    .label:last-child { page-break-after: auto; }
  }
</style></head>
<body>
<div class="toolbar">${sacks.length} label${sacks.length === 1 ? '' : 's'} · ${backLink} · <a href="javascript:window.print()">Print again</a></div>
${labels}
${autoPrint ? `<script>
  // Wait for QR images before printing — printing early yields blank squares.
  (function () {
    var imgs = Array.prototype.slice.call(document.images);
    var left = imgs.length;
    if (!left) return window.print();
    imgs.forEach(function (img) {
      if (img.complete) { if (--left === 0) window.print(); return; }
      img.addEventListener('load', function () { if (--left === 0) window.print(); });
      img.addEventListener('error', function () { if (--left === 0) window.print(); });
    });
  })();
</script>` : ''}
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/**
 * Cultivar prints on one line at a fixed width, so a long name would silently
 * clip (overflow:hidden + nowrap) — and a tag reading "Suver Haze x Cherr"
 * looks correct until someone needs it. Step the size down instead; ~17 chars
 * is where 25pt stops fitting the 3.74in text column.
 */
function cultivarFontPt(name) {
  const len = (name || '').length;
  if (len <= 16) return 25;
  if (len <= 20) return 20;
  if (len <= 26) return 15.5;
  return 12.5;
}

function formatTagDate(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).substring(0, 10) + 'T00:00:00Z');
  if (isNaN(d)) return String(iso).substring(0, 10);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function sackDetailBody(sack, flash) {
  const opened = !!sack.opened_at;
  // floor, not round — a sack cut this morning is "today", not "1 day ago".
  const daysInBarn = sack.harvest_date
    ? Math.max(0, Math.floor((Date.now() - new Date(sack.harvest_date + 'T00:00:00Z')) / 86400000))
    : null;
  const daysLabel = daysInBarn === null ? ''
    : daysInBarn === 0 ? ' · today'
    : daysInBarn === 1 ? ' · 1 day ago'
    : ` · ${daysInBarn} days ago`;

  const weights = opened
    ? `<p class="note">Opened ${escapeHtml(sack.opened_at)} UTC<br><strong>${sack.tops_lbs} lb tops · ${sack.smalls_lbs} lb smalls</strong></p>`
    : `
<p class="note">Not yet opened. Record weights when this sack is bucked:</p>
<form method="POST" action="/api/harvest?action=sack_weigh" onsubmit="this.querySelector('button').disabled=true">
  <input type="hidden" name="sack_id" value="${escapeHtml(sack.sack_id)}">
  <label for="tops_lbs">Tops (lbs)</label>
  <input id="tops_lbs" name="tops_lbs" type="number" step="0.01" min="0" max="500" required autofocus>
  <label for="smalls_lbs">Smalls (lbs)</label>
  <input id="smalls_lbs" name="smalls_lbs" type="number" step="0.01" min="0" max="500" required>
  <button class="btn" type="submit">Record weights</button>
</form>`;

  return `
${flash ? `<p class="note">✅ ${escapeHtml(flash)}</p>` : ''}
<h1>${escapeHtml(sack.cultivar || 'Sack')}</h1>
<p class="sub">#&nbsp;${escapeHtml(sack.sack_id)}</p>
<p class="note">
  Zone <strong>${escapeHtml(sack.zone)}</strong> · Cut ${escapeHtml(String(sack.cut_number ?? '?'))}<br>
  Harvested ${escapeHtml(formatTagDate(sack.harvest_date))}${daysLabel}
</p>
${weights}
<div class="footer"><a href="/api/harvest?action=sack_label&id=${encodeURIComponent(sack.sack_id)}">Reprint this tag →</a></div>`;
}
