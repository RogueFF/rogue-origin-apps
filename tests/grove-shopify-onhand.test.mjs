/**
 * The 10 lb Grove lane (card 99) reads its on hand from Shopify's last word —
 * the Flow echo rows in inventory_adjustments for the "Grove Bags" product's
 * "10 lbs." variant — when that word is newer than the last count. Design:
 * docs/plans/2026-10-14-grove-bins-design.md, addendum 2026-10-21.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeEnv, call } from './helpers/fake-d1.mjs';

const secs = (n) => new Date(Date.now() + n * 1000).toISOString().slice(0, 19) + 'Z'; // Flow echoes carry whole seconds
const echo = (env, at, total, variant = '10 lbs.') => env.db.exec(`INSERT INTO inventory_adjustments
  (timestamp, size, sku, adjustment_source, product_name, variant_title, new_total_available)
  VALUES ('${at}', '', '', 'shopify_flow', 'Grove Bags', '${variant}', ${total})`);
const lane99 = async (env) => (await call(env, 'getBinStatus&cardId=99')).lanes[0];

test('Shopify’s word newer than the count: card 99 shows Shopify’s level and says so', async () => {
  const env = fakeEnv();
  await call(env, 'recount', { cardId: 99, sealedBins: 10 });          // 500 counted
  const at = secs(5);
  echo(env, at, 294);
  const ln = await lane99(env);
  assert.equal(ln.onHand, 294);
  assert.equal(ln.bins, 5);
  assert.equal(ln.onHandSource, 'shopify');
  assert.equal(ln.ledgerOnHand, 500);
  assert.deepEqual(ln.shopify, { available: 294, at, bins: 5, agrees: false });
});

test('the count newer than Shopify’s word: the count shows, Shopify rides beside it for the nag', async () => {
  const env = fakeEnv();
  echo(env, secs(-60), 294);
  await call(env, 'recount', { cardId: 99, sealedBins: 10 });
  const ln = await lane99(env);
  assert.equal(ln.onHand, 500);
  assert.equal(ln.onHandSource, 'ledger');
  assert.equal(ln.shopify.available, 294);
  assert.equal(ln.shopify.agrees, false);
});

test('receive answers with the lane’s Shopify word so the Desk can say what to set', async () => {
  const env = fakeEnv();
  echo(env, secs(-60), 294);
  const r = await call(env, 'receiveBins', { cardId: 99, leftoverBins: 2, boxes: 4 });
  assert.equal(r.lane.onHand, 500);
  assert.equal(r.lane.onHandSource, 'ledger');
  assert.deepEqual({ ...r.lane.shopify, at: undefined }, { available: 294, bins: 5, agrees: false, at: undefined });
});

test('barn scans are usage, never a Shopify word; another size’s echo never feeds the 10 lb lane', async () => {
  const env = fakeEnv();
  echo(env, secs(-60), 294);
  await call(env, 'recount', { cardId: 99, sealedBins: 10 });
  env.db.exec(`INSERT INTO inventory_adjustments (timestamp, size, sku) VALUES ('${new Date(Date.now() + 1000).toISOString()}', '10lb', 'MANUAL-10LB-BAG')`);
  echo(env, secs(10), 999, '1 oz.');
  const ln = await lane99(env);
  assert.equal(ln.onHand, 499);                 // count 500 − 1 barn scan
  assert.equal(ln.onHandSource, 'ledger');
  assert.equal(ln.shopify.available, 294);      // the 1 oz. echo is not this lane's
});

test('no Shopify word at all: the lane is the ledger, as before; other lanes never carry one', async () => {
  const env = fakeEnv();
  await call(env, 'recount', { cardId: 99, sealedBins: 10 });
  await call(env, 'recount', { cardId: 21, sealedBins: 4 });
  echo(env, secs(5), 294, '1 oz.');             // a 1 oz. echo exists, but card 21 does not read Shopify
  const s = await call(env, 'getBinStatus');
  const by = Object.fromEntries(s.lanes.map(l => [l.cardId, l]));
  assert.equal(by[99].onHand, 500);
  assert.equal(by[99].onHandSource, 'ledger');
  assert.equal(by[99].shopify, null);
  assert.equal(by[21].onHand, 200);
  assert.equal(by[21].onHandSource, 'ledger');
  assert.equal(by[21].shopify, null);
});

test('a Shopify echo with no level is not a word', async () => {
  const env = fakeEnv();
  await call(env, 'recount', { cardId: 99, sealedBins: 10 });
  env.db.exec(`INSERT INTO inventory_adjustments (timestamp, adjustment_source, product_name, variant_title, new_total_available)
    VALUES ('${secs(5)}', 'shopify_flow', 'Grove Bags', '10 lbs.', NULL)`);
  const ln = await lane99(env);
  assert.equal(ln.onHandSource, 'ledger');
  assert.equal(ln.shopify, null);
});
