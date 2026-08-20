/**
 * /api/wholesale — wholesale orders with real line items.
 *
 * Replaces the Wholesale Orders app retired in 611da09e. That app could only
 * express one strain and one kg total per order, so multi-cultivar orders were
 * recorded in prose; this one stores them as rows.
 *
 * Deliberately NOT mounted on /api/orders. That path is now an auth endpoint
 * that Consignment posts to in order to unlock its page, and breaking it to
 * reuse a name would be a poor trade.
 *
 * Endpoints:
 * - GET  ?action=getCultivars  - the order picker's source of truth
 * - GET  ?action=getCustomers  - customer list
 * - POST ?action=saveCustomer  - create/update a customer
 * - POST ?action=deleteCustomer
 * - GET  ?action=getOrders     - orders with their line items and customer
 * - POST ?action=saveOrder     - upsert an order and replace its line items
 * - POST ?action=deleteOrder
 * - GET  ?action=getRates      - per-cultivar trim rate + where it came from
 * - GET  ?action=test          - health check
 *
 * Design: docs/plans/2026-08-19-order-blocks-design.md
 */

import { query, queryOne, execute, transaction } from '../lib/db.js';
import { successResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { toLbs, fromLbs, pickRate } from '../lib/wholesale.js';

const WRITE_ACTIONS = new Set(['saveCustomer', 'deleteCustomer', 'saveOrder', 'deleteOrder']);

const ORDER_STATUSES = new Set(['draft', 'open', 'in_production', 'shipped', 'closed']);
const FORMS = new Set(['tops', 'smalls']);
const UNITS = new Set(['lb', 'kg']);

/**
 * Cultivars with less trim history than this produce a rate too noisy to
 * promise a date on. The thinnest rows in monthly_production are the worst —
 * Critical Berries reports an implausible 0.0% tops share on 7 hours.
 */
const MIN_RATE_HOURS = 20;

/**
 * Farm-wide average across all cultivars, used only when a cultivar has no
 * usable history of its own. Recomputed from live data on every getRates call
 * rather than hardcoded, so it tracks the operation instead of drifting.
 */
const FALLBACK_SEED = { ratePerTrimmerHour: 1.67, topsFraction: 0.539 };

export async function handleWholesaleD1(request, env) {
  const body = request.method === 'POST' ? await parseBody(request) : {};
  const action = getAction(request, body);
  const params = getQueryParams(request);
  const db = env.DB;

  if (WRITE_ACTIONS.has(action)) {
    requireAuth(request, body, env, `wholesale-${action}`);
  }

  switch (action) {
    case 'getCultivars': return getCultivars(db, params);
    case 'getCustomers': return getCustomers(db);
    case 'saveCustomer': return saveCustomer(db, body);
    case 'deleteCustomer': return deleteCustomer(db, body);
    case 'getOrders': return getOrders(db, params);
    case 'saveOrder': return saveOrder(db, body);
    case 'deleteOrder': return deleteOrder(db, body);
    case 'getRates': return getRates(db);
    case 'test': return successResponse({ success: true, message: 'Wholesale API operational' });
    default:
      throw createError('NOT_FOUND', `Unknown wholesale action: ${action}`);
  }
}

// ─── IDS ───────────────────────────────────────────────
// Human-readable and sequential per year, matching the MO-2026-001 convention
// the old app used on invoices. Volume is a handful of orders a year from one
// operator, so MAX+1 is not worth hardening into a sequence table.

async function nextId(db, table, prefix, year) {
  const like = `${prefix}-${year}-%`;
  const row = await queryOne(db,
    `SELECT id FROM ${table} WHERE id LIKE ? ORDER BY id DESC LIMIT 1`, [like]);
  const n = row ? parseInt(String(row.id).split('-').pop(), 10) + 1 : 1;
  return `${prefix}-${year}-${String(n).padStart(3, '0')}`;
}

// ─── CULTIVARS ─────────────────────────────────────────

async function getCultivars(db, params) {
  const includeInactive = params.includeInactive === 'true';
  const rows = await query(db, `
    SELECT id, name, sku_prefix, active
    FROM cultivars
    ${includeInactive ? '' : 'WHERE active = 1'}
    ORDER BY name
  `);
  return successResponse({
    success: true,
    cultivars: rows.map(r => ({
      id: r.id, name: r.name, skuPrefix: r.sku_prefix, active: !!r.active,
    })),
  });
}

// ─── CUSTOMERS ─────────────────────────────────────────

async function getCustomers(db) {
  const rows = await query(db, `
    SELECT id, name, company, email, phone, address, city, state, zip, notes
    FROM customers ORDER BY COALESCE(NULLIF(company,''), name)
  `);
  return successResponse({ success: true, customers: rows });
}

async function saveCustomer(db, body) {
  const name = String(body.name || '').trim();
  if (!name) throw createError('VALIDATION_ERROR', 'Customer name is required');

  const fields = {
    name,
    company: body.company ?? '',
    email: body.email ?? '',
    phone: body.phone ?? '',
    address: body.address ?? '',
    city: body.city ?? '',
    state: body.state ?? '',
    zip: body.zip ?? '',
    notes: body.notes ?? '',
  };

  if (body.id) {
    const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ');
    const res = await execute(db,
      `UPDATE customers SET ${sets} WHERE id = ?`, [...Object.values(fields), body.id]);
    if (!res.changes) throw createError('NOT_FOUND', `No customer ${body.id}`);
    return successResponse({ success: true, id: body.id });
  }

  const id = await nextId(db, 'customers', 'CUST', new Date().getUTCFullYear());
  const cols = ['id', ...Object.keys(fields)];
  await execute(db,
    `INSERT INTO customers (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    [id, ...Object.values(fields)]);
  return successResponse({ success: true, id });
}

async function deleteCustomer(db, body) {
  if (!body.id) throw createError('VALIDATION_ERROR', 'Customer id is required');
  // orders.customer_id is a hard FK; deleting out from under an order would
  // leave a dangling reference. Refuse with a message that says why.
  const used = await queryOne(db,
    'SELECT COUNT(*) n FROM orders WHERE customer_id = ?', [body.id]);
  if (used && used.n > 0) {
    throw createError('VALIDATION_ERROR',
      `Customer ${body.id} still has ${used.n} order(s) — delete or reassign them first`);
  }
  const res = await execute(db, 'DELETE FROM customers WHERE id = ?', [body.id]);
  if (!res.changes) throw createError('NOT_FOUND', `No customer ${body.id}`);
  return successResponse({ success: true, id: body.id });
}

// ─── ORDERS ────────────────────────────────────────────

async function getOrders(db, params) {
  const wantClosed = params.includeClosed === 'true';
  const orders = await query(db, `
    SELECT o.*, COALESCE(NULLIF(c.company,''), c.name) AS customer_name
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    ${wantClosed ? '' : "WHERE o.status != 'closed'"}
    ORDER BY o.order_date DESC, o.id DESC
  `);
  if (!orders.length) return successResponse({ success: true, orders: [] });

  const items = await query(db, `
    SELECT i.*, cv.name AS cultivar_name
    FROM order_items i
    JOIN cultivars cv ON cv.id = i.cultivar_id
    ORDER BY i.order_id, i.sort_order, i.id
  `);

  const byOrder = new Map();
  for (const it of items) {
    if (!byOrder.has(it.order_id)) byOrder.set(it.order_id, []);
    byOrder.get(it.order_id).push({
      id: it.id,
      cultivarId: it.cultivar_id,
      cultivarName: it.cultivar_name,
      form: it.form,
      qtyLbs: it.qty_lbs,
      // Redisplay in the unit the operator typed. Older rows may predate the
      // entered_* columns being populated, so fall back to pounds.
      enteredQty: it.entered_qty ?? it.qty_lbs,
      enteredUnit: it.entered_unit ?? 'lb',
      unitPrice: it.unit_price,
      lineTotal: (it.entered_qty ?? it.qty_lbs) * (it.unit_price || 0),
      notes: it.notes,
    });
  }

  return successResponse({
    success: true,
    orders: orders.map(o => {
      const lines = byOrder.get(o.id) || [];
      return {
        id: o.id,
        customerId: o.customer_id,
        customerName: o.customer_name,
        orderDate: o.order_date,
        status: o.status,
        paymentTerms: o.payment_terms,
        notes: o.notes,
        source: o.source,
        items: lines,
        totalLbs: lines.reduce((s, l) => s + l.qtyLbs, 0),
        totalValue: lines.reduce((s, l) => s + l.lineTotal, 0),
      };
    }),
  });
}

/**
 * Upsert an order and replace its line items wholesale.
 *
 * Replace-all rather than diff: the client always sends the complete line set,
 * and a partial diff would need stable client-side ids for rows the operator
 * has not saved yet. Delete + insert runs in one D1 batch so a failure cannot
 * leave an order with no lines.
 */
async function saveOrder(db, body) {
  const status = body.status || 'draft';
  if (!ORDER_STATUSES.has(status)) {
    throw createError('VALIDATION_ERROR',
      `Invalid status "${status}" — expected one of: ${[...ORDER_STATUSES].join(', ')}`);
  }
  if (!body.customerId) throw createError('VALIDATION_ERROR', 'customerId is required');

  const customer = await queryOne(db, 'SELECT id FROM customers WHERE id = ?', [body.customerId]);
  if (!customer) throw createError('VALIDATION_ERROR', `No customer ${body.customerId}`);

  const items = Array.isArray(body.items) ? body.items : [];
  const prepared = await prepareItems(db, items);

  const isNew = !body.id;
  const id = body.id || await nextId(db, 'orders', 'MO', new Date().getUTCFullYear());

  const orderFields = {
    customer_id: body.customerId,
    order_date: body.orderDate || new Date().toISOString().slice(0, 10),
    status,
    payment_terms: body.paymentTerms ?? '',
    notes: body.notes ?? '',
    updated_at: new Date().toISOString(),
  };

  const statements = [];
  if (isNew) {
    const cols = ['id', ...Object.keys(orderFields)];
    statements.push({
      sql: `INSERT INTO orders (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      params: [id, ...Object.values(orderFields)],
    });
  } else {
    const existing = await queryOne(db, 'SELECT id FROM orders WHERE id = ?', [id]);
    if (!existing) throw createError('NOT_FOUND', `No order ${id}`);
    statements.push({
      sql: `UPDATE orders SET ${Object.keys(orderFields).map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
      params: [...Object.values(orderFields), id],
    });
  }

  statements.push({ sql: 'DELETE FROM order_items WHERE order_id = ?', params: [id] });

  const stamp = Date.now();
  prepared.forEach((it, idx) => {
    statements.push({
      sql: `INSERT INTO order_items
              (id, order_id, cultivar_id, form, qty_lbs, entered_qty, entered_unit,
               unit_price, sku, sort_order, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        `OI-${stamp}-${idx}`, id, it.cultivarId, it.form, it.qtyLbs,
        it.enteredQty, it.enteredUnit, it.unitPrice, it.sku, idx, it.notes,
      ],
    });
  });

  await transaction(db, statements);
  return successResponse({ success: true, id, itemCount: prepared.length });
}

/**
 * Validate and canonicalise line items before any of them are written.
 *
 * Every check happens up front so a bad third line cannot leave the first two
 * inserted. Quantities are stored in pounds, with the operator's original entry
 * kept alongside so a kg order redisplays as kg forever.
 */
async function prepareItems(db, items) {
  if (!items.length) return [];

  const ids = [...new Set(items.map(i => i.cultivarId))];
  const known = await query(db,
    `SELECT id FROM cultivars WHERE id IN (${ids.map(() => '?').join(', ')})`, ids);
  const knownIds = new Set(known.map(r => r.id));

  return items.map((raw, idx) => {
    const where = `line ${idx + 1}`;
    if (!knownIds.has(raw.cultivarId)) {
      throw createError('VALIDATION_ERROR',
        `${where}: unknown cultivar "${raw.cultivarId}" — pick one from getCultivars`);
    }
    if (!FORMS.has(raw.form)) {
      throw createError('VALIDATION_ERROR',
        `${where}: invalid form "${raw.form}" — expected tops or smalls`);
    }
    const unit = raw.unit || 'lb';
    if (!UNITS.has(unit)) {
      throw createError('VALIDATION_ERROR', `${where}: invalid unit "${unit}" — expected lb or kg`);
    }
    const qty = Number(raw.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw createError('VALIDATION_ERROR', `${where}: quantity must be greater than zero`);
    }

    return {
      cultivarId: raw.cultivarId,
      form: raw.form,
      qtyLbs: toLbs(qty, unit),
      enteredQty: qty,
      enteredUnit: unit,
      unitPrice: Number(raw.unitPrice) || 0,
      sku: raw.sku ?? null,
      notes: raw.notes ?? null,
    };
  });
}

async function deleteOrder(db, body) {
  if (!body.id) throw createError('VALIDATION_ERROR', 'Order id is required');
  const statements = [
    { sql: 'DELETE FROM order_items WHERE order_id = ?', params: [body.id] },
    { sql: 'DELETE FROM production_runs WHERE dedicated_order_id = ?', params: [body.id] },
    { sql: 'DELETE FROM orders WHERE id = ?', params: [body.id] },
  ];
  await transaction(db, statements);
  return successResponse({ success: true, id: body.id });
}

// ─── RATES ─────────────────────────────────────────────

/**
 * Per-cultivar trim rate and tops share, resolved through cultivar_aliases.
 *
 * The alias join is the point. monthly_production spells a cultivar
 * '2025 - Sour Lifter / Sungrown'; an order line says 'sour-lifter'. Matching
 * on the literal string — which the old getEffectiveTargetRate does — sees one
 * crop year of Lifter instead of all four, and finds nothing at all for a
 * cultivar recorded only as numbered phenotypes.
 */
async function getRates(db) {
  const year = new Date().getUTCFullYear();

  const rows = await query(db, `
    SELECT a.cultivar_id,
           a.crop_year,
           SUM(mp.tops_lbs1 + mp.smalls_lbs1) AS lbs,
           SUM(mp.tops_lbs1)                  AS tops_lbs,
           SUM(COALESCE(mp.effective_trimmers_line1, mp.trimmers_line1)) AS hours
    FROM monthly_production mp
    JOIN cultivar_aliases a ON a.alias = mp.cultivar1
    WHERE COALESCE(mp.effective_trimmers_line1, mp.trimmers_line1) > 0
      AND (mp.tops_lbs1 + mp.smalls_lbs1) > 0
    GROUP BY a.cultivar_id, a.crop_year
  `);

  const sameYear = new Map();
  const allYears = new Map();
  let farmLbs = 0, farmTops = 0, farmHours = 0;

  const add = (map, key, r) => {
    const b = map.get(key) || { lbs: 0, topsLbs: 0, hours: 0 };
    b.lbs += r.lbs; b.topsLbs += r.tops_lbs; b.hours += r.hours;
    map.set(key, b);
  };

  for (const r of rows) {
    add(allYears, r.cultivar_id, r);
    if (r.crop_year === year) add(sameYear, r.cultivar_id, r);
    farmLbs += r.lbs; farmTops += r.tops_lbs; farmHours += r.hours;
  }

  // Recomputed from live data rather than hardcoded, so the fallback tracks
  // the operation. FALLBACK_SEED only covers a database with no history yet.
  const fallback = farmHours > 0
    ? { ratePerTrimmerHour: farmLbs / farmHours, topsFraction: farmTops / farmLbs }
    : FALLBACK_SEED;

  const cultivars = await query(db, 'SELECT id, name FROM cultivars WHERE active = 1 ORDER BY name');

  return successResponse({
    success: true,
    minHours: MIN_RATE_HOURS,
    fallback,
    rates: cultivars.map(c => ({
      cultivarId: c.id,
      cultivarName: c.name,
      ...pickRate({
        sameYear: sameYear.get(c.id) || null,
        allYears: allYears.get(c.id) || null,
        minHours: MIN_RATE_HOURS,
        fallback,
      }),
    })),
  });
}

export { fromLbs };
