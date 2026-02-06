/**
 * Consignment API Handler - D1
 * Manages partner farms, intakes, sales, payments, and balance calculations
 */

import { query, queryOne, execute } from '../lib/db.js';
import { successResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';

// Write actions that require authentication
const CONSIGNMENT_WRITE_ACTIONS = new Set([
  'saveConsignmentPartner', 'saveConsignmentStrain',
  'saveConsignmentIntake', 'saveConsignmentBatchIntake',
  'saveConsignmentSale', 'saveConsignmentInventoryCount',
  'saveConsignmentPayment',
  'deleteConsignmentPartner', 'deleteConsignmentIntake',
  'deleteConsignmentSale', 'deleteConsignmentPayment',
]);

export async function handleConsignmentD1(request, env, ctx) {
  const body = request.method === 'POST' ? await parseBody(request) : {};
  const action = getAction(request, body);
  const params = getQueryParams(request);
  const db = env.DB;

  // Require auth for write actions
  if (CONSIGNMENT_WRITE_ACTIONS.has(action)) {
    requireAuth(request, body, env, `consignment-${action}`);
  }

  switch (action) {
    // === PARTNERS ===
    case 'getConsignmentPartners':
      return getPartners(db);
    case 'getConsignmentPartnerDetail':
      return getPartnerDetail(db, params.id);
    case 'saveConsignmentPartner':
      return savePartner(db, body);

    // === STRAINS ===
    case 'getConsignmentStrains':
      return getStrains(db);
    case 'saveConsignmentStrain':
      return saveStrain(db, body);

    // === INTAKES ===
    case 'saveConsignmentIntake':
      return saveIntake(db, body);
    case 'saveConsignmentBatchIntake':
      return saveBatchIntake(db, body);

    // === SALES ===
    case 'saveConsignmentSale':
      return saveSale(db, body);
    case 'saveConsignmentInventoryCount':
      return saveInventoryCount(db, body);

    // === PAYMENTS ===
    case 'saveConsignmentPayment':
      return savePayment(db, body);

    // === INVENTORY ===
    case 'getConsignmentInventory':
      return getInventory(db, params);

    // === ACTIVITY ===
    case 'getConsignmentActivity':
      return getActivity(db, params);

    // === DELETES ===
    case 'deleteConsignmentPartner':
      return deletePartner(db, body);
    case 'deleteConsignmentIntake':
      return deleteIntake(db, body);
    case 'deleteConsignmentSale':
      return deleteSale(db, body);
    case 'deleteConsignmentPayment':
      return deletePayment(db, body);

    default:
      throw createError('NOT_FOUND', `Unknown consignment action: ${action}`);
  }
}

// ─── PARTNERS ───────────────────────────────────────────

async function getPartners(db) {
  const partners = await query(db, 'SELECT * FROM consignment_partners ORDER BY name');

  const enriched = await Promise.all(partners.map(async (p) => {
    // Get inventory on hand
    const inv = await queryOne(db, `
      SELECT COALESCE(SUM(intake_lbs), 0) - COALESCE(SUM(sale_lbs), 0) as on_hand
      FROM (
        SELECT weight_lbs as intake_lbs, 0 as sale_lbs FROM consignment_intakes WHERE partner_id = ?
        UNION ALL
        SELECT 0 as intake_lbs, weight_lbs as sale_lbs FROM consignment_sales WHERE partner_id = ?
      )
    `, [p.id, p.id]);

    // Get balance owed: sum of (sold lbs * intake price) - payments
    const owedResult = await queryOne(db, `
      SELECT COALESCE(SUM(sub.owed), 0) as total_owed
      FROM (
        SELECT s.weight_lbs * COALESCE(
          (SELECT i.price_per_lb FROM consignment_intakes i
           WHERE i.partner_id = s.partner_id AND i.strain = s.strain AND i.type = s.type
           ORDER BY i.date DESC LIMIT 1), 0
        ) as owed
        FROM consignment_sales s
        WHERE s.partner_id = ?
      ) sub
    `, [p.id]);

    const payments = await queryOne(db, `
      SELECT COALESCE(SUM(amount), 0) as total, MAX(date) as last_date
      FROM consignment_payments WHERE partner_id = ?
    `, [p.id]);

    const lastIntake = await queryOne(db, `
      SELECT MAX(date) as last_date FROM consignment_intakes WHERE partner_id = ?
    `, [p.id]);

    const totalOwed = (owedResult?.total_owed || 0) - (payments?.total || 0);

    return {
      ...p,
      balance_owed: Math.max(0, totalOwed),
      inventory_lbs: inv?.on_hand || 0,
      last_intake_date: lastIntake?.last_date || null,
      last_payment_date: payments?.last_date || null,
    };
  }));

  return successResponse({ success: true, data: enriched });
}

async function getPartnerDetail(db, partnerId) {
  if (!partnerId) throw createError('VALIDATION_ERROR', 'Partner ID required');

  const partner = await queryOne(db, 'SELECT * FROM consignment_partners WHERE id = ?', [partnerId]);
  if (!partner) throw createError('NOT_FOUND', 'Partner not found');

  const intakes = await query(db, 'SELECT * FROM consignment_intakes WHERE partner_id = ? ORDER BY date DESC', [partnerId]);
  const sales = await query(db, 'SELECT * FROM consignment_sales WHERE partner_id = ? ORDER BY date DESC', [partnerId]);
  const payments = await query(db, 'SELECT * FROM consignment_payments WHERE partner_id = ? ORDER BY date DESC', [partnerId]);

  // Calculate balance
  let totalOwed = 0;
  for (const sale of sales) {
    const intake = await queryOne(db, `
      SELECT price_per_lb FROM consignment_intakes
      WHERE partner_id = ? AND strain = ? AND type = ?
      ORDER BY date DESC LIMIT 1
    `, [partnerId, sale.strain, sale.type]);
    totalOwed += sale.weight_lbs * (intake?.price_per_lb || 0);
  }
  const totalPayments = payments.reduce((sum, p) => sum + p.amount, 0);

  // Inventory by strain+type
  const inventory = await query(db, `
    SELECT strain, type,
      COALESCE(SUM(intake_lbs), 0) - COALESCE(SUM(sale_lbs), 0) as on_hand_lbs
    FROM (
      SELECT strain, type, weight_lbs as intake_lbs, 0 as sale_lbs FROM consignment_intakes WHERE partner_id = ?
      UNION ALL
      SELECT strain, type, 0 as intake_lbs, weight_lbs as sale_lbs FROM consignment_sales WHERE partner_id = ?
    )
    GROUP BY strain, type
    HAVING on_hand_lbs > 0
    ORDER BY strain, type
  `, [partnerId, partnerId]);

  return successResponse({
    success: true,
    data: {
      partner,
      intakes,
      sales,
      payments,
      inventory,
      balance_owed: Math.max(0, totalOwed - totalPayments),
      total_paid: totalPayments,
    }
  });
}

async function savePartner(db, body) {
  const { id, name, contact_name, email, phone, notes } = body;
  if (!name || !name.trim()) throw createError('VALIDATION_ERROR', 'Partner name is required');

  if (id) {
    await execute(db, `
      UPDATE consignment_partners SET name = ?, contact_name = ?, email = ?, phone = ?, notes = ?
      WHERE id = ?
    `, [name.trim(), contact_name || null, email || null, phone || null, notes || null, id]);
    return successResponse({ success: true, id });
  } else {
    const result = await execute(db, `
      INSERT INTO consignment_partners (name, contact_name, email, phone, notes)
      VALUES (?, ?, ?, ?, ?)
    `, [name.trim(), contact_name || null, email || null, phone || null, notes || null]);
    return successResponse({ success: true, id: result.lastRowId });
  }
}

// ─── STRAINS ────────────────────────────────────────────

async function getStrains(db) {
  const strains = await query(db, 'SELECT * FROM consignment_strains WHERE active = 1 ORDER BY name');
  return successResponse({ success: true, data: strains });
}

async function saveStrain(db, body) {
  const { name } = body;
  if (!name || !name.trim()) throw createError('VALIDATION_ERROR', 'Strain name is required');

  const result = await execute(db, 'INSERT OR IGNORE INTO consignment_strains (name) VALUES (?)', [name.trim()]);
  return successResponse({ success: true, id: result.lastRowId });
}

// ─── INTAKES ────────────────────────────────────────────

async function saveIntake(db, body) {
  const { partner_id, date, strain, type, weight_lbs, price_per_lb, notes } = body;

  if (!partner_id) throw createError('VALIDATION_ERROR', 'Partner is required');
  if (!date) throw createError('VALIDATION_ERROR', 'Date is required');
  if (!strain) throw createError('VALIDATION_ERROR', 'Strain is required');
  if (!type || !['tops', 'smalls'].includes(type)) throw createError('VALIDATION_ERROR', 'Type must be tops or smalls');
  if (!weight_lbs || weight_lbs <= 0) throw createError('VALIDATION_ERROR', 'Weight must be positive');
  if (!price_per_lb || price_per_lb <= 0) throw createError('VALIDATION_ERROR', 'Price per lb must be positive');

  const result = await execute(db, `
    INSERT INTO consignment_intakes (partner_id, date, strain, type, weight_lbs, price_per_lb, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [partner_id, date, strain, type, weight_lbs, price_per_lb, notes || null]);

  return successResponse({ success: true, id: result.lastRowId });
}

async function saveBatchIntake(db, body) {
  const { partner_id, date, items, notes } = body;
  
  if (!partner_id) throw createError('VALIDATION_ERROR', 'Partner is required');
  if (!date) throw createError('VALIDATION_ERROR', 'Date is required');
  if (!items || !Array.isArray(items) || items.length === 0) throw createError('VALIDATION_ERROR', 'At least one item is required');
  
  // Generate batch ID for grouping multi-line intakes
  const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const results = [];
  for (const item of items) {
    const { strain, type, weight_lbs, price_per_lb } = item;
    if (!strain) throw createError('VALIDATION_ERROR', 'Strain is required for all items');
    if (!type || !['tops', 'smalls'].includes(type)) throw createError('VALIDATION_ERROR', 'Type must be tops or smalls');
    if (!weight_lbs || weight_lbs <= 0) throw createError('VALIDATION_ERROR', 'Weight must be positive');
    if (!price_per_lb || price_per_lb <= 0) throw createError('VALIDATION_ERROR', 'Price per lb must be positive');
    
    const result = await execute(db, `
      INSERT INTO consignment_intakes (partner_id, date, strain, type, weight_lbs, price_per_lb, notes, batch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [partner_id, date, strain.trim(), type, weight_lbs, price_per_lb, notes || null, batchId]);
    
    results.push({ id: result.lastRowId, strain, type, weight_lbs });
  }
  
  return successResponse({ success: true, data: { count: results.length, items: results, batch_id: batchId } });
}

// ─── SALES ──────────────────────────────────────────────

async function saveSale(db, body) {
  const { partner_id, date, strain, type, weight_lbs, sale_price_per_lb, channel, notes } = body;

  if (!partner_id) throw createError('VALIDATION_ERROR', 'Partner is required');
  if (!date) throw createError('VALIDATION_ERROR', 'Date is required');
  if (!strain) throw createError('VALIDATION_ERROR', 'Strain is required');
  if (!type || !['tops', 'smalls'].includes(type)) throw createError('VALIDATION_ERROR', 'Type must be tops or smalls');
  if (!weight_lbs || weight_lbs <= 0) throw createError('VALIDATION_ERROR', 'Weight must be positive');

  // Check available inventory
  const inv = await queryOne(db, `
    SELECT
      COALESCE((SELECT SUM(weight_lbs) FROM consignment_intakes WHERE partner_id = ? AND strain = ? AND type = ?), 0) -
      COALESCE((SELECT SUM(weight_lbs) FROM consignment_sales WHERE partner_id = ? AND strain = ? AND type = ?), 0)
      as available
  `, [partner_id, strain, type, partner_id, strain, type]);

  if (inv.available < weight_lbs) {
    throw createError('VALIDATION_ERROR', `Only ${inv.available.toFixed(1)} lbs available (requested ${weight_lbs})`);
  }

  const result = await execute(db, `
    INSERT INTO consignment_sales (partner_id, date, strain, type, weight_lbs, sale_price_per_lb, channel, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [partner_id, date, strain, type, weight_lbs, sale_price_per_lb || null, channel || 'retail', notes || null]);

  return successResponse({ success: true, id: result.lastRowId });
}

// ─── INVENTORY COUNT ────────────────────────────────────

async function saveInventoryCount(db, body) {
  const { partner_id, date, strain, type, counted_lbs, notes } = body;
  
  // Validate
  if (!partner_id) throw createError('VALIDATION_ERROR', 'Partner is required');
  if (!date) throw createError('VALIDATION_ERROR', 'Date is required');
  if (!strain) throw createError('VALIDATION_ERROR', 'Strain is required');
  if (!type || !['tops', 'smalls'].includes(type)) throw createError('VALIDATION_ERROR', 'Type must be tops or smalls');
  if (counted_lbs == null || counted_lbs < 0) throw createError('VALIDATION_ERROR', 'Count must be zero or positive');
  
  // Calculate expected on hand
  const inv = await queryOne(db, `
    SELECT
      COALESCE((SELECT SUM(weight_lbs) FROM consignment_intakes WHERE partner_id = ? AND strain = ? AND type = ?), 0) -
      COALESCE((SELECT SUM(weight_lbs) FROM consignment_sales WHERE partner_id = ? AND strain = ? AND type = ?), 0)
      as expected
  `, [partner_id, strain, type, partner_id, strain, type]);
  
  const expected = inv?.expected || 0;
  const sold = Math.max(0, expected - counted_lbs);
  
  // If there's a difference (stuff was sold), auto-create a sale record
  if (sold > 0) {
    // Get the intake price for this strain/type from most recent intake
    const priceRow = await queryOne(db, `
      SELECT price_per_lb FROM consignment_intakes 
      WHERE partner_id = ? AND strain = ? AND type = ?
      ORDER BY date DESC LIMIT 1
    `, [partner_id, strain, type]);
    
    await execute(db, `
      INSERT INTO consignment_sales (partner_id, date, strain, type, weight_lbs, sale_price_per_lb, channel, notes)
      VALUES (?, ?, ?, ?, ?, ?, 'inventory_count', ?)
    `, [partner_id, date, strain, type, sold, priceRow?.price_per_lb || null, 
        `Inventory count: ${counted_lbs} lbs on hand (expected ${expected.toFixed(1)} lbs)`]);
  }
  
  return successResponse({ 
    success: true, 
    data: {
      expected_lbs: expected,
      counted_lbs: counted_lbs,
      sold_lbs: sold,
      auto_sale_created: sold > 0
    }
  });
}

// ─── PAYMENTS ───────────────────────────────────────────

async function savePayment(db, body) {
  const { partner_id, date, amount, method, reference_number, notes } = body;

  if (!partner_id) throw createError('VALIDATION_ERROR', 'Partner is required');
  if (!date) throw createError('VALIDATION_ERROR', 'Date is required');
  if (!amount || amount <= 0) throw createError('VALIDATION_ERROR', 'Amount must be positive');

  const result = await execute(db, `
    INSERT INTO consignment_payments (partner_id, date, amount, method, reference_number, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [partner_id, date, amount, method || 'check', reference_number || null, notes || null]);

  return successResponse({ success: true, id: result.lastRowId });
}

// ─── INVENTORY ──────────────────────────────────────────

async function getInventory(db, params) {
  const partnerId = params.partner_id;

  let sql, binds;

  if (partnerId) {
    sql = `
      SELECT sub.partner_id, p.name as partner_name, sub.strain, sub.type,
        COALESCE(SUM(sub.intake_lbs), 0) as total_intake,
        COALESCE(SUM(sub.sale_lbs), 0) as total_sold,
        COALESCE(SUM(sub.intake_lbs), 0) - COALESCE(SUM(sub.sale_lbs), 0) as on_hand_lbs
      FROM (
        SELECT partner_id, strain, type, weight_lbs as intake_lbs, 0 as sale_lbs
        FROM consignment_intakes WHERE partner_id = ?
        UNION ALL
        SELECT partner_id, strain, type, 0 as intake_lbs, weight_lbs as sale_lbs
        FROM consignment_sales WHERE partner_id = ?
      ) sub
      LEFT JOIN consignment_partners p ON p.id = sub.partner_id
      GROUP BY sub.partner_id, sub.strain, sub.type
      HAVING on_hand_lbs > 0
      ORDER BY p.name, sub.strain, sub.type
    `;
    binds = [partnerId, partnerId];
  } else {
    sql = `
      SELECT sub.partner_id, p.name as partner_name, sub.strain, sub.type,
        COALESCE(SUM(sub.intake_lbs), 0) as total_intake,
        COALESCE(SUM(sub.sale_lbs), 0) as total_sold,
        COALESCE(SUM(sub.intake_lbs), 0) - COALESCE(SUM(sub.sale_lbs), 0) as on_hand_lbs
      FROM (
        SELECT partner_id, strain, type, weight_lbs as intake_lbs, 0 as sale_lbs
        FROM consignment_intakes
        UNION ALL
        SELECT partner_id, strain, type, 0 as intake_lbs, weight_lbs as sale_lbs
        FROM consignment_sales
      ) sub
      LEFT JOIN consignment_partners p ON p.id = sub.partner_id
      GROUP BY sub.partner_id, sub.strain, sub.type
      HAVING on_hand_lbs > 0
      ORDER BY p.name, sub.strain, sub.type
    `;
    binds = [];
  }

  const inventory = await query(db, sql, binds);
  return successResponse({ success: true, data: inventory });
}

// ─── ACTIVITY FEED ──────────────────────────────────────

async function getActivity(db, params) {
  const limit = Math.min(parseInt(params.limit) || 50, 200);
  const offset = parseInt(params.offset) || 0;
  const partnerId = params.partner_id;

  let sql, binds;

  if (partnerId) {
    sql = `
      SELECT * FROM (
        SELECT 'intake' as activity_type, id, partner_id, date, strain, type, weight_lbs, price_per_lb as price, NULL as amount, NULL as method, batch_id, notes, created_at
        FROM consignment_intakes WHERE partner_id = ?
        UNION ALL
        SELECT 'sale' as activity_type, id, partner_id, date, strain, type, weight_lbs, sale_price_per_lb as price, NULL as amount, channel as method, NULL as batch_id, notes, created_at
        FROM consignment_sales WHERE partner_id = ?
        UNION ALL
        SELECT 'payment' as activity_type, id, partner_id, date, NULL as strain, NULL as type, NULL as weight_lbs, NULL as price, amount, method, NULL as batch_id, notes, created_at
        FROM consignment_payments WHERE partner_id = ?
      )
      ORDER BY date DESC, created_at DESC
      LIMIT ? OFFSET ?
    `;
    binds = [partnerId, partnerId, partnerId, limit, offset];
  } else {
    sql = `
      SELECT * FROM (
        SELECT 'intake' as activity_type, id, partner_id, date, strain, type, weight_lbs, price_per_lb as price, NULL as amount, NULL as method, batch_id, notes, created_at
        FROM consignment_intakes
        UNION ALL
        SELECT 'sale' as activity_type, id, partner_id, date, strain, type, weight_lbs, sale_price_per_lb as price, NULL as amount, channel as method, NULL as batch_id, notes, created_at
        FROM consignment_sales
        UNION ALL
        SELECT 'payment' as activity_type, id, partner_id, date, NULL as strain, NULL as type, NULL as weight_lbs, NULL as price, amount, method, NULL as batch_id, notes, created_at
        FROM consignment_payments
      )
      ORDER BY date DESC, created_at DESC
      LIMIT ? OFFSET ?
    `;
    binds = [limit, offset];
  }

  const activity = await query(db, sql, binds);

  // Enrich with partner names
  const partnerIds = [...new Set(activity.map(a => a.partner_id))];
  const partners = {};
  for (const pid of partnerIds) {
    const p = await queryOne(db, 'SELECT name FROM consignment_partners WHERE id = ?', [pid]);
    if (p) partners[pid] = p.name;
  }

  const enriched = activity.map(a => ({
    ...a,
    partner_name: partners[a.partner_id] || 'Unknown',
  }));

  return successResponse({ success: true, data: enriched });
}

// ─── DELETES ────────────────────────────────────────────

async function deletePartner(db, body) {
  const { id } = body;
  if (!id) throw createError('VALIDATION_ERROR', 'Partner ID is required');
  
  // Delete all related records first
  await execute(db, 'DELETE FROM consignment_intakes WHERE partner_id = ?', [id]);
  await execute(db, 'DELETE FROM consignment_sales WHERE partner_id = ?', [id]);
  await execute(db, 'DELETE FROM consignment_payments WHERE partner_id = ?', [id]);
  await execute(db, 'DELETE FROM consignment_partners WHERE id = ?', [id]);
  
  return successResponse({ success: true });
}

async function deleteIntake(db, body) {
  const { id } = body;
  if (!id) throw createError('VALIDATION_ERROR', 'Intake ID is required');
  await execute(db, 'DELETE FROM consignment_intakes WHERE id = ?', [id]);
  return successResponse({ success: true });
}

async function deleteSale(db, body) {
  const { id } = body;
  if (!id) throw createError('VALIDATION_ERROR', 'Sale ID is required');
  await execute(db, 'DELETE FROM consignment_sales WHERE id = ?', [id]);
  return successResponse({ success: true });
}

async function deletePayment(db, body) {
  const { id } = body;
  if (!id) throw createError('VALIDATION_ERROR', 'Payment ID is required');
  await execute(db, 'DELETE FROM consignment_payments WHERE id = ?', [id]);
  return successResponse({ success: true });
}
