/**
 * The trailer decal (Koa, 2026-09-28).
 *
 * Six trailers, T1-T6, each with its own QR. The DRIVER scans it on drop-off,
 * instead of the water spider logging the load at a door. The screen shows
 * the lot the load is about to go to, a 12-bay grid, and one button; bins are
 * 24 unless the driver says partial.
 *
 * What this suite pins:
 *  - what the driver SAW is what is saved (the lot is proposed at render and
 *    posted as an id, so a zone scan between the scan and the tap moves
 *    nothing);
 *  - a load never saves without a lot (the thing that lost 96 bins on 9/24);
 *  - the grace window still sends the trailer on the apron to the lot it was
 *    cut from;
 *  - a second scan of the same trailer inside five minutes asks first;
 *  - the bay default is the trailer's own, and only on the same day.
 *
 * Run with `node --test`.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, quiet, minsAgo, seedSession, loads, lastLoad, modUrl, sqliteAvailable, SEASON }
  from './helpers/harvest-sqlite.mjs';

const { handleHarvestD1, handleZoneScan, handleTrailerScan } =
  await import(modUrl('workers/src/handlers/harvest-d1.js'));
const worker = (await import(modUrl('workers/src/index.js'))).default;

const scanTrailer = (env, ctx, n, lang = 'en') => quiet(() => handleTrailerScan(
  new Request(`https://x/t/${n}${lang ? `?lang=${lang}` : ''}`), env, ctx));

const logTrailer = (env, ctx, fields) => quiet(() => handleHarvestD1(
  new Request('https://x/api/harvest?action=trailer_log&lang=en', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, String(v)]))),
  }), env, ctx));

const scanZone = (env, ctx, zone) => quiet(() => handleZoneScan(
  new Request(`https://x/z/${zone}?lang=en`), env, ctx));

/** Which lot radio / bay radio the page has ticked, or null. */
const checkedLot = (html) => (html.match(/name="lot" value="(\d+)" required checked/) || [])[1] ?? null;
const checkedBay = (html) => (html.match(/name="bay" value="(\d+)" required checked/) || [])[1] ?? null;

const backdateLoad = (sqlite, id, minutes) => sqlite.prepare(
  `UPDATE harvest_scan_log SET occurred_at = datetime('now','-${minutes} minutes') WHERE id = ?`).run(id);

before(function () {
  if (!sqliteAvailable) this.skip('node:sqlite unavailable (needs Node >= 22.5)');
});

// --- the screen ----------------------------------------------------------------

test('the decal page names the trailer, the open lot, a bay grid and one button', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter' });

  const html = await (await scanTrailer(env, ctx, 3)).text();
  assert.match(html, /<h1 class="trailer-name">T3<\/h1>/);
  assert.match(html, /→ Z4 · Sour Lifter · Cut 1/);
  assert.equal(checkedLot(html), String(z4), 'the open lot is the one ticked');
  assert.equal((html.match(/name="bay" value="\d+"/g) || []).length, 12, 'bays 1-12');
  assert.match(html, /Log load · 24 bins/);
  assert.doesNotMatch(html, /name="bins"/, 'a full trailer is not a number the driver types');
});

test('the form posts to an absolute path, so a scanned /t/ page cannot lose it', async () => {
  // The 2026-09-04 lesson: a relative ?action= on a page served from /z/Z4
  // landed back on the zone handler and recorded nothing.
  const { sqlite, env, ctx } = freshDb();
  seedSession(sqlite, {});
  const html = await (await scanTrailer(env, ctx, 1)).text();
  assert.match(html, /action="\/api\/harvest\?action=trailer_log&lang=en"/);
});

test('it is Spanish by default, in the crew\'s own words', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedSession(sqlite, {});
  const html = await (await scanTrailer(env, ctx, 1, null)).text();
  assert.match(html, /Anotar carga · 24 cajas/);
  assert.match(html, /¿Otro lote\?/);
});

test('an unknown trailer is refused, not guessed at', async () => {
  const { env, ctx } = freshDb();
  for (const n of ['7', '0', 'abc']) {
    const res = await scanTrailer(env, ctx, n);
    assert.ok(res.status >= 400, `/t/${n}`);
  }
});

test('the decal answers through the worker, the way a scanned QR reaches it', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedSession(sqlite, {});
  const res = await quiet(() => worker.fetch(new Request('https://x/t/2?lang=en'), env, ctx));
  assert.equal(res.status, 200);
  assert.match(await res.text(), /trailer-name">T2</);
});

// --- logging ---------------------------------------------------------------------

test('a logged trailer records the trailer, 24 bins, the bay and the lot it showed', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter' });

  const html = await (await logTrailer(env, ctx, { trailer: 3, lot: z4, bay: 9 })).text();
  const row = lastLoad(sqlite);
  assert.deepEqual(
    { trailer: row.trailer, bins: row.bins, bay: row.bay, lot: row.attributed_zone_session_id, zone: row.zone, crew: row.crew },
    { trailer: 3, bins: 24, bay: 9, lot: z4, zone: 'Z4', crew: null });
  assert.match(html, /T3: 24 bins logged/);
  assert.match(html, /hung in bay 9/);
});

test('what the driver saw is what is saved, even if the zone changes before the tap', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, { zone: 'Z4', opened: minsAgo(120) });
  const page = await (await scanTrailer(env, ctx, 2)).text();
  const shown = checkedLot(page);
  assert.equal(shown, String(z4));

  await scanZone(env, ctx, 'Z5');   // the crew moves on while the driver is reading
  await logTrailer(env, ctx, { trailer: 2, lot: shown, bay: 4 });
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, z4);
});

test('a trailer load lands on the lot in the ledger', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, { zone: 'Z4', cultivar: 'Sour Lifter' });
  await logTrailer(env, ctx, { trailer: 1, lot: z4, bay: 2 });
  await logTrailer(env, ctx, { trailer: 2, lot: z4, bay: 2, partial_bins: 14 });

  const body = await handleHarvestD1(new Request(`https://x/api/harvest?action=rollup&season=${SEASON}`,
    { headers: { authorization: 'test-password' } }), env, ctx).then(r => r.json());
  const lot = (body.lots || body.data?.lots || []).find(l => l.zone === 'Z4');
  assert.equal(lot.loads, 2);
  assert.equal(lot.bins, 38);
});

// --- which lot -------------------------------------------------------------------

test('just after a zone change, the trailer is offered the lot it was cut from', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, { zone: 'Z4', opened: minsAgo(90), closed: minsAgo(3) });
  seedSession(sqlite, { zone: 'Z5', cultivar: 'Lifter', opened: minsAgo(3) });

  const html = await (await scanTrailer(env, ctx, 1)).text();
  assert.equal(checkedLot(html), String(z4));
  assert.match(html, /The zone just changed/);
});

test('past the grace window the open lot is offered again', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedSession(sqlite, { zone: 'Z4', opened: minsAgo(90), closed: minsAgo(20) });
  const z5 = seedSession(sqlite, { zone: 'Z5', cultivar: 'Lifter', opened: minsAgo(20) });

  const html = await (await scanTrailer(env, ctx, 1)).text();
  assert.equal(checkedLot(html), String(z5));
  assert.doesNotMatch(html, /The zone just changed/);
});

test('the last trailer after End of day still goes to the lot that just closed', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, { zone: 'Z4', opened: minsAgo(300), closed: minsAgo(2) });
  const html = await (await scanTrailer(env, ctx, 1)).text();
  assert.equal(checkedLot(html), String(z4));
});

test('with nothing open the driver must pick, and a load never saves without a lot', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, { zone: 'Z4', opened: minsAgo(300), closed: minsAgo(120) });

  const html = await (await scanTrailer(env, ctx, 1)).text();
  assert.equal(checkedLot(html), null, 'nothing pre-ticked: there is no honest default');
  assert.match(html, /Which lot did it come from\?/);
  assert.match(html, new RegExp(`name="lot" value="${z4}"`), 'the recent lot is offered');

  const refused = await logTrailer(env, ctx, { trailer: 1, bay: 3 });
  assert.ok(refused.status >= 400);
  assert.equal(loads(sqlite).length, 0, 'no lot, no row');

  await logTrailer(env, ctx, { trailer: 1, lot: z4, bay: 3 });
  assert.equal(lastLoad(sqlite).attributed_zone_session_id, z4);
});

test('with no recent lots there is no form, only what to do about it', async () => {
  const { env, ctx } = freshDb();
  const html = await (await scanTrailer(env, ctx, 1)).text();
  assert.doesNotMatch(html, /id="trailerForm"/);
  assert.match(html, /Ask the crew lead to scan the zone sign/);
});

test('a lot that is too old or does not exist is refused, and nothing is written', async () => {
  const { sqlite, env, ctx } = freshDb();
  const old = seedSession(sqlite, { zone: 'Z4', opened: minsAgo(60 * 24 * 9), closed: minsAgo(60 * 24 * 8) });
  for (const lot of [old, 99999, 'abc']) {
    const res = await logTrailer(env, ctx, { trailer: 1, lot, bay: 3 });
    assert.ok(res.status >= 400, `lot ${lot}`);
  }
  assert.equal(loads(sqlite).length, 0);
});

// --- bins ------------------------------------------------------------------------

test('a partial stores the number typed; anything that is not a partial is refused', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, {});
  await logTrailer(env, ctx, { trailer: 1, lot: z4, bay: 3, partial_bins: 14 });
  assert.equal(lastLoad(sqlite).bins, 14);

  await logTrailer(env, ctx, { trailer: 2, lot: z4, bay: 3, partial_bins: '' });
  assert.equal(lastLoad(sqlite).bins, 24, 'an empty partial box is a full trailer');

  const before = loads(sqlite).length;
  for (const bad of ['24', '30', '0', '-3', '12.5', 'abc']) {
    const res = await logTrailer(env, ctx, { trailer: 3, lot: z4, bay: 3, partial_bins: bad });
    assert.ok(res.status >= 400, `partial ${bad}`);
  }
  assert.equal(loads(sqlite).length, before);
});

// --- bay -------------------------------------------------------------------------

test('a bay is required, and one outside 1-12 is refused', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, {});
  assert.ok((await logTrailer(env, ctx, { trailer: 1, lot: z4 })).status >= 400);
  assert.ok((await logTrailer(env, ctx, { trailer: 1, lot: z4, bay: 13 })).status >= 400);
  assert.equal(loads(sqlite).length, 0);
});

test('the bay default is this trailer\'s own last bay', async () => {
  // Trailers entering from both sides fill different bays at once. A global
  // "last bay" would hand each side the other's number all day.
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, {});
  await logTrailer(env, ctx, { trailer: 3, lot: z4, bay: 9 });
  await logTrailer(env, ctx, { trailer: 4, lot: z4, bay: 3 });

  assert.equal(checkedBay(await (await scanTrailer(env, ctx, 3)).text()), '9');
  assert.equal(checkedBay(await (await scanTrailer(env, ctx, 4)).text()), '3');
  // A trailer with no history borrows the last bay anyone filled.
  assert.equal(checkedBay(await (await scanTrailer(env, ctx, 5)).text()), '3');
});

test('a bay from an earlier day is named, not ticked', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, {});
  await logTrailer(env, ctx, { trailer: 3, lot: z4, bay: 9 });
  backdateLoad(sqlite, lastLoad(sqlite).id, 60 * 26);

  const html = await (await scanTrailer(env, ctx, 3)).text();
  assert.equal(checkedBay(html), null);
  assert.match(html, /9 was a different day/);
});

// --- the repeat guard ------------------------------------------------------------

test('a second scan of the same trailer inside five minutes asks before logging', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, {});
  await logTrailer(env, ctx, { trailer: 3, lot: z4, bay: 9 });

  const page = await (await scanTrailer(env, ctx, 3)).text();
  assert.match(page, /T3 was logged at \d{1,2}:\d{2}/);
  assert.match(page, /name="again" value="1"/);
  assert.match(page, /Yes, log another load/);

  // A double tap or a back-button resubmit carries no `again`: nothing written,
  // the screen comes back with the warning and the driver's own choices.
  const resent = await (await logTrailer(env, ctx, { trailer: 3, lot: z4, bay: 9, partial_bins: 12 })).text();
  assert.equal(loads(sqlite).length, 1);
  assert.match(resent, /T3 was logged at/);
  assert.equal(checkedBay(resent), '9');
  assert.match(resent, /name="partial_bins"[^>]*value="12"/);

  await logTrailer(env, ctx, { trailer: 3, lot: z4, bay: 9, again: 1 });
  assert.equal(loads(sqlite).length, 2, 'confirmed, so it really is another load');
});

test('after five minutes it is an ordinary load again', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, {});
  await logTrailer(env, ctx, { trailer: 3, lot: z4, bay: 9 });
  backdateLoad(sqlite, lastLoad(sqlite).id, 6);

  assert.doesNotMatch(await (await scanTrailer(env, ctx, 3)).text(), /was logged at/);
  await logTrailer(env, ctx, { trailer: 3, lot: z4, bay: 9 });
  assert.equal(loads(sqlite).length, 2);
});

test('the repeat guard is per trailer', async () => {
  const { sqlite, env, ctx } = freshDb();
  const z4 = seedSession(sqlite, {});
  await logTrailer(env, ctx, { trailer: 3, lot: z4, bay: 9 });
  await logTrailer(env, ctx, { trailer: 4, lot: z4, bay: 9 });
  assert.equal(loads(sqlite).length, 2);
});
