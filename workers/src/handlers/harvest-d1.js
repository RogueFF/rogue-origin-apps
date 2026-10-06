import { practicePage } from './harvest-practice.js';
import { loadCrewHourly, submitCrewHourly, crewHourlyBody } from './harvest-crew-hourly.js';
import { loadTakedownHourly, submitTakedownHourly, takedownHourlyBody } from './harvest-takedown-hourly.js';
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
 * - GET  ?action=bajada                                   - Hourly takedown report (HTML); POST bajada_set saves an hour
 * - POST ?action=crew_set   (drivers,cutter_water_spiders,
 *                            hangers,hanging_water_spiders) - Update roster (HTML)
 * - GET  ?action=test                                    - Health check (JSON)
 * - GET  ?action=status                                  - Current active zone (JSON)
 * - GET  ?action=logs&zone=&event_type=&limit=            - Raw rows (JSON)
 * - GET  ?action=harvest_dash                            - Cycle-time dashboard shell (HTML, no data)
 * - GET  ?action=harvest_metrics&season=                 - Cycle times + event feed (JSON, gated)
 * - GET  ?action=print_codes                             - Printable crew cards + barn door codes (HTML)
 * - GET  ?action=rollup&season=                          - Derived lot ledger (JSON)
 *
 * The zone-sign scan target /z/<zone> is routed in index.js -> handleZoneScan;
 * multi-cultivar zones show a cultivar picker before the session opens.
 * Crew-facing SOP: wiki/operations/sop-harvest-tracking.md
 *
 * Supersack tags (see docs/plans/2026-08-06-supersack-tag-design.md):
 * - GET  ?action=sack_print                              - Lot picker, starts a takedown session (HTML)
 * - GET  ?action=pipeline                                - What's coming: cultivars drying (bay-dated) + in supersacks (HTML, read-only)
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
import { HARVEST_UI_STYLE } from './harvest-ui.js';
import { SACK_DETAIL_STYLE } from './sack-detail-style.js';
import { SACK_BRAND_LOGO } from './sack-brand-logo.js';
import { successResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { createError, formatError } from '../lib/errors.js';
import { VALID_ZONES, normalizeZone } from '../lib/zones.js';
import { cultivarsFor, isMultiCultivar, isHarvestTracked,
  cultivarShare, ZONE_CULTIVAR_ROWS, zoneRowTotal } from '../lib/zone-cultivars.js';
import { zoneFacts, plantCountFor, acresFor, PLANTS_PER_ACRE, PLANT_SPACING_FT } from '../lib/zone-facts.js';
import { cultivarCode, supersackSku } from '../lib/cultivar-codes.js';
import { fullSackLbs, sackLbs, parseFillLbs } from '../lib/sack-weight.js';
import { adjustSupersackCount, listSupersackVariants, matchSupersackVariant, checkSupersackVariant } from '../lib/supersack-inventory.js';
import { floorOutputByCultivar } from '../lib/floor-output.js';
import { bayFills, bayCards, percentShares } from '../lib/bay-fills.js';
import { sendTelegramMessage } from '../lib/telegram.js';
import { pickLang, t as translate, langCookie } from '../lib/i18n.js';
import { handleHarvestBoard, BOARD_ACTIONS } from './harvest-board-d1.js';
import { requireAuth } from '../lib/auth.js';
import { buildMetrics } from '../lib/harvest-metrics.js';
import { dashPage } from './harvest-dash-page.js';
import { withinBarnGrace } from '../lib/barn-attribution.js';
import { IFRAME_PRINT_UNRELIABLE_SRC, APP_PRINT_FIT_SRC, SAFARI_PRINT_SRC, COMPACT_TEXT_SRC } from '../lib/print-client.js';
import { qrDataUri } from '../lib/qr.js';
import { salidaPageBody } from './harvest-salida-page.js';
import { SACK_OUT_ACTIONS, handleSackOutAction, sackOutToday } from './harvest-sack-out.js';
import {
  IN_FLIGHT, inFlight, classifyDebt, summariseDebts, DEBT_SQL, isLiveInFlight, isStaleInFlight, ADD_LANDED_AFTER_OUT_SQL,
} from '../lib/inventory-debt.js';
import {
  enqueueStatements, pullJobs, ackJob, recordHeartbeat, agentOnline,
  resolvePrintVia, requireAgentAuth, PULL_LIMIT,
  enqueueReprint, jobStatusFor, requeueStale, resolvePrinter,
} from '../lib/print-queue.js';

const DEBOUNCE_MS = 5 * 60 * 1000;       // re-scanning the same active zone within this window is a no-op
const NEW_CUT_PROMPT_DAYS = 7;           // a zone untouched this long: the scan ASKS whether it is a new cut (never decides)
// Cutter counts offered on the zone screen. 6-20: the 2026 crew is 16-18 most
// days and 8 when one team is in (Koa, 2026-09-30); 1-5 never happens.
const HEADCOUNT_OPTIONS = Array.from({ length: 15 }, (_, i) => i + 6);

const MAX_PRINT_QTY = 40;                // sanity cap on one print run
const LOT_PICKER_DAYS = 45;
// How far back the barn door may reach when it names a lot by hand. Long
// enough for a trailer that sat overnight, short enough that last week's lot is
// not one mis-tap away.
const LOT_AT_DOOR_DAYS = 3;              // how far back the takedown lot picker looks

// Drying bays, numbered continuously across both barns (Koa, 2026-09-03).
// The barn is DERIVED from the number rather than stored: two columns that have
// to agree is one column too many.
const BAY_MIN = 1;
const BAY_MAX = 12;
const BOTTOM_BARN_LAST_BAY = 8;   // 1-8 bottom, 9-12 top
// How many days back the nightly allocation replays. Long enough that a
// supersack_entries row entered late still reaches its bags, short enough that
// the job stays a handful of queries.
const ALLOCATION_WINDOW_DAYS = 7;

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
  harvestDayLimits: {
    value: null,
    label: 'cutting day starts / ends (Pacific)',
    unblocks: 'cutter person-hours on a lot the crew slept on',
    how: 'the crew stops at the end of the day and picks up in the same zone next morning, so the session spans the night; the hours it was actually worked need the day window',
  },
  // Per crop year, from lib/sack-weight.js — this entry is the dashboard's label
  // for the current crop, not a number anything multiplies by.
  supersackLbs: { value: fullSackLbs(2026), label: `1 supersack = ${fullSackLbs(2026)} lb (2026 crop on; ${fullSackLbs(2025)} lb through 2025). A bag weighed off-standard carries its own weight.`, unblocks: null, how: 'Koa 2026-09-28 (37 lb confirmed 2026-08-03 for the 2025 crop)' },
  binsPerTrailer: { value: 24, label: '1 trailer = 24 bins', unblocks: null, how: 'standard for all of 2026 harvest (Koa, 2026-09-28)' },
  plantsPerBin: { value: 1, label: '1 bin = 1 plant', unblocks: null, how: 'recalibrate once real' },
};
const PUBLIC_BASE = 'https://rogue-origin-api.roguefamilyfarms.workers.dev';

/**
 * Every action URL must be ABSOLUTE.
 *
 * The crew reach these pages through short QR routes -- /z/Z4, /b, /s/<id> --
 * and a relative `?action=...` resolves against THAT path, not /api/harvest.
 * So a cutter-count tap from a scanned zone sign went to `/z/Z4?action=
 * headcount`, which routes to the zone handler, ignores `action`, and answers
 * "Already entered Z4" while recording nothing. Same for a trailer submitted
 * from /b. Both looked like they worked and captured nothing (found 2026-09-04,
 * from Koa noticing the cutter alert never arrived).
 */
const API = '/api/harvest';

/**
 * THREE CREWS (Koa, 2026-10-03). Crew A (Nico), Crew B (Jose) and Crew C
 * (Diego) each cut their own zone, so each crew has its own open lot and a
 * zone scan closes only THAT crew's previous lot.
 *
 * The crew is ASKED on every zone scan — three big buttons — and never
 * remembered on the phone. A remembered tag is what lost loads in September
 * (the 2026-09-28 one-crew build replaced it): a second, untagged phone kept
 * scanning signs, and every trailer cut under its sessions saved with no lot.
 * An unpicked crew writes nothing.
 *
 * Trailers follow their crew. On a crew's first zone scan of the day the lead
 * names its trailers and how many cutters, drivers and water spiders it has
 * (harvest_crew_day, migration 0042); after that a driver's scan of /t/3 goes
 * to the open lot of whichever crew has T3 today.
 *
 * Old sessions keep whatever crew they were written with. Pre-September 'A'
 * and 'B' meant the retired phone tags, not Nico's and Jose's crews.
 */
const CREWS = [
  { id: 'A', lead: 'Nico' },
  { id: 'B', lead: 'Jose' },
  { id: 'C', lead: 'Diego' },
];
const crewById = (raw) => CREWS.find(c => c.id === String(raw ?? '').trim().toUpperCase()) || null;
/** "Cuadrilla A · Nico" on screen. */
const crewLabel = (ui, id) => {
  const c = crewById(id);
  return c ? ui.t('crewName', { c: c.id, lead: c.lead }) : String(id ?? '?');
};
/** "Crew A (Nico)" in Telegram, which is read in English. */
const crewTg = (id) => { const c = crewById(id); return c ? `Crew ${c.id} (${c.lead})` : 'no crew'; };

/**
 * The people a crew starts the day with, asked ONCE on its first zone scan as
 * tap buttons (Koa, 2026-10-03: cutters usually 4-10, water spiders and drivers
 * usually 1-3). The buttons run a little past the usual range each way; the
 * min/max are the server's guard. Changes through the day come in on the
 * hourly report, not here, so the crew card only edits trailers.
 */
const CREW_DAY_FIELDS = [
  { key: 'cutters', label: 'crewCutters', min: 1, max: 20, buttons: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { key: 'water_spiders', label: 'crewWS', min: 0, max: 10, buttons: [0, 1, 2, 3, 4] },
  { key: 'drivers', label: 'crewDrivers', min: 0, max: 10, buttons: [1, 2, 3, 4, 5] },
];

const CREW_COOKIE_CLEAR = 'rf_crew=; Path=/; Max-Age=0; SameSite=Lax';

/**
 * Barn intake doors, PUBLIC_BASE/b/1 and /b/2. A fallback since trailers carry
 * their own QR (a torn decal, a dead phone): the door number is shown on the
 * screen so two identical tablets are not two chances to log at the wrong one,
 * and nothing else hangs off it.
 */
const STATIONS = [1, 2];

function pickStation(request, body = {}) {
  const url = new URL(request.url);
  const fromPath = (url.pathname.match(/^\/b\/(\d+)/) || [])[1];
  const raw = fromPath ?? body.station ?? url.searchParams.get('station')
    ?? ((request.headers.get('cookie') || '').match(/(?:^|;\s*)rf_barn=(\d+)/) || [])[1];
  const n = parseInt(raw, 10);
  return STATIONS.includes(n) ? n : null;
}

/**
 * Trailers, PUBLIC_BASE/t/1 .. /t/6. Each carries its own QR decal, and the
 * DRIVER scans it on drop-off — the trailer, not a door or a crew, is the fact
 * that arrives at the barn. Stored as the bare number; shown as "T3".
 */
const TRAILERS = [1, 2, 3, 4, 5, 6];
const trailerName = (n) => `T${n}`;

/*
 * NO COOLDOWN, NO DOUBLE-SCAN FLAG (Koa, 2026-09-29). A 5-minute block on
 * rescanning a decal refused real trailers and sent the crew back to the barn
 * tablet on the first morning; the amber "double scan?" warning that replaced
 * it was dropped the same day — Koa checks the data for doubles instead. Every
 * scan logs, and every receipt is the green one.
 */

/** A receipt this new is the scan landing: show the full-screen confirmation. */
const LOGGED_FLASH_FRESH_MS = 30 * 1000;

function parseTrailer(raw) {
  // The whole value, not a prefix of it: parseInt would read /t/1abc as T1, so
  // a mangled QR would still log — to a trailer nobody chose.
  const m = String(raw ?? '').trim().match(/^t?([1-9]\d?)$/i);
  const n = m ? Number(m[1]) : NaN;
  return TRAILERS.includes(n) ? n : null;
}

function stationCookie(station) {
  return `rf_barn=${station}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

const HTML_ACTIONS = new Set(['salida', 
  'enter', 'headcount', 'crew_day', 'cultivar_fix', 'barn_intake', 'barn_log', 'trailer_log', 'trailer_done', 'trailer_fix', 'trailer_again', 'cut_change',
  'sack_print', 'sack_session_start', 'sack_session', 'lot_resume', 'sack_label', 'sack_weigh',
  'crew', 'crew_set', 'bajada', 'bajada_set', 'sack_note', 'sack_note_edit', 'sack_store', 'sack_fill', 'find', 'sack_open', 'print_codes', 'harvest_dash',
  'lot_finish', 'bay_finish', 'hub', 'reconcile_page', 'pipeline',
]);

/** GET /c/A — the crew card. Its own entry point, like the zone and barn scans. */
export async function handleCrewScan(request, env, ctx) {
  env = await withSettings(env);
  const ui = makeUi(request, env);
  try {
    return await handleCrewTag(ui, request);
  } catch (e) {
    // An HTML page, not a JSON error: this is reached by a phone camera, and
    // the crew lead needs to see that the card did not take.
    const { message, status } = formatError(e);
    return errorPage(ui, message, status);
  }
}

export async function handleHarvestD1(request, env, ctx) {
  const body = request.method === 'POST' ? await parseBody(request) : {};
  const action = getAction(request, body);
  if (action === 'practice') return practicePage(pickLang(request));
  env = await withSettings(env);
  const params = getQueryParams(request);
  const db = env.DB;
  const ui = makeUi(request, env);

  // The lot stage board is its own module (D1-backed, password-gated) so this
  // file doesn't grow another 400 lines. See harvest-board-d1.js.
  if (SACK_OUT_ACTIONS.has(action)) {
    return await handleSackOutAction(action, { request, env, ctx, db, ui, body, params }, SACK_OUT_DEPS);
  }

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
        case 'crew_day':
          return await handleCrewDay(ui, db, env, ctx, request.method === 'POST' ? body : params, request.method);
        case 'cut_change':
          return await handleCutChange(ui, db, env, ctx, body, request.method);
        case 'cultivar_fix':
          return await handleCultivarFix(ui, db, env, ctx, params);
        case 'barn_intake':
          return await handleBarnIntakeForm(ui, db, env, ctx, pickStation(request, body));
        case 'barn_log':
          return await handleBarnLog(ui, db, env, ctx, body, pickStation(request, body));
        case 'trailer_log':
          return await handleTrailerLog(ui, db, env, ctx, body);
        case 'trailer_done':
          return await handleTrailerDone(ui, db, env, params);
        case 'trailer_fix':
          return await handleTrailerFix(ui, db, env, ctx, body);
        case 'trailer_again':
          return await handleTrailerAgain(ui, db, env, ctx, body, request.method);
        case 'harvest_dash':
          // The shell only. It ships zero harvest data and fetches everything
          // after the operator types the password, the same way the lot board
          // does — so the public HTML never carries the season's numbers.
          return dashPage();
        case 'salida': {
          const today = await sackOutToday(db, env, {}, SACK_OUT_DEPS);
          return renderPage(ui, ui.lang === 'es' ? 'Salida de bolsas' : 'Sack scan-out',
            salidaPageBody(ui, { api: '/api/harvest', lang: ui.lang, is_test: isTestMode(env), today }));
        }
        case 'reconcile_page':
          return renderPage(ui, ui.lang === 'es' ? 'Inventario' : 'Inventory comparison', reconcileBody(ui));
        case 'hub':
          return renderPage(ui, ui.lang === 'es' ? 'Herramientas de cosecha' : 'Harvest tools', hubBody(ui));
        case 'print_codes':
          return renderPage(ui, ui.t('printCodes'), codeSheetBody(ui, params.packet), 200);
        case 'sack_print':
          return await handleSackPrintForm(ui, db, env);
        case 'pipeline':
          return await handlePipeline(ui, db, env);
        case 'sack_session_start':
          return await handleSackSession(ui, db, env, body);
        case 'sack_session':
          return await handleSackSession(ui, db, env, params);
        case 'lot_resume':
          return await handleLotResume(ui, db, env, params);
        case 'lot_finish':
          return await handleLotFinish(ui, db, env, ctx, body);
        case 'bay_finish':
          return await handleBayFinish(ui, db, env, ctx, body);
        case 'sack_label':
          return await handleSackLabel(ui, db, env, params);
        case 'sack_weigh':
          return await handleSackWeigh(ui, db, env, ctx, body);
        case 'crew': {
          const isTest = isTestMode(env) ? 1 : 0;
          const data = await loadCrewHourly(db, env, params, isTest);
          return renderPage(ui, ui.t('crew'), crewHourlyBody(ui, data));
        }
        case 'crew_set': {
          const isTest = isTestMode(env) ? 1 : 0;
          const saved = await submitCrewHourly(db, env, body, isTest);
          const data = await loadCrewHourly(db, env, { barn: saved.row.barn, hour: saved.row.hour_start }, isTest);
          const flash = ui.lang === 'es'
            ? `Guardado ${saved.row.hour_start} · ${saved.row.barn === 'upper' ? 'Arriba' : 'Abajo'}`
            : `Saved ${saved.row.hour_start} · ${saved.row.barn === 'upper' ? 'Upper' : 'Bottom'}`;
          return renderPage(ui, ui.t('crew'), crewHourlyBody(ui, data, flash));
        }
        case 'bajada': {
          const isTest = isTestMode(env) ? 1 : 0;
          const data = await loadTakedownHourly(db, env, params, isTest);
          return renderPage(ui, ui.lang === 'es' ? 'Bajada por hora' : 'Hourly takedown', takedownHourlyBody(ui, data));
        }
        case 'bajada_set': {
          const isTest = isTestMode(env) ? 1 : 0;
          const saved = await submitTakedownHourly(db, env, body, isTest);
          const data = await loadTakedownHourly(db, env, { hour: saved.row.hour_start }, isTest);
          const flash = `${ui.lang === 'es' ? 'Guardado' : 'Saved'} ${saved.row.hour_start}`;
          return renderPage(ui, ui.lang === 'es' ? 'Bajada por hora' : 'Hourly takedown', takedownHourlyBody(ui, data, flash));
        }
        case 'sack_note':
          return await handleSackNote(ui, db, env, ctx, body);
        case 'sack_note_edit':
          return await handleSackNoteEdit(ui, db, env, ctx, body);
        case 'sack_fill':
          return await handleSackFill(ui, db, env, ctx, body);
        case 'sack_store':
          return await handleSackStore(ui, db, env, ctx, body);
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
      return await getRollup(request, db, env, params, body);
    case 'harvest_metrics':
      return await getMetrics(request, db, env, params, body);
    case 'provenance':
      return await getProvenance(db, env, params);
    case 'reconcile':
      return await getReconcile(db, env, params);
    case 'allocate':
      return await handleAllocate(db, env, params);
    case 'day_end':
      return await handleDayEnd(ui, db, env, ctx, params.crew);

    case 'sack_alloc':
      return await handleSackAlloc(db, env, ctx, body);
    case 'print_pull':
      return await handlePrintPull(db, env, body);
    case 'print_ack':
      return await handlePrintAck(db, env, body);
    case 'print_heartbeat':
      return await handlePrintHeartbeat(db, env, body);
    case 'print_status':
      return await handlePrintStatus(db);
    case 'print_reprint':
      return await handlePrintReprint(db, env, body);
    case 'print_check':
      return await handlePrintCheck(db, body);
    case 'test_mode':
      return await handleTestMode(request, db, env, body);
    case 'inventory_sweep':
      return await handleInventorySweep(request, db, env, ctx, body, params);
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
  env = await withSettings(env);
  const ui = makeUi(request, env);
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
    if (picked) params.cultivar = picked;
    if (url.searchParams.get('crew')) params.crew = url.searchParams.get('crew');

    // One set of rules, in handleEnter: a trial / split zone with no pick gets
    // the picker back (one sign per zone beats a separate QR per cultivar — no
    // wrong code to scan), a single-cultivar zone auto-fills, and a cultivar
    // that isn't planted here is refused. They used to live in both places.
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
/**
 * `/fin` — the end-of-day card. Its own short path for the same reason the
 * others have one: it is laminated for a season, and a shorter URL is a
 * lower-version QR with bigger modules.
 */
export async function handleDayEndScan(request, env, ctx) {
  env = await withSettings(env);
  const ui = makeUi(request, env);
  try {
    return await handleDayEnd(ui, env.DB, env, ctx, new URL(request.url).searchParams.get('crew'));
  } catch (e) {
    const { message, status } = formatError(e);
    return errorPage(ui, message, status);
  }
}

export async function handleBarnScan(request, env, ctx) {
  env = await withSettings(env);
  const ui = makeUi(request, env);
  try {
    const station = pickStation(request);
    const res = await handleBarnIntakeForm(ui, env.DB, env, ctx, station);
    // Remember the door, so the tablet at station 2 stays station 2 whether it
    // was reached by the QR, a bookmark, or the "log another" link.
    if (station) res.headers.append('Set-Cookie', stationCookie(station));
    return res;
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
  env = await withSettings(env);
  const ui = makeUi(request, env);
  try {
    const url = new URL(request.url);
    const sackId = url.pathname.replace(/^\/s\//, '').trim();
    // REAL FIRST. The example tags carry real bag numbers, so the only thing
    // stopping a genuine bag from being shadowed by invented weights is that
    // nothing consults the examples until the lookup has already missed.
    const view = await getSackView(env.DB, sackId);
    if (view) {
      return renderPage(ui, `${ui.t('sack')} ${view.sack.sack_id}`, sackDetailBody(ui, view));
    }
    const demo = demoKey(sackId);
    if (demo) {
      const dv = demoSackView(url.searchParams.get('opened') === '1',
                              url.searchParams.get('voided') === '1', demo);
      return renderPage(ui, `${ui.t('sack')} ${demo}`,
        demoBanner(ui, url, null, demo) + sackDetailBody(ui, dv));
    }
    return errorPage(ui, ui.t('noSackCheck', { id: sackId }), 404);
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

/**
 * Test mode is a setting the farm can flip, falling back to the deployed value.
 *
 * Read once per request and hung on a copy of env, so every isTestMode(env)
 * below stays synchronous — the alternative was threading a promise through
 * about forty call sites for a flag that changes twice a season.
 *
 * Cached for a few seconds per isolate: the crew screens poll, and a flip that
 * takes a few seconds to reach a phone is not worth a database read on every
 * scan. An unreadable settings table is not an emergency — the deployed value
 * stands, which is the behaviour this had before the table existed.
 */
let testFlagCache = { at: 0, value: null };
const TEST_FLAG_TTL_MS = 5000;

async function withSettings(env) {
  // A PREVIEW build — uploaded with `wrangler versions upload --var
  // HARVEST_FORCE_TEST:true`, reached on its own preview URL while the live
  // worker keeps serving the floor — is pinned to test mode whatever the
  // farm's switch says, and posts nothing to Telegram. The shared switch lives
  // in the same database the live worker reads, so trying a new build on real
  // phones must neither obey it (and write real rows) nor move it (see
  // handleTestMode), nor post into the floor's chat. Koa, 2026-09-28.
  if (isPreviewBuild(env)) return { ...env, HARVEST_TEST_MODE: 'true', TELEGRAM_TEST_CHAT_ID: '' };
  if (!env?.DB) return env;
  const now = Date.now();
  if (now - testFlagCache.at > TEST_FLAG_TTL_MS) {
    try {
      const row = await queryOne(env.DB, `SELECT value FROM harvest_settings WHERE key = 'test_mode'`);
      testFlagCache = { at: now, value: row ? String(row.value) : null };
    } catch { testFlagCache = { at: now, value: null }; }
  }
  if (testFlagCache.value === null) return env;
  return { ...env, HARVEST_TEST_MODE: testFlagCache.value === 'true' ? 'true' : 'false' };
}

function isPreviewBuild(env) {
  return env?.HARVEST_FORCE_TEST === 'true';
}

/** Flip it, and let the next request on every isolate see the change. */
async function setTestMode(db, on, who) {
  await execute(db, `
    INSERT INTO harvest_settings (key, value, updated_at, updated_by)
    VALUES ('test_mode', ?, datetime('now'), ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
  `, [on ? 'true' : 'false', who || null]);
  testFlagCache = { at: 0, value: null };
}

function getSeason() {
  return new Date().getUTCFullYear();
}

/** Which barn a bay is in. Null for anything outside 1-12. */
function barnForBay(bay) {
  const n = Number(bay);
  if (!Number.isInteger(n) || n < BAY_MIN || n > BAY_MAX) return null;
  return n <= BOTTOM_BARN_LAST_BAY ? 'bottom' : 'top';
}

/**
 * Parse a bay from user input. Absent is null; invalid throws.
 *
 * Never coerced or clamped: the bay prints on the tag, so a silently-corrected
 * value gets tied to a physical sack and read as fact months later. `ui` is
 * optional because the JSON path has no translator — the crew never sees that
 * message, only the operator's console does.
 */
function parseBay(raw, ui = null) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const n = parseInt(raw, 10);
  if (!barnForBay(n)) {
    throw createError('VALIDATION_ERROR', ui
      ? ui.t('bayRange', { min: BAY_MIN, max: BAY_MAX })
      : `Bay must be between ${BAY_MIN} and ${BAY_MAX}.`);
  }
  return n;
}

/**
 * The bay the last tagged sack came out of.
 *
 * The picker defaults to this because the crew fills roughly one bay a day, so
 * a bay sees several takedowns and the common case is confirming the same one
 * rather than choosing a new one.
 */
async function getLastBay(db, isTest) {
  const row = await queryOne(db, `
    SELECT bay FROM harvest_sacks
    WHERE bay IS NOT NULL AND is_test = ? ORDER BY id DESC LIMIT 1
  `, [isTest]);
  return row ? row.bay : null;
}

/**
 * Where a sack is kept between takedown and opening: one of the bays, or the
 * Supermarket below the barns (Koa, 2026-09-10).
 *
 * ONE TEXT COLUMN, TWO SHAPES, ONE DOOR IN. Bays are stored as bare digits so a
 * later CAST(storage AS INTEGER) still works; the Supermarket is stored with
 * exactly that casing. Every write comes through here, so "supermarket" off a
 * phone keyboard and "Supermarket" off the picker can never become two buckets
 * in anything that groups on it.
 *
 * Refused rather than coerced, for the reason parseBay gives: a location read
 * off the scan page is taken as fact by whoever goes looking for the sack.
 */
const SUPERMARKET = 'Supermarket';

function parseStorage(raw, ui = null) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const s = String(raw).trim();
  if (s.toLowerCase() === SUPERMARKET.toLowerCase()) return SUPERMARKET;
  if (/^\d+$/.test(s) && barnForBay(parseInt(s, 10))) return String(parseInt(s, 10));
  throw createError('VALIDATION_ERROR', ui
    ? ui.t('storageInvalid', { min: BAY_MIN, max: BAY_MAX })
    : `Storage must be a bay from ${BAY_MIN} to ${BAY_MAX}, or the ${SUPERMARKET}.`);
}

/** The one way a stored location is read back out. Null in, null out. */
function storageLabel(ui, storage) {
  if (storage === null || storage === undefined || storage === '') return null;
  return storage === SUPERMARKET ? SUPERMARKET : ui.t('bayN', { n: storage });
}

/**
 * The last storage used, and whether it was used TODAY (Pacific).
 *
 * Only a same-day answer is pre-selected. Yesterday's rack going to the
 * Supermarket says nothing about where today's goes, and a carried-over place
 * arrives on the form looking like a decision nobody made — the same trap the
 * intake bay names with bayStale. A stale one is named in the hint instead,
 * and the picker starts at "Not yet".
 */
async function getLastStorage(db, isTest) {
  const row = await queryOne(db, `
    SELECT storage, printed_at FROM harvest_sacks
    WHERE storage IS NOT NULL AND is_test = ? ORDER BY id DESC LIMIT 1
  `, [isTest]);
  if (!row) return null;
  const today = !!row.printed_at && pacificDay(parseSqliteUtc(row.printed_at)) === pacificToday();
  return { storage: row.storage, today };
}

/**
 * The bay the last trailer was hung into, and when.
 *
 * NOT `getLastBay()`. That one reads the last bay a sack came OUT of, which is
 * the takedown question; this is the fill question, and mid-season the two are
 * routinely different bays — one crew is hanging bay 9 while the other is
 * pulling bay 3.
 *
 * BARN-WIDE, for trailers and the door alike (Koa, 2026-09-29: "once a bay is
 * changed, all trailers update to the newest bay"). The first day live the
 * barn moved from bay 10 to 9 mid-morning and each trailer kept logging its
 * OWN last bay, 10, until someone fixed that trailer's receipt — nobody does,
 * the floor moves too fast. Now the newest load's bay is everyone's default:
 * one load logged (or one receipt fixed) into bay 9 moves every trailer.
 */
async function getLastFilledBay(db, isTest) {
  return await queryOne(db, `
    SELECT bay, occurred_at FROM harvest_scan_log
    WHERE event_type = 'barn_load' AND bay IS NOT NULL AND is_test = ?
    ORDER BY occurred_at DESC, id DESC LIMIT 1
  `, [isTest]);
}

// SQLite's datetime('now') returns "YYYY-MM-DD HH:MM:SS" (UTC, no offset).
function parseSqliteUtc(ts) {
  return new Date(ts.replace(' ', 'T') + 'Z');
}

/**
 * The civil date in Pacific, 'YYYY-MM-DD'. Same approach as the production
 * handlers: let Intl carry the DST rules rather than an offset that is right
 * for half of harvest and wrong for the other half — the season runs across the
 * November change.
 *
 * Needed because timestamps are stored UTC, where a perfectly ordinary
 * afternoon of cutting (2pm-5pm Pacific) already crosses midnight.
 */
const HARVEST_TZ = 'America/Los_Angeles';
function pacificDay(date) {
  return date.toLocaleDateString('en-CA', { timeZone: HARVEST_TZ });
}

/** SQLite's own timestamp text, "YYYY-MM-DD HH:MM:SS", always UTC. */
function sqliteUtc(d) {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * The zone's UTC offset at a given instant, DST and all.
 *
 * `sv-SE` formats as "YYYY-MM-DD HH:MM:SS"; reading that wall time back as if
 * it were UTC and subtracting the real instant leaves exactly the offset. Let
 * Intl carry the rules rather than hard-coding -7 or -8, either of which is
 * wrong for part of a season that runs across the November change.
 */
function pacificOffsetMs(at) {
  const wall = at.toLocaleString('sv-SE', { timeZone: HARVEST_TZ });
  return Date.parse(wall.replace(' ', 'T') + 'Z') - at.getTime();
}

/**
 * The half-open UTC range [start, end) covering one Pacific civil day.
 *
 * `date(occurred_at) = '2026-10-14'` asks SQLite for a UTC day, and the barn's
 * day is not a UTC day: 5pm Pacific is already tomorrow in UTC (4pm once the
 * clocks go back). Every "today" in this file used to split mid-afternoon —
 * the load counter reset while trailers were still arriving, and allocation
 * paired a sack opened after 5pm with the NEXT day's floor weights, which is
 * silent and unrecoverable.
 *
 * The offset is measured ONCE PER END. Measuring it once and applying it to
 * both is the real DST bug: on 1 November the day opens in PDT and closes in
 * PST, so a single offset makes a 25-hour day look like 24 and drops an hour
 * of the barn's evening into the wrong day. Three tests cover that.
 *
 * Each end then re-measures at its own corrected instant. That second pass is
 * unreachable for America/Los_Angeles — the changeover is at 2am local, so
 * local midnight is always hours clear of it and the first probe is already
 * right (a mutation test confirms removing it changes nothing today). It stays
 * because it is two lines, and because it is the only thing keeping this
 * function from silently depending on where in the day HARVEST_TZ happens to
 * move its clocks.
 */
export function pacificDayRange(day) {
  const at = (wallMs) => {
    let t = wallMs - pacificOffsetMs(new Date(wallMs));
    return wallMs - pacificOffsetMs(new Date(t));
  };
  const wall = Date.parse(day + 'T00:00:00Z');
  return [sqliteUtc(new Date(at(wall))), sqliteUtc(new Date(at(wall + 86400000)))];
}

/** Today, as the barn means it. */
function pacificToday() {
  return pacificDay(new Date());
}

/**
 * Inventory bookkeeping that survives its own failure.
 *
 * A tag's +1 and a void's -1 both run in waitUntil, after the crew already has
 * their answer, against a Google Apps Script that can return an HTML error page
 * or simply never answer. Three states have to stay apart afterwards, because
 * the only way to tell them apart later is what the row says:
 *
 *   counted   shopify_added_at set,   no error        — Shopify holds the +1
 *   failed    marker unchanged,       error recorded  — safe to retry
 *   unknown   marker unchanged,       IN_FLIGHT       — started, never answered
 *
 * IN_FLIGHT is written BEFORE the call, which is the whole trick: a background
 * job that dies mid-call writes nothing, so without a mark laid down first it
 * is indistinguishable from one that never ran. On 2026-09-22 that cost an hour
 * of picking through rows to work out which tags Shopify still counted.
 *
 * An unknown row is NOT retried automatically. The script may have applied the
 * change and failed on the way back; replaying that subtracts twice, and a
 * double subtraction reads exactly like an honest count.
 */
// IN_FLIGHT / inFlight now live in lib/inventory-debt.js, so the sweep and the
// screens cannot drift on what 'unknown' means. See that file for the why.

/** A query-string or JSON flag: `?apply=1`, `{ apply: true }`, `apply=yes`. */
const truthy = (v) => v === true || v === 1 || /^(1|true|yes|on)$/i.test(String(v ?? ''));


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
  const now = new Date();

  // Which crew, before anything else, and never guessed: an unpicked crew gets
  // the three buttons back and writes nothing. See CREWS.
  const crewRaw = String(params.crew ?? '').trim();
  const crew = crewById(crewRaw);
  if (crewRaw && !crew) throw createError('VALIDATION_ERROR', ui.t('crewBad', { c: crewRaw }));
  if (!crew) {
    return renderPage(ui, zone, crewPickerBody(ui, zone, params));
  }
  const active = await getActiveSession(db, isTest, crew.id);

  // Cultivar comes from the picker (multi-cultivar zones) or auto-fills from
  // the planting record. A lot is zone x cultivar x cut throughout.
  //
  // NEVER GUESS IN A ZONE THAT HOLDS MORE THAN ONE. This used to fall back to
  // the first name on the zone's list, which is only ever right by luck: a lot
  // is zone x cultivar x cut, so a guessed cultivar is a guessed lot, and every
  // sack hung off it inherits the guess under a plausible-looking name. The
  // scan path asks already; this guard is for ?action=enter, which reaches this
  // function with whatever the query string happened to carry. Asking again
  // costs a tap. Guessing costs a lot nobody can tell apart from a real one.
  const options = cultivarsFor(zone);
  const picked = String(params.cultivar ?? '').trim();
  if (picked && !options.includes(picked)) {
    throw createError('VALIDATION_ERROR', ui.t('notPlantedHere', { cv: picked, zone }));
  }
  if (!picked && isMultiCultivar(zone)) {
    return renderPage(ui, zone, cultivarPickerBody(ui, zone, options, crew.id));
  }
  const cultivar = picked || options[0] || null;

  // The crew's first zone of the day asks for its trailers and people first.
  // Writes nothing: the form's POST saves them and then opens the lot here.
  const crewDay = await getCrewDay(db, isTest, crew.id);
  if (!crewDay) {
    const [last, today] = await Promise.all([
      getLastCrewDay(db, isTest, crew.id), getCrewDays(db, isTest)]);
    return renderPage(ui, crewLabel(ui, crew.id), crewDayFormBody(ui, {
      crew: crew.id, zone, cultivar, testCut: params.test_cut, prefill: last, today,
    }));
  }

  // Idempotency guard: a phone refresh/back-button/link-preview re-hitting
  // the same zone's URL moments later shouldn't open a second session. Keyed on
  // cultivar too, so switching cultivar inside one trial zone still opens a new
  // lot rather than being swallowed as a duplicate scan.
  if (active && active.zone === zone && active.cultivar === cultivar &&
      (now - parseSqliteUtc(active.occurred_at)) < DEBOUNCE_MS) {
    return renderPage(ui, ui.t('alreadyEntered', { zone }), alreadyEnteredBody(ui, active, crewDay));
  }

  // THIS crew's open lots only — the other two crews are still cutting theirs.
  // Lots from the one-crew days (no crew) close too, so the first scans after
  // the three-crew build leave no orphan open.
  await closeOpenSessions(db, isTest, crew.id);

  const cutNumber = await computeCutNumber(db, zone, cultivar, season, isTest, params.test_cut);
  // How long since this lot was last worked — only to decide whether the "new
  // cut?" question opens unfolded. Read before the INSERT, after the close.
  const lastHere = await getLastClosedSession(db, zone, cultivar, season, isTest);
  const daysIdle = lastHere
    ? (Date.now() - parseSqliteUtc(lastHere.closed_at).getTime()) / 86400000 : null;

  // The crew's cutters ride on the lot from the day's form, so person-hours
  // and the hourly cross-check read them without another tap.
  const cutters = crewDay.cutters ?? null;
  const result = await execute(db, `
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, crew, headcount, headcount_at, is_test)
    VALUES ('enter', ?, ?, ?, ?, ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END, ?)
  `, [zone, cultivar, season, cutNumber, crew.id, cutters, cutters, isTest]);
  const sessionId = result.lastRowId;

  const prevNote = active
    ? `Previous lot *${active.zone}${active.cultivar ? ` ${active.cultivar}` : ''}* auto-closed.`
    : 'No prior zone was open for this crew.';
  ctx.waitUntil(sendTelegramMessage(env, {
    chatId: env.TELEGRAM_TEST_CHAT_ID,
    text: `🌿 ${crewTg(crew.id)} entered *${zone}*${cultivar ? ` — ${cultivar}` : ''} — Cut ${cutNumber}\n${prevNote}`,
  }).catch(e => console.error('[harvest][telegram]', e)));

  return renderPage(ui, ui.t('entered', { zone }), enterBody(ui, {
    zone, cultivar, cutNumber, sessionId, crew: crew.id, crewDay,
    prevZone: active ? `${active.zone}${active.cultivar ? ` ${active.cultivar}` : ''}` : null,
    daysIdle,
  }));
}

/**
 * The open lot — of one crew, or (no crew) the newest anywhere. Each crew has
 * at most one; the newest wins if old data holds two.
 */
async function getActiveSession(db, isTest, crew = null) {
  return queryOne(db, `
    SELECT * FROM harvest_scan_log
    WHERE event_type = 'enter' AND closed_at IS NULL AND is_test = ? ${crew ? 'AND crew = ?' : ''}
    ORDER BY occurred_at DESC, id DESC LIMIT 1
  `, crew ? [isTest, crew] : [isTest]);
}

/**
 * Close open lots. With a crew: that crew's, plus any from the one-crew days
 * (no crew), which belong to nobody now and would otherwise stay open forever.
 * Without: every open lot. Returns how many it closed.
 */
async function closeOpenSessions(db, isTest, crew = null) {
  const r = await execute(db, `
    UPDATE harvest_scan_log SET closed_at = datetime('now')
    WHERE event_type = 'enter' AND closed_at IS NULL AND is_test = ?
      ${crew ? 'AND (crew = ? OR crew IS NULL)' : ''}
  `, crew ? [isTest, crew] : [isTest]);
  return r.changes || 0;
}

// ─── CREW DAY (trailers + people, once per crew per day) ─

/** Today's row for one crew, or null. Pacific day. */
async function getCrewDay(db, isTest, crew, day = pacificDay(new Date())) {
  return queryOne(db, `
    SELECT * FROM harvest_crew_day WHERE harvest_date = ? AND crew = ? AND is_test = ?
  `, [day, crew, isTest]);
}

/** Every crew's row for a day. */
async function getCrewDays(db, isTest, day = pacificDay(new Date())) {
  return query(db, `
    SELECT * FROM harvest_crew_day WHERE harvest_date = ? AND is_test = ? ORDER BY crew
  `, [day, isTest]);
}

/** The crew's most recent earlier day — only to prefill the form. */
async function getLastCrewDay(db, isTest, crew) {
  return queryOne(db, `
    SELECT * FROM harvest_crew_day WHERE crew = ? AND is_test = ? AND harvest_date < ?
    ORDER BY harvest_date DESC LIMIT 1
  `, [crew, isTest, pacificDay(new Date())]);
}

/** Today's crew row for a lot's crew, or null (a lot with no crew has none). */
async function crewDayFor(db, session) {
  if (!crewById(session.crew)) return null;
  return getCrewDay(db, Number(session.is_test) ? 1 : 0, session.crew);
}

/** '3,4' -> [3, 4]; anything that is not a trailer is dropped. */
function trailerList(s) {
  return String(s ?? '').split(',').map(x => parseTrailer(x)).filter(Boolean);
}

/** Which crew has this trailer today, or null. */
async function crewForTrailer(db, isTest, trailer) {
  const rows = await getCrewDays(db, isTest);
  const hit = rows.find(r => trailerList(r.trailers).includes(trailer));
  return hit ? hit.crew : null;
}

/** One whole number in a field's range, or a thrown range error. */
function parseCount(raw, f, ui) {
  const s = String(raw ?? '').trim();
  const n = parseInt(s, 10);
  if (!Number.isInteger(n) || String(n) !== s || n < f.min || n > f.max) {
    throw createError('VALIDATION_ERROR', ui.t('crewDayRange', { role: ui.t(f.label), min: f.min, max: f.max }));
  }
  return n;
}

/**
 * GET: the crew-day form in edit mode (from the zone screen's "change" link).
 * POST: save the crew's trailers and people for today. A trailer assigned here
 * comes OFF any other crew that had it today — a trailer runs for one crew.
 *
 * Two ways in. From the first zone scan (zone, no session_id): save, then open
 * the lot exactly as the scan would have. From the zone screen (session_id):
 * save, move that open lot's cutter count with it, and show the zone screen.
 */
async function handleCrewDay(ui, db, env, ctx, input, method) {
  const isTest = isTestMode(env) ? 1 : 0;
  const crew = crewById(input.crew);
  if (!crew) throw createError('VALIDATION_ERROR', ui.t('crewBad', { c: input.crew ?? '' }));
  const sessionId = parseInt(input.session_id, 10);
  const editing = Number.isInteger(sessionId) && sessionId > 0;
  const session = editing ? await queryOne(db, `
    SELECT * FROM harvest_scan_log
    WHERE id = ? AND event_type = 'enter' AND crew = ? AND closed_at IS NULL AND is_test = ?
  `, [sessionId, crew.id, isTest]) : null;
  if (editing && !session) throw createError('VALIDATION_ERROR', ui.t('crewDayLotGone'));

  if (method !== 'POST') {
    if (!editing) throw createError('VALIDATION_ERROR', ui.t('crewDayPost'));
    const [mine, today] = await Promise.all([getCrewDay(db, isTest, crew.id), getCrewDays(db, isTest)]);
    return renderPage(ui, crewLabel(ui, crew.id), crewDayFormBody(ui, {
      crew: crew.id, zone: session.zone, cultivar: session.cultivar, sessionId, prefill: mine, today, editing: true,
    }));
  }

  const day = pacificDay(new Date());
  const others = (await getCrewDays(db, isTest, day)).filter(r => r.crew !== crew.id);
  const mine = await getCrewDay(db, isTest, crew.id, day);

  // Trailers: the ones ticked, or — none ticked — the crew's last assignment
  // (Koa, 2026-10-03). Today's row when editing; otherwise its last day, less
  // any trailer another crew has already claimed today: not ticking must never
  // take a trailer off someone else.
  let trailers = TRAILERS.filter(n => truthy(input[`t${n}`]));
  if (!trailers.length) {
    const claimed = new Set(others.flatMap(r => trailerList(r.trailers)));
    const last = mine || await getLastCrewDay(db, isTest, crew.id);
    trailers = last ? trailerList(last.trailers).filter(n => !claimed.has(n)) : [];
  }
  if (!trailers.length) throw createError('VALIDATION_ERROR', ui.t('crewDayPickTrailer'));

  // The people are set once, on the first scan; an edit from the crew card
  // changes trailers only and keeps them.
  const counts = {};
  for (const f of CREW_DAY_FIELDS) {
    counts[f.key] = editing && mine ? mine[f.key] : parseCount(input[f.key], f, ui);
  }

  const list = trailers.join(',');
  // Take these trailers off every other crew first, then write this crew's row.
  const moved = [];
  const stmts = [];
  for (const r of others) {
    const had = trailerList(r.trailers);
    const keep = had.filter(n => !trailers.includes(n));
    if (keep.length !== had.length) {
      had.filter(n => trailers.includes(n)).forEach(n => moved.push(`${trailerName(n)} from ${crewTg(r.crew)}`));
      stmts.push(db.prepare(`UPDATE harvest_crew_day SET trailers = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(keep.join(','), r.id));
    }
  }
  stmts.push(db.prepare(`
    INSERT INTO harvest_crew_day (harvest_date, crew, trailers, cutters, drivers, water_spiders, is_test)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (harvest_date, crew, is_test) DO UPDATE SET
      trailers = excluded.trailers, cutters = excluded.cutters, drivers = excluded.drivers,
      water_spiders = excluded.water_spiders, updated_at = datetime('now')
  `).bind(day, crew.id, list, counts.cutters, counts.drivers, counts.water_spiders, isTest));
  if (session) {
    stmts.push(db.prepare(`UPDATE harvest_scan_log SET headcount = ?, headcount_at = datetime('now') WHERE id = ?`)
      .bind(counts.cutters, session.id));
  }
  await db.batch(stmts);

  ctx.waitUntil(sendTelegramMessage(env, {
    chatId: env.TELEGRAM_TEST_CHAT_ID,
    text: `👥 ${crewTg(crew.id)} today: ${trailers.map(trailerName).join(', ')} · ${counts.cutters} cutters`
      + ` · ${counts.drivers} drivers · ${counts.water_spiders} water spiders`
      + `${moved.length ? `\nMoved: ${moved.join('; ')}` : ''}`,
  }).catch(e => console.error('[harvest][telegram]', e)));

  if (session) {
    const crewDay = await getCrewDay(db, isTest, crew.id);
    return renderPage(ui, ui.t('entered', { zone: session.zone }), enterBody(ui, {
      zone: session.zone, cultivar: session.cultivar, cutNumber: session.cut_number, sessionId: session.id,
      crew: crew.id, crewDay, prevZone: null, flash: ui.t('crewDaySaved'),
    }));
  }
  return handleEnter(ui, db, env, ctx, {
    zone: input.zone, cultivar: input.cultivar, crew: crew.id, test_cut: input.test_cut,
  });
}

/** The open lot in one zone — what the fallback door needs once it knows the zone. */
async function getOpenSessionForZone(db, isTest, zone) {
  return queryOne(db, `
    SELECT * FROM harvest_scan_log
    WHERE event_type = 'enter' AND zone = ? AND closed_at IS NULL AND is_test = ?
    ORDER BY occurred_at DESC, id DESC LIMIT 1
  `, [zone, isTest]);
}

// The most recently closed session — for a given zone, or anywhere.
// Deliberately cultivar-agnostic: at the barn nobody knows which cultivar of a
// trial zone a load came off, and the closed session already carries it.
async function getLastClosedAnyCultivar(db, isTest, zone = null, crew = null) {
  const parts = ["event_type = 'enter'", 'closed_at IS NOT NULL'];
  const args = [];
  if (zone) { parts.push('zone = ?'); args.push(zone); }
  if (crew) { parts.push('crew = ?'); args.push(crew); }
  parts.push('is_test = ?'); args.push(isTest);
  return queryOne(db, `
    SELECT * FROM harvest_scan_log WHERE ${parts.join(' AND ')}
    ORDER BY closed_at DESC, id DESC LIMIT 1
  `, args);
}

// A session still inside the barn grace window (see lib/barn-attribution.js).
function inBarnGrace(session) {
  if (!session || !session.closed_at) return false;
  return withinBarnGrace(parseSqliteUtc(session.closed_at).getTime(), Date.now());
}

async function getLastClosedSession(db, zone, cultivar, season, isTest) {
  return queryOne(db, `
    SELECT * FROM harvest_scan_log
    WHERE event_type = 'enter' AND zone = ? AND cultivar IS ? AND season = ?
      AND closed_at IS NOT NULL AND is_test = ?
    ORDER BY closed_at DESC, id DESC LIMIT 1
  `, [zone, cultivar, season, isTest]);
}

// A ZONE CONTINUES ITS CUT. Re-entering a zone is the same cut, however long
// it has been — a zone takes days to cut, the crew closes it every night, and
// they leave for other zones and come back. A new cut starts only when a
// person says so (handleCutChange, from the zone screen).
//
// This replaced an 8-hour rule that started a new cut whenever a zone was
// re-entered more than 8 h after its last close. That was every morning: Z1,
// Z2 and Z11 each came up "cut 2" on their second day in 2026 (Koa,
// 2026-09-30: "this is still zone 11 cut 1"), and the number is printed on
// supersack tags.
//
// Keyed on (zone, cultivar): in a trial zone, Z10 "Lemon" cut 1 is independent
// of Z10 "Rocket Sauce" cut 1.
async function computeCutNumber(db, zone, cultivar, season, isTest, testCutParam) {
  const forced = parseInt(testCutParam, 10);
  if (Number.isInteger(forced) && forced >= 1 && forced <= 9) return forced;

  // Someone is already cutting this zone and cultivar — the second crew is
  // joining THAT cut, not starting a new one. Without this, crew B walking into
  // a zone crew A opened would read the last CLOSED session (a cut from weeks
  // ago), add one, and split one rack of plants across two lot numbers — a
  // number that ends up printed on a supersack tag.
  const concurrent = await queryOne(db, `
    SELECT cut_number FROM harvest_scan_log
    WHERE event_type = 'enter' AND zone = ? AND cultivar IS ? AND season = ?
      AND closed_at IS NULL AND is_test = ?
    ORDER BY occurred_at DESC, id DESC LIMIT 1
  `, [zone, cultivar, season, isTest]);
  if (concurrent) return concurrent.cut_number;

  const last = await getLastClosedSession(db, zone, cultivar, season, isTest);
  return last ? last.cut_number : 1;
}

/**
 * POST from the zone screen: this open lot is the NEXT cut (or, to undo a
 * mis-tap, the previous one). The only way a cut number moves.
 *
 * Refused once tags are printed off the lot, for the reason the cultivar fix
 * is: the tags carry the number. Loads already logged to the session move with
 * it — they were cut in this session, so they are the same cut it is.
 */
async function handleCutChange(ui, db, env, ctx, body, method) {
  if (method !== 'POST') throw createError('VALIDATION_ERROR', ui.t('cutChangePost'));
  const sessionId = parseInt(body.session_id, 10);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    throw createError('VALIDATION_ERROR', 'Missing or invalid session_id.');
  }
  const session = await queryOne(db, `SELECT * FROM harvest_scan_log WHERE id = ? AND event_type = 'enter'`, [sessionId]);
  if (!session) throw createError('NOT_FOUND', ui.t('noSessionFound', { id: sessionId }));
  refuseRealInTest(ui, env, session);
  if (session.closed_at) throw createError('VALIDATION_ERROR', ui.t('cutLotClosed'));

  const to = Number(session.cut_number) + (body.dir === 'prev' ? -1 : 1);
  if (to < 1 || to > 9) throw createError('VALIDATION_ERROR', ui.t('cutRange'));

  const tags = await queryOne(db, `
    SELECT COUNT(*) AS n FROM harvest_sacks WHERE zone_session_id = ? AND voided_at IS NULL
  `, [sessionId]);
  if (tags && tags.n > 0) throw createError('VALIDATION_ERROR', ui.t('cutHasTags', { n: tags.n }));

  await execute(db, `UPDATE harvest_scan_log SET cut_number = ? WHERE id = ? AND closed_at IS NULL`, [to, sessionId]);
  ctx.waitUntil(sendTelegramMessage(env, {
    chatId: env.TELEGRAM_TEST_CHAT_ID,
    text: `✂️ *${session.zone}*${session.cultivar ? ` ${session.cultivar}` : ''} — now Cut ${to} (was ${session.cut_number}), set on the zone screen.`,
  }).catch(e => console.error('[harvest][telegram]', e)));

  return renderPage(ui, ui.t('entered', { zone: session.zone }), enterBody(ui, {
    zone: session.zone, cultivar: session.cultivar, cutNumber: to, sessionId, prevZone: null,
    flash: ui.t('cutNow', { n: to }), headcount: session.headcount,
    crew: session.crew, crewDay: await crewDayFor(db, session),
  }));
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

  return renderPage(ui, ui.t('crew'), headcountBody(ui, {
    zone: session.zone, cutNumber: session.cut_number, sessionId, count, cultivar: session.cultivar,
  }));
}

/**
 * Fix the cultivar on the lot just opened — the receipt's "wrong cultivar?".
 *
 * Koa, 2026-09-21, after two R1 lots recorded a cultivar nobody cut. The pick
 * is one tap among seven on a phone in a field, and the only thing separating a
 * mis-tap from a real lot is that somebody notices. So: correct it in place,
 * the same way the headcount grid already lets a wrong count be re-tapped.
 *
 * IN PLACE, NOT A NEW SESSION. Re-scanning the sign would close this lot and
 * open another, leaving a minutes-long phantom lot in the timeline with barn
 * loads possibly already attached to it. The correction moves this row instead,
 * and the loads follow it, which is what actually happened in the field.
 *
 * Refused once tags exist: a printed tag carries the cultivar name on it, so at
 * that point paper and database disagree and only voiding can settle it.
 */
async function handleCultivarFix(ui, db, env, ctx, params) {
  const sessionId = parseInt(params.session_id, 10);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    throw createError('VALIDATION_ERROR', 'Missing or invalid session_id.');
  }
  const session = await queryOne(db, `SELECT * FROM harvest_scan_log WHERE id = ? AND event_type = 'enter'`, [sessionId]);
  if (!session) throw createError('NOT_FOUND', ui.t('noSessionFound', { id: sessionId }));
  refuseRealInTest(ui, env, session);
  if (session.closed_at) throw createError('VALIDATION_ERROR', ui.t('fixLotClosed'));

  const zone = session.zone;
  const options = cultivarsFor(zone);
  const cultivar = String(params.cultivar ?? '').trim();
  if (!options.includes(cultivar)) {
    throw createError('VALIDATION_ERROR', ui.t('notPlantedHere', { cv: cultivar, zone }));
  }

  const tags = await queryOne(db, `
    SELECT COUNT(*) AS n FROM harvest_sacks WHERE zone_session_id = ? AND voided_at IS NULL
  `, [sessionId]);
  if (tags && tags.n > 0) {
    throw createError('VALIDATION_ERROR', ui.t('fixHasTags', { n: tags.n }));
  }

  const was = session.cultivar;
  // The cut number is a property of zone x cultivar, so it is re-derived for
  // the cultivar this lot turned out to be — not carried over from the wrong one.
  const cutNumber = was === cultivar ? session.cut_number : await computeCutNumber(
    db, zone, cultivar, session.season, Number(session.is_test) ? 1 : 0, null);
  await execute(db, `UPDATE harvest_scan_log SET cultivar = ?, cut_number = ? WHERE id = ?`,
    [cultivar, cutNumber, sessionId]);

  if (was !== cultivar) {
    ctx.waitUntil(sendTelegramMessage(env, {
      chatId: env.TELEGRAM_TEST_CHAT_ID,
      text: `✏️ Corrected *${zone}* — ${was || '?'} → *${cultivar}* (Cut ${cutNumber})`,
    }).catch(e => console.error('[harvest][telegram]', e)));
  }

  return renderPage(ui, ui.t('cultivarFixed', { cv: cultivar }), enterBody(ui, {
    zone, cultivar, cutNumber, sessionId, prevZone: null,
    flash: ui.t('cultivarFixed', { cv: cultivar }),
    headcount: session.headcount,
    crew: session.crew, crewDay: await crewDayFor(db, session),
  }));
}

// ─── CREW CARD (retired) ────────────────────────────────
// The Crew A / Crew B cards are retired (one crew, Koa 2026-09-28), but they
// are laminated and still on clipboards. Scanning one CLEARS the old tag off
// the phone and says so, rather than erroring at someone holding a card.

async function handleCrewTag(ui) {
  const res = renderPage(ui, ui.t('crewRetired'), `
<h1>${ui.t('crewRetired')}</h1>
<p class="sub">${ui.t('crewRetiredSub')}</p>
<div class="footer"><a href="${API}?action=hub&lang=${ui.lang}">${ui.t('allTools')}</a></div>`);
  res.headers.append('Set-Cookie', CREW_COOKIE_CLEAR);
  return res;
}

// ─── END OF DAY ─────────────────────────────────────────
// The crew does not leave the last zone of the day — they stop, and pick up in
// that same zone next morning. So nothing closes that session, open-to-close
// contains a night, and the ledger withholds cutter-hours for it.
//
// That rule is right and the arithmetic makes it fatal: a zone is ~1 acre,
// ~1,936 plants, ~88 trailers, which is a day and a half to two days of
// cutting. Nearly every lot of the season spans a night, so nearly every lot
// reports nothing, and the crew rate the whole dashboard is built around reads
// empty all harvest — honest, and indistinguishable from broken.
//
// One scan fixes it. The lead already re-scans the zone sign every morning, so
// this is the only new habit in the whole chain.

/**
 * Close open lots at the end of the day. With one lot open, the card closes it.
 * With several (three crews), one lead finishing early must not close the
 * other crews' zones, so it asks which crew — or all of them. `?crew=A` closes
 * that crew's lot; `?crew=all` closes every one.
 */
async function handleDayEnd(ui, db, env, ctx, crewParam = null) {
  const isTest = isTestMode(env) ? 1 : 0;
  const open = await query(db, `
    SELECT * FROM harvest_scan_log
    WHERE event_type = 'enter' AND closed_at IS NULL AND is_test = ?
    ORDER BY occurred_at DESC, id DESC
  `, [isTest]);
  if (!open.length) {
    // Not an error. Scanning twice, or scanning after the crew already moved
    // on, is a person being careful — it must not look like a fault.
    return renderPage(ui, ui.t('dayEnd'), dayEndBody(ui, null));
  }

  const raw = String(crewParam ?? '').trim();
  const all = raw.toLowerCase() === 'all';
  const crew = all ? null : crewById(raw);
  if (raw && !all && !crew) throw createError('VALIDATION_ERROR', ui.t('crewBad', { c: raw }));
  if (!all && !crew && open.length > 1) {
    return renderPage(ui, ui.t('dayEnd'), dayEndPickerBody(ui, open));
  }

  const closing = crew ? open.filter(s => s.crew === crew.id) : open;
  if (!closing.length) return renderPage(ui, ui.t('dayEnd'), dayEndBody(ui, null));
  await execute(db, `
    UPDATE harvest_scan_log SET closed_at = datetime('now')
    WHERE event_type = 'enter' AND closed_at IS NULL AND is_test = ?
      AND id IN (${closing.map(() => '?').join(',')})
  `, [isTest, ...closing.map(s => s.id)]);

  const withHours = closing.map(s => ({
    ...s, hours: (Date.now() - parseSqliteUtc(s.occurred_at).getTime()) / 3600000 }));
  ctx.waitUntil(sendTelegramMessage(env, {
    chatId: env.TELEGRAM_TEST_CHAT_ID,
    text: '🌙 Fin del día: ' + withHours.map(s => `*${s.zone}*${s.cultivar ? ` · ${s.cultivar}` : ''}`
      + `${s.crew ? ` (${crewTg(s.crew)})` : ''} cerrada tras ${s.hours.toFixed(1)} h`).join('; ') + '.',
  }).catch(e => console.error('[harvest][telegram]', e)));

  return renderPage(ui, ui.t('dayEnd'), withHours.length === 1
    ? dayEndBody(ui, withHours[0])
    : dayEndManyBody(ui, withHours));
}

/** Several crews still open: one button per open lot's crew, and "all". */
function dayEndPickerBody(ui, open) {
  const crews = [...new Set(open.map(s => s.crew).filter(c => crewById(c)))].sort();
  const btn = (c) => {
    const lots = open.filter(s => s.crew === c).map(s => escapeHtml(s.zone)).join(', ');
    return `<a class="btn crewbtn crew-${c}" href="/fin?crew=${c}&lang=${ui.lang}"><span class="crewletter">${c}</span>`
      + `<span class="crewlead">${escapeHtml(crewById(c).lead)} · ${lots}</span></a>`;
  };
  return `
<h1>${ui.t('dayEndWhich')}</h1>
<div class="crewgrid">${crews.map(btn).join('')}
<a class="btn alt cvbtn" href="/fin?crew=all&lang=${ui.lang}">${ui.t('dayEndAll')}</a></div>`;
}

function dayEndManyBody(ui, closed) {
  const rows = closed.map(s => `<div class="lotmeta"><strong>${escapeHtml(s.zone)}${
    s.cultivar ? ` · ${escapeHtml(s.cultivar)}` : ''}</strong> · ${ui.t('cut', { n: s.cut_number })}${
    s.crew ? ` · ${escapeHtml(crewLabel(ui, s.crew))}` : ''}</div>`).join('');
  return `
<h1>✅ ${ui.t('dayEndClosedN', { n: closed.length })}</h1>
<div class="status">${rows}</div>
<p class="note">${ui.t('dayEndTomorrow')}</p>
<div class="footer"><a href="${API}?action=barn_intake">${ui.t('toBarnIntake')}</a> · <a href="${API}?action=find">${ui.t('findLink')}</a></div>`;
}

function dayEndBody(ui, closed) {
  if (!closed) {
    return `
<h1>${ui.t('dayEndNothing')}</h1>
<p class="note">${ui.t('dayEndNothingSub')}</p>
<div class="footer"><a href="${API}?action=barn_intake">${ui.t('toBarnIntake')}</a> · <a href="${API}?action=crew">${ui.t('crewChanged')}</a></div>`;
  }

  return `
<h1>✅ ${ui.t('dayEndClosed', {
    lot: `${escapeHtml(closed.zone)}${closed.cultivar ? ` · ${escapeHtml(closed.cultivar)}` : ''}`,
  })}</h1>
<div class="status">
  <div class="lotmeta"><strong>${ui.t('cut', { n: closed.cut_number })}</strong></div>
  <div class="lotmeta">${ui.t('dayEndAfter', { h: closed.hours.toFixed(1) })}</div>
</div>
<p class="note">${ui.t('dayEndTomorrow')}</p>
<div class="footer"><a href="${API}?action=barn_intake">${ui.t('toBarnIntake')}</a> · <a href="${API}?action=find">${ui.t('findLink')}</a></div>`;
}

// ─── BARN INTAKE ────────────────────────────────────────
// Two ways in, one set of rules, one write.
//
// The TRAILER decal (/t/<n>) is the normal path (Koa, 2026-09-28): the driver
// scans it on drop-off, sees the lot the load is about to go to, taps a bay.
// The DOOR page (/b/<n>) is the fallback for a torn decal or a dead phone,
// where someone picks the zone by hand. Both end in recordLoad().

async function handleBarnIntakeForm(ui, db, env, ctx, station = null) {
  const isTest = isTestMode(env) ? 1 : 0;
  const active = await getActiveSession(db, isTest);

  // The bay default is worth more care than it looks. A wrong bay is
  // unrecoverable — nothing afterwards distinguishes it from a right one —
  // whereas a missing bay is merely unknown. So the default is silent while it
  // is still the same Pacific day, and NAMED once the day has turned, which is
  // exactly when the crew has moved on to the next bay and the default has
  // quietly stopped being true. Keep the stale bay warning visible.
  const lastFill = await getLastFilledBay(db, isTest);
  const bayStale = !!(lastFill && lastFill.occurred_at &&
    pacificDay(parseSqliteUtc(lastFill.occurred_at)) !== pacificDay(new Date()));

  const [openNow, recentLots] = await Promise.all([
    query(db, `SELECT zone FROM harvest_scan_log
               WHERE event_type = 'enter' AND closed_at IS NULL AND is_test = ?`, [isTest]),
    getRecentEnterSessions(db, isTest),
  ]);

  return renderPage(ui, ui.t('barnIntake'),
    barnIntakeFormBody(ui, active, station,
      { bay: lastFill ? lastFill.bay : null, stale: bayStale },
      recentLots, openNow.map(r => r.zone)));
}

/**
 * The lot a form named, or null when it named none. Throws rather than
 * falling back: a load that quietly ignored the choice made at the door would
 * be worse than one that never offered the choice.
 *
 * With a zone, the lot must be in it: an id for another zone is a mis-tap or a
 * stale page, not an override, and it would move a trailer of bins onto a lot
 * it never touched. Old lots are refused for the same reason.
 */
async function pickedLot(ui, db, isTest, raw, zone = null) {
  const value = raw === undefined || raw === null ? '' : String(raw).trim();
  if (!value) return null;
  const id = parseInt(value, 10);
  if (!Number.isInteger(id) || id <= 0) throw createError('VALIDATION_ERROR', ui.t('lotAtDoorBad'));
  // Age is time since the lot was last ACTIVE: now if it is open, else its
  // close. An open lot is always eligible (a weekend with no End of day scan
  // must not lock every trailer out), and a two-day zone that closed a minute
  // ago is recent, however long ago it opened.
  const lot = await queryOne(db, `
    SELECT * FROM harvest_scan_log
    WHERE id = ? AND event_type = 'enter' AND is_test = ? ${zone ? 'AND zone = ?' : ''}
      AND julianday('now') - julianday(COALESCE(closed_at, datetime('now'))) <= ?
  `, zone ? [id, isTest, zone, LOT_AT_DOOR_DAYS] : [id, isTest, LOT_AT_DOOR_DAYS]);
  if (!lot) throw createError('VALIDATION_ERROR', ui.t('lotAtDoorBad'));
  return lot;
}

/**
 * Which lot does a trailer arriving NOW belong to, when nobody has named a
 * zone? The trailer screen's question.
 *
 * One crew means one open lot, so the answer is that lot — except inside the
 * barn grace window after a close (a zone change, a cultivar switch in a trial
 * zone, the end of the day). Then the trailer on the apron was loaded BEFORE
 * the change and belongs to the lot that just closed. lib/barn-attribution.js
 * has why that error is one-sided: a genuine load for the new lot cannot be
 * cut, filled and driven in six minutes.
 *
 * A null lot means nothing is open and nothing just closed — the driver has to
 * say which lot, because the alternative is bins that belong to no lot.
 */
async function proposeLot(db, isTest, trailer) {
  // THREE CREWS: the trailer's crew today decides, and the grace window is that
  // crew's — crew A changing zones must not pull crew B's trailer onto A's old
  // lot. A trailer on no crew today is ASKED, never sent to the newest lot.
  const crew = trailer ? await crewForTrailer(db, isTest, trailer) : null;
  if (!crew) {
    // A day nobody has set crews up yet is still a one-crew day (the build
    // shipped mid-shift, 2026-10-03, with all three crews in one zone): the
    // open lot, as before. Once any crew is set up, an unassigned trailer asks.
    if ((await getCrewDays(db, isTest)).length) return { lot: null, viaGrace: false, crew: null };
    const recentAny = await getLastClosedAnyCultivar(db, isTest);
    if (inBarnGrace(recentAny)) return { lot: recentAny, viaGrace: true, crew: null };
    return { lot: await getActiveSession(db, isTest), viaGrace: false, crew: null };
  }
  const recent = await getLastClosedAnyCultivar(db, isTest, null, crew);
  if (inBarnGrace(recent)) return { lot: recent, viaGrace: true, crew };
  return { lot: await getActiveSession(db, isTest, crew), viaGrace: false, crew };
}

/**
 * The door's question: the zone is known (someone picked it), which lot?
 *
 * A cultivar switch INSIDE one zone is invisible to a plain open-session
 * lookup: the zone is still open, so the load attaches to whatever is being
 * cut NOW. In a trial zone that is the whole error. Z10 is 15 cultivars in one
 * acre at ~130 plants each — roughly six trailers a lot — so a single
 * misplaced trailer is a 15-20% error on a lot whose only purpose is being
 * compared against its neighbours. Z8 and R1 are the same shape. So if a
 * DIFFERENT cultivar closed in this zone inside the grace window, the trailer
 * was loaded before the switch. Self-limiting: in a single-cultivar zone the
 * previous session carries the same cultivar, so this never fires.
 *
 * Nothing open for this zone — the crew has moved on. If it closed within the
 * grace window the load was cut there and is only now arriving.
 */
async function attributeForZone(db, isTest, zone) {
  let session = await getOpenSessionForZone(db, isTest, zone);
  let viaSwitch = null;
  let viaGrace = false;
  if (session) {
    const prev = await getLastClosedAnyCultivar(db, isTest, zone);
    const now = session.cultivar || null;
    if (prev && inBarnGrace(prev) && (prev.cultivar || null) !== now) {
      viaSwitch = { from: prev.cultivar || null, to: now };
      session = prev;
    }
  } else {
    const recent = await getLastClosedAnyCultivar(db, isTest, zone);
    if (inBarnGrace(recent)) { session = recent; viaGrace = true; }
  }
  return { session, viaGrace, viaSwitch };
}

/**
 * Which load of its Pacific day, for its zone, a load is: "Carga #3 hoy".
 * Counted up to the load itself, so a receipt re-opened later still says 3.
 *
 * Pacific, not UTC: "#3 today" used to reset at 5pm Pacific, mid-afternoon,
 * while trailers were still arriving.
 */
async function loadNumberFor(db, isTest, zone, occurredAt, id) {
  const [dayStart, dayEnd] = pacificDayRange(pacificDay(occurredAt));
  const r = await queryOne(db, `
    SELECT COUNT(*) as n FROM harvest_scan_log
    WHERE event_type = 'barn_load' AND zone = ? AND id <= ?
      AND occurred_at >= ? AND occurred_at < ? AND is_test = ?
  `, [zone, id, dayStart, dayEnd, isTest]);
  return (r?.n) || 1;
}

/**
 * Write one barn load and announce it. Both entry points end here, so the
 * ledger, the rack board and the Telegram feed cannot disagree about what a
 * load is. Returns { id, loadNumber }.
 */
async function recordLoad(db, env, ctx, { zone, bins, session, bay, trailer = null, isTest, cutNote }) {
  const res = await execute(db, `
    INSERT INTO harvest_scan_log (event_type, zone, season, bins, attributed_zone_session_id, bay, trailer, crew, is_test)
    VALUES ('barn_load', ?, ?, ?, ?, ?, ?, ?, ?)
  `, [zone, getSeason(), bins, session ? session.id : null, bay, trailer, session?.crew ?? null, isTest]);

  const loadNumber = await loadNumberFor(db, isTest, zone, new Date(), res.lastRowId);

  ctx.waitUntil(sendTelegramMessage(env, {
    chatId: env.TELEGRAM_TEST_CHAT_ID,
    text: `🚚 ${trailer ? `${trailerName(trailer)} · ` : ''}${session?.crew ? `${crewTg(session.crew)} · ` : ''}Load: ${bins} bins → *${zone}* (${cutNote})`
      + `${bay ? ` · bay ${bay}` : ''}. Load #${loadNumber} today for this zone.`,
  }).catch(e => console.error('[harvest][telegram]', e)));

  return { id: res.lastRowId, loadNumber };
}

async function handleBarnLog(ui, db, env, ctx, body, station = null) {
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

  // Nullable: an old bookmark that posts no bay still logs its bins. Losing
  // bins is the worst outcome available (the ledger joins on the session FK, so
  // a rejected load drops off the lot entirely); an unknown bay only costs a
  // cell on the rack board. An out-of-range bay still throws — that is a typo,
  // not an old bookmark, and it would print on a tag.
  const bay = parseBay(body.bay, ui);

  const isTest = isTestMode(env) ? 1 : 0;

  // A lot named at the door beats every rule below it. Nothing automatic knows
  // more than the person holding the trailer, who was told which zone started
  // (Koa, 2026-09-17) — and this is the case where the automatic answer is
  // "nothing", which loses the bins off every lot.
  const picked = await pickedLot(ui, db, isTest, body.lot, zone);
  const { session, viaGrace, viaSwitch } = picked
    ? { session: picked, viaGrace: false, viaSwitch: null }
    : await attributeForZone(db, isTest, zone);

  const cutNote = session
    ? `cut ${session.cut_number}${picked ? ', chosen at the door' : ''}${viaGrace ? ', just-closed lot' : ''}`
      + `${viaSwitch ? `, ${viaSwitch.from || '?'} (cultivar just changed)` : ''}`
    : 'no active session for this zone';
  const { loadNumber } = await recordLoad(db, env, ctx, { zone, bins, session, bay, isTest, cutNote });

  return renderPage(ui, ui.t('barnIntake'), barnLogConfirmBody(ui, {
    chosen: picked ? `${picked.zone} · ${picked.cultivar || '?'} · ${translate(ui.lang, 'cut', { n: picked.cut_number ?? '?' })}` : null,
    zone, bins, loadNumber, station, bay,
    hasActiveSession: !!session,
    grace: viaGrace ? { zone, cut: session.cut_number } : null,
    switched: viaSwitch,
  }));
}

// ─── TRAILER DECAL ──────────────────────────────────────
// ONE SCAN (Koa, 2026-09-28: "just a one-scan on the qr without jumping
// through any hoops"). Scanning the decal IS logging the load: open lot (or
// the one that just closed), 24 bins, this trailer's bay from earlier today.
// The receipt then offers the rare corrections — wrong bay, a partial, the
// wrong lot, undo — for TRAILER_EDIT_MS. Fix-after instead of ask-before.
//
// It still asks, and writes nothing, in exactly two cases, because guessing
// would put bins somewhere wrong that nobody can see afterwards:
//   - no bay for this trailer yet today (its first run: one tap, then
//     hands-free until the barn moves on);
//   - no lot to put it on (nothing open and nothing just closed).

/** How long after the scan the receipt still offers fixes and undo. */
const TRAILER_EDIT_MS = 10 * 60 * 1000;

/**
 * A request that must never log a load: anything but a plain GET, a browser
 * prefetch/prerender, or a link-preview bot (the URL is printed on a trailer
 * and may well be texted around). These get the ask screen, which writes
 * nothing until someone taps.
 */
function isNotAPerson(request) {
  if (request.method !== 'GET') return true;
  const h = request.headers;
  const purpose = `${h.get('sec-purpose') || ''} ${h.get('purpose') || ''} ${h.get('x-purpose') || ''}`;
  if (/prefetch|prerender|preview/i.test(purpose)) return true;
  return /bot\b|crawler|spider|preview|facebookexternalhit|whatsapp|slack|discord|telegram/i
    .test(h.get('user-agent') || '');
}

const receiptUrl = (id, ui) => `${API}?action=trailer_done&id=${id}&lang=${ui.lang}`;

/** 303 to a GET page: the tab ends up on the receipt, never on the scan URL. */
const seeOther = (location) => new Response(null, { status: 303, headers: { Location: location } });

/** GET /t/<n> — the QR on a trailer, scanned by its driver at drop-off. */
export async function handleTrailerScan(request, env, ctx) {
  env = await withSettings(env);
  const ui = makeUi(request, env);
  try {
    const raw = new URL(request.url).pathname.replace(/^\/t\//, '').trim();
    const trailer = parseTrailer(raw);
    if (!trailer) throw createError('VALIDATION_ERROR', ui.t('trailerBad', { t: raw }));
    if (isNotAPerson(request)) return await trailerFormPage(ui, env.DB, env, trailer);
    return await logTrailerNow(ui, env.DB, env, ctx, trailer, 'one scan');
  } catch (e) {
    const { message, status } = formatError(e);
    return errorPage(ui, message, status);
  }
}

/**
 * What one scan does, shared by the decal and the receipt's "Log another load"
 * button (Koa, 2026-09-29: "if they don't want to scan the QR every time"), so
 * the two can never disagree: the open or just-closed lot, 24 bins, the barn's
 * bay today — or the ask screen when one of those has no honest answer.
 */
async function logTrailerNow(ui, db, env, ctx, trailer, how) {
  const isTest = isTestMode(env) ? 1 : 0;
  const [proposal, lastFill] = await Promise.all([
    proposeLot(db, isTest, trailer), getLastFilledBay(db, isTest)]);
  const bayToday = lastFill && lastFill.occurred_at &&
    pacificDay(parseSqliteUtc(lastFill.occurred_at)) === pacificDay(new Date())
    ? lastFill.bay : null;
  if (!proposal.lot || !bayToday) return await trailerFormPage(ui, db, env, trailer);

  const saved = await recordLoad(db, env, ctx, {
    zone: proposal.lot.zone, bins: CONSTANTS.binsPerTrailer.value, session: proposal.lot,
    bay: bayToday, trailer, isTest,
    cutNote: `cut ${proposal.lot.cut_number}${proposal.viaGrace ? ', just-closed lot' : ''}, ${how}`,
  });
  return seeOther(receiptUrl(saved.id, ui));
}

/**
 * POST from the receipt's "Log another load" button — the same as scanning the
 * decal again. POST only: a button is a deliberate tap, and nothing that merely
 * fetches a page (a prefetch, a restored tab) may log a trailer.
 */
async function handleTrailerAgain(ui, db, env, ctx, body, method) {
  if (method !== 'POST') throw createError('VALIDATION_ERROR', ui.t('trailerAgainPost'));
  const trailer = parseTrailer(body.trailer);
  if (!trailer) throw createError('VALIDATION_ERROR', ui.t('trailerBad', { t: body.trailer ?? '' }));
  return logTrailerNow(ui, db, env, ctx, trailer, 'receipt button');
}

/**
 * The ask screen, for the two cases one scan cannot settle. The lot is worked
 * out HERE, shown to the driver, and posted as an explicit id — so what the
 * driver saw is exactly what is saved.
 */
async function trailerFormPage(ui, db, env, trailer, keep = null) {
  const isTest = isTestMode(env) ? 1 : 0;
  const [proposal, lastFill, recentLots] = await Promise.all([
    proposeLot(db, isTest, trailer),
    getLastFilledBay(db, isTest),
    getRecentEnterSessions(db, isTest),
  ]);
  // Pre-selected only on the same Pacific day, for the reason the door gives:
  // overnight the barn moves on to the next bay and the default stops being
  // true. The number is still named, just not ticked.
  const today = !!(lastFill && lastFill.occurred_at &&
    pacificDay(parseSqliteUtc(lastFill.occurred_at)) === pacificDay(new Date()));
  return renderPage(ui, `${ui.t('trailer')} ${trailerName(trailer)}`, trailerFormBody(ui, {
    trailer, proposal, recentLots, keep,
    lastBay: lastFill ? lastFill.bay : null, bayToday: today,
  }));
}

/** Bins from a form field: 1..max, the whole value, or a thrown range error. */
function parseBins(raw, max, errorKey, ui) {
  const s = String(raw ?? '').trim();
  const n = parseInt(s, 10);
  if (!Number.isInteger(n) || n < 1 || n > max || String(n) !== s) {
    throw createError('VALIDATION_ERROR', ui.t(errorKey, { max }));
  }
  return n;
}

/** POST from the ask screen: the tap that one scan could not do by itself. */
async function handleTrailerLog(ui, db, env, ctx, body) {
  const trailer = parseTrailer(body.trailer);
  if (!trailer) throw createError('VALIDATION_ERROR', ui.t('trailerBad', { t: body.trailer ?? '' }));
  const isTest = isTestMode(env) ? 1 : 0;

  // Both required. The screen marks them required too; this is the guard for
  // anything that reaches the endpoint without the screen.
  const lot = await pickedLot(ui, db, isTest, body.lot);
  if (!lot) throw createError('VALIDATION_ERROR', ui.t('trailerPickLot'));
  const bay = parseBay(body.bay, ui);
  if (!bay) throw createError('VALIDATION_ERROR', ui.t('trailerPickBay'));

  // 24 is the standard (Koa, 2026-09-28). A partial is 1..23; anything else in
  // the partial box is refused rather than stored as one.
  const FULL = CONSTANTS.binsPerTrailer.value;
  const partial = String(body.partial_bins ?? '').trim();
  const bins = partial ? parseBins(partial, FULL - 1, 'partialRange', ui) : FULL;

  const proposal = await proposeLot(db, isTest, trailer);
  const asProposed = !!(proposal.lot && proposal.lot.id === lot.id);
  const cutNote = `cut ${lot.cut_number}${asProposed ? (proposal.viaGrace ? ', just-closed lot' : '') : ', chosen by driver'}`;
  const saved = await recordLoad(db, env, ctx, {
    zone: lot.zone, bins, session: lot, bay, trailer, isTest, cutNote,
  });

  // Post/Redirect/Get: a reload or a back button re-shows the receipt instead
  // of re-posting the load.
  return seeOther(receiptUrl(saved.id, ui));
}

/** One trailer load with its lot, or null. Trailer loads only. */
async function getTrailerLoad(db, isTest, rawId) {
  const id = parseInt(rawId, 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  return queryOne(db, `
    SELECT l.*, s.cultivar AS lot_cultivar, s.cut_number AS lot_cut, s.crew AS lot_crew
    FROM harvest_scan_log l
    JOIN harvest_scan_log s ON s.id = l.attributed_zone_session_id
    WHERE l.id = ? AND l.event_type = 'barn_load' AND l.trailer IS NOT NULL AND l.is_test = ?
  `, [id, isTest]);
}

const editableUntil = (row) => parseSqliteUtc(row.occurred_at).getTime() + TRAILER_EDIT_MS;

/** GET receipt for a trailer load — where every scan and every tap ends up. */
async function handleTrailerDone(ui, db, env, params) {
  const isTest = isTestMode(env) ? 1 : 0;
  const row = await getTrailerLoad(db, isTest, params.id);
  if (!row) throw createError('NOT_FOUND', ui.t('trailerNoReceipt'));
  const editable = Date.now() < editableUntil(row);
  const [loadNumber, recentLots] = await Promise.all([
    loadNumberFor(db, isTest, row.zone, parseSqliteUtc(row.occurred_at), row.id),
    editable ? getRecentEnterSessions(db, isTest) : [],
  ]);
  // The full-screen "logged" flash plays only on the scan's own redirect, not
  // when an old receipt is reopened from the tab list hours later.
  const fresh = Date.now() - parseSqliteUtc(row.occurred_at).getTime() < LOGGED_FLASH_FRESH_MS;
  return renderPage(ui, `${ui.t('trailer')} ${trailerName(row.trailer)}`, trailerReceiptBody(ui, {
    row, loadNumber, editable, recentLots, fresh,
  }));
}

/**
 * POST from the receipt: fix a load (bay, bins, lot) or undo it, inside
 * TRAILER_EDIT_MS of the scan. The window is enforced in the UPDATE/DELETE
 * itself, so a receipt left open on a phone cannot rewrite an old load.
 */
async function handleTrailerFix(ui, db, env, ctx, body) {
  const isTest = isTestMode(env) ? 1 : 0;
  const row = await getTrailerLoad(db, isTest, body.id);
  if (!row) throw createError('NOT_FOUND', ui.t('trailerNoReceipt'));
  const windowSql = `occurred_at > datetime('now', '-${Math.round(TRAILER_EDIT_MS / 1000)} seconds')`;
  const name = trailerName(row.trailer);

  if (truthy(body.undo)) {
    // A hard delete, on purpose: a load scanned by mistake minutes ago was
    // never a load, and a void flag would have to be honoured by every ledger,
    // rack-board and metrics query there is. The Telegram feed keeps the record.
    const r = await execute(db, `
      DELETE FROM harvest_scan_log
      WHERE id = ? AND event_type = 'barn_load' AND trailer IS NOT NULL AND is_test = ? AND ${windowSql}
    `, [row.id, isTest]);
    if (!r.changes) throw createError('VALIDATION_ERROR', ui.t('trailerFixLate'));
    ctx.waitUntil(sendTelegramMessage(env, {
      chatId: env.TELEGRAM_TEST_CHAT_ID,
      text: `↩️ ${name} · load removed (was ${row.bins} bins → *${row.zone}*${row.bay ? ` · bay ${row.bay}` : ''}).`,
    }).catch(e => console.error('[harvest][telegram]', e)));
    return renderPage(ui, `${ui.t('trailer')} ${name}`, `
<h1>${ui.t('trailerUndone', { t: name })}</h1>
<p class="sub">${ui.t('trailerUndoneSub')}</p>`);
  }

  const bay = parseBay(body.bay, ui);
  if (!bay) throw createError('VALIDATION_ERROR', ui.t('trailerPickBay'));
  const bins = parseBins(body.bins, CONSTANTS.binsPerTrailer.value, 'binsFixRange', ui);
  // The load's own lot needs no re-validation — it was valid when the scan
  // chose it, and an old-but-just-closed lot must not block a bay fix.
  const lotRaw = String(body.lot ?? '').trim();
  const lot = !lotRaw || Number(lotRaw) === row.attributed_zone_session_id
    ? { id: row.attributed_zone_session_id, zone: row.zone, crew: row.lot_crew }
    : await pickedLot(ui, db, isTest, lotRaw);

  // The load's crew follows its lot, so a load moved to crew B's lot counts for B.
  const r = await execute(db, `
    UPDATE harvest_scan_log SET bay = ?, bins = ?, attributed_zone_session_id = ?, zone = ?, crew = ?
    WHERE id = ? AND event_type = 'barn_load' AND trailer IS NOT NULL AND is_test = ? AND ${windowSql}
  `, [bay, bins, lot.id, lot.zone, lot.crew ?? null, row.id, isTest]);
  if (!r.changes) throw createError('VALIDATION_ERROR', ui.t('trailerFixLate'));

  const changed = [
    bay !== row.bay ? `bay ${row.bay ?? '?'}→${bay}` : '',
    bins !== row.bins ? `${row.bins}→${bins} bins` : '',
    lot.id !== row.attributed_zone_session_id ? `lot ${row.zone}→${lot.zone}` : '',
  ].filter(Boolean).join(', ');
  if (changed) {
    ctx.waitUntil(sendTelegramMessage(env, {
      chatId: env.TELEGRAM_TEST_CHAT_ID,
      text: `✏️ ${name} · load fixed: ${changed}.`,
    }).catch(e => console.error('[harvest][telegram]', e)));
  }
  return seeOther(receiptUrl(row.id, ui));
}

// ─── SUPERSACK TAGS ─────────────────────────────────────
// Sacks are filled at TAKEDOWN, ~10 days after the material was cut — while
// the crew may be out cutting a different zone entirely. So none of this may
// ever attribute a sack to the "currently active" zone the way barn intake
// does; the operator explicitly picks which lot is coming down.

async function handleSackPrintForm(ui, db, env, flash = null) {
  const isTest = isTestMode(env) ? 1 : 0;
  const [lots, lastBay, lastStorage] = await Promise.all([
    getRecentLots(db, isTest), getLastBay(db, isTest), getLastStorage(db, isTest)]);
  await attachDryingBays(db, isTest, lots);
  const bays = await getBayTakedown(db, isTest, lots);
  return renderPage(ui, ui.t('printTags'), sackPrintFormBody(ui, lots, lastBay, lastStorage, flash, bays));
}

const bayKey = (bay, cultivar, cut, fillStart) => `${Number(bay)}|${cultivar}|${Number(cut ?? 1)}|${fillStart}`;

/**
 * Takedown by BAY (Koa, 2026-10-05). Sour Lifter from two or three zones hangs
 * in every bay and the sticks carry no zone, so the crew can see which bay is
 * coming down but not which zone a stick grew in. The picker offers one card
 * per bay, cultivar and cut, with each zone's share by bins (Koa chose bins
 * over acres: they are what was physically hung in that bay).
 *
 * Sacks still hang off ONE lot, the zone with the most bins in the bay, so the
 * rest of the system (serials, Shopify, the scan page) is unchanged. The bay on
 * every sack is what carries the real lineage; zone yields are to be split from
 * the bay's bin shares, never read off the lot the sack happens to hang on.
 *
 * Lots with no bay on any load keep their zone card.
 */
async function getBayTakedown(db, isTest, lots) {
  const [loads, tags, done] = await Promise.all([
    // A lot with no barn loads at all can carry its bay on its own enter row:
    // material trucked in from McLoughlin, or hung on tables, is never scanned
    // at the barn door (Koa, 2026-10-05). It joins the bay with zero bins.
    query(db, `
      SELECT attributed_zone_session_id AS session_id, bay, bins, occurred_at FROM harvest_scan_log
      WHERE event_type = 'barn_load' AND is_test = ? AND bay IS NOT NULL
        AND attributed_zone_session_id IS NOT NULL
        AND julianday('now') - julianday(occurred_at) <= ?
      UNION ALL
      SELECT e.id AS session_id, e.bay, 0 AS bins, e.occurred_at FROM harvest_scan_log e
      WHERE e.event_type = 'enter' AND e.is_test = ? AND e.bay IS NOT NULL
        AND julianday('now') - julianday(e.occurred_at) <= ?
        AND NOT EXISTS (SELECT 1 FROM harvest_scan_log b
                        WHERE b.event_type = 'barn_load' AND b.attributed_zone_session_id = e.id)
    `, [isTest, LOT_PICKER_DAYS, isTest, LOT_PICKER_DAYS]),
    query(db, `
      SELECT bay, printed_at, cultivar, cut_number FROM harvest_sacks
      WHERE is_test = ? AND bay IS NOT NULL AND voided_at IS NULL
        AND julianday('now') - julianday(printed_at) <= ?
    `, [isTest, LOT_PICKER_DAYS]),
    // Before migration 0043 the table is absent: no bay has been finished yet.
    query(db, `SELECT bay, cultivar, cut_number, fill_start, done_at FROM harvest_bay_done WHERE is_test = ?`, [isTest])
      .catch(() => []),
  ]);
  const fills = bayFills(loads);
  const lotOfSession = new Map();
  for (const l of lots) for (const id of (l.session_ids || [l.id])) lotOfSession.set(id, l);
  const doneByKey = new Map(done.map(d => [bayKey(d.bay, d.cultivar, d.cut_number, d.fill_start), d]));

  const cards = bayCards(fills, lotOfSession, tags).map(c => {
    const fillStart = sqliteUtc(new Date(c.fillStartMs));
    const d = doneByKey.get(bayKey(c.bay, c.cultivar, c.cut, fillStart));
    // Sacks hang off the biggest lot still open: a finished lot refuses tags.
    const open = c.zones.filter(z => !z.lot.takedown_done_at);
    return { ...c, fillStart, doneAt: d ? d.done_at : null,
      primary: (open[0] || c.zones[0]).lot, allLotsFinished: open.length === 0 };
  });
  const active = cards.filter(c => !c.doneAt && !c.allLotsFinished);
  const finished = cards.filter(c => c.doneAt)
    .sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
  const covered = new Set();
  for (const c of [...active, ...finished]) for (const z of c.zones) covered.add(z.lot.id);
  return { cards, active, finished, covered, fills, doneByKey };
}

/** True once every bay fill holding this lot's loads is down (finished, or refilled since). */
function lotAllBaysDown(lot, info) {
  const ids = new Set(lot.session_ids || [lot.id]);
  for (const [bay, fills] of info.fills) {
    for (const f of fills) {
      if (f.closed || !f.loads.some(l => ids.has(l.session_id))) continue;
      if (!info.doneByKey.has(bayKey(bay, lot.cultivar, lot.cut_number, sqliteUtc(new Date(f.startMs))))) return false;
    }
  }
  return true;
}

/** "Sep 28" / "28 sept" — a Pacific calendar day without the year. */
function shortDay(ui, ms) {
  return new Date(ms).toLocaleDateString(ui.lang === 'es' ? 'es-MX' : 'en-US',
    { timeZone: HARVEST_TZ, month: 'short', day: 'numeric' });
}

function hungDates(ui, c) {
  const a = shortDay(ui, c.firstMs), b = shortDay(ui, c.lastMs);
  return ui.t('hungDates', { d: a === b ? a : `${a}–${b}` });
}

/** The zone chips of a bay card: "Z1+Z2 66%" "Z11 34%" (zones harvested together merged). */
function zoneMix(c) {
  const shown = c.groups || c.zones;
  const pct = percentShares(shown);
  return `<span class="zonemix">${shown.map((z, i) =>
    `<span class="zchip">${escapeHtml(z.zone)} <b>${pct[i]}%</b></span>`).join('')}</span>`;
}

/**
 * POST ?action=bay_finish — "Bay 9 is down" (or reopen it). Records the bay
 * fill as finished, then closes every lot it held whose bays are now ALL down,
 * so a zone hung across bays 9 and 10 stays open until both are. Like Finished
 * on a lot, it touches no sack, no storage and no Shopify count.
 */
async function handleBayFinish(ui, db, env, ctx, body) {
  const bay = parseBay(body.bay, ui);
  const cultivar = String(body.cultivar || '').trim().substring(0, 60);
  const cut = parseInt(body.cut, 10) || 1;
  const fillStart = String(body.fill_start || '').trim();
  if (!bay || !cultivar || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(fillStart)) {
    throw createError('VALIDATION_ERROR', ui.t('pickLotFirst'));
  }
  const reopen = String(body.reopen ?? '') === '1';
  const isTest = isTestMode(env) ? 1 : 0;
  await execute(db, reopen
    ? `DELETE FROM harvest_bay_done WHERE bay = ? AND cultivar = ? AND cut_number = ? AND fill_start = ? AND is_test = ?`
    : `INSERT OR IGNORE INTO harvest_bay_done (bay, cultivar, cut_number, fill_start, is_test) VALUES (?, ?, ?, ?, ?)`,
    [bay, cultivar, cut, fillStart, isTest]);

  const lots = await getRecentLots(db, isTest);
  const info = await getBayTakedown(db, isTest, lots);
  const card = info.cards.find(c => c.bay === bay && c.cultivar === cultivar
    && Number(c.cut) === cut && c.fillStart === fillStart);
  for (const z of (card ? card.zones : [])) {
    const lot = await requireLot(db, z.lot.id);
    const f = lotSessionsWhere(lot);
    if (reopen) {
      await execute(db, `UPDATE harvest_scan_log SET takedown_done_at = NULL
                         WHERE ${f.where} AND takedown_done_at IS NOT NULL`, f.params);
    } else if (lotAllBaysDown(z.lot, info)) {
      await execute(db, `UPDATE harvest_scan_log SET takedown_done_at = ?
                         WHERE ${f.where} AND takedown_done_at IS NULL`, [sqliteUtc(new Date()), ...f.params]);
    }
  }

  const sacks = card ? card.sacks : 0;
  ctx.waitUntil(sendTelegramMessage(env, {
    chatId: env.TELEGRAM_TEST_CHAT_ID,
    text: reopen
      ? `↩️ Bay ${bay} reopened — *${cultivar}* cut ${cut}.`
      : `✅ Bay ${bay} down — *${cultivar}* cut ${cut}: ${sacks} sack${sacks === 1 ? '' : 's'}${card ? ` (${card.zones.map(z => z.zone).join(', ')})` : ''}.`,
  }).catch(e => console.error('[harvest][telegram]', e)));

  if (reopen && card) {
    return new Response(null, { status: 303, headers: {
      Location: `${API}?action=lot_resume&session_id=${card.primary.id}&bay=${bay}&reopened=1&lang=${ui.lang}` } });
  }
  return handleSackPrintForm(ui, db, env,
    ui.t(reopen ? 'bayReopened' : 'bayFinished', { bay, cv: cultivar, n: sacks }));
}

/**
 * The bay(s) each lot is drying in, as `lot.bays` — shown on its picker card
 * (Koa, 2026-10-05: "can we also put what bay it's drying in?").
 *
 * From the lot's barn loads, which carry the bay they were hung in. A lot with
 * none (cut before bays were captured, or entered by hand) falls back to the
 * bay its tags came down from. Neither: no bay shown, never a guess.
 * Whole-window reads filtered in JS, as in handlePipeline: an IN list over
 * session ids would outgrow D1's 100-variable cap.
 */
async function attachDryingBays(db, isTest, lots) {
  const [loads, tags] = await Promise.all([
    query(db, `
      SELECT DISTINCT attributed_zone_session_id AS session_id, bay FROM harvest_scan_log
      WHERE event_type = 'barn_load' AND is_test = ? AND bay IS NOT NULL
        AND attributed_zone_session_id IS NOT NULL
        AND julianday('now') - julianday(occurred_at) <= ?
    `, [isTest, LOT_PICKER_DAYS]),
    query(db, `
      SELECT DISTINCT zone_session_id AS session_id, bay FROM harvest_sacks
      WHERE is_test = ? AND bay IS NOT NULL AND zone_session_id IS NOT NULL
        AND julianday('now') - julianday(printed_at) <= ?
    `, [isTest, LOT_PICKER_DAYS]),
  ]);
  const bySession = (rows) => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.session_id)) m.set(r.session_id, new Set());
      m.get(r.session_id).add(Number(r.bay));
    }
    return m;
  };
  const loadBays = bySession(loads), tagBays = bySession(tags);
  const collect = (m, ids) => [...new Set(ids.flatMap(id => [...(m.get(id) || [])]))];
  for (const l of lots) {
    const ids = l.session_ids || [l.id];
    const found = collect(loadBays, ids);
    l.bays = (found.length ? found : collect(tagBays, ids)).sort((a, b) => a - b);
  }
  return lots;
}

/** "Bay 7" / "Bays 7, 9" — empty when the lot's bay is unknown. */
function bayPill(ui, lot) {
  const bays = lot.bays || [];
  if (!bays.length) return '';
  const text = bays.length === 1 ? ui.t('bayN', { n: bays[0] }) : ui.t('baysN', { n: bays.join(', ') });
  return `<span class="baypill">${escapeHtml(text)}</span>`;
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
/**
 * A LOT is season x zone x cultivar x cut. A SESSION is one uninterrupted
 * stretch of a crew being in that zone. They are NOT the same thing, and
 * treating them as the same was a real bug:
 *
 *   - One crew leaves Z8 for Z7 and comes back, the same shift or the next
 *     morning. That is deliberately still cut 1 (a zone continues its cut), so
 *     the second entry is a second session of the SAME lot. (See the 2025 log:
 *     "Finished Z8, partial Z7, partial Z5".)
 *   - From 2026 two cutting crews can be in one zone at once — same plants,
 *     same cut, two sessions.
 *
 * Keyed on the session, each of those produced its own ledger row carrying the
 * same lot_id AND the FULL zone acreage, so lb/ac read low by however many
 * times the zone was entered. Everything downstream groups on the lot instead.
 */
function lotKey(l) {
  return `${l.season || getSeason()}|${l.zone}|${l.cultivar || ''}|${l.cut_number}`;
}

/**
 * Sessions -> array of lots, each an array of that lot's sessions.
 * Input order is preserved, so pass sessions oldest-first and the first session
 * of each lot is its primary — the one sacks and the picker hang off.
 */
function groupSessionsIntoLots(sessions) {
  const byKey = new Map();
  for (const s of sessions) {
    const k = lotKey(s);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(s);
  }
  return [...byKey.values()];
}

/**
 * Peak cutters on a lot at any one moment.
 *
 * Summing headcount across sessions is wrong half the time and right the other
 * half: one crew of 6 that left and came back is 6 cutters, not 12, while two
 * crews of 6 and 5 working the same zone at once really is 11. The peak of the
 * concurrent intervals is correct in both, and reduces to today's single number
 * for a lot with one session.
 */
function peakHeadcount(sessions, nowMs = Date.now()) {
  const events = [];
  for (const s of sessions) {
    if (!s.headcount) continue;
    const opened = parseSqliteUtc(s.occurred_at).getTime();
    const closed = s.closed_at ? parseSqliteUtc(s.closed_at).getTime() : nowMs;
    events.push([opened, s.headcount], [closed, -s.headcount]);
  }
  if (!events.length) return null;
  // At an identical timestamp, close before open: back-to-back sessions are
  // sequential, and must not read as a moment of double the cutters.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let live = 0, peak = 0;
  for (const [, delta] of events) { live += delta; if (live > peak) peak = live; }
  return peak;
}

// Ranking for the takedown picker, shared by the sort and by lotPlausibility()
// so the order on screen and the badge on each card can never disagree.
const LOT_RANK = { ready: 0, old: 1, started: 2, green: 3 };

function lotLevel(lot) {
  if (lot.days_since_cut < DRY_DAYS_MIN) return 'green';
  if (lot.sacks_printed > 0) return 'started';
  if (lot.days_since_cut > DRY_DAYS_MAX) return 'old';
  return 'ready';
}

async function getRecentLots(db, isTest) {
  const sessions = await query(db, `
    SELECT
      l.id, l.zone, l.cultivar, l.cut_number, l.season, l.occurred_at, l.takedown_done_at,
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
    ORDER BY l.occurred_at ASC
  `, [isTest, LOT_PICKER_DAYS]);

  // Ranking moved out of SQL because it now depends on the MERGED sack count:
  // a lot whose first session has no tags but whose second does is "already
  // started", and ranking per session would have shown it as untouched.
  return groupSessionsIntoLots(sessions).map(mergePickerLot).sort((a, b) =>
    LOT_RANK[lotLevel(a)] - LOT_RANK[lotLevel(b)] ||
    String(a.occurred_at).localeCompare(String(b.occurred_at)));
}

function mergePickerLot(sessions) {
  const primary = sessions[0];
  return {
    ...primary,
    // Sacks hang off ONE session per lot so a re-entered zone cannot split its
    // tags across two rows depending on which the operator's thumb landed on.
    id: primary.id,
    session_ids: sessions.map(s => s.id),
    sacks_printed: sessions.reduce((t, s) => t + (s.sacks_printed || 0), 0),
    last_printed_at: sessions.map(s => s.last_printed_at).filter(Boolean).sort().pop() || null,
    // Dryness is judged from the earliest cut — the oldest material on the rack.
    days_since_cut: primary.days_since_cut,
    // Finished only while EVERY session is — the same rule as getLotFinish(),
    // so the picker and the print guard can never disagree about a lot.
    takedown_done_at: lotFinishedAt(sessions),
  };
}

/** The lot's close-out time, or null while any of its sessions is still open. */
function lotFinishedAt(sessions) {
  if (!sessions.length || !sessions.every(s => s.takedown_done_at)) return null;
  return sessions.map(s => s.takedown_done_at).sort().pop();
}

/**
 * How plausible is it that this lot is the one physically coming down now?
 * Advisory only — the operator can always override, because the tape and their
 * eyes beat our heuristic. We warn, we don't block.
 */
function lotPlausibility(ui, lot) {
  const d = lot.days_since_cut;
  const level = lotLevel(lot);
  const note = {
    green:   () => ui.t('noteGreen', { d, typical: DRY_DAYS_TYPICAL }),
    started: () => ui.t('noteStarted', { n: lot.sacks_printed }),
    old:     () => ui.t('noteOld', { d }),
    ready:   () => ui.t('noteReady', { d }),
  }[level]();
  return { level, note };
}

/**
 * The takedown session screen. Picked once per lot, then it stays up while the
 * worker fills sack after sack — the PRINT TAG button allocates and prints
 * without navigating, so nobody loses their place mid-rack with gloves on.
 */
async function handleSackSession(ui, db, env, input, flash = null) {
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
  const bay = parseBay(input.bay, ui);
  const storage = parseStorage(input.storage, ui);
  const finishedAt = await getLotFinish(db, lot);
  // Will these tags move a Super Sack count? Asked here, before a serial is
  // spent, because a miss is otherwise silent until someone reconciles.
  const variantCheck = isTest ? null : await checkSupersackVariant(env, db, {
    season: lot.season || getSeason(), cultivar, zone: lot.zone, cut: lot.cut_number });

  const tags = await getLotTags(db, sessionId, isTest);

  // Taking down a whole bay: the screen names the bay and its zone mix, and
  // closes out the bay rather than the lot.
  let bayCard = null;
  if (bay) {
    const info = await getBayTakedown(db, isTest, await getRecentLots(db, isTest));
    bayCard = info.cards.find(c => c.bay === bay && c.cultivar === lot.cultivar
      && Number(c.cut) === Number(lot.cut_number ?? 1)
      && c.zones.some(z => (z.lot.session_ids || [z.lot.id]).includes(sessionId))) || null;
  }

  return renderPage(ui, `${ui.t('printTags')} — ${bayCard ? ui.t('bayN', { n: bay }) : lot.zone}`,
    sackSessionBody(ui, { lot, cultivar, stats, tags, bay, storage, finishedAt, variantCheck, flash, bayCard }));
}

/**
 * Where to pick a started lot back up (Koa, 2026-09-28: "once a lot is
 * started, I'd like to be able to re-open it").
 *
 * The cultivar and bay its newest tag went out with, so Resume does not ask for
 * them again — the rack has not moved. Voided tags count here: a void retires a
 * number, not the rack it came off. Storage carries over only from the same
 * Pacific day, the same rule as the picker's default, because a guessed
 * location is worse than an empty one.
 */
async function getLotResume(db, lot) {
  const f = lotSessionsWhere(lot);
  const last = await queryOne(db, `
    SELECT cultivar, bay, storage, printed_at FROM harvest_sacks
    WHERE is_test = ? AND zone_session_id IN (SELECT id FROM harvest_scan_log WHERE ${f.where})
    ORDER BY printed_at DESC, serial DESC LIMIT 1
  `, [lot.is_test, ...f.params]);
  const today = !!last?.printed_at && pacificDay(parseSqliteUtc(last.printed_at)) === pacificToday();
  return {
    cultivar: last?.cultivar || lot.cultivar || '',
    bay: last?.bay ?? null,
    storage: today ? (last.storage || null) : null,
  };
}

/** GET ?action=lot_resume&session_id= — straight back onto a lot's takedown screen. */
async function handleLotResume(ui, db, env, params) {
  const sessionId = parseInt(params.session_id, 10);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    throw createError('VALIDATION_ERROR', ui.t('pickLotFirst'));
  }
  const lot = await requireLot(db, sessionId);
  const resume = await getLotResume(db, lot);
  // A bay card's Resume names its bay: the lot's newest tag may have come out
  // of another bay the same zone was hung in.
  if (params.bay) resume.bay = parseBay(params.bay, ui);
  const flash = String(params.reopened || '') === '1' ? ui.t('lotReopened', { lot: lotLabel(ui, lot, resume.cultivar) }) : null;
  return handleSackSession(ui, db, env, { session_id: sessionId, ...resume }, flash);
}

/**
 * Refuse a write to a REAL row while the system is in test mode.
 *
 * Test mode marks what it creates as test data and skips Shopify, but a row
 * that already exists carries its own flag — and a real tag scanned on a test
 * day is exactly the case this exists for: the bag is real, its number is
 * spent, and voiding or opening it is not a rehearsal. The read is untouched,
 * so the page still shows the bag; only the write is refused.
 */
function refuseRealInTest(ui, env, row) {
  if (!row || !isTestMode(env)) return;
  if (Number(row.is_test) === 0) throw createError('VALIDATION_ERROR', ui.t('testRealRow'));
}

async function requireLot(db, sessionId) {
  const lot = await queryOne(db, `SELECT * FROM harvest_scan_log WHERE id = ? AND event_type = 'enter'`, [sessionId]);
  if (!lot) throw createError('NOT_FOUND', `No harvest lot found for session ${sessionId}.`);
  return lot;
}

/**
 * Every enter session of the lot this session belongs to, as a WHERE clause.
 * The same four parts as lotKey(), in SQL, so closing a lot out reaches a
 * second crew's session and a same-shift re-entry as well as the primary.
 */
function lotSessionsWhere(lot) {
  return {
    where: `event_type = 'enter' AND is_test = ? AND zone = ? AND COALESCE(cultivar, '') = ?
            AND cut_number IS ? AND COALESCE(season, ?) = ?`,
    params: [lot.is_test, lot.zone, lot.cultivar || '', lot.cut_number, getSeason(), lot.season || getSeason()],
  };
}

async function getLotFinish(db, lot) {
  const f = lotSessionsWhere(lot);
  const sessions = await query(db, `SELECT takedown_done_at FROM harvest_scan_log WHERE ${f.where}`, f.params);
  return lotFinishedAt(sessions);
}

function lotLabel(ui, lot, cultivar = lot.cultivar) {
  return `${lot.zone}${cultivar ? ` · ${cultivar}` : ''} ${ui.t('cut', { n: lot.cut_number ?? '?' })}`;
}

/** A UTC SQLite timestamp as the Pacific calendar date the crew lived it on. */
function finishedDate(ui, at) {
  return formatTagDate(ui.lang, pacificDay(parseSqliteUtc(at)));
}

/**
 * Close a takedown lot out, or reopen it. Koa, 2026-09-15: "we might need to
 * add a "Finished" button or something to close out that batch. the batch of 15
 * 1st cut is still open however its all finished".
 *
 * Nothing else records the end of a takedown. The picker only knows a lot has
 * tags, so a fully bagged lot sat at STARTED for the whole picker window, above
 * the lots really coming down.
 *
 * Finished means "no more tags off this lot" — NOT "these sacks left". It
 * touches no sack, no storage and no Shopify count, and one press undoes it,
 * because someone will press it with a sack still on the rack.
 *
 * It does not close the rack board's `coming_down` either: a bay's current fill
 * can hold several lots, so one lot finishing is not the bay standing empty.
 */
async function handleLotFinish(ui, db, env, ctx, body) {
  const sessionId = parseInt(body.session_id, 10);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    throw createError('VALIDATION_ERROR', ui.t('pickLotFirst'));
  }
  const reopen = String(body.reopen ?? '') === '1';

  const lot = await requireLot(db, sessionId);
  refuseRealInTest(ui, env, lot);
  const f = lotSessionsWhere(lot);
  // Stamps only the sessions still open, so pressing Finished twice keeps the
  // first time; a reopen clears every one.
  const r = reopen
    ? await execute(db, `UPDATE harvest_scan_log SET takedown_done_at = NULL
                         WHERE ${f.where} AND takedown_done_at IS NOT NULL`, f.params)
    : await execute(db, `UPDATE harvest_scan_log SET takedown_done_at = ?
                         WHERE ${f.where} AND takedown_done_at IS NULL`, [sqliteUtc(new Date()), ...f.params]);

  const row = await queryOne(db, `
    SELECT COUNT(*) AS n FROM harvest_sacks
    WHERE voided_at IS NULL AND is_test = ?
      AND zone_session_id IN (SELECT id FROM harvest_scan_log WHERE ${f.where})
  `, [lot.is_test, ...f.params]);
  const sacks = row?.n || 0;
  const label = lotLabel(ui, lot);

  if (r.changes > 0) {
    ctx.waitUntil(sendTelegramMessage(env, {
      chatId: env.TELEGRAM_TEST_CHAT_ID,
      text: reopen
        ? `↩️ Takedown reopened — *${lot.cultivar || '?'}* ${lot.zone} cut ${lot.cut_number}.`
        : `✅ Takedown finished — *${lot.cultivar || '?'}* ${lot.zone} cut ${lot.cut_number}: ${sacks} sack${sacks === 1 ? '' : 's'}.`,
    }).catch(e => console.error('[harvest][telegram]', e)));
  }

  // Reopening is done to print more, so it lands on the lot's takedown screen.
  // A redirect rather than rendering it here: a reload of a POST would reopen
  // again, and the address bar should say where the crew actually is.
  if (reopen) {
    return new Response(null, { status: 303, headers: {
      Location: `${API}?action=lot_resume&session_id=${sessionId}&reopened=1&lang=${ui.lang}` } });
  }
  return handleSackPrintForm(ui, db, env, ui.t('lotFinished', { lot: label, n: sacks }));
}

// Voided tags are excluded from the count — they were never a sack.
//
// The LAST tag is the newest by print time, then serial — never MAX(sack_id).
// Sack ids are text, so "26-RAINGQ-4" sorts after "26-RAINGQ-20": the takedown
// screen named #4 as the last tag once a lot passed #9, and Void acts on
// whichever tag the screen names.
async function getLotTagStats(db, sessionId, isTest) {
  const [row, last] = await Promise.all([
    queryOne(db, `SELECT COUNT(*) AS printed FROM harvest_sacks
                  WHERE zone_session_id = ? AND is_test = ? AND voided_at IS NULL`, [sessionId, isTest]),
    queryOne(db, `SELECT sack_id FROM harvest_sacks
                  WHERE zone_session_id = ? AND is_test = ? AND voided_at IS NULL
                  ORDER BY printed_at DESC, serial DESC LIMIT 1`, [sessionId, isTest]),
  ]);
  return { printed: row?.printed || 0, lastSackId: last?.sack_id || null };
}

/**
 * Every tag on this lot, newest first, for the takedown screen's list — so any
 * of them can be reprinted or voided, not only the last (Koa, 2026-09-28).
 * Same scope and order as getLotTagStats, so the list's top row is the tag the
 * screen calls "Last". Voided tags stay in, marked, with no actions: seeing the
 * void land is the confirmation. `at` is ISO UTC; the page shows it in Pacific.
 */
async function getLotTags(db, sessionId, isTest) {
  const rows = await query(db, `
    SELECT sack_id, printed_at, voided_at, opened_at, fill_lbs FROM harvest_sacks
    WHERE zone_session_id = ? AND is_test = ?
    ORDER BY printed_at DESC, serial DESC
  `, [sessionId, isTest]);
  return rows.map(r => ({
    id: r.sack_id,
    at: r.printed_at ? parseSqliteUtc(r.printed_at).toISOString() : null,
    voided: !!r.voided_at,
    opened: !!r.opened_at,
    fill: r.fill_lbs ?? null,
  }));
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
  // A note typed before PRINT TAG belongs to the bag that tag goes on (Koa,
  // 2026-09-16: "the note should pertain to the next tag that gets printed").
  // It is written in the same transaction as the tag, so a note can never land
  // on a different bag or survive a print that failed. One bag, one tag: a
  // batch is several bags and cannot share it, so it is refused before any
  // serial is spent rather than guessed onto one of them.
  const note = String(body.note || '').trim().substring(0, 500);
  if (note && qty !== 1) {
    throw createError('VALIDATION_ERROR', 'A note goes on one tag — print it with PRINT TAG, not a batch.');
  }
  // The bag's own weight when it is not a full sack — the last of a lot, most
  // often (Koa, 2026-09-28). Same one-bag rule as the note, for the same reason.
  let fillLbs;
  try { fillLbs = parseFillLbs(body.fill_lbs); }
  catch (e) { throw createError('VALIDATION_ERROR', e.message); }
  if (fillLbs !== null && qty !== 1) {
    throw createError('VALIDATION_ERROR', 'A bag weight goes on one tag — print it with PRINT TAG, not a batch.');
  }

  const lot = await requireLot(db, sessionId);
  // Test mode never adds to a real lot: those tags would hang off real bins.
  refuseRealInTest(makeUi(new Request('https://x/')), env, lot);
  // A finished lot takes no more tags until it is reopened. The session screen
  // disables PRINT TAG, but a second phone still on the old page must not
  // spend a serial on a closed lot — so the server refuses, before allocating.
  if (await getLotFinish(db, lot)) {
    throw createError('VALIDATION_ERROR', 'This lot is marked finished — reopen it from Print Sack Tags to print more.');
  }
  const isTest = isTestMode(env) ? 1 : 0;
  const season = getSeason();
  const harvestDate = String(lot.occurred_at).substring(0, 10);
  // Bay is set once at Start takedown and rides every sack of the session. It
  // prints on the tag, so a wrong one is visible on the first label rather than
  // discovered in analysis — which is the only defence a location field gets.
  const bay = parseBay(body.bay);
  // Where the sacks go once they are down. Same once-per-session shape as the
  // bay, and validated before a serial is spent for the same reason.
  const storage = parseStorage(body.storage);
  const storedAt = storage ? sqliteUtc(new Date()) : null;

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
  // Per cut as well (Koa, 2026-09-16): a second cut starts again at #1, and the
  // sack id carries the cut so the two #1s stay distinct (formatSackId).
  const row = await queryOne(db, `
    SELECT COALESCE(MAX(serial), 0) AS max_serial FROM harvest_sacks
    WHERE season = ? AND cultivar_code = ? AND COALESCE(cut_number, 1) = COALESCE(?, 1)
  `, [season, code, lot.cut_number]);
  const startSerial = (row?.max_serial || 0) + 1;

  const ids = [];
  const statements = [];
  for (let i = 0; i < qty; i++) {
    const serial = startSerial + i;
    const sackId = formatSackId(season, code, serial, lot.cut_number);
    ids.push(sackId);
    statements.push({
      sql: `INSERT INTO harvest_sacks
              (sack_id, season, serial, cultivar_code, sku, zone, cultivar, cut_number, harvest_date, zone_session_id, bay, storage, stored_at, is_test, fill_lbs)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [sackId, season, serial, code, supersackSku(code, season),
               lot.zone, cultivar, lot.cut_number, harvestDate, lot.id, bay, storage, storedAt, isTest, fillLbs],
    });
  }
  if (note) {
    statements.push({
      sql: `INSERT INTO harvest_sack_notes (sack_id, note, is_test) VALUES (?, ?, ?)`,
      params: [ids[0], note, isTest],
    });
  }

  // One print job per tag, in the SAME batch as the sacks. A job must not be
  // able to exist for a tag that was not allocated, nor survive an allocation
  // that failed — the same rule the note above follows.
  statements.push(...enqueueStatements({ sackIds: ids, isTest }));
  await transaction(db, statements);

  const stats = await getLotTagStats(db, sessionId, isTest);

  // A printed tag means a sack now exists, so the count goes up by one each.
  // One call for the batch, not one per tag. After the rows are committed and
  // inside waitUntil: printing must not wait on, or fail because of, an
  // external call — the crew is standing at the printer.
  if (!isTestMode(env)) {
    const ph = ids.map(() => '?').join(',');
    ctx.waitUntil((async () => {
      // Claim the attempt first — see IN_FLIGHT. If this job is evicted between
      // here and the answer, the row says so instead of saying nothing.
      await execute(db, `UPDATE harvest_sacks SET shopify_add_error = ? WHERE sack_id IN (${ph})`,
        [inFlight('add'), ...ids]);
      const r = await adjustSupersackCount(env, {
        db,
        season, cultivar, zone: lot.zone, cut: lot.cut_number, delta: qty,
        note: `[Harvest] ${qty} tag${qty === 1 ? '' : 's'} printed — ${ids[0]}${qty > 1 ? `–${ids[ids.length - 1]}` : ''} (${lot.zone} cut ${lot.cut_number})`,
      });
      await execute(db, `
        UPDATE harvest_sacks
        SET shopify_added_at = ?, shopify_add_error = ?, shopify_variant_id = COALESCE(shopify_variant_id, ?),
            shopify_sync_error = ${ADD_LANDED_AFTER_OUT_SQL}
        WHERE sack_id IN (${ph})
      `, [r.ok ? new Date().toISOString() : null, r.error, r.variantId, r.ok ? 1 : 0, ...ids]);
      if (!r.ok) console.error(`[harvest][inventory] add ${ids.length}: ${r.error}`);
    })().catch(e => console.error('[harvest][inventory]', e)));
  }

  ctx.waitUntil(sendTelegramMessage(env, {
    chatId: env.TELEGRAM_TEST_CHAT_ID,
    text: `🏷️ ${qty} sack tag${qty === 1 ? '' : 's'} — *${cultivar}* ${lot.zone} cut ${lot.cut_number} (${ids[0]}${qty > 1 ? `–${ids[ids.length - 1]}` : ''}). ${stats.printed} for this lot.${note ? `\n📝 ${note}` : ''}`,
  }).catch(e => console.error('[harvest][telegram]', e)));

  // Resolved HERE, per allocation, and handed to the client with the ids —
  // never baked into the page. A phone can sit on a loaded takedown screen for
  // an hour; if it decided from render-time state it would print via its iframe
  // while the agent printed the same job. Two tags, one serial, mid-rack.
  const printVia = await resolvePrintVia(db);

  return successResponse({ success: true, ids, printed: stats.printed, last_sack_id: stats.lastSackId,
    tags: await getLotTags(db, sessionId, isTest), note_on: note ? ids[0] : null,
    fill_on: fillLbs !== null ? ids[0] : null, fill_lbs: fillLbs, print_via: printVia });
}

/* ---------------------------------------------------------------------------
 * Print agent endpoints
 *
 * The barn PC runs an agent that drains the print queue and drives the printer,
 * so the crew can print from ANY phone — iOS included, where WebKit ignores
 * `@page` and the 4x2 tag cannot be printed from the browser at all.
 * See wiki/operations/plans/2026-09-18-wireless-tag-printer.md
 *
 * These are machine-to-machine and carry their own shared secret, not the crew
 * password (requireAgentAuth). All are POST.
 * ------------------------------------------------------------------------- */

/** The agent asks for work. Claims what it returns, so a job goes out once. */
async function handlePrintPull(db, env, body) {
  requireAgentAuth(env, body);
  const agentId = String(body.agent_id || 'barn-pc').substring(0, 60);
  const isTest = isTestMode(env) ? 1 : 0;
  // The heartbeat rides the pull: an agent that is asking for work is by
  // definition alive, so there is no window where it is printing but reads
  // offline to sack_alloc.
  await recordHeartbeat(db, agentId, String(body.printer || '').substring(0, 120) || null);
  // An agent that crashed mid-job, or a barn PC that rebooted, leaves rows
  // claimed forever — pullJobs only takes 'pending'. Those tags would never
  // print and nobody would be told, so reclaim them on the way past.
  await requeueStale(db);
  const jobs = await pullJobs(db, {
    agentId,
    limit: Math.min(parseInt(body.limit, 10) || PULL_LIMIT, PULL_LIMIT),
    isTest,
  });
  // The printer name comes down with the work, so swapping to the spare Zebra
  // is one settings line rather than a trip to the barn PC to edit env vars.
  return successResponse({ success: true, jobs, printer: await resolvePrinter(db) });
}

/** The agent reports what physically happened. */
async function handlePrintAck(db, env, body) {
  requireAgentAuth(env, body);
  const jobId = parseInt(body.job_id, 10);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw createError('VALIDATION_ERROR', 'Missing job_id.');
  }
  const ok = body.ok === true || body.ok === 'true' || body.ok === 1 || body.ok === '1';
  await ackJob(db, { jobId, ok, error: body.error });
  return successResponse({ success: true });
}

/** Keeps the agent trusted between racks, when nothing is printing. */
async function handlePrintHeartbeat(db, env, body) {
  requireAgentAuth(env, body);
  const agentId = String(body.agent_id || 'barn-pc').substring(0, 60);
  await recordHeartbeat(db, agentId, String(body.printer || '').substring(0, 120) || null);
  return successResponse({ success: true });
}

/**
 * Is an agent alive, and which way will the next tag print? Unauthenticated on
 * purpose: it exposes no tag data, and the crew screen needs it to warn BEFORE
 * a serial is spent.
 */
async function handlePrintStatus(db) {
  const [online, via] = await Promise.all([agentOnline(db), resolvePrintVia(db)]);
  const pending = await queryOne(db, `
    SELECT COUNT(*) AS n FROM harvest_print_queue WHERE status IN ('pending', 'claimed')
  `);
  return successResponse({
    success: true, agent_online: online, print_via: via, pending: pending?.n || 0,
  });
}

/**
 * Queue a reprint — the jam path, from the crew screen.
 *
 * Same serial, no new sack row. This is a POST rather than the old plain link
 * to the label page because that link was a BROWSER print, which in agent mode
 * on an iPhone is exactly the path WebKit breaks. Reprint is the crew's most
 * time-critical recovery; it must work on every handset.
 */
async function handlePrintReprint(db, env, body) {
  const sackId = String(body.sack_id || '').trim().substring(0, 40);
  if (!sackId) throw createError('VALIDATION_ERROR', 'Missing sack_id.');
  const sack = await queryOne(db, `SELECT sack_id FROM harvest_sacks WHERE sack_id = ?`, [sackId]);
  if (!sack) throw createError('NOT_FOUND', `No such tag: ${sackId}`);

  // THE SERVER DECIDES, and only queues when the agent will actually print.
  // The client must not answer this from a variable it set at its last
  // allocation: a screen freshly loaded in agent mode has allocated nothing, so
  // a page-held default would send the crew's jam recovery down the browser
  // path — the one WebKit breaks on iPhone — at the worst possible moment.
  const printVia = await resolvePrintVia(db);
  if (printVia === 'agent') {
    await enqueueReprint(db, { sackId, isTest: isTestMode(env) ? 1 : 0 });
  }
  return successResponse({ success: true, sack_id: sackId, print_via: printVia });
}

/**
 * Did these tags actually come out? Polled by the crew screen in agent mode.
 *
 * The screen must not show a tick on the strength of a queue insert: the serial
 * is already spent and the Shopify count already moved, so "queued" and
 * "printed" are very different facts to a person standing at a printer.
 */
async function handlePrintCheck(db, body) {
  const ids = Array.isArray(body.ids) ? body.ids.slice(0, 40).map(String) : [];
  return successResponse({ success: true, status: await jobStatusFor(db, ids) });
}

/**
 * The outstanding inventory debts, for a screen to show.
 *
 * Same rows the sweep repairs, through the same SQL — a screen that could
 * disagree with the repair tool would teach the crew to ignore it.
 */
async function loadInventoryDebts(db, env) {
  const rows = await query(db, `
    SELECT sack_id, voided_at, shopify_added_at, shopify_add_error,
           opened_at, shopify_synced_at, shopify_sync_error
    FROM harvest_sacks
    WHERE is_test = ? AND (${DEBT_SQL})
    ORDER BY printed_at DESC
  `, [isTestMode(env) ? 1 : 0]);
  return summariseDebts(rows);
}

/**
 * What the inventory owes, and a way to pay it — `?action=inventory_sweep`.
 *
 * Every row that failed above is left retryable on purpose, so something has to
 * find them. Two debts exist:
 *
 *   owed -1   a voided tag Shopify still counts
 *   owed +1   a printed, unvoided tag that never reached Shopify
 *
 * Reports by default. `apply` replays the DEFINITE failures — the ones where
 * the script answered and said no. Rows stuck IN_FLIGHT are listed but not
 * touched: nobody knows whether that call landed, and replaying a call that
 * did land moves the count the wrong way just as silently. Check the variant in
 * Shopify, then `force` them.
 */
async function handleInventorySweep(request, db, env, ctx, body, params) {
  requireAuth(request, body, env, 'harvest-inventory-sweep');
  const apply = truthy(body.apply ?? params.apply);
  const force = truthy(body.force ?? params.force);
  const isTest = isTestMode(env) ? 1 : 0;

  const rows = await query(db, `
    SELECT sack_id, season, cultivar, zone, cut_number, shopify_variant_id,
           shopify_added_at, shopify_add_error, voided_at,
           opened_at, shopify_synced_at, shopify_sync_error
    FROM harvest_sacks
    WHERE is_test = ? AND (${DEBT_SQL})
    ORDER BY printed_at
  `, [isTest]);

  const out = [];
  for (const row of rows) {
    const { owes: delta, state, kind, error } = classifyDebt(row);
    const unknown = state === 'unknown';
    const item = {
      sack_id: row.sack_id, owes: delta, state, kind,
      error, acted: false, ok: null,
    };
    // owes 0 is shown, never acted on — not even forced: there is no move
    // that is right whichever way the unanswered call went.
    if (apply && delta !== 0 && (!unknown || force)) {
      // The list above was read once; each call below takes seconds, and the
      // floor keeps scanning. Re-read THIS row now and act only if it still
      // owes exactly what it owed (P2/P2b/P3/P4, 2026-10-06).
      const col = (kind === 'out' || kind === 'undo') ? 'shopify_sync_error' : 'shopify_add_error';
      const fresh = await queryOne(db, `
        SELECT sack_id, shopify_added_at, shopify_add_error, voided_at,
               opened_at, shopify_synced_at, shopify_sync_error
        FROM harvest_sacks WHERE sack_id = ? AND (${DEBT_SQL})
      `, [row.sack_id]);
      const now = fresh && classifyDebt(fresh);
      const same = now && now.kind === kind && now.owes === delta && now.state === state
        && (fresh[col] ?? null) === (row[col] ?? null)
        && !isLiveInFlight(fresh[col]); // even force never doubles a live call
      // One pool operation per sack at a time: lay the marker BEFORE the call,
      // guarded on the exact value read, so a second sweep or a floor action
      // that got there first wins and this one stands down.
      const isNull = (v) => (v ? 'IS NOT NULL' : 'IS NULL');
      const shape = `opened_at ${isNull(fresh?.opened_at)} AND voided_at ${isNull(fresh?.voided_at)}`;
      const marker = inFlight(`sweep ${kind}`);
      const laid = same && await execute(db,
        `UPDATE harvest_sacks SET ${col} = ? WHERE sack_id = ? AND ${col} IS ? AND ${shape}`,
        [marker, row.sack_id, fresh[col] ?? null]);
      if (!laid || !laid.changes) {
        item.changed = true;
        out.push(item);
        continue;
      }
      const r = await adjustSupersackCount(env, {
        db,
        season: row.season, cultivar: row.cultivar, zone: row.zone, cut: row.cut_number,
        variantId: delta < 0 ? row.shopify_variant_id : null, delta,
        note: `[Harvest] sweep ${delta < 0 ? 'rollback' : 'add'} — ${row.sack_id}`,
      });
      item.acted = true;
      item.ok = r.ok;
      item.error = r.ok ? null : r.error;
      // Every write-back is guarded on OUR marker still being there: if the
      // crew moved the sack meanwhile, they replaced it, and the row now says
      // what a person must check rather than what this call assumed.
      const mine = `sack_id = ? AND ${col} = ?`;
      if (kind === 'undo') {
        await execute(db, `UPDATE harvest_sacks SET shopify_sync_error = ? WHERE ${mine} AND ${shape}`,
          [r.ok ? null : `undo add-back failed: sweep failed: ${r.error}`, row.sack_id, marker]);
      } else if (kind === 'out') {
        await execute(db, `UPDATE harvest_sacks SET shopify_synced_at = ?, shopify_sync_error = ? WHERE ${mine} AND ${shape}`,
          [r.ok ? new Date().toISOString() : null, r.ok ? null : `sweep failed: ${r.error}`, row.sack_id, marker]);
      } else if (r.ok && delta < 0) {
        await execute(db, `UPDATE harvest_sacks SET shopify_added_at = NULL, shopify_add_error = NULL, shopify_sync_error = NULL WHERE ${mine} AND ${shape}`,
          [row.sack_id, marker]);
      } else if (r.ok) {
        // An add may land on a sack scanned out while it was in flight (P4):
        // the scan sent no -1, so the row becomes an out-debt (CASE), not lost.
        await execute(db, `
          UPDATE harvest_sacks
          SET shopify_added_at = ?, shopify_add_error = NULL, shopify_variant_id = COALESCE(shopify_variant_id, ?),
              shopify_sync_error = ${ADD_LANDED_AFTER_OUT_SQL}
          WHERE ${mine} AND voided_at ${isNull(fresh.voided_at)}
        `, [new Date().toISOString(), r.variantId, 1, row.sack_id, marker]);
      } else {
        await execute(db, `UPDATE harvest_sacks SET shopify_add_error = ? WHERE ${mine}`,
          [`sweep failed: ${r.error}`, row.sack_id, marker]);
      }
    }
    out.push(item);
  }

  return successResponse({
    success: true,
    applied: apply,
    forced: force,
    owed_minus: out.filter(o => o.owes < 0).length,
    owed_plus: out.filter(o => o.owes > 0).length,
    unknown: out.filter(o => o.state === 'unknown').length,
    note: 'A row marked unknown started a call that never answered — it may or may not have landed. Check the variant in Shopify before forcing it.',
    rows: out,
  });
}

/**
 * Read or flip test mode (Koa, 2026-09-18). Password-gated like every other
 * number on the dashboard: this decides whether the season's records are real.
 *
 * GET reports the state and where it came from; POST { on: true|false } sets
 * the override row. Flipping it OFF does not delete anything — the test rows
 * stay until someone clears them, which is deliberate: they are the evidence
 * of what a test day did.
 */
async function handleTestMode(request, db, env, body) {
  requireAuth(request, body, env, 'harvest-test-mode');
  if (request.method === 'POST' && body.on !== undefined) {
    if (isPreviewBuild(env)) {
      // The switch is shared with the live worker: flipping it from a preview
      // would change what the floor is recording.
      throw createError('VALIDATION_ERROR', 'This is a preview build: it is always in test mode, and cannot change the farm switch.');
    }
    const on = body.on === true || body.on === 'true' || body.on === 1 || body.on === '1';
    await setTestMode(db, on, 'dashboard');
    return successResponse({ success: true, test_mode: on, source: 'setting' });
  }
  const row = await queryOne(db, `SELECT value, updated_at FROM harvest_settings WHERE key = 'test_mode'`);
  const counts = await queryOne(db, `
    SELECT (SELECT COUNT(*) FROM harvest_scan_log WHERE is_test = 1) AS scans,
           (SELECT COUNT(*) FROM harvest_sacks WHERE is_test = 1) AS sacks
  `);
  return successResponse({
    success: true,
    test_mode: isTestMode(env),
    source: row ? 'setting' : 'deployed default',
    changed_at: row ? row.updated_at : null,
    test_rows: { scans: counts?.scans || 0, sacks: counts?.sacks || 0 },
  });
}

/**
 * Void a tag — the double-tap case: two serials issued, one sack. Voided
 * serials are never reused; a gap in the sequence is safe, a duplicate is not.
 */
async function handleSackVoid(db, env, ctx, body) {
  const sackId = String(body.sack_id || '').trim();
  const sack = await queryOne(db, `SELECT * FROM harvest_sacks WHERE sack_id = ?`, [sackId]);
  if (!sack) throw createError('NOT_FOUND', `No sack found with ID "${sackId}".`);
  refuseRealInTest(makeUi(new Request('https://x/')), env, sack);
  if (sack.opened_at) {
    throw createError('VALIDATION_ERROR', `Sack ${sackId} already has weights recorded — it can't be voided.`);
  }

  // No finished-lot check here, unlike sack_alloc, on purpose: retiring a
  // mistaken tag after the lot is closed out is a correction, not more
  // takedown. It spends no serial, and the rollback below keeps Shopify honest.
  // Void after a scan-out undo whose +1 back has not landed (the out's -1 did):
  // in flight -> wait; failed -> Shopify holds nothing for this tag, so the void
  // sends nothing and cancels the undo's debt instead.
  const undoErr = String(sack.shopify_sync_error || '');
  if (sack.shopify_added_at && isLiveInFlight(undoErr)) {
    throw createError('VALIDATION_ERROR', `Sack ${sackId} is still settling with Shopify — try again in a minute.`);
  }
  const undoFailed = !!sack.shopify_added_at && undoErr.startsWith('undo add-back failed');
  // Count already in doubt (a stale add-back, or "undone; check Shopify"):
  // Shopify holds 0 or 1 for this sack and the target is now 0. Void it, send
  // nothing (a -1 on a 0 is as wrong as a missing one), and keep it listed as
  // an unknown void debt so a person checks the variant.
  const voidUnknown = !!sack.shopify_added_at && undoErr.startsWith(IN_FLIGHT);
  const unknownText = `${undoErr.includes('check Shopify') ? undoErr : `${undoErr} — never answered`}`
    + ' — voided; check Shopify holds 0 for this sack';
  // Guarded on opened_at too: a scan-out that flipped the row after it was read
  // has already taken this tag's one off Shopify; a second -1 would end 2 low.
  const v = await execute(db, `
    UPDATE harvest_sacks SET voided_at = datetime('now')
      ${undoFailed ? ', shopify_added_at = NULL, shopify_sync_error = NULL' : ''}
      ${voidUnknown ? ', shopify_sync_error = ?' : ''}
    WHERE sack_id = ? AND voided_at IS NULL AND opened_at IS NULL
      ${voidUnknown ? 'AND shopify_sync_error = ?' : ''}
  `, voidUnknown ? [unknownText, sackId, undoErr] : [sackId]);
  if (!v || !v.changes) {
    throw createError('VALIDATION_ERROR', `Sack ${sackId} is already out or voided — it can't be voided.`);
  }

  const isTest = isTestMode(env) ? 1 : 0;
  const stats = await getLotTagStats(db, sack.zone_session_id, isTest);

  ctx.waitUntil(sendTelegramMessage(env, {
    chatId: env.TELEGRAM_TEST_CHAT_ID,
    text: `🚫 Voided tag *${sackId}* (${sack.cultivar || '?'} ${sack.zone}). ${stats.printed} for this lot.`,
  }).catch(e => console.error('[harvest][telegram]', e)));

  // Take back the +1 that printing added. A voided tag is a retired number with
  // no sack behind it; leaving the increment would be phantom inventory. Only
  // undo it if the add actually landed.
  if (!isTestMode(env) && sack.shopify_added_at && !undoFailed && !voidUnknown) {
    ctx.waitUntil((async () => {
      await execute(db, `UPDATE harvest_sacks SET shopify_add_error = ? WHERE sack_id = ?`,
        [inFlight('void rollback'), sackId]);
      const r = await adjustSupersackCount(env, {
        db,
        season: sack.season, cultivar: sack.cultivar, zone: sack.zone, cut: sack.cut_number,
        // Where this sack's +1 landed, so the -1 takes it off the same count.
        variantId: sack.shopify_variant_id, delta: -1,
        note: `[Harvest] ${sackId} voided — tag retired with no sack`,
      });
      // THE MARKER ONLY CLEARS ON SUCCESS. Clearing it on failure was the
      // second half of the 2026-09-22 mess: shopify_added_at is the record that
      // Shopify still holds this tag's +1, and dropping it on a failed rollback
      // threw away both the truth and the only handle a retry has.
      if (r.ok) {
        await execute(db, `
          UPDATE harvest_sacks SET shopify_added_at = NULL, shopify_add_error = NULL WHERE sack_id = ?
        `, [sackId]);
      } else {
        await execute(db, `UPDATE harvest_sacks SET shopify_add_error = ? WHERE sack_id = ?`,
          [`void rollback failed: ${r.error}`, sackId]);
        console.error(`[harvest][inventory] void ${sackId}: ${r.error}`);
      }
    })().catch(e => console.error('[harvest][inventory]', e)));
  }

  return successResponse({ success: true, voided: sackId, printed: stats.printed, last_sack_id: stats.lastSackId,
    tags: await getLotTags(db, sack.zone_session_id, isTest) });
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

  // ?calibrate=1 on the thermal path: specimen tags for proving a printer
  // without burning a bag number. Never auto-prints, never writes.
  if (params.calibrate === '1') {
    const banner = `<div class="banner">
      <strong>Specimen tags — not real bags.</strong> Nothing was allocated and no number was used up.
      One tag per cultivar-name length, because the name font steps down as it gets longer.
      <br><br><strong>Scan the first one</strong> (Sour Lifter #142) — it opens the sack page with example data, so you
      can see what a scan actually shows. Nothing is saved from that page, including the buttons.
      <br><br><strong>The other two are print checks:</strong> they carry the longest name and the widest bag number the
      season can produce, and their QRs point at bags that do not exist — so a <em>&ldquo;no sack&rdquo;</em> page means
      the code scanned <strong>correctly</strong>.
      <br><br><strong>Check:</strong> the tag measures 4&Prime; × 2&Prime;, no cultivar name is clipped, and every QR reads
      first time. If one will not scan, raise the print density in the driver before changing anything else.
      </div>`;
    return renderLabelSheet(ui, specimenSacks(), null,
      { autoPrint: false, banner, stock: params.stock });
  }

  // ?examples=1 — the two hand-out tags. Separate from ?calibrate=1, which is
  // three tags chosen to stress the printer rather than to be given to anyone.
  if (params.examples === '1') {
    const banner = ui.lang === 'es'
      ? `<div class="banner">
      <strong>Dos etiquetas de ejemplo</strong> — Sour Lifter y Lifter.
      <br><br><strong>Escanea cualquiera de las dos.</strong> Abre la página real de la bolsa, con el recorrido
      completo: sembrada, cortada, embolsada, abierta y los pesos. Nada de lo que toques ahí se guarda.
      <br><br>Todo en la etiqueta es real: variedad, código, zona, bahía, fecha y número de bolsa.
      <br><br>No se creó ninguna fila, así que <strong>no se gastó ningún número de serie</strong>. Si algún día
      la temporada llega a imprimir estos números de verdad, esa bolsa real se queda con su número y estas
      etiquetas dejan de servir de ejemplo — nunca al revés.
      </div>`
      : `<div class="banner">
      <strong>Two example tags</strong> — Sour Lifter and Lifter.
      <br><br><strong>Scan either one.</strong> It opens the real sack page with the full journey — planted, cut,
      bagged, opened, and the weights. Nothing you press there is saved.
      <br><br>Everything on the tag is real: cultivar, code, zone, bay, date and bag number.
      <br><br>No rows were created, so <strong>no serial numbers were used up</strong>. If the season ever prints
      these numbers for real, that bag keeps its own number and these tags stop working as examples — never the
      other way round.
      </div>`;
    return renderLabelSheet(ui, exampleTagSacks(), null,
      { autoPrint: false, banner, stock: params.stock });
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
  // ?popup=1 — opened as a throwaway print tab by the takedown screen on iOS,
  // where a hidden iframe cannot print (WebKit scopes window.print() to the top
  // document). It closes itself once printing is done so the crew lands back on
  // the takedown screen instead of piling up tabs, one per sack, all day.
  // ?back=1 — reached by navigation from the takedown screen running as an
  // iOS home-screen app, where there is no tab to open or close. The page
  // offers a way back instead of closing itself.
  //
  // app_print_box — the printable box the home-screen app is assumed to have,
  // 'WxH' in inches, for every phone at once (see print-client.js). Read here
  // so a wrong guess is one D1 row rather than a deploy. Absent means default.
  const boxRow = await queryOne(db, `SELECT value FROM harvest_settings WHERE key = 'app_print_box'`);
  return renderLabelSheet(ui, sacks, null, {
    autoPrint: params.preview !== '1',
    popup: String(params.popup || '') === '1',
    back: String(params.back || '') === '1',
    appBox: boxRow ? String(boxRow.value || '') : '',
  });
}

async function handleSackWeigh(ui, db, env, ctx, body) {
  const sackId = String(body.sack_id || '').trim();
  refuseRealInTest(ui, env, await queryOne(db, `SELECT is_test FROM harvest_sacks WHERE sack_id = ?`, [sackId]));
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
        db,
        season: sack.season, cultivar: sack.cultivar, zone: sack.zone, cut: sack.cut_number,
        // Where this sack's +1 landed, so the -1 takes it off the same count.
        variantId: sack.shopify_variant_id, delta: -1,
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
/**
 * A scannable sack that does not exist.
 *
 * Showing someone the scan screen used to mean tagging a real bag, which burns
 * a serial that can only be voided, never reused -- an expensive way to look at
 * a layout. /s/DEMO renders the same page from synthetic data: no row, no
 * serial, nothing to clean up afterwards, and it keeps working after every
 * clear-down of test data.
 *
 * Numbers come from the real Z4 facts so the proportions are honest -- a demo
 * with invented acreage teaches the wrong thing about what the page shows.
 *
 * ?opened=1 shows the state after ABRIR BOLSA, with floor-allocated weights.
 * ?voided=1 shows a retired number, which has no sack behind it to open.
 */
/**
 * The example sacks, one per cultivar Koa hands out as a physical specimen.
 *
 * THESE CARRY REAL BAG NUMBERS (Koa, 2026-09-07: "give it an actual bag #") —
 * a specimen should look like the thing it is a specimen of, and `#DEMO` on the
 * tag did not.
 *
 * The collision that buys is handled by ORDER, not by the id: every scan looks
 * the bag up for real FIRST and only falls through to these when no such row
 * exists. So the day the season actually prints `26-SLIFT-142`, that bag wins
 * its own number and the example quietly stops being an example — which is the
 * right way round. A laminated tag that outlives the season is allowed to go
 * stale; it is not allowed to show fake weights for a real bag.
 *
 * The serials are high on purpose, so that day is late if it comes at all.
 *
 * The five parts sum to the 35 lb that went into the sack (a 2026-crop bag), because that is how
 * the real figures behave: waste is the remainder, not a reading. Lifter is
 * given a lower tops share than Sour Lifter, which is the direction the real
 * supersack data actually goes — a demo with the ranking backwards teaches the
 * wrong thing.
 */
const DEMO_SACKS = {
  '26-SLIFT-142': {
    serial: 142, code: 'SLIFT', cultivar: 'Sour Lifter', zone: 'Z4', cut: 1, bay: 7, storage: 'Supermarket', lotSacks: 14,
    parts: { tops: 20.2, smalls: 11.3, biomass: 2.0, trim: 1.1, waste: 0.4 },
    notes: [
      { note: 'Bottom of the rack was still damp — held back a day.', at: '16:05:00' },
      { note: 'Tape said Z4 cut 1, matches the lot picker.', at: '14:22:00' },
    ],
  },
  '26-LIFT-87': {
    serial: 87, code: 'LIFT', cultivar: 'Lifter', zone: 'Z19', cut: 1, bay: 11, storage: '3', lotSacks: 9,
    parts: { tops: 17.2, smalls: 13.8, biomass: 2.5, trim: 1.2, waste: 0.3 },
    notes: [
      { note: 'Top bay, dried fast — came down two days early.', at: '15:40:00' },
      { note: 'Z19 cut 1, whole plant.', at: '15:38:00' },
    ],
  },
};

const DEMO_SACK_ID = '26-SLIFT-142';

/**
 * Which example sack an id names, or null for a real one.
 *
 * Bare `DEMO` still resolves — it is printed on the calibration specimen sheet
 * and may be on a laminated tag already.
 */
function demoKey(id) {
  const raw = String(id || '').trim().toUpperCase();
  if (!raw) return null;
  if (raw === 'DEMO') return DEMO_SACK_ID;
  return Object.prototype.hasOwnProperty.call(DEMO_SACKS, raw) ? raw : null;
}

function isDemoSack(id) {
  return demoKey(id) !== null;
}

/**
 * Says plainly that the page is a demo, and offers the other state.
 *
 * Without this the page is indistinguishable from a real sack, which is how a
 * demo ends up quoted as a measurement later.
 */
function demoBanner(ui, url, msg, id = DEMO_SACK_ID) {
  const es = ui.lang === 'es';
  const opened = url ? url.searchParams.get('opened') === '1' : true;
  const key = demoKey(id) || DEMO_SACK_ID;
  const other = opened ? `/s/${key}` : `/s/${key}?opened=1`;
  const otherLabel = opened
    ? (es ? 'ver sin abrir' : 'see it unopened')
    : (es ? 'ver ya abierta, con pesos' : 'see it opened, with weights');
  // The zone is read off the sack being shown, not hard-coded: with two example
  // sacks a fixed "Z4" was a plain lie on the Lifter one.
  const zone = (DEMO_SACKS[key] || {}).zone || 'Z4';
  const line = msg
    ? msg
    : (es
        ? `Bolsa de <strong>ejemplo</strong> — no existe. Los números son de la ${zone} real para que las proporciones sean honestas.`
        : `<strong>Example</strong> sack — it does not exist. The figures come from the real ${zone} so the proportions are honest.`);
  // Explicit dark text: the page body is white-on-dark-green, so a light
  // banner without its own colour inherits white and disappears.
  return `<div style="background:#fff4d6;border:1px solid #e0c86a;border-radius:6px;padding:11px 13px;margin:0 0 16px;font-size:14px;line-height:1.5;color:#3a2f05">
    ${line}<br><a href="${other}" style="color:#6b5200;font-weight:600">${otherLabel} →</a>
  </div>`;
}

function demoSackView(opened, voided, id = DEMO_SACK_ID) {
  const key = demoKey(id) || DEMO_SACK_ID;
  const d = DEMO_SACKS[key];
  const facts = zoneFacts(d.zone) || {};
  const today = new Date();
  // Cut 16 days ago, bagged after the typical dry cycle, opened yesterday —
  // so the journey on the page shows the shape of a real sack's timeline.
  const cut = new Date(today.getTime() - (DRY_DAYS_TYPICAL + 6) * 86400000).toISOString().slice(0, 10);
  const bagged = new Date(today.getTime() - 6 * 86400000).toISOString().slice(0, 10);
  const growDays = (facts.plantDate)
    ? Math.round((new Date(cut + 'T00:00:00Z') - new Date(facts.plantDate + 'T00:00:00Z')) / 86400000)
    : null;
  return {
    sack: {
      sack_id: key, season: 2026, serial: d.serial, cultivar_code: d.code,
      cultivar: d.cultivar, zone: d.zone, cut_number: d.cut,
      harvest_date: cut,
      bay: d.bay,
      storage: d.storage ?? null,
      stored_at: d.storage ? bagged + ' 14:30:00' : null,
      printed_at: bagged + ' 14:20:00',
      opened_at: opened ? new Date(today.getTime() - 86400000).toISOString().slice(0, 19).replace('T', ' ') : null,
      // The five parts sum to the 35 lb that went into the sack, because that
      // is how the real figures behave — waste is the remainder, not a reading.
      // A demo that did not add up would teach the wrong thing.
      tops_lbs: opened ? d.parts.tops : null,
      smalls_lbs: opened ? d.parts.smalls : null,
      biomass_lbs: opened ? d.parts.biomass : null,
      trim_lbs: opened ? d.parts.trim : null,
      waste_lbs: opened ? d.parts.waste : null,
      weights_source: opened ? 'allocated' : null,
      voided_at: voided ? cut + ' 15:10:00' : null, is_test: 1,
    },
    notes: d.notes.map(n => ({ note: n.note, created_at: bagged + ' ' + n.at })),
    plantDate: facts.plantDate || null,
    plantDateApprox: !!facts.multiDay,
    acres: acresFor(d.zone, cultivarShare(d.zone, d.cultivar)),
    plants: plantCountFor(d.zone, cultivarShare(d.zone, d.cultivar)),
    areaBasis: areaBasisFor(d.zone, d.cultivar),
    growDays,
    lotSacks: d.lotSacks,
    hangBays: [d.bay],
  };
}

async function getSackView(db, sackId) {
  const sack = await queryOne(db, `SELECT * FROM harvest_sacks WHERE sack_id = ?`, [sackId]);
  if (!sack) return null;

  const facts = zoneFacts(sack.zone);
  const notes = await query(db, `
    SELECT id, note, created_at, edited_at FROM harvest_sack_notes
    WHERE sack_id = ? ORDER BY created_at DESC, id DESC LIMIT 50
  `, [sackId]);

  const lot = sack.zone_session_id
    ? await queryOne(db, `
        SELECT COUNT(*) AS sacks FROM harvest_sacks
        WHERE zone_session_id = ? AND is_test = ? AND voided_at IS NULL
      `, [sack.zone_session_id, sack.is_test])
    : null;

  // Every bay this sack's LOT was hung into at the barn door — across ALL of
  // the lot's sessions, not just the one the sack hangs off. Sacks hang off the
  // lot's primary session, but a trailer is attributed to whichever session was
  // open when it arrived: a crew that leaves and comes back inside the grace
  // window, or a second crew in the zone, is a second session of the same lot.
  // Keyed on the primary alone, this listed only some of the bays and read as
  // complete.
  const hang = sack.zone_session_id
    ? await query(db, `
        SELECT DISTINCT b.bay FROM harvest_scan_log p
        JOIN harvest_scan_log e
          ON e.event_type = 'enter' AND e.season = p.season AND e.zone = p.zone
         AND e.cultivar IS p.cultivar AND e.cut_number IS p.cut_number AND e.is_test = p.is_test
        JOIN harvest_scan_log b
          ON b.event_type = 'barn_load' AND b.attributed_zone_session_id = e.id
         AND b.bay IS NOT NULL AND b.is_test = p.is_test
        WHERE p.id = ?
        ORDER BY b.bay
      `, [sack.zone_session_id])
    : [];

  const growDays = (facts?.plantDate && sack.harvest_date)
    ? Math.round((new Date(sack.harvest_date + 'T00:00:00Z') - new Date(facts.plantDate + 'T00:00:00Z')) / 86400000)
    : null;

  return {
    sack, notes,
    plantDate: facts?.plantDate || null,
    plantDateApprox: !!facts?.multiDay,
    // The lot's OWN ground, not the whole zone. A trial block is planted in
    // bands, and reporting the zone for one band made a Rainbow GMO Quik tag
    // read 0.468 ac / ~906 plants when its six rows are 0.076 / ~147 — 6x over,
    // on the denominator of every per-acre and per-plant figure, in the blocks
    // that exist to compare cultivars. (Koa, off a printed tag, 2026-09-09.)
    acres: acresFor(sack.zone, cultivarShare(sack.zone, sack.cultivar)),
    plants: plantCountFor(sack.zone, cultivarShare(sack.zone, sack.cultivar)),
    areaBasis: areaBasisFor(sack.zone, sack.cultivar),
    growDays,
    lotSacks: lot?.sacks ?? null,
    hangBays: hang.map(r => r.bay),
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

  // 26-SL-C2-12 / SL-C2-12 — a later cut, whose number restarted. Checked
  // before the plain forms, which would read "SL-C2" as a cultivar code.
  let m = q.match(/^(\d{2})-([A-Z]+\d*)-C(\d{1,2})-(\d{1,6})$/);
  if (m) return formatSackId(`20${m[1]}`, m[2], parseInt(m[4], 10), parseInt(m[3], 10));
  m = q.match(/^([A-Z]+\d*?)-C(\d{1,2})-(\d{1,6})$/);
  if (m) return formatSackId(season, m[1], parseInt(m[3], 10), parseInt(m[2], 10));

  // 26-SL-12 — already whole.
  m = q.match(/^(\d{2})-([A-Z]+\d*)-(\d{1,6})$/);
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
      SELECT sack_id, serial, cultivar, zone, cut_number FROM harvest_sacks
      WHERE is_test = ? AND voided_at IS NULL ORDER BY printed_at DESC, id DESC LIMIT 8
    `, [isTest]);
    return renderPage(ui, ui.t('findSack'), sackFindBody(ui, { recent }));
  }

  const parsed = normalizeSackId(raw, getSeason());

  // A bare number matches one bag per cultivar now, so offer the candidates
  // instead of picking one. Guessing here would hand back a confidently wrong
  // sack, which is worse than asking.
  if (parsed && typeof parsed === 'object' && parsed.ambiguous !== undefined) {
    const matches = await query(db, `
      SELECT sack_id, serial, cultivar, zone, cut_number FROM harvest_sacks
      WHERE serial = ? AND season = ? AND is_test = ? AND voided_at IS NULL
      ORDER BY cultivar
    `, [parsed.ambiguous, getSeason(), isTest]);
    if (matches.length === 1) {
      const only = await getSackView(db, matches[0].sack_id);
      return renderPage(ui, `${ui.t('sack')} ${only.sack.sack_id}`, sackDetailBody(ui, only));
    }
    const recentA = await query(db, `
      SELECT sack_id, serial, cultivar, zone, cut_number FROM harvest_sacks
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
    SELECT sack_id, serial, cultivar, zone, cut_number FROM harvest_sacks
    WHERE is_test = ? AND voided_at IS NULL ORDER BY printed_at DESC, id DESC LIMIT 8
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
  // Real first, same as the scan: pressing OPEN SACK on a number the season has
  // since printed must open THAT bag, not silently no-op against an example.
  const view = await getSackView(db, sackId);
  refuseRealInTest(ui, env, view?.sack);
  if (!view) {
    const demoOpen = demoKey(sackId);
    if (demoOpen) {
      const msg = ui.lang === 'es'
        ? 'Así se ve después de <strong>ABRIR BOLSA</strong>. No se guardó nada — es la bolsa de ejemplo.'
        : 'This is how it looks after <strong>OPEN SACK</strong>. Nothing was saved — it is the example sack.';
      return renderPage(ui, `${ui.t('sack')} ${demoOpen}`,
        demoBanner(ui, null, msg, demoOpen) + sackDetailBody(ui, demoSackView(true, false, demoOpen)));
    }
    throw createError('NOT_FOUND', ui.t('noSack', { id: sackId }));
  }
  const sack = view.sack;

  if (sack.voided_at) throw createError('VALIDATION_ERROR', ui.t('noSack', { id: sackId }));
  if (sack.opened_at) {
    // Already open — say so rather than decrementing the count a second time.
    return renderPage(ui, `${ui.t('sack')} ${sackId}`, sackDetailBody(ui, view, ui.t('alreadyOpen')));
  }

  const took = await takeSackOut(db, env, ctx, sack, { by: 'page' });
  if (took === 'already') {
    const now = await getSackView(db, sackId);
    return renderPage(ui, `${ui.t('sack')} ${sackId}`, sackDetailBody(ui, now || view, ui.t('alreadyOpen')));
  }
  if (took === 'busy') {
    // An undo's +1 back is still unanswered: one inventory call per sack at a time.
    const msg = ui.lang === 'es' ? 'Intenta de nuevo en un momento.' : 'Try again in a moment.';
    return renderPage(ui, `${ui.t('sack')} ${sackId}`, sackDetailBody(ui, view, msg));
  }

  const updated = await getSackView(db, sackId);
  return renderPage(ui, `${ui.t('sack')} ${sackId}`, sackDetailBody(ui, updated, ui.t('sackOpened')));
}

/**
 * THE one way a sack leaves inventory — the ABRIR BOLSA button and the
 * /salida scan both come through here, so the count can only move one way.
 *
 * The UPDATE is guarded on opened_at IS NULL: two scans racing for one bag
 * both reach here, and only the one that actually flips the row may take the
 * one off Shopify. Returns 'out' (this call flipped the row), 'already' (out
 * or voided before) or 'busy' (an undo's +1 back is still unanswered).
 *
 * A re-scan after an undo is decided from shopify_sync_error, and the UPDATE
 * is guarded on that exact value so a racing answer makes it miss:
 *   'undo add-back failed…'   -1 landed, +1 back did not: Shopify holds nothing
 *                             for this sack, so they cancel. Out, settled, no call.
 *   '…undone; check Shopify'  nobody knows if the -1 landed: out again, no
 *                             call, still flagged for a person.
 *   'in flight since…'        the undo's +1 is still running: 'busy'.
 *
 * The pool -1 gets the same IN_FLIGHT marker the +1 at tagging has, written
 * BEFORE the call (see lib/inventory-debt.js): a waitUntil that dies mid-call
 * otherwise leaves a row that looks like a subtract that never ran.
 */
export async function takeSackOut(db, env, ctx, sack, { by, orderId = null, orderSource = null } = {}) {
  const sackId = sack.sack_id;
  const live = !isTestMode(env);
  const cur = await queryOne(db,
    `SELECT opened_at, voided_at, shopify_added_at, shopify_sync_error FROM harvest_sacks WHERE sack_id = ?`, [sackId]);
  if (!cur || cur.opened_at || cur.voided_at) return 'already';
  const prior = cur.shopify_sync_error ?? null;
  const priorText = String(prior || '');
  let subtract = false, syncedAt = null, marker = null;
  // A LIVE marker is another pool call on this sack: busy, the page retries.
  // A STALE one (or one already saying "check Shopify") will never be
  // answered: go out, send nothing, leave a person the question.
  if (priorText.includes('check Shopify') || isStaleInFlight(priorText)) {
    marker = `${priorText} — out again; check Shopify`;
  } else if (priorText.startsWith('undo add-back failed')) {
    // The earlier -1 landed and the +1 back did not, so Shopify already holds
    // nothing for this sack: the owed +1 and this -1 cancel. No pool call.
    syncedAt = new Date().toISOString();
  } else if (isLiveInFlight(priorText)) {
    return 'busy';
  } else {
    // Only a sack whose +1 landed has a one to take off; anything else would
    // push Shopify below what it was ever told.
    subtract = live && !!cur.shopify_added_at;
    marker = subtract ? inFlight('out') : null;
  }
  const r = await execute(db, `
    UPDATE harvest_sacks
    SET opened_at = datetime('now'), out_by = ?, out_order_id = ?, out_order_source = ?,
        shopify_synced_at = ?, shopify_sync_error = ?
    WHERE sack_id = ? AND opened_at IS NULL AND voided_at IS NULL AND shopify_sync_error IS ?
  `, [by, orderId, orderSource, syncedAt, marker, sackId, prior]);
  if (!r || !r.changes) {
    const now = await queryOne(db, `SELECT opened_at, voided_at FROM harvest_sacks WHERE sack_id = ?`, [sackId]);
    return (!now || now.opened_at || now.voided_at) ? 'already' : 'busy';
  }

  ctx.waitUntil(sendTelegramMessage(env, {
    chatId: env.TELEGRAM_TEST_CHAT_ID,
    text: `📂 Abierta *${sackId}* — ${sack.cultivar || '?'} ${sack.zone} corte ${sack.cut_number}`,
  }).catch(e => console.error('[harvest][telegram]', e)));

  if (subtract) {
    ctx.waitUntil((async () => {
      const r = await adjustSupersackCount(env, {
        db,
        season: sack.season, cultivar: sack.cultivar, zone: sack.zone, cut: sack.cut_number,
        // Where this sack's +1 landed, so the -1 takes it off the same count.
        variantId: sack.shopify_variant_id, delta: -1,
        note: `[Harvest] ${sackId} out (${by}, ${sack.zone} cut ${sack.cut_number})`,
      });
      // Guarded on the marker: an undo that ran meanwhile cleared it, and its
      // own bookkeeping must not be overwritten by this late answer.
      await execute(db, `
        UPDATE harvest_sacks SET shopify_synced_at = ?, shopify_sync_error = ?
        WHERE sack_id = ? AND opened_at IS NOT NULL AND shopify_sync_error = ?
      `, [r.ok ? new Date().toISOString() : null, r.ok ? null : (r.error || 'unknown error'), sackId, marker]);
      if (!r.ok) console.error(`[harvest][inventory] out ${sackId}: ${r.error}`);
    })().catch(e => console.error('[harvest][inventory]', e)));
  }
  return 'out';
}

/**
 * Share the floor's daily output across the bags opened that day — ALL FIVE
 * PARTS a supersack breaks into (tops, smalls, biomass, trim, waste), not just
 * the finished flower. Waste rides along as a derived residual and never as a
 * measurement; see the note in lib/floor-output.js.
 *
 * Equal split. Near-exact rather than exact: product is weighed into every sack
 * at 37 lb, so the bags really are the same size — except the LAST sack of a
 * lot, which goes out light and still takes a full share here. One sack in ~48,
 * always over-crediting, and knowingly accepted (Koa, 2026-09-02) rather than
 * ask the crew to type a fill weight for one bag. The real figure is written in
 * that tag's notes; it is deliberately not summed, because free-text notes are
 * not a number this can add up without guessing at units.
 *
 * Re-runnable — a day still in progress gets a partial share, and running it
 * again once the day closes replaces it.
 *
 * Never touches a bag whose weights were actually measured.
 */
export async function handleAllocate(db, env, params) {
  const isTest = isTestMode(env) ? 1 : 0;
  // Pacific, not UTC: the floor types its own civil day into
  // `supersack_entries.date`, and this has to name the same day they did.
  const day = String(params.date || '').substring(0, 10) || pacificToday();
  const [dayStart, dayEnd] = pacificDayRange(day);

  // Grouped by season AND cultivar. The floor spends part of 2026 trimming
  // 2025 material, so "Lifter" alone is not a lot — 2025 Lifter and 2026
  // Lifter are different crops that happen to share a name.
  // One row per bag, grouped here rather than in SQL, because each bag's share
  // now depends on its own weight (Koa, 2026-09-28): a bag weighed at 18 lb
  // takes 18/35 of a full bag's share, not a full one.
  // Also grouped by CUT and HARVEST TYPE (Greenhouse when the zone starts GH —
  // the same rule as supersack-inventory's harvestTypeForZone): 1st and 2nd
  // Cut of one cultivar opened the same day are different bags with different
  // yields, and pooling them gave every bag the same average.
  const bags = await query(db, `
    SELECT sack_id, season, cultivar, cut_number, fill_lbs,
           CASE WHEN zone LIKE 'GH%' THEN 'Greenhouse' ELSE 'Sungrown' END AS harvest_type
    FROM harvest_sacks
    WHERE opened_at >= ? AND opened_at < ? AND is_test = ? AND voided_at IS NULL
      AND (weights_source IS NULL OR weights_source = 'allocated')
    ORDER BY season, cultivar, cut_number, sack_id
  `, [dayStart, dayEnd, isTest]);
  const groups = new Map();
  for (const b of bags) {
    const cut = b.cut_number == null ? null : Number(b.cut_number);
    const k = `${b.season}|${b.cultivar}|${cut ?? ''}|${b.harvest_type}`;
    const g = groups.get(k)
      || { season: b.season, cultivar: b.cultivar, cut, harvest_type: b.harvest_type, n: 0, lbs: 0, bags: [] };
    const w = sackLbs(b);
    g.n += 1; g.lbs += w; g.bags.push({ sack_id: b.sack_id, lbs: w, weighed: b.fill_lbs != null });
    groups.set(k, g);
  }
  const bagGroups = [...groups.values()];

  if (!bagGroups.length) {
    return successResponse({ success: true, date: day, allocated: [], note: 'No bags opened that day.' });
  }

  let floor, unresolved;
  try {
    ({ byKey: floor, unresolved } = await floorOutputByCultivar(db, env, day));
  } catch (e) {
    // INTERNAL_ERROR because that is what this actually is now: floor output
    // is read from supersack_entries, not fetched from the scoreboard over
    // HTTP, so a failure here is ours. (The previous 'EXTERNAL_API_ERROR' was
    // not in ErrorCodes either and fell through to a 500 anyway — same status,
    // but it pointed a debugger at a network call that no longer happens.)
    throw createError('INTERNAL_ERROR', `Could not read floor output for ${day}: ${e.message}`);
  }

  const r2 = x => Math.round(x * 100) / 100;

  // MATCHING. Each floor row takes the bag groups of its season and cultivar
  // whose cut and harvest type equal the row's. A row whose title carries no
  // cut (or no type) may take any cut (or type) — but ONLY when no other row of
  // the cultivar could compete on that dimension that day (for cut: no other
  // row of a compatible type; for type: none of a compatible cut). Beside a
  // cut-specific row it matches only bags with no cut either, so it never
  // steals that row's output. A cut-less Greenhouse row beside a cut-less
  // Sungrown row (every 2025 title has a type and no cut) still takes its cut.
  // A lone cut-less row facing two cuts cannot be attributed by cut: it is
  // split across both by weight, and said so in `pooled_across_cuts`.
  const floorRows = [...floor.values()];
  const cultivarOf = x => `${x.season}|${x.cultivar}`;
  const pools = [];
  const claimed = new Set();
  for (const f of floorRows) {
    // "Only row" is judged among the rows that could compete on that dimension:
    // a cut-less Greenhouse row is still alone on cut beside a Sungrown row.
    const compat = (x, y) => x == null || y == null || x === y;
    const rivals = pick => floorRows.filter(o => cultivarOf(o) === cultivarOf(f) && pick(o)).length === 1;
    const aloneCut = rivals(o => compat(o.harvest_type, f.harvest_type));
    const aloneType = rivals(o => compat(o.cut, f.cut));
    const fits = (want, have, alone) => (want == null ? (alone || have == null) : want === have);
    const gs = bagGroups.filter(g => cultivarOf(g) === cultivarOf(f)
      && fits(f.cut, g.cut, aloneCut) && fits(f.harvest_type, g.harvest_type, aloneType) && !claimed.has(g));
    if (!gs.length) continue;
    gs.forEach(g => claimed.add(g));
    pools.push({ f, groups: gs });
  }

  const done = [];
  const countMismatches = [];
  const pooledAcrossCuts = [];
  for (const g of bagGroups.filter(g => !claimed.has(g))) {
    done.push({
      season: g.season, cultivar: g.cultivar, cut_number: g.cut, harvest_type: g.harvest_type, sacks: g.n,
      skipped: `floor logged no ${g.season} ${g.cultivar}${g.cut != null ? ` cut ${g.cut}` : ''} (${g.harvest_type}) that day`,
    });
  }
  for (const { f, groups: gs } of pools) {
    const cuts = [...new Set(gs.map(g => g.cut))].sort();
    if (cuts.length > 1) {
      pooledAcrossCuts.push({
        season: f.season, cultivar: f.cultivar, cuts,
        reason: `the floor logged one ${f.season} ${f.cultivar} row with no cut, and bags of ${cuts.length} cuts were opened; its output is split across all of them by bag weight, not by cut`,
      });
    }
    const r = {
      season: f.season, cultivar: f.cultivar,
      cut: cuts.length === 1 ? cuts[0] : null,
      harvest_type: new Set(gs.map(g => g.harvest_type)).size === 1 ? gs[0].harvest_type : null,
      n: gs.reduce((s, g) => s + g.n, 0), lbs: gs.reduce((s, g) => s + g.lbs, 0),
      bags: gs.flatMap(g => g.bags),
    };

    // The floor counts the sacks it opened; this counts the sacks carrying tags.
    // They should be the same number. When they are not, someone missed an
    // ABRIR BOLSA or missed a tracker row — and dividing by the smaller of the
    // two over-credits every bag, invisibly and permanently. Divide by the
    // TAGGED count, because those are the bags being written, and report the
    // disagreement rather than let it settle into the ledger unremarked.
    // No truthiness guard on floorSacks: `sacks_opened` is NOT NULL DEFAULT 0,
    // so a back-entered row where someone filled in the weights and left the
    // count reads as 0 — which is wrong whenever there are pounds behind it,
    // and skipping the check there would be a silent pass rather than a number.
    if (f.floorSacks !== r.n) {
      countMismatches.push({
        season: r.season, cultivar: r.cultivar, cut_number: r.cut, harvest_type: r.harvest_type,
        floor_sacks_opened: f.floorSacks, tagged_bags_opened: r.n,
        effect: f.floorSacks > r.n
          ? `each tagged bag credited ~${Math.round((f.floorSacks / r.n) * 100 - 100)}% high`
          : `${r.n - f.floorSacks} tagged bag(s) the floor did not count`,
      });
    }

    // Each bag's share of the four weighed parts is its weight over the
    // group's weight. With every bag full that is exactly the old equal split.
    //
    // WASTE IS NOT SPLIT — it is re-derived per bag, as what is left of THAT
    // bag's weight. The floor's own waste is left over from sacks x a full
    // sack, because the tracker cannot know a bag was light; splitting it by
    // weight would carry the light bag's missing pounds onto every bag in the
    // group and push each one past its own weight. With every bag full the
    // two give the same figure.
    const shareFor = lbs => {
      const sh = {
        tops: r2(f.tops * lbs / r.lbs), smalls: r2(f.smalls * lbs / r.lbs),
        biomass: r2(f.biomass * lbs / r.lbs), trim: r2(f.trim * lbs / r.lbs),
      };
      sh.waste = r2(Math.max(0, lbs - sh.tops - sh.smalls - sh.biomass - sh.trim));
      return sh;
    };
    const SET = `SET tops_lbs = ?, smalls_lbs = ?, biomass_lbs = ?, trim_lbs = ?, waste_lbs = ?,
                     weights_source = 'allocated', weights_allocated_at = datetime('now')`;
    const full = fullSackLbs(r.season);
    const fullShare = shareFor(full);
    // One write per 80 full bags in the pool (named by sack_id, since a pool is
    // now a cut, not a whole cultivar; chunked under D1's bound-parameter cap),
    // one per weighed bag.
    const fullIds = r.bags.filter(b => !b.weighed).map(b => b.sack_id);
    const fullChunks = [];
    for (let i = 0; i < fullIds.length; i += 80) fullChunks.push(fullIds.slice(i, i + 80));
    await transaction(db, [
      ...fullChunks.map(ids => ({
        sql: `UPDATE harvest_sacks ${SET}
              WHERE sack_id IN (${ids.map(() => '?').join(',')}) AND fill_lbs IS NULL
                AND (weights_source IS NULL OR weights_source = 'allocated')`,
        params: [fullShare.tops, fullShare.smalls, fullShare.biomass, fullShare.trim, fullShare.waste, ...ids],
      })),
      ...r.bags.filter(b => b.weighed).map(b => {
        const sh = shareFor(b.lbs);
        return {
          sql: `UPDATE harvest_sacks ${SET}
                WHERE sack_id = ? AND (weights_source IS NULL OR weights_source = 'allocated')`,
          params: [sh.tops, sh.smalls, sh.biomass, sh.trim, sh.waste, b.sack_id],
        };
      }),
    ]);
    done.push({
      season: r.season, cultivar: r.cultivar, cut_number: r.cut, harvest_type: r.harvest_type,
      sacks: r.n, sack_lbs: round1(r.lbs),
      floor: { tops: f.tops, smalls: f.smalls, biomass: f.biomass, trim: f.trim, waste: f.waste },
      // What a full bag got. A weighed bag got the same four parts scaled by
      // its weight, and its own remainder as waste.
      per_sack: fullShare,
      weighed_bags: r.bags.filter(b => b.weighed).map(b => ({ sack_id: b.sack_id, lbs: b.lbs, share: shareFor(b.lbs) })),
      // The floor assumes every bag it opened was full. The gap is the pounds
      // its raw figure (and its waste) carries that were never in the bags.
      floor_raw_over_bags_lbs: round1(r.n * full - r.lbs),
    });
  }

  // Floor output with no tagged bags behind it. During the changeover that is
  // the ordinary case — 2025 sacks are untagged — but it is worth seeing,
  // because it is also what a missed scan looks like.
  const untagged = floorRows
    .filter(f => !pools.some(p => p.f === f))
    .map(f => ({
      season: f.season, cultivar: f.cultivar, cut_number: f.cut, harvest_type: f.harvest_type,
      strain_titles: f.titles,
      floor: { tops: f.tops, smalls: f.smalls, biomass: f.biomass, trim: f.trim, waste: f.waste },
      floor_sacks_opened: f.floorSacks,
    }));

  return successResponse({
    success: true, date: day, is_test: !!isTest, allocated: done,
    // Surfaced, not swallowed: a strain the alias table does not know means that
    // day's output belongs to nobody and the bags stay unallocated.
    unresolved_floor_strains: unresolved,
    floor_output_without_tagged_bags: untagged,
    // The floor's sack count against the tagged-bag count. A disagreement means
    // the per-bag figures for that cultivar are scaled wrong, so it belongs in
    // the result rather than in a log line nobody reads.
    sack_count_mismatches: countMismatches,
    // A cut-less floor row split across bags of several cuts: those per-bag
    // figures are a cultivar average, not the yield of each cut.
    pooled_across_cuts: pooledAcrossCuts,
    basis: "All five parts of the day's floor output (supersack_entries: tops, smalls, biomass, trim, waste), matched on SEASON, cultivar, cut and harvest type (a floor row with no cut or type matches any only when it is the cultivar's only row that day), split across the TAGGED bags opened the same day in proportion to each bag's weight: a full sack is 35 lb for the 2026 crop and 37 lb through 2025, and a bag weighed off-standard at takedown (usually the light last bag of a lot) counts at its own weight. Waste is a derived residual, not a weighed figure: each bag's is what is left of its own weight after the four weighed parts.",
  });
}

/**
 * Nightly allocation — the thing that actually calls handleAllocate.
 *
 * Runs a TRAILING WINDOW rather than yesterday alone. A `supersack_entries` row
 * is entered by hand per day and can lag or be back-entered, so a job that only
 * ever looked at yesterday would leave a late row's bags permanently empty.
 * Replaying is safe by construction: allocation is idempotent and refuses to
 * touch a bag whose weights were measured, so a day that was already correct is
 * simply rewritten with the same figures.
 *
 * The window ends YESTERDAY. Today's floor day is still open, and allocating a
 * half-finished day only to overwrite it tomorrow makes the ledger flicker for
 * anyone reading it in between.
 *
 * Logs per day rather than one total: a week where five days did nothing looks
 * identical to a clean week in an aggregate line.
 */
export async function runNightlyAllocation(env, { days = ALLOCATION_WINDOW_DAYS } = {}) {
  const db = env.DB;
  const summary = [];

  for (let back = 1; back <= days; back++) {
    const d = new Date(Date.now() - back * 86400000).toISOString().substring(0, 10);
    try {
      const res = await handleAllocate(db, env, { date: d });
      const body = await res.json();
      const data = body.data || body;
      const wrote = (data.allocated || []).filter(a => !a.skipped);
      summary.push({ date: d, cultivars: wrote.length });

      if (wrote.length) {
        console.log(`[Cron][allocate] ${d}: ${wrote.map(a => `${a.cultivar} x${a.sacks}`).join(', ')}`);
      }
      // Three things that are normal once and alarming twice. Logged per day so
      // they can be traced to one, rather than summed into a number nobody can
      // act on.
      for (const m of (data.sack_count_mismatches || [])) {
        console.error(`[Cron][allocate] ${d}: ${m.cultivar} — floor opened ${m.floor_sacks_opened}, ` +
          `${m.tagged_bags_opened} tagged; ${m.effect}`);
      }
      for (const strain of (data.unresolved_floor_strains || [])) {
        console.error(`[Cron][allocate] ${d}: no cultivar alias for "${strain}" — that output reached no bag`);
      }
      for (const u of (data.floor_output_without_tagged_bags || [])) {
        console.log(`[Cron][allocate] ${d}: ${u.season} ${u.cultivar} floor output with no tagged bags ` +
          '(ordinary during the 2025 changeover, otherwise a missed scan)');
      }
    } catch (e) {
      // One bad day must not stop the rest of the window.
      summary.push({ date: d, error: e.message });
      console.error(`[Cron][allocate] ${d} failed: ${e.message}`);
    }
  }
  return summary;
}

async function handleSackNote(ui, db, env, ctx, body) {
  const sackId = String(body.sack_id || '').trim();
  const note = String(body.note || '').trim().substring(0, 500);
  if (!note) throw createError('VALIDATION_ERROR', ui.t('noteEmpty'));

  const view = await getSackView(db, sackId);
  refuseRealInTest(ui, env, view?.sack);
  if (!view) {
    const demoNote = demoKey(sackId);
    if (demoNote) {
      const msg = ui.lang === 'es'
        ? 'La nota no se guardó — es la bolsa de ejemplo.'
        : 'The note was not saved — it is the example sack.';
      return renderPage(ui, `${ui.t('sack')} ${demoNote}`,
        demoBanner(ui, null, msg, demoNote) + sackDetailBody(ui, demoSackView(false, false, demoNote)));
    }
    throw createError('NOT_FOUND', ui.t('noSack', { id: sackId }));
  }

  await execute(db, `INSERT INTO harvest_sack_notes (sack_id, note, is_test) VALUES (?, ?, ?)`,
    [sackId, note, view.sack.is_test]);

  ctx.waitUntil(sendTelegramMessage(env, {
    chatId: env.TELEGRAM_TEST_CHAT_ID,
    text: `📝 *${sackId}* (${view.sack.cultivar || '?'} ${view.sack.zone}) — ${note}`,
  }).catch(e => console.error('[harvest][telegram]', e)));

  const updated = await getSackView(db, sackId);
  return renderPage(ui, `${ui.t('sack')} ${sackId}`, sackDetailBody(ui, updated, ui.t('noteSaved')));
}

/**
 * Change the wording of a note already on a sack (Koa, 2026-09-16: "make it so
 * we can edit previous notes").
 *
 * The note must belong to the sack the form names — a note id alone could be
 * any bag's, and editing the wrong bag's history is worse than no edit. The
 * words as first saved are kept in original_note on the first edit and never
 * overwritten after, and edited_at lets the page say the note was changed.
 * Saving the same words again changes nothing, not even the edited mark.
 */
async function handleSackNoteEdit(ui, db, env, ctx, body) {
  const sackId = String(body.sack_id || '').trim();
  const noteId = parseInt(body.note_id, 10);
  const note = String(body.note || '').trim().substring(0, 500);
  if (!note) throw createError('VALIDATION_ERROR', ui.t('noteEmpty'));

  refuseRealInTest(ui, env, await queryOne(db, `SELECT is_test FROM harvest_sacks WHERE sack_id = ?`, [sackId]));
  const row = Number.isInteger(noteId)
    ? await queryOne(db, `SELECT id, note FROM harvest_sack_notes WHERE id = ? AND sack_id = ?`, [noteId, sackId])
    : null;
  if (!row) throw createError('NOT_FOUND', ui.t('noteNotFound'));

  if (row.note !== note) {
    await execute(db, `
      UPDATE harvest_sack_notes
      SET original_note = COALESCE(original_note, note), note = ?, edited_at = datetime('now')
      WHERE id = ? AND sack_id = ?
    `, [note, noteId, sackId]);
    ctx.waitUntil(sendTelegramMessage(env, {
      chatId: env.TELEGRAM_TEST_CHAT_ID,
      text: `✏️ Note edited on *${sackId}* — ${note}`,
    }).catch(e => console.error('[harvest][telegram]', e)));
  }

  const view = await getSackView(db, sackId);
  return renderPage(ui, `${ui.t('sack')} ${sackId}`, sackDetailBody(ui, view, ui.t('noteUpdated')));
}

/**
 * Set or change where a sack is kept.
 *
 * Refused for opened and voided sacks HERE, not only by hiding the form: an
 * opened sack is not in storage any more, and a voided number never had a sack
 * behind it. The form is hidden for both; this is what holds when someone posts
 * anyway.
 */
async function handleSackStore(ui, db, env, ctx, body) {
  const sackId = String(body.sack_id || '').trim();
  const storage = parseStorage(body.storage, ui);

  const view = await getSackView(db, sackId);
  refuseRealInTest(ui, env, view?.sack);
  if (!view) {
    const demo = demoKey(sackId);
    if (demo) {
      const msg = ui.lang === 'es'
        ? 'La ubicación no se guardó — es la bolsa de ejemplo.'
        : 'The location was not saved — it is the example sack.';
      return renderPage(ui, `${ui.t('sack')} ${demo}`,
        demoBanner(ui, null, msg, demo) + sackDetailBody(ui, demoSackView(false, false, demo)));
    }
    throw createError('NOT_FOUND', ui.t('noSack', { id: sackId }));
  }
  if (view.sack.voided_at) throw createError('VALIDATION_ERROR', ui.t('storeVoided'));
  if (view.sack.opened_at) throw createError('VALIDATION_ERROR', ui.t('storeOpened'));

  // Only a real move restamps stored_at, so saving the same place twice does
  // not quietly reset "since" to today.
  await execute(db, `
    UPDATE harvest_sacks
    SET storage = ?, stored_at = CASE WHEN ? IS NULL THEN NULL ELSE ? END
    WHERE sack_id = ? AND opened_at IS NULL AND voided_at IS NULL AND storage IS NOT ?
  `, [storage, storage, sqliteUtc(new Date()), sackId, storage]);

  const updated = await getSackView(db, sackId);
  const where = storageLabel(ui, storage);
  return renderPage(ui, `${ui.t('sack')} ${sackId}`,
    sackDetailBody(ui, updated, where ? ui.t('storageSaved', { where }) : ui.t('storageCleared')));
}

/**
 * Correct a bag's weight from its page — for a bag weighed after its tag
 * printed, or a weight typed wrong at takedown. Blank means a full sack.
 * Refused once the bag is opened: the day's output has been split by it.
 */
async function handleSackFill(ui, db, env, ctx, body) {
  const sackId = String(body.sack_id || '').trim();
  let fillLbs;
  try { fillLbs = parseFillLbs(body.fill_lbs); }
  catch (e) { throw createError('VALIDATION_ERROR', e.message); }

  const view = await getSackView(db, sackId);
  refuseRealInTest(ui, env, view?.sack);
  if (!view) throw createError('NOT_FOUND', ui.t('noSack', { id: sackId }));
  if (view.sack.voided_at) throw createError('VALIDATION_ERROR', ui.t('fillVoided'));
  if (view.sack.opened_at) throw createError('VALIDATION_ERROR', ui.t('fillOpened'));

  await execute(db, `UPDATE harvest_sacks SET fill_lbs = ? WHERE sack_id = ? AND opened_at IS NULL AND voided_at IS NULL`,
    [fillLbs, sackId]);

  const updated = await getSackView(db, sackId);
  return renderPage(ui, `${ui.t('sack')} ${sackId}`,
    sackDetailBody(ui, updated, fillLbs !== null
      ? ui.t('fillSaved', { n: fillLbs })
      : ui.t('fillCleared', { n: fullSackLbs(updated.sack.season) })));
}

/**
 * e.g. 26-SL-1. Unpadded on purpose (Koa): "1, 2, 3", not "0001".
 *
 * Numbers restart for each cut (Koa, 2026-09-16), so a later cut carries the
 * cut in the id: 26-SL-C2-1. A first cut keeps the plain form — it is what the
 * bags tagged before the change already carry in their QR, and a first cut is
 * the common case.
 */
function formatSackId(season, code, serial, cut = 1) {
  const c = Number(cut) >= 2 ? `C${Number(cut)}-` : '';
  return `${String(season).slice(-2)}-${code}-${c}${serial}`;
}

/** The cut as the tag spells it, large: "1ST CUT", "2ND CUT", "3RD CUT". */
function cutOrdinal(cut) {
  const n = Number(cut);
  if (!Number.isInteger(n) || n < 1) return null;
  const suffix = (n % 100 >= 11 && n % 100 <= 13) ? 'TH' : ({ 1: 'ST', 2: 'ND', 3: 'RD' }[n % 10] || 'TH');
  return `${n}${suffix}`;
}

function qrUrlFor(sackId) {
  // 203px ≈ 1in at the ZP-450's 203dpi head, so the QR maps ~1:1 to printer
  // dots instead of being resampled.
  return qrImageUrl(`${PUBLIC_BASE}/s/${sackId}`, 203);
}

/**
 * The QR for a printed page, as an inline `data:` URI.
 *
 * This used to be `api.qrserver.com`. Measured 2026-09-21, that fetch cost
 * **0.62-0.84 s** against **0.16-0.24 s** for the whole label page — and since
 * the label waits for every image before printing (printing early yields blank
 * squares), it WAS the delay the crew felt on every bag. It also put tag
 * printing at the mercy of an unrelated company mid-harvest.
 *
 * `px` is now ignored: the QR is SVG, so it is resolution-independent and each
 * page's CSS sizes it. The parameter is kept so the call sites read the same,
 * and because the number still documents the intended print size.
 */
// eslint-disable-next-line no-unused-vars
function qrImageUrl(target, px) {
  return qrDataUri(target);
}

/**
 * A QR image, with the URL it encodes carried alongside it in `data-qr`.
 *
 * The target used to be readable straight out of the `src`, because the src was
 * a qrserver URL with `?data=<the target>`. Inlining the QR removed that, and
 * with it the ability to ask a rendered page "what will a phone camera actually
 * open?" — which is the single worst thing to get wrong here: a bad URL survives
 * printing, laminating and staking, and only surfaces when someone scans it in a
 * field in October.
 *
 * So the target rides along explicitly. Tests assert both that `data-qr` is the
 * intended URL AND that `src` equals `qrDataUri(data-qr)`, which together are
 * stronger than the old string match: they check the intent and that the image
 * really encodes it.
 */
function qrImg(target, cls = 'qr', alt = '') {
  return `<img class="${cls}" src="${qrDataUri(target)}" data-qr="${escapeHtml(target)}" alt="${escapeHtml(alt)}">`;
}

// ─── JSON ACTIONS ───────────────────────────────────────

async function getStatus(db, env) {
  const isTest = isTestMode(env) ? 1 : 0;
  // Every open session, not one. One crew means one open lot, but data from
  // the two-crew build can hold two until the next zone scan closes both, and
  // a status feed that hid one would hide exactly that.
  const open = await query(db, `
    SELECT * FROM harvest_scan_log
    WHERE event_type = 'enter' AND closed_at IS NULL AND is_test = ?
    ORDER BY occurred_at DESC, id DESC
  `, [isTest]);

  const shape = (a) => ({
    id: a.id,
    zone: a.zone,
    cultivar: a.cultivar,
    cut_number: a.cut_number,
    crew: a.crew,
    occurred_at: a.occurred_at,
    headcount: a.headcount,
    headcount_at: a.headcount_at,
  });

  // The barn door's "which lot?" picker: when nothing is open for a zone, the
  // person at the door names the lot instead of the load landing on nothing.
  // Carried on the status poll so a tablet left up all day keeps seeing lots
  // that have closed since it loaded.
  const recent = await getRecentEnterSessions(db, isTest);
  const crewDays = await getCrewDays(db, isTest);

  return successResponse({
    // Each crew's trailers and people today, as the leads entered them.
    crews_today: crewDays.map(r => ({
      crew: r.crew, lead: crewById(r.crew)?.lead ?? null, trailers: trailerList(r.trailers),
      cutters: r.cutters, drivers: r.drivers, water_spiders: r.water_spiders, updated_at: r.updated_at,
    })),
    success: true,
    season: getSeason(),
    is_test: !!isTest,
    // Kept as the most recent for anything already reading it; active_zones is
    // the honest answer.
    active_zone: open.length ? shape(open[0]) : null,
    active_zones: open.map(shape),
    recent_lots: recent.map(a => ({ ...shape(a), closed_at: a.closed_at })),
  });
}

/**
 * Lots a trailer arriving now could plausibly have been cut from: every zone
 * session of the last few days, open or closed. Deliberately not filtered to
 * one crew or one zone — the picker is for the case where the automatic
 * attribution has nothing, and the barn is the one that knows.
 */
async function getRecentEnterSessions(db, isTest, days = LOT_AT_DOOR_DAYS) {
  return await query(db, `
    SELECT * FROM harvest_scan_log
    WHERE event_type = 'enter' AND is_test = ?
      AND julianday('now') - julianday(COALESCE(closed_at, datetime('now'))) <= ?
    ORDER BY occurred_at DESC, id DESC LIMIT 40
  `, [isTest, days]);
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
  const [dayStart, dayEnd] = pacificDayRange(dayIso);
  const bounds = await queryOne(db, `
    SELECT MIN(occurred_at) AS first_event, MAX(occurred_at) AS last_event
    FROM harvest_scan_log
    WHERE occurred_at >= ? AND occurred_at < ? AND is_test = ?
  `, [dayStart, dayEnd, isTest]);
  if (!bounds?.first_event || !bounds?.last_event) return null;

  const periods = await query(db, `
    SELECT * FROM harvest_crew_roster
    WHERE is_test = ?
      AND effective_from < ?
      AND (effective_to IS NULL OR effective_to >= ?)
    ORDER BY effective_from ASC
  `, [isTest, dayEnd, dayStart]);
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
  const [dayStart, dayEnd] = pacificDayRange(dayIso);
  const loads = await query(db, `
    SELECT occurred_at FROM harvest_scan_log
    WHERE event_type = 'barn_load'
      AND occurred_at >= ? AND occurred_at < ? AND is_test = ?
    ORDER BY occurred_at ASC
  `, [dayStart, dayEnd, isTest]);
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
    SELECT cultivar, zone, cut_number,
           COUNT(*) AS tagged,
           SUM(CASE WHEN opened_at IS NULL THEN 1 ELSE 0 END) AS unopened,
           SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
           SUM(CASE WHEN opened_at IS NOT NULL AND shopify_synced_at IS NULL THEN 1 ELSE 0 END) AS unsynced
    FROM harvest_sacks
    WHERE season = ? AND is_test = ? AND voided_at IS NULL
    GROUP BY cultivar, CASE WHEN zone LIKE 'GH%' THEN 'GH' ELSE 'FIELD' END, cut_number
    ORDER BY cultivar, cut_number
  `, [season, isTest]);

  let variants = [];
  let variantsError = null;
  try { variants = await listSupersackVariants(env); }
  catch (e) { variantsError = String(e.message || e); }

  // Per cut, through the same matcher (aliases included) that moves the count —
  // a reconcile that matched differently would report drift that isn't there.
  const lines = await Promise.all(rows.map(async r => {
    const m = await matchSupersackVariant(variants, db,
      { season, cultivar: r.cultivar, zone: r.zone, cut: r.cut_number });
    const v = m.variant;
    const title = v ? v.title : m.title;
    const shopify = v ? Number(v.quantity) || 0 : null;
    return {
      cultivar: r.cultivar,
      cut: r.cut_number,
      variant_title: title,
      variant_exists: !!v,
      match_error: v ? null : m.error,
      tagged: r.tagged,
      unopened: r.unopened,
      opened: r.opened,
      opened_but_not_counted: r.unsynced,
      shopify_on_hand: shopify,
      // Our unopened bags should equal what Shopify says is on hand.
      drift: shopify === null ? null : r.unopened - shopify,
    };
  }));

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
    // Tags whose Shopify write never settled. Reconcile compares tagged bags
    // against the Shopify count, so a debt here is the difference — and until
    // 2026-09-22 it was invisible on every screen while the sweep endpoint sat
    // there knowing about it.
    inventory_debts: await loadInventoryDebts(db, env),
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

/**
 * The lot ledger as data.
 *
 * Split out from the response so the dashboard can build on the SAME numbers
 * rather than aggregating lots a second way. Two aggregations over one table
 * eventually disagree, and nothing tells you which one is right — the sack-tag
 * CSS duplicated across two renderers is the same trap one layer down.
 */
export async function computeRollup(db, env, params) {
  const isTest = isTestMode(env) ? 1 : 0;
  const season = parseInt(params.season, 10) || getSeason();

  const lots = await query(db, `
    SELECT
      l.id, l.zone, l.cultivar, l.cut_number, l.season, l.occurred_at, l.closed_at,
      l.headcount, l.headcount_at,
      (SELECT COUNT(*) FROM harvest_scan_log b
        WHERE b.event_type = 'barn_load' AND b.attributed_zone_session_id = l.id AND b.is_test = l.is_test) AS loads,
      (SELECT COALESCE(SUM(b.bins), 0) FROM harvest_scan_log b
        WHERE b.event_type = 'barn_load' AND b.attributed_zone_session_id = l.id AND b.is_test = l.is_test) AS bins,
      (SELECT COUNT(*) FROM harvest_sacks s
        WHERE s.zone_session_id = l.id AND s.is_test = l.is_test AND s.voided_at IS NULL) AS sacks,
      (SELECT COALESCE(SUM(COALESCE(s.fill_lbs, ?)), 0) FROM harvest_sacks s
        WHERE s.zone_session_id = l.id AND s.is_test = l.is_test AND s.voided_at IS NULL) AS sack_lbs,
      (SELECT COUNT(*) FROM harvest_sacks s
        WHERE s.zone_session_id = l.id AND s.is_test = l.is_test AND s.voided_at IS NULL
          AND s.fill_lbs IS NOT NULL) AS sacks_weighed,
      (SELECT COUNT(*) FROM harvest_sacks s
        WHERE s.zone_session_id = l.id AND s.is_test = l.is_test AND s.voided_at IS NULL
          AND s.opened_at IS NOT NULL) AS sacks_opened,
      (SELECT COALESCE(SUM(s.tops_lbs), 0) FROM harvest_sacks s
        WHERE s.zone_session_id = l.id AND s.is_test = l.is_test AND s.voided_at IS NULL) AS tops_lbs,
      (SELECT COALESCE(SUM(s.smalls_lbs), 0) FROM harvest_sacks s
        WHERE s.zone_session_id = l.id AND s.is_test = l.is_test AND s.voided_at IS NULL) AS smalls_lbs,
      (SELECT COALESCE(SUM(s.biomass_lbs), 0) FROM harvest_sacks s
        WHERE s.zone_session_id = l.id AND s.is_test = l.is_test AND s.voided_at IS NULL) AS biomass_lbs,
      (SELECT COALESCE(SUM(s.trim_lbs), 0) FROM harvest_sacks s
        WHERE s.zone_session_id = l.id AND s.is_test = l.is_test AND s.voided_at IS NULL) AS trim_lbs,
      (SELECT COALESCE(SUM(s.waste_lbs), 0) FROM harvest_sacks s
        WHERE s.zone_session_id = l.id AND s.is_test = l.is_test AND s.voided_at IS NULL) AS waste_lbs
    FROM harvest_scan_log l
    WHERE l.event_type = 'enter' AND l.season = ? AND l.is_test = ?
    ORDER BY l.occurred_at ASC
  `, [fullSackLbs(season), season, isTest]);

  // Trailer times per session, for clipping an overnight session to the hours
  // it can be seen to have worked. Counts and sums come from the subqueries
  // above; this is the only place the individual timestamps are needed.
  const loadTimes = await query(db, `
    SELECT attributed_zone_session_id AS sid, occurred_at
    FROM harvest_scan_log
    WHERE event_type = 'barn_load' AND season = ? AND is_test = ?
      AND attributed_zone_session_id IS NOT NULL
    ORDER BY occurred_at ASC
  `, [season, isTest]);
  const eventsBySession = new Map();
  for (const r of loadTimes) {
    if (!eventsBySession.has(r.sid)) eventsBySession.set(r.sid, []);
    eventsBySession.get(r.sid).push(r.occurred_at);
  }

  // One row per LOT, not per session. Ordered oldest-first by the query, so
  // each group's first session is its primary.
  const rows = groupSessionsIntoLots(lots).map(g => buildLotRow(g, eventsBySession));

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

  return {
    success: true,
    season,
    is_test: !!isTest,
    generated_at: new Date().toISOString(),
    crew_by_day: crewByDay,
    constants: summarizeConstants(),
    plants_per_acre: { value: PLANTS_PER_ACRE, derivation: `43,560 sq ft/ac ÷ (${PLANT_SPACING_FT.inRow} ft × ${PLANT_SPACING_FT.bed} ft)` },
    totals: rollupTotals(rows),
    lots: rows,
  };
}

/**
 * The ledger over the wire. GATED, unlike every other read here: it carries
 * per-lot yield and acreage for the whole season, which is the farm's numbers
 * rather than a crew screen. It was open until 2026-09-04 only because nothing
 * had ever fetched it — putting a password in front of the dashboard while
 * leaving the same data served openly beside it would have been decoration.
 */
async function getRollup(request, db, env, params, body) {
  requireAuth(request, body, env, 'harvest-rollup');
  return successResponse(await computeRollup(db, env, params));
}

/**
 * One ledger row for one lot, folding together every session that belongs to it
 * (see lotKey / groupSessionsIntoLots). `sessions` arrives oldest-first.
 */
/**
 * Hours a spanning session can be SEEN to have worked, day by day.
 *
 * The fallback for a forgotten end-of-day scan (see handleDayEnd). Open-to-
 * close contains a night and cannot be used; this uses only moments the system
 * actually observed — the zone scan, headcount taps, every trailer logged
 * against the session, and the close — and takes the span of them within each
 * Pacific day.
 *
 * IT UNDERSTATES, ALWAYS, AND THAT IS THE POINT TO BE HONEST ABOUT. The crew
 * were cutting before the first trailer of the morning arrived and after the
 * last one left, and none of that is visible here. So the hours are a FLOOR,
 * and any rate divided by them is a CEILING. Everything downstream keeps these
 * in their own bucket for exactly that reason: pooled with measured sessions
 * they would quietly inflate bins-per-cutter-hour, and an overstated rate just
 * looks like a good day.
 *
 * A day with fewer than two observations contributes nothing rather than a
 * guess — that is a day we have no evidence about, not a day of no work.
 */
function clippedActiveHours(session, loadTimes = []) {
  const stamps = [session.occurred_at, session.headcount_at, session.closed_at, ...loadTimes]
    .filter(Boolean)
    .map(t => parseSqliteUtc(t));

  const byDay = new Map();
  for (const d of stamps) {
    const key = pacificDay(d);
    const ms = d.getTime();
    const cur = byDay.get(key);
    if (!cur) byDay.set(key, { min: ms, max: ms });
    else { if (ms < cur.min) cur.min = ms; if (ms > cur.max) cur.max = ms; }
  }

  let hours = 0;
  for (const w of byDay.values()) hours += (w.max - w.min) / 3600000;
  return { hours: +hours.toFixed(2), days: byDay.size };
}

function buildLotRow(sessions, eventsBySession = new Map()) {
  const l = sessions[0];                       // the lot's primary session
  const sum = (k) => sessions.reduce((t, s) => t + (s[k] || 0), 0);

  const facts = zoneFacts(l.zone);
  const cutDate = String(l.occurred_at).substring(0, 10);
  const plantDate = facts?.plantDate || null;
  const share = cultivarShare(l.zone, l.cultivar);
  const acres = acresFor(l.zone, share);
  const plants = plantCountFor(l.zone, share);

  const growDays = plantDate
    ? Math.round((new Date(cutDate + 'T00:00:00Z') - new Date(plantDate + 'T00:00:00Z')) / 86400000)
    : null;

  // Cutter person-hours: headcount x how long each SESSION stayed open, summed.
  // Deliberately not (last close - first open) x headcount — a lot the crew
  // left and came back to has a gap in the middle that was spent somewhere
  // else, and with two crews the sessions overlap instead. Null unless every
  // session has closed and carries a headcount, so an in-progress or partly
  // unrecorded lot reports nothing rather than a number that keeps growing or
  // one that silently omits a crew.
  const perSession = sessions.map(s => {
    const opened = parseSqliteUtc(s.occurred_at);
    const closed = s.closed_at ? parseSqliteUtc(s.closed_at) : null;
    // The crew does not leave the last zone of the day — they stop, and pick up
    // in that same zone next morning, so nothing closes the session until they
    // move on. Open-to-close therefore contains a night, and multiplying it by
    // headcount would bill the lot for the crew's sleep. There is no honest
    // number without the cutting-day window (CONSTANTS.harvestDayLimits), so
    // this reports nothing rather than something wrong — the same way wet_lbs
    // waits on the bin weight.
    const slept = closed ? pacificDay(opened) !== pacificDay(closed) : false;
    const hrs = closed ? (closed - opened) / 3600000 : null;

    // Measured when the session closed inside one day — the crew lead scanned
    // the end-of-day card, or simply moved zones before dark. Clipped when it
    // spans a night: the observed window instead of the raw one.
    let personHours = null;
    let basis = null;
    let hoursUsed = null;
    if (hrs !== null && s.headcount) {
      if (!slept) {
        hoursUsed = +hrs.toFixed(2);
        personHours = +(hrs * s.headcount).toFixed(1);
        basis = 'measured';
      } else {
        const c = clippedActiveHours(s, eventsBySession.get(s.id) || []);
        if (c.hours > 0) {
          hoursUsed = c.hours;
          personHours = +(c.hours * s.headcount).toFixed(1);
          basis = 'clipped';
        }
      }
    }

    return {
      session_id: s.id,
      headcount: s.headcount,
      hours_open: hrs === null ? null : +hrs.toFixed(2),
      spans_days: slept,
      hours_counted: hoursUsed,
      hours_basis: basis,
      cutter_person_hours: personHours,
    };
  });
  const openSessions = perSession.filter(x => x.hours_open === null).length;
  const sleptSessions = perSession.filter(x => x.spans_days).length;
  const measuredS = perSession.filter(x => x.hours_basis === 'measured');
  const clippedS = perSession.filter(x => x.hours_basis === 'clipped');
  const total = (xs) => round1(xs.reduce((t, x) => t + x.cutter_person_hours, 0));

  // Still null if ANY session has neither — a partial lot total would be read
  // as the lot's hours and it is not.
  const cutterHours = perSession.some(x => x.cutter_person_hours === null)
    ? null : total(perSession);
  const cutterHoursMeasured = measuredS.length ? total(measuredS) : null;
  const cutterHoursClipped = clippedS.length ? total(clippedS) : null;

  const cutterHoursBasis = cutterHours === null
    ? (openSessions ? 'withheld: the lot is still being cut'
      : sleptSessions ? `withheld: ${sleptSessions} overnight session(s) with nothing observed to clip to`
      : 'withheld: no cutter count was recorded')
    : clippedS.length
      // Said on every lot that carries one, because the number reads like a
      // measurement and half of it is not.
      ? `${clippedS.length} of ${perSession.length} session(s) ran overnight and are clipped to observed activity — those hours are a floor, so a rate from them is a ceiling`
      : null;

  const tops = round1(sum('tops_lbs'));
  const smalls = round1(sum('smalls_lbs'));
  const finished = round1(tops + smalls);

  // Dry biomass, and the ONLY yield figure available at takedown. Product is
  // weighed into every sack (35 lb from the 2026 crop, 37 lb before), so the
  // sacks ARE a measurement — no bucking, no trim floor, no allocation needed. That matters because the
  // finished figures below are gated on every sack having been opened, and
  // sacks are only bucked when there is an order for that strain: a lot cut in
  // October can sit with no yield row until the following spring while this
  // number was knowable the day the rack came down.
  //
  // The light last sack of a lot used to be counted as full (accepted
  // 2026-09-02). Since 2026-09-28 the crew types its weight at takedown, so a
  // weighed bag counts at its own weight and only an unweighed light bag still
  // reads high.
  const sacks = sum('sacks');
  const sacksOpened = sum('sacks_opened');
  const sacksWeighed = sum('sacks_weighed');
  const fullLbs = fullSackLbs(l.season || getSeason());
  const dryLbs = sacks ? round1(sum('sack_lbs')) : null;

  // Yields are only honest once every tagged sack has actually been weighed —
  // a partially-opened lot would read as a catastrophic yield miss.
  const complete = sacks > 0 && sacksOpened === sacks;

  return {
    lot_id: lotId(l),
    // The primary session, and every session that made up this lot. Sacks and
    // the takedown picker hang off the primary; the array is what tells you a
    // lot was cut in more than one stretch, or by more than one crew.
    session_id: l.id,
    session_ids: sessions.map(s => s.id),
    sessions: perSession,
    zone: l.zone,
    cultivar: l.cultivar,
    cut_number: l.cut_number,
    plant_date: plantDate,
    plant_date_approx: !!facts?.multiDay,
    cut_date: cutDate,
    grow_days: growDays,
    acres,
    plants,
    area_basis: areaBasisFor(l.zone, l.cultivar),
    // PEAK concurrent cutters, never a sum: one crew that left and came back is
    // still that one crew, while two crews in the zone at once really do add up.
    headcount: peakHeadcount(sessions),
    headcount_basis: sessions.length > 1
      ? `peak across ${sessions.length} sessions (${perSession.map(x => x.headcount ?? '?').join(' + ')})`
      : null,
    cutter_person_hours: cutterHours,
    cutter_person_hours_measured: cutterHoursMeasured,
    cutter_person_hours_clipped: cutterHoursClipped,
    cutter_person_hours_basis: cutterHoursBasis,
    loads: sum('loads'),
    bins: sum('bins'),
    // Blocked on the uncalibrated bin constant — see CONSTANTS.
    wet_lbs: CONSTANTS.binWeightLbsWet.value === null
      ? null : round1(sum('bins') * CONSTANTS.binWeightLbsWet.value),
    sacks,
    sacks_opened: sacksOpened,
    dry_lbs: dryLbs,
    dry_lbs_basis: dryLbs === null ? null
      : `${sacks - sacksWeighed} full sacks x ${fullLbs} lb${sacksWeighed ? ` + ${sacksWeighed} weighed at takedown` : ''}; a light last sack that was not weighed still counts as full`,
    dry_lbs_per_acre: dryLbs !== null && acres ? round1(dryLbs / acres) : null,
    dry_lbs_per_plant: dryLbs !== null && plants ? +(dryLbs / plants).toFixed(3) : null,
    tops_lbs: tops,
    smalls_lbs: smalls,
    biomass_lbs: round1(sum('biomass_lbs')),
    trim_lbs: round1(sum('trim_lbs')),
    // Derived residual, not weighed — it absorbs the error in the other four
    // and the light last sack. Named apart from the rest so a reader of the
    // ledger cannot mistake it for something that went on a scale.
    waste_lbs_derived: round1(sum('waste_lbs')),
    // Deliberately still tops + smalls. Biomass and trim are real output but
    // they are not finished flower, and widening this would silently change
    // every lbs/acre figure already recorded against it.
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
    // Every tagged lot contributes, opened or not — that is the point of it.
    dry_lbs: sum(rows, 'dry_lbs'),
    tops_lbs: sum(rows, 'tops_lbs'),
    smalls_lbs: sum(rows, 'smalls_lbs'),
    biomass_lbs: sum(rows, 'biomass_lbs'),
    trim_lbs: sum(rows, 'trim_lbs'),
    waste_lbs_derived: sum(rows, 'waste_lbs_derived'),
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

/**
 * Cycle times and the event feed behind the dashboard.
 *
 * Gated for the same reason the ledger is: it carries the season's bin counts,
 * crew rates and every timestamp of the harvest.
 *
 * The lot-shaped half comes from computeRollup so the dashboard and the ledger
 * can never drift; this only adds what the ledger does not carry — the raw
 * event times. `spans_days` is stamped here rather than in the metrics module
 * because the Pacific-day rule lives with the other timestamp handling.
 */
async function getMetrics(request, db, env, params, body) {
  requireAuth(request, body, env, 'harvest-metrics');

  const isTest = isTestMode(env) ? 1 : 0;
  const season = parseInt(params.season, 10) || getSeason();
  const roll = await computeRollup(db, env, { season });

  // The rack board spans two seasons on purpose — see the SEASON note in
  // harvest-metrics.js. Kept as separate queries rather than widening the ones
  // above, because cadence, crew rates and the feed are all season figures and
  // would be wrong if last year's rows leaked into them.
  const prev = season - 1;
  const [rawSessions, loads, sacks, rackLoads, rackSacks, unopenedSacks] = await Promise.all([
    query(db, `
      SELECT id, zone, cultivar, cut_number, crew, occurred_at, closed_at, headcount
      FROM harvest_scan_log
      WHERE event_type = 'enter' AND season = ? AND is_test = ?
      ORDER BY occurred_at ASC, id ASC`, [season, isTest]),
    query(db, `
      SELECT id, zone, bins, crew, bay, occurred_at, attributed_zone_session_id AS session_id
      FROM harvest_scan_log
      WHERE event_type = 'barn_load' AND season = ? AND is_test = ?
      ORDER BY occurred_at ASC, id ASC`, [season, isTest]),
    query(db, `
      SELECT sack_id, serial, zone, cultivar, cut_number, bay,
             zone_session_id AS session_id, printed_at, opened_at
      FROM harvest_sacks
      WHERE season = ? AND is_test = ? AND voided_at IS NULL
      ORDER BY printed_at ASC`, [season, isTest]),
    query(db, `
      SELECT id, zone, bins, crew, bay, occurred_at, attributed_zone_session_id AS session_id
      FROM harvest_scan_log
      WHERE event_type = 'barn_load' AND bay IS NOT NULL AND season IN (?, ?) AND is_test = ?
      ORDER BY occurred_at ASC, id ASC`, [prev, season, isTest]),
    query(db, `
      SELECT sack_id, zone, cultivar, bay, zone_session_id AS session_id, printed_at
      FROM harvest_sacks
      WHERE bay IS NOT NULL AND season IN (?, ?) AND is_test = ? AND voided_at IS NULL
      ORDER BY printed_at ASC`, [prev, season, isTest]),
    // Where the tagged sacks are kept. NOT bay-filtered — a sack can be stored
    // with no drying bay recorded — and over the same two seasons as the racks,
    // because a sack stored in December is still in the building in January.
    // Rows with no storage come too, so the board can count them.
    query(db, `
      SELECT sack_id, season, zone, cultivar, cut_number, storage, stored_at
      FROM harvest_sacks
      WHERE season IN (?, ?) AND is_test = ? AND voided_at IS NULL AND opened_at IS NULL`,
      [prev, season, isTest]),
  ]);

  const sessions = rawSessions.map(s => ({
    ...s,
    spans_days: !!(s.closed_at &&
      pacificDay(parseSqliteUtc(s.occurred_at)) !== pacificDay(parseSqliteUtc(s.closed_at))),
  }));

  const metrics = buildMetrics({
    lots: roll.lots,
    sessions,
    loads,
    sacks,
    dryWindow: { min: DRY_DAYS_MIN, typical: DRY_DAYS_TYPICAL, max: DRY_DAYS_MAX },
    rackLoads,
    rackSacks,
    unopenedSacks,
    bottomBarnLastBay: BOTTOM_BARN_LAST_BAY,
    bayCount: BAY_MAX,
  });

  return successResponse({
    success: true,
    season,
    is_test: !!isTest,
    generated_at: new Date().toISOString(),
    constants: roll.constants,
    totals: roll.totals,
    lots: roll.lots,
    // Same rows the reconcile screen and the sweep see. On the dashboard so a
    // debt is noticed during the day rather than only at day end.
    inventory_debts: await loadInventoryDebts(db, env),
    ...metrics,
  });
}

/**
 * The one-off print jobs: the end-of-day card and one code per barn door
 * (default), one sign per zone, and one decal per trailer.
 *
 * Generated from STATIONS, TRAILERS and the zone list rather than typed out,
 * so it cannot drift from what the handler actually accepts — add a seventh
 * trailer and this sheet grows a page on its own.
 *
 * Bilingual, Spanish first, because these are read by the field and barn crew
 * the same way the screens are. (The supersack TAG is the deliberate exception
 * — it outlives the shift and is read downstream in English.)
 *
 * Deliberately NOT auto-printing the way the sack sheet does: that one fires on
 * a barn PC in kiosk mode many times a day, this is printed once a season by
 * someone who wants to pick the tray and the paper first.
 */
function codeSheetBody(ui, packet = 'crew') {
  const door = (n) => `
<section class="sheet door">
  <div class="kicker">Rogue Family Farms · 2026</div>
  <div class="big">RECEPCIÓN ${n}</div>
  <div class="sub">Barn intake ${n}</div>
  ${qrImg(`${PUBLIC_BASE}/b/${n}`, 'qr big-qr')}
  <div class="how">Si una traila no tiene su código, anota la carga aquí.</div>
  <div class="how en">If a trailer's own code is missing, log the load here.</div>
  <div class="url">${PUBLIC_BASE.replace('https://', '')}/b/${n}</div>
</section>`;

  const dayEndCard = `
  <div class="card">
    <div class="kicker">Rogue Family Farms · 2026</div>
    <div class="big">FIN DEL DÍA</div>
    <div class="sub">End of day</div>
    ${qrImg(`${PUBLIC_BASE}/fin`)}
    <div class="how">Escanéalo <strong>al terminar el día</strong>. Cierra la zona abierta.</div>
    <div class="how en">Scan at the <strong>end of the day</strong>. Closes the open zone.</div>
    <div class="url">${PUBLIC_BASE.replace('https://', '')}/fin</div>
  </div>`;

  // One decal per trailer. The printed number IS the trailer's name — they had
  // none before these (Koa, 2026-09-28) — so it is sized to read across a yard.
  const trailerSheet = (n) => `
<section class="sheet door trailer">
  <div class="kicker">Rogue Family Farms · ${getSeason()}</div>
  <div class="big trailer-num">${trailerName(n)}</div>
  <div class="sub">Traila / Trailer ${n}</div>
  ${qrImg(`${PUBLIC_BASE}/t/${n}`, 'qr trailer-qr', `QR ${trailerName(n)}`)}
  <div class="how">El chofer lo escanea <strong>cada vez que deja una carga</strong>.</div>
  <div class="how en">The driver scans this <strong>at every drop-off</strong>.</div>
  <div class="url">${PUBLIC_BASE.replace('https://', '')}/t/${n}</div>
</section>`;

  const doors = STATIONS.map(door).join('');
  const trailerSheets = TRAILERS.map(trailerSheet).join('');
  const zones = [...VALID_ZONES].filter(isHarvestTracked).sort((a,b) => a.localeCompare(b,'en',{numeric:true}));
  const zoneSheets = zones.map(z => `<section class="sheet door"><div class="kicker">Rogue Family Farms · ${getSeason()}</div><div class="big">ZONA ${z}</div><div class="sub">Zone ${z}</div>${qrImg(`${PUBLIC_BASE}/z/${z}`, 'qr big-qr', `QR ${z}`)}<div class="how">Escanea al empezar a cortar. Confirma el cultivar.</div><div class="how en">Scan when cutting starts. Confirm the cultivar.</div><div class="url">${PUBLIC_BASE.replace('https://','')}/z/${z}</div></section>`).join('');
  const pages = packet === 'zones' ? zones.length
    : packet === 'trailers' ? TRAILERS.length : STATIONS.length + 1;

  return `
<style>
  @page { size: letter portrait; margin: 0.4in; }
  body { background: #fff; color: #111; }
  .codesheet { font-family: -apple-system, system-ui, sans-serif; }
  .codesheet .sheet { page-break-after: always; text-align: center; }
  .codesheet .sheet:last-child { page-break-after: auto; }
  .kicker { font-size: 11pt; letter-spacing: .18em; text-transform: uppercase; color: #667; }
  .big { font-size: 46pt; font-weight: 900; letter-spacing: -.02em; line-height: 1; margin: 6pt 0 2pt; }
  .sub { font-size: 15pt; font-weight: 600; color: #445; margin-bottom: 10pt; }
  .qr { display: block; margin: 0 auto; width: 2.6in; height: 2.6in; }
  .how { font-size: 12pt; color: #223; margin: 10pt auto 0; max-width: 5in; line-height: 1.35; }
  .how.en { font-size: 10.5pt; color: #667; margin-top: 3pt; }
  .url { font-family: ui-monospace, Menlo, monospace; font-size: 9.5pt; color: #889; margin-top: 8pt; }

  /* Crew cards: two to a page, cut down the middle, each a half-letter card
     that trims into a laminating pouch and rides a clipboard.

     Each card is a FIXED 4.6in rather than the pair filling the page. Sized to
     the page, the two cards plus the wrapper's body padding came to more than
     a letter sheet holds and the second card printed on its own sheet — and it
     would have broken again on any margin preset but the default. 2 x 4.6in
     plus the gap is 9.35in, inside the printable area even at 0.75in margins. */
  .cards { display: grid; gap: 0.15in; }
  /* Fixed height so two fill a letter page exactly and cut identically —
     10.2in printable, 2 x 4.6in + a 0.15in gap = 9.35in. A THIRD does not fit
     (14.1in), which is why the end-of-day card gets its own page rather than
     being appended here. break-inside guards the same mistake being made
     again: a card that spills is a card cut in half. */
  .card { height: 4.6in; box-sizing: border-box;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          border: 1.5pt dashed #bbb; border-radius: 8pt; padding: 12pt; text-align: center;
          break-inside: avoid; page-break-inside: avoid; }
  .card .big { font-size: 34pt; }
  .card .qr { width: 2.1in; height: 2.1in; }

  /* Door codes: read from across the barn, so the QR is the page. */
  .door { padding-top: 0.5in; }
  .door .big-qr { width: 5.2in; height: 5.2in; }
  .door .big { font-size: 54pt; }
  /* Trailer decals: the number is the name, read from the driver's seat. */
  .trailer .trailer-num { font-size: 150pt; line-height: .9; }
  .trailer .trailer-qr { width: 4.6in; height: 4.6in; }

  .noprint { max-width: 6.5in; margin: 0 auto 18pt; padding: 12pt 14pt; border: 1pt solid #ccd;
             border-radius: 8pt; background: #f6f7f9; font-size: 11pt; color: #334; text-align: left; }
  .noprint ul { margin: 6pt 0 0; padding-left: 18pt; }
  @media screen {
    .codesheet { max-width:860px; margin:auto; }
    .codesheet .sheet { margin:20px 0; background:white; border:1px solid #d4dccd; border-radius:12px; padding:20px; }
    .codesheet .noprint { background:#edf1e4; color:#304e3c; line-height:1.7; border-radius:14px; }
    .codesheet .noprint a,.codesheet .noprint button { display:inline-block;padding:10px 14px;margin:4px;border:1px solid #becdb2;border-radius:8px;color:#304e3c;background:white;text-decoration:none;font:inherit;cursor:pointer; }
    .codesheet .big-qr { max-width:100%; height:auto; }
    .codesheet .url { overflow-wrap:anywhere; }
    @media(max-width:600px){.codesheet .big,.codesheet .door .big{font-size:36px}.codesheet .how{font-size:15px}.codesheet .card{height:auto;min-height:4.6in}.codesheet .qr{max-width:100%;height:auto}}
  }
  @media print {
    .noprint { display: none; }
    /* The page wrapper pads the body and floats a language toggle in the
       corner. Both are for the screen: the padding stacks on top of the @page
       margin and steals a quarter inch from every sheet, and the toggle would
       print as a stray "ES" on a laminated sign. */
    body { margin: 0; padding: 0; }
    .lang { display: none; }
  }
</style>
<div class="codesheet">
  <div class="noprint">
    <strong>${ui.t('printCodes')}</strong> — ${pages} pages.
    <div><a href="${API}?action=hub&lang=${ui.lang}">${ui.lang === 'es' ? 'Herramientas' : 'All tools'}</a><a href="${API}?action=print_codes&packet=crew&lang=${ui.lang}">Barn / Recepción</a><a href="${API}?action=print_codes&packet=trailers&lang=${ui.lang}">Trailers / Trailas</a><a href="${API}?action=print_codes&packet=zones&lang=${ui.lang}">Zones / Zonas</a><button type="button" onclick="window.print()">Print / Imprimir</button><a href="${API}?action=practice&lang=${ui.lang}">${ui.lang === 'es' ? 'Practicar sin guardar' : 'Practice without saving'}</a></div>
    Print at 100% (no &ldquo;fit to page&rdquo;), then laminate.
    ${packet === 'zones' ? '<p>One zone per page / Una zona por página.</p>'
      : packet === 'trailers' ? '<p>One trailer per page / Una traila por página. Weatherproof decal or a laminated sheet on the trailer.</p>'
      : `<ul>
      <li><strong>Page 1</strong> — End of day / Fin del día.</li>
      <li><strong>Pages 2–${STATIONS.length + 1}</strong> — one per barn intake door. The fallback
          when a trailer's own code is missing.</li>
    </ul>`}
  </div>

  ${packet === 'zones' ? zoneSheets : packet === 'trailers' ? trailerSheets
    : `<section class="sheet cards">${dayEndCard}</section>
  ${doors}`}
</div>`;
}

// ─── HTML RENDERING ─────────────────────────────────────

function renderPage(ui, title, bodyHtml, status = 200) {
  const lang = ui.lang;
  const working = !bodyHtml.includes('class="sd"') && !bodyHtml.includes('class="harvest-hub"') && !bodyHtml.includes('class="codesheet"');
  const chrome = `<header class="harvest-header"><img src="${SACK_BRAND_LOGO}" alt="Rogue Origin" width="54" height="54"><div><strong>ROGUE ORIGIN</strong><small>${lang === 'es' ? 'Del campo a la flor' : 'From field to flower'}</small></div><nav aria-label="${lang === 'es' ? 'Navegación' : 'Navigation'}"><a href="${API}?action=hub&lang=${lang}">${lang === 'es' ? 'Herramientas' : 'All tools'}</a><a href="${escapeHtml(ui.toggle)}" data-lang-swap>${ui.t('langOther')}</a></nav></header>`;
  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Harvest</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 24px 20px; background: #14251a; color: #f2f6f2; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; }
  .sub { color: #9fc2ac; margin: 0 0 20px; }
  h1 .code { font-size: 0.62em; font-weight: 700; color: #9fc2ac; }
  .serial { font-size: 2.4rem; font-weight: 800; line-height: 1; margin: 2px 0 2px; }
  .fullid { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.78rem;
            color: #7fa78e; letter-spacing: .04em; margin: 0 0 20px; }
  .note { color: #cfe3d6; margin: 8px 0; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 12px; }
  /* The chosen number changes HUE, not shade: at arm's length in daylight a
     darker green reads as a shadow, amber reads as "this one". */
  .grid a.btn { position: relative; }
  .grid a.btn:active { transform: scale(0.96); }
  .grid a.btn.sel { background: #e9c462; color: #1b2b20; font-weight: 800;
                    box-shadow: inset 0 0 0 3px #fff3d1; }
  .grid a.btn.sel::after { content: '✓'; position: absolute; top: 3px; right: 7px;
                           font-size: 0.72rem; font-weight: 800; }
  .grid a.btn.saving { opacity: 0.55; }
  .hcstat { margin-top: 14px; font-size: 1.15rem; font-weight: 700; min-height: 1.5em; }
  .hcstat.ok { color: #8fe3ad; }
  .hcstat.bad { color: #ffb3b3; }
  a.btn, button.btn { display: block; text-align: center; padding: 18px 8px; font-size: 1.2rem; font-weight: 600;
    background: #2f7a4f; color: #fff; text-decoration: none; border-radius: 10px; border: none; }
  a.btn.alt { background: #3a5f4c; }
  .footer { margin-top: 28px; font-size: 0.9rem; }
  .footer a { color: #9fc2ac; }
  select, input[type=number], input[type=text], input:not([type]) { font-size: 1.2rem; padding: 12px; width: 100%; box-sizing: border-box; margin: 8px 0 16px; border-radius: 8px; border: none; }
  label { font-size: 1rem; color: #cfe3d6; }

  /* Harvest tools home — one lane per stage, in the order the material moves.
     Each lane has its own colour so a stage is found by colour before it is
     read. A card that only works from a printed QR is not a link at all. */
  .hub-search { display: flex; gap: 10px; margin: 6px 0 22px; }
  .hub-search input { margin: 0; }
  .hub-search .btn { margin: 0; padding: 12px 20px; white-space: nowrap; cursor: pointer; }
  .lane { margin: 0 0 22px; border-left: 6px solid var(--lane); padding-left: 14px; }
  .lane-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
  .lane-n { flex: none; width: 1.9rem; height: 1.9rem; border-radius: 50%; background: var(--lane); color: #14251a;
            font-weight: 800; display: inline-flex; align-items: center; justify-content: center; }
  .lane-t { font-size: 1.25rem; font-weight: 800; }
  .lane-s { color: #9fc2ac; font-size: 0.9rem; }
  .hubgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 10px; }
  .hubcard { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; border-radius: 12px;
             background: #1b3123; border: 1px solid #2c4a36; color: #f2f6f2; text-decoration: none; }
  a.hubcard:hover { border-color: var(--lane); background: #21402c; }
  a.hubcard.primary { background: #2f7a4f; border-color: #3f9a66; }
  .hubcard .ht { font-size: 1.12rem; font-weight: 700; }
  .hubcard .hd { color: #cfe3d6; font-size: 0.9rem; line-height: 1.35; }
  .hubcard .hb { align-self: flex-start; margin-top: 4px; font-size: 0.68rem; font-weight: 800; letter-spacing: .06em;
                 padding: 3px 7px; border-radius: 4px; background: #3a5f4c; color: #fff; }
  .hubcard.scan { border-style: dashed; }
  .hubcard.scan .hb { background: #8a6d1f; }
  .hubcard code { font-size: 0.85rem; color: #e9c462; }

  /* Takedown session screen — big targets, gloves on, one job per press. */
  .lot { border-left: 4px solid #2f7a4f; padding-left: 12px; margin-bottom: 22px; }
  .topnav { display: flex; gap: 10px; margin: 0 0 18px; }
  .topnav a.btn { flex: 1; padding: 14px 8px; font-size: 1.05rem; }
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
  /* A real button, not a grey line: a collapsed section is exactly where
     Reopen went unfound (Koa, 2026-09-28). Closed so PRINT TAG stays on top. */
  .batch.taglist > summary { font-size: 1.05rem; font-weight: 600; padding: 14px 16px; border-radius: 10px;
                       background: #edf1e4; color: #304e3c; border: 1px solid #c2cdb8; }
  .tagrows { display: grid; gap: 8px; margin-top: 8px; }
  .tagrow { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; justify-content: space-between;
            padding: 10px 12px; background: #1b3123; border: 1px solid #2c4a36; border-radius: 10px; color: #f4f1e8; }
  .tagrow .taginfo { display: flex; flex-direction: column; }
  .tagrow .tagid { font-size: 1.1rem; }
  .tagrow .tagwhen { color: #9fc2ac; font-size: 0.85rem; }
  .tagrow .tagacts { display: flex; gap: 8px; align-items: center; }
  .tagrow.voided { opacity: 0.55; }
  .tagrow.voided .tagid { text-decoration: line-through; }
  /* The note for the NEXT tag sits above PRINT TAG, closed until someone needs
     it. A note waiting to go out turns the heading gold and the button says so. */
  .nextnote { margin: 0 0 12px; color: #cfe3d6; }
  .nextnote summary { cursor: pointer; padding: 8px 0; font-size: 1.05rem; }
  .nextnote.pending summary { color: #e9c462; font-weight: 700; }
  .nextnote textarea { width: 100%; box-sizing: border-box; font: inherit; font-size: 1.1rem; padding: 12px;
                       border: none; border-radius: 8px; resize: vertical; margin: 4px 0 6px; }
  .fillrow { display: flex; align-items: center; gap: 10px; margin: 4px 0 6px; }
  .fillrow input { width: 7em; margin: 0; font-size: 1.4rem; font-weight: 700; text-align: center; }
  .fillrow span { font-size: 1.2rem; font-weight: 700; }
  a.mini { display: inline-block; padding: 10px 16px; background: #3a5f4c; color: #fff;
           text-decoration: none; border-radius: 8px; font-size: 0.95rem; }
  a.mini.danger { background: #7a3a3a; }
  .batch { margin-top: 26px; color: #9fc2ac; }
  .batch summary { cursor: pointer; padding: 8px 0; }
  .batchrow { display: flex; gap: 10px; align-items: center; }
  .batchrow input { margin: 0; max-width: 110px; }
  .batchrow .btn { margin: 0; white-space: nowrap; padding: 12px 18px; font-size: 1rem; }
  .hint { color: #9fc2ac; font-size: 0.85rem; font-weight: normal; }
  /* Inventory writes that never settled. Amber, not red, as a whole: most are
     retryable. The UNKNOWN line inside goes red because it is the one nobody
     may replay blindly — the call may have landed, and replaying doubles the
     count, which reads exactly like an honest number. */
  .debt { border: 2px solid #e0a53a; background: #2b2417; border-radius: 12px;
          padding: 16px 18px; margin: 14px 0; color: #f6e9cf; }
  .debt strong { display: block; font-size: 1.1rem; margin-bottom: 8px; }
  .debt-row { margin: 4px 0; }
  .debt-row.bad { color: #ffb3b3; font-weight: 700; }
  .debt-ids { margin-top: 10px; line-height: 1.9; }
  .debt-ids code { background: #1b2b20; border: 1px solid #3a5946; border-radius: 6px;
                   padding: 2px 7px; font-size: 0.9rem; }
  .debt-why { margin-top: 10px; color: #cfe3d6; font-size: 0.9rem; }
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
  details.greenlots { margin: 0 0 20px; }
  details.greenlots .lotlist { margin-top: 6px; }
  .lotbody { display: block; min-width: 0; }
  .lothead { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 1.1rem; }
  .lotmeta { display: block; color: #9fc2ac; font-size: 0.88rem; margin-top: 4px; }
  .baypill { font-size: 0.8rem; font-weight: 800; padding: 3px 9px; border-radius: 999px; white-space: nowrap;
             background: #e9c462; color: #1b2b20; }
  /* Takedown by bay: the bay leads the card, the zones it holds sit under it. */
  .baybig { display: inline-block; font-size: 1.15rem; font-weight: 800; padding: 2px 10px; border-radius: 8px;
            background: #e9c462; color: #1b2b20; white-space: nowrap; }
  .zonemix { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .zchip { font-size: 0.92rem; padding: 3px 10px; border-radius: 999px; background: #2c4a36; color: #f2f6f2; white-space: nowrap; }
  .zchip b { color: #e9c462; }
  .badge { font-size: 0.68rem; font-weight: 800; letter-spacing: 0.06em;
           padding: 3px 7px; border-radius: 4px; white-space: nowrap; }
  .badge.ok   { background: #2f7a4f; color: #fff; }
  .badge.warn { background: #8a6d1f; color: #fff; }
  .badge.bad  { background: #7a3a3a; color: #fff; }
  /* Closing a lot out. Its own forms, outside the takedown form, so closing a
     lot can never start one — and Reopen sits one press away. */
  form.finishrow { display: flex; gap: 12px; align-items: center; padding: 14px; margin: 0;
                   background: #1b3123; border: 1px solid #2c4a36; border-radius: 10px; }
  form.finishrow .lotbody { flex: 1; }
  /* Name on its own line, buttons under it side by side — room on a phone for
     Resume and Finished without either shrinking to an unreadable tap target. */
  form.finishrow { flex-wrap: wrap; }
  form.finishrow .lotbody { flex: 1 1 100%; }
  form.finishrow a.btn { flex: 1; }
  form.finishrow button.btn, form.finishrow a.btn { flex: none; margin: 0; padding: 14px 18px; font-size: 1rem; cursor: pointer; }
  form.finishrow.done { background: #17271c; }
  button.btn.alt { background: #3a5f4c; }
  .finishlot { margin-top: 26px; }
  .finishlot button.btn { width: 100%; cursor: pointer; }
  .finishlot .hint { display: block; margin-top: 6px; }
  .finished summary { font-size: 1rem; }
  .notice { background: #3d3214; border: 1px solid #8a6d1f; border-left: 6px solid #e9c462; border-radius: 8px;
            padding: 14px 16px; margin: 0 0 18px; font-size: 1.05rem; color: #f4f1e8; }
  .notice button.btn { margin-top: 12px; width: 100%; cursor: pointer; }
  .notice a.btn { margin-top: 12px; }
  .notice .hint { display: block; margin-top: 8px; }
  /* ── Sack scan page ──────────────────────────────────────────────────
     A crew member holding a sack, phone at arm's length, gloves on, barn
     light. Built like field signage: three dark planes (page → card →
     raised), warm off-white ink, and straw for the one thing that matters
     most — the number on the tag — and for "allocated, not weighed".
     Every ink/surface pair below was checked numerically (body ink ≥ 6.7:1,
     nothing under 13px). No fonts, no assets: it loads on one bar. */
  .sd { color: #f4f1e8; --card: #1c3123; --raised: #27412f; --line: #35513e; --ink2: #d3e2d3;
        --muted: #9fbcaa; --straw: #e9c462; --tops: #4fbd7c; --smalls: #b5e9c3;
        /* Biomass and trim are real output, so they keep saturated colour.
           Waste is a derived residual and is deliberately the dullest thing
           on the bar — it must never read as a weighed part. */
        --biomass: #7aa7d8; --trim: #d8b45f; --waste: #55705f;
        --lift: inset 0 1px 0 rgba(255,255,255,.05), 0 1px 0 rgba(0,0,0,.35), 0 12px 26px -16px rgba(0,0,0,.75); }
  .sd .hint { color: var(--muted); font-size: 0.9rem; }
  .sd .note { color: var(--ink2); font-size: 1.05rem; line-height: 1.45; }
  .sd h2 { font-size: 0.82rem; letter-spacing: 0.14em; color: var(--muted); margin: 30px 0 10px;
           padding-bottom: 8px; border-bottom: 2px solid var(--line); }
  .sd .card, .sd .tile, .sd .notecard, .sd .sd-head {
    background: var(--card); border: 1px solid var(--line); color: #f4f1e8; box-shadow: var(--lift); }

  /* The tag plate: what they just scanned, set the way it reads on the bag.
     Straw edge and straw number — the one place the accent is loud. */
  /* The stamp sits on its own row rather than beside the name. Sharing a row
     meant a nowrap pill took its width first and pushed the cultivar onto two
     lines -- "NOT OPENED" is wide enough to do it at 375px. Shrinking the pill
     would have fixed the symptom by dropping it under 13px, which is the one
     thing this page cannot trade away. */
  .sd-head { display: block; padding: 12px 16px 14px 18px; border-left: 6px solid var(--straw);
             border-radius: 6px 12px 12px 6px; background: linear-gradient(180deg, #203828, var(--card)); }
  .sd-head .sd-state { display: flex; justify-content: flex-end; margin: 0 0 8px; }
  .sd-head h1 { font-size: 1.15rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
                margin: 0; color: var(--ink2); }
  .sd-head h1 .code { font-size: 0.82em; font-weight: 600; letter-spacing: 0.08em; color: var(--muted); }
  .sd-head .serial { font-size: 3.4rem; font-weight: 900; letter-spacing: -0.03em; line-height: 1;
                     margin: 8px 0 6px; color: var(--straw); }
  .sd-head .fullid { margin: 0; font-size: 0.88rem; color: var(--muted); }
  .sd-head .badge { margin-top: 2px; flex: none; }

  /* Stamps: bordered, uppercase, tracked. State on the plate, source on the weights. */
  .sd .badge { font-size: 0.82rem; font-weight: 800; letter-spacing: 0.1em; padding: 8px 12px;
               border-radius: 6px; border: 2px solid transparent; }
  .sd .badge.ok      { background: #1f5a39; border-color: #3f9a66; color: #f4f1e8; }
  .sd .badge.neutral { background: var(--raised); border-color: #5f8069; color: #f4f1e8; }
  .sd .badge.bad     { background: #5a2424; border-color: #c25a5a; color: #ffe6e6; }
  .sd .badge.warn    { background: var(--straw); border-color: var(--straw); color: #2a2007; }
  .flash { background: #1f4a2f; border: 1px solid #3f9a66; border-left: 6px solid #3f9a66; border-radius: 8px;
           padding: 14px 16px; margin: 0 0 18px; font-size: 1.08rem; font-weight: 600; color: #f4f1e8; }

  .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 10px 0 0; }
  .tile { border-radius: 10px; padding: 12px 12px 11px; min-width: 0;
          display: flex; flex-direction: column; justify-content: flex-end; }
  .tile .tl { display: block; font-size: 0.82rem; font-weight: 700; text-transform: uppercase;
              letter-spacing: 0.1em; color: var(--muted); }
  .tile .tv { display: block; font-size: 1.7rem; font-weight: 800; line-height: 1.1; margin-top: 4px;
              letter-spacing: -0.01em; overflow-wrap: anywhere; }
  .tile .ts { display: block; font-size: 0.9rem; color: var(--ink2); margin-top: 3px; }

  .card { border-radius: 12px; padding: 16px; }
  /* A button with an edge: pressable at a glance, and it visibly goes down. */
  .sd .bigbtn { min-height: 120px; border-radius: 12px; letter-spacing: 0.06em;
                box-shadow: inset 0 -5px 0 rgba(0,0,0,.28), 0 2px 0 rgba(0,0,0,.45); }
  .sd .bigbtn:active { box-shadow: inset 0 2px 0 rgba(0,0,0,.3); transform: translateY(2px); }

  /* Weights: tops + smalls stacked on a 37-lb track, the track recessed into
     the card. Two steps of one green (ordered tiers), a 2px surface gap. */
  .wtop { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
  .wtop .tv { font-size: 2.3rem; font-weight: 900; line-height: 1; letter-spacing: -0.02em; }
  .wtop .hint { font-size: 0.95rem; }
  .wtop .badge { margin-left: auto; align-self: center; }
  .wbar { position: relative; display: flex; gap: 2px; height: 32px; background: var(--raised);
          border-radius: 7px; overflow: hidden; box-shadow: inset 0 2px 4px rgba(0,0,0,.45); }
  .seg { height: 100%; flex: 0 0 auto; }
  .seg.tops { background: var(--tops); }
  .seg.smalls { background: var(--smalls); }
  .seg.biomass { background: var(--biomass); }
  .seg.trim { background: var(--trim); }
  /* Hatched, not solid: a derived residual should not look measured. */
  .seg.waste { background: repeating-linear-gradient(45deg, var(--waste) 0 4px, #47614f 4px 8px); }
  .seg:last-child { border-radius: 0 5px 5px 0; }
  .wbar .tick { position: absolute; top: 0; bottom: 0; width: 3px; background: #f4f1e8; }
  .wscale { display: flex; justify-content: space-between; font-size: 0.88rem; color: var(--muted);
            margin-top: 6px; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }
  .legend { display: flex; gap: 20px; flex-wrap: wrap; margin-top: 12px; font-size: 1.05rem; color: var(--ink2); }
  .legend .sw { display: inline-block; width: 16px; height: 16px; border-radius: 4px; margin-right: 8px;
                vertical-align: -2px; }
  .legend .sw.tops { background: var(--tops); }
  .legend .sw.smalls { background: var(--smalls); }
  .legend .sw.biomass { background: var(--biomass); }
  .legend .sw.trim { background: var(--trim); }
  .legend .sw.waste { background: repeating-linear-gradient(45deg, var(--waste) 0 3px, #47614f 3px 6px); }
  .legend strong { font-weight: 800; color: #f4f1e8; }
  .empty { font-size: 2.3rem; font-weight: 900; color: var(--muted); margin: 0 0 8px; line-height: 1; }

  /* Journey: planted → cut → bagged → opened / today. Vertical so it never
     cramps on a phone; the spans between nodes carry the day counts. Done
     nodes are green with a ring; "today" is a straw ring — now, not yet. */
  .journey { list-style: none; margin: 6px 0 0; padding: 0; }
  .journey li { display: grid; grid-template-columns: 26px 1fr; column-gap: 14px; }
  .journey .node { align-items: center; padding: 4px 0; font-size: 1.08rem; }
  .journey .dot { width: 16px; height: 16px; border-radius: 50%; background: var(--tops); justify-self: center;
                  box-sizing: border-box; box-shadow: 0 0 0 3px #14251a, 0 0 0 5px var(--line); }
  .journey .dot.open { background: transparent; border: 3px solid var(--straw);
                       box-shadow: 0 0 0 3px #14251a, 0 0 0 5px var(--line); }
  .journey .dot.none { background: transparent; border: 2px solid var(--line); box-shadow: none; }
  .journey .node > span { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
  .journey .node strong { font-weight: 800; }
  .journey .node .when { color: var(--ink2); text-align: right; font-variant-numeric: tabular-nums; }
  .journey .span { min-height: 40px; }
  .journey .line { width: 3px; background: var(--line); justify-self: center; height: 100%; border-radius: 2px; }
  .journey .span .dur { align-self: center; color: var(--muted); font-size: 0.98rem; padding: 6px 0; }
  .journey .span .dur strong { color: #f4f1e8; font-size: 1.12rem; font-weight: 800; }
  .sd .kv { border-bottom: 0; border-top: 2px solid var(--line); margin-top: 12px; padding: 12px 0 0; font-size: 1.02rem; }
  .sd .kv span { color: var(--muted); }

  .notecard { border-left: 4px solid #5f8069; border-radius: 0 10px 10px 0; padding: 12px 14px; margin: 10px 0;
              font-size: 1.02rem; line-height: 1.45; }
  .notecard .hint { display: block; margin-top: 4px; }
  .sd .batch { margin-top: 14px; color: var(--ink2); }
  .sd .batch summary { font-size: 1.05rem; font-weight: 600; padding: 14px 0; }
  .sd .batch input { background: #f4f1e8; color: #14251a; }
  .sd .footer a { color: var(--muted); font-weight: 600; font-size: 1rem; }
  /* Language toggle — small and out of the way. Spanish is the default, so
     this is an escape hatch for an English reader, not a decision the crew is
     asked to make on every screen. */
  .lang { position: fixed; top: 8px; right: 10px; font-size: 0.8rem; }
  .lang a { color: #9fc2ac; text-decoration: none; border: 1px solid #2c4a36;
            padding: 5px 9px; border-radius: 999px; background: #1b3123; }
  @media print { .lang { display: none; } }

  /* Test mode is the default, and switching it off lives in a deploy-time
     variable. A redeploy that forgets it writes every real scan as test data —
     which the season's own cleanup step then DELETEs. Nothing on screen used to
     say so, so the failure would have been invisible until the barn was empty
     and the ledger was too. Loud, top of every crew screen, both languages. */
  /* The language toggle is position:fixed at top right, so a band in normal
     flow runs straight underneath it — on a 390px phone the message crossed
     "Cuadrilla A / English". Reserving side gutters was not enough: the toggle
     plus the crew chip is wider than any gutter that leaves room for the text.
     So the toggle moves DOWN below the band instead, which also puts it in the
     same relationship to the page content it has on every other screen.
     The band exists to be unmistakable, not to explain; the explaining is the
     SOP's job, which is why the copy is two words. */
  .testband { background: #7a3a3a; color: #fff; font-weight: 800; font-size: 0.9rem;
              letter-spacing: 0.14em; text-transform: uppercase; text-align: center;
              padding: 11px 12px; margin: -24px -20px 18px; }
  body.testmode .lang { top: 50px; }
  @media print { .testband { display: none; } }
  ${SACK_DETAIL_STYLE}
  ${HARVEST_UI_STYLE}
</style>
<script>
// Language without a reload: fetch the same page in the other language and
// swap the body in. The response carries the language cookie, so the next scan
// still comes back in the chosen language, and the URL is updated so a refresh
// or a shared link keeps it. Falls back to ordinary navigation on any error —
// the link works with this script broken or absent.
(function () {
  if (window.__langSwap) return;
  window.__langSwap = true;
  var busy = false;
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-lang-swap]');
    if (!a || busy || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    busy = true;
    var href = a.href, before = a.textContent;
    a.textContent = '…';
    fetch(href, { headers: { 'X-Lang-Swap': '1' } })
      .then(function (r) { if (!r.ok) throw new Error('lang'); return r.text(); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        // Long-running screens stop their timers before their nodes go.
        window.dispatchEvent(new Event('harvest:swap'));
        document.documentElement.lang = doc.documentElement.lang || document.documentElement.lang;
        document.title = doc.title;
        document.body.className = doc.body.className;
        document.body.replaceChildren.apply(document.body, Array.prototype.map.call(doc.body.childNodes, function (n) {
          return document.importNode(n, true);
        }));
        // A script inserted as markup does not run; re-create each one so the
        // swapped-in screen is as alive as a freshly loaded one.
        Array.prototype.forEach.call(document.body.querySelectorAll('script'), function (old) {
          var s = document.createElement('script');
          for (var i = 0; i < old.attributes.length; i++) s.setAttribute(old.attributes[i].name, old.attributes[i].value);
          s.textContent = old.textContent;
          old.replaceWith(s);
        });
        try { history.replaceState(null, '', href); } catch (_) { /* file:// and the like */ }
        busy = false;
      })
      .catch(function () { a.textContent = before; busy = false; location.href = href; });
  });
})();
</script>
</head>
<body${ui.isTest ? ' class="testmode"' : ''}>
${ui.isTest ? `<div class="testband">${ui.t('testBand')}</div>` : ''}
<div class="lang"><a href="${ui.toggle}" data-lang-swap>${ui.t('langOther')}</a></div>
${working ? `<main class="harvest-screen">${chrome}${bodyHtml}</main>` : bodyHtml}
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
function makeUi(request, env = null) {
  const lang = pickLang(request);
  const url = new URL(request.url);
  const other = lang === 'es' ? 'en' : 'es';
  url.searchParams.set('lang', other);
  return {
    lang,
    toggle: url.pathname + url.search,
    // Carried on the ui rather than threaded through renderPage's 28 callers.
    // Every crew screen has to be able to say it, because the ONE thing a
    // silent test mode looks like is a system working perfectly.
    isTest: env ? isTestMode(env) : false,
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

/**
 * The cutter grid, showing WHICH number is currently set.
 *
 * It used to render identically before and after a tap, so the only evidence
 * anything had happened was a headline above a grid that looked untouched --
 * and the crew lead's eye is on the grid, because that is what they just
 * pressed. Koa, using it: "I pick the cutter amount but I'm unsure if it's
 * entered." Marking the selection is what answers that.
 */
function headcountGrid(ui, zone, sessionId, current = null) {
  const q = `${API}?lang=${ui.lang}&zone=${zone}&action=headcount&session_id=${sessionId}`;
  const cell = (n, extra = '') => {
    const on = Number(current) === n;
    return `<a class="btn${extra}${on ? ' sel' : ''}" data-n="${n}" href="${q}&count=${n}"`
      + ` aria-pressed="${on}">${n}</a>`;
  };
  return HEADCOUNT_OPTIONS.map(n => cell(n)).join('');
}

/**
 * Instant feedback on tap, then save in the background.
 *
 * Without this the tap starts a page load, and on one bar in a field that gap
 * is silent -- which is the other half of "did that go through?". The button
 * lights up before the network is touched, so the answer never depends on
 * signal.
 *
 * Progressive enhancement on purpose: the cells stay real links, so with no JS
 * (or if fetch throws) the old navigation still records the headcount and the
 * page it lands on now shows the selection too.
 */
function headcountScript(ui) {
  const T = JSON.stringify({
    saving: ui.t('hcSaving'),
    saved: ui.t('loggedCutters', { n: '{n}' }),
    saved1: ui.t('loggedCutter'),
    failed: ui.t('hcFailed'),
  });
  return `<script>
(function () {
  var grid = document.querySelector('.grid');
  var stat = document.getElementById('hcstat');
  if (!grid || !stat || !window.fetch) return;
  var T = ${T}, busy = false;

  grid.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a.btn') : null;
    if (!a || busy) return;
    e.preventDefault();
    busy = true;

    var prev = grid.querySelector('a.btn.sel');
    if (prev) { prev.classList.remove('sel'); prev.setAttribute('aria-pressed', 'false'); }
    a.classList.add('sel', 'saving');
    a.setAttribute('aria-pressed', 'true');
    stat.className = 'hcstat';
    stat.textContent = T.saving;

    var n = a.getAttribute('data-n');
    fetch(a.href, { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function () {
        a.classList.remove('saving');
        stat.className = 'hcstat ok';
        stat.textContent = (n === '1' ? T.saved1 : T.saved.replace('{n}', n));
        busy = false;
      })
      .catch(function () {
        // Never leave it looking saved when it is not.
        a.classList.remove('sel', 'saving');
        a.setAttribute('aria-pressed', 'false');
        if (prev) { prev.classList.add('sel'); prev.setAttribute('aria-pressed', 'true'); }
        stat.className = 'hcstat bad';
        stat.textContent = T.failed;
        busy = false;
      });
  });
})();
</script>`;
}

/**
 * Cultivar picker — shown after scanning a trial/split zone's sign, before the
 * session opens. Big tap targets: this is a gloved thumb in a field.
 */
function cultivarPickerBody(ui, zone, options, crew = null) {
  const buttons = options.map(cv =>
    `<a class="btn cvbtn" href="/z/${encodeURIComponent(zone)}?lang=${ui.lang}${crew ? `&crew=${crew}` : ''}&cultivar=${encodeURIComponent(cv)}">${escapeHtml(cv)}</a>`
  ).join('');
  return `
<h1>${escapeHtml(zone)}</h1>
<p class="sub">${crew ? `${escapeHtml(crewLabel(ui, crew))} · ` : ''}${ui.t('nCultivars', { n: options.length })}</p>
<p class="note">${ui.t('whichCutting')}</p>
<div class="cvgrid">${buttons}</div>`;
}

/** "Z4 · Sour Lifter · Corte 1 · Cuadrilla A · Nico" — every lot picker. */
function lotLabelText(ui, l) {
  return `${escapeHtml(l.zone)} · ${escapeHtml(l.cultivar || '?')} · ${ui.t('cut', { n: l.cut_number ?? '?' })}${
    crewById(l.crew) ? ` · ${escapeHtml(crewLabel(ui, l.crew))}` : ''}`;
}

/**
 * Which crew — the first thing a zone sign asks. One big button per crew, in
 * its own colour so a lead finds theirs before reading it. Links, so a tap is
 * one GET carrying everything the scan already had (cultivar, test cut).
 */
function crewPickerBody(ui, zone, params = {}) {
  const keep = ['cultivar', 'test_cut'].filter(k => params[k])
    .map(k => `&${k}=${encodeURIComponent(params[k])}`).join('');
  const buttons = CREWS.map(c =>
    `<a class="btn crewbtn crew-${c.id}" href="/z/${encodeURIComponent(zone)}?lang=${ui.lang}&crew=${c.id}${keep}">`
    + `<span class="crewletter">${c.id}</span><span class="crewlead">${escapeHtml(c.lead)}</span></a>`
  ).join('');
  return `
<h1>${escapeHtml(zone)}</h1>
<p class="sub">${ui.t('whichCrew')}</p>
<div class="crewgrid">${buttons}</div>
<p class="note"><span class="hint">${ui.t('whichCrewSub')}</span></p>`;
}

/**
 * The crew's day: which trailers run for it, and — on the first zone scan
 * only — how many cutters, water spiders and drivers it starts with.
 *
 * Trailers are optional: tick none and the crew keeps its last assignment
 * (named on the form), less any trailer another crew has claimed today. From
 * the crew card ("change trailers") today's are ticked and only trailers move.
 * The people are tap buttons with nothing pre-picked: counted fresh each day,
 * and changes after that come in on the hourly report.
 */
function crewDayFormBody(ui, { crew, zone, cultivar, testCut = null, sessionId = null, prefill = null, today = [], editing = false }) {
  const mine = prefill ? trailerList(prefill.trailers) : [];
  const elsewhere = new Map();
  for (const r of today) {
    if (r.crew === crew) continue;
    for (const n of trailerList(r.trailers)) elsewhere.set(n, r.crew);
  }
  const fallback = mine.filter(n => editing || !elsewhere.has(n));
  const tiles = TRAILERS.map(n => `<label class="trtile"><input type="checkbox" name="t${n}" value="1"${
    editing && mine.includes(n) ? ' checked' : ''}><span class="trname">${trailerName(n)}</span>${
    elsewhere.has(n) ? `<span class="trwith">${ui.t('crewTrailerWith', { c: elsewhere.get(n) })}</span>` : ''}</label>`).join('');
  const trailerHint = fallback.length
    ? `<p class="note"><span class="hint">${ui.t(editing ? 'crewTrailersKeepNow' : 'crewTrailersKeep', {
      t: fallback.map(trailerName).join(' · ') })}</span></p>`
    : '';
  const counts = editing ? '' : CREW_DAY_FIELDS.map(f => `
  <h2>${ui.t(f.label)}</h2>
  <div class="baygrid cntgrid">${f.buttons.map(n => `<label class="baybtn"><input type="radio" name="${f.key}" value="${n}" required><span>${n}</span></label>`).join('')}</div>`).join('');
  // With no fallback, a trailer has to be ticked; with one, none ticked is fine.
  const mustTick = fallback.length ? '' : `if(!this.querySelector('.trgrid input:checked')){alert(${escapeHtml(JSON.stringify(ui.t('crewDayPickTrailer')))});return false}`;
  const hidden = [
    ['crew', crew], ['zone', zone], ['cultivar', cultivar], ['test_cut', testCut], ['session_id', sessionId],
  ].filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${escapeHtml(v)}">`).join('');
  return `
<h1>${escapeHtml(crewLabel(ui, crew))}</h1>
<p class="sub">${ui.t(editing ? 'crewDayEditTitle' : 'crewDayTitle')} · ${escapeHtml(zone)}${cultivar ? ` · ${escapeHtml(cultivar)}` : ''}</p>
${editing ? '' : `<p class="note">${ui.t('crewDaySub')}</p>`}
<form method="POST" action="${API}?action=crew_day&lang=${ui.lang}"
      onsubmit="${mustTick}var b=this.querySelector('button[type=submit]');if(b.disabled)return false;b.disabled=true">
  ${hidden}
  <h2>${ui.t('crewTrailers')}</h2>
  <div class="trgrid">${tiles}</div>
  ${trailerHint}
  ${counts}
  <button class="btn" type="submit">${editing ? ui.t('crewDaySave') : ui.t('crewDayOpen', { zone: escapeHtml(zone) })}</button>
</form>`;
}

/** The crew's day at a glance on the zone screen, with the way to change it. */
function crewCard(ui, crew, crewDay, sessionId) {
  if (!crewById(crew)) return '';
  const tr = crewDay ? trailerList(crewDay.trailers).map(trailerName).join(' · ') : '—';
  const n = (k) => (crewDay && crewDay[k] != null ? crewDay[k] : '—');
  return `
<div class="crewcard crew-${crew}">
  <div class="crewcard-head">${escapeHtml(crewLabel(ui, crew))}</div>
  <div class="crewcard-tr">${ui.t('crewSummaryTrailers')}: <strong>${tr}</strong></div>
  <div class="crewcard-n"><span><strong>${n('cutters')}</strong> ${ui.t('crewCutters')}</span>
    <span><strong>${n('drivers')}</strong> ${ui.t('crewDrivers')}</span>
    <span><strong>${n('water_spiders')}</strong> ${ui.t('crewWS')}</span></div>
  <p class="hint">${ui.t('crewPeopleHourly')}</p>
  <a class="mini" href="${API}?action=crew_day&lang=${ui.lang}&crew=${crew}&session_id=${sessionId}">✏️ ${ui.t('crewDayEdit')}</a>
</div>`;
}

function enterBody(ui, { zone, cultivar, cutNumber, sessionId, prevZone, flash = null, headcount = null, daysIdle = null, crew = null, crewDay = null }) {
  // A crew lot carries its cutters from the crew card; the old grid stays only
  // for a lot with no crew (nothing opens one any more, but old links exist).
  const people = crewById(crew)
    ? crewCard(ui, crew, crewDay, sessionId)
    : `<p class="note">${ui.t('howManyCutters')}</p>
<div class="grid">${headcountGrid(ui, zone, sessionId, headcount)}</div>
<div id="hcstat" class="hcstat" role="status" aria-live="polite"></div>`;
  return `
<h1>${flash ? escapeHtml(flash) : ui.t('entered', { zone })}</h1>
<p class="sub">${escapeHtml(zone)} · ${cultivar ? `${escapeHtml(cultivar)} · ` : ''}${ui.t('cut', { n: cutNumber })}</p>
<p class="note">${prevZone ? ui.t('prevClosed', { lot: escapeHtml(prevZone) }) : ui.t('noPrior')}</p>
${people}
${cutChangeBlock(ui, sessionId, cutNumber, daysIdle)}
${cultivarFixBlock(ui, zone, sessionId, cultivar)}
<div class="footer"><a href="${API}?action=logs&zone=${zone}">${ui.t('viewLog')}</a></div>
${headcountScript(ui)}`;
}

/**
 * "Is this a new cut?" — the only way the cut number moves. ALWAYS folded shut
 * (Koa, 2026-10-04): a cut changes only when Koa says the cultivar's cut is
 * finished, and most retail strains only ever have one. It used to open by
 * itself after NEW_CUT_PROMPT_DAYS idle, and on Oct 4 that put Z8 Rainbow Cake
 * on "cut 2" when the crew was finishing cut 1 ten days later — retail trial
 * blocks are cut in pieces days apart. Idle days are still named inside, for
 * whoever opens it. A mis-tap has its own way back.
 */
function cutChangeBlock(ui, sessionId, cutNumber, daysIdle) {
  const n = Number(cutNumber) || 1;
  const long = daysIdle != null && daysIdle >= NEW_CUT_PROMPT_DAYS;
  const form = (dir, label, cls) => `
  <form method="POST" action="${API}?action=cut_change&lang=${ui.lang}"
        onsubmit="var b=this.querySelector('button');if(b.disabled)return false;b.disabled=true">
    <input type="hidden" name="session_id" value="${sessionId}">
    <input type="hidden" name="dir" value="${dir}">
    <button class="btn ${cls}" type="submit">${label}</button>
  </form>`;
  return `
<details class="cvfix cutfix">
  <summary>${ui.t('cutNewAsk')}</summary>
  ${long ? `<p class="note">${ui.t('cutIdle', { d: Math.floor(daysIdle) })}</p>` : ''}
  <p class="note"><span class="hint">${ui.t('cutNewHint', { n })}</span></p>
  ${n < 9 ? form('next', ui.t('cutStart', { n: n + 1 }), '') : ''}
  ${n > 1 ? form('prev', ui.t('cutBack', { n: n - 1 }), 'alt') : ''}
</details>`;
}

/**
 * Folded shut, because the pick is usually right and the cutters' next tap is
 * the headcount directly above it. Open, it is the same grid as the picker with
 * the current lot marked, so the fix reads as "change this" rather than "start
 * something". Nothing to show in a zone that holds one cultivar.
 */
function cultivarFixBlock(ui, zone, sessionId, current) {
  if (!isMultiCultivar(zone)) return '';
  const buttons = cultivarsFor(zone).map(cv => {
    const on = cv === current;
    return `<a class="btn${on ? ' sel' : ''}" aria-pressed="${on}"`
      + ` href="${API}?lang=${ui.lang}&action=cultivar_fix&session_id=${sessionId}`
      + `&cultivar=${encodeURIComponent(cv)}">${escapeHtml(cv)}</a>`;
  }).join('');
  return `
<details class="cvfix">
  <summary>${ui.t('wrongCultivar')}</summary>
  <div class="cvgrid">${buttons}</div>
</details>`;
}

function alreadyEnteredBody(ui, active, crewDay = null) {
  const people = crewById(active.crew)
    ? crewCard(ui, active.crew, crewDay, active.id)
    : `<p class="note">${ui.t('howManyCutters')}</p>
<div class="grid">${headcountGrid(ui, active.zone, active.id, active.headcount)}</div>
<div id="hcstat" class="hcstat" role="status" aria-live="polite"></div>
${headcountScript(ui)}`;
  return `
<h1>${ui.t('alreadyEntered', { zone: active.zone })}</h1>
<p class="sub">${active.cultivar ? `${escapeHtml(active.cultivar)} · ` : ''}${ui.t('cut', { n: active.cut_number })}</p>
<p class="note">${ui.t('alreadyEnteredAt', { t: active.occurred_at })}</p>
${people}`;
}

function headcountBody(ui, { zone, cutNumber, sessionId, count, cultivar = null }) {
  // The no-JS landing page. The grid now carries `count`, so even here the
  // number that was set is visibly the one selected rather than being asserted
  // only by the headline.
  return `
<h1>${count === 1 ? ui.t('loggedCutter') : ui.t('loggedCutters', { n: count })}</h1>
<p class="sub">${zone} — ${ui.t('cut', { n: cutNumber })}</p>
<p class="note">${ui.t('wrongNumber')}</p>
<div class="grid">${headcountGrid(ui, zone, sessionId, count)}</div>
<div id="hcstat" class="hcstat" role="status" aria-live="polite"></div>
${cultivarFixBlock(ui, zone, sessionId, cultivar)}
<div class="footer"><a href="${API}?action=status">${ui.t('viewStatus')}</a></div>
${headcountScript(ui)}`;
}

/**
 * Where a lot's acreage came from, in words.
 *
 * The figure is a share of a zone, so it has to say so: "6 of 37 rows" is
 * checkable against the tape and the zone page, and an unrecorded cultivar
 * reads as unknown rather than quietly whole-zone.
 */
function areaBasisFor(zone, cultivar) {
  const m = ZONE_CULTIVAR_ROWS[zone];
  if (!m) return isMultiCultivar(zone) ? `${zone} row split not recorded` : null;
  const rows = m[cultivar];
  const total = zoneRowTotal(zone);
  if (!rows || !total) return `${cultivar || 'this cultivar'} is not in the recorded ${zone} row split`;
  return `${rows} of ${total} rows in ${zone}`;
}

function barnIntakeFormBody(ui, active, station = null, lastFill = null,
                            recentLots = [], openZones = []) {
  // A full trailer, pre-filled, so the ordinary load is one tap on Submit
  // instead of a typed number. Read off the constant rather than written here,
  // because that constant carries "recalibrate once 2026 trailers run" and the
  // form has to follow it when it moves.
  //
  // NAMED as pre-filled, for the same reason the carried-over bay is named: a
  // number that is already in the box reads as a reading. Trailers run 18-22
  // (see lib/barn-attribution.js), and the short ones are structural — the last
  // load of a day, of a zone, and of every cultivar in a trial zone. Those are
  // also the smallest lots, where accepting 22 on a half load is a ~9% error on
  // the exact comparison a trial zone exists to make.
  //
  // No autofocus now: the common case needs no keyboard at all. Tapping the
  // field selects it, so a partial is typed over rather than edited around.
  const FULL_TRAILER = CONSTANTS.binsPerTrailer.value;
  // Follow the open lot; an older arriving trailer uses a manual override.
  // With several crews' zones open there is no one lot to follow, so the door
  // asks for the zone rather than guessing the newest (three crews, 2026-10-03).
  const preselect = active && openZones.length <= 1 ? active.zone : null;

  // Only zones harvest actually counts — offering GH here would let a load be
  // logged against a zone no bag will ever be tagged from.
  const options = [...VALID_ZONES].filter(isHarvestTracked).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map(z =>
    `<option value="${z}" ${preselect === z ? 'selected' : ''}>${z}</option>`
  ).join('');
  const activeNote = active
    ? `<p class="note">${ui.t('activeNow', {
        lot: `${active.zone}${active.cultivar ? ` · ${escapeHtml(active.cultivar)}` : ''}`,
        n: active.cut_number,
      })}</p>`
    : `<p class="note">${ui.t('noZoneOpen')}</p>`;
  // Which door this is, stated on the screen: two intakes that look identical
  // are two chances to log a load at the wrong one.
  const stationNote = station ? `<p class="sub">${ui.t('atStation', { n: station })}</p>` : '';
  // Carried explicitly rather than trusted to the cookie: the cookie makes a
  // bookmark remember its door, this makes THIS submission unambiguous.
  const stationField = station ? `<input type="hidden" name="station" value="${station}">` : '';

  // Stale means the last load with a bay was on an earlier Pacific day, so the
  // crew has almost certainly moved to the next bay since. Say the number out
  // loud rather than leaving it pre-selected and unremarked.
  // The picker only appears when the zone in the box has nothing open — with a
  // session open the load attributes itself, and asking would be a question
  // with one answer. Rendered for every recent lot and filtered by the script,
  // so the page keeps working when the script does not: the server refuses a
  // lot that does not belong to the zone submitted with it.
  const lotOptions = [`<option value="">${ui.t('lotAtDoorNone')}</option>`].concat(
    recentLots.map(l => `<option value="${l.id}" data-zone="${escapeHtml(l.zone)}">${
      escapeHtml(`${l.zone} · ${l.cultivar || '?'} · `)}${ui.t('cut', { n: l.cut_number ?? '?' })}${
      escapeHtml(` · ${String(l.occurred_at).substring(0, 10)}`)}${
      l.closed_at ? '' : ` · ${ui.t('lotAtDoorOpen')}`}</option>`)).join('');
  const lotPickHidden = preselect && openZones.includes(preselect) ? ' hidden' : '';

  const bayHint = !lastFill || !lastFill.bay
    ? ui.t('bayHungHint')
    : (lastFill.stale ? ui.t('bayStale', { n: lastFill.bay })
                      : ui.t('bayHungLast', { n: lastFill.bay }));

  return `
<h1>${ui.t('barnIntake')}</h1>
${stationNote}
<div id="intakeActive" role="status">${activeNote}</div>
<button id="followOpen" type="button" class="btn alt" style="margin-bottom:16px">${ui.t('followOpen')}</button>
<form id="intakeForm" method="POST" action="${API}?action=barn_log&lang=${ui.lang}">
  ${stationField}
  <label for="zone">${ui.t('zone')}</label>
  <select id="zone" name="zone" required><option value="">${ui.lang === 'es' ? 'Elige una zona' : 'Choose a zone'}</option>${options}</select>
  <div id="lotPick"${lotPickHidden}>
    <label for="lot">${ui.t('lotAtDoor')}</label>
    <select id="lot" name="lot">${lotOptions}</select>
    <p class="note"><span class="hint">${ui.t('lotAtDoorHint')}</span></p>
  </div>
  <label for="bins">${ui.t('binsOnLoad')} <span class="hint">${ui.t('binsPrefilled', { n: FULL_TRAILER })}</span></label>
  <input id="bins" name="bins" type="number" min="1" max="500" inputmode="numeric" required
         value="${FULL_TRAILER}" onfocus="this.select()">
  <label for="bay">${ui.t('bayHung')} <span class="hint">${bayHint}</span></label>
  <select id="bay" name="bay">
    <option value="">${ui.t('bayUnknown')}</option>
    ${bayOptions(ui, lastFill ? lastFill.bay : null)}
  </select>
  <button class="btn" type="submit">${ui.t('logLoad')}</button>
</form>
<div id="intakeReceipt" role="status" aria-live="polite"></div>
${barnLiveScript(ui)}`;
}

// Progressive enhancement: the normal POST remains usable without JavaScript.
// Never retry a failed POST automatically: a lost response may already be saved.
function barnLiveScript(ui) {
  const es = ui.lang === 'es';
  const text = {
    live: es ? 'Zona abierta: ' : 'Open zone: ',
    none: es ? 'Sin zona abierta. Elige una zona.' : 'No zone open. Choose a zone.',
    several: es ? 'Hay varias zonas abiertas: ' : 'Several zones open: ',
    pick: es ? '. Elige la zona de esta traila.' : '. Choose the zone this trailer came from.',
    manual: es ? 'Zona manual — se conserva para cargas anteriores. Pulsa Seguir para volver.' : 'Manual zone — held for arriving loads. Press Follow to resume automatic selection.',
    offline: es ? 'No se pudo actualizar la zona. Confírmala antes de registrar.' : 'Zone update unavailable. Confirm the zone before logging.',
    saving: es ? 'Registrando…' : 'Recording…',
    ready: es ? 'Listo para otra carga. Se restableció la carga completa.' : 'Ready for another trailer. Full-load bin count restored.',
    uncertain: es ? 'No se pudo confirmar el guardado. Revisa el registro antes de enviar de nuevo.' : 'Could not confirm the save. Check the load log before submitting again.',
    check: es ? 'Ver registro de cargas' : 'Check load log',
    none_lot: es ? 'Sin lote — anotar de todos modos' : 'No lot — log it anyway',
    open_lot: es ? 'abierto' : 'open',
    cut: es ? 'Corte ' : 'Cut ',
  };
  return `<script>
(function () {
  var T = ${JSON.stringify(text)};
  var form = document.getElementById('intakeForm'), zone = document.getElementById('zone');
  var status = document.getElementById('intakeActive'), receipt = document.getElementById('intakeReceipt');
  var follow = document.getElementById('followOpen'), busy = false, manual = false, polling = false;
  var latest = null, modeVersion = 0;
  var lotPick = document.getElementById('lotPick'), lotSel = document.getElementById('lot');
  var openZones = [], recentLots = null;
  function applyActive() {
    if (manual || busy) return;
    if (openZones.length > 1) {
      zone.value = '';
      status.textContent = T.several + openZones.join(', ') + T.pick;
      return;
    }
    zone.value = latest ? latest.zone : '';
    status.textContent = latest ? T.live + latest.zone + (latest.cultivar ? ' · ' + latest.cultivar : '') : T.none;
  }
  // The picker is for the case the rules cannot answer: this zone has nothing
  // open, so without a lot named here the bins land on no lot at all. With a
  // session open it stays hidden AND cleared — a stale selection must never
  // ride along and override a lot that is genuinely open.
  function syncPicker() {
    if (!lotPick) return;
    var z = zone.value, needed = !!z && openZones.indexOf(z) === -1;
    if (recentLots) {
      var keep = lotSel.value;
      lotSel.replaceChildren();
      lotSel.appendChild(new Option(T.none_lot, ''));
      recentLots.filter(function (l) { return l.zone === z; }).forEach(function (l) {
        var label = l.zone + ' · ' + (l.cultivar || '?') + ' · ' + T.cut + (l.cut_number == null ? '?' : l.cut_number)
          + ' · ' + String(l.occurred_at).substring(0, 10) + (l.closed_at ? '' : ' · ' + T.open_lot);
        lotSel.appendChild(new Option(label, String(l.id), false, String(l.id) === keep));
      });
    } else {
      Array.prototype.forEach.call(lotSel.options, function (o) {
        if (o.value) o.hidden = o.dataset.zone !== z;
      });
    }
    if (!needed) lotSel.value = '';
    lotPick.hidden = !needed;
  }
  async function refresh() {
    if (polling || busy || document.hidden) return;
    polling = true;
    try {
      var r = await fetch('${API}?action=status', { cache: 'no-store' });
      if (!r.ok) throw new Error('status');
      var d = await r.json();
      if (!Array.isArray(d.active_zones)) throw new Error('status');
      latest = d.active_zones[0] || null;
      openZones = d.active_zones.map(function (s) { return s.zone; });
      if (Array.isArray(d.recent_lots)) recentLots = d.recent_lots;
      applyActive();
      syncPicker();
    } catch (_) { if (!manual && !busy) status.textContent = T.offline; }
    finally { polling = false; }
  }
  zone.addEventListener('change', function () { manual = true; modeVersion++; status.textContent = T.manual; syncPicker(); });
  if (follow) follow.addEventListener('click', function () { manual = false; modeVersion++; refresh(); });
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (busy || !form.reportValidity()) return;
    // Capture the visible selection before disabling controls; an in-flight
    // status response must never change the zone of this trailer.
    var body = new URLSearchParams(new FormData(form));
    var submittedMode = modeVersion;
    busy = true;
    var controls = Array.from(form.querySelectorAll('input, select, button'));
    controls.forEach(function (el) { el.disabled = true; });
    if (follow) follow.disabled = true;
    receipt.textContent = T.saving;
    try {
      var r = await fetch(form.action, { method: 'POST', body: body });
      var html = await r.text();
      if (!r.ok) throw new Error('save');
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var heading = doc.querySelector('h1');
      if (!heading) throw new Error('receipt');
      receipt.replaceChildren();
      // Only render text from the server receipt, never replay its scripts.
      [heading].concat(Array.from(doc.querySelectorAll('p.sub, p.note'))).forEach(function (el) {
        var p = document.createElement('p'); p.textContent = el.textContent; receipt.appendChild(p);
      });
      var ready = document.createElement('p'); ready.textContent = T.ready; receipt.appendChild(ready);
      document.getElementById('bins').value = '${CONSTANTS.binsPerTrailer.value}';
      if (lotSel) { lotSel.value = ''; syncPicker(); }
    } catch (_) {
      receipt.textContent = T.uncertain + ' ';
      var a = document.createElement('a'); a.href = '${API}?action=logs&event_type=barn_load';
      a.textContent = T.check; a.target = '_blank'; a.rel = 'noopener'; receipt.appendChild(a);
    } finally {
      busy = false; controls.forEach(function (el) { el.disabled = false; });
      if (follow) follow.disabled = false;
      if (submittedMode === modeVersion) refresh();
    }
  });
  syncPicker();
  refresh();
  var poll = setInterval(refresh, 5000);
  window.addEventListener('harvest:swap', function () { clearInterval(poll); }, { once: true });
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
})();
</script>`;
}

function barnLogConfirmBody(ui, { zone, bins, loadNumber, hasActiveSession, grace = null,
                                  station = null, bay = null,
                                  switched = null, chosen = null }) {
  // Three outcomes, and the person at the door should be able to tell them
  // apart: attributed to the open lot (silent), to a lot that just closed (say
  // so — it is a correction), or to nothing (warn, that one loses bins).
  const attribution = chosen
    ? `<p class="note">${ui.t('lotChosen', { lot: escapeHtml(chosen) })}</p>`
    : grace
      ? `<p class="note">${ui.t('graceAttributed', { zone: grace.zone, n: grace.cut })}</p>`
      : (hasActiveSession ? '' : `<p class="note">${ui.t('noSessionWarn', { zone })}</p>`);
  // Said out loud, like every other correction the cascade makes. The person at
  // the door is the only one who can tell a trailer loaded before the switch
  // from one loaded after it, so they are told which lot it went to.
  const switchNote = switched
    ? `<p class="note">${ui.t('cultivarSwitched', {
        prev: escapeHtml(switched.from || '?'),
        now: escapeHtml(switched.to || '?'),
      })}</p>`
    : '';
  return `
<h1>${ui.t('loggedLoad', { bins, zone })}</h1>
<p class="sub">${ui.t('loadNumToday', { n: loadNumber, zone })}${bay ? ` · ${ui.t('hungInBay', { n: bay })}` : ''}</p>
${attribution}
${switchNote}
<div class="footer"><a href="${API}?action=barn_intake${station ? `&station=${station}` : ''}">${ui.t('logAnother')}</a> · <a href="${API}?action=crew">${ui.t('crewChanged')}</a> · <a href="${API}?action=find">${ui.t('findLink')}</a></div>`;
}

/**
 * The driver's screen. Built for a phone held in one hand at a barn door:
 * the trailer's name, the lot it is going to, a bay, one button.
 *
 * Every choice is a radio, not a select: one tap each, all visible, and the
 * page works with no script at all. The lot the server proposed is ticked;
 * "Different lot?" opens the recent ones for the rare wrong case.
 */
function trailerFormBody(ui, { trailer, proposal, recentLots, keep, lastBay, bayToday }) {
  const name = trailerName(trailer);
  const FULL = CONSTANTS.binsPerTrailer.value;
  const lotLabel = (l) => lotLabelText(ui, l);

  const lots = [...recentLots];
  if (proposal.lot && !lots.some(l => l.id === proposal.lot.id)) lots.unshift(proposal.lot);
  const chosen = keep ? keep.lot : (proposal.lot ? proposal.lot.id : null);
  const lotRadios = lots.map(l => `<label class="choice"><input type="radio" name="lot" value="${l.id}" required${
    String(l.id) === String(chosen) ? ' checked' : ''}> ${lotLabel(l)}${
    l.closed_at ? '' : ` · ${ui.t('lotAtDoorOpen')}`}</label>`).join('');

  const lotCard = proposal.lot
    ? `<div class="status trailer-lot"><div class="lotmeta"><strong>→ ${lotLabel(proposal.lot)}</strong></div>${
        proposal.viaGrace ? `<p class="note">${ui.t('trailerGrace')}</p>` : ''}</div>`
    : `<p class="note">${proposal.crew
      ? ui.t('trailerCrewNoLot', { crew: escapeHtml(crewLabel(ui, proposal.crew)) })
      : ui.t('trailerUnassigned', { t: name })}</p>`;
  const lotPicker = proposal.lot
    ? `<details class="lotother"${keep && keep.lot !== proposal.lot.id ? ' open' : ''}><summary>${ui.t('trailerOtherLot')}</summary>${lotRadios}</details>`
    : `<fieldset class="lotother"><legend>${ui.t('trailerWhichLot')}</legend>${lotRadios || `<p class="note">${ui.t('trailerNoRecent')}</p>`}</fieldset>`;

  const bayPick = keep ? keep.bay : (bayToday ? lastBay : null);
  const bayBtn = (n) => `<label class="baybtn"><input type="radio" name="bay" value="${n}" required${
    Number(bayPick) === n ? ' checked' : ''}><span>${n}</span></label>`;
  const bayRow = (labelKey, from, to) => {
    const out = [];
    for (let n = from; n <= to; n++) out.push(bayBtn(n));
    return `<div class="baybarn">${ui.t(labelKey)}</div><div class="baygrid">${out.join('')}</div>`;
  };
  const bayHint = lastBay
    ? (bayToday ? ui.t('bayHungLast', { n: lastBay }) : ui.t('bayStale', { n: lastBay }))
    : ui.t('trailerBayPick');

  const partialVal = keep && keep.partial ? escapeHtml(keep.partial) : '';
  const canLog = !!proposal.lot || lots.length > 0;
  // Why a one-scan decal is asking at all: its first run of the day.
  const firstBay = proposal.lot && !bayToday && !keep
    ? `<p class="note">${ui.t('trailerFirstBay')}</p>` : '';

  return `
<h1 class="trailer-name">${name}</h1>
<p class="sub">${ui.t('trailerSub')}</p>
${lotCard}
${firstBay}
${canLog ? `<form id="trailerForm" method="POST" action="${API}?action=trailer_log&lang=${ui.lang}"
      onsubmit="var b=this.querySelector('button[type=submit]');if(b.disabled)return false;b.disabled=true">
  <input type="hidden" name="trailer" value="${trailer}">
  ${lotPicker}
  <label>${ui.t('bayHung')} <span class="hint">${bayHint}</span></label>
  ${bayRow('bottomBarn', BAY_MIN, BOTTOM_BARN_LAST_BAY)}
  ${bayRow('topBarn', BOTTOM_BARN_LAST_BAY + 1, BAY_MAX)}
  <details class="partial"${partialVal ? ' open' : ''}><summary>${ui.t('trailerPartial', { n: FULL })}</summary>
    <label for="partial_bins">${ui.t('trailerPartialHow')}</label>
    <input id="partial_bins" name="partial_bins" type="number" min="1" max="${FULL - 1}" inputmode="numeric" value="${partialVal}">
  </details>
  <button class="btn" type="submit">${ui.t('trailerLogBtn', { n: FULL })}</button>
</form>` : lotPicker}`;
}

/**
 * The receipt: what the scan logged, big enough to check at arm's length, and
 * — for TRAILER_EDIT_MS — the fixes, folded away so the ordinary load is just
 * a glance. The bay is the loudest thing on the page because it is the one
 * default that can quietly stop being true (the barn moved on to the next bay).
 */
function trailerReceiptBody(ui, { row, loadNumber, editable, recentLots, fresh = false }) {
  const name = trailerName(row.trailer);
  const FULL = CONSTANTS.binsPerTrailer.value;
  const lotLabel = (l) => lotLabelText(ui, l);
  const current = { id: row.attributed_zone_session_id, zone: row.zone, cultivar: row.lot_cultivar, cut_number: row.lot_cut, crew: row.lot_crew };


  let fix = `<p class="note">${ui.t('trailerFixClosed')}</p>`;
  if (editable) {
    const lots = [...recentLots];
    if (!lots.some(l => l.id === current.id)) lots.unshift(current);
    const lotRadios = lots.map(l => `<label class="choice"><input type="radio" name="lot" value="${l.id}"${
      l.id === current.id ? ' checked' : ''}> ${lotLabel(l)}</label>`).join('');
    const bayBtn = (n) => `<label class="baybtn"><input type="radio" name="bay" value="${n}" required${
      Number(row.bay) === n ? ' checked' : ''}><span>${n}</span></label>`;
    const bayRow = (labelKey, from, to) => {
      const out = [];
      for (let n = from; n <= to; n++) out.push(bayBtn(n));
      return `<div class="baybarn">${ui.t(labelKey)}</div><div class="baygrid">${out.join('')}</div>`;
    };
    fix = `
<details class="fixload"><summary>✏️ ${ui.t('trailerFix')} <span class="hint">· ${ui.t('trailerFixHint')}</span></summary>
<form id="trailerFix" method="POST" action="${API}?action=trailer_fix&lang=${ui.lang}"
      onsubmit="var b=this.querySelector('button[type=submit]');if(b.disabled)return false;b.disabled=true">
  <input type="hidden" name="id" value="${row.id}">
  <label>${ui.t('bayHung')}</label>
  ${bayRow('bottomBarn', BAY_MIN, BOTTOM_BARN_LAST_BAY)}
  ${bayRow('topBarn', BOTTOM_BARN_LAST_BAY + 1, BAY_MAX)}
  <label for="fixbins">${ui.t('trailerBinsNow')}</label>
  <input id="fixbins" name="bins" type="number" min="1" max="${FULL}" inputmode="numeric" required value="${row.bins}">
  <details class="lotother"><summary>${ui.t('trailerOtherLot')}</summary>${lotRadios}</details>
  <button class="btn" type="submit">${ui.t('trailerFixSave')}</button>
</form>
<form method="POST" action="${API}?action=trailer_fix&lang=${ui.lang}" class="undo"
      onsubmit="return confirm(${escapeHtml(JSON.stringify(ui.t('trailerUndoConfirm')))})">
  <input type="hidden" name="id" value="${row.id}">
  <input type="hidden" name="undo" value="1">
  <button class="btn alt" type="submit">${ui.t('trailerUndo')}</button>
</form>
</details>
<p class="note">${ui.t('trailerFixUntil', { time: pacificClock(ui, new Date(editableUntil(row))) })}</p>`;
  }

  // Drivers asked for an unmistakable "it worked" (Koa, 2026-09-29): a green
  // screen with a drawn check, read at a glance from the tractor seat, that
  // fades to the receipt after two seconds or on a tap. No sound or buzz: a
  // page opened from a camera scan has no user gesture, and browsers block both
  // without one.
  const flash = fresh ? `
<div class="logged-flash ok" role="status" aria-live="assertive" onclick="this.remove()">
  <svg class="lf-mark" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M14 27 L22 35 L38 17"/></svg>
  <div class="lf-big">${ui.t('flashOk')}</div>
  <div class="lf-sub">${name} · ${ui.t('flashBins', { n: row.bins })} · ${ui.t('trailerBayBig', { n: row.bay ?? '?' })}</div>
  <div class="lf-lot">→ ${escapeHtml(row.zone)} · ${escapeHtml(row.lot_cultivar || '?')}</div>
</div>
<script>(function () {
  var f = document.querySelector('.logged-flash'); if (!f) return;
  var hold = 2000;
  setTimeout(function () { f.classList.add('out'); }, hold);
  setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, hold + 500);
  // The "Log another load" button stays locked until well after the flash:
  // a tap meant to dismiss it must never land on the button underneath.
  setTimeout(function () {
    var b = document.querySelector('.again-btn[data-unlock]');
    if (b) { b.disabled = false; b.removeAttribute('data-unlock'); }
  }, hold + 900);
})();</script>` : '';

  const again = `
<form method="POST" action="${API}?action=trailer_again&lang=${ui.lang}" class="again"
      onsubmit="var b=this.querySelector('button');if(b.disabled)return false;b.disabled=true">
  <input type="hidden" name="trailer" value="${row.trailer}">
  <button class="btn again-btn" type="submit"${fresh ? ' disabled data-unlock' : ''}>+ ${ui.t('trailerAgain', { t: name })}</button>
  <p class="hint">${ui.t('trailerAgainHint')}</p>
</form>`;

  return `${flash}
<h1>✅ ${ui.t('trailerLogged', { t: name, bins: row.bins })}</h1>
<div class="status trailer-lot">
  <div class="lotmeta"><strong>→ ${lotLabel(current)}</strong></div>
  <div class="baybig">${ui.t('trailerBayBig', { n: row.bay ?? '?' })}</div>
</div>
<p class="sub">${ui.t('loadNumToday', { n: loadNumber, zone: escapeHtml(row.zone) })}</p>
${again}
${fix}`;
}

/** A stored UTC timestamp (or a Date) as a Pacific wall-clock time, "2:14 PM". */
function pacificClock(ui, ts) {
  return (ts instanceof Date ? ts : parseSqliteUtc(ts)).toLocaleTimeString(ui.lang === 'es' ? 'es-US' : 'en-US',
    { timeZone: HARVEST_TZ, hour: 'numeric', minute: '2-digit' });
}

// ─── CREW ROSTER RENDERING ──────────────────────────────

function crewFormBody(ui, current) {
  const fields = CREW_ROLES.map(r => `
  <label for="${r.key}">${ui.t(r.labelKey)} <span class="hint">${ui.t(r.whereKey)}</span></label>
  <div class="crew-stepper"><button type="button" data-field="${r.key}" data-step="-1" aria-label="${ui.lang === 'es' ? 'Reducir' : 'Decrease'} ${ui.t(r.labelKey)}">−</button><input id="${r.key}" name="${r.key}" type="number" min="0" max="99" inputmode="numeric"
         value="${current && current[r.key] !== null ? current[r.key] : ''}"><button type="button" data-field="${r.key}" data-step="1" aria-label="${ui.lang === 'es' ? 'Aumentar' : 'Increase'} ${ui.t(r.labelKey)}">+</button></div>`).join('');

  const since = current
    ? `<p class="note">${ui.t('rosterSince', { t: escapeHtml(current.effective_from) })}</p>`
    : `<p class="note">${ui.t('rosterNone')}</p>`;

  return `
<h1>${ui.t('crew')}</h1>
<p class="sub">${ui.t('crewSub')}</p>
${since}
<form method="POST" action="${API}?action=crew_set&lang=${ui.lang}" onsubmit="this.querySelector('button[type=submit]').disabled=true">
  ${fields}
  <label for="note">${ui.t('note')} <span class="hint">${ui.t('noteHint')}</span></label>
  <input id="note" name="note" maxlength="200" autocomplete="off">
  <button class="btn" type="submit">${ui.t('saveCrew')}</button>
</form>
<p class="note"><span class="hint">${ui.t('cuttersNotHere')}</span></p>
<script>document.querySelectorAll('.crew-stepper button').forEach(function(b){b.addEventListener('click',function(){var input=document.getElementById(b.dataset.field);input.value=Math.max(0,Math.min(99,Number(input.value||0)+Number(b.dataset.step)));});});</script>`;
}

function crewConfirmBody(ui, counts, flash) {
  const rows = CREW_ROLES.map(r =>
    `<div class="lotmeta"><strong>${ui.t(r.labelKey)}:</strong> ${counts[r.key] ?? '—'} <span class="hint">${ui.t(r.whereKey)}</span></div>`
  ).join('');
  return `
<h1>✅ ${escapeHtml(flash)}</h1>
<div class="status">${rows}</div>
<div class="footer"><a href="${API}?action=crew">${ui.t('changeAgain')}</a> · <a href="${API}?action=barn_intake">${ui.t('toBarnIntake')}</a></div>`;
}

// ─── SUPERSACK TAG RENDERING ────────────────────────────

/**
 * Bay select, grouped by barn. Defaulted rather than blank because the crew
 * fills roughly one bay a day, so most takedowns are the same bay as the last
 * one — the common action should be confirming, not choosing.
 */
function bayOptions(ui, selected) {
  const group = (labelKey, from, to) => {
    const opts = [];
    for (let n = from; n <= to; n++) {
      opts.push(`<option value="${n}" ${Number(selected) === n ? 'selected' : ''}>${ui.t('bayN', { n })}</option>`);
    }
    return `<optgroup label="${ui.t(labelKey)}">${opts.join('')}</optgroup>`;
  };
  return group('bottomBarn', BAY_MIN, BOTTOM_BARN_LAST_BAY)
       + group('topBarn', BOTTOM_BARN_LAST_BAY + 1, BAY_MAX);
}

/**
 * Storage picker: not yet, the Supermarket, then the bays by barn. "Not yet" is
 * a real answer — sacks get stacked before anyone decides where they live, and
 * a guessed location is worse than an empty one.
 */
function storageOptions(ui, selected) {
  return `<option value=""${selected ? '' : ' selected'}>${ui.t('storageNotYet')}</option>`
    + `<option value="${SUPERMARKET}"${selected === SUPERMARKET ? ' selected' : ''}>${SUPERMARKET}</option>`
    + bayOptions(ui, selected);
}

/**
 * "Open in Chrome", for an iPhone that is NOT in Chrome (Koa, 2026-09-30).
 *
 * Safari on iOS — and the home-screen app, which prints through the same path —
 * forces its own margins onto a printed page, so the tag can only come out at
 * about 3.2 x 1.05 in of the 4 x 2 label. Chrome on iOS prints it full size.
 * Nothing on the page can widen Safari's box, so the fallback is to hand the
 * same screen to Chrome: `googlechromes://` is Chrome's own URL scheme for an
 * https page.
 *
 * A BUTTON, not a redirect: iOS only follows an app link from a tap, and a
 * redirect that silently did nothing would be worse than no offer at all. If
 * Chrome is not installed the tap does nothing and the crew keeps printing
 * here at the smaller size — which is why this is an offer and never a gate.
 *
 * Hidden by default and revealed by script, so every other device never sees
 * it. `path` must be a GET that rebuilds this exact screen.
 */
function chromeHandoff(ui, path) {
  const target = `${PUBLIC_BASE.replace(/^https:\/\//, '')}${path}`;
  return `<div id="chromeHandoff" class="notice handoff" hidden>${ui.t('chromeWhy')}
  <a class="btn" href="googlechromes://${escapeHtml(target)}">${ui.t('openInChrome')}</a>
  <span class="hint">${ui.t('chromeHint')}</span>
</div>
<script>
(function () {
  var ua = navigator.userAgent || '';
  // iPadOS reports itself as a Mac; touch points tell them apart.
  var ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && !/CriOS/.test(ua)) document.getElementById('chromeHandoff').hidden = false;
})();
</script>`;
}

function sackPrintFormBody(ui, allLots, lastBay = null, lastStorage = null, flash = null, bays = null) {
  // Lots hung in a bay are offered by BAY (getBayTakedown); only lots with no
  // bay on any load keep a zone card. A finished lot is not a takedown
  // candidate, so it never reaches the radio list — nor the pre-selection.
  const bayInfo = bays || { active: [], finished: [], covered: new Set() };
  const lots = allLots.filter(l => !l.takedown_done_at && !bayInfo.covered.has(l.id));
  const finished = allLots.filter(l => l.takedown_done_at && !bayInfo.covered.has(l.id))
    .sort((a, b) => String(b.takedown_done_at).localeCompare(String(a.takedown_done_at)));
  // Drying days from the bay's FIRST load, as a lot counts from its cut date.
  const bayDays = (c) => Math.floor((Date.now() - c.firstMs) / 86400000);
  const bayLevel = (c) => lotLevel({ days_since_cut: bayDays(c), sacks_printed: c.sacks });
  const activeBays = bayInfo.active.slice().sort((a, b) =>
    LOT_RANK[bayLevel(a)] - LOT_RANK[bayLevel(b)] || a.bay - b.bay);
  const flashHtml = flash ? `<div class="flash">✅ ${escapeHtml(flash)}</div>` : '';

  const closeForm = (l, reopen) => `
    <form method="POST" action="${API}?action=lot_finish&lang=${ui.lang}" class="finishrow${reopen ? ' done' : ''}"${reopen ? ''
      : ` data-confirm="${escapeHtml(ui.t('confirmFinish', { lot: lotLabel(ui, l), n: l.sacks_printed }))}"`}>
      <input type="hidden" value="${l.id}" name="session_id">${reopen ? '<input type="hidden" name="reopen" value="1">' : ''}
      <span class="lotbody">
        <strong>${escapeHtml(lotLabel(ui, l))}</strong> ${bayPill(ui, l)}
        <span class="lotmeta">${reopen
          ? ui.t('finishedOn', { date: escapeHtml(finishedDate(ui, l.takedown_done_at)), n: l.sacks_printed })
          : escapeHtml(ui.t('noteStarted', { n: l.sacks_printed }))}</span>
      </span>
      ${reopen ? '' : `<a class="btn" href="${API}?action=lot_resume&session_id=${l.id}&lang=${ui.lang}">${ui.t('resumeLot')}</a>`}
      <button class="btn${reopen ? '' : ' alt'}" type="submit">${ui.t(reopen ? 'reopenLot' : 'markFinished')}</button>
    </form>`;

  // A bay in progress or finished: Resume / Finished, or Reopen.
  const bayForm = (c, reopen) => `
    <form method="POST" action="${API}?action=bay_finish&lang=${ui.lang}" class="finishrow${reopen ? ' done' : ''}"${reopen ? ''
      : ` data-confirm="${escapeHtml(ui.t('confirmBayFinish', { bay: c.bay, cv: c.cultivar, n: c.sacks }))}"`}>
      <input type="hidden" name="bay" value="${c.bay}"><input type="hidden" name="cultivar" value="${escapeHtml(c.cultivar)}">
      <input type="hidden" name="cut" value="${c.cut}"><input type="hidden" name="fill_start" value="${escapeHtml(c.fillStart)}">${reopen ? '<input type="hidden" name="reopen" value="1">' : ''}
      <span class="lotbody">
        <span class="lothead"><span class="baybig">${ui.t('bayN', { n: c.bay })}</span>
          <strong>${escapeHtml(c.cultivar)}</strong> <span class="hint">${ui.t('cut', { n: c.cut })}</span></span>
        ${zoneMix(c)}
        <span class="lotmeta">${reopen
          ? ui.t('bayFinishedOn', { date: escapeHtml(finishedDate(ui, c.doneAt)), n: c.sacks })
          : escapeHtml(ui.t('noteStartedBay', { n: c.sacks }))}</span>
      </span>
      ${reopen ? '' : `<a class="btn" href="${API}?action=lot_resume&session_id=${c.primary.id}&bay=${c.bay}&lang=${ui.lang}">${ui.t('resumeLot')}</a>`}
      <button class="btn${reopen ? '' : ' alt'}" type="submit">${ui.t(reopen ? 'reopenLot' : 'markFinished')}</button>
    </form>`;

  // Open, not collapsed (Koa, 2026-09-28): tucked away, nobody found Reopen.
  const nFinished = finished.length + bayInfo.finished.length;
  const finishedHtml = nFinished ? `
<details class="batch finished" open>
  <summary>${ui.t('finishedLots', { n: nFinished })}</summary>
  <div class="lotlist">${bayInfo.finished.map(c => bayForm(c, true)).join('')}${finished.map(l => closeForm(l, true)).join('')}</div>
</details>` : '';

  if (!lots.length && !activeBays.length) {
    return `
<h1>${ui.t('printTags')}</h1>
${chromeHandoff(ui, `${API}?action=sack_print&lang=${ui.lang}`)}
${flashHtml}
<p class="note">${ui.t(finished.length ? 'noOpenLots' : 'noLots', { n: LOT_PICKER_DAYS })}</p>
${finishedHtml}`;
  }

  // Only a lot with tags can be resumed or closed out from here. A lot never started has
  // nothing to finish, and listing every lot twice would bury the ones that do.
  const started = lots.filter(l => l.sacks_printed > 0);
  const startedBays = activeBays.filter(c => c.sacks > 0);
  const finishHtml = started.length || startedBays.length ? `
<h2>${ui.t('finishSection')}</h2>
<p class="note">${ui.t('finishSectionHelp')}</p>
<div class="lotlist">${startedBays.map(c => bayForm(c, false)).join('')}${started.map(l => closeForm(l, false)).join('')}</div>` : '';

  const BADGE = {
    ready:   { cls: 'ok',   text: ui.t('badgeReady') },
    started: { cls: 'warn', text: ui.t('badgeStarted') },
    green:   { cls: 'bad',  text: ui.t('badgeGreen') },
    old:     { cls: 'warn', text: ui.t('badgeOld') },
  };

  // Pre-select ONLY when the best candidate is genuinely plausible. If the top
  // of the list is overdue/green/already-started, pre-filling it would make the
  // dangerous option the default — force a deliberate choice instead. Never
  // with bay cards: which bay is coming down is the crew's call to make.
  const topIsReady = !activeBays.length && lots.length > 0 && lotPlausibility(ui, lots[0]).level === 'ready';

  const bayCard = (c) => {
    const level = bayLevel(c);
    const p = lotPlausibility(ui, { days_since_cut: bayDays(c), sacks_printed: c.sacks });
    const b = BADGE[level];
    const label = `${ui.t('bayN', { n: c.bay })} · ${c.cultivar} ${ui.t('cut', { n: c.cut })}`;
    return `
    <label class="lot baycard ${level}">
      <input type="radio" name="session_id" value="${c.primary.id}"
             data-cultivar="${escapeHtml(c.cultivar)}" data-level="${level}" data-bay="${c.bay}"
             data-desc="${escapeHtml(label)}"
             data-confirm="${escapeHtml(ui.t('confirmLot', { lot: label, note: p.note }))}" required>
      <span class="lotbody">
        <span class="lothead">
          <span class="baybig">${ui.t('bayN', { n: c.bay })}</span>
          <strong>${escapeHtml(c.cultivar)}</strong>
          <span class="badge ${b.cls}">${b.text}</span>
        </span>
        ${zoneMix(c)}
        <span class="lotmeta">${ui.t('cut', { n: c.cut })} · ${escapeHtml(hungDates(ui, c))} · ${escapeHtml(p.note)}${c.bins ? ` · ${ui.t('binsN', { n: c.bins.toLocaleString('en-US') })}` : ''}</span>
      </span>
    </label>`;
  };

  const card = (l, i) => {
    const p = lotPlausibility(ui, l);
    const b = BADGE[p.level];
    const cv = l.cultivar || '';
    return `
    <label class="lot ${p.level}">
      <input type="radio" name="session_id" value="${l.id}"
             data-cultivar="${escapeHtml(cv)}" data-level="${p.level}"
             data-bay="${(l.bays || []).length === 1 ? l.bays[0] : ''}"
             data-desc="${escapeHtml(`${l.zone}${cv ? ` · ${cv}` : ''} cut ${l.cut_number}`)}"
             data-confirm="${escapeHtml(ui.t('confirmLot', {
               lot: `${l.zone}${cv ? ` · ${cv}` : ''} ${ui.t('cut', { n: l.cut_number })}`,
               note: p.note,
             }))}" ${i === 0 && topIsReady ? 'checked' : ''} required>
      <span class="lotbody">
        <span class="lothead">
          <strong>${escapeHtml(l.zone)}${cv ? ` · ${escapeHtml(cv)}` : ''}</strong>
          <span class="badge ${b.cls}">${b.text}</span>
          ${bayPill(ui, l)}
        </span>
        <span class="lotmeta">${ui.t('cut', { n: l.cut_number })} · ${escapeHtml(String(l.occurred_at).substring(0, 10))} · ${escapeHtml(p.note)}</span>
      </span>
    </label>`;
  };
  // Too-green lots fold into a closed section under the list (Koa, 2026-10-05:
  // "anything that is too green should be minimized"). Still pickable — the
  // tape can beat the dry clock — just not in the way of the lots coming down.
  const cards = activeBays.map(c => bayLevel(c) === 'green' ? '' : bayCard(c)).join('')
    + lots.map((l, i) => lotLevel(l) === 'green' ? '' : card(l, i)).join('');
  const greenBays = activeBays.filter(c => bayLevel(c) === 'green');
  const greenLots = lots.filter(l => lotLevel(l) === 'green');
  const nGreen = greenBays.length + greenLots.length;
  const greenHtml = nGreen ? `
  <details class="batch greenlots">
    <summary>${ui.t('greenLots', { n: nGreen })}</summary>
    <div class="lotlist">${greenBays.map(bayCard).join('')}${greenLots.map(l => card(l, lots.indexOf(l))).join('')}</div>
  </details>` : '';

  const firstCv = topIsReady ? (lots[0].cultivar || '') : '';

  return `
<h1>${ui.t('printTags')}</h1>
${chromeHandoff(ui, `${API}?action=sack_print&lang=${ui.lang}`)}
${flashHtml}
${finishHtml}
${finishHtml ? `<h2>${ui.t('startSection')}</h2>` : ''}
<p class="note">${ui.t(activeBays.length ? 'pickBayHelp' : 'pickLotHelp', { n: DRY_DAYS_TYPICAL })}</p>

<form method="POST" action="${API}?action=sack_session_start&lang=${ui.lang}" id="lotForm">
  ${cards ? `<div class="lotlist">${cards}</div>` : ''}${greenHtml}
  <label for="cultivar">${ui.t('cultivar')} <span class="hint">${ui.t('cultivarHint')}</span></label>
  <input id="cultivar" name="cultivar" required autocomplete="off" value="${escapeHtml(firstCv)}" placeholder="Sour Lifter">
  <label for="bay">${ui.t('bay')} <span class="hint">${lastBay ? ui.t('bayHintLast', { n: lastBay }) : ui.t('bayHint')}</span></label>
  <select id="bay" name="bay" required>${bayOptions(ui, lastBay)}</select>
  <label for="storage">${ui.t('storageField')} <span class="hint">${!lastStorage ? ui.t('storageHint')
    : ui.t(lastStorage.today ? 'storageHintLast' : 'storageHintStale',
        { where: escapeHtml(storageLabel(ui, lastStorage.storage)) })}</span></label>
  <select id="storage" name="storage">${storageOptions(ui, lastStorage?.today ? lastStorage.storage : null)}</select>
  <button class="btn" type="submit">${ui.t('startTakedown')}</button>
</form>
${finishedHtml}

<script>
(function () {
  var form = document.getElementById('lotForm');
  var cv = document.getElementById('cultivar');

  // Closing a lot out is undoable, but it takes the lot off this list, so it
  // asks once, naming the lot and its tag count.
  Array.prototype.forEach.call(document.querySelectorAll('form.finishrow[data-confirm]'), function (f) {
    f.addEventListener('submit', function (e) {
      if (!confirm(f.getAttribute('data-confirm'))) { e.preventDefault(); return; }
      f.querySelector('button').disabled = true;
    });
  });

  function selected() { return form.querySelector('input[name=session_id]:checked'); }

  // With every lot too green, the only radios sit in the closed section, and
  // the browser cannot point at a required field it cannot show — so a submit
  // with nothing picked unfolds it rather than failing silently.
  var greenBox = form.querySelector('details.greenlots');
  form.addEventListener('invalid', function (e) {
    if (greenBox && e.target.name === 'session_id' && !form.querySelector('.lotlist > label.lot')) greenBox.open = true;
  }, true);

  // Cultivar was captured at the zone scan, so it carries through rather than
  // being retyped at takedown — one less place for a mismatch.
  function applyLot(r) {
    var v = r.getAttribute('data-cultivar');
    if (v) cv.value = v;
    // A lot hung in one bay is taken down from that bay: set it, so the bay
    // printed on every tag matches the card that was picked. Two bays, or
    // none known: the field is left alone for the operator.
    var bay = r.getAttribute('data-bay'), sel = document.getElementById('bay');
    if (bay && sel && sel.querySelector('option[value="' + bay + '"]')) sel.value = bay;
  }
  form.addEventListener('change', function (e) {
    if (e.target.name === 'session_id') applyLot(e.target);
  });
  if (selected()) applyLot(selected());

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

// ─── PIPELINE ───────────────────────────────────────────
// A read-only "what's coming" board for the people downstream of the barn.
// Koa, 2026-10-01: "so Nathan and Inaiah can see what cultivars are in the
// pipeline, with expected dates on when they will be ready".
//
// Two lists, and each cultivar is on exactly one of them (Koa, same day: "only
// need to list a cultivar once, not by zone ... if they are [in supersacks],
// they don't need to be listed in the pipeline again"):
//   - ALREADY IN SUPERSACKS: any tag this season. Takedown starts when the
//     first tag prints, so that is also the only "bagging" signal there is.
//   - COMING: open lots of every other cultivar, with an expected date.
//
// THE DATE IS THE BAY'S, NOT THE LOT'S. "We want to take the whole bay down at
// once" — so a lot that is dry is still waiting on whatever was hung after it
// in the same bay. A bay is due DRY_DAYS_TYPICAL days after its newest load
// from a still-open lot. Open lots, not the rack board's fills: a finished lot
// has come down, and that is the boundary the fills approximate from tags.
// A lot with no bay recorded (loads before bays were captured) falls back to
// its own cut day.
//
// Cultivar, bay, dates and sack counts only — no weights or projections.

async function handlePipeline(ui, db, env) {
  const isTest = isTestMode(env) ? 1 : 0;
  const [lots, loads, sacks] = await Promise.all([
    getRecentLots(db, isTest),
    // Every bay-tagged load in the picker window, filtered to open lots in JS:
    // an IN list over session ids would outgrow D1's 100-variable cap.
    query(db, `
      SELECT attributed_zone_session_id AS session_id, bay, occurred_at
      FROM harvest_scan_log
      WHERE event_type = 'barn_load' AND is_test = ? AND bay IS NOT NULL
        AND attributed_zone_session_id IS NOT NULL
        AND julianday('now') - julianday(occurred_at) <= ?
    `, [isTest, LOT_PICKER_DAYS]),
    query(db, `
      SELECT cultivar, COUNT(*) AS tagged, SUM(CASE WHEN opened_at IS NULL THEN 1 ELSE 0 END) AS unopened
      FROM harvest_sacks
      WHERE season = ? AND is_test = ? AND voided_at IS NULL AND cultivar IS NOT NULL AND TRIM(cultivar) <> ''
      GROUP BY cultivar
    `, [getSeason(), isTest]),
  ]);
  return renderPage(ui, ui.lang === 'es' ? 'Lo que viene' : "What's coming",
    pipelineBody(ui, { lots: lots.filter(l => !l.takedown_done_at), loads, sacks }));
}

/** "YYYY-MM-DD" plus n days, calendar arithmetic only (no clock, no zone). */
function dayPlus(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayDiff(fromDay, toDay) {
  return Math.round((Date.parse(`${toDay}T12:00:00Z`) - Date.parse(`${fromDay}T12:00:00Z`)) / 86400000);
}

function pipelineBody(ui, { lots, loads, sacks }, now = new Date()) {
  const es = ui.lang === 'es';
  const L = (en, sp) => (es ? sp : en);
  const today = pacificDay(now);
  const fmtDay = (day, opts = { weekday: 'short', month: 'short', day: 'numeric' }) =>
    new Date(`${day}T12:00:00Z`).toLocaleDateString(es ? 'es-US' : 'en-US', { ...opts, timeZone: 'UTC' });
  const short = (day) => fmtDay(day, { month: 'short', day: 'numeric' });
  // Sack cultivars are typed at print time; match them to the scan log loosely.
  const norm = (s) => String(s || '').trim().toLowerCase();

  // ── Already in supersacks ──
  // Shown under the scan log's spelling when a lot has one, else the spelling
  // most of its tags carry.
  const lotName = new Map(lots.filter(l => norm(l.cultivar)).map(l => [norm(l.cultivar), l.cultivar.trim()]));
  const bagged = new Map();
  for (const s of sacks) {
    const k = norm(s.cultivar);
    const b = bagged.get(k) || { cultivar: lotName.get(k), most: 0, tagged: 0, unopened: 0 };
    if (!lotName.has(k) && (s.tagged || 0) > b.most) { b.cultivar = String(s.cultivar).trim(); b.most = s.tagged; }
    b.tagged += s.tagged || 0;
    b.unopened += s.unopened || 0;
    bagged.set(k, b);
  }

  // ── Bay due dates, from every open lot (bagged cultivars included: their
  // leftovers hang in the same bay and come down with it) ──
  const lotOfSession = new Map();
  for (const l of lots) for (const id of (l.session_ids || [l.id])) lotOfSession.set(id, l);
  const bayLast = new Map();               // bay -> newest load day
  const baysOfLot = new Map();             // lot -> Set(bay)
  for (const ld of loads) {
    const lot = lotOfSession.get(ld.session_id);
    if (!lot) continue;
    const day = pacificDay(parseSqliteUtc(ld.occurred_at));
    if (!bayLast.has(ld.bay) || day > bayLast.get(ld.bay)) bayLast.set(ld.bay, day);
    if (!baysOfLot.has(lot)) baysOfLot.set(lot, new Set());
    baysOfLot.get(lot).add(ld.bay);
  }
  const bayDue = (bay) => dayPlus(bayLast.get(bay), DRY_DAYS_TYPICAL);

  // ── Still hanging, per cultivar. A cultivar not yet in a supersack is a
  // Coming card; one already bagged carries it as a "more drying" line
  // (Koa, 2026-10-01: Sour Lifter's 2 sacks were a small test lot, while the
  // crop itself is still hanging). ──
  const drying = new Map();
  for (const l of lots) {
    const k = norm(l.cultivar);
    if (!k) continue;
    const c = drying.get(k) || { cultivar: l.cultivar.trim(), dues: [], bays: new Set(), unbayed: false };
    const bays = baysOfLot.get(l);
    if (bays && bays.size) {
      for (const b of bays) { c.bays.add(b); c.dues.push(bayDue(b)); }
    } else {
      c.unbayed = true;
      c.dues.push(dayPlus(pacificDay(parseSqliteUtc(l.occurred_at)), DRY_DAYS_TYPICAL));
    }
    drying.set(k, c);
  }
  for (const c of drying.values()) {
    const sorted = c.dues.slice().sort();
    c.first = sorted[0];
    c.last = sorted[sorted.length - 1];
  }
  const comingCards = [...drying.entries()].filter(([k]) => !bagged.has(k)).map(([, c]) => c).sort((a, b) => a.first.localeCompare(b.first) || a.cultivar.localeCompare(b.cultivar));

  const byNum = (a, b) => a - b;
  const whenOf = (c) => c.first === c.last ? `~${fmtDay(c.first)}` : `~${short(c.first)} – ${short(c.last)}`;
  const whereOf = (c) => {
    const bays = [...c.bays].sort(byNum);
    return [
      bays.length ? `${bays.length > 1 ? L('Bays', 'Bahías') : L('Bay', 'Bahía')} ${bays.join(', ')}` : '',
      c.unbayed ? L('bay not recorded', 'bahía sin registrar') : '',
    ].filter(Boolean).join(' · ');
  };
  const comingCard = (c) => {
    const when = whenOf(c);
    const left = dayDiff(today, c.first);
    const detail = left > 1 ? L(`in ${left} days`, `en ${left} días`)
      : left === 1 ? L('tomorrow', 'mañana')
      : L('due — waiting on takedown', 'ya toca — esperando la bajada');
    const where = whereOf(c);
    return `<article class="pcard"><h3>${escapeHtml(c.cultivar)}</h3><p class="pwhen"><strong>${escapeHtml(when)}</strong> <span>${escapeHtml(detail)}</span></p><p class="pwhere">${escapeHtml(where)}</p></article>`;
  };

  const baggedCards = [...bagged.values()].filter(b => b.unopened > 0)
    .sort((a, b) => a.cultivar.localeCompare(b.cultivar));
  const baggedCard = (b) => {
    const more = drying.get(norm(b.cultivar));
    const moreHtml = more ? `<p class="pmore">${escapeHtml(`${L('More drying', 'Más secando')} ${whenOf(more)} · ${whereOf(more)}`)}</p>` : '';
    return `<article class="pcard"><h3>${escapeHtml(b.cultivar)}</h3><p class="pwhen"><strong>${b.unopened}</strong> <span>${b.unopened === 1
      ? L('supersack', 'supersaco') : L('supersacks', 'supersacos')}</span></p>${moreHtml}</article>`;
  };

  const section = (color, title, sub, cards, render, empty) => `
<section class="plane" style="--lane:${color}">
  <div class="plane-head"><h2>${title}</h2><span class="pcount">${cards.length}</span><span class="plane-sub">${sub}</span></div>
  ${cards.length ? `<div class="pgrid">${cards.map(render).join('')}</div>` : `<p class="pempty">${empty}</p>`}
</section>`;

  const asOf = now.toLocaleString(es ? 'es-US' : 'en-US',
    { timeZone: HARVEST_TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  return `
<style>
body:has(.pipe) { background: #f6f5ef; color: #263f32; }
.pipe { max-width: 1100px; margin: 0 auto; font-family: 'Quicksand', system-ui, sans-serif; }
.pipe h1 { font: 800 clamp(30px, 6vw, 46px)/1.05 'Karla', system-ui, sans-serif; letter-spacing: -.03em; margin: 8px 0 8px; color: #263f32; }
.pipe .psub { color: #5d6d61; font-size: 1rem; line-height: 1.5; margin: 0 0 6px; }
.pipe .pasof { color: #7a887d; font-size: .85rem; margin: 0 0 26px; }
.plane { margin: 0 0 30px; }
.plane-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 0 0 10px; margin-bottom: 14px; border-bottom: 4px solid var(--lane); }
.plane-head h2 { margin: 0; font: 800 1.5rem 'Karla', system-ui, sans-serif; color: var(--lane); text-transform: none; letter-spacing: -.01em; }
.pcount { background: var(--lane); color: #fff; font-weight: 800; border-radius: 999px; min-width: 1.8rem; padding: 2px 9px; text-align: center; }
.plane-sub { color: #5d6d61; font-size: .95rem; }
.pgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr)); gap: 14px; }
.pcard { background: #fff; border: 1px solid #dde3d6; border-left: 8px solid var(--lane); border-radius: 14px; padding: 16px 18px; }
.pcard h3 { margin: 0 0 8px; font: 800 1.45rem/1.15 'Karla', system-ui, sans-serif; color: #263f32; }
.pwhen { margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
.pwhen strong { font-size: 1.3rem; color: var(--lane); }
.pwhen span { color: #3d5246; font-weight: 600; }
.pwhere { margin: 8px 0 0; color: #6b7a6f; font-size: .9rem; }
.pmore { margin: 8px 0 0; color: #2d7f86; font-weight: 700; font-size: .95rem; }
.pempty { color: #7a887d; font-style: italic; margin: 0; }
</style>
<div class="pipe">
<h1>${L("What's coming", 'Lo que viene')}</h1>
<p class="psub">${L(
    `Each cultivar once. A bay comes down all at once, about ${DRY_DAYS_TYPICAL} days after the last load hung in it, so dates are estimates.`,
    `Cada variedad una vez. Una bahía se baja completa, unos ${DRY_DAYS_TYPICAL} días después de la última carga colgada; las fechas son estimadas.`)}</p>
<p class="pasof">${L('As of', 'Al')} ${escapeHtml(asOf)} · ${L('refresh for the latest', 'actualiza para ver lo último')}</p>
${section('#2d7f86', L('Coming', 'Por venir'), L('Drying in the barn', 'Secando en el granero'),
    comingCards, comingCard, L('Nothing drying right now.', 'Nada secando por ahora.'))}
${section('#b8841c', L('Already in supersacks', 'Ya en supersacos'), L('Bagged this season, not yet opened', 'Embolsado esta temporada, sin abrir'),
    baggedCards, baggedCard, L('No supersacks yet this season.', 'Todavía no hay supersacos esta temporada.'))}
</div>`;
}

/**
 * The screen the worker actually lives on during a takedown. Quantity is
 * deliberately NOT asked up front — you don't know how many sacks a rack
 * yields until it's empty, and pre-printing leaves orphan serials that can end
 * up on the next rack's sacks.
 */
function sackSessionBody(ui, { lot, cultivar, stats, tags = [], bay = null, storage = null, finishedAt = null, variantCheck = null, flash = null, bayCard = null }) {
  // Taking down a whole bay: it is finished as a bay, not as this lot.
  if (bayCard) finishedAt = bayCard.doneAt || null;
  const bayHidden = bayCard ? `<input type="hidden" name="bay" value="${bayCard.bay}"><input type="hidden" name="cultivar" value="${escapeHtml(bayCard.cultivar)}">
    <input type="hidden" name="cut" value="${bayCard.cut}"><input type="hidden" name="fill_start" value="${escapeHtml(bayCard.fillStart)}">` : '';
  const q = `session_id=${lot.id}&cultivar=${encodeURIComponent(cultivar)}&lang=${ui.lang}`;
  const barn = barnForBay(bay);
  // Bay sits on the lot header rather than tucked away: it prints on every tag
  // of this session, so it should be visible the whole time tags are printing.
  const bayLine = bay
    ? `<div class="lot-meta">${ui.t('bayN', { n: bay })} · ${ui.t(barn === 'bottom' ? 'bottomBarn' : 'topBarn')}</div>`
    : `<div class="lot-meta">${ui.t('noBaySet')}</div>`;
  // Beside the bay for the same reason: it rides every sack printed from here.
  const storageLine = `<div class="lot-meta">${storage
    ? ui.t('storedInWhere', { where: escapeHtml(storageLabel(ui, storage)) })
    : ui.t('storageNotSet')}</div>`;
  // A finished lot says so above everything, with Reopen right there: the print
  // buttons are off, and whoever needs one more tag should not hunt for why.
  const notice = finishedAt ? (bayCard ? `
<div class="notice">${ui.t('bayFinishedNotice', { bay: bayCard.bay, date: escapeHtml(finishedDate(ui, finishedAt)) })}
  <form method="POST" action="${API}?action=bay_finish&lang=${ui.lang}">
    ${bayHidden}<input type="hidden" name="reopen" value="1">
    <button class="btn alt" type="submit">${ui.t('reopenLot')}</button>
  </form>
</div>` : `
<div class="notice">${ui.t('lotFinishedNotice', { date: escapeHtml(finishedDate(ui, finishedAt)) })}
  <form method="POST" action="${API}?action=lot_finish&lang=${ui.lang}">
    <input type="hidden" value="${lot.id}" name="session_id"><input type="hidden" name="reopen" value="1">
    <button class="btn alt" type="submit">${ui.t('reopenLot')}</button>
  </form>
</div>`) : '';
  // Printing still works when there is no variant — a Shopify gap must not stop
  // a takedown — but the crew lead sees it on the first screen, not months later.
  // A check that could not run (ok === null) stays quiet: an outage is not news
  // about this lot.
  const variantWarn = variantCheck?.ok === false ? `
<div class="notice">⚠️ ${ui.t('variantMissing', { e: escapeHtml(variantCheck.error) })}</div>` : '';
  const flashHtml = flash ? `<div class="flash">✅ ${escapeHtml(flash)}</div>` : '';
  const handoff = chromeHandoff(ui, `${API}?action=sack_session&${q}`
    + (bay === null ? '' : `&bay=${bay}`) + (storage ? `&storage=${encodeURIComponent(storage)}` : ''));
  // Back out to another cultivar from the top, not only from the small footer
  // link (Koa, 2026-10-05: crews work several cultivars at once). The picker's
  // Resume brings a started lot back with its bay, so nothing is retyped.
  const topNav = `<nav class="topnav">
  <a class="btn alt" href="${API}?action=sack_print&lang=${ui.lang}">${ui.t('otherCultivar')}</a>
  <a class="btn alt" href="${API}?action=hub&lang=${ui.lang}">${ui.t('homeTools')}</a>
</nav>`;
  return `${topNav}${handoff}${flashHtml}${notice}${variantWarn}
<div class="lot">
  <div class="lot-cultivar">${escapeHtml(cultivar)}</div>
  ${bayCard ? `<div class="lot-meta"><span class="baybig">${ui.t('bayN', { n: bayCard.bay })}</span> ${ui.t('cut', { n: bayCard.cut })} · ${escapeHtml(hungDates(ui, bayCard))}</div>
  <div class="lot-meta">${ui.t('bayMixLabel')} ${zoneMix(bayCard)}</div>`
  : `<div class="lot-meta">${escapeHtml(lot.zone)} · ${ui.t('cut', { n: lot.cut_number ?? '?' })} · ${escapeHtml(formatTagDate(ui.lang, String(lot.occurred_at).substring(0, 10)))}</div>`}
  ${bayLine}
  ${storageLine}
</div>

<!-- A note for the bag about to be tagged (Koa, 2026-09-16: "the note should
     pertain to the next tag that gets printed, not the previous"). Typed first,
     then PRINT TAG saves it on that tag, in the same write. -->
<details id="nextNote" class="nextnote"${finishedAt ? ' hidden' : ''}>
  <summary>${ui.t('noteNext')}</summary>
  <textarea id="noteText" maxlength="500" rows="2" placeholder="${escapeHtml(ui.t('notePlaceholder'))}"></textarea>
  <div class="hint">${ui.t('noteNextHint')}</div>
</details>

<!-- The next bag's weight when it is not a full sack — the last bag of a lot,
     almost always (Koa, 2026-09-28). The crew had been typing it into the note
     ("18lb"); here it is a number the ledger and the allocator can add up. -->
<details id="nextFill" class="nextnote"${finishedAt ? ' hidden' : ''}>
  <summary>${ui.t('fillNext')}</summary>
  <div class="fillrow"><input id="fillLbs" type="number" inputmode="decimal" min="1" max="60" step="0.1"
    placeholder="${fullSackLbs(lot.season || getSeason())}" aria-label="${escapeHtml(ui.t('fillNext'))}"><span>lb</span></div>
  <div class="hint">${ui.t('fillNextHint', { n: fullSackLbs(lot.season || getSeason()) })}</div>
</details>

<button id="printBtn" class="bigbtn"${finishedAt ? ' disabled' : ''}>${ui.t('printTag')}</button>

<div class="status">
  <div id="count">${stats.printed === 1 ? ui.t('tagForLot') : ui.t('tagsForLot', { n: stats.printed })}</div>
  <div id="last" class="last">${stats.lastSackId ? ui.t('lastTag', { id: escapeHtml(stats.lastSackId) }) : ui.t('noTagsYet')}</div>
  <div id="lastActions" class="lastActions" ${stats.lastSackId ? '' : 'hidden'}>
    <a id="reprintLink" class="mini" href="#">${ui.t('reprint')}</a>
    <a id="voidLink" class="mini danger" href="#">${ui.t('void')}</a>
  </div>
  <div id="noteMsg" class="last" hidden></div>
  <!-- Agent mode only: the crew no longer watches a tag appear, so the screen
       says whether one actually did. Stays hidden while the browser prints. -->
  <div id="agentMsg" class="hcstat" hidden></div>
</div>

<!-- Every tag on the lot, so an older one can be reprinted or voided — not
     only the last (Koa, 2026-09-28). Closed by default: PRINT TAG is the job,
     this is the correction. Filled by the script below from the same list the
     print and void responses return, so it never goes stale. -->
<details id="tagList" class="batch taglist"${tags.length ? '' : ' hidden'}>
  <summary id="tagListSum"></summary>
  <div id="tagRows" class="tagrows"></div>
</details>

<details class="batch">
  <summary>${ui.t('printSeveral')}</summary>
  <p class="note">${ui.t('printSeveralHelp')}</p>
  <div class="batchrow">
    <input id="batchQty" type="number" min="2" max="${MAX_PRINT_QTY}" inputmode="numeric" value="5">
    <button id="batchBtn" class="btn"${finishedAt ? ' disabled' : ''}>${ui.t('printBatch')}</button>
  </div>
</details>

${finishedAt ? '' : bayCard ? `<form method="POST" action="${API}?action=bay_finish&lang=${ui.lang}" id="finishForm" class="finishlot">
  ${bayHidden}
  <button class="btn alt" type="submit">${ui.t('finishBay', { bay: bayCard.bay })}</button>
  <span class="hint">${ui.t('finishBayHelp')}</span>
</form>` : `<form method="POST" action="${API}?action=lot_finish&lang=${ui.lang}" id="finishForm" class="finishlot">
  <input type="hidden" value="${lot.id}" name="session_id">
  <button class="btn alt" type="submit">${ui.t('finishLot')}</button>
  <span class="hint">${ui.t('finishLotHelp')}</span>
</form>`}

<div class="footer"><a href="${API}?action=sack_print">${ui.t('changeLot')}</a> · <a href="${API}?action=find">${ui.t('findLink')}</a> · <a href="${API}?action=bajada&lang=${ui.lang}">${ui.lang === 'es' ? 'Bajada por hora' : 'Hourly takedown'}</a> · <a href="${API}?action=hub&lang=${ui.lang}">${ui.lang === 'es' ? 'Todas las herramientas' : 'All harvest tools'}</a></div>

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
    confirmFinish: ui.t('confirmFinish', { lot: lotLabel(ui, lot, cultivar), n: '{n}' }),
    printTagNote: ui.t('printTagNote'), noteSavedOn: ui.t('noteSavedOn', { id: '{id}' }),
    printTagFill: ui.t('printTagFill', { n: '{n}' }), fillSavedOn: ui.t('fillSavedOn', { id: '{id}', n: '{n}' }),
    reprint: ui.t('reprint'), void: ui.t('void'), tagList: ui.t('tagList', { n: '{n}' }),
    tagVoided: ui.t('tagVoided'), tagOpened: ui.t('tagOpened'),
    printingOnAgent: ui.lang === 'es' ? 'Imprimiendo…' : 'Printing…',
    printedOnAgent: ui.lang === 'es' ? '✓ Etiqueta impresa' : '✓ Tag printed',
    printAgentFailed: ui.lang === 'es'
      ? '⚠ No salió la etiqueta {id}: {e} — usa Reimprimir'
      : '⚠ Tag {id} did not print: {e} — use Reprint',
    printAgentSlow: ui.lang === 'es'
      ? '⚠ La impresora no contesta. Revisa la PC del granero.'
      : '⚠ No answer from the printer. Check the barn PC.',
  })};
  var btn = document.getElementById('printBtn');
  var batchBtn = document.getElementById('batchBtn');
  var frame = document.getElementById('printFrame');
  var countEl = document.getElementById('count');
  var lastEl = document.getElementById('last');
  var actions = document.getElementById('lastActions');
  var reprint = document.getElementById('reprintLink');
  var agentMsg = document.getElementById('agentMsg');
  var voidLink = document.getElementById('voidLink');
  var noteBox = document.getElementById('nextNote');
  var noteText = document.getElementById('noteText');
  var noteMsg = document.getElementById('noteMsg');
  var lastId = ${stats.lastSackId ? JSON.stringify(stats.lastSackId) : 'null'};
  var tags = ${JSON.stringify(tags).replace(/</g, '\\u003c')};
  var tagList = document.getElementById('tagList');
  var tagListSum = document.getElementById('tagListSum');
  var tagRows = document.getElementById('tagRows');
  var TAG_TIME = { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  var TAG_LOCALE = '${ui.lang === 'es' ? 'es-US' : 'en-US'}';

  // Built from DOM nodes, not an HTML string: the ids come from the server,
  // and this page is one template literal, so the fewer layers of escaping
  // the better.
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function renderTags() {
    var live = tags.filter(function (t) { return !t.voided; }).length;
    tagList.hidden = !tags.length;
    tagListSum.textContent = T.tagList.replace('{n}', live);
    tagRows.textContent = '';
    tags.forEach(function (t) {
      var row = el('div', 'tagrow' + (t.voided ? ' voided' : ''));
      var info = el('span', 'taginfo');
      info.appendChild(el('strong', 'tagid', '# ' + t.id));
      var when = t.at ? new Date(t.at).toLocaleString(TAG_LOCALE, TAG_TIME) : '';
      if (t.fill != null) when += (when ? ' · ' : '') + t.fill + ' lb';
      if (when) info.appendChild(el('span', 'tagwhen', when));
      row.appendChild(info);
      var acts = el('span', 'tagacts');
      if (t.voided) {
        acts.appendChild(el('span', 'hint', T.tagVoided));
      } else {
        var rp = el('a', 'mini', T.reprint); rp.href = '#';
        rp.setAttribute('data-act', 'reprint'); rp.setAttribute('data-id', t.id);
        acts.appendChild(rp);
        if (t.opened) {
          acts.appendChild(el('span', 'hint', T.tagOpened));
        } else {
          var vd = el('a', 'mini danger', T.void); vd.href = '#';
          vd.setAttribute('data-act', 'void'); vd.setAttribute('data-id', t.id);
          acts.appendChild(vd);
        }
      }
      row.appendChild(acts);
      tagRows.appendChild(row);
    });
  }
  var busy = false;
  var locked = ${finishedAt ? 'true' : 'false'};   // lot finished: no printing until it is reopened
  var printed = ${stats.printed};

  function setBusy(b, label) {
    busy = b;
    btn.disabled = b || locked; batchBtn.disabled = b || locked;
    btn.textContent = b ? (label || T.printing) : idleLabel();
  }

  var fillBox = document.getElementById('nextFill');
  var fillInput = document.getElementById('fillLbs');
  function pendingNote() { return noteText.value.trim(); }
  function pendingFill() { return fillInput.value.trim(); }
  // The button names what it will do: a waiting note or weight goes out with
  // the tag. The weight wins the label — it changes the numbers, a note does not.
  function idleLabel() {
    if (pendingFill()) return T.printTagFill.replace('{n}', pendingFill());
    return pendingNote() ? T.printTagNote : T.printTag;
  }
  noteText.addEventListener('input', function () {
    noteBox.classList.toggle('pending', !!pendingNote());
    if (!busy) btn.textContent = idleLabel();
  });
  fillInput.addEventListener('input', function () {
    fillBox.classList.toggle('pending', !!pendingFill());
    if (!busy) btn.textContent = idleLabel();
  });

  function refresh(data) {
    if (data.tags) { tags = data.tags; renderTags(); }
    var n = data.printed;
    printed = n;
    countEl.innerHTML = (n === 1 ? T.tagForLot : T.tagsForLot.replace('{n}', n));
    lastId = data.last_sack_id;
    if (lastId) {
      lastEl.innerHTML = T.lastTag.replace('{id}', lastId);
      actions.hidden = false;
      reprint.href = '${API}?action=sack_label&id=' + encodeURIComponent(lastId);
    } else {
      lastEl.textContent = T.noTagsYet;
      actions.hidden = true;
    }
  }

  // Who prints: the server decides, per allocation, and says so in the alloc
  // response. NOT a page-level flag — this page can have been open for an hour,
  // and a stale decision would print the tag twice (iframe here AND the agent).
  // WebKit scopes window.print() to the TOP-LEVEL document, not the iframe that
  // called it — so on an iPhone the hidden-iframe trick prints the takedown
  // screen instead of the tag (Koa, 2026-09-21, in Chrome on iOS; Chrome there
  // is WebKit underneath, so this is not Safari-only). Desktop Chrome scopes it
  // to the frame, which is why the barn PC has always worked.
  var iframePrintUnreliable = ${IFRAME_PRINT_UNRELIABLE_SRC};
  var topLevelPrint = iframePrintUnreliable(
    navigator.userAgent, navigator.platform, navigator.maxTouchPoints);

  function print(ids, via) {
    if (via === 'agent') { watchPrint(ids); return; }  // the barn PC prints it
    var url = '${API}?action=sack_label&ids=' + encodeURIComponent(ids.join(','));
    if (window.navigator.standalone === true) {
      // Running as an iOS home-screen app (Koa, 2026-09-25). There are no tabs
      // in there: window.open either fails or lands in a view with no way
      // back. Go to the label page in place; it lays the tag out for the app's
      // print path and offers history.back() to return here for the next bag.
      window.location.href = url + '&back=1';
      return;
    }
    if (topLevelPrint) {
      // A separate tab, so window.print() runs at top level where WebKit will
      // honour it. Opened from the button's own click handler, so it counts as
      // user-initiated and is not treated as a popup. The takedown screen stays
      // loaded underneath with its lot, bay and count intact.
      //
      // NAMED, not '_blank': every tag reuses this one tab instead of opening a
      // fresh one per sack. popup=1 tells the label page to close itself when
      // printing is done, so the crew lands back here rather than closing a tab
      // per bag all day (Koa, 2026-09-21).
      var w = window.open(url + '&popup=1', 'rf_tag_print');
      // Blocked anyway (a locked-down browser): navigate rather than silently
      // printing nothing. The label page carries a link back to the lot.
      if (!w) window.location.href = url;
      return;
    }
    frame.src = url;
  }

  // In agent mode the crew no longer watches a tag appear as confirmation, so
  // the screen has to supply it. Queued is NOT printed: the serial is already
  // spent and the Shopify count already moved, so showing a tick on the
  // strength of an enqueue would hide exactly the failure the ack exists for.
  function watchPrint(ids) {
    var tries = 0;
    agentMsg.hidden = false;
    agentMsg.className = 'hcstat';
    agentMsg.textContent = T.printingOnAgent;
    (function poll() {
      tries += 1;
      fetch('${API}?action=print_check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ids }),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var st = (d && d.status) || {};
          var states = ids.map(function (id) { return (st[id] || {}).status; });
          var failed = ids.filter(function (id) { return (st[id] || {}).status === 'failed'; });
          if (failed.length) {
            agentMsg.className = 'hcstat bad';
            agentMsg.textContent = T.printAgentFailed
              .replace('{id}', failed[0])
              .replace('{e}', (st[failed[0]] || {}).error || '');
            return;
          }
          if (states.every(function (x) { return x === 'done'; })) {
            agentMsg.className = 'hcstat ok';
            agentMsg.textContent = T.printedOnAgent;
            return;
          }
          // ~30s. Long enough for a rack of tags, short enough that a stopped
          // agent is noticed while the crew is still at the printer.
          if (tries < 40) return setTimeout(poll, 750);
          agentMsg.className = 'hcstat bad';
          agentMsg.textContent = T.printAgentSlow;
        })
        .catch(function () { if (tries < 40) setTimeout(poll, 1500); });
    })();
  }

  function alloc(qty) {
    if (busy) return;           // guards the double-tap: two serials, one sack
    // Only PRINT TAG carries the note: a batch is several bags. The note waits
    // in its box for the next single tag instead.
    var note = qty === 1 ? pendingNote() : '';
    var fill = qty === 1 ? pendingFill() : '';
    setBusy(true);
    fetch('${API}?action=sack_alloc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: ${lot.id}, cultivar: ${JSON.stringify(cultivar)}, qty: qty, bay: ${bay === null ? 'null' : bay}, storage: ${JSON.stringify(storage)}, note: note, fill_lbs: fill })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.success) throw new Error(d.error || 'Print failed');
        print(d.ids, d.print_via); refresh(d);
        var saved = [];
        if (d.note_on) {
          // Saved with the tag: clear the box so it cannot ride onto the next one.
          noteText.value = ''; noteBox.classList.remove('pending'); noteBox.open = false;
          saved.push(T.noteSavedOn.replace('{id}', d.note_on));
        }
        if (d.fill_on) {
          fillInput.value = ''; fillBox.classList.remove('pending'); fillBox.open = false;
          saved.push(T.fillSavedOn.replace('{id}', d.fill_on).replace('{n}', d.fill_lbs));
        }
        noteMsg.innerHTML = saved.join('<br>');
        noteMsg.hidden = !saved.length;
        setBusy(false);
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

  function reprintTag(id) {
    if (!id) return;
    // A jam is the most time-critical recovery there is, so it must work on
    // every handset. ALWAYS ask the server which way to print — this page may
    // have been loaded without allocating anything, so there is no local answer
    // that can be trusted, and guessing 'browser' is the path WebKit breaks.
    fetch('${API}?action=print_reprint', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sack_id: id }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.success) throw new Error(d.error || 'Reprint failed');
        if (d.print_via === 'agent') watchPrint([id]);
        else print([id], 'browser');
      })
      .catch(function (err) { alert(T.printFailed.replace('{e}', err.message)); });
  }

  function voidTag(id) {
    if (!id || busy) return;
    if (!confirm(T.confirmVoid.replace('{id}', id))) return;
    setBusy(true, T.voiding);
    fetch('${API}?action=sack_void', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sack_id: id })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.success) throw new Error(d.error || 'Void failed');
        refresh(d); setBusy(false);
      })
      .catch(function (e) { setBusy(false); alert(T.voidFailed.replace('{e}', e.message)); });
  }

  reprint.addEventListener('click', function (e) { e.preventDefault(); reprintTag(lastId); });
  voidLink.addEventListener('click', function (e) { e.preventDefault(); voidTag(lastId); });
  tagRows.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-act]');
    if (!a) return;
    e.preventDefault();
    var id = a.getAttribute('data-id');
    if (a.getAttribute('data-act') === 'void') voidTag(id); else reprintTag(id);
  });
  renderTags();

  // The count in the question is the live one, not the one the page loaded with.
  var finishForm = document.getElementById('finishForm');
  if (finishForm) finishForm.addEventListener('submit', function (e) {
    if (busy || !confirm(T.confirmFinish.replace('{n}', printed))) { e.preventDefault(); return; }
    finishForm.querySelector('button').disabled = true;
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
/**
 * The printed tag is always English, whatever language the screen is in.
 *
 * The crew screens are Spanish because the field and barn crew read them. The
 * tag is different: it is stuck to a sack that outlives the shift and gets read
 * downstream by bucking, the trim floor, inventory and sales, where English is
 * the working language. A tag whose language depends on whoever happened to be
 * at the barn PC when it printed would leave a rack of sacks labelled two ways.
 *
 * `labelInner` deliberately takes no `ui`, so the tag cannot accidentally be
 * localised by a caller that has one.
 */
const TAG_LANG = 'en';

/**
 * The printed face of one tag.
 *
 * WIDTH BUDGET on the meta line: date + zone + cut + bay measures 226pt of the
 * 253pt column at its worst case ("Sep 30, 2026 - Z10 - Cut 9 - Bay 12"), i.e.
 * 89% full. That is a HARD worst case rather than an estimate, because every
 * field on it is length-capped -- 3-char month, 2-digit day, 3-char zone,
 * 1-digit cut, 2-digit bay. It fits, but there is no room for a fifth field:
 * anything more on that line has to displace something, and the line silently
 * CLIPS rather than wrapping.
 */
function labelInner(s) {
  // A specimen that walks away from the printer is otherwise indistinguishable
  // from a real tag — the bag number is real by design (Koa, 2026-09-07), so
  // the number cannot carry the warning and something else has to.
  //
  // Both languages, because it will be handed to people on both sides of the
  // barn, and one word each so it reads across a room. Solid black rather than
  // an outline: this has to survive being glanced at, not studied.
  const exampleBar = s.example
    ? `<div class="exbar"><span>EJEMPLO</span><span>EXAMPLE</span></div>`
    : '';
  // Serial only, not the whole id. '#1' beside 'Sour Lifter (SLIFT)' is what a
  // person actually needs, and it removes the width pressure that used to push
  // a long id under the QR. The full id still travels in the QR, and stays
  // reconstructable by eye: code + serial + the year off the harvest date.
  const serial = s.serial ?? String(s.sack_id || '').split('-').pop();
  // The cut, large, beside the number (Koa, 2026-09-16). Numbers restart for
  // each cut, so "#1" alone names two bags; this box is what tells them apart
  // from across the barn. An outline, never a fill — a browser drops
  // background colours when printing (see .exbar). It replaces "Cut N" in the
  // meta line rather than repeating it.
  const ord = cutOrdinal(s.cut_number);
  const cutBox = ord ? `<div class="cutbox"><span class="ord">${ord}</span><span class="cw">CUT</span></div>` : '';
  return `
    <div class="qrwrap">
      ${qrImg(`${PUBLIC_BASE}/s/${s.qr_id || s.sack_id}`)}
      ${exampleBar}
    </div>
    <div class="txt">
      <div class="cultivar" style="font-size:${cultivarFontPt(s.cultivar)}pt">${escapeHtml(s.cultivar || '')}</div>
      ${s.cultivar_code ? `<div class="code">${escapeHtml(s.cultivar_code)}</div>` : ''}
      <div class="bagrow">
        <div class="bagno" style="font-size:${bagnoFontPt(serial, ord ? CUT_BOX_PT : 0)}pt">#${escapeHtml(String(serial))}</div>
        ${cutBox}
      </div>
      <div class="meta">${escapeHtml(formatTagDate(TAG_LANG, s.harvest_date))} · ${escapeHtml(s.zone)}${ord ? '' : ` · ${escapeHtml(translate(TAG_LANG, 'cut', { n: '?' }))}`}${s.bay ? ` · ${escapeHtml(translate(TAG_LANG, 'bayN', { n: s.bay }))}` : ''}</div>
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
    for (const sack of sacks) cells.push(`<div class="cell">${labelInner(sack)}</div>`);
  }

  const pages = [];
  for (let i = 0; i < cells.length; i += G.perSheet) {
    pages.push(`<div class="sheet">${cells.slice(i, i + G.perSheet).join('')}</div>`);
  }

  const used = skip + sacks.length;
  const leftOver = calibrate ? 0 : (G.perSheet - (used % G.perSheet)) % G.perSheet;
  const nextSkip = (used % G.perSheet);

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${G.name}</title>
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
    display: flex; flex-direction: row; align-items: center; gap: 0.1in;
  }
  .txt { min-width: 0; flex: 1; }
  .cell.blank { visibility: hidden; }
  .cultivar { font-weight: 800; line-height: 1.05; letter-spacing: -0.01em;
              white-space: nowrap; overflow: hidden; }
  /* The cultivar abbreviation, on its own line under the name (Koa, 2026-09-03).
     Its own line is the point: sharing one with the name is what cost the name
     3-7pt when this last lived on the tag, and the name is what gets read
     across a barn. Sized well below the name so it reads as a subtitle rather
     than competing with it; letter-spaced because a short all-caps code is
     easier to pick apart at arm's length with the letters opened up.
     KEEP IN SYNC with the same rules in the other renderer. */
  .code { font-size: 13pt; font-weight: 700; line-height: 1.1; letter-spacing: .06em;
          white-space: nowrap; overflow: hidden; margin-top: 0.01in; }
  .bagno { font-weight: 800; line-height: 1.0; white-space: nowrap; min-width: 0; overflow: hidden; }
  /* The number and its cut side by side. KEEP IN SYNC with the other renderer. */
  .bagrow { display: flex; align-items: center; gap: 0.08in; margin-top: 0.02in; }
  .cutbox { flex: none; border: 2pt solid #000; padding: 0.03in 0.06in; text-align: center;
            line-height: 1; font-weight: 800; }
  .cutbox .ord { display: block; font-size: 22pt; letter-spacing: -0.01em; }
  .cutbox .cw { display: block; font-size: 10pt; letter-spacing: .14em; margin-top: 0.02in; }
  /* Bold, because at 203dpi a normal-weight 10.5pt stroke falls between dots
     and prints noticeably lighter than the rest of the tag. This is the ONLY
     line on the label CSS can darken: the cultivar and bag number are already
     at 800, and the stack is Arial/Helvetica, which has no face heavier than
     Bold — asking for 900 there would change nothing. Everything else is a
     printer density question. */
  .meta { font-size: 10.5pt; margin-top: 0.04in; white-space: nowrap; font-weight: 700; }
  .qr { width: 1in; height: 1in; flex: none; }

  /* Calibration: outline every slot so a test print can be held against a
     real sheet. If these boxes do not sit on the die-cuts, the printer is
     scaling and no amount of template tweaking will fix it. */
  .cell.cal { border: 1pt solid #000; align-items: center; justify-content: center; }
  .calnum { font-size: 28pt; font-weight: 700; color: #000; }

  .toolbar { padding: 14px; font: 14px system-ui; background: #fff; }
  .toolbar a { color: #304e3c; display:inline-block; padding:10px 14px; border:1px solid #c5d0ba; border-radius:8px; text-decoration:none; margin:4px; }
  @media screen { .toolbar{background:#edf1e4!important;color:#304e3c!important;padding:16px!important;line-height:1.8} .banner{border-radius:12px!important} }
  .toolbar .warn { color: #a33; font-weight: 600; }
  @media screen and (max-width:600px) { .sheet { zoom: .42; } }
  @media screen { .sheet { margin: 12px auto; box-shadow: 0 1px 6px rgba(0,0,0,.3); } }
  @media print {
    .toolbar { display: none; }
    body { background: #fff; }
    .sheet { margin: 0; box-shadow: none; page-break-after: always; }
    .sheet:last-child { page-break-after: auto; }
  }
</style></head>
<body>
<div class="toolbar"><a href="/api/harvest?action=hub&lang=${ui.lang}">${ui.lang === 'es' ? 'Herramientas' : 'All tools'}</a>
  <strong>${G.name}</strong> &middot; ${calibrate ? 'calibration sheet' : `${sacks.length} ${ui.t('sack')}${skip ? ` · skipped ${skip}` : ''}`}
  &middot; <a href="javascript:window.print()">${ui.t('printTag')}</a>
  ${!calibrate && leftOver ? `&middot; <strong>${leftOver} slot(s) left on this sheet</strong> — keep it, next run use <code>&amp;skip=${nextSkip}</code>` : ''}
  <div class="warn">Print at 100% scale, margins None, headers/footers off — anything else shifts every label.</div>
</div>
${pages.join('')}
${TAG_FIT_SCRIPT}
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/**
 * Three specimen tags for proving a printer, allocating nothing.
 *
 * Deliberately not one sample. The cultivar font steps down as the name grows
 * (cultivarFontPt), so a printer that renders "Sour Lifter" beautifully can
 * still clip "Orange Pineapple Quik" — the longest name in the 2026 roster.
 * One tag per bracket is the only way to see that on real hardware.
 *
 * The last one also carries the longest plausible bag number, which is the
 * densest QR the season can produce: if that one scans off the printed tag,
 * every real tag will.
 */
/**
 * The two hand-out tags: one Sour Lifter, one Lifter (Koa, 2026-09-07).
 *
 * Real in every respect a printer or a person can check: real cultivar, real
 * sku prefix, real zone, real bay, a real-format bag number, a plausible cut
 * date. Both QRs open a working sack page, so a person handed one of these can
 * scan it and see the whole journey, and nothing they press on that page
 * writes anything — until the season prints that number for real, at which
 * point the real bag takes over its own id (see DEMO_SACKS).
 *
 * No rows, so no serials are consumed: an is_test sack row would take
 * `26-SLIFT-1` and push the first real bag of the season to `-2`, which is
 * exactly what happened on 2026-09-04.
 */
function exampleTagSacks() {
  // Cut on the typical dry cycle back from today, so the date on the tag is
  // always plausible against the day it is being looked at.
  const cut = new Date(Date.now() - DRY_DAYS_TYPICAL * 86400000).toISOString().slice(0, 10);
  return Object.entries(DEMO_SACKS).map(([id, d]) => ({
    example: true,
    sack_id: id, qr_id: id, serial: d.serial,
    cultivar_code: d.code, cultivar: d.cultivar, zone: d.zone,
    cut_number: d.cut, harvest_date: cut, bay: d.bay,
  }));
}

function specimenSacks() {
  const today = new Date().toISOString().slice(0, 10);
  // Real cultivar/sku_prefix pairs from the 2026 roster, not invented ones, so
  // the proof exercises widths that can actually occur.
  return [
    // The one to scan: its QR opens the demo sack page, so the printed tag and
    // the screen it leads to can both be judged from one sheet.
    { example: true, sack_id: DEMO_SACK_ID, qr_id: DEMO_SACK_ID, serial: 142, cultivar_code: 'SLIFT', cultivar: 'Sour Lifter', zone: 'Z4', cut_number: 1, harvest_date: today, bay: 7 },
    // Longest name in the roster, so the name font drops to its smallest step.
    { example: true, sack_id: '26-ORNGPQ-C2-12', serial: 12,  cultivar_code: 'ORNGPQ',   cultivar: 'Orange Pineapple Quik', zone: 'Z8',  cut_number: 2, harvest_date: today, bay: 9 },
    // The realistic worst case, and both squeezes at once: an 8-character
    // prefix (the longest planted this year) with a 3-digit serial, under a
    // 20-character name. This is the pairing that overlapped the QR.
    { example: true, sack_id: '26-STRAWDNT-C3-123', serial: 123, cultivar_code: 'STRAWDNT', cultivar: 'Strawberry Doughnuts',  zone: 'Z10', cut_number: 3, harvest_date: today, bay: 12 },
  ];
}

function renderLabelSheet(ui, sacks, printCtx, opts = {}) {
  const autoPrint = opts.autoPrint !== false;

  // ?stock=4x6 prints the same 4x2 tag on 4x6 media. The tag is unchanged --
  // only the page grows -- so a printer can be proven on whatever roll is
  // already loaded, before committing to an order of 4x2. The dashed line
  // marks where the real label ends, so the footprint can be eyeballed against
  // a Uline tag without owning the right stock yet.
  const oversize = String(opts.stock || '') === '4x6';
  const pageH = oversize ? 6 : 2;

  const labels = sacks.map(s => oversize
    ? `<div class="page">
         <div class="label">${labelInner(s)}
         </div>
         <div class="cutline"><span>real 4&Prime; × 2&Prime; tag ends here</span></div>
       </div>`
    : `<div class="label">${labelInner(s)}
  </div>`).join('');

  const backLink = `<a href="${API}?action=sack_print">${ui.t('changeLot')}</a>`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Sack tags</title>
<style>
  @page { size: 4in ${pageH}in; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; background: #eee; }
  .page { width: 4in; height: ${pageH}in; background: #fff; }
  .label {
    width: 4in; height: 2in; padding: 0.11in 0.13in;
    background: #fff; color: #000; overflow: hidden;
    display: flex; flex-direction: row; align-items: center; gap: 0.1in;
    /* A tag is one physical label. Even if something above it shifts the flow,
       it must move whole rather than split across the perforation. */
    break-inside: avoid; page-break-inside: avoid;
    position: relative;
  }
  /* Example tags only. Absolutely positioned so the flex row above is untouched
     — the name/code/number/meta stack keeps the widths it was tuned for, and
     only the bottom padding grows to make room. */
  /* BLACK INK ON WHITE, never a background fill.
     This mark was reported invisible on the printout twice, and both times I
     moved it — first off the label edge, then into the QR column — when the
     geometry was never the problem. It was white text on a black box, and a
     browser DROPS background colours when printing unless the user has ticked
     "Background graphics". The fill vanished, the white text went with it, and
     on a thermal printer that is nothing at all. In the print preview it read
     as faint grey, which is exactly what a dropped fill looks like.
     Everything else on this tag is black on white, which is why everything
     else survives. print-color-adjust:exact would force the fill back, but it
     hangs on a checkbox in someone's print dialog and inverts to black-on-black
     when they tick it — an outline needs no permission from anybody.
     It stays under the QR: that column really does have the spare height. */
  .qrwrap { flex: none; display: flex; flex-direction: column;
            align-items: center; gap: 0.05in; }
  .exbar {
    border: 1.5pt solid #000; color: #000; background: none;
    text-align: center; line-height: 1.18; padding: 0.02in 0.05in;
  }
  .exbar span {
    display: block; font-size: 8pt; font-weight: 800; letter-spacing: 0.06em;
    white-space: nowrap;
  }
  .txt { min-width: 0; flex: 1; }
  .cutline { border-top: 1pt dashed #999; text-align: center; }
  .cutline span { font-size: 7pt; color: #777; letter-spacing: .04em; }
  .cultivar { font-weight: 800; line-height: 1.05; letter-spacing: -0.01em;
              white-space: nowrap; overflow: hidden; }
  /* The cultivar abbreviation, on its own line under the name (Koa, 2026-09-03).
     Its own line is the point: sharing one with the name is what cost the name
     3-7pt when this last lived on the tag, and the name is what gets read
     across a barn. Sized well below the name so it reads as a subtitle rather
     than competing with it; letter-spaced because a short all-caps code is
     easier to pick apart at arm's length with the letters opened up.
     KEEP IN SYNC with the same rules in the other renderer. */
  .code { font-size: 13pt; font-weight: 700; line-height: 1.1; letter-spacing: .06em;
          white-space: nowrap; overflow: hidden; margin-top: 0.01in; }
  .bagno { font-weight: 800; line-height: 1.0; white-space: nowrap; min-width: 0; overflow: hidden; }
  /* The number and its cut side by side (Koa, 2026-09-16: numbers restart per
     cut, so the cut has to read from across the barn). An outline, not a
     fill, for the reason .exbar gives. KEEP IN SYNC with the other renderer. */
  .bagrow { display: flex; align-items: center; gap: 0.08in; margin-top: 0.02in; }
  .cutbox { flex: none; border: 2pt solid #000; padding: 0.03in 0.06in; text-align: center;
            line-height: 1; font-weight: 800; }
  .cutbox .ord { display: block; font-size: 22pt; letter-spacing: -0.01em; }
  .cutbox .cw { display: block; font-size: 10pt; letter-spacing: .14em; margin-top: 0.02in; }
  /* Bold: at 203dpi a normal-weight 10.5pt stroke falls between dots and prints
     lighter than the rest of the tag (Koa, 2026-09-03). This is the only line
     CSS can darken — cultivar and bag number are already 800, and Arial has no
     face heavier than Bold, so 900 there would change nothing. The rest is
     printer density. KEEP IN SYNC with the same rule in renderAverySheet. */
  .meta { font-size: 10.5pt; margin-top: 0.04in; white-space: nowrap; font-weight: 700; }
  .qr { width: 1in; height: 1in; flex: none; }
  .toolbar { padding: 14px; font: 14px system-ui; }
  /* Way back to the takedown screen if the browser will not close this tab.
     Screen-only — it must never cost a label. Hidden in the ONE @media print
     block below, not a second one: a stray print block ahead of it shadows the
     real one for anything reading the first match. */
  #doneBtn { display: block; margin: 16px auto; padding: 18px 24px; font-size: 20px;
             font-weight: 700; background: #2f7a4f; color: #fff; border: 0;
             border-radius: 12px; min-width: 80%; }
  .toolbar a { color: #304e3c; display:inline-block; padding:10px 14px; border:1px solid #c5d0ba; border-radius:8px; text-decoration:none; margin:4px; }
  @media screen { .toolbar{background:#edf1e4!important;color:#304e3c!important;padding:16px!important;line-height:1.8} .banner{border-radius:12px!important} }
  /* Explanatory text for whoever opened the sheet — SCREEN ONLY. Left in the
     print flow it costs a label and, worse, pushes the first tag down so it
     straddles the page boundary: the Sour Lifter tag came out of a BIXOLON
     SRP-770III with the name on one label and the QR on the next
     (Koa, 2026-09-07). The calibration sheet had the same fault. */
  .banner { max-width: 4in; margin: 12px auto; padding: 12px 14px;
            background: #fff; border: 1px solid #ccc; border-radius: 6px;
            font: 13px/1.5 system-ui, sans-serif; color: #222; }
  @media screen {
    .label, .page { margin: 12px auto; box-shadow: 0 1px 6px rgba(0,0,0,.3); }
    .page .label { margin: 0; box-shadow: none; }
  }
  @media print {
    .toolbar, .banner { display: none; }
    #doneBtn { display: none; }
    body { background: #fff; }
    .label, .page { margin: 0; page-break-after: always; box-shadow: none; }
    .label:last-child, .page:last-child { page-break-after: auto; }
    .page .label { page-break-after: auto; }
  }
  /* SAFARI ON iOS (Koa, 2026-09-25: "it works in Chrome but not Safari"; the
     home-screen app is Safari's print path too). Safari ignores @page and lays
     the tag out inside the printer's printable area, ~0.5in in from every
     edge, shrinking to fit the width and SPLITTING on the height: the date and
     the bottom of the QR came out on the next label. Chrome on iOS lands the
     4x2 page 1:1. Nothing here can widen Safari's box, so the same markup is
     laid out to fit inside it instead. --pw/--ph are the box, --tf the text
     factor; the script below sets them (see SAFARI_PRINT_SRC and
     APP_PRINT_FIT_SRC in print-client.js for the rule and the tuning).
     The QR takes the box's full height; the text column scales to match. */
  html.app-print .label { width: var(--pw); height: var(--ph); padding: 0.04in 0.06in; gap: 0.06in; }
  html.app-print .qr { width: calc(var(--ph) - 0.08in); height: calc(var(--ph) - 0.08in); }
  html.app-print .qrwrap { gap: 0.02in; }
  /* Specimen tags only: the EJEMPLO/EXAMPLE bar shares the QR's column, so the
     QR gives up its two lines rather than pushing the bar off the box. */
  html.app-print .qrwrap:has(.exbar) .qr { width: calc(var(--ph) - 0.34in); height: calc(var(--ph) - 0.34in); }
  html.app-print .exbar { border-width: 1pt; padding: 0.01in 0.03in; }
  /* The code line folds into the date line in the compact tag (the script
     moves the text); its 0.2in is what buys the bag number its full size. */
  html.app-print .code { display: none; }
  html.app-print .bagrow { gap: calc(0.06in * var(--tf)); margin-top: 0; }
  html.app-print .cutbox { border-width: calc(2pt * var(--tc)); padding: calc(0.03in * var(--tc)) calc(0.06in * var(--tc)); }
  html.app-print .cutbox .cw { margin-top: calc(0.02in * var(--tc)); }
  html.app-print .meta { margin-top: calc(0.02in * var(--tf)); }
</style></head>
<body>
<div class="toolbar"><a href="/api/harvest?action=hub&lang=${ui.lang}">${ui.lang === 'es' ? 'Herramientas' : 'All tools'}</a>${sacks.length} · ${backLink} · <a href="javascript:window.print()">${ui.t('printTag')}</a></div>
${opts.banner || ''}
${labels}
${opts.popup || opts.back ? `<button type="button" id="doneBtn" hidden>${ui.lang === 'es' ? '← Volver e imprimir la siguiente' : '← Back for the next tag'}</button>` : ''}
<script>
  // Safari on iOS (and the home-screen app): lay the tag out to fit the box
  // its print path leaves us (see the html.app-print rules above). Runs BEFORE
  // the fit script so the width check below sees the scaled sizes. Chrome on
  // iOS, Android and the barn PC get null here and print the full 4x2 tag.
  var safariPrint = ${SAFARI_PRINT_SRC};
  var appPrintFit = ${APP_PRINT_FIT_SRC};
  var compactText = ${COMPACT_TEXT_SRC};
  (function () {
    var q = /[?&]fit=([^&]*)/.exec(window.location.search);
    var compact = safariPrint(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
    var box = appPrintFit(q ? decodeURIComponent(q[1]) : '', ${JSON.stringify(String(opts.appBox || ''))}, compact);
    if (!box) return;
    var root = document.documentElement;
    var t = compactText(box.h);
    root.style.setProperty('--pw', box.w + 'in');
    root.style.setProperty('--ph', box.h + 'in');
    root.style.setProperty('--tf', String(box.f));
    root.style.setProperty('--tc', String(t.cut));
    // Each line has its own factor (COMPACT_TEXT_SRC): the bag number is read
    // across the barn and keeps its size; the rest gives. The name and number
    // carry their size inline (it steps with length), so the stylesheet cannot
    // scale them: read what each is, scale, write back.
    function scale(sel, f) {
      var els = document.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) {
        var pt = parseFloat(getComputedStyle(els[i]).fontSize) * 0.75 * f;
        els[i].style.fontSize = (Math.round(pt * 4) / 4) + 'pt';
      }
    }
    scale('.cultivar', t.name);
    scale('.bagno', t.num);
    scale('.cutbox .ord, .cutbox .cw', t.cut);
    scale('.meta, .exbar span', t.meta);
    // The code line gives up its row: it leads the date line instead, so the
    // abbreviation is still on the tag where the full-size layout has it.
    var labels = document.querySelectorAll('.label');
    for (var j = 0; j < labels.length; j++) {
      var code = labels[j].querySelector('.code'), meta = labels[j].querySelector('.meta');
      if (code && meta && code.textContent) meta.textContent = code.textContent + ' \u00b7 ' + meta.textContent;
    }
    root.className += ' app-print';
    // Then fit the stack to the box's HEIGHT. The number's inline size is
    // already fit to the column width (a short "#142" starts near 44pt), so a
    // factor alone cannot promise the stack fits; and height is the one
    // overflow that costs a label — it prints on the next one. The number
    // gives first, down to the cut box beside it, then the name. Width fitting
    // stays with fitTagText below.
    var innerPx = (box.h - 0.08) * 96;
    for (var k = 0; k < labels.length; k++) {
      var txt = labels[k].querySelector('.txt'), bag = labels[k].querySelector('.bagno');
      var cb = labels[k].querySelector('.cutbox'), nm = labels[k].querySelector('.cultivar');
      for (var guard = 0; guard < 200 && txt.getBoundingClientRect().height > innerPx + 0.5; guard++) {
        var bagPt = parseFloat(getComputedStyle(bag).fontSize) * 0.75;
        var cbH = cb ? cb.getBoundingClientRect().height : 0;
        if (bag.getBoundingClientRect().height > cbH + 1 && bagPt > 10) { bag.style.fontSize = (bagPt - 0.5) + 'pt'; continue; }
        var nmPt = parseFloat(getComputedStyle(nm).fontSize) * 0.75;
        if (nmPt > 8) { nm.style.fontSize = (nmPt - 0.5) + 'pt'; continue; }
        break;
      }
    }
  })();
</script>
${TAG_FIT_SCRIPT}
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
</script>` : ''}${opts.popup || opts.back ? `<script>
  // Opened as a print tab by the takedown screen. Get the crew back to that
  // screen without making them close a tab per sack (Koa, 2026-09-21: "when i
  // want to print the next tag, i have to close back and go to the previous
  // page"). A script-opened window may close itself, which is why this only
  // ever runs with popup=1.
  //
  // back=1 is the home-screen app, which navigated here instead: there is no
  // tab to close, so "done" is history.back() to the takedown screen, and the
  // button is the same way back if afterprint never fires.
  (function () {
    var closed = false;
    var goBack = ${opts.back ? 'true' : 'false'};
    function done() {
      // Never latched in the app: if the first back() went nowhere (the label
      // page was opened cold, nothing behind it), the button must still try.
      if (goBack) { window.history.back(); return; }
      if (closed) return;
      closed = true;
      window.close();
      // If the browser refuses to close it, the button below is the way back —
      // never leave the crew on a dead-end page mid-takedown.
      var b = document.getElementById('doneBtn');
      if (b) b.hidden = false;
    }
    window.addEventListener('afterprint', done);
    // afterprint is not reliable on every WebKit build, so a timer backstops it.
    // Generous: it must not fire while the print sheet is still open.
    setTimeout(function () {
      var b = document.getElementById('doneBtn');
      if (b) b.hidden = false;
    }, 4000);
    var btn = document.getElementById('doneBtn');
    if (btn) btn.addEventListener('click', function (e) { e.preventDefault(); done(); });
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
/**
 * Rough advance width of a bag number in em, Arial Bold.
 *
 * Deliberately pessimistic: every capital is charged the width of a wide one
 * (0.722) even though I and L are far narrower. Erring large here shrinks the
 * text a little; erring small lets it run under the QR, which is what the
 * printed proof caught. Cheap direction to be wrong in.
 */
function emWidth(str) {
  let w = 0;
  for (const ch of String(str)) {
    if (ch >= '0' && ch <= '9') w += 0.556;
    else if (ch >= 'A' && ch <= 'Z') w += 0.722;
    else if (ch >= 'a' && ch <= 'z') w += 0.580;
    else if (ch === '-') w += 0.333;
    else if (ch === '(' || ch === ')') w += 0.333;
    else if (ch === '#') w += 0.556;
    else if (ch === ' ' || ch === ' ') w += 0.278;
    else w += 0.6;
  }
  return w;
}

/** Text column beside the 1in QR: 4in less padding, the QR, and the gap. */
const TAG_COLUMN_PT = 191;

/**
 * Fit to 96% of the column, not 100%.
 *
 * The widths above are estimates from a metrics table, and the printer's own
 * font may differ by a percent or two. Without headroom the longest cultivar
 * line lands within a fraction of a point of the edge, which is not a margin
 * so much as a coincidence. Costs half a point of type; buys certainty.
 */
const FIT_SAFETY = 0.96;

/**
 * Fit the bag number to the column left of the QR.
 *
 * A fixed 30pt worked for 26-SLIFT-1 and silently overlapped the QR on longer
 * ids -- the real worst case is 26-SKUNKCAND-999 at 16 characters, since
 * sku_prefix runs to 9. Computed rather than bucketed by length, because a
 * digit is 0.556em and a capital 0.722em, so two ids of equal length can need
 * different sizes.
 *
 * Never clips instead. A truncated bag number still looks like a valid bag
 * number -- 26-SLIFT-12 cut to 26-SLIFT-1 is a different sack -- so the text
 * must always shrink to fit, never be cut off.
 */
/** Width the cut box takes out of the number's row: "2ND" at 22pt, padding, border and gap. */
const CUT_BOX_PT = 64;

function bagnoFontPt(serial, reservePt = 0) {
  const em = emWidth('#' + (serial ?? ''));
  const fit = ((TAG_COLUMN_PT - reservePt) * FIT_SAFETY) / Math.max(em, 0.001);
  // Capped by the label's height, not its width -- '#999' would fit far larger
  // across, but the line has to sit above the meta and below the name.
  return Math.max(20, Math.min(44, Math.floor(fit * 2) / 2));
}

/**
 * Fit the cultivar name to the column beside the QR.
 *
 * Width-aware rather than bucketed by length: "Orange Pineapple Quik" and
 * "Strawberry Doughnuts" are a character apart but not the same width, since a
 * capital is 0.722em against 0.58em for lowercase.
 *
 * The SKU code used to share this line in brackets and is off the tag now
 * (Koa, 2026-09-02). Nothing in the barn needed it -- Find takes the bare
 * serial that is printed, and the scan page still shows the code -- and
 * dropping it hands the width back to the name, which is the thing actually
 * read across a barn.
 */
function cultivarFontPt(name) {
  const fit = (TAG_COLUMN_PT * FIT_SAFETY) / Math.max(emWidth(name || ''), 0.001);
  return Math.max(11, Math.min(25, Math.floor(fit * 2) / 2));
}

/**
 * Shrink any tag line the browser actually draws wider than its column.
 *
 * The sizes above come from a metrics table, and Chrome draws Arial Bold wider
 * than that table says: "Rainbow GMO Quik" was set at 19.5pt, came out 268px in
 * a 253px column, and printed as "Rainbow GMO Qui" (Koa, 2026-09-16). The
 * estimate stays as the starting size — it is right for most names and keeps a
 * page without scripts close — and this measures the real text and steps each
 * clipped line down half a point until nothing is cut. It runs as soon as the
 * labels are parsed, before the auto-print waits on the QR images, and again on
 * `beforeprint` for the toolbar's manual Print link.
 */
const TAG_FIT_SCRIPT = `<script>
  function fitTagText() {
    var els = document.querySelectorAll('.txt > .cultivar, .txt > .code, .txt > .bagrow > .bagno, .txt > .meta');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var pt = parseFloat(getComputedStyle(el).fontSize) * 0.75;
      while (el.scrollWidth > el.clientWidth + 0.5 && pt > 6) {
        pt -= 0.5;
        el.style.fontSize = pt + 'pt';
      }
    }
  }
  fitTagText();
  window.addEventListener('beforeprint', fitTagText);
</script>`;

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

/**
 * Every harvest tool on one page, in the order the material moves (Koa,
 * 2026-09-16: "a dashboard/ect that has all these accessible through it").
 *
 * Links only — no season data — so it needs no password; the pages that carry
 * numbers keep their own. Two tools are deliberately NOT links: a zone sign
 * (/z/) opens a cutting session and /fin closes the day. Opening those from a
 * menu would write real records, so they are shown as "scan only" with where
 * the printed code lives. A trailer decal (/t/) writes nothing until its
 * button is pressed, but it is still shown as a scan: it belongs to the
 * driver standing at the trailer, not to a menu.
 */
function hubBody(ui) {
  const es = ui.lang === 'es';
  const L = (en, sp) => (es ? sp : en);
  const q = `lang=${ui.lang}`;
  const card = (href, title, desc, badge = '', primary = false) =>
    `<a class="hubcard${primary ? ' primary' : ''}" href="${href}"><span class="ht">${title}</span><span class="hd">${desc}</span>${badge ? `<span class="hb">${badge}</span>` : ''}<span class="hub-arrow" aria-hidden="true">↗</span></a>`;
  const scan = (title, desc, code) =>
    `<div class="hubcard scan"><span class="ht">${title}</span><span class="hd">${desc}</span><span class="hd"><code>${code}</code></span><span class="hb">${L('SCAN ONLY', 'SOLO ESCANEAR')}</span></div>`;
  const lane = (n, color, title, sub, cards) => `
<section class="lane" id="stage-${n}" style="--lane:${color}">
  <div class="lane-head"><span class="lane-n">${n}</span><h2 class="lane-t">${title}</h2><span class="lane-s">${sub}</span></div>
  <div class="hubgrid">${cards.join('')}</div>
</section>`;
  const PW = L('PASSWORD', 'CONTRASEÑA');
  // One hue per stage, dark enough to read on the light ground. It marks the stage's
  // number, a stripe on each of its cards, and its tab, so a stage is found by colour.
  const LANE = ['#3f8a5c', '#b8841c', '#2d7f86', '#8a5aa0', '#4f6fa6'];

  return `
<style>
body:has(.harvest-hub) { background: #f6f5ef; color: #263f32; padding: 0; }
body:has(.harvest-hub) > .lang { display: none; }
body:has(.harvest-hub) > .testband { margin: 0; }
.harvest-hub { --ink: #263f32; --muted: #5d6d61; max-width: 1200px; margin: auto; padding: 0 40px 30px; font-family: 'Quicksand', system-ui, sans-serif; }
.harvest-hub * { box-sizing: border-box; }
.hub-brand { display: flex; align-items: center; gap: 16px; padding: 22px 0; border-bottom: 1px solid #d8ded2; }
.hub-brand img { width: 64px; height: 64px; object-fit: contain; }
.hub-brand strong { display: block; font: 700 15px 'Karla', sans-serif; letter-spacing: .12em; }
.hub-brand small { display: block; margin-top: 6px; color: var(--muted); font-size: 13px; }
.hub-language { margin-left: auto; color: var(--ink); border: 1px solid #c4cebe; border-radius: 30px; padding: 12px 18px; text-decoration: none; font: 700 14px 'Karla', sans-serif; }
.hub-intro { padding: 36px 0 26px; display: flex; justify-content: space-between; align-items: end; gap: 24px; }
.hub-eyebrow { color: #607451; font: 700 11px 'Karla', sans-serif; letter-spacing: .17em; text-transform: uppercase; margin: 0 0 12px; }
.harvest-hub h1 { font: 700 clamp(36px, 5vw, 58px)/1.04 'Karla', sans-serif; letter-spacing: -.045em; margin: 0 0 12px; }
.harvest-hub .sub { color: var(--muted); font-size: 15px; margin: 0; line-height: 1.6; }
.hub-season { flex: none; font: 700 12px 'Karla', sans-serif; padding: 10px 14px; border: 1px solid #c9d2c1; border-radius: 30px; margin-bottom: 4px; }
.hub-workbench { display: grid; grid-template-columns: 1.15fr 1fr; gap: 18px; margin-bottom: 30px; }
.hub-start { border-radius: 18px; padding: 27px; background: #2e4b3b; color: #fff; position: relative; }
.hub-start h2 { margin: 0 0 8px; color: #fff; font: 700 25px 'Karla',sans-serif; letter-spacing: -.02em; text-transform: none; }
.hub-start p { margin: 0 0 23px; color: #dfebdf; font-size: 14px; line-height: 1.6; }
.hub-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.hub-actions a { display: flex; align-items: center; justify-content: space-between; gap: 22px; min-height: 49px; padding: 13px 18px; border-radius: 8px; font: 700 15px 'Karla',sans-serif; background: #ebc665; color: #263f32; text-decoration: none; }
.hub-actions a + a { background: transparent; color: #fff; border: 1px solid #91a395; }
.hub-lookup { background: #ecefe4; border: 1px solid #dbe1d2; padding: 27px; border-radius: 18px; }
.harvest-hub .hub-lookup label { display: block; color: var(--ink); font: 700 23px 'Karla',sans-serif; margin-bottom: 8px; }
.hub-lookup p { font-size: 14px; color: var(--muted); margin: 0 0 20px; line-height: 1.6; }
.harvest-hub .hub-search { margin: 0; gap: 8px; }
.harvest-hub .hub-search input { min-width: 0; height: 50px; border: 1px solid #b7c3ad; border-radius: 8px; background: #fff; color: var(--ink); font: 16px system-ui,sans-serif; margin: 0; }
.harvest-hub .hub-search .btn { background: #2e4b3b; border-radius: 8px; font: 700 15px 'Karla',sans-serif; padding: 12px 20px; }
/* Practice sits above the real tools: it is where a new hire starts, and the
   one thing on this page that cannot touch a record. */
.hub-practice { display: flex; align-items: center; gap: 16px; margin: 0 0 22px; padding: 18px 20px;
  border: 2px solid #c6a252; background: #fdf6e3; border-radius: 14px; color: var(--ink); text-decoration: none; }
.hub-practice:hover { background: #f8eed6; }
.hub-practice .hp-mark { flex: none; display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%;
  background: #edc76b; color: #3d3116; font-size: 16px; }
.hub-practice .hp-text { min-width: 0; }
.hub-practice strong { display: block; font: 700 19px 'Karla', sans-serif; letter-spacing: -.015em; }
.hub-practice small { display: block; margin-top: 4px; color: #6b6248; font-size: 14px; line-height: 1.5; }
.hub-practice .hp-go { margin-left: auto; flex: none; color: #8a7433; font-size: 22px; }
@media(max-width: 480px) { .hub-practice .hp-go { display: none; } }
.hub-nav { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 0 26px; border-bottom: 1px solid #d8ded2; margin-bottom: 30px; }
.hub-nav a i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--lane); margin-right: 8px; vertical-align: 1px; }
.hub-nav a { color: #455b48; text-decoration: none; padding: 12px 16px; background: #eaede3; border-radius: 7px; font: 700 14px 'Karla',sans-serif; display: flex; align-items: center; min-height: 44px; }
.hub-nav a span { opacity: .65; margin-right: 10px; font-size: 11px; }
.harvest-hub .lane { border: 0; padding: 0; margin: 0 0 32px; scroll-margin-top: 20px; }
.harvest-hub .lane-head { gap: 11px; align-items: center; margin-bottom: 14px; }
.harvest-hub .lane-n { border-radius: 7px; width: 30px; height: 30px; background: var(--lane); color: #fff; font: 700 13px 'Karla',sans-serif; }
.harvest-hub .lane-t { margin: 0; color: var(--ink); font: 700 23px 'Karla',sans-serif; letter-spacing: -.025em; text-transform: none; }
.harvest-hub .lane-s { font-size: 13px; color: var(--muted); }
.harvest-hub .lane-s::before { content: '·'; margin-right: 8px; opacity: .6; }
.harvest-hub .hubgrid { grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px; }
.harvest-hub #stage-1 .hubgrid { grid-template-columns: repeat(4,minmax(0,1fr)); }
.harvest-hub .hubcard { min-height: 118px; position: relative; gap: 8px; padding: 18px 34px 18px 20px; background: #fff; border: 1px solid #d9dfd3; border-top: 4px solid var(--lane); border-radius: 12px; color: var(--ink); transition: background .15s, border-color .15s; }
.harvest-hub a.hubcard:hover { background: #eef3e8; border-color: #7d9778; border-top-color: var(--lane); }
.harvest-hub .hubcard .ht { font: 700 18px 'Karla',sans-serif; letter-spacing: -.015em; }
.harvest-hub .hubcard .hd { color: var(--muted); font-size: 13px; line-height: 1.6; }
.harvest-hub .hubcard .hb { margin-top: auto; background: #edf0e7; color: #4b5c45; font: 700 12px 'Karla',sans-serif; padding: 5px 9px; }
.harvest-hub .hubcard.scan { background: transparent; border-style: dashed; border-top-style: solid; }
.harvest-hub .hubcard.scan .hb { background: #eee8d8; color: #796026; }
.harvest-hub .hubcard code { font-size: 12px; color: #687a5d; }
.harvest-hub a.hubcard.primary { border-color: #9fb496; border-top-color: var(--lane); background: #e9efdf; }
.hub-arrow { position: absolute; right: 16px; top: 20px; color: #657b59; font: 20px system-ui,sans-serif; }
.hub-footer { display: flex; justify-content: space-between; gap: 20px; padding-top: 22px; border-top: 1px solid #d8ded2; color: var(--muted); font-size: 12px; line-height: 1.6; }
.harvest-hub :is(a, input, button):focus-visible { outline: 3px solid #9a6d16; outline-offset: 4px; }
.hub-language:hover, .hub-nav a:hover { background: #dce5d2; }
@media(max-width: 800px) {
 .harvest-hub { padding: 0 22px 24px; }
 .hub-workbench { grid-template-columns: 1fr; }
 .harvest-hub .hubgrid, .harvest-hub #stage-1 .hubgrid { grid-template-columns: repeat(2,minmax(0,1fr)); }
 .hub-intro { align-items: start; }
 .hub-season { display: none; }
}
@media(max-width: 480px) {
 .harvest-hub { padding: 0 16px 24px; }
 .hub-brand { gap: 10px; padding: 16px 0; }
 .hub-brand img { width: 46px; height: 46px; }
 .hub-brand strong { font-size: 13px; letter-spacing: .06em; }
 .hub-brand small { font-size: 11px; }
 .hub-language { padding: 12px; font-size: 12px; }
 .hub-intro { padding: 28px 0 22px; }
 .hub-start, .hub-lookup { padding: 22px; }
 .hub-actions a { flex: 1 1 auto; }
 .hub-nav { gap: 6px; flex-wrap: nowrap; overflow-x: auto; margin: 0 -16px 26px; padding: 0 16px 20px; scrollbar-width: none; }
 .hub-nav::-webkit-scrollbar { display: none; }
 .hub-nav a { flex: none; font-size: 13px; padding: 13px 12px; }
 .hub-nav a span { margin-right: 6px; }
 .harvest-hub .hubgrid, .harvest-hub #stage-1 .hubgrid { grid-template-columns: 1fr; }
 .harvest-hub .hubcard { min-height: 0; }
 .harvest-hub .lane-s { font-size: 12px; }
 .hub-footer { flex-direction: column; gap: 8px; }
}
</style>
<main class="harvest-hub">
<header class="hub-brand">
 <img src="${SACK_BRAND_LOGO}" alt="Rogue Origin" width="64" height="64">
 <div><strong>ROGUE ORIGIN</strong><small>${L('From field to flower', 'Del campo a la flor')}</small></div>
 <a class="hub-language" href="${escapeHtml(ui.toggle)}" lang="${es ? 'en' : 'es'}" data-lang-swap>${L('Español', 'English')}</a>
</header>
<div class="hub-intro"><div><p class="hub-eyebrow">${L('Rogue Family Farms · Harvest operations', 'Rogue Family Farms · Operaciones de cosecha')}</p>
<h1>${L('Harvest tools', 'Herramientas de cosecha')}</h1>
<p class="sub">${L('From the first cut to the last sack. Your next step starts here.', 'Del primer corte a la última bolsa. Tu siguiente paso empieza aquí.')}</p></div>
<span class="hub-season">${L('HARVEST', 'COSECHA')} ${getSeason()}</span></div>
<a class="hub-practice" href="${API}?action=practice&${q}">
 <span class="hp-mark" aria-hidden="true">▶</span>
 <span class="hp-text"><strong>${L('Practice mode', 'Modo práctica')}</strong>
 <small>${L('Walk through the whole harvest — crew, trailers, tags, bags. Nothing is saved and no real numbers are used.', 'Recorre toda la cosecha — cuadrilla, cargas, etiquetas, bolsas. No se guarda nada y no se usan números reales.')}</small></span>
 <span class="hp-go" aria-hidden="true">→</span>
</a>
<div class="hub-workbench">
 <section class="hub-start"><h2>${L('Keep the harvest moving.', 'Que la cosecha siga.')}</h2><p>${L('Bring a load in. Get the next bag tagged.', 'Recibe una carga. Etiqueta la siguiente bolsa.')}</p>
 <div class="hub-actions"><a href="${API}?action=sack_print&${q}">${L('Print sack tags', 'Imprimir etiquetas')} <span aria-hidden="true">↗</span></a><a href="/b?${q}">${L('Barn intake', 'Recibo de cargas')} <span aria-hidden="true">↗</span></a></div></section>
 <section class="hub-lookup"><label for="hub-query">${L('Find a sack', 'Buscar bolsa')}</label><p id="hub-query-help">${L('Enter the code or number printed on the tag.', 'Ingresa el código o número impreso en la etiqueta.')}</p>
 <form class="hub-search" method="GET" action="${API}">
  <input type="hidden" name="action" value="find"><input type="hidden" name="lang" value="${ui.lang}">
  <input id="hub-query" name="q" aria-describedby="hub-query-help" autocomplete="off" autocapitalize="off" autocorrect="off" required placeholder="${L('e.g. RAINGQ-C2-3 or 7', 'ej. RAINGQ-C2-3 o 7')}">
  <button class="btn" type="submit">${L('Find', 'Buscar')}</button>
 </form></section>
</div>
<nav class="hub-nav" aria-label="${L('Harvest stages', 'Etapas de cosecha')}">
${[L('Field', 'Campo'), L('Barn', 'Bodega'), L('Takedown', 'Bajada'), L('Bags', 'Bolsas'), L('Oversight', 'Supervisión')].map((name, i) => `<a href="#stage-${i + 1}" style="--lane:${LANE[i]}"><i aria-hidden="true"></i><span>0${i + 1}</span>${name}</a>`).join('')}
</nav>
${lane(1, LANE[0], L('Field', 'Campo'), L('cutting crews', 'cuadrillas de corte'), [
    scan(L('Zone sign', 'Letrero de zona'), L('Starts cutting a zone: cultivar and crew size.', 'Empieza a cortar una zona: cultivar y número de cortadores.'), '/z/Z8'),
    scan(L('End of day', 'Fin del día'), L('Closes the zone that is open.', 'Cierra la zona que esté abierta.'), '/fin'),
    card(`${API}?action=print_codes&${q}`, L('Print signs &amp; decals', 'Imprimir letreros y códigos'), L('Every zone sign, trailer decal and barn code as QR codes.', 'Todos los letreros, códigos de traila y de bodega en QR.')),
  ])}
${lane(2, LANE[1], L('Barn', 'Bodega'), L('trailers in, racks hung', 'trailas y racks'), [
    scan(L('Trailer decal', 'Código de traila'), L('The driver scans it at every drop-off: lot, bay, one tap.', 'El chofer lo escanea en cada descarga: lote, bahía, un toque.'), '/t/1 … /t/6'),
    card(`/b?${q}`, L('Barn intake (fallback)', 'Recibo de cargas (respaldo)'), L('When a trailer code is missing: log it here with zone, bins and bay.', 'Si falta el código de la traila: anótala aquí con zona, cajas y bahía.')),
    card(`${API}?action=crew&${q}`, L('Hourly crew report', 'Reporte por hora'), L('On the hour: who is working and how many sticks went up.', 'Cada hora: quién está trabajando y cuántos palos se colgaron.')),
  ])}
${lane(3, LANE[2], L('Takedown', 'Bajada'), L('bagging and tagging', 'embolsar y etiquetar'), [
    card(`${API}?action=sack_print&${q}`, L('Print sack tags', 'Imprimir etiquetas'), L('Pick the lot, set bay and storage, print a tag per bag. Notes and Finished are here.', 'Escoge el lote, bahía y lugar, imprime una etiqueta por bolsa. Notas y Terminado van aquí.'), '', true),
    card(`${API}?action=bajada&${q}`, L('Hourly takedown report', 'Bajada por hora'), L('On the hour: people by role and sticks taken down. Sacks come from the tags.', 'Cada hora: personas por puesto y palos bajados. Las bolsas salen de las etiquetas.')),
    card(`${API}?action=sack_label&examples=1&${q}`, L('Example tags', 'Etiquetas de ejemplo'), L('Test the printer. No real numbers, no Shopify.', 'Prueba la impresora. Sin números reales ni Shopify.')),
    card(`${API}?action=sack_label&sheet=avery5163&calibrate=1&${q}`, L('Avery calibration sheet', 'Hoja de calibración Avery'), L('Laser fallback: check the sheet lines up.', 'Respaldo láser: revisa que la hoja cuadre.')),
  ])}
${lane(4, LANE[3], L('Bags', 'Bolsas'), L('storage to opening', 'del almacén a abrirlas'), [
    card(`/salida?${q}`, L('Sack scan-out', 'Salida de bolsas'), L('Scan or type a sack as it goes to the line: off the Shopify count and onto its order.', 'Escanea o escribe la bolsa al salir a la línea: baja del conteo de Shopify y queda en su pedido.'), null, true),
    card(`${API}?action=find&${q}`, L('Find a sack', 'Buscar bolsa'), L('Look up any tag by code or number; recent tags listed.', 'Busca cualquier etiqueta por código o número; muestra las recientes.')),
    scan(L('Bag page', 'Página de la bolsa'), L('The QR on each tag: details, location, weights, notes, open the sack.', 'El QR de cada etiqueta: datos, ubicación, pesos, notas, abrir la bolsa.'), '/s/26-RAINGQ-7'),
  ])}
${lane(5, LANE[4], L('Oversight', 'Supervisión'), L('for the office', 'para la oficina'), [
    card(`${API}?action=pipeline&${q}`, L("What's coming", 'Lo que viene'), L('Cultivars drying in the barn with expected dates, and what is already in supersacks.', 'Variedades secando en el granero con fechas estimadas, y lo que ya está en supersacos.')),
    card(`${API}?action=harvest_dash`, L('Harvest dashboard', 'Tablero de cosecha'), L('Rack board, storage, cycle times.', 'Racks, almacén, tiempos de ciclo.'), PW),
    card(`${API}?action=board_page`, L('Lot board', 'Tablero de lotes'), L('Every lot from untested to supersacked.', 'Cada lote, de sin probar a embolsado.'), PW),
    card(`${API}?action=reconcile_page&season=${getSeason()}`, L('Reconcile with Shopify', 'Cuadrar con Shopify'), L('Unopened bags vs the Super Sack count, per cut.', 'Bolsas sin abrir contra el conteo de Super Sacks, por corte.'), L('DATA', 'DATOS')),
  ])}<footer class="hub-footer"><span>ROGUE FAMILY FARMS · ${L('Field to flower', 'Del campo a la flor')}</span><span>${L('Scan-only tools start from the printed QR code.', 'Las herramientas de escaneo se abren desde el código QR impreso.')}</span></footer></main>`;
}

function reconcileBody(ui) {
  const es = ui.lang === 'es';
  const L = (en, sp) => es ? sp : en;
  const strings = {
    loading: L('Checking inventory…', 'Revisando inventario…'),
    failed: L('Could not load the comparison. Try again.', 'No se pudo cargar la comparación. Inténtalo de nuevo.'),
    empty: L('No tagged bags for this season.', 'No hay bolsas etiquetadas esta temporada.'),
    matched: L('Matched', 'Cuadra'), review: L('Review', 'Revisar'), unknown: L('Unavailable', 'No disponible'),
    unavailable: L('Shopify could not be checked. Counts below are not a complete comparison.', 'No se pudo consultar Shopify. La comparación está incompleta.'),
    unmatched: L('Shopify variants without tagged bags', 'Variantes de Shopify sin bolsas etiquetadas'),
    unsynced: L('Opened bags awaiting inventory sync', 'Bolsas abiertas pendientes de sincronizar'),
    debtTitle: L('Inventory writes that never settled', 'Escrituras de inventario sin confirmar'),
    debtFailed: L('{n} can be retried', '{n} se pueden reintentar'),
    debtUnknown: L('{n} unknown — check Shopify by hand before retrying',
                   '{n} desconocidas — revisa Shopify a mano antes de reintentar'),
    debtWhy: L('These tags are part of any difference above.',
               'Estas etiquetas son parte de cualquier diferencia de arriba.'),
    debtMore: L('…and {n} more', '…y {n} más'),
  };
  return `<h1>${L('Do the counts match?', '¿Cuadran las cantidades?')}</h1>
<p class="sub">${L('Unopened tagged bags compared with Shopify Super Sack inventory, per cut.', 'Bolsas etiquetadas sin abrir contra el inventario Super Sack de Shopify, por corte.')}</p>
<form id="compareForm"><label for="compareSeason">${L('Season', 'Temporada')}</label><input id="compareSeason" type="number" min="2020" max="2100" value="${getSeason()}" required><button type="submit" class="btn">${L('Refresh comparison', 'Actualizar comparación')}</button></form>
<p id="compareStatus" role="status" aria-live="polite"></p>
<div class="reconcile-table"><table><thead><tr>${[L('Cultivar / cut', 'Cultivar / corte'), L('Unopened bags', 'Bolsas sin abrir'), 'Shopify', L('Difference', 'Diferencia'), L('Status', 'Estado')].map(x => `<th scope="col">${x}</th>`).join('')}</tr></thead><tbody id="compareRows"></tbody></table></div>
<div id="inventoryDebt" hidden></div>
<div id="compareExtra"></div><p class="note"><span class="hint">${L('Read-only. Positive difference means more tagged bags than Shopify units. Check the physical count before making adjustments.', 'Solo lectura. Una diferencia positiva indica más bolsas que unidades en Shopify. Revisa el conteo físico antes de ajustar.')}</span></p>
<script>
(function(){
 function renderDebt(s){
   var box=document.getElementById('inventoryDebt');
   if(!box||!s||!s.show){if(box){box.hidden=true;}return;}
   // Unknown first and in red: that is the one nobody may retry blindly,
   // because the call may have landed and replaying it doubles the count.
   var bits=[];
   if(s.unknown)bits.push('<div class="debt-row bad">'+T.debtUnknown.replace('{n}',s.unknown)+'</div>');
   if(s.failed)bits.push('<div class="debt-row">'+T.debtFailed.replace('{n}',s.failed)+'</div>');
   var ids=s.items.map(function(i){return '<code>'+i.sack_id+'</code>';}).join(' ');
   if(s.total>s.items.length)ids+=' '+T.debtMore.replace('{n}',s.total-s.items.length);
   box.innerHTML='<div class="debt"><strong>'+T.debtTitle+' — '+s.total+'</strong>'+bits.join('')+
     '<div class="debt-ids">'+ids+'</div><div class="debt-why">'+T.debtWhy+'</div></div>';
   box.hidden=false;
 }
 var T=${JSON.stringify(strings)}, form=document.getElementById('compareForm'), status=document.getElementById('compareStatus');
 var rows=document.getElementById('compareRows'), extra=document.getElementById('compareExtra');
 async function load(){
  if(!form.reportValidity())return;
  var button=form.querySelector('button');button.disabled=true;status.textContent=T.loading;rows.replaceChildren();extra.replaceChildren();
  try{
   var r=await fetch('${API}?action=reconcile&season='+encodeURIComponent(document.getElementById('compareSeason').value),{cache:'no-store'});
   if(!r.ok)throw new Error('load');var d=await r.json();if(!d.success||!Array.isArray(d.lines))throw new Error('data');
   status.textContent=d.variants_error?T.unavailable:(!d.lines.length?T.empty:new Date(d.generated_at).toLocaleString('${es ? 'es-US' : 'en-US'}',{timeZone:'America/Los_Angeles'})+' Pacific');
   renderDebt(d.inventory_debts);
   var pending=0;
   d.lines.forEach(function(l){
    var tr=document.createElement('tr'), unavailable=!!d.variants_error||l.shopify_on_hand===null;
    [l.cultivar+' / '+l.cut,l.unopened,unavailable?'—':l.shopify_on_hand,unavailable?'—':(l.drift>0?'+':'')+l.drift,unavailable?T.unknown:l.drift===0?T.matched:T.review].forEach(function(value){var td=document.createElement('td');td.textContent=value;tr.appendChild(td)});
    rows.appendChild(tr);pending+=Number(l.opened_but_not_counted)||0;
   });
   if(pending){var p=document.createElement('p');p.className='notice';p.textContent=T.unsynced+': '+pending;extra.appendChild(p)}
   if(Array.isArray(d.unmatched_variants)&&d.unmatched_variants.length){var h=document.createElement('h2');h.textContent=T.unmatched;extra.appendChild(h);d.unmatched_variants.forEach(function(v){var p=document.createElement('p');p.textContent=v.title+' · '+v.on_hand;extra.appendChild(p)})}
  }catch(_){status.textContent=T.failed}finally{button.disabled=false}
 }
 form.addEventListener('submit',function(e){e.preventDefault();load()});load();
})();
</script>`;
}

function sackFindBody(ui, { recent, missing, typed, ambiguous }) {
  const list = recent.length
    ? recent.map(r => `<a class="btn alt findrow" href="/s/${encodeURIComponent(r.sack_id)}?lang=${ui.lang}">
         <strong>${escapeHtml(r.cultivar || '')} #${escapeHtml(String(r.serial ?? String(r.sack_id || '').split('-').pop()))} · ${ui.t('cut', { n: r.cut_number ?? '?' })}</strong>
         <span class="hint">${escapeHtml(r.sack_id)} · ${escapeHtml(r.zone)}</span>
       </a>`).join('')
    : '';

  return `
<h1>${ui.t('findSack')}</h1>
${missing ? `<p class="note">⚠️ ${ui.t('findNotFound', { id: escapeHtml(missing) })}</p>` : ''}
${ambiguous !== undefined && !missing ? `<p class="note">⚠️ ${ui.t('findAmbiguous', { n: ambiguous })}</p>` : ''}
<p class="note">${ui.t('findHelp')}</p>
<form method="GET" action="/api/harvest" onsubmit="this.querySelector('button[type=submit]').disabled=true">
  <input type="hidden" name="action" value="find">
  <input type="hidden" name="lang" value="${ui.lang}">
  <label for="q">${ui.t('findSack')}</label>
  <input id="q" name="q" autocomplete="off" autocapitalize="off" autocorrect="off"
         placeholder="${ui.t('findPlaceholder')}"
         value="${typed ? escapeHtml(String(typed)) : ''}" autofocus required>
  <button class="btn" type="submit">${ui.t('findGo')}</button>
</form>
<p class="note"><span class="hint">${ui.t('findUnreadable')}</span></p>
${list ? `<h2>${ui.t('findRecent')}</h2><div class="cvgrid">${list}</div>` : ''}
<div class="footer"><a href="${API}?action=sack_print">${ui.t('printTags')} →</a> · <a href="${API}?action=hub&lang=${ui.lang}">${ui.lang === 'es' ? 'Todas las herramientas' : 'All harvest tools'}</a></div>
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
  const { sack, notes, plantDate, plantDateApprox, acres, plants, growDays, lotSacks, areaBasis, hangBays = [] } = view;
  const opened = !!sack.opened_at;
  const voided = !!sack.voided_at;
  const DASH = '—';
  const fmtDate = iso => escapeHtml(formatTagDate(ui.lang, iso));

  // Whole days between two timestamps by date part, floored: a sack cut this
  // morning is "today", not "1 day ago". Null in, null out — never a guess.
  const daysBetween = (a, b) => {
    if (!a || !b) return null;
    const da = new Date(String(a).substring(0, 10) + 'T00:00:00Z');
    const db = new Date(String(b).substring(0, 10) + 'T00:00:00Z');
    if (isNaN(da) || isNaN(db)) return null;
    return Math.max(0, Math.floor((db - da) / 86400000));
  };
  const todayIso = pacificToday();
  const sinceCut = daysBetween(sack.harvest_date, todayIso);
  const rackDays = daysBetween(sack.harvest_date, sack.printed_at);        // cut → bagged
  const sackDays = daysBetween(sack.printed_at, sack.opened_at || todayIso); // bagged → opened / today
  const dShort = n => (n === null ? DASH : ui.t('daysShort', { n }));

  // ── Header: cultivar, serial, and one state pill ──
  const state = voided ? ['bad', ui.t('stateVoided')]
    : opened ? ['ok', ui.t('stateOpened')]
    : ['neutral', ui.t('stateUnopened')];
  const serial = sack.serial ?? String(sack.sack_id || '').split('-').pop();
  const head = `
<div class="sd-head">
  <div class="sd-eyebrow">${ui.lang === 'es' ? 'Registro de cosecha' : 'Harvest record'}</div>
  <div class="sd-state"><span class="badge ${state[0]}">${state[1]}</span></div>
  <h1>${escapeHtml(sack.cultivar || ui.t('sack'))}${sack.cultivar_code ? ` <span class="code">(${escapeHtml(sack.cultivar_code)})</span>` : ''}</h1>
  <p class="serial">#${escapeHtml(String(serial))}</p>
  <p class="fullid">${escapeHtml(sack.sack_id)}</p>
</div>`;

  // ── Three tiles: the answers someone holding the sack wants first ──
  const tiles = `
<div class="tiles">
  <div class="tile"><span class="tl">${ui.t('zone')}</span><strong class="tv">${escapeHtml(sack.zone || DASH)}</strong><span class="ts">${sack.cut_number != null ? ui.t('cut', { n: sack.cut_number }) : DASH}</span></div>
  <div class="tile"><span class="tl">${ui.t('kSinceCut')}</span><strong class="tv">${dShort(sinceCut)}</strong><span class="ts">${sack.harvest_date ? fmtDate(sack.harvest_date) : DASH}</span></div>
  <div class="tile"><span class="tl">${ui.t('kInLot')}</span><strong class="tv">${lotSacks != null ? Number(lotSacks).toLocaleString('en-US') : DASH}</strong><span class="ts">${lotSacks === 1 ? ui.t('kSack') : ui.t('kSacks')}</span></div>
</div>`;

  // ── Location: where it dried, where it is now ──
  // Its own panel at tile size. The drying bay already rode the journey as a
  // hint, and Koa — holding the page — could not tell it was there (2026-09-10).
  const driedBarn = barnForBay(sack.bay);
  const otherHang = hangBays.filter(b => b !== sack.bay);
  // The lot's other bays only when they add something; a lot hung in the one
  // bay this sack came out of says nothing new.
  const driedSub = otherHang.length
    ? ui.t(hangBays.length === 1 ? 'lotHungInOne' : 'lotHungIn', { list: hangBays.join(', ') })
    : (driedBarn ? ui.t(driedBarn === 'bottom' ? 'bottomBarn' : 'topBarn') : ui.t('noBaySet'));
  const storedWhere = storageLabel(ui, sack.storage);
  const storedSub = storedWhere
    ? (sack.stored_at ? ui.t('storedSince', { d: fmtDate(String(sack.stored_at).slice(0, 10)) }) : '')
    : ui.t('storageNone');
  const canMove = !opened && !voided;
  const location = `
<section class="sd-panel sd-location" aria-labelledby="sack-location">
<h2 id="sack-location">${ui.t('secLocation')}</h2>
<div class="tiles loc">
  <div class="tile"><span class="tl">${ui.t('locDried')}</span><strong class="tv">${sack.bay ? escapeHtml(ui.t('bayN', { n: sack.bay })) : DASH}</strong><span class="ts">${driedSub}</span></div>
  <div class="tile"><span class="tl">${ui.t('locStored')}</span><strong class="tv">${storedWhere ? escapeHtml(storedWhere) : DASH}</strong><span class="ts">${storedSub}</span></div>
</div>
${canMove ? `<details class="batch">
  <summary>${ui.t('storeChange')}</summary>
  <form method="POST" action="/api/harvest?action=sack_store&lang=${ui.lang}" onsubmit="this.querySelector('button[type=submit]').disabled=true">
    <input type="hidden" name="sack_id" value="${escapeHtml(sack.sack_id)}">
    <select name="storage" aria-label="${ui.t('locStored')}">${storageOptions(ui, sack.storage)}</select>
    <button class="btn" type="submit">${ui.t('storeSave')}</button>
  </form>
</details>` : ''}
</section>`;

  // ── Weights ──
  // No weight entry here on purpose. Nobody weighs a bag's output on its own —
  // the floor reports a daily total per strain and each bag's share is
  // allocated from it, so this screen shows the result instead of asking.
  // The bar is drawn only when BOTH figures exist; a missing figure is an
  // explicit empty state, never a zero-length segment.
  const num = v => ((v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v));
  const tops = num(sack.tops_lbs), smalls = num(sack.smalls_lbs);
  // Every part the sack broke into. A part with no figure is left out entirely
  // rather than drawn as a zero-length segment — absent must read as absent.
  // Order is the order they matter in, and waste is last because it is the
  // residual the other four leave behind.
  const parts = [
    { cls: 'tops', label: ui.t('wTops'), v: tops },
    { cls: 'smalls', label: ui.t('wSmalls'), v: smalls },
    { cls: 'biomass', label: ui.t('wBiomass'), v: num(sack.biomass_lbs) },
    { cls: 'trim', label: ui.t('wTrim'), v: num(sack.trim_lbs) },
    { cls: 'waste', label: ui.t('wWaste'), v: num(sack.waste_lbs), derived: true },
  ].filter(p => p.v !== null);
  const hasWeights = parts.length > 0;
  // What went into THIS bag: its weighed fill, else a full sack for its crop
  // year (35 lb from 2026, 37 before). Never null.
  const fill = sackLbs(sack);
  const measured = sack.weights_source === 'measured';
  const srcBadge = `<span class="badge ${measured ? 'ok' : 'warn'}">${measured ? ui.t('srcMeasuredBadge') : ui.t('srcAllocatedBadge')}</span>`;
  const srcLine = measured ? ui.t('weightsMeasured') : ui.t('weightsAllocated');
  // Date only, in the page's language. Every other date on the page reads
  // "Aug 17, 2026"; a raw "2026-09-01 21:02:58 UTC" beside them is machine
  // output leaking into a page a crew member reads at arm's length, and the
  // seconds a sack was opened have never mattered to anyone.
  const openedLine = opened
    ? ui.t('openedAt', { t: escapeHtml(formatTagDate(ui.lang, String(sack.opened_at).slice(0, 10))) })
    : '';
  const lb = n => n.toFixed(1).replace(/\.0$/, '');

  let weights;
  if (voided && !opened) {
    // A voided number was retired without a sack behind it, so there is
    // nothing to open. The backend refuses it anyway; showing the button
    // just invites someone to press it and read an error as a fault.
    weights = `<div class="card">
  <p class="note" style="margin:0">${ui.t('voidedNoOpen')}</p>
</div>`;
  } else if (!opened) {
    // The bag's weight, and a way to correct it until it is opened — after that
    // the day's output has been split by it, so it is fixed.
    const full = fullSackLbs(sack.season);
    const weighed = sack.fill_lbs !== null && sack.fill_lbs !== undefined;
    weights = `<div class="card">
  <p class="note" style="margin:0 0 6px"><strong>${ui.t('bagWeight')}:</strong> ${weighed
    ? ui.t('bagWeighed', { n: lb(Number(sack.fill_lbs)) }) : ui.t('bagFull', { n: full })}</p>
  <details class="batch" style="margin:0 0 12px">
    <summary>${ui.t('fillChange')}</summary>
    <form method="POST" action="/api/harvest?action=sack_fill&lang=${ui.lang}" onsubmit="this.querySelector('button[type=submit]').disabled=true">
      <input type="hidden" name="sack_id" value="${escapeHtml(sack.sack_id)}">
      <div class="fillrow"><input name="fill_lbs" type="number" inputmode="decimal" min="1" max="60" step="0.1"
        value="${weighed ? lb(Number(sack.fill_lbs)) : ''}" placeholder="${full}" aria-label="${escapeHtml(ui.t('bagWeight'))}"><span>lb</span></div>
      <p class="hint" style="margin:0 0 8px">${ui.t('fillChangeHint', { n: full })}</p>
      <button class="btn" type="submit">${ui.t('fillSave')}</button>
    </form>
  </details>
  <p class="note" style="margin:0 0 12px">${ui.t('notOpened')}</p>
  <form method="POST" action="/api/harvest?action=sack_open&lang=${ui.lang}" onsubmit="this.querySelector('button[type=submit]').disabled=true">
    <input type="hidden" name="sack_id" value="${escapeHtml(sack.sack_id)}">
    <button class="bigbtn" type="submit">${ui.t('openSack')}</button>
  </form>
</div>`;
  } else if (hasWeights) {
    const total = parts.reduce((t, p) => t + p.v, 0);
    // The headline stays TOPS + SMALLS as a share of the sack. With all five
    // parts present the total is 37 by construction — waste is defined as the
    // remainder — so "% of the sack accounted for" would always read 100% and
    // say nothing. How much of the sack became flower is the real question.
    const flower = (tops || 0) + (smalls || 0);
    // The track is the full sack (37 lb). If the shares ever exceed it, the
    // scale stretches to the total and a tick marks 37 — an overrun is real
    // information about the day's split, not something to clip.
    const scaleMax = fill ? Math.max(fill, total) : total;
    const pct = n => (scaleMax > 0 ? (n / scaleMax) * 100 : 0);
    const share = v => (total > 0 ? Math.round((v / total) * 100) : null);
    const recovered = (fill && flower > 0) ? Math.round((flower / fill) * 100) : null;
    const overTick = (fill && total > fill) ? `<i class="tick" style="left:${pct(fill).toFixed(2)}%"></i>` : '';
    const scaleEnd = fill
      ? `${lb(scaleMax)} lb${total <= fill ? ` · ${ui.t('wFull')}` : ''}`
      : `${lb(total)} lb`;
    const wasteShown = parts.some(p => p.derived);
    weights = `<div class="card">
  <div class="wtop"><strong class="tv">${lb(tops !== null && smalls !== null ? flower : total)} lb</strong><span class="hint">${tops !== null && smalls !== null ? `${ui.t('wTops')} + ${ui.t('wSmalls')}` : ui.t('wTotal')}</span>${srcBadge}</div>
  <div class="wbar" role="img" aria-label="${parts.map(p => `${p.label} ${lb(p.v)} lb`).join(' · ')}">
    ${parts.map(p => `<div class="seg ${p.cls}" style="flex-basis:${pct(p.v).toFixed(2)}%"></div>`).join('')}${overTick}
  </div>
  <div class="wscale"><span>0</span><span>${scaleEnd}</span></div>
  <div class="legend">
    ${parts.map(p => {
      const sh = share(p.v);
      return `<span class="weight-row"><span><i class="sw ${p.cls}"></i>${p.label}</span><strong>${lb(p.v)} lb</strong><span class="weight-share">${sh !== null ? `${sh}%` : '—'}</span></span>`;
    }).join('')}
  </div>
  <p class="hint" style="margin:12px 0 0">${recovered !== null ? `${ui.t('wRecovered', { pct: recovered, fill })}<br>` : ''}${wasteShown ? `${ui.t('wWasteNote', { fill })}<br>` : ''}${srcLine} · ${openedLine}</p>
</div>`;
  } else {
    weights = `<div class="card">
  <p class="empty">${DASH}</p>
  <p class="note" style="margin:0">${ui.t('weightsPending')}</p>
  <p class="hint" style="margin:8px 0 0">${openedLine}</p>
</div>`;
  }

  // ── Journey: planted → cut → bagged → opened / today ──
  // Vertical, so the day counts sit on the spans between nodes at full size
  // instead of being squeezed proportionally (112 days growing next to 10 on
  // the rack would leave the barn part a sliver). A node with no date is drawn
  // hollow and labelled "—", not dropped.
  let journey;
  if (!sack.harvest_date) {
    journey = `<p class="note"><span class="hint">${ui.t('tlNoDates')}</span></p>`;
  } else {
    const node = (cls, label, when) =>
      `<li class="node"><i class="dot ${cls}"></i><span><strong>${label}</strong><span class="when">${when}</span></span></li>`;
    const span = text => `<li class="span"><i class="line"></i><span class="dur">${text}</span></li>`;
    const dur = (key, n) => (n === null ? DASH : ui.t(key, { d: `<strong>${ui.t('daysShort', { n })}</strong>` }));
    const rows = [];
    if (plantDate) {
      rows.push(node('', ui.t('tlPlanted'),
        fmtDate(plantDate) + (plantDateApprox ? ` <span class="hint">(${ui.t('approx')})</span>` : '')));
      rows.push(span(dur('tlGrow', growDays)));
    } else {
      rows.push(node('none', ui.t('tlPlanted'), `<span class="hint">${ui.t('tlNoPlant')}</span>`));
      rows.push(span(DASH));
    }
    rows.push(node('', ui.t('tlCut'), fmtDate(sack.harvest_date)));
    if (sack.printed_at) {
      // The drying leg already carried both dry dates — Cut is the day it was
      // hung (same day, Koa 2026-09-03) and Bagged is the day it came down.
      // The bay joins them here rather than in its own tile, so where it dried
      // and how long it dried read as one fact instead of two.
      rows.push(span(dur('tlRack', rackDays)
        + (sack.bay ? ` <span class="hint">· ${ui.t('tlDriedIn', { n: sack.bay })}</span>` : '')));
      rows.push(node('', ui.t('tlBagged'), fmtDate(sack.printed_at)));
      rows.push(span(dur('tlSack', sackDays)));
    } else {
      rows.push(span(DASH));
      rows.push(node('none', ui.t('tlBagged'), DASH));
      rows.push(span(DASH));
    }
    rows.push(opened
      ? node('', ui.t('tlOpened'), fmtDate(sack.opened_at))
      : node('open', ui.t('tlToday'), fmtDate(todayIso)));
    journey = `<ol class="journey">${rows.join('')}</ol>`;
  }

  // The basis rides with the number. It is a SHARE of a zone, so "6 of 37 rows"
  // is what makes it checkable against the tape and the zone page — and what
  // makes an unrecorded cultivar read as unknown instead of whole-zone.
  const basisNote = areaBasis
    ? `<div class="lotmeta"><span class="hint">${escapeHtml(areaBasis)}</span></div>` : '';
  const areaRow = acres
    ? `<div class="kv"><span>${ui.t('area')}</span><strong>${plants
        ? ui.t('areaVal', { ac: acres.toFixed(3), plants: plants.toLocaleString('en-US') })
        : `${acres.toFixed(3)} ac`}</strong></div>${basisNote}`
    : '';

  const noteList = notes.length
    ? notes.map(n => `<div class="notecard">${escapeHtml(n.note)}
        <span class="hint">${escapeHtml(String(n.created_at).substring(0, 10))}${n.edited_at ? ` · ${ui.t('noteEdited', { d: escapeHtml(String(n.edited_at).substring(0, 10)) })}` : ''}</span>
        ${n.id ? `<details class="noteedit">
          <summary>${ui.t('editNote')}</summary>
          <form method="POST" action="/api/harvest?action=sack_note_edit&lang=${ui.lang}" onsubmit="this.querySelector('button[type=submit]').disabled=true">
            <input type="hidden" name="sack_id" value="${escapeHtml(sack.sack_id)}">
            <input type="hidden" name="note_id" value="${Number(n.id)}">
            <textarea name="note" maxlength="500" rows="2" required>${escapeHtml(n.note)}</textarea>
            <button class="btn" type="submit">${ui.t('saveNote')}</button>
          </form>
        </details>` : ''}</div>`).join('')
    : `<p class="note"><span class="hint">${ui.t('noNotes')}</span></p>`;

  return `<div class="sd">
<div class="sd-brand"><img class="sd-logo" src="${SACK_BRAND_LOGO}" alt="Rogue Origin" width="76" height="76"><span class="sd-brand-caption">${ui.lang === 'es' ? 'Del campo a la flor' : 'From field to flower'}</span><span class="sd-language"><a href="${escapeHtml(ui.toggle)}" data-lang-swap>${ui.t('langOther')}</a></span></div>
${flash ? `<div class="flash">✅ ${escapeHtml(flash)}</div>` : ''}
${head}
${notes.length ? `<div class="flash" style="margin-top:18px"><strong>${ui.t('secNotes')}</strong><br>${notes.map(n => escapeHtml(n.note)).join('<br>')}</div>` : ''}
${tiles}
${location}

<div class="sd-columns">
<section class="sd-panel" aria-labelledby="sack-weights">
<h2 id="sack-weights">${ui.t('secWeights')}</h2>
${weights}
</section>

<section class="sd-panel" aria-labelledby="sack-origin">
<h2 id="sack-origin">${ui.t('secOrigin')}</h2>
${journey}
${areaRow}
</section>
</div>

<section class="sd-panel sd-notes" aria-labelledby="sack-notes">
<h2 id="sack-notes">${ui.t('secNotes')}</h2>
${noteList}
<details class="batch" id="addNoteBox">
  <summary>${ui.t('addNote')}</summary>
  <form method="POST" action="/api/harvest?action=sack_note&lang=${ui.lang}" onsubmit="this.querySelector('button[type=submit]').disabled=true">
    <input type="hidden" name="sack_id" value="${escapeHtml(sack.sack_id)}">
    <input name="note" maxlength="500" autocomplete="off" placeholder="${ui.t('notePlaceholder')}" required>
    <button class="btn" type="submit">${ui.t('saveNote')}</button>
  </form>
</details>

</section>
<div class="footer"><a href="/api/harvest?action=hub&lang=${ui.lang}">${ui.lang === 'es' ? 'Todas las herramientas' : 'All harvest tools'}</a> · <a href="/api/harvest?action=sack_label&lang=${ui.lang}&id=${encodeURIComponent(sack.sack_id)}">${ui.t('reprintTag')}</a></div>
</div>`;
}

const SACK_OUT_DEPS = {
  isTestMode, getSeason, normalizeSackId, demoKey, pacificToday, pacificDayRange,
  takeSackOut: (...a) => takeSackOut(...a), adjustSupersackCount,
};
