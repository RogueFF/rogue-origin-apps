/**
 * A preview build is sealed off from the floor (Koa, 2026-09-28: "test the
 * quick entry QR codes ... without messing up the floor entries").
 *
 * `wrangler versions upload --preview-alias <name> --var HARVEST_FORCE_TEST:true`
 * puts a new build on its own URL while the live worker keeps serving the
 * floor. Both read ONE database, and test mode is a switch stored IN that
 * database — so a preview that merely defaulted to test mode would obey the
 * farm's "off" and write real rows, and its dashboard could flip the switch
 * for the live worker too. These tests hold the seal with the switch OFF.
 *
 * Run with `node --test`.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, quiet, seedSession, seedCrewDay, modUrl, sqliteAvailable, earlierTodayMins } from './helpers/harvest-sqlite.mjs';

const { handleHarvestD1, handleZoneScan, handleTrailerScan } =
  await import(modUrl('workers/src/handlers/harvest-d1.js'));
const worker = (await import(modUrl('workers/src/index.js'))).default;

// No test in this file may reach the network: the live-shaped env carries a
// bot token, and the one test that runs as the live worker would otherwise
// post to Telegram. Every call is recorded instead.
const netCalls = [];
const realFetch = globalThis.fetch;
before(() => { globalThis.fetch = async (url) => { netCalls.push(String(url)); return new Response('{"ok":true}'); }; });
after(() => { globalThis.fetch = realFetch; });

/** A live-shaped env with the farm's switch OFF — the dangerous case. */
function liveDb({ preview }) {
  const db = freshDb();
  db.sqlite.prepare(`INSERT INTO harvest_settings (key, value, updated_at) VALUES ('test_mode', 'false', datetime('now'))`).run();
  db.env = { ...db.env, HARVEST_TEST_MODE: 'false', TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_TEST_CHAT_ID: '-100live' };
  seedCrewDay(db.sqlite, { isTest: 0 });   // Crew A on the live floor too
  if (preview) db.env.HARVEST_FORCE_TEST = 'true';
  return db;
}

const rows = (sqlite, where = '1=1') => sqlite.prepare(`SELECT * FROM harvest_scan_log WHERE ${where} ORDER BY id`).all();

before(function () {
  if (!sqliteAvailable) this.skip('node:sqlite unavailable (needs Node >= 22.5)');
});

test('a preview build writes only test rows, even with the farm\'s switch off', async () => {
  const { sqlite, env, ctx } = liveDb({ preview: true });
  await quiet(() => handleZoneScan(new Request('https://preview/z/Z4?crew=A&lang=en'), env, ctx));
  const lot = rows(sqlite, "event_type='enter'")[0];
  assert.equal(lot.is_test, 1);

  await quiet(() => handleHarvestD1(new Request('https://preview/api/harvest?action=trailer_log&lang=en', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ trailer: '3', lot: String(lot.id), bay: '9' }),
  }), env, ctx));
  const loads = rows(sqlite, "event_type='barn_load'");
  assert.equal(loads.length, 1);
  assert.equal(loads[0].is_test, 1);
});

test('the live worker does not see what the preview wrote', async () => {
  const { sqlite, env, ctx } = liveDb({ preview: true });
  await quiet(() => handleZoneScan(new Request('https://preview/z/Z4?crew=A&lang=en'), env, ctx));

  const { HARVEST_FORCE_TEST: _drop, ...live } = env;
  const d = await handleHarvestD1(new Request('https://live/api/harvest?action=status'), live, ctx).then(r => r.json());
  assert.equal((d.active_zones || d.data?.active_zones || []).length, 0);
  assert.equal(rows(sqlite).length, 1, 'the row is there, just not a real one');
});

test('a real open lot is never touched by a preview zone scan', async () => {
  // Closing "every open lot" is scoped by is_test, so the floor's open lot
  // survives any number of preview scans.
  const { sqlite, env, ctx } = liveDb({ preview: true });
  const real = sqlite.prepare(`
    INSERT INTO harvest_scan_log (event_type, zone, cultivar, season, cut_number, occurred_at, is_test)
    VALUES ('enter', 'R1', 'Strawberry Doughnuts', 2026, 1, datetime('now','-1 hour'), 0)`).run().lastInsertRowid;
  await quiet(() => handleZoneScan(new Request('https://preview/z/Z4?crew=A&lang=en'), env, ctx));
  await quiet(() => handleHarvestD1(new Request('https://preview/fin?action=day_end&lang=en'), env, ctx));
  assert.equal(sqlite.prepare('SELECT closed_at FROM harvest_scan_log WHERE id = ?').get(real).closed_at, null);
});

test('a preview build cannot flip the farm\'s test-mode switch', async () => {
  const { sqlite, env, ctx } = liveDb({ preview: true });
  // Through the worker, so the refusal comes back the way the dashboard sees it.
  const res = await quiet(() => worker.fetch(new Request('https://preview/api/harvest?action=test_mode', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ on: true, password: 'test-password' }),
  }), env, ctx));
  assert.ok(res.status >= 400);
  assert.equal(sqlite.prepare("SELECT value FROM harvest_settings WHERE key='test_mode'").get().value, 'false');
});

test('a preview build posts nothing to the floor\'s Telegram chat', async () => {
  const { sqlite, env, ctx } = liveDb({ preview: true });
  const before = netCalls.length;
  const waits = [];
  const c = { waitUntil: (p) => waits.push(p) };
  await quiet(() => handleZoneScan(new Request('https://preview/z/Z4?crew=A&lang=en'), env, c));
  const lot = rows(sqlite, "event_type='enter'")[0];
  sqlite.prepare(`INSERT INTO harvest_scan_log (event_type, zone, season, bins, attributed_zone_session_id, bay, trailer, is_test, occurred_at)
    VALUES ('barn_load', 'Z4', 2026, 24, ?, 9, 3, 1, datetime('now', ?))`).run(lot.id, `-${earlierTodayMins() ?? 6} minutes`);
  await quiet(() => handleTrailerScan(new Request('https://preview/t/3?lang=en'), env, c));
  await quiet(() => Promise.all(waits));
  assert.equal(rows(sqlite, "event_type='barn_load'").length, 2, 'the scan did log (to test rows)');
  assert.deepEqual(netCalls.slice(before).filter(u => u.includes('telegram')), []);
});

test('without the preview flag, the farm\'s switch still rules', async () => {
  // The lock must not leak into the live worker.
  const { sqlite, env } = liveDb({ preview: false });
  const waits = [];
  const before = netCalls.length;
  await quiet(() => handleZoneScan(new Request('https://live/z/Z4?crew=A&lang=en'), env, { waitUntil: (p) => waits.push(p) }));
  await quiet(() => Promise.all(waits));
  assert.equal(rows(sqlite, "event_type='enter'")[0].is_test, 0);
  assert.ok(netCalls.slice(before).some(u => u.includes('telegram')), 'and the live worker still announces it');
});
