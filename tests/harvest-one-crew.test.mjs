/**
 * One crew, one open lot (Koa, 2026-09-28).
 *
 * The 2026 build ran two crews, told apart by a Crew A / Crew B tag on the
 * lead's phone, with barn door 1 wired to Crew A and door 2 to Crew B. In
 * practice a second, untagged phone kept scanning zone signs, and door 1 only
 * ever matched Crew A sessions — so every trailer cut under an untagged
 * session saved with NO lot. On 2026-09-24 that was four R1 loads, 96 bins of
 * Strawberry Doughnuts, missing from the ledger; on 9/28 four Z8 loads. The two
 * tag chains also left two lots open at once, because each phone only closed
 * its own.
 *
 * Now the operation is one crew: two cutting groups, always in the same zone
 * on the same cultivar. So there is exactly one open lot, any scan moves it,
 * every door follows it, and the crew tag is ignored (and cleared by the old
 * card). The regression test at the heart of this file is the 9/24 shape: an
 * untagged session and a door that used to belong to Crew A.
 *
 * Trailers now log themselves by their own QR — see harvest-trailer.test.mjs.
 * The doors here are the fallback.
 *
 * Run with `node --test`.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { qrDataUri } from '../workers/src/lib/qr.js';
import { freshDb, quiet, minsAgo, seedSession, sessions, openSessions, lastLoad, loads,
  modUrl, sqliteAvailable } from './helpers/harvest-sqlite.mjs';

const { handleHarvestD1, handleZoneScan, handleCrewScan, handleBarnScan,
  handleDayEndScan, handleTrailerScan } = await import(modUrl('workers/src/handlers/harvest-d1.js'));

/** A zone sign scanned from a phone that may still carry an old crew tag. */
const scanZone = (env, ctx, zone, crew = null) => quiet(() => handleZoneScan(
  new Request(`https://x/z/${zone}?crew=A&lang=en`, {
    headers: crew ? { cookie: `rf_crew=${crew}` } : {},
  }), env, ctx));

/** The barn tablet at a given door. No station = the bare /b. */
const barnForm = (env, ctx, station, lang = 'en') => quiet(() => handleBarnScan(
  new Request(`https://x/b${station ? `/${station}` : ''}?lang=${lang}`), env, ctx));

/** A load submitted from a door, the way the form carries it. */
const logLoadAt = (env, ctx, zone, bins, station = null, extra = {}) => quiet(() => handleHarvestD1(
  new Request('https://x/api/harvest?action=barn_log&lang=en', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ zone, bins: String(bins),
      ...(station ? { station: String(station) } : {}), ...extra }),
  }), env, ctx));

const backdate = (sqlite, id, minutes) => sqlite.prepare(
  `UPDATE harvest_scan_log SET occurred_at = datetime('now','-${minutes} minutes') WHERE id = ?`).run(id);

before(function () {
  if (!sqliteAvailable) this.skip('node:sqlite unavailable (needs Node >= 22.5)');
});

// --- one open lot -------------------------------------------------------------

test('scanning a new zone closes the open one, whichever phone scans it', async () => {
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', 'A');     // a phone still carrying the old tag
  await scanZone(env, ctx, 'Z7', null);    // the other phone

  // Under the two-crew build these were two open lots, forever: neither phone
  // could close the other's.
  assert.deepEqual(openSessions(sqlite).map(s => s.zone), ['Z7']);
});

test('the first scan after the two-crew build closes BOTH old chains', async () => {
  // Exactly the live state on 2026-09-28: Z10 open under Crew A and Z2 open
  // untagged. One scan has to leave one lot open, not three.
  const { sqlite, env, ctx } = freshDb();
  seedSession(sqlite, { zone: 'Z10', cultivar: 'Strawberry Doughnuts', crew: 'A', opened: minsAgo(90) });
  seedSession(sqlite, { zone: 'Z2', cultivar: 'Sour Lifter', crew: null, opened: minsAgo(30) });

  await scanZone(env, ctx, 'Z4', null);
  assert.deepEqual(openSessions(sqlite).map(s => s.zone), ['Z4']);
});

test('a new lot carries the crew the lead tapped, never the phone\'s old tag', async () => {
  // Three crews (2026-10-03): the crew rides in the tapped link (crew=A), and
  // an old rf_crew=B cookie on the phone changes nothing.
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4', 'B');
  assert.equal(openSessions(sqlite)[0].crew, 'A');
});

test('re-scanning the open zone later is a resumption, not a new cut', async () => {
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4');
  backdate(sqlite, openSessions(sqlite)[0].id, 90);   // past the refresh debounce

  await scanZone(env, ctx, 'Z4');
  const all = sessions(sqlite);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map(s => s.cut_number), [1, 1], 'a re-scan must not invent cut 2');
  assert.equal(openSessions(sqlite).length, 1);
});

test('a refresh inside the debounce opens nothing new', async () => {
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4');
  await scanZone(env, ctx, 'Z4');
  assert.equal(sessions(sqlite).length, 1);
});

test('the zone screen names the crew that was tapped, with its lead', async () => {
  const { env, ctx } = freshDb();
  const html = await (await scanZone(env, ctx, 'Z4', 'B')).text();
  const visible = html.replace(/<style[\s\S]*?<\/style>/g, '');
  assert.match(visible, /Crew A · Nico/);
  assert.doesNotMatch(visible, /Crew B/, 'the phone\'s old tag is not a crew');
});

test('status reports the one open lot', async () => {
  const { env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4');
  await scanZone(env, ctx, 'Z7');
  const d = await handleHarvestD1(new Request('https://x/api/harvest?action=status'), env, ctx).then(r => r.json());
  const zones = (d.active_zones || d.data?.active_zones || []);
  assert.deepEqual(zones.map(z => z.zone), ['Z7']);
});

// --- a zone continues its cut -------------------------------------------------
//
// Koa, 2026-09-30: "not sure why cut 2 was started, this is still zone 11 cut
// 1". An 8-hour rule started a new cut whenever a zone was re-entered more than
// 8 h after its last close — every morning. A zone keeps its cut now; a new one
// starts only when the lead says so on the zone screen.

// The zone screen asks once before moving the cut (2026-10-07); this plays the
// confirmed second press. The first press has its own tests in
// harvest-cut-change.test.mjs.
const cutChange = (env, ctx, sessionId, dir = 'next', method = 'POST') => quiet(() => handleHarvestD1(
  method === 'POST'
    ? new Request('https://x/api/harvest?action=cut_change&lang=en', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ session_id: String(sessionId), dir, confirm: '1' }),
      })
    : new Request(`https://x/api/harvest?action=cut_change&session_id=${sessionId}&dir=${dir}&lang=en`), env, ctx));

test('THE 9/30 BUG: the morning scan of a zone closed the night before is still cut 1', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedSession(sqlite, { zone: 'Z11', opened: minsAgo(60 * 18), closed: minsAgo(60 * 14) });   // closed 14 h ago
  const html = await (await scanZone(env, ctx, 'Z11')).text();
  assert.equal(openSessions(sqlite)[0].cut_number, 1);
  assert.match(html, /Cut 1/);
  assert.match(html, /<details class="cvfix cutfix">/, 'the "new cut?" question is there, folded shut');
});

test('even weeks later the scan does not decide, and the new-cut question stays closed', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedSession(sqlite, { zone: 'Z4', opened: minsAgo(60 * 24 * 22), closed: minsAgo(60 * 24 * 21) });
  const html = await (await scanZone(env, ctx, 'Z4')).text();
  assert.equal(openSessions(sqlite)[0].cut_number, 1, 'still cut 1 until someone says otherwise');
  // Koa 2026-10-04: a cut changes only on Koa's word; idle days must not open the question
  assert.match(html, /<details class="cvfix cutfix">/);
  assert.doesNotMatch(html, /<details class="cvfix cutfix" open>/);
  assert.match(html, /last cut 21 days ago/);
  assert.match(html, /Start cut 2/);
});

test('"Start cut 2" is how a new cut begins, it sticks, and a mis-tap has a way back', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedSession(sqlite, { zone: 'Z4', opened: minsAgo(60 * 24 * 22), closed: minsAgo(60 * 24 * 21) });
  await scanZone(env, ctx, 'Z4');
  const id = openSessions(sqlite)[0].id;

  const html = await (await cutChange(env, ctx, id)).text();
  assert.equal(openSessions(sqlite)[0].cut_number, 2);
  assert.match(html, /Now cut 2/);
  assert.match(html, /Back to cut 1/);

  // The next morning's scan carries on with cut 2.
  sqlite.prepare("UPDATE harvest_scan_log SET occurred_at = datetime('now','-20 hours'), closed_at = datetime('now','-14 hours') WHERE id = ?").run(id);
  await scanZone(env, ctx, 'Z4');
  assert.equal(openSessions(sqlite)[0].cut_number, 2);

  await cutChange(env, ctx, openSessions(sqlite)[0].id, 'prev');
  assert.equal(openSessions(sqlite)[0].cut_number, 1);
  assert.ok((await cutChange(env, ctx, openSessions(sqlite)[0].id, 'prev')).status >= 400, 'there is no cut 0');
});

test('the cut cannot change by a fetched link, on a closed lot, or once tags are printed', async () => {
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4');
  const id = openSessions(sqlite)[0].id;
  assert.ok((await cutChange(env, ctx, id, 'next', 'GET')).status >= 400, 'GET');

  sqlite.prepare(`INSERT INTO harvest_sacks (sack_id, season, serial, zone, cultivar, cut_number, zone_session_id, is_test)
    VALUES ('26-SLIFT-1', ?, 1, 'Z4', 'Sour Lifter', 1, ?, 1)`).run(new Date().getUTCFullYear(), id);
  const tagged = await cutChange(env, ctx, id);
  assert.ok(tagged.status >= 400);
  assert.match(await tagged.text(), /tag\(s\) printed/);
  sqlite.prepare('DELETE FROM harvest_sacks').run();

  sqlite.prepare("UPDATE harvest_scan_log SET closed_at = datetime('now') WHERE id = ?").run(id);
  assert.ok((await cutChange(env, ctx, id)).status >= 400, 'closed');
  assert.equal(sessions(sqlite)[0].cut_number, 1, 'nothing moved');
});

test('the zone screen shows the crew\'s people from the day\'s form, not a cutter grid', async () => {
  // Cutters are entered once per crew per day (with drivers and water
  // spiders) and ride on every lot the crew opens; the crew card changes them.
  const { sqlite, env, ctx } = freshDb();
  const html = await (await scanZone(env, ctx, 'Z5')).text();
  assert.doesNotMatch(html, /action=headcount&session_id=\d+&count=/);
  assert.match(html, /<strong>16<\/strong> Cutters/);
  assert.equal(openSessions(sqlite)[0].headcount, 16, 'the lot carries the crew\'s cutters');
});

// --- the retired crew card ---------------------------------------------------

test('the old crew card clears the tag off the phone and says why', async () => {
  // Laminated cards are still on clipboards. Scanning one must not error at
  // the person holding it, and must stop the tag riding around.
  const { env, ctx } = freshDb();
  for (const card of ['A', 'B', 'Q']) {
    const res = await quiet(() => handleCrewScan(new Request(`https://x/c/${card}?lang=en`), env, ctx));
    assert.equal(res.status, 200, `/c/${card}`);
    const all = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
    assert.match(all.join(' | '), /rf_crew=; Path=\/; Max-Age=0/);
    assert.match(await res.text(), /This card is no longer used/);
  }
});

// --- the doors (fallback) ----------------------------------------------------

test('THE 9/24 BUG: an untagged lot takes the load at the door that used to be Crew A', async () => {
  // R1 opened from the untagged phone; four trailers logged at door 1. Every
  // one saved with no lot, because door 1 only looked for Crew A sessions.
  const { sqlite, env, ctx } = freshDb();
  const r1 = seedSession(sqlite, { zone: 'R1', cultivar: 'Strawberry Doughnuts', crew: null, opened: minsAgo(40) });

  const html = await (await logLoadAt(env, ctx, 'R1', 24, 1)).text();
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, r1,
    'a null here is 24 bins that belong to no lot at all');
  assert.doesNotMatch(html, /logged with no lot/);
});

test('a lot opened under an old crew tag takes the load at either door', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z10 = seedSession(sqlite, { zone: 'Z10', cultivar: 'Strawberry Cream', crew: 'A' });
  await logLoadAt(env, ctx, 'Z10', 24, 2);
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, z10);
});

test('a door load carries the crew of the lot it lands on, not the door\'s', async () => {
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4');
  await logLoadAt(env, ctx, 'Z4', 24, 1);
  assert.equal(lastLoad(sqlite).crew, 'A');
});

test('every door follows the open lot', async () => {
  const { env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4');
  for (const station of [1, 2, null]) {
    const html = await (await barnForm(env, ctx, station)).text();
    assert.match(html, /<option value="Z4" selected/, `door ${station ?? '(bare)'}`);
    assert.doesNotMatch(html, /Crew [AB]|intake-choice/, 'no crew chooser left');
  }
});

test('the door says which door it is, and nothing about a crew', async () => {
  const { env, ctx } = freshDb();
  const html = await (await barnForm(env, ctx, 2)).text();
  assert.match(html, /Barn intake 2/);
  assert.match(html, /Follow the open zone/);
});

test('scanning the door QR makes the tablet remember which door it is', async () => {
  const { env, ctx } = freshDb();
  const res = await barnForm(env, ctx, 2);
  const all = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  assert.match(all.join(' | '), /rf_barn=2/);
});

test('the 6-minute grace still sends a late trailer to the lot it was cut in', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, { zone: 'Z4', opened: minsAgo(60), closed: minsAgo(4) });
  await scanZone(env, ctx, 'Z5');

  const html = await (await logLoadAt(env, ctx, 'Z4', 24, 1)).text();
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, z4);
  assert.match(html, /which just closed/);
});

// --- the door names the lot when nothing is open -----------------------------
//
// Koa, 2026-09-17: "If a zone isn't automatically assigned (which it should be
// if cut-leads scan it in) they will be able to catch it at the door."

const lotIdFor = (sqlite, zone) => sqlite.prepare(
  "SELECT id FROM harvest_scan_log WHERE event_type='enter' AND zone=? ORDER BY id DESC LIMIT 1").get(zone).id;

test('a load names its lot at the door, and lands on it', async () => {
  const { sqlite, env, ctx } = freshDb();
  const lot = seedSession(sqlite, { zone: 'Z4', opened: minsAgo(60 * 24), closed: minsAgo(60 * 20) });

  const plain = await logLoadAt(env, ctx, 'Z4', 24, 1);
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, null, 'without a lot it still lands on nothing');
  assert.match(await plain.text(), /logged with no lot/i);

  const html = await (await logLoadAt(env, ctx, 'Z4', 20, 1, { lot: String(lot) })).text();
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, lot);
  assert.equal(lastLoad(sqlite).bins, 20);
  assert.match(html, /Logged to the lot you chose/);
});

test('a lot from another zone, or too old, is refused — the bins are not moved onto it', async () => {
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4');
  const z4 = lotIdFor(sqlite, 'Z4');
  await scanZone(env, ctx, 'Z7');
  const before = loads(sqlite).length;

  const wrongZone = await logLoadAt(env, ctx, 'Z7', 20, 1, { lot: String(z4) });
  assert.ok(wrongZone.status >= 400);
  assert.match(await wrongZone.text(), /not in this zone|too old/i);

  // Too old = last ACTIVE more than 3 days ago (closed 9 days back), not merely
  // opened long ago — a two-day zone that closed a minute ago is recent.
  sqlite.prepare("UPDATE harvest_scan_log SET occurred_at = datetime('now','-10 days'), closed_at = datetime('now','-9 days') WHERE id = ?").run(z4);
  assert.ok((await logLoadAt(env, ctx, 'Z4', 20, 1, { lot: String(z4) })).status >= 400);
  assert.ok((await logLoadAt(env, ctx, 'Z4', 20, 1, { lot: 'abc' })).status >= 400);
  assert.equal(loads(sqlite).length, before, 'a refused load writes no row at all');
});

test('the form offers the picker only when the zone has nothing open', async () => {
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4');
  const lot = lotIdFor(sqlite, 'Z4');

  const open = await (await barnForm(env, ctx, 1)).text();
  assert.match(open, /<div id="lotPick" hidden>/, 'Z4 is open, so there is nothing to ask');
  assert.match(open, new RegExp(`<option value="${lot}" data-zone="Z4"`));

  sqlite.prepare("UPDATE harvest_scan_log SET closed_at = datetime('now','-30 minutes') WHERE id = ?").run(lot);
  const closed = await (await barnForm(env, ctx, 1)).text();
  assert.match(closed, /<div id="lotPick">/, 'nothing open now, so the door is asked');
  assert.match(closed, /No lot — log it anyway/);
});

test('the status feed carries the recent lots the picker offers', async () => {
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4');
  const lot = lotIdFor(sqlite, 'Z4');
  await scanZone(env, ctx, 'Z7');
  sqlite.prepare("UPDATE harvest_scan_log SET occurred_at = datetime('now','-10 days'), closed_at = datetime('now','-9 days') WHERE id = ?").run(lot);

  const d = await handleHarvestD1(new Request('https://x/api/harvest?action=status'), env, ctx).then(r => r.json());
  const body = d.data || d;
  assert.deepEqual(body.recent_lots.map(l => l.zone), ['Z7'], 'a lot older than the window is not offered');
});

test('a long zone that closed a minute ago is still a recent lot', async () => {
  // A zone is a day and a half to two days of cutting; over a weekend, four.
  // Measuring age from when it OPENED dropped it from the picker (and refused
  // the trailer the grace window had just proposed) the moment it closed.
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, { zone: 'Z4', opened: minsAgo(60 * 24 * 4), closed: minsAgo(1) });
  const d = await handleHarvestD1(new Request('https://x/api/harvest?action=status'), env, ctx).then(r => r.json());
  assert.ok((d.data || d).recent_lots.some(l => l.id === z4));
  await logLoadAt(env, ctx, 'Z4', 20, 1, { lot: String(z4) });
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, z4);
});

test('open intake follows the open zone, preserves an override, and logs repeatedly in place', async () => {
  const { chromium } = await import('@playwright/test');
  const { sqlite, env, ctx } = freshDb();
  await scanZone(env, ctx, 'Z4');
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
    await scanZone(env, ctx, 'Z5');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => document.getElementById('zone').value === 'Z5');
    await page.locator('#zone').selectOption('Z4');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#zone').inputValue(), 'Z4', 'a manual choice is held');
    await page.locator('#followOpen').click();
    await page.waitForFunction(() => document.getElementById('zone').value === 'Z5');
    await page.locator('#bay').selectOption('3');
    await page.locator('#bins').fill('18');
    await page.locator('#intakeForm button').click();
    await page.waitForFunction(() => document.getElementById('intakeReceipt').textContent.includes('Ready for another'));
    assert.equal(lastLoad(sqlite).zone, 'Z5');
    assert.equal(lastLoad(sqlite).bins, 18);
    assert.equal(await page.locator('#bins').inputValue(), '24', 'back to a full trailer');
    await page.locator('#intakeForm button').click();
    await page.waitForFunction(() => document.getElementById('intakeReceipt').textContent.includes('Ready for another'));
    assert.equal(loads(sqlite).length, 2);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

// --- the print sheets --------------------------------------------------------

const codeSheet = (env, ctx, packet = null) => handleHarvestD1(
  new Request(`https://x/api/harvest?action=print_codes&lang=en${packet ? `&packet=${packet}` : ''}`), env, ctx)
  .then(r => r.text());

/**
 * What a phone camera would actually be pointed at: the data-qr target, AND a
 * check that the image really encodes it, so this cannot pass on a
 * correct-looking attribute over a wrong picture.
 */
const qrTargets = (html) => {
  const out = [];
  for (const m of html.matchAll(/<img[^>]*class="qr[^"]*"[^>]*>/g)) {
    const tag = m[0];
    const target = (tag.match(/data-qr="([^"]*)"/) || [])[1];
    const src = (tag.match(/src="([^"]*)"/) || [])[1];
    assert.ok(target, `QR image with no data-qr: ${tag.slice(0, 120)}`);
    assert.equal(src, qrDataUri(target), `the QR image does not encode its own data-qr target: ${target}`);
    out.push(target);
  }
  return out;
};
const BASE = 'https://rogue-origin-api.roguefamilyfarms.workers.dev';

test('the barn sheet is end of day plus one page per door, and no crew cards', async () => {
  const { env, ctx } = freshDb();
  const html = await codeSheet(env, ctx);
  assert.deepEqual(qrTargets(html), [`${BASE}/fin`, `${BASE}/b/1`, `${BASE}/b/2`]);
  assert.equal((html.match(/class="card"/g) || []).length, 1);
  assert.equal((html.match(/class="sheet door"/g) || []).length, 2);
  assert.doesNotMatch(html, /CUADRILLA [AB]|\/c\/A/);
});

test('the trailer sheet is one decal per trailer, T1 to T7', async () => {
  const { env, ctx } = freshDb();
  const html = await codeSheet(env, ctx, 'trailers');
  assert.deepEqual(qrTargets(html), [1, 2, 3, 4, 5, 6, 7].map(n => `${BASE}/t/${n}`));
  // The printed number is the trailer's name — they had none before these.
  for (const n of [1, 7]) assert.match(html, new RegExp(`class="big trailer-num">T${n}<`));
  assert.match(html, /El chofer lo escanea <strong>cada vez que deja una carga<\/strong>/);
});

test('every code on every sheet is one this build actually accepts', async () => {
  const { env, ctx } = freshDb();
  const all = [];
  for (const p of [null, 'trailers', 'zones']) all.push(...qrTargets(await codeSheet(env, ctx, p)));
  for (const target of all) {
    const path = new URL(target).pathname;
    const req = () => new Request(`https://x${path}?lang=en`);
    const res = path.startsWith('/t/') ? await quiet(() => handleTrailerScan(req(), env, ctx))
      : path.startsWith('/z/') ? await quiet(() => handleZoneScan(req(), env, ctx))
      : path === '/fin' ? await quiet(() => handleDayEndScan(req(), env, ctx))
      : await quiet(() => handleBarnScan(req(), env, ctx));
    assert.equal(res.status, 200, `${path} does not answer`);
  }
});

test('the sheets read in Spanish first, like the screens the crew use', async () => {
  const { env, ctx } = freshDb();
  const html = await codeSheet(env, ctx);
  assert.match(html, /Escan[ée]alo <strong>al terminar el día<\/strong>/);
  assert.ok(html.includes('Si una traila no tiene su código, anota la carga aquí.'));
});

test('the sheet does not fire the printer by itself', async () => {
  const { env, ctx } = freshDb();
  const html = await codeSheet(env, ctx, 'trailers');
  assert.ok(html.includes('onclick="window.print()"'));
  assert.equal(/<script[^>]*>[^<]*window\.print/.test(html), false);
});

test('the print sheet strips what the screen wrapper adds', async () => {
  const { env, ctx } = freshDb();
  const html = await codeSheet(env, ctx);
  assert.match(html, /@media print \{[\s\S]*body \{ margin: 0; padding: 0; \}/);
  assert.match(html, /@media print \{[\s\S]*\.lang \{ display: none; \}/);
});

test('a card is sized to the card, not to the page', async () => {
  const { env, ctx } = freshDb();
  const html = await codeSheet(env, ctx);
  assert.match(html, /\.card \{ height: 4\.6in;/);
});
