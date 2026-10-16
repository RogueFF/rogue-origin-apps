/**
 * Cerrar día on /salida — /api/supersack?action=close_day_preview | close_day.
 * Design: docs/plans/2026-10-16-salida-close-day-design.md.
 *
 * The only end-of-day numbers typed are Biomass #2 and Premium #1. Sacks come
 * from the day's scans, tops and smalls from the hourly log
 * (monthly_production), and the two weights are split across cultivars by
 * sacks scanned. Driven through the real router over in-memory SQLite.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = (p) => 'file:///' + join(REPO, p).replace(/\\/g, '/');
const { handleSupersackD1 } = await import(url('workers/src/handlers/supersack-d1.js'));

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node < 22.5 */ }
const skip = !DatabaseSync && 'node:sqlite unavailable';

const DAY = '2026-10-20'; // PDT, UTC-7
const HOURLY_SL = '2026 - Sour Lifter / Sungrown';   // the hourly log is cut-less
const HOURLY_LF = '2026 - Lifter / Sungrown';
const ROW_SL1 = '2026 - Sour Lifter / Sungrown / 1st Cut';
const ROW_SL2 = '2026 - Sour Lifter / Sungrown / 2nd Cut';
const ROW_LF1 = '2026 - Lifter / Sungrown / 1st Cut';

const MIGRATIONS = [
  '0009-harvest-scan-log.sql', '0010-harvest-sacks.sql', '0011-harvest-sacks-void.sql',
  '0012-harvest-scan-log-cultivar.sql', '0013-harvest-crew-roster.sql',
  '0014-harvest-sack-notes.sql', '0015-harvest-sacks-per-cultivar-serial.sql',
  '0016-harvest-sacks-sku.sql', '0017-harvest-sacks-shopify-sync.sql',
  '0018-harvest-sacks-shopify-add.sql', '0019-harvest-sacks-weight-source.sql',
  '0027-harvest-sacks-all-parts.sql', '0028-harvest-sacks-bay.sql', '0029-harvest-crew-tag.sql',
  '0030-harvest-load-bay.sql', '0040-harvest-load-trailer.sql', '0031-harvest-sacks-storage.sql',
  '0034-harvest-lot-takedown-done.sql', '0035-harvest-sacks-serial-per-cut.sql',
  '0036-harvest-sack-notes-edit.sql', '0037-harvest-settings.sql', '0038-harvest-print-queue.sql',
  '0041-harvest-sacks-fill-lbs.sql', '0045-harvest-sacks-scan-out.sql',
];

function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) {
    const sql = readFileSync(join(REPO, 'workers/migrations', f), 'utf8')
      .split(/\r?\n/).map(l => l.replace(/--.*$/, '')).join('\n');
    for (const st of sql.split(';')) { const t = st.trim(); if (t) sqlite.exec(t); }
  }
  sqlite.exec(`CREATE TABLE supersack_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, strain TEXT NOT NULL,
    sacks_opened INTEGER NOT NULL DEFAULT 0, tops_lbs REAL NOT NULL DEFAULT 0,
    smalls_lbs REAL NOT NULL DEFAULT 0, biomass_lbs REAL NOT NULL DEFAULT 0,
    trim_lbs REAL NOT NULL DEFAULT 0, waste_lbs REAL NOT NULL DEFAULT 0,
    raw_lbs REAL NOT NULL DEFAULT 0, created_at TEXT, updated_at TEXT, UNIQUE(date, strain))`);
  sqlite.exec(`CREATE TABLE monthly_production (
    id INTEGER PRIMARY KEY AUTOINCREMENT, production_date TEXT NOT NULL, time_slot TEXT NOT NULL,
    trimmers_line1 INTEGER DEFAULT 0, trimmers_line2 INTEGER DEFAULT 0,
    cultivar1 TEXT, cultivar2 TEXT, tops_lbs1 REAL DEFAULT 0, smalls_lbs1 REAL DEFAULT 0,
    tops_lbs2 REAL DEFAULT 0, smalls_lbs2 REAL DEFAULT 0,
    effective_trimmers_line1 REAL, effective_trimmers_line2 REAL, UNIQUE(production_date, time_slot))`);
  sqlite.exec('CREATE TABLE cultivars (id INTEGER PRIMARY KEY, name TEXT)');
  sqlite.exec('CREATE TABLE cultivar_aliases (alias TEXT, cultivar_id INTEGER, crop_year INTEGER)');
  sqlite.exec('CREATE TABLE orders (id TEXT PRIMARY KEY, nickname TEXT)');
  sqlite.exec("INSERT INTO cultivars (id, name) VALUES (1, 'Sour Lifter'), (2, 'Lifter')");
  sqlite.prepare('INSERT INTO cultivar_aliases VALUES (?, 1, 2026)').run(HOURLY_SL);
  sqlite.prepare('INSERT INTO cultivar_aliases VALUES (?, 2, 2026)').run(HOURLY_LF);
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
  return { sqlite, env: { DB, HARVEST_TEST_MODE: 'true' } };
}

let serial = 0;
function sack(sqlite, o = {}) {
  serial++;
  const r = {
    sack_id: `T-${serial}`, season: 2026, serial, zone: 'Z4', cultivar: 'Sour Lifter', cut_number: 1,
    opened_at: `${DAY} 17:00:00`, is_test: 1, voided_at: null, shopify_variant_id: 'V1',
    fill_lbs: null, out_order_id: null, weights_source: null, tops_lbs: null, ...o,
  };
  const cols = Object.keys(r);
  sqlite.prepare(`INSERT INTO harvest_sacks (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map(c => r[c]));
  return r.sack_id;
}

function hour(sqlite, { slot, c1 = HOURLY_SL, tops1 = 0, smalls1 = 0, c2 = null, tops2 = 0, smalls2 = 0, day = DAY }) {
  sqlite.prepare(`INSERT INTO monthly_production
    (production_date, time_slot, trimmers_line1, cultivar1, tops_lbs1, smalls_lbs1, cultivar2, tops_lbs2, smalls_lbs2)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(day, slot, 10, c1, tops1, smalls1, c2, tops2, smalls2);
}

async function preview(env, date = DAY) {
  const req = new Request(`https://x/api/supersack?action=close_day_preview&date=${date}`);
  const res = await handleSupersackD1(req, env, { waitUntil() {} });
  return { status: res.status, body: await res.json() };
}
async function close(env, body, method = 'POST') {
  const req = new Request(`https://x/api/supersack?action=close_day`, {
    method, body: method === 'POST' ? JSON.stringify({ date: DAY, ...body }) : undefined,
    headers: { 'Content-Type': 'text/plain' },
  });
  const res = await handleSupersackD1(req, env, { waitUntil() {} });
  return { status: res.status, body: await res.json() };
}
const rows = (sqlite) => sqlite.prepare('SELECT * FROM supersack_entries WHERE date = ? ORDER BY strain').all(DAY);

test('preview: sacks from the scans, tops and smalls from the hourly log, hours counted', { skip }, async () => {
  const { sqlite, env } = freshDb();
  sack(sqlite); sack(sqlite); sack(sqlite);
  sack(sqlite, { voided_at: `${DAY} 18:00:00` });
  sack(sqlite, { opened_at: '2026-10-21 17:00:00' });
  hour(sqlite, { slot: '7:00 AM – 8:00 AM', tops1: 14.2, smalls1: 11 });
  hour(sqlite, { slot: '8:00 AM – 9:00 AM', tops1: 18.2, smalls1: 11 });
  const r = await preview(env);
  assert.equal(r.status, 200);
  assert.equal(r.body.date, DAY);
  assert.equal(r.body.hours_logged, 2);
  assert.equal(r.body.groups.length, 1);
  const g = r.body.groups[0];
  assert.equal(g.sacks, 3);
  assert.equal(g.title, ROW_SL1);
  assert.equal(g.cultivar, 'Sour Lifter');
  assert.equal(g.cut_number, 1);
  assert.equal(g.tops, 32.4);
  assert.equal(g.smalls, 22);
  assert.equal(g.alias_missing, false);
  assert.equal(r.body.existing, null);
});

test('preview: no 2026 scans that day means nothing to close', { skip }, async () => {
  const { sqlite, env } = freshDb();
  hour(sqlite, { slot: '7:00 AM – 8:00 AM', tops1: 14.2 });
  const r = await preview(env);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.groups, []);
});

test('preview: a scanned cultivar with no alias row shows 0 tops and says so', { skip }, async () => {
  const { sqlite, env } = freshDb();
  sack(sqlite, { cultivar: 'Lifter' });
  hour(sqlite, { slot: '7:00 AM – 8:00 AM', c1: '2026 - Lifter / Sungrown / 1st Cut', tops1: 9 });
  sqlite.exec("DELETE FROM cultivar_aliases WHERE cultivar_id = 2");
  const r = await preview(env);
  assert.equal(r.body.groups[0].tops, 0);
  assert.equal(r.body.groups[0].alias_missing, true);
});

test('preview: two cuts of one cultivar — the pounds sit on the first cut', { skip }, async () => {
  const { sqlite, env } = freshDb();
  sack(sqlite); sack(sqlite, { cut_number: 2, shopify_variant_id: 'V2' });
  hour(sqlite, { slot: '7:00 AM – 8:00 AM', tops1: 20, smalls1: 5 });
  const r = await preview(env);
  const [c1, c2] = r.body.groups;
  assert.equal(c1.cut_number, 1); assert.equal(c1.tops, 20); assert.equal(c1.pounds_on, null);
  assert.equal(c2.cut_number, 2); assert.equal(c2.tops, 0); assert.equal(c2.pounds_on, ROW_SL1);
});

test('preview: line 2 pounds count too, and a 2025 strain on the sheet is not credited to a 2026 sack', { skip }, async () => {
  const { sqlite, env } = freshDb();
  sack(sqlite);
  sqlite.prepare('INSERT INTO cultivar_aliases VALUES (?, 1, 2025)').run('2025 - Sour Lifter / Sungrown');
  hour(sqlite, { slot: '7:00 AM – 8:00 AM', c1: '2025 - Sour Lifter / Sungrown', tops1: 50, c2: HOURLY_SL, tops2: 7, smalls2: 3 });
  const r = await preview(env);
  assert.equal(r.body.groups[0].tops, 7);
  assert.equal(r.body.groups[0].smalls, 3);
});

test('close_day: writes one row per scanned group, no Shopify call, and returns the yield', { skip }, async () => {
  const { sqlite, env } = freshDb();
  let fetched = 0; globalThis.fetch = async () => { fetched++; return Response.json({ ok: true }); };
  for (let i = 0; i < 22; i++) sack(sqlite);
  hour(sqlite, { slot: '7:00 AM – 8:00 AM', tops1: 60, smalls1: 50 });
  hour(sqlite, { slot: '8:00 AM – 9:00 AM', tops1: 63, smalls1: 60 });
  const r = await close(env, { biomass_lbs: 330, trim_lbs: 50 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(fetched, 0);
  const w = rows(sqlite);
  assert.equal(w.length, 1);
  assert.equal(w[0].strain, ROW_SL1);
  assert.equal(w[0].sacks_opened, 22);
  assert.equal(w[0].tops_lbs, 123);
  assert.equal(w[0].smalls_lbs, 110);
  assert.equal(w[0].biomass_lbs, 330);
  assert.equal(w[0].trim_lbs, 50);
  assert.equal(w[0].raw_lbs, 22 * 35);
  assert.equal(w[0].waste_lbs, 22 * 35 - 123 - 110 - 330 - 50);
  assert.equal(r.body.rows.length, 1);
  assert.equal(r.body.yield.groups.length, 1);
  assert.equal(r.body.yield.groups[0].sacks, 22);
  assert.equal(r.body.yield.groups[0].biomass, 330);
  // Every scanned sack got its share.
  const n = sqlite.prepare("SELECT COUNT(*) AS n FROM harvest_sacks WHERE weights_source = 'allocated'").get().n;
  assert.equal(n, 22);
});

test('close_day: two cultivars share the pile by sacks scanned', { skip }, async () => {
  const { sqlite, env } = freshDb();
  for (let i = 0; i < 15; i++) sack(sqlite);
  for (let i = 0; i < 5; i++) sack(sqlite, { cultivar: 'Lifter', shopify_variant_id: 'V3' });
  hour(sqlite, { slot: '7:00 AM – 8:00 AM', tops1: 40, c2: HOURLY_LF, tops2: 10 });
  const r = await close(env, { biomass_lbs: 200, trim_lbs: 40 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const w = rows(sqlite);
  const lf = w.find(x => x.strain === ROW_LF1), sl = w.find(x => x.strain === ROW_SL1);
  assert.equal(sl.biomass_lbs, 150); assert.equal(sl.trim_lbs, 30); assert.equal(sl.tops_lbs, 40);
  assert.equal(lf.biomass_lbs, 50); assert.equal(lf.trim_lbs, 10); assert.equal(lf.tops_lbs, 10);
});

test('close_day: two cuts — pounds on the first cut, weights split by sacks', { skip }, async () => {
  const { sqlite, env } = freshDb();
  for (let i = 0; i < 3; i++) sack(sqlite);
  sack(sqlite, { cut_number: 2, shopify_variant_id: 'V2' });
  hour(sqlite, { slot: '7:00 AM – 8:00 AM', tops1: 20 });
  const r = await close(env, { biomass_lbs: 40, trim_lbs: 8 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const w = rows(sqlite);
  const c1 = w.find(x => x.strain === ROW_SL1), c2 = w.find(x => x.strain === ROW_SL2);
  assert.equal(c1.tops_lbs, 20); assert.equal(c1.biomass_lbs, 30); assert.equal(c1.trim_lbs, 6);
  assert.equal(c2.tops_lbs, 0); assert.equal(c2.biomass_lbs, 10); assert.equal(c2.trim_lbs, 2);
});

test('close_day: refused with no 2026 scans, when premium outweighs biomass, on bad numbers, and on GET', { skip }, async () => {
  const { sqlite, env } = freshDb();
  let r = await close(env, { biomass_lbs: 10, trim_lbs: 1 });
  assert.equal(r.status, 400); assert.match(r.body.error, /no sacks scanned/i);
  sack(sqlite);
  r = await close(env, { biomass_lbs: 10, trim_lbs: 11 });
  assert.equal(r.status, 400); assert.match(r.body.error, /which box is which/i);
  r = await close(env, { biomass_lbs: -1, trim_lbs: 0 });
  assert.equal(r.status, 400);
  r = await close(env, { biomass_lbs: 'x', trim_lbs: 0 });
  assert.equal(r.status, 400);
  r = await close(env, {}, 'GET');
  assert.equal(r.status, 405);
  assert.equal(rows(sqlite).length, 0);
});

test('close_day: a second close overwrites the same rows and the preview shows the saved weights', { skip }, async () => {
  const { sqlite, env } = freshDb();
  globalThis.fetch = async () => Response.json({ ok: true });
  sack(sqlite); sack(sqlite);
  hour(sqlite, { slot: '7:00 AM – 8:00 AM', tops1: 10 });
  assert.equal((await close(env, { biomass_lbs: 30, trim_lbs: 5 })).status, 200);
  hour(sqlite, { slot: '3:00 PM – 4:00 PM', tops1: 4 });     // the last hour, logged after the weigh
  const r = await close(env, { biomass_lbs: 32, trim_lbs: 5 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const w = rows(sqlite);
  assert.equal(w.length, 1);
  assert.equal(w[0].biomass_lbs, 32);
  assert.equal(w[0].tops_lbs, 14);
  const p = await preview(env);
  assert.deepEqual(p.body.existing, { biomass_lbs: 32, trim_lbs: 5 });
});

// ---- the Shopify pools: the form added the day's biomass and trim to two pool
// products in grams, so the close must too, as a delta on a re-close ----

const BIO_ID = 'gid://shopify/Product/7672248008896', TRIM_ID = 'gid://shopify/Product/7649698578624';
function poolStub(mode = 'ok') {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    if (body.action === 'list_products') {
      return new Response(JSON.stringify({ products: [
        { id: 'gid://shopify/Product/1', title: 'Lifter Smalls' },
        { id: BIO_ID, title: 'CBD Biomass (Trim)' }, { id: TRIM_ID, title: 'Premium CBD Flower Trim' }] }));
    }
    if (mode === 'refuse') return new Response(JSON.stringify({ error: 'pool locked' }));
    return new Response(JSON.stringify({ success: true }));
  };
  return calls;
}
const poolEnv = (env) => ({ ...env, POOL_INVENTORY_API_URL: 'https://pool.test/exec', POOL_INVENTORY_API_KEY: 'k' });
const updates = (calls) => calls.filter(c => c.action === 'update_pool').map(c => [c.productId, c.operation, c.amount, c.poolType, c.note]);

test('close_day: adds biomass and trim to their Shopify pools in grams, with the key and a note', { skip }, async () => {
  const { sqlite, env } = freshDb();
  const calls = poolStub();
  sack(sqlite); hour(sqlite, { slot: '7:00 AM – 8:00 AM', tops1: 5 });
  const r = await close(poolEnv(env), { biomass_lbs: 330, trim_lbs: 50 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.pool_errors, []);
  assert.ok(calls.every(c => c.apiKey === 'k'));
  assert.deepEqual(updates(calls), [
    [BIO_ID, 'add', 149685.4, 'trim', `[Salida] Biomass +330 lbs (${DAY})`],
    [TRIM_ID, 'add', 22679.6, 'trim', `[Salida] Trim +50 lbs (${DAY})`],
  ]);
});

test('close_day: a re-close moves the pools by the difference only, in either direction', { skip }, async () => {
  const { sqlite, env } = freshDb();
  let calls = poolStub();
  sack(sqlite); hour(sqlite, { slot: '7:00 AM – 8:00 AM', tops1: 5 });
  assert.equal((await close(poolEnv(env), { biomass_lbs: 330, trim_lbs: 50 })).status, 200);
  calls = poolStub();
  const r = await close(poolEnv(env), { biomass_lbs: 332, trim_lbs: 45 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(updates(calls), [
    [BIO_ID, 'add', 907.2, 'trim', `[Salida] Biomass +2 lbs (${DAY})`],
    [TRIM_ID, 'subtract', 2268, 'trim', `[Salida] Trim -5 lbs (${DAY})`],
  ]);
  calls = poolStub();
  assert.equal((await close(poolEnv(env), { biomass_lbs: 332, trim_lbs: 45 })).status, 200);
  assert.deepEqual(updates(calls), [], 'nothing changed, nothing sent');
});

test('close_day: the save stands when the pool refuses or is not configured; the response says so', { skip }, async () => {
  const { sqlite, env } = freshDb();
  poolStub('refuse');
  sack(sqlite); hour(sqlite, { slot: '7:00 AM – 8:00 AM', tops1: 5 });
  let r = await close(poolEnv(env), { biomass_lbs: 330, trim_lbs: 50 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(rows(sqlite)[0].biomass_lbs, 330);
  assert.equal(r.body.pool_errors.length, 2);
  assert.match(r.body.pool_errors[0], /pool locked/);
  const { sqlite: s2, env: e2 } = freshDb();
  globalThis.fetch = async () => { throw new Error('must not be called'); };
  sack(s2); hour(s2, { slot: '7:00 AM – 8:00 AM', tops1: 5 });
  r = await close(e2, { biomass_lbs: 330, trim_lbs: 50 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.pool_errors, ['pool not configured']);
});
