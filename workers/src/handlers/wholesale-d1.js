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
 * - GET  ?action=getQueue      - the production queue: ranked runs + order dates
 * - GET  ?action=getCoverage    - committed vs packed inventory, per cultivar
 * - POST ?action=saveRunOrder  - persist the run ranking
 * - POST ?action=importOrder   - create an order from Shopify SKUs (bot entry point)
 * - GET  ?action=test          - health check
 *
 * Design: docs/plans/2026-08-19-order-blocks-design.md
 */

import { query, queryOne, execute, transaction } from '../lib/db.js';
import { successResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { toLbs, fromLbs, pickRate, orderBlocks } from '../lib/wholesale.js';
import { scheduleQueue } from '../lib/queue-schedule.js';
import { allocate, moment, impliedStatus } from '../lib/burndown.js';
import { parseSku } from '../lib/sku.js';
import { summarizeInventory, assessCoverage } from '../lib/coverage.js';
import { formatDatePT } from '../lib/production-utils.js';

const WRITE_ACTIONS = new Set(['saveCustomer', 'deleteCustomer', 'saveOrder', 'deleteOrder', 'saveQueueOrder', 'setAccrualStart', 'importOrder']);

const ORDER_STATUSES = new Set(['in_queue', 'in_production', 'finished']);
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
    case 'getQueue': return getQueue(db, params);
    case 'getCoverage': return getCoverage(db);
    case 'saveQueueOrder': return saveQueueOrder(db, body);
    case 'setAccrualStart': return setAccrualStart(db, body);
    case 'importOrder': return importOrder(db, body);
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
  // `includeClosed` is the name migration 0019 retired. Both are accepted so the
  // two deploys — front end on Pages, worker on Cloudflare — can land in either
  // order without a window where the board sees no finished orders.
  const wantFinished = params.includeFinished === 'true' || params.includeClosed === 'true';
  const orders = await query(db, `
    SELECT o.*, COALESCE(NULLIF(c.company,''), c.name) AS customer_name
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    ${wantFinished ? '' : "WHERE o.status != 'finished'"}
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
      sku: it.sku,
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
  const status = body.status || 'in_queue';
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
    // Both stamped at insert, and neither can be left to a column default.
    //
    // `accrual_start` is when this order starts collecting recorded production.
    // It is the moment of saving, not the order date: order_date is a bare date
    // and midnight would credit an order typed this afternoon with the whole
    // morning's trim. Damon corrects it from his bot when the paperwork lagged.
    //
    // `queue_rank` makes "insertion order" mean something. Ordering by a column
    // that is NULL on every row is arbitrary order, not insertion order.
    const at = nowPT();
    orderFields.accrual_start = moment(at.date, at.minutes);
    orderFields.queue_rank = orderFields.updated_at;

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
  // `production_runs` was dropped by migration 0019 — under order blocks every
  // pass belongs to exactly one order, so a separate run table had nothing left
  // to say. This still tried to delete from it, and because the three run in one
  // batch, "no such table" aborted the whole thing: deleting any order failed
  // outright rather than partially.
  const statements = [
    { sql: 'DELETE FROM order_items WHERE order_id = ?', params: [body.id] },
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

// ─── PRODUCTION QUEUE ──────────────────────────────────

/**
 * Statuses whose demand is real enough to schedule — which, since migration 0019
 * collapsed the vocabulary, is every status except `finished`. Spelled as an
 * explicit list rather than `!== 'finished'` because the queue and the off-queue
 * list must partition the same set, and a fourth status added later should have
 * to be placed in one of them deliberately.
 */
const SCHEDULABLE = ["in_queue", "in_production"];

/**
 * Crew size, derived from what actually happened rather than typed.
 *
 * Trailing seven PRODUCTION days, not calendar days — a week with a holiday in
 * it would otherwise read as a smaller crew. Prefers effective_trimmers_line1,
 * which is already weighted for people joining or leaving mid-hour.
 *
 * Worth knowing when reading a date off this: across 2026-08-12..19 the real
 * figure moved between 3.8 and 12.3. A single number cannot be right for every
 * day, which is exactly why the board shows it and lets it be overridden.
 */
async function derivedCrew(db) {
  const rows = await query(db, `
    SELECT production_date,
           AVG(COALESCE(effective_trimmers_line1, trimmers_line1)) AS crew
    FROM monthly_production
    WHERE COALESCE(effective_trimmers_line1, trimmers_line1) > 0
    GROUP BY production_date
    ORDER BY production_date DESC
    LIMIT 7
  `);
  if (!rows.length) return { crew: 6, basis: "default", days: 0 };
  const crew = rows.reduce((s, r) => s + r.crew, 0) / rows.length;
  return { crew: Math.round(crew * 10) / 10, basis: "trailing-7", days: rows.length };
}

/** Per-cultivar rate table keyed for the scheduler, plus the farm fallback. */
async function rateTable(db) {
  const year = new Date().getUTCFullYear();
  const rows = await query(db, `
    SELECT a.cultivar_id, a.crop_year,
           SUM(mp.tops_lbs1 + mp.smalls_lbs1) AS lbs,
           SUM(mp.tops_lbs1)                  AS tops_lbs,
           SUM(COALESCE(mp.effective_trimmers_line1, mp.trimmers_line1)) AS hours
    FROM monthly_production mp
    JOIN cultivar_aliases a ON a.alias = mp.cultivar1
    WHERE COALESCE(mp.effective_trimmers_line1, mp.trimmers_line1) > 0
      AND (mp.tops_lbs1 + mp.smalls_lbs1) > 0
    GROUP BY a.cultivar_id, a.crop_year
  `);

  const sameYear = new Map(), allYears = new Map();
  let fLbs = 0, fTops = 0, fHours = 0;
  const add = (m, k, r) => {
    const b = m.get(k) || { lbs: 0, topsLbs: 0, hours: 0 };
    b.lbs += r.lbs; b.topsLbs += r.tops_lbs; b.hours += r.hours;
    m.set(k, b);
  };
  for (const r of rows) {
    add(allYears, r.cultivar_id, r);
    if (r.crop_year === year) add(sameYear, r.cultivar_id, r);
    fLbs += r.lbs; fTops += r.tops_lbs; fHours += r.hours;
  }
  const fallback = fHours > 0
    ? { ratePerTrimmerHour: fLbs / fHours, topsFraction: fTops / fLbs }
    : FALLBACK_SEED;

  const rates = {};
  for (const id of new Set([...allYears.keys(), ...sameYear.keys()])) {
    rates[id] = pickRate({
      sameYear: sameYear.get(id) || null,
      allYears: allYears.get(id) || null,
      minHours: MIN_RATE_HOURS,
      fallback,
    });
  }
  return { rates, fallback };
}

/** Persisted run ranking, pooled runs only. */
/**
 * The block ranking: order ids, best first.
 *
 * `queue_rank` is stamped at insert with the save timestamp, so an order book
 * nobody has dragged comes back in insertion order — decision 3. Ordering on a
 * column that were all NULL would be arbitrary, not insertion order, which is
 * why saveOrder writes it rather than leaving it to a default.
 */
async function savedRank(db) {
  const rows = await query(db, `
    SELECT id FROM orders
    WHERE status IN (${SCHEDULABLE.map(() => "?").join(", ")})
    ORDER BY queue_rank, id
  `, SCHEDULABLE);
  return rows.map(r => r.id);
}

/**
 * Recorded production, resolved to canonical cultivars.
 *
 * The alias join is exact (`a.alias = mp.cultivar1`), matching rateTable. The
 * bidirectional substring matching used elsewhere in the tree silently counts
 * "Sour Lifter" toward "Lifter"; here that would credit the wrong order.
 *
 * Line 2 is not read. Zero rows in 45 days carry any line-2 signal, and a
 * second line would need its own crew figure before its pounds could mean
 * anything. If one is ever brought up, this query is where it starts.
 */
async function recordedProduction(db, since) {
  return query(db, `
    SELECT mp.production_date AS date, mp.time_slot AS timeSlot,
           a.cultivar_id AS cultivarId,
           mp.tops_lbs1 AS topsLbs, mp.smalls_lbs1 AS smallsLbs
    FROM monthly_production mp
    JOIN cultivar_aliases a ON a.alias = mp.cultivar1
    WHERE mp.production_date >= ?
      AND (COALESCE(mp.tops_lbs1, 0) + COALESCE(mp.smalls_lbs1, 0)) > 0
  `, [since]);
}

/** Pacific wall-clock now, as the civil pair the scheduler and burn-down use. */
function nowPT() {
  const date = formatDatePT(new Date(), "yyyy-MM-dd");
  const [h, m] = new Date().toLocaleTimeString("en-GB", {
    timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", hour12: false,
  }).split(":").map(Number);
  return { date, minutes: h * 60 + m };
}

/**
 * Gather everything the queue needs, and run both engines over it.
 *
 * Shared by getQueue and the cron that advances statuses, so the board and the
 * automation can never disagree about how far along an order is.
 */
async function computeQueue(db, crewOverride) {
  const queued = await query(db, `
    SELECT i.id AS lineId, i.order_id AS orderId, i.cultivar_id AS cultivarId,
           i.form, i.qty_lbs AS qtyLbs, i.sort_order AS sortOrder,
           o.accrual_start AS accrualStart
    FROM order_items i
    JOIN orders o ON o.id = i.order_id
    WHERE o.status IN (${SCHEDULABLE.map(() => "?").join(", ")})
  `, SCHEDULABLE);

  const rank = await savedRank(db);
  const rankOf = new Map(rank.map((id, i) => [id, i]));

  // Burn-down reaches back only as far as the earliest order still in the queue
  // could accrue from. Scanning all of monthly_production would be both slower
  // and wrong — it would credit an order with last season's work.
  const earliest = queued.reduce(
    (min, l) => (l.accrualStart && l.accrualStart < min ? l.accrualStart : min),
    nowPT().date);
  const since = String(earliest).slice(0, 10);

  // FINISHED ORDERS STILL HOLD THEIR CLAIM ON PAST POUNDS.
  //
  // Allocation is a replay, not a ledger: every pound is dealt out again from
  // scratch on each read. So an order that has left the queue must still be
  // dealt its share, or the pounds it already consumed are handed to whoever is
  // next in line for that cultivar — and a second order would be credited with
  // work that is physically already spent.
  //
  // Bounded to orders accruing inside the same window being replayed. A
  // finished order older than that settled against entries this scan does not
  // read, so including it would let last season re-claim this season's work.
  const claimed = await query(db, `
    SELECT i.id AS lineId, i.order_id AS orderId, i.cultivar_id AS cultivarId,
           i.form, i.qty_lbs AS qtyLbs, i.sort_order AS sortOrder,
           o.accrual_start AS accrualStart, o.queue_rank AS queueRank
    FROM order_items i
    JOIN orders o ON o.id = i.order_id
    WHERE o.status = 'finished' AND o.accrual_start >= ?
  `, [since]);

  // Finished orders rank AHEAD of everything still queued. They took their
  // pounds while they were at the front, and the replay has to reproduce that
  // order or it will hand their share to a live order instead.
  const finishedRank = new Map(
    [...new Set(claimed.map(l => l.orderId))]
      .sort((a, b) => String(a).localeCompare(String(b)))
      .map((id, i) => [id, i - claimed.length - 1]));

  const entries = await recordedProduction(db, since);

  const progress = allocate({
    entries,
    lines: [
      ...claimed.map(l => ({ ...l, rank: finishedRank.get(l.orderId) })),
      ...queued.map(l => ({ ...l, rank: rankOf.get(l.orderId) ?? Number.MAX_SAFE_INTEGER })),
    ],
  });

  const [{ rates, fallback }, crewInfo, names] = await Promise.all([
    rateTable(db),
    derivedCrew(db),
    query(db, "SELECT id, name FROM cultivars"),
  ]);

  const crew = Number(crewOverride) > 0 ? Number(crewOverride) : crewInfo.crew;
  const start = nowPT();

  // Only the queue is scheduled. A finished order claims pounds but occupies no
  // floor time, so it must not appear as a block or push live orders back.
  const scheduled = scheduleQueue({
    blocks: orderBlocks(queued),
    rates, crew, rank, fallback, start,
    progress: progress.byLine,
  });

  return { ...scheduled, progress, rates, fallback, crewInfo, crew, start, names };
}

async function getQueue(db, params) {
  const q = await computeQueue(db, params.crew);
  const nameOf = new Map(q.names.map(n => [n.id, n.name]));

  return successResponse({
    success: true,
    crew: q.crew,
    crewBasis: Number(params.crew) > 0 ? "override" : q.crewInfo.basis,
    crewDays: q.crewInfo.days,
    start: q.start,
    fallback: q.fallback,
    blocks: q.blocks.map(b => ({
      ...b,
      passes: b.passes.map(p => ({
        ...p,
        cultivarName: nameOf.get(p.cultivarId) || p.cultivarId,
      })),
    })),
    orders: q.orders,
    // Pounds the floor recorded that no waiting order could take. Mostly this is
    // ordinary — most of what gets trimmed is not against a wholesale order —
    // but it is the number to look at when a block is not moving.
    unallocated: q.progress.unallocated,
  });
}

/**
 * Persist the block ranking.
 *
 * Every rank is rewritten rather than a fractional key inserted between two
 * neighbours. The column stays TEXT so fractional indexing remains available,
 * but with a handful of live orders a full rewrite in one batch is simpler and
 * has no contention worth designing around.
 *
 * Ranking moved from cultivars to ORDERS in the 2026-08-20 restructure. The
 * `production_runs` table this used to write is gone: under order blocks every
 * pass belongs to exactly one order, so a separate run table had nothing left
 * to say.
 */
async function saveQueueOrder(db, body) {
  const order = Array.isArray(body.order) ? body.order : null;
  if (!order) throw createError("VALIDATION_ERROR", "order must be an array of order ids");

  const known = await query(db, "SELECT id FROM orders");
  const ids = new Set(known.map(k => k.id));
  for (const id of order) {
    if (!ids.has(id)) throw createError("VALIDATION_ERROR", `Unknown order "${id}"`);
  }

  const now = new Date().toISOString();
  const statements = order.map((orderId, i) => ({
    sql: "UPDATE orders SET queue_rank = ?, updated_at = ? WHERE id = ?",
    params: [`a${String(i).padStart(4, "0")}`, now, orderId],
  }));
  await transaction(db, statements);
  return successResponse({ success: true, ranked: order.length });
}

/**
 * Move an order's accrual start.
 *
 * An order accrues recorded production from the moment it was saved. That is
 * right by default and wrong whenever the paperwork lags the floor — an order
 * agreed on Monday and typed on Wednesday would otherwise ignore two days of
 * its own trim. This is the correction, and it is Damon's to make from his
 * Telegram bot.
 *
 * Pacific wall-clock 'YYYY-MM-DD HH:MM', matching how hourly entries are
 * recorded, so no timezone conversion stands between the two.
 */
async function setAccrualStart(db, body) {
  const { orderId, accrualStart } = body;
  if (!orderId) throw createError("VALIDATION_ERROR", "orderId is required");
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(accrualStart || ""))) {
    throw createError("VALIDATION_ERROR",
      `accrualStart must be Pacific 'YYYY-MM-DD HH:MM', got "${accrualStart}"`);
  }

  const order = await queryOne(db, "SELECT id FROM orders WHERE id = ?", [orderId]);
  if (!order) throw createError("VALIDATION_ERROR", `No order ${orderId}`);

  await execute(db, "UPDATE orders SET accrual_start = ?, updated_at = ? WHERE id = ?",
    [accrualStart, new Date().toISOString(), orderId]);
  return successResponse({ success: true, orderId, accrualStart });
}

/**
 * Advance statuses from what the floor has actually recorded. Decision 5:
 * fully automatic — the first pound moves an order to `in_production`, and a
 * fully trimmed order goes to `finished`.
 *
 * THIS IS A WRITE, AND getQueue IS A READ. Doing it inside getQueue would make
 * an unauthenticated GET mutate the order book, and would only run while
 * somebody had the page open. It belongs on the cron, which already exists.
 *
 * Only forward transitions are applied. Nothing here moves an order backwards,
 * so a human who marked something finished early keeps that decision.
 */
export async function syncOrderStatuses(env) {
  const db = env.DB;
  const { progress } = await computeQueue(db);
  const rows = await query(db, `
    SELECT id, status FROM orders
    WHERE status IN (${SCHEDULABLE.map(() => "?").join(", ")})
  `, SCHEDULABLE);

  const FORWARD = { in_queue: 0, in_production: 1, finished: 2 };
  const now = new Date().toISOString();
  const statements = [];
  const moved = [];

  for (const row of rows) {
    const next = impliedStatus(progress.byOrder[row.id]);
    if (!next || FORWARD[next] <= FORWARD[row.status]) continue;
    statements.push({
      sql: "UPDATE orders SET status = ?, updated_at = ? WHERE id = ?",
      params: [next, now, row.id],
    });
    moved.push({ id: row.id, from: row.status, to: next });
  }

  if (statements.length) await transaction(db, statements);
  return moved;
}

// ─── COVERAGE ──────────────────────────────────────────

/**
 * Committed pounds against packed inventory, per cultivar and form.
 *
 * "Short" here is not an alarm. Through most of a season the bulk of inventory
 * is raw material waiting to be trimmed, so having committed more than is
 * currently packed is the ordinary state. What the operator needs to tell apart
 * is *nothing packed yet* from *nothing to pack*, which is why the raw sack
 * count travels with every shortfall.
 *
 * Raw sacks are reported as a count and never projected into pounds — that
 * projection lives in supersack-d1 (`tops_breakdown`), auth-gated and cached,
 * and a second copy of the math here would drift from it.
 */
async function getCoverage(db) {
  const demandRows = await query(db, `
    SELECT i.cultivar_id, i.form, SUM(i.qty_lbs) AS committed
    FROM order_items i
    JOIN orders o ON o.id = i.order_id
    WHERE o.status IN (${SCHEDULABLE.map(() => "?").join(", ")})
    GROUP BY i.cultivar_id, i.form
  `, SCHEDULABLE);

  if (!demandRows.length) {
    return successResponse({ success: true, coverage: [], byOrder: {}, skippedSkus: [] });
  }

  // Latest count per (sku, location) — an adjustment feed carries a running
  // total, so anything but the newest row per pair double-counts.
  const invRows = await query(db, `
    WITH latest AS (
      SELECT sku, location, new_total_available,
             ROW_NUMBER() OVER (PARTITION BY sku, location ORDER BY timestamp DESC, id DESC) rn
      FROM inventory_adjustments
      WHERE sku IS NOT NULL AND sku != ''
    )
    SELECT sku, SUM(new_total_available) AS units
    FROM latest WHERE rn = 1
    GROUP BY sku
  `);

  const prefixRows = await query(db,
    "SELECT id, name, sku_prefix FROM cultivars WHERE sku_prefix IS NOT NULL AND sku_prefix != ''");
  const prefixMap = {};
  const nameOf = new Map();
  for (const r of prefixRows) prefixMap[r.sku_prefix.toUpperCase()] = r.id;
  for (const r of await query(db, "SELECT id, name FROM cultivars")) nameOf.set(r.id, r.name);

  const inv = summarizeInventory(invRows.map(r => ({ sku: r.sku, units: r.units })), prefixMap);

  const coverage = assessCoverage(
    demandRows.map(r => ({ cultivarId: r.cultivar_id, form: r.form, committedLbs: r.committed })),
    inv,
  ).map(c => ({ ...c, cultivarName: nameOf.get(c.cultivarId) || c.cultivarId }));

  // Which orders touch a short line, so a card can flag itself without the
  // client having to re-derive the join.
  const shortKeys = new Set(coverage.filter(c => c.short).map(c => `${c.cultivarId}|${c.form}`));
  const byOrder = {};
  if (shortKeys.size) {
    const lines = await query(db, `
      SELECT i.order_id, i.cultivar_id, i.form
      FROM order_items i
      JOIN orders o ON o.id = i.order_id
      WHERE o.status IN (${SCHEDULABLE.map(() => "?").join(", ")})
    `, SCHEDULABLE);
    for (const l of lines) {
      if (!shortKeys.has(`${l.cultivar_id}|${l.form}`)) continue;
      (byOrder[l.order_id] ||= []).push({
        cultivarId: l.cultivar_id,
        cultivarName: nameOf.get(l.cultivar_id) || l.cultivar_id,
        form: l.form,
      });
    }
  }

  return successResponse({
    success: true,
    coverage: coverage.sort((a, b) => b.shortfallLbs - a.shortfallLbs),
    byOrder,
    // Surfaced rather than swallowed: a SKU nobody can parse is inventory that
    // silently is not being counted.
    skippedSkus: [...new Set(inv.skipped)],
  });
}

// ─── SHOPIFY IMPORT ────────────────────────────────────

/**
 * The customer every imported order attaches to until someone says otherwise.
 *
 * Buyer identity is deliberately not imported. This placeholder exists because
 * orders.customer_id is a NOT NULL foreign key, not because we want a stand-in
 * for a name — an operator can reassign the order to a nicknamed customer in
 * the app afterwards.
 */
const IMPORT_CUSTOMER = { id: "CUST-IMPORT", name: "Shopify import" };

async function ensureImportCustomer(db) {
  const existing = await queryOne(db, "SELECT id FROM customers WHERE id = ?", [IMPORT_CUSTOMER.id]);
  if (!existing) {
    await execute(db, "INSERT INTO customers (id, name, company) VALUES (?, ?, ?)",
      [IMPORT_CUSTOMER.id, IMPORT_CUSTOMER.name, IMPORT_CUSTOMER.name]);
  }
  return IMPORT_CUSTOMER.id;
}

/**
 * Create an order from Shopify line SKUs. The bots' write surface.
 *
 * WHAT THIS DELIBERATELY CANNOT DO:
 * There is no field here for a customer name, an address, or a dollar amount.
 * That is the enforcement — not a filter that could be forgotten, but an
 * endpoint with nowhere to put them. Anything extra in the body is ignored.
 * Prices are left at zero and the card renders no value at all rather than $0.
 *
 * WHY IT REFUSES SO READILY:
 * These orders are written unattended, at status `open`, which means they are
 * scheduled immediately and every date behind them moves. A SKU read wrongly
 * off a screenshot would attach real pounds to the wrong cultivar and quietly
 * reprice the queue. So every line is parsed and resolved BEFORE anything is
 * written, and one bad line rejects the whole import naming the line and the
 * reason. A loud failure the operator can re-shoot is much cheaper than a
 * plausible wrong number nobody notices.
 */
async function importOrder(db, body) {
  const orderRef = String(body.orderRef || "").trim();
  if (!orderRef) throw createError("VALIDATION_ERROR", "orderRef is required (the Shopify order number)");

  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) throw createError("VALIDATION_ERROR", "lines must be a non-empty array of { sku, quantity }");

  // Refuse a re-import rather than creating a second copy of the same order.
  const dupe = await queryOne(db, "SELECT id FROM orders WHERE shopify_order_id = ?", [orderRef]);
  if (dupe) {
    throw createError("VALIDATION_ERROR",
      `Shopify order ${orderRef} is already imported as ${dupe.id}`);
  }

  const prefixRows = await query(db,
    "SELECT id, name, sku_prefix FROM cultivars WHERE sku_prefix IS NOT NULL AND sku_prefix != ''");
  const byPrefix = new Map(prefixRows.map(r => [r.sku_prefix.toUpperCase(), r]));

  // Parse and resolve everything up front; nothing is written until all of it
  // succeeds.
  const resolved = lines.map((line, i) => {
    const where = `line ${i + 1}`;
    const qty = Number(line.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw createError("VALIDATION_ERROR", `${where}: quantity must be greater than zero`);
    }
    let parsed;
    try {
      parsed = parseSku(line.sku);
    } catch (e) {
      throw createError("VALIDATION_ERROR", `${where}: ${e.message}`);
    }
    const cultivar = byPrefix.get(parsed.prefix);
    if (!cultivar) {
      throw createError("VALIDATION_ERROR",
        `${where}: sku prefix "${parsed.prefix}" matches no cultivar — add it to the cultivars table first`);
    }
    return {
      cultivarId: cultivar.id,
      cultivarName: cultivar.name,
      form: parsed.form,
      qtyLbs: qty * parsed.packLbs,
      sku: String(line.sku).trim().toUpperCase(),
      quantity: qty,
    };
  });

  // Several pack sizes of the same cultivar and form are one line on the board.
  const merged = new Map();
  for (const r of resolved) {
    const key = `${r.cultivarId}|${r.form}`;
    const cur = merged.get(key);
    if (cur) { cur.qtyLbs += r.qtyLbs; cur.skus.push(r.sku); }
    else merged.set(key, { ...r, skus: [r.sku] });
  }
  const items = [...merged.values()];

  const customerId = body.customerId || await ensureImportCustomer(db);
  const customer = await queryOne(db, "SELECT id FROM customers WHERE id = ?", [customerId]);
  if (!customer) throw createError("VALIDATION_ERROR", `No customer ${customerId}`);

  const id = await nextId(db, "orders", "MO", new Date().getUTCFullYear());
  const now = new Date().toISOString();
  const importedAt = nowPT();

  const statements = [{
    sql: `INSERT INTO orders
            (id, customer_id, order_date, status, source, shopify_order_id, shopify_order_name,
             notes, updated_at, accrual_start, queue_rank)
          VALUES (?, ?, ?, 'in_queue', 'shopify', ?, ?, ?, ?, ?, ?)`,
    params: [id, customerId, now.slice(0, 10), orderRef, orderRef,
      `Imported from Shopify ${orderRef}`, now,
      moment(importedAt.date, importedAt.minutes), now],
  }];

  const stamp = Date.now();
  items.forEach((it, idx) => {
    statements.push({
      sql: `INSERT INTO order_items
              (id, order_id, cultivar_id, form, qty_lbs, entered_qty, entered_unit, unit_price, sku, sort_order, notes)
            VALUES (?, ?, ?, ?, ?, ?, 'lb', 0, ?, ?, ?)`,
      params: [`OI-${stamp}-${idx}`, id, it.cultivarId, it.form,
        it.qtyLbs, it.qtyLbs, it.skus.join(", "), idx,
        `${it.quantity} x ${it.skus[0]}`],
    });
  });

  await transaction(db, statements);

  return successResponse({
    success: true,
    id,
    orderRef,
    customerId,
    items: items.map(i => ({
      cultivar: i.cultivarName, form: i.form, qtyLbs: Math.round(i.qtyLbs * 100) / 100,
    })),
    totalLbs: Math.round(items.reduce((s, i) => s + i.qtyLbs, 0) * 100) / 100,
  });
}

export { fromLbs };
