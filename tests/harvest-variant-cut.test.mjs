/**
 * The harvest worker and the Super Sack cut split, end to end.
 *
 * Koa, 2026-09-16: every 2026 Super Sack variant is now "/ 1st Cut" or
 * "/ 2nd Cut". supersack-variant-match.test.mjs pins the matcher; this suite
 * pins that the worker hands it the cut on every path that moves a count —
 * printing, voiding — that Start takedown warns before a serial is spent when
 * a tag would not count, and that the reconcile report compares per cut.
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
const YY = String(SEASON).slice(-2);
const gid = (n) => `gid://shopify/ProductVariant/${n}`;
const RG1 = gid(48979052200128);
const RG2 = gid(49030271664320);

const MIGRATIONS = [
  '0009-harvest-scan-log.sql', '0010-harvest-sacks.sql', '0011-harvest-sacks-void.sql',
  '0012-harvest-scan-log-cultivar.sql', '0013-harvest-crew-roster.sql',
  '0014-harvest-sack-notes.sql', '0015-harvest-sacks-per-cultivar-serial.sql',
  '0016-harvest-sacks-sku.sql', '0017-harvest-sacks-shopify-sync.sql',
  '0018-harvest-sacks-shopify-add.sql', '0019-harvest-sacks-weight-source.sql',
  '0027-harvest-sacks-all-parts.sql', '0028-harvest-sacks-bay.sql',
  '0029-harvest-crew-tag.sql',
  '0030-harvest-load-bay.sql', '0031-harvest-sacks-storage.sql', '0034-harvest-lot-takedown-done.sql', '0035-harvest-sacks-serial-per-cut.sql', '0036-harvest-sack-notes-edit.sql', '0037-harvest-settings.sql', '0038-harvest-print-queue.sql',
];

/** A LIVE-mode worker (not test mode) — the Shopify paths only run there. */
function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) {
    const stripped = readFileSync(join(REPO, 'workers/migrations', f), 'utf8')
      .split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
    for (const stmt of stripped.split(';')) { const t = stmt.trim(); if (t) sqlite.exec(t); }
  }
  sqlite.exec('CREATE TABLE cultivars (id INTEGER PRIMARY KEY, name TEXT, sku_prefix TEXT)');
  sqlite.exec(`INSERT INTO cultivars (id, name, sku_prefix) VALUES
    (1, 'Rainbow GMO Quik', 'RAINGQ'), (2, 'Purple Snowman', 'PSN')`);
  sqlite.exec('CREATE TABLE cultivar_aliases (alias TEXT, cultivar_id INTEGER)');
  // The production row, recorded before the split.
  sqlite.exec(`INSERT INTO cultivar_aliases (alias, cultivar_id) VALUES ('${SEASON} - Rainbow GMO / Sungrown', 1)`);

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
  const pending = [];
  return {
    sqlite,
    env: { DB, HARVEST_TEST_MODE: 'false', POOL_INVENTORY_API_URL: 'https://pool.test', POOL_INVENTORY_API_KEY: 'k' },
    ctx: { waitUntil(p) { pending.push(p); } },
    settle: () => Promise.all(pending.splice(0)),
  };
}

/** Stub the pool API: the real Rainbow GMO variants, recording every move. */
function withPool({ down = false } = {}) {
  const moves = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.action === 'get_supersack_variants') {
      if (down) return new Response(JSON.stringify({ error: 'Apps Script timed out' }), { status: 200 });
      return new Response(JSON.stringify({ variants: [
        { id: RG1, title: `${SEASON} - Rainbow GMO / Sungrown / 1st Cut`, quantity: 15, inventoryItemId: 'i1', locationId: 'l1' },
        { id: RG2, title: `${SEASON} - Rainbow GMO / Sungrown / 2nd Cut`, quantity: 0, inventoryItemId: 'i2', locationId: 'l1' },
      ] }), { status: 200 });
    }
    if (body.action === 'update_supersack_inventory') {
      moves.push({ variantId: body.variantId, operation: body.operation, amount: body.amount });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    // Telegram and anything else: not under test.
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  return { moves, restore: () => { globalThis.fetch = real; } };
}

function seedLot(sqlite, { cultivar = 'Rainbow GMO Quik', cut = 1 } = {}) {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, occurred_at, closed_at, is_test)
    VALUES ('enter', 'Z8', ?, ?, ?, datetime('now','-12 days'), datetime('now','-11 days'), 0)
  `).run(cultivar, SEASON, cut);
  return Number(sqlite.prepare('SELECT last_insert_rowid() AS id').get().id);
}

const json = (env, ctx, action, body) => handleHarvestD1(new Request(`https://x/api/harvest?action=${action}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}), env, ctx).then(r => r.json());

const screen = (env, ctx, lot, cultivar = 'Rainbow GMO Quik') => handleHarvestD1(new Request(
  `https://x/api/harvest?action=sack_session&session_id=${lot}&cultivar=${encodeURIComponent(cultivar)}&lang=en`),
  env, ctx).then(r => r.text());

before(function () {
  if (!DatabaseSync) this.skip('node:sqlite unavailable (needs Node >= 22.5)');
});

test('a second-cut tag counts on 2nd Cut, a first-cut tag on 1st Cut — through the pre-split alias', async () => {
  const { sqlite, env, ctx, settle } = freshDb();
  const cut1 = seedLot(sqlite, { cut: 1 });
  const cut2 = seedLot(sqlite, { cut: 2 });
  const pool = withPool();
  try {
    await json(env, ctx, 'sack_alloc', { session_id: cut2, cultivar: 'Rainbow GMO Quik', qty: 2 });
    await json(env, ctx, 'sack_alloc', { session_id: cut1, cultivar: 'Rainbow GMO Quik', qty: 1 });
    await settle();
    assert.deepEqual(pool.moves, [
      { variantId: RG2, operation: 'add', amount: 2 },
      { variantId: RG1, operation: 'add', amount: 1 },
    ]);
    const rows = sqlite.prepare('SELECT sack_id, shopify_variant_id, shopify_add_error FROM harvest_sacks ORDER BY id').all();
    assert.deepEqual(rows.map(r => [r.sack_id, r.shopify_variant_id, r.shopify_add_error]),
      [[`${YY}-RAINGQ-C2-1`, RG2, null], [`${YY}-RAINGQ-C2-2`, RG2, null], [`${YY}-RAINGQ-1`, RG1, null]]);
  } finally { pool.restore(); }
});

test('a void takes the tag off the variant it was counted on, even one counted before the split', async () => {
  const { sqlite, env, ctx, settle } = freshDb();
  const cut2 = seedLot(sqlite, { cut: 2 });
  // #1 was printed before the split: counted on the variant now titled 1st Cut.
  sqlite.prepare(`
    INSERT INTO harvest_sacks (sack_id, season, serial, cultivar_code, zone, cultivar, cut_number, zone_session_id,
                               shopify_added_at, shopify_variant_id, is_test)
    VALUES (?, ?, 1, 'RAINGQ', 'Z8', 'Rainbow GMO Quik', 2, ?, '2026-09-15T22:08:51Z', ?, 0)
  `).run(`${YY}-RAINGQ-1`, SEASON, cut2, RG1);
  const pool = withPool();
  try {
    await json(env, ctx, 'sack_void', { sack_id: `${YY}-RAINGQ-1` });
    await settle();
    assert.deepEqual(pool.moves, [{ variantId: RG1, operation: 'subtract', amount: 1 }],
      'a re-match by title would take it off 2nd Cut, which never received it');
  } finally { pool.restore(); }
});

test('Start takedown warns when a tag will not count — and only then', async () => {
  const { sqlite, env, ctx } = freshDb();
  const ok = seedLot(sqlite, { cut: 2 });
  const noVariant = seedLot(sqlite, { cultivar: 'Purple Snowman', cut: 1 });
  const cut3 = seedLot(sqlite, { cut: 3 });

  let pool = withPool();
  try {
    assert.doesNotMatch(await screen(env, ctx, ok), /will not move/);
    const miss = await screen(env, ctx, noVariant, 'Purple Snowman');
    assert.match(miss, /class="notice">⚠️ Tags will print, but the Shopify Super Sack count <strong>will not move<\/strong>/);
    assert.match(miss, /Purple Snowman \/ Sungrown \/ 1st Cut/, 'it names the title to create');
    assert.match(miss, /<button id="printBtn" class="bigbtn">/, 'a warning, not a block');
    assert.match(await screen(env, ctx, cut3), /1st Cut and 2nd Cut/);
  } finally { pool.restore(); }

  pool = withPool({ down: true });
  try {
    assert.doesNotMatch(await screen(env, ctx, noVariant, 'Purple Snowman'), /will not move/,
      'an outage is not news about this lot');
  } finally { pool.restore(); }
});

test('reconcile compares each cut with its own variant', async () => {
  const { sqlite, env, ctx, settle } = freshDb();
  const cut1 = seedLot(sqlite, { cut: 1 });
  const cut2 = seedLot(sqlite, { cut: 2 });
  const pool = withPool();
  try {
    await json(env, ctx, 'sack_alloc', { session_id: cut1, cultivar: 'Rainbow GMO Quik', qty: 3 });
    await json(env, ctx, 'sack_alloc', { session_id: cut2, cultivar: 'Rainbow GMO Quik', qty: 2 });
    await settle();
    const r = await handleHarvestD1(new Request(`https://x/api/harvest?action=reconcile&season=${SEASON}`), env, ctx)
      .then(res => res.json());
    const lines = (r.lines || r.data?.lines).map(l => [l.cut, l.variant_title, l.variant_exists, l.unopened, l.shopify_on_hand, l.drift]);
    assert.deepEqual(lines, [
      [1, `${SEASON} - Rainbow GMO / Sungrown / 1st Cut`, true, 3, 15, -12],
      [2, `${SEASON} - Rainbow GMO / Sungrown / 2nd Cut`, true, 2, 0, 2],
    ]);
    assert.deepEqual(r.unmatched_variants ?? r.data?.unmatched_variants, []);
  } finally { pool.restore(); }
});
