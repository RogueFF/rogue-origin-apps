/**
 * Tracking Inputs — water, nutrients, amendments applied to lots/locations
 */

import { jsonResponse } from '../../lib/response.js';
import { ApiError } from '../../lib/errors.js';
import { generateId } from './id.js';

export async function handle(action, request, env) {
  switch (action) {
    case 'recordInput':
      return await recordInput(request, env);
    case 'listInputs':
      return await listInputs(request, env);
    default:
      throw new ApiError(`Unknown input action: ${action}`, 'BAD_REQUEST', 400);
  }
}

async function recordInput(request, env) {
  const body = await request.json();
  const { lot_id, location_id, stage, input_type, product_name, amount, unit, logged_by, notes } = body;

  if (!input_type) {
    throw new ApiError('Missing required field: input_type', 'BAD_REQUEST', 400);
  }

  const id = generateId();

  await env.DB.prepare(`
    INSERT INTO tracking_inputs (id, lot_id, location_id, stage, input_type, product_name, amount, unit, logged_by, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, lot_id || null, location_id || null, stage || null,
    input_type, product_name || null, amount || null, unit || null,
    logged_by || null, notes || null
  ).run();

  return jsonResponse({
    input: { id, lot_id, location_id, stage, input_type, product_name, amount, unit, logged_by, notes }
  });
}

async function listInputs(request, env) {
  const url = new URL(request.url);
  const lotId = url.searchParams.get('lot_id');
  const locationId = url.searchParams.get('location_id');
  const inputType = url.searchParams.get('input_type');
  const dateFrom = url.searchParams.get('date_from');
  const dateTo = url.searchParams.get('date_to');

  let query = 'SELECT * FROM tracking_inputs WHERE 1=1';
  const params = [];

  if (lotId) {
    query += ' AND lot_id = ?';
    params.push(lotId);
  }
  if (locationId) {
    query += ' AND location_id = ?';
    params.push(locationId);
  }
  if (inputType) {
    query += ' AND input_type = ?';
    params.push(inputType);
  }
  if (dateFrom) {
    query += ' AND applied_at >= ?';
    params.push(dateFrom);
  }
  if (dateTo) {
    query += ' AND applied_at <= ?';
    params.push(dateTo);
  }

  query += ' ORDER BY applied_at DESC';

  const { results } = await env.DB.prepare(query).bind(...params).all();
  return jsonResponse({ inputs: results });
}
