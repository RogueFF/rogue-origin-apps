/**
 * Scale weight handlers.
 */

import { successResponse, errorResponse } from '../../lib/response.js';
import { getConfig, setConfig } from '../../lib/production-utils.js';
import { incrementDataVersion } from './bag-tracking.js';

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
  try {
    await setConfig(env, BAG_MODE_KEY, mode, body.updatedBy || 'scoreboard');
    await incrementDataVersion(env);
    return successResponse({ success: true, bagMode: mode });
  } catch (error) {
    console.error('Error setting bag mode:', error);
    return errorResponse('Failed to update bag mode', 'INTERNAL_ERROR', 500);
  }
}

async function getScaleWeight(params, env) {
  const stationId = params.stationId || 'line1';
  const STALE_THRESHOLD_MS = 3000;

  try {
    const [result, bagMode] = await Promise.all([
      env.DB.prepare(
        `SELECT weight, target_weight, COALESCE(unit, 'g') AS unit, updated_at
         FROM scale_readings WHERE station_id = ?`
      ).bind(stationId).first(),
      getBagMode(env),
    ]);

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
      unit: result.unit,
      bagMode,
      percentComplete,
      stationId,
      updatedAt: updatedAt.toISOString(),
      isStale,
    });
  } catch (error) {
    console.error('Error getting scale weight:', error);
    return errorResponse('Failed to get scale weight', 'INTERNAL_ERROR', 500);
  }
}

async function setScaleWeight(body, env) {
  const stationId = body.stationId || 'line1';
  const weight = parseFloat(body.weight);
  const unit = normalizeUnit(body.unit);

  if (isNaN(weight) || weight < 0) {
    return errorResponse('Invalid weight value', 'VALIDATION_ERROR', 400);
  }

  const safeWeight = Math.min(weight, 10);

  try {
    await env.DB.prepare(
      `INSERT INTO scale_readings (station_id, weight, unit, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(station_id) DO UPDATE SET
         weight = excluded.weight,
         unit = excluded.unit,
         updated_at = datetime('now')`
    ).bind(stationId, safeWeight, unit).run();

    return successResponse({ success: true });
  } catch (error) {
    console.error('Error setting scale weight:', error);
    return errorResponse('Failed to update scale weight', 'INTERNAL_ERROR', 500);
  }
}

export { getScaleWeight, setScaleWeight, getBagMode, setBagMode };
