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
 * - GET  ?action=sack_print                              - Lot picker for takedown (HTML)
 * - POST ?action=sack_print_run  (session_id,cultivar,qty) - Allocate + print labels (HTML)
 * - GET  ?action=sack_label&id=26-0847                   - Reprint one label, SAME serial (HTML)
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
import { sendTelegramMessage } from '../lib/telegram.js';

const DEBOUNCE_MS = 5 * 60 * 1000;       // re-scanning the same active zone within this window is a no-op
const CUT_RESUME_GRACE_HOURS = 8;        // re-entering a zone within this many hours of its last close = same cut
const HEADCOUNT_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1); // 1-12, plus a 13+ link

const MAX_PRINT_QTY = 40;                // sanity cap on one print run
const LOT_PICKER_DAYS = 45;              // how far back the takedown lot picker looks
const PUBLIC_BASE = 'https://rogue-origin-api.roguefamilyfarms.workers.dev';

const HTML_ACTIONS = new Set([
  'enter', 'headcount', 'barn_intake', 'barn_log',
  'sack_print', 'sack_print_run', 'sack_label', 'sack_weigh',
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
        case 'sack_print_run':
          return await handleSackPrintRun(db, env, ctx, body);
        case 'sack_label':
          return await handleSackLabel(db, env, params);
        case 'sack_weigh':
          return await handleSackWeigh(db, env, ctx, body);
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
    default:
      throw createError('NOT_FOUND', `Unknown harvest action: ${action}`);
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

  // Idempotency guard: a phone refresh/back-button/link-preview re-hitting
  // the same zone's URL moments later shouldn't open a second session.
  if (active && active.zone === zone && (now - parseSqliteUtc(active.occurred_at)) < DEBOUNCE_MS) {
    return renderPage('Already entered', alreadyEnteredBody(active));
  }

  if (active) {
    await execute(db, `UPDATE harvest_scan_log SET closed_at = datetime('now') WHERE id = ?`, [active.id]);
  }

  const cutNumber = await computeCutNumber(db, zone, season, isTest, params.test_cut);

  const result = await execute(db, `
    INSERT INTO harvest_scan_log (event_type, zone, season, cut_number, is_test)
    VALUES ('enter', ?, ?, ?, ?)
  `, [zone, season, cutNumber, isTest]);
  const sessionId = result.lastRowId;

  const prevNote = active ? `Previous zone *${active.zone}* auto-closed.` : 'No prior zone was open.';
  ctx.waitUntil(sendTelegramMessage(env, {
    chatId: env.TELEGRAM_TEST_CHAT_ID,
    text: `🌿 Entered *${zone}* — Cut ${cutNumber}\n${prevNote}`,
  }).catch(e => console.error('[harvest][telegram]', e)));

  return renderPage(`Entered ${zone}`, enterBody({ zone, cutNumber, sessionId, prevZone: active ? active.zone : null }));
}

async function getActiveSession(db, isTest) {
  return queryOne(db, `
    SELECT * FROM harvest_scan_log
    WHERE event_type = 'enter' AND closed_at IS NULL AND is_test = ?
    ORDER BY occurred_at DESC, id DESC LIMIT 1
  `, [isTest]);
}

async function getLastClosedSession(db, zone, season, isTest) {
  return queryOne(db, `
    SELECT * FROM harvest_scan_log
    WHERE event_type = 'enter' AND zone = ? AND season = ? AND closed_at IS NOT NULL AND is_test = ?
    ORDER BY closed_at DESC, id DESC LIMIT 1
  `, [zone, season, isTest]);
}

// Same-day grace window: a zone re-entered within CUT_RESUME_GRACE_HOURS of
// its last close is a resumption of the same cut, not a new one — fixes the
// gap where a crew finishes part of a zone, works elsewhere, then returns
// same-shift (see 2025 log: "Finished Z8, partial Z7, partial Z5").
async function computeCutNumber(db, zone, season, isTest, testCutParam) {
  const forced = parseInt(testCutParam, 10);
  if (Number.isInteger(forced) && forced >= 1 && forced <= 9) return forced;

  const last = await getLastClosedSession(db, zone, season, isTest);
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

// Candidate lots for takedown: zone-entry sessions from the last ~45 days,
// newest first, with how long the material has been drying.
async function getRecentLots(db, isTest) {
  return query(db, `
    SELECT id, zone, cut_number, occurred_at,
           CAST(julianday('now') - julianday(occurred_at) AS INTEGER) AS days_since_cut
    FROM harvest_scan_log
    WHERE event_type = 'enter' AND is_test = ?
      AND julianday('now') - julianday(occurred_at) <= ?
    ORDER BY occurred_at DESC
  `, [isTest, LOT_PICKER_DAYS]);
}

async function handleSackPrintRun(db, env, ctx, body) {
  const sessionId = parseInt(body.session_id, 10);
  const qty = parseInt(body.qty, 10);
  const cultivar = (body.cultivar || '').trim().substring(0, 60);

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    throw createError('VALIDATION_ERROR', 'Pick which lot is coming down before printing.');
  }
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_PRINT_QTY) {
    throw createError('VALIDATION_ERROR', `Quantity must be between 1 and ${MAX_PRINT_QTY}.`);
  }
  if (!cultivar) {
    throw createError('VALIDATION_ERROR', 'Cultivar is required — it prints on the tag.');
  }

  const lot = await queryOne(db, `SELECT * FROM harvest_scan_log WHERE id = ? AND event_type = 'enter'`, [sessionId]);
  if (!lot) throw createError('NOT_FOUND', `No harvest lot found for session ${sessionId}.`);

  const isTest = isTestMode(env) ? 1 : 0;
  const season = getSeason();
  const harvestDate = String(lot.occurred_at).substring(0, 10);

  // Serial allocation is MAX+1 per season. The UNIQUE(season, serial) index
  // means a concurrent print run fails loudly rather than silently issuing two
  // physical tags with the same number.
  const row = await queryOne(db, `SELECT COALESCE(MAX(serial), 0) AS max_serial FROM harvest_sacks WHERE season = ?`, [season]);
  const startSerial = (row?.max_serial || 0) + 1;

  const sacks = [];
  const statements = [];
  for (let i = 0; i < qty; i++) {
    const serial = startSerial + i;
    const sackId = formatSackId(season, serial);
    sacks.push({ sack_id: sackId, zone: lot.zone, cultivar, cut_number: lot.cut_number, harvest_date: harvestDate });
    statements.push({
      sql: `INSERT INTO harvest_sacks
              (sack_id, season, serial, zone, cultivar, cut_number, harvest_date, zone_session_id, is_test)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [sackId, season, serial, lot.zone, cultivar, lot.cut_number, harvestDate, lot.id, isTest],
    });
  }
  await transaction(db, statements);

  ctx.waitUntil(sendTelegramMessage(env, {
    chatId: env.TELEGRAM_TEST_CHAT_ID,
    text: `🏷️ Printed ${qty} sack tag${qty === 1 ? '' : 's'} — *${cultivar}* ${lot.zone} cut ${lot.cut_number}\n${sacks[0].sack_id} → ${sacks[sacks.length - 1].sack_id}`,
  }).catch(e => console.error('[harvest][telegram]', e)));

  return renderLabelSheet(sacks, { sessionId, cultivar });
}

// Reprint path — looks the sack up and reuses its EXISTING serial. Never
// allocates a new one: two physical tags carrying different IDs for the same
// sack is unrecoverable once they're in the barn.
async function handleSackLabel(db, env, params) {
  const sackId = String(params.id || '').trim();
  const sack = await queryOne(db, `SELECT * FROM harvest_sacks WHERE sack_id = ?`, [sackId]);
  if (!sack) throw createError('NOT_FOUND', `No sack found with ID "${sackId}".`);
  // ?preview=1 renders without firing the print dialog — for eyeballing a
  // label (or checking a long cultivar name fits) before committing paper.
  return renderLabelSheet([sack], null, { autoPrint: params.preview !== '1' });
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

  sql += ' ORDER BY serial DESC LIMIT ?';
  binds.push(limit);

  const rows = await query(db, sql, binds);
  const totals = await queryOne(db, `
    SELECT COUNT(*) AS total, SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened
    FROM harvest_sacks WHERE is_test = ?
  `, [isTest]);

  return successResponse({ success: true, season: getSeason(), totals, data: rows });
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
  select, input[type=number] { font-size: 1.2rem; padding: 12px; width: 100%; box-sizing: border-box; margin: 8px 0 16px; border-radius: 8px; border: none; }
  label { font-size: 1rem; color: #cfe3d6; }
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

function enterBody({ zone, cutNumber, sessionId, prevZone }) {
  return `
<h1>✅ Entered ${zone}</h1>
<p class="sub">Cut ${cutNumber}</p>
${prevZone ? `<p class="note">Previous zone <strong>${prevZone}</strong> auto-closed.</p>` : `<p class="note">No prior zone was open.</p>`}
<p class="note">How many cutters here now?</p>
<div class="grid">${headcountGrid(zone, sessionId)}</div>
<div class="footer"><a href="?action=logs&zone=${zone}">View log →</a></div>`;
}

function alreadyEnteredBody(active) {
  return `
<h1>Already entered ${active.zone}</h1>
<p class="sub">Cut ${active.cut_number}</p>
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
    ? `<p class="note">Currently active zone: <strong>${active.zone}</strong> (cut ${active.cut_number})</p>`
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
<div class="footer"><a href="?action=barn_intake">Log another load →</a></div>`;
}

// ─── SUPERSACK TAG RENDERING ────────────────────────────

function sackPrintFormBody(lots) {
  if (!lots.length) {
    return `
<h1>Print Sack Tags</h1>
<p class="note">No harvest lots recorded in the last ${LOT_PICKER_DAYS} days, so there's nothing to take down yet. Scan a zone QR to open a lot first.</p>`;
  }

  const options = lots.map(l => {
    const label = `${l.zone} · cut ${l.cut_number} · cut ${String(l.occurred_at).substring(0, 10)} — ${l.days_since_cut}d drying`;
    return `<option value="${l.id}">${escapeHtml(label)}</option>`;
  }).join('');

  return `
<h1>Print Sack Tags</h1>
<p class="note">Pick the lot that's <strong>coming down now</strong> — not the zone being cut today. Material bags ~10 days after it was cut.</p>
<form method="POST" action="?action=sack_print_run" onsubmit="this.querySelector('button').disabled=true">
  <label for="session_id">Lot coming down</label>
  <select id="session_id" name="session_id" required>${options}</select>
  <label for="cultivar">Cultivar</label>
  <input id="cultivar" name="cultivar" list="cultivars" required autocomplete="off" placeholder="e.g. Sour Lifter">
  <datalist id="cultivars">
    <option value="Sour Lifter"><option value="Lifter"><option value="Berry Bliss">
  </datalist>
  <label for="qty">How many sacks?</label>
  <input id="qty" name="qty" type="number" min="1" max="${MAX_PRINT_QTY}" value="1" required>
  <button class="btn" type="submit">Print tags</button>
</form>`;
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
