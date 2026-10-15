/**
 * Grove reorder requests through the router (fake D1): the email carries the
 * lane (order-by first line) on both scan paths, and closing logs a kanban_orders row.
 * Mail goes through the relay transport with fetch stubbed to capture the body.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fakeEnv, call } from './helpers/fake-d1.mjs';

let sent, realFetch;
beforeEach(() => {
  sent = []; realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true, success: true })); };
});
afterEach(() => { globalThis.fetch = realFetch; });

const mailEnv = () => Object.assign(fakeEnv(), { MAIL_RELAY_URL: 'https://relay.test/exec', MAIL_RELAY_SECRET: 's', DAMON_EMAIL: 'damon@example.test' });

test('red-card scan: the email leads with the order-by date', async () => {
  const env = mailEnv();
  await call(env, 'recount', { cardId: 21, sealedBins: 10 });
  const { redCard } = await call(env, 'makeLaneKit', { cardId: 21 });
  await call(env, 'scanCard', { token: redCard.token });
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.split('\n')[0], /^1 oz — order by /);
  assert.match(sent[0].body, /On hand: 500 bags \(10 bins\)/);
  assert.match(sent[0].body, /\(seed estimate\)/);
});

test('cart-scan path (addToCart) on a Grove lane also sends the lane email', async () => {
  const env = mailEnv();
  await call(env, 'addToCart', { cardId: 54 });
  assert.match(sent[0].body.split('\n')[0], /^1 lb — order by /);
});

test('a Grove card with no bin lane keeps the old email', async () => {
  const env = mailEnv();
  env.db.exec(`INSERT INTO kanban_cards (id, item, supplier) VALUES (300, 'Grove misc', 'Grove')`);
  await call(env, 'addToCart', { cardId: 300 });
  assert.match(sent[0].body, /was flagged for reorder/);
});

test('closing a request writes one kanban_orders row (vendor, placed_by, items with MOQ)', async () => {
  const env = mailEnv();
  await call(env, 'addToCart', { cardId: 21 });
  const { close_token } = env.db.prepare('SELECT close_token FROM kanban_reorder_requests').get();
  const r = await call(env, 'closeReorderRequest', { token: close_token, closedBy: 'Damon' });
  assert.equal(r.alreadyClosed, false);
  const rows = env.db.prepare('SELECT vendor, placed_by, items_json FROM kanban_orders').all();
  assert.equal(rows.length, 1);
  assert.deepEqual({ vendor: rows[0].vendor, placed_by: rows[0].placed_by }, { vendor: 'Grove', placed_by: 'Damon' });
  assert.deepEqual(JSON.parse(rows[0].items_json), [{ cardId: 21, item: '1 oz', qty: 2500 }]);
  // Idempotent: a second close is a no-op and writes nothing.
  assert.equal((await call(env, 'closeReorderRequest', { token: close_token })).alreadyClosed, true);
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM kanban_orders').get().n, 1);
});

test('closing via the email link with no lane config logs qty null and placed_by email-link', async () => {
  const env = mailEnv();
  env.db.exec(`INSERT INTO kanban_cards (id, item, supplier) VALUES (300, 'Grove misc', 'Grove')`);
  await call(env, 'addToCart', { cardId: 300 });
  const { close_token } = env.db.prepare('SELECT close_token FROM kanban_reorder_requests').get();
  await call(env, 'closeReorderRequest', { token: close_token });
  const row = env.db.prepare('SELECT placed_by, items_json FROM kanban_orders').get();
  assert.equal(row.placed_by, 'email-link');
  assert.deepEqual(JSON.parse(row.items_json), [{ cardId: 300, item: 'Grove misc', qty: null }]);
});
