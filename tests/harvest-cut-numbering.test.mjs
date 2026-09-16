/**
 * Bag numbers restart for each cut.
 *
 * Koa, 2026-09-16: first cut and second cut are numbered separately — Rainbow
 * GMO Quik's first cut is #1-#15, and its second cut starts again at #1 — with
 * the cut printed large on the tag so two #1s can be told apart.
 *
 * What this suite holds:
 *
 * 1. EACH CUT COUNTS FROM 1, and one cut's tags never move the other's count.
 * 2. A FIRST-CUT ID NEVER CHANGES. "26-RAINGQ-1" is what the bags already tagged
 *    carry in their QR, so first cut keeps the plain form; later cuts carry the
 *    cut in the id ("26-RAINGQ-C2-1"), which is what keeps both #1s unique.
 * 3. THE DATABASE ALLOWS THE SAME NUMBER ONCE PER CUT, and still refuses a true
 *    duplicate within a cut.
 * 4. FIND reads a typed second-cut id, and a bare number offers both cuts.
 * 5. THE TAG shows the cut large, beside the number.
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

const MIGRATIONS = [
  '0009-harvest-scan-log.sql', '0010-harvest-sacks.sql', '0011-harvest-sacks-void.sql',
  '0012-harvest-scan-log-cultivar.sql', '0013-harvest-crew-roster.sql',
  '0014-harvest-sack-notes.sql', '0015-harvest-sacks-per-cultivar-serial.sql',
  '0016-harvest-sacks-sku.sql', '0017-harvest-sacks-shopify-sync.sql',
  '0018-harvest-sacks-shopify-add.sql', '0019-harvest-sacks-weight-source.sql',
  '0027-harvest-sacks-all-parts.sql', '0028-harvest-sacks-bay.sql',
  '0029-harvest-crew-tag.sql',
  '0030-harvest-load-bay.sql', '0031-harvest-sacks-storage.sql', '0034-harvest-lot-takedown-done.sql', '0035-harvest-sacks-serial-per-cut.sql', '0036-harvest-sack-notes-edit.sql',
];

function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) {
    const stripped = readFileSync(join(REPO, 'workers/migrations', f), 'utf8')
      .split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
    for (const stmt of stripped.split(';')) { const t = stmt.trim(); if (t) sqlite.exec(t); }
  }
  sqlite.exec('CREATE TABLE cultivars (id INTEGER PRIMARY KEY, name TEXT, sku_prefix TEXT)');
  sqlite.exec("INSERT INTO cultivars (id, name, sku_prefix) VALUES (1, 'Rainbow GMO Quik', 'RAINGQ'), (2, 'Sour Lifter', 'SLIFT')");
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

function seedLot(sqlite, { cultivar = 'Rainbow GMO Quik', cut = 1 } = {}) {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, occurred_at, closed_at, is_test)
    VALUES ('enter', 'Z8', ?, ?, ?, datetime('now','-12 days'), datetime('now','-11 days'), 1)
  `).run(cultivar, SEASON, cut);
  return Number(sqlite.prepare('SELECT last_insert_rowid() AS id').get().id);
}

const alloc = (env, ctx, body) => handleHarvestD1(new Request('https://x/api/harvest?action=sack_alloc', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}), env, ctx).then(r => r.json());

const get = (env, ctx, qs) => handleHarvestD1(new Request(`https://x/api/harvest?${qs}`), env, ctx)
  .then(async r => ({ status: r.status, html: await r.text() }));

const ids = (sqlite) => sqlite.prepare('SELECT sack_id FROM harvest_sacks ORDER BY id').all().map(r => r.sack_id);

before(function () {
  if (!DatabaseSync) this.skip('node:sqlite unavailable (needs Node >= 22.5)');
});

test('each cut counts from 1, and a first-cut id keeps its plain form', async () => {
  const { sqlite, env, ctx } = freshDb();
  const cut1 = seedLot(sqlite, { cut: 1 });
  const cut2 = seedLot(sqlite, { cut: 2 });

  await alloc(env, ctx, { session_id: cut1, cultivar: 'Rainbow GMO Quik', qty: 3 });
  const r = await alloc(env, ctx, { session_id: cut2, cultivar: 'Rainbow GMO Quik', qty: 2 });
  assert.deepEqual(r.ids, [`${YY}-RAINGQ-C2-1`, `${YY}-RAINGQ-C2-2`], 'second cut restarts at #1');
  await alloc(env, ctx, { session_id: cut1, cultivar: 'Rainbow GMO Quik', qty: 1 });

  assert.deepEqual(ids(sqlite), [
    `${YY}-RAINGQ-1`, `${YY}-RAINGQ-2`, `${YY}-RAINGQ-3`,
    `${YY}-RAINGQ-C2-1`, `${YY}-RAINGQ-C2-2`,
    `${YY}-RAINGQ-4`,
  ], "first cut carries on from its own last number, untouched by second cut's tags");
  assert.deepEqual(sqlite.prepare('SELECT cut_number, serial FROM harvest_sacks ORDER BY id').all().map(x => [x.cut_number, x.serial]),
    [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [1, 4]]);
});

test('a third cut restarts too, and each cultivar keeps its own numbers', async () => {
  const { sqlite, env, ctx } = freshDb();
  await alloc(env, ctx, { session_id: seedLot(sqlite, { cut: 3 }), cultivar: 'Rainbow GMO Quik', qty: 1 });
  await alloc(env, ctx, { session_id: seedLot(sqlite, { cultivar: 'Sour Lifter', cut: 2 }), cultivar: 'Sour Lifter', qty: 1 });
  assert.deepEqual(ids(sqlite), [`${YY}-RAINGQ-C3-1`, `${YY}-SLIFT-C2-1`]);
});

test('the database allows a number once per cut, and still refuses a duplicate within one', () => {
  const { sqlite } = freshDb();
  const ins = sqlite.prepare(`INSERT INTO harvest_sacks (sack_id, season, serial, cultivar_code, zone, cut_number, is_test)
                              VALUES (?, ?, 1, 'RAINGQ', 'Z8', ?, 1)`);
  ins.run(`${YY}-RAINGQ-1`, SEASON, 1);
  ins.run(`${YY}-RAINGQ-C2-1`, SEASON, 2);
  assert.throws(() => ins.run(`${YY}-RAINGQ-X-1`, SEASON, 2), /UNIQUE/, 'two second-cut #1s must fail loudly');
});

test('Find reads a typed second-cut id, and a bare number offers both cuts', async () => {
  const { sqlite, env, ctx } = freshDb();
  await alloc(env, ctx, { session_id: seedLot(sqlite, { cut: 1 }), cultivar: 'Rainbow GMO Quik', qty: 1 });
  await alloc(env, ctx, { session_id: seedLot(sqlite, { cut: 2 }), cultivar: 'Rainbow GMO Quik', qty: 1 });

  for (const typed of [`${YY}-RAINGQ-C2-1`, `${YY}-raingq-c2-01`, 'raingq-c2-1', '# RAINGQ-C2-001',`https://rogue-origin-api.roguefamilyfarms.workers.dev/s/${YY}-RAINGQ-C2-1`]) {
    const r = await get(env, ctx, `action=find&lang=en&q=${encodeURIComponent(typed)}`);
    assert.equal(r.status, 200, typed);
    assert.match(r.html, new RegExp(`${YY}-RAINGQ-C2-1`), typed);
  }
  const first = await get(env, ctx, `action=find&lang=en&q=RAINGQ-1`);
  assert.match(first.html, new RegExp(`${YY}-RAINGQ-1\\b`), 'the plain form is still first cut');
  assert.doesNotMatch(first.html, /C2-1/);

  const bare = await get(env, ctx, 'action=find&lang=en&q=1');
  assert.equal(bare.status, 300, 'two bags share #1, so it asks');
  assert.match(bare.html, /Rainbow GMO Quik #1 · Cut 1/);
  assert.match(bare.html, /Rainbow GMO Quik #1 · Cut 2/);
});

test('the tag prints the cut large beside the number, and not again in the small line', async () => {
  const { sqlite, env, ctx } = freshDb();
  await alloc(env, ctx, { session_id: seedLot(sqlite, { cut: 2 }), cultivar: 'Rainbow GMO Quik', qty: 1, bay: 8 });
  const { html } = await get(env, ctx, `action=sack_label&id=${YY}-RAINGQ-C2-1`);
  assert.match(html, /<div class="bagno"[^>]*>#1<\/div>\s*<div class="cutbox"><span class="ord">2ND<\/span><span class="cw">CUT<\/span><\/div>/);
  assert.match(html, new RegExp(`%2Fs%2F${YY}-RAINGQ-C2-1"`), 'the QR opens the second-cut bag');
  const meta = html.match(/<div class="meta">([^<]*)<\/div>/)[1];
  assert.doesNotMatch(meta, /Cut/, 'the cut is in the box, not repeated small');
  assert.match(meta, /Z8 · Bay 8/);

  const avery = await get(env, ctx, `action=sack_label&sheet=avery5163&id=${YY}-RAINGQ-C2-1`);
  assert.match(avery.html, /<span class="ord">2ND<\/span>/, 'the Avery sheet shows it too');
  assert.match(avery.html, /\.cutbox \{/, 'and carries the style for it');
});
