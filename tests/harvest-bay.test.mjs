/**
 * Drying bays — the one thing takedown now captures that nothing else knows.
 *
 * Twelve bays numbered continuously across two barns: 1-8 bottom, 9-12 top.
 * The barn is DERIVED from the number and never stored, so this pins that
 * derivation and the validation around it.
 *
 * Why it matters that an invalid bay is refused rather than coerced: the bay
 * prints on the tag. A silently-clamped or defaulted value would be tied to a
 * physical sack and read as fact by whoever picks it up months later.
 *
 * Run with `node --test`.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node < 22.5 */ }

const { handleHarvestD1, handleSackScan } = await import(
  join(REPO, 'workers/src/handlers/harvest-d1.js').replace(/\\/g, '/').replace(/^/, 'file:///')
);

const SEASON = new Date().getUTCFullYear();

const MIGRATIONS = [
  '0009-harvest-scan-log.sql', '0010-harvest-sacks.sql', '0011-harvest-sacks-void.sql',
  '0012-harvest-scan-log-cultivar.sql', '0013-harvest-crew-roster.sql',
  '0014-harvest-sack-notes.sql', '0015-harvest-sacks-per-cultivar-serial.sql',
  '0016-harvest-sacks-sku.sql', '0017-harvest-sacks-shopify-sync.sql',
  '0018-harvest-sacks-shopify-add.sql', '0019-harvest-sacks-weight-source.sql',
  '0027-harvest-sacks-all-parts.sql', '0028-harvest-sacks-bay.sql',
];

function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) {
    const stripped = readFileSync(join(REPO, 'workers/migrations', f), 'utf8')
      .split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
    for (const stmt of stripped.split(';')) { const t = stmt.trim(); if (t) sqlite.exec(t); }
  }
  sqlite.exec('CREATE TABLE cultivars (id INTEGER PRIMARY KEY, name TEXT, sku_prefix TEXT)');
  sqlite.exec("INSERT INTO cultivars (id, name, sku_prefix) VALUES (1, 'Sour Lifter', 'SLIFT')");
  sqlite.exec('CREATE TABLE cultivar_aliases (alias TEXT, cultivar_id INTEGER)');

  const DB = {
    // D1 exposes batch() for transactions; the alloc path uses it so the row
    // insert and the serial claim commit together.
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
  return { sqlite, env: { DB, HARVEST_TEST_MODE: 'true' }, ctx: { waitUntil() {} } };
}

/** An open lot for takedown to hang sacks off. */
function seedLot(sqlite, { zone = 'Z4', cultivar = 'Sour Lifter' } = {}) {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, occurred_at, closed_at, is_test)
    VALUES ('enter', ?, ?, ?, 1, datetime('now','-12 days'), datetime('now','-11 days'), 1)
  `).run(zone, cultivar, SEASON);
  return Number(sqlite.prepare('SELECT last_insert_rowid() AS id').get().id);
}

const alloc = (env, ctx, body) => handleHarvestD1(
  new Request('https://x/api/harvest?action=sack_alloc', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), env, ctx).then(async r => ({ status: r.status, body: await r.json() }));

const pickerHtml = (env, ctx, lang = 'en') => handleHarvestD1(
  new Request(`https://x/api/harvest?action=sack_print&lang=${lang}`), env, ctx).then(r => r.text());

const sacks = (sqlite) => sqlite.prepare('SELECT * FROM harvest_sacks ORDER BY serial').all();

before(function () {
  if (!DatabaseSync) this.skip('node:sqlite unavailable (needs Node >= 22.5)');
});

test('with no lots at all there is no bay picker, because there is nothing to take down', async () => {
  const { env, ctx } = freshDb();
  const html = await pickerHtml(env, ctx);
  assert.doesNotMatch(html, /<select id="bay"/);
});

// --- capture -----------------------------------------------------------------

test('the bay is stored on every sack of the takedown session', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedLot(sqlite);

  const r = await alloc(env, ctx, { session_id: lot, cultivar: 'Sour Lifter', qty: 3, bay: 7 });
  assert.equal(r.body.success, true);
  // Set once at Start takedown, carried by each sack — not asked per sack.
  assert.deepEqual(sacks(sqlite).map(s => s.bay), [7, 7, 7]);
});

test('a bay outside 1-12 is refused, never coerced', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedLot(sqlite);

  for (const bad of [0, 13, 99, -1]) {
    await assert.rejects(
      () => alloc(env, ctx, { session_id: lot, cultivar: 'Sour Lifter', qty: 1, bay: bad }),
      /Bay must be between 1 and 12/, `bay ${bad} should be refused`);
  }
  // Refused before any serial is issued — a burnt number cannot be reclaimed.
  assert.equal(sacks(sqlite).length, 0);
});

test('no bay is null, not a default', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedLot(sqlite);

  await alloc(env, ctx, { session_id: lot, cultivar: 'Sour Lifter', qty: 1 });
  // Defaulting to 1 would silently claim the sack came out of the first
  // bottom-barn bay. Absent must stay absent.
  assert.equal(sacks(sqlite)[0].bay, null);
});

// --- the picker defaults to the last bay used --------------------------------

test('the picker pre-selects the bay the last sack came out of', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedLot(sqlite);
  await alloc(env, ctx, { session_id: lot, cultivar: 'Sour Lifter', qty: 1, bay: 9 });

  const html = await pickerHtml(env, ctx);
  // The crew fills roughly one bay a day, so several takedowns share a bay —
  // the common action should be confirming, not choosing.
  assert.match(html, /<option value="9" selected/);
  assert.doesNotMatch(html, /<option value="1" selected/);
});

test('with nothing tagged yet, no bay is pre-selected', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedLot(sqlite);
  const html = await pickerHtml(env, ctx);
  // Nothing to carry over from, so the operator has to choose deliberately
  // rather than inherit a guess.
  assert.doesNotMatch(html, /<option value="\d+" selected/);
});

test('the picker groups bays by barn', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedLot(sqlite);
  const html = await pickerHtml(env, ctx);
  assert.match(html, /Bottom barn \(1-8\)/);
  assert.match(html, /Top barn \(9-12\)/);
  // 12 bays, no more and no fewer.
  assert.equal((html.match(/<option value="\d+"/g) || []).length, 12);
});

test('the picker is Spanish for the crew', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedLot(sqlite);
  const html = await pickerHtml(env, ctx, 'es');
  assert.match(html, /Bodega de abajo/);
  assert.match(html, /Bah&#237;a|Bahía/);
});

// --- what the tag and the scan page show -------------------------------------

test('the bay prints on the tag, in English like the rest of it', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedLot(sqlite);
  await alloc(env, ctx, { session_id: lot, cultivar: 'Sour Lifter', qty: 1, bay: 7 });
  const id = sacks(sqlite)[0].sack_id;

  // Spanish requested: the SCREENS follow it, the printed tag never does.
  const label = await handleHarvestD1(
    new Request(`https://x/api/harvest?action=sack_label&lang=es&id=${id}`), env, ctx).then(r => r.text());
  assert.match(label, /Bay 7/);
  assert.doesNotMatch(label, /Bah&#237;a 7|Bahía 7/);
});

test('a sack with no bay prints no bay, not an empty separator', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedLot(sqlite);
  await alloc(env, ctx, { session_id: lot, cultivar: 'Sour Lifter', qty: 1 });
  const id = sacks(sqlite)[0].sack_id;

  const label = await handleHarvestD1(
    new Request(`https://x/api/harvest?action=sack_label&id=${id}`), env, ctx).then(r => r.text());
  assert.doesNotMatch(label, /Bay/);
  assert.doesNotMatch(label, /·\s*<\/div>/, 'a dangling separator would print as a stray dot');
});

test('the scan page shows where it dried, on the drying leg', async () => {
  const { env, ctx } = freshDb();
  // DEMO carries bay 7 and needs no rows, so it exercises the render directly.
  const html = await handleSackScan(
    new Request('https://x/s/DEMO?lang=en'), env, ctx).then(r => r.text());
  // The dry dates were always there — Cut is the day it was hung, Bagged the
  // day it came down. The bay joins them so where and how long read as one.
  assert.match(html, /on the rack/);
  assert.match(html, /dried in bay 7/);
});
