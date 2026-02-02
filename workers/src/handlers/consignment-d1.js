/**
 * Consignment Module API Handler - D1 Version
 * Manages partner consignment tracking: intakes, sales, payments, inventory, balances
 */

import { query, queryOne, execute } from '../lib/db.js';
import { successResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { createError } from '../lib/errors.js';

// ===== READ ACTIONS =====

/**
 * Get all consignment partners with calculated balances
 */
async function getConsignmentPartners(env) {
  const partners = await query(env.DB, `
    SELECT
      p.id,
      p.name,
      p.contact_info,
      p.notes,
      p.status,
      p.created_at,
      COALESCE(inv.total_intake_lbs, 0) - COALESCE(sal.total_sold_lbs, 0) AS inventory_lbs,
      COALESCE(bal.amount_owed, 0) - COALESCE(pay.total_paid, 0) AS balance_owed,
      inv.last_intake_date,
      pay.last_payment_date
    FROM consignment_partners p
    LEFT JOIN (
      SELECT partner_id,
        SUM(weight_lbs) AS total_intake_lbs,
        MAX(date) AS last_intake_date
      FROM consignment_intakes
      GROUP BY partner_id
    ) inv ON inv.partner_id = p.id
    LEFT JOIN (
      SELECT partner_id,
        SUM(weight_lbs) AS total_sold_lbs
      FROM consignment_sales
      GROUP BY partner_id
    ) sal ON sal.partner_id = p.id
    LEFT JOIN (
      SELECT s.partner_id,
        SUM(s.weight_lbs * latest_price.price_per_lb) AS amount_owed
      FROM consignment_sales s
      JOIN (
        SELECT partner_id, strain, type, price_per_lb
        FROM consignment_intakes i1
        WHERE i1.id = (
          SELECT i2.id FROM consignment_intakes i2
          WHERE i2.partner_id = i1.partner_id
            AND i2.strain = i1.strain
            AND i2.type = i1.type
          ORDER BY i2.date DESC, i2.id DESC
          LIMIT 1
        )
      ) latest_price ON latest_price.partner_id = s.partner_id
        AND latest_price.strain = s.strain
        AND latest_price.type = s.type
      GROUP BY s.partner_id
    ) bal ON bal.partner_id = p.id
    LEFT JOIN (
      SELECT partner_id,
        SUM(amount) AS total_paid,
        MAX(date) AS last_payment_date
      FROM consignment_payments
      GROUP BY partner_id
    ) pay ON pay.partner_id = p.id
    ORDER BY p.name
  `);

  return successResponse({ success: true, data: partners });
}

/**
 * Get single partner detail with full history and inventory breakdown
 */
async function getConsignmentPartnerDetail(params, env) {
  const { id } = params;
  if (!id) throw createError('VALIDATION_ERROR', 'Partner ID is required');

  const partner = await queryOne(env.DB, `
    SELECT * FROM consignment_partners WHERE id = ?
  `, [id]);

  if (!partner) throw createError('NOT_FOUND', 'Partner not found');

  // Fetch intakes, sales, payments in parallel
  const [intakes, sales, payments, inventory, balanceData] = await Promise.all([
    query(env.DB, `
      SELECT * FROM consignment_intakes
      WHERE partner_id = ?
      ORDER BY date DESC, id DESC
    `, [id]),

    query(env.DB, `
      SELECT * FROM consignment_sales
      WHERE partner_id = ?
      ORDER BY date DESC, id DESC
    `, [id]),

    query(env.DB, `
      SELECT * FROM consignment_payments
      WHERE partner_id = ?
      ORDER BY date DESC, id DESC
    `, [id]),

    // Inventory by strain/type
    query(env.DB, `
      SELECT
        strain,
        type,
        COALESCE(SUM(intake_lbs), 0) - COALESCE(SUM(sold_lbs), 0) AS on_hand_lbs
      FROM (
        SELECT strain, type, weight_lbs AS intake_lbs, 0 AS sold_lbs
        FROM consignment_intakes WHERE partner_id = ?
        UNION ALL
        SELECT strain, type, 0 AS intake_lbs, weight_lbs AS sold_lbs
        FROM consignment_sales WHERE partner_id = ?
      )
      GROUP BY strain, type
      HAVING on_hand_lbs > 0
      ORDER BY strain, type
    `, [id, id]),

    // Balance calculation
    query(env.DB, `
      SELECT
        s.strain,
        s.type,
        SUM(s.weight_lbs) AS sold_lbs,
        latest_price.price_per_lb
      FROM consignment_sales s
      JOIN (
        SELECT partner_id, strain, type, price_per_lb
        FROM consignment_intakes i1
        WHERE i1.id = (
          SELECT i2.id FROM consignment_intakes i2
          WHERE i2.partner_id = i1.partner_id
            AND i2.strain = i1.strain
            AND i2.type = i1.type
          ORDER BY i2.date DESC, i2.id DESC
          LIMIT 1
        )
      ) latest_price ON latest_price.partner_id = s.partner_id
        AND latest_price.strain = s.strain
        AND latest_price.type = s.type
      WHERE s.partner_id = ?
      GROUP BY s.strain, s.type
    `, [id]),
  ]);

  const totalOwed = balanceData.reduce((sum, row) => sum + (row.sold_lbs * row.price_per_lb), 0);
  const totalPaid = payments.reduce((sum, row) => sum + row.amount, 0);
  const balanceOwed = totalOwed - totalPaid;

  return successResponse({
    success: true,
    data: {
      partner,
      intakes,
      sales,
      payments,
      inventory,
      balance_owed: balanceOwed,
      total_owed: totalOwed,
      total_paid: totalPaid,
    },
  });
}

/**
 * Get all active consignment strains
 */
async function getConsignmentStrains(env) {
  const strains = await query(env.DB, `
    SELECT * FROM consignment_strains
    WHERE active = 1
    ORDER BY name
  `);

  return successResponse({ success: true, data: strains });
}

/**
 * Get on-hand inventory by partner × strain × type
 */
async function getConsignmentInventory(params, env) {
  const { partner_id } = params;

  let sql = `
    SELECT
      p.id AS partner_id,
      p.name AS partner_name,
      inv.strain,
      inv.type,
      inv.on_hand_lbs
    FROM (
      SELECT
        partner_id,
        strain,
        type,
        COALESCE(SUM(intake_lbs), 0) - COALESCE(SUM(sold_lbs), 0) AS on_hand_lbs
      FROM (
        SELECT partner_id, strain, type, weight_lbs AS intake_lbs, 0 AS sold_lbs
        FROM consignment_intakes
        UNION ALL
        SELECT partner_id, strain, type, 0 AS intake_lbs, weight_lbs AS sold_lbs
        FROM consignment_sales
      )
      GROUP BY partner_id, strain, type
      HAVING on_hand_lbs > 0
    ) inv
    JOIN consignment_partners p ON p.id = inv.partner_id
  `;

  const sqlParams = [];
  if (partner_id) {
    sql += ` WHERE inv.partner_id = ?`;
    sqlParams.push(partner_id);
  }

  sql += ` ORDER BY p.name, inv.strain, inv.type`;

  const inventory = await query(env.DB, sql, sqlParams);

  return successResponse({ success: true, data: inventory });
}

/**
 * Get activity feed (union of intakes, sales, payments)
 */
async function getConsignmentActivity(params, env) {
  const { partner_id, offset } = params;
  let limit = parseInt(params.limit, 10) || 50;
  if (limit > 200) limit = 200;
  const off = parseInt(offset, 10) || 0;

  let partnerFilter = '';
  const sqlParams = [];

  if (partner_id) {
    partnerFilter = 'WHERE partner_id = ?';
    // Need to push 3 times for 3 union branches
    sqlParams.push(partner_id, partner_id, partner_id);
  }

  const activity = await query(env.DB, `
    SELECT * FROM (
      SELECT
        'intake' AS activity_type,
        i.id,
        i.partner_id,
        p.name AS partner_name,
        i.date,
        i.strain,
        i.type,
        i.weight_lbs,
        i.price_per_lb,
        NULL AS amount,
        NULL AS sale_price_per_lb,
        NULL AS channel,
        NULL AS method,
        NULL AS reference_number,
        i.created_at
      FROM consignment_intakes i
      JOIN consignment_partners p ON p.id = i.partner_id
      ${partnerFilter}

      UNION ALL

      SELECT
        'sale' AS activity_type,
        s.id,
        s.partner_id,
        p.name AS partner_name,
        s.date,
        s.strain,
        s.type,
        s.weight_lbs,
        NULL AS price_per_lb,
        NULL AS amount,
        s.sale_price_per_lb,
        s.channel,
        NULL AS method,
        NULL AS reference_number,
        s.created_at
      FROM consignment_sales s
      JOIN consignment_partners p ON p.id = s.partner_id
      ${partnerFilter}

      UNION ALL

      SELECT
        'payment' AS activity_type,
        pm.id,
        pm.partner_id,
        p.name AS partner_name,
        pm.date,
        NULL AS strain,
        NULL AS type,
        NULL AS weight_lbs,
        NULL AS price_per_lb,
        pm.amount,
        NULL AS sale_price_per_lb,
        NULL AS channel,
        pm.method,
        pm.reference_number,
        pm.created_at
      FROM consignment_payments pm
      JOIN consignment_partners p ON p.id = pm.partner_id
      ${partnerFilter}
    )
    ORDER BY date DESC, created_at DESC
    LIMIT ? OFFSET ?
  `, [...sqlParams, limit, off]);

  return successResponse({ success: true, data: activity });
}

// ===== WRITE ACTIONS =====

/**
 * Create or update a consignment partner
 */
async function saveConsignmentPartner(body, env) {
  if (!body.name) throw createError('VALIDATION_ERROR', 'Partner name is required');

  if (body.id) {
    // Update existing
    await execute(env.DB, `
      UPDATE consignment_partners
      SET name = ?, contact_info = ?, notes = ?, status = ?, updated_at = datetime('now')
      WHERE id = ?
    `, [body.name, body.contact_info || null, body.notes || null, body.status || 'active', body.id]);

    return successResponse({ success: true, data: { id: body.id } });
  }

  // Insert new
  const result = await execute(env.DB, `
    INSERT INTO consignment_partners (name, contact_info, notes, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `, [body.name, body.contact_info || null, body.notes || null, body.status || 'active']);

  return successResponse({ success: true, data: { id: result.lastRowId } });
}

/**
 * Insert a new consignment strain (ignore if exists)
 */
async function saveConsignmentStrain(body, env) {
  if (!body.name) throw createError('VALIDATION_ERROR', 'Strain name is required');

  await execute(env.DB, `
    INSERT OR IGNORE INTO consignment_strains (name, active, created_at)
    VALUES (?, 1, datetime('now'))
  `, [body.name]);

  // Return the strain (may already exist)
  const strain = await queryOne(env.DB, `
    SELECT * FROM consignment_strains WHERE name = ?
  `, [body.name]);

  return successResponse({ success: true, data: strain });
}

/**
 * Record a consignment intake
 */
async function saveConsignmentIntake(body, env) {
  const required = ['partner_id', 'date', 'strain', 'type', 'weight_lbs', 'price_per_lb'];
  for (const field of required) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      throw createError('VALIDATION_ERROR', `${field} is required`);
    }
  }

  if (!['tops', 'smalls'].includes(body.type)) {
    throw createError('VALIDATION_ERROR', 'Type must be "tops" or "smalls"');
  }

  if (parseFloat(body.weight_lbs) <= 0) {
    throw createError('VALIDATION_ERROR', 'weight_lbs must be positive');
  }

  if (parseFloat(body.price_per_lb) <= 0) {
    throw createError('VALIDATION_ERROR', 'price_per_lb must be positive');
  }

  // Auto-create strain if it doesn't exist
  await execute(env.DB, `
    INSERT OR IGNORE INTO consignment_strains (name, active, created_at)
    VALUES (?, 1, datetime('now'))
  `, [body.strain]);

  const result = await execute(env.DB, `
    INSERT INTO consignment_intakes (partner_id, date, strain, type, weight_lbs, price_per_lb, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `, [body.partner_id, body.date, body.strain, body.type, parseFloat(body.weight_lbs), parseFloat(body.price_per_lb), body.notes || null]);

  return successResponse({ success: true, data: { id: result.lastRowId } });
}

/**
 * Record a consignment sale (validates available inventory)
 */
async function saveConsignmentSale(body, env) {
  const required = ['partner_id', 'date', 'strain', 'type', 'weight_lbs'];
  for (const field of required) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      throw createError('VALIDATION_ERROR', `${field} is required`);
    }
  }

  if (!['tops', 'smalls'].includes(body.type)) {
    throw createError('VALIDATION_ERROR', 'Type must be "tops" or "smalls"');
  }

  const saleWeight = parseFloat(body.weight_lbs);
  if (saleWeight <= 0) {
    throw createError('VALIDATION_ERROR', 'weight_lbs must be positive');
  }

  // Check available inventory for this partner/strain/type
  const inventoryRow = await queryOne(env.DB, `
    SELECT
      COALESCE(SUM(CASE WHEN src = 'intake' THEN lbs ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN src = 'sale' THEN lbs ELSE 0 END), 0) AS available
    FROM (
      SELECT 'intake' AS src, weight_lbs AS lbs FROM consignment_intakes
      WHERE partner_id = ? AND strain = ? AND type = ?
      UNION ALL
      SELECT 'sale' AS src, weight_lbs AS lbs FROM consignment_sales
      WHERE partner_id = ? AND strain = ? AND type = ?
    )
  `, [body.partner_id, body.strain, body.type, body.partner_id, body.strain, body.type]);

  const available = inventoryRow?.available || 0;
  if (saleWeight > available) {
    throw createError('VALIDATION_ERROR',
      `Insufficient inventory. Available: ${available} lbs, requested: ${saleWeight} lbs`);
  }

  const result = await execute(env.DB, `
    INSERT INTO consignment_sales (partner_id, date, strain, type, weight_lbs, sale_price_per_lb, channel, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `, [
    body.partner_id, body.date, body.strain, body.type, saleWeight,
    body.sale_price_per_lb ? parseFloat(body.sale_price_per_lb) : null,
    body.channel || null, body.notes || null,
  ]);

  return successResponse({ success: true, data: { id: result.lastRowId } });
}

/**
 * Record a payment to a consignment partner
 */
async function saveConsignmentPayment(body, env) {
  const required = ['partner_id', 'date', 'amount'];
  for (const field of required) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      throw createError('VALIDATION_ERROR', `${field} is required`);
    }
  }

  const amount = parseFloat(body.amount);
  if (amount <= 0) {
    throw createError('VALIDATION_ERROR', 'Amount must be positive');
  }

  const result = await execute(env.DB, `
    INSERT INTO consignment_payments (partner_id, date, amount, method, reference_number, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `, [body.partner_id, body.date, amount, body.method || null, body.reference_number || null, body.notes || null]);

  return successResponse({ success: true, data: { id: result.lastRowId } });
}

// ===== MAIN HANDLER =====

export async function handleConsignmentD1(request, env, ctx) {
  const action = getAction(request);
  const params = getQueryParams(request);
  const body = request.method === 'POST' ? await parseBody(request) : {};

  const actions = {
    // Reads
    getConsignmentPartners: () => getConsignmentPartners(env),
    getConsignmentPartnerDetail: () => getConsignmentPartnerDetail(params, env),
    getConsignmentStrains: () => getConsignmentStrains(env),
    getConsignmentInventory: () => getConsignmentInventory(params, env),
    getConsignmentActivity: () => getConsignmentActivity(params, env),
    // Writes
    saveConsignmentPartner: () => saveConsignmentPartner(body, env),
    saveConsignmentStrain: () => saveConsignmentStrain(body, env),
    saveConsignmentIntake: () => saveConsignmentIntake(body, env),
    saveConsignmentSale: () => saveConsignmentSale(body, env),
    saveConsignmentPayment: () => saveConsignmentPayment(body, env),
  };

  if (!action || !actions[action]) {
    throw createError('VALIDATION_ERROR', `Unknown consignment action: ${action}`);
  }

  return actions[action]();
}
