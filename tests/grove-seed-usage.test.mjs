import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMonth, pickColumn, seedRows, seedAt, monthlyTotals } from '../scripts/lib/grove-seed-usage-lib.mjs';

test('parseMonth: YYYY-MM, YYYY-MM-DD, Mon YYYY', () => {
  assert.equal(parseMonth('2025-11'), '2025-11');
  assert.equal(parseMonth('2025-11-01'), '2025-11');
  assert.equal(parseMonth('2025-1-05'), '2025-01');
  assert.equal(parseMonth('2025-11-01T00:00:00-08:00'), '2025-11');
  assert.equal(parseMonth('Nov 2025'), '2025-11');
  assert.equal(parseMonth('November 2025'), '2025-11');
  assert.equal(parseMonth(' dec 2025 '), '2025-12');
  assert.equal(parseMonth('2025-13'), null);
  assert.equal(parseMonth('Foo 2025'), null);
  assert.equal(parseMonth(''), null);
  assert.equal(parseMonth(undefined), null);
});

test('pickColumn: case-insensitive, first candidate wins', () => {
  const head = ['MONTH', 'product variant id', ' Net Items Sold ', 'Day'];
  assert.equal(pickColumn(head, ['Month', 'Day']), 0);
  assert.equal(pickColumn(head, ['Day', 'Month']), 3);
  assert.equal(pickColumn(head, ['Product variant ID']), 1);
  assert.equal(pickColumn(head, ['Net quantity', 'Net items sold']), 2);
  assert.equal(pickColumn(head, ['Quantity ordered']), -1);
});

test('seedAt: mid-month noon UTC ISO string', () => {
  assert.equal(seedAt('2025-11'), '2025-11-15T12:00:00.000Z');
});

test('seedRows: aggregates same variant + month, emits SQL', () => {
  const { rows, unmapped, bad } = seedRows([
    { month: '2025-11-01', variantId: '111', title: 'Sour Lifter / 1 oz', sku: 'SL-1OZ', qty: '400' },
    { month: 'Nov 2025', variantId: '111', title: 'Sour Lifter / 1 oz', sku: 'SL-1OZ', qty: '212' },
    { month: '2025-12', variantId: '111', title: 'Sour Lifter / 1 oz', sku: 'SL-1OZ', qty: '1,050' },
    { month: '2025-11', variantId: '222', title: 'Lifter / 10 lb', sku: '', qty: '3' },
  ]);
  assert.deepEqual(unmapped, []);
  assert.deepEqual(bad, []);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].sql,
    "INSERT OR IGNORE INTO kanban_usage (card_id, qty, source, ref, variant_id, at) VALUES (21, 612, 'shopify:seed', '2025-11', '111', '2025-11-15T12:00:00.000Z');");
  assert.deepEqual(rows.map(r => [r.month, r.card, r.qty]), [['2025-11', 21, 612], ['2025-11', 99, 3], ['2025-12', 21, 1050]]);
  assert.deepEqual(monthlyTotals(rows), { '2025-11': { 21: 612, 99: 3 }, '2025-12': { 21: 1050 } });
});

test('seedRows: SKU helps place the card; qty <= 0 skipped', () => {
  const { rows } = seedRows([
    { month: '2025-11', variantId: '333', title: 'Default Title', sku: 'LIFTER-1LB', qty: '5' },
    { month: '2025-11', variantId: '333', title: 'Default Title', sku: 'LIFTER-1LB', qty: '-2' },
    { month: '2025-11', variantId: '444', title: 'Lifter 1 oz', sku: '', qty: '0' },
  ]);
  assert.deepEqual(rows.map(r => [r.variantId, r.card, r.qty]), [['333', 54, 5]]);
});

test('seedRows: unmapped and bad ids are reported, not emitted', () => {
  const { rows, unmapped, bad } = seedRows([
    { month: '2025-11', variantId: '555', title: 'Gift Card', sku: '', qty: '4' },
    { month: '2025-12', variantId: '555', title: 'Gift Card', sku: '', qty: '1' },
    { month: '2025-11', variantId: 'gid://shopify/ProductVariant/1', title: '1 oz', sku: '', qty: '4' },
    { month: '2025-11', variantId: "1'; DROP", title: '1 oz', sku: '', qty: '4' },
    { month: 'someday', variantId: '666', title: '1 oz', sku: '', qty: '4' },
  ]);
  assert.equal(rows.length, 0);
  assert.deepEqual(unmapped, [{ variantId: '555', title: 'Gift Card' }]);
  assert.deepEqual(bad.map(b => b.reason), ['id', 'id', 'month someday']);
});
