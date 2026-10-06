/**
 * Allocation by cut and harvest type — handleAllocate over an in-memory SQLite
 * built from the real migrations, with the alias table seeded CUT-LESS, as the
 * live table is for 2026 ("2026 - Sour Lifter / Sungrown").
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
const { handleAllocate } = await import(url('workers/src/handlers/harvest-d1.js'));
const { handleSupersackD1 } = await import(url('workers/src/handlers/supersack-d1.js'));
const fo = await import(url('workers/src/lib/floor-output.js'));
const { fullSackLbs } = await import(url('workers/src/lib/sack-weight.js'));

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node < 22.5 */ }
const skip = !DatabaseSync && 'node:sqlite unavailable';

const DAY = '2026-10-20';
const BASE = '2026 - Sour Lifter / Sungrown';
const T1 = `${BASE} / 1st Cut`;
const T2 = `${BASE} / 2nd Cut`;
const GH = '2026 - Sour Lifter / Greenhouse';

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
    raw_lbs REAL NOT NULL DEFAULT 0, UNIQUE(date, strain))`);
  sqlite.exec('CREATE TABLE cultivars (id INTEGER PRIMARY KEY, name TEXT)');
  sqlite.exec('CREATE TABLE cultivar_aliases (alias TEXT, cultivar_id INTEGER)');
  sqlite.exec('CREATE TABLE orders (id TEXT PRIMARY KEY, nickname TEXT)');
  sqlite.exec("INSERT INTO cultivars (id, name) VALUES (1, 'Sour Lifter'), (2, 'Sugar Cookez')");
  sqlite.exec('DELETE FROM cultivar_aliases');
  // Cut-less only, as in production.
  for (const [a, id] of [[BASE, 1], [GH, 1], ['2025 - Sugar Cookez (Cookies) / Sungrown', 2]]) {
    sqlite.prepare('INSERT INTO cultivar_aliases VALUES (?, ?)').run(a, id);
  }
  const DB = {
    async batch(stmts) { return Promise.all(stmts.map(st => st.run())); },
    prepare(sql) {
      const bound = (...args) => ({
        all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
        first: async () => sqlite.prepare(sql).get(...args) ?? null,
        run: async () => {
          const r = sqlite.prepare(sql).run(...args);
          return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
        },
      });
      return { bind: bound, ...bound() };
    },
  };
  return { sqlite, DB, env: { DB, HARVEST_TEST_MODE: 'true' } };
}

let serial = 0;
function sack(sqlite, o = {}) {
  serial++;
  const r = {
    sack_id: `C-${serial}`, season: 2026, serial, zone: 'Z4', cultivar: 'Sour Lifter', cut_number: 1,
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

async function allocate(DB, env, date = DAY) {
  const res = await handleAllocate(DB, env, { date });
  const raw = await res.json();
  return raw.data || raw;
}
const topsOf = (sqlite, id) => sqlite.prepare('SELECT tops_lbs FROM harvest_sacks WHERE sack_id = ?').get(id).tops_lbs;

test('fullSackLbs: 35 lb for 2026, 37 lb for 2025', () => {
  assert.equal(fullSackLbs(2026), 35);
  assert.equal(fullSackLbs(2025), 37);
});

test('parsing: cut and harvest type off a strain title', () => {
  assert.equal(fo.cutFromStrainTitle(T1), 1);
  assert.equal(fo.harvestTypeFromStrainTitle(T1), 'Sungrown');
  assert.equal(fo.cutFromStrainTitle('2026 - Gravy Train / Greenhouse / 2nd Cut'), 2);
  assert.equal(fo.harvestTypeFromStrainTitle('2026 - Gravy Train / Greenhouse / 2nd Cut'), 'Greenhouse');
  assert.equal(fo.cutFromStrainTitle('2025 - Sugar Cookez (Cookies) / Sungrown'), null);
  assert.equal(fo.harvestTypeFromStrainTitle('2025 - Sugar Cookez (Cookies) / Sungrown'), 'Sungrown');
  assert.equal(fo.harvestTypeFromStrainTitle('2026 - Lifter / 1st Cut'), null);
  assert.equal(fo.cutFromStrainTitle('2026 - Lifter / 1st Cut'), 1);
  for (const g of ['garbage', '', null, undefined]) {
    assert.equal(fo.cutFromStrainTitle(g), null);
    assert.equal(fo.harvestTypeFromStrainTitle(g), null);
  }
  assert.deepEqual(fo.aliasCandidates(T1), [T1, BASE, '2026 - Sour Lifter']);
  assert.deepEqual(fo.aliasCandidates(BASE), [BASE, '2026 - Sour Lifter']);
  assert.deepEqual(fo.aliasCandidates(''), []);
  assert.equal(fo.floorKey(2026, 'X', null, null), '2026|X||');
});

test('resolution: a 1st Cut title resolves through the cut-less alias; unknown stays unresolved', { skip }, async () => {
  const { sqlite, DB, env } = freshDb();
  floor(sqlite, { sacks: 1, tops: 5 });
  floor(sqlite, { strain: '2026 - Nobody Knows / Sungrown / 1st Cut', sacks: 1, tops: 5 });
  const { byKey, unresolved } = await fo.floorOutputByCultivar(DB, env, DAY);
  const e = byKey.get(fo.floorKey(2026, 'Sour Lifter', 1, 'Sungrown'));
  assert.ok(e, [...byKey.keys()].join(','));
  assert.equal(e.cut, 1);
  assert.equal(e.harvest_type, 'Sungrown');
  assert.deepEqual(e.titles, [T1]);
  assert.deepEqual(unresolved, ['2026 - Nobody Knows / Sungrown / 1st Cut']);
});

test('two cuts, each with its own floor row: no pooling', { skip }, async () => {
  const { sqlite, DB, env } = freshDb();
  const a = sack(sqlite), b = sack(sqlite), c = sack(sqlite, { cut_number: 2 });
  floor(sqlite, { sacks: 2, tops: 20 });
  floor(sqlite, { strain: T2, sacks: 1, tops: 7 });
  const body = await allocate(DB, env);
  assert.equal(topsOf(sqlite, a), 10);
  assert.equal(topsOf(sqlite, b), 10);
  assert.equal(topsOf(sqlite, c), 7);
  assert.deepEqual(body.pooled_across_cuts, []);
  assert.deepEqual(body.sack_count_mismatches, []);
  assert.deepEqual(body.floor_output_without_tagged_bags, []);
});

test('two cuts, one cut-less floor row: split by weight and reported as pooled', { skip }, async () => {
  const { sqlite, DB, env } = freshDb();
  const ids = [sack(sqlite), sack(sqlite), sack(sqlite, { cut_number: 2 })];
  floor(sqlite, { strain: BASE, sacks: 3, tops: 30 });
  const body = await allocate(DB, env);
  for (const id of ids) assert.equal(topsOf(sqlite, id), 10);
  assert.equal(body.pooled_across_cuts.length, 1);
  assert.deepEqual(body.pooled_across_cuts[0].cuts, [1, 2]);
  assert.equal(body.pooled_across_cuts[0].cultivar, 'Sour Lifter');
  assert.equal(body.pooled_across_cuts[0].season, 2026);
});

test('a cut-less row beside a 2nd Cut row takes no bags; cut-1 bags are skipped', { skip }, async () => {
  const { sqlite, DB, env } = freshDb();
  const a = sack(sqlite), b = sack(sqlite, { cut_number: 2 }), c = sack(sqlite, { cut_number: 2 });
  floor(sqlite, { strain: BASE, sacks: 1, tops: 50 });
  floor(sqlite, { strain: T2, sacks: 2, tops: 16 });
  const body = await allocate(DB, env);
  assert.equal(topsOf(sqlite, b), 8);
  assert.equal(topsOf(sqlite, c), 8);
  assert.equal(topsOf(sqlite, a), null);
  const skipped = body.allocated.filter(x => x.skipped);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].cut_number, 1);
  assert.equal(body.floor_output_without_tagged_bags.length, 1);
  assert.equal(body.floor_output_without_tagged_bags[0].cut_number, null);
  assert.deepEqual(body.pooled_across_cuts, []);
});

test('cut-1 bags and a cut-2 floor row only: bags skipped, row untagged', { skip }, async () => {
  const { sqlite, DB, env } = freshDb();
  const a = sack(sqlite);
  floor(sqlite, { strain: T2, sacks: 1, tops: 9 });
  const body = await allocate(DB, env);
  assert.equal(topsOf(sqlite, a), null);
  assert.equal(body.allocated.filter(x => x.skipped).length, 1);
  assert.equal(body.floor_output_without_tagged_bags.length, 1);
  assert.equal(body.floor_output_without_tagged_bags[0].cut_number, 2);
  assert.equal(body.floor_output_without_tagged_bags[0].harvest_type, 'Sungrown');
});

test('Greenhouse and Sungrown bags of one cultivar take separate shares', { skip }, async () => {
  const { sqlite, DB, env } = freshDb();
  const g = sack(sqlite, { zone: 'GH1' }), s = sack(sqlite, { zone: 'Z4' });
  floor(sqlite, { strain: GH, sacks: 1, tops: 12 });
  floor(sqlite, { strain: BASE, sacks: 1, tops: 6 });
  const body = await allocate(DB, env);
  assert.equal(topsOf(sqlite, g), 12);
  assert.equal(topsOf(sqlite, s), 6);
  assert.deepEqual(body.floor_output_without_tagged_bags, []);
  assert.deepEqual(body.pooled_across_cuts, []);
});

test('Greenhouse and Sungrown 1st Cut rows split by type', { skip }, async () => {
  const { sqlite, DB, env } = freshDb();
  const g = sack(sqlite, { zone: 'GH2' }), s = sack(sqlite, { zone: 'Z1' }), s2 = sack(sqlite, { zone: 'Z1' });
  floor(sqlite, { strain: `${GH} / 1st Cut`, sacks: 1, tops: 9 });
  floor(sqlite, { strain: T1, sacks: 2, tops: 14 });
  const body = await allocate(DB, env);
  assert.deepEqual([topsOf(sqlite, g), topsOf(sqlite, s), topsOf(sqlite, s2)], [9, 7, 7]);
  assert.deepEqual(body.floor_output_without_tagged_bags, []);
});

test('2025: cut-less title, cut-1 Z bags, one row — unchanged', { skip }, async () => {
  const { sqlite, DB, env } = freshDb();
  const o = { season: 2025, cultivar: 'Sugar Cookez', zone: 'Z1' };
  const a = sack(sqlite, o), b = sack(sqlite, { ...o, fill_lbs: 18.5 });
  floor(sqlite, { strain: '2025 - Sugar Cookez (Cookies) / Sungrown', sacks: 2, tops: 33.3 });
  const body = await allocate(DB, env);
  // 37 / 55.5 and 18.5 / 55.5 of 33.3
  assert.equal(topsOf(sqlite, a), 22.2);
  assert.equal(topsOf(sqlite, b), 11.1);
  assert.deepEqual(body.pooled_across_cuts, []);
});

test('idempotent; measured bags untouched; count mismatch reported per cut', { skip }, async () => {
  const { sqlite, DB, env } = freshDb();
  const a = sack(sqlite), b = sack(sqlite, { cut_number: 2 });
  const m = sack(sqlite, { weights_source: 'measured', tops_lbs: 99 });
  floor(sqlite, { sacks: 1, tops: 10 });
  floor(sqlite, { strain: T2, sacks: 3, tops: 12 });
  const body = await allocate(DB, env);
  const first = [topsOf(sqlite, a), topsOf(sqlite, b)];
  assert.deepEqual(first, [10, 12]);
  assert.equal(topsOf(sqlite, m), 99);
  assert.equal(body.sack_count_mismatches.length, 1);
  const mm = body.sack_count_mismatches[0];
  assert.equal(mm.cut_number, 2);
  assert.equal(mm.harvest_type, 'Sungrown');
  assert.equal(mm.floor_sacks_opened, 3);
  assert.equal(mm.tagged_bags_opened, 1);
  await allocate(DB, env);
  assert.deepEqual([topsOf(sqlite, a), topsOf(sqlite, b)], first);
  assert.equal(topsOf(sqlite, m), 99);
});

test('day_yield passes pooled_across_cuts through and groups carry cut_number', { skip }, async () => {
  const { sqlite, env } = freshDb();
  sack(sqlite); sack(sqlite); sack(sqlite, { cut_number: 2, shopify_variant_id: 'V2' });
  floor(sqlite, { strain: BASE, sacks: 3, tops: 30 });
  const req = new Request('https://x/api/supersack?action=day_yield',
    { method: 'POST', body: JSON.stringify({ date: DAY }), headers: { 'Content-Type': 'text/plain' } });
  const res = await handleSupersackD1(req, env, { waitUntil() {} });
  const raw = await res.json();
  const body = raw.data || raw;
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.pooled_across_cuts.length, 1);
  assert.deepEqual(body.pooled_across_cuts[0].cuts, [1, 2]);
  const byCut = Object.fromEntries(body.groups.map(g => [g.cut_number, g.tops]));
  assert.deepEqual(byCut, { 1: 20, 2: 10 });
});
