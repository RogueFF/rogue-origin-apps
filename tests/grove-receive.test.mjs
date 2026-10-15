/**
 * Grove receive/recount/setBinConfig through the real router, on an in-memory
 * SQLite wrapped to look like D1 (migration 0046 + 0013 + the columns of
 * kanban_cards / inventory_adjustments the lane reads touch).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleKanbanD1 } from '../workers/src/handlers/kanban-d1.js';

const mig = (f) => readFileSync(new URL(`../workers/migrations/${f}`, import.meta.url), 'utf8');

function fakeEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE kanban_cards (id INTEGER PRIMARY KEY, item TEXT, crumbtrail TEXT, supplier TEXT);
    CREATE TABLE inventory_adjustments (id INTEGER PRIMARY KEY, timestamp TEXT, size TEXT, sku TEXT, adjustment_source TEXT);
    INSERT INTO kanban_cards (id, item, supplier) VALUES (21,'1 oz','Grove'),(54,'1 lb','Grove'),(56,'1/4','Grove'),(69,'blank','Grove'),(99,'10 lb','Grove'),(7,'tape','Uline');`);
  db.exec(mig('0013-kanban-reorder-requests.sql'));
  db.exec(mig('0046-kanban-bins.sql'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes, last_row_id: r.lastInsertRowid } }; },
  });
  return { db, DB: { prepare: (sql) => stmt(sql), batch: async (list) => { db.exec('BEGIN'); try { for (const s of list) await s.run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } } } };
}

async function call(env, action, body) {
  const url = `https://x.test/api/kanban?action=${action}`;
  const req = body ? new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) : new Request(url);
  return (await handleKanbanD1(req, env)).json();
}

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
