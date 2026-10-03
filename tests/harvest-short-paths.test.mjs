/**
 * Short paths for the screens nobody scans a sign to reach.
 *
 * Koa, 2026-09-25, having opened a saved link to the takedown printer and got
 * the API's endpoint list instead: "can we shorten the link to look more like
 * the other apps we've created".
 *
 * The failure is worth pinning because of its SHAPE. Every crew screen lives
 * behind `?action=…`; drop the query string — a shortened link, a paste that
 * broke at the `?`, a bookmark saved after a redirect — and the request lands
 * on `/`, which answers **200 with cheerful JSON**. Nothing reads as broken.
 * A path carries no query string to lose, which is why /b and /fin are paths.
 *
 * These tests go through the worker's fetch handler rather than a page handler:
 * routing is the thing under test, and a handler called directly would pass
 * whether or not index.js ever reaches it.
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

const worker = (await import(
  join(REPO, 'workers/src/index.js').replace(/\\/g, '/').replace(/^/, 'file:///')
)).default;

const MIGRATIONS = [
  '0009-harvest-scan-log.sql', '0010-harvest-sacks.sql', '0011-harvest-sacks-void.sql',
  '0012-harvest-scan-log-cultivar.sql', '0013-harvest-crew-roster.sql',
  '0014-harvest-sack-notes.sql', '0015-harvest-sacks-per-cultivar-serial.sql',
  '0016-harvest-sacks-sku.sql', '0017-harvest-sacks-shopify-sync.sql',
  '0018-harvest-sacks-shopify-add.sql', '0019-harvest-sacks-weight-source.sql',
  '0027-harvest-sacks-all-parts.sql', '0028-harvest-sacks-bay.sql',
  '0029-harvest-crew-tag.sql', '0030-harvest-load-bay.sql', '0031-harvest-sacks-storage.sql',
  '0032-harvest-hourly.sql', '0033-harvest-sms-queue.sql', '0034-harvest-channel.sql',
  '0034-harvest-lot-takedown-done.sql', '0035-harvest-sacks-serial-per-cut.sql',
  '0036-harvest-sack-notes-edit.sql', '0037-harvest-settings.sql', '0038-harvest-print-queue.sql', '0041-harvest-sacks-fill-lbs.sql', '0040-harvest-load-trailer.sql', '0042-harvest-crew-day.sql',
];

function freshEnv() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) {
    const stripped = readFileSync(join(REPO, 'workers/migrations', f), 'utf8')
      .split(/\r?\n/).map(l => l.replace(/--.*$/, '')).join('\n');
    for (const stmt of stripped.split(';')) { const t = stmt.trim(); if (t) sqlite.exec(t); }
  }
  sqlite.exec('CREATE TABLE cultivars (id INTEGER PRIMARY KEY, name TEXT, sku_prefix TEXT)');
  sqlite.exec('CREATE TABLE cultivar_aliases (alias TEXT, cultivar_id INTEGER)');
  sqlite.prepare("INSERT INTO harvest_crew_day (harvest_date, crew, trailers, cutters, drivers, water_spiders, is_test) VALUES (?, 'A', '1,2,3,4,5,6', 16, 4, 4, 1)")
    .run(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }));
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
  return { sqlite, env: { DB, HARVEST_TEST_MODE: 'true', ORDERS_PASSWORD: 'test-password' },
    ctx: { waitUntil() {} } };
}

const quiet = async (fn) => {
  const l = console.log, e = console.error;
  console.log = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = l; console.error = e; }
};

const get = (env, ctx, path) => quiet(() =>
  worker.fetch(new Request('https://x' + path), env, ctx));

before((t) => { if (!DatabaseSync) t.skip('node:sqlite unavailable (Node < 22.5)'); });

test('/tags is the takedown printer', async () => {
  const { env, ctx } = freshEnv();

  const res = await get(env, ctx, '/tags');
  const html = await res.text();

  assert.equal(res.status, 200);
  assert.match(html, /Imprimir Etiquetas/, 'the page itself, not a redirect and not JSON');
  assert.doesNotMatch(html, /Rogue Origin API - Cloudflare Workers/,
    'the endpoint list is what a lost query string looks like');
});

test('/hora is the hourly crew report', async () => {
  const { env, ctx } = freshEnv();

  const html = await (await get(env, ctx, '/hora')).text();

  assert.match(html, /Reporte de cuadrilla por hora/);
  assert.match(html, /Granero Arriba/, 'barn picker, so it is the form and not an error page');
});

test('/hub is the tools hub', async () => {
  const { env, ctx } = freshEnv();

  const html = await (await get(env, ctx, '/hub')).text();

  assert.match(html, /Herramientas de cosecha|Harvest tools/);
});

test('a short path still takes ?lang', async () => {
  const { env, ctx } = freshEnv();

  const html = await (await get(env, ctx, '/tags?lang=en')).text();

  assert.match(html, /<html lang="en"/, 'the language switch must survive the rewrite to ?action=');
  assert.match(html, /Print Sack Tags/i, 'and the page renders in it');
});

test('the long URLs keep working — nothing printed or bookmarked breaks', async () => {
  const { env, ctx } = freshEnv();

  const html = await (await get(env, ctx, '/api/harvest?action=sack_print')).text();

  assert.match(html, /Imprimir Etiquetas/);
});

test('the scan routes are untouched by the new table', async () => {
  const { env, ctx } = freshEnv();

  const zone = await (await get(env, ctx, '/z/Z4?crew=A&lang=en')).text();
  assert.match(zone, /Entered Z4/, '/z/ still opens a zone rather than routing as a short screen');

  const barn = await (await get(env, ctx, '/b?lang=en')).text();
  assert.match(barn, /bins|Bins|load/, '/b is still the barn form');
});

test('an unknown short path is still a 404, not a page', async () => {
  const { env, ctx } = freshEnv();

  const res = await get(env, ctx, '/tt');

  assert.equal(res.status, 404, 'only the three named paths are screens');
});
