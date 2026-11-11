/**
 * Practice / demo driver (Koa 2026-11-11: "build our side out using mock data
 * from the last 90 days ... cells/bagging/tagging etc."). Runs ONLY on the demo
 * database (lib/demo-env.js): production/index.js refuses demo* actions outside
 * demo mode, and every write here goes to env.DB, which in demo mode is DEMO_DB.
 *
 *   POST ?action=demoLoad    { orders: [{ name, simAt, rush, lines: [...] }], simStartMs, speed }
 *                            wipes the demo floor and queues a day of mock orders
 *   POST ?action=demoTick    advances the sim clock by real time x speed: orders
 *                            arrive, cells trim, baskets swap, bag/tag (if auto) moves
 *   POST ?action=demoControl { speed?, paused?, auto? }
 *   GET  ?action=demoState   clock, speed, counts
 *   POST ?action=demoFulfill { orderId }   the Shopify stub: "label bought" -> fulfilled
 *
 * How the floor moves:
 *   - Orders arrive when the sim clock passes their time, through the same intake
 *     (normalizeOrder -> upsertOrder -> routeLine) as Shopify orders.
 *   - Our stand-in auto-assign (fillSlots) puts them on cells, as live would with
 *     ORDER_AUTO_ASSIGN on.
 *   - A cell trims its NOW basket at a pace near the room default. With a cell
 *     screen open and not started, the basket waits for that person's Start. table1 has a
 *     (simulated) scale: its readings rise, and at the target the matched empty
 *     basket "goes on" (reading ~1 g). A cell screen open in demo sees that swap
 *     and posts the pickup itself, through the real code; with no screen open, the
 *     sim posts the same pickup mark after SWAP_GRACE_MS. Cells with no scale
 *     close the basket the way bag/tag's Basket done does.
 *   - Auto bag/tag (on by default; off lets people click): confirms an assigned
 *     order, collects an order from the pickup spot, then "buys the label"
 *     (fulfilled), each after a few sim minutes.
 */
import { successResponse, errorResponse } from '../../lib/response.js';
import { normalizeOrder, upsertOrder } from '../../lib/order-sync.js';
import { fillSlots, loadCells, startJob, completeJob, orderAction } from './order-flow.js';
import { DEFAULT_PACE_GPM } from '../../lib/order-assign.js';

const MAX_DT_MS = 30000;          // a driver tab that slept doesn't jump the floor ahead
const SWAP_GRACE_MS = 15000;      // real ms an open cell screen gets to post the swap's pickup itself
const SCREEN_FRESH_MS = 60000;
export const AUTO = { confirmMin: 2, collectMin: 6, fulfilMin: 10 };   // sim minutes
const SPEEDS = [1, 10, 60];

const bad = msg => errorResponse(msg, 'VALIDATION_ERROR', 400);
const guard = env => (env.DEMO ? null : errorResponse('Demo only', 'NOT_FOUND', 404));
const utc = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

async function run(env, sql, ...p) { return env.DB.prepare(sql).bind(...p).run(); }
async function all(env, sql, ...p) { return (await env.DB.prepare(sql).bind(...p).all()).results || []; }
async function first(env, sql, ...p) { return env.DB.prepare(sql).bind(...p).first(); }

async function getClock(env) {
  const r = await first(env, `SELECT value FROM demo_state WHERE key = 'clock'`);
  return r ? JSON.parse(r.value) : null;
}
async function setClock(env, c) {
  await run(env, `INSERT INTO demo_state (key, value) VALUES ('clock', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, JSON.stringify(c));
}

/** A cell's own pace, a little either side of the room default, so cells don't move in lockstep. */
export function cellPace(stationId) {
  let h = 0;
  for (const ch of String(stationId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return DEFAULT_PACE_GPM * (0.85 + (h % 31) / 100);
}

/** A mock line -> a Shopify GraphQL line node, so it goes through the real intake. */
function lineNode(orderName, i, l) {
  const opts = Object.entries(l.options || {}).map(([name, value]) => ({ name, value }));
  return {
    id: `gid://shopify/LineItem/demo-${orderName.replace(/\D/g, '')}-${i}`,
    title: l.title, variantTitle: l.variantTitle || Object.values(l.options || {}).join(' / ') || null,
    quantity: l.qty, unfulfilledQuantity: l.qty,
    product: l.custom ? null : { title: l.productTitle || l.title, productType: l.productType || 'Hemp Flower', tags: l.productTags || [] },
    variant: l.custom ? null : { selectedOptions: opts },
  };
}

export async function demoLoad(body, env, now = Date.now()) {
  const g = guard(env); if (g) return g;
  const orders = Array.isArray(body.orders) ? body.orders : null;
  if (!orders || orders.length > 400) return bad('orders: 1-400 mock orders');
  const speed = SPEEDS.includes(Number(body.speed)) ? Number(body.speed) : 10;
  const simStartMs = Number(body.simStartMs);
  if (!Number.isFinite(simStartMs)) return bad('simStartMs required');
  // Wipe the demo floor. This is the demo database: never the live one.
  // Children before parents: D1 enforces the foreign keys (cell_jobs -> lines -> orders).
  for (const t of ['demo_jobs', 'demo_orders', 'demo_arrivals', 'scale_marks', 'cell_jobs', 'shop_order_lines', 'shop_orders', 'cell_screen_state', 'scale_readings', 'scale_events', 'shop_sync']) {
    await run(env, `DELETE FROM ${t}`);
  }
  await run(env, `INSERT OR IGNORE INTO scale_stations (station_id, label, kind, token_hash, stale_after_s) VALUES ('table1', 'Cell 1', 'table', 'demo', 45)`);
  let n = 0;
  for (const o of orders) {
    const name = String(o.name || '').slice(0, 20);
    if (!name || !Array.isArray(o.lines) || !o.lines.length) continue;
    await run(env, `INSERT INTO demo_arrivals (sim_at, payload) VALUES (?, ?)`, Number(o.simAt) || simStartMs, JSON.stringify({
      name, rush: !!o.rush, lines: o.lines.slice(0, 20).map(l => ({
        title: String(l.title || '').slice(0, 120), productTitle: l.productTitle ? String(l.productTitle).slice(0, 120) : null,
        variantTitle: l.variantTitle ? String(l.variantTitle).slice(0, 80) : null, productType: l.productType || null,
        productTags: (l.productTags || []).slice(0, 10).map(String), options: l.options || {}, qty: Math.max(1, Math.min(50, Number(l.qty) || 1)),
        custom: !!l.custom,
      })),
    }));
    n++;
  }
  await setClock(env, { simMs: simStartMs, realMs: now, speed, paused: false, auto: body.auto !== false });
  return successResponse({ success: true, queued: n, speed });
}

export async function demoControl(body, env, now = Date.now()) {
  const g = guard(env); if (g) return g;
  const c = await getClock(env);
  if (!c) return errorResponse('Load a day first', 'NOT_LOADED', 409);
  c.simMs += c.paused ? 0 : Math.min(now - c.realMs, MAX_DT_MS) * c.speed;
  c.realMs = now;
  if (SPEEDS.includes(Number(body.speed))) c.speed = Number(body.speed);
  if (typeof body.paused === 'boolean') c.paused = body.paused;
  if (typeof body.auto === 'boolean') c.auto = body.auto;
  await setClock(env, c);
  return successResponse({ success: true, clock: c });
}

export async function demoFulfill(body, env) {
  const g = guard(env); if (g) return g;
  const id = Number(body.orderId);
  const r = await run(env, `UPDATE shop_orders SET state = 'fulfilled', fulfilled_at = datetime('now'), shop_status = 'FULFILLED'
    WHERE id = ? AND state NOT IN ('fulfilled', 'cancelled')`, id);
  if (!r.meta || !r.meta.changes) return errorResponse('Not an open order', 'NOT_OPEN', 409);
  await run(env, `UPDATE cell_jobs SET state = 'cancelled' WHERE order_id = ? AND state = 'queued' AND started_at IS NULL`, id);
  return successResponse({ success: true, orderId: id });
}

export async function demoState(params, env) {
  const g = guard(env); if (g) return g;
  const c = await getClock(env);
  const counts = Object.fromEntries((await all(env, `SELECT state, COUNT(*) AS n FROM shop_orders GROUP BY state`)).map(r => [r.state, r.n]));
  const left = await first(env, `SELECT COUNT(*) AS n FROM demo_arrivals WHERE done = 0`);
  return successResponse({ loaded: !!c, clock: c, counts, toArrive: (left && left.n) || 0, auto: AUTO });
}

async function arrivals(env, simMs, now) {
  const due = await all(env, `SELECT id, payload FROM demo_arrivals WHERE done = 0 AND sim_at <= ? ORDER BY sim_at, id`, simMs);
  for (const a of due) {
    const o = JSON.parse(a.payload);
    const node = {
      id: `gid://shopify/Order/demo-${a.id}`, name: o.name, createdAt: new Date(now).toISOString(), cancelledAt: null,
      displayFulfillmentStatus: 'UNFULFILLED', tags: ['m2o-line'], shippingLine: { title: o.rush ? 'UPS Next Day Air' : 'Ground' },
      lineItems: { nodes: o.lines.map((l, i) => lineNode(o.name, i, l)) },
    };
    const n = normalizeOrder(node, null);
    if (n) await upsertOrder(env, n);
    await run(env, `UPDATE demo_arrivals SET done = 1 WHERE id = ?`, a.id);
  }
  return due.length;
}

async function setReading(env, stationId, grams, now) {
  await run(env, `INSERT INTO scale_readings (station_id, weight, target_weight, unit, updated_at, stable) VALUES (?, ?, 0, 'g', ?, 1)
    ON CONFLICT (station_id) DO UPDATE SET weight = excluded.weight, updated_at = excluded.updated_at, stable = 1`,
  stationId, Math.round(grams * 100) / 100000, utc(now));
}

async function trim(env, dtSimMin, now) {
  const [cells, scales, screens] = await Promise.all([
    loadCells(env),
    all(env, `SELECT station_id FROM scale_stations WHERE kind = 'table'`),
    all(env, `SELECT station_id, phase, updated_at FROM cell_screen_state`),
  ]);
  const scaleSet = new Set(scales.map(s => s.station_id));
  const screenOpen = new Map(screens.map(s => [s.station_id, now - Number(s.updated_at) <= SCREEN_FRESH_MS]));
  const screenIdle = new Map(screens.map(s => [s.station_id, s.phase === 'idle']));
  let closed = 0;
  for (const c of cells.filter(x => x.takesOrders)) {
    const job = c.rows[0];
    const scale = scaleSet.has(c.stationId);
    if (!job) { if (scale) await setReading(env, c.stationId, 0.4, now); continue; }
    let st = await first(env, `SELECT * FROM demo_jobs WHERE job_id = ?`, job.id);
    if (!st) {
      await run(env, `INSERT INTO demo_jobs (job_id, grams, phase) VALUES (?, 0, 'trim')`, job.id);
      st = { job_id: job.id, grams: 0, phase: 'trim', swapped_real: null };
    }
    if (st.phase === 'trim') {
      // A cell screen open on this cell and not started yet: a person is at it, so the
      // basket waits, empty, for their Start (the screen re-arms itself after a pickup).
      if (scale && screenOpen.get(c.stationId) && screenIdle.get(c.stationId) && st.grams === 0) {
        await setReading(env, c.stationId, 0.4, now);
        continue;
      }
      const grams = Math.min(job.target_g, st.grams + cellPace(c.stationId) * dtSimMin);
      if (grams > 0 && !job.started_at) await startJob(env, c.stationId, job.id);
      if (grams < job.target_g || (scale && st.grams < job.target_g)) {
        // A scale cell shows the full basket for one tick first, so an open screen chimes.
        await run(env, `UPDATE demo_jobs SET grams = ? WHERE job_id = ?`, grams, job.id);
        if (scale) await setReading(env, c.stationId, grams, now);
        continue;
      }
      if (!scale) {   // no scale: the basket is done, as bag/tag's Basket done tap
        await completeJob(env, { jobId: job.id, by: 'tap', netG: job.target_g });
        await run(env, `DELETE FROM demo_jobs WHERE job_id = ?`, job.id);
        closed++;
        continue;
      }
      // The two-basket swap: the full basket goes to the spot, the matched empty one goes on.
      await setReading(env, c.stationId, 1.2, now);
      await run(env, `UPDATE demo_jobs SET grams = ?, phase = 'swapped', swapped_real = ? WHERE job_id = ?`, job.target_g, now, job.id);
      continue;
    }
    // Swapped: an open cell screen posts the pickup itself; otherwise the sim does, the same mark.
    // The scale keeps posting the empty basket meanwhile, as a node does: the screen times its
    // "held at zero" from the readings, so a reading that stopped would never hold.
    if (screenOpen.get(c.stationId) && now - Number(st.swapped_real) < SWAP_GRACE_MS) {
      await setReading(env, c.stationId, 1.2, now);
      continue;
    }
    const cycleS = Math.round((job.target_g / cellPace(c.stationId)) * 60);
    await run(env, `INSERT INTO scale_marks (station_id, ts, kind, kg, cultivar, bag, cycle_s, job_id) VALUES (?, ?, 'pickup', ?, ?, ?, ?, ?)`,
      c.stationId, utc(now), job.target_g / 1000, job.cultivar, job.bag, cycleS, job.id);
    await completeJob(env, { jobId: job.id, stationId: c.stationId, by: 'scale', netG: job.target_g, cycleS });
    await run(env, `DELETE FROM demo_jobs WHERE job_id = ?`, job.id);
    closed++;
  }
  // A job the screen closed (or that moved) leaves no sim state behind.
  await run(env, `DELETE FROM demo_jobs WHERE job_id NOT IN (SELECT id FROM cell_jobs WHERE state = 'queued')`);
  return closed;
}

/**
 * Auto bag/tag: each step a few sim minutes after the demo first saw the order in
 * that state (demo_orders, on the sim clock).
 */
async function bagTag(env, simMs) {
  const since = ms => (ms == null ? 0 : (simMs - ms) / 60000);
  let moved = 0;
  const orders = await all(env, `SELECT o.id, o.state, o.collected_at, o.confirmed_at, d.order_id AS known, d.seen_at, d.ready_at AS ready_sim, d.collected_at AS collected_sim
    FROM shop_orders o LEFT JOIN demo_orders d ON d.order_id = o.id WHERE o.state IN ('queued', 'assigned', 'trimming', 'ready')`);
  for (const o of orders) {
    if (!o.known) await run(env, `INSERT INTO demo_orders (order_id, seen_at) VALUES (?, ?)`, o.id, simMs);
    if (o.state === 'ready' && o.ready_sim == null) { await run(env, `UPDATE demo_orders SET ready_at = ? WHERE order_id = ?`, simMs, o.id); o.ready_sim = simMs; }
    if (o.collected_at && o.collected_sim == null) { await run(env, `UPDATE demo_orders SET collected_at = ? WHERE order_id = ?`, simMs, o.id); o.collected_sim = simMs; }
    const seen = o.known ? o.seen_at : simMs;
    // A custom line waits for a person: the demo sends it to bagging.
    if (o.state === 'queued') {
      for (const l of await all(env, `SELECT id FROM shop_order_lines WHERE order_id = ? AND route = 'ask' AND qty_open > 0`, o.id)) {
        await orderAction({ orderId: o.id, op: 'route', lineId: l.id, route: 'bagging' }, env); moved++;
      }
    }
    if (!o.confirmed_at && since(seen) >= AUTO.confirmMin) {
      await orderAction({ orderId: o.id, op: 'confirm' }, env); moved++; continue;
    }
    if (o.state === 'ready' && !o.collected_at && since(o.ready_sim) >= AUTO.collectMin) {
      await orderAction({ orderId: o.id, op: 'collected' }, env); moved++; continue;
    }
    if (o.state === 'ready' && o.collected_at && since(o.collected_sim) >= AUTO.fulfilMin) {
      await demoFulfill({ orderId: o.id }, env); moved++;
    }
  }
  return moved;
}

export async function demoTick(body, env, now = Date.now()) {
  const g = guard(env); if (g) return g;
  const row = await first(env, `SELECT value FROM demo_state WHERE key = 'clock'`);
  if (!row) return errorResponse('Load a day first', 'NOT_LOADED', 409);
  const c = JSON.parse(row.value);
  const dtReal = c.paused ? 0 : Math.max(0, Math.min(now - c.realMs, MAX_DT_MS));
  c.simMs += dtReal * c.speed;
  c.realMs = now;
  // One tick at a time: claim the clock with a compare-and-set. A second driver tab, or
  // a slow tick still running, finds the clock already moved and steps aside, so time
  // never advances twice and a swap never posts two pickups.
  const claim = await run(env, `UPDATE demo_state SET value = ? WHERE key = 'clock' AND value = ?`, JSON.stringify(c), row.value);
  if (!claim.meta || claim.meta.changes !== 1) return successResponse({ success: true, busy: true, clock: JSON.parse(row.value) });
  const arrived = await arrivals(env, c.simMs, now);
  await fillSlots(env);
  const closed = c.paused ? 0 : await trim(env, (dtReal * c.speed) / 60000, now);
  const moved = c.auto && !c.paused ? await bagTag(env, c.simMs) : 0;
  if (closed || moved) await fillSlots(env);
  return successResponse({ success: true, clock: c, arrived, closed, moved });
}
