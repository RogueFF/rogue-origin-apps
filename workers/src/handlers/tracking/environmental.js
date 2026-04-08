/**
 * Tracking Environmental — greenhouse readings + manual weather entries
 */

import { jsonResponse } from '../../lib/response.js';
import { ApiError } from '../../lib/errors.js';
import { generateId } from './id.js';

export async function handle(action, request, env) {
  switch (action) {
    case 'recordReading':
      return await recordReading(request, env);
    case 'listReadings':
      return await listReadings(request, env);
    case 'getLatestReading':
      return await getLatestReading(request, env);
    default:
      throw new ApiError(`Unknown environmental action: ${action}`, 'BAD_REQUEST', 400);
  }
}

async function recordReading(request, env) {
  const body = await request.json();
  const { location_id, source, temp_f, humidity_pct, logged_by } = body;

  if (!location_id) {
    throw new ApiError('Missing required field: location_id', 'BAD_REQUEST', 400);
  }

  const id = generateId();
  const resolvedSource = source || 'manual';

  await env.DB.prepare(`
    INSERT INTO tracking_environmental (id, location_id, source, temp_f, humidity_pct, logged_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, location_id, resolvedSource, temp_f || null, humidity_pct || null, logged_by || null).run();

  return jsonResponse({
    reading: { id, location_id, source: resolvedSource, temp_f, humidity_pct, logged_by }
  });
}

async function listReadings(request, env) {
  const url = new URL(request.url);
  const locationId = url.searchParams.get('location_id');
  const source = url.searchParams.get('source');
  const dateFrom = url.searchParams.get('date_from');
  const dateTo = url.searchParams.get('date_to');

  let query = 'SELECT * FROM tracking_environmental WHERE 1=1';
  const params = [];

  if (locationId) {
    query += ' AND location_id = ?';
    params.push(locationId);
  }
  if (source) {
    query += ' AND source = ?';
    params.push(source);
  }
  if (dateFrom) {
    query += ' AND recorded_at >= ?';
    params.push(dateFrom);
  }
  if (dateTo) {
    query += ' AND recorded_at <= ?';
    params.push(dateTo);
  }

  query += ' ORDER BY recorded_at DESC';

  const { results } = await env.DB.prepare(query).bind(...params).all();
  return jsonResponse({ readings: results });
}

async function getLatestReading(request, env) {
  const url = new URL(request.url);
  const locationId = url.searchParams.get('location_id');

  if (!locationId) {
    throw new ApiError('Missing location_id parameter', 'BAD_REQUEST', 400);
  }

  const { results } = await env.DB.prepare(
    'SELECT * FROM tracking_environmental WHERE location_id = ? ORDER BY recorded_at DESC LIMIT 1'
  ).bind(locationId).all();

  if (results.length === 0) {
    throw new ApiError('No readings found for this location', 'NOT_FOUND', 404);
  }

  return jsonResponse({ reading: results[0] });
}
