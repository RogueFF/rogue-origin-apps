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
import { qrDataUri } from '../workers/src/lib/qr.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node < 22.5 */ }

const { handleHarvestD1, handleZoneScan, handleCrewScan, handleBarnScan,
  handleDayEndScan } = await import(
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
  '0030-harvest-load-bay.sql', '0031-harvest-sacks-storage.sql', '0034-harvest-lot-takedown-done.sql', '0035-harvest-sacks-serial-per-cut.sql', '0036-harvest-sack-notes-edit.sql', '0037-harvest-settings.sql', '0038-harvest-print-queue.sql',
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
  return { sqlite, env: { DB, HARVEST_TEST_MODE: 'true', ORDERS_PASSWORD: 'test-password' }, ctx: { waitUntil() {} } };
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
    new Request(`https://x/api/harvest?action=rollup&season=${SEASON}`,
      { headers: { authorization: 'test-password' } }), env, ctx).then(r => r.json());
  const z4 = (body.lots || body.data?.lots || []).filter(l => l.zone === 'Z4');
  assert.equal(z4.length, 1, 'one cut, one lot, however many crews and days it took');
});

test('two crews in one zone make one lot in the ledger', async () => {
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', 'A');
  await scanZone(env, ctx, 'Z4', 'B');

  const body = await handleHarvestD1(
    new Request(`https://x/api/harvest?action=rollup&season=${SEASON}`,
      { headers: { authorization: 'test-password' } }), env, ctx).then(r => r.json());
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

test('an unlabelled intake asks for a door instead of borrowing a zone', async () => {
  const { env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', 'A');
  const html = await (await barnForm(env, ctx, null)).text();
  assert.equal(/<option value="Z4" selected/.test(html), false);
  assert.ok(html.includes('/b/1?lang=en') && html.includes('/b/2?lang=en'));
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

test("a labelled door never attributes a load to the other crew", async () => {
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z7', 'B');
  await logLoadAt(env, ctx, 'Z7', 20, 1);
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, null);
  assert.equal(lastLoad(sqlite).crew, 'A');
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

test("before its own crew scans in, a door has no preselected zone", async () => {
  const { env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z7', 'B');
  const html = await (await barnForm(env, ctx, 1)).text();
  assert.equal(/<option value="Z7" selected/.test(html), false);
  assert.ok(html.includes('<option value="">Choose a zone</option>'));
});

test('a door showing its OWN crew\'s zone borrows nothing and says nothing', async () => {
  const { env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', 'A');
  await scanZone(env, ctx, 'Z7', 'B');

  const html = await (await barnForm(env, ctx, 1)).text();
  assert.match(html, /<option value="Z4" selected/);
  assert.doesNotMatch(html, /nothing open yet/);
});

test('a labelled door never defaults to an untagged session', async () => {
  const { env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z9', null);
  const html = await (await barnForm(env, ctx, 1)).text();
  assert.equal(/<option value="Z9" selected/.test(html), false);
});

test('the newly scanned zone wins over the previous zone during grace', async () => {
  const { env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', 'A');
  await scanZone(env, ctx, 'Z5', 'A');
  const html = await (await barnForm(env, ctx, 1)).text();
  assert.ok(/<option value="Z5" selected/.test(html));
  assert.equal(/<option value="Z4" selected/.test(html), false);
});

// --- the print sheet ---------------------------------------------------------

const codeSheet = (env, ctx) => handleHarvestD1(
  new Request('https://x/api/harvest?action=print_codes&lang=en'), env, ctx).then(r => r.text());

/**
 * What a phone camera would actually be pointed at.
 *
 * The QR is generated locally and inlined as a data: URI, so the target is no
 * longer readable out of the src — it rides in `data-qr`. Read that, AND check
 * the image really encodes it, so this cannot pass on a correct-looking
 * attribute over a wrong picture.
 */
const qrTargets = (html) => {
  const out = [];
  for (const m of html.matchAll(/<img[^>]*class="qr[^"]*"[^>]*>/g)) {
    const tag = m[0];
    const target = (tag.match(/data-qr="([^"]*)"/) || [])[1];
    const src = (tag.match(/src="([^"]*)"/) || [])[1];
    assert.ok(target, `QR image with no data-qr: ${tag.slice(0, 120)}`);
    assert.equal(src, qrDataUri(target),
      `the QR image does not encode its own data-qr target: ${target}`);
    out.push(target);
  }
  return out;
};

test('the print sheet encodes the real scan targets, not a description of them', async () => {
  const { env, ctx } = freshDb();
  const targets = qrTargets(await codeSheet(env, ctx));

  // A wrong URL here is the worst kind of typo available: it survives printing,
  // laminating and staking, and only shows up when a crew lead scans it in a
  // field in October.
  assert.deepEqual(targets, [
    'https://rogue-origin-api.roguefamilyfarms.workers.dev/c/A',
    'https://rogue-origin-api.roguefamilyfarms.workers.dev/c/B',
    'https://rogue-origin-api.roguefamilyfarms.workers.dev/fin',
    'https://rogue-origin-api.roguefamilyfarms.workers.dev/b/1',
    'https://rogue-origin-api.roguefamilyfarms.workers.dev/b/2',
  ]);
});

test('every code on the sheet is one this build actually accepts', async () => {
  const { env, ctx } = freshDb();
  for (const target of qrTargets(await codeSheet(env, ctx))) {
    const path = new URL(target).pathname;
    const req = () => new Request(`https://x${path}?lang=en`);
    const res = path.startsWith('/c/')
      ? await quiet(() => handleCrewScan(req(), env, ctx))
      : path === '/fin'
        ? await quiet(() => handleDayEndScan(req(), env, ctx))
        : await quiet(() => handleBarnScan(req(), env, ctx));
    assert.equal(res.status, 200, `${path} does not answer`);
  }
});

test('the sheet is one card per crew and one page per door', async () => {
  const { env, ctx } = freshDb();
  const html = await codeSheet(env, ctx);
  // Generated from CREWS and STATION_CREW rather than typed out, so a third
  // crew or a third intake grows the sheet instead of quietly going unprinted.
  // Two crew cards plus ONE end-of-day card — the crew tag lives on the lead's
  // phone, so a single code closes whichever crew scans it.
  assert.equal((html.match(/class="card"/g) || []).length, 3);
  // Two to a page and no more: a card is 4.6in and a letter page holds 9.35in
  // of them, so a third on the same sheet is cut in half at the fold.
  const cardPages = html.match(/class="sheet cards"/g) || [];
  assert.equal(cardPages.length, 2);
  assert.equal((html.match(/class="sheet door"/g) || []).length, 2);
  assert.match(html, /CUADRILLA A/);
  assert.match(html, /RECEPCI[ÓO]N 2/);
  assert.match(html, /Cuadrilla \/ Crew B/);
  assert.match(html, /FIN DEL D[ÍI]A/);
});

test('the sheet reads in Spanish first, like the screens the crew use', async () => {
  const { env, ctx } = freshDb();
  const html = await codeSheet(env, ctx);
  // The supersack tag is the deliberate exception to this, not the rule.
  assert.match(html, /Escan[ée]alo <strong>una vez<\/strong>/);
  assert.ok(html.includes('Registra cada carga sin salir de la pantalla.'));
});

test('the sheet does not fire the printer by itself', async () => {
  const { env, ctx } = freshDb();
  // The sack sheet auto-prints because a barn PC in kiosk mode runs it dozens
  // of times a day. This is printed once a season, onto card stock, by someone
  // who wants to choose the tray first.
  const html = await codeSheet(env, ctx);
  assert.ok(html.includes('onclick="window.print()"'));
  assert.equal(/<script[^>]*>[^<]*window\.print/.test(html), false);
});

test('the print sheet strips what the screen wrapper adds', async () => {
  const { env, ctx } = freshDb();
  const html = await codeSheet(env, ctx);

  // Neither of these shows up on screen, so nothing but a rule catches them:
  // the wrapper's body padding stacks on the @page margin and pushed the
  // second crew card onto its own sheet, and the language toggle would print
  // as a stray "ES" in the corner of a laminated sign.
  assert.match(html, /@media print \{[\s\S]*body \{ margin: 0; padding: 0; \}/);
  assert.match(html, /@media print \{[\s\S]*\.lang \{ display: none; \}/);
});

test('a crew card is sized to the card, not to the page', async () => {
  const { env, ctx } = freshDb();
  const html = await codeSheet(env, ctx);
  // Two 4.6in cards plus the gap fit a letter sheet at any sane margin preset.
  // Sizing the PAIR to fill the page fit only the default margins.
  assert.match(html, /\.card \{ height: 4\.6in;/);
  assert.doesNotMatch(html, /\.cards \{[^}]*height: 10in/);
});

test('open intake follows its crew, preserves an override, and logs repeatedly in place', async () => {
  const { chromium } = await import('@playwright/test');
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', 'A');
  await scanZone(env, ctx, 'Z7', 'B');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('https://x/**', async route => {
      const r = route.request();
      const request = new Request(r.url(), { method: r.method(), headers: r.headers(),
        ...(r.method() === 'POST' ? { body: r.postData() } : {}) });
      const response = await quiet(() => r.url().includes('/b/1')
        ? handleBarnScan(request, env, ctx) : handleHarvestD1(request, env, ctx));
      await route.fulfill({ status: response.status, contentType: response.headers.get('content-type'), body: await response.text() });
    });
    await page.goto('https://x/b/1?lang=en');
    await page.waitForFunction(() => document.getElementById('zone').value === 'Z4');
    await scanZone(env, ctx, 'Z5', 'A');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => document.getElementById('zone').value === 'Z5');
    await page.locator('#zone').selectOption('Z4');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#zone').inputValue(), 'Z4');
    await page.locator('#followCrew').click();
    await page.waitForFunction(() => document.getElementById('zone').value === 'Z5');
    await page.locator('#bay').selectOption('3');
    await page.locator('#bins').fill('18');
    await page.locator('#intakeForm button').click();
    await page.waitForFunction(() => document.getElementById('intakeReceipt').textContent.includes('Ready for another'));
    assert.equal(lastLoad(sqlite).zone, 'Z5');
    assert.equal(lastLoad(sqlite).crew, 'A');
    assert.equal(lastLoad(sqlite).bins, 18);
    assert.equal(await page.locator('#bins').inputValue(), '22');
    assert.equal(await page.locator('#bay').inputValue(), '3');
    await page.locator('#intakeForm button').click();
    await page.waitForFunction(() => document.getElementById('intakeReceipt').textContent.includes('Ready for another'));
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM harvest_scan_log WHERE event_type='barn_load'").get().n, 2);
    assert.equal(page.url(), 'https://x/b/1?lang=en');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

// --- the door names the lot when nothing is open -----------------------------
//
// Koa, 2026-09-17: "If a zone isn't automatically assigned (which it should be
// if cut-leads scan it in) they will be able to catch it at the door. Cutters
// notify the barn when new zones are started." A load that lands on no lot
// takes its bins off every lot's yield, silently.

const logLoadWithLot = (env, ctx, { zone, bins = 20, station = 1, lot }) => quiet(() => handleHarvestD1(
  new Request('https://x/api/harvest?action=barn_log&lang=en', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ zone, bins: String(bins), station: String(station), lot: String(lot) }),
  }), env, ctx));

const lotIdFor = (sqlite, zone) => sqlite.prepare(
  "SELECT id FROM harvest_scan_log WHERE event_type='enter' AND zone=? ORDER BY id DESC LIMIT 1").get(zone).id;

test('a load names its lot at the door, and lands on it', async () => {
  const { sqlite, env, ctx } = freshDb();
  // Crew A cut Z4 yesterday and has scanned nothing today; the trailer is only
  // arriving now, so nothing automatic can attribute it.
  await scanZone(env, ctx, 'Z4', 'A');
  const lot = lotIdFor(sqlite, 'Z4');
  sqlite.prepare("UPDATE harvest_scan_log SET occurred_at = datetime('now','-1 day'), closed_at = datetime('now','-20 hours') WHERE id = ?").run(lot);

  const plain = await logLoadAt(env, ctx, 'Z4', 22, 1);
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, null, 'without a lot it still lands on nothing');
  assert.match(await plain.text(), /logged with no lot/i);

  const html = await (await logLoadWithLot(env, ctx, { zone: 'Z4', bins: 20, lot })).text();
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, lot);
  assert.equal(lastLoad(sqlite).bins, 20);
  assert.match(html, /Logged to the lot you chose/);
});

test('a lot from another zone, or too old, is refused — the bins are not moved onto it', async () => {
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', 'A');
  const z4 = lotIdFor(sqlite, 'Z4');
  await scanZone(env, ctx, 'Z7', 'B');
  const before = sqlite.prepare("SELECT COUNT(*) AS n FROM harvest_scan_log WHERE event_type='barn_load'").get().n;

  // Z4's lot submitted with Z7 on the form: a mis-tap or a stale page.
  const wrongZone = await logLoadWithLot(env, ctx, { zone: 'Z7', bins: 20, lot: z4 });
  assert.ok(wrongZone.status >= 400);
  assert.match(await wrongZone.text(), /not in this zone|too old/i);

  sqlite.prepare("UPDATE harvest_scan_log SET occurred_at = datetime('now','-9 days') WHERE id = ?").run(z4);
  const tooOld = await logLoadWithLot(env, ctx, { zone: 'Z4', bins: 20, lot: z4 });
  assert.ok(tooOld.status >= 400);

  const nonsense = await logLoadWithLot(env, ctx, { zone: 'Z4', bins: 20, lot: 'abc' });
  assert.ok(nonsense.status >= 400);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM harvest_scan_log WHERE event_type='barn_load'").get().n,
    before, 'a refused load writes no row at all');
});

test('a named lot beats the automatic answer, including the other crew\'s open zone', async () => {
  const { sqlite, env, ctx } = freshDb();
  // Z4 is open under crew B. Door 1 (crew A) is holding a trailer from Z4's
  // earlier cut, which crew A cut and closed this morning.
  await scanZone(env, ctx, 'Z4', 'A');
  const mine = lotIdFor(sqlite, 'Z4');
  sqlite.prepare("UPDATE harvest_scan_log SET occurred_at = datetime('now','-6 hours'), closed_at = datetime('now','-5 hours') WHERE id = ?").run(mine);
  await scanZone(env, ctx, 'Z4', 'B');
  const theirs = lotIdFor(sqlite, 'Z4');

  await logLoadWithLot(env, ctx, { zone: 'Z4', bins: 18, lot: mine });
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, mine, "the door's choice wins over the open session");
  assert.notEqual(mine, theirs);
});

test('the form offers the picker only when the zone has nothing open', async () => {
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', 'A');
  const lot = lotIdFor(sqlite, 'Z4');

  const open = await (await barnForm(env, ctx, 1)).text();
  assert.match(open, /<div id="lotPick" hidden>/, 'Z4 is open, so there is nothing to ask');
  assert.match(open, new RegExp(`<option value="${lot}" data-zone="Z4"`), 'the lots are on the page for the no-script case');

  sqlite.prepare("UPDATE harvest_scan_log SET closed_at = datetime('now','-30 minutes') WHERE id = ?").run(lot);
  const closed = await (await barnForm(env, ctx, 1)).text();
  assert.match(closed, /<div id="lotPick">/, 'nothing open now, so the door is asked');
  assert.match(closed, /Which lot did this trailer come from\?/);
  assert.match(closed, /No lot — log it anyway/);
});

test('the status feed carries the recent lots the picker offers', async () => {
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', 'A');
  const lot = lotIdFor(sqlite, 'Z4');
  sqlite.prepare("UPDATE harvest_scan_log SET occurred_at = datetime('now','-9 days') WHERE id = ?").run(lot);
  await scanZone(env, ctx, 'Z7', 'B');

  const d = await handleHarvestD1(new Request('https://x/api/harvest?action=status'), env, ctx).then(r => r.json());
  const body = d.data || d;
  assert.deepEqual(body.recent_lots.map(l => l.zone), ['Z7'], 'a lot older than the window is not offered');
  assert.equal(body.recent_lots[0].closed_at, null);
});
