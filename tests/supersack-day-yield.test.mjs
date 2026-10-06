/**
 * End of day for scanned sacks — /api/supersack?action=scanned_day | day_yield.
 *
 * Driven through the real router (handleSupersackD1) with real Requests, over
 * an in-memory SQLite built from the real migrations. Pins: the Pacific day,
 * void and mode filters, cut-level rows, variant-less sacks surfaced, yield
 * grouped by zone / cut / order, and every gap reported rather than dropped.
 *
 * Run with `node --test`.
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
const T1 = '2026 - Sour Lifter / Sungrown / 1st Cut';
const T2 = '2026 - Sour Lifter / Sungrown / 2nd Cut';

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

function freshDb({ mode = 'true' } = {}) {
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
    raw_lbs REAL NOT NULL DEFAULT 0, UNIQUE(date, strain))`);
  sqlite.exec('CREATE TABLE cultivars (id INTEGER PRIMARY KEY, name TEXT)');
  sqlite.exec('CREATE TABLE cultivar_aliases (alias TEXT, cultivar_id INTEGER)');
  sqlite.exec('CREATE TABLE orders (id TEXT PRIMARY KEY, nickname TEXT)');
  sqlite.exec("INSERT INTO cultivars (id, name) VALUES (1, 'Sour Lifter'), (2, 'Lifter')");
  for (const t of [T1, T2]) sqlite.prepare('INSERT INTO cultivar_aliases VALUES (?, 1)').run(t);
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
  return { sqlite, env: { DB, HARVEST_TEST_MODE: mode } };
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

function floor(sqlite, { day = DAY, strain = T1, sacks, tops, smalls = 0 }) {
  sqlite.prepare(`INSERT INTO supersack_entries (date, strain, sacks_opened, tops_lbs, smalls_lbs, waste_lbs, raw_lbs)
    VALUES (?,?,?,?,?,?,?)`).run(day, strain, sacks, tops, smalls, 0, sacks * 35);
}

async function call(env, action, { date = DAY, method } = {}) {
  const post = method ? method === 'POST' : action === 'day_yield';
  const req = post
    ? new Request(`https://x/api/supersack?action=${action}`, { method: 'POST', body: JSON.stringify({ date }), headers: { 'Content-Type': 'text/plain' } })
    : new Request(`https://x/api/supersack?action=${action}&date=${encodeURIComponent(date)}`, { method: method || 'GET' });
  const res = await handleSupersackD1(req, env, { waitUntil() {} });
  return { status: res.status, body: await res.json() };
}
const total = (rows) => rows.reduce((n, r) => n + r.sacks, 0);

test('scanned_day counts the Pacific day, excludes voided and the other mode', { skip }, async () => {
  const { sqlite, env } = freshDb();
  sack(sqlite);                                              // 10am Pacific
  sack(sqlite, { opened_at: '2026-10-21 06:00:00' });        // 11pm Pacific on the 20th
  sack(sqlite, { opened_at: '2026-10-21 08:00:00' });        // 1am Pacific on the 21st
  sack(sqlite, { opened_at: '2026-10-20 06:30:00' });        // 11:30pm Pacific on the 19th
  sack(sqlite, { voided_at: `${DAY} 18:00:00` });
  sack(sqlite, { is_test: 0 });
  const r = await call(env, 'scanned_day');
  assert.equal(r.status, 200);
  assert.equal(r.body.is_test, true);
  assert.equal(total(r.body.by_strain), 2);
  const next = await call(env, 'scanned_day', { date: '2026-10-21' });
  assert.equal(total(next.body.by_strain), 1);
});

test('live mode shows only real sacks; the DB switch overrides the env var', { skip }, async () => {
  const { sqlite, env } = freshDb({ mode: 'false' });
  sack(sqlite); sack(sqlite, { is_test: 0 }); sack(sqlite, { is_test: 0 });
  assert.equal(total((await call(env, 'scanned_day')).body.by_strain), 2);
  sqlite.exec("INSERT INTO harvest_settings (key, value) VALUES ('test_mode', 'true')");
  const r = await call(env, 'scanned_day');
  assert.equal(r.body.is_test, true);
  assert.equal(total(r.body.by_strain), 1);
});

test('two cuts land on separate rows; a sack with no variant is reported', { skip }, async () => {
  const { sqlite, env } = freshDb();
  sack(sqlite); sack(sqlite);
  sack(sqlite, { cut_number: 2, shopify_variant_id: 'V2' });
  sack(sqlite, { cut_number: 2, shopify_variant_id: null });
  const { body } = await call(env, 'scanned_day');
  const byCut = Object.fromEntries(body.by_strain.map(g => [g.cut_number, g.sacks]));
  assert.deepEqual(byCut, { 1: 2, 2: 2 });
  const titlesFor = (cut) => body.by_strain.find(g => g.cut_number === cut).strain_titles;
  assert.deepEqual(titlesFor(1), [T1]);   // only that cut's title, not the cultivar's
  assert.deepEqual(titlesFor(2), [T2]);
  assert.deepEqual(body.by_variant.map(v => [v.shopify_variant_id, v.cut_number, v.sacks]).sort(),
    [['V1', 1, 2], ['V2', 2, 1]]);
  assert.equal(body.no_variant.length, 1);
  assert.equal(body.no_variant[0].cut_number, 2);
  assert.equal(total(body.by_variant) + body.no_variant.length, 4, 'nothing silently dropped');
});

test('bad dates are refused; day_yield must be a POST', { skip }, async () => {
  const { env } = freshDb();
  for (const d of ['', 'garbage', '2026-13-01', '2026-02-31', "2026-10-20' OR 1=1"]) {
    assert.equal((await call(env, 'scanned_day', { date: d })).status, 400, d);
    assert.equal((await call(env, 'day_yield', { date: d })).status, 400, d);
  }
  assert.equal((await call(env, 'day_yield', { method: 'GET' })).status, 405);
});

test('day_yield groups by zone, cut and order, with nickname and stock', { skip }, async () => {
  const { sqlite, env } = freshDb();
  sqlite.exec("INSERT INTO orders VALUES ('O1', 'Bob''s 50')");
  sack(sqlite, { out_order_id: 'O1' });
  sack(sqlite, { fill_lbs: 17.5 });                       // light: half a sack
  sack(sqlite, { cut_number: 2, shopify_variant_id: 'V2' });
  sack(sqlite, { zone: 'Z9', weights_source: 'measured', tops_lbs: 99 });
  floor(sqlite, { sacks: 2, tops: 15 });                  // 1st Cut: the 2 unmeasured cut-1 bags
  floor(sqlite, { strain: T2, sacks: 1, tops: 10 });      // 2nd Cut: its own row
  const { status, body } = await call(env, 'day_yield');
  assert.equal(status, 200, JSON.stringify(body));
  const g = (zone, cut, order) => body.groups.find(x => x.zone === zone && x.cut_number === cut
    && (order ? x.order?.id === order : x.order === null));
  assert.equal(body.groups.length, 4);
  assert.deepEqual(g('Z4', 1, 'O1').order, { id: 'O1', nickname: "Bob's 50" });
  assert.equal(g('Z4', 1, 'O1').tops, 10);   // 35 / 52.5 of 15
  assert.equal(g('Z4', 1, null).tops, 5);    // 17.5 / 52.5 of 15
  assert.equal(g('Z4', 2, null).tops, 10);
  assert.equal(g('Z9', 1, null).tops, 99, 'measured sack untouched');
  assert.deepEqual(body.mismatches, []);
  assert.deepEqual(body.unallocated, []);
  const again = await call(env, 'day_yield');
  assert.deepEqual(again.body.groups, body.groups, 'idempotent');
});

test('day_yield surfaces mismatches, unknown strains and both kinds of gap', { skip }, async () => {
  const { sqlite, env } = freshDb();
  sack(sqlite); sack(sqlite);
  sack(sqlite, { cultivar: 'Lifter' });                   // no floor output for Lifter
  floor(sqlite, { sacks: 3, tops: 30 });                  // floor says 3, 2 tagged
  floor(sqlite, { strain: '2026 - Mystery / Sungrown', sacks: 1, tops: 5 });
  floor(sqlite, { strain: '2025 - Sour Lifter / Sungrown', sacks: 2, tops: 20 });
  sqlite.prepare('INSERT INTO cultivar_aliases VALUES (?, 1)').run('2025 - Sour Lifter / Sungrown');
  const { status, body } = await call(env, 'day_yield');
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.mismatches.length, 1);
  const kinds = body.unallocated.map(u => `${u.kind}:${u.season ?? ''}:${u.cultivar ?? u.strain}`).sort();
  assert.deepEqual(kinds, [
    'output_without_scans:2025:Sour Lifter',
    'scanned_without_output:2026:Lifter',
    'unknown_strain::2026 - Mystery / Sungrown',
  ]);
});

test('day_yield on a day with no scans still reports the floor output', { skip }, async () => {
  const { sqlite, env } = freshDb();
  floor(sqlite, { sacks: 2, tops: 20 });
  const { status, body } = await call(env, 'day_yield');
  assert.equal(status, 200);
  assert.deepEqual(body.groups, []);
  assert.deepEqual(body.unallocated.map(u => u.kind), ['output_without_scans']);
});

test('day_yield works for today (Pacific)', { skip }, async () => {
  const { sqlite, env } = freshDb();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
  const nowUtc = new Date().toISOString().replace('T', ' ').slice(0, 19);
  sack(sqlite, { opened_at: nowUtc });
  floor(sqlite, { day: today, sacks: 1, tops: 12 });
  const { status, body } = await call(env, 'day_yield', { date: today });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.groups.length, 1);
  assert.equal(body.groups[0].tops, 12);
});

test('day_yield reports a failed allocation instead of an empty day', { skip }, async () => {
  const { sqlite, env } = freshDb();
  sack(sqlite);
  sqlite.exec('DROP TABLE supersack_entries');            // allocation cannot read the floor
  const { status, body } = await call(env, 'day_yield');
  assert.equal(status, 500);
  assert.equal(body.success, false);
  assert.equal(body.code, 'ALLOCATE_FAILED');
});
