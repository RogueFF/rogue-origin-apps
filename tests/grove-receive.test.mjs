/**
 * Grove receive/recount/setBinConfig through the real router, on the in-memory
 * SQLite D1 stand-in in helpers/fake-d1.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeEnv, call } from './helpers/fake-d1.mjs';

test('first receive on an empty lane: no recount, baseline = boxes × perBox', async () => {
  const env = fakeEnv();
  const r = await call(env, 'receiveBins', { cardId: 21, leftoverBins: 10, boxes: 25 });
  assert.equal(r.needsRecount, false);
  assert.equal(r.estimateBefore, 0);
  assert.equal(r.lane.baseline.bags, 10 * 50 + 25 * 100);
  assert.match(r.lane.baseline.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
});

test('bin-size override applies to incoming boxes; leftovers count at the old size', async () => {
  const env = fakeEnv();
  await call(env, 'recount', { cardId: 21, sealedBins: 4 });            // 200 on hand at cfg 50
  const r = await call(env, 'receiveBins', { cardId: 21, leftoverBins: 4, boxes: 10, bagsPerBin: 25 });
  assert.equal(r.needsRecount, false);
  assert.equal(r.lane.baseline.bags, 4 * 50 + 10 * 100);
  assert.equal(r.lane.config.bagsPerBin, 25);                           // stored for next time
  const ev = env.db.prepare(`SELECT bins, bag_count FROM kanban_bin_events WHERE kind='receive'`).get();
  assert.deepEqual({ ...ev }, { bins: 4 + 40, bag_count: 25 });
});

test('receive more than a bin off the estimate flags a recount', async () => {
  const env = fakeEnv();
  await call(env, 'recount', { cardId: 21, sealedBins: 40 });
  assert.equal((await call(env, 'receiveBins', { cardId: 21, leftoverBins: 39, boxes: 0 })).needsRecount, false);
  await call(env, 'recount', { cardId: 21, sealedBins: 40 });
  assert.equal((await call(env, 'receiveBins', { cardId: 21, leftoverBins: 38, boxes: 0 })).needsRecount, true);
});

test('setBinConfig upserts without clobbering unspecified columns', async () => {
  const env = fakeEnv();
  const r = await call(env, 'setBinConfig', { cardId: 21, safetyDays: 20 });
  assert.equal(r.lane.config.safetyDays, 20);
  assert.equal(r.lane.config.seedPerMonth, 600);
  const n = await call(env, 'setBinConfig', { cardId: 7, bagsPerBin: 10 });
  assert.equal(n.lane.config.bagsPerBin, 10);
  assert.equal(n.lane.config.seedPerMonth, 0);
});

test('validation: bad ids and sizes are 400/404, lot is capped', async () => {
  const env = fakeEnv();
  await assert.rejects(call(env, 'setBinConfig', { cardId: 21, bagsPerBin: 0 }), (e) => e.status === 400 || e.code === 'VALIDATION_ERROR');
  await assert.rejects(call(env, 'recount', { cardId: 1.5, sealedBins: 1 }), (e) => e.code === 'VALIDATION_ERROR');
  await assert.rejects(call(env, 'getBinStatus'.concat('&cardId=abc')), (e) => e.code === 'VALIDATION_ERROR');
  await assert.rejects(call(env, 'setBinConfig', { cardId: 12345, moq: 0 }), (e) => e.code === 'NOT_FOUND');
  await call(env, 'receiveBins', { cardId: 21, leftoverBins: 0, boxes: 1, lot: 'L'.repeat(300) });
  assert.equal(env.db.prepare(`SELECT length(lot) AS n FROM kanban_bin_events`).get().n, 100);
});

test('10 lb lane counts only barn scans (MANUAL-10LB-BAG), not Flow echoes', async () => {
  const env = fakeEnv();
  await call(env, 'recount', { cardId: 99, sealedBins: 10 });
  const t = new Date(Date.now() + 1000).toISOString();
  env.db.exec(`INSERT INTO inventory_adjustments (timestamp, size, sku, adjustment_source) VALUES
    ('${t}','10lb','MANUAL-10LB-BAG',NULL), ('${t}','10lb','RO-10LB-X','shopify_flow')`);
  const s = await call(env, 'getBinStatus&cardId=99');
  assert.equal(s.lanes[0].onHand, 499);
});

test('counts must be plain whole numbers: true / [5] / 1.5 are 400', async () => {
  const env = fakeEnv();
  for (const bad of [true, [5], 1.5, -1, '2x']) {
    await assert.rejects(call(env, 'receiveBins', { cardId: 21, leftoverBins: 0, boxes: bad }), (e) => e.code === 'VALIDATION_ERROR', `boxes ${JSON.stringify(bad)}`);
    await assert.rejects(call(env, 'receiveBins', { cardId: 21, leftoverBins: bad, boxes: 1 }), (e) => e.code === 'VALIDATION_ERROR', `leftoverBins ${JSON.stringify(bad)}`);
    await assert.rejects(call(env, 'recount', { cardId: 21, sealedBins: bad }), (e) => e.code === 'VALIDATION_ERROR', `sealedBins ${JSON.stringify(bad)}`);
  }
  const ok = await call(env, 'receiveBins', { cardId: 21, leftoverBins: '2', boxes: '3' });
  assert.equal(ok.lane.baseline.bags, 2 * 50 + 3 * 100);
  assert.equal((await call(env, 'recount', { cardId: 21, sealedBins: '4' })).lane.baseline.bags, 200);
});

test('receive that answers an open request logs the order (placed_by receive, bags received)', async () => {
  const env = fakeEnv();
  await call(env, 'addToCart', { cardId: 21 });                         // opens a Damon request (mail fails harmlessly)
  await call(env, 'receiveBins', { cardId: 21, leftoverBins: 2, boxes: 25 });
  assert.equal(env.db.prepare(`SELECT status FROM kanban_reorder_requests`).get().status, 'ordered');
  const rows = env.db.prepare('SELECT vendor, placed_by, items_json FROM kanban_orders').all();
  assert.equal(rows.length, 1);
  assert.deepEqual({ vendor: rows[0].vendor, placed_by: rows[0].placed_by }, { vendor: 'Grove', placed_by: 'receive' });
  assert.deepEqual(JSON.parse(rows[0].items_json), [{ cardId: 21, item: '1 oz', qty: 2500 }]);
  // No open request → a receive logs no order.
  await call(env, 'receiveBins', { cardId: 21, leftoverBins: 0, boxes: 5 });
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM kanban_orders').get().n, 1);
});
