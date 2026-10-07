/**
 * Changing a zone's cut from the zone screen: asked once, then applied to
 * every crew still cutting that zone.
 *
 * 2026-10-07: crew B's lead advanced Z16 to cut 2 while crew A was cutting the
 * same plants on cut 1, and both leads did it again in Z17 — cuts 2 and 3 for
 * a zone on its first cut. The button read as "I'm back in this zone". So the
 * first press now only asks, and the second press moves the whole zone.
 *
 * Run with `node --test`.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, quiet, seedSession, sessions, modUrl, sqliteAvailable } from './helpers/harvest-sqlite.mjs';

const { handleHarvestD1 } = await import(modUrl('workers/src/handlers/harvest-d1.js'));

const post = (env, ctx, action, fields) => quiet(() => handleHarvestD1(
  new Request(`https://x/api/harvest?action=${action}&lang=en`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)]))),
  }), env, ctx));
const cutOf = (sqlite, id) => sessions(sqlite).find(s => s.id === id).cut_number;

before(function () {
  if (!sqliteAvailable) this.skip('node:sqlite unavailable (needs Node >= 22.5)');
});

test('the first press only asks: nothing changes, the page names the cut and the other crew', async () => {
  const { sqlite, env, ctx } = freshDb();
  const a = seedSession(sqlite, { zone: 'Z17', crew: 'A' });
  const b = seedSession(sqlite, { zone: 'Z17', crew: 'B' });
  const html = await (await post(env, ctx, 'cut_change', { session_id: b, dir: 'next' })).text();
  assert.equal(cutOf(sqlite, a), 1);
  assert.equal(cutOf(sqlite, b), 1);
  assert.match(html, /Cut 2 in Z17\?/);
  assert.match(html, /also moves crew A/);
  assert.match(html, /name="confirm" value="1"/);
  assert.match(html, /Yes, cut 2/);
});

test('the confirmed press moves every open crew in the zone together', async () => {
  const { sqlite, env, ctx } = freshDb();
  const a = seedSession(sqlite, { zone: 'Z17', crew: 'A' });
  const b = seedSession(sqlite, { zone: 'Z17', crew: 'B' });
  const html = await (await post(env, ctx, 'cut_change', { session_id: b, dir: 'next', confirm: '1' })).text();
  assert.equal(cutOf(sqlite, a), 2, "crew A's open session moved with it");
  assert.equal(cutOf(sqlite, b), 2);
  assert.match(html, /Now cut 2/);
});

test('a closed session, another zone and another cultivar are left alone', async () => {
  const { sqlite, env, ctx } = freshDb();
  const closed = seedSession(sqlite, { zone: 'Z17', crew: 'A', closed: '2026-10-06 23:00:00' });
  const otherZone = seedSession(sqlite, { zone: 'Z16', crew: 'C' });
  const otherCultivar = seedSession(sqlite, { zone: 'Z17', cultivar: 'Lifter', crew: 'C' });
  const b = seedSession(sqlite, { zone: 'Z17', crew: 'B' });
  await post(env, ctx, 'cut_change', { session_id: b, dir: 'next', confirm: '1' });
  assert.equal(cutOf(sqlite, b), 2);
  assert.equal(cutOf(sqlite, closed), 1);
  assert.equal(cutOf(sqlite, otherZone), 1);
  assert.equal(cutOf(sqlite, otherCultivar), 1);
});

test('back one cut also moves the other crew, and a lone crew needs no mention of others', async () => {
  const { sqlite, env, ctx } = freshDb();
  const a = seedSession(sqlite, { zone: 'Z17', crew: 'A', cut: 2 });
  const b = seedSession(sqlite, { zone: 'Z17', crew: 'B', cut: 2 });
  await post(env, ctx, 'cut_change', { session_id: a, dir: 'prev', confirm: '1' });
  assert.equal(cutOf(sqlite, a), 1);
  assert.equal(cutOf(sqlite, b), 1);

  const solo = seedSession(sqlite, { zone: 'Z9', crew: 'C' });
  const html = await (await post(env, ctx, 'cut_change', { session_id: solo, dir: 'next' })).text();
  assert.doesNotMatch(html, /also moves crew/);
  assert.equal(cutOf(sqlite, solo), 1);
});

test('tags printed off the OTHER crew\'s session block the change too', async () => {
  const { sqlite, env, ctx } = freshDb();
  const a = seedSession(sqlite, { zone: 'Z17', crew: 'A' });
  const b = seedSession(sqlite, { zone: 'Z17', crew: 'B' });
  sqlite.prepare(`
    INSERT INTO harvest_sacks (sack_id, season, serial, cultivar_code, zone, cultivar, cut_number, zone_session_id, is_test, printed_at)
    VALUES ('26-SLIFT-1', ?, 1, 'SLIFT', 'Z17', 'Sour Lifter', 1, ?, 1, datetime('now'))
  `).run(new Date().getUTCFullYear(), a);
  const res = await post(env, ctx, 'cut_change', { session_id: b, dir: 'next', confirm: '1' });
  const html = await res.text();
  assert.match(html, /already has 1 tag/);
  assert.equal(cutOf(sqlite, a), 1);
  assert.equal(cutOf(sqlite, b), 1);
});
