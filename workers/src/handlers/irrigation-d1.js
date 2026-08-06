/**
 * Irrigation Reporting API Handler — D1
 *
 * Logs crew irrigation reports (zone / minutes / PPM / optional method) captured
 * by the "Riego" Telegram/WhatsApp agent via the farm-bridge `log_irrigation`
 * MCP tool. The agent only calls this after the irrigator confirms the report.
 *
 * Endpoints:
 * - POST ?action=log   - Record a confirmed irrigation report
 * - GET  ?action=logs  - List rows (for the nightly wiki rollup / dashboards)
 * - GET  ?action=test  - Health check
 *
 * Design: wiki/operations/plans/2026-06-16-irrigation-whatsapp-agent-design.md
 */

import { query, execute } from '../lib/db.js';
import { successResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { extractPassword, constantTimeEqual } from '../lib/auth.js';
import { VALID_ZONES, normalizeZone } from '../lib/zones.js';

const VALID_CHANNELS = new Set(['telegram', 'whatsapp']);

const WRITE_ACTIONS = new Set(['log']);

export async function handleIrrigationD1(request, env, ctx) {
  const body = request.method === 'POST' ? await parseBody(request) : {};
  const action = getAction(request, body);
  const params = getQueryParams(request);
  const db = env.DB;

  if (WRITE_ACTIONS.has(action)) {
    requireWriteAuth(request, body, env);
  }

  switch (action) {
    case 'log':
      return logIrrigation(db, body);
    case 'logs':
      return getLogs(db, params);
    case 'test':
      return successResponse({ success: true, message: 'Irrigation API operational' });
    default:
      throw createError('NOT_FOUND', `Unknown irrigation action: ${action}`);
  }
}

// ─── AUTH (optional until hardened) ────────────────────
// If IRRIGATION_WRITE_KEY is unset, writes are allowed (v1 — the bot allowlist is
// the gate). Set IRRIGATION_WRITE_KEY on THIS worker and on the farm-bridge MCP
// worker to require a matching bearer token — no code change needed.
function requireWriteAuth(request, body, env) {
  const key = env.IRRIGATION_WRITE_KEY;
  if (!key) {
    console.warn('[irrigation] IRRIGATION_WRITE_KEY not set — write is unauthenticated');
    return;
  }
  const provided = extractPassword(request, body);
  if (!provided || !constantTimeEqual(provided, key)) {
    throw createError('UNAUTHORIZED', 'Invalid or missing irrigation write key');
  }
}

// ─── NORMALIZE ─────────────────────────────────────────

function normalizeMethod(raw) {
  if (!raw) return null;
  const m = String(raw).trim().toLowerCase();
  if (/(goteo|drip|cinta|tape)/.test(m)) return 'drip';
  if (/(inund|flood|chorro|encharc|manguera)/.test(m)) return 'flood';
  return null; // unknown → store nothing rather than fail an otherwise-good report
}

// ─── WRITE ─────────────────────────────────────────────

async function logIrrigation(db, body) {
  const zone = normalizeZone(body.zone);
  const duration_min = Math.round(Number(body.minutes ?? body.duration_min));
  const ppm = Math.round(Number(body.ppm));
  const method = normalizeMethod(body.method);
  const irrigator = body.irrigator ? String(body.irrigator).substring(0, 80) : null;
  const channel = VALID_CHANNELS.has(body.channel) ? body.channel : 'telegram';
  const raw_message = body.raw_message ? String(body.raw_message).substring(0, 2000) : null;

  if (!zone || !VALID_ZONES.has(zone)) {
    throw createError('VALIDATION_ERROR', `Unknown zone "${body.zone}". Valid: Z1–Z21, R1, GH1, GH2.`);
  }
  if (!Number.isFinite(duration_min) || duration_min <= 0 || duration_min > 1440) {
    throw createError('VALIDATION_ERROR', 'minutes must be a positive number up to 1440.');
  }
  if (!Number.isFinite(ppm) || ppm < 0 || ppm > 10000) {
    throw createError('VALIDATION_ERROR', 'ppm must be a number between 0 and 10000.');
  }

  const result = await execute(db, `
    INSERT INTO irrigation_log (irrigator, zone, duration_min, ppm, method, channel, raw_message)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [irrigator, zone, duration_min, ppm, method, channel, raw_message]);

  return successResponse({
    success: true,
    id: result.lastRowId,
    logged: { zone, duration_min, ppm, method, irrigator, channel },
  });
}

// ─── READ (nightly wiki rollup / dashboards) ───────────

async function getLogs(db, params) {
  const { date, zone, limit: rawLimit } = params;
  const limit = Math.min(Math.max(parseInt(rawLimit) || 200, 1), 1000);

  let sql = 'SELECT * FROM irrigation_log';
  const conditions = [];
  const binds = [];

  if (date) {
    conditions.push('date(reported_at) = ?'); // YYYY-MM-DD (UTC)
    binds.push(String(date).substring(0, 10));
  }
  if (zone) {
    conditions.push('zone = ?');
    binds.push(normalizeZone(zone));
  }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY reported_at DESC LIMIT ?';
  binds.push(limit);

  const rows = await query(db, sql, binds);
  return successResponse({ success: true, data: rows });
}
