/**
 * Tracking Observations — journal entries, watering logs, weekly checks, sap analysis
 */

import { jsonResponse } from '../../lib/response.js';
import { ApiError } from '../../lib/errors.js';
import { generateId } from './id.js';

export async function handle(action, request, env) {
  switch (action) {
    case 'createObservation':
      return await createObservation(request, env);
    case 'listObservations':
      return await listObservations(request, env);
    case 'getObservation':
      return await getObservation(request, env);
    case 'logWatering':
      return await logWatering(request, env);
    case 'logWeeklyCheck':
      return await logWeeklyCheck(request, env);
    case 'logSapAnalysis':
      return await logSapAnalysis(request, env);
    default:
      throw new ApiError(`Unknown observation action: ${action}`, 'BAD_REQUEST', 400);
  }
}

async function createObservation(request, env) {
  const body = await request.json();
  const { lot_id, location_id, stage, observation_type, content, photo_urls, severity, logged_by, metadata } = body;

  if (!observation_type) {
    throw new ApiError('Missing required field: observation_type', 'BAD_REQUEST', 400);
  }

  const id = generateId();

  await env.DB.prepare(`
    INSERT INTO tracking_observations (id, lot_id, location_id, stage, observation_type, content, photo_urls, severity, logged_by, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, lot_id || null, location_id || null, stage || null,
    observation_type, content || null, photo_urls || null,
    severity || 'info', logged_by || null, metadata || null
  ).run();

  return jsonResponse({
    observation: { id, lot_id, location_id, stage, observation_type, content, photo_urls, severity, logged_by, metadata }
  });
}

async function listObservations(request, env) {
  const url = new URL(request.url);
  const lotId = url.searchParams.get('lot_id');
  const locationId = url.searchParams.get('location_id');
  const observationType = url.searchParams.get('observation_type');
  const dateFrom = url.searchParams.get('date_from');
  const dateTo = url.searchParams.get('date_to');

  let query = 'SELECT * FROM tracking_observations WHERE 1=1';
  const params = [];

  if (lotId) {
    query += ' AND lot_id = ?';
    params.push(lotId);
  }
  if (locationId) {
    query += ' AND location_id = ?';
    params.push(locationId);
  }
  if (observationType) {
    query += ' AND observation_type = ?';
    params.push(observationType);
  }
  if (dateFrom) {
    query += ' AND observed_at >= ?';
    params.push(dateFrom);
  }
  if (dateTo) {
    query += ' AND observed_at <= ?';
    params.push(dateTo);
  }

  query += ' ORDER BY observed_at DESC';

  const { results } = await env.DB.prepare(query).bind(...params).all();
  return jsonResponse({ observations: results });
}

async function getObservation(request, env) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id) {
    throw new ApiError('Missing id parameter', 'BAD_REQUEST', 400);
  }

  const { results } = await env.DB.prepare(
    'SELECT * FROM tracking_observations WHERE id = ?'
  ).bind(id).all();

  if (results.length === 0) {
    throw new ApiError('Observation not found', 'NOT_FOUND', 404);
  }

  return jsonResponse({ observation: results[0] });
}

async function logWatering(request, env) {
  const body = await request.json();
  const { lot_id, weight_lbs, action, stage, feed_type, logged_by } = body;

  if (!lot_id) {
    throw new ApiError('Missing required field: lot_id', 'BAD_REQUEST', 400);
  }

  const id = generateId();
  const metadata = JSON.stringify({ weight_lbs, action, stage, feed_type });

  await env.DB.prepare(`
    INSERT INTO tracking_observations (id, lot_id, observation_type, logged_by, metadata)
    VALUES (?, ?, 'watering', ?, ?)
  `).bind(id, lot_id, logged_by || null, metadata).run();

  return jsonResponse({
    observation: { id, lot_id, observation_type: 'watering', logged_by, metadata }
  });
}

async function logWeeklyCheck(request, env) {
  const body = await request.json();
  const { location_id, week_number, height_inches, growth_rating, pest_pressure, pest_type, moisture_rating, photo_urls, notes, logged_by } = body;

  if (!location_id) {
    throw new ApiError('Missing required field: location_id', 'BAD_REQUEST', 400);
  }

  const id = generateId();
  const metadata = JSON.stringify({ week_number, height_inches, growth_rating, pest_pressure, pest_type, moisture_rating });

  await env.DB.prepare(`
    INSERT INTO tracking_observations (id, location_id, observation_type, content, photo_urls, logged_by, metadata)
    VALUES (?, ?, 'weekly_check', ?, ?, ?, ?)
  `).bind(id, location_id, notes || null, photo_urls || null, logged_by || null, metadata).run();

  return jsonResponse({
    observation: { id, location_id, observation_type: 'weekly_check', content: notes, photo_urls, logged_by, metadata }
  });
}

async function logSapAnalysis(request, env) {
  const body = await request.json();
  const { farm_name, photo_urls, notes, logged_by } = body;

  const id = generateId();
  const photoUrlsStr = photo_urls ? (typeof photo_urls === 'string' ? photo_urls : JSON.stringify(photo_urls)) : null;

  await env.DB.prepare(`
    INSERT INTO tracking_observations (id, observation_type, content, photo_urls, logged_by, metadata)
    VALUES (?, 'sap_analysis', ?, ?, ?, ?)
  `).bind(id, notes || null, photoUrlsStr, logged_by || null, farm_name ? JSON.stringify({ farm_name }) : null).run();

  return jsonResponse({
    observation: { id, observation_type: 'sap_analysis', content: notes, photo_urls, logged_by }
  });
}
