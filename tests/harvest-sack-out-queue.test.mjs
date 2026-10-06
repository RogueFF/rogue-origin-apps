// Sack scan-out against the REAL production queue (computeQueue from wholesale-d1.js),
// on a complete schema: workers/schema.sql + every migration, in filename order.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = (p) => join(REPO, p).replace(/\\/g, '/').replace(/^/, 'file:///');

const { DatabaseSync } = await import('node:sqlite');
const { handleHarvestD1 } = await import(url('workers/src/handlers/harvest-d1.js'));
const { computeQueue } = await import(url('workers/src/handlers/wholesale-d1.js'));

const SEASON = new Date().getUTCFullYear();
const YY = String(SEASON).slice(2);
const VARIANT = 'gid://shopify/ProductVariant/1';

// Pool API stub: answers OK so the background inventory sync never reaches the network.
globalThis.fetch = async (_u, init) => {
  const body = JSON.parse(init?.body || '{}');
  if (body.action === 'get_supersack_variants') return Response.json({ variants: [] });
  return Response.json({ ok: true });
};

function splitSql(text) {
  return text.split(/\r?\n/).map(l => l.replace(/--.*$/, '')).join('\n')
    .split(';').map(s => s.trim()).filter(Boolean);
}

/** One full schema, built once and cloned per test via serialize-free re-exec of the dump. */
function buildSchemaSqlite() {
  const sqlite = new DatabaseSync(':memory:');
  const files = [join(REPO, 'workers/schema.sql'),
    ...readdirSync(join(REPO, 'workers/migrations')).filter(f => f.endsWith('.sql')).sort()
      .map(f => join(REPO, 'workers/migrations', f))];
  for (const f of files) {
    for (const stmt of splitSql(readFileSync(f, 'utf8'))) {
      try { sqlite.exec(stmt); } catch { /* duplicate column, already exists, etc. */ }
    }
  }
  return sqlite;
}

let counter = { n: 0 };
function wrap(sqlite) {
  const exec = (sql, args, kind) => {
    const st = sqlite.prepare(sql);
    if (kind === 'all') return { results: st.all(...args) };
    if (kind === 'first') return st.get(...args) ?? null;
    const r = st.run(...args);
    return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
  };
  const stmt = (sql, args) => ({
    all: async () => exec(sql, args, 'all'),
    first: async () => exec(sql, args, 'first'),
    run: async () => exec(sql, args, 'run'),
  });
  return {
    async batch(stmts) { return Promise.all(stmts.map(st => st.run())); },
    prepare(sql) {
      counter.n++;
      return { ...stmt(sql, []), bind: (...args) => stmt(sql, args) };
    },
  };
}

const quiet = async (fn) => {
  const l = console.log, e = console.error;
  console.log = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = l; console.error = e; }
};

let sqlite, env, ctx, settle, CULT, ALIAS;

function fresh() {
  sqlite = buildSchemaSqlite();
  sqlite.exec('DELETE FROM harvest_sacks; DELETE FROM order_items; DELETE FROM orders; DELETE FROM supersack_entries;');
  const c = sqlite.prepare(`SELECT id, name FROM cultivars WHERE name = 'Sour Lifter'`).get();
  assert.ok(c, 'seeded cultivar Sour Lifter exists');
  CULT = c.id;
  const a = sqlite.prepare(`SELECT alias FROM cultivar_aliases WHERE cultivar_id = ? ORDER BY alias LIMIT 1`).get(CULT);
  ALIAS = a?.alias;
  if (!ALIAS) { ALIAS = 'Sour Lifter'; sqlite.prepare(`INSERT INTO cultivar_aliases (alias, cultivar_id, source) VALUES (?, ?, 'manual')`).run(ALIAS, CULT); }
  // Sack-rate history: 3 sacks gave 150 lb tops from 600 lb raw -> 50 lb tops / sack.
  sqlite.prepare(`INSERT INTO supersack_entries (date, strain, sacks_opened, tops_lbs, raw_lbs)
    VALUES (date('now','-3 days'), ?, 3, 150, 600)`).run(ALIAS);
  sqlite.prepare(`INSERT INTO harvest_scan_log (id, event_type, zone, cultivar, season, cut_number, is_test)
    VALUES (119, 'enter', 'Z16', 'Sour Lifter', ?, 1, 0)`).run(SEASON);
  const DB = wrap(sqlite);
  env = { DB, HARVEST_TEST_MODE: 'false', ORDERS_PASSWORD: 'test-password',
    POOL_INVENTORY_API_URL: 'https://pool.test/exec', POOL_INVENTORY_API_KEY: 'k' };
  const pending = [];
  ctx = { waitUntil(p) { pending.push(p); } };
  settle = async () => { while (pending.length) await pending.shift().catch(() => {}); };
}

function order(id, { rank, status = 'in_queue', nickname = id, lines = [] }) {
  sqlite.prepare(`INSERT INTO orders (id, nickname, order_date, status, queue_rank, accrual_start, shopify_order_name, created_at, updated_at)
    VALUES (?, ?, date('now','-10 days'), ?, ?, date('now','-10 days'), ?, datetime('now'), datetime('now'))`)
    .run(id, nickname, status, rank, `#${id}`);
  lines.forEach((l, i) => sqlite.prepare(`INSERT INTO order_items (id, order_id, cultivar_id, form, qty_lbs, credited_lbs, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`)
    .run(`${id}-L${i}`, id, l.cultivarId ?? CULT, l.form ?? 'tops', l.qty, l.credited ?? 0, i));
}

let serial = 0;
function sack(cultivar = 'Sour Lifter', code = 'SLIFT') {
  serial++;
  const id = `${YY}-${code}-${serial}`;
  sqlite.prepare(`INSERT INTO harvest_sacks (sack_id, season, serial, zone, cultivar, cut_number, harvest_date, zone_session_id,
      is_test, printed_at, shopify_added_at, shopify_variant_id)
    VALUES (?, ?, ?, 'Z16', ?, 1, date('now'), 119, 0, datetime('now'), '2026-09-21T21:26:45.082Z', ?)`)
    .run(id, SEASON, serial, cultivar, VARIANT);
  return id;
}

const call = async (method, action, body) => {
  const init = method === 'POST'
    ? { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { method };
  const res = await quiet(() => handleHarvestD1(new Request(`https://x/api/harvest?action=${action}`, init), env, ctx));
  const j = await res.json();
  await quiet(settle);
  return j.data && typeof j.data === 'object' && !Array.isArray(j.data) ? { ...j, ...j.data } : j;
};
const scan = (id) => call('POST', 'sack_out', { q: id, by: 'scan' });
const row = (id) => sqlite.prepare(`SELECT out_order_id, out_order_source, opened_at FROM harvest_sacks WHERE sack_id = ?`).get(id);
const pass = (q, orderId) => q.blocks.find(b => b.orderId === orderId)?.passes.find(p => String(p.cultivarId) === String(CULT));

beforeEach(() => { fresh(); });

test('1. computeQueue returns ranked blocks whose passes carry the fields proposeOrder reads', async () => {
  order('A', { rank: 'a0000', lines: [{ qty: 200 }] });
  order('B', { rank: 'a0001', lines: [{ qty: 100 }] });
  const q = await computeQueue(env.DB);
  console.log('[shape]', JSON.stringify({ orderId: q.blocks[0].orderId,
    pass: Object.fromEntries(Object.entries(q.blocks[0].passes[0]).filter(([k]) => /cultivar|remaining|sack|form|qty/i.test(k))) }));
  assert.deepEqual(q.blocks.map(b => b.orderId), ['A', 'B']);
  for (const b of q.blocks) {
    assert.ok('orderId' in b && Array.isArray(b.passes) && b.passes.length);
    for (const p of b.passes) for (const k of ['cultivarId', 'remainingTopsLbs', 'sacksNeeded']) assert.ok(k in p, `pass has ${k}`);
  }
  assert.equal(pass(q, 'A').remainingTopsLbs, 200);
  assert.equal(pass(q, 'A').sacksNeeded, 4); // 200 lb / 50 lb per sack
  assert.equal(pass(q, 'B').sacksNeeded, 2);
});

test('2. two open orders, A ranked first -> A proposed; options A,B with queue sacksNeeded', async () => {
  order('A', { rank: 'a0000', lines: [{ qty: 200 }] });
  order('B', { rank: 'a0001', lines: [{ qty: 100 }] });
  const q = await computeQueue(env.DB);
  const id = sack();
  const r = await scan(id);
  assert.equal(r.state, 'out');
  assert.equal(r.order?.id, 'A');
  assert.equal(r.order.source, 'queue');
  assert.equal(r.order.shopify_order_name, '#A');
  assert.deepEqual(r.order_options.map(o => o.id), ['A', 'B']);
  for (const o of r.order_options) {
    assert.equal(typeof o.sacks_needed, 'number');
    assert.equal(o.sacks_needed, pass(q, o.id).sacksNeeded);
  }
  assert.equal(row(id).out_order_id, 'A');
  assert.equal(row(id).out_order_source, 'queue');
});

test('3. swapped ranks -> B proposed', async () => {
  order('A', { rank: 'a0001', lines: [{ qty: 200 }] });
  order('B', { rank: 'a0000', lines: [{ qty: 100 }] });
  const id = sack();
  const r = await scan(id);
  assert.equal(r.order?.id, 'B');
  assert.deepEqual(r.order_options.map(o => o.id), ['B', 'A']);
  assert.equal(row(id).out_order_id, 'B');
  assert.equal(row(id).out_order_source, 'queue');
});

test('4. A fully credited (remaining tops 0) -> B proposed, A not an option', async () => {
  order('A', { rank: 'a0000', lines: [{ qty: 200, credited: 200 }] });
  order('B', { rank: 'a0001', lines: [{ qty: 100 }] });
  const q = await computeQueue(env.DB);
  const pa = pass(q, 'A');
  assert.ok(!pa || Number(pa.remainingTopsLbs) === 0, `A remaining ${pa?.remainingTopsLbs}`);
  const id = sack();
  const r = await scan(id);
  assert.equal(r.order?.id, 'B');
  assert.deepEqual(r.order_options.map(o => o.id), ['B']);
  assert.equal(row(id).out_order_id, 'B');
  assert.equal(row(id).out_order_source, 'queue');
});

test('5. a smalls-only order: observed behaviour', async () => {
  order('S', { rank: 'a0000', lines: [{ qty: 100, form: 'smalls' }] });
  const q = await computeQueue(env.DB);
  const ps = pass(q, 'S');
  console.log('[smalls]', JSON.stringify(ps ? { remainingTopsLbs: ps.remainingTopsLbs, sacksNeeded: ps.sacksNeeded } : 'no pass'));
  const id = sack();
  const r = await scan(id);
  // Observed: the smalls line yields a pass with remainingTopsLbs 0 and sacksNeeded 0,
  // so a smalls-only order is never proposed: the sack goes out as stock.
  assert.equal(ps.remainingTopsLbs, 0);
  assert.equal(ps.sacksNeeded, 0);
  assert.equal(r.order, null);
  assert.deepEqual(r.order_options, []);
  assert.equal(row(id).out_order_id, null);
  assert.equal(row(id).out_order_source, null);
});

test('6. finished orders are never proposed nor offered (orders.status CHECK allows no draft)', () => {
  assert.throws(() => order('D', { rank: 'a0001', status: 'draft', lines: [{ qty: 200 }] }), /CHECK constraint/);
});

test('6b. a finished order ranked first is skipped for the open one', async () => {
  order('F', { rank: 'a0000', status: 'finished', lines: [{ qty: 200 }] });
  order('B', { rank: 'a0002', lines: [{ qty: 100 }] });
  const id = sack();
  const r = await scan(id);
  assert.equal(r.order?.id, 'B');
  assert.deepEqual(r.order_options.map(o => o.id), ['B']);
  assert.equal(row(id).out_order_id, 'B');
  assert.equal(row(id).out_order_source, 'queue');
});

// EXPOSES BUG: workers/src/lib/sack-out.js proposeOrder (lines 39 and 42) coerces cultivar ids
// with Number(), but cultivar ids are TEXT slugs ('sour-lifter'). Every id becomes NaN, and
// Set.has(NaN) is true for any NaN, so the first open order for ANY cultivar is proposed.
test('7. no open order wants the cultivar -> stock', async () => {
  const other = sqlite.prepare(`SELECT id FROM cultivars WHERE id <> ? ORDER BY id LIMIT 1`).get(CULT).id;
  order('O', { rank: 'a0000', lines: [{ qty: 100, cultivarId: other }] });
  const id = sack();
  const r = await scan(id);
  assert.equal(r.state, 'out');
  assert.equal(r.order, null);
  assert.deepEqual(r.order_options, []);
  assert.equal(row(id).out_order_id, null);
  assert.equal(row(id).out_order_source, null);
  assert.ok(row(id).opened_at);
});

// EXPOSES BUG: same NaN coercion in workers/src/lib/sack-out.js proposeOrder — an order for a
// DIFFERENT cultivar ranked first is proposed (and offered) ahead of the Sour Lifter order.
test('7b. an order for another cultivar ranked first is not proposed for a Sour Lifter sack', async () => {
  const other = sqlite.prepare(`SELECT id FROM cultivars WHERE id <> ? ORDER BY id LIMIT 1`).get(CULT).id;
  order('O', { rank: 'a0000', lines: [{ qty: 100, cultivarId: other }] });
  order('A', { rank: 'a0001', lines: [{ qty: 200 }] });
  const id = sack();
  const r = await scan(id);
  assert.equal(r.order?.id, 'A');
  assert.deepEqual(r.order_options.map(o => o.id), ['A']);
  assert.equal(row(id).out_order_id, 'A');
  assert.equal(row(id).out_order_source, 'queue');
});

test('8. cultivar matched through an alias, and through a different case', async () => {
  order('A', { rank: 'a0000', lines: [{ qty: 200 }] });
  sqlite.prepare(`INSERT INTO cultivar_aliases (alias, cultivar_id, source) VALUES ('SL Test Alias', ?, 'manual')`).run(CULT);
  for (const name of ['sl test alias', 'SOUR LIFTER']) {
    const id = sack(name);
    const r = await scan(id);
    assert.equal(r.order?.id, 'A', name);
    assert.equal(row(id).out_order_id, 'A');
    assert.equal(row(id).out_order_source, 'queue');
  }
});

test('9. unknown cultivar -> out as stock, no throw', async () => {
  order('A', { rank: 'a0000', lines: [{ qty: 200 }] });
  const id = sack('Nonesuch Kush', 'NONE');
  const r = await scan(id);
  assert.equal(r.state, 'out');
  assert.equal(r.order, null);
  assert.deepEqual(r.order_options, []);
  assert.equal(row(id).out_order_id, null);
  assert.equal(row(id).out_order_source, null);
});

test('10. sack_out_today groups two sacks to A and one to stock', async () => {
  order('A', { rank: 'a0000', lines: [{ qty: 200 }] });
  const s1 = sack(), s2 = sack();
  await scan(s1); await scan(s2);
  const s3 = sack('Nonesuch Kush', 'NONE');
  await scan(s3);
  assert.equal(row(s1).out_order_id, 'A'); assert.equal(row(s2).out_order_id, 'A');
  assert.equal(row(s3).out_order_id, null);
  const q = await computeQueue(env.DB);
  const r = await call('GET', 'sack_out_today');
  assert.equal(r.groups.length, 2);
  const ga = r.groups.find(g => g.order?.id === 'A');
  const gs = r.groups.find(g => g.order == null);
  assert.equal(ga.sacks_today, 2);
  assert.equal(ga.sacks_needed, pass(q, 'A').sacksNeeded);
  assert.equal(gs.sacks_today, 1);
  assert.equal(gs.sacks_needed, null);
});

test('11. cost of one proposing scan', async () => {
  order('A', { rank: 'a0000', lines: [{ qty: 200 }] });
  order('B', { rank: 'a0001', lines: [{ qty: 100 }] });
  const id = sack();
  counter.n = 0;
  const t0 = performance.now();
  const r = await scan(id);
  const ms = performance.now() - t0;
  console.log(`[cost] queries=${counter.n} ms=${ms.toFixed(1)}`);
  assert.equal(r.order?.id, 'A');
  assert.equal(row(id).out_order_source, 'queue');
  assert.ok(counter.n < 200, `queries ${counter.n}`);
});
