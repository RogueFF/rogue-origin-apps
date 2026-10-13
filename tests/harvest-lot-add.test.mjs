/**
 * "+ Add a cultivar" on the bay screen (Koa, 2026-10-12): POST ?action=lot_add
 * writes the closed, crew-less enter row the SOP had Claude insert by hand for
 * a McLoughlin cultivar that is hanging but was never scanned. The zone comes
 * from the planting layout; only a cultivar in two McLoughlin zones asks.
 *
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { freshDb, seedLot, seedLoad, sqliteAvailable } from './helpers/harvest-bay-seed.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const mod = (p) => join(REPO, p).replace(/\\/g, '/').replace(/^/, 'file:///');
const { handleHarvestD1 } = await import(mod('workers/src/handlers/harvest-d1.js'));
const { formatError } = await import(mod('workers/src/lib/errors.js'));
const { errorResponse } = await import(mod('workers/src/lib/response.js'));

const API = 'https://x/api/harvest';
// JSON actions throw; index.js's global catch turns that into the error JSON.
// Do the same here so a refusal reads as the 400 the phone would get.
const post = (env, ctx, action, body) => handleHarvestD1(
  new Request(`${API}?action=${action}&lang=en`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, ctx)
  .catch((e) => { const { message, code, status, details } = formatError(e); return errorResponse(message, code, status, details); });

test('lot_add inserts a closed enter row with the bay, zone resolved from the cultivar', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { sqlite, env, ctx } = freshDb();
  sqlite.exec(`INSERT INTO cultivars (name, sku_prefix) VALUES ('Critical Berries', 'CB')`);
  const res = await post(env, ctx, 'lot_add', { bay: 3, cultivar: 'Critical Berries' });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.success, true);
  assert.equal(j.zone, 'MZ1');
  const row = sqlite.prepare(`SELECT * FROM harvest_scan_log WHERE id = ?`).get(j.session_id);
  assert.equal(row.event_type, 'enter');
  assert.equal(row.zone, 'MZ1');
  assert.equal(row.cultivar, 'Critical Berries');
  assert.equal(row.cut_number, 1);
  assert.equal(row.bay, 3);
  assert.ok(row.closed_at, 'never left open: an open crew-less lot picks up trailer loads');
  assert.equal(row.crew, null);
  assert.equal(row.is_test, 1, 'the suite runs in test mode, so the lot is a test lot');
});

test('lot_add asks for the zone when the cultivar is in two McLoughlin zones', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { sqlite, env, ctx } = freshDb();
  sqlite.exec(`INSERT INTO cultivars (name, sku_prefix) VALUES ('Angel Cake', 'ACA')`);
  const res = await post(env, ctx, 'lot_add', { bay: 3, cultivar: 'Angel Cake' });
  assert.equal(res.status, 400);
  const j = await res.json();
  assert.deepEqual(j.details.zones, ['MZ1', 'MZ2']);
  const ok = await post(env, ctx, 'lot_add', { bay: 3, cultivar: 'Angel Cake', zone: 'MZ2' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).zone, 'MZ2');
  const bad = await post(env, ctx, 'lot_add', { bay: 3, cultivar: 'Angel Cake', zone: 'MZ4' });
  assert.equal(bad.status, 400, 'a zone the cultivar is not planted in is a mis-tap');
});

test('lot_add refuses a cultivar with no sku_prefix, naming it', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { env, ctx } = freshDb();
  const res = await post(env, ctx, 'lot_add', { bay: 3, cultivar: 'Runtz' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Runtz/);
});

test('lot_add refuses a cultivar not planted at McLoughlin and a bad bay', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { sqlite, env, ctx } = freshDb();
  sqlite.exec(`INSERT INTO cultivars (name, sku_prefix) VALUES ('Lifter', 'LIFT')`);
  assert.equal((await post(env, ctx, 'lot_add', { bay: 3, cultivar: 'Lifter' })).status, 400);
  sqlite.exec(`INSERT INTO cultivars (name, sku_prefix) VALUES ('Runtz', 'RUN')`);
  assert.equal((await post(env, ctx, 'lot_add', { bay: 13, cultivar: 'Runtz' })).status, 400);
});

test('lot_add dates the lot at the bay fill start so drying days read right, and the bay card appears', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { sqlite, env, ctx } = freshDb();
  sqlite.exec(`INSERT INTO cultivars (name, sku_prefix) VALUES ('Runtz', 'RUN')`);
  // A Z10 lot hung in bay 3 five days ago.
  const z10 = seedLot(sqlite, { zone: 'Z10', cultivar: 'Puff Pastries', daysAgo: 5 });
  seedLoad(sqlite, z10, 3, { bins: 24, minutesAgo: 5 * 1440 });
  const j = await (await post(env, ctx, 'lot_add', { bay: 3, cultivar: 'Runtz' })).json();
  const row = sqlite.prepare(`SELECT occurred_at FROM harvest_scan_log WHERE id = ?`).get(j.session_id);
  const fillStart = sqlite.prepare(`SELECT MIN(occurred_at) AS s FROM harvest_scan_log WHERE event_type='barn_load' AND bay=3`).get().s;
  assert.equal(row.occurred_at, fillStart);
  const page = await handleHarvestD1(new Request(`${API}?action=sack_print&lang=en`), env, ctx);
  const html = await page.text();
  assert.match(html, /Runtz/);
});

const pacificToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

test('lot_add dates a second add at the hand-added fill, so both cultivars stay on the bay', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { sqlite, env, ctx } = freshDb();
  sqlite.exec(`INSERT INTO cultivars (name, sku_prefix) VALUES ('Critical Berries', 'CB'), ('Runtz', 'RUN')`);
  // A McLoughlin bay nobody scans: no barn loads, only hand-added lots.
  const cb = await (await post(env, ctx, 'lot_add', { bay: 12, cultivar: 'Critical Berries' })).json();
  sqlite.prepare(`UPDATE harvest_scan_log SET occurred_at = datetime(occurred_at, '-4 days'),
                  closed_at = datetime(closed_at, '-4 days') WHERE id = ?`).run(cb.session_id);
  const cbAt = sqlite.prepare(`SELECT occurred_at FROM harvest_scan_log WHERE id = ?`).get(cb.session_id).occurred_at;
  const rz = await (await post(env, ctx, 'lot_add', { bay: 12, cultivar: 'Runtz' })).json();
  const rzAt = sqlite.prepare(`SELECT occurred_at FROM harvest_scan_log WHERE id = ?`).get(rz.session_id).occurred_at;
  assert.equal(rzAt, cbAt, 'same fill as the hand-added Critical Berries, not a new one');
  const html = await (await handleHarvestD1(new Request(`${API}?action=bay_tags&lang=en`), env, ctx)).text();
  const bay12 = html.slice(html.indexOf('data-bay="12" data-fill'));
  assert.match(bay12, /data-cultivar="Critical Berries"/);
  assert.match(bay12, /data-cultivar="Runtz"/);
});

test('lot_add refuses a cultivar already in the bay, pointing at its row', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { sqlite, env, ctx } = freshDb();
  sqlite.exec(`INSERT INTO cultivars (name, sku_prefix) VALUES ('Critical Berries', 'CB')`);
  const first = await post(env, ctx, 'lot_add', { bay: 12, cultivar: 'Critical Berries' });
  assert.equal(first.status, 200);
  const firstId = (await first.json()).session_id;
  const again = await post(env, ctx, 'lot_add', { bay: 12, cultivar: 'critical berries' });
  assert.equal(again.status, 400);
  const j = await again.json();
  assert.match(j.error, /already in bay 12/);
  assert.equal(j.details.session_id, firstId);
  assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM harvest_scan_log WHERE event_type = 'enter' AND cultivar = 'Critical Berries'`).get().n, 1);
});

test('lot_add refuses Sour Lifter in a bay where Egg Farm Sour Lifter already hangs', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { sqlite, env, ctx } = freshDb();
  const z14 = seedLot(sqlite, { zone: 'Z14', cultivar: 'Sour Lifter' });
  seedLoad(sqlite, z14, 4, { minutesAgo: 5 * 1440, bins: 48 });
  const res = await post(env, ctx, 'lot_add', { bay: 4, cultivar: 'Sour Lifter' });
  assert.equal(res.status, 400);
  const j = await res.json();
  assert.match(j.error, /already in bay 4/);
  assert.equal(j.details.session_id, z14);
  assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM harvest_scan_log WHERE zone = 'MZ4'`).get().n, 0);
});

test('lot_add in an empty bay dates the lot 8 AM Pacific today, never the next UTC day', async (t) => {
  if (!sqliteAvailable) return t.skip();
  const { sqlite, env, ctx } = freshDb();
  sqlite.exec(`INSERT INTO cultivars (name, sku_prefix) VALUES ('Runtz', 'RUN')`);
  const j = await (await post(env, ctx, 'lot_add', { bay: 7, cultivar: 'Runtz' })).json();
  const at = sqlite.prepare(`SELECT occurred_at FROM harvest_scan_log WHERE id = ?`).get(j.session_id).occurred_at;
  const day = pacificToday();
  const eight = `${day} 15:00:00`;
  assert.ok(at.startsWith(day), `${at} is today's Pacific day`);
  assert.ok(at <= eight, 'never in the future');
  const nowUtc = new Date().toISOString().replace('T', ' ').slice(0, 19);
  if (nowUtc > eight) assert.equal(at, eight);
});
