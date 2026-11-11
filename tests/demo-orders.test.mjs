// Mock orders for the practice mode (src/js/demo/orders.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDay, parseShopifyExport, replayDay, lineFromName, parseCsv, pacificMs } from '../src/js/demo/orders.mjs';

test('a generated day has the 90-day shape, and the same seed gives the same day', () => {
  const a = generateDay({ day: '2026-11-10', seed: 7 });
  const b = generateDay({ day: '2026-11-10', seed: 7 });
  assert.deepEqual(a, b);
  assert.ok(a.orders.length >= 28 && a.orders.length <= 40, `weekday ~34 (${a.orders.length})`);
  const sat = generateDay({ day: '2026-11-14', seed: 7 });
  assert.ok(sat.orders.length < a.orders.length, 'weekends are lighter');
  // Over many days: median 1 line, P90 about 3, ~11% rush, ~27.5% mixed.
  const all = [];
  for (let d = 1; d <= 28; d++) all.push(...generateDay({ day: `2026-10-${String(d).padStart(2, '0')}`, seed: 3 }).orders);
  const lines = all.map(o => o.lines.length).sort((x, y) => x - y);
  assert.equal(lines[Math.floor(lines.length / 2)], 1);
  assert.ok(lines[Math.floor(lines.length * 0.9)] >= 2 && lines[Math.floor(lines.length * 0.9)] <= 4);
  const rush = all.filter(o => o.rush).length / all.length;
  assert.ok(rush > 0.06 && rush < 0.16, `rush ${rush}`);
  const mixed = all.filter(o => new Set(o.lines.filter(l => l.options && l.options['Bag Size']).map(l => l.title)).size > 1).length / all.length;
  assert.ok(mixed > 0.15 && mixed < 0.4, `mixed ${mixed}`);
  for (const o of all) for (const l of o.lines) assert.ok(!('email' in l) && !('customer' in o), 'no buyer fields');
  assert.ok(a.orders.every((o, i, arr) => i === 0 || o.simAt >= arr[i - 1].simAt), 'in arrival order');
  assert.equal(a.simStartMs, pacificMs('2026-11-10', 6, 55));
});

test('Shopify export lines become the same lines the intake reads', () => {
  assert.deepEqual(lineFromName('Sour Lifter Hemp Flower - 1 oz. / Tops', 2),
    { title: 'Sour Lifter Hemp Flower', options: { 'Bag Size': '1 oz.', 'Flower Type': 'Tops' }, productTags: ['retail-only'], qty: 2 });
  assert.deepEqual(lineFromName('[2025] Lifter Hemp Flower - 1 lb. / Tops', 1).productTags, []);
  assert.equal(lineFromName('10 lb Sour Lifter tops (custom)', 1).custom, true);
  assert.deepEqual(parseCsv('a,"b, c","d ""e"""\n1,2,3\n'), [['a', 'b, c', 'd "e"'], ['1', '2', '3']]);
});

test('a real export replays one production day exactly, reading no buyer column', () => {
  const csv = [
    'Name,Email,Financial Status,Shipping Method,Created at,Lineitem quantity,Lineitem name,Billing Name,Shipping Address1',
    '#5001,someone@example.com,paid,Ground,2026-11-09 18:10:00 -0800,2,Sour Lifter Hemp Flower - 1 oz. / Tops,A Person,1 Main St',
    '#5001,,,,,1,Rainbow GMO Hemp Flower - 1 oz. / Smalls,,',
    '#5002,x@example.com,paid,UPS Next Day Air,2026-11-10 09:30:00 -0800,1,Orange Fritter Hemp Flower - 1/4 oz. / Tops,B Person,2 Main St',
    '#5003,y@example.com,paid,Ground,2026-11-10 17:00:00 -0800,1,Lifter Hemp Flower - 1 oz. / Tops,C Person,3 Main St',
    '#4999,z@example.com,paid,Ground,2026-11-09 10:00:00 -0800,1,Lifter Hemp Flower - 1 oz. / Tops,D Person,4 Main St',
  ].join('\n');
  const orders = parseShopifyExport(csv);
  assert.equal(orders.length, 4);
  assert.ok(!JSON.stringify(orders).match(/example\.com|Person|Main St|paid/), 'no buyer data read');
  const day = replayDay(orders, '2026-11-10');
  assert.deepEqual(day.orders.map(o => o.name), ['#5001', '#5002'], 'Mon 4:30 PM to Tue 4:30 PM');
  assert.equal(day.orders[0].simAt, day.simStartMs, 'overnight orders arrive at the start');
  assert.equal(day.orders[1].rush, true);
  assert.equal(day.orders[0].lines.length, 2);
  assert.throws(() => parseShopifyExport('a,b\n1,2'), /Not a Shopify order export/);
});
