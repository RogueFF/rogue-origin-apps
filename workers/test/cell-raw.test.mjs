// Raw hand-out and weigh-back (migration 0057, handlers/production/cell-raw.js, lib/raw-yield.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { rawOut, rawBack, rawUndo, getRawBoard } from '../src/handlers/production/cell-raw.js';
import { lotYields, G_PER_LB } from '../src/lib/raw-yield.js';

const NOW = new Date('2026-11-10T18:00:00Z');   // 10:00 am Pacific
const DAY = '2026-11-10';
const LIFTER = '2026 - Lifter / Sungrown';
const SL = '2026 - Sour Lifter / Sungrown';

function env({ with0057 = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE scale_readings (station_id TEXT PRIMARY KEY, weight REAL, target_weight REAL, unit TEXT, updated_at TEXT);`);
  const ms = ['0049-cell-table-stations', '0050-cell-hourly', '0052-cell-job-order', '0054-cell-screen-state',
    ...(with0057 ? ['0057-cell-raw-handout'] : [])];
  for (const m of ms) db.exec(readFileSync(new URL(`../migrations/${m}.sql`, import.meta.url), 'utf8'));
  db.exec(`INSERT OR IGNORE INTO scale_stations (station_id, label, kind, token_hash, stale_after_s) VALUES ('table1', 'Cell 1', 'table', 'x', 45);`);
  const stmt = (sql, p) => ({
    first: async () => db.prepare(sql).get(...p) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...p) }),
    run: async () => ({ meta: { changes: db.prepare(sql).run(...p).changes } }),
  });
  return { raw: db, env: { DB: { prepare: sql => ({ bind: (...p) => stmt(sql, p), ...stmt(sql, []) }) } } };
}
const json = async r => ({ status: r.status, body: await r.json() });

test('hand out, top up, weigh back: the lot adds up and closes', async () => {
  const { env: e } = env();
  let r = await json(await rawOut({ stationId: 'table3', cultivar: SL, bag: 'oz1', bags: 4, grams: 702, suggestedG: 700 }, e, NOW));
  assert.equal(r.status, 200);
  assert.equal(r.body.lot.outG, 702);
  assert.equal(r.body.lot.bags, 4);
  r = await json(await rawOut({ stationId: 'table3', cultivar: SL, grams: 120 }, e, NOW));
  assert.equal(r.body.topUp, true, 'a top-up needs no bag size');
  assert.equal(r.body.lot.outG, 822);
  assert.equal(r.body.lot.outs, 2);
  r = await json(await rawBack({ stationId: 'table3', grams: 900 }, e));
  assert.equal(r.status, 400, 'can\'t weigh back more than went out');
  r = await json(await rawBack({ stationId: 'table3', grams: 95.5 }, e));
  assert.equal(r.body.usedG, 726.5);
  r = await json(await rawBack({ stationId: 'table3', grams: 0 }, e));
  assert.equal(r.body.code, 'NO_OPEN_LOT');
});

test('hard stops: another cultivar while raw is out, unknown cell, no bag size, silly grams', async () => {
  const { env: e } = env();
  await rawOut({ stationId: 'table3', cultivar: SL, bag: 'oz1', grams: 175 }, e, NOW);
  let r = await json(await rawOut({ stationId: 'table3', cultivar: LIFTER, bag: 'oz1', grams: 130 }, e, NOW));
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'WEIGH_BACK_FIRST');
  assert.equal((await rawOut({ stationId: 'table99x', cultivar: SL, bag: 'oz1', grams: 175 }, e, NOW)).status, 400);
  assert.equal((await rawOut({ stationId: 'table4', cultivar: SL, grams: 175 }, e, NOW)).status, 400, 'a new lot needs the bag size');
  assert.equal((await rawOut({ stationId: 'table4', cultivar: SL, bag: 'oz1', grams: 0 }, e, NOW)).status, 400);
  assert.equal((await rawOut({ stationId: 'table4', cultivar: SL, bag: 'oz1', grams: 25000 }, e, NOW)).status, 400);
  assert.equal((await rawOut({ stationId: 'table4', cultivar: '', bag: 'oz1', grams: 100 }, e, NOW)).status, 400);
  assert.equal((await rawOut({ stationId: 'table4', cultivar: SL, bag: 'oz1', bags: 0, grams: 100 }, e, NOW)).status, 400);
});

test('undo: the last entry within 15 min; a weigh-back undo reopens the lot', async () => {
  const { raw, env: e } = env();
  await rawOut({ stationId: 'table3', cultivar: SL, bag: 'oz1', grams: 175 }, e, NOW);
  await rawBack({ stationId: 'table3', grams: 10 }, e);
  let r = await json(await rawUndo({ stationId: 'table3' }, e));
  assert.deepEqual(r.body.undone, { kind: 'back', grams: 10 });
  assert.equal(raw.prepare(`SELECT closed_at FROM cell_raw_lots`).get().closed_at, null, 'open again');
  r = await json(await rawUndo({ stationId: 'table3' }, e));
  assert.equal(r.body.undone.kind, 'out');
  assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM cell_raw_lots`).get().n, 0, 'an empty lot goes too');
  raw.exec(`INSERT INTO cell_raw_lots (station_id, production_date, cultivar, bag) VALUES ('table3', '${DAY}', '${SL}', 'oz1');`);
  raw.exec(`INSERT INTO cell_raw (lot_id, kind, grams, ts) VALUES (2, 'out', 100, datetime('now', '-20 minutes'));`);
  assert.equal((await json(await rawUndo({ stationId: 'table3' }, e))).body.code, 'NOTHING_TO_UNDO', 'too old');
});

test('yield, scale cell: pickups from hand-out to weigh-back (+2 min), never into the next lot', () => {
  const lots = [
    { id: 1, stationId: 'table1', date: DAY, cultivar: SL, openedAt: '2026-11-10 17:00:00', closedAt: '2026-11-10 17:40:00', outG: 700, backG: 100 },
    { id: 2, stationId: 'table1', date: DAY, cultivar: SL, openedAt: '2026-11-10 17:41:00', closedAt: null, outG: 175, backG: 0 },
  ];
  const marks = [
    { station_id: 'table1', ts: '2026-11-10 16:59:00', kg: 0.5 },     // before: not this lot
    { station_id: 'table1', ts: '2026-11-10 17:20:00', kg: 0.06 },
    { station_id: 'table1', ts: '2026-11-10 17:39:00', kg: 0.05 },
    { station_id: 'table1', ts: '2026-11-10 17:40:30', kg: 0.004 },   // just after the weigh-back: counts
    { station_id: 'table1', ts: '2026-11-10 17:41:30', kg: 0.03 },    // the next lot's
  ];
  const y = lotYields({ lots, scaleStations: new Set(['table1']), marks });
  assert.equal(y.lots[0].usedG, 600);
  assert.equal(y.lots[0].topsG, 114);
  assert.equal(y.lots[0].yieldPct, 19);
  assert.equal(y.lots[1].yieldPct, null, 'still open');
  assert.deepEqual(y.byCultivar, [{ cultivar: SL, lots: 1, usedG: 600, topsG: 114, yieldPct: 19, rawPerTops: 5.26 }]);
});

test('yield, cells without a scale: the hourly log for the cell-day-cultivar, once every lot is closed', () => {
  const lots = [
    { id: 1, stationId: 'table3', date: DAY, cultivar: LIFTER, openedAt: '2026-11-10 16:00:00', closedAt: '2026-11-10 18:00:00', outG: 2000, backG: 200 },
    { id: 2, stationId: 'table3', date: DAY, cultivar: LIFTER, openedAt: '2026-11-10 18:05:00', closedAt: '2026-11-10 19:00:00', outG: 1000, backG: 0 },
    { id: 3, stationId: 'table4', date: DAY, cultivar: SL, openedAt: '2026-11-10 16:00:00', closedAt: null, outG: 1000, backG: 0 },
  ];
  const hourly = [
    { station_id: 'table3', production_date: DAY, cultivar: LIFTER, tops_lbs: 1 },
    { station_id: 'table3', production_date: DAY, cultivar: LIFTER, tops_lbs: 0.5 },
    { station_id: 'table3', production_date: DAY, cultivar: SL, tops_lbs: 9 },       // another cultivar
    { station_id: 'table4', production_date: DAY, cultivar: SL, tops_lbs: 0.4 },
  ];
  const y = lotYields({ lots, scaleStations: new Set(['table1']), hourly });
  const g3 = y.groups.find(g => g.stationId === 'table3');
  assert.equal(g3.usedG, 2800);
  assert.equal(g3.topsG, Math.round(1.5 * G_PER_LB * 10) / 10);
  assert.equal(g3.yieldPct, 24.3);
  assert.equal(y.groups.find(g => g.stationId === 'table4').yieldPct, null, 'raw still out');
  assert.equal(y.byCultivar.length, 1);
  assert.equal(y.byCultivar[0].lots, 2);
  assert.equal(y.lots[0].group, g3.key);
});

test('the board: cells with the screen order and open lot, today\'s lots, per-cultivar roll-up', async () => {
  const { raw, env: e } = env();
  raw.exec(`INSERT INTO cell_screen_state (station_id, phase, cultivar, bag, updated_at) VALUES ('table1', 'armed', '${SL}', 'oz1', 1)`);
  await rawOut({ stationId: 'table1', cultivar: SL, bag: 'oz1', grams: 175 }, e, new Date());
  const r = await json(await getRawBoard({ date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) }, e));
  assert.equal(r.status, 200);
  const c1 = r.body.cells.find(c => c.stationId === 'table1');
  assert.equal(c1.hasScale, true);
  assert.deepEqual(c1.screen, { cultivar: SL, bag: 'oz1', phase: 'armed' });
  assert.equal(c1.open.outG, 175);
  assert.equal(r.body.lots.length, 1);
  assert.equal(r.body.cells.find(c => c.stationId === 'table2').open, null);
});

test('before 0057 is applied: the board loads empty and a hand-out says not set up', async () => {
  const { env: e } = env({ with0057: false });
  const r = await json(await getRawBoard({ date: DAY }, e));
  assert.equal(r.status, 200);
  assert.equal(r.body.ready, false);
  assert.equal((await rawOut({ stationId: 'table3', cultivar: SL, bag: 'oz1', grams: 175 }, e, NOW)).status, 503);
});
