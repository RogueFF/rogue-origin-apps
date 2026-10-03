/**
 * Three cutting crews (Koa, 2026-10-03).
 *
 * Crew A (Nico), Crew B (Jose) and Crew C (Diego) each cut their own zone. So:
 *  - a zone sign asks WHICH crew, every scan, and writes nothing until tapped
 *    (a remembered phone tag is what lost loads in September);
 *  - a crew's first zone of the day asks once for its trailers and its
 *    cutters, drivers and water spiders, then opens the lot;
 *  - a zone scan closes only that crew's previous lot;
 *  - a trailer load follows the crew that has the trailer today, to that
 *    crew's open lot (or the one it closed inside the barn grace);
 *  - a trailer on no crew today is asked about, never guessed.
 *
 * The assignment used throughout is the real one from 2026-10-03:
 * Nico T3+T4, Jose T1+T5, Diego T6+T2.
 *
 * Run with `node --test`.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, quiet, minsAgo, seedSession, seedCrewDay, sessions, openSessions, loads, lastLoad,
  modUrl, sqliteAvailable, earlierTodayMins, pacificToday } from './helpers/harvest-sqlite.mjs';

const { handleHarvestD1, handleZoneScan, handleTrailerScan } =
  await import(modUrl('workers/src/handlers/harvest-d1.js'));

const zone = (env, ctx, z, qs = '') => quiet(() => handleZoneScan(
  new Request(`https://x/z/${z}?lang=en${qs}`), env, ctx));
const trailer = (env, ctx, n) => quiet(() => handleTrailerScan(new Request(`https://x/t/${n}?lang=en`), env, ctx));
const post = (env, ctx, action, fields) => quiet(() => handleHarvestD1(
  new Request(`https://x/api/harvest?action=${action}&lang=en`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)]))),
  }), env, ctx));
const crewDays = (sqlite) => sqlite.prepare('SELECT * FROM harvest_crew_day ORDER BY crew').all();

/** Today's floor: the three crews with their real trailers. */
function threeCrews(sqlite) {
  seedCrewDay(sqlite, { crew: 'A', trailers: '3,4', cutters: 6 });
  seedCrewDay(sqlite, { crew: 'B', trailers: '1,5', cutters: 5 });
  seedCrewDay(sqlite, { crew: 'C', trailers: '6,2', cutters: 6 });
}

/** A load earlier today with a bay, so a scan has today's bay and logs in one go. */
function bayToday(sqlite, lot, bay = 9) {
  sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, season, bins, attributed_zone_session_id, bay, trailer, is_test, occurred_at)
    SELECT 'barn_load', zone, season, 24, id, ?, NULL, 1, datetime('now', ?) FROM harvest_scan_log WHERE id = ?
  `).run(bay, `-${earlierTodayMins()} minutes`, lot);
}

const TODAY = earlierTodayMins();
before(function () {
  if (!sqliteAvailable) this.skip('node:sqlite unavailable (needs Node >= 22.5)');
  if (TODAY === null) this.skip('within 6 minutes of midnight Pacific');
});

// --- the zone sign asks which crew ----------------------------------------------

test('a zone sign with no crew picked shows the three crews and writes nothing', async () => {
  const { sqlite, env, ctx } = freshDb({ crews: false });
  const html = await (await zone(env, ctx, 'Z4')).text();
  assert.match(html, /Which crew are you\?/);
  for (const [c, lead] of [['A', 'Nico'], ['B', 'Jose'], ['C', 'Diego']]) {
    assert.match(html, new RegExp(`href="/z/Z4\\?lang=en&crew=${c}"[^>]*>.*${lead}`));
  }
  assert.equal(sessions(sqlite).length, 0);
});

test('the crew pick is never taken from the phone: an old crew cookie still gets the question', async () => {
  const { sqlite, env, ctx } = freshDb();
  const html = await (await quiet(() => handleZoneScan(
    new Request('https://x/z/Z4?lang=en', { headers: { cookie: 'rf_crew=A' } }), env, ctx))).text();
  assert.match(html, /Which crew are you\?/);
  assert.equal(sessions(sqlite).length, 0);
});

test('a multi-cultivar zone keeps the crew through the cultivar picker', async () => {
  const { env, ctx } = freshDb();
  const html = await (await zone(env, ctx, 'R1', '&crew=A')).text();
  assert.match(html, /href="\/z\/R1\?lang=en&crew=A&cultivar=/);
});

test('an unknown crew is refused, not guessed', async () => {
  const { sqlite, env, ctx } = freshDb();
  const res = await zone(env, ctx, 'Z4', '&crew=Q');
  assert.equal(res.status, 400);
  assert.equal(sessions(sqlite).length, 0);
});

// --- the crew's first zone of the day --------------------------------------------

test("a crew's first zone of the day asks for trailers and people, and writes nothing", async () => {
  const { sqlite, env, ctx } = freshDb({ crews: false });
  const html = await (await zone(env, ctx, 'Z4', '&crew=B')).text();
  assert.match(html, /Crew B · Jose/);
  assert.match(html, /First zone today/);
  for (let n = 1; n <= 6; n++) assert.match(html, new RegExp(`name="t${n}"`));
  for (const f of ['cutters', 'drivers', 'water_spiders']) assert.match(html, new RegExp(`name="${f}"`));
  assert.match(html, /action="\/api\/harvest\?action=crew_day/);
  assert.equal(sessions(sqlite).length, 0);
  assert.equal(crewDays(sqlite).length, 0);
});

test('saving the form stores the crew day and opens the lot with its cutters', async () => {
  const { sqlite, env, ctx } = freshDb({ crews: false });
  const res = await post(env, ctx, 'crew_day', {
    crew: 'B', zone: 'Z4', t1: 1, t5: 1, cutters: 5, drivers: 2, water_spiders: 1 });
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /Entered Z4/);

  const [day] = crewDays(sqlite);
  assert.deepEqual(
    { date: day.harvest_date, crew: day.crew, trailers: day.trailers, c: day.cutters, d: day.drivers, w: day.water_spiders },
    { date: pacificToday(), crew: 'B', trailers: '1,5', c: 5, d: 2, w: 1 });
  const [lot] = openSessions(sqlite);
  assert.equal(lot.crew, 'B');
  assert.equal(lot.headcount, 5);

  // The next zone that day goes straight in, with the same people.
  await zone(env, ctx, 'Z7', '&crew=B');
  assert.equal(openSessions(sqlite)[0].zone, 'Z7');
  assert.equal(openSessions(sqlite)[0].headcount, 5);
});

test('the form refuses no trailer, and counts out of range', async () => {
  const { sqlite, env, ctx } = freshDb({ crews: false });
  const none = await post(env, ctx, 'crew_day', { crew: 'A', zone: 'Z4', cutters: 6, drivers: 2, water_spiders: 2 });
  assert.equal(none.status, 400);
  assert.match(await none.text(), /at least one trailer/);
  const zero = await post(env, ctx, 'crew_day', { crew: 'A', zone: 'Z4', t3: 1, cutters: 0, drivers: 2, water_spiders: 2 });
  assert.equal(zero.status, 400);
  const blank = await post(env, ctx, 'crew_day', { crew: 'A', zone: 'Z4', t3: 1, cutters: 6, drivers: '', water_spiders: 2 });
  assert.equal(blank.status, 400);
  assert.equal(crewDays(sqlite).length, 0);
  assert.equal(sessions(sqlite).length, 0);
});

test('giving a crew a trailer takes it off the crew that had it today', async () => {
  const { sqlite, env, ctx } = freshDb({ crews: false });
  threeCrews(sqlite);
  const a = seedSession(sqlite, { zone: 'Z4', crew: 'A' });
  // Jose's crew takes T4 from Nico mid-day, from the crew card.
  const b = seedSession(sqlite, { zone: 'Z7', crew: 'B' });
  await post(env, ctx, 'crew_day', { crew: 'B', session_id: b, t1: 1, t5: 1, t4: 1, cutters: 5, drivers: 3, water_spiders: 1 });
  const byCrew = Object.fromEntries(crewDays(sqlite).map(r => [r.crew, r.trailers]));
  assert.deepEqual(byCrew, { A: '3', B: '1,4,5', C: '6,2' });
  assert.ok(a);
});

const yesterday = () => new Date(Date.now() - 36 * 3600e3).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

test('the form names the trailers a crew keeps if it picks none, and shows who has the rest', async () => {
  const { sqlite, env, ctx } = freshDb({ crews: false });
  seedCrewDay(sqlite, { crew: 'C', trailers: '6,2', day: yesterday() });
  seedCrewDay(sqlite, { crew: 'A', trailers: '2,3' });   // Nico took T2 today
  const html = await (await zone(env, ctx, 'Z9', '&crew=C')).text();
  assert.doesNotMatch(html, /name="t\d" value="1" checked/, 'nothing pre-ticked: the lead picks, or keeps');
  assert.match(html, /Pick none to keep the last ones: T6</);
  assert.match(html, /name="t2" value="1"><span class="trname">T2<\/span><span class="trwith">now with A/);
});

test("picking no trailers keeps the crew's last ones, never one another crew already has today", async () => {
  const { sqlite, env, ctx } = freshDb({ crews: false });
  seedCrewDay(sqlite, { crew: 'C', trailers: '6,2', day: yesterday() });
  seedCrewDay(sqlite, { crew: 'A', trailers: '2,3' });
  const res = await post(env, ctx, 'crew_day', { crew: 'C', zone: 'Z9', cutters: 6, water_spiders: 2, drivers: 2 });
  assert.equal(res.status, 200);
  const byCrew = Object.fromEntries(crewDays(sqlite).filter(r => r.harvest_date === pacificToday()).map(r => [r.crew, r.trailers]));
  assert.deepEqual(byCrew, { A: '2,3', C: '6' });
  assert.equal(openSessions(sqlite)[0].crew, 'C');
});

test('the people are tap buttons in the usual ranges, nothing pre-picked', async () => {
  const { env, ctx } = freshDb({ crews: false });
  const html = await (await zone(env, ctx, 'Z4', '&crew=A')).text();
  const vals = (k) => [...html.matchAll(new RegExp(`name="${k}" value="(\\d+)" required>`, 'g'))].map(m => Number(m[1]));
  assert.deepEqual(vals('cutters'), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(vals('water_spiders'), [0, 1, 2, 3, 4]);
  assert.deepEqual(vals('drivers'), [1, 2, 3, 4, 5]);
  assert.ok(html.indexOf('>Cutters<') < html.indexOf('>Water spiders<'));
  assert.ok(html.indexOf('>Water spiders<') < html.indexOf('>Drivers<'));
});

test('the crew card changes trailers only; the people stay as counted', async () => {
  const { sqlite, env, ctx } = freshDb({ crews: false });
  threeCrews(sqlite);
  await zone(env, ctx, 'Z4', '&crew=A');
  const lot = openSessions(sqlite)[0];
  const form = await (await quiet(() => handleHarvestD1(
    new Request(`https://x/api/harvest?action=crew_day&lang=en&crew=A&session_id=${lot.id}`), env, ctx))).text();
  assert.match(form, /name="t3" value="1" checked/);
  assert.doesNotMatch(form, /name="cutters"/, 'people changes go on the hourly report');

  const html = await (await post(env, ctx, 'crew_day', { crew: 'A', session_id: lot.id, t3: 1, cutters: 8 })).text();
  assert.match(html, /Saved/);
  assert.equal(crewDays(sqlite).find(r => r.crew === 'A').trailers, '3');
  assert.equal(openSessions(sqlite)[0].headcount, 6, 'the count from the first scan stands');
  assert.equal(sessions(sqlite).length, 1, 'editing opens no new lot');
});

test("a crew card cannot edit another crew's lot", async () => {
  const { sqlite, env, ctx } = freshDb({ crews: false });
  threeCrews(sqlite);
  const b = seedSession(sqlite, { zone: 'Z7', crew: 'B' });
  const res = await post(env, ctx, 'crew_day', { crew: 'A', session_id: b, t3: 1, cutters: 9, drivers: 1, water_spiders: 1 });
  assert.equal(res.status, 400);
  assert.equal(sessions(sqlite)[0].headcount, null);
});

// --- each crew its own lot --------------------------------------------------------

test("a zone scan closes only that crew's lot", async () => {
  const { sqlite, env, ctx } = freshDb({ crews: false });
  threeCrews(sqlite);
  await zone(env, ctx, 'Z4', '&crew=A');
  await zone(env, ctx, 'Z7', '&crew=B');
  await zone(env, ctx, 'Z9', '&crew=C');
  assert.deepEqual(openSessions(sqlite).map(s => `${s.crew}:${s.zone}`).sort(), ['A:Z4', 'B:Z7', 'C:Z9']);

  await zone(env, ctx, 'Z5', '&crew=A');
  assert.deepEqual(openSessions(sqlite).map(s => `${s.crew}:${s.zone}`).sort(), ['A:Z5', 'B:Z7', 'C:Z9']);
});

test('a lot left open from the one-crew days closes on the first crew scan', async () => {
  const { sqlite, env, ctx } = freshDb({ crews: false });
  threeCrews(sqlite);
  seedSession(sqlite, { zone: 'Z11', crew: null, opened: minsAgo(200) });
  await zone(env, ctx, 'Z4', '&crew=B');
  assert.deepEqual(openSessions(sqlite).map(s => s.zone), ['Z4']);
});

test('a second crew walking into a zone joins its cut', async () => {
  const { sqlite, env, ctx } = freshDb({ crews: false });
  threeCrews(sqlite);
  seedSession(sqlite, { zone: 'Z4', crew: 'A', cut: 2 });
  await zone(env, ctx, 'Z4', '&crew=C');
  const c = openSessions(sqlite).find(s => s.crew === 'C');
  assert.equal(c.cut_number, 2, 'one rack of plants is one cut, whichever crew cut it');
});

// --- trailers follow their crew ----------------------------------------------------

test("each trailer's load goes to its own crew's lot", async () => {
  const { sqlite, env, ctx } = freshDb({ crews: false });
  threeCrews(sqlite);
  const a = seedSession(sqlite, { zone: 'Z4', crew: 'A', cultivar: 'Sour Lifter' });
  const b = seedSession(sqlite, { zone: 'Z7', crew: 'B', cultivar: 'Lifter' });
  const c = seedSession(sqlite, { zone: 'Z9', crew: 'C', cultivar: 'Lifter' });
  bayToday(sqlite, a);

  for (const [n, lot, crew] of [[3, a, 'A'], [4, a, 'A'], [1, b, 'B'], [5, b, 'B'], [6, c, 'C'], [2, c, 'C']]) {
    const res = await trailer(env, ctx, n);
    assert.equal(res.status, 303, `T${n} logs in one scan`);
    const row = lastLoad(sqlite);
    assert.deepEqual({ t: row.trailer, lot: row.attributed_zone_session_id, crew: row.crew },
      { t: n, lot, crew }, `T${n}`);
  }
});

test("the barn grace is per crew: A changing zones does not pull B's trailer onto A's old lot", async () => {
  const { sqlite, env, ctx } = freshDb({ crews: false });
  threeCrews(sqlite);
  const aOld = seedSession(sqlite, { zone: 'Z4', crew: 'A', opened: minsAgo(200), closed: minsAgo(1) });
  seedSession(sqlite, { zone: 'Z5', crew: 'A', opened: minsAgo(1) });
  const b = seedSession(sqlite, { zone: 'Z7', crew: 'B', opened: minsAgo(120) });
  bayToday(sqlite, b);

  await trailer(env, ctx, 1);
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, b, "B's trailer stays on B's lot");
  await trailer(env, ctx, 3);
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, aOld, "A's trailer was loaded before A moved");
});

test('a trailer on no crew today is asked about, never guessed', async () => {
  const { sqlite, env, ctx } = freshDb({ crews: false });
  seedCrewDay(sqlite, { crew: 'A', trailers: '3,4' });
  const a = seedSession(sqlite, { zone: 'Z4', crew: 'A' });
  bayToday(sqlite, a);
  const before = loads(sqlite).length;

  const res = await trailer(env, ctx, 6);
  assert.equal(res.status, 200, 'the ask screen, not a logged load');
  const html = await res.text();
  assert.match(html, /T6 is not on any crew today/);
  assert.match(html, /name="lot" value="\d+"/, 'the driver can still pick the lot');
  assert.equal(loads(sqlite).length, before);
});

test('a crew with trailers but no zone open asks, and says which crew', async () => {
  const { sqlite, env, ctx } = freshDb({ crews: false });
  threeCrews(sqlite);
  const a = seedSession(sqlite, { zone: 'Z4', crew: 'A' });
  bayToday(sqlite, a);
  const before = loads(sqlite).length;
  const html = await (await trailer(env, ctx, 1)).text();
  assert.match(html, /Crew B · Jose has no zone open/);
  assert.equal(loads(sqlite).length, before);
});

test('the lot picker names each lot\'s crew', async () => {
  const { sqlite, env, ctx } = freshDb({ crews: false });
  threeCrews(sqlite);
  seedSession(sqlite, { zone: 'Z4', crew: 'A' });
  seedSession(sqlite, { zone: 'Z7', crew: 'B', cultivar: 'Lifter' });
  const html = await (await trailer(env, ctx, 6)).text();   // C has no lot: the picker shows
  assert.match(html, /Z4 · Sour Lifter · Cut 1 · Crew A · Nico/);
  assert.match(html, /Z7 · Lifter · Cut 1 · Crew B · Jose/);
});

test('status carries each crew\'s day', async () => {
  const { sqlite, env, ctx } = freshDb({ crews: false });
  threeCrews(sqlite);
  const d = await handleHarvestD1(new Request('https://x/api/harvest?action=status'), env, ctx).then(r => r.json());
  const crews = d.crews_today || d.data?.crews_today;
  assert.deepEqual(crews.map(c => [c.crew, c.lead, c.trailers]),
    [['A', 'Nico', [3, 4]], ['B', 'Jose', [1, 5]], ['C', 'Diego', [6, 2]]]);
});

test('the barn door asks for the zone when several crews are cutting, instead of guessing the newest', async () => {
  const { handleBarnScan } = await import(modUrl('workers/src/handlers/harvest-d1.js'));
  const { sqlite, env, ctx } = freshDb({ crews: false });
  threeCrews(sqlite);
  seedSession(sqlite, { zone: 'Z4', crew: 'A' });
  const one = await (await quiet(() => handleBarnScan(new Request('https://x/b/1?lang=en'), env, ctx))).text();
  assert.match(one, /<option value="Z4" selected/, 'one zone open: the door follows it');
  seedSession(sqlite, { zone: 'Z7', crew: 'B', cultivar: 'Lifter' });
  const two = await (await quiet(() => handleBarnScan(new Request('https://x/b/1?lang=en'), env, ctx))).text();
  assert.doesNotMatch(two, /<option value="Z\d+" selected/);
});

test('a day with no crew set up yet still logs trailers to the open lot, as the one-crew build did', async () => {
  // Shipped mid-shift 2026-10-03: until the first lead scans in, there are no
  // crew rows today, and every trailer must keep landing on the open lot.
  const { sqlite, env, ctx } = freshDb({ crews: false });
  const z15 = seedSession(sqlite, { zone: 'Z15', crew: null });
  bayToday(sqlite, z15);
  const res = await trailer(env, ctx, 5);
  assert.equal(res.status, 303);
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, z15);

  // The first crew set up today switches the rules on for everyone.
  seedCrewDay(sqlite, { crew: 'A', trailers: '3,4' });
  const before = loads(sqlite).length;
  assert.equal((await trailer(env, ctx, 5)).status, 200, 'T5 is on no crew now: asked');
  assert.equal(loads(sqlite).length, before);
});
