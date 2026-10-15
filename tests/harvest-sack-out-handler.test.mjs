// Handler-level tests for sack scan-out (Track A). Harness copied from harvest-inventory-honesty.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node < 22.5 */ }

const { handleHarvestD1 } = await import(
  join(REPO, 'workers/src/handlers/harvest-d1.js').replace(/\\/g, '/').replace(/^/, 'file:///')
);

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

/**
 * The pool API, as the worker sees it: a POST that answers with JSON, with an
 * HTML error page (the 2026-09-22 failure), or not at all.
 */
function poolStub(mode) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (mode === 'html') {
      return new Response('<!doctype html><html><head>Sorry, unable to open the file</head></html>',
        { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (body.action === 'get_supersack_variants') {
      return Response.json({
        variants: [{
          id: VARIANT, title: `${SEASON} - Purple Snowman / Sungrown / 1st Cut`,
          inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: 'gid://shopify/Location/1',
        }],
      });
    }
    if (mode === 'refuse') return Response.json({ error: 'Inventory is locked for stocktake' });
    return Response.json({ ok: true });
  };
  return calls;
}

function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) {
    const stripped = readFileSync(join(REPO, 'workers/migrations', f), 'utf8')
      .split(/\r?\n/).map(l => l.replace(/--.*$/, '')).join('\n');
    for (const stmt of stripped.split(';')) { const t = stmt.trim(); if (t) sqlite.exec(t); }
  }
  sqlite.exec('CREATE TABLE cultivars (id INTEGER PRIMARY KEY, name TEXT, sku_prefix TEXT)');
  sqlite.exec('CREATE TABLE cultivar_aliases (alias TEXT, cultivar_id INTEGER)');
  const DB = {
    async batch(stmts) { return Promise.all(stmts.map(st => st.run())); },
    prepare(sql) {
      return {
        bind(...args) {
          return {
            all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
            first: async () => sqlite.prepare(sql).get(...args) ?? null,
            run: async () => {
              const r = sqlite.prepare(sql).run(...args);
              return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
            },
          };
        },
      };
    },
  };
  // Live, not test mode: the sync only runs against real rows.
  const env = {
    DB, HARVEST_TEST_MODE: 'false', ORDERS_PASSWORD: 'test-password',
    POOL_INVENTORY_API_URL: 'https://pool.test/exec', POOL_INVENTORY_API_KEY: 'k',
  };
  // The background work is the thing under test, so it has to be awaited.
  const pending = [];
  const ctx = { waitUntil(p) { pending.push(p); } };
  const settle = async () => { while (pending.length) await pending.shift(); };
  return { sqlite, env, ctx, settle };
}

const quiet = async (fn) => {
  const l = console.log, e = console.error;
  console.log = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = l; console.error = e; }
};

/** A printed, counted tag — the state a void starts from. */
function seedCountedTag(sqlite, { sackId = '26-PURPSNOW-2', serial = 2 } = {}) {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (id, event_type, zone, cultivar, season, cut_number, is_test)
    VALUES (119, 'enter', 'R1', 'Purple Snowman', ?, 1, 0)
  `).run(SEASON);
  sqlite.prepare(`
    INSERT INTO harvest_sacks
      (sack_id, season, serial, zone, cultivar, cut_number, harvest_date, zone_session_id,
       is_test, printed_at, shopify_added_at, shopify_variant_id)
    VALUES (?, ?, ?, 'R1', 'Purple Snowman', 1, date('now'), 119, 0, datetime('now'), ?, ?)
  `).run(sackId, SEASON, serial, '2026-09-21T21:26:45.082Z', VARIANT);
}


const row = (sqlite, id = '26-PURPSNOW-2') => sqlite.prepare(`SELECT * FROM harvest_sacks WHERE sack_id = ?`).get(id);
const adjusts = (calls) => calls.filter(c => c.action !== 'get_supersack_variants');
const post = async (env, ctx, action, body) => {
  const res = await quiet(() => handleHarvestD1(new Request(`https://x/api/harvest?action=${action}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env, ctx));
  const j = await res.json();
  return j.data && typeof j.data === 'object' && !Array.isArray(j.data) ? { ...j, ...j.data } : j;
};
const get = async (env, ctx, qs) => {
  const j = await (await quiet(() => handleHarvestD1(new Request(`https://x/api/harvest?${qs}`), env, ctx))).json();
  return j.data && typeof j.data === 'object' ? { ...j, ...j.data } : j;
};
const out = (env, ctx, body) => post(env, ctx, 'sack_out', body);
function setup(mode = 'ok') {
  const h = freshDb();
  seedCountedTag(h.sqlite);
  h.sqlite.exec(`CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, nickname TEXT, shopify_order_name TEXT)`);
  h.sqlite.exec(`INSERT INTO orders (id, nickname, shopify_order_name) VALUES ('ORD-1', 'Acme', '#1001')`);
  h.calls = poolStub(mode);
  return h;
}
const skip = !DatabaseSync;

test('good scan by bare id: out, one -1, stamped scan', { skip }, async () => {
  const { sqlite, env, ctx, settle, calls } = setup();
  const r = await out(env, ctx, { q: '26-PURPSNOW-2' });
  await settle();
  assert.equal(r.state, 'out');
  assert.equal(row(sqlite).out_by, 'scan');
  assert.ok(row(sqlite).shopify_synced_at);
  assert.equal(adjusts(calls).length, 1);
});

test('good scan by tag URL and by code+number', { skip }, async () => {
  for (const body of [{ q: 'https://x/s/26-PURPSNOW-2' }, { code: 'PURPSNOW', number: '2', by: 'typed' }]) {
    const { env, ctx, settle } = setup();
    const r = await out(env, ctx, body);
    await settle();
    assert.equal(r.state, 'out', JSON.stringify(body));
  }
});

test('repeat scan is already_out with exactly one subtract', { skip }, async () => {
  const { env, ctx, settle, calls } = setup();
  await out(env, ctx, { q: '26-PURPSNOW-2' }); await settle();
  const r = await out(env, ctx, { q: '26-PURPSNOW-2' }); await settle();
  assert.equal(r.state, 'already_out');
  assert.equal(adjusts(calls).length, 1);
});

test('two concurrent scans for one sack: exactly one subtract', { skip }, async () => {
  const { env, ctx, settle, calls } = setup();
  const rs = await Promise.all([out(env, ctx, { q: '26-PURPSNOW-2' }), out(env, ctx, { q: '26-PURPSNOW-2' })]);
  await settle();
  assert.deepEqual(rs.map(r => r.state).sort(), ['already_out', 'out']);
  assert.equal(adjusts(calls).length, 1);
});

test('not found, not_a_tag, voided', { skip }, async () => {
  const { sqlite, env, ctx, calls } = setup();
  assert.equal((await out(env, ctx, { q: '26-PURPSNOW-999' })).state, 'not_found');
  assert.equal((await out(env, ctx, { q: 'https://menu.example.com/lunch' })).state, 'not_a_tag');
  sqlite.exec(`UPDATE harvest_sacks SET voided_at = datetime('now')`);
  assert.equal((await out(env, ctx, { q: '26-PURPSNOW-2' })).state, 'voided');
  assert.equal(adjusts(calls).length, 0);
});

test('explicit order_id, "stock", and an unknown order_id rejected with nothing written', { skip }, async () => {
  const { sqlite, env, ctx, settle } = setup();
  const bad = await out(env, ctx, { q: '26-PURPSNOW-2', order_id: 'NOPE' });
  assert.equal(bad.success, false);
  assert.equal(row(sqlite).opened_at, null);
  const r = await out(env, ctx, { q: '26-PURPSNOW-2', order_id: 'ORD-1' }); await settle();
  assert.equal(r.order.id, 'ORD-1');
  assert.equal(row(sqlite).out_order_source, 'manual');
  const a = await post(env, ctx, 'sack_out_assign', { sack_id: '26-PURPSNOW-2', order_id: 'stock' });
  assert.equal(a.order, null);
  assert.equal(row(sqlite).out_order_id, null);
});

test('a sack whose +1 never reached Shopify sends no -1', { skip }, async () => {
  const { sqlite, env, ctx, settle, calls } = setup();
  sqlite.exec(`UPDATE harvest_sacks SET shopify_added_at = NULL`);
  assert.equal((await out(env, ctx, { q: '26-PURPSNOW-2' })).state, 'out');
  await settle();
  assert.equal(adjusts(calls).length, 0);
});

test('test mode refuses a real sack with zero pool calls', { skip }, async () => {
  const { sqlite, env, ctx, settle, calls } = setup();
  env.HARVEST_TEST_MODE = 'true';
  const r = await out(env, ctx, { q: '26-PURPSNOW-2' }); await settle();
  assert.equal(r.success, false);
  assert.equal(r.state, 'refused');
  assert.equal(row(sqlite).opened_at, null);
  assert.equal(calls.length, 0);
});

test('pool HTML error page: sack still out and the debt shows in the sweep list; sweep settles it', { skip }, async () => {
  const { sqlite, env, ctx, settle } = setup('html');
  await out(env, ctx, { q: '26-PURPSNOW-2' }); await settle();
  assert.ok(row(sqlite).opened_at);
  assert.ok(row(sqlite).shopify_sync_error);
  const listed = await sweep(env, ctx);
  assert.match(JSON.stringify(listed), /26-PURPSNOW-2/);
  poolStub('ok');
  await sweep(env, ctx, '&apply=1'); await settle();
  assert.ok(row(sqlite).shopify_synced_at);
  assert.equal(row(sqlite).shopify_sync_error, null);
});

test('pool never answers: the in-flight marker is on the row before the call', { skip }, async () => {
  const { sqlite, env, ctx } = setup();
  globalThis.fetch = () => new Promise(() => {});
  await out(env, ctx, { q: '26-PURPSNOW-2' });
  await new Promise(r => setTimeout(r, 10));
  assert.match(row(sqlite).shopify_sync_error, /^in flight since /);
});

test('undo after a counted subtract adds exactly one back', { skip }, async () => {
  const { sqlite, env, ctx, settle, calls } = setup();
  await out(env, ctx, { q: '26-PURPSNOW-2' }); await settle();
  const u = await post(env, ctx, 'sack_out_undo', { sack_id: '26-PURPSNOW-2' }); await settle();
  assert.equal(u.state, 'undone');
  assert.equal(row(sqlite).opened_at, null);
  assert.equal(row(sqlite).shopify_sync_error, null);
  assert.equal(adjusts(calls).length, 2);
});

test('undo after a failed subtract makes no pool call', { skip }, async () => {
  const { env, ctx, settle, calls } = setup('html');
  await out(env, ctx, { q: '26-PURPSNOW-2' }); await settle();
  const before = calls.length;
  await post(env, ctx, 'sack_out_undo', { sack_id: '26-PURPSNOW-2' }); await settle();
  assert.equal(calls.length, before);
});

test('undo while the subtract is in flight: no add back, row left flagged', { skip }, async () => {
  const { sqlite, env, ctx, calls } = setup();
  globalThis.fetch = (u, i) => { calls.push(JSON.parse(i.body)); return new Promise(() => {}); };
  await out(env, ctx, { q: '26-PURPSNOW-2' });
  await new Promise(r => setTimeout(r, 10));
  const n = calls.length;
  await post(env, ctx, 'sack_out_undo', { sack_id: '26-PURPSNOW-2' });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(calls.length, n);
  assert.match(row(sqlite).shopify_sync_error, /check Shopify/);
});

test('undo is too_late once any weight is on the sack', { skip }, async () => {
  for (const col of ['weights_allocated_at', 'smalls_lbs', 'waste_lbs']) {
    const { sqlite, env, ctx, settle } = setup();
    await out(env, ctx, { q: '26-PURPSNOW-2' }); await settle();
    sqlite.exec(`UPDATE harvest_sacks SET ${col} = ${col.endsWith('_at') ? "datetime('now')" : 1}`);
    assert.equal((await post(env, ctx, 'sack_out_undo', { sack_id: '26-PURPSNOW-2' })).state, 'too_late', col);
  }
});

// ---- void x scan-out accounting ----
test('void of a sack that is out is refused with no pool call', { skip }, async () => {
  const { sqlite, env, ctx, settle, calls } = setup();
  await out(env, ctx, { q: '26-PURPSNOW-2' }); await settle();
  await voidTag(env, ctx, '26-PURPSNOW-2'); await settle();
  assert.equal(row(sqlite).voided_at, null);
  assert.equal(adjusts(calls).length, 1);
});

test('void after out+undo whose add-back landed sends one -1 (net zero)', { skip }, async () => {
  const { sqlite, env, ctx, settle, calls } = setup();
  await out(env, ctx, { q: '26-PURPSNOW-2' }); await settle();
  await post(env, ctx, 'sack_out_undo', { sack_id: '26-PURPSNOW-2' }); await settle();
  await voidTag(env, ctx, '26-PURPSNOW-2'); await settle();
  assert.ok(row(sqlite).voided_at);
  assert.equal(adjusts(calls).length, 3);
  assert.equal(row(sqlite).shopify_added_at, null);
});

test('void after out+undo whose add-back failed sends nothing and clears the debt', { skip }, async () => {
  const { sqlite, env, ctx, settle, calls } = setup();
  await out(env, ctx, { q: '26-PURPSNOW-2' }); await settle();
  poolStub('html');
  await post(env, ctx, 'sack_out_undo', { sack_id: '26-PURPSNOW-2' }); await settle();
  assert.match(row(sqlite).shopify_sync_error, /undo add-back failed/);
  assert.match(JSON.stringify(await sweep(env, ctx)), /26-PURPSNOW-2/);
  const c2 = poolStub('ok');
  await voidTag(env, ctx, '26-PURPSNOW-2'); await settle();
  assert.ok(row(sqlite).voided_at);
  assert.equal(adjusts(c2).length, 0);
  assert.equal(row(sqlite).shopify_added_at, null);
  assert.doesNotMatch(JSON.stringify(await sweep(env, ctx)), /26-PURPSNOW-2/);
});

test('sack_out_today: Pacific day, by_strain per cut', { skip }, async () => {
  const { sqlite, env, ctx, settle } = setup();
  await out(env, ctx, { q: '26-PURPSNOW-2' }); await settle();
  // 23:00 Pacific (PDT) on 2026-10-05 is 06:00 UTC on 10-06.
  sqlite.exec(`UPDATE harvest_sacks SET opened_at = '2026-10-06 06:00:00'`);
  const d5 = await get(env, ctx, 'action=sack_out_today&date=2026-10-05');
  assert.equal(d5.total, 1);
  assert.equal(d5.by_strain[0].cut_number, 1);
  assert.equal((await get(env, ctx, 'action=sack_out_today&date=2026-10-06')).total, 0);
});

// ── Helpers cut off when this file was sliced from harvest-inventory-honesty ──
function voidTag(env, ctx, sackId) {
  return quiet(() => handleHarvestD1(new Request(
    'https://x/api/harvest?action=sack_void',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sack_id: sackId }) },
  ), env, ctx)).then(r => r.json()).catch(e => ({ success: false, error: e.message }));
}
function sweep(env, ctx, qs = '') {
  return quiet(() => handleHarvestD1(new Request(
    `https://x/api/harvest?action=inventory_sweep${qs}`,
    { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'test-password' }, body: '{}' },
  ), env, ctx)).then(r => r.json());
}
/** The sweep's entry for one sack, or null when it owes nothing. */
async function debtOf(env, ctx, id = '26-PURPSNOW-2') {
  const j = await sweep(env, ctx);
  let hit = null;
  const walk = (v) => {
    if (hit || !v || typeof v !== 'object') return;
    if (!Array.isArray(v) && v.sack_id === id && 'owes' in v) { hit = v; return; }
    Object.values(v).forEach(walk);
  };
  walk(j);
  return hit;
}
const takeOut = (env, ctx, sqlite, by = 'scan') => quiet(() => takeSackOut(env.DB, env, ctx, row(sqlite), { by }));
/** Out (counted), then an undo whose +1 back never answers. */
async function undoInFlight(h) {
  await out(h.env, h.ctx, { q: '26-PURPSNOW-2' }); await h.settle();
  const calls = [];
  globalThis.fetch = (u, i) => { calls.push(JSON.parse(i.body)); return new Promise(() => {}); };
  await post(h.env, h.ctx, 'sack_out_undo', { sack_id: '26-PURPSNOW-2' });
  await new Promise(r => setTimeout(r, 10));
  return calls;
}
const { takeSackOut } = await import(
  join(REPO, 'workers/src/handlers/harvest-d1.js').replace(/\\/g, '/').replace(/^/, 'file:///')
);

test('scan while an undo add-back is in flight is busy: nothing written, no pool call', { skip }, async () => {
  const h = setup();
  const calls = await undoInFlight(h);
  assert.equal(adjusts(calls).length, 1);
  assert.match(row(h.sqlite).shopify_sync_error, /^in flight since .*\(undo out\)/);
  assert.equal(await takeOut(h.env, h.ctx, h.sqlite), 'busy');
  assert.equal(row(h.sqlite).opened_at, null);
  assert.equal(adjusts(calls).length, 1);
});

test('rescan after a failed add-back sends nothing and clears the debt', { skip }, async () => {
  const h = setup();
  await out(h.env, h.ctx, { q: '26-PURPSNOW-2' }); await h.settle();
  poolStub('html');
  await post(h.env, h.ctx, 'sack_out_undo', { sack_id: '26-PURPSNOW-2' }); await h.settle();
  assert.match(row(h.sqlite).shopify_sync_error, /^undo add-back failed/);
  const c = poolStub('ok');
  assert.equal(await takeOut(h.env, h.ctx, h.sqlite), 'out'); await h.settle();
  assert.equal(adjusts(c).length, 0);
  assert.ok(row(h.sqlite).opened_at);
  assert.ok(row(h.sqlite).shopify_synced_at);
  assert.equal(row(h.sqlite).shopify_sync_error, null);
  assert.equal(await debtOf(h.env, h.ctx), null);
});

test('rescan after "undone; check Shopify" sends nothing and stays listed unknown', { skip }, async () => {
  const h = setup();
  const calls = [];
  globalThis.fetch = (u, i) => { calls.push(JSON.parse(i.body)); return new Promise(() => {}); };
  await out(h.env, h.ctx, { q: '26-PURPSNOW-2' });
  await new Promise(r => setTimeout(r, 10));
  await post(h.env, h.ctx, 'sack_out_undo', { sack_id: '26-PURPSNOW-2' });
  await new Promise(r => setTimeout(r, 10));
  assert.match(row(h.sqlite).shopify_sync_error, /undone; check Shopify/);
  const c = poolStub('ok');
  assert.equal(await takeOut(h.env, h.ctx, h.sqlite), 'out');
  assert.equal(adjusts(c).length, 0);
  assert.ok(row(h.sqlite).opened_at);
  assert.match(row(h.sqlite).shopify_sync_error, /out again; check Shopify/);
  const d = await debtOf(h.env, h.ctx);
  assert.equal(d.state, 'unknown');
  await sweep(h.env, h.ctx, '&apply=1');
  assert.equal(adjusts(c).length, 0);
});

test('failed add on a sack that is out is no debt; sweep sends nothing; undo brings it back', { skip }, async () => {
  const h = setup();
  h.sqlite.exec(`UPDATE harvest_sacks SET shopify_added_at = NULL, shopify_add_error = 'HTML error page'`);
  assert.equal((await debtOf(h.env, h.ctx)).owes, 1);
  const c = poolStub('ok');
  assert.equal(await takeOut(h.env, h.ctx, h.sqlite), 'out'); await h.settle();
  assert.equal(adjusts(c).length, 0);
  assert.equal(await debtOf(h.env, h.ctx), null);
  await sweep(h.env, h.ctx, '&apply=1&force=1'); await h.settle();
  assert.equal(adjusts(c).length, 0);
  await post(h.env, h.ctx, 'sack_out_undo', { sack_id: '26-PURPSNOW-2' }); await h.settle();
  assert.equal(adjusts(c).length, 0);
  assert.equal(row(h.sqlite).opened_at, null);
  const d = await debtOf(h.env, h.ctx);
  assert.equal(d.owes, 1);
  assert.equal(d.state, 'failed');
});

test('in-flight add on a sack that is out: listed unknown, owes 0, never swept even forced', { skip }, async () => {
  const h = setup();
  h.sqlite.exec(`UPDATE harvest_sacks SET shopify_added_at = NULL, shopify_add_error = 'in flight since 2026-09-21T21:26:45.082Z (add)'`);
  const c = poolStub('ok');
  assert.equal(await takeOut(h.env, h.ctx, h.sqlite), 'out'); await h.settle();
  assert.equal(adjusts(c).length, 0);
  const d = await debtOf(h.env, h.ctx);
  assert.equal(d.owes, 0);
  assert.equal(d.state, 'unknown');
  assert.match(d.error, /sack is out.*Shopify is one high/);
  await sweep(h.env, h.ctx, '&apply=1&force=1'); await h.settle();
  assert.equal(adjusts(c).length, 0);
  assert.equal(row(h.sqlite).shopify_added_at, null);
});

test('sack_open page button: out by page, one -1; a second press sends no second -1', { skip }, async () => {
  const h = setup();
  const form = () => quiet(() => handleHarvestD1(new Request('https://x/api/harvest?action=sack_open&lang=en', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sack_id: '26-PURPSNOW-2' }).toString(),
  }), h.env, h.ctx)).then(async r => ({ status: r.status, html: await r.text() }));
  const first = await form(); await h.settle();
  assert.equal(first.status, 200);
  assert.ok(row(h.sqlite).opened_at);
  assert.equal(row(h.sqlite).out_by, 'page');
  assert.equal(adjusts(h.calls).length, 1);
  const second = await form(); await h.settle();
  assert.match(second.html, /already open/);
  assert.equal(adjusts(h.calls).length, 1);
});

test('void while an undo add-back is in flight is refused with no pool call', { skip }, async () => {
  const h = setup();
  const calls = await undoInFlight(h);
  const n = calls.length;
  await voidTag(h.env, h.ctx, '26-PURPSNOW-2');
  await new Promise(r => setTimeout(r, 10));
  assert.equal(row(h.sqlite).voided_at, null);
  assert.equal(calls.length, n);
});
