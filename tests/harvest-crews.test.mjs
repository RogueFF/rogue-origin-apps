/**
 * Two cutting crews.
 *
 * Zone sessions used to be global. `getActiveSession` took the single most
 * recent open session with no scoping at all, and `handleEnter` closed it. So
 * crew B scanning Z7 closed crew A's Z4, and crew A's next trailer arrived at
 * the barn with no open session to attach to — falling outside the 6-minute
 * grace and recording NO attribution, which drops those bins off every lot.
 * Exactly the shape of the silent-capture bug found on 2026-09-04, except it
 * would happen all day rather than at zone boundaries.
 *
 * The crew tag rides on the crew lead's phone, because the zone signs are
 * printed and laminated for the season and cannot carry it. An untagged phone
 * is a legitimate state and must degrade to single-crew behaviour rather than
 * silently take over another crew's zone — the NULL-crew tests below are the
 * ones that pin that.
 *
 * The cut-number test is the sharp one. Two crews in a zone are cutting the
 * SAME plants, so they must land on the same cut, or one rack splits across two
 * lot numbers — and that number gets printed on a supersack tag.
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

const { handleHarvestD1, handleZoneScan, handleCrewScan, handleBarnScan } = await import(
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
  return { sqlite, env: { DB, HARVEST_TEST_MODE: 'true' }, ctx: { waitUntil() {} } };
}

const quiet = async (fn) => {
  const l = console.log, e = console.error;
  console.log = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = l; console.error = e; }
};

/** A crew lead scanning a zone sign from a phone carrying (or missing) a tag. */
const scanZone = (env, ctx, zone, crew) => quiet(() => handleZoneScan(
  new Request(`https://x/z/${zone}?lang=en`, {
    headers: crew ? { cookie: `rf_crew=${crew}` } : {},
  }), env, ctx));

const logLoad = (env, ctx, zone, bins) => quiet(() => handleHarvestD1(
  new Request('https://x/api/harvest?action=barn_log&lang=en', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ zone, bins: String(bins) }),
  }), env, ctx));

/** The barn tablet at a given door. No station = the single-intake /b of 2025. */
const barnForm = (env, ctx, station) => quiet(() => handleBarnScan(
  new Request(`https://x/b${station ? `/${station}` : ''}?lang=en`), env, ctx));

/** A load submitted from that door — station carried the way the form carries it. */
const logLoadAt = (env, ctx, zone, bins, station) => quiet(() => handleHarvestD1(
  new Request('https://x/api/harvest?action=barn_log&lang=en', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(station
      ? { zone, bins: String(bins), station: String(station) }
      : { zone, bins: String(bins) }),
  }), env, ctx));

const sessions = (sqlite) => sqlite.prepare(
  "SELECT * FROM harvest_scan_log WHERE event_type='enter' ORDER BY id").all();
const openSessions = (sqlite) => sessions(sqlite).filter(s => s.closed_at === null);
const lastLoad = (sqlite) => sqlite.prepare(
  "SELECT * FROM harvest_scan_log WHERE event_type='barn_load' ORDER BY id DESC LIMIT 1").get();

/** Backdate a session so it is not swallowed by the same-scan debounce. */
const backdate = (sqlite, id, minutes) => sqlite.prepare(
  `UPDATE harvest_scan_log SET occurred_at = datetime('now','-${minutes} minutes') WHERE id = ?`).run(id);

before(function () {
  if (!DatabaseSync) this.skip('node:sqlite unavailable (needs Node >= 22.5)');
});

// --- the failure this whole thing exists to stop -----------------------------

test("crew B entering a zone does not close crew A's", async () => {
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', 'A');
  await scanZone(env, ctx, 'Z7', 'B');

  const open = openSessions(sqlite);
  assert.equal(open.length, 2, 'two crews are cutting, so two zones are open');
  assert.deepEqual(open.map(s => `${s.crew}:${s.zone}`).sort(), ['A:Z4', 'B:Z7']);
});

test("crew A's trailer still lands on crew A's lot while crew B works elsewhere", async () => {
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', 'A');
  const z4 = openSessions(sqlite).find(s => s.zone === 'Z4');
  await scanZone(env, ctx, 'Z7', 'B');

  await logLoad(env, ctx, 'Z4', 22);

  // The bins, not the zone name, are what the ledger counts. A null here is not
  // a misplaced load — it is bins that belong to no lot at all.
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, z4.id);
});

test('a crew moving on still closes its OWN zone', async () => {
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', 'A');
  const z4 = openSessions(sqlite).find(s => s.zone === 'Z4');
  await scanZone(env, ctx, 'Z5', 'A');

  // Scoping must not turn into "nothing ever closes" — the chain of enters is
  // still how a crew leaves a zone.
  assert.ok(sessions(sqlite).find(s => s.id === z4.id).closed_at, 'Z4 should be closed');
  assert.deepEqual(openSessions(sqlite).map(s => s.zone), ['Z5']);
});

// --- an untagged phone ------------------------------------------------------

test('an untagged phone never closes a tagged crew\'s session', async () => {
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', 'A');
  await scanZone(env, ctx, 'Z7', null);        // spare handset, cleared cookie

  const open = openSessions(sqlite);
  assert.equal(open.length, 2);
  assert.ok(open.find(s => s.zone === 'Z4' && s.crew === 'A'));
  assert.ok(open.find(s => s.zone === 'Z7' && s.crew === null));
});

test('a tagged crew never closes an untagged session either', async () => {
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', null);
  await scanZone(env, ctx, 'Z7', 'B');

  assert.equal(openSessions(sqlite).length, 2);
});

test('with no crew tags at all, behaviour is exactly what it was', async () => {
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', null);
  await scanZone(env, ctx, 'Z7', null);

  // The whole season can run untagged and still work the way it did in 2025.
  assert.deepEqual(openSessions(sqlite).map(s => s.zone), ['Z7']);
});

// --- one zone, two crews ----------------------------------------------------

test('two crews in one zone join the SAME cut', async () => {
  const { sqlite, env, ctx } = freshDb();
  // Z4 cut 1 finished a month ago, so the last CLOSED session says "cut 1".
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, occurred_at, closed_at, is_test)
    VALUES ('enter', 'Z4', 'Sour Lifter', ?, 1, datetime('now','-30 days'), datetime('now','-30 days'), 1)
  `).run(SEASON);

  await scanZone(env, ctx, 'Z4', 'A');
  await scanZone(env, ctx, 'Z4', 'B');

  const open = openSessions(sqlite);
  assert.equal(open.length, 2, "crew B must not be swallowed by crew A's debounce");
  // Both are cutting cut 2. Reading only the last CLOSED session would have
  // given crew B cut 3 — one rack of plants split across two lot numbers, one
  // of which gets printed on a tag.
  assert.deepEqual(open.map(s => s.cut_number), [2, 2]);
});

test('a crew returning next morning rejoins the cut its partner is still on', async () => {
  const { sqlite, env, ctx } = freshDb();
  // Crew A cut Z4 yesterday and moved on at the end of the day, closing its
  // session 15 hours ago — well past CUT_RESUME_GRACE_HOURS. Crew B is still
  // in Z4 on that same cut.
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, occurred_at, closed_at, crew, is_test)
    VALUES ('enter', 'Z4', 'Sour Lifter', ?, 1, datetime('now','-20 hours'), datetime('now','-15 hours'), 'A', 1)
  `).run(SEASON);
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, occurred_at, closed_at, crew, is_test)
    VALUES ('enter', 'Z4', 'Sour Lifter', ?, 1, datetime('now','-20 hours'), NULL, 'B', 1)
  `).run(SEASON);

  await scanZone(env, ctx, 'Z4', 'A');

  // Reading only the last CLOSED session gives 15 h since close, past the
  // 8-hour resume grace, and calls this cut 2 — a second lot number on the
  // same standing plants, printed onto whichever supersacks come off it.
  const fresh = sessions(sqlite).at(-1);
  assert.equal(fresh.cut_number, 1);

  const body = await handleHarvestD1(
    new Request(`https://x/api/harvest?action=rollup&season=${SEASON}`), env, ctx).then(r => r.json());
  const z4 = (body.lots || body.data?.lots || []).filter(l => l.zone === 'Z4');
  assert.equal(z4.length, 1, 'one cut, one lot, however many crews and days it took');
});

test('two crews in one zone make one lot in the ledger', async () => {
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', 'A');
  await scanZone(env, ctx, 'Z4', 'B');

  const body = await handleHarvestD1(
    new Request(`https://x/api/harvest?action=rollup&season=${SEASON}`), env, ctx).then(r => r.json());
  const z4 = (body.lots || body.data?.lots || []).filter(l => l.zone === 'Z4');

  assert.equal(z4.length, 1, 'same plants, same cut — two rows would claim the acreage twice');
  assert.equal(z4[0].session_ids.length, 2);
});

test('one crew re-scanning its own zone is still a resumption, not a new cut', async () => {
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', 'A');
  const first = openSessions(sqlite)[0];
  backdate(sqlite, first.id, 90);              // past the refresh debounce

  await scanZone(env, ctx, 'Z4', 'A');

  const all = sessions(sqlite);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map(s => s.cut_number), [1, 1], 'a re-scan must not invent cut 2');
});

// --- status ------------------------------------------------------------------

test('status reports both crews, not whichever scanned last', async () => {
  const { env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', 'A');
  await scanZone(env, ctx, 'Z7', 'B');

  const body = await handleHarvestD1(
    new Request('https://x/api/harvest?action=status'), env, ctx).then(r => r.json());
  const zones = (body.active_zones || body.data?.active_zones || []);

  assert.equal(zones.length, 2);
  assert.deepEqual(zones.map(z => `${z.crew}:${z.zone}`).sort(), ['A:Z4', 'B:Z7']);
});

// --- the crew card -----------------------------------------------------------

test('scanning the Crew A card tags the phone for the season', async () => {
  const { env, ctx } = freshDb();
  const res = await quiet(() => handleCrewScan(new Request('https://x/c/A?lang=en'), env, ctx));

  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie') || '';
  assert.match(cookie, /rf_crew=A/);
  assert.match(cookie, /Max-Age=31536000/, 'one card scan has to last the season');
  assert.match(await res.text(), /This phone is Crew A/);
});

test('the card does not clobber a language the crew lead chose', async () => {
  const { env, ctx } = freshDb();
  const res = await quiet(() => handleCrewScan(new Request('https://x/c/B?lang=en'), env, ctx));
  const all = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  const joined = all.join(' | ');
  assert.match(joined, /rf_crew=B/);
  assert.match(joined, /rf_lang=en/);
});

test('an unknown crew card is refused rather than guessed at', async () => {
  const { env, ctx } = freshDb();
  const res = await quiet(() => handleCrewScan(new Request('https://x/c/Q?lang=en'), env, ctx));
  assert.notEqual(res.status, 200);
  assert.doesNotMatch(res.headers.get('set-cookie') || '', /rf_crew/);
});

test('every crew screen shows which crew the phone is, so an untagged one is obvious', async () => {
  const { env, ctx } = freshDb();
  const tagged = await (await scanZone(env, ctx, 'Z4', 'A')).text();
  assert.match(tagged, /Crew A/);

  const { env: env2, ctx: ctx2 } = freshDb();
  const untagged = await (await scanZone(env2, ctx2, 'Z4', null)).text();
  assert.doesNotMatch(untagged, /Crew A|Crew B/);
});

// --- two barn intakes --------------------------------------------------------

test('each intake pre-selects the zone ITS crew is cutting', async () => {
  const { env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', 'A');
  await scanZone(env, ctx, 'Z7', 'B');

  const one = await (await barnForm(env, ctx, 1)).text();
  assert.match(one, /<option value="Z4" selected/);
  assert.doesNotMatch(one, /<option value="Z7" selected/);

  const two = await (await barnForm(env, ctx, 2)).text();
  assert.match(two, /<option value="Z7" selected/);
  assert.doesNotMatch(two, /<option value="Z4" selected/);
});

test('the door says which door it is', async () => {
  const { env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', 'A');
  const html = await (await barnForm(env, ctx, 2)).text();
  // Two intakes that look identical are two chances to log at the wrong one.
  assert.match(html, /Barn intake 2/);
  assert.match(html, /Crew B/);
});

test('a single unlabelled intake behaves exactly as it did', async () => {
  const { env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', 'A');
  const html = await (await barnForm(env, ctx, null)).text();
  // /b predates the stations and is still on a wall somewhere. It must fall
  // back to whichever zone is open rather than to "no crew" and nothing.
  assert.match(html, /<option value="Z4" selected/);
  assert.doesNotMatch(html, /Barn intake/);
});

test('scanning the door QR makes the tablet remember which door it is', async () => {
  const { env, ctx } = freshDb();
  const res = await barnForm(env, ctx, 2);
  const all = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  assert.match(all.join(' | '), /rf_barn=2/);
});

test("a load at intake 1 lands on crew A's lot while crew B cuts elsewhere", async () => {
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', 'A');
  const z4 = openSessions(sqlite).find(s => s.zone === 'Z4');
  await scanZone(env, ctx, 'Z7', 'B');

  await logLoadAt(env, ctx, 'Z4', 22, 1);
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, z4.id);
});

test('with both crews in one zone, each door lands on its own crew', async () => {
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', 'A');
  await scanZone(env, ctx, 'Z4', 'B');
  const [a, b] = ['A', 'B'].map(c => openSessions(sqlite).find(s => s.crew === c));

  await logLoadAt(env, ctx, 'Z4', 22, 1);
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, a.id);

  await logLoadAt(env, ctx, 'Z4', 18, 2);
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, b.id);
  // Both are the same lot in the ledger; the split is only kept so "which crew
  // moved more bins per cutter-hour" stays answerable after the season.
  assert.notEqual(a.id, b.id);
});

test('the load records which crew delivered it', async () => {
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', 'A');
  await logLoadAt(env, ctx, 'Z4', 22, 1);

  // Cannot be reconstructed after the season, so it is captured even though the
  // lot ledger folds the crews back together.
  assert.equal(lastLoad(sqlite).crew, 'A');
});

test("a load landing on the other crew's lot says so, rather than looking normal", async () => {
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', 'A');
  await scanZone(env, ctx, 'Z7', 'B');

  // Crew B's zone, logged at crew A's door: fine if a trailer really was moved,
  // a mis-tap otherwise, and only the person at the door can tell which.
  const html = await (await logLoadAt(env, ctx, 'Z7', 20, 1)).text();
  assert.match(html, /Crew B/);
  assert.match(html, /Check the zone if that is wrong/);
});

test('an ordinary load at the right door says nothing extra', async () => {
  const { env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', 'A');
  const html = await (await logLoadAt(env, ctx, 'Z4', 22, 1)).text();
  // A warning that fires on every load is a warning nobody reads.
  assert.doesNotMatch(html, /Check the zone if that is wrong/);
});

test("the 6-minute grace prefers this crew's just-closed zone", async () => {
  const { sqlite, env, ctx } = freshDb();
  // Crew A cut Z4 and moved to Z5 four minutes ago; crew B is in Z9. The
  // trailer at crew A's door was loaded in Z4 before they moved.
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, occurred_at, closed_at, crew, is_test)
    VALUES ('enter', 'Z4', 'Sour Lifter', ?, 1, datetime('now','-60 minutes'), datetime('now','-4 minutes'), 'A', 1)
  `).run(SEASON);
  const z4 = sessions(sqlite).at(-1);
  await scanZone(env, ctx, 'Z5', 'A');
  await scanZone(env, ctx, 'Z9', 'B');

  const html = await (await logLoadAt(env, ctx, 'Z4', 22, 1)).text();
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, z4.id,
    'a null here is bins that belong to no lot at all');
  assert.doesNotMatch(html, /logged with no lot/);
});
