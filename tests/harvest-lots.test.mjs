/**
 * A lot is not a session.
 *
 * A LOT is season x zone x cultivar x cut — the agronomic unit, the thing that
 * owns the acreage and the yield. A SESSION is one uninterrupted stretch of a
 * crew being in that zone. The ledger keyed on the session, so one lot could
 * produce two rows, each carrying the FULL zone acreage:
 *
 *     LOT-2026-Z4-SL-C1   session 1   acres 1.045
 *     LOT-2026-Z4-SL-C1   session 3   acres 1.045
 *
 * Every lb/ac figure for that lot then read low by however many times the zone
 * was entered. Two ways in:
 *
 *   1. One crew leaves a zone and comes back the same shift. Inside
 *      CUT_RESUME_GRACE_HOURS that is deliberately still the same cut, so the
 *      second entry is a second session of the same lot. This is not
 *      hypothetical — the 2025 log records "Finished Z8, partial Z7, partial
 *      Z5" as an ordinary day.
 *   2. From 2026, two cutting crews can work one zone at once. Same plants,
 *      same cut, two sessions.
 *
 * The headcount tests below are the sharp edge. Sessions do NOT aggregate the
 * same way in those two cases — one crew twice is not two crews — and a naive
 * sum or a naive max is wrong in one direction or the other. Anything that
 * makes both of them pass at once is doing the right thing.
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

// The ledger is password-gated — it carries per-lot yield and acreage for the
// whole season. Reading it in a test means saying so, same as the dashboard does.
const TEST_PW = 'test-password';

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
  return { sqlite, env: { DB, HARVEST_TEST_MODE: 'true', ORDERS_PASSWORD: TEST_PW }, ctx: { waitUntil() {} } };
}

/** One zone session. Minutes ago, so the fixtures read like a shift. */
function enter(sqlite, { zone, cultivar, cut = 1, openedMinAgo, closedMinAgo, headcount = null }) {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, occurred_at, closed_at, headcount, is_test)
    VALUES ('enter', ?, ?, ?, ?, datetime('now', ?), ${closedMinAgo === null ? 'NULL' : "datetime('now', ?)"}, ?, 1)
  `).run(...[
    zone, cultivar, SEASON, cut, `-${openedMinAgo} minutes`,
    ...(closedMinAgo === null ? [] : [`-${closedMinAgo} minutes`]),
    headcount,
  ]);
  return Number(sqlite.prepare('SELECT last_insert_rowid() AS id').get().id);
}

/**
 * A UTC timestamp for a wall-clock hour that is unambiguously mid-day Pacific.
 * 17:00-22:00 UTC is 10:00-15:00 PDT and 09:00-14:00 PST, so a fixture built
 * from it never straddles a Pacific midnight whatever time the suite runs at,
 * and stays put across the November DST change in the middle of harvest.
 */
function utcAt(daysAgo, utcHour, utcMin = 0) {
  const t = new Date(Date.now() - daysAgo * 86400000);
  t.setUTCHours(utcHour, utcMin, 0, 0);
  return t.toISOString().replace('T', ' ').substring(0, 19);
}

/** A session pinned to explicit UTC timestamps rather than "N minutes ago". */
function enterAt(sqlite, { zone, cultivar, cut = 1, opened, closed = null, headcount = null }) {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, occurred_at, closed_at, headcount, is_test)
    VALUES ('enter', ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(zone, cultivar, SEASON, cut, opened, closed, headcount);
  return Number(sqlite.prepare('SELECT last_insert_rowid() AS id').get().id);
}

const load = (sqlite, zone, bins, sessionId) => sqlite.prepare(`
  INSERT INTO harvest_scan_log (event_type, zone, season, bins, attributed_zone_session_id, occurred_at, is_test)
  VALUES ('barn_load', ?, ?, ?, ?, datetime('now'), 1)
`).run(zone, SEASON, bins, sessionId);

const sack = (sqlite, { zone, cultivar, cut = 1, sessionId, serial }) => sqlite.prepare(`
  INSERT INTO harvest_sacks (sack_id, season, serial, zone, cultivar, cut_number, zone_session_id, is_test)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1)
`).run(`T-${serial}`, SEASON, serial, zone, cultivar, cut, sessionId);

const lots = (env, ctx) => handleHarvestD1(
  new Request(`https://x/api/harvest?action=rollup&season=${SEASON}`,
    { headers: { authorization: TEST_PW } }), env, ctx)
  .then(r => r.json()).then(j => j.lots || j.data?.lots || []);

const picker = (env, ctx) => handleHarvestD1(
  new Request('https://x/api/harvest?action=sack_print&lang=en'), env, ctx).then(r => r.text());

/** The radio values the operator can actually pick, ignoring the bay <select>. */
const lotChoices = (html) =>
  [...html.matchAll(/name="session_id" value="(\d+)"/g)].map(m => Number(m[1]));

before(function () {
  if (!DatabaseSync) this.skip('node:sqlite unavailable (needs Node >= 22.5)');
});

// --- one crew, in and out and back again -------------------------------------

test('a zone left and returned to the same shift is ONE lot, not two', async () => {
  const { sqlite, env, ctx } = freshDb();
  // 6 cutters: an hour in Z4, an hour away in Z7, two hours back in Z4.
  const first = enter(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', openedMinAgo: 300, closedMinAgo: 240, headcount: 6 });
  enter(sqlite, { zone: 'Z7', cultivar: 'Sour Lifter', openedMinAgo: 240, closedMinAgo: 180, headcount: 6 });
  const second = enter(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', openedMinAgo: 180, closedMinAgo: 60, headcount: 6 });

  load(sqlite, 'Z4', 22, first);
  load(sqlite, 'Z4', 20, second);
  load(sqlite, 'Z4', 24, second);
  sack(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', sessionId: first, serial: 1 });
  sack(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', sessionId: second, serial: 2 });

  const z4 = (await lots(env, ctx)).filter(l => l.zone === 'Z4');
  assert.equal(z4.length, 1, 'two rows here means the lot claims its acreage twice');
  assert.deepEqual(z4[0].session_ids, [first, second]);
  assert.equal(z4[0].loads, 3);
  assert.equal(z4[0].bins, 66);
  assert.equal(z4[0].sacks, 2, 'sacks tagged under either session belong to the one lot');
  assert.equal(z4[0].acres, 1.045);
});

test('the same crew twice is still that one crew', async () => {
  const { sqlite, env, ctx } = freshDb();
  enter(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', openedMinAgo: 300, closedMinAgo: 240, headcount: 6 });
  enter(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', openedMinAgo: 180, closedMinAgo: 60, headcount: 6 });

  const lot = (await lots(env, ctx)).find(l => l.zone === 'Z4');
  assert.equal(lot.headcount, 6, 'summing sequential sessions would claim 12 cutters were in the field');
});

test('cutter-hours count time in the zone, not the span across a trip elsewhere', async () => {
  const { sqlite, env, ctx } = freshDb();
  // One Pacific morning: an hour in Z4, an hour in Z7, two hours back in Z4.
  enterAt(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', opened: utcAt(1, 17), closed: utcAt(1, 18), headcount: 6 });
  enterAt(sqlite, { zone: 'Z7', cultivar: 'Sour Lifter', opened: utcAt(1, 18), closed: utcAt(1, 19), headcount: 6 });
  enterAt(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', opened: utcAt(1, 19), closed: utcAt(1, 21), headcount: 6 });

  const lot = (await lots(env, ctx)).find(l => l.zone === 'Z4');
  // 1 h x 6 + 2 h x 6. The 4-hour span from first open to last close would give
  // 24 and would be charging Z4 for the hour the crew spent cutting Z7.
  assert.equal(lot.cutter_person_hours, 18);
  assert.equal(lot.cutter_person_hours_basis, null, 'nothing to withhold, so nothing to explain');
});

// --- two crews, one zone -----------------------------------------------------

test('two crews in one zone is ONE lot, with both their loads', async () => {
  const { sqlite, env, ctx } = freshDb();
  const a = enter(sqlite, { zone: 'Z9', cultivar: 'Lifter', openedMinAgo: 240, closedMinAgo: 120, headcount: 6 });
  const b = enter(sqlite, { zone: 'Z9', cultivar: 'Lifter', openedMinAgo: 240, closedMinAgo: 120, headcount: 5 });
  load(sqlite, 'Z9', 18, a);
  load(sqlite, 'Z9', 15, b);

  const z9 = (await lots(env, ctx)).filter(l => l.zone === 'Z9');
  assert.equal(z9.length, 1, 'same plants, same cut — splitting it would halve every per-acre figure');
  assert.equal(z9[0].loads, 2);
  assert.equal(z9[0].bins, 33);
});

test('crews working at the same time DO add up', async () => {
  const { sqlite, env, ctx } = freshDb();
  enterAt(sqlite, { zone: 'Z9', cultivar: 'Lifter', opened: utcAt(1, 18), closed: utcAt(1, 20), headcount: 6 });
  enterAt(sqlite, { zone: 'Z9', cultivar: 'Lifter', opened: utcAt(1, 18), closed: utcAt(1, 20), headcount: 5 });

  const lot = (await lots(env, ctx)).find(l => l.zone === 'Z9');
  // The counterpart to the sequential test above: taking the max would report 6
  // and lose a whole crew. Peak concurrent is the only rule that fits both.
  assert.equal(lot.headcount, 11);
  assert.equal(lot.cutter_person_hours, 22);
  assert.match(lot.headcount_basis, /peak across 2 sessions \(6 \+ 5\)/);
});

test('a single-session lot reports its headcount plainly, with no basis note', async () => {
  const { sqlite, env, ctx } = freshDb();
  enter(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', openedMinAgo: 120, closedMinAgo: 60, headcount: 7 });

  const lot = (await lots(env, ctx)).find(l => l.zone === 'Z4');
  assert.equal(lot.headcount, 7);
  assert.equal(lot.headcount_basis, null, 'the explanation is noise when there is nothing to explain');
  assert.deepEqual(lot.session_ids.length, 1);
});

test('a lot the crew slept on withholds its cutter-hours, and says so', async () => {
  const { sqlite, env, ctx } = freshDb();
  // The last zone of the day is where they pick up next morning, so nothing
  // closes the session until they move on — it runs 16:30 Pacific through to
  // 08:00 the following day.
  enterAt(sqlite, {
    zone: 'Z4', cultivar: 'Sour Lifter',
    opened: utcAt(2, 23, 30), closed: utcAt(1, 15), headcount: 6,
  });

  const lot = (await lots(env, ctx)).find(l => l.zone === 'Z4');
  assert.equal(lot.sessions[0].spans_days, true);
  // ~15.5 h x 6 = 93 cutter-hours, most of it the crew asleep. Reporting that
  // is worse than reporting nothing.
  assert.equal(lot.cutter_person_hours, null);
  assert.match(lot.cutter_person_hours_basis, /overnight/);
  assert.match(lot.cutter_person_hours_basis, /cutting-day window is not set/);
});

test('an ordinary Pacific afternoon is not mistaken for an overnight', async () => {
  const { sqlite, env, ctx } = freshDb();
  // 23:00 UTC to 01:00 UTC the next day is 16:00-18:00 Pacific on ONE afternoon
  // (15:00-17:00 in PST). Timestamps are stored UTC, so judging the day there
  // would withhold the hours from every late-afternoon session of the season —
  // which is most of them.
  enterAt(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', opened: utcAt(2, 23), closed: utcAt(1, 1), headcount: 6 });

  const lot = (await lots(env, ctx)).find(l => l.zone === 'Z4');
  assert.equal(lot.sessions[0].spans_days, false);
  assert.equal(lot.cutter_person_hours, 12);
});

test('the cutting-day window is declared as a known gap, not left implicit', async () => {
  const { sqlite, env, ctx } = freshDb();
  enter(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', openedMinAgo: 120, closedMinAgo: 60, headcount: 6 });

  const body = await handleHarvestD1(
    new Request(`https://x/api/harvest?action=rollup&season=${SEASON}`,
      { headers: { authorization: TEST_PW } }), env, ctx).then(r => r.json());
  const c = (body.constants || body.data?.constants).harvestDayLimits;
  // Same treatment as the uncalibrated bin weight: listed, pending, and paired
  // with what it would unblock, so it cannot quietly become someone's guess.
  assert.equal(c.value, null);
  assert.equal(c.pending, true);
  assert.match(c.unblocks, /cutter person-hours/);
});

test('an unfinished session leaves the lot with no cutter-hours at all', async () => {
  const { sqlite, env, ctx } = freshDb();
  enter(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', openedMinAgo: 300, closedMinAgo: 240, headcount: 6 });
  enter(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', openedMinAgo: 180, closedMinAgo: null, headcount: 6 });

  const lot = (await lots(env, ctx)).find(l => l.zone === 'Z4');
  // Reporting only the closed stretch would understate the lot while looking
  // like a finished figure. Null says "not yet", which is the truth.
  assert.equal(lot.cutter_person_hours, null);
});

// --- what stays separate -----------------------------------------------------

test('different cuts of one zone stay different lots', async () => {
  const { sqlite, env, ctx } = freshDb();
  enter(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', cut: 1, openedMinAgo: 60 * 24 * 30, closedMinAgo: 60 * 24 * 30, headcount: 6 });
  enter(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', cut: 2, openedMinAgo: 120, closedMinAgo: 60, headcount: 6 });

  const z4 = (await lots(env, ctx)).filter(l => l.zone === 'Z4');
  assert.equal(z4.length, 2, 'a second cut is new growth — merging it would fuse two harvests');
  assert.deepEqual(z4.map(l => l.cut_number).sort(), [1, 2]);
});

test('two cultivars in a trial zone stay different lots', async () => {
  const { sqlite, env, ctx } = freshDb();
  enter(sqlite, { zone: 'Z10', cultivar: 'Lemon', openedMinAgo: 240, closedMinAgo: 180, headcount: 6 });
  enter(sqlite, { zone: 'Z10', cultivar: 'Rocket Sauce', openedMinAgo: 180, closedMinAgo: 120, headcount: 6 });

  const z10 = (await lots(env, ctx)).filter(l => l.zone === 'Z10');
  assert.equal(z10.length, 2, 'the whole point of a trial zone is telling the cultivars apart');
});

// --- the takedown picker -----------------------------------------------------

test('the takedown picker offers a re-entered lot once, not once per session', async () => {
  const { sqlite, env, ctx } = freshDb();
  const first = enter(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', openedMinAgo: 60 * 24 * 10, closedMinAgo: 60 * 24 * 10, headcount: 6 });
  const second = enter(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', openedMinAgo: 60 * 24 * 10, closedMinAgo: 60 * 24 * 10, headcount: 6 });

  const html = await picker(env, ctx);
  const choices = lotChoices(html);
  // The code's own comment calls this the highest-stakes single input in the
  // system. Two identical cards means the operator's tags land on whichever one
  // their thumb hit, splitting one rack across two rows.
  assert.deepEqual(choices, [first], `expected only the primary session, got ${JSON.stringify(choices)}`);
  assert.ok(!choices.includes(second));
  assert.equal((html.match(/data-desc="Z4[^"]*"/g) || []).length, 1);
});

test('tags printed under either session make the lot read as already started', async () => {
  const { sqlite, env, ctx } = freshDb();
  const first = enter(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', openedMinAgo: 60 * 24 * 10, closedMinAgo: 60 * 24 * 10, headcount: 6 });
  const second = enter(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', openedMinAgo: 60 * 24 * 10, closedMinAgo: 60 * 24 * 10, headcount: 6 });
  // Tagged under the SECOND session only — the card hangs off the first.
  sack(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', sessionId: second, serial: 1 });

  const html = await picker(env, ctx);
  assert.deepEqual(lotChoices(html), [first]);
  // Ranking used to be done in SQL per session, which would have shown this lot
  // as untouched and invited a second, duplicate takedown of the same rack.
  assert.match(html, /data-level="started"/);
});
