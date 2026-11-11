// Orders at the cells, slice 2 (migration 0061; lib/order-assign.js,
// handlers/production/order-flow.js, the scaleMark / setCellState hooks).
// Made-up orders only: invented numbers, no buyer fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { planAssignments, basketsFor, paceFromMarks, DEFAULT_PACE_GPM } from '../src/lib/order-assign.js';
import { fillSlots, getCellQueue, orderAction, jobDone, handJobLeft } from '../src/handlers/production/order-flow.js';
import { scaleMark } from '../src/handlers/production/cell-hourly.js';
import { setCellState, collectPickup } from '../src/handlers/production/cell-board.js';
import { syncShopOrders, STATUS_QUERY } from '../src/lib/order-sync.js';
import { getOrderQueue } from '../src/handlers/production/order-queue.js';

const NOW = new Date('2026-11-10T18:00:00Z');
const SL = '2026 - Sour Lifter / Sungrown';
const LI = '2026 - Lifter / Sungrown';
const RG = '2026 - Rainbow GMO / Sungrown';

// ---------- the planner (pure) ----------

const cell = (stationId, sort, jobs = [], extra = {}) => ({ stationId, sort, jobs, ...extra });
const job = (orderId, cultivar, targetG = 120, started = false) => ({ orderId, cultivar, targetG, started });
const order = (id, lines, placedAt = `2026-11-10T1${id % 10}:00:00Z`, rush = false) => ({ id, rush, placedAt, lines });
const line = (lineId, cultivar, bag = 'oz1', qtyOpen = 4) => ({ lineId, cultivar, bag, qtyOpen });

test('baskets: whole bags, at most one 1 lb fill each', () => {
  assert.deepEqual(basketsFor('oz1', 4), [{ bags: 4, targetG: 120, basketNo: 1, baskets: 1 }]);
  assert.deepEqual(basketsFor('lb1', 3).map(b => b.targetG), [460, 460, 460]);
  assert.deepEqual(basketsFor('oz1', 20).map(b => b.bags), [15, 5]);
  assert.deepEqual(basketsFor('qLb', 5).map(b => b.bags), [4, 1]);
  assert.deepEqual(basketsFor('lb10', 1), [], 'never a cell basket');
});

test('pace: a cell\'s own once it has half an hour of jobs, else the room default', () => {
  assert.equal(paceFromMarks([{ kg: 0.03, cycle_s: 300 }]), null);
  assert.equal(Math.round(paceFromMarks([{ kg: 0.12, cycle_s: 1200 }, { kg: 0.12, cycle_s: 1200 }])), 6);
  assert.equal(DEFAULT_PACE_GPM, 6.8);
});

test('same cultivar first, then the cell that frees up soonest', () => {
  const busy = [cell('table1', 1, [job(1, SL)]), cell('table12', 12, [job(2, LI)])];
  const { assign } = planAssignments({ cells: busy, orders: [order(10, [line(1, LI)])] });
  assert.equal(assign[0].stationId, 'table12');
  assert.match(assign[0].why, /same cultivar/);
  const cells = [...busy, cell('table13', 13)];
  const r = planAssignments({ cells, orders: [order(11, [line(1, RG)])] });
  assert.equal(r.assign[0].stationId, 'table13', 'nobody runs it: the idle cell');
  assert.equal(r.assign[0].why, 'cell is free');
});

test('a cell never sits idle to save a changeover', () => {
  const cells = [cell('table1', 1, [job(1, SL, 60)]), cell('table13', 13)];
  const { assign } = planAssignments({ cells, orders: [order(10, [line(1, SL)])] });
  assert.equal(assign[0].stationId, 'table13', 'idle cell, even though table1 runs the same cultivar');
  const both = [cell('table1', 1, [], { lastCultivar: LI }), cell('table13', 13, [], { lastCultivar: SL })];
  assert.equal(planAssignments({ cells: both, orders: [order(11, [line(1, SL)])] }).assign[0].stationId, 'table13',
    'among idle cells, the one that last ran it');
});

test('every cell busy: same cultivar only within a short wait', () => {
  const busy = [job(1, SL, 460, false), job(1, SL, 460, false)];   // ~135 min of work
  const cells = [cell('table1', 1, busy), cell('table13', 13, [], { lastCultivar: LI })];
  const { assign } = planAssignments({ cells, orders: [order(10, [line(1, SL)])] });
  assert.equal(assign[0].stationId, 'table13');
});

test('a mixed order goes to a cell already running one of its cultivars, that cultivar first', () => {
  const cells = [cell('table1', 1, [job(1, LI)]), cell('table12', 12, [job(2, SL)])];
  const { assign } = planAssignments({ cells, orders: [order(10, [line(1, RG, 'qOz', 2), line(2, SL, 'oz1', 1)])] });
  assert.equal(assign[0].stationId, 'table12');
  assert.match(assign[0].why, /one of its cultivars/);
  assert.deepEqual(assign[0].jobs.map(j => j.cultivar), [SL, RG]);
});

test('NOW + NEXT: two orders a cell; rush first; the rest wait with the cell that frees first', () => {
  const cells = [cell('table1', 1)];
  const orders = [order(1, [line(1, SL)], '2026-11-10T10:00:00Z'), order(2, [line(2, SL)], '2026-11-10T11:00:00Z'),
    order(3, [line(3, SL)], '2026-11-10T12:00:00Z', true)];
  const { assign, waiting } = planAssignments({ cells, orders });
  assert.deepEqual(assign.map(a => a.orderId), [3, 1], 'rush, then oldest');
  assert.equal(waiting[0].orderId, 2);
  assert.equal(waiting[0].stationId, 'table1');
  assert.equal(waiting[0].inMin, Math.round(120 / DEFAULT_PACE_GPM));
});

// ---------- the Worker, on a real SQLite ----------

function env() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE scale_readings (station_id TEXT PRIMARY KEY, weight REAL, target_weight REAL, unit TEXT, updated_at TEXT);`);
  for (const m of ['0049-cell-table-stations', '0050-cell-hourly', '0052-cell-job-order', '0054-cell-screen-state', '0058-order-queue', '0060-pickup-spot', '0061-order-assign']) {
    db.exec(readFileSync(new URL(`../migrations/${m}.sql`, import.meta.url), 'utf8'));
  }
  db.exec(`INSERT OR IGNORE INTO scale_stations (station_id, label, kind, token_hash, stale_after_s) VALUES ('table1', 'Cell 1', 'table', 'x', 45);`);
  const stmt = (sql, p) => ({
    first: async () => db.prepare(sql).get(...p) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...p) }),
    run: async () => ({ meta: { changes: db.prepare(sql).run(...p).changes } }),
  });
  return { raw: db, env: { DB: { prepare: sql => ({ bind: (...p) => stmt(sql, p), ...stmt(sql, []) }) } } };
}
const json = async r => ({ status: r.status, body: await r.json() });

let lid = 0;
const sLine = (title, bag, qty, flower = 'Tops', tags = ['retail-only']) => ({
  id: `gid://shopify/LineItem/${++lid}`, title, variantTitle: `${bag} / ${flower}`, quantity: qty, unfulfilledQuantity: qty,
  product: { title, productType: 'Hemp Flower', tags }, variant: { selectedOptions: [{ name: 'Bag Size', value: bag }, { name: 'Flower Type', value: flower }] },
});
const sOrder = (n, createdAt, lines) => ({
  id: `gid://shopify/Order/${n}`, name: `#${n}`, createdAt, cancelledAt: null, displayFulfillmentStatus: 'UNFULFILLED',
  tags: ['m2o-line'], shippingLine: { title: 'Ground' }, lineItems: { nodes: lines },
});
const shop = (nodes, statuses = {}) => async (q, v) => (q === STATUS_QUERY
  ? { nodes: v.ids.map(id => statuses[id] || null) }
  : { orders: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } });

async function seed(e, nodes) {
  await syncShopOrders(e, { gql: shop(nodes), now: NOW, force: true });
  return fillSlots(e);
}
const queueOf = async (e, stationId) => (await json(await getCellQueue({ stationId }, e))).body.cell;
const orderId = (raw, name) => raw.prepare('SELECT id FROM shop_orders WHERE name = ?').get(name).id;

test('orders fill NOW and NEXT at the order-taking cells (table1, 12-14), two each', async () => {
  const { raw, env: e } = env();
  const nodes = Array.from({ length: 10 }, (_, i) => sOrder(5000 + i, `2026-11-10T1${i}:00:00Z`, [sLine('Sour Lifter Hemp Flower', '1 oz.', 2)]));
  const r = await seed(e, nodes);
  assert.equal(r.assigned, 8, '4 cells x 2 orders');
  const per = raw.prepare(`SELECT station_id, COUNT(DISTINCT order_id) n FROM cell_jobs WHERE state = 'queued' GROUP BY station_id`).all();
  assert.deepEqual(per.map(p => [p.station_id, p.n]).sort(), [['table1', 2], ['table12', 2], ['table13', 2], ['table14', 2]]);
  assert.equal(raw.prepare(`SELECT COUNT(*) n FROM shop_orders WHERE state = 'queued'`).get().n, 2);
  const c = await queueOf(e, 'table1');
  assert.equal(c.now.orderName, '#5000');
  assert.equal(c.next.orderName, '#5004', 'same cultivar everywhere: round the cells by who frees first');
  assert.equal(c.now.targetG, 60);
  assert.equal(c.now.cultivar, SL);
  assert.equal((await fillSlots(e)).assigned, 0, 'running it again changes nothing');
  const q = (await json(await getOrderQueue({}, e, NOW))).body;
  const waiting = q.orders.find(o => o.name === '#5008');
  assert.equal(waiting.cell.waiting, true);
  assert.ok(waiting.cell.stationId);
  assert.equal(q.orders.find(o => o.name === '#5000').cell.slot, 'NOW');
});

test('a scale pickup with jobId closes the basket; NEXT moves up; the last basket makes the order ready; the slot refills', async () => {
  const { raw, env: e } = env();
  const nodes = [
    sOrder(6001, '2026-11-10T10:00:00Z', [sLine('Sour Lifter Hemp Flower', '1 lb.', 2)]),   // two baskets
    ...Array.from({ length: 8 }, (_, i) => sOrder(6010 + i, `2026-11-10T11:0${i}:00Z`, [sLine('Lifter Hemp Flower', '1 oz.', 1)])),
  ];
  await seed(e, nodes);
  let c = await queueOf(e, 'table1');
  assert.equal(c.now.orderName, '#6001');
  assert.equal(c.now.baskets, 2);
  assert.equal(c.next.orderName, '#6001', 'NEXT is the same order\'s second basket');
  assert.notEqual(c.nextOrder.orderName, '#6001', 'nextOrder is the order after it');
  await setCellState({ stationId: 'table1', phase: 'running', cultivar: SL, bag: 'lb1', targetG: 460, elapsedMs: 1000, jobId: c.now.id }, e);
  assert.equal(raw.prepare(`SELECT state FROM shop_orders WHERE name = '#6001'`).get().state, 'trimming');
  let r = await json(await scaleMark({ stationId: 'table1', kind: 'pickup', kg: 0.46, cultivar: SL, bag: 'lb1', cycleS: 3600, jobId: c.now.id }, e));
  assert.equal(r.body.job.closed, true);
  assert.equal(r.body.job.orderReady, false);
  assert.equal(raw.prepare(`SELECT job_id FROM scale_marks ORDER BY id DESC LIMIT 1`).get().job_id, c.now.id);
  c = await queueOf(e, 'table1');
  assert.equal(c.now.basketNo, 2);
  assert.ok(c.next && c.next.orderName !== '#6001', 'a new order took the NEXT slot');
  r = await json(await scaleMark({ stationId: 'table1', kind: 'pickup', kg: 0.461, cultivar: SL, bag: 'lb1', cycleS: 3500, jobId: c.now.id }, e));
  assert.equal(r.body.job.orderReady, true);
  const o = raw.prepare(`SELECT state, ready_at FROM shop_orders WHERE name = '#6001'`).get();
  assert.equal(o.state, 'ready');
  assert.ok(o.ready_at);
  c = await queueOf(e, 'table1');
  assert.deepEqual(c.atSpot.map(s => [s.orderName, s.baskets, s.orderReady]), [['#6001', 2, true]]);
  // A pickup for a job that isn't this cell's is just a mark.
  r = await json(await scaleMark({ stationId: 'table1', kind: 'pickup', kg: 0.03, jobId: 99999 }, e));
  assert.equal(r.body.job.closed, false);
});

test('a cell with no scale: Basket done tap; bag/tag collects from the spot', async () => {
  const { raw, env: e } = env();
  await seed(e, [sOrder(7001, '2026-11-10T10:00:00Z', [sLine('Sour Lifter Hemp Flower', '1 oz.', 2)]),
    sOrder(7002, '2026-11-10T10:05:00Z', [sLine('Lifter Hemp Flower', '1 oz.', 2)])]);
  const id = orderId(raw, '#7002');
  const j = raw.prepare(`SELECT id, station_id FROM cell_jobs WHERE order_id = ?`).get(id);
  assert.notEqual(j.station_id, 'table1', 'the second order went to the next free cell');
  assert.equal((await json(await orderAction({ orderId: id, op: 'collected' }, e))).status, 409, 'not at the spot yet');
  assert.equal((await jobDone({ jobId: j.id }, e)).status, 200);
  assert.equal((await jobDone({ jobId: j.id }, e)).status, 409, 'twice is refused');
  assert.equal(raw.prepare(`SELECT state FROM shop_orders WHERE id = ?`).get(id).state, 'ready');
  assert.equal((await orderAction({ orderId: id, op: 'collected' }, e)).status, 200);
  assert.ok(raw.prepare(`SELECT collected_at FROM shop_orders WHERE id = ?`).get(id).collected_at);
  const c = await queueOf(e, j.station_id);
  assert.deepEqual(c.atSpot, [], 'collected: nothing waiting at the spot');
});

test('bag/tag: confirm, move, hold and release, route a custom line', async () => {
  const { raw, env: e } = env();
  const custom = { id: `gid://shopify/LineItem/${++lid}`, title: '4 oz Sour Lifter tops (custom)', variantTitle: null,
    quantity: 1, unfulfilledQuantity: 1, product: null, variant: null };
  await seed(e, [
    sOrder(8001, '2026-11-10T10:00:00Z', [sLine('Sour Lifter Hemp Flower', '1 oz.', 1)]),
    sOrder(8002, '2026-11-10T10:05:00Z', [sLine('Rainbow GMO Hemp Flower', '1 oz.', 2, 'Smalls')]),
    sOrder(8003, '2026-11-10T10:10:00Z', [custom]),
  ]);
  const a = orderId(raw, '#8001'), b = orderId(raw, '#8002'), c = orderId(raw, '#8003');
  // Smalls only: confirm sends it straight to Ready to check.
  assert.equal((await orderAction({ orderId: b, op: 'confirm' }, e)).status, 200);
  assert.deepEqual({ ...raw.prepare(`SELECT state, collected_at IS NOT NULL AS col FROM shop_orders WHERE id = ?`).get(b) }, { state: 'ready', col: 1 });
  // A cell order: confirm only stamps the click.
  await orderAction({ orderId: a, op: 'confirm' }, e);
  assert.equal(raw.prepare(`SELECT state FROM shop_orders WHERE id = ?`).get(a).state, 'assigned');
  // Move it.
  assert.equal((await orderAction({ orderId: a, op: 'move', stationId: 'table14' }, e)).status, 200);
  assert.equal(raw.prepare(`SELECT station_id, assigned_by FROM cell_jobs WHERE order_id = ? AND state = 'queued'`).get(a).station_id, 'table14');
  // Hold frees the slot; release puts it back in line, and it's placed again.
  await orderAction({ orderId: a, op: 'hold' }, e);
  assert.equal(raw.prepare(`SELECT state FROM shop_orders WHERE id = ?`).get(a).state, 'hold');
  assert.equal(raw.prepare(`SELECT COUNT(*) n FROM cell_jobs WHERE order_id = ? AND state = 'queued'`).get(a).n, 0);
  await orderAction({ orderId: a, op: 'release' }, e);
  assert.equal(raw.prepare(`SELECT state FROM shop_orders WHERE id = ?`).get(a).state, 'assigned');
  // The custom line waits for bag/tag; once routed, it stays routed through the next poll.
  assert.equal(raw.prepare(`SELECT state FROM shop_orders WHERE id = ?`).get(c).state, 'queued');
  const l = raw.prepare(`SELECT id FROM shop_order_lines WHERE order_id = ?`).get(c).id;
  assert.equal((await orderAction({ orderId: c, op: 'route', lineId: l, route: 'cell' }, e)).status, 400, 'no cultivar: not a cell line');
  assert.equal((await orderAction({ orderId: c, op: 'route', lineId: l, route: 'bagging' }, e)).status, 200);
  await syncShopOrders(e, { gql: shop([sOrder(8003, '2026-11-10T10:10:00Z', [custom])]), now: NOW, force: true });
  assert.equal(raw.prepare(`SELECT route FROM shop_order_lines WHERE id = ?`).get(l).route, 'bagging');
  assert.equal((await orderAction({ orderId: a, op: 'nope' }, e)).status, 400);
});

test('cancelled in Shopify: its baskets leave the cell, and the slot refills', async () => {
  const { raw, env: e } = env();
  const nodes = Array.from({ length: 9 }, (_, i) => sOrder(9000 + i, `2026-11-10T1${i}:00:00Z`, [sLine('Sour Lifter Hemp Flower', '1 oz.', 1)]));
  await seed(e, nodes);
  assert.equal(raw.prepare(`SELECT state FROM shop_orders WHERE name = '#9008'`).get().state, 'queued');
  await syncShopOrders(e, { gql: shop(nodes.slice(1), { 'gid://shopify/Order/9000': { id: 'gid://shopify/Order/9000', cancelledAt: '2026-11-10T19:00:00Z', displayFulfillmentStatus: 'UNFULFILLED' } }), now: NOW, force: true });
  await fillSlots(e);
  assert.equal(raw.prepare(`SELECT COUNT(*) n FROM cell_jobs WHERE order_id = ? AND state = 'queued'`).get(orderId(raw, '#9000')).n, 0);
  assert.equal(raw.prepare(`SELECT state FROM shop_orders WHERE name = '#9008'`).get().state, 'assigned');
});

test('a cell trimming a hand-picked job is not free', async () => {
  const t0 = Date.parse('2026-11-11T16:00:00Z');
  const screen = (phase, target_g = 460) => ({ phase, target_g, updated_at: t0 - 5000 });
  assert.equal(handJobLeft(screen('running'), [], 160, t0), 300, 'running, nothing queued started: a hand job');
  assert.equal(handJobLeft(screen('running'), [{ started_at: 'x' }], 160, t0), 0, 'the running job is the queued one');
  assert.equal(handJobLeft(screen('armed', 115), [], null, t0), 115);
  assert.equal(handJobLeft(screen('armed', 115), [{ started_at: null }], null, t0), 0, 'armed on its queued NOW');
  assert.equal(handJobLeft({ ...screen('running'), updated_at: t0 - 10 * 60000 }, [], 0, t0), 0, 'a tablet that went quiet says nothing');

  const { raw, env: e } = env();
  raw.prepare(`INSERT INTO cell_screen_state (station_id, phase, cultivar, bag, target_g, paused, updated_at) VALUES ('table1', 'running', ?, 'lb1', 460, 0, ?)`)
    .run(SL, Date.now());
  await seed(e, [sOrder(9501, '2026-11-10T10:00:00Z', [sLine('Sour Lifter Hemp Flower', '1 oz.', 1)])]);
  assert.notEqual(raw.prepare(`SELECT station_id FROM cell_jobs WHERE order_id = ?`).get(orderId(raw, '#9501')).station_id, 'table1',
    'the first order goes to an idle cell, not behind table1\'s hand job');
});

test('hold is refused once a basket of the order is being trimmed', async () => {
  const { raw, env: e } = env();
  await seed(e, [sOrder(9601, '2026-11-10T10:00:00Z', [sLine('Sour Lifter Hemp Flower', '1 oz.', 1)])]);
  const id = orderId(raw, '#9601');
  raw.prepare(`UPDATE cell_jobs SET started_at = datetime('now') WHERE order_id = ?`).run(id);
  assert.equal((await orderAction({ orderId: id, op: 'hold' }, e)).status, 409);
});

test('before migration 0061: a clear 503, never a crash', async () => {
  const db = new DatabaseSync(':memory:');
  const s = sql => ({ first: async () => db.prepare(sql).get(), all: async () => ({ results: db.prepare(sql).all() }), run: async () => db.prepare(sql).run() });
  const e = { DB: { prepare: sql => ({ bind: () => s(sql), ...s(sql) }) } };
  assert.equal((await getCellQueue({}, e)).status, 503);
  assert.equal((await jobDone({ jobId: 1 }, e)).status, 503);
  assert.deepEqual(await fillSlots(e), { assigned: 0, notReady: true });
});

test('one pickup spot: the board\'s Collected on a basket collects the job and, with the last one, the order (and Undo)', async () => {
  const { raw, env: e } = env();
  await seed(e, [sOrder(9701, '2026-11-10T10:00:00Z', [sLine('Sour Lifter Hemp Flower', '1 lb.', 2)])]);
  const id = orderId(raw, '#9701');
  for (let i = 0; i < 2; i++) {
    const c = await queueOf(e, 'table1');
    await scaleMark({ stationId: 'table1', kind: 'pickup', kg: 0.46, cultivar: SL, bag: 'lb1', cycleS: 3000, jobId: c.now.id }, e);
  }
  const marks = raw.prepare(`SELECT id, job_id, collected_at FROM scale_marks WHERE kind = 'pickup' ORDER BY id`).all();
  assert.equal(marks.length, 2);
  assert.ok(marks.every(m => m.job_id && m.collected_at === null), 'waiting at the spot');
  const c = await queueOf(e, 'table1');
  assert.deepEqual(c.atSpot[0].jobIds.length, 2, 'the board can put the order number on each basket card');
  await collectPickup({ id: marks[0].id }, e);
  assert.equal(raw.prepare(`SELECT collected_at FROM shop_orders WHERE id = ?`).get(id).collected_at, null, 'one basket still at the spot');
  await collectPickup({ id: marks[1].id }, e);
  assert.ok(raw.prepare(`SELECT collected_at FROM shop_orders WHERE id = ?`).get(id).collected_at, 'both collected: on to check-weigh');
  await collectPickup({ id: marks[1].id, undo: true }, e);
  assert.equal(raw.prepare(`SELECT collected_at FROM shop_orders WHERE id = ?`).get(id).collected_at, null, 'undo puts the order back at the spot');
});

test('one pickup spot: bag/tag\'s order Collected clears the baskets\' marks too', async () => {
  const { raw, env: e } = env();
  await seed(e, [sOrder(9801, '2026-11-10T10:00:00Z', [sLine('Sour Lifter Hemp Flower', '1 oz.', 2)])]);
  const c = await queueOf(e, 'table1');
  await scaleMark({ stationId: 'table1', kind: 'pickup', kg: 0.06, cultivar: SL, bag: 'oz1', cycleS: 600, jobId: c.now.id }, e);
  assert.equal((await orderAction({ orderId: orderId(raw, '#9801'), op: 'collected' }, e)).status, 200);
  assert.ok(raw.prepare(`SELECT collected_at FROM scale_marks WHERE job_id = ?`).get(c.now.id).collected_at);
});
