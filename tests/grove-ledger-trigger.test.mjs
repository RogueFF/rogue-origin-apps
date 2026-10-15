/** Grove ledger trigger: a Shopify order that takes a lane to its reorder point raises the Damon request (fake D1). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeEnv, call } from './helpers/fake-d1.mjs';

/** Card 21 sitting exactly `extra` bags above its reorder point, with variant 111 → 1 bag of card 21. */
async function laneAbovePoint(extra) {
  const env = fakeEnv();
  const { reorderPoint } = (await call(env, 'getBinStatus&cardId=21')).lanes[0];
  env.db.prepare('INSERT INTO kanban_baselines (card_id, bags, at, reason) VALUES (?, ?, ?, ?)')
    .run(21, reorderPoint + extra, new Date(Date.now() - 3600e3).toISOString(), 'recount');
  await call(env, 'setRecipe', { variant_id: '111', card_id: 21, qty: 1 });
  return env;
}
const order = (ref, qty = 1) => ({ order: ref, at: new Date().toISOString(), items: [{ variant_id: 'gid://shopify/ProductVariant/111', qty }] });
const openRequests = (env) => env.db.prepare(`SELECT card_id FROM kanban_reorder_requests WHERE status = 'open'`).all();

test('an order that reaches the reorder point raises one request; the next order does not add another', async () => {
  const env = await laneAbovePoint(1);
  assert.equal((await call(env, 'getBinStatus&cardId=21')).lanes[0].status, 'soon');
  const r = await call(env, 'orderUsage', order('#1001'));
  assert.deepEqual(r.touched, [21]);
  assert.deepEqual(openRequests(env).map(x => x.card_id), [21]);
  await call(env, 'orderUsage', order('#1002'));
  assert.equal(openRequests(env).length, 1);
});

test('an order that leaves the lane above its point raises nothing', async () => {
  const env = await laneAbovePoint(2);
  await call(env, 'orderUsage', order('#1001'));
  assert.equal(openRequests(env).length, 0);
});

test('a trigger failure never fails the webhook', async () => {
  const env = await laneAbovePoint(1);
  env.db.exec('DROP TABLE kanban_reorder_requests');
  const r = await call(env, 'orderUsage', order('#1001'));
  assert.equal(r.success, true);
  assert.equal(r.written, 1);
});

test('once Damon marks it ordered, later orders do not raise again until the bins are received', async () => {
  const env = await laneAbovePoint(1);
  await call(env, 'orderUsage', order('#1001'));
  const { close_token } = env.db.prepare('SELECT close_token FROM kanban_reorder_requests').get();
  await call(env, 'closeReorderRequest', { token: close_token, closedBy: 'Damon' });
  await call(env, 'orderUsage', order('#1002'));
  await call(env, 'orderUsage', order('#1003'));
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM kanban_reorder_requests').get().n, 1);
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM kanban_orders').get().n, 1);
  // A mid-lead recount must not re-arm the trigger either.
  await call(env, 'recount', { cardId: 21, sealedBins: 1 });
  await call(env, 'orderUsage', order('#1004'));
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM kanban_reorder_requests').get().n, 1);
  // The delivery lands (receive), then the lane runs down again: the trigger is armed again.
  await call(env, 'receiveBins', { cardId: 21, leftoverBins: 0, boxes: 0 });
  await new Promise(r => setTimeout(r, 5));
  await call(env, 'orderUsage', order('#1005'));
  assert.equal(openRequests(env).length, 1);
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM kanban_reorder_requests').get().n, 2);
});

test('an ordered request older than lead + safety with no receive no longer holds the trigger', async () => {
  const env = await laneAbovePoint(1);
  env.db.prepare(`INSERT INTO kanban_reorder_requests (card_id, status, close_token, requested_at, closed_at, closed_by) VALUES (21, 'ordered', 'old', ?, ?, 'Damon')`)
    .run(new Date(Date.now() - 200 * 864e5).toISOString(), new Date(Date.now() - 120 * 864e5).toISOString());
  await call(env, 'orderUsage', order('#1001'));
  assert.equal(openRequests(env).length, 1);
});

test('an uncounted lane (no baseline) never emails Damon, however low it looks', async () => {
  const env = fakeEnv();
  await call(env, 'setRecipe', { variant_id: '111', card_id: 21, qty: 1 });
  assert.equal((await call(env, 'getBinStatus&cardId=21')).lanes[0].status, 'order');   // onHand 0 at seed rate
  await call(env, 'orderUsage', order('#1001'));
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM kanban_reorder_requests').get().n, 0);
});

test('runbook re-arm: a zero-box receive after a closed test request re-arms the trigger and logs no order', async () => {
  const env = await laneAbovePoint(1);
  await call(env, 'orderUsage', order('#1001'));
  const { close_token } = env.db.prepare('SELECT close_token FROM kanban_reorder_requests').get();
  await call(env, 'closeReorderRequest', { token: close_token });
  const ordersBefore = env.db.prepare('SELECT COUNT(*) AS n FROM kanban_orders').get().n;
  await new Promise(r => setTimeout(r, 5));
  await call(env, 'receiveBins', { cardId: 21, leftoverBins: 1, boxes: 0 });
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM kanban_orders').get().n, ordersBefore);
  await new Promise(r => setTimeout(r, 5));
  await call(env, 'orderUsage', order('#1002'));
  assert.equal(openRequests(env).length, 1);
});
