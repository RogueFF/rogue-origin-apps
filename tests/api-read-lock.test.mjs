/**
 * API read lock — /api/wholesale, /api/complaints, /api/consignment.
 *
 * Those three endpoints used to lock only their writes, so anyone with the URL
 * could read buyer names and order terms, customer complaints and consignment
 * partner balances. Each handler is now DEFAULT-DENY: a short, explicit set of
 * public actions, and every other action — reads, writes and names nobody has
 * written yet — needs the shared password before the switch runs.
 *
 * One exception that is deliberately NOT a 401: wholesale `getQueueBrief`. The
 * open Floor Manager page reads it with no password, so an unauthenticated
 * caller gets the same shape with every buyer key removed and
 * `ordersLocked: true`, the way lib/cost-lock.js answers with `costsLocked`.
 *
 * Status codes are asserted through the worker's real entry point: the handlers
 * throw, and only index.js turns the throw into the 401 a browser sees.
 *
 * Run with `node --test`.
 */
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createMockDB } from './helpers/d1-mock.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const mod = (p) => join(REPO, p).replace(/\\/g, '/').replace(/^/, 'file:///');

const worker = (await import(mod('workers/src/index.js'))).default;
const { handleWholesaleD1 } = await import(mod('workers/src/handlers/wholesale-d1.js'));
const { handleComplaintsD1, syncFromSheets } = await import(mod('workers/src/handlers/complaints-d1.js'));
const { handleConsignmentD1 } = await import(mod('workers/src/handlers/consignment-d1.js'));
const { BUYER_KEYS, stripKeys, lockBuyers } = await import(mod('workers/src/lib/buyer-lock.js'));

const PW = 'test-pw';
const ctx = { waitUntil() {} };
const makeEnv = (db = createMockDB()) => ({ DB: db, ORDERS_PASSWORD: PW });

/** GET through the worker. `auth` is a password string, or nothing. */
function get(path, action, { auth, params = {} } = {}) {
  const qs = new URLSearchParams({ action, ...params });
  const headers = auth ? { Authorization: `Bearer ${auth}` } : {};
  return new Request(`https://x${path}?${qs}`, { headers });
}

/** POST through the worker, the way the pages send it (text/plain JSON). */
function post(path, action, body = {}) {
  return new Request(`https://x${path}?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(body),
  });
}

async function call(req, env) {
  const res = await worker.fetch(req, env, ctx);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, json, text };
}

/** Collect every key at every depth, to prove a stripped key is gone everywhere. */
function allKeys(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach(v => allKeys(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { out.add(k); allKeys(v, out); }
  }
  return out;
}

// ─── fixtures ──────────────────────────────────────────

/**
 * A queue with two open orders on two cultivars, so the brief has a headline,
 * a `next` and two block rows — every place buildQueueBrief puts a nickname.
 * Names are obviously fake.
 */
function seedQueue(db) {
  db.addRows('JOIN orders o ON o.id = i.order_id WHERE o.status IN', [
    { lineId: 11, orderId: 'WO-TEST-A', cultivarId: 'cv-one', form: 'tops', qtyLbs: 10, creditedLbs: 0, sortOrder: 0, accrualStart: null },
    { lineId: 12, orderId: 'WO-TEST-B', cultivarId: 'cv-two', form: 'tops', qtyLbs: 20, creditedLbs: 0, sortOrder: 0, accrualStart: null },
  ]);
  db.addRows('ORDER BY queue_rank, id', [{ id: 'WO-TEST-A' }, { id: 'WO-TEST-B' }]);
  db.addRows('SELECT id, name FROM cultivars', [
    { id: 'cv-one', name: 'Cultivar One' },
    { id: 'cv-two', name: 'Cultivar Two' },
  ]);
  db.addRows('SELECT id, nickname, shopify_order_name FROM orders', [
    { id: 'WO-TEST-A', nickname: 'Fakebuyer Alpha', shopify_order_name: '#T9001' },
    { id: 'WO-TEST-B', nickname: 'Fakebuyer Beta', shopify_order_name: '#T9002' },
  ]);
  db.addRows('SELECT alias, cultivar_id AS cultivarId FROM cultivar_aliases', [
    { alias: '2026 - Cultivar One / Sungrown', cultivarId: 'cv-one' },
    { alias: '2026 - Cultivar Two / Sungrown', cultivarId: 'cv-two' },
  ]);
  return db;
}

// ─── buyer-lock unit ───────────────────────────────────

describe('buyer-lock', () => {
  test('BUYER_KEYS names the nickname', () => {
    assert.ok(BUYER_KEYS.includes('nickname'));
  });

  test('stripKeys deletes the key at every depth (not set to null) and does not mutate', () => {
    const input = { a: { nickname: null, keep: 1 }, list: [{ nickname: 'x', orderRef: '#1' }], nickname: 'y' };
    const before = JSON.stringify(input);
    const out = stripKeys(input, BUYER_KEYS);
    assert.equal(JSON.stringify(input), before);
    assert.deepEqual(out, { a: { keep: 1 }, list: [{ orderRef: '#1' }] });
    assert.equal(stripKeys(null, BUYER_KEYS), null);
    assert.equal(stripKeys(7, BUYER_KEYS), 7);
  });

  test('lockBuyers strips and flags ordersLocked', () => {
    const out = lockBuyers({ success: true, headline: { nickname: 'z', orderRef: '#2' } });
    assert.equal(out.ordersLocked, true);
    assert.equal(out.headline.nickname, undefined);
    assert.equal(out.headline.orderRef, '#2');
  });
});

// ─── /api/wholesale ────────────────────────────────────

describe('/api/wholesale read lock', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  for (const action of ['getOrders', 'getQueue', 'getCoverage', 'getNotify']) {
    test(`${action} unauthenticated → 401`, async () => {
      const r = await call(get('/api/wholesale', action), env);
      assert.equal(r.status, 401);
      assert.equal(r.json.code, 'UNAUTHORIZED');
    });
  }

  test('getOrders with a wrong password → 401', async () => {
    const r = await call(get('/api/wholesale', 'getOrders', { auth: 'nope' }), env);
    assert.equal(r.status, 401);
    assert.equal(r.json.code, 'UNAUTHORIZED');
  });

  test('getOrders with the right Bearer → 200', async () => {
    const r = await call(get('/api/wholesale', 'getOrders', { auth: PW }), env);
    assert.equal(r.status, 200);
    assert.equal(r.json.success, true);
    assert.deepEqual(r.json.orders, []);
  });

  test('getOrders by POST with body.password → 200', async () => {
    const r = await call(post('/api/wholesale', 'getOrders', { password: PW }), env);
    assert.equal(r.status, 200);
    assert.equal(r.json.success, true);
  });

  test('a write unauthenticated → 401', async () => {
    const r = await call(post('/api/wholesale', 'saveOrder', { nickname: 'x' }), env);
    assert.equal(r.status, 401);
  });

  test('an unknown action unauthenticated → 401, not NOT_FOUND', async () => {
    const r = await call(get('/api/wholesale', 'getSomethingNew'), env);
    assert.equal(r.status, 401);
    assert.equal(r.json.code, 'UNAUTHORIZED');
  });

  test('an unknown action authenticated → 404 NOT_FOUND', async () => {
    const r = await call(get('/api/wholesale', 'getSomethingNew', { auth: PW }), env);
    assert.equal(r.status, 404);
    assert.equal(r.json.code, 'NOT_FOUND');
  });

  for (const action of ['test', 'getCultivars', 'getRates']) {
    test(`${action} stays public`, async () => {
      const r = await call(get('/api/wholesale', action), env);
      assert.equal(r.status, 200);
      assert.equal(r.json.success, true);
    });
  }
});

describe('/api/wholesale getQueueBrief buyer lock', () => {
  let env;
  beforeEach(() => { env = makeEnv(seedQueue(createMockDB())); });

  test('authenticated: nicknames present at headline, next and blocks; no ordersLocked', async () => {
    const r = await call(get('/api/wholesale', 'getQueueBrief', { auth: PW }), env);
    assert.equal(r.status, 200);
    const d = r.json;
    assert.equal(d.ordersLocked, undefined);
    // Guards against a vacuous unauthenticated test: the fixture really does
    // put a nickname in every place the brief carries one.
    assert.equal(d.headline.nickname, 'Fakebuyer Alpha');
    assert.equal(d.next.nickname, 'Fakebuyer Beta');
    assert.equal(d.blocks.length, 2);
    assert.equal(d.blocks[0].nickname, 'Fakebuyer Alpha');
    assert.equal(d.blocks[1].nickname, 'Fakebuyer Beta');
  });

  test('unauthenticated: 200, same shape, no nickname anywhere, ordersLocked', async () => {
    const r = await call(get('/api/wholesale', 'getQueueBrief'), env);
    assert.equal(r.status, 200);
    assert.ok(!r.text.includes('nickname'), 'no nickname key in the serialized payload');
    assert.ok(!r.text.includes('Fakebuyer'), 'no buyer string in the serialized payload');
    const d = r.json;
    assert.equal(d.ordersLocked, true);
    assert.equal(d.success, true);
    // Everything else survives.
    assert.equal(d.headline.orderRef, '#T9001');
    assert.equal(d.headline.orderId, 'WO-TEST-A');
    assert.equal(d.headline.totalLbs, 10);
    assert.equal(d.next.orderRef, '#T9002');
    assert.equal(d.blocks.length, 2);
    assert.equal(d.blocks[0].orderRef, '#T9001');
    assert.equal(d.blocks[0].totalLbs, 10);
    assert.equal(typeof d.blocks[0].pct, 'number');
    assert.ok('finish' in d.blocks[0]);
    assert.equal(d.blocks[0].passes[0].lines[0].lineId, 11);
    assert.equal(d.blocks[0].passes[0].lines[0].qtyLbs, 10);
    assert.equal(d.blocksTotal, 2);
    assert.deepEqual(d.queueAliases, ['2026 - Cultivar One / Sungrown', '2026 - Cultivar Two / Sungrown']);
    // Same keys as the authenticated payload, minus the buyer keys, plus the flag.
    const authed = await call(get('/api/wholesale', 'getQueueBrief', { auth: PW }), env);
    const expected = new Set([...allKeys(authed.json)].filter(k => !BUYER_KEYS.includes(k)));
    expected.add('ordersLocked');
    assert.deepEqual([...allKeys(d)].sort(), [...expected].sort());
  });

  test('wrong password: stripped, not 401', async () => {
    const r = await call(get('/api/wholesale', 'getQueueBrief', { auth: 'nope' }), env);
    assert.equal(r.status, 200);
    assert.equal(r.json.ordersLocked, true);
    assert.ok(!r.text.includes('nickname'));
  });

  test('an empty queue (CLEAR headline carries nickname: null) still leaks no nickname key', async () => {
    const r = await call(get('/api/wholesale', 'getQueueBrief'), makeEnv());
    assert.equal(r.status, 200);
    assert.equal(r.json.headline.mode, 'clear');
    assert.ok(!r.text.includes('nickname'));
    assert.equal(r.json.ordersLocked, true);
  });

  test('the stripped response still carries no-store caching', async () => {
    const r = await call(get('/api/wholesale', 'getQueueBrief'), env);
    assert.equal(r.status, 200);
    assert.equal(r.json.ordersLocked, true);
    assert.equal(r.headers.get('Cache-Control'), 'no-cache, no-store, must-revalidate');
    assert.match(r.headers.get('Content-Type') || '', /application\/json/);
  });

  test('handler direct: unauthenticated getQueueBrief does not throw', async () => {
    const res = await handleWholesaleD1(get('/api/wholesale', 'getQueueBrief'), env);
    const d = await res.json();
    assert.equal(d.ordersLocked, true);
  });
});

// ─── /api/complaints ───────────────────────────────────

const CSV = 'Date,Customer,Invoice,Complaint,Resolution,Type\n2026-10-01,Test Customer,INV-T1,Too dry,,Quality\n';

describe('/api/complaints read lock', () => {
  let env, realFetch, fetchCalls;
  beforeEach(() => {
    env = makeEnv();
    realFetch = globalThis.fetch;
    fetchCalls = [];
    globalThis.fetch = async (url) => {
      fetchCalls.push(String(url));
      if (String(url).startsWith('https://docs.google.com/spreadsheets/')) {
        return new Response(CSV, { status: 200 });
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    };
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  for (const action of ['complaints', 'complaint', 'stats', 'recent']) {
    test(`${action} unauthenticated → 401`, async () => {
      const r = await call(get('/api/complaints', action, { params: { id: '1' } }), env);
      assert.equal(r.status, 401);
      assert.equal(r.json.code, 'UNAUTHORIZED');
    });
  }

  test('complaints with a wrong password → 401', async () => {
    const r = await call(get('/api/complaints', 'complaints', { auth: 'nope' }), env);
    assert.equal(r.status, 401);
  });

  test('complaints with the right Bearer → 200', async () => {
    const r = await call(get('/api/complaints', 'complaints', { auth: PW }), env);
    assert.equal(r.status, 200);
    assert.equal(r.json.success, true);
  });

  test('stats by POST with body.password → 200', async () => {
    const r = await call(post('/api/complaints', 'stats', { password: PW }), env);
    assert.equal(r.status, 200);
    assert.equal(r.json.success, true);
  });

  test('sync unauthenticated → 401 and never touches Sheets', async () => {
    const r = await call(post('/api/complaints', 'sync', {}), env);
    assert.equal(r.status, 401);
    assert.deepEqual(fetchCalls, []);
  });

  test('sync with body.password → 200', async () => {
    const r = await call(post('/api/complaints', 'sync', { password: PW }), env);
    assert.equal(r.status, 200);
    assert.equal(r.json.imported, 1);
  });

  test('save unauthenticated → 401', async () => {
    const r = await call(post('/api/complaints', 'save', { complaint_date: '2026-10-01', customer: 'x', complaint: 'y' }), env);
    assert.equal(r.status, 401);
  });

  test('test stays public', async () => {
    const r = await call(get('/api/complaints', 'test'), env);
    assert.equal(r.status, 200);
    assert.equal(r.json.success, true);
  });

  test('an unknown action unauthenticated → 401, not NOT_FOUND', async () => {
    const r = await call(get('/api/complaints', 'somethingNew'), env);
    assert.equal(r.status, 401);
    assert.equal(r.json.code, 'UNAUTHORIZED');
  });

  test('an unknown action authenticated → 404', async () => {
    const r = await call(get('/api/complaints', 'somethingNew', { auth: PW }), env);
    assert.equal(r.status, 404);
  });

  test('handler direct: unauthenticated read rejects UNAUTHORIZED', async () => {
    await assert.rejects(
      () => handleComplaintsD1(get('/api/complaints', 'recent'), env, ctx),
      { code: 'UNAUTHORIZED' });
  });

  test('syncFromSheets is exported and runs without any password', async () => {
    const res = await syncFromSheets(env.DB, env);
    const d = await res.json();
    assert.equal(d.success, true);
    assert.equal(d.imported, 1);
    assert.equal(d.skipped, 0);
  });

  test('the daily cron still syncs complaints with no credentials', async () => {
    const logs = [];
    const realLog = console.log;
    const realErr = console.error;
    console.log = (...a) => { logs.push(a.join(' ')); };
    console.error = (...a) => { logs.push(a.join(' ')); };
    try {
      await worker.scheduled({ cron: '0 13 * * *' }, env, ctx);
    } finally {
      console.log = realLog;
      console.error = realErr;
    }
    assert.ok(logs.includes('[Cron] Complaints sync: imported=1, skipped=0'), logs.join('\n'));
    assert.ok(!logs.some(l => l.startsWith('[Cron] Complaints sync failed')), logs.join('\n'));
    assert.ok(fetchCalls.some(u => u.startsWith('https://docs.google.com/spreadsheets/')));
  });
});

// ─── /api/consignment ──────────────────────────────────

describe('/api/consignment read lock', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  for (const action of ['getConsignmentPartners', 'getConsignmentPartnerDetail', 'getConsignmentStrains',
    'getConsignmentInventory', 'getConsignmentActivity']) {
    test(`${action} unauthenticated → 401`, async () => {
      const r = await call(get('/api/consignment', action, { params: { id: '1' } }), env);
      assert.equal(r.status, 401);
      assert.equal(r.json.code, 'UNAUTHORIZED');
    });
  }

  test('getConsignmentPartners with a wrong password → 401', async () => {
    const r = await call(get('/api/consignment', 'getConsignmentPartners', { auth: 'nope' }), env);
    assert.equal(r.status, 401);
  });

  test('getConsignmentPartners with the right Bearer → 200', async () => {
    const r = await call(get('/api/consignment', 'getConsignmentPartners', { auth: PW }), env);
    assert.equal(r.status, 200);
    assert.equal(r.json.success, true);
  });

  test('getConsignmentStrains by POST with body.password → 200', async () => {
    const r = await call(post('/api/consignment', 'getConsignmentStrains', { password: PW }), env);
    assert.equal(r.status, 200);
    assert.equal(r.json.success, true);
  });

  test('a write unauthenticated → 401', async () => {
    const r = await call(post('/api/consignment', 'saveConsignmentPartner', { name: 'x' }), env);
    assert.equal(r.status, 401);
  });

  test('test is not an action here, so it is locked too', async () => {
    const r = await call(get('/api/consignment', 'test'), env);
    assert.equal(r.status, 401);
  });

  test('an unknown action unauthenticated → 401, not NOT_FOUND', async () => {
    const r = await call(get('/api/consignment', 'somethingNew'), env);
    assert.equal(r.status, 401);
    assert.equal(r.json.code, 'UNAUTHORIZED');
  });

  test('handler direct: unauthenticated read rejects UNAUTHORIZED', async () => {
    await assert.rejects(
      () => handleConsignmentD1(get('/api/consignment', 'getConsignmentStrains'), env, ctx),
      { code: 'UNAUTHORIZED' });
  });
});

// ─── duplicated / split `action` parameters ────────────
//
// getAction (lib/response.js) returns url.searchParams.get('action') || body.action,
// so with `?action=A&action=B` the FIRST value wins. The auth gate and the switch
// must read the same value. If the gate ever read a different duplicate than the
// switch (e.g. getAll('action').at(-1)), `?action=getOrders&action=getQueueBrief`
// would pass the gate as the open brief and be served as getOrders.

/** A raw request, for URLs the get()/post() helpers cannot build (repeated keys). */
const raw = (url, init) => new Request(`https://x${url}`, init);

/** Queries that touch data. The router's own api_client_log telemetry write is not one. */
const dataQueries = (db) => db.getQueries().filter(q => !/api_client_log/.test(q.sql));

/** POST text/plain JSON with an arbitrary query string (possibly none). */
const postRaw = (url, body) => raw(url, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain' },
  body: JSON.stringify(body),
});

describe('duplicated action parameter cannot split the gate from the switch', () => {
  test('wholesale ?action=getOrders&action=getQueueBrief unauthenticated → 401, no DB query', async () => {
    const db = seedQueue(createMockDB());
    const r = await call(raw('/api/wholesale?action=getOrders&action=getQueueBrief'), makeEnv(db));
    assert.equal(r.status, 401);
    assert.equal(r.json.code, 'UNAUTHORIZED');
    assert.equal(dataQueries(db).length, 0, 'the locked read must not reach the database');
  });

  test('wholesale ?action=getQueueBrief&action=getOrders unauthenticated → 200, stripped (first wins)', async () => {
    const db = seedQueue(createMockDB());
    const r = await call(raw('/api/wholesale?action=getQueueBrief&action=getOrders'), makeEnv(db));
    assert.equal(r.status, 200);
    assert.equal(r.json.ordersLocked, true);
    assert.ok(r.json.headline && r.json.blocks, 'served as the queue brief, not as getOrders');
    assert.ok(!r.text.includes('nickname'), 'no nickname key in the serialized payload');
    assert.ok(!r.text.includes('Fakebuyer'), 'no buyer string in the serialized payload');
  });

  test('wholesale POST ?action=getQueueBrief with body.action=getOrders → 200 stripped (query wins)', async () => {
    const db = seedQueue(createMockDB());
    const r = await call(postRaw('/api/wholesale?action=getQueueBrief', { action: 'getOrders' }), makeEnv(db));
    assert.equal(r.status, 200);
    assert.equal(r.json.ordersLocked, true);
    assert.ok(r.json.headline && r.json.blocks, 'served as the queue brief, not as getOrders');
    assert.ok(!r.text.includes('nickname'));
    assert.ok(!r.text.includes('Fakebuyer'));
  });

  test('wholesale POST with no query action and body.action=getOrders → 401', async () => {
    const db = seedQueue(createMockDB());
    const r = await call(postRaw('/api/wholesale', { action: 'getOrders' }), makeEnv(db));
    assert.equal(r.status, 401);
    assert.equal(r.json.code, 'UNAUTHORIZED');
    assert.equal(dataQueries(db).length, 0);
  });

  test('complaints ?action=complaints&action=test unauthenticated → 401, no DB query', async () => {
    const db = createMockDB();
    const r = await call(raw('/api/complaints?action=complaints&action=test'), makeEnv(db));
    assert.equal(r.status, 401);
    assert.equal(r.json.code, 'UNAUTHORIZED');
    assert.equal(dataQueries(db).length, 0);
  });

  test('consignment ?action=getConsignmentPartners&action=getConsignmentStrains unauthenticated → 401, no DB query', async () => {
    const db = createMockDB();
    const r = await call(raw('/api/consignment?action=getConsignmentPartners&action=getConsignmentStrains'), makeEnv(db));
    assert.equal(r.status, 401);
    assert.equal(r.json.code, 'UNAUTHORIZED');
    assert.equal(dataQueries(db).length, 0);
  });
});
