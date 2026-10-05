/**
 * Too-green lots are folded away on the takedown picker (Koa, 2026-10-05:
 * "anything that is too green should be minimized"). A lot cut under
 * DRY_DAYS_MIN days ago sits in a closed <details> under the list, still
 * pickable, so the lots actually coming down are the ones in view.
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

function seedLot(sqlite, { zone, cultivar = 'Sour Lifter', daysAgo }) {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, occurred_at, closed_at, is_test)
    VALUES ('enter', ?, ?, ?, 1, datetime('now', ?), datetime('now', ?), 1)
  `).run(zone, cultivar, SEASON, `-${daysAgo} days`, `-${daysAgo - 1} days`);
  return Number(sqlite.prepare('SELECT last_insert_rowid() AS id').get().id);
}

const picker = (env, ctx, lang = 'en') => handleHarvestD1(
  new Request(`https://x/api/harvest?action=sack_print&lang=${lang}`), env, ctx).then(r => r.text());

/** The closed too-green section, or null. */
const greenBox = (html) => html.match(/<details class="batch greenlots">[\s\S]*?<\/details>/)?.[0] ?? null;
const radioIds = (html) => [...html.matchAll(/type="radio" name="session_id" value="(\d+)"/g)].map(m => Number(m[1]));

test('a too-green lot is folded into a closed section; a dry lot stays in view', { skip: !DatabaseSync }, async () => {
  const { sqlite, env, ctx } = freshDb();
  const dry = seedLot(sqlite, { zone: 'Z4', daysAgo: 12 });
  const green = seedLot(sqlite, { zone: 'Z8', daysAgo: 2 });
  const html = await picker(env, ctx);

  const box = greenBox(html);
  assert.ok(box, 'green section rendered');
  assert.ok(!/<details class="batch greenlots" open/.test(html), 'closed by default');
  assert.match(box, /Too green to come down \(1\)/);
  assert.deepEqual(radioIds(box), [green], 'only the green lot is folded');
  assert.ok(radioIds(html.replace(box, '')).includes(dry), 'the dry lot is in the main list');
  // The dry lot is still the default pick.
  assert.ok(new RegExp(`value="${dry}"[^>]*checked`).test(html), 'dry lot pre-selected');
});

test('no green lots, no green section', { skip: !DatabaseSync }, async () => {
  const { sqlite, env, ctx } = freshDb();
  seedLot(sqlite, { zone: 'Z4', daysAgo: 12 });
  assert.equal(greenBox(await picker(env, ctx)), null);
});

test('every lot green: all folded, still pickable, Spanish summary', { skip: !DatabaseSync }, async () => {
  const { sqlite, env, ctx } = freshDb();
  const a = seedLot(sqlite, { zone: 'Z4', daysAgo: 1 });
  const b = seedLot(sqlite, { zone: 'Z8', daysAgo: 3 });
  const html = await picker(env, ctx, 'es');
  const box = greenBox(html);
  assert.deepEqual(radioIds(box).sort(), [a, b].sort());
  assert.equal(radioIds(html.replace(box, '')).length, 0);
  assert.match(box, /Muy verde para bajar \(2\)/);
  assert.ok(!/<div class="lotlist"><\/div>/.test(html), 'no empty list above it');
});
