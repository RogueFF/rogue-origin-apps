/**
 * Scale weight handlers.
 */

import { successResponse, errorResponse } from '../../lib/response.js';

async function getScaleWeight(params, env) {
  const stationId = params.stationId || 'line1';
  const STALE_THRESHOLD_MS = 3000;

  try {
    const result = await env.DB.prepare(
      'SELECT weight, target_weight, updated_at FROM scale_readings WHERE station_id = ?'
    ).bind(stationId).first();

    if (!result) {
      return successResponse({
        weight: 0,
        targetWeight: 5.0,
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

  if (isNaN(weight) || weight < 0) {
    return errorResponse('Invalid weight value', 'VALIDATION_ERROR', 400);
  }

  const safeWeight = Math.min(weight, 10);

  try {
    await env.DB.prepare(
      `INSERT INTO scale_readings (station_id, weight, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(station_id) DO UPDATE SET
         weight = excluded.weight,
         updated_at = datetime('now')`
    ).bind(stationId, safeWeight).run();

    return successResponse({ success: true });
  } catch (error) {
    console.error('Error setting scale weight:', error);
    return errorResponse('Failed to update scale weight', 'INTERNAL_ERROR', 500);
  }
}

export { getScaleWeight, setScaleWeight };
