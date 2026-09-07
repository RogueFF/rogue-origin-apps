/**
 * Crew pages must not contain relative action URLs.
 *
 * The crew reach these screens through short QR routes — /z/Z4, /b, /s/<id> —
 * and a relative `?action=...` resolves against THAT path, not /api/harvest.
 * So a cutter-count tap from a scanned zone sign went to `/z/Z4?action=
 * headcount`, which routes to the zone handler, ignores `action`, answers
 * "Already entered Z4", and records nothing. A trailer submitted from /b did
 * the same. Both returned 200 and looked fine.
 *
 * That is the worst shape a bug can take here: the capture screens appear to
 * work while the season's data quietly goes nowhere. Found 2026-09-04 only
 * because Koa noticed a Telegram alert that never arrived.
 *
 * These tests are deliberately about the SOURCE of the links rather than any
 * one screen's behaviour — the failure was a whole class, and one screen
 * passing says nothing about the next one someone adds.
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

const { handleZoneScan, handleBarnScan, handleSackScan, handleHarvestD1 } = await import(
  join(REPO, 'workers/src/handlers/harvest-d1.js').replace(/\\/g, '/').replace(/^/, 'file:///')
);

const MIGRATIONS = [
  '0009-harvest-scan-log.sql', '0010-harvest-sacks.sql', '0011-harvest-sacks-void.sql',
  '0012-harvest-scan-log-cultivar.sql', '0013-harvest-crew-roster.sql',
  '0014-harvest-sack-notes.sql', '0015-harvest-sacks-per-cultivar-serial.sql',
  '0016-harvest-sacks-sku.sql', '0017-harvest-sacks-shopify-sync.sql',
  '0018-harvest-sacks-shopify-add.sql', '0019-harvest-sacks-weight-source.sql',
  '0027-harvest-sacks-all-parts.sql', '0028-harvest-sacks-bay.sql',
  '0029-harvest-crew-tag.sql',
  '0030-harvest-load-bay.sql',
];

function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) {
    const c = readFileSync(join(REPO, 'workers/migrations', f), 'utf8')
      .split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
    for (const st of c.split(';')) { const t = st.trim(); if (t) sqlite.exec(t); }
  }
  sqlite.exec('CREATE TABLE cultivars (id INTEGER PRIMARY KEY, name TEXT, sku_prefix TEXT)');
  sqlite.exec('CREATE TABLE cultivar_aliases (alias TEXT, cultivar_id INTEGER)');
  const DB = {
    async batch(x) { return Promise.all(x.map(s => s.run())); },
    prepare(sql) {
      return { bind(...a) {
        return {
          all: async () => ({ results: sqlite.prepare(sql).all(...a) }),
          first: async () => sqlite.prepare(sql).get(...a) ?? null,
          run: async () => { const r = sqlite.prepare(sql).run(...a);
            return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
        };
      } };
    },
  };
  return { sqlite, env: { DB, HARVEST_TEST_MODE: 'true' }, ctx: { waitUntil() {} } };
}

const quiet = async (fn) => { const l = console.log; console.log = () => {};
  try { return await fn(); } finally { console.log = l; } };

/** Any href/action/fetch/src that starts a query without naming a path. */
function relativeActionUrls(html) {
  return [
    ...html.matchAll(/(?:href|action|src)\s*=\s*"(\?[^"]*)"/g),
    ...html.matchAll(/(?:fetch|src\s*=)\s*\(?\s*'(\?[^']*)'/g),
  ].map(m => m[1]);
}

before(function () {
  if (!DatabaseSync) this.skip('node:sqlite unavailable (needs Node >= 22.5)');
});

test('the scanned zone sign has no relative action URLs', async () => {
  const { env, ctx } = freshDb();
  const html = await (await quiet(() =>
    handleZoneScan(new Request('https://x/z/Z4?lang=en'), env, ctx))).text();

  assert.deepEqual(relativeActionUrls(html), [],
    'served from /z/Z4, a relative ?action= goes back to the zone handler and records nothing');
  // The specific one that was losing every cutter count.
  assert.match(html, /href="\/api\/harvest\?lang=en&zone=Z4&action=headcount/);
});

test('the barn intake form posts to an absolute path', async () => {
  const { env, ctx } = freshDb();
  const html = await (await quiet(() =>
    handleBarnScan(new Request('https://x/b?lang=en'), env, ctx))).text();

  assert.deepEqual(relativeActionUrls(html), [],
    'served from /b, a relative form action re-renders the form and loses the load');
  assert.match(html, /action="\/api\/harvest\?action=barn_log/);
});

test('the sack scan page has no relative action URLs', async () => {
  const { env, ctx } = freshDb();
  const html = await (await quiet(() =>
    handleSackScan(new Request('https://x/s/DEMO?lang=en'), env, ctx))).text();
  assert.deepEqual(relativeActionUrls(html), []);
});

test('the takedown screens have none either', async () => {
  const { env, ctx } = freshDb();
  for (const action of ['sack_print', 'crew', 'barn_intake', 'find', 'print_codes']) {
    const html = await (await quiet(() => handleHarvestD1(
      new Request(`https://x/api/harvest?action=${action}&lang=en`), env, ctx))).text();
    assert.deepEqual(relativeActionUrls(html), [], `${action} has relative action URLs`);
  }
});

test('a cutter count tapped from a scanned sign is actually recorded', async () => {
  const { sqlite, env, ctx } = freshDb();
  const enter = await (await quiet(() =>
    handleZoneScan(new Request('https://x/z/Z4?lang=en'), env, ctx))).text();

  // Follow the link the crew lead's thumb actually lands on, resolved the way
  // a browser resolves it — against the page's own URL. That resolution IS the
  // bug: a bare `?action=...` on a page served from /z/Z4 becomes /z/Z4, which
  // never reaches the headcount handler.
  const href = (enter.match(/href="([^"]*action=headcount[^"]*)&count=6"/) || [])[1];
  assert.ok(href, 'no headcount link found on the entry screen');
  const resolved = new URL(href + '&count=6', 'https://x/z/Z4');
  assert.equal(resolved.pathname, '/api/harvest',
    `tapping resolves to ${resolved.pathname}, which is not the harvest API`);

  const res = await quiet(() => handleHarvestD1(new Request(resolved), env, ctx));

  assert.equal(res.status, 200);
  const row = sqlite.prepare("SELECT headcount FROM harvest_scan_log WHERE event_type='enter'").get();
  assert.equal(row.headcount, 6, 'the tap must record the count, not just look like it did');
});
