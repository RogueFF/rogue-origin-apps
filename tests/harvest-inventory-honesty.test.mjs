/**
 * The inventory count says what actually happened.
 *
 * Both halves of the Shopify sync run in waitUntil, against a Google Apps
 * Script that can answer "no", answer with an HTML error page, or never answer
 * at all. On 2026-09-22, voiding eight Purple Snowman tags, all three happened:
 *
 *   - one rollback failed AND cleared shopify_added_at anyway, so the row then
 *     claimed Shopify no longer counted a tag Shopify still counted, and the
 *     only handle a retry had was gone;
 *   - one died mid-call and wrote nothing, which reads exactly like a tag that
 *     was never counted in the first place.
 *
 * What these tests pin is the distinction between three states, because that
 * distinction is the whole basis for deciding what to do later:
 *
 *   counted   marker set,       no error
 *   failed    marker unchanged, error recorded   — retryable
 *   unknown   marker unchanged, IN_FLIGHT        — may or may not have landed
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
const VARIANT = 'gid://shopify/ProductVariant/49030527025344';

const MIGRATIONS = [
  '0009-harvest-scan-log.sql', '0010-harvest-sacks.sql', '0011-harvest-sacks-void.sql',
  '0012-harvest-scan-log-cultivar.sql', '0013-harvest-crew-roster.sql',
  '0014-harvest-sack-notes.sql', '0015-harvest-sacks-per-cultivar-serial.sql',
  '0016-harvest-sacks-sku.sql', '0017-harvest-sacks-shopify-sync.sql',
  '0018-harvest-sacks-shopify-add.sql', '0019-harvest-sacks-weight-source.sql',
  '0027-harvest-sacks-all-parts.sql', '0028-harvest-sacks-bay.sql',
  '0029-harvest-crew-tag.sql', '0030-harvest-load-bay.sql', '0031-harvest-sacks-storage.sql',
  '0034-harvest-lot-takedown-done.sql', '0035-harvest-sacks-serial-per-cut.sql',
  '0036-harvest-sack-notes-edit.sql', '0037-harvest-settings.sql', '0038-harvest-print-queue.sql',
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
      .split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
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

const sack = (sqlite, id = '26-PURPSNOW-2') =>
  sqlite.prepare(`SELECT * FROM harvest_sacks WHERE sack_id = ?`).get(id);

const voidTag = (env, ctx, sackId) => quiet(() => handleHarvestD1(new Request(
  'https://x/api/harvest?action=sack_void',
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sack_id: sackId }) },
), env, ctx));

const sweep = (env, ctx, qs = '') => quiet(() => handleHarvestD1(new Request(
  `https://x/api/harvest?action=inventory_sweep${qs}`,
  { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'test-password' }, body: '{}' },
), env, ctx));

before((t) => { if (!DatabaseSync) t.skip('node:sqlite unavailable (Node < 22.5)'); });

test('a rollback that lands clears the marker and leaves no error', async () => {
  const { sqlite, env, ctx, settle } = freshDb();
  seedCountedTag(sqlite);
  poolStub('ok');

  await voidTag(env, ctx, '26-PURPSNOW-2');
  await settle();

  const row = sack(sqlite);
  assert.ok(row.voided_at, 'the tag is retired');
  assert.equal(row.shopify_added_at, null, 'Shopify no longer counts it');
  assert.equal(row.shopify_add_error, null);
});

test('a refused rollback keeps the marker — the +1 is still standing', async () => {
  const { sqlite, env, ctx, settle } = freshDb();
  seedCountedTag(sqlite);
  poolStub('refuse');

  await voidTag(env, ctx, '26-PURPSNOW-2');
  await settle();

  const row = sack(sqlite);
  assert.ok(row.voided_at, 'the tag is still retired — that part never depended on Shopify');
  assert.equal(row.shopify_added_at, '2026-09-21T21:26:45.082Z',
    'the marker must survive: it is the record that Shopify holds this +1, and the only handle a retry has');
  assert.match(row.shopify_add_error, /void rollback failed: .*stocktake/);
});

test('an HTML error page is a failure, not a success', async () => {
  const { sqlite, env, ctx, settle } = freshDb();
  seedCountedTag(sqlite);
  poolStub('html');

  await voidTag(env, ctx, '26-PURPSNOW-2');
  await settle();

  const row = sack(sqlite);
  assert.ok(row.shopify_added_at, 'still counted');
  assert.match(row.shopify_add_error, /non-JSON/);
});

test('a rollback that dies mid-call leaves a mark saying so', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedCountedTag(sqlite);
  // The job starts and never comes back — the waitUntil promise is simply
  // never settled, which is what an evicted worker looks like from here.
  globalThis.fetch = () => new Promise(() => {});

  await voidTag(env, ctx, '26-PURPSNOW-2');
  await new Promise(r => setTimeout(r, 20));

  const row = sack(sqlite);
  assert.ok(row.shopify_added_at, 'nothing was taken off Shopify');
  assert.match(row.shopify_add_error, /^in flight since /,
    'the attempt is claimed before the call, so a dead job is not silence');
});

test('the sweep reports what is owed, and touches nothing until told', async () => {
  const { sqlite, env, ctx, settle } = freshDb();
  seedCountedTag(sqlite);
  poolStub('refuse');
  await voidTag(env, ctx, '26-PURPSNOW-2');
  await settle();

  const body = await (await sweep(env, ctx)).json();

  assert.equal(body.data?.owed_minus ?? body.owed_minus, 1);
  const rows = body.data?.rows ?? body.rows;
  assert.equal(rows[0].sack_id, '26-PURPSNOW-2');
  assert.equal(rows[0].state, 'failed');
  assert.equal(rows[0].acted, false, 'reporting is not acting');
  assert.ok(sack(sqlite).shopify_added_at, 'and nothing moved');
});

test('sweep --apply replays a definite failure and settles the row', async () => {
  const { sqlite, env, ctx, settle } = freshDb();
  seedCountedTag(sqlite);
  poolStub('refuse');
  await voidTag(env, ctx, '26-PURPSNOW-2');
  await settle();

  poolStub('ok');                       // the script is answering again
  const body = await (await sweep(env, ctx, '&apply=1')).json();

  const rows = body.data?.rows ?? body.rows;
  assert.equal(rows[0].acted, true);
  assert.equal(rows[0].ok, true);
  const row = sack(sqlite);
  assert.equal(row.shopify_added_at, null, 'the -1 finally landed');
  assert.equal(row.shopify_add_error, null);
});

test('sweep --apply will not guess at an unknown row without force', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedCountedTag(sqlite);
  globalThis.fetch = () => new Promise(() => {});
  await voidTag(env, ctx, '26-PURPSNOW-2');
  await new Promise(r => setTimeout(r, 20));

  poolStub('ok');
  const body = await (await sweep(env, ctx, '&apply=1')).json();
  const rows = body.data?.rows ?? body.rows;

  assert.equal(rows[0].state, 'unknown');
  assert.equal(rows[0].acted, false,
    'that call may have landed; replaying it would subtract twice and look identical to an honest count');
  assert.ok(sack(sqlite).shopify_added_at);

  const forced = await (await sweep(env, ctx, '&apply=1&force=1')).json();
  assert.equal((forced.data?.rows ?? forced.rows)[0].acted, true, 'force is the deliberate override');
  assert.equal(sack(sqlite).shopify_added_at, null);
});

test('the sweep needs the password', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedCountedTag(sqlite);

  // JSON actions throw; index.js turns that into the error response.
  const err = await quiet(() => handleHarvestD1(
    new Request('https://x/api/harvest?action=inventory_sweep&apply=1', { method: 'POST', body: '{}' }), env, ctx))
    .then(() => null, e => e);

  assert.equal(err?.code, 'UNAUTHORIZED');
  assert.ok(sack(sqlite).shopify_added_at, 'and nothing moved');
});
