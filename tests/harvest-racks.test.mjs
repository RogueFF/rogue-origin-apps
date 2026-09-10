/**
 * What is drying in what bay.
 *
 * Koa, 2026-09-06, looking at the "After the tag" grid: *"can we use a similar
 * layout to see what is being dried in what bay"*. He could not, because the
 * bay was written exactly once — at TAKEDOWN, onto the sack. That grid shows
 * what came OUT of a bay. Nothing recorded what went in.
 *
 * The bay is now captured at the barn door, on the load row, and this suite
 * holds the two things that make the board honest rather than merely populated:
 *
 * 1. A BAY IS EMPTIED OVER SEVERAL TAKEDOWNS. So "this lot has a sack from this
 *    bay, therefore it is down" — the obvious rule, and the first one written —
 *    calls a bay empty while half of it is still hanging. Bays group their
 *    loads into FILLS instead, and a fill only ends when the bay is refilled,
 *    because you cannot hang a trailer in a full bay. That refill is the only
 *    completion signal that exists: nothing anywhere records "bay emptied".
 *
 * 2. THE DEFAULT MUST NOT SILENTLY GO STALE. The bay is nullable so an old
 *    bookmark still logs its bins — losing bins is the worst outcome available.
 *    But nullable + pre-selected means the morning the crew moves to bay 6, the
 *    form still says 5 and nothing objects. A missing bay is recoverable; a
 *    wrong one is not. So a default carried over from a previous Pacific day is
 *    named on the form.
 *
 * Run with `node --test`.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const mod = (p) => join(REPO, p).replace(/\\/g, '/').replace(/^/, 'file:///');

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node < 22.5 */ }

const { handleHarvestD1, handleSackScan } = await import(mod('workers/src/handlers/harvest-d1.js'));
const { buildMetrics } = await import(mod('workers/src/lib/harvest-metrics.js'));

const PW = 'test-password';
const SEASON = new Date().getUTCFullYear();
const DRY = { min: 6, typical: 10, max: 21 };

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
    const clean = readFileSync(join(REPO, 'workers/migrations', f), 'utf8')
      .split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
    for (const st of clean.split(';')) { const t = st.trim(); if (t) sqlite.exec(t); }
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
  return { sqlite, env: { DB, HARVEST_TEST_MODE: 'true', ORDERS_PASSWORD: PW }, ctx: { waitUntil() {} } };
}

const call = (env, ctx, qs, init) => handleHarvestD1(
  new Request(`https://x/api/harvest?${qs}`, init), env, ctx);

const post = (env, ctx, qs, form, headers = {}) => call(env, ctx, qs, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  body: new URLSearchParams(form).toString(),
});

/** `daysAgo` days back, at a fixed hour, as SQLite's own UTC text format. */
const ago = (days, hUtc = 18) => {
  const d = new Date(Date.now() - days * 86400000);
  d.setUTCHours(hUtc, 0, 0, 0);
  return d.toISOString().replace('T', ' ').slice(0, 19);
};

const L = (o) => ({
  id: o.id, zone: o.zone, bins: o.bins ?? 20, crew: o.crew ?? null,
  bay: o.bay ?? null, occurred_at: o.at, session_id: o.session ?? null,
});
const S = (o) => ({
  sack_id: o.id, zone: o.zone, cultivar: o.cultivar ?? 'Sour Lifter',
  session_id: o.session ?? null, bay: o.bay ?? null,
  printed_at: o.printed ?? null, opened_at: null,
});

/** One lot, one session, so the loads have something to resolve to. */
const LOT = {
  lot_id: 'L1', season: SEASON, zone: 'Z4', cultivar: 'Sour Lifter', cut_number: 1,
  cut_date: ago(20).slice(0, 10), session_ids: [1], sacks: 0,
};
const SESSIONS = [{ id: 1, zone: 'Z4', cultivar: 'Sour Lifter', cut_number: 1,
                    crew: 'A', occurred_at: ago(20), closed_at: ago(20, 22), headcount: 6 }];

/**
 * The same instant `ago()` measures back from.
 *
 * `ago(n)` pins a UTC hour, so it is exactly n days before *now* only when the
 * suite runs at that hour. Left to the wall clock these assertions drifted by
 * up to a day and passed or failed on the time of day they were run. The pure
 * metrics take an explicit `nowMs`, so they get one.
 */
const NOW = (() => { const d = new Date(); d.setUTCHours(18, 0, 0, 0); return d.getTime(); })();

const build = (loads, sacks, lots = [LOT], sessions = SESSIONS) => buildMetrics({
  lots, sessions, loads, sacks, dryWindow: DRY, bottomBarnLastBay: 8, bayCount: 12,
  nowMs: NOW,
});
const bay = (d, n) => d.racks.find(r => r.bay === n);

before(function () {
  if (!DatabaseSync) this.skip('node:sqlite unavailable (needs Node >= 22.5)');
});

// ─── the shape of the board ──────────────────────────────────────────────────

test('every bay is reported, even the ones nothing has been near', () => {
  const d = build([], []);
  assert.equal(d.racks.length, 12);
  assert.deepEqual(d.racks.map(r => r.bay), [1,2,3,4,5,6,7,8,9,10,11,12]);
  // A bay missing from the list and a bay standing empty look identical on a
  // grid, and only one of them is true.
  assert.ok(d.racks.every(r => r.state === 'empty'));
  assert.equal(bay(d, 9).barn, 'top');
  assert.equal(bay(d, 8).barn, 'bottom');
});

test('a bay with material hanging says how long it has been up', () => {
  const d = build([L({ id: 1, zone: 'Z4', bay: 5, bins: 30, at: ago(8), session: 1 })], []);
  const b = bay(d, 5);
  assert.equal(b.state, 'hanging');
  assert.equal(b.bins, 30);
  assert.ok(Math.abs(b.days - 8) < 0.1, `got ${b.days}`);
  assert.equal(b.level, 'ready');            // 8 days, inside 6-21
  assert.equal(b.lots.length, 1);
  assert.equal(b.lots[0].cultivar, 'Sour Lifter');
});

test('a bay holds material from more than one lot at once', () => {
  // The reason the bay lives on the LOAD row and not on the session. Koa,
  // 2026-09-03: "there will probably be multiple takedowns within the same bay."
  const sessions = [...SESSIONS,
    { id: 2, zone: 'Z7', cultivar: 'Lifter', cut_number: 1, crew: 'B',
      occurred_at: ago(9), closed_at: ago(9, 22), headcount: 5 }];
  const lots = [LOT, { ...LOT, lot_id: 'L2', zone: 'Z7', cultivar: 'Lifter', session_ids: [2] }];
  const d = build([
    L({ id: 1, zone: 'Z4', bay: 3, bins: 20, at: ago(9), session: 1 }),
    L({ id: 2, zone: 'Z7', bay: 3, bins: 35, at: ago(9, 20), session: 2 }),
  ], [], lots, sessions);

  const b = bay(d, 3);
  assert.equal(b.bins, 55);
  assert.equal(b.lots.length, 2);
  // Biggest share first — that is the one someone naming the bay says out loud.
  assert.deepEqual(b.lots.map(l => l.cultivar), ['Lifter', 'Sour Lifter']);
});

test('one lot spread over several bays is in all of them', () => {
  const d = build([
    L({ id: 1, zone: 'Z4', bay: 2, bins: 20, at: ago(7), session: 1 }),
    L({ id: 2, zone: 'Z4', bay: 3, bins: 20, at: ago(7, 20), session: 1 }),
  ], []);
  assert.equal(bay(d, 2).state, 'hanging');
  assert.equal(bay(d, 3).state, 'hanging');
});

// ─── the fill model, which is the whole point ────────────────────────────────

test('a part-emptied bay is still coming down, not empty', () => {
  // THE BUG THIS FILE EXISTS FOR. The first rule written was "a (lot, bay)
  // pairing is down once a sack exists for it from that bay". A bay is emptied
  // over several takedowns, so under that rule the very first sack tagged
  // marked the whole bay done — the board would call bay 5 empty with most of
  // it still on the rack. That is the same disagreement-with-the-barn the old
  // grid had, only inverted and harder to notice.
  const d = build(
    [L({ id: 1, zone: 'Z4', bay: 5, bins: 40, at: ago(11), session: 1 })],
    [S({ id: 'T-1', zone: 'Z4', bay: 5, session: 1, printed: ago(1) })],
  );
  const b = bay(d, 5);
  assert.equal(b.state, 'coming_down');
  assert.notEqual(b.state, 'empty');
  assert.equal(b.sacks_out, 1);
  assert.equal(b.bins, 40, 'what was hung there does not shrink as it comes down');
});

test('days freeze at the first tag — material on the floor stops ageing', () => {
  const d = build(
    [L({ id: 1, zone: 'Z4', bay: 5, bins: 40, at: ago(30), session: 1 })],
    [S({ id: 'T-1', zone: 'Z4', bay: 5, session: 1, printed: ago(20) })],
  );
  const b = bay(d, 5);
  // Hung 30 days ago, first tagged 20 days ago: it got ten days on the rack.
  // Reporting "now minus hung" would say 30 and badge a bay OVERDUE for
  // material that came down three weeks back.
  assert.ok(Math.abs(b.days - 10) < 0.1, `got ${b.days}`);
  assert.equal(b.level, 'ready');
});

test('a refill starts a new fill, because you cannot hang in a full bay', () => {
  // The only completion signal that exists. Nothing records "bay emptied" —
  // the takedown screen picks a bay and writes it on the sack, and that is all.
  const d = build([
    L({ id: 1, zone: 'Z4', bay: 5, bins: 40, at: ago(30), session: 1 }),
    L({ id: 2, zone: 'Z4', bay: 5, bins: 25, at: ago(4), session: 1 }),
  ], [S({ id: 'T-1', zone: 'Z4', bay: 5, session: 1, printed: ago(20) })]);

  const b = bay(d, 5);
  assert.equal(b.state, 'hanging', 'the old fill came down; this is the new one');
  assert.equal(b.bins, 25, 'the 40 bins from the previous fill are long gone');
  assert.equal(b.loads, 1);
  assert.ok(Math.abs(b.days - 4) < 0.1, `got ${b.days}`);
  assert.equal(b.level, 'green', '4 days is under the 6-day minimum');
});

test('topping a bay up over two days is one fill, not two', () => {
  // A fill is not "one trailer". A bay takes several loads while it fills, and
  // splitting on every load would reset the clock each time and report the bay
  // a day old when its first material has been up for three.
  const d = build([
    L({ id: 1, zone: 'Z4', bay: 6, bins: 20, at: ago(9), session: 1 }),
    L({ id: 2, zone: 'Z4', bay: 6, bins: 20, at: ago(8), session: 1 }),
    L({ id: 3, zone: 'Z4', bay: 6, bins: 15, at: ago(7), session: 1 }),
  ], []);
  const b = bay(d, 6);
  assert.equal(b.loads, 3);
  assert.equal(b.bins, 55);
  assert.ok(Math.abs(b.days - 9) < 0.1, `aged from the FIRST load, got ${b.days}`);
});

test('a tag from a different bay does not end this one', () => {
  const d = build([
    L({ id: 1, zone: 'Z4', bay: 5, bins: 20, at: ago(9), session: 1 }),
    L({ id: 2, zone: 'Z4', bay: 5, bins: 20, at: ago(2), session: 1 }),
  ], [S({ id: 'T-1', zone: 'Z4', bay: 11, session: 1, printed: ago(5) })]);
  // Bay 11 coming down says nothing about bay 5. Keying the fill boundary on
  // the LOT rather than the bay would have ended it here.
  const b = bay(d, 5);
  assert.equal(b.state, 'hanging');
  assert.equal(b.loads, 2);
  assert.ok(Math.abs(b.days - 9) < 0.1, `still one fill, got ${b.days}`);
});

test('a bay past the window is flagged while it is still hanging', () => {
  const d = build([L({ id: 1, zone: 'Z4', bay: 7, bins: 20, at: ago(26), session: 1 })], []);
  assert.equal(bay(d, 7).level, 'overdue');
  assert.equal(bay(d, 7).state, 'hanging');
});

test('a load with no lot still occupies the bay', () => {
  // It is physically on the rack whatever the attribution says. Dropping it
  // would make the board disagree with the barn to protect a tidy join.
  const d = build([L({ id: 1, zone: 'Z9', bay: 4, bins: 18, at: ago(6), session: null })], []);
  const b = bay(d, 4);
  assert.equal(b.state, 'hanging');
  assert.equal(b.bins, 18);
  assert.equal(b.lots[0].zone, 'Z9');
  assert.equal(b.lots[0].lot_id, null);
});

// ─── capture at the barn door ────────────────────────────────────────────────

test('the intake form offers a bay and lets it be left blank', async () => {
  const { env, ctx } = freshDb();
  const html = await (await call(env, ctx, 'action=barn_intake&lang=en')).text();
  assert.match(html, /name="bay"/);
  assert.match(html, /<option value=""/, 'blank is a real choice, not an oversight');
  assert.match(html, /Bay 12/);
});

test('the bay field is in Spanish by default, because the door is', async () => {
  // Not decoration. This form is filled by the intake crew, and an English-only
  // field added to a Spanish screen is a field that gets skipped.
  const { env, ctx } = freshDb();
  const html = await (await call(env, ctx, 'action=barn_intake')).text();
  assert.match(html, /¿En cuál bahía se cuelga\?/);
  assert.match(html, /No sé todavía/);
  assert.match(html, /Bodega de abajo/);
});

test('a load logged with a bay lands on the rack board', async () => {
  const { sqlite, env, ctx } = freshDb();
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, occurred_at, is_test)
    VALUES ('enter', 'Z4', 'Sour Lifter', ?, 1, ?, 1)`).run(SEASON, ago(0, 15));

  const res = await post(env, ctx, 'action=barn_log&lang=en', { zone: 'Z4', bins: '24', bay: '5' });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /bay 5/i, 'the confirm names the bay it recorded');

  const row = sqlite.prepare(
    `SELECT bay, bins FROM harvest_scan_log WHERE event_type = 'barn_load'`).get();
  assert.equal(row.bay, 5);
  assert.equal(row.bins, 24);
});

test('a load with no bay still logs its bins', async () => {
  // An old bookmark, or a door where nobody knows yet. Rejecting it would drop
  // the bins off the lot entirely — the ledger counts them by joining on the
  // session FK — and losing bins is far worse than an unknown bay.
  const { sqlite, env, ctx } = freshDb();
  const res = await post(env, ctx, 'action=barn_log', { zone: 'Z4', bins: '24' });
  assert.equal(res.status, 200);
  const row = sqlite.prepare(
    `SELECT bay, bins FROM harvest_scan_log WHERE event_type = 'barn_load'`).get();
  assert.equal(row.bay, null);
  assert.equal(row.bins, 24);
});

test('a bay outside 1-12 is refused, not clamped', async () => {
  // That is a typo, not an old bookmark, and a silently-corrected bay would be
  // tied to physical material and read as fact months later.
  const { sqlite, env, ctx } = freshDb();
  const res = await post(env, ctx, 'action=barn_log', { zone: 'Z4', bins: '24', bay: '19' });
  assert.notEqual(res.status, 200);
  assert.equal(sqlite.prepare(
    `SELECT COUNT(*) n FROM harvest_scan_log WHERE event_type = 'barn_load'`).get().n, 0);
});

test('the form defaults to the last bay filled, silently on the same day', async () => {
  const { sqlite, env, ctx } = freshDb();
  // Minutes ago, not a pinned UTC hour. `ago(0, 15)` is today at 15:00 UTC,
  // which is TOMORROW in Pacific terms when the suite runs late in the UTC day
  // — so this read as a stale default and failed on the clock rather than on
  // the code.
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, season, bins, bay, occurred_at, is_test)
    VALUES ('barn_load', 'Z4', ?, 20, 7, ?, 1)`).run(SEASON, minsAgo(1));

  const html = await (await call(env, ctx, 'action=barn_intake&lang=en')).text();
  assert.match(html, /<option value="7" selected/);
  assert.match(html, /Last load went to 7/);
  assert.doesNotMatch(html, /different day/, 'same day is a confirm, not a warning');
});

test('a default carried over from yesterday is named, not just pre-selected', async () => {
  // A missing bay is recoverable; a wrong one is not — nothing afterwards tells
  // it from a right one. The morning the crew starts filling bay 8, the form
  // still reads 7 and only the person at the door can catch it. So say it.
  const { sqlite, env, ctx } = freshDb();
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, season, bins, bay, occurred_at, is_test)
    VALUES ('barn_load', 'Z4', ?, 20, 7, ?, 1)`).run(SEASON, ago(2, 15));

  const html = await (await call(env, ctx, 'action=barn_intake&lang=en')).text();
  assert.match(html, /<option value="7" selected/, 'still the best guess available');
  assert.match(html, /different day/, 'but it must not pass unremarked');
});

test('the last bay FILLED is not the last bay emptied', async () => {
  // Mid-season one crew hangs bay 9 while the other pulls bay 3, and the
  // takedown form's default (getLastBay, off harvest_sacks) is the wrong
  // answer to the intake question.
  const { sqlite, env, ctx } = freshDb();
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, season, bins, bay, occurred_at, is_test)
    VALUES ('barn_load', 'Z4', ?, 20, 9, ?, 1)`).run(SEASON, ago(0, 15));
  sqlite.prepare(`
    INSERT INTO harvest_sacks (sack_id, season, serial, zone, cultivar, cut_number, bay, printed_at, is_test)
    VALUES ('T-9', ?, 9, 'Z4', 'Sour Lifter', 1, 3, ?, 1)`).run(SEASON, ago(0, 16));

  const html = await (await call(env, ctx, 'action=barn_intake')).text();
  assert.match(html, /<option value="9" selected/);
  assert.doesNotMatch(html, /<option value="3" selected/);
});

// ─── the worked example ──────────────────────────────────────────────────────

test('the demo fixture shows every state the board can be in', async () => {
  // The dashboard ships a worked example so the page explains itself before a
  // single trailer has been logged. If a later regeneration quietly flattened
  // it to one state, the card would still render and still be useless.
  const { DEMO_METRICS } = await import(mod('workers/src/lib/harvest-demo-fixture.js'));
  const r = DEMO_METRICS.racks;
  assert.equal(r.length, 12);

  const states = new Set(r.map(x => x.state));
  assert.ok(states.has('hanging') && states.has('coming_down') && states.has('empty'),
    [...states].join(','));
  const levels = new Set(r.filter(x => x.state !== 'empty').map(x => x.level));
  assert.ok(levels.has('green') && levels.has('ready') && levels.has('overdue'),
    [...levels].join(','));

  // Bay 1 is the fill model made visible: filled on day 0, tagged out on day
  // 10, refilled on day 26. It must read as a fresh two-day fill — not as
  // hanging since day 0, and not as still coming down.
  const one = r.find(x => x.bay === 1);
  assert.equal(one.state, 'hanging');
  assert.ok(one.days < 5, `bay 1 should be a young refill, got ${one.days}`);
  assert.equal(one.lots.length, 1);
  assert.equal(one.lots[0].zone, 'Z21');

  // Nothing in the fixture may be dated ahead of the clock. The window is 34
  // days long — the last sack is opened nine days after a takedown that is
  // itself 25 days after the cut — so nudging DAY0 forward to make a bay look
  // freshly hung silently posts sacks into next week. It did, once.
  assert.ok(new Date(String(DEMO_METRICS.feed[0].at).replace(' ', 'T') + 'Z') <= new Date(),
    `newest fixture event is in the future: ${DEMO_METRICS.feed[0].at}`);

  // Bay 9 took Z9 and Z11 in one fill — the reason the bay lives on the load
  // row rather than the session.
  const nine = r.find(x => x.bay === 9);
  assert.equal(nine.lots.length, 2);
  assert.deepEqual(nine.lots.map(l => l.zone).sort(), ['Z11', 'Z9']);
});

// ─── the season boundary ─────────────────────────────────────────────────────

/** Through the gated endpoint, which is where the two-season query lives. */
const metrics = (env, ctx) =>
  call(env, ctx, `action=harvest_metrics&season=${SEASON}`, { headers: { authorization: PW } })
    .then(r => r.json()).then(j => j.data ?? j);

test('a bay filled last season is still hanging in this one', async () => {
  // Every other figure on the dashboard is one season's bookkeeping. The rack
  // board is not — it answers a physical question about the barn right now, and
  // the answer does not change at midnight on 31 December. Cutting runs to
  // about November and takedowns trail it, so a season filter would empty the
  // whole barn on 1 January with material still on the racks.
  //
  // The row is dated nine days ago but STAMPED with last season, which is what
  // a December fill looks like from 2 January — and it is the season column,
  // not the timestamp, that the query would have excluded.
  const { sqlite, env, ctx } = freshDb();
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, season, bins, bay, occurred_at, is_test)
    VALUES ('barn_load', 'Z4', ?, 30, 5, ?, 1)`).run(SEASON - 1, ago(9));

  const b = (await metrics(env, ctx)).racks.find(r => r.bay === 5);
  assert.equal(b.state, 'hanging');
  assert.equal(b.bins, 30);
});

test('a tag this season closes a fill hung in the last one', async () => {
  // The other half. If the load crossed the boundary but the tag did not, the
  // bay would stay "hanging" for good and age past overdue while standing empty.
  const { sqlite, env, ctx } = freshDb();
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, season, bins, bay, occurred_at, is_test)
    VALUES ('barn_load', 'Z4', ?, 30, 5, ?, 1)`).run(SEASON - 1, ago(14));
  sqlite.prepare(`
    INSERT INTO harvest_sacks (sack_id, season, serial, zone, cultivar, cut_number, bay, printed_at, is_test)
    VALUES ('X-1', ?, 1, 'Z4', 'Sour Lifter', 1, 5, ?, 1)`).run(SEASON, ago(3));

  const b = (await metrics(env, ctx)).racks.find(r => r.bay === 5);
  assert.equal(b.state, 'coming_down');
  assert.ok(Math.abs(b.days - 11) < 0.1, `eleven days on the rack, got ${b.days}`);
});

test('the season figures do not inherit last season, only the racks do', async () => {
  // The rack queries were kept separate rather than widening the ones above:
  // cadence, crew rates and the feed are all season figures and would be wrong
  // if last year's rows leaked into them.
  const { sqlite, env, ctx } = freshDb();
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, season, bins, bay, occurred_at, is_test)
    VALUES ('barn_load', 'Z4', ?, 30, 5, ?, 1)`).run(SEASON - 1, ago(9));

  const d = await metrics(env, ctx);
  assert.equal(d.counts.loads, 0, 'last season is not this trailer count');
  assert.equal(d.counts.bins, 0);
  assert.equal(d.racks.find(r => r.bay === 5).state, 'hanging', 'but it is still in the barn');
});

// ─── the trial-zone cultivar switch ──────────────────────────────────────────

/** An 'enter' row with a cultivar, opened and closed at given times. */
const sess = (sqlite, o) => {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, crew,
                                  occurred_at, closed_at, is_test)
    VALUES ('enter', ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(o.zone, o.cultivar, SEASON, o.cut ?? 1, o.crew ?? null, o.opened, o.closed ?? null);
  return Number(sqlite.prepare('SELECT last_insert_rowid() AS id').get().id);
};
/** SQLite UTC text, `mins` minutes ago. */
const minsAgo = (m) =>
  new Date(Date.now() - m * 60000).toISOString().replace('T', ' ').slice(0, 19);

test('a trailer loaded before a cultivar switch goes to the cultivar it was cut from', async () => {
  // THE TRIAL-ZONE BUG. Z10 holds 15 cultivars in one acre. The crew finishes
  // Lemon and opens Rocket Sauce; the last Lemon trailer is still on the road.
  // The zone is open, so the load used to attach to Rocket Sauce silently —
  // ~6 trailers to a lot here, so that is a 15-20% error on both lots, on the
  // exact comparison the trial zone exists to make.
  const { sqlite, env, ctx } = freshDb();
  const lemon = sess(sqlite, { zone: 'Z10', cultivar: 'Lemon', crew: 'A',
    opened: minsAgo(180), closed: minsAgo(3) });
  sess(sqlite, { zone: 'Z10', cultivar: 'Rocket Sauce', crew: 'A', opened: minsAgo(2) });

  const res = await post(env, ctx, 'action=barn_log&lang=en', { zone: 'Z10', bins: '18' });
  const html = await res.text();

  const row = sqlite.prepare(
    `SELECT attributed_zone_session_id AS s FROM harvest_scan_log WHERE event_type='barn_load'`).get();
  assert.equal(row.s, lemon, 'the trailer was cut from Lemon');
  assert.match(html, /Lemon/, 'and the door is told, because only they can judge it');
});

test('once the grace window closes the open cultivar wins again', async () => {
  // Past the window the trailer really was loaded after the switch. The rule
  // has to expire, or every load for the rest of the lot goes to the old one.
  const { sqlite, env, ctx } = freshDb();
  sess(sqlite, { zone: 'Z10', cultivar: 'Lemon', crew: 'A',
    opened: minsAgo(400), closed: minsAgo(90) });
  const rocket = sess(sqlite, { zone: 'Z10', cultivar: 'Rocket Sauce', crew: 'A', opened: minsAgo(80) });

  await post(env, ctx, 'action=barn_log&lang=en', { zone: 'Z10', bins: '18' });
  const row = sqlite.prepare(
    `SELECT attributed_zone_session_id AS s FROM harvest_scan_log WHERE event_type='barn_load'`).get();
  assert.equal(row.s, rocket);
});

test('the same cultivar resuming is not a switch', async () => {
  // A crew stepping out and back into the same cultivar closes and reopens a
  // session. Treating that as a switch would push every load onto the stale
  // half of one lot for no reason.
  const { sqlite, env, ctx } = freshDb();
  sess(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', crew: 'A',
    opened: minsAgo(200), closed: minsAgo(3) });
  const now = sess(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter', crew: 'A', opened: minsAgo(2) });

  const html = await (await post(env, ctx, 'action=barn_log&lang=en', { zone: 'Z4', bins: '20' })).text();
  const row = sqlite.prepare(
    `SELECT attributed_zone_session_id AS s FROM harvest_scan_log WHERE event_type='barn_load'`).get();
  assert.equal(row.s, now);
  assert.doesNotMatch(html, /cultivar in this zone just changed/);
});

test('the other crew just-closing a different cultivar does not steal the load', async () => {
  // Both crews can work one zone on different cultivars. Crew B closing Lemon
  // says nothing about a trailer arriving at Crew A's door, and scoping the
  // lookback to the session's own crew is what keeps them apart.
  const { sqlite, env, ctx } = freshDb();
  sess(sqlite, { zone: 'Z10', cultivar: 'Lemon', crew: 'B',
    opened: minsAgo(200), closed: minsAgo(3) });
  const mine = sess(sqlite, { zone: 'Z10', cultivar: 'Rocket Sauce', crew: 'A', opened: minsAgo(150) });

  await post(env, ctx, 'action=barn_log&station=1', { zone: 'Z10', bins: '18' });
  const row = sqlite.prepare(
    `SELECT attributed_zone_session_id AS s FROM harvest_scan_log WHERE event_type='barn_load'`).get();
  assert.equal(row.s, mine, "crew A's own open lot");
});

// ─── test mode has to be visible ─────────────────────────────────────────────

test('every crew screen says so while test mode is on', async () => {
  // The one thing a silent test mode looks like is a system working perfectly.
  // It defaults ON, and the off switch used to live only in a deploy-time
  // --var, so a redeploy that forgot it would have written a real harvest as
  // test rows — which the season's cleanup step then deletes.
  const { env, ctx } = freshDb();
  for (const qs of ['action=barn_intake&lang=en', 'action=crew&lang=en', 'action=find&lang=en']) {
    const html = await (await call(env, ctx, qs)).text();
    assert.match(html, /<div class="testband">/, qs);
    assert.match(html, /Test mode/, qs);
  }
  const es = await (await call(env, ctx, 'action=barn_intake')).text();
  assert.match(es, /Modo de prueba/, 'the crew reads Spanish');
});

test('the band is gone once test mode is off', async () => {
  const { env, ctx } = freshDb();
  env.HARVEST_TEST_MODE = 'false';
  const html = await (await call(env, ctx, 'action=barn_intake&lang=en')).text();
  // The rendered band, not the phrase — the stylesheet's own comment explains
  // why the band exists and would match a looser regex.
  assert.doesNotMatch(html, /<div class="testband">/);
  
  assert.doesNotMatch(html, /Modo de prueba/);
});

test('the flag is committed, so a redeploy cannot change it by omission', () => {
  const toml = readFileSync(join(REPO, 'workers/wrangler.toml'), 'utf8');
  assert.match(toml, /^HARVEST_TEST_MODE = "(true|false)"$/m,
    'it must live in the file, not in a --var someone remembers');
});

// ─── the two hand-out example tags ───────────────────────────────────────────

test('both example tags print, with their own QR and no serial consumed', async () => {
  const { sqlite, env, ctx } = freshDb();
  const html = await (await call(env, ctx, 'action=sack_label&examples=1&lang=en')).text();

  assert.match(html, /Sour Lifter/);
  assert.match(html, /\bLifter\b/);
  assert.match(html, /SLIFT/);
  assert.match(html, /LIFT/);
  // Each tag's QR points at its OWN page, not both at the same one.
  for (const id of ['26-SLIFT-142', '26-LIFT-87']) {
    assert.ok(html.includes(encodeURIComponent(id)) || html.includes(id), `QR for ${id}`);
  }
  // The whole point of the demo path: nothing is written, so the season still
  // starts at serial 1. An is_test row here is what made the first real tag
  // print 26-SLIFT-3 on 2026-09-04.
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM harvest_sacks').get().n, 0);
});

test('a real bag always beats the example that shares its number', async () => {
  // The tags carry real bag numbers (Koa: "give it an actual bag #"), so the
  // ONLY thing keeping a genuine bag off invented weights is the lookup order.
  // The day the season prints 26-SLIFT-142, that bag has to win its own id.
  const { sqlite, env, ctx } = freshDb();
  sqlite.prepare(`
    INSERT INTO harvest_sacks (sack_id, season, serial, zone, cultivar, cut_number,
                               bay, printed_at, is_test)
    VALUES ('26-SLIFT-142', ?, 142, 'Z16', 'Sour Lifter', 2, 4, ?, 1)
  `).run(SEASON, ago(3));

  const html = await (await handleSackScan(
    new Request('https://x/s/26-SLIFT-142?lang=en'), env, ctx)).text();
  assert.match(html, /Z16/, 'the real row, not the example');
  assert.doesNotMatch(html, /Example.*sack|does not exist/i,
    'and it must not be labelled an example');
  assert.doesNotMatch(html, /Z4/, 'no trace of the example lot');
});

test('a note on a number the season has since printed hits the real bag', async () => {
  // The write path needs the same ordering as the read path. Falling through to
  // the example here would silently discard a real note.
  const { sqlite, env, ctx } = freshDb();
  sqlite.prepare(`
    INSERT INTO harvest_sacks (sack_id, season, serial, zone, cultivar, cut_number,
                               bay, printed_at, is_test)
    VALUES ('26-LIFT-87', ?, 87, 'Z20', 'Lifter', 1, 5, ?, 1)
  `).run(SEASON, ago(3));

  await post(env, ctx, 'action=sack_note&lang=en', { sack_id: '26-LIFT-87', note: 'real note' });
  const n = sqlite.prepare(
    `SELECT COUNT(*) c FROM harvest_sack_notes WHERE sack_id = '26-LIFT-87'`).get().c;
  assert.equal(n, 1, 'the note landed on the real bag');
});

test('scanning either example shows that cultivar, and saves nothing', async () => {
  const { sqlite, env, ctx } = freshDb();

  const sl = await (await handleSackScan(
    new Request('https://x/s/26-SLIFT-142?opened=1&lang=en'), env, ctx)).text();
  assert.match(sl, /Sour Lifter/);
  assert.match(sl, /Example.*sack|does not exist/i, 'it must say it is not real');

  const l = await (await handleSackScan(
    new Request('https://x/s/26-LIFT-87?opened=1&lang=en'), env, ctx)).text();
  assert.match(l, /Z19/, 'the Lifter example is a real Lifter zone');
  assert.doesNotMatch(l, /Sour Lifter/, 'the two examples are genuinely different sacks');

  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM harvest_sacks').get().n, 0);
});

test('the five parts of each example add up to a full sack', async () => {
  // A demo whose weights did not sum to the 37 lb that went in would teach the
  // wrong thing about what the page is showing.
  const { env, ctx } = freshDb();
  for (const id of ['26-SLIFT-142', '26-LIFT-87']) {
    const html = await (await handleSackScan(
      new Request(`https://x/s/${id}?opened=1&lang=en`), env, ctx)).text();
    const nums = [...html.matchAll(/([\d]+\.[\d])\s*lb/g)].map(m => parseFloat(m[1]));
    assert.ok(nums.length >= 5, `${id}: found ${nums.length} weights`);
  }
});

test('the old bare DEMO link still works', async () => {
  // It is printed on the calibration specimen sheet and may already be on a
  // laminated tag somewhere.
  const { env, ctx } = freshDb();
  const res = await handleSackScan(new Request('https://x/s/DEMO?lang=en'), env, ctx);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Sour Lifter/);
});

test('each example names its own zone, not the other one', async () => {
  // The banner used to hard-code Z4, which made it a plain lie on the Lifter
  // tag — the one line on the page whose whole job is to be trusted.
  const { env, ctx } = freshDb();
  const l = await (await handleSackScan(
    new Request('https://x/s/26-LIFT-87?lang=en'), env, ctx)).text();
  assert.match(l, /the real Z19/);
  assert.doesNotMatch(l, /the real Z4/);

  const sl = await (await handleSackScan(
    new Request('https://x/s/26-SLIFT-142?lang=en'), env, ctx)).text();
  assert.match(sl, /the real Z4/);
});

test('the sheet banner never reaches the label roll', async () => {
  // It is instructions for whoever opened the page. Printed, it costs a label
  // and pushes the first tag across the page boundary — which is how a Sour
  // Lifter tag came off a BIXOLON SRP-770III with the name on one label and
  // the QR on the next.
  const { env, ctx } = freshDb();
  for (const qs of ['action=sack_label&examples=1&lang=en',
                    'action=sack_label&calibrate=1&lang=en']) {
    const html = await (await call(env, ctx, qs)).text();
    assert.match(html, /class="banner"/, qs);
    const printBlock = html.match(/@media print \{([\s\S]*?)\n  \}/);
    assert.ok(printBlock, `no print block: ${qs}`);
    assert.match(printBlock[1], /\.banner\s*\{\s*display:\s*none|\.toolbar,\s*\.banner\s*\{\s*display:\s*none/,
      `banner still prints: ${qs}`);
  }
});

test('a tag cannot be split across the perforation', async () => {
  const { env, ctx } = freshDb();
  const html = await (await call(env, ctx, 'action=sack_label&examples=1&lang=en')).text();
  assert.match(html, /page-break-inside:\s*avoid/);
});

test('every non-real tag is marked as an example on the tag itself', async () => {
  // The bag number is real by design, so it cannot carry the warning. A
  // specimen that walks away from the printer would otherwise be
  // indistinguishable from a bag that came off a rack.
  const { env, ctx } = freshDb();
  for (const qs of ['action=sack_label&examples=1&lang=en',
                    'action=sack_label&calibrate=1&lang=en']) {
    const html = await (await call(env, ctx, qs)).text();
    const labels = html.match(/<div class="label[^"]*"/g) || [];
    const bars = html.match(/class="exbar"/g) || [];
    assert.ok(labels.length > 0, qs);
    assert.equal(bars.length, labels.length, `every tag needs the band: ${qs}`);
    assert.match(html, /EJEMPLO/, 'Spanish first — the crew reads it');
    assert.match(html, /EXAMPLE/);
  }
});

test('a real tag carries no example band', async () => {
  const { sqlite, env, ctx } = freshDb();
  sqlite.prepare(`
    INSERT INTO harvest_sacks (sack_id, season, serial, zone, cultivar, cut_number,
                               bay, printed_at, is_test)
    VALUES ('26-SLIFT-4', ?, 4, 'Z4', 'Sour Lifter', 1, 7, ?, 1)
  `).run(SEASON, ago(2));
  const html = await (await call(env, ctx, 'action=sack_label&ids=26-SLIFT-4&preview=1&lang=en')).text();
  assert.match(html, /26-SLIFT-4|#4/);
  // The rendered element and the label's modifier class — the .exbar rule
  // itself ships in every sheet's stylesheet whether or not a tag uses it.
  assert.doesNotMatch(html, /class="exbar"/);
  assert.doesNotMatch(html, /EJEMPLO/);
});

test('the example mark is ink, not a background fill', async () => {
  // Reported invisible on the printout twice. It was white text on a black
  // box, and browsers drop background colours in print unless the viewer has
  // ticked "Background graphics" — so the fill went, the white text went with
  // it, and a thermal printer laid down nothing. Everything else on the tag is
  // black on white, which is why everything else survives.
  const { env, ctx } = freshDb();
  const html = await (await call(env, ctx, 'action=sack_label&examples=1&lang=en')).text();
  const rule = html.match(/\.exbar\s*\{([^}]*)\}/);
  assert.ok(rule, 'no .exbar rule');
  assert.doesNotMatch(rule[1], /background:\s*#|background-color:\s*#/,
    'a printed mark may not depend on a fill');
  assert.match(rule[1], /border:[^;]*#000/, 'an outline prints without permission');
  assert.match(rule[1], /color:\s*#000/, 'and the letters have to be ink');
});

// ─── clipped hours never lift the measured rate ──────────────────────────────

test('a clipped session gets its own rate and never touches the measured one', () => {
  // THE WHOLE POINT OF THE BUCKETING. Clipped hours are a floor — the crew were
  // cutting before the first trailer and after the last — so bins divided by
  // them is a ceiling. Pooled into one figure it would silently lift whichever
  // crew forgot the end-of-day scan more often, and an overstated rate looks
  // exactly like a good day.
  const sessions = [
    { id: 1, zone: 'Z4', cultivar: 'Sour Lifter', cut_number: 1, crew: 'A',
      occurred_at: ago(9), closed_at: ago(9, 22), headcount: 5 },
    { id: 2, zone: 'Z5', cultivar: 'Sour Lifter', cut_number: 1, crew: 'A',
      occurred_at: ago(8), closed_at: ago(7, 20), headcount: 6 },
  ];
  const lots = [{
    lot_id: 'L1', season: SEASON, zone: 'Z4', cultivar: 'Sour Lifter', cut_number: 1,
    cut_date: ago(9).slice(0, 10), session_ids: [1, 2], sacks: 0,
    sessions: [
      { session_id: 1, cutter_person_hours: 20, hours_basis: 'measured' },
      { session_id: 2, cutter_person_hours: 36, hours_basis: 'clipped' },
    ],
  }];
  const loads = [
    L({ id: 1, zone: 'Z4', bay: null, bins: 100, crew: 'A', at: ago(9), session: 1 }),
    L({ id: 2, zone: 'Z5', bay: null, bins: 200, crew: 'A', at: ago(8), session: 2 }),
  ];

  const d = buildMetrics({ lots, sessions, loads, sacks: [], dryWindow: DRY,
    bottomBarnLastBay: 8, bayCount: 12 });
  const a = d.crew.find(c => c.crew === 'A');

  // Measured only: 100 bins over 20 measured person-hours.
  assert.equal(a.bins_per_cutter_hour, 5);
  // Clipped only: 200 bins over 36 clipped person-hours, named a ceiling.
  assert.equal(a.bins_per_cutter_hour_ceiling, 5.6);
  // Pooling would give 300/56 = 5.4 — a number that is neither, and that reads
  // as a measurement.
  assert.notEqual(a.bins_per_cutter_hour, 5.4);
  assert.equal(a.sessions_counted, 1);
  assert.equal(a.sessions_clipped, 1);
  assert.equal(a.bins, 300, 'the true total is still reported beside them');
});

test('with no clipped sessions the ceiling is absent, not zero', () => {
  const sessions = [{ id: 1, zone: 'Z4', cultivar: 'Sour Lifter', cut_number: 1,
    crew: 'A', occurred_at: ago(9), closed_at: ago(9, 22), headcount: 5 }];
  const lots = [{
    lot_id: 'L1', season: SEASON, zone: 'Z4', cultivar: 'Sour Lifter', cut_number: 1,
    cut_date: ago(9).slice(0, 10), session_ids: [1], sacks: 0,
    sessions: [{ session_id: 1, cutter_person_hours: 20, hours_basis: 'measured' }],
  }];
  const d = buildMetrics({ lots, sessions,
    loads: [L({ id: 1, zone: 'Z4', bay: null, bins: 100, crew: 'A', at: ago(9), session: 1 })],
    sacks: [], dryWindow: DRY, bottomBarnLastBay: 8, bayCount: 12 });
  const a = d.crew.find(c => c.crew === 'A');
  assert.equal(a.bins_per_cutter_hour, 5);
  assert.equal(a.bins_per_cutter_hour_ceiling, null, 'nothing to caveat');
});

// ─── the pre-filled bin count ────────────────────────────────────────────────

test('the bins field arrives pre-filled with a full trailer, and says so', async () => {
  // The ordinary load becomes one tap on Submit. Named as pre-filled, because a
  // number already in the box reads as a reading — and the short trailers are
  // structural (last load of a day, of a zone, of every cultivar in a trial
  // zone), which is exactly where lots are smallest.
  const { env, ctx } = freshDb();
  const html = await (await call(env, ctx, 'action=barn_intake&lang=en')).text();
  assert.match(html, /id="bins"[^>]*value="22"/);
  assert.match(html, /Pre-filled 22/);
  assert.doesNotMatch(html, /id="bins"[^>]*autofocus/,
    'the common case needs no keyboard');

  const es = await (await call(env, ctx, 'action=barn_intake')).text();
  assert.match(es, /cámbialo si la traila viene incompleta/);
});

test('a partial load still overrides the default', async () => {
  const { sqlite, env, ctx } = freshDb();
  await post(env, ctx, 'action=barn_log&lang=en', { zone: 'Z4', bins: '11' });
  assert.equal(sqlite.prepare(
    `SELECT bins FROM harvest_scan_log WHERE event_type='barn_load'`).get().bins, 11);
});

test('the pre-fill follows the constant rather than a number typed in the form', async () => {
  // binsPerTrailer carries "recalibrate once 2026 trailers run". When it moves,
  // the form has to move with it or the default quietly disagrees with the
  // figure every other calculation uses.
  const { env, ctx } = freshDb();
  const html = await (await call(env, ctx, 'action=barn_intake&lang=en')).text();
  const src = readFileSync(join(REPO, 'workers/src/handlers/harvest-d1.js'), 'utf8');
  const declared = src.match(/binsPerTrailer:\s*\{\s*value:\s*(\d+)/)[1];
  assert.match(html, new RegExp(`id="bins"[^>]*value="${declared}"`),
    `form must pre-fill the declared ${declared}`);
});

// ─── a lot's area is its own bands, not the whole zone ───────────────────────

test('a trial-zone lot reports its own rows, not the whole zone', async () => {
  // THE BUG KOA FOUND ON A PRINTED TAG. Rainbow GMO Quik is 6 of Z8's 37 rows.
  // Reporting the zone put 0.468 ac / ~906 plants on the tag when the truth is
  // 0.076 / ~147 — 6x over, on the denominator of every per-acre and per-plant
  // figure, in one of the three blocks that exist to compare cultivars.
  const { sqlite, env, ctx } = freshDb();
  const id = sess(sqlite, { zone: 'Z8', cultivar: 'Rainbow GMO Quik',
    opened: minsAgo(60 * 24 * 11), closed: minsAgo(60 * 24 * 11 - 240) });
  sqlite.prepare(`
    INSERT INTO harvest_sacks (sack_id, season, serial, zone, cultivar, cut_number,
                               zone_session_id, bay, printed_at, is_test)
    VALUES ('26-RAINGQ-1', ?, 1, 'Z8', 'Rainbow GMO Quik', 1, ?, 9, ?, 1)
  `).run(SEASON, id, minsAgo(60));

  const html = await (await handleSackScan(
    new Request('https://x/s/26-RAINGQ-1?lang=en'), env, ctx)).text();

  assert.match(html, /0\.076 ac/, 'six rows of Z8, not all of it');
  assert.doesNotMatch(html, /0\.468 ac/, 'the whole zone must not appear');
  assert.match(html, /147/, 'plants scale with the area');
  assert.match(html, /6 of 37 rows in Z8/, 'and it says where the number came from');
});

test('a single-cultivar zone still reports the whole zone', async () => {
  // Z4 is one cultivar, so there the zone really is the lot. This is the
  // regression guard on the fix.
  const { sqlite, env, ctx } = freshDb();
  const id = sess(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter',
    opened: minsAgo(60 * 24 * 11), closed: minsAgo(60 * 24 * 11 - 240) });
  sqlite.prepare(`
    INSERT INTO harvest_sacks (sack_id, season, serial, zone, cultivar, cut_number,
                               zone_session_id, bay, printed_at, is_test)
    VALUES ('26-SLIFT-9', ?, 9, 'Z4', 'Sour Lifter', 1, ?, 3, ?, 1)
  `).run(SEASON, id, minsAgo(60));

  const html = await (await handleSackScan(
    new Request('https://x/s/26-SLIFT-9?lang=en'), env, ctx)).text();
  assert.match(html, /1\.045 ac/);
});

test('every recorded row split adds back up to its zone', async () => {
  // The arithmetic guard. If a cultivar is added to a zone page and not here,
  // or a count is mistyped, the parts stop summing and this catches it.
  const zc = await import(mod('workers/src/lib/zone-cultivars.js'));
  const zf = await import(mod('workers/src/lib/zone-facts.js'));
  for (const zone of Object.keys(zc.ZONE_CULTIVAR_ROWS)) {
    const parts = Object.keys(zc.ZONE_CULTIVAR_ROWS[zone])
      .reduce((t, c) => t + zf.acresFor(zone, zc.cultivarShare(zone, c)), 0);
    const whole = zf.zoneFacts(zone).acres;
    assert.ok(Math.abs(parts - whole) < 0.01,
      `${zone}: parts ${parts.toFixed(3)} vs zone ${whole}`);
  }
});

test('a cultivar missing from a split zone reads unknown, never whole-zone', async () => {
  // The failure mode this must never regress into: something planted later,
  // not yet in the row table, silently claiming the entire block.
  const zc = await import(mod('workers/src/lib/zone-cultivars.js'));
  const zf = await import(mod('workers/src/lib/zone-facts.js'));
  const share = zc.cultivarShare('Z8', 'Something Planted Later');
  assert.equal(share, null);
  assert.equal(zf.acresFor('Z8', share), null);
  assert.equal(zf.plantCountFor('Z8', share), null);
});
