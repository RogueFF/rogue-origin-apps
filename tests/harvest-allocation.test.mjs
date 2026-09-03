/**
 * Weight allocation — sharing the trim floor's day across the bags opened.
 *
 * Nobody weighs a supersack's output. The floor records a day's total per
 * strain in `supersack_entries`, and each tagged bag opened that day takes a
 * share. This pins the parts of that which are easy to get quietly wrong:
 *
 *  - ALL FIVE PARTS travel, not just tops and smalls. A sack breaks into tops,
 *    smalls, biomass and trim; recording two of them threw away most of what a
 *    lot produced (Koa, 2026-09-02).
 *  - WASTE IS DERIVED. `supersack_entries` computes it as the remainder of
 *    37 lb, so it absorbs every error in the other four. It is carried, and it
 *    is labelled — it must never be presented as a weighed figure.
 *  - THE DIVISOR IS THE TAGGED COUNT, and a disagreement with the floor's own
 *    sack count is reported. Dividing quietly by the smaller of the two
 *    over-credits every bag, invisibly and permanently.
 *  - SEASON IS PART OF THE KEY. The floor spends part of 2026 trimming 2025
 *    material; that output must not land on 2026 bags.
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

const { handleHarvestD1, runNightlyAllocation } = await import(
  join(REPO, 'workers/src/handlers/harvest-d1.js').replace(/\\/g, '/').replace(/^/, 'file:///')
);

const SEASON = new Date().getUTCFullYear();
const DAY = '2026-10-20';

const MIGRATIONS = [
  '0009-harvest-scan-log.sql', '0010-harvest-sacks.sql', '0011-harvest-sacks-void.sql',
  '0012-harvest-scan-log-cultivar.sql', '0013-harvest-crew-roster.sql',
  '0014-harvest-sack-notes.sql', '0015-harvest-sacks-per-cultivar-serial.sql',
  '0016-harvest-sacks-sku.sql', '0017-harvest-sacks-shopify-sync.sql',
  '0018-harvest-sacks-shopify-add.sql', '0019-harvest-sacks-weight-source.sql',
  '0027-harvest-sacks-all-parts.sql',
];

function freshDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) {
    const stripped = readFileSync(join(REPO, 'workers/migrations', f), 'utf8')
      .split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
    for (const stmt of stripped.split(';')) { const t = stmt.trim(); if (t) sqlite.exec(t); }
  }
  // The floor's daily row, and the alias table the strain title resolves through.
  sqlite.exec(`CREATE TABLE supersack_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, strain TEXT NOT NULL,
    sacks_opened INTEGER NOT NULL DEFAULT 0, tops_lbs REAL NOT NULL DEFAULT 0,
    smalls_lbs REAL NOT NULL DEFAULT 0, biomass_lbs REAL NOT NULL DEFAULT 0,
    trim_lbs REAL NOT NULL DEFAULT 0, waste_lbs REAL NOT NULL DEFAULT 0,
    raw_lbs REAL NOT NULL DEFAULT 0, UNIQUE(date, strain))`);
  sqlite.exec('CREATE TABLE cultivars (id INTEGER PRIMARY KEY, name TEXT)');
  sqlite.exec('CREATE TABLE cultivar_aliases (alias TEXT, cultivar_id INTEGER)');
  sqlite.exec("INSERT INTO cultivars (id, name) VALUES (1, 'Sour Lifter'), (2, 'Lifter')");

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

/** The floor's row for a day. `waste` defaults to the real residual of 37/sack. */
function seedFloor(sqlite, { day = DAY, strain, sacks, tops, smalls, biomass = 0, trim = 0, waste = null }) {
  const raw = sacks * 37;
  const w = waste === null ? Math.max(0, raw - tops - smalls - biomass - trim) : waste;
  sqlite.prepare(`INSERT INTO supersack_entries
    (date, strain, sacks_opened, tops_lbs, smalls_lbs, biomass_lbs, trim_lbs, waste_lbs, raw_lbs)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(day, strain, sacks, tops, smalls, biomass, trim, w, raw);
}

function seedAlias(sqlite, alias, cultivarId) {
  sqlite.prepare('INSERT INTO cultivar_aliases (alias, cultivar_id) VALUES (?, ?)').run(alias, cultivarId);
}

/** Tagged bags, opened on `day`. */
function seedOpenedSacks(sqlite, { n, cultivar, season = SEASON, day = DAY }) {
  const from = Number(sqlite.prepare('SELECT COALESCE(MAX(serial),0) AS m FROM harvest_sacks').get().m) + 1;
  for (let i = 0; i < n; i++) {
    const serial = from + i;
    sqlite.prepare(`INSERT INTO harvest_sacks
      (sack_id, season, serial, zone, cultivar, cut_number, opened_at, is_test)
      VALUES (?, ?, ?, 'Z4', ?, 1, ?, 1)`)
      .run(`T-${serial}`, season, serial, cultivar, `${day} 09:00:00`);
  }
}

const allocate = (env, ctx, day = DAY) => handleHarvestD1(
  new Request(`https://x/api/harvest?action=allocate&date=${day}`), env, ctx)
  .then(r => r.json()).then(b => b.data || b);

const sackRows = (sqlite) => sqlite.prepare('SELECT * FROM harvest_sacks ORDER BY serial').all();

before(function () {
  if (!DatabaseSync) this.skip('node:sqlite unavailable (needs Node >= 22.5)');
});

// --- all five parts ---------------------------------------------------------

test('every part of the sack is shared out, not just tops and smalls', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedAlias(sqlite, `${SEASON} - Sour Lifter / Sungrown`, 1);
  // 4 sacks = 148 lb raw. tops 84, smalls 48, biomass 8, trim 4 -> waste 4.
  seedFloor(sqlite, { strain: `${SEASON} - Sour Lifter / Sungrown`, sacks: 4, tops: 84, smalls: 48, biomass: 8, trim: 4 });
  seedOpenedSacks(sqlite, { n: 4, cultivar: 'Sour Lifter' });

  await allocate(env, ctx);

  for (const row of sackRows(sqlite)) {
    assert.equal(row.tops_lbs, 21);
    assert.equal(row.smalls_lbs, 12);
    assert.equal(row.biomass_lbs, 2);
    assert.equal(row.trim_lbs, 1);
    assert.equal(row.waste_lbs, 1);
    assert.equal(row.weights_source, 'allocated');
    // True by construction, not a reconciliation: waste is defined as the
    // remainder of 37. Asserted only to show the parts account for the sack.
    const sum = row.tops_lbs + row.smalls_lbs + row.biomass_lbs + row.trim_lbs + row.waste_lbs;
    assert.equal(Math.round(sum * 10) / 10, 37);
  }
});

test('the result reports the floor day and the per-sack share for every part', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedAlias(sqlite, `${SEASON} - Lifter / Sungrown`, 2);
  seedFloor(sqlite, { strain: `${SEASON} - Lifter / Sungrown`, sacks: 2, tops: 40, smalls: 20, biomass: 6, trim: 2 });
  seedOpenedSacks(sqlite, { n: 2, cultivar: 'Lifter' });

  const res = await allocate(env, ctx);
  const row = res.allocated.find(a => a.cultivar === 'Lifter');
  assert.deepEqual(row.per_sack, { tops: 20, smalls: 10, biomass: 3, trim: 1, waste: 3 });
  assert.equal(row.floor.biomass, 6);
  // The basis line travels with the numbers, so a reader of the raw API is
  // told waste is derived without having to find the source.
  assert.match(res.basis, /Waste is a derived residual/);
});

// --- the divisor, and the cross-check ---------------------------------------

test('a floor/tagged count disagreement is reported, not silently divided', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedAlias(sqlite, `${SEASON} - Sour Lifter / Sungrown`, 1);
  // The floor opened 10 sacks; only 6 carry tags. Dividing by 6 credits each
  // tagged bag with ~67% more than it produced.
  seedFloor(sqlite, { strain: `${SEASON} - Sour Lifter / Sungrown`, sacks: 10, tops: 200, smalls: 100 });
  seedOpenedSacks(sqlite, { n: 6, cultivar: 'Sour Lifter' });

  const res = await allocate(env, ctx);
  assert.equal(res.sack_count_mismatches.length, 1);
  const m = res.sack_count_mismatches[0];
  assert.equal(m.floor_sacks_opened, 10);
  assert.equal(m.tagged_bags_opened, 6);
  assert.match(m.effect, /67% high/);

  // Still divided by the TAGGED count — those are the bags being written.
  assert.equal(sackRows(sqlite)[0].tops_lbs, Math.round((200 / 6) * 100) / 100);
});

test('a tracker row with weights but no sack count is caught, not skipped', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedAlias(sqlite, `${SEASON} - Lifter / Sungrown`, 2);
  // Real pounds, sacks_opened left at its NOT NULL DEFAULT 0 — what a
  // back-entered row looks like when someone fills weights and forgets the
  // count. Skipping the check here would be a silent pass.
  seedFloor(sqlite, { strain: `${SEASON} - Lifter / Sungrown`, sacks: 0, tops: 60, smalls: 30, waste: 0 });
  seedOpenedSacks(sqlite, { n: 3, cultivar: 'Lifter' });

  const res = await allocate(env, ctx);
  assert.equal(res.sack_count_mismatches.length, 1);
  assert.equal(res.sack_count_mismatches[0].floor_sacks_opened, 0);
  assert.match(res.sack_count_mismatches[0].effect, /3 tagged bag\(s\) the floor did not count/);
  // The share is still written — the pounds are real, only the count is missing.
  assert.equal(sackRows(sqlite)[0].tops_lbs, 20);
});

test('matching counts raise nothing', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedAlias(sqlite, `${SEASON} - Lifter / Sungrown`, 2);
  seedFloor(sqlite, { strain: `${SEASON} - Lifter / Sungrown`, sacks: 3, tops: 60, smalls: 30 });
  seedOpenedSacks(sqlite, { n: 3, cultivar: 'Lifter' });

  assert.deepEqual((await allocate(env, ctx)).sack_count_mismatches, []);
});

// --- what must not happen ---------------------------------------------------

test("last season's floor output never lands on this season's bags", async () => {
  const { sqlite, env, ctx } = freshDb();
  seedAlias(sqlite, '2025 - Lifter / Sungrown', 2);
  seedFloor(sqlite, { strain: '2025 - Lifter / Sungrown', sacks: 4, tops: 80, smalls: 40 });
  seedOpenedSacks(sqlite, { n: 4, cultivar: 'Lifter', season: SEASON });

  const res = await allocate(env, ctx);
  assert.match(res.allocated[0].skipped, /floor logged no/);
  assert.equal(sackRows(sqlite)[0].tops_lbs, null);
  // And the orphaned output is surfaced rather than dropped.
  assert.equal(res.floor_output_without_tagged_bags.length, 1);
});

test('a strain with no alias is reported, never guessed at', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedFloor(sqlite, { strain: `${SEASON} - Mystery Kush / Sungrown`, sacks: 2, tops: 40, smalls: 20 });
  seedOpenedSacks(sqlite, { n: 2, cultivar: 'Sour Lifter' });

  const res = await allocate(env, ctx);
  assert.deepEqual(res.unresolved_floor_strains, [`${SEASON} - Mystery Kush / Sungrown`]);
  assert.equal(sackRows(sqlite)[0].tops_lbs, null);
});

test('a bag actually weighed is left alone', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedAlias(sqlite, `${SEASON} - Lifter / Sungrown`, 2);
  seedFloor(sqlite, { strain: `${SEASON} - Lifter / Sungrown`, sacks: 2, tops: 40, smalls: 20 });
  seedOpenedSacks(sqlite, { n: 2, cultivar: 'Lifter' });
  sqlite.prepare("UPDATE harvest_sacks SET tops_lbs = 99, weights_source = 'measured' WHERE serial = 1").run();

  await allocate(env, ctx);
  const rows = sackRows(sqlite);
  assert.equal(rows[0].tops_lbs, 99, 'a real weighing outranks a share of a day');
  assert.equal(rows[1].weights_source, 'allocated');
});

test('re-running replaces the share rather than compounding it', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedAlias(sqlite, `${SEASON} - Lifter / Sungrown`, 2);
  seedFloor(sqlite, { strain: `${SEASON} - Lifter / Sungrown`, sacks: 2, tops: 40, smalls: 20 });
  seedOpenedSacks(sqlite, { n: 2, cultivar: 'Lifter' });

  await allocate(env, ctx);
  await allocate(env, ctx);
  // Idempotence is what makes the nightly window safe to replay.
  assert.equal(sackRows(sqlite)[0].tops_lbs, 20);
});

// --- the nightly job --------------------------------------------------------

test('the nightly run replays a window, so a late floor row still lands', async () => {
  const { sqlite, env, ctx } = freshDb();
  const log = console.log, err = console.error;
  console.log = () => {}; console.error = () => {};
  try {
    // Four days back — well outside "yesterday", which is the whole point: a
    // supersack_entries row is entered by hand and can be back-entered.
    const day = new Date(Date.now() - 4 * 86400000).toISOString().substring(0, 10);
    seedAlias(sqlite, `${SEASON} - Lifter / Sungrown`, 2);
    seedFloor(sqlite, { day, strain: `${SEASON} - Lifter / Sungrown`, sacks: 2, tops: 40, smalls: 20 });
    seedOpenedSacks(sqlite, { n: 2, cultivar: 'Lifter', day });

    const summary = await runNightlyAllocation(env);
    assert.equal(summary.length, 7);
    assert.equal(summary.find(d => d.date === day).cultivars, 1);
    assert.equal(sackRows(sqlite)[0].tops_lbs, 20);
  } finally { console.log = log; console.error = err; }
});

test('the nightly run never allocates today, whose floor day is still open', async () => {
  const { sqlite, env, ctx } = freshDb();
  const log = console.log, err = console.error;
  console.log = () => {}; console.error = () => {};
  try {
    const today = new Date().toISOString().substring(0, 10);
    seedAlias(sqlite, `${SEASON} - Lifter / Sungrown`, 2);
    seedFloor(sqlite, { day: today, strain: `${SEASON} - Lifter / Sungrown`, sacks: 2, tops: 40, smalls: 20 });
    seedOpenedSacks(sqlite, { n: 2, cultivar: 'Lifter', day: today });

    const summary = await runNightlyAllocation(env);
    assert.ok(!summary.some(d => d.date === today), 'today must be out of the window');
    // Half a day allocated now would be overwritten tomorrow, and the ledger
    // would flicker for anyone reading it in between.
    assert.equal(sackRows(sqlite)[0].tops_lbs, null);
  } finally { console.log = log; console.error = err; }
});

test('one bad day does not stop the rest of the window', async () => {
  const { env } = freshDb();
  const log = console.log, err = console.error;
  console.log = () => {}; console.error = () => {};
  try {
    // No supersack_entries table reachable for one call: force a throw by
    // pointing at a DB whose prepare fails, and confirm the loop carries on.
    let calls = 0;
    const inner = env.DB.prepare.bind(env.DB);
    env.DB.prepare = (sql) => {
      if (++calls === 1) throw new Error('transient D1 blip');
      return inner(sql);
    };
    const summary = await runNightlyAllocation(env);
    assert.equal(summary.length, 7);
    assert.ok(summary.some(d => d.error), 'the failed day is recorded');
    assert.ok(summary.some(d => !d.error), 'the others still ran');
  } finally { console.log = log; console.error = err; }
});
