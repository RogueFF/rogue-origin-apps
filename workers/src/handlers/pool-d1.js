/**
 * Pool Inventory Management - D1 Handler
 * Handles bin registry, transactions, and balance queries
 */

import { jsonResponse, errorResponse } from '../lib/response.js';
import { ApiError } from '../lib/errors.js';

export async function handlePoolD1(request, env) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  switch (action) {
    case 'listBins':
      return await listBins(request, env);
    case 'getBin':
      return await getBin(request, env);
    case 'createBin':
      return await createBin(request, env);
    case 'updateBin':
      return await updateBin(request, env);
    case 'deleteBin':
      return await deleteBin(request, env);
    case 'recordTransaction':
      return await recordTransaction(request, env);
    case 'getTransactions':
      return await getTransactions(request, env);
    case 'getBinBalance':
      return await getBinBalance(request, env);
    case 'getAllBalances':
      return await getAllBalances(request, env);
    case 'getDashboard':
      return await getDashboard(request, env);
    default:
      throw new ApiError(`Unknown action: ${action}`, 400);
  }
}

/**
 * List all bins with optional filters
 * Query params: source, type, cultivar, active
 */
async function listBins(request, env) {
  const url = new URL(request.url);
  const source = url.searchParams.get('source');
  const type = url.searchParams.get('type');
  const cultivar = url.searchParams.get('cultivar');
  const active = url.searchParams.get('active') !== 'false'; // default true

  let query = 'SELECT * FROM bins WHERE active = ?';
  const params = [active ? 1 : 0];

  if (source) {
    query += ' AND source = ?';
    params.push(source);
  }
  if (type) {
    query += ' AND type = ?';
    params.push(type);
  }
  if (cultivar) {
    query += ' AND cultivar LIKE ?';
    params.push(`%${cultivar}%`);
  }

  query += ' ORDER BY bin_number ASC';

  const { results } = await env.DB.prepare(query).bind(...params).all();

  return jsonResponse({ bins: results });
}

/**
 * Get single bin by ID with balance
 */
async function getBin(request, env) {
  const url = new URL(request.url);
  const binId = url.searchParams.get('binId');

  if (!binId) {
    throw new ApiError('Missing binId parameter', 400);
  }

  const binQuery = `
    SELECT b.*, bb.current_lbs, bb.total_intakes_lbs, bb.total_dispenses_lbs,
           bb.last_intake_at, bb.last_dispense_at
    FROM bins b
    LEFT JOIN bin_balances bb ON b.id = bb.bin_id
    WHERE b.id = ?
  `;

  const { results } = await env.DB.prepare(binQuery).bind(binId).all();

  if (results.length === 0) {
    throw new ApiError('Bin not found', 404);
  }

  return jsonResponse({ bin: results[0] });
}

/**
 * Create new bin
 * Body: { bin_number, cultivar, type, source, capacity_lbs }
 */
async function createBin(request, env) {
  const body = await request.json();
  const { bin_number, cultivar, type, source, capacity_lbs = 12.5 } = body;

  if (!bin_number || !cultivar || !type || !source) {
    throw new ApiError('Missing required fields: bin_number, cultivar, type, source', 400);
  }

  if (!['tops', 'smalls'].includes(type)) {
    throw new ApiError('Invalid type. Must be: tops, smalls', 400);
  }

  if (!['in-house', 'consignment'].includes(source)) {
    throw new ApiError('Invalid source. Must be: in-house, consignment', 400);
  }

  // Insert bin
  const binResult = await env.DB.prepare(`
    INSERT INTO bins (bin_number, cultivar, type, source, capacity_lbs)
    VALUES (?, ?, ?, ?, ?)
  `).bind(bin_number, cultivar, type, source, capacity_lbs).run();

  const binId = binResult.meta.last_row_id;

  // Initialize balance
  await env.DB.prepare(`
    INSERT INTO bin_balances (bin_id, current_lbs, total_intakes_lbs, total_dispenses_lbs)
    VALUES (?, 0, 0, 0)
  `).bind(binId).run();

  return jsonResponse({ 
    success: true, 
    binId,
    message: 'Bin created successfully' 
  });
}

/**
 * Update bin details
 * Body: { binId, cultivar, type, active }
 */
async function updateBin(request, env) {
  const body = await request.json();
  const { binId, cultivar, type, active } = body;

  if (!binId) {
    throw new ApiError('Missing binId', 400);
  }

  const updates = [];
  const params = [];

  if (cultivar !== undefined) {
    updates.push('cultivar = ?');
    params.push(cultivar);
  }
  if (type !== undefined) {
    if (!['tops', 'smalls'].includes(type)) {
      throw new ApiError('Invalid type. Must be: tops, smalls', 400);
    }
    updates.push('type = ?');
    params.push(type);
  }
  if (active !== undefined) {
    updates.push('active = ?');
    params.push(active ? 1 : 0);
  }

  if (updates.length === 0) {
    throw new ApiError('No fields to update', 400);
  }

  updates.push('updated_at = datetime(\'now\')');
  params.push(binId);

  await env.DB.prepare(`
    UPDATE bins 
    SET ${updates.join(', ')}
    WHERE id = ?
  `).bind(...params).run();

  return jsonResponse({ 
    success: true, 
    message: 'Bin updated successfully' 
  });
}

/**
 * Delete bin (soft delete by setting active = 0)
 */
async function deleteBin(request, env) {
  const body = await request.json();
  const { binId } = body;

  if (!binId) {
    throw new ApiError('Missing binId', 400);
  }

  await env.DB.prepare('UPDATE bins SET active = 0 WHERE id = ?').bind(binId).run();

  return jsonResponse({ 
    success: true, 
    message: 'Bin archived successfully' 
  });
}

/**
 * Record pool transaction (intake, dispense, adjustment, waste)
 * Body: { binId, type, weight_lbs, source_ref, package_size, package_count, notes }
 */
async function recordTransaction(request, env) {
  const body = await request.json();
  const { binId, type, weight_lbs, source_ref, package_size, package_count, notes } = body;

  if (!binId || !type || weight_lbs === undefined) {
    throw new ApiError('Missing required fields: binId, type, weight_lbs', 400);
  }

  if (!['intake', 'dispense', 'adjustment', 'waste'].includes(type)) {
    throw new ApiError('Invalid type. Must be: intake, dispense, adjustment, waste', 400);
  }

  // Insert transaction
  await env.DB.prepare(`
    INSERT INTO pool_transactions (bin_id, type, weight_lbs, source_ref, package_size, package_count, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(binId, type, weight_lbs, source_ref || null, package_size || null, package_count || null, notes || null).run();

  // Update balance
  const delta = (type === 'intake' || type === 'adjustment') ? weight_lbs : -weight_lbs;

  await env.DB.prepare(`
    UPDATE bin_balances
    SET current_lbs = current_lbs + ?,
        total_intakes_lbs = total_intakes_lbs + CASE WHEN ? = 'intake' THEN ? ELSE 0 END,
        total_dispenses_lbs = total_dispenses_lbs + CASE WHEN ? IN ('dispense', 'waste') THEN ? ELSE 0 END,
        last_intake_at = CASE WHEN ? = 'intake' THEN datetime('now') ELSE last_intake_at END,
        last_dispense_at = CASE WHEN ? IN ('dispense', 'waste') THEN datetime('now') ELSE last_dispense_at END,
        last_updated = datetime('now')
    WHERE bin_id = ?
  `).bind(delta, type, weight_lbs, type, weight_lbs, type, type, binId).run();

  return jsonResponse({ 
    success: true, 
    message: 'Transaction recorded successfully' 
  });
}

/**
 * Get transactions for a bin
 * Query params: binId, type, limit, offset
 */
async function getTransactions(request, env) {
  const url = new URL(request.url);
  const binId = url.searchParams.get('binId');
  const type = url.searchParams.get('type');
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const offset = parseInt(url.searchParams.get('offset') || '0');

  let query = 'SELECT * FROM pool_transactions WHERE 1=1';
  const params = [];

  if (binId) {
    query += ' AND bin_id = ?';
    params.push(binId);
  }
  if (type) {
    query += ' AND type = ?';
    params.push(type);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await env.DB.prepare(query).bind(...params).all();

  return jsonResponse({ transactions: results });
}

/**
 * Get balance for a bin
 */
async function getBinBalance(request, env) {
  const url = new URL(request.url);
  const binId = url.searchParams.get('binId');

  if (!binId) {
    throw new ApiError('Missing binId parameter', 400);
  }

  const { results } = await env.DB.prepare(`
    SELECT bb.*, b.bin_number, b.cultivar, b.type, b.source, b.capacity_lbs
    FROM bin_balances bb
    JOIN bins b ON bb.bin_id = b.id
    WHERE bb.bin_id = ?
  `).bind(binId).all();

  if (results.length === 0) {
    throw new ApiError('Bin not found', 404);
  }

  return jsonResponse({ balance: results[0] });
}

/**
 * Get all balances with bin details
 */
async function getAllBalances(request, env) {
  const url = new URL(request.url);
  const source = url.searchParams.get('source');
  const type = url.searchParams.get('type');

  let query = `
    SELECT bb.*, b.bin_number, b.cultivar, b.type, b.source, b.capacity_lbs, b.active
    FROM bin_balances bb
    JOIN bins b ON bb.bin_id = b.id
    WHERE b.active = 1
  `;
  const params = [];

  if (source) {
    query += ' AND b.source = ?';
    params.push(source);
  }
  if (type) {
    query += ' AND b.type = ?';
    params.push(type);
  }

  query += ' ORDER BY b.bin_number ASC';

  const { results } = await env.DB.prepare(query).bind(...params).all();

  return jsonResponse({ balances: results });
}

/**
 * Dashboard summary
 * Returns: total bins, total weight, low stock alerts, recent transactions
 */
async function getDashboard(request, env) {
  // Summary stats
  const statsQuery = `
    SELECT 
      COUNT(DISTINCT b.id) as total_bins,
      SUM(bb.current_lbs) as total_weight_lbs,
      SUM(bb.total_intakes_lbs) as total_intakes_lbs,
      SUM(bb.total_dispenses_lbs) as total_dispenses_lbs,
      COUNT(DISTINCT CASE WHEN bb.current_lbs < 3 THEN b.id END) as low_stock_count
    FROM bins b
    JOIN bin_balances bb ON b.id = bb.bin_id
    WHERE b.active = 1
  `;

  const { results: stats } = await env.DB.prepare(statsQuery).all();

  // Low stock bins (< 3 lbs)
  const lowStockQuery = `
    SELECT b.bin_number, b.cultivar, b.type, b.source, bb.current_lbs
    FROM bins b
    JOIN bin_balances bb ON b.id = bb.bin_id
    WHERE b.active = 1 AND bb.current_lbs < 3
    ORDER BY bb.current_lbs ASC
  `;

  const { results: lowStock } = await env.DB.prepare(lowStockQuery).all();

  // Recent transactions (last 20)
  const recentQuery = `
    SELECT pt.*, b.bin_number, b.cultivar, b.type
    FROM pool_transactions pt
    JOIN bins b ON pt.bin_id = b.id
    ORDER BY pt.created_at DESC
    LIMIT 20
  `;

  const { results: recent } = await env.DB.prepare(recentQuery).all();

  return jsonResponse({
    summary: stats[0],
    lowStock,
    recentTransactions: recent
  });
}
