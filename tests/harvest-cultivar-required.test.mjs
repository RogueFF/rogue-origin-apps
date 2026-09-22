/**
 * The cultivar is picked, never guessed — and a wrong pick is fixable.
 *
 * Two R1 lots in September 2026 recorded a cultivar nobody cut. A lot is
 * zone x cultivar x cut, so a wrong cultivar is a wrong lot: the tags printed
 * against it carry the name, the Shopify variant it feeds is per-cultivar, and
 * every yield figure downstream is filed under a cultivar that was never in
 * that trailer. Nothing about the row looks wrong afterwards, which is what
 * makes it worth a test rather than a rule of thumb.
 *
 * The scan path asked already. These tests pin the two holes around it:
 *
 *   1. ?action=enter reaches handleEnter with whatever the query string
 *      carried, skipping the picker. It used to fill in the first name on the
 *      zone's list — right only by luck, and silent when wrong.
 *   2. A pick is one tap among seven on a phone in a field. The receipt now
 *      carries the same grid with the current lot marked, correcting the row
 *      IN PLACE rather than opening a second lot on top of the first.
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

const { handleHarvestD1, handleZoneScan } = await import(
  join(REPO, 'workers/src/handlers/harvest-d1.js').replace(/\\/g, '/').replace(/^/, 'file:///')
);

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

function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) {
    const stripped = readFileSync(join(REPO, 'workers/migrations', f), 'utf8')
      .split(/\r?\n/).map(l => l.replace(/--.*$/, '')).join('\n');
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
  return { sqlite, env: { DB, HARVEST_TEST_MODE: 'true', ORDERS_PASSWORD: 'test-password' }, ctx: { waitUntil() {} } };
}

const quiet = async (fn) => {
  const l = console.log, e = console.error;
  console.log = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = l; console.error = e; }
};

const sessions = (sqlite) => sqlite.prepare(
  `SELECT id, zone, cultivar, cut_number, closed_at FROM harvest_scan_log WHERE event_type = 'enter' ORDER BY id`
).all();

/** The QR on the zone sign. */
const scan = (env, ctx, path) => quiet(() => handleZoneScan(new Request(`https://x/z/${path}`), env, ctx));

/** The same screen reached as a URL — no picker in front of it. */
const api = (env, ctx, qs) => quiet(() => handleHarvestD1(new Request(`https://x/api/harvest?${qs}`), env, ctx));

// R1 holds seven cultivars; Animal Muffins is sixth, Orange Fritter first.
// Z4 holds only Sour Lifter.
const R1_FIRST = 'Orange Fritter';

before((t) => { if (!DatabaseSync) t.skip('node:sqlite unavailable (Node < 22.5)'); });

test('?action=enter on a multi-cultivar zone records nothing and asks', async () => {
  const { sqlite, env, ctx } = freshDb();

  const res = await api(env, ctx, 'action=enter&zone=R1&lang=en');
  const html = await res.text();

  assert.equal(sessions(sqlite).length, 0,
    'a zone entry with no cultivar must not open a lot — it used to open one under the first name on the list');
  assert.match(html, /7 cultivars planted here/, 'the picker comes back instead');
  assert.match(html, /cultivar=Animal%20Muffins/, 'every cultivar in the zone is offered');
  assert.doesNotMatch(html, new RegExp(`Entered R1`), 'nothing is reported as entered');
});

test('a single-cultivar zone still auto-fills — there is nothing to ask', async () => {
  const { sqlite, env, ctx } = freshDb();

  await api(env, ctx, 'action=enter&zone=Z4&lang=en');

  const rows = sessions(sqlite);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cultivar, 'Sour Lifter');
});

test('a cultivar that is not planted in the zone is refused, by scan or by URL', async () => {
  const { sqlite, env, ctx } = freshDb();

  const viaApi = await (await api(env, ctx, 'action=enter&zone=R1&cultivar=Lemon&lang=en')).text();
  assert.match(viaApi, /isn&#39;t planted in R1|isn't planted in R1/);

  const viaScan = await (await scan(env, ctx, 'R1?cultivar=Lemon&lang=en')).text();
  assert.match(viaScan, /isn&#39;t planted in R1|isn't planted in R1/);

  assert.equal(sessions(sqlite).length, 0, 'neither path opens a lot');
});

test('scanning the sign with a pick still opens the lot', async () => {
  const { sqlite, env, ctx } = freshDb();

  await scan(env, ctx, `R1?cultivar=${encodeURIComponent('Purple Snowman')}&lang=en`);

  const rows = sessions(sqlite);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cultivar, 'Purple Snowman');
});

test('the receipt offers the fix, with the current cultivar marked', async () => {
  const { env, ctx } = freshDb();

  const html = await (await scan(env, ctx, `R1?cultivar=${encodeURIComponent(R1_FIRST)}&lang=en`)).text();

  assert.match(html, /Wrong cultivar\?/, 'the way out is on the receipt, not on another screen');
  assert.match(html, /action=cultivar_fix/);
  assert.match(html, /class="btn sel" aria-pressed="true" href="[^"]*cultivar=Orange%20Fritter/,
    'the lot as it stands is the selected button');
});

test('a single-cultivar zone gets no fix block — there is nothing to change', async () => {
  const { env, ctx } = freshDb();

  const html = await (await scan(env, ctx, 'Z4?lang=en')).text();

  assert.doesNotMatch(html, /Wrong cultivar\?/);
});

test('the fix moves the lot in place rather than opening a second one', async () => {
  const { sqlite, env, ctx } = freshDb();
  await scan(env, ctx, `R1?cultivar=${encodeURIComponent('Animal Muffins')}&lang=en`);
  const [before_] = sessions(sqlite);

  const html = await (await api(env, ctx,
    `action=cultivar_fix&session_id=${before_.id}&cultivar=${encodeURIComponent('Orange Fritter')}&lang=en`)).text();

  const rows = sessions(sqlite);
  assert.equal(rows.length, 1, 'still one lot — a correction is not a new lot');
  assert.equal(rows[0].id, before_.id, 'and it is the same row');
  assert.equal(rows[0].cultivar, 'Orange Fritter');
  assert.equal(rows[0].closed_at, null, 'the crew is still cutting');
  assert.match(html, /Changed to Orange Fritter/);
});

test('the cut number is re-derived for the cultivar the lot turned out to be', async () => {
  const { sqlite, env, ctx } = freshDb();
  // Orange Fritter has been cut in R1 before, Animal Muffins has not.
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, is_test, occurred_at, closed_at)
    VALUES ('enter', 'R1', 'Orange Fritter', ?, 1, 1, datetime('now','-30 days'), datetime('now','-29 days'))
  `).run(new Date().getUTCFullYear());

  await scan(env, ctx, `R1?cultivar=${encodeURIComponent('Animal Muffins')}&lang=en`);
  const open = sessions(sqlite).at(-1);
  assert.equal(open.cut_number, 1, 'a first cut for Animal Muffins');

  await api(env, ctx,
    `action=cultivar_fix&session_id=${open.id}&cultivar=${encodeURIComponent('Orange Fritter')}&lang=en`);

  assert.equal(sessions(sqlite).at(-1).cut_number, 2,
    'as Orange Fritter it is the second cut — the cut number belongs to zone x cultivar, not to the row');
});

test('the fix refuses a cultivar that is not planted in the zone', async () => {
  const { sqlite, env, ctx } = freshDb();
  await scan(env, ctx, `R1?cultivar=${encodeURIComponent('Animal Muffins')}&lang=en`);
  const [row] = sessions(sqlite);

  const html = await (await api(env, ctx, `action=cultivar_fix&session_id=${row.id}&cultivar=Lemon&lang=en`)).text();

  assert.match(html, /isn&#39;t planted in R1|isn't planted in R1/);
  assert.equal(sessions(sqlite)[0].cultivar, 'Animal Muffins', 'the lot is untouched');
});

test('the fix refuses once the lot has tags — they carry the name', async () => {
  const { sqlite, env, ctx } = freshDb();
  await scan(env, ctx, `R1?cultivar=${encodeURIComponent('Animal Muffins')}&lang=en`);
  const [row] = sessions(sqlite);
  sqlite.prepare(`
    INSERT INTO harvest_sacks (sack_id, season, serial, zone, cultivar, cut_number, harvest_date, zone_session_id, is_test)
    VALUES ('26-ANIMMUF-1', ?, 1, 'R1', 'Animal Muffins', 1, date('now'), ?, 1)
  `).run(new Date().getUTCFullYear(), row.id);

  const html = await (await api(env, ctx,
    `action=cultivar_fix&session_id=${row.id}&cultivar=${encodeURIComponent('Orange Fritter')}&lang=en`)).text();

  assert.match(html, /already has 1 tag/);
  assert.equal(sessions(sqlite)[0].cultivar, 'Animal Muffins',
    'paper and database must not be allowed to disagree silently');
});

test('the fix refuses on a closed lot', async () => {
  const { sqlite, env, ctx } = freshDb();
  await scan(env, ctx, `R1?cultivar=${encodeURIComponent('Animal Muffins')}&lang=en`);
  const [row] = sessions(sqlite);
  sqlite.prepare(`UPDATE harvest_scan_log SET closed_at = datetime('now') WHERE id = ?`).run(row.id);

  const html = await (await api(env, ctx,
    `action=cultivar_fix&session_id=${row.id}&cultivar=${encodeURIComponent('Orange Fritter')}&lang=en`)).text();

  assert.match(html, /already closed/);
  assert.equal(sessions(sqlite)[0].cultivar, 'Animal Muffins');
});

test('a real lot cannot be corrected while the tracker is in test mode', async () => {
  const { sqlite, env, ctx } = freshDb();
  const live = { ...env, HARVEST_TEST_MODE: 'false' };
  await quiet(() => handleZoneScan(
    new Request(`https://x/z/R1?cultivar=${encodeURIComponent('Animal Muffins')}&lang=en`), live, ctx));
  const [row] = sessions(sqlite);
  assert.equal(row.cultivar, 'Animal Muffins');

  const html = await (await api(env, ctx,
    `action=cultivar_fix&session_id=${row.id}&cultivar=${encodeURIComponent('Orange Fritter')}&lang=en`)).text();

  assert.doesNotMatch(html, /Changed to/);
  assert.equal(sessions(sqlite)[0].cultivar, 'Animal Muffins',
    'test mode never writes to a real row');
});
