// One-click print, browser path (order flow slice 4: lib/order-coa.js,
// handlers/production/order-print.js). Made-up orders; COA names as in
// raw/coas/2026/Post-Harvest/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { parseCoaName, coaFor, coaFiles, resetCoaCache, safeCoaFile, COA_PREFIX } from '../src/lib/order-coa.js';
import { getOrderPrint, coaPdf, adminOrderUrl } from '../src/handlers/production/order-print.js';
import { getOrderQueue } from '../src/handlers/production/order-queue.js';

const FILES = [
  'Sour-Lifter-PostHarvest-G1395-2026.pdf', 'Orange-Fritter-PostHarvest-G1396-2026.pdf',
  'Rainbow-GMO-PostHarvest-G1393-2026.pdf', 'Rainbow-GMO-PostHarvest-G4044-2026.pdf',
  'Peytons-Strawberries-1-PostHarvest-G1330-2026.pdf', 'Peytons-Strawberries-18-PostHarvest-G1331-2026.pdf',
];

test('COA names: cultivar from the file name; one per cultivar; Rainbow GMO is the field round', () => {
  assert.deepEqual(parseCoaName('Sour-Lifter-PostHarvest-G1395-2026.pdf'), { key: 'sour lifter', sample: 'G1395', year: '2026', file: 'Sour-Lifter-PostHarvest-G1395-2026.pdf' });
  assert.equal(parseCoaName('notes.txt'), null);
  assert.deepEqual(coaFor('Sour Lifter', FILES), { file: 'Sour-Lifter-PostHarvest-G1395-2026.pdf' });
  assert.deepEqual(coaFor('Rainbow GMO', FILES), { file: 'Rainbow-GMO-PostHarvest-G1393-2026.pdf' });
  assert.deepEqual(coaFor('Lifter', FILES), { missing: true }, 'Lifter is not Sour Lifter');
  assert.deepEqual(coaFor('Purple Snowman', FILES), { missing: true });
  assert.ok(safeCoaFile('Sour-Lifter-PostHarvest-G1395-2026.pdf'));
  assert.ok(!safeCoaFile('../secrets.json'));
  assert.ok(!safeCoaFile('2026/Sour-Lifter-PostHarvest-G1395-2026.pdf'));
});

test('Shopify admin link for Shopify\'s own packing slip', () => {
  assert.equal(adminOrderUrl({ SHOPIFY_SHOP: 'example-store' }, 'gid://shopify/Order/12345'), 'https://admin.shopify.com/store/example-store/orders/12345');
  assert.equal(adminOrderUrl({ SHOPIFY_SHOP: 'example-store.myshopify.com', SHOPIFY_ADMIN_STORE: 'other' }, 'gid://shopify/Order/1'), 'https://admin.shopify.com/store/other/orders/1');
  assert.equal(adminOrderUrl({}, 'gid://shopify/Order/1'), null, 'not connected: no link');
});

function bucket(files) {
  const listCalls = [];
  return {
    listCalls,
    list: async ({ prefix, cursor }) => {
      listCalls.push(prefix);
      assert.equal(prefix, COA_PREFIX);
      return { objects: files.map(f => ({ key: COA_PREFIX + f })), truncated: false, cursor };
    },
    get: async key => (files.includes(key.slice(COA_PREFIX.length)) ? { body: 'PDF' } : null),
  };
}

function env(extra = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE scale_readings (station_id TEXT PRIMARY KEY, weight REAL, target_weight REAL, unit TEXT, updated_at TEXT);`);
  for (const m of ['0049-cell-table-stations', '0050-cell-hourly', '0052-cell-job-order', '0054-cell-screen-state', '0058-order-queue', '0060-pickup-spot', '0061-order-assign']) {
    db.exec(readFileSync(new URL(`../migrations/${m}.sql`, import.meta.url), 'utf8'));
  }
  db.exec(`INSERT INTO shop_orders (id, shop_gid, name, placed_at, state) VALUES (1, 'gid://shopify/Order/555', '#9001', '2026-11-10T15:00:00Z', 'assigned');
    INSERT INTO shop_order_lines (order_id, shop_line_gid, title, cultivar, form, bag, qty, qty_open, route) VALUES
      (1, 'a', 'Sour Lifter Hemp Flower', 'Sour Lifter', 'tops', 'oz1', 4, 4, 'cell'),
      (1, 'b', 'Rainbow GMO Hemp Flower', 'Rainbow GMO', 'smalls', 'oz1', 2, 2, 'bagging'),
      (1, 'c', 'Purple Snowman Hemp Flower', 'Purple Snowman', 'tops', 'qOz', 1, 1, 'cell'),
      (1, 'd', 'Hemp Pre-Rolls', NULL, NULL, NULL, 1, 1, 'pack');`);
  const stmt = (sql, p) => ({
    first: async () => db.prepare(sql).get(...p) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...p) }),
    run: async () => ({ meta: { changes: db.prepare(sql).run(...p).changes } }),
  });
  return { DB: { prepare: sql => ({ bind: (...p) => stmt(sql, p), ...stmt(sql, []) }) }, ...extra };
}

test('the order\'s papers: Shopify slip link, a COA per cultivar (tops and smalls), missing ones named', async () => {
  resetCoaCache();
  const e = env({ SHOPIFY_SHOP: 'example-store', MEDIA_BUCKET: bucket(FILES) });
  const r = await getOrderPrint({ orderId: '1' }, e);
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.slipUrl, 'https://admin.shopify.com/store/example-store/orders/555');
  assert.deepEqual(d.coas, [
    { cultivar: 'Sour Lifter', file: 'Sour-Lifter-PostHarvest-G1395-2026.pdf' },
    { cultivar: 'Rainbow GMO', file: 'Rainbow-GMO-PostHarvest-G1393-2026.pdf' },
    { cultivar: 'Purple Snowman', missing: true },
  ]);
  assert.equal((await getOrderPrint({ orderId: '99' }, e)).status, 404);
  assert.equal((await getOrderPrint({}, e)).status, 400);
  // The queue card carries the same COA check.
  const q = await (await getOrderQueue({}, e, new Date('2026-11-10T18:00:00Z'))).json();
  assert.deepEqual(q.orders[0].coa, { checked: true, missing: ['Purple Snowman'], count: 2 });
});

test('the R2 listing is read once per 5 minutes, not per request', async () => {
  resetCoaCache();
  const b = bucket(FILES);
  await coaFiles({ MEDIA_BUCKET: b }, 1000);
  await coaFiles({ MEDIA_BUCKET: b }, 2000);
  assert.equal(b.listCalls.length, 1);
  await coaFiles({ MEDIA_BUCKET: b }, 1000 + 6 * 60000);
  assert.equal(b.listCalls.length, 2);
  resetCoaCache();
});

test('coaPdf: only COA names, served inline', async () => {
  const e = { MEDIA_BUCKET: bucket(FILES) };
  const r = await coaPdf({ file: 'Sour-Lifter-PostHarvest-G1395-2026.pdf' }, e);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Content-Type'), 'application/pdf');
  assert.match(r.headers.get('Content-Disposition'), /^inline/);
  assert.equal((await coaPdf({ file: '../../secrets.json' }, e)).status, 400);
  assert.equal((await coaPdf({ file: 'Lifter-PostHarvest-G1-2026.pdf' }, e)).status, 404);
  assert.equal((await coaPdf({ file: 'Sour-Lifter-PostHarvest-G1395-2026.pdf' }, {})).status, 503);
});
