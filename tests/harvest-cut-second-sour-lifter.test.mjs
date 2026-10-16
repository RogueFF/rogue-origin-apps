/**
 * Sour Lifter's second cut: from 2026-10-15 every Sour Lifter lot opens as cut 2.
 *
 * Koa, 2026-10-16: "second cut will be all the sour lifter trailer scans". The
 * first cut of every Sour Lifter zone finished on 2026-10-08; from Thursday
 * 2026-10-15 the crews go back over those zones for what the first cut left,
 * and that material goes on tables, not on sticks. Before this rule a first
 * re-entry read the zone's last closed session (cut 1) and opened cut 1, so the
 * lead had to tap "Empezar corte 2" in every zone, or the day's lots were fixed
 * by hand in D1 (Z4, Z5, Z6, Z7, Z9 on 10/15-10/16).
 *
 * What this suite holds:
 *
 * 1. A SOUR LIFTER RE-ENTRY OPENS AS CUT 2, whether the zone's last session was
 *    cut 1 or the zone was never scanned at all.
 * 2. A ZONE ALREADY PAST CUT 2 KEEPS ITS NUMBER: a declared cut 3 stays 3.
 * 3. THE DATE GATES IT: the same re-entry before 2026-10-15 opened cut 1.
 * 4. ONLY SOUR LIFTER: a retail cultivar and Lifter still follow the old rule
 *    (last closed session, else 1) — retail blocks are finished in pieces and
 *    stay cut 1 (Koa, 2026-10-04 and 2026-10-16).
 * 5. A CREW JOINING AN OPEN ZONE JOINS THAT CUT, as before, even when a lead
 *    moved it back to 1.
 * 6. THE ZONE SCREEN CAN STILL MOVE A LOT BACK TO 1 for a mis-tap.
 *
 * Run with `node --test`.
 */
import { test, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, quiet, seedSession, sessions, modUrl, sqliteAvailable } from './helpers/harvest-sqlite.mjs';

const { handleHarvestD1 } = await import(modUrl('workers/src/handlers/harvest-d1.js'));

const enter = (env, ctx, zone, { crew = 'A', cultivar = null } = {}) => quiet(() => handleHarvestD1(
  new Request(`https://x/api/harvest?action=enter&zone=${zone}&crew=${crew}&lang=en`
    + (cultivar ? `&cultivar=${encodeURIComponent(cultivar)}` : '')), env, ctx));

const post = (env, ctx, action, fields) => quiet(() => handleHarvestD1(
  new Request(`https://x/api/harvest?action=${action}&lang=en`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)]))),
  }), env, ctx));

const newest = (sqlite) => sessions(sqlite).at(-1);

before(function () {
  if (!sqliteAvailable) this.skip('node:sqlite unavailable (needs Node >= 22.5)');
});

test('a Sour Lifter zone re-entered after 2026-10-15 opens as cut 2', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedSession(sqlite, { zone: 'Z3', cut: 1, opened: '2026-10-02 15:00:00', closed: '2026-10-02 22:00:00' });
  const html = await (await enter(env, ctx, 'Z3')).text();
  assert.equal(newest(sqlite).zone, 'Z3');
  assert.equal(newest(sqlite).cut_number, 2);
  assert.match(html, /Cut 2/);
});

test('a Sour Lifter zone never scanned before opens as cut 2 as well', async () => {
  const { sqlite, env, ctx } = freshDb();
  await enter(env, ctx, 'Z3');
  assert.equal(newest(sqlite).cut_number, 2);
});

test('a Sour Lifter zone already past cut 2 keeps its number', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedSession(sqlite, { zone: 'Z3', cut: 3, opened: '2026-10-15 15:00:00', closed: '2026-10-15 22:00:00' });
  await enter(env, ctx, 'Z3');
  assert.equal(newest(sqlite).cut_number, 3);
});

test('before 2026-10-15 the same re-entry opened cut 1', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-10T18:00:00Z').getTime() });
  try {
    const { sqlite, env, ctx } = freshDb();
    seedSession(sqlite, { zone: 'Z3', cut: 1, opened: '2026-10-02 15:00:00', closed: '2026-10-02 22:00:00' });
    await enter(env, ctx, 'Z3');
    assert.equal(newest(sqlite).cut_number, 1);
  } finally {
    mock.timers.reset();
  }
});

test('a retail cultivar re-entered after 2026-10-15 stays cut 1', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedSession(sqlite, { zone: 'Z8', cultivar: 'Platinum M A4', cut: 1,
    opened: '2026-10-05 20:48:24', closed: '2026-10-06 18:32:17' });
  await enter(env, ctx, 'Z8', { cultivar: 'Platinum M A4' });
  assert.equal(newest(sqlite).cultivar, 'Platinum M A4');
  assert.equal(newest(sqlite).cut_number, 1);
});

test('Lifter re-entered after 2026-10-15 stays cut 1', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedSession(sqlite, { zone: 'Z21', cultivar: 'Lifter', cut: 1,
    opened: '2026-10-13 14:19:07', closed: '2026-10-13 23:00:00' });
  await enter(env, ctx, 'Z21');
  assert.equal(newest(sqlite).cultivar, 'Lifter');
  assert.equal(newest(sqlite).cut_number, 1);
});

test('a crew joining a Sour Lifter zone another crew has open joins that cut, even cut 1', async () => {
  const { sqlite, env, ctx } = freshDb();
  seedSession(sqlite, { zone: 'Z4', cut: 1, crew: 'B' });
  await enter(env, ctx, 'Z4', { crew: 'A' });
  assert.equal(newest(sqlite).crew, 'A');
  assert.equal(newest(sqlite).cut_number, 1);
});

test('the zone screen can still move a Sour Lifter lot back to cut 1', async () => {
  const { sqlite, env, ctx } = freshDb();
  await enter(env, ctx, 'Z3');
  const id = newest(sqlite).id;
  assert.equal(newest(sqlite).cut_number, 2);
  await post(env, ctx, 'cut_change', { session_id: id, dir: 'prev', confirm: '1' });
  assert.equal(newest(sqlite).cut_number, 1);
});
