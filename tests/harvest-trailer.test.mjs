/**
 * The trailer decal: ONE SCAN (Koa, 2026-09-28 — "just a one-scan on the qr
 * without jumping through any hoops").
 *
 * Six trailers, T1-T6, each with its own QR. The driver scans it on drop-off
 * and that IS the load: the open lot (or the one that closed inside the barn
 * grace), 24 bins, and this trailer's bay from earlier today. The scan answers
 * 303 to a GET receipt, which offers fixes (bay, partial, lot) and undo for
 * ten minutes.
 *
 * It asks instead — and writes nothing — only when guessing would put bins
 * somewhere wrong: no bay for this trailer yet today, or no lot at all.
 *
 * What this suite pins:
 *  - an ordinary scan logs with no tap, and the tab lands on the receipt (so a
 *    reopened browser cannot re-log it);
 *  - a load never saves without a lot (the thing that lost 96 bins on 9/24);
 *  - every scan logs: no cooldown and no double-scan flag;
 *  - link-preview bots and browser prefetches never log a load;
 *  - fixes and undo work inside the window and are refused after it.
 *
 * Run with `node --test`.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, quiet, minsAgo, seedSession, loads, lastLoad, modUrl, sqliteAvailable, SEASON, earlierTodayMins }
  from './helpers/harvest-sqlite.mjs';

const { handleHarvestD1, handleZoneScan, handleTrailerScan } =
  await import(modUrl('workers/src/handlers/harvest-d1.js'));
const worker = (await import(modUrl('workers/src/index.js'))).default;

/** The raw scan: a phone camera opening /t/<n>. */
const scan = (env, ctx, n, { lang = 'en', headers = {}, method = 'GET' } = {}) => quiet(() => handleTrailerScan(
  new Request(`https://x/t/${n}${lang ? `?lang=${lang}` : ''}`, { method, headers }), env, ctx));

/** Follow a 303 the way the phone does; anything else comes back as is. */
const follow = async (env, ctx, res) => {
  if (res.status !== 303) return res;
  return quiet(() => handleHarvestD1(new Request(`https://x${res.headers.get('location')}`), env, ctx));
};

/** What the driver ends up looking at after scanning. */
const scanPage = async (env, ctx, n, opts) => (await follow(env, ctx, await scan(env, ctx, n, opts))).text();

const post = (env, ctx, action, fields) => quiet(() => handleHarvestD1(
  new Request(`https://x/api/harvest?action=${action}&lang=en`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)]))),
  }), env, ctx));

const scanZone = (env, ctx, zone) => quiet(() => handleZoneScan(new Request(`https://x/z/${zone}?crew=A&lang=en`), env, ctx));

/** Earlier today and past the repeat window; see earlierTodayMins. */
const TODAY = earlierTodayMins();

const checkedLot = (html) => (html.match(/name="lot" value="(\d+)" required checked/) || [])[1] ?? null;
const checkedBay = (html) => (html.match(/name="bay" value="(\d+)" required checked/) || [])[1] ?? null;

/** Age a row, so "earlier today", "yesterday" and "past the window" are testable. */
const age = (sqlite, id, minutes) => sqlite.prepare(
  `UPDATE harvest_scan_log SET occurred_at = datetime('now','-${minutes} minutes') WHERE id = ?`).run(id);

/**
 * A trailer that already ran once today into `bay` — aged past the 5-minute
 * repeat window, so the next scan is a new load. Seeded directly: the point
 * is the state, not the path that made it.
 */
function ranEarlier(sqlite, { trailer, bay, lot, minutes = TODAY }) {
  const r = sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, season, bins, attributed_zone_session_id, bay, trailer, is_test, occurred_at)
    SELECT 'barn_load', zone, season, 24, id, ?, ?, 1, datetime('now', ?) FROM harvest_scan_log WHERE id = ?
  `).run(bay, trailer, `-${minutes} minutes`, lot);
  return Number(r.lastInsertRowid);
}

before(function () {
  if (!sqliteAvailable) this.skip('node:sqlite unavailable (needs Node >= 22.5)');
  if (TODAY === null) this.skip('within 6 minutes of midnight Pacific: there is no "earlier today" to seed');
});

// --- one scan ------------------------------------------------------------------

test('an ordinary scan logs the load with no tap at all', async () => {
  const { sqlite, env, ctx } = freshDb();
  const r1 = seedSession(sqlite, { zone: 'R1', cultivar: 'Strawberry Doughnuts', opened: minsAgo(120) });
  ranEarlier(sqlite, { trailer: 3, bay: 9, lot: r1 });

  const res = await scan(env, ctx, 3);
  assert.equal(res.status, 303, 'the scan itself writes, then hands the phone a receipt');
  const row = lastLoad(sqlite);
  assert.deepEqual(
    { trailer: row.trailer, bins: row.bins, bay: row.bay, lot: row.attributed_zone_session_id, zone: row.zone, crew: row.crew },
    { trailer: 3, bins: 24, bay: 9, lot: r1, zone: 'R1', crew: 'A' }, 'the load carries the crew of its lot');

  const html = await (await follow(env, ctx, res)).text();
  assert.match(html, /T3: 24 bins logged/);
  assert.match(html, /→ R1 · Strawberry Doughnuts · Cut 1/);
  assert.match(html, /class="baybig">Bay 9</, 'the bay is the loudest thing on the receipt');
  assert.match(html, /Load #2 today for R1/);
});

test('the tab lands on the receipt, so reopening the browser cannot log it again', async () => {
  const { sqlite, env, ctx } = freshDb();
  const r1 = seedSession(sqlite, {});
  ranEarlier(sqlite, { trailer: 3, bay: 9, lot: r1 });

  const res = await scan(env, ctx, 3);
  const location = res.headers.get('location');
  assert.match(location, /^\/api\/harvest\?action=trailer_done&id=\d+&lang=en$/, 'absolute path, never /t/3');
  const before = loads(sqlite).length;
  for (let i = 0; i < 3; i++) {
    const again = await quiet(() => handleHarvestD1(new Request(`https://x${location}`), env, ctx));
    assert.equal(again.status, 200);
  }
  assert.equal(loads(sqlite).length, before, 're-opening the receipt writes nothing');
});

test('the decal logs through the worker, the way a scanned QR reaches it', async () => {
  const { sqlite, env, ctx } = freshDb();
  const r1 = seedSession(sqlite, {});
  ranEarlier(sqlite, { trailer: 2, bay: 4, lot: r1 });
  const res = await quiet(() => worker.fetch(new Request('https://x/t/2?lang=en'), env, ctx));
  assert.equal(res.status, 303);
  assert.equal(lastLoad(sqlite).trailer, 2);
});

test('just after a zone change, the scan logs to the lot it was cut from', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z8 = seedSession(sqlite, { zone: 'Z8', cultivar: 'Orange Pineapple Quik', cut: 2, opened: minsAgo(300), closed: minsAgo(3) });
  seedSession(sqlite, { zone: 'Z21', cultivar: 'Lifter', opened: minsAgo(3) });
  ranEarlier(sqlite, { trailer: 5, bay: 2, lot: z8, minutes: TODAY });

  await scan(env, ctx, 5);
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, z8);
  assert.equal(lastLoad(sqlite).zone, 'Z8');
});

test('past the grace window the scan logs to the open lot', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, { zone: 'Z4', opened: minsAgo(300), closed: minsAgo(20) });
  const z5 = seedSession(sqlite, { zone: 'Z5', cultivar: 'Lifter', opened: minsAgo(20) });
  ranEarlier(sqlite, { trailer: 1, bay: 6, lot: z4, minutes: TODAY });

  await scan(env, ctx, 1);
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, z5);
});

test('a lot left open over a weekend still takes the trailer', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, { zone: 'Z4', opened: minsAgo(60 * 24 * 4) });
  ranEarlier(sqlite, { trailer: 1, bay: 5, lot: z4 });
  const res = await scan(env, ctx, 1);
  assert.equal(res.status, 303);
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, z4);
});

test('a trailer load lands on the lot in the ledger', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter' });
  const first = ranEarlier(sqlite, { trailer: 1, bay: 2, lot: z4 });
  await scan(env, ctx, 1);
  const second = lastLoad(sqlite).id;
  await post(env, ctx, 'trailer_fix', { id: second, bay: 2, bins: 14 });   // the short last trailer

  const body = await handleHarvestD1(new Request(`https://x/api/harvest?action=rollup&season=${SEASON}`,
    { headers: { authorization: 'test-password' } }), env, ctx).then(r => r.json());
  const lot = (body.lots || body.data?.lots || []).find(l => l.zone === 'Z4');
  assert.equal(lot.loads, 2);
  assert.equal(lot.bins, 38);
  assert.ok(first < second);
});

// --- when it has to ask ----------------------------------------------------------

test('a trailer\'s first run of the day asks for the bay once, and writes nothing', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter' });

  const res = await scan(env, ctx, 3);
  assert.equal(res.status, 200, 'an ask screen, not a redirect');
  assert.equal(loads(sqlite).length, 0);
  const html = await res.text();
  assert.match(html, /First load of the day: tap the bay once/);
  assert.equal(checkedLot(html), String(z4), 'the lot is still worked out for them');
  assert.equal(checkedBay(html), null, 'nothing logged today, so no bay to guess');
  assert.match(html, /action="\/api\/harvest\?action=trailer_log&lang=en"/);

  // The one tap. Then the next scan is hands-free.
  const tapped = await post(env, ctx, 'trailer_log', { trailer: 3, lot: z4, bay: 9 });
  assert.equal(tapped.status, 303);
  assert.equal(lastLoad(sqlite).bay, 9);
  age(sqlite, lastLoad(sqlite).id, TODAY);
  assert.equal((await scan(env, ctx, 3)).status, 303);
  assert.equal(loads(sqlite).length, 2);
  assert.equal(lastLoad(sqlite).bay, 9);
});

test('a bay from yesterday is asked about again, not reused', async () => {
  // Overnight the barn moves on to the next bay.
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, {});
  ranEarlier(sqlite, { trailer: 3, bay: 9, lot: z4, minutes: 60 * 26 });

  const res = await scan(env, ctx, 3);
  assert.equal(res.status, 200);
  assert.equal(loads(sqlite).length, 1, 'only yesterday\'s');
  const html = await res.text();
  assert.equal(checkedBay(html), null);
  assert.match(html, /9 was a different day/);
});

test('a new bay from any trailer moves every trailer', async () => {
  // Koa, 2026-09-29: the barn went from bay 10 to 9 mid-morning and each
  // trailer kept logging its OWN last bay. The newest load's bay wins.
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, {});
  ranEarlier(sqlite, { trailer: 4, bay: 10, lot: z4, minutes: TODAY });
  ranEarlier(sqlite, { trailer: 3, bay: 9, lot: z4, minutes: TODAY - 1 });   // newer
  await scan(env, ctx, 4);
  assert.equal(lastLoad(sqlite).bay, 9, 'T4 follows the bay T3 moved to');
});

test('fixing the bay on a receipt moves every trailer', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, {});
  ranEarlier(sqlite, { trailer: 3, bay: 10, lot: z4 });
  await scan(env, ctx, 3);                                      // logged into 10
  await post(env, ctx, 'trailer_fix', { id: lastLoad(sqlite).id, bay: 9, bins: 24 });
  await scan(env, ctx, 5);
  assert.equal(lastLoad(sqlite).bay, 9);
});

test('a load logged on the barn tablet moves the trailers too', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, { zone: 'Z4' });
  ranEarlier(sqlite, { trailer: 3, bay: 10, lot: z4 });
  await post(env, ctx, 'barn_log', { zone: 'Z4', bins: 24, bay: 9 });
  await scan(env, ctx, 3);
  assert.equal(lastLoad(sqlite).bay, 9);
});

test('with nothing open the driver must pick, and a load never saves without a lot', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, { zone: 'Z4', opened: minsAgo(300), closed: minsAgo(120) });
  ranEarlier(sqlite, { trailer: 1, bay: 3, lot: z4, minutes: 130 });
  const before = loads(sqlite).length;

  const res = await scan(env, ctx, 1);
  assert.equal(res.status, 200);
  assert.equal(loads(sqlite).length, before, 'no lot, no row');
  const html = await res.text();
  assert.equal(checkedLot(html), null, 'there is no honest default');
  assert.match(html, /Which lot did it come from\?/);

  assert.ok((await post(env, ctx, 'trailer_log', { trailer: 1, bay: 3 })).status >= 400);
  assert.equal(loads(sqlite).length, before);
  await post(env, ctx, 'trailer_log', { trailer: 1, lot: z4, bay: 3 });
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, z4);
});

test('with no recent lots there is no form, only what to do about it', async () => {
  const { env, ctx } = freshDb();
  const html = await scanPage(env, ctx, 1);
  assert.doesNotMatch(html, /id="trailerForm"/);
  assert.match(html, /Ask the crew lead to scan the zone sign/);
});

test('it is Spanish by default, in the crew\'s own words', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, {});
  const ask = await scanPage(env, ctx, 1, { lang: null });
  assert.match(ask, /Primera carga del día: toca la bahía/);
  ranEarlier(sqlite, { trailer: 2, bay: 7, lot: z4 });
  const receipt = await scanPage(env, ctx, 2, { lang: null });
  assert.match(receipt, /T2: 24 cajas anotadas/);
  assert.match(receipt, /Bahía 7/);
});

// --- never from a machine ----------------------------------------------------------

test('a link preview, a prefetch or a HEAD never logs a load', async () => {
  // The URL is printed on a trailer; someone will text it.
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, {});
  ranEarlier(sqlite, { trailer: 3, bay: 9, lot: z4 });
  const before = loads(sqlite).length;
  const machines = [
    { headers: { 'user-agent': 'WhatsApp/2.23.20.0' } },
    { headers: { 'user-agent': 'TelegramBot (like TwitterBot)' } },
    { headers: { 'user-agent': 'facebookexternalhit/1.1' } },
    { headers: { 'user-agent': 'Slackbot-LinkExpanding 1.0' } },
    { headers: { 'sec-purpose': 'prefetch;prerender' } },
    { headers: { purpose: 'prefetch' } },
    { method: 'HEAD' },
  ];
  for (const m of machines) {
    const res = await scan(env, ctx, 3, m);
    assert.notEqual(res.status, 303, JSON.stringify(m));
  }
  assert.equal(loads(sqlite).length, before);
  // And a real phone still logs.
  const phone = { headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' } };
  assert.equal((await scan(env, ctx, 3, phone)).status, 303);
});

// --- no cooldown, no double-scan flag -------------------------------------------
//
// Koa, 2026-09-29: the 5-minute block refused real trailers the first morning
// and sent the crew back to the barn tablet; the amber "double scan?" warning
// that replaced it was dropped the same day. Every scan logs, every receipt is
// the green one, and doubles are Koa's to spot in the data.

test('every scan logs, even seconds apart — there is no cooldown', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, {});
  ranEarlier(sqlite, { trailer: 3, bay: 9, lot: z4 });
  for (let i = 0; i < 3; i++) assert.equal((await scan(env, ctx, 3)).status, 303);
  assert.equal(loads(sqlite).length, 4, 'the earlier run plus all three scans');
});

test('a quick second scan gets the same green receipt — no double-scan warning', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, {});
  ranEarlier(sqlite, { trailer: 3, bay: 9, lot: z4 });
  await scan(env, ctx, 3);
  const second = await (await follow(env, ctx, await scan(env, ctx, 3))).text();
  assert.match(second, /class="logged-flash ok"/);
  assert.doesNotMatch(second, /class="logged-flash warn"|was also logged|Double scan/);
  // Undo still exists, folded inside Fix with the rest of the corrections.
  const inFix = second.slice(second.indexOf('class="fixload"'));
  assert.match(inFix, /name="undo" value="1"/);
});

test('two scans at the same moment both log', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, {});
  ranEarlier(sqlite, { trailer: 3, bay: 9, lot: z4 });
  const [a, b] = await Promise.all([scan(env, ctx, 3), scan(env, ctx, 3)]);
  assert.deepEqual([a.status, b.status], [303, 303]);
  assert.equal(loads(sqlite).length, 3);
});

test('the ask screen logs every submit too', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, {});
  await post(env, ctx, 'trailer_log', { trailer: 3, lot: z4, bay: 9, partial_bins: 12 });
  const res = await post(env, ctx, 'trailer_log', { trailer: 3, lot: z4, bay: 9, partial_bins: 12 });
  assert.equal(res.status, 303);
  assert.equal(loads(sqlite).length, 2);
});

// --- the "logged" flash -----------------------------------------------------

test('a fresh scan lands on a full-screen green "Logged!" the driver can read at a glance', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z2 = seedSession(sqlite, { zone: 'Z2', cultivar: 'Sour Lifter' });
  ranEarlier(sqlite, { trailer: 3, bay: 9, lot: z2 });
  const html = await (await follow(env, ctx, await scan(env, ctx, 3))).text();
  assert.match(html, /class="logged-flash ok" role="status" aria-live="assertive"/);
  assert.match(html, /<div class="lf-big">Logged!<\/div>/);
  assert.match(html, /T3 · 24 bins · Bay 9/);
  assert.match(html, /→ Z2 · Sour Lifter/);
  assert.match(html, /f\.classList\.add\('out'\)/, 'it fades by itself');
  // Spanish by default, in the crew's words.
  const es = await (await follow(env, ctx, await scan(env, ctx, 4, { lang: null }))).text();
  assert.match(es, /¡Anotada!/);
  assert.match(es, /T4 · 24 cajas · Bahía 9/);
});

test('an old receipt reopened later does not flash', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, {});
  ranEarlier(sqlite, { trailer: 3, bay: 9, lot: z4 });
  await scan(env, ctx, 3);
  const id = lastLoad(sqlite).id;
  age(sqlite, id, 2);
  const html = await (await quiet(() => handleHarvestD1(
    new Request(`https://x/api/harvest?action=trailer_done&id=${id}&lang=en`), env, ctx))).text();
  assert.doesNotMatch(html, /class="logged-flash/, 'no flash element (the stylesheet naming it does not count)');
  assert.match(html, /T3: 24 bins logged/, 'the receipt itself is still there');
});

// --- "Log another load" on the receipt -----------------------------------------

test('the receipt carries a big "Log another load" button that logs like a scan', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z2 = seedSession(sqlite, { zone: 'Z2' });
  ranEarlier(sqlite, { trailer: 3, bay: 9, lot: z2 });
  const receipt = await (await follow(env, ctx, await scan(env, ctx, 3))).text();
  assert.match(receipt, /action="\/api\/harvest\?action=trailer_again&lang=en"/);
  assert.match(receipt, /name="trailer" value="3"/);
  assert.match(receipt, /Log another load · T3/);

  const res = await post(env, ctx, 'trailer_again', { trailer: 3 });
  assert.equal(res.status, 303, 'a tap is a scan: log, then the receipt');
  const row = lastLoad(sqlite);
  assert.deepEqual({ t: row.trailer, bins: row.bins, bay: row.bay, lot: row.attributed_zone_session_id },
    { t: 3, bins: 24, bay: 9, lot: z2 });
  const next = await (await follow(env, ctx, res)).text();
  assert.match(next, /class="logged-flash ok"/, 'the same green confirmation as a scan');
});

test('the button is locked while the green flash is up, so a dismissing tap cannot log twice', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z2 = seedSession(sqlite, {});
  ranEarlier(sqlite, { trailer: 3, bay: 9, lot: z2 });
  const fresh = await (await follow(env, ctx, await scan(env, ctx, 3))).text();
  assert.match(fresh, /class="btn again-btn" type="submit" disabled data-unlock/);
  assert.match(fresh, /\.again-btn\[data-unlock\]/, 'and the flash script unlocks it afterwards');

  const id = lastLoad(sqlite).id;
  age(sqlite, id, 2);
  const later = await (await quiet(() => handleHarvestD1(
    new Request(`https://x/api/harvest?action=trailer_done&id=${id}&lang=en`), env, ctx))).text();
  assert.match(later, /class="btn again-btn" type="submit">/, 'a receipt reopened later is ready to tap');
});

test('only a real tap logs: fetching the button URL writes nothing', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z2 = seedSession(sqlite, {});
  ranEarlier(sqlite, { trailer: 3, bay: 9, lot: z2 });
  const before = loads(sqlite).length;
  const res = await quiet(() => handleHarvestD1(
    new Request('https://x/api/harvest?action=trailer_again&trailer=3&lang=en'), env, ctx));
  assert.ok(res.status >= 400);
  assert.equal(loads(sqlite).length, before);
  assert.ok((await post(env, ctx, 'trailer_again', { trailer: 9 })).status >= 400, 'no trailer T9');
});

test('the button asks, like a scan, when there is no bay yet today', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedSession(sqlite, {});
  const res = await post(env, ctx, 'trailer_again', { trailer: 3 });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /First load of the day: tap the bay once/);
  assert.equal(loads(sqlite).length, 0);
});

// --- fixes and undo --------------------------------------------------------------

test('the receipt fixes the bay, a partial and the lot, inside ten minutes', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z8 = seedSession(sqlite, { zone: 'Z8', cultivar: 'Rainbow Cake', opened: minsAgo(400), closed: minsAgo(30) });
  const z10 = seedSession(sqlite, { zone: 'Z10', cultivar: 'Spruce Dough', opened: minsAgo(30) });
  ranEarlier(sqlite, { trailer: 2, bay: 9, lot: z10, minutes: TODAY });
  await scan(env, ctx, 2);
  const id = lastLoad(sqlite).id;

  const receipt = await (await follow(env, ctx, { status: 303, headers: new Headers({ location: `/api/harvest?action=trailer_done&id=${id}&lang=en` }) })).text();
  assert.match(receipt, /Fix this load/);
  assert.match(receipt, /Fixes stay open until/);
  assert.match(receipt, new RegExp(`name="lot" value="${z8}"`), 'the lot it may really have come from is offered');

  const res = await post(env, ctx, 'trailer_fix', { id, bay: 10, bins: 14, lot: z8 });
  assert.equal(res.status, 303);
  const row = lastLoad(sqlite);
  assert.deepEqual({ bay: row.bay, bins: row.bins, lot: row.attributed_zone_session_id, zone: row.zone },
    { bay: 10, bins: 14, lot: z8, zone: 'Z8' }, 'zone moves with the lot, so the two never disagree');
});

test('a fix that leaves the lot alone keeps it, even an old one that just closed', async () => {
  const { sqlite, env, ctx } = freshDb();
  const long = seedSession(sqlite, { zone: 'Z4', opened: minsAgo(60 * 24 * 4), closed: minsAgo(2) });
  ranEarlier(sqlite, { trailer: 1, bay: 5, lot: long, minutes: TODAY });
  await scan(env, ctx, 1);
  const id = lastLoad(sqlite).id;
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, long);
  assert.equal((await post(env, ctx, 'trailer_fix', { id, bay: 6, bins: 24, lot: long })).status, 303);
  assert.equal(lastLoad(sqlite).bay, 6);
});

test('fixes are refused, and change nothing, once ten minutes have passed', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, {});
  ranEarlier(sqlite, { trailer: 3, bay: 9, lot: z4 });
  await scan(env, ctx, 3);
  const id = lastLoad(sqlite).id;
  age(sqlite, id, 11);

  const html = await (await quiet(() => handleHarvestD1(
    new Request(`https://x/api/harvest?action=trailer_done&id=${id}&lang=en`), env, ctx))).text();
  assert.doesNotMatch(html, /id="trailerFix"/);
  assert.match(html, /can no longer be changed here/);

  assert.ok((await post(env, ctx, 'trailer_fix', { id, bay: 1, bins: 10 })).status >= 400);
  assert.ok((await post(env, ctx, 'trailer_fix', { id, undo: 1 })).status >= 400);
  const row = lastLoad(sqlite);
  assert.deepEqual({ id: row.id, bay: row.bay, bins: row.bins }, { id, bay: 9, bins: 24 });
});

test('bad fixes are refused: bins outside 1-24, a bay outside 1-12, a lot that is not one', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, {});
  ranEarlier(sqlite, { trailer: 3, bay: 9, lot: z4 });
  await scan(env, ctx, 3);
  const id = lastLoad(sqlite).id;
  for (const f of [{ bins: 0 }, { bins: 25 }, { bins: '12.5' }, { bins: 'abc' }, { bay: 13 }, { bay: '' }, { lot: 99999 }]) {
    const res = await post(env, ctx, 'trailer_fix', { id, bay: 9, bins: 24, ...f });
    assert.ok(res.status >= 400, JSON.stringify(f));
  }
  const row = lastLoad(sqlite);
  assert.deepEqual({ bay: row.bay, bins: row.bins }, { bay: 9, bins: 24 });
});

test('undo removes a mistaken scan inside the window', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, {});
  ranEarlier(sqlite, { trailer: 3, bay: 9, lot: z4 });
  await scan(env, ctx, 3);
  const id = lastLoad(sqlite).id;

  const html = await (await post(env, ctx, 'trailer_fix', { id, undo: 1 })).text();
  assert.match(html, /T3: load removed/);
  assert.equal(loads(sqlite).length, 1, 'only the earlier load is left');
  assert.ok((await post(env, ctx, 'trailer_fix', { id, undo: 1 })).status >= 400, 'undoing twice is a clear no');
});

test('a receipt or a fix for something that is not a trailer load is refused', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, {});
  for (const id of [z4, 99999, 'abc']) {
    const res = await quiet(() => handleHarvestD1(
      new Request(`https://x/api/harvest?action=trailer_done&id=${id}&lang=en`), env, ctx));
    assert.ok(res.status >= 400, `receipt ${id}`);
    assert.ok((await post(env, ctx, 'trailer_fix', { id, undo: 1 })).status >= 400, `undo ${id}`);
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM harvest_scan_log').get().n, 1, 'the lot itself is untouched');
});

// --- the ask screen's own rules ---------------------------------------------------

test('a partial from the ask screen stores the number typed; anything else is refused', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, {});
  await post(env, ctx, 'trailer_log', { trailer: 1, lot: z4, bay: 3, partial_bins: 14 });
  assert.equal(lastLoad(sqlite).bins, 14);
  await post(env, ctx, 'trailer_log', { trailer: 2, lot: z4, bay: 3, partial_bins: '' });
  assert.equal(lastLoad(sqlite).bins, 24, 'an empty partial box is a full trailer');

  const before = loads(sqlite).length;
  for (const bad of ['24', '30', '0', '-3', '12.5', 'abc']) {
    assert.ok((await post(env, ctx, 'trailer_log', { trailer: 3, lot: z4, bay: 3, partial_bins: bad })).status >= 400, bad);
  }
  assert.ok((await post(env, ctx, 'trailer_log', { trailer: 3, lot: z4 })).status >= 400, 'no bay');
  assert.ok((await post(env, ctx, 'trailer_log', { trailer: 3, lot: z4, bay: 13 })).status >= 400, 'bay 13');
  assert.equal(loads(sqlite).length, before);
});

test('what the driver saw on the ask screen is what is saved, even if the zone changes', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, { zone: 'Z4', opened: minsAgo(120) });
  const shown = checkedLot(await scanPage(env, ctx, 2));
  assert.equal(shown, String(z4));
  await scanZone(env, ctx, 'Z5');   // the crew moves on while the driver is reading
  await post(env, ctx, 'trailer_log', { trailer: 2, lot: shown, bay: 4 });
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, z4);
});

test('an unknown trailer is refused, not guessed at', async () => {
  const { env, ctx } = freshDb();
  for (const n of ['9', '0', 'abc', '1abc', '2/x', '03']) {
    assert.ok((await scan(env, ctx, n)).status >= 400, `/t/${n}`);
  }
});

// ─── "Add to Home Screen" (Koa, 2026-10-08) ──────────────────────────────
// The icon opens /t/<n>?home: one big button, nothing logged until it is
// tapped. Each trailer has its own manifest and icon so the phone shows "T3".

/** A GET of a trailer URL with its own query string, the way a home-screen icon or a manifest fetch does it. */
const getT = (env, ctx, pathAndQuery, headers = {}) =>
  quiet(() => handleTrailerScan(new Request(`https://x/t/${pathAndQuery}`, { headers }), env, ctx));

test('the home-screen launcher opens with one button and logs nothing by itself', async () => {
  const { sqlite, env, ctx } = freshDb();
  const r1 = seedSession(sqlite, { zone: 'R1', cultivar: 'Strawberry Doughnuts', opened: minsAgo(120) });
  ranEarlier(sqlite, { trailer: 3, bay: 9, lot: r1 });
  const before = lastLoad(sqlite).id;

  const res = await getT(env, ctx, '3?home&lang=en');
  assert.equal(res.status, 200, 'a page, not the 303 a real scan answers');
  assert.equal(lastLoad(sqlite).id, before, 'opening the launcher is not a load');
  const html = await res.text();
  assert.match(html, /action=trailer_again/, 'the button posts what the decal scan does');
  assert.match(html, /name="trailer" value="3"/);
  assert.match(html, /Log a load · T3/);
  assert.match(html, /id="a2hsBtn"/, 'the launcher itself offers Add to Home Screen');
  assert.match(html, /rel="manifest" href="\/t\/3\/manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" href="\/t\/3\/icon-180\.png"/);
  assert.match(html, /apple-mobile-web-app-title" content="T3"/);
  assert.doesNotMatch(html, /how\.hidden = false;/, 'the steps stay folded unless asked for');
  // iOS keeps the page the icon was added from, so the launcher itself is the scan when it runs as an app
  assert.match(html, /if \(!standalone\) return;\s*var f = document\.querySelector\('form\.again'\)/, 'as a home-screen app the launcher submits at once');
});

test('arriving from the receipt button unfolds the install steps', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedSession(sqlite, {});
  const html = await (await getT(env, ctx, '3?home&add&lang=en')).text();
  assert.match(html, /how\.hidden = false;/);
  assert.match(html, /Add to Home Screen/);
  assert.match(html, /tap Share/, 'the iPhone steps are on the page');
  assert.match(html, /Add to Home screen" or "Install"/, 'and the Android steps');
});

test('the receipt offers Add to Home Screen and carries the install tags', async () => {
  const { sqlite, env, ctx } = freshDb();
  const r1 = seedSession(sqlite, { zone: 'R1', cultivar: 'Strawberry Doughnuts', opened: minsAgo(120) });
  ranEarlier(sqlite, { trailer: 3, bay: 9, lot: r1 });
  const html = await scanPage(env, ctx, 3);
  assert.match(html, /href="\/t\/3\?home&add&lang=en"[^>]*>📲 Add to Home Screen/);
  assert.match(html, /rel="manifest" href="\/t\/3\/manifest\.webmanifest"/);
  assert.match(html, /apple-mobile-web-app-title" content="T3"/);
  assert.match(html, /wakeLock/, 'the receipt keeps the screen on between loads');
  assert.match(html, /var MIN = 15000, hiddenAt = null;/, 'a home-screen app logs on any return longer than its own 5-second tick');
  assert.match(html, /if \(!standalone\) return;/, 'but never from a plain browser tab');
  assert.match(html, /var AGE = \d+;\s*if \(AGE >= MIN\) \{ press\(\); return; \}/, 'a stale receipt reopened as an app logs the next load');
  assert.match(html, /setInterval\(function \(\) \{\s*var now = Date\.now\(\);\s*if \(now - last >= MIN\)/, 'a frozen-then-woken app sees the gap on its clock and logs, without needing a visibility event');
  assert.match(html, /var AGE = [0-9]{1,5};/, 'a receipt served right after its scan is seconds old, not minutes');
});

test('the home-screen icon start page logs like a scan, and says it came from the icon', async () => {
  const { sqlite, env, ctx } = freshDb();
  const r1 = seedSession(sqlite, { zone: 'R1', cultivar: 'Strawberry Doughnuts', opened: minsAgo(120) });
  ranEarlier(sqlite, { trailer: 3, bay: 9, lot: r1 });
  const before = lastLoad(sqlite).id;
  const res = await getT(env, ctx, '3?app&lang=en');
  assert.equal(res.status, 303, 'the icon tap writes and lands on the receipt');
  const row = lastLoad(sqlite);
  assert.equal(row.id, before + 1);
  assert.deepEqual({ trailer: row.trailer, bins: row.bins, bay: row.bay }, { trailer: 3, bins: 24, bay: 9 });
  // The 'home icon' wording goes to the Telegram message only; the row itself cannot tell an icon tap from a scan.
});

test('each trailer has its own manifest, naming it and opening its launcher', async () => {
  const { env, ctx } = freshDb();
  const res = await getT(env, ctx, '3/manifest.webmanifest?lang=es');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/manifest\+json/);
  assert.match(res.headers.get('cache-control'), /max-age=300/, 'short-lived, so a re-added icon sees the current manifest');
  const m = JSON.parse(await res.text());
  assert.equal(m.short_name, 'T3');
  assert.equal(m.start_url, '/t/3?app&lang=es', 'the icon opens the logging URL: tapping it IS the scan (Koa, 2026-10-08)');
  assert.equal(m.display, 'standalone');
  assert.deepEqual(m.icons.map(i => [i.src, i.sizes, i.type]),
    [['/t/3/icon-192.png', '192x192', 'image/png'], ['/t/3/icon-512.png', '512x512', 'image/png']]);
});

test('the icons are real PNGs, and only the sizes and trailers that exist', async () => {
  const { env, ctx } = freshDb();
  for (const size of [180, 192, 512]) {
    const res = await getT(env, ctx, `3/icon-${size}.png`);
    assert.equal(res.status, 200, `icon-${size}`);
    assert.equal(res.headers.get('content-type'), 'image/png');
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'PNG signature');
  }
  assert.ok((await getT(env, ctx, '3/icon-64.png')).status >= 400, 'no such size');
  assert.ok((await getT(env, ctx, '9/manifest.webmanifest')).status >= 400, 'no such trailer');
  assert.ok((await getT(env, ctx, '9/icon-180.png')).status >= 400);
});

test('fetching the manifest or an icon never logs a load, even with a lot open and a bay set', async () => {
  const { sqlite, env, ctx } = freshDb();
  const r1 = seedSession(sqlite, { zone: 'R1', cultivar: 'Strawberry Doughnuts', opened: minsAgo(120) });
  ranEarlier(sqlite, { trailer: 3, bay: 9, lot: r1 });
  const before = lastLoad(sqlite).id;
  await getT(env, ctx, '3/manifest.webmanifest');
  await getT(env, ctx, '3/icon-192.png');
  assert.equal(lastLoad(sqlite).id, before);
  // and the plain scan still logs, so the asset branch did not swallow it
  assert.equal((await scan(env, ctx, 3)).status, 303);
  assert.equal(lastLoad(sqlite).id, before + 1);
});
