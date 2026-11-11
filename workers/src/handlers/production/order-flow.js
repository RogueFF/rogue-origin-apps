/**
 * Orders at the cells, slice 2 (migration 0061; design doc §2e; Koa 2026-11-11:
 * "automatic order assignment, 1 click printing, order queue, and flow").
 *
 * The Worker assigns every waiting order to a cell by itself (lib/order-assign.js)
 * and keeps each order-taking cell's NOW and NEXT filled. Bag/tag doesn't pick a
 * cell: its one click confirms (slice 4 adds the printing). It can still move an
 * order, hold it, or pick the route of a custom line.
 *
 *   GET  ?action=cellQueue[&stationId=tableN]   every order-taking cell: NOW, NEXT, baskets at the pickup spot
 *   POST ?action=orderAction { orderId, op: confirm|move|hold|release|collected|route, stationId?, lineId?, route? }
 *   POST ?action=jobDone     { jobId }   a cell with no scale: its basket is at the pickup spot
 *
 * A scale cell's job closes itself: the cell screen's pickup scaleMark carries
 * jobId (cell-hourly.js -> completeJob). fillSlots runs after every sync, pickup
 * and bag/tag action, and on the 5-minute cron.
 *
 * No token, like the other floor screens: order number, cultivar, bag size and
 * counts only. Nothing here writes to Shopify.
 */
import { successResponse, errorResponse } from '../../lib/response.js';
import { planAssignments, paceFromMarks, FILL_G, minutesToFree } from '../../lib/order-assign.js';

const notReady = e => /no such (table|column)/i.test(String(e && e.message));
const NOT_READY = () => errorResponse('Orders at cells are not set up yet (migration 0061)', 'NOT_READY', 503);
const bad = msg => errorResponse(msg, 'VALIDATION_ERROR', 400);

async function all(env, sql, ...p) { return (await env.DB.prepare(sql).bind(...p).all()).results || []; }
async function first(env, sql, ...p) { return env.DB.prepare(sql).bind(...p).first(); }
async function run(env, sql, ...p) { return env.DB.prepare(sql).bind(...p).run(); }

const SCREEN_FRESH_MS = 2 * 60 * 1000;
/**
 * A cell busy with a job that isn't from the queue (a hand-picked wholesale batch,
 * or the dropdowns): grams still to trim on it, so the planner never calls that
 * cell free. A queued job the screen started has started_at (setCellState with
 * jobId), so a running screen with no started queued job is a hand job.
 */
export function handJobLeft(screen, rows, liveNetG, now = Date.now()) {
  if (!screen || !(screen.target_g > 0) || !(now - Number(screen.updated_at) <= SCREEN_FRESH_MS)) return 0;
  if (screen.phase === 'running' && !rows.some(j => j.started_at)) {
    return Math.max(0, screen.target_g - Math.max(0, liveNetG ?? 0));
  }
  if (screen.phase === 'armed' && !rows.length) return screen.target_g;
  return 0;
}

/** What the planner needs about each order-taking cell, from D1. */
export async function loadCells(env, now = Date.now()) {
  const [roster, jobs, screens, readings, marks, lastDone] = await Promise.all([
    all(env, `SELECT station_id, label, lane, sort, takes_orders FROM cell_roster WHERE active = 1 ORDER BY sort, station_id`),
    all(env, `SELECT * FROM cell_jobs WHERE state = 'queued' ORDER BY station_id, seq, id`),
    all(env, `SELECT station_id, phase, cultivar, target_g, updated_at FROM cell_screen_state`).catch(() => []),
    all(env, `SELECT r.station_id, r.weight FROM scale_readings r JOIN scale_stations s ON s.station_id = r.station_id AND s.kind = 'table'`).catch(() => []),
    all(env, `SELECT station_id, kg, cycle_s FROM scale_marks WHERE kind = 'pickup' AND cycle_s IS NOT NULL AND ts >= datetime('now', '-7 days')`).catch(() => []),
    all(env, `SELECT station_id, cultivar FROM cell_jobs WHERE state = 'done' AND id IN (SELECT MAX(id) FROM cell_jobs WHERE state = 'done' GROUP BY station_id)`),
  ]);
  const by = (rows) => { const m = new Map(); for (const r of rows) (m.get(r.station_id) || m.set(r.station_id, []).get(r.station_id)).push(r); return m; };
  const jobsBy = by(jobs), marksBy = by(marks);
  const screenBy = new Map(screens.map(s => [s.station_id, s]));
  const readBy = new Map(readings.map(r => [r.station_id, r]));
  const doneBy = new Map(lastDone.map(r => [r.station_id, r.cultivar]));
  return roster.filter(c => c.takes_orders === 1 || jobsBy.has(c.station_id)).map(c => {
    const r = readBy.get(c.station_id);
    const s = screenBy.get(c.station_id);
    const rows = jobsBy.get(c.station_id) || [];
    const liveNetG = r && Number.isFinite(Number(r.weight)) ? Number(r.weight) * 1000 : null;
    return {
      stationId: c.station_id, label: c.label, lane: c.lane, sort: c.sort, takesOrders: c.takes_orders === 1,
      liveNetG,
      handJobLeftG: handJobLeft(s, rows, liveNetG, now),
      lastCultivar: doneBy.get(c.station_id) || (s && s.cultivar) || null,
      paceGpm: paceFromMarks(marksBy.get(c.station_id) || []),
      rows,
      jobs: rows.map(j => ({ orderId: j.order_id, cultivar: j.cultivar, targetG: j.target_g, started: !!j.started_at })),
    };
  });
}

/** Orders waiting for a cell: cell lines only. An order with a custom line waits for bag/tag to route it. */
export async function loadWaiting(env) {
  const orders = await all(env, `SELECT id, name, rush, placed_at FROM shop_orders WHERE state = 'queued'`);
  if (!orders.length) return [];
  const lines = await all(env,
    `SELECT l.id, l.order_id, l.floor_cultivar, l.bag, l.qty_open, l.route FROM shop_order_lines l
     JOIN shop_orders o ON o.id = l.order_id WHERE o.state = 'queued' AND l.qty_open > 0`);
  const out = [];
  for (const o of orders) {
    const ls = lines.filter(l => l.order_id === o.id);
    if (ls.some(l => l.route === 'ask')) continue;
    const cell = ls.filter(l => l.route === 'cell' && l.floor_cultivar && FILL_G[l.bag]);
    if (!cell.length) continue;
    out.push({ id: o.id, name: o.name, rush: o.rush === 1, placedAt: o.placed_at,
      lines: cell.map(l => ({ lineId: l.id, cultivar: l.floor_cultivar, bag: l.bag, qtyOpen: l.qty_open })) });
  }
  return out;
}

/**
 * Our auto-assign is a STAND-IN (Koa 2026-11-11: "leave the scheduling for him
 * for now"): scheduling is Nathan's (wiki operations/plans/2026-11-11-scheduler-contract.md).
 * It only runs when ORDER_AUTO_ASSIGN is '1' (set it only to test it; the floor
 * walkthrough, demo.html, runs the same planner in the browser);
 * live it is OFF, and orders wait for the scheduler.
 */
export const autoAssignOn = env => !!env && String(env.ORDER_AUTO_ASSIGN || '') === '1';

/** Fill every free NOW/NEXT slot. Safe to run twice at once: an order is claimed with a guarded UPDATE. */
export async function fillSlots(env) {
  if (!autoAssignOn(env)) return { assigned: 0, off: true };
  let cells, waiting;
  try { [cells, waiting] = await Promise.all([loadCells(env), loadWaiting(env)]); } catch (e) {
    if (notReady(e)) return { assigned: 0, notReady: true };
    throw e;
  }
  const planCells = cells.filter(c => c.takesOrders);
  if (!planCells.length || !waiting.length) return { assigned: 0 };
  const { assign } = planAssignments({ cells: planCells, orders: waiting });
  let n = 0;
  for (const a of assign) {
    const claimed = await run(env, `UPDATE shop_orders SET state = 'assigned', assigned_at = datetime('now') WHERE id = ? AND state = 'queued'`, a.orderId);
    if (!claimed.meta || claimed.meta.changes !== 1) continue;
    const top = await first(env, `SELECT COALESCE(MAX(seq), 0) AS s FROM cell_jobs WHERE station_id = ?`, a.stationId);
    let seq = (top && top.s) || 0;
    for (const j of a.jobs) {
      await run(env,
        `INSERT INTO cell_jobs (order_id, line_id, station_id, seq, cultivar, bag, bags, target_g, basket_no, baskets, why)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        a.orderId, j.lineId, a.stationId, ++seq, j.cultivar, j.bag, j.bags, j.targetG, j.basketNo, j.baskets, a.why);
    }
    n++;
  }
  return { assigned: n };
}

/** The cell screen started trimming a queued job (setCellState with jobId). */
export async function startJob(env, stationId, jobId) {
  try {
    const r = await run(env, `UPDATE cell_jobs SET started_at = COALESCE(started_at, datetime('now'))
      WHERE id = ? AND station_id = ? AND state = 'queued'`, Number(jobId), String(stationId));
    if (r.meta && r.meta.changes) {
      await run(env, `UPDATE shop_orders SET state = 'trimming'
        WHERE id = (SELECT order_id FROM cell_jobs WHERE id = ?) AND state = 'assigned'`, Number(jobId));
    }
  } catch (e) { if (!notReady(e)) throw e; }
}

/** A basket reached the pickup spot: by the cell scale's pickup, or a tap for a cell with no scale. */
export async function completeJob(env, { jobId, stationId = null, by = 'scale', netG = null, cycleS = null }) {
  let job;
  try { job = await first(env, `SELECT id, order_id, station_id, state FROM cell_jobs WHERE id = ?`, Number(jobId)); } catch (e) {
    if (notReady(e)) return { ok: false, notReady: true };   // 0061 not applied: the pickup mark is all there is
    throw e;
  }
  if (!job || job.state !== 'queued' || (stationId && job.station_id !== stationId)) return { ok: false };
  await run(env, `UPDATE cell_jobs SET state = 'done', done_at = datetime('now'), done_by = ?, net_g = ?, cycle_s = ?,
    started_at = COALESCE(started_at, datetime('now')) WHERE id = ? AND state = 'queued'`, by, netG, cycleS, job.id);
  const left = await first(env, `SELECT COUNT(*) AS n FROM cell_jobs WHERE order_id = ? AND state = 'queued'`, job.order_id);
  if (!left.n) {
    await run(env, `UPDATE shop_orders SET state = 'ready', ready_at = datetime('now') WHERE id = ? AND state IN ('assigned', 'trimming')`, job.order_id);
  } else {
    await run(env, `UPDATE shop_orders SET state = 'trimming' WHERE id = ? AND state = 'assigned'`, job.order_id);
  }
  await fillSlots(env);
  return { ok: true, orderId: job.order_id, orderReady: !left.n };
}

/**
 * The pickup spot has one store, the pickup mark (scale_marks.collected_at,
 * migration 0060, #166). When the board's Collected (collectPickup) takes a mark
 * that closed a queued job, the job is collected too, and the order once every
 * basket of it is. Undo puts both back.
 */
export async function markCollected(env, markId, collected) {
  try {
    const m = await first(env, `SELECT job_id FROM scale_marks WHERE id = ?`, Number(markId));
    if (!m || !m.job_id) return;
    const job = await first(env, `SELECT id, order_id FROM cell_jobs WHERE id = ?`, m.job_id);
    if (!job) return;
    if (collected) {
      await run(env, `UPDATE cell_jobs SET collected_at = COALESCE(collected_at, datetime('now')) WHERE id = ?`, job.id);
      const left = await first(env, `SELECT COUNT(*) AS n FROM cell_jobs WHERE order_id = ? AND state != 'cancelled' AND collected_at IS NULL`, job.order_id);
      if (!left.n) await run(env, `UPDATE shop_orders SET collected_at = COALESCE(collected_at, datetime('now')) WHERE id = ? AND state = 'ready'`, job.order_id);
    } else {
      await run(env, `UPDATE cell_jobs SET collected_at = NULL WHERE id = ?`, job.id);
      await run(env, `UPDATE shop_orders SET collected_at = NULL WHERE id = ? AND state = 'ready'`, job.order_id);
    }
  } catch (e) { if (!notReady(e)) throw e; }
}

/** Shopify cancelled or fulfilled an order: its baskets not yet started leave the cell queue. */
export async function dropQueuedJobs(env, orderId) {
  try {
    await run(env, `UPDATE cell_jobs SET state = 'cancelled' WHERE order_id = ? AND state = 'queued' AND started_at IS NULL`, orderId);
  } catch (e) { if (!notReady(e)) throw e; }
}

const jobOut = (j, orders) => {
  const o = orders.get(j.order_id) || {};
  return {
    id: j.id, orderId: j.order_id, orderName: o.name || null, cultivar: j.cultivar, bag: j.bag, bags: j.bags,
    targetG: j.target_g, basketNo: j.basket_no, baskets: j.baskets, started: !!j.started_at, why: j.why,
    confirmed: !!o.confirmed_at, changedInShopify: !!o.shop_changed_at, rush: o.rush === 1,
  };
};

export async function getCellQueue(params, env) {
  let cells, spot, orders;
  try {
    cells = await loadCells(env);
    spot = await all(env,
      `SELECT j.* FROM cell_jobs j JOIN shop_orders o ON o.id = j.order_id
       WHERE j.state = 'done' AND j.collected_at IS NULL AND o.collected_at IS NULL
         AND o.state NOT IN ('cancelled', 'fulfilled') ORDER BY j.done_at`);
    const ids = [...new Set([...cells.flatMap(c => c.rows.map(j => j.order_id)), ...spot.map(j => j.order_id)])];
    orders = new Map();
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const rows = await all(env, `SELECT id, name, state, rush, confirmed_at, shop_changed_at, ready_at FROM shop_orders WHERE id IN (${chunk.map(() => '?').join(',')})`, ...chunk);
      for (const r of rows) orders.set(r.id, r);
    }
  } catch (e) { if (notReady(e)) return NOT_READY(); throw e; }
  const want = params.stationId ? String(params.stationId) : null;
  const out = cells.filter(c => !want || c.stationId === want).map(c => {
    const atSpot = new Map();
    for (const j of spot.filter(s => s.station_id === c.stationId)) {
      const e = atSpot.get(j.order_id) || { orderId: j.order_id, orderName: (orders.get(j.order_id) || {}).name || null,
        baskets: 0, since: j.done_at, orderReady: (orders.get(j.order_id) || {}).state === 'ready', jobIds: [] };
      e.baskets += 1;
      e.jobIds.push(j.id);
      atSpot.set(j.order_id, e);
    }
    return {
      stationId: c.stationId, label: c.label, takesOrders: c.takesOrders,
      now: c.rows[0] ? jobOut(c.rows[0], orders) : null,
      next: c.rows[1] ? jobOut(c.rows[1], orders) : null,   // the next basket (may be NOW's order)
      nextOrder: (() => { const r = c.rows.find(x => c.rows[0] && x.order_id !== c.rows[0].order_id); return r ? jobOut(r, orders) : null; })(),
      queued: c.rows.length,
      freeInMin: Math.round(minutesToFree(c)),
      atSpot: [...atSpot.values()],
    };
  });
  const autoAssign = autoAssignOn(env);   // something feeds the cells orders (the cell screen's calm wait)
  if (want && !out.length) return successResponse({ serverNow: Date.now(), autoAssign, cell: null, cells: [] });
  return successResponse({ serverNow: Date.now(), autoAssign, cell: want ? out[0] : undefined, cells: out });
}

export async function jobDone(body, env) {
  const jobId = Number(body.jobId);
  if (!Number.isInteger(jobId) || jobId < 1) return bad('jobId is required');
  let r;
  try { r = await completeJob(env, { jobId, by: 'tap' }); } catch (e) { if (notReady(e)) return NOT_READY(); throw e; }
  if (r.notReady) return NOT_READY();
  if (!r.ok) return errorResponse('That basket is not waiting at a cell', 'NOT_QUEUED', 409);
  return successResponse({ success: true, ...r });
}

const OPS = ['confirm', 'move', 'hold', 'release', 'collected', 'route'];

export async function orderAction(body, env) {
  const op = OPS.includes(body.op) ? body.op : null;
  if (!op) return bad(`op must be one of ${OPS.join(', ')}`);
  const orderId = Number(body.orderId);
  let order;
  try { order = await first(env, `SELECT * FROM shop_orders WHERE id = ?`, orderId); } catch (e) { if (notReady(e)) return NOT_READY(); throw e; }
  if (!order) return bad('Unknown order');
  if (['cancelled', 'fulfilled'].includes(order.state)) return errorResponse(`Order ${order.name} is ${order.state}`, 'CLOSED', 409);
  try {
    if (op === 'confirm') {
      // Bag/tag's one click (slice 4 prints on it). An order with no cell work goes
      // straight to Ready to check: bag/tag pulls it from the pools itself.
      const cellLines = await first(env, `SELECT COUNT(*) AS n FROM shop_order_lines WHERE order_id = ? AND route = 'cell' AND qty_open > 0`, orderId);
      await run(env, `UPDATE shop_orders SET confirmed_at = COALESCE(confirmed_at, datetime('now')) WHERE id = ?`, orderId);
      if (!cellLines.n && ['queued', 'hold'].includes(order.state)) {
        await run(env, `UPDATE shop_orders SET state = 'ready', ready_at = datetime('now'), collected_at = datetime('now') WHERE id = ?`, orderId);
      }
    } else if (op === 'move') {
      const to = await first(env, `SELECT station_id FROM cell_roster WHERE station_id = ? AND active = 1`, String(body.stationId || ''));
      if (!to) return bad('Unknown cell');
      const started = await first(env, `SELECT COUNT(*) AS n FROM cell_jobs WHERE order_id = ? AND state = 'queued' AND started_at IS NOT NULL`, orderId);
      if (started.n) return errorResponse('A basket of this order is already being trimmed', 'STARTED', 409);
      const jobs = await all(env, `SELECT id FROM cell_jobs WHERE order_id = ? AND state = 'queued' ORDER BY seq`, orderId);
      if (!jobs.length) return errorResponse('This order has no baskets waiting at a cell', 'NOT_QUEUED', 409);
      const top = await first(env, `SELECT COALESCE(MAX(seq), 0) AS s FROM cell_jobs WHERE station_id = ?`, to.station_id);
      let seq = (top && top.s) || 0;
      for (const j of jobs) await run(env, `UPDATE cell_jobs SET station_id = ?, seq = ?, assigned_by = 'moved', why = 'moved by bag/tag' WHERE id = ?`, to.station_id, ++seq, j.id);
    } else if (op === 'hold') {
      const started = await first(env, `SELECT COUNT(*) AS n FROM cell_jobs WHERE order_id = ? AND state = 'queued' AND started_at IS NOT NULL`, orderId);
      if (started.n) return errorResponse('A basket of this order is already being trimmed', 'STARTED', 409);
      await run(env, `UPDATE cell_jobs SET state = 'cancelled' WHERE order_id = ? AND state = 'queued' AND started_at IS NULL`, orderId);
      await run(env, `UPDATE shop_orders SET state = 'hold' WHERE id = ? AND state IN ('queued', 'assigned')`, orderId);
    } else if (op === 'release') {
      await run(env, `UPDATE shop_orders SET state = 'queued' WHERE id = ? AND state = 'hold'`, orderId);
    } else if (op === 'collected') {
      if (order.state !== 'ready') return errorResponse('Not every basket is at the pickup spot yet', 'NOT_READY_YET', 409);
      await run(env, `UPDATE cell_jobs SET collected_at = datetime('now') WHERE order_id = ? AND state = 'done' AND collected_at IS NULL`, orderId);
      await run(env, `UPDATE shop_orders SET collected_at = COALESCE(collected_at, datetime('now')) WHERE id = ?`, orderId);
      // ...and the pickup marks behind those baskets, so the board's waiting cards clear too (0060).
      try {
        await run(env, `UPDATE scale_marks SET collected_at = datetime('now') WHERE kind = 'pickup' AND collected_at IS NULL
          AND job_id IN (SELECT id FROM cell_jobs WHERE order_id = ?)`, orderId);
      } catch (e) { if (!notReady(e)) throw e; }
    } else if (op === 'route') {
      const route = ['bagging', 'pack', 'cell'].includes(body.route) ? body.route : null;
      if (!route) return bad('route must be bagging, pack or cell');
      const line = await first(env, `SELECT * FROM shop_order_lines WHERE id = ? AND order_id = ?`, Number(body.lineId), orderId);
      if (!line) return bad('Unknown line');
      if (route === 'cell' && !(line.floor_cultivar || line.cultivar) ) return bad('This line has no cultivar: it can\'t go to a cell');
      if (route === 'cell' && !FILL_G[line.bag]) return bad('Only 1/4 oz to 1 lb bags go to a cell');
      const floor = route === 'cell' ? (line.floor_cultivar || `2026 - ${line.cultivar} / Sungrown`) : line.floor_cultivar;
      await run(env, `UPDATE shop_order_lines SET route = ?, route_why = 'Picked at bag/tag', route_set_by = 'bagtag', floor_cultivar = ? WHERE id = ?`, route, floor, line.id);
    }
  } catch (e) { if (notReady(e)) return NOT_READY(); throw e; }
  await fillSlots(env);
  return successResponse({ success: true, op, orderId });
}
