// API-level tests for sack scan-out: real Requests through handleHarvestD1 and the worker fetch.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = (p) => join(REPO, p).replace(/\\/g, '/').replace(/^/, 'file:///');

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node < 22.5 */ }

const { handleHarvestD1 } = await import(url('workers/src/handlers/harvest-d1.js'));
const { UNDO_WAIT } = await import(url('workers/src/handlers/harvest-sack-out.js'));
const { proposeOrder } = await import(url('workers/src/lib/sack-out.js'));
const worker = (await import(url('workers/src/index.js'))).default;

UNDO_WAIT.stepMs = 20; UNDO_WAIT.maxMs = 300;

const SEASON = new Date().getUTCFullYear();
const YY = String(SEASON).slice(2);
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

function poolStub() {
  const calls = [];
  globalThis.fetch = async (_u, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (body.action === 'get_supersack_variants') {
      return Response.json({ variants: [{ id: VARIANT, title: `${SEASON} - Purple Snowman / Sungrown / 1st Cut`,
        inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: 'gid://shopify/Location/1' }] });
    }
    return Response.json({ ok: true });
  };
  return calls;
}
const adjusts = (calls) => calls.filter(c => c.action !== 'get_supersack_variants');

function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) {
    const stripped = readFileSync(join(REPO, 'workers/migrations', f), 'utf8')
      .split(/\r?\n/).map(l => l.replace(/--.*$/, '')).join('\n');
    for (const stmt of stripped.split(';')) { const t = stmt.trim(); if (t) sqlite.exec(t); }
  }
  sqlite.exec('CREATE TABLE cultivars (id INTEGER PRIMARY KEY, name TEXT, sku_prefix TEXT)');
  sqlite.exec('CREATE TABLE cultivar_aliases (alias TEXT, cultivar_id INTEGER)');
  sqlite.exec('CREATE TABLE orders (id TEXT PRIMARY KEY, nickname TEXT, shopify_order_name TEXT)');
  sqlite.exec(`INSERT INTO cultivars VALUES (7, 'Purple Snowman', 'PURPSNOW')`);
  sqlite.exec(`INSERT INTO orders VALUES ('WO-1', 'Acme', '#1001'), ('WO-2', 'Beta', '#1002')`);
  sqlite.prepare(`INSERT INTO harvest_scan_log (id, event_type, zone, cultivar, season, cut_number, is_test)
    VALUES (119, 'enter', 'R1', 'Purple Snowman', ?, 1, 0)`).run(SEASON);
  const DB = {
    async batch(stmts) { return Promise.all(stmts.map(st => st.run())); },
    prepare(sql) {
      return { bind(...args) { return {
        all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
        first: async () => sqlite.prepare(sql).get(...args) ?? null,
        run: async () => { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
      }; } };
    },
  };
  const env = { DB, HARVEST_TEST_MODE: 'false', ORDERS_PASSWORD: 'test-password',
    POOL_INVENTORY_API_URL: 'https://pool.test/exec', POOL_INVENTORY_API_KEY: 'k' };
  const pending = [];
  const ctx = { waitUntil(p) { pending.push(p); } };
  const settle = async () => { while (pending.length) await pending.shift(); };
  return { sqlite, env, ctx, settle };
}

/** A printed, counted tag; `extra` sets any other columns. */
function seed(sqlite, { id = `${YY}-PURPSNOW-2`, serial = 2, cultivar = 'Purple Snowman', season = SEASON, ...extra } = {}) {
  sqlite.prepare(`INSERT INTO harvest_sacks (sack_id, season, serial, zone, cultivar, cut_number, harvest_date,
      zone_session_id, is_test, printed_at, shopify_added_at, shopify_variant_id)
    VALUES (?, ?, ?, 'R1', ?, 1, date('now'), 119, 0, datetime('now'), '2026-09-21T21:26:45.082Z', ?)`)
    .run(id, season, serial, cultivar, VARIANT);
  for (const [k, v] of Object.entries(extra)) sqlite.prepare(`UPDATE harvest_sacks SET ${k} = ? WHERE sack_id = ?`).run(v, id);
  return id;
}
const row = (sqlite, id = `${YY}-PURPSNOW-2`) => sqlite.prepare(`SELECT * FROM harvest_sacks WHERE sack_id = ?`).get(id);

const quiet = async (fn) => {
  const l = console.log, e = console.error; console.log = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = l; console.error = e; }
};
const unwrap = async (res) => { const j = await res.json(); return j.data && typeof j.data === 'object' && !Array.isArray(j.data) ? { ...j, ...j.data } : j; };
const post = (env, ctx, action, body, { type = 'application/json', qs = '' } = {}) => quiet(async () => unwrap(await handleHarvestD1(
  new Request(`https://x/api/harvest?action=${action}${qs}`, { method: 'POST', headers: { 'content-type': type }, body: JSON.stringify(body) }), env, ctx)));
const get = (env, ctx, action) => quiet(async () => unwrap(await handleHarvestD1(new Request(`https://x/api/harvest?action=${action}`), env, ctx)));

before((t) => { if (!DatabaseSync) t.skip('node:sqlite unavailable'); });

test('sack_out accepts a text/plain JSON body and takes the sack out', async () => {
  const { sqlite, env, ctx, settle } = freshDb(); const calls = poolStub(); const id = seed(sqlite);
  const r = await post(env, ctx, 'sack_out', { q: id }, { type: 'text/plain;charset=UTF-8' });
  await quiet(settle);
  assert.equal(r.state, 'out'); assert.ok(row(sqlite).opened_at); assert.equal(row(sqlite).out_by, 'scan');
  assert.equal(adjusts(calls).length, 1);
});

test('typed code + number goes out with out_by=typed', async () => {
  const { sqlite, env, ctx, settle } = freshDb(); poolStub(); seed(sqlite);
  const r = await post(env, ctx, 'sack_out', { code: `${YY}-PURPSNOW`, number: 2, by: 'typed' });
  await quiet(settle);
  assert.equal(r.state, 'out'); assert.equal(row(sqlite).out_by, 'typed');
});

test('already_out carries order, order_options and undo_until inside the window, null after', async () => {
  const { sqlite, env, ctx } = freshDb(); poolStub();
  seed(sqlite, { opened_at: new Date().toISOString().slice(0, 19).replace('T', ' '), out_order_id: 'WO-1', out_order_source: 'queue', out_by: 'scan' });
  const r = await post(env, ctx, 'sack_out', { q: `${YY}-PURPSNOW-2` });
  assert.equal(r.state, 'already_out'); assert.equal(r.order.id, 'WO-1'); assert.ok(Array.isArray(r.order_options));
  assert.ok(r.sack.opened_at); assert.ok(Date.parse(r.undo_until) > Date.now());
  seed(sqlite, { id: `${YY}-PURPSNOW-3`, serial: 3, opened_at: '2026-01-01 00:00:00' });
  const old = await post(env, ctx, 'sack_out', { q: `${YY}-PURPSNOW-3` });
  assert.equal(old.state, 'already_out'); assert.equal(old.undo_until, null);
});

test('assign: another order, stock, unknown order (message, nothing written), not out', async () => {
  const { sqlite, env, ctx } = freshDb(); poolStub();
  seed(sqlite, { opened_at: '2026-01-01 00:00:00', out_order_id: 'WO-1', out_order_source: 'queue' });
  const a = await post(env, ctx, 'sack_out_assign', { sack_id: `${YY}-PURPSNOW-2`, order_id: 'WO-2' });
  assert.equal(a.state, 'out'); assert.equal(row(sqlite).out_order_id, 'WO-2'); assert.ok(Array.isArray(a.order_options));
  const u = await post(env, ctx, 'sack_out_assign', { sack_id: `${YY}-PURPSNOW-2`, order_id: 'NOPE' });
  assert.equal(u.state, 'unknown_order'); assert.ok(u.message); assert.equal(row(sqlite).out_order_id, 'WO-2');
  const st = await post(env, ctx, 'sack_out_assign', { sack_id: `${YY}-PURPSNOW-2`, order_id: 'stock' });
  assert.equal(st.state, 'out'); assert.equal(row(sqlite).out_order_id, null);
  seed(sqlite, { id: `${YY}-PURPSNOW-4`, serial: 4 });
  const n = await post(env, ctx, 'sack_out_assign', { sack_id: `${YY}-PURPSNOW-4`, order_id: 'WO-1' });
  assert.equal(n.state, 'not_out'); assert.equal(row(sqlite, `${YY}-PURPSNOW-4`).out_order_id, null);
});

// A LIVE marker: one older than two minutes counts as abandoned (see
// isLiveInFlight) and is treated as unknown rather than busy.
const IN_FLIGHT_MARK = `in flight since ${new Date().toISOString()} (scan out)`;
async function undoWhile(settleTo) {
  const { sqlite, env, ctx, settle } = freshDb(); const calls = poolStub();
  seed(sqlite, { opened_at: '2026-01-01 00:00:00', out_by: 'scan', shopify_sync_error: IN_FLIGHT_MARK });
  const p = post(env, ctx, 'sack_out_undo', { sack_id: `${YY}-PURPSNOW-2` });
  await new Promise(r => setTimeout(r, 60));
  if (settleTo === 'landed') sqlite.prepare(`UPDATE harvest_sacks SET shopify_synced_at = datetime('now'), shopify_sync_error = NULL`).run();
  if (settleTo === 'failed') sqlite.prepare(`UPDATE harvest_sacks SET shopify_sync_error = 'pool refused'`).run();
  const r = await p; await quiet(settle);
  return { r, calls, row: row(sqlite) };
}

test('undo waits for an in-flight -1 that then lands: exactly one add back', async () => {
  const { r, calls, row: s } = await undoWhile('landed');
  assert.equal(r.state, 'undone'); assert.equal(s.opened_at, null);
  assert.equal(adjusts(calls).length, 1); assert.equal(adjusts(calls)[0].delta ?? 1, 1);
});

test('undo waits for an in-flight -1 that then fails: no pool call, error cleared', async () => {
  const { r, calls, row: s } = await undoWhile('failed');
  assert.equal(r.state, 'undone'); assert.equal(adjusts(calls).length, 0); assert.equal(s.shopify_sync_error, null);
});

test('undo of a -1 that never settles: put back, flagged for a person, no add back', async () => {
  const { r, calls, row: s } = await undoWhile('never');
  assert.equal(r.state, 'undone'); assert.equal(adjusts(calls).length, 0);
  assert.match(s.shopify_sync_error, /undone; check Shopify/);
});

test('a sack still settling with Shopify answers busy (needs takeSackOut → "busy")', async () => {
  const { sqlite, env, ctx, settle } = freshDb(); const calls = poolStub();
  seed(sqlite, { shopify_sync_error: `in flight since ${new Date().toISOString()} (undo out)` });
  const r = await post(env, ctx, 'sack_out', { q: `${YY}-PURPSNOW-2` }); await quiet(settle);
  assert.equal(r.state, 'busy'); assert.equal(row(sqlite).opened_at, null); assert.equal(adjusts(calls).length, 0);
});

test('sack_out_today: groups, can_undo, tz, chips, and a null-cultivar row does not throw', async () => {
  const { sqlite, env, ctx } = freshDb(); poolStub();
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  seed(sqlite, { opened_at: now, out_order_id: 'WO-1' });
  seed(sqlite, { id: `${YY}-PURPSNOW-3`, serial: 3, opened_at: now, out_order_id: 'WO-1', tops_lbs: 4.5 });
  seed(sqlite, { id: `${YY}-PURPSNOW-4`, serial: 4, opened_at: now });
  seed(sqlite, { id: `${YY}-PURPSNOW-5`, serial: 5 });                         // chip
  seed(sqlite, { id: `${YY}-PURPSNOW-6`, serial: 6 });                         // chip
  seed(sqlite, { id: `${YY}-PURPSNOW-7`, serial: 7, voided_at: now });         // not a chip
  seed(sqlite, { id: `${YY}-PURPSNOW-8`, serial: 8, printed_at: null });       // not a chip
  seed(sqlite, { id: `${YY}-PURPSNOW-9`, serial: 9, is_test: 1 });             // not a chip
  seed(sqlite, { id: `${YY}-PURPSNOW-10`, serial: 10, season: SEASON - 1 });   // not a chip
  try { seed(sqlite, { id: `${YY}-X-1`, serial: 1, cultivar: null, opened_at: now }); }
  catch { seed(sqlite, { id: `${YY}-X-1`, serial: 1, cultivar: '', opened_at: now }); }
  const r = await get(env, ctx, 'sack_out_today');
  assert.equal(r.tz, 'UTC'); assert.equal(r.total, 4);
  const g = r.groups.find(x => x.cultivar === 'Purple Snowman' && x.order?.id === 'WO-1');
  assert.equal(g.sacks_today, 2); assert.equal(g.sacks_needed, null);
  assert.deepEqual(g.sacks.map(s => s.can_undo), [true, false]);
  assert.equal(r.groups.find(x => x.cultivar === 'Purple Snowman' && !x.order?.id)?.sacks_today, 1);
  assert.equal(r.groups.find(x => !x.cultivar).cultivar_code, null);
  assert.deepEqual(r.chips.map(c => [c.cultivar, c.in_inventory]), [['Purple Snowman', 2]]);
});

test('the example sacks never write; refused follows lang', async () => {
  const { sqlite, env, ctx, settle } = freshDb(); const calls = poolStub();
  seed(sqlite, { id: '26-SLIFT-142', serial: 142, cultivar: 'Sour Lifter' });
  const en = await post(env, ctx, 'sack_out', { q: '26-SLIFT-142' }, { qs: '&lang=en' });
  const es = await post(env, ctx, 'sack_out', { q: '26-SLIFT-142' }, { qs: '&lang=es' });
  await quiet(settle);
  assert.equal(en.state, 'refused'); assert.match(en.message, /^Test mode/); assert.match(es.message, /^Modo de prueba/);
  assert.equal(row(sqlite, '26-SLIFT-142').opened_at, null); assert.equal(calls.length, 0);
});

// Queue objects shaped like computeQueue output (blocks[].orderId, passes[].cultivarId/remainingTopsLbs/sacksNeeded).
const block = (orderId, cultivarId, remainingTopsLbs, sacksNeeded) => ({ orderId, passes: [{ cultivarId, remainingTopsLbs, sacksNeeded }] });
test('proposeOrder: top-ranked wins, options in rank order, produced lines skipped, none → null', () => {
  const q = { blocks: [block('WO-9', 3, 20, 2), block('WO-1', 7, 50, 4), block('WO-2', 7, 0, 0), block('WO-3', 7, 10, 1)] };
  const r = proposeOrder([7], q);
  assert.equal(r.proposed.id, 'WO-1'); assert.deepEqual(r.options.map(o => o.id), ['WO-1', 'WO-3']);
  assert.equal(r.options[0].sacks_needed, 4);
  assert.equal(proposeOrder([8], q).proposed, null);
});

test('routing: /salida and /out serve the page; the decoder is JS with a long cache', async () => {
  const { env, ctx } = freshDb(); poolStub();
  for (const p of ['/salida', '/out']) {
    const res = await quiet(() => worker.fetch(new Request('https://x' + p), env, ctx));
    assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /html/);
    assert.match(await res.text(), /<html/i);
  }
  const js = await quiet(() => worker.fetch(new Request('https://x/salida/jsqr-1.4.0.js'), env, ctx));
  assert.equal(js.status, 200); assert.match(js.headers.get('content-type'), /javascript/);
  assert.match(js.headers.get('cache-control') || '', /max-age=\d{6,}/);
});
