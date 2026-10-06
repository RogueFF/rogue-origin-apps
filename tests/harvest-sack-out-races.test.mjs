import test from 'node:test';
import assert from 'node:assert/strict';
// Proofs for sack scan-out inventory races. Run: node races.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { fileURLToPath } from 'node:url';
const REPO = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
const { handleHarvestD1 } = await import('file:///' + REPO + '/workers/src/handlers/harvest-d1.js');
const { DEBT_SQL, classifyDebt, inFlight, ADD_LANDED_AFTER_OUT_SQL } = await import('file:///' + REPO + '/workers/src/lib/inventory-debt.js');

const SEASON = new Date().getUTCFullYear();
const VARIANT = 'gid://shopify/ProductVariant/49030527025344';
const MIGRATIONS = [
  '0009-harvest-scan-log.sql', '0010-harvest-sacks.sql', '0011-harvest-sacks-void.sql',
  '0012-harvest-scan-log-cultivar.sql', '0013-harvest-crew-roster.sql',
  '0014-harvest-sack-notes.sql', '0015-harvest-sacks-per-cultivar-serial.sql',
  '0016-harvest-sacks-sku.sql', '0017-harvest-sacks-shopify-sync.sql',
  '0018-harvest-sacks-shopify-add.sql', '0019-harvest-sacks-weight-source.sql',
  '0027-harvest-sacks-all-parts.sql', '0028-harvest-sacks-bay.sql',
  '0029-harvest-crew-tag.sql', '0030-harvest-load-bay.sql', '0040-harvest-load-trailer.sql', '0031-harvest-sacks-storage.sql',
  '0034-harvest-lot-takedown-done.sql', '0035-harvest-sacks-serial-per-cut.sql',
  '0036-harvest-sack-notes-edit.sql', '0037-harvest-settings.sql', '0038-harvest-print-queue.sql', '0041-harvest-sacks-fill-lbs.sql', '0045-harvest-sacks-scan-out.sql',
];

// Pool stub with a ledger and an optional gate: when gated, the next adjust call
// blocks until release() — lets us interleave a second request mid-call.
function pool() {
  const st = { ledger: 0, calls: [], mode: 'ok', gate: null, first: null };
  globalThis.fetch = async (url, init) => {
    const b = JSON.parse(init.body);
    if (b.action === 'get_supersack_variants') {
      return Response.json({ variants: [{ id: VARIANT, title: `${SEASON} - Purple Snowman / Sungrown / 1st Cut`,
        inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: 'gid://shopify/Location/1' }] });
    }
    st.calls.push(b); 
    if (st.gate) { const g = st.gate; st.gate = null; g.entered(); await g.wait; }
    if (st.mode === 'refuse') return Response.json({ error: 'locked' });
    const d = (b.operation === 'subtract' ? -1 : 1) * Number(b.amount); st.log = (st.log || []).concat(b.operation + ' ' + b.amount);
    st.ledger += d;
    return Response.json({ ok: true });
  };
  st.arm = () => {
    let release, entered; const w = new Promise(r => (release = r)); const e = new Promise(r => (entered = r));
    st.gate = { wait: w, entered }; return { release, entered: e };
  };
  return st;
}

function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) {
    const s = readFileSync(join(REPO, 'workers/migrations', f), 'utf8').split(/\r?\n/).map(l => l.replace(/--.*$/, '')).join('\n');
    for (const stmt of s.split(';')) { const t = stmt.trim(); if (t) sqlite.exec(t); }
  }
  sqlite.exec('CREATE TABLE cultivars (id INTEGER PRIMARY KEY, name TEXT, sku_prefix TEXT)');
  sqlite.exec('CREATE TABLE cultivar_aliases (alias TEXT, cultivar_id INTEGER)');
  sqlite.exec('CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, nickname TEXT, shopify_order_name TEXT)');
  const DB = { async batch(s) { return Promise.all(s.map(x => x.run())); }, prepare(sql) { return { bind(...a) { return {
    all: async () => ({ results: sqlite.prepare(sql).all(...a) }),
    first: async () => sqlite.prepare(sql).get(...a) ?? null,
    run: async () => { const r = sqlite.prepare(sql).run(...a); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
  }; } }; } };
  const env = { DB, HARVEST_TEST_MODE: 'false', ORDERS_PASSWORD: 'test-password',
    POOL_INVENTORY_API_URL: 'https://pool.test/exec', POOL_INVENTORY_API_KEY: 'k' };
  const pending = []; const ctx = { waitUntil(p) { pending.push(p); } };
  const settle = async () => { while (pending.length) await pending.shift(); };
  sqlite.prepare(`INSERT INTO harvest_scan_log (id, event_type, zone, cultivar, season, cut_number, is_test) VALUES (119,'enter','R1','Purple Snowman',?,1,0)`).run(SEASON);
  sqlite.prepare(`INSERT INTO harvest_sacks (sack_id, season, serial, zone, cultivar, cut_number, harvest_date, zone_session_id,
     is_test, printed_at, shopify_added_at, shopify_variant_id) VALUES ('26-PURPSNOW-2', ?, 2, 'R1','Purple Snowman',1,date('now'),119,0,datetime('now'),?,?)`)
    .run(SEASON, '2026-09-21T21:26:45.082Z', VARIANT);
  return { sqlite, env, ctx, settle };
}
const q = async (fn) => { const l = console.log, e = console.error; console.log = () => {}; console.error = () => {}; try { return await fn(); } finally { console.log = l; console.error = e; } };
const post = async (h, action, body, auth) => { const r = await q(() => handleHarvestD1(new Request(`https://x/api/harvest?action=${action}`,
  { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'test-password' } : {}) }, body: JSON.stringify(body) }), h.env, h.ctx)); return r.json(); };
const row = (h) => h.sqlite.prepare(`SELECT opened_at, voided_at, shopify_added_at, shopify_add_error, shopify_synced_at, shopify_sync_error FROM harvest_sacks WHERE sack_id='26-PURPSNOW-2'`).get();
const debts = (h) => h.sqlite.prepare(`SELECT * FROM harvest_sacks WHERE is_test=0 AND (${DEBT_SQL})`).all().map(classifyDebt);
const report = (name, h, p, shouldBe) => {
  // Shopify holds: tag +1 (pre-seeded as counted, unless overridden) + ledger.
  const holds = (h.base ?? 1) + p.ledger;
  console.log(`\n== ${name}\n  row: ${JSON.stringify(row(h))}\n  Shopify holds ${holds}, should hold ${shouldBe}\n  debt list: ${JSON.stringify(debts(h))}`);
  console.log(holds !== shouldBe && debts(h).length === 0 ? '  >>> BUG: count wrong and NOT in debt list' : '  (see above)');
};
const sweep = (h, force) => post(h, `inventory_sweep&apply=1${force ? '&force=1' : ''}`, {}, true);

// ---- tests (ported from review-a/races.mjs, 2026-10-06) ----
const ID = '26-PURPSNOW-2';
const set = (h, sql, ...a) => h.sqlite.prepare(`UPDATE harvest_sacks SET ${sql} WHERE sack_id='${ID}'`).run(...a);
const holds = (h, p) => (h.base ?? 1) + p.ledger;
const shape = (h) => debts(h).map(d => `${d.kind}/${d.owes}/${d.state}`);
const old = (what) => `in flight since 2026-01-01T00:00:00.000Z (${what})`;
// The tag job's success write-back, verbatim SQL shape from harvest-d1.js.
const tagLands = (h) => h.sqlite.prepare(`UPDATE harvest_sacks SET shopify_added_at = ?, shopify_add_error = NULL,
  shopify_sync_error = ${ADD_LANDED_AFTER_OUT_SQL} WHERE sack_id = ?`).run(new Date().toISOString(), 1, ID);

test('P1: tag +1 lands after the scan-out -> out-debt -> sweep settles to 0', async () => {
  const p = pool(); const h = freshDb();
  set(h, 'shopify_added_at=NULL, shopify_add_error=?', inFlight('add')); h.base = 0;
  await post(h, 'sack_out', { q: ID, order_id: 'stock' }); await h.settle();
  assert.equal(p.calls.length, 0);
  tagLands(h); p.ledger += 1;
  assert.equal(holds(h, p), 1);
  assert.deepEqual(shape(h), ['out/-1/failed']);
  await sweep(h); await h.settle();
  assert.equal(holds(h, p), 0); assert.deepEqual(shape(h), []);
});

test('P1 then undo: Shopify 1, sack in inventory, no debt', async () => {
  const p = pool(); const h = freshDb();
  set(h, 'shopify_added_at=NULL, shopify_add_error=?', inFlight('add')); h.base = 0;
  await post(h, 'sack_out', { q: ID, order_id: 'stock' }); await h.settle();
  tagLands(h); p.ledger += 1;
  await post(h, 'sack_out_undo', { sack_id: ID }); await h.settle();
  assert.equal(row(h).opened_at, null); assert.equal(holds(h, p), 1); assert.deepEqual(shape(h), []);
});

test('P4: sweep retry of a failed add lands after the scan-out -> out-debt -> settles', async () => {
  const p = pool(); const h = freshDb();
  set(h, "shopify_added_at=NULL, shopify_add_error='boom'"); h.base = 0;
  const g = p.arm(); const sw = sweep(h); await g.entered;
  assert.match(row(h).shopify_add_error, /^in flight since .*\(sweep add\)$/, 'marker laid before the call');
  await post(h, 'sack_out', { q: ID, order_id: 'stock' }); g.release(); await sw; await h.settle();
  assert.equal(holds(h, p), 1); assert.deepEqual(shape(h), ['out/-1/failed']);
  await sweep(h); await h.settle();
  assert.equal(holds(h, p), 0); assert.deepEqual(shape(h), []);
});

for (const [name, mode, want] of [['P2', 'ok', 0], ['P2b', 'refuse', 1]]) {
  test(`${name}: sweep -1 in flight, crew undoes -> never stamped counted, listed unknown`, async () => {
    const p = pool(); const h = freshDb();
    p.mode = 'refuse'; await post(h, 'sack_out', { q: ID, order_id: 'stock' }); await h.settle(); p.mode = mode;
    const g = p.arm(); const sw = sweep(h); await g.entered;
    assert.match(row(h).shopify_sync_error, /\(sweep out\)$/);
    await post(h, 'sack_out_undo', { sack_id: ID }); g.release(); await sw; await h.settle();
    assert.equal(row(h).opened_at, null);
    assert.equal(holds(h, p), want);
    assert.deepEqual(shape(h), ['undo/1/unknown'], 'a person must check: the -1 outcome was unseen by the undo');
    const before = p.calls.length; await sweep(h); await h.settle();
    assert.equal(p.calls.length, before, 'unknown is never auto-replayed'); assert.equal(holds(h, p), want);
  });
}

test('P3: undo add-back failed, sweep +1 in flight, rescan is busy; ends consistent', async () => {
  const p = pool(); const h = freshDb();
  await post(h, 'sack_out', { q: ID, order_id: 'stock' }); await h.settle();
  p.mode = 'refuse'; await post(h, 'sack_out_undo', { sack_id: ID }); await h.settle(); p.mode = 'ok';
  const g = p.arm(); const sw = sweep(h); await g.entered;
  const r = await post(h, 'sack_out', { q: ID, order_id: 'stock' });
  assert.equal((r.data || r).state, 'busy');
  g.release(); await sw; await h.settle();
  assert.equal(row(h).opened_at, null); assert.equal(holds(h, p), 1); assert.deepEqual(shape(h), []);
});

test('sweep skips a row that changed between its read and its call; two sweeps act once', async () => {
  const p = pool(); const h = freshDb();
  set(h, "shopify_added_at=NULL, shopify_add_error='boom'"); h.base = 0;
  const g = p.arm(); const a = sweep(h); await g.entered;
  const b = await sweep(h, true);
  const rb = (b.data || b).rows.find(x => x.sack_id === ID);
  assert.equal(rb.acted, false); assert.equal(rb.changed, true);
  g.release(); await a; await h.settle();
  assert.equal(p.calls.length, 1); assert.equal(holds(h, p), 1); assert.deepEqual(shape(h), []);
});

test('stale (undo out) marker -> scan goes out as unknown, no call; live -> busy', async () => {
  const p = pool(); const h = freshDb();
  set(h, 'shopify_sync_error=?', inFlight('undo out'));
  assert.equal(((await post(h, 'sack_out', { q: ID, order_id: 'stock' })).data || {}).state ?? 'busy', 'busy');
  assert.equal(row(h).opened_at, null);
  set(h, 'shopify_sync_error=?', old('undo out'));
  await post(h, 'sack_out', { q: ID, order_id: 'stock' }); await h.settle();
  assert.ok(row(h).opened_at); assert.equal(p.calls.length, 0);
  assert.match(row(h).shopify_sync_error, /out again; check Shopify$/);
  assert.deepEqual(shape(h), ['out/-1/unknown']);
  const t0 = Date.now(); await post(h, 'sack_out_undo', { sack_id: ID }); await h.settle();
  assert.ok(Date.now() - t0 < 1500, 'undo does not wait on a check-Shopify row');
  assert.equal(p.calls.length, 0); assert.deepEqual(shape(h), ['undo/1/unknown']);
});

test('void from the check-Shopify state succeeds, sends nothing, stays listed unknown', async () => {
  const p = pool(); const h = freshDb();
  set(h, 'shopify_sync_error=?', `${old('out')} — undone; check Shopify`);
  const r = await post(h, 'sack_void', { sack_id: ID }, true); await h.settle();
  assert.ok(row(h).voided_at, JSON.stringify(r).slice(0, 200));
  assert.equal(p.calls.length, 0);
  assert.deepEqual(shape(h), ['void/-1/unknown']);
  assert.match(debts(h)[0].error, /voided; check Shopify/);
});

test('E: DEBT_SQL and classifyDebt agree on every row shape', () => {
  const live = inFlight('x'), A = '2026-09-21T00:00:00Z';
  const cases = [
    ['never-added failed', { shopify_added_at: null, shopify_add_error: 'boom' }, 'add/1/failed'],
    ['add in flight live', { shopify_added_at: null, shopify_add_error: live }, 'add/1/unknown'],
    ['add in flight stale', { shopify_added_at: null, shopify_add_error: old('add') }, 'add/1/unknown'],
    ['added, clean', {}, null],
    ['out counted', { opened_at: A, shopify_synced_at: A }, null],
    ['out failed', { opened_at: A, shopify_sync_error: 'boom' }, 'out/-1/failed'],
    ['out in flight live', { opened_at: A, shopify_sync_error: live }, 'out/-1/unknown'],
    ['out in flight stale', { opened_at: A, shopify_sync_error: old('out') }, 'out/-1/unknown'],
    ['out, failed add', { opened_at: A, shopify_added_at: null, shopify_add_error: 'boom' }, null],
    ['out, add in flight', { opened_at: A, shopify_added_at: null, shopify_add_error: live }, 'add/0/unknown'],
    ['out, add landed after out', { opened_at: A, shopify_sync_error: 'add landed after out' }, 'out/-1/failed'],
    ['undone, add-back in flight', { shopify_sync_error: live }, 'undo/1/unknown'],
    ['undone, add-back failed', { shopify_sync_error: 'undo add-back failed: x' }, 'undo/1/failed'],
    ['undone; check Shopify', { shopify_sync_error: `${old('out')} — undone; check Shopify` }, 'undo/1/unknown'],
    ['out again; check Shopify', { opened_at: A, shopify_sync_error: `${old('out')} — undone; check Shopify — out again; check Shopify` }, 'out/-1/unknown'],
    ['voided, add counted', { voided_at: A }, 'void/-1/failed'],
    ['voided, add never counted', { voided_at: A, shopify_added_at: null }, null],
    ['voided from check-Shopify', { voided_at: A, shopify_sync_error: `${old('out')} — undone; check Shopify — voided; check Shopify holds 0 for this sack` }, 'void/-1/unknown'],
    ['legacy never-opened stray sync error, no add', { shopify_added_at: null, shopify_sync_error: 'stray' }, null],
  ];
  for (const [name, cols, want] of cases) {
    const h = freshDb();
    const base = { opened_at: null, voided_at: null, shopify_added_at: A, shopify_add_error: null, shopify_synced_at: null, shopify_sync_error: null };
    const c = { ...base, ...cols };
    set(h, Object.keys(c).map(k => `${k}=?`).join(', '), ...Object.values(c));
    assert.deepEqual(shape(h), want ? [want] : [], name);
  }
});
