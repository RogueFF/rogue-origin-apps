import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlowOrder, usageRowsFor } from '../workers/src/lib/bin-usage.js';

const RECIPES = [{ variant_id: '111', card_id: 21, qty: 1 }, { variant_id: '222', card_id: 54, qty: 1 }, { variant_id: '222', card_id: 99, qty: 0 }, { variant_id: '333', card_id: 56, qty: 2 }];

test('parseFlowOrder accepts the Flow body and ignores junk', () => {
  const o = parseFlowOrder({ order: '#1001', at: '2026-10-14T01:02:03Z', items: [{ variant_id: 'gid://shopify/ProductVariant/111', qty: 2 }, { variant_id: '', qty: 1 }] });
  assert.deepEqual(o, { ref: '#1001', at: '2026-10-14T01:02:03.000Z', items: [{ variantId: '111', qty: 2 }] });
});
test('parseFlowOrder rejects a body with no order name', () => {
  assert.throws(() => parseFlowOrder({ items: [] }), /order/);
});
test('usageRowsFor multiplies qty by recipe qty and skips zero recipes', () => {
  const rows = usageRowsFor({ ref: '#1001', at: 'T', items: [{ variantId: '111', qty: 2 }, { variantId: '222', qty: 1 }] }, RECIPES);
  assert.deepEqual(rows, [
    { card_id: 21, qty: 2, source: 'shopify', ref: '#1001', variant_id: '111', at: 'T' },
    { card_id: 54, qty: 1, source: 'shopify', ref: '#1001', variant_id: '222', at: 'T' },
  ]);
});
test('an unmapped variant becomes a loud card_id 0 row, never silence', () => {
  const rows = usageRowsFor({ ref: '#1002', at: 'T', items: [{ variantId: '999', qty: 3 }] }, RECIPES);
  assert.deepEqual(rows, [{ card_id: 0, qty: 3, source: 'shopify:unmapped', ref: '#1002', variant_id: '999', at: 'T' }]);
});
test('parseFlowOrder accepts qty as a numeric string', () => {
  const o = parseFlowOrder({ order: '#1003', items: [{ variant_id: '111', qty: '2' }] });
  assert.deepEqual(o.items, [{ variantId: '111', qty: 2 }]);
});
test('parseFlowOrder drops zero, negative and NaN quantities', () => {
  const o = parseFlowOrder({ order: '#1004', items: [
    { variant_id: '111', qty: 0 }, { variant_id: '111', qty: -1 }, { variant_id: '111', qty: 'abc' }, { variant_id: '111' },
  ] });
  assert.deepEqual(o.items, []);
});
test('parseFlowOrder fills in an ISO timestamp when Flow omits at', () => {
  const o = parseFlowOrder({ order: '#1005', items: [] });
  assert.match(o.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
});
test('parseFlowOrder tolerates a missing items array', () => {
  assert.deepEqual(parseFlowOrder({ order: '#1006', at: '2026-10-14T01:02:03Z' }).items, []);
});
test('parseFlowOrder normalises at to toISOString() form', () => {
  assert.equal(parseFlowOrder({ order: '#1007', at: '2026-10-14T01:02:03Z' }).at, '2026-10-14T01:02:03.000Z');
  assert.equal(parseFlowOrder({ order: '#1007', at: '2026-10-13T18:02:03-07:00' }).at, '2026-10-14T01:02:03.000Z');
});
test('parseFlowOrder replaces a junk at with now, in ISO', () => {
  assert.match(parseFlowOrder({ order: '#1008', at: 'not a date' }).at, /^\d{4}-\d\d-\d\dT.*Z$/);
});
test('the same variant twice in one order is summed, so the unique index cannot drop a line', () => {
  const o = parseFlowOrder({ order: '#1009', at: '2026-10-14T01:02:03Z', items: [{ variant_id: '111', qty: 1 }, { variant_id: 'gid://shopify/ProductVariant/111', qty: 2 }] });
  assert.deepEqual(o.items, [{ variantId: '111', qty: 3 }]);
  const rows = usageRowsFor(o, RECIPES);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].qty, 3);
});
test('a recipe qty of 2 doubles the bags consumed', () => {
  const rows = usageRowsFor({ ref: '#1010', at: 'T', items: [{ variantId: '333', qty: 2 }] }, RECIPES);
  assert.deepEqual(rows, [{ card_id: 56, qty: 4, source: 'shopify', ref: '#1010', variant_id: '333', at: 'T' }]);
});
