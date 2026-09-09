/**
 * The cycle-time dashboard.
 *
 * Two things this suite exists to hold:
 *
 * 1. THE PAGE SHIPS NO DATA. It is a public URL; every figure arrives after the
 *    operator types the password. The lot board already works this way and the
 *    dashboard has to as well, or the gate is decoration.
 *
 * 2. RATES COVER ONE SET OF SESSIONS. The ledger withholds cutter-hours for any
 *    session that ran overnight. Counting every bin a crew delivered against
 *    only the hours that survived that rule inflates whichever crew worked more
 *    late zones — in the worked example it alone made one crew read twice as
 *    productive as the other before it was caught. The numerator and the
 *    denominator must come from the same sessions.
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

const { handleHarvestD1 } = await import(mod('workers/src/handlers/harvest-d1.js'));
// The worker's real entry point. The JSON actions throw on purpose and index.js
// turns the throw into a response — so a test that calls the handler directly
// never sees the status a browser gets. That is exactly the shape of the bug
// this project shipped on 2026-09-04: every test used the one path where it
// could not happen.
const worker = (await import(mod('workers/src/index.js'))).default;
const { buildMetrics } = await import(mod('workers/src/lib/harvest-metrics.js'));
const { DEMO_METRICS } = await import(mod('workers/src/lib/harvest-demo-fixture.js'));

const PW = 'test-password';
const SEASON = new Date().getUTCFullYear();

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

const call = (env, ctx, qs, headers) => handleHarvestD1(
  new Request(`https://x/api/harvest?${qs}`, headers ? { headers } : undefined), env, ctx);

const metrics = (env, ctx) =>
  call(env, ctx, `action=harvest_metrics&season=${SEASON}`, { authorization: PW })
    .then(r => r.json()).then(j => j.data ?? j);

const at = (dayOffset, hUtc, m = 0) => {
  const d = new Date(Date.now() - dayOffset * 86400000);
  d.setUTCHours(hUtc, m, 0, 0);
  return d.toISOString().replace('T', ' ').slice(0, 19);
};

const session = (sqlite, o) => {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, crew,
                                  occurred_at, closed_at, headcount, is_test)
    VALUES ('enter', ?, ?, ?, 1, ?, ?, ?, ?, 1)
  `).run(o.zone, o.cultivar || 'Sour Lifter', SEASON, o.crew || null,
         o.opened, o.closed || null, o.headcount ?? null);
  return Number(sqlite.prepare('SELECT last_insert_rowid() AS id').get().id);
};
const load = (sqlite, o) => sqlite.prepare(`
  INSERT INTO harvest_scan_log (event_type, zone, season, bins, crew, occurred_at,
                                attributed_zone_session_id, is_test)
  VALUES ('barn_load', ?, ?, ?, ?, ?, ?, 1)
`).run(o.zone, SEASON, o.bins, o.crew || null, o.at, o.session ?? null);

let serial = 0;
const sack = (sqlite, o) => sqlite.prepare(`
  INSERT INTO harvest_sacks (sack_id, season, serial, zone, cultivar, cut_number,
                             zone_session_id, bay, printed_at, opened_at, is_test)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 1)
`).run(`T-${++serial}`, SEASON, serial, o.zone, o.cultivar || 'Sour Lifter',
       o.session, o.bay ?? null, o.printed, o.opened ?? null);

before(function () {
  if (!DatabaseSync) this.skip('node:sqlite unavailable (needs Node >= 22.5)');
});

// --- the gate ----------------------------------------------------------------

/** Through the worker, the way a browser reaches it. */
const fetchApi = (env, ctx, qs, headers) => worker.fetch(
  new Request(`https://x/api/harvest?${qs}`, headers ? { headers } : undefined), env, ctx);

test('the metrics endpoint refuses an unauthenticated read', async () => {
  const { env, ctx } = freshDb();
  assert.equal((await fetchApi(env, ctx, 'action=harvest_metrics')).status, 401);
  assert.equal((await fetchApi(env, ctx, 'action=harvest_metrics', { authorization: 'wrong' })).status, 401);
  assert.equal((await fetchApi(env, ctx, 'action=harvest_metrics', { authorization: PW })).status, 200);
});

test('the ledger is gated too, so the dashboard gate is not decoration', async () => {
  const { env, ctx } = freshDb();
  // It was open until 2026-09-04, purely because nothing had ever fetched it.
  // A password on the dashboard while the same numbers are served openly beside
  // it protects nothing.
  assert.equal((await fetchApi(env, ctx, 'action=rollup')).status, 401);
  assert.equal((await fetchApi(env, ctx, 'action=rollup', { authorization: PW })).status, 200);
});

test('the dashboard page is public and carries no harvest data', async () => {
  const { sqlite, env, ctx } = freshDb();
  // Deliberately distinctive values: the page DOES embed the worked example, so
  // the test has to prove the SEASON's rows are absent, not that the file is
  // free of digits. Z14 and this sack id appear nowhere in the fixture.
  const s = session(sqlite, { zone: 'Z14', cultivar: 'Suver Haze', crew: 'A',
    opened: at(2, 17), closed: at(2, 21), headcount: 6 });
  load(sqlite, { zone: 'Z14', bins: 137, crew: 'A', at: at(2, 18), session: s });
  sqlite.prepare(`INSERT INTO harvest_sacks
    (sack_id, season, serial, zone, cultivar, cut_number, zone_session_id, bay, printed_at, is_test)
    VALUES ('SEASON-SECRET-9', ?, 999, 'Z14', 'Suver Haze', 1, ?, 3, ?, 1)`)
    .run(SEASON, s, at(1, 18));

  const res = await fetchApi(env, ctx, 'action=harvest_dash');
  assert.equal(res.status, 200);
  const html = await res.text();

  // The shell is a public URL — no password, no session. Nothing the season put
  // in the database may be baked into it.
  assert.doesNotMatch(html, /Z14/);
  assert.doesNotMatch(html, /Suver Haze/);
  assert.doesNotMatch(html, /SEASON-SECRET-9/);
  assert.doesNotMatch(html, /137/);
  assert.match(html, /action=harvest_metrics/, 'it has to fetch the data it shows');
});

test('the password goes in a header, never a query string', async () => {
  const { env, ctx } = freshDb();
  const html = await (await call(env, ctx, 'action=harvest_dash')).text();
  // A query password lands in access logs, browser history and Referer headers.
  assert.match(html, /authorization:\s*pw/);
  assert.doesNotMatch(html, /password=/);
});

// --- the rate, and the trap in it -------------------------------------------

test('a crew rate counts the same sessions on both sides of the division', async () => {
  const { sqlite, env, ctx } = freshDb();
  // Crew B works two zones: one an ordinary afternoon, one running overnight —
  // which is every crew's last zone of the day.
  const day = session(sqlite, { zone: 'Z9', crew: 'B', opened: at(3, 17), closed: at(3, 21), headcount: 5 });
  const night = session(sqlite, {
    zone: 'Z11', crew: 'B', cultivar: 'Lifter', headcount: 5,
    opened: at(3, 23, 30), closed: at(2, 15),          // crosses a Pacific midnight
  });
  load(sqlite, { zone: 'Z9', bins: 20, crew: 'B', at: at(3, 18), session: day });
  load(sqlite, { zone: 'Z11', bins: 200, crew: 'B', at: at(3, 23, 45), session: night });

  const d = await metrics(env, ctx);
  const b = d.crew.find(c => c.crew === 'B');

  // The overnight session has no hours, so its 200 bins must not be divided by
  // the other session's hours. 20 bins over 4 h x 5 cutters = 1 bin/cutter-hour.
  assert.equal(b.bins, 220, 'the true total is still reported');
  assert.equal(b.bins_rated, 20, 'only bins whose session has hours may be rated');
  assert.equal(b.cutter_person_hours, 20);
  assert.equal(b.bins_per_cutter_hour, 1);
  assert.equal(b.sessions_counted, 1);
  assert.equal(b.sessions_total, 2, 'the coverage has to be visible, not implied');
});

test('time in a zone leaves out the sessions that ran overnight, and counts them', async () => {
  const { sqlite, env, ctx } = freshDb();
  session(sqlite, { zone: 'Z4', crew: 'A', opened: at(3, 17), closed: at(3, 21), headcount: 6 });
  session(sqlite, { zone: 'Z5', crew: 'A', cultivar: 'Lifter', opened: at(3, 23, 30), closed: at(2, 15), headcount: 6 });

  const d = await metrics(env, ctx);
  // The ledger already refuses to state cutter-hours for an overnight session.
  // A dwell chart drawn from the same timestamps would republish exactly the
  // figure it withheld, in a more believable form.
  assert.deepEqual(d.dwell.map(x => x.zone), ['Z4']);
  assert.equal(d.dwell_excluded_overnight, 1);
});

// --- the cycle times ---------------------------------------------------------

test('days on the rack are measured to the FIRST tag of the lot', async () => {
  const { sqlite, env, ctx } = freshDb();
  const s = session(sqlite, { zone: 'Z4', crew: 'A', opened: at(14, 17), closed: at(14, 21), headcount: 6 });
  sack(sqlite, { zone: 'Z4', session: s, bay: 1, printed: at(4, 18) });   // day 10
  sack(sqlite, { zone: 'Z4', session: s, bay: 1, printed: at(3, 18) });   // day 11

  const d = await metrics(env, ctx);
  assert.equal(d.dry_days.length, 1);
  // Cut 17:00, first tag 18:00 ten days later — ten days and an hour. Measuring
  // to the LAST tag would call it eleven; measuring from midnight of the cut
  // date would call it 10.8, which is most of a day of slop on the number the
  // READY / TOO GREEN badge is judged against.
  assert.ok(Math.abs(d.dry_days[0].days - 10.04) < 0.06, `got ${d.dry_days[0].days}`);
  assert.equal(d.dry_days[0].level, 'ready');
});

test('a lot with nothing tagged yet has no dry-days bar at all', async () => {
  const { sqlite, env, ctx } = freshDb();
  session(sqlite, { zone: 'Z4', crew: 'A', opened: at(3, 17), closed: at(3, 21), headcount: 6 });
  const d = await metrics(env, ctx);
  // A zero-day bar would read as "came down the day it was cut".
  assert.deepEqual(d.dry_days, []);
  assert.equal(d.counts.lots, 1);
});

test('a gap that spans a night is not counted as a slow trailer', async () => {
  const { sqlite, env, ctx } = freshDb();
  const s = session(sqlite, { zone: 'Z4', crew: 'A', opened: at(3, 16), closed: at(2, 20), headcount: 6 });
  load(sqlite, { zone: 'Z4', bins: 20, crew: 'A', at: at(3, 17), session: s });
  load(sqlite, { zone: 'Z4', bins: 21, crew: 'A', at: at(3, 18), session: s });   // +60 min
  load(sqlite, { zone: 'Z4', bins: 22, crew: 'A', at: at(2, 17), session: s });   // +23 h

  const d = await metrics(env, ctx);
  assert.deepEqual(d.all_gaps, [60], 'the overnight gap is the night, not the cadence');
  assert.equal(d.cadence[0].loads, 3, 'but all three loads still belong to the lot');
});

test('a load that landed on no lot is counted and surfaced', async () => {
  const { sqlite, env, ctx } = freshDb();
  load(sqlite, { zone: 'Z4', bins: 19, crew: 'A', at: at(1, 18), session: null });
  const d = await metrics(env, ctx);
  // Bins on no lot are the one failure that loses data outright, so the
  // dashboard has to say so rather than quietly total them in.
  assert.equal(d.counts.loads_unattributed, 1);
  assert.equal(d.counts.bins, 19);
  assert.ok(d.feed.some(e => e.kind === 'load' && /NO LOT/.test(e.detail)));
});

test('every scan appears in the feed, newest first', async () => {
  const { sqlite, env, ctx } = freshDb();
  const s = session(sqlite, { zone: 'Z4', crew: 'A', opened: at(3, 17), closed: at(3, 21), headcount: 6 });
  load(sqlite, { zone: 'Z4', bins: 22, crew: 'A', at: at(3, 18), session: s });
  sack(sqlite, { zone: 'Z4', session: s, bay: 7, printed: at(1, 18), opened: at(0, 19) });

  const d = await metrics(env, ctx);
  const kinds = d.feed.map(e => e.kind);
  assert.deepEqual([...kinds].sort(), ['enter', 'leave', 'load', 'open', 'tag']);
  const times = d.feed.map(e => String(e.at));
  assert.deepEqual(times, [...times].sort().reverse(), 'newest first');
});

test('bays report which barn they are in', async () => {
  const { sqlite, env, ctx } = freshDb();
  const s = session(sqlite, { zone: 'Z4', crew: 'A', opened: at(12, 17), closed: at(12, 21), headcount: 6 });
  sack(sqlite, { zone: 'Z4', session: s, bay: 3, printed: at(2, 18) });
  sack(sqlite, { zone: 'Z4', session: s, bay: 11, printed: at(2, 18) });

  const d = await metrics(env, ctx);
  assert.deepEqual(d.bays.map(b => [b.bay, b.barn]), [[3, 'bottom'], [11, 'top']]);
});

// --- the worked example -------------------------------------------------------

test('the worked example is marked as invented, and covers every verdict', async () => {
  // It is generated by running the real endpoint over a seeded in-memory DB —
  // a hand-written fixture drifts from the endpoint it claims to come from.
  assert.equal(DEMO_METRICS.is_demo, true);
  assert.equal(DEMO_METRICS.is_test, true);

  // If the example never shows a green or an overdue lot, the first real one is
  // the first time anyone sees what the warning bands look like.
  const levels = new Set(DEMO_METRICS.dry_days.map(d => d.level));
  assert.deepEqual([...levels].sort(), ['green', 'overdue', 'ready']);

  assert.ok(DEMO_METRICS.dwell_excluded_overnight > 0, 'and at least one overnight exclusion');
  assert.ok(DEMO_METRICS.counts.loads_unattributed > 0, 'and one load that lost its lot');
});

test('the example never claims a sack has been waiting a negative number of days', () => {
  // It did: the fortnight was originally dated a month into the future, so
  // "oldest sealed sack" came out at -35 days.
  const ol = DEMO_METRICS.order_latency;
  assert.ok(ol.oldest_waiting_days === null || ol.oldest_waiting_days > 0,
    `oldest_waiting_days = ${ol.oldest_waiting_days}`);
  assert.ok(ol.days.every(d => d >= 0));
});

// --- the pure module ----------------------------------------------------------

test('buildMetrics needs no database, so the shapes can be pinned directly', () => {
  const out = buildMetrics({
    lots: [], sessions: [], loads: [], sacks: [],
    dryWindow: { min: 6, typical: 10, max: 21 }, bottomBarnLastBay: 8,
  });
  assert.deepEqual(out.dry_days, []);
  assert.deepEqual(out.crew, []);
  assert.equal(out.counts.bins, 0);
  assert.equal(out.order_latency.median_days, null);
});

// --- reachable from the board -------------------------------------------------

test('the lot board links to the dashboard, and the link is absolute', async () => {
  const { env, ctx } = freshDb();
  const html = await (await fetchApi(env, ctx, 'action=board_page')).text();

  assert.match(html, /href="\/api\/harvest\?action=harvest_dash"/,
    'the board should offer a way through to the cycle times');

  // The board is served from /api/harvest?action=board_page, where a bare
  // `?action=harvest_dash` happens to resolve correctly — which is exactly the
  // assumption that silently lost every cutter count and every trailer logged
  // from a scanned QR code until 2026-09-04. Resolve it the way a browser does.
  const hrefs = [...html.matchAll(/href="([^"]*action=harvest_dash[^"]*)"/g)].map(m => m[1]);
  assert.ok(hrefs.length >= 1);
  for (const href of hrefs) {
    const resolved = new URL(href, 'https://x/api/harvest?action=board_page');
    assert.equal(resolved.pathname, '/api/harvest', `${href} resolves to ${resolved.pathname}`);
    assert.equal(resolved.searchParams.get('action'), 'harvest_dash');
  }
});

test('the board links to the takedown screen, absolutely', async () => {
  // The daily action the barn actually runs on: pick the lot coming down, pick
  // the bay, print a tag per sack. Resolved the way a browser would, because a
  // relative `?action=` on a page served from /api/harvest happens to work and
  // is exactly the assumption that silently lost every scan on 2026-09-04.
  const { env, ctx } = freshDb();
  const html = await (await fetchApi(env, ctx, 'action=board_page')).text();

  const hrefs = [...html.matchAll(/href="([^"]*action=sack_print[^"]*)"/g)].map(m => m[1]);
  assert.ok(hrefs.length >= 1, 'the board needs a way to reach the takedown screen');
  for (const href of hrefs) {
    const resolved = new URL(href, 'https://x/api/harvest?action=board_page');
    assert.equal(resolved.pathname, '/api/harvest');
    assert.equal(resolved.searchParams.get('action'), 'sack_print');
  }
});

test('the dashboard links back to the board, absolutely', async () => {
  const { env, ctx } = freshDb();
  const html = await (await fetchApi(env, ctx, 'action=harvest_dash')).text();

  const hrefs = [...html.matchAll(/href="([^"]*action=board_page[^"]*)"/g)].map(m => m[1]);
  assert.ok(hrefs.length >= 1, 'the pair to the board\'s "Cycle times" link');
  for (const href of hrefs) {
    const resolved = new URL(href, 'https://x/api/harvest?action=harvest_dash');
    assert.equal(resolved.pathname, '/api/harvest');
    assert.equal(resolved.searchParams.get('action'), 'board_page');
  }
});

test('both pages reach each other, so neither is a dead end', async () => {
  const { env, ctx } = freshDb();
  const [dash, board] = await Promise.all([
    fetchApi(env, ctx, 'action=harvest_dash').then(r => r.text()),
    fetchApi(env, ctx, 'action=board_page').then(r => r.text()),
  ]);
  // One tool viewed two ways. A link added in one direction and forgotten in
  // the other is how a page becomes something you have to know the URL for.
  assert.match(dash, /action=board_page/);
  assert.match(board, /action=harvest_dash/);
});

test('the board still ships no lot data of its own', async () => {
  const { env, ctx } = freshDb();
  const html = await (await fetchApi(env, ctx, 'action=board_page')).text();
  // Adding a link must not have turned the shell into something that carries
  // cards. It is a public URL and the lots carry Total THC.
  //
  // Checked by looking for a LOT ID rather than for the string "Total THC":
  // the page's own JavaScript names that field, so matching on the label finds
  // the code that renders a value, not a value.
  assert.doesNotMatch(html, /LOT-\d{4}-/, 'no lot may be baked into the public shell');
  // The board builds its action at runtime (`API + "?action=" + action`), so
  // there is no literal to match — what matters is that it still goes and gets
  // the lots rather than having them baked in.
  assert.match(html, /API \+ "\?action=" \+ action/, 'it still fetches its own data');
});
