/**
 * Tracking Planting — planting passes, replant events, and summaries
 */

import { jsonResponse } from '../../lib/response.js';
import { ApiError } from '../../lib/errors.js';
import { generateId } from './id.js';

export async function handle(action, request, env) {
  switch (action) {
    case 'logPlantingPass':
      return await logPlantingPass(request, env);
    case 'getPlantingPasses':
      return await getPlantingPasses(request, env);
    case 'logReplant':
      return await logReplant(request, env);
    case 'getReplants':
      return await getReplants(request, env);
    case 'getPlantingSummary':
      return await getPlantingSummary(request, env);
    default:
      throw new ApiError(`Unknown planting action: ${action}`, 'BAD_REQUEST', 400);
  }
}

async function logPlantingPass(request, env) {
  const body = await request.json();
  const { lot_id, location_id, pass_number, row_1_replacements, row_2_replacements, row_3_replacements, reason, logged_by, notes } = body;

  if (!lot_id || !location_id || pass_number === undefined || pass_number === null) {
    throw new ApiError('Missing required fields: lot_id, location_id, pass_number', 'BAD_REQUEST', 400);
  }

  const id = generateId();

  await env.DB.prepare(`
    INSERT INTO tracking_planting_passes (id, lot_id, location_id, pass_number, row_1_replacements, row_2_replacements, row_3_replacements, reason, logged_by, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, lot_id, location_id, pass_number,
    row_1_replacements || 0, row_2_replacements || 0, row_3_replacements || 0,
    reason || null, logged_by || null, notes || null
  ).run();

  return jsonResponse({
    pass: { id, lot_id, location_id, pass_number, row_1_replacements, row_2_replacements, row_3_replacements, reason, logged_by, notes }
  });
}

async function getPlantingPasses(request, env) {
  const url = new URL(request.url);
  const lotId = url.searchParams.get('lot_id');

  if (!lotId) {
    throw new ApiError('Missing lot_id parameter', 'BAD_REQUEST', 400);
  }

  const { results } = await env.DB.prepare(
    'SELECT * FROM tracking_planting_passes WHERE lot_id = ? ORDER BY pass_number ASC'
  ).bind(lotId).all();

  return jsonResponse({ passes: results });
}

async function logReplant(request, env) {
  const body = await request.json();
  const { lot_id, location_id, row_data, trays_used, source_lot_id, logged_by, notes } = body;

  if (!lot_id || !location_id || !row_data) {
    throw new ApiError('Missing required fields: lot_id, location_id, row_data', 'BAD_REQUEST', 400);
  }

  const id = generateId();

  await env.DB.prepare(`
    INSERT INTO tracking_replants (id, lot_id, location_id, row_data, trays_used, source_lot_id, logged_by, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, lot_id, location_id, row_data,
    trays_used || null, source_lot_id || null,
    logged_by || null, notes || null
  ).run();

  // If source_lot_id provided, create lineage record and update quantities
  if (source_lot_id) {
    const rows = JSON.parse(row_data);
    const totalCount = rows.reduce((sum, r) => sum + (r.count || 0), 0);

    if (totalCount > 0) {
      const lineageId = generateId();

      // Create lineage record: parent=source_lot, child=target lot
      await env.DB.prepare(`
        INSERT INTO tracking_lot_lineage (id, parent_lot_id, child_lot_id, quantity, unit, reason, notes)
        VALUES (?, ?, ?, ?, 'plants', 'replant', ?)
      `).bind(lineageId, source_lot_id, lot_id, totalCount, notes || null).run();

      // Reduce source lot quantity
      await env.DB.prepare(`
        UPDATE tracking_lots SET quantity = quantity - ?, updated_at = datetime('now') WHERE id = ?
      `).bind(totalCount, source_lot_id).run();

      // Increase target lot quantity
      await env.DB.prepare(`
        UPDATE tracking_lots SET quantity = quantity + ?, updated_at = datetime('now') WHERE id = ?
      `).bind(totalCount, lot_id).run();
    }
  }

  return jsonResponse({
    replant: { id, lot_id, location_id, row_data, trays_used, source_lot_id, logged_by, notes }
  });
}

async function getReplants(request, env) {
  const url = new URL(request.url);
  const lotId = url.searchParams.get('lot_id');

  if (!lotId) {
    throw new ApiError('Missing lot_id parameter', 'BAD_REQUEST', 400);
  }

  const { results } = await env.DB.prepare(
    'SELECT * FROM tracking_replants WHERE lot_id = ? ORDER BY logged_at DESC'
  ).bind(lotId).all();

  return jsonResponse({ replants: results });
}

async function getPlantingSummary(request, env) {
  const url = new URL(request.url);
  const lotId = url.searchParams.get('lot_id');

  if (!lotId) {
    throw new ApiError('Missing lot_id parameter', 'BAD_REQUEST', 400);
  }

  // Get all planting passes
  const { results: passes } = await env.DB.prepare(
    'SELECT * FROM tracking_planting_passes WHERE lot_id = ? ORDER BY pass_number ASC'
  ).bind(lotId).all();

  // Get all replants
  const { results: replants } = await env.DB.prepare(
    'SELECT * FROM tracking_replants WHERE lot_id = ? ORDER BY logged_at DESC'
  ).bind(lotId).all();

  // Calculate totals
  const totalPassReplacements = passes.reduce(
    (sum, p) => sum + (p.row_1_replacements || 0) + (p.row_2_replacements || 0) + (p.row_3_replacements || 0), 0
  );

  let totalReplants = 0;
  const byReason = {};

  for (const replant of replants) {
    const rows = JSON.parse(replant.row_data || '[]');
    for (const row of rows) {
      const count = row.count || 0;
      totalReplants += count;
      const reason = row.reason || 'unknown';
      byReason[reason] = (byReason[reason] || 0) + count;
    }
  }

  // Also tally pass reasons
  for (const pass of passes) {
    if (pass.reason) {
      const passTotal = (pass.row_1_replacements || 0) + (pass.row_2_replacements || 0) + (pass.row_3_replacements || 0);
      if (passTotal > 0) {
        byReason[pass.reason] = (byReason[pass.reason] || 0) + passTotal;
      }
    }
  }

  return jsonResponse({
    summary: {
      total_pass_replacements: totalPassReplacements,
      total_replants: totalReplants,
      by_reason: byReason,
      passes,
      replants
    }
  });
}
