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
