/**
 * End to end for "+ Add a cultivar": each hand-added cultivar lands as the row
 * the takedown needs (bay, zone, cut, cultivar), shows on the bay screen with
 * its own PRINT, and prints tags against that row.
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
const post = (env, ctx, action, body) => handleHarvestD1(
  new Request(`${API}?action=${action}&lang=en`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, ctx)
  .catch((e) => { const { message, code, status, details } = formatError(e); return errorResponse(message, code, status, details); });
const get = (env, ctx, action) => handleHarvestD1(new Request(`${API}?action=${action}&lang=en`), env, ctx);

const seedCultivars = (sqlite) => sqlite.exec(`INSERT INTO cultivars (name, sku_prefix) VALUES
  ('Sour Lifter', 'SLIFT'), ('Critical Berries', 'CB'), ('Runtz', 'RUN'), ('Lifter', 'LIFT')`);

test('lot_add keeps the cut the crew picked, so a cut-2 cultivar is logged as cut 2', { skip: !sqliteAvailable }, async () => {
  const { sqlite, env, ctx } = freshDb();
  seedCultivars(sqlite);
  const res = await post(env, ctx, 'lot_add', { bay: 5, cultivar: 'Sour Lifter', zone: 'MZ4', cut: 2 });
  assert.equal(res.status, 200);
  const row = sqlite.prepare(`SELECT cut_number FROM harvest_scan_log WHERE id = ?`).get((await res.json()).session_id);
  assert.equal(row.cut_number, 2);
});

test('several hand-added cultivars in one bay each keep their zone, cut and bay', { skip: !sqliteAvailable }, async () => {
  const { sqlite, env, ctx } = freshDb();
  seedCultivars(sqlite);
  const adds = [
    { bay: 5, cultivar: 'Critical Berries' },
    { bay: 5, cultivar: 'Runtz' },
    { bay: 5, cultivar: 'Lifter', zone: 'Z19' },
  ];
  for (const a of adds) assert.equal((await post(env, ctx, 'lot_add', a)).status, 200, a.cultivar);
  const rows = sqlite.prepare(`SELECT cultivar, zone, cut_number, bay FROM harvest_scan_log
    WHERE event_type = 'enter' AND bay = 5 ORDER BY cultivar`).all();
  assert.deepEqual(rows.map(r => [r.cultivar, r.zone, r.cut_number, r.bay]), [
    ['Critical Berries', 'MZ1', 1, 5],
    ['Lifter', 'Z19', 1, 5],
    ['Runtz', 'MZ3', 1, 5],
  ]);
  const html = await (await get(env, ctx, 'bay_tags')).text();
  const bay5 = html.slice(html.indexOf('data-bay="5" data-fill'));
  for (const a of adds) assert.match(bay5, new RegExp(`data-cultivar="${a.cultivar}"`), a.cultivar);
});

test('a hand-added cultivar prints tags against its own row', { skip: !sqliteAvailable }, async () => {
  const { sqlite, env, ctx } = freshDb();
  seedCultivars(sqlite);
  const res = await post(env, ctx, 'lot_add', { bay: 6, cultivar: 'Critical Berries' });
  const { session_id: id } = await res.json();
  const page = await (await get(env, ctx, 'sack_print')).text();
  assert.match(page, /Critical Berries/);
  const lot = sqlite.prepare(`SELECT zone, cultivar, bay FROM harvest_scan_log WHERE id = ?`).get(id);
  assert.deepEqual([lot.zone, lot.cultivar, lot.bay], ['MZ1', 'Critical Berries', 6]);
});

test('the add sheet offers the cut, so a hand-add is logged on the cut being taken down', { skip: !sqliteAvailable }, async () => {
  const { env, ctx } = freshDb();
  const html = await (await get(env, ctx, 'bay_tags')).text();
  assert.match(html, /<select id="addCut">/);
  assert.match(html, /<option value="2">Cut 2<\/option>/);
  assert.match(html, /body = \{ bay: addBay, cultivar: addCv\.value\.trim\(\), cut: Number\(addCut\.value\) \}/);
});
