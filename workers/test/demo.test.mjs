// Practice / demo mode (lib/demo-env.js, handlers/production/demo.js,
// migrations-demo/demo-schema.sql). Mock orders only: no buyer fields anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { demoEnv, DEMO_ACTIONS, verifyDemoDb } from '../src/lib/demo-env.js';
import { demoLoad, demoTick, demoControl, demoState, demoFulfill, cellPace } from '../src/handlers/production/demo.js';
import { getCellQueue, orderAction } from '../src/handlers/production/order-flow.js';
import { getOrderQueue } from '../src/handlers/production/order-queue.js';
import { handleProductionD1 } from '../src/handlers/production/index.js';

function sqliteDb(sqlText) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');   // as D1 does
  if (sqlText) db.exec(sqlText);
  const stmt = (sql, p) => ({
    first: async () => db.prepare(sql).get(...p) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...p) }),
    run: async () => ({ meta: { changes: db.prepare(sql).run(...p).changes } }),
  });
  const counter = { n: 0 };
  return { raw: db, counter, d1: { prepare: sql => { counter.n++; return { bind: (...p) => stmt(sql, p), ...stmt(sql, []) }; } } };
}
const json = async r => ({ status: r.status, body: await r.json() });
const SCHEMA = readFileSync(new URL('../migrations-demo/demo-schema.sql', import.meta.url), 'utf8');

test('only the real practice database is accepted (marker row), never the live one', async () => {
  assert.equal(await verifyDemoDb(sqliteDb(SCHEMA).d1), true);
  const live = sqliteDb(`CREATE TABLE shop_orders (id INTEGER PRIMARY KEY);`).d1;
  assert.equal(await verifyDemoDb(live), false, 'a binding pointed at a live-shaped database is refused');
  const wrong = sqliteDb(`CREATE TABLE demo_state (key TEXT PRIMARY KEY, value TEXT); INSERT INTO demo_state VALUES ('database', 'something-else');`).d1;
  assert.equal(await verifyDemoDb(wrong), false);
  assert.equal(await verifyDemoDb(null), false);
});

test('demo env: the DEMO_DB database, no Shopify or Telegram, stand-in auto-assign on', () => {
  assert.equal(demoEnv({ DB: 'live' }), null, 'no DEMO_DB binding: no demo');
  const live = { DB: 'live', DEMO_DB: 'demo', SHOPIFY_SHOP: 's', SHOPIFY_CLIENT_SECRET: 'x', TELEGRAM_BOT_TOKEN: 't', MEDIA_BUCKET: {}, ORDERS_PASSWORD: 'p' };
  const d = demoEnv(live);
  assert.equal(d.DB, 'demo');
  assert.equal(d.DEMO, '1');
  assert.equal(d.ORDER_AUTO_ASSIGN, '1');
  for (const k of ['SHOPIFY_SHOP', 'SHOPIFY_CLIENT_SECRET', 'TELEGRAM_BOT_TOKEN', 'MEDIA_BUCKET']) assert.equal(d[k], undefined, k);
  assert.equal(live.DB, 'live', 'the live env is untouched');
});

test('demo mode serves only floor actions; demo actions never run outside demo mode', async () => {
  const { d1 } = sqliteDb(SCHEMA);
  const demo = { DB: d1, DEMO: '1', ORDER_AUTO_ASSIGN: '1' };
  const call = (env, action) => handleProductionD1(new Request(`https://x/api/demo/production?action=${action}`), env, {});
  for (const a of ['chat', 'addProduction', 'migrate', 'setConfig', 'rawOut', 'dashboard']) {
    assert.equal((await call(demo, a)).status, 403, `${a} blocked in demo`);
  }
  assert.ok(DEMO_ACTIONS.has('cellQueue'));
  assert.equal((await call(demo, 'cellQueue')).status, 200);
  const live = { DB: sqliteDb(SCHEMA).d1 };
  assert.equal((await call(live, 'demoTick')).status, 404, 'no demo driver on the live database');
});

function mockOrder(n, simAt, lines, rush = false) {
  return { name: `#D${n}`, simAt, rush, lines };
}
const tops = (cultivar, bag, qty) => ({ title: `${cultivar} Hemp Flower`, options: { 'Bag Size': bag, 'Flower Type': 'Tops' }, productTags: ['retail-only'], qty });
const smalls = (cultivar, bag, qty) => ({ title: `${cultivar} Hemp Flower`, options: { 'Bag Size': bag, 'Flower Type': 'Smalls' }, productTags: ['retail-only'], qty });

test('a simulated day: arrivals -> cells -> table1 swap and pickup -> no-scale Basket done -> auto bag/tag -> fulfilled', async () => {
  const { raw, d1, counter } = sqliteDb(SCHEMA);
  const env = { DB: d1, DEMO: '1', ORDER_AUTO_ASSIGN: '1' };
  const t0 = Date.parse('2026-11-11T15:00:00Z');   // 7:00 am Pacific, sim
  let now = Date.parse('2026-11-12T20:00:00Z');      // the real clock
  let r = await json(await demoLoad({ simStartMs: t0, speed: 60, orders: [
    mockOrder(1, t0, [tops('Sour Lifter', '1 oz.', 2)]),
    mockOrder(2, t0, [tops('Rainbow GMO', '1/4 oz.', 4), smalls('Rainbow GMO', '1 oz.', 1)]),
    mockOrder(3, t0 + 90 * 60000, [smalls('Lifter', '1/2 oz.', 1)], true),
    mockOrder(4, t0, [{ title: '4 oz Sour Lifter tops (custom)', custom: true, qty: 1 }]),
  ] }, env, now));
  assert.equal(r.status, 200);
  assert.equal(r.body.queued, 4);
  r = await json(await demoTick({}, env, now += 1000));
  assert.equal(r.body.arrived, 3, '#D3 arrives 90 sim min in');
  const q1 = (await json(await getCellQueue({ stationId: 'table1' }, env))).body.cell;
  assert.equal(q1.now.orderName, '#D1');
  // A cell screen is open on table1 (it reports every few seconds): the sim leaves it the swap's pickup.
  const screen = () => raw.prepare(`INSERT INTO cell_screen_state (station_id, phase, paused, updated_at) VALUES ('table1', 'running', 0, ?)
    ON CONFLICT (station_id) DO UPDATE SET updated_at = excluded.updated_at`).run(now);
  // 2 x 1 oz = 60 g at ~6-7.5 g/min: about 10 sim min; each real second is a sim minute at 60x.
  for (let i = 0; i < 13; i++) { screen(); await demoTick({}, env, now += 1000); }
  const reading = raw.prepare(`SELECT weight FROM scale_readings WHERE station_id = 'table1'`).get();
  assert.ok(reading.weight < 0.005, 'the matched empty basket is on: the swap happened');
  assert.equal(raw.prepare(`SELECT state FROM cell_jobs WHERE id = ?`).get(q1.now.id).state, 'queued', 'a screen may still post the pickup');
  await demoTick({}, env, now += 16000);   // past the swap grace: the sim posts the pickup itself
  const mark = raw.prepare(`SELECT kind, job_id, collected_at FROM scale_marks WHERE job_id = ?`).get(q1.now.id);
  assert.deepEqual({ ...mark }, { kind: 'pickup', job_id: q1.now.id, collected_at: null }, 'waiting at the pickup spot');
  // Run the rest of the day, counting the queries each tick costs (each is a round trip on real D1).
  let most = 0;
  for (let i = 0; i < 200; i++) { const before = counter.n; await demoTick({}, env, now += 1000); most = Math.max(most, counter.n - before); }
  assert.ok(most < 250, `a tick at 60x stays small on D1: at most ${most} queries`);
  console.log(`# demo tick, busiest at 60x: ${most} queries`);
  const st = (await json(await demoState({}, env))).body;
  assert.equal(st.toArrive, 0);
  assert.deepEqual(st.counts, { fulfilled: 4 }, 'every order made it out, the custom line routed by the demo');
  assert.ok(raw.prepare(`SELECT COUNT(*) n FROM cell_jobs WHERE done_by = 'tap'`).get().n >= 1, 'a cell with no scale closed by Basket done');
});

test('controls: speed, pause, auto off leaves bag/tag to people; the Shopify stub fulfils', async () => {
  const { d1 } = sqliteDb(SCHEMA);
  const env = { DB: d1, DEMO: '1', ORDER_AUTO_ASSIGN: '1' };
  const t0 = Date.parse('2026-11-11T15:00:00Z');
  let now = Date.parse('2026-11-12T20:00:00Z');
  assert.equal((await demoTick({}, env, now)).status, 409, 'nothing loaded yet');
  await demoLoad({ simStartMs: t0, speed: 10, auto: false, orders: [mockOrder(1, t0, [tops('Sour Lifter', '1 oz.', 1)])] }, env, now);
  await demoTick({}, env, now += 1000);
  let c = (await json(await demoControl({ paused: true }, env, now += 5000))).body.clock;
  const paused = c.simMs;
  c = (await json(await demoTick({}, env, now += 20000))).body.clock;
  assert.equal(c.simMs, paused, 'paused: the sim clock stands still');
  await demoControl({ paused: false, speed: 60 }, env, now += 1000);
  for (let i = 0; i < 30; i++) await demoTick({}, env, now += 1000);
  const q = (await json(await getOrderQueue({}, env, new Date(now)))).body;
  assert.equal(q.demo, true);
  assert.equal(q.orders[0].confirmedAt, null, 'auto off: nobody confirmed it');
  assert.equal(q.orders[0].shopifyUrl, 'demo-stub', 'the Shopify button goes to the stub page in demo');
  await orderAction({ orderId: q.orders[0].id, op: 'confirm' }, env);
  assert.equal((await demoFulfill({ orderId: q.orders[0].id }, env)).status, 200);
  assert.equal((await demoFulfill({ orderId: q.orders[0].id }, env)).status, 409);
  assert.ok(cellPace('table1') > 5 && cellPace('table1') < 8);
});

test('loading a second day wipes the first (children before parents, as D1 enforces foreign keys)', async () => {
  const { raw, d1 } = sqliteDb(SCHEMA);
  const env = { DB: d1, DEMO: '1', ORDER_AUTO_ASSIGN: '1' };
  const t0 = Date.parse('2026-11-11T15:00:00Z');
  let now = Date.now();
  await demoLoad({ simStartMs: t0, speed: 60, orders: [mockOrder(1, t0, [tops('Sour Lifter', '1 oz.', 2)])] }, env, now);
  for (let i = 0; i < 3; i++) await demoTick({}, env, now += 1000);
  assert.ok(raw.prepare(`SELECT COUNT(*) n FROM cell_jobs`).get().n > 0);
  const r = await demoLoad({ simStartMs: t0, speed: 60, orders: [mockOrder(2, t0, [tops('Lifter', '1 oz.', 1)])] }, env, now += 1000);
  assert.equal(r.status, 200);
  assert.equal(raw.prepare(`SELECT COUNT(*) n FROM shop_orders`).get().n, 0, 'the old day is gone');
});

test('one tick at a time: a tick that finds the clock already moved steps aside', async () => {
  const { raw, d1 } = sqliteDb(SCHEMA);
  const t0 = Date.parse('2026-11-11T15:00:00Z');
  let now = Date.now();
  let interfere = false;
  // Another driver tab moves the clock between this tick's read and its claim.
  const racing = { prepare: sql => {
    const p = d1.prepare(sql);
    if (interfere && /SELECT value FROM demo_state WHERE key = 'clock'/.test(sql)) {
      return { bind: (...a) => ({ first: async () => {
        const r = await p.bind(...a).first();
        raw.prepare(`UPDATE demo_state SET value = json_set(value, '$.realMs', 1) WHERE key = 'clock'`).run();
        return r;
      } }), first: async () => {
        const r = await p.first();
        raw.prepare(`UPDATE demo_state SET value = json_set(value, '$.realMs', 1) WHERE key = 'clock'`).run();
        return r;
      } };
    }
    return p;
  } };
  const env = { DB: racing, DEMO: '1', ORDER_AUTO_ASSIGN: '1' };
  await demoLoad({ simStartMs: t0, speed: 60, orders: [mockOrder(1, t0, [tops('Sour Lifter', '1 oz.', 1)])] }, env, now);
  interfere = true;
  const r = await json(await demoTick({}, env, now += 1000));
  assert.equal(r.body.busy, true);
  assert.equal(raw.prepare(`SELECT COUNT(*) n FROM shop_orders`).get().n, 0, 'the busy tick did nothing');
});
