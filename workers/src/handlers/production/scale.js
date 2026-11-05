/**
 * Scale weight handlers.
 */

import { successResponse, errorResponse } from '../../lib/response.js';
import { getConfig, setConfig, incrementDataVersion } from '../../lib/production-utils.js';
import { constantTimeEqual } from '../../lib/auth.js';

// Scale unit tag (kept as metadata on readings for debug/audit — no longer
// drives button visibility).
function normalizeUnit(raw) {
  if (!raw) return 'g';
  const u = String(raw).toLowerCase().trim();
  if (u === 'lb' || u === 'lbs' || u === 'pound' || u === 'pounds') return 'lb';
  if (u === 'kg' || u === 'kgs' || u === 'kilogram' || u === 'kilograms') return 'kg';
  if (u === 'oz' || u === 'ounce' || u === 'ounces') return 'oz';
  return 'g';
}

// Current facility bag mode = app-side toggle. Only values: '5kg' | '10lb'.
const BAG_MODE_KEY = 'production.bag_mode';
function normalizeBagMode(raw) {
  const m = String(raw || '').toLowerCase().trim();
  if (m === '10lb' || m === '10 lb' || m === '10lbs') return '10lb';
  return '5kg';
}

async function getBagMode(env) {
  const v = await getConfig(env, BAG_MODE_KEY);
  return normalizeBagMode(v);
}

async function setBagMode(body, env) {
  const mode = normalizeBagMode(body.mode);
  const updatedBy = body.updatedBy || 'hourly-entry';
  try {
    // Upsert so this works even if the schema migration didn't seed the row.
    // Bypasses setConfig() which is UPDATE-only.
    await env.DB.prepare(
      `INSERT INTO system_config (key, value, value_type, category, description, updated_at, updated_by)
       VALUES (?, ?, 'string', 'production', 'Current facility bag mode (5kg or 10lb)', datetime('now'), ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`
    ).bind(BAG_MODE_KEY, mode, updatedBy).run();
    await incrementDataVersion(env);
    return successResponse({ success: true, bagMode: mode });
  } catch (error) {
    console.error('Error setting bag mode:', error);
    return errorResponse('Failed to update bag mode', 'INTERNAL_ERROR', 500);
  }
}

// Cell table scales (migration 0049). A station registered in scale_stations
// with kind 'table' must send its device token; anything unregistered (line1,
// the QC bag scale) keeps the original behaviour: no token, 3 s stale.
const LEGACY_STALE_MS = 3000;
const EVENT_MIN_MOVE_KG = 0.0002; // log a settled weight only when it moved 0.2 g or more

// { migrated, station }. Until 0049 is applied there is no scale_stations
// table, and every station must behave exactly as before, never a 500.
async function findStation(env, stationId) {
  try {
    const station = await env.DB.prepare(
      `SELECT station_id, kind, token_hash, stale_after_s, active
       FROM scale_stations WHERE station_id = ?`
    ).bind(stationId).first();
    return { migrated: true, station: station || null };
  } catch (error) {
    if (/no such table/i.test(String(error && error.message))) {
      return { migrated: false, station: null };
    }
    throw error;
  }
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function bearerToken(request) {
  const header = (request && request.headers && request.headers.get('authorization')) || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

// null when the caller didn't say (line1's reader never sends it).
function parseStable(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  return raw === true || raw === 1 || raw === '1' || raw === 'true' ? 1 : 0;
}

async function getScaleWeight(params, env) {
  const stationId = params.stationId || 'line1';

  try {
    const [found, result, bagMode] = await Promise.all([
      findStation(env, stationId),
      // SELECT * so this works before and after 0049 adds the stable column.
      env.DB.prepare(`SELECT * FROM scale_readings WHERE station_id = ?`).bind(stationId).first(),
      getBagMode(env),
    ]);
    const station = found.station;
    const STALE_THRESHOLD_MS = station && station.stale_after_s > 0
      ? station.stale_after_s * 1000
      : LEGACY_STALE_MS;

    if (!result) {
      return successResponse({
        weight: 0,
        targetWeight: 5.0,
        unit: 'g',
        bagMode,
        percentComplete: 0,
        stationId,
        updatedAt: null,
        isStale: true,
      });
    }

    const updatedAt = new Date(result.updated_at + 'Z');
    const now = new Date();
    const isStale = (now - updatedAt) > STALE_THRESHOLD_MS;
    const percentComplete = result.target_weight > 0
      ? Math.min(100, Math.round((result.weight / result.target_weight) * 100))
      : 0;

    return successResponse({
      weight: result.weight,
      targetWeight: result.target_weight,
      unit: result.unit || 'g',
      bagMode,
      percentComplete,
      stationId,
      updatedAt: updatedAt.toISOString(),
      isStale,
      stable: result.stable === undefined || result.stable === null ? null : result.stable === 1,
      staleAfterS: STALE_THRESHOLD_MS / 1000,
    });
  } catch (error) {
    console.error('Error getting scale weight:', error);
    return errorResponse('Failed to get scale weight', 'INTERNAL_ERROR', 500);
  }
}

async function setScaleWeight(body, env, request) {
  const stationId = body.stationId || 'line1';
  const weight = parseFloat(body.weight);
  const unit = normalizeUnit(body.unit);

  if (isNaN(weight) || weight < 0) {
    return errorResponse('Invalid weight value', 'VALIDATION_ERROR', 400);
  }

  const safeWeight = Math.min(weight, 10);

  try {
    const { migrated, station } = await findStation(env, stationId);

    if (station && station.kind === 'table') {
      if (!station.active) {
        return errorResponse('Scale station is inactive', 'UNAUTHORIZED', 401);
      }
      const token = bearerToken(request);
      const presented = token ? await sha256Hex(token) : '';
      if (!station.token_hash || !constantTimeEqual(presented, station.token_hash)) {
        return errorResponse('Device token required', 'UNAUTHORIZED', 401);
      }
    }

    if (!migrated) {
      await env.DB.prepare(
        `INSERT INTO scale_readings (station_id, weight, unit, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(station_id) DO UPDATE SET
           weight = excluded.weight,
           unit = excluded.unit,
           updated_at = datetime('now')`
      ).bind(stationId, safeWeight, unit).run();
      return successResponse({ success: true });
    }

    const stable = parseStable(body.stable);
    await env.DB.prepare(
      `INSERT INTO scale_readings (station_id, weight, unit, stable, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(station_id) DO UPDATE SET
         weight = excluded.weight,
         unit = excluded.unit,
         stable = excluded.stable,
         updated_at = datetime('now')`
    ).bind(stationId, safeWeight, unit, stable).run();

    // Settled weights of registered stations only, so an unregistered caller
    // can't fill the log. Heartbeats repeat the last value and are skipped.
    let logged = false;
    if (station && stable === 1) {
      const kg = safeWeight; // weight is always kg here; unit is only a tag
      const last = await env.DB.prepare(
        `SELECT weight_kg FROM scale_events WHERE station_id = ? ORDER BY id DESC LIMIT 1`
      ).bind(stationId).first();
      if (!last || Math.abs(kg - last.weight_kg) >= EVENT_MIN_MOVE_KG - 1e-9) {
        await env.DB.prepare(
          `INSERT INTO scale_events (station_id, ts, weight_kg) VALUES (?, datetime('now'), ?)`
        ).bind(stationId, kg).run();
        logged = true;
      }
    }

    return successResponse({ success: true, stable: stable === null ? null : stable === 1, logged });
  } catch (error) {
    console.error('Error setting scale weight:', error);
    return errorResponse('Failed to update scale weight', 'INTERNAL_ERROR', 500);
  }
}

export { getScaleWeight, setScaleWeight, getBagMode, setBagMode };
