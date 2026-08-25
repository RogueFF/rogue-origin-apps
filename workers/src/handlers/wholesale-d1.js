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
 * - POST ?action=deleteCustomer
 * - GET  ?action=getOrders     - orders with their line items
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
import { sendTelegramMessage } from '../lib/telegram.js';
import { deriveEvents } from '../lib/wholesale-notify.js';
import { buildQueueBrief } from '../lib/queue-brief.js';

const WRITE_ACTIONS = new Set(['saveOrder', 'deleteOrder', 'saveQueueOrder', 'setAccrualStart', 'importOrder', 'setNotify']);

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
    case 'getOrders': return getOrders(db, params);
    case 'saveOrder': return saveOrder(db, body);
    case 'deleteOrder': return deleteOrder(db, body);
    case 'getRates': return getRates(db);
    case 'getQueue': return getQueue(db, params);
    case 'getQueueBrief': return getQueueBrief(db, params);
    case 'getCoverage': return getCoverage(db);
    case 'getNotify': return getNotify(db);
    case 'setNotify': return setNotify(db, body);
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

// ─── ORDERS ────────────────────────────────────────────

async function getOrders(db, params) {
  // `includeClosed` is the name migration 0019 retired. Both are accepted so the
  // two deploys — front end on Pages, worker on Cloudflare — can land in either
  // order without a window where the board sees no finished orders.
  const wantFinished = params.includeFinished === 'true' || params.includeClosed === 'true';
  const orders = await query(db, `
    SELECT * FROM orders
    ${wantFinished ? '' : "WHERE status != 'finished'"}
    ORDER BY order_date DESC, id DESC
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
        // What the floor calls this order. The customer dimension it replaced
        // held two rows, one of them called "test".
        nickname: o.nickname,
        orderDate: o.order_date,
        status: o.status,
        // The number the operator actually uses. `MO-2026-002` is an internal
        // key; orders are referenced by their Shopify order number, which
        // `importOrder` already writes and which is now editable by hand for
        // orders that were entered rather than imported.
        shopifyOrderName: o.shopify_order_name,
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
  // An absent status means "no opinion", not "reset it". The board's copy of an
  // order can be up to a minute old, so a quick edit made while the cron was
  // advancing that order would otherwise write the stale status back and drag a
  // finished order into the queue, moving every date behind it.
  const existing = body.id
    ? await queryOne(db, 'SELECT status FROM orders WHERE id = ?', [body.id])
    : null;
  const status = body.status || existing?.status || 'in_queue';
  if (!ORDER_STATUSES.has(status)) {
    throw createError('VALIDATION_ERROR',
      `Invalid status "${status}" — expected one of: ${[...ORDER_STATUSES].join(', ')}`);
  }
  const items = Array.isArray(body.items) ? body.items : [];

  // AN ORDER WITH NO LINES CANNOT BE SEEN. The queue is built from line items,
  // so it produces no block; and the off-queue list is the complement of the
  // queue, so a still-queued status excludes it from there too. It exists, it
  // is scheduled against nothing, and no screen shows it. Refused here rather
  // than in one client, because the bot writes through this path as well.
  if (!items.length) {
    throw createError('VALIDATION_ERROR',
      'An order needs at least one line item — delete the order instead');
  }

  const prepared = await prepareItems(db, items);

  const isNew = !body.id;
  const id = body.id || await nextId(db, 'orders', 'MO', new Date().getUTCFullYear());

  const orderFields = {
    nickname: String(body.nickname || '').trim() || null,
    order_date: body.orderDate || new Date().toISOString().slice(0, 10),
    status,
    payment_terms: body.paymentTerms ?? '',
    notes: body.notes ?? '',
    updated_at: new Date().toISOString(),
  };

  // Only written when the caller says something about it. An absent key must
  // leave an imported order's number alone rather than blanking it — the
  // difference between "no opinion" and "clear this" matters here, because
  // importOrder sets this and a later edit from anywhere else would wipe it.
  if (body.shopifyOrderName !== undefined) {
    orderFields.shopify_order_name = String(body.shopifyOrderName || '').trim() || null;
  }

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
    //
    // THE PREFIX IS LOad-BEARING. Ranks written by a drag look like `a0000`,
    // and SQLite compares TEXT byte by byte: a bare ISO timestamp starts with a
    // digit, and digits sort before letters. So a new order stamped with its
    // timestamp landed BEFORE every dragged order — first on the board, first
    // in the queue, and first claim on every future pound of its cultivars.
    // Silent, and it armed itself the first time anybody reordered anything.
    // `z` puts a new order after the ranked ones, which is what the back of the
    // queue means.
    const at = nowPT();
    orderFields.accrual_start = moment(at.date, at.minutes);
    orderFields.queue_rank = `z${orderFields.updated_at}`;

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
  // Validated before the lookup below binds them: a line with no cultivar used
  // to reach the query as `undefined` and fail as a 500, where the operator
  // deserves the sentence that says which line is wrong.
  for (const [i, it] of items.entries()) {
    if (!it.cultivarId) {
      throw createError('VALIDATION_ERROR', `Line ${i + 1}: pick a cultivar`);
    }
    if (!(Number(it.qty) > 0)) {
      throw createError('VALIDATION_ERROR', `Line ${i + 1}: quantity must be greater than zero`);
    }
  }

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
 * FIVE PRODUCTION DAYS, WEIGHTED BY HOURS WORKED. Both halves of that were
 * measured on real data rather than chosen:
 *
 * - The window was seven days and it lagged badly. Across the last ten
 *   production days the daily average ran 3.8, 7.5, 7.6, 7.7, 8.5, 8.6, 9.7,
 *   11.7, 12.3, 14.25 — a crew that has been growing. Seven days reported 9.7
 *   while the floor was running 14. Five reports 10.9.
 * - Weighting is by slot, so a five-slot half day counts for half a full one.
 *   On today's data that barely moves the number (9.70 to 9.74 over seven
 *   days), which says the lag was the window and not the short days — worth
 *   recording so nobody re-litigates it.
 *
 * The spread is the reason this is not simply today's count. A single light day
 * of four people would stretch every date in the queue by weeks, and an order
 * spanning twelve work days depends on the crew across those days, not on this
 * morning's. Today's figure is reported separately so the operator can see the
 * gap and take it deliberately.
 */
async function derivedCrew(db) {
  const row = await queryOne(db, `
    WITH d AS (
      SELECT DISTINCT production_date FROM monthly_production
      WHERE COALESCE(effective_trimmers_line1, trimmers_line1) > 0
      ORDER BY production_date DESC LIMIT 5
    )
    SELECT AVG(COALESCE(m.effective_trimmers_line1, m.trimmers_line1)) AS crew,
           COUNT(DISTINCT m.production_date) AS days
    FROM monthly_production m
    JOIN d ON d.production_date = m.production_date
    WHERE COALESCE(m.effective_trimmers_line1, m.trimmers_line1) > 0
  `);
  if (!row || !row.crew) return { crew: 6, basis: "default", days: 0 };
  return { crew: Math.round(row.crew * 10) / 10, basis: "trailing-5", days: row.days };
}

/**
 * Who is on the line on the most recent day anything was recorded.
 *
 * Reported, never used to schedule. It is the number to reach for when the
 * floor is plainly busier or thinner than usual, and the operator is better
 * placed than an average to judge whether today is going to hold.
 */
async function liveCrew(db) {
  const row = await queryOne(db, `
    SELECT AVG(COALESCE(effective_trimmers_line1, trimmers_line1)) AS crew,
           COUNT(*) AS slots,
           production_date AS date
    FROM monthly_production
    WHERE production_date = (
            SELECT MAX(production_date) FROM monthly_production
            WHERE COALESCE(effective_trimmers_line1, trimmers_line1) > 0)
      AND COALESCE(effective_trimmers_line1, trimmers_line1) > 0
  `);
  if (!row || !row.crew) return null;
  return { crew: Math.round(row.crew * 10) / 10, slots: row.slots, date: row.date };
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
 * `queue_rank` is stamped at insert with `z` + the save timestamp, so an order
 * book nobody has dragged comes back in insertion order — decision 3. Ordering
 * on a column that were all NULL would be arbitrary, not insertion order, which
 * is why saveOrder writes it rather than leaving it to a default.
 *
 * The `z` matters: a drag rewrites every rank as `a0000`, `a0001`…, and TEXT
 * comparison is byte-wise, so an unprefixed timestamp would sort ahead of all
 * of them and silently promote every new order to the front.
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

/**
 * Production the burn-down could not read, because nothing maps its spelling.
 *
 * `recordedProduction` joins `cultivar_aliases` on an exact match, which is
 * right — substring matching silently counts Sour Lifter toward Lifter. But an
 * inner join DROPS what it cannot match, and nothing inserts aliases at run
 * time: migration 0017 seeded them through the 2025 crop year. The first entry
 * spelled `2026 - Lifter / Sungrown` therefore stops counting toward any order,
 * appears in neither progress nor `unallocated`, and looks exactly like a floor
 * that has stopped trimming.
 *
 * Reported so it is a visible gap rather than an invisible one.
 */
async function unmatchedSpellings(db, since) {
  return query(db, `
    SELECT mp.cultivar1 AS spelling,
           ROUND(SUM(COALESCE(mp.tops_lbs1, 0) + COALESCE(mp.smalls_lbs1, 0)), 1) AS lbs
    FROM monthly_production mp
    LEFT JOIN cultivar_aliases a ON a.alias = mp.cultivar1
    WHERE mp.production_date >= ?
      AND a.alias IS NULL
      AND mp.cultivar1 IS NOT NULL AND TRIM(mp.cultivar1) != ''
      AND (COALESCE(mp.tops_lbs1, 0) + COALESCE(mp.smalls_lbs1, 0)) > 0
    GROUP BY mp.cultivar1
    ORDER BY lbs DESC
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

  // FINISHED ORDERS STILL HOLD THEIR CLAIM ON PAST POUNDS.
  //
  // Allocation is a replay, not a ledger: every pound is dealt out again from
  // scratch on each read. An order that has left the queue must still be dealt
  // its share, or the pounds it already ate are handed to whoever is next in
  // line for that cultivar — and that order is credited with work physically
  // already spent, then auto-finished by the cron on the strength of it.
  //
  // WHICH FINISHED ORDERS, AND WHY THIS IS NOT `accrual_start >= since`.
  // It was, and that was exactly backwards. The replay window used to be
  // derived from the QUEUED orders alone, and the front of the queue is
  // normally the oldest — so the moment it finished, the window jumped past its
  // own accrual start and dropped it from the replay on the very next tick.
  // One cron cycle after any order completed, the next order wanting the same
  // cultivar inherited every pound it had consumed.
  //
  // A finished order is relevant while the work it consumed is still inside the
  // window being replayed, which is a question about when it STOPPED consuming,
  // not when it began. `updated_at` is stamped when the cron finishes it, so
  // that is the bound — and the horizon below is what keeps last season out
  // without the window's own start being the thing that decides.
  const SETTLED_AFTER_DAYS = 60;
  const horizon = new Date(Date.now() - SETTLED_AFTER_DAYS * 86400000)
    .toISOString().slice(0, 10);

  const claimed = await query(db, `
    SELECT i.id AS lineId, i.order_id AS orderId, i.cultivar_id AS cultivarId,
           i.form, i.qty_lbs AS qtyLbs, i.sort_order AS sortOrder,
           o.accrual_start AS accrualStart, o.queue_rank AS queueRank
    FROM order_items i
    JOIN orders o ON o.id = i.order_id
    WHERE o.status = 'finished' AND COALESCE(o.updated_at, o.created_at) >= ?
  `, [horizon]);

  // The window has to reach back far enough to cover everything being replayed,
  // finished orders included — otherwise a finished order is in the deal but the
  // entries it consumed are not, and it arrives empty-handed while a live order
  // takes them.
  const earliest = [...queued, ...claimed].reduce(
    (min, l) => (l.accrualStart && l.accrualStart < min ? l.accrualStart : min),
    nowPT().date);
  const since = String(earliest).slice(0, 10);

  const [entries, unmatched] = await Promise.all([
    recordedProduction(db, since),
    unmatchedSpellings(db, since),
  ]);

  // Finished orders rank AHEAD of everything still queued: they took their
  // pounds while they were at the front, and the replay has to reproduce that
  // order or their share goes to a live order instead. Among themselves they
  // keep the rank they held, so two orders that finished in sequence are
  // re-dealt in that sequence.
  const finishedIds = [...new Set(claimed.map(l => l.orderId))]
    .sort((a, b) => {
      const ra = claimed.find(l => l.orderId === a)?.queueRank ?? '';
      const rb = claimed.find(l => l.orderId === b)?.queueRank ?? '';
      return String(ra).localeCompare(String(rb)) || String(a).localeCompare(String(b));
    });
  const finishedRank = new Map(
    finishedIds.map((id, i) => [id, i - finishedIds.length - 1]));

  const progress = allocate({
    entries,
    lines: [
      ...claimed.map(l => ({ ...l, rank: finishedRank.get(l.orderId) })),
      ...queued.map(l => ({ ...l, rank: rankOf.get(l.orderId) ?? Number.MAX_SAFE_INTEGER })),
    ],
  });

  const [{ rates, fallback }, crewInfo, live, names] = await Promise.all([
    rateTable(db),
    derivedCrew(db),
    liveCrew(db),
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

  return { ...scheduled, progress, rates, fallback, crewInfo, live, crew, start, names, unmatched };
}

async function getQueue(db, params) {
  const q = await computeQueue(db, params.crew);
  const nameOf = new Map(q.names.map(n => [n.id, n.name]));

  return successResponse({
    success: true,
    crew: q.crew,
    // The trailing-seven figure, reported even while an override is in force —
    // otherwise the board cannot offer to go back to it, or tell whether a
    // typed number differs from it at all.
    derivedCrew: q.crewInfo.crew,
    // Today's actual count, reported so the gap between it and the trailing
    // figure is visible. Never used to schedule.
    liveCrew: q.live?.crew ?? null,
    liveCrewDate: q.live?.date ?? null,
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
    // Hourly entries whose cultivar spelling maps to nothing. These are not
    // merely unallocated — they are unread, and without this they are invisible.
    unmatched: q.unmatched,
  });
}

/**
 * The small read of the queue, for surfaces that are not the board: the Ops Hub
 * widget and the hourly-entry banner.
 *
 * Same `computeQueue` the board uses — the derivation is never duplicated — but
 * projected down to what fits on a phone. `getQueue`'s `unallocated` array
 * alone was most of its payload and grows with the 60-day replay window.
 *
 * ALIASES ARE NOT FILTERED BY CROP YEAR HERE, deliberately. The client matches
 * these against the options its own dropdown already holds, so a spelling from
 * a year it is not showing simply matches nothing and costs a few bytes.
 * Choosing a year on this side would mean hardcoding one — and the entry app
 * already hardcodes 2025 in `loadCultivars()`, which is exactly the thing that
 * will need finding at the crop-year rollover. Two of them would be worse.
 * Newest spellings sort first so the current year's wins the top slot.
 */
async function getQueueBrief(db, params) {
  const q = await computeQueue(db, params.crew);
  const nameOf = new Map(q.names.map(n => [n.id, n.name]));

  const [orders, aliases] = await Promise.all([
    query(db, 'SELECT id, nickname, shopify_order_name FROM orders'),
    query(db, 'SELECT alias, cultivar_id AS cultivarId FROM cultivar_aliases ORDER BY crop_year DESC, alias'),
  ]);

  const brief = buildQueueBrief({
    blocks: q.blocks.map(b => ({
      ...b,
      passes: b.passes.map(p => ({ ...p, cultivarName: nameOf.get(p.cultivarId) || p.cultivarId })),
    })),
    orders: orders.map(o => ({
      id: o.id,
      nickname: o.nickname,
      shopifyOrderName: o.shopify_order_name,
    })),
    aliases,
  });

  return successResponse({ success: true, ...brief });
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
  const q = await computeQueue(env.DB);
  return applyStatuses(env.DB, q.progress);
}

/**
 * Move orders forward to match what the floor has recorded. Decision 5: fully
 * automatic — the first pound moves an order to `in_production`, a fully
 * trimmed one to `finished`.
 *
 * THIS IS A WRITE, AND getQueue IS A READ. Doing it inside getQueue would make
 * an unauthenticated GET mutate the order book, and would only run while
 * somebody had the page open. It belongs on the cron.
 *
 * Only forward transitions are applied, so a human who marked something
 * finished early keeps that decision.
 */
async function applyStatuses(db, progress) {
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

  const id = await nextId(db, "orders", "MO", new Date().getUTCFullYear());
  const now = new Date().toISOString();
  const importedAt = nowPT();

  const statements = [{
    sql: `INSERT INTO orders
            (id, order_date, status, source, shopify_order_id, shopify_order_name,
             notes, updated_at, accrual_start, queue_rank)
          VALUES (?, ?, 'in_queue', 'shopify', ?, ?, ?, ?, ?, ?)`,
    params: [id, now.slice(0, 10), orderRef, orderRef,
      `Imported from Shopify ${orderRef}`, now,
      // Same prefix as a hand-entered order: an unattended import must join the
      // BACK of the queue, not jump to the front of a board somebody has ranked.
      moment(importedAt.date, importedAt.minutes), `z${now}`],
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
    items: items.map(i => ({
      cultivar: i.cultivarName, form: i.form, qtyLbs: Math.round(i.qtyLbs * 100) / 100,
    })),
    totalLbs: Math.round(items.reduce((s, i) => s + i.qtyLbs, 0) * 100) / 100,
  });
}


// ─── NOTIFICATIONS ─────────────────────────────────────

const NOTIFY_KEY = 'wholesale_notify';

/** Every rule this feature owns, so reads and clears never touch other alerts. */
const NOTIFY_RULES = [
  'order_started', 'order_finished', 'strain_started', 'strain_finished',
  'running_behind', 'queue_clear', 'promise_date',
];

async function notifyEnabled(db) {
  const row = await queryOne(db, 'SELECT value FROM system_config WHERE key = ?', [NOTIFY_KEY]);
  return row?.value === 'true';
}

async function getNotify(db) {
  return successResponse({ success: true, enabled: await notifyEnabled(db) });
}

/**
 * Turn the bell on or off.
 *
 * TURNING IT ON DOES NOT REPLAY HISTORY. Every strain already running would
 * otherwise be announced at once, because "this has started" is true of all of
 * them. So enabling records the current state as already-said and sends
 * nothing; the first real message is the next thing that actually changes.
 */
async function setNotify(db, body) {
  const enabled = body.enabled === true || body.enabled === 'true';
  await execute(db, `
    INSERT INTO system_config (key, value, value_type, category, description, updated_at)
    VALUES (?, ?, 'boolean', 'wholesale', 'Push wholesale queue updates to Telegram', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `, [NOTIFY_KEY, enabled ? 'true' : 'false']);

  let seeded = 0;
  if (enabled) {
    const q = await computeQueue(db);
    seeded = await recordEvents(db, await buildEvents(db, q, []));
  }
  return successResponse({ success: true, enabled, seeded });
}

/** What has already been said, as deriveEvents wants it. */
async function sentLedger(db) {
  const rows = await query(db, `
    SELECT rule, dedup_key, metadata_json FROM alerts_sent
    WHERE rule IN (${NOTIFY_RULES.map(() => '?').join(', ')})
  `, NOTIFY_RULES);
  return new Map(rows.map(r => {
    let meta = {};
    try { meta = r.metadata_json ? JSON.parse(r.metadata_json) : {}; } catch { meta = {}; }
    return [`${r.rule}:${r.dedup_key}`, meta];
  }));
}

const RECORD_SQL = `
  INSERT INTO alerts_sent (rule, dedup_key, last_sent_ts, metadata_json)
  VALUES (?, ?, datetime('now'), ?)
  ON CONFLICT(rule, dedup_key) DO UPDATE SET
    last_sent_ts = excluded.last_sent_ts,
    metadata_json = excluded.metadata_json`;

/** Write events to the ledger so they are never said twice. */
async function recordEvents(db, events) {
  if (!events.length) return 0;
  await transaction(db, events.map(e => ({
    sql: RECORD_SQL,
    params: [e.rule, e.key, e.meta ? JSON.stringify(e.meta) : null],
  })));
  return events.length;
}

/** Record a single event, immediately after it has actually been delivered. */
async function recordEvent(db, e) {
  await execute(db, RECORD_SQL, [e.rule, e.key, e.meta ? JSON.stringify(e.meta) : null]);
}

async function buildEvents(db, q, moved) {
  const [orders, sent, items] = await Promise.all([
    query(db, 'SELECT id, nickname, shopify_order_name FROM orders'),
    sentLedger(db),
    query(db, 'SELECT order_id, qty_lbs FROM order_items'),
  ]);

  const totals = new Map();
  for (const i of items) totals.set(i.order_id, (totals.get(i.order_id) || 0) + i.qty_lbs);

  const nameOf = new Map(q.names.map(n => [n.id, n.name]));
  return deriveEvents({
    blocks: q.blocks.map(b => ({
      ...b,
      passes: b.passes.map(p => ({ ...p, cultivarName: nameOf.get(p.cultivarId) || p.cultivarId })),
    })),
    orders: orders.map(o => ({
      id: o.id,
      nickname: o.nickname,
      shopifyOrderName: o.shopify_order_name,
      totalLbs: totals.get(o.id) || 0,
    })),
    moved,
    sent,
    today: nowPT().date,
  });
}

/**
 * The whole wholesale cron: advance statuses, then say what changed.
 *
 * Notifications run after the status sync and are handed its result, because
 * "this order has started" is a status transition rather than something
 * visible in the queue — an order that has begun is still sitting in it.
 *
 * A failure to send must not roll back the statuses, so each half is caught
 * separately by the caller.
 */
export async function runWholesaleCron(env) {
  const db = env.DB;

  // ONE computation, and the events are derived from it BEFORE the statuses
  // move. Deriving afterwards cost the last pass of every order its
  // "✅ done — Next up: …": finishing the order takes it out of the queue, so
  // the pass that finished it was no longer in `blocks` to be noticed.
  const q = await computeQueue(db);
  const moved = await applyStatuses(db, q.progress);

  if (!await notifyEnabled(db)) return { moved, sent: 0 };

  const events = await buildEvents(db, q, moved);
  const speak = events.filter(e => e.text);
  const silent = events.filter(e => !e.text);

  let sent = 0;
  for (const e of speak) {
    try {
      await sendTelegramMessage(env, { chatId: env.TELEGRAM_CASEY_CHAT_ID, text: e.text });
    } catch (err) {
      // ONE BAD MESSAGE MUST NOT WEDGE THE REST. Recording used to happen once,
      // after the whole loop, so a single message Telegram refused meant nothing
      // was written at all — and the same message was retried, and refused,
      // every five minutes forever, with every later event stuck behind it.
      // Now each event is recorded the moment it lands, and a failure costs
      // only itself.
      console.error(`[Cron] Telegram send failed for ${e.rule}:${e.key}: ${err.message}`);
      continue;
    }
    await recordEvent(db, e);
    sent += 1;
  }

  // Bookkeeping rows carry no message, so nothing can have failed to deliver.
  await recordEvents(db, silent);
  return { moved, sent };
}
