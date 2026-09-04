/**
 * Harvest capture, end to end through the REAL handler.
 *
 * The other harvest test (`barn-attribution.test.mjs`) covers the grace-window
 * maths as pure functions. This one drives `handleHarvestD1` / `handleBarnScan`
 * against an in-memory SQLite standing in for D1, because the two things most
 * worth protecting here are not decisions in a pure function — they are what
 * actually lands in a row and what the ledger does with it afterwards:
 *
 *  1. A trailer logged against a just-closed zone must record a NON-NULL
 *     `attributed_zone_session_id`. The lot ledger counts loads and bins by
 *     JOINING on that column, so a NULL does not put the bins on the wrong lot
 *     — it drops them off every lot. That is silent, and it is only visible
 *     months later when a zone's yield looks light.
 *
 *  2. `dry_lbs` must appear as soon as sacks are tagged, with nothing opened.
 *     The finished figures are gated on every sack off the lot being bucked,
 *     and trimming is order-driven, so that gate can hold for months. If dry
 *     weight ever starts waiting on the same gate, the ledger goes quiet for a
 *     whole season and nobody would notice from the unit tests.
 *
 * Run with `node --test`.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

// node:sqlite landed in Node 22.5. Skip rather than fail on an older runtime —
// a test that cannot run should say so, not look like a broken handler.
let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older Node */ }

const { handleHarvestD1, handleBarnScan } = await import(
  join(REPO, 'workers/src/handlers/harvest-d1.js').replace(/\\/g, '/').replace(/^/, 'file:///')
);

// The season the handler will pick for new rows, so seeded rows still match
// when this test is run in a later year.
const SEASON = new Date().getUTCFullYear();

// Every migration that shapes the harvest tables, in order. Listed rather than
// globbed: this test asserts on columns, so a new migration should make someone
// look at it rather than silently change what is under test.
const MIGRATIONS = [
  '0009-harvest-scan-log.sql', '0010-harvest-sacks.sql', '0011-harvest-sacks-void.sql',
  '0012-harvest-scan-log-cultivar.sql', '0013-harvest-crew-roster.sql',
  '0014-harvest-sack-notes.sql', '0015-harvest-sacks-per-cultivar-serial.sql',
  '0016-harvest-sacks-sku.sql', '0017-harvest-sacks-shopify-sync.sql',
  '0018-harvest-sacks-shopify-add.sql', '0019-harvest-sacks-weight-source.sql',
  '0027-harvest-sacks-all-parts.sql', '0028-harvest-sacks-bay.sql',
];

/**
 * A fresh database per test — these handlers write, and a shared one would let
 * an earlier test's rows decide a later test's answer.
 */
function freshDb() {
  const sqlite = new DatabaseSync(':memory:');

  // Strip `--` comments across the WHOLE file before splitting on `;`. The
  // migration comments contain semicolons of their own ("DELETE FROM
  // harvest_sacks WHERE is_test = 1;"), so splitting first shreds the real
  // statements sitting around them.
  for (const f of MIGRATIONS) {
    const stripped = readFileSync(join(REPO, 'workers/migrations', f), 'utf8')
      .split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
    for (const stmt of stripped.split(';')) {
      const t = stmt.trim();
      if (t) sqlite.exec(t);
    }
  }

  // Minimal D1 shim: prepare().bind().all() / .first() / .run()
  const DB = {
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

/** The handler narrates every load to Telegram, which is not what is under test. */
async function quiet(fn) {
  const log = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = log; }
}

/** A zone-entry session. `closedMinAgo: null` leaves it open. */
function seedEnter(sqlite, { zone, cultivar = null, openedMinAgo, closedMinAgo }) {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, occurred_at, closed_at, is_test)
    VALUES ('enter', ?, ?, ?, 1, datetime('now', ?), ${closedMinAgo === null ? 'NULL' : "datetime('now', ?)"}, 1)
  `).run(...(closedMinAgo === null
    ? [zone, cultivar, SEASON, `-${openedMinAgo} minutes`]
    : [zone, cultivar, SEASON, `-${openedMinAgo} minutes`, `-${closedMinAgo} minutes`]));
  return Number(sqlite.prepare('SELECT last_insert_rowid() AS id').get().id);
}

/** Serials are unique per season, so seeding two lots must not restart at 1. */
function seedSacks(sqlite, { n, zone, cultivar, sessionId }) {
  const from = Number(sqlite.prepare(
    'SELECT COALESCE(MAX(serial), 0) AS m FROM harvest_sacks').get().m) + 1;
  for (let i = 0; i < n; i++) {
    const serial = from + i;
    sqlite.prepare(`
      INSERT INTO harvest_sacks (sack_id, season, serial, zone, cultivar, cut_number, zone_session_id, is_test)
      VALUES (?, ?, ?, ?, ?, 1, ?, 1)
    `).run(`${String(SEASON).slice(2)}-TEST-${serial}`, SEASON, serial, zone, cultivar, sessionId);
  }
}

const logLoad = (env, ctx, zone, bins) => quiet(() => handleHarvestD1(
  new Request('https://x/api/harvest?action=barn_log&lang=en', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ zone, bins: String(bins) }),
  }), env, ctx));

const intakeForm = (env, ctx, lang = 'en') =>
  handleBarnScan(new Request(`https://x/b?lang=${lang}`), env, ctx).then(r => r.text());

const rollup = (env, ctx) => handleHarvestD1(
  new Request(`https://x/api/harvest?action=rollup&season=${SEASON}`), env, ctx).then(r => r.json());

const lastLoadRow = (sqlite) => sqlite.prepare(
  `SELECT * FROM harvest_scan_log WHERE event_type='barn_load' ORDER BY id DESC LIMIT 1`).get();

before(function () {
  if (!DatabaseSync) this.skip('node:sqlite unavailable (needs Node >= 22.5)');
});

// --- the in-transit trailer -------------------------------------------------

test('a load for a just-closed zone lands on that lot, not on nothing', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedEnter(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', openedMinAgo: 45, closedMinAgo: 2 });
  seedEnter(sqlite, { zone: 'Z5', cultivar: 'Lifter', openedMinAgo: 2, closedMinAgo: null });

  await logLoad(env, ctx, 'Z4', 20);

  const row = lastLoadRow(sqlite);
  assert.equal(row.attributed_zone_session_id, z4,
    'a NULL here drops the bins off every lot, not merely onto the wrong one');

  // The assertion that actually matters: the ledger's join must see them.
  const bins = sqlite.prepare(`
    SELECT COALESCE(SUM(bins), 0) AS bins FROM harvest_scan_log
    WHERE event_type = 'barn_load' AND attributed_zone_session_id = ?`).get(z4).bins;
  assert.equal(bins, 20);
});

test('the intake form pre-selects the zone before, and asks for a check', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedEnter(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', openedMinAgo: 45, closedMinAgo: 2 });
  seedEnter(sqlite, { zone: 'Z5', cultivar: 'Lifter', openedMinAgo: 2, closedMinAgo: null });

  const html = await intakeForm(env, ctx);
  assert.match(html, /<option value="Z4" selected/);
  assert.doesNotMatch(html, /<option value="Z5" selected/);
  // Phrased as a choice: on a fast double move the suggestion can be wrong, and
  // the barn is the only thing that can see which zone the trailer came from.
  assert.match(html, /change it if not/);
});

test('an ordinary load goes to the open lot with no correction note', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z5 = seedEnter(sqlite, { zone: 'Z5', cultivar: 'Lifter', openedMinAgo: 30, closedMinAgo: null });

  const html = await (await logLoad(env, ctx, 'Z5', 18)).text();
  assert.equal(lastLoadRow(sqlite).attributed_zone_session_id, z5);
  assert.doesNotMatch(html, /which just closed/);
});

test('a zone closed days ago takes no load, and the crew is warned', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedEnter(sqlite, { zone: 'Z9', cultivar: 'Lifter', openedMinAgo: 60 * 24 * 3, closedMinAgo: 60 * 24 * 3 });

  const html = await (await logLoad(env, ctx, 'Z9', 5)).text();
  assert.equal(lastLoadRow(sqlite).attributed_zone_session_id, null);
  // Losing the bins is acceptable; losing them SILENTLY is not.
  assert.match(html, /logged with no lot/);
});

test('the crew screens are Spanish by default', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedEnter(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', openedMinAgo: 45, closedMinAgo: 2 });
  seedEnter(sqlite, { zone: 'Z5', cultivar: 'Lifter', openedMinAgo: 2, closedMinAgo: null });

  const html = await intakeForm(env, ctx, 'es');
  assert.match(html, /Se preseleccionó <strong>Z4<\/strong>/);
  assert.match(html, /cámbialo si no/);
});

// --- dry weight at takedown -------------------------------------------------

test('dry lbs are reported with nothing bucked, while finished yield waits', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedEnter(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', openedMinAgo: 60, closedMinAgo: 30 });
  seedSacks(sqlite, { n: 5, zone: 'Z4', cultivar: 'Sour Lifter', sessionId: z4 });

  const lot = (await rollup(env, ctx)).lots.find(r => r.zone === 'Z4');
  assert.equal(lot.sacks, 5);
  assert.equal(lot.sacks_opened, 0);

  // Product is weighed into each sack at 37 lb, so this is a measurement and
  // needs neither bucking nor the floor's day.
  assert.equal(lot.dry_lbs, 185);
  assert.ok(lot.dry_lbs_per_acre > 0);
  assert.ok(lot.dry_lbs_per_plant > 0);

  // The finished figures legitimately wait — a partly-bucked lot would read as
  // a catastrophic yield miss. That gate must never spread to dry weight.
  assert.equal(lot.lbs_per_acre, null);
  assert.equal(lot.lbs_per_plant, null);
});

test('the dry figure carries its own convention, overstatement included', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedEnter(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', openedMinAgo: 60, closedMinAgo: 30 });
  seedSacks(sqlite, { n: 5, zone: 'Z4', cultivar: 'Sour Lifter', sessionId: z4 });

  const lot = (await rollup(env, ctx)).lots.find(r => r.zone === 'Z4');
  // The last sack of a lot goes out light and is counted as full. Stated on the
  // row rather than in documentation nobody reads next to the number.
  assert.match(lot.dry_lbs_basis, /up to 37 lb high/);
  assert.match(lot.dry_lbs_basis, /5 sacks/);
});

test('a lot with no sacks reports no dry weight rather than zero', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedEnter(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', openedMinAgo: 60, closedMinAgo: 30 });

  const lot = (await rollup(env, ctx)).lots.find(r => r.zone === 'Z4');
  // Absent data must read as absent. A 0 here is a lot that yielded nothing.
  assert.equal(lot.dry_lbs, null);
  assert.equal(lot.dry_lbs_per_acre, null);
  assert.equal(lot.dry_lbs_basis, null);
});

test('the lot ledger carries every part, with waste named as derived', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedEnter(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', openedMinAgo: 60, closedMinAgo: 30 });
  seedSacks(sqlite, { n: 2, zone: 'Z4', cultivar: 'Sour Lifter', sessionId: z4 });
  sqlite.prepare(`UPDATE harvest_sacks
    SET tops_lbs = 21, smalls_lbs = 12, biomass_lbs = 2, trim_lbs = 1, waste_lbs = 1,
        opened_at = datetime('now'), weights_source = 'allocated'`).run();

  const lot = (await rollup(env, ctx)).lots.find(r => r.zone === 'Z4');
  assert.equal(lot.biomass_lbs, 4);
  assert.equal(lot.trim_lbs, 2);
  // Named apart from the weighed parts, because it is a residual that absorbs
  // their error. A plain `waste_lbs` beside the rest would read as measured.
  assert.equal(lot.waste_lbs_derived, 2);
  // finished_lbs stays tops + smalls. Widening it to include biomass and trim
  // would silently change every lbs/acre figure already recorded against it.
  assert.equal(lot.finished_lbs, 66);
  assert.equal(lot.lbs_per_acre > 0, true);
});

test('season totals carry dry lbs from every tagged lot, opened or not', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedEnter(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', openedMinAgo: 90, closedMinAgo: 60 });
  const z5 = seedEnter(sqlite, { zone: 'Z5', cultivar: 'Lifter', openedMinAgo: 60, closedMinAgo: 30 });
  seedSacks(sqlite, { n: 5, zone: 'Z4', cultivar: 'Sour Lifter', sessionId: z4 });
  seedSacks(sqlite, { n: 3, zone: 'Z5', cultivar: 'Lifter', sessionId: z5 });

  const totals = (await rollup(env, ctx)).totals;
  assert.equal(totals.sacks, 8);
  assert.equal(totals.dry_lbs, 296);        // 8 x 37
  assert.equal(totals.tops_lbs, 0);         // nothing bucked yet
});
