// Order queue, slice 1 (migration 0058; lib/order-route.js, lib/order-sync.js,
// lib/shopify.js, handlers/production/order-queue.js). All Shopify data here is
// made up: invented order numbers, catalog-shaped products, no buyer fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { routeLine, bagKey, cultivarKey, titleCultivar, rushOf, intakeTag } from '../src/lib/order-route.js';
import { syncShopOrders, normalizeOrder, ORDERS_QUERY, STATUS_QUERY, inPollHours } from '../src/lib/order-sync.js';
import { adminToken, shopifyGraphql, resetTokenCache, shopifyConfigured } from '../src/lib/shopify.js';
import { getOrderQueue, orderSync, carryCutoff, pacificWallToUtc } from '../src/handlers/production/order-queue.js';

const NOW = new Date('2026-11-10T18:00:00Z');   // Tue 10:00 am Pacific

function env(extra = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0058-order-queue.sql', import.meta.url), 'utf8'));
  const stmt = (sql, p) => ({
    first: async () => db.prepare(sql).get(...p) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...p) }),
    run: async () => ({ meta: { changes: db.prepare(sql).run(...p).changes } }),
  });
  return { raw: db, env: { DB: { prepare: sql => ({ bind: (...p) => stmt(sql, p), ...stmt(sql, []) }) }, ...extra } };
}

// Catalog-shaped line items (Sidekick read 2026-11-10).
const opt = (o) => ({ selectedOptions: Object.entries(o).map(([name, value]) => ({ name, value })) });
const product = (title, tags = ['retail-only'], productType = 'Hemp Flower') => ({ title, productType, tags });
let lid = 0;
const line = (title, options, prod, qty = 1, open = qty) => ({
  id: `gid://shopify/LineItem/${++lid}`, title, variantTitle: Object.values(options).join(' / '),
  quantity: qty, unfulfilledQuantity: open, product: prod, variant: opt(options),
});
const order = (n, createdAt, lines, { tags = ['m2o-line', 'prod-queued'], ship = 'Ground', cancelledAt = null, status = 'UNFULFILLED' } = {}) => ({
  id: `gid://shopify/Order/${n}`, name: `#${n}`, createdAt, cancelledAt, displayFulfillmentStatus: status, tags,
  shippingLine: { title: ship }, lineItems: { nodes: lines },
});

const SL = () => line('Sour Lifter Hemp Flower', { 'Bag Size': '1 oz.', 'Flower Type': 'Tops' }, product('Sour Lifter Hemp Flower'), 4);

test('route: 2026 Sungrown Tops 1/4 oz-1 lb go to a cell; everything else does not', () => {
  const r = (title, options, tags, extra = {}) => routeLine({ title, productTitle: title, hasProduct: true, options, productTags: tags, ...extra });
  let x = r('Sour Lifter Hemp Flower', { 'Bag Size': '1 oz.', 'Flower Type': 'Tops' }, ['retail-only']);
  assert.equal(x.route, 'cell');
  assert.equal(x.cultivar, 'Sour Lifter');
  assert.equal(x.floorCultivar, '2026 - Sour Lifter / Sungrown');
  assert.equal(x.bag, 'oz1');
  assert.equal(r('Sour Lifter Hemp Flower', { 'Bag Size': '1/4 lb.', 'Flower Type': 'Tops' }, ['coming-soon']).route, 'cell');
  assert.equal(r('Rainbow GMO Hemp Flower', { 'Bag Size': '1 oz.', 'Flower Type': 'Smalls' }, ['retail-only']).route, 'bagging');
  assert.equal(r('[2025] Lifter Hemp Flower', { 'Bag Size': '1 oz.', 'Flower Type': 'Tops' }, []).route, 'bagging');
  assert.equal(r('[Mid-Grade] Sugar Shaker Hemp Flower', { 'Bag Size': '1 oz.', 'Flower Type': 'Tops' }, ['retail-only']).route, 'bagging');
  assert.equal(r('Strawberry Doughnuts Hemp Flower', { 'Bag Size': '1 oz.', 'Flower Type': 'Tops', 'Grow': 'Greenhouse' }, ['retail-only']).route, 'bagging');
  x = r('Sour Lifter Hemp Flower', { 'Bag Size': '10 lbs.', 'Flower Type': 'Tops' }, ['retail-only']);
  assert.equal(x.route, 'bagging');
  assert.match(x.why, /5 kg rounds/);
  assert.equal(r('Sour Lifter Hemp Flower', { 'Bag Size': '1 oz.', 'Flower Type': 'Tops' }, ['retail-only', 'prebagged']).route, 'bagging');
  assert.equal(r('Sour Lifter Hemp Flower', { 'Bag Size': '1 oz.', 'Flower Type': 'Tops' }, []).route, 'bagging', 'no 2026 tag: never a cell');
  assert.equal(r('Hemp Pre-Rolls 5 pack', {}, [], { productType: 'Pre-Roll' }).route, 'pack');
  assert.equal(r('Gift Card', {}, []).route, 'pack');
  assert.equal(routeLine({ title: '10 lb Sour Lifter tops (custom)', hasProduct: false }).route, 'ask');
  assert.equal(routeLine({ title: '10 lb Sour Lifter tops (custom)', hasProduct: false }).form, 'tops');
  assert.equal(routeLine({ title: 'Sour Lifter Hemp Flower', productTitle: 'Sour Lifter Hemp Flower', hasProduct: true,
    options: { 'Bag Size': '1 oz.', 'Flower Type': 'Tops' }, productTags: ['retail-only'] }, { tags: ['wholesale-line'] }).route, 'wholesale');
});

test('route helpers: bag sizes, titles, spellings, rush, intake tags', () => {
  assert.deepEqual(['1/4 oz.', '1/2 oz.', '1 oz.', '1/4 lb.', '1/2 lb.', '1 lb.', '10 lbs.', '1 kg.', '5 kg.', 'Full Pallet (160kg)', 'huge'].map(bagKey),
    ['qOz', 'hOz', 'oz1', 'qLb', 'hLb', 'lb1', 'lb10', 'kg1', 'kg5', 'pallet', null]);
  assert.equal(titleCultivar('[2025] [Mids] Lifter Hemp Flower'), 'Lifter');
  assert.equal(cultivarKey("Payton's Strawberries"), cultivarKey("Peyton's Strawberries"));
  assert.equal(cultivarKey('2026 - Sour Lifter / Sungrown'), 'sour lifter');
  assert.equal(routeLine({ title: "Payton's Strawberries Hemp Flower", productTitle: "Payton's Strawberries Hemp Flower", hasProduct: true,
    options: { 'Bag Size': '1 oz.', 'Flower Type': 'Tops' }, productTags: ['retail-only'] }).cultivar, "Peyton's Strawberries");
  assert.equal(rushOf('UPS Next Day Air'), 'UPS Next Day Air');
  assert.equal(rushOf('UPS 2nd Day Air'), 'UPS 2nd Day Air');
  assert.equal(rushOf('USPS Ground Advantage'), null);
  assert.equal(intakeTag(['prod-queued', 'm2o-line']), 'm2o');
  assert.equal(intakeTag(['wholesale-line']), 'wholesale');
  assert.equal(intakeTag(['Matrixify']), null);
});

test('intake filter: tagged, or created since go-live; cancelled and done orders stay out', () => {
  assert.ok(normalizeOrder(order(1001, '2026-11-09T20:00:00Z', [SL()])));
  assert.equal(normalizeOrder(order(1002, '2026-11-09T20:00:00Z', [SL()], { tags: [] })), null, 'untagged, no go-live');
  assert.equal(normalizeOrder(order(1003, '2026-11-09T20:00:00Z', [SL()], { tags: [] }), '2026-11-10'), null, 'before go-live');
  assert.ok(normalizeOrder(order(1004, '2026-11-10T16:00:00Z', [SL()], { tags: [] }), '2026-11-10'), 'after go-live');
  assert.equal(normalizeOrder(order(1005, '2026-11-10T16:00:00Z', [SL()], { cancelledAt: '2026-11-10T17:00:00Z' })), null);
  const done = line('Sour Lifter Hemp Flower', { 'Bag Size': '1 oz.', 'Flower Type': 'Tops' }, product('Sour Lifter Hemp Flower'), 2, 0);
  assert.equal(normalizeOrder(order(1006, '2026-11-10T16:00:00Z', [done])), null, 'nothing left to fulfil');
  const r = normalizeOrder(order(1007, '2026-11-10T16:00:00Z', [SL()], { ship: 'UPS Next Day Air' }));
  assert.equal(r.rush, 1);
});

test('the query asks for no buyer or money field', () => {
  for (const q of [ORDERS_QUERY, STATUS_QUERY]) {
    for (const f of ['customer', 'email', 'phone', 'Address', 'address', 'price', 'Price', 'total', 'Total', 'note', 'billing']) {
      assert.ok(!q.includes(f), `query must not ask for ${f}`);
    }
  }
});

function fakeShopify(pages, statuses = {}) {
  const calls = [];
  const gql = async (q, v) => {
    calls.push({ q, v });
    if (q === STATUS_QUERY) return { nodes: v.ids.map(id => statuses[id] || null) };
    const i = v.after ? Number(v.after) : 0;
    return { orders: { nodes: pages[i] || [], pageInfo: { hasNextPage: i + 1 < pages.length, endCursor: String(i + 1) } } };
  };
  return { gql, calls };
}

test('sync: pages, dedups on re-poll, keeps no buyer data, reconciles fulfilled and cancelled', async () => {
  const { raw, env: e } = env();
  const mixed = order(2002, '2026-11-10T15:00:00Z', [
    SL(),
    line('Rainbow GMO Hemp Flower', { 'Bag Size': '1 oz.', 'Flower Type': 'Smalls' }, product('Rainbow GMO Hemp Flower')),
  ]);
  const pages = [[order(2001, '2026-11-10T14:00:00Z', [SL()]), mixed], [order(2003, '2026-11-10T16:00:00Z', [SL()], { ship: 'UPS 2nd Day Air' })]];
  let f = fakeShopify(pages);
  let r = await syncShopOrders(e, { gql: f.gql, now: NOW, force: true });
  assert.deepEqual(r, { ok: true, orders: 3, closed: 0 });
  assert.equal(f.calls.filter(c => c.q !== STATUS_QUERY).length, 2, 'two pages');
  r = await syncShopOrders(e, { gql: f.gql, now: NOW, force: true });
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM shop_orders').get().n, 3, 'no duplicate orders');
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM shop_order_lines').get().n, 4, 'no duplicate lines');
  const cols = raw.prepare(`SELECT name FROM pragma_table_info('shop_orders') UNION SELECT name FROM pragma_table_info('shop_order_lines')`).all().map(c => c.name);
  assert.ok(!cols.some(c => /customer|email|address|phone|price|total/.test(c)), 'no buyer or money columns');

  // 2001 bought its label in Shopify (fulfilled); 2003 was cancelled: neither is returned now.
  f = fakeShopify([[mixed]], {
    'gid://shopify/Order/2001': { id: 'gid://shopify/Order/2001', cancelledAt: null, displayFulfillmentStatus: 'FULFILLED' },
    'gid://shopify/Order/2003': { id: 'gid://shopify/Order/2003', cancelledAt: '2026-11-10T17:30:00Z', displayFulfillmentStatus: 'UNFULFILLED' },
  });
  r = await syncShopOrders(e, { gql: f.gql, now: NOW, force: true });
  assert.equal(r.closed, 2);
  const states = Object.fromEntries(raw.prepare('SELECT name, state FROM shop_orders').all().map(x => [x.name, x.state]));
  assert.deepEqual(states, { '#2001': 'fulfilled', '#2002': 'queued', '#2003': 'cancelled' });
});

test('sync: Refresh at most every 20 s; errors are kept for the page, not thrown', async () => {
  const { env: e } = env();
  const f = fakeShopify([[order(3001, '2026-11-10T14:00:00Z', [SL()])]]);
  assert.equal((await syncShopOrders(e, { gql: f.gql, now: NOW })).orders, 1);
  assert.equal((await syncShopOrders(e, { gql: f.gql, now: new Date(NOW.getTime() + 5000) })).skipped, 'too-soon');
  const bad = async () => { throw new Error('Shopify: Throttled'); };
  const r = await syncShopOrders(e, { gql: bad, now: new Date(NOW.getTime() + 60000) });
  assert.equal(r.ok, false);
  const q = await (await getOrderQueue({}, e.DB ? e : e, NOW)).json();
  assert.equal(q.sync.lastError, 'Shopify: Throttled');
  assert.ok(q.sync.lastOkAt, 'the last good sync is still shown');
  assert.equal((await syncShopOrders({ DB: e.DB })).skipped, 'not-configured');
});

test('queue: rush first, then oldest; routes per line; carried over; empty-after-fulfil lines hidden', async () => {
  const { env: e } = env();
  const f = fakeShopify([[
    order(4001, '2026-11-09T22:00:00Z', [SL()]),                                    // Mon 2 pm: carried over
    order(4002, '2026-11-10T06:00:00Z', [SL()]),                                    // overnight: today's wave
    order(4003, '2026-11-10T07:00:00Z', [SL()], { ship: 'UPS Next Day Air' }),
    order(4004, '2026-11-10T08:00:00Z', [line('Hemp Pre-Rolls 5 pack', {}, product('Hemp Pre-Rolls 5 pack', [], 'Pre-Roll'))]),
  ]]);
  await syncShopOrders(e, { gql: f.gql, now: NOW, force: true });
  const q = await (await getOrderQueue({}, e, NOW)).json();
  assert.deepEqual(q.orders.map(o => o.name), ['#4003', '#4001', '#4002', '#4004']);
  assert.equal(q.orders[0].rush, true);
  assert.deepEqual(q.orders.map(o => o.carriedOver), [false, true, false, false]);
  assert.equal(q.orders[3].lines[0].route, 'pack');
  assert.equal(q.orders[3].cellLines, 0);
  assert.deepEqual(q.orders[1].cultivars, ['Sour Lifter']);
});

test('queue before migration 0058: a clear 503, never a crash', async () => {
  const db = new DatabaseSync(':memory:');
  const e = { DB: { prepare: sql => { const s = { first: async () => db.prepare(sql).get(), all: async () => ({ results: db.prepare(sql).all() }) }; return { bind: () => s, ...s }; } } };
  const r = await getOrderQueue({}, e, NOW);
  assert.equal(r.status, 503);
  assert.equal((await orderSync({}, e, NOW)).status, 503);
});

test('carry-over cutoff: the last production day at 4:30 PM Pacific (Monday looks back to Saturday)', () => {
  assert.equal(new Date(carryCutoff(NOW)).toISOString(), '2026-11-10T00:30:00.000Z');            // Mon 11/9 4:30 PM PST
  assert.equal(new Date(carryCutoff(new Date('2026-11-09T18:00:00Z'))).toISOString(), '2026-11-08T00:30:00.000Z'); // Mon -> Sat 11/7
  assert.equal(new Date(pacificWallToUtc('2026-07-01', 16 * 60 + 30)).toISOString(), '2026-07-01T23:30:00.000Z');  // PDT
});

test('poll hours: 5 am to 7 pm Pacific', () => {
  assert.equal(inPollHours(new Date('2026-11-10T12:30:00Z')), false);   // 4:30 am
  assert.equal(inPollHours(new Date('2026-11-10T13:00:00Z')), true);    // 5:00 am
  assert.equal(inPollHours(new Date('2026-11-11T02:59:00Z')), true);    // 6:59 pm
  assert.equal(inPollHours(new Date('2026-11-11T03:00:00Z')), false);   // 7:00 pm
});

test('shopify: client credentials token, cached in memory, refused cleanly', async () => {
  resetTokenCache();
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    if (url.endsWith('/admin/oauth/access_token')) {
      return new Response(JSON.stringify({ access_token: 'tok-1', scope: 'read_orders,read_products', expires_in: 86399 }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
  };
  const e = { SHOPIFY_SHOP: 'example-store', SHOPIFY_CLIENT_ID: 'id', SHOPIFY_CLIENT_SECRET: 'secret' };
  assert.equal(shopifyConfigured(e), true);
  assert.equal(shopifyConfigured({ SHOPIFY_SHOP: 'x' }), false);
  assert.equal(await adminToken(e, { fetchImpl }), 'tok-1');
  assert.equal(await adminToken(e, { fetchImpl }), 'tok-1');
  assert.equal(seen.length, 1, 'cached');
  assert.match(seen[0].init.body, /grant_type=client_credentials/);
  assert.ok(!/scope=/.test(seen[0].init.body), 'no scope param: Shopify ignores it');
  assert.deepEqual(await shopifyGraphql(e, '{ shop { name } }', {}, { fetchImpl }), { ok: true });
  assert.equal(seen[1].url, 'https://example-store.myshopify.com/admin/api/2026-10/graphql.json');
  assert.equal(seen[1].init.headers['X-Shopify-Access-Token'], 'tok-1');

  resetTokenCache();
  const refuse = async () => new Response(JSON.stringify({ error: 'shop_not_permitted' }), { status: 400 });
  await assert.rejects(adminToken(e, { fetchImpl: refuse }), /shop_not_permitted/);
  assert.equal(await adminToken({ SHOPIFY_SHOP: 's', SHOPIFY_ADMIN_TOKEN: 'shpat_x' }), 'shpat_x', 'legacy token used as is');
  resetTokenCache();
});
