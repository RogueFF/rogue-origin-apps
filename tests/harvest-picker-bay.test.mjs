/**
 * The takedown picker shows the bay each lot is drying in (Koa, 2026-10-05),
 * from its barn loads, falling back to its tags' bay, never guessed. A lot in
 * one bay also sets the Bay field when picked.
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

const { handleHarvestD1 } = await import(
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
  '0029-harvest-crew-tag.sql',
  '0030-harvest-load-bay.sql', '0040-harvest-load-trailer.sql', '0031-harvest-sacks-storage.sql', '0034-harvest-lot-takedown-done.sql', '0035-harvest-sacks-serial-per-cut.sql', '0036-harvest-sack-notes-edit.sql', '0037-harvest-settings.sql', '0038-harvest-print-queue.sql', '0041-harvest-sacks-fill-lbs.sql',
];

function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) {
    const stripped = readFileSync(join(REPO, 'workers/migrations', f), 'utf8')
      .split(/\r?\n/).map(l => l.replace(/--.*$/, '')).join('\n');
    for (const stmt of stripped.split(';')) { const t = stmt.trim(); if (t) sqlite.exec(t); }
  }
  sqlite.exec('CREATE TABLE cultivars (id INTEGER PRIMARY KEY, name TEXT, sku_prefix TEXT)');
  sqlite.exec("INSERT INTO cultivars (id, name, sku_prefix) VALUES (1, 'Sour Lifter', 'SLIFT')");
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
  return { sqlite, env: { DB, HARVEST_TEST_MODE: 'true' }, ctx: { waitUntil() {} } };
}

/** A zone session, dry and ready. Two with the same zone, cultivar and cut are one lot. */

function seedLot(sqlite, { zone, cultivar = 'Sour Lifter', daysAgo = 10 }) {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, occurred_at, closed_at, is_test)
    VALUES ('enter', ?, ?, ?, 1, datetime('now', ?), datetime('now', ?), 1)
  `).run(zone, cultivar, SEASON, `-${daysAgo} days`, `-${daysAgo - 1} days`);
  return Number(sqlite.prepare('SELECT last_insert_rowid() AS id').get().id);
}
function seedLoad(sqlite, lot, bay) {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, season, bins, attributed_zone_session_id, bay, is_test, occurred_at)
    VALUES ('barn_load', 'Z4', ?, 24, ?, ?, 1, datetime('now', '-9 days'))
  `).run(SEASON, lot, bay);
}
function seedTag(sqlite, lot, bay, serial) {
  sqlite.prepare(`
    INSERT INTO harvest_sacks (sack_id, season, serial, zone, cultivar, cut_number, zone_session_id, bay, is_test, cultivar_code)
    VALUES (?, ?, ?, 'Z4', 'Sour Lifter', 1, ?, ?, 1, 'SLIFT')
  `).run(`26-SLIFT-${serial}`, SEASON, serial, lot, bay);
}

const picker = (env, ctx, lang = 'en') => handleHarvestD1(
  new Request(`https://x/api/harvest?action=sack_print&lang=${lang}`), env, ctx).then(r => r.text());

/** The radio card for one lot. */
const card = (html, id) => html.match(new RegExp(`<label class="lot[^"]*">\\s*<input type="radio" name="session_id" value="${id}"[\\s\\S]*?</label>`))?.[0];

// Since 2026-10-05 a lot whose loads carry a bay is offered as a BAY card
// (tests/harvest-bay-takedown.test.mjs); the pill below is for zone cards.
test('a lot hung in a bay is offered as that bay, which sets the Bay field', { skip: !DatabaseSync }, async () => {
  const { sqlite, env, ctx } = freshDb();
  const id = seedLot(sqlite, { zone: 'Z4' });
  seedLoad(sqlite, id, 7); seedLoad(sqlite, id, 7);
  const c = card(await picker(env, ctx), id);
  assert.match(c, /class="lot baycard/);
  assert.match(c, /<span class="baybig">Bay 7<\/span>/);
  assert.match(c, /data-bay="7"/);
});

test('a lot across two bays is offered once per bay', { skip: !DatabaseSync }, async () => {
  const { sqlite, env, ctx } = freshDb();
  const id = seedLot(sqlite, { zone: 'Z5' });
  seedLoad(sqlite, id, 9); seedLoad(sqlite, id, 3);
  const html = await picker(env, ctx, 'es');
  const bays = [...html.matchAll(new RegExp(`value="${id}"[^>]*?data-bay="(\\d+)"`, 'g'))].map(m => Number(m[1]));
  assert.deepEqual(bays.sort((a, b) => a - b), [3, 9]);
});

test('no loads with a bay: the bay its tags came down from', { skip: !DatabaseSync }, async () => {
  const { sqlite, env, ctx } = freshDb();
  const id = seedLot(sqlite, { zone: 'Z6' });
  seedTag(sqlite, id, 10, 1);
  const html = await picker(env, ctx);
  // A started lot shows the bay on its Resume row as well as its card.
  assert.match(card(html, id), /Bay 10/);
  assert.match(html, /<form method="POST" action="[^"]*lot_finish[\s\S]*?baypill">Bay 10</);
});

test('no bay known: no bay shown', { skip: !DatabaseSync }, async () => {
  const { sqlite, env, ctx } = freshDb();
  const id = seedLot(sqlite, { zone: 'Z7' });
  assert.ok(!/baypill/.test(card(await picker(env, ctx), id)));
});
