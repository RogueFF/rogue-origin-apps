/**
 * Tracking Lots CRUD + Stage Transitions + Split/Merge
 * Manages plant lots through the seed-to-sale pipeline
 */

import { jsonResponse } from '../../lib/response.js';
import { ApiError } from '../../lib/errors.js';
import { generateId } from './id.js';

export async function handle(action, request, env) {
  switch (action) {
    case 'listLots':
      return await listLots(request, env);
    case 'getLot':
      return await getLot(request, env);
    case 'createLot':
      return await createLot(request, env);
    case 'updateLot':
      return await updateLot(request, env);
    case 'transitionStage':
      return await transitionStage(request, env);
    case 'splitLot':
      return await splitLot(request, env);
    case 'mergeLots':
      return await mergeLots(request, env);
    case 'getLotHistory':
      return await getLotHistory(request, env);
    default:
      throw new ApiError(`Unknown lot action: ${action}`, 'BAD_REQUEST', 400);
  }
}

async function listLots(request, env) {
  const url = new URL(request.url);
  const currentStage = url.searchParams.get('current_stage');
  const cultivar = url.searchParams.get('cultivar');
  const currentLocationId = url.searchParams.get('current_location_id');

  let query = 'SELECT * FROM tracking_lots WHERE 1=1';
  const params = [];

  if (currentStage) {
    query += ' AND current_stage = ?';
    params.push(currentStage);
  }
  if (cultivar) {
    query += ' AND cultivar LIKE ?';
    params.push(`%${cultivar}%`);
  }
  if (currentLocationId) {
    query += ' AND current_location_id = ?';
    params.push(currentLocationId);
  }

  query += ' ORDER BY created_at DESC';

  const { results } = await env.DB.prepare(query).bind(...params).all();
  return jsonResponse({ lots: results });
}

async function getLot(request, env) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id) {
    throw new ApiError('Missing id parameter', 'BAD_REQUEST', 400);
  }

  // Lot details
  const { results: lots } = await env.DB.prepare(
    'SELECT * FROM tracking_lots WHERE id = ?'
  ).bind(id).all();

  if (lots.length === 0) {
    throw new ApiError('Lot not found', 'NOT_FOUND', 404);
  }

  // Lineage: parents (this lot is a child)
  const { results: parents } = await env.DB.prepare(
    'SELECT l.*, p.cultivar as parent_cultivar, p.current_stage as parent_stage FROM tracking_lot_lineage l JOIN tracking_lots p ON l.parent_lot_id = p.id WHERE l.child_lot_id = ?'
  ).bind(id).all();

  // Lineage: children (this lot is a parent)
  const { results: children } = await env.DB.prepare(
    'SELECT l.*, c.cultivar as child_cultivar, c.current_stage as child_stage FROM tracking_lot_lineage l JOIN tracking_lots c ON l.child_lot_id = c.id WHERE l.parent_lot_id = ?'
  ).bind(id).all();

  // Recent transitions
  const { results: transitions } = await env.DB.prepare(
    'SELECT * FROM tracking_stage_transitions WHERE lot_id = ? ORDER BY transitioned_at DESC LIMIT 20'
  ).bind(id).all();

  return jsonResponse({
    lot: lots[0],
    lineage: { parents, children },
    transitions
  });
}

async function createLot(request, env) {
  const body = await request.json();
  const { cultivar, seed_source, seed_lot_number, quantity, unit, germ_method, current_location_id, notes } = body;

  if (!cultivar || !quantity || !unit) {
    throw new ApiError('Missing required fields: cultivar, quantity, unit', 'BAD_REQUEST', 400);
  }

  const lotId = generateId();
  const transitionId = generateId();

  const statements = [
    env.DB.prepare(`
      INSERT INTO tracking_lots (id, cultivar, seed_source, seed_lot_number, quantity, unit, germ_method, current_stage, current_location_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'germination', ?, ?)
    `).bind(
      lotId, cultivar, seed_source || null, seed_lot_number || null,
      quantity, unit, germ_method || null, current_location_id || null, notes || null
    ),
    env.DB.prepare(`
      INSERT INTO tracking_stage_transitions (id, lot_id, from_stage, to_stage, quantity_in, quantity_out, unit, location_id, logged_by, notes)
      VALUES (?, ?, NULL, 'germination', ?, ?, ?, ?, ?, ?)
    `).bind(
      transitionId, lotId, quantity, quantity, unit,
      current_location_id || null, null, 'Lot created'
    ),
  ];

  await env.DB.batch(statements);

  return jsonResponse({
    lot: { id: lotId, cultivar, seed_source, seed_lot_number, quantity, unit, germ_method, current_stage: 'germination', current_location_id, notes }
  });
}

async function updateLot(request, env) {
  const body = await request.json();
  const { id, ...fields } = body;

  if (!id) {
    throw new ApiError('Missing id', 'BAD_REQUEST', 400);
  }

  const allowedFields = ['cultivar', 'seed_source', 'seed_lot_number', 'quantity', 'unit', 'germ_method', 'is_replant', 'notes'];
  const updates = [];
  const params = [];

  for (const [key, value] of Object.entries(fields)) {
    if (allowedFields.includes(key)) {
      updates.push(`${key} = ?`);
      params.push(value);
    }
  }

  if (updates.length === 0) {
    throw new ApiError('No fields to update', 'BAD_REQUEST', 400);
  }

  updates.push("updated_at = datetime('now')");
  params.push(id);

  await env.DB.prepare(`
    UPDATE tracking_lots SET ${updates.join(', ')} WHERE id = ?
  `).bind(...params).run();

  return jsonResponse({ updated: true });
}

async function transitionStage(request, env) {
  const body = await request.json();
  const { lot_id, to_stage, quantity_in, quantity_out, unit, location_id, logged_by, notes } = body;

  if (!lot_id || !to_stage) {
    throw new ApiError('Missing required fields: lot_id, to_stage', 'BAD_REQUEST', 400);
  }

  // Get current lot state
  const { results: lots } = await env.DB.prepare(
    'SELECT * FROM tracking_lots WHERE id = ?'
  ).bind(lot_id).all();

  if (lots.length === 0) {
    throw new ApiError('Lot not found', 'NOT_FOUND', 404);
  }

  const lot = lots[0];
  const transitionId = generateId();

  // Update lot fields
  const updateFields = ["current_stage = ?", "updated_at = datetime('now')"];
  const updateParams = [to_stage];

  if (quantity_out !== undefined && quantity_out !== null) {
    updateFields.push('quantity = ?');
    updateParams.push(quantity_out);
  }
  if (location_id) {
    updateFields.push('current_location_id = ?');
    updateParams.push(location_id);
  }

  updateParams.push(lot_id);

  // Batch: transition record + lot update
  const statements = [
    env.DB.prepare(`
      INSERT INTO tracking_stage_transitions (id, lot_id, from_stage, to_stage, quantity_in, quantity_out, unit, location_id, logged_by, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      transitionId, lot_id, lot.current_stage, to_stage,
      quantity_in || null, quantity_out || null, unit || null,
      location_id || null, logged_by || null, notes || null
    ),
    env.DB.prepare(`
      UPDATE tracking_lots SET ${updateFields.join(', ')} WHERE id = ?
    `).bind(...updateParams),
  ];

  await env.DB.batch(statements);

  return jsonResponse({
    transition: {
      id: transitionId, lot_id, from_stage: lot.current_stage, to_stage,
      quantity_in, quantity_out, unit, location_id, logged_by, notes
    }
  });
}

async function splitLot(request, env) {
  const body = await request.json();
  const { parent_lot_id, splits } = body;

  if (!parent_lot_id || !splits || !splits.length) {
    throw new ApiError('Missing required fields: parent_lot_id, splits', 'BAD_REQUEST', 400);
  }

  // Get parent lot
  const { results: lots } = await env.DB.prepare(
    'SELECT * FROM tracking_lots WHERE id = ?'
  ).bind(parent_lot_id).all();

  if (lots.length === 0) {
    throw new ApiError('Parent lot not found', 'NOT_FOUND', 404);
  }

  const parent = lots[0];
  const totalSplitQty = splits.reduce((sum, s) => sum + s.quantity, 0);

  if (totalSplitQty > parent.quantity) {
    throw new ApiError('Split quantity exceeds parent lot quantity', 'BAD_REQUEST', 400);
  }

  const children = [];
  const statements = [];

  for (const split of splits) {
    const childId = generateId();
    const lineageId = generateId();
    const transitionId = generateId();

    // Create child lot inheriting from parent
    statements.push(env.DB.prepare(`
      INSERT INTO tracking_lots (id, cultivar, seed_source, seed_lot_number, quantity, unit, germ_method, current_stage, current_location_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      childId, parent.cultivar, parent.seed_source, parent.seed_lot_number,
      split.quantity, split.unit || parent.unit, parent.germ_method,
      parent.current_stage, split.location_id || parent.current_location_id,
      split.notes || null
    ));

    // Create lineage record
    statements.push(env.DB.prepare(`
      INSERT INTO tracking_lot_lineage (id, parent_lot_id, child_lot_id, quantity, unit, reason, notes)
      VALUES (?, ?, ?, ?, ?, 'split', ?)
    `).bind(
      lineageId, parent_lot_id, childId, split.quantity,
      split.unit || parent.unit, split.notes || null
    ));

    // Create stage transition for child
    statements.push(env.DB.prepare(`
      INSERT INTO tracking_stage_transitions (id, lot_id, from_stage, to_stage, quantity_in, quantity_out, unit, location_id, notes)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)
    `).bind(
      transitionId, childId, parent.current_stage, split.quantity, split.quantity,
      split.unit || parent.unit, split.location_id || parent.current_location_id,
      `Split from lot ${parent_lot_id}`
    ));

    children.push({
      id: childId, cultivar: parent.cultivar, quantity: split.quantity,
      unit: split.unit || parent.unit, current_stage: parent.current_stage,
      location_id: split.location_id || parent.current_location_id
    });
  }

  // Reduce parent quantity
  statements.push(env.DB.prepare(`
    UPDATE tracking_lots SET quantity = quantity - ?, updated_at = datetime('now') WHERE id = ?
  `).bind(totalSplitQty, parent_lot_id));

  await env.DB.batch(statements);

  return jsonResponse({ children });
}

async function mergeLots(request, env) {
  const body = await request.json();
  const { target_lot_id, sources, notes } = body;

  if (!target_lot_id || !sources || !sources.length) {
    throw new ApiError('Missing required fields: target_lot_id, sources', 'BAD_REQUEST', 400);
  }

  // Verify target exists
  const { results: targets } = await env.DB.prepare(
    'SELECT * FROM tracking_lots WHERE id = ?'
  ).bind(target_lot_id).all();

  if (targets.length === 0) {
    throw new ApiError('Target lot not found', 'NOT_FOUND', 404);
  }

  const target = targets[0];
  let totalMerged = 0;
  const statements = [];

  // Validate each source lot has sufficient quantity before building batch
  for (const source of sources) {
    const { results: sourceLots } = await env.DB.prepare(
      'SELECT * FROM tracking_lots WHERE id = ?'
    ).bind(source.lot_id).all();

    if (sourceLots.length === 0) {
      throw new ApiError(`Source lot ${source.lot_id} not found`, 'NOT_FOUND', 404);
    }

    if (sourceLots[0].quantity < source.quantity) {
      throw new ApiError(
        `Source lot ${source.lot_id} has insufficient quantity (${sourceLots[0].quantity} available, ${source.quantity} requested)`,
        'BAD_REQUEST', 400
      );
    }
  }

  for (const source of sources) {
    const lineageId = generateId();

    // Create lineage record (parent=source, child=target)
    statements.push(env.DB.prepare(`
      INSERT INTO tracking_lot_lineage (id, parent_lot_id, child_lot_id, quantity, unit, reason, notes)
      VALUES (?, ?, ?, ?, ?, 'merge', ?)
    `).bind(
      lineageId, source.lot_id, target_lot_id, source.quantity,
      target.unit, notes || null
    ));

    // Reduce source lot quantity
    statements.push(env.DB.prepare(`
      UPDATE tracking_lots SET quantity = quantity - ?, updated_at = datetime('now') WHERE id = ?
    `).bind(source.quantity, source.lot_id));

    totalMerged += source.quantity;
  }

  // Increase target lot quantity
  statements.push(env.DB.prepare(`
    UPDATE tracking_lots SET quantity = quantity + ?, updated_at = datetime('now') WHERE id = ?
  `).bind(totalMerged, target_lot_id));

  await env.DB.batch(statements);

  return jsonResponse({ merged: true });
}

async function getLotHistory(request, env) {
  const url = new URL(request.url);
  const lotId = url.searchParams.get('lot_id');

  if (!lotId) {
    throw new ApiError('Missing lot_id parameter', 'BAD_REQUEST', 400);
  }

  // Stage transitions
  const { results: transitions } = await env.DB.prepare(
    "SELECT id, lot_id, from_stage, to_stage, quantity_in, quantity_out, unit, location_id, transitioned_at as event_date, logged_by, notes, 'transition' as type FROM tracking_stage_transitions WHERE lot_id = ?"
  ).bind(lotId).all();

  // Observations
  const { results: observations } = await env.DB.prepare(
    "SELECT id, lot_id, location_id, stage, observation_type, content, severity, observed_at as event_date, logged_by, 'observation' as type FROM tracking_observations WHERE lot_id = ?"
  ).bind(lotId).all();

  // Inputs
  const { results: inputs } = await env.DB.prepare(
    "SELECT id, lot_id, location_id, stage, input_type, product_name, amount, unit, applied_at as event_date, logged_by, notes, 'input' as type FROM tracking_inputs WHERE lot_id = ?"
  ).bind(lotId).all();

  // Lineage events (both as parent and child)
  const { results: lineage } = await env.DB.prepare(
    "SELECT id, parent_lot_id, child_lot_id, quantity, unit, reason, created_at as event_date, notes, 'lineage' as type FROM tracking_lot_lineage WHERE parent_lot_id = ? OR child_lot_id = ?"
  ).bind(lotId, lotId).all();

  // Combine and sort by date descending
  const timeline = [...transitions, ...observations, ...inputs, ...lineage]
    .sort((a, b) => (b.event_date || '').localeCompare(a.event_date || ''));

  return jsonResponse({ history: timeline });
}
