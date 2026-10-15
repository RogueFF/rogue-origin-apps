import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMonth, pickColumn, seedRows, seedDays, monthlyTotals } from '../scripts/lib/grove-seed-usage-lib.mjs';

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

test('seedDays: every calendar day at noon UTC', () => {
  const nov = seedDays('2025-11');
  assert.equal(nov.length, 30);
  assert.deepEqual(nov[0], { day: '2025-11-01', at: '2025-11-01T12:00:00.000Z' });
  assert.deepEqual(nov[29], { day: '2025-11-30', at: '2025-11-30T12:00:00.000Z' });
  assert.equal(seedDays('2025-12').length, 31);
  assert.equal(seedDays('2026-02').length, 28);
  assert.equal(seedDays('2024-02').length, 29);
});

test('seedRows: aggregates same variant + month, emits SQL', () => {
  const { rows, months, unmapped, bad } = seedRows([
    { month: '2025-11-01', variantId: '111', title: 'Sour Lifter / 1 oz', sku: 'SL-1OZ', qty: '400' },
    { month: 'Nov 2025', variantId: '111', title: 'Sour Lifter / 1 oz', sku: 'SL-1OZ', qty: '212' },
    { month: '2025-12', variantId: '111', title: 'Sour Lifter / 1 oz', sku: 'SL-1OZ', qty: '1,050' },
    { month: '2025-11', variantId: '222', title: 'Lifter / 10 lb', sku: '', qty: '3' },
  ]);
  assert.deepEqual(unmapped, []);
  assert.deepEqual(bad, []);
  // Nov 612 (1 oz) + Nov 3 (10 lb) over 30 days, Dec 1,050 over 31.
  assert.equal(rows.length, 30 + 30 + 31);
  const nov1oz = rows.filter(r => r.month === '2025-11' && r.card === 21);
  assert.equal(nov1oz.length, 30);
  assert.ok(nov1oz.every(r => r.qty === 20.4));
  assert.equal(nov1oz[0].sql,
    "INSERT OR IGNORE INTO kanban_usage (card_id, qty, source, ref, variant_id, at) VALUES (21, 20.4, 'shopify:seed', '2025-11-01', '111', '2025-11-01T12:00:00.000Z');");
  assert.equal(nov1oz[29].at, '2025-11-30T12:00:00.000Z');
  assert.equal(nov1oz[29].day, '2025-11-30');
  assert.equal(rows.find(r => r.card === 99).qty, 0.1); // 3 / 30
  assert.equal(rows.find(r => r.month === '2025-12').qty, 33.871); // 1050 / 31, 3 decimals
  assert.equal(new Set(rows.map(r => `${r.day}|${r.card}|${r.variantId}`)).size, rows.length); // unique refs
  assert.deepEqual(monthlyTotals(months), { '2025-11': { 21: 612, 99: 3 }, '2025-12': { 21: 1050 } });
});

test('seedRows: SKU helps place the card; qty <= 0 skipped', () => {
  const { rows } = seedRows([
    { month: '2025-11', variantId: '333', title: 'Default Title', sku: 'LIFTER-1LB', qty: '5' },
    { month: '2025-11', variantId: '333', title: 'Default Title', sku: 'LIFTER-1LB', qty: '-2' },
    { month: '2025-11', variantId: '444', title: 'Lifter 1 oz', sku: '', qty: '0' },
  ]);
  assert.equal(rows.length, 30);
  assert.deepEqual([...new Set(rows.map(r => [r.variantId, r.card, r.qty].join()))], ['333,54,0.167']);
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
