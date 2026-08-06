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
 * Design: wiki/operations/plans/2026-07-06-seed-to-sale-harvest-tracking.md
 */

import { query, queryOne, execute } from '../lib/db.js';
import { successResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { createError, formatError } from '../lib/errors.js';
import { VALID_ZONES, normalizeZone } from '../lib/zones.js';
import { sendTelegramMessage } from '../lib/telegram.js';

const DEBOUNCE_MS = 5 * 60 * 1000;       // re-scanning the same active zone within this window is a no-op
const CUT_RESUME_GRACE_HOURS = 8;        // re-entering a zone within this many hours of its last close = same cut
const HEADCOUNT_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1); // 1-12, plus a 13+ link

const HTML_ACTIONS = new Set(['enter', 'headcount', 'barn_intake', 'barn_log']);

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
    default:
      throw createError('NOT_FOUND', `Unknown harvest action: ${action}`);
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
