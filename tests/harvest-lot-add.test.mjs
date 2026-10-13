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
