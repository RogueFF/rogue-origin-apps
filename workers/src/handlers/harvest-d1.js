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
 * - GET  ?action=crew                                     - Crew roster form (HTML)
 * - POST ?action=crew_set   (drivers,cutter_water_spiders,
 *                            hangers,hanging_water_spiders) - Update roster (HTML)
 * - GET  ?action=test                                    - Health check (JSON)
 * - GET  ?action=status                                  - Current active zone (JSON)
 * - GET  ?action=logs&zone=&event_type=&limit=            - Raw rows (JSON)
 * - GET  ?action=rollup&season=                          - Derived lot ledger (JSON)
 *
 * The zone-sign scan target /z/<zone> is routed in index.js -> handleZoneScan;
 * multi-cultivar zones show a cultivar picker before the session opens.
 * Crew-facing SOP: wiki/operations/sop-harvest-tracking.md
 *
 * Supersack tags (see docs/plans/2026-08-06-supersack-tag-design.md):
 * - GET  ?action=sack_print                              - Lot picker, starts a takedown session (HTML)
 * - POST ?action=sack_session_start (session_id,cultivar) - Enter the session screen (HTML)
 * - GET  ?action=sack_session&session_id=&cultivar=      - The session screen itself (HTML)
 * - POST ?action=sack_alloc      (session_id,cultivar,qty) - Allocate serial(s) (JSON, called by fetch)
 * - POST ?action=sack_void       (sack_id)               - Void a mis-printed tag (JSON)
 * - GET  ?action=sack_label&id=|ids=                     - Label sheet; reprint reuses SAME serial (HTML)
 * - GET  ?action=sack_label&...&sheet=avery5163[&skip=N]  - Same tags on an Avery 5163 laser sheet (fallback)
 * - GET  ?action=sack_label&sheet=avery5163&calibrate=1   - Empty slot outlines, to check printer alignment
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
import { cultivarsFor, isMultiCultivar, isHarvestTracked } from '../lib/zone-cultivars.js';
import { zoneFacts, plantCountFor, PLANTS_PER_ACRE, PLANT_SPACING_FT } from '../lib/zone-facts.js';
import { cultivarCode, supersackSku } from '../lib/cultivar-codes.js';
import { adjustSupersackCount, listSupersackVariants, variantTitle, harvestTypeForZone } from '../lib/supersack-inventory.js';
import { floorOutputByCultivar } from '../lib/floor-output.js';
import { sendTelegramMessage } from '../lib/telegram.js';
import { pickLang, t as translate, langCookie } from '../lib/i18n.js';
import { handleHarvestBoard, BOARD_ACTIONS } from './harvest-board-d1.js';

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
  'crew', 'crew_set', 'sack_note', 'find', 'sack_open',
]);

export async function handleHarvestD1(request, env, ctx) {
  const body = request.method === 'POST' ? await parseBody(request) : {};
  const action = getAction(request, body);
  const params = getQueryParams(request);
  const db = env.DB;
  const ui = makeUi(request);

  // The lot stage board is its own module (D1-backed, password-gated) so this
  // file doesn't grow another 400 lines. See harvest-board-d1.js.
  if (BOARD_ACTIONS.has(action)) {
    return await handleHarvestBoard(request, env, ctx, { action, params, body });
  }

  // HTML-rendering actions are phone/tablet-facing — never let an error
  // fall through to the JSON errorResponse in index.js's global catch.
  if (HTML_ACTIONS.has(action)) {
    try {
      switch (action) {
        case 'enter':
          return await handleEnter(ui, db, env, ctx, params);
        case 'headcount':
          return await handleHeadcount(ui, db, env, ctx, params);
        case 'barn_intake':
          return await handleBarnIntakeForm(ui, db, env, ctx);
        case 'barn_log':
          return await handleBarnLog(ui, db, env, ctx, body);
        case 'sack_print':
          return await handleSackPrintForm(ui, db, env);
        case 'sack_session_start':
          return await handleSackSession(ui, db, env, body);
        case 'sack_session':
          return await handleSackSession(ui, db, env, params);
        case 'sack_label':
          return await handleSackLabel(ui, db, env, params);
        case 'sack_weigh':
          return await handleSackWeigh(ui, db, env, ctx, body);
        case 'crew':
          return await handleCrewForm(ui, db, env);
        case 'crew_set':
          return await handleCrewSet(ui, db, env, ctx, body);
        case 'sack_note':
          return await handleSackNote(ui, db, env, ctx, body);
        case 'sack_open':
          return await handleSackOpen(ui, db, env, ctx, body);
        case 'find':
          return await handleSackFind(ui, db, env, request.method === 'POST' ? body : params);
      }
    } catch (e) {
      const { message, status } = formatError(e);
      return errorPage(ui, message, status);
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
    case 'provenance':
      return await getProvenance(db, env, params);
    case 'reconcile':
      return await getReconcile(db, env, params);
    case 'allocate':
      return await handleAllocate(db, env, params);
    case 'sack_alloc':
      return await handleSackAlloc(db, env, ctx, body);
    case 'sack_void':
      return await handleSackVoid(db, env, ctx, body);
    default:
      throw createError('NOT_FOUND', ui.t('unknownAction', { a: action }));
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
  const ui = makeUi(request);
  try {
    const url = new URL(request.url);
    const zone = normalizeZone(url.pathname.replace(/^\/z\//, '').trim());
    if (!zone || !VALID_ZONES.has(zone)) {
      throw createError('VALIDATION_ERROR', ui.t('unknownZone', { z: zone ?? '' }));
    }

    // Refuse before touching state. Opening a session here would close whatever
    // field zone is actually being cut, corrupting the timeline and
    // mis-attributing barn loads — a stray greenhouse scan must be inert.
    if (!isHarvestTracked(zone)) {
      return errorPage(ui, ui.t('zoneNotTracked', { zone }), 404);
    }

    const params = { zone };
    const picked = url.searchParams.get('cultivar');
    if (url.searchParams.get('test_cut')) params.test_cut = url.searchParams.get('test_cut');

    const options = cultivarsFor(zone);
    if (isMultiCultivar(zone) && !picked) {
      // Trial / split zone: a lot is zone x cultivar x cut, so we can't open a
      // session until we know which cultivar is being cut. One sign per zone
      // with a picker beats a separate QR per cultivar — no wrong code to scan.
      return renderPage(ui, zone, cultivarPickerBody(ui, zone, options));
    }
    if (picked) {
      if (!options.includes(picked)) {
        throw createError('VALIDATION_ERROR', ui.t('notPlantedHere', { cv: picked, zone }));
      }
      params.cultivar = picked;
    } else {
      params.cultivar = options[0] || null;   // single-cultivar zone: auto-fill
    }

    return await handleEnter(ui, env.DB, env, ctx, params);
  } catch (e) {
    const { message, status } = formatError(e);
    return errorPage(ui, message, status);
  }
}

/**
 * GET /b — the barn-intake QR target. Short for the same reason as /z/ and /s/:
 * this code is posted on a barn wall for a whole season and scanned dozens of
 * times a day, often in poor light with dusty hands.
 */
export async function handleBarnScan(request, env, ctx) {
  const ui = makeUi(request);
  try {
    return await handleBarnIntakeForm(ui, env.DB, env, ctx);
  } catch (e) {
    const { message, status } = formatError(e);
    return errorPage(ui, message, status);
  }
}

/**
 * GET /s/<sack_id> — the QR scan target. Routed separately in index.js so the
 * encoded URL stays short: a shorter payload means a lower-version QR with
 * bigger modules, which is what survives a scuffed label in barn lighting.
 */
export async function handleSackScan(request, env, ctx) {
  const ui = makeUi(request);
  try {
    const sackId = new URL(request.url).pathname.replace(/^\/s\//, '').trim();
    const view = await getSackView(env.DB, sackId);
    if (!view) {
      return errorPage(ui, ui.t('noSackCheck', { id: sackId }), 404);
    }
    return renderPage(ui, `${ui.t('sack')} ${view.sack.sack_id}`, sackDetailBody(ui, view));
  } catch (e) {
    const { message, status } = formatError(e);
    return errorPage(ui, message, status);
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

async function handleEnter(ui, db, env, ctx, params) {
  const zone = normalizeZone(params.zone);
  if (!zone || !VALID_ZONES.has(zone)) {
    throw createError('VALIDATION_ERROR', ui.t('unknownZone', { z: params.zone ?? '' }));
  }

  if (!isHarvestTracked(zone)) {
    throw createError('NOT_FOUND', ui.t('zoneNotTracked', { zone }));
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
    return renderPage(ui, ui.t('alreadyEntered', { zone }), alreadyEnteredBody(ui, active));
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

  return renderPage(ui, ui.t('entered', { zone }), enterBody(ui, {
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

async function handleHeadcount(ui, db, env, ctx, params) {
  const sessionId = parseInt(params.session_id, 10);
  const count = parseInt(params.count, 10);

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    throw createError('VALIDATION_ERROR', 'Missing or invalid session_id.');
  }
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw createError('VALIDATION_ERROR', ui.t('headcountRange'));
  }

  const session = await queryOne(db, `SELECT * FROM harvest_scan_log WHERE id = ? AND event_type = 'enter'`, [sessionId]);
  if (!session) {
    throw createError('NOT_FOUND', ui.t('noSessionFound', { id: sessionId }));
  }

  await execute(db, `UPDATE harvest_scan_log SET headcount = ?, headcount_at = datetime('now') WHERE id = ?`, [count, sessionId]);

  ctx.waitUntil(sendTelegramMessage(env, {
    chatId: env.TELEGRAM_TEST_CHAT_ID,
    text: `👥 ${count} cutter${count === 1 ? '' : 's'} in *${session.zone}* (cut ${session.cut_number})`,
  }).catch(e => console.error('[harvest][telegram]', e)));

  return renderPage(ui, ui.t('crew'), headcountBody(ui, { zone: session.zone, cutNumber: session.cut_number, sessionId, count }));
}

// ─── BARN INTAKE ────────────────────────────────────────

async function handleBarnIntakeForm(ui, db, env, ctx) {
  const isTest = isTestMode(env) ? 1 : 0;
  const active = await getActiveSession(db, isTest);
  return renderPage(ui, ui.t('barnIntake'), barnIntakeFormBody(ui, active));
}

async function handleBarnLog(ui, db, env, ctx, body) {
  const zone = normalizeZone(body.zone);
  if (!zone || !VALID_ZONES.has(zone)) {
    throw createError('VALIDATION_ERROR', ui.t('unknownZone', { z: body.zone ?? '' }));
  }
  if (!isHarvestTracked(zone)) {
    throw createError('VALIDATION_ERROR', ui.t('zoneNotTracked', { zone }));
  }
  const bins = parseInt(body.bins, 10);
  if (!Number.isInteger(bins) || bins < 1 || bins > 500) {
    throw createError('VALIDATION_ERROR', ui.t('binsRange'));
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

  return renderPage(ui, ui.t('barnIntake'), barnLogConfirmBody(ui, { zone, bins, loadNumber, hasActiveSession: !!zoneSession }));
}

// ─── SUPERSACK TAGS ─────────────────────────────────────
// Sacks are filled at TAKEDOWN, ~10 days after the material was cut — while
// the crew may be out cutting a different zone entirely. So none of this may
// ever attribute a sack to the "currently active" zone the way barn intake
// does; the operator explicitly picks which lot is coming down.

async function handleSackPrintForm(ui, db, env) {
  const isTest = isTestMode(env) ? 1 : 0;
  const lots = await getRecentLots(db, isTest);
  return renderPage(ui, ui.t('printTags'), sackPrintFormBody(ui, lots));
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
function lotPlausibility(ui, lot) {
  const d = lot.days_since_cut;
  if (d < DRY_DAYS_MIN) {
    return { level: 'green', note: ui.t('noteGreen', { d, typical: DRY_DAYS_TYPICAL }) };
  }
  if (lot.sacks_printed > 0) {
    return { level: 'started', note: ui.t('noteStarted', { n: lot.sacks_printed }) };
  }
  if (d > DRY_DAYS_MAX) {
    return { level: 'old', note: ui.t('noteOld', { d }) };
  }
  return { level: 'ready', note: ui.t('noteReady', { d }) };
}

/**
 * The takedown session screen. Picked once per lot, then it stays up while the
 * worker fills sack after sack — the PRINT TAG button allocates and prints
 * without navigating, so nobody loses their place mid-rack with gloves on.
 */
async function handleSackSession(ui, db, env, input) {
  const sessionId = parseInt(input.session_id, 10);
  const cultivar = String(input.cultivar || '').trim().substring(0, 60);

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    throw createError('VALIDATION_ERROR', ui.t('pickLotFirst'));
  }
  if (!cultivar) {
    throw createError('VALIDATION_ERROR', ui.t('cultivarRequired'));
  }

  const lot = await requireLot(db, sessionId);
  const isTest = isTestMode(env) ? 1 : 0;
  const stats = await getLotTagStats(db, sessionId, isTest);

  return renderPage(ui, `${ui.t('printTags')} — ${lot.zone}`, sackSessionBody(ui, { lot, cultivar, stats }));
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

  // MAX+1 per (season, cultivar): each cultivar counts from 1. The
  // UNIQUE(season, cultivar_code, serial) index means two simultaneous
  // allocations fail loudly rather than silently issuing two physical tags
  // carrying the same number.
  let code;
  try {
    code = await cultivarCode(db, cultivar);
  } catch (e) {
    // Surfaced to the operator rather than swallowed: a wrong code prints onto
    // physical tags and puts the bag on the wrong per-cultivar sequence.
    throw createError('VALIDATION_ERROR', e.message);
  }
  const row = await queryOne(db, `
    SELECT COALESCE(MAX(serial), 0) AS max_serial FROM harvest_sacks
    WHERE season = ? AND cultivar_code = ?
  `, [season, code]);
  const startSerial = (row?.max_serial || 0) + 1;

  const ids = [];
  const statements = [];
  for (let i = 0; i < qty; i++) {
    const serial = startSerial + i;
    const sackId = formatSackId(season, code, serial);
    ids.push(sackId);
    statements.push({
      sql: `INSERT INTO harvest_sacks
              (sack_id, season, serial, cultivar_code, sku, zone, cultivar, cut_number, harvest_date, zone_session_id, is_test)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [sackId, season, serial, code, supersackSku(code, season),
               lot.zone, cultivar, lot.cut_number, harvestDate, lot.id, isTest],
    });
  }
  await transaction(db, statements);

  const stats = await getLotTagStats(db, sessionId, isTest);

  // A printed tag means a sack now exists, so the count goes up by one each.
  // One call for the batch, not one per tag. After the rows are committed and
  // inside waitUntil: printing must not wait on, or fail because of, an
  // external call — the crew is standing at the printer.
  if (!isTestMode(env)) {
    ctx.waitUntil((async () => {
      const r = await adjustSupersackCount(env, {
        season, cultivar, zone: lot.zone, delta: qty,
        note: `[Harvest] ${qty} tag${qty === 1 ? '' : 's'} printed — ${ids[0]}${qty > 1 ? `–${ids[ids.length - 1]}` : ''} (${lot.zone} cut ${lot.cut_number})`,
      });
      const ph = ids.map(() => '?').join(',');
      await execute(db, `
        UPDATE harvest_sacks
        SET shopify_added_at = ?, shopify_add_error = ?, shopify_variant_id = COALESCE(shopify_variant_id, ?)
        WHERE sack_id IN (${ph})
      `, [r.ok ? new Date().toISOString() : null, r.error, r.variantId, ...ids]);
      if (!r.ok) console.error(`[harvest][inventory] add ${ids.length}: ${r.error}`);
    })().catch(e => console.error('[harvest][inventory]', e)));
  }

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

  // Take back the +1 that printing added. A voided tag is a retired number with
  // no sack behind it; leaving the increment would be phantom inventory. Only
  // undo it if the add actually landed.
  if (!isTestMode(env) && sack.shopify_added_at) {
    ctx.waitUntil((async () => {
      const r = await adjustSupersackCount(env, {
        season: sack.season, cultivar: sack.cultivar, zone: sack.zone, delta: -1,
        note: `[Harvest] ${sackId} voided — tag retired with no sack`,
      });
      await execute(db, `
        UPDATE harvest_sacks SET shopify_added_at = NULL, shopify_add_error = ? WHERE sack_id = ?
      `, [r.ok ? null : `void rollback failed: ${r.error}`, sackId]);
      if (!r.ok) console.error(`[harvest][inventory] void ${sackId}: ${r.error}`);
    })().catch(e => console.error('[harvest][inventory]', e)));
  }

  return successResponse({ success: true, voided: sackId, printed: stats.printed, last_sack_id: stats.lastSackId });
}

// Reprint path — looks the sack up and reuses its EXISTING serial. Never
// allocates a new one: two physical tags carrying different IDs for the same
// sack is unrecoverable once they're in the barn.
async function handleSackLabel(ui, db, env, params) {
  // ?id= for a single reprint, ?ids=a,b,c for a freshly-allocated run. The
  // session screen loads this into a hidden iframe, which prints itself.
  // The calibration sheet prints empty outlines to check printer alignment,
  // so it deliberately needs no sacks — and must not allocate any.
  if (String(params.sheet || '') === 'avery5163' && params.calibrate === '1') {
    return renderAverySheet(ui, [], { calibrate: true });
  }

  const raw = String(params.ids || params.id || '').trim();
  const ids = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, MAX_PRINT_QTY);
  if (!ids.length) throw createError('VALIDATION_ERROR', ui.t('noSackId'));

  const placeholders = ids.map(() => '?').join(',');
  const rows = await query(db, `SELECT * FROM harvest_sacks WHERE sack_id IN (${placeholders})`, ids);
  if (!rows.length) throw createError('NOT_FOUND', ui.t('noSack', { id: ids[0] }));

  // Preserve the requested order (SQL IN doesn't guarantee it).
  const byId = new Map(rows.map(r => [r.sack_id, r]));
  const sacks = ids.map(id => byId.get(id)).filter(Boolean);

  // ?sheet=avery5163 lays the same tags on a laser sheet instead of the
  // thermal roll — the fallback for a dead ZP-450 or a dropped connection.
  // Never auto-prints: a sheet costs ten labels, so it waits to be told.
  if (String(params.sheet || '') === 'avery5163') {
    return renderAverySheet(ui, sacks, { skip: params.skip });
  }

  // ?preview=1 renders without firing the print dialog — for eyeballing a
  // label (or checking a long cultivar name fits) before committing paper.
  return renderLabelSheet(ui, sacks, null, { autoPrint: params.preview !== '1' });
}

async function handleSackWeigh(ui, db, env, ctx, body) {
  const sackId = String(body.sack_id || '').trim();
  const tops = parseFloat(body.tops_lbs);
  const smalls = parseFloat(body.smalls_lbs);

  if (!Number.isFinite(tops) || tops < 0 || tops > 500) {
    throw createError('VALIDATION_ERROR', ui.t('weightRange', { field: ui.t('topsLbs') }));
  }
  if (!Number.isFinite(smalls) || smalls < 0 || smalls > 500) {
    throw createError('VALIDATION_ERROR', ui.t('weightRange', { field: ui.t('smallsLbs') }));
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

  // Opening a bag takes one off the Super Sack Inventory count. Deliberately
  // AFTER the weights are committed and inside waitUntil: the measurement is
  // the thing that cannot be lost, and it must not wait on — or fail because
  // of — an external bookkeeping call. Test rows never touch real inventory.
  if (!isTestMode(env)) {
    ctx.waitUntil((async () => {
      const r = await adjustSupersackCount(env, {
        season: sack.season, cultivar: sack.cultivar, zone: sack.zone, delta: -1,
        note: `[Harvest] ${sackId} opened — ${tops} lb tops / ${smalls} lb smalls (${sack.zone} cut ${sack.cut_number})`,
      });
      await execute(db, `
        UPDATE harvest_sacks
        SET shopify_synced_at = ?, shopify_sync_error = ?, shopify_variant_id = ?
        WHERE sack_id = ?
      `, [r.ok ? new Date().toISOString() : null, r.error, r.variantId, sackId]);
      if (!r.ok) console.error(`[harvest][inventory] ${sackId}: ${r.error}`);
    })().catch(e => console.error('[harvest][inventory]', e)));
  }

  const updated = await getSackView(db, sackId);
  return renderPage(ui, `${ui.t('sack')} ${sackId}`, sackDetailBody(ui, updated, ui.t('weightsRecorded')));
}

/**
 * Everything a scan should show — the sack, where it came from, and what
 * anyone has noted about it. Scanning a tag is the one moment the whole chain
 * is visible in one place, so it pulls the field side (plant date, acreage)
 * rather than only the harvest side the sack row happens to carry.
 */
async function getSackView(db, sackId) {
  const sack = await queryOne(db, `SELECT * FROM harvest_sacks WHERE sack_id = ?`, [sackId]);
  if (!sack) return null;

  const facts = zoneFacts(sack.zone);
  const notes = await query(db, `
    SELECT note, created_at FROM harvest_sack_notes
    WHERE sack_id = ? ORDER BY created_at DESC, id DESC LIMIT 50
  `, [sackId]);

  const lot = sack.zone_session_id
    ? await queryOne(db, `
        SELECT COUNT(*) AS sacks FROM harvest_sacks
        WHERE zone_session_id = ? AND is_test = ? AND voided_at IS NULL
      `, [sack.zone_session_id, sack.is_test])
    : null;

  const growDays = (facts?.plantDate && sack.harvest_date)
    ? Math.round((new Date(sack.harvest_date + 'T00:00:00Z') - new Date(facts.plantDate + 'T00:00:00Z')) / 86400000)
    : null;

  return {
    sack, notes,
    plantDate: facts?.plantDate || null,
    plantDateApprox: !!facts?.multiDay,
    acres: facts?.acres ?? null,
    plants: plantCountFor(sack.zone),
    growDays,
    lotSacks: lot?.sacks ?? null,
  };
}

/**
 * Turn whatever someone typed or scanned into a sack id.
 *
 * A torn tag is read by eye under barn light, and a USB imager types the whole
 * URL. So accept all of it: the printed form, the digits without the dash, a
 * bare serial (current season assumed), a leading #, and a full scan URL.
 * Being strict here would mean a damaged tag has no recovery path at all.
 */
function normalizeSackId(raw, season) {
  let q = String(raw || '').trim();
  if (!q) return null;

  const fromUrl = q.match(/\/s\/([^/?#\s]+)/i);   // a scanner typed the URL
  if (fromUrl) q = fromUrl[1];

  q = q.toUpperCase().replace(/\s+/g, '').replace(/^#+/, '');
  const yy = String(season).slice(-2);

  // 26-SL-12 — already whole.
  let m = q.match(/^(\d{2})-([A-Z]+\d*)-(\d{1,6})$/);
  if (m) return `${m[1]}-${m[2]}-${parseInt(m[3], 10)}`;

  // SL-12 / SL12 — cultivar and number, season assumed. What someone reading a
  // torn tag will most often manage: the code and the number are the two things
  // still legible.
  m = q.match(/^([A-Z]+\d*?)-?(\d{1,6})$/);
  if (m && /[A-Z]/.test(m[1])) return `${yy}-${m[1]}-${parseInt(m[2], 10)}`;

  // A bare number can no longer identify a bag on its own — 1 is a valid number
  // for every cultivar. Hand it back so the caller can say so rather than
  // guessing a cultivar and confidently returning the wrong sack.
  if (/^\d+$/.test(q)) return { ambiguous: parseInt(q, 10) };

  return q;
}

async function handleSackFind(ui, db, env, input) {
  const raw = input.q !== undefined ? input.q : input.sack_id;
  const isTest = isTestMode(env) ? 1 : 0;

  if (raw === undefined || String(raw).trim() === '') {
    const recent = await query(db, `
      SELECT sack_id, cultivar, zone, cut_number FROM harvest_sacks
      WHERE is_test = ? AND voided_at IS NULL ORDER BY serial DESC LIMIT 8
    `, [isTest]);
    return renderPage(ui, ui.t('findSack'), sackFindBody(ui, { recent }));
  }

  const parsed = normalizeSackId(raw, getSeason());

  // A bare number matches one bag per cultivar now, so offer the candidates
  // instead of picking one. Guessing here would hand back a confidently wrong
  // sack, which is worse than asking.
  if (parsed && typeof parsed === 'object' && parsed.ambiguous !== undefined) {
    const matches = await query(db, `
      SELECT sack_id, cultivar, zone, cut_number FROM harvest_sacks
      WHERE serial = ? AND season = ? AND is_test = ? AND voided_at IS NULL
      ORDER BY cultivar
    `, [parsed.ambiguous, getSeason(), isTest]);
    if (matches.length === 1) {
      const only = await getSackView(db, matches[0].sack_id);
      return renderPage(ui, `${ui.t('sack')} ${only.sack.sack_id}`, sackDetailBody(ui, only));
    }
    const recentA = await query(db, `
      SELECT sack_id, cultivar, zone, cut_number FROM harvest_sacks
      WHERE is_test = ? AND voided_at IS NULL ORDER BY id DESC LIMIT 8
    `, [isTest]);
    return renderPage(ui, ui.t('findSack'),
      sackFindBody(ui, { recent: matches.length ? matches : recentA, typed: raw,
                         ambiguous: parsed.ambiguous, missing: matches.length ? null : String(parsed.ambiguous) }),
      matches.length ? 300 : 404);
  }

  const id = typeof parsed === 'string' ? parsed : null;
  const view = id ? await getSackView(db, id) : null;
  if (view) {
    return renderPage(ui, `${ui.t('sack')} ${view.sack.sack_id}`, sackDetailBody(ui, view));
  }

  const recent = await query(db, `
    SELECT sack_id, cultivar, zone, cut_number FROM harvest_sacks
    WHERE is_test = ? AND voided_at IS NULL ORDER BY serial DESC LIMIT 8
  `, [isTest]);
  return renderPage(ui, ui.t('findSack'), sackFindBody(ui, { recent, missing: id, typed: raw }), 404);
}

/**
 * Mark a bag opened. One tap at bucking — the crew scans the tag anyway, and
 * this replaces typing weights, which nobody does per bag: the floor reports a
 * daily total per strain and each bag's share is allocated from it.
 */
async function handleSackOpen(ui, db, env, ctx, body) {
  const sackId = String(body.sack_id || '').trim();
  const view = await getSackView(db, sackId);
  if (!view) throw createError('NOT_FOUND', ui.t('noSack', { id: sackId }));
  const sack = view.sack;

  if (sack.voided_at) throw createError('VALIDATION_ERROR', ui.t('noSack', { id: sackId }));
  if (sack.opened_at) {
    // Already open — say so rather than decrementing the count a second time.
    return renderPage(ui, `${ui.t('sack')} ${sackId}`, sackDetailBody(ui, view, ui.t('alreadyOpen')));
  }

  await execute(db, `UPDATE harvest_sacks SET opened_at = datetime('now') WHERE sack_id = ?`, [sackId]);

  ctx.waitUntil(sendTelegramMessage(env, {
    chatId: env.TELEGRAM_TEST_CHAT_ID,
    text: `📂 Abierta *${sackId}* — ${sack.cultivar || '?'} ${sack.zone} corte ${sack.cut_number}`,
  }).catch(e => console.error('[harvest][telegram]', e)));

  if (!isTestMode(env)) {
    ctx.waitUntil((async () => {
      const r = await adjustSupersackCount(env, {
        season: sack.season, cultivar: sack.cultivar, zone: sack.zone, delta: -1,
        note: `[Harvest] ${sackId} opened (${sack.zone} cut ${sack.cut_number})`,
      });
      await execute(db, `
        UPDATE harvest_sacks SET shopify_synced_at = ?, shopify_sync_error = ? WHERE sack_id = ?
      `, [r.ok ? new Date().toISOString() : null, r.error, sackId]);
      if (!r.ok) console.error(`[harvest][inventory] open ${sackId}: ${r.error}`);
    })().catch(e => console.error('[harvest][inventory]', e)));
  }

  const updated = await getSackView(db, sackId);
  return renderPage(ui, `${ui.t('sack')} ${sackId}`, sackDetailBody(ui, updated, ui.t('sackOpened')));
}

/**
 * Share the floor's daily output across the bags opened that day.
 *
 * Equal split, and exact rather than approximate: every supersack is filled TO
 * 37 lb, so the bags really are the same size. Re-runnable — a day still in
 * progress gets a partial share, and running it again once the day closes
 * replaces it.
 *
 * Never touches a bag whose weights were actually measured.
 */
async function handleAllocate(db, env, params) {
  const isTest = isTestMode(env) ? 1 : 0;
  const day = String(params.date || '').substring(0, 10) || new Date().toISOString().substring(0, 10);

  // Grouped by season AND cultivar. The floor spends part of 2026 trimming
  // 2025 material, so "Lifter" alone is not a lot — 2025 Lifter and 2026
  // Lifter are different crops that happen to share a name.
  const rows = await query(db, `
    SELECT season, cultivar, COUNT(*) AS n FROM harvest_sacks
    WHERE date(opened_at) = ? AND is_test = ? AND voided_at IS NULL
      AND (weights_source IS NULL OR weights_source = 'allocated')
    GROUP BY season, cultivar
  `, [day, isTest]);

  if (!rows.length) {
    return successResponse({ success: true, date: day, allocated: [], note: 'No bags opened that day.' });
  }

  let floor, unresolved;
  try {
    ({ byKey: floor, unresolved } = await floorOutputByCultivar(db, env, day));
  } catch (e) {
    throw createError('EXTERNAL_API_ERROR', `Could not read floor output for ${day}: ${e.message}`);
  }

  const done = [];
  for (const r of rows) {
    const f = floor.get(`${r.season}|${r.cultivar}`);
    if (!f) {
      done.push({
        season: r.season, cultivar: r.cultivar, sacks: r.n,
        skipped: `floor logged no ${r.season} ${r.cultivar} that day`,
      });
      continue;
    }
    const tops = Math.round((f.tops / r.n) * 100) / 100;
    const smalls = Math.round((f.smalls / r.n) * 100) / 100;
    await execute(db, `
      UPDATE harvest_sacks
      SET tops_lbs = ?, smalls_lbs = ?, weights_source = 'allocated', weights_allocated_at = datetime('now')
      WHERE date(opened_at) = ? AND season = ? AND cultivar = ? AND is_test = ? AND voided_at IS NULL
        AND (weights_source IS NULL OR weights_source = 'allocated')
    `, [tops, smalls, day, r.season, r.cultivar, isTest]);
    done.push({
      season: r.season, cultivar: r.cultivar, sacks: r.n,
      floor_tops: f.tops, floor_smalls: f.smalls,
      per_sack_tops: tops, per_sack_smalls: smalls,
    });
  }

  // Floor output with no tagged bags behind it. During the changeover that is
  // the ordinary case — 2025 sacks are untagged — but it is worth seeing,
  // because it is also what a missed scan looks like.
  const untagged = [...floor.values()]
    .filter(f => !rows.some(r => r.season === f.season && r.cultivar === f.cultivar))
    .map(f => ({ season: f.season, cultivar: f.cultivar, floor_tops: f.tops, floor_smalls: f.smalls }));

  return successResponse({
    success: true, date: day, is_test: !!isTest, allocated: done,
    // Surfaced, not swallowed: a strain the alias table does not know means that
    // day's output belongs to nobody and the bags stay unallocated.
    unresolved_floor_strains: unresolved,
    floor_output_without_tagged_bags: untagged,
    basis: 'Floor output for the day, matched on SEASON and cultivar, split equally across the bags opened the same day. Equal is exact — every sack is filled to 37 lb.',
  });
}

async function handleSackNote(ui, db, env, ctx, body) {
  const sackId = String(body.sack_id || '').trim();
  const note = String(body.note || '').trim().substring(0, 500);
  if (!note) throw createError('VALIDATION_ERROR', ui.t('noteEmpty'));

  const view = await getSackView(db, sackId);
  if (!view) throw createError('NOT_FOUND', ui.t('noSack', { id: sackId }));

  await execute(db, `INSERT INTO harvest_sack_notes (sack_id, note, is_test) VALUES (?, ?, ?)`,
    [sackId, note, view.sack.is_test]);

  ctx.waitUntil(sendTelegramMessage(env, {
    chatId: env.TELEGRAM_TEST_CHAT_ID,
    text: `📝 *${sackId}* (${view.sack.cultivar || '?'} ${view.sack.zone}) — ${note}`,
  }).catch(e => console.error('[harvest][telegram]', e)));

  const updated = await getSackView(db, sackId);
  return renderPage(ui, `${ui.t('sack')} ${sackId}`, sackDetailBody(ui, updated, ui.t('noteSaved')));
}

/** e.g. 26-SL-1. Unpadded on purpose (Koa): "1, 2, 3", not "0001". */
function formatSackId(season, code, serial) {
  return `${String(season).slice(-2)}-${code}-${serial}`;
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
  { key: 'drivers',               labelKey: 'roleDrivers',   whereKey: 'whereDrivers' },
  { key: 'cutter_water_spiders',  labelKey: 'roleCutterWS',  whereKey: 'whereCutterWS' },
  { key: 'hangers',               labelKey: 'roleHangers',   whereKey: 'whereHangers' },
  { key: 'hanging_water_spiders', labelKey: 'roleHangingWS', whereKey: 'whereHangingWS' },
];

async function getOpenRoster(db, isTest) {
  return queryOne(db, `
    SELECT * FROM harvest_crew_roster
    WHERE effective_to IS NULL AND is_test = ?
    ORDER BY effective_from DESC, id DESC LIMIT 1
  `, [isTest]);
}

async function handleCrewForm(ui, db, env) {
  const isTest = isTestMode(env) ? 1 : 0;
  const current = await getOpenRoster(db, isTest);
  return renderPage(ui, ui.t('crew'), crewFormBody(ui, current));
}

async function handleCrewSet(ui, db, env, ctx, body) {
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
      throw createError('VALIDATION_ERROR', ui.t('roleRange', { role: ui.t(r.labelKey) }));
    }
    counts[r.key] = n;
  }

  const unchanged = current && CREW_ROLES.every(r => current[r.key] === counts[r.key]);
  if (unchanged) {
    return renderPage(ui, ui.t('crew'), crewConfirmBody(ui, counts, ui.t('crewNoChange')));
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

  return renderPage(ui, ui.t('crew'), crewConfirmBody(ui, counts, ui.t('crewUpdated')));
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

// ─── RECONCILE ──────────────────────────────────────────
//
// Tagged-and-unopened bags vs the Shopify count, per cultivar-year.
//
// The two are independent measurements of one population: harvest_sacks counts
// individuals we printed tags for, Shopify counts sacks on hand. They should
// agree, and where they do not, the gap is the interesting number — that is the
// standing raw-sack question (system ~1,318 vs whiteboard 1,232) made
// answerable rather than argued about.
//
// Read-only. It never adjusts anything to make the numbers match.

async function getReconcile(db, env, params) {
  const isTest = isTestMode(env) ? 1 : 0;
  const season = parseInt(params.season, 10) || getSeason();

  const rows = await query(db, `
    SELECT cultivar, zone,
           COUNT(*) AS tagged,
           SUM(CASE WHEN opened_at IS NULL THEN 1 ELSE 0 END) AS unopened,
           SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
           SUM(CASE WHEN opened_at IS NOT NULL AND shopify_synced_at IS NULL THEN 1 ELSE 0 END) AS unsynced
    FROM harvest_sacks
    WHERE season = ? AND is_test = ? AND voided_at IS NULL
    GROUP BY cultivar, CASE WHEN zone LIKE 'GH%' THEN 'GH' ELSE 'FIELD' END
    ORDER BY cultivar
  `, [season, isTest]);

  let variants = [];
  let variantsError = null;
  try { variants = await listSupersackVariants(env); }
  catch (e) { variantsError = String(e.message || e); }

  const byTitle = new Map(variants.map(v =>
    [String(v.title || '').trim().toLowerCase().replace(/\s+/g, ' '), v]));

  const lines = rows.map(r => {
    const title = variantTitle(season, r.cultivar, harvestTypeForZone(r.zone));
    const v = byTitle.get(title.toLowerCase().replace(/\s+/g, ' '));
    const shopify = v ? Number(v.quantity) || 0 : null;
    return {
      cultivar: r.cultivar,
      variant_title: title,
      variant_exists: !!v,
      tagged: r.tagged,
      unopened: r.unopened,
      opened: r.opened,
      opened_but_not_counted: r.unsynced,
      shopify_on_hand: shopify,
      // Our unopened bags should equal what Shopify says is on hand.
      drift: shopify === null ? null : r.unopened - shopify,
    };
  });

  return successResponse({
    success: true,
    season,
    is_test: !!isTest,
    generated_at: new Date().toISOString(),
    variants_error: variantsError,
    basis: 'Bags tagged and not yet opened, against the Super Sack Inventory count for the same cultivar-year.',
    note: 'Read-only. Drift is reported, never corrected — a mismatch is a question about the physical count, not something to paper over.',
    lines,
    unmatched_variants: variants
      .filter(v => String(v.title || '').startsWith(`${season} -`))
      .filter(v => !lines.some(l => l.variant_title.toLowerCase() === String(v.title).toLowerCase()))
      .map(v => ({ title: v.title, on_hand: Number(v.quantity) || 0 })),
  });
}

// ─── PROVENANCE (downstream) ────────────────────────────
//
// Which field lots fed a given day of processing.
//
// Derived, with NO new capture: a sack already records when it was opened and
// what it yielded, and it already knows its lot. So a processing day's
// composition is just the lots of the sacks opened that day, weighted by what
// they gave up. Pooling breaks the one-sack-to-one-bag link, but it does not
// break this — the day is the unit that survives it.
//
// That constraint is deliberate. The previous attempt at seed-to-sale here
// (the "Field Tracking Hub", migrations 0004-0007) built nine tables covering
// germination through lineage, required somebody to fill them, and never went
// live. Anything downstream that needs a new data-entry step will die the same
// way, so this asks for nothing.

async function getProvenance(db, env, params) {
  const isTest = isTestMode(env) ? 1 : 0;
  const limitDays = Math.min(Math.max(parseInt(params.days, 10) || 60, 1), 400);

  const rows = await query(db, `
    SELECT date(s.opened_at) AS day,
           s.zone_session_id, s.zone, s.cultivar, s.cut_number, s.season,
           COUNT(*) AS sacks,
           COALESCE(SUM(s.tops_lbs), 0) AS tops_lbs,
           COALESCE(SUM(s.smalls_lbs), 0) AS smalls_lbs
    FROM harvest_sacks s
    WHERE s.opened_at IS NOT NULL AND s.voided_at IS NULL AND s.is_test = ?
      AND julianday('now') - julianday(s.opened_at) <= ?
    GROUP BY day, s.zone_session_id
    ORDER BY day DESC, tops_lbs DESC
  `, [isTest, limitDays]);

  const byDay = new Map();
  for (const r of rows) {
    if (!byDay.has(r.day)) {
      byDay.set(r.day, { date: r.day, sacks_opened: 0, tops_lbs: 0, smalls_lbs: 0, lots: [] });
    }
    const d = byDay.get(r.day);
    d.sacks_opened += r.sacks;
    d.tops_lbs += r.tops_lbs;
    d.smalls_lbs += r.smalls_lbs;
    d.lots.push({
      lot_id: lotId(r),
      zone: r.zone, cultivar: r.cultivar, cut_number: r.cut_number,
      sacks: r.sacks, tops_lbs: round1(r.tops_lbs), smalls_lbs: round1(r.smalls_lbs),
    });
  }

  const days = [...byDay.values()].map(d => {
    const total = d.tops_lbs + d.smalls_lbs;
    return {
      ...d,
      tops_lbs: round1(d.tops_lbs),
      smalls_lbs: round1(d.smalls_lbs),
      finished_lbs: round1(total),
      // Share of the day's finished weight, so a bag from this day can be
      // described honestly as "mostly Z4, some Z5" rather than guessed at.
      lots: d.lots.map(l => ({
        ...l,
        share_pct: total > 0 ? +(((l.tops_lbs + l.smalls_lbs) / total) * 100).toFixed(1) : null,
      })),
      single_lot: d.lots.length === 1,
    };
  });

  return successResponse({
    success: true,
    is_test: !!isTest,
    generated_at: new Date().toISOString(),
    basis: 'Sacks opened per day, grouped by field lot. No separate capture — derived from the sack tags themselves.',
    limits: 'Stops at the trim floor: which buyer received which lot is not tracked, because that needs a batch-to-order link nobody records today.',
    days,
  });
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

function renderPage(ui, title, bodyHtml, status = 200) {
  const lang = ui.lang;
  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>${escapeHtml(title)} — Harvest</title>
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
  h2 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.09em;
       color: #7fae91; margin: 22px 0 8px; font-weight: 700; }
  .kv { display: flex; justify-content: space-between; gap: 14px; padding: 7px 0;
        border-bottom: 1px solid #223b29; font-size: 1.02rem; }
  .kv span { color: #9fc2ac; }
  .kv strong { text-align: right; }

  /* Cultivar picker — trial zones can hold 15 cultivars, so a single column of
     full-width targets beats a cramped grid for a gloved thumb. */
  .cvgrid { display: grid; grid-template-columns: 1fr; gap: 10px; margin-top: 14px; }
  a.cvbtn { padding: 20px 14px; font-size: 1.15rem; text-align: left; }
  a.findrow { text-align: left; padding: 14px; }
  a.findrow .hint { display: block; margin-top: 3px; }

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
  /* Language toggle — small and out of the way. Spanish is the default, so
     this is an escape hatch for an English reader, not a decision the crew is
     asked to make on every screen. */
  .lang { position: fixed; top: 8px; right: 10px; font-size: 0.8rem; }
  .lang a { color: #9fc2ac; text-decoration: none; border: 1px solid #2c4a36;
            padding: 5px 9px; border-radius: 999px; background: #1b3123; }
  @media print { .lang { display: none; } }
</style>
</head>
<body>
<div class="lang"><a href="${ui.toggle}">${ui.t('langOther')}</a></div>
${bodyHtml}
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      // Remember the choice so a toggle survives the next scan.
      'Set-Cookie': langCookie(lang),
    },
  });
}

/**
 * Per-request UI context. Carries the language, a translator already bound to
 * it, and a toggle link that KEEPS the current query string — a bare
 * `?lang=en` would drop `action=` and dump the user on an unknown-action error.
 */
function makeUi(request) {
  const lang = pickLang(request);
  const url = new URL(request.url);
  const other = lang === 'es' ? 'en' : 'es';
  url.searchParams.set('lang', other);
  return {
    lang,
    toggle: url.pathname + url.search,
    t: (key, vars) => translate(lang, key, vars),
  };
}

function errorPage(ui, message, status = 400) {
  return renderPage(ui, ui.t('error'),
    `<h1>⚠️ ${escapeHtml(message)}</h1><p class="note">${ui.t('checkQR')}</p>`, status);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function headcountGrid(ui, zone, sessionId) {
  const q = `?lang=${ui.lang}&zone=${zone}&action=headcount&session_id=${sessionId}`;
  const cells = HEADCOUNT_OPTIONS
    .map(n => `<a class="btn" href="${q}&count=${n}">${n}</a>`)
    .join('');
  return `${cells}<a class="btn alt" href="${q}&count=13">13+</a>`;
}

/**
 * Cultivar picker — shown after scanning a trial/split zone's sign, before the
 * session opens. Big tap targets: this is a gloved thumb in a field.
 */
function cultivarPickerBody(ui, zone, options) {
  const buttons = options.map(cv =>
    `<a class="btn cvbtn" href="/z/${encodeURIComponent(zone)}?lang=${ui.lang}&cultivar=${encodeURIComponent(cv)}">${escapeHtml(cv)}</a>`
  ).join('');
  return `
<h1>${escapeHtml(zone)}</h1>
<p class="sub">${ui.t('nCultivars', { n: options.length })}</p>
<p class="note">${ui.t('whichCutting')}</p>
<div class="cvgrid">${buttons}</div>`;
}

function enterBody(ui, { zone, cultivar, cutNumber, sessionId, prevZone }) {
  return `
<h1>${ui.t('entered', { zone })}</h1>
<p class="sub">${cultivar ? `${escapeHtml(cultivar)} · ` : ''}${ui.t('cut', { n: cutNumber })}</p>
<p class="note">${prevZone ? ui.t('prevClosed', { lot: escapeHtml(prevZone) }) : ui.t('noPrior')}</p>
<p class="note">${ui.t('howManyCutters')}</p>
<div class="grid">${headcountGrid(ui, zone, sessionId)}</div>
<div class="footer"><a href="?action=logs&zone=${zone}">${ui.t('viewLog')}</a></div>`;
}

function alreadyEnteredBody(ui, active) {
  return `
<h1>${ui.t('alreadyEntered', { zone: active.zone })}</h1>
<p class="sub">${active.cultivar ? `${escapeHtml(active.cultivar)} · ` : ''}${ui.t('cut', { n: active.cut_number })}</p>
<p class="note">${ui.t('alreadyEnteredAt', { t: active.occurred_at })}</p>
<p class="note">${ui.t('howManyCutters')}</p>
<div class="grid">${headcountGrid(ui, active.zone, active.id)}</div>`;
}

function headcountBody(ui, { zone, cutNumber, sessionId, count }) {
  return `
<h1>${count === 1 ? ui.t('loggedCutter') : ui.t('loggedCutters', { n: count })}</h1>
<p class="sub">${zone} — ${ui.t('cut', { n: cutNumber })}</p>
<p class="note">${ui.t('wrongNumber')}</p>
<div class="grid">${headcountGrid(ui, zone, sessionId)}</div>
<div class="footer"><a href="?action=status">${ui.t('viewStatus')}</a></div>`;
}

function barnIntakeFormBody(ui, active) {
  // Only zones harvest actually counts — offering GH here would let a load be
  // logged against a zone no bag will ever be tagged from.
  const options = [...VALID_ZONES].filter(isHarvestTracked).sort().map(z =>
    `<option value="${z}" ${active && active.zone === z ? 'selected' : ''}>${z}</option>`
  ).join('');
  const activeNote = active
    ? `<p class="note">${ui.t('activeNow', {
        lot: `${active.zone}${active.cultivar ? ` · ${escapeHtml(active.cultivar)}` : ''}`,
        n: active.cut_number,
      })}</p>`
    : `<p class="note">${ui.t('noZoneOpen')}</p>`;
  return `
<h1>${ui.t('barnIntake')}</h1>
${activeNote}
<form method="POST" action="?action=barn_log&lang=${ui.lang}" onsubmit="this.querySelector('button').disabled=true">
  <label for="zone">${ui.t('zone')}</label>
  <select id="zone" name="zone" required>${options}</select>
  <label for="bins">${ui.t('binsOnLoad')}</label>
  <input id="bins" name="bins" type="number" min="1" max="500" inputmode="numeric" required autofocus>
  <button class="btn" type="submit">${ui.t('logLoad')}</button>
</form>`;
}

function barnLogConfirmBody(ui, { zone, bins, loadNumber, hasActiveSession }) {
  return `
<h1>${ui.t('loggedLoad', { bins, zone })}</h1>
<p class="sub">${ui.t('loadNumToday', { n: loadNumber, zone })}</p>
${hasActiveSession ? '' : `<p class="note">${ui.t('noSessionWarn', { zone })}</p>`}
<div class="footer"><a href="?action=barn_intake">${ui.t('logAnother')}</a> · <a href="?action=crew">${ui.t('crewChanged')}</a> · <a href="?action=find">${ui.t('findLink')}</a></div>`;
}

// ─── CREW ROSTER RENDERING ──────────────────────────────

function crewFormBody(ui, current) {
  const fields = CREW_ROLES.map(r => `
  <label for="${r.key}">${ui.t(r.labelKey)} <span class="hint">${ui.t(r.whereKey)}</span></label>
  <input id="${r.key}" name="${r.key}" type="number" min="0" max="99" inputmode="numeric"
         value="${current && current[r.key] !== null ? current[r.key] : ''}">`).join('');

  const since = current
    ? `<p class="note">${ui.t('rosterSince', { t: escapeHtml(current.effective_from) })}</p>`
    : `<p class="note">${ui.t('rosterNone')}</p>`;

  return `
<h1>${ui.t('crew')}</h1>
<p class="sub">${ui.t('crewSub')}</p>
${since}
<form method="POST" action="?action=crew_set&lang=${ui.lang}" onsubmit="this.querySelector('button').disabled=true">
  ${fields}
  <label for="note">${ui.t('note')} <span class="hint">${ui.t('noteHint')}</span></label>
  <input id="note" name="note" maxlength="200" autocomplete="off">
  <button class="btn" type="submit">${ui.t('saveCrew')}</button>
</form>
<p class="note"><span class="hint">${ui.t('cuttersNotHere')}</span></p>`;
}

function crewConfirmBody(ui, counts, flash) {
  const rows = CREW_ROLES.map(r =>
    `<div class="lotmeta"><strong>${ui.t(r.labelKey)}:</strong> ${counts[r.key] ?? '—'} <span class="hint">${ui.t(r.whereKey)}</span></div>`
  ).join('');
  return `
<h1>✅ ${escapeHtml(flash)}</h1>
<div class="status">${rows}</div>
<div class="footer"><a href="?action=crew">${ui.t('changeAgain')}</a> · <a href="?action=barn_intake">${ui.t('toBarnIntake')}</a></div>`;
}

// ─── SUPERSACK TAG RENDERING ────────────────────────────

function sackPrintFormBody(ui, lots) {
  if (!lots.length) {
    return `
<h1>${ui.t('printTags')}</h1>
<p class="note">${ui.t('noLots', { n: LOT_PICKER_DAYS })}</p>`;
  }

  const BADGE = {
    ready:   { cls: 'ok',   text: ui.t('badgeReady') },
    started: { cls: 'warn', text: ui.t('badgeStarted') },
    green:   { cls: 'bad',  text: ui.t('badgeGreen') },
    old:     { cls: 'warn', text: ui.t('badgeOld') },
  };

  // Pre-select ONLY when the best candidate is genuinely plausible. If the top
  // of the list is overdue/green/already-started, pre-filling it would make the
  // dangerous option the default — force a deliberate choice instead.
  const topIsReady = lots.length > 0 && lotPlausibility(ui, lots[0]).level === 'ready';

  const cards = lots.map((l, i) => {
    const p = lotPlausibility(ui, l);
    const b = BADGE[p.level];
    const cv = l.cultivar || '';
    return `
    <label class="lot ${p.level}">
      <input type="radio" name="session_id" value="${l.id}"
             data-cultivar="${escapeHtml(cv)}" data-level="${p.level}"
             data-desc="${escapeHtml(`${l.zone}${cv ? ` · ${cv}` : ''} cut ${l.cut_number}`)}"
             data-confirm="${escapeHtml(ui.t('confirmLot', {
               lot: `${l.zone}${cv ? ` · ${cv}` : ''} ${ui.t('cut', { n: l.cut_number })}`,
               note: p.note,
             }))}" ${i === 0 && topIsReady ? 'checked' : ''} required>
      <span class="lotbody">
        <span class="lothead">
          <strong>${escapeHtml(l.zone)}${cv ? ` · ${escapeHtml(cv)}` : ''}</strong>
          <span class="badge ${b.cls}">${b.text}</span>
        </span>
        <span class="lotmeta">${ui.t('cut', { n: l.cut_number })} · ${escapeHtml(String(l.occurred_at).substring(0, 10))} · ${escapeHtml(p.note)}</span>
      </span>
    </label>`;
  }).join('');

  const firstCv = topIsReady ? (lots[0].cultivar || '') : '';

  return `
<h1>${ui.t('printTags')}</h1>
<p class="note">${ui.t('pickLotHelp', { n: DRY_DAYS_TYPICAL })}</p>

<form method="POST" action="?action=sack_session_start&lang=${ui.lang}" id="lotForm">
  <div class="lotlist">${cards}</div>
  <label for="cultivar">${ui.t('cultivar')} <span class="hint">${ui.t('cultivarHint')}</span></label>
  <input id="cultivar" name="cultivar" required autocomplete="off" value="${escapeHtml(firstCv)}" placeholder="Sour Lifter">
  <button class="btn" type="submit">${ui.t('startTakedown')}</button>
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
      var msg = r.getAttribute('data-confirm');
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
function sackSessionBody(ui, { lot, cultivar, stats }) {
  const q = `session_id=${lot.id}&cultivar=${encodeURIComponent(cultivar)}&lang=${ui.lang}`;
  return `
<div class="lot">
  <div class="lot-cultivar">${escapeHtml(cultivar)}</div>
  <div class="lot-meta">${escapeHtml(lot.zone)} · ${ui.t('cut', { n: lot.cut_number ?? '?' })} · ${escapeHtml(formatTagDate(ui.lang, String(lot.occurred_at).substring(0, 10)))}</div>
</div>

<button id="printBtn" class="bigbtn">${ui.t('printTag')}</button>

<div class="status">
  <div id="count">${stats.printed === 1 ? ui.t('tagForLot') : ui.t('tagsForLot', { n: stats.printed })}</div>
  <div id="last" class="last">${stats.lastSackId ? ui.t('lastTag', { id: escapeHtml(stats.lastSackId) }) : ui.t('noTagsYet')}</div>
  <div id="lastActions" class="lastActions" ${stats.lastSackId ? '' : 'hidden'}>
    <a id="reprintLink" class="mini" href="#">${ui.t('reprint')}</a>
    <a id="voidLink" class="mini danger" href="#">${ui.t('void')}</a>
  </div>
</div>

<details class="batch">
  <summary>${ui.t('printSeveral')}</summary>
  <p class="note">${ui.t('printSeveralHelp')}</p>
  <div class="batchrow">
    <input id="batchQty" type="number" min="2" max="${MAX_PRINT_QTY}" inputmode="numeric" value="5">
    <button id="batchBtn" class="btn">${ui.t('printBatch')}</button>
  </div>
</details>

<div class="footer"><a href="?action=sack_print">${ui.t('changeLot')}</a> · <a href="?action=find">${ui.t('findLink')}</a></div>

<iframe id="printFrame" title="print" style="position:absolute;width:0;height:0;border:0;left:-9999px"></iframe>

<script>
(function () {
  var Q = '${q}';
  // Strings injected as data rather than assembled in JS — keeps every
  // translation in one table and avoids escaping through two template layers.
  var T = ${JSON.stringify({
    printTag: ui.t('printTag'), printing: ui.t('printing'), voiding: ui.t('voiding'),
    tagForLot: ui.t('tagForLot'), tagsForLot: ui.t('tagsForLot', { n: '{n}' }),
    lastTag: ui.t('lastTag', { id: '{id}' }), noTagsYet: ui.t('noTagsYet'),
    printFailed: ui.t('printFailed', { e: '{e}' }),
    voidFailed: ui.t('voidFailed', { e: '{e}' }),
    confirmVoid: ui.t('confirmVoid', { id: '{id}' }),
  })};
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
    btn.textContent = b ? (label || T.printing) : T.printTag;
  }

  function refresh(data) {
    var n = data.printed;
    countEl.innerHTML = (n === 1 ? T.tagForLot : T.tagsForLot.replace('{n}', n));
    lastId = data.last_sack_id;
    if (lastId) {
      lastEl.innerHTML = T.lastTag.replace('{id}', lastId);
      actions.hidden = false;
      reprint.href = '?action=sack_label&id=' + encodeURIComponent(lastId);
    } else {
      lastEl.textContent = T.noTagsYet;
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
        alert(T.printFailed.replace('{e}', e.message));
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
    if (!confirm(T.confirmVoid.replace('{id}', lastId))) return;
    setBusy(true, T.voiding);
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
      .catch(function (e) { setBusy(false); alert(T.voidFailed.replace('{e}', e.message)); });
  });
})();
</script>`;
}

/**
 * Printable label sheet — one 4x2in page per sack. Auto-fires window.print()
 * once every QR image has loaded; with Chrome's --kiosk-printing flag on the
 * barn PC that goes straight to the ZP-450 with no dialog to dismiss.
 */
/**
 * The printed face of one tag. Shared verbatim by the thermal roll and the
 * Avery sheet so a bag looks identical whichever printer produced it — two
 * copies of this markup would drift, and the drift would only show up as two
 * tags on one rack that don't match.
 */
function labelInner(ui, s) {
  return `
    <div class="cultivar" style="font-size:${cultivarFontPt(s.cultivar)}pt">${escapeHtml(s.cultivar || '')}</div>
    <div class="row">
      <div class="left">
        <div class="bagno">#&nbsp;${escapeHtml(s.sack_id)}</div>
        <div class="meta">${escapeHtml(formatTagDate(ui.lang, s.harvest_date))} · ${escapeHtml(s.zone)} · ${escapeHtml(ui.t('cut', { n: s.cut_number ?? '?' }))}</div>
      </div>
      <img class="qr" src="${qrUrlFor(s.sack_id)}" alt="">
    </div>`;
}

/**
 * Avery 5163 — 2in x 4in, 10 to a US Letter sheet, laser.
 *
 * The numbers are Avery's own and they close exactly, which is the check that
 * they are right: 0.15625 + 4 + 0.1875 + 4 + 0.15625 = 8.5in across, and
 * 0.5 + (5 x 2) + 0.5 = 11in down. A template whose margins don't sum to the
 * sheet is a template that will creep a little further off with every row.
 */
const AVERY_5163 = {
  name: 'Avery 5163', cols: 2, rows: 5, perSheet: 10,
  labelW: 4, labelH: 2, marginTop: 0.5, marginLeft: 0.15625, gutterX: 0.1875, gutterY: 0,
};

/**
 * The same tags laid out on an Avery 5163 sheet, for a plain laser printer.
 *
 * This is the FALLBACK path, not the everyday one. The Zebra prints one tag as
 * one sack is filled, which is what keeps a number attached to the bag it was
 * allocated for. A sheet printer cannot do that \u2014 it emits ten at a time \u2014 so
 * using this means labels exist before their sacks do, and a sheet left on the
 * bench can end up on the wrong lot. That is the failure the on-demand design
 * avoids, and it is worth accepting only when the alternative is not printing:
 * a dead ZP-450, or the barn connection dropping mid-takedown.
 *
 * `skip` leaves the first N slots blank so a part-used sheet can be re-fed
 * rather than binned \u2014 without it, three tags cost a whole sheet of ten.
 */
function renderAverySheet(ui, sacks, opts = {}) {
  const G = AVERY_5163;
  const skip = Math.min(Math.max(parseInt(opts.skip, 10) || 0, 0), G.perSheet - 1);
  const calibrate = opts.calibrate === true;

  // Blank leading slots, then the tags, chunked one sheet per page.
  const cells = [];
  for (let i = 0; i < skip; i++) cells.push('<div class="cell blank"></div>');
  if (calibrate) {
    cells.length = 0;   // a calibration sheet is every slot, ignoring skip
    for (let i = 0; i < G.perSheet; i++) {
      cells.push(`<div class="cell cal"><span class="calnum">${i + 1}</span></div>`);
    }
  } else {
    for (const sack of sacks) cells.push(`<div class="cell">${labelInner(ui, sack)}</div>`);
  }

  const pages = [];
  for (let i = 0; i < cells.length; i += G.perSheet) {
    pages.push(`<div class="sheet">${cells.slice(i, i + G.perSheet).join('')}</div>`);
  }

  const used = skip + sacks.length;
  const leftOver = calibrate ? 0 : (G.perSheet - (used % G.perSheet)) % G.perSheet;
  const nextSkip = (used % G.perSheet);

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${G.name}</title>
<style>
  @page { size: letter portrait; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #eee; }
  .sheet {
    width: 8.5in; height: 11in; background: #fff;
    padding: ${G.marginTop}in 0 0 ${G.marginLeft}in;
    display: grid;
    grid-template-columns: repeat(${G.cols}, ${G.labelW}in);
    grid-auto-rows: ${G.labelH}in;
    column-gap: ${G.gutterX}in; row-gap: ${G.gutterY}in;
    align-content: start;
  }
  .cell {
    width: ${G.labelW}in; height: ${G.labelH}in;
    padding: 0.11in 0.13in; overflow: hidden; color: #000;
    display: flex; flex-direction: column;
  }
  .cell.blank { visibility: hidden; }
  .cultivar { font-size: 25pt; font-weight: 800; line-height: 1.0; letter-spacing: -0.01em;
              white-space: nowrap; overflow: hidden; }
  .row { display: flex; align-items: flex-end; justify-content: space-between; flex: 1; gap: 0.08in; }
  .left { min-width: 0; }
  .bagno { font-size: 30pt; font-weight: 800; line-height: 1.05; white-space: nowrap; }
  .meta { font-size: 10.5pt; margin-top: 0.03in; white-space: nowrap; }
  .qr { width: 1in; height: 1in; flex: none; }

  /* Calibration: outline every slot so a test print can be held against a
     real sheet. If these boxes do not sit on the die-cuts, the printer is
     scaling and no amount of template tweaking will fix it. */
  .cell.cal { border: 1pt solid #000; align-items: center; justify-content: center; }
  .calnum { font-size: 28pt; font-weight: 700; color: #000; }

  .toolbar { padding: 14px; font: 14px system-ui; background: #fff; }
  .toolbar a { color: #036; }
  .toolbar .warn { color: #a33; font-weight: 600; }
  @media screen { .sheet { margin: 12px auto; box-shadow: 0 1px 6px rgba(0,0,0,.3); } }
  @media print {
    .toolbar { display: none; }
    body { background: #fff; }
    .sheet { margin: 0; box-shadow: none; page-break-after: always; }
    .sheet:last-child { page-break-after: auto; }
  }
</style></head>
<body>
<div class="toolbar">
  <strong>${G.name}</strong> &middot; ${calibrate ? 'calibration sheet' : `${sacks.length} ${ui.t('sack')}${skip ? ` · skipped ${skip}` : ''}`}
  &middot; <a href="javascript:window.print()">${ui.t('printTag')}</a>
  ${!calibrate && leftOver ? `&middot; <strong>${leftOver} slot(s) left on this sheet</strong> — keep it, next run use <code>&amp;skip=${nextSkip}</code>` : ''}
  <div class="warn">Print at 100% scale, margins None, headers/footers off — anything else shifts every label.</div>
</div>
${pages.join('')}
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function renderLabelSheet(ui, sacks, printCtx, opts = {}) {
  const autoPrint = opts.autoPrint !== false;
  const labels = sacks.map(s => `
  <div class="label">${labelInner(ui, s)}
  </div>`).join('');

  const backLink = `<a href="?action=sack_print">${ui.t('changeLot')}</a>`;

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
<div class="toolbar">${sacks.length} · ${backLink} · <a href="javascript:window.print()">${ui.t('printTag')}</a></div>
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

const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
};

/**
 * Date as it appears on the printed tag and on screen. Spanish puts the day
 * first — "3 oct 2026" — which is what a Spanish-reading crew expects to see
 * on a sack they are trying to identify quickly.
 */
function formatTagDate(lang, iso) {
  if (!iso) return '';
  const d = new Date(String(iso).substring(0, 10) + 'T00:00:00Z');
  if (isNaN(d)) return String(iso).substring(0, 10);
  const m = (MONTHS[lang] || MONTHS.en)[d.getUTCMonth()];
  return lang === 'es'
    ? `${d.getUTCDate()} ${m} ${d.getUTCFullYear()}`
    : `${m} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function sackFindBody(ui, { recent, missing, typed, ambiguous }) {
  const list = recent.length
    ? recent.map(r => `<a class="btn alt findrow" href="/s/${encodeURIComponent(r.sack_id)}?lang=${ui.lang}">
         <strong>#&nbsp;${escapeHtml(r.sack_id)}</strong>
         <span class="hint">${escapeHtml(r.cultivar || '')} · ${escapeHtml(r.zone)} · ${ui.t('cut', { n: r.cut_number ?? '?' })}</span>
       </a>`).join('')
    : '';

  return `
<h1>${ui.t('findSack')}</h1>
${missing ? `<p class="note">⚠️ ${ui.t('findNotFound', { id: escapeHtml(missing) })}</p>` : ''}
${ambiguous !== undefined && !missing ? `<p class="note">⚠️ ${ui.t('findAmbiguous', { n: ambiguous })}</p>` : ''}
<p class="note">${ui.t('findHelp')}</p>
<form method="GET" action="/api/harvest" onsubmit="this.querySelector('button').disabled=true">
  <input type="hidden" name="action" value="find">
  <input type="hidden" name="lang" value="${ui.lang}">
  <input id="q" name="q" autocomplete="off" autocapitalize="off" autocorrect="off"
         inputmode="numeric" placeholder="${ui.t('findPlaceholder')}"
         value="${typed ? escapeHtml(String(typed)) : ''}" autofocus required>
  <button class="btn" type="submit">${ui.t('findGo')}</button>
</form>
<p class="note"><span class="hint">${ui.t('findUnreadable')}</span></p>
${list ? `<h2>${ui.t('findRecent')}</h2><div class="cvgrid">${list}</div>` : ''}
<div class="footer"><a href="?action=sack_print">${ui.t('printTags')} →</a></div>
<script>
  // A USB imager types the code then presses Enter, so the box submits itself.
  // Select the existing text immediately, not just on focus: the box is
  // autofocused, so a re-render after a failed search leaves the old value
  // there already focused — no focus event fires, and the next scan would
  // append to it instead of replacing it.
  (function () {
    var q = document.getElementById('q');
    q.select();
    q.addEventListener('focus', function () { q.select(); });
  })();
</script>`;
}

function sackDetailBody(ui, view, flash) {
  const { sack, notes, plantDate, plantDateApprox, acres, plants, growDays, lotSacks } = view;
  const opened = !!sack.opened_at;

  // floor, not round — a sack cut this morning is "today", not "1 day ago".
  const days = sack.harvest_date
    ? Math.max(0, Math.floor((Date.now() - new Date(sack.harvest_date + 'T00:00:00Z')) / 86400000))
    : null;
  const drying = days === null ? ''
    : days === 0 ? ui.t('dryingToday')
    : days === 1 ? ui.t('dryingOne')
    : ui.t('dryingFor', { n: days });

  const row = (label, value) =>
    `<div class="kv"><span>${label}</span><strong>${value}</strong></div>`;

  const origin = [
    row(ui.t('zone'), `${escapeHtml(sack.zone)} · ${ui.t('cut', { n: sack.cut_number ?? '?' })}`),
    plantDate ? row(ui.t('planted'),
      `${escapeHtml(formatTagDate(ui.lang, plantDate))}${plantDateApprox ? ' ~' : ''}`) : '',
    row(ui.t('harvested', { d: '' }).trim(), escapeHtml(formatTagDate(ui.lang, sack.harvest_date))),
    growDays !== null ? row('', ui.t('growTime', { n: growDays })) : '',
    acres ? row(ui.t('area'), ui.t('areaVal', {
      ac: acres.toFixed(3), plants: plants ? plants.toLocaleString('en-US') : '?' })) : '',
  ].join('');

  const hasWeights = sack.tops_lbs !== null && sack.tops_lbs !== undefined;
  const src = sack.weights_source === 'measured' ? ui.t('weightsMeasured') : ui.t('weightsAllocated');

  // No weight entry here on purpose. Nobody weighs a bag's output on its own —
  // the floor reports a daily total per strain and each bag's share is
  // allocated from it, so this screen shows the result instead of asking.
  const weights = !opened
    ? `
<p class="note">${ui.t('notOpened')}</p>
<form method="POST" action="/api/harvest?action=sack_open&lang=${ui.lang}" onsubmit="this.querySelector('button').disabled=true">
  <input type="hidden" name="sack_id" value="${escapeHtml(sack.sack_id)}">
  <button class="bigbtn" type="submit">${ui.t('openSack')}</button>
</form>`
    : hasWeights
      ? `<p class="note"><strong>${ui.t('weights', { tops: sack.tops_lbs, smalls: sack.smalls_lbs })}</strong><br>
         <span class="hint">${src} · ${ui.t('openedAt', { t: escapeHtml(sack.opened_at) })}</span></p>`
      : `<p class="note">${ui.t('weightsPending')}<br>
         <span class="hint">${ui.t('openedAt', { t: escapeHtml(sack.opened_at) })}</span></p>`;

  const noteList = notes.length
    ? notes.map(n => `<div class="lotmeta">• ${escapeHtml(n.note)}
        <span class="hint">${escapeHtml(String(n.created_at).substring(0, 10))}</span></div>`).join('')
    : `<p class="note"><span class="hint">${ui.t('noNotes')}</span></p>`;

  return `
${flash ? `<p class="note">✅ ${escapeHtml(flash)}</p>` : ''}
<h1>${escapeHtml(sack.cultivar || ui.t('sack'))}</h1>
<p class="sub">#&nbsp;${escapeHtml(sack.sack_id)}${sack.voided_at ? ` · ${ui.t('void')}` : ''}</p>

<h2>${ui.t('secOrigin')}</h2>
${origin}

<h2>${ui.t('secBarn')}</h2>
<div class="kv"><span>${drying}</span><strong>${lotSacks ? (lotSacks === 1 ? ui.t('lotTotalOne') : ui.t('lotTotal', { n: lotSacks })) : ''}</strong></div>

<h2>${ui.t('secWeights')}</h2>
${weights}

<h2>${ui.t('secNotes')}</h2>
${noteList}
<details class="batch">
  <summary>${ui.t('addNote')}</summary>
  <form method="POST" action="/api/harvest?action=sack_note&lang=${ui.lang}" onsubmit="this.querySelector('button').disabled=true">
    <input type="hidden" name="sack_id" value="${escapeHtml(sack.sack_id)}">
    <input name="note" maxlength="500" autocomplete="off" placeholder="${ui.t('notePlaceholder')}" required>
    <button class="btn" type="submit">${ui.t('saveNote')}</button>
  </form>
</details>

<div class="footer"><a href="/api/harvest?action=sack_label&lang=${ui.lang}&id=${encodeURIComponent(sack.sack_id)}">${ui.t('reprintTag')}</a></div>`;
}
