import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  getCellHourly, setCellHourly, setCellQuality, setRoomSmalls, saveCellRoster, scaleMark,
} from '../src/handlers/production/cell-hourly.js';

/**
 * A real SQLite database (node:sqlite) behind a D1-shaped wrapper, with
 * migration 0050 applied. The handlers' SQL runs for real: the upserts, the
 * UNIQUE keys, the CHECK constraints and the seed roster.
 */
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0050-cell-hourly.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0051-cell-quality-checks.sql', import.meta.url), 'utf8'));
  // Prepared lazily, like D1: a missing table fails when the statement runs.
  const stmt = (sql, params) => ({
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => { const r = db.prepare(sql).run(...params); return { meta: { changes: r.changes } }; },
  });
  return {
    raw: db,
    prepare: sql => ({ bind: (...p) => stmt(sql, p), ...stmt(sql, []) }),
  };
}

const json = async r => ({ status: r.status, body: await r.json() });
const DAY = '2026-11-09';
const SLOT = '9:00 AM – 10:00 AM';

test('the roster is seeded with 21 cells, 12-14 retail, in order', async () => {
  const env = { DB: d1() };
  const { body } = await json(await getCellHourly({ date: DAY }, env));
  assert.equal(body.roster.length, 21);
  assert.deepEqual(body.roster.filter(c => c.lane === 'retail').map(c => c.stationId), ['table12', 'table13', 'table14']);
  assert.equal(body.roster[0].stationId, 'table1');
  assert.equal(body.roster[20].label, 'Cell 21');
});

test('slots are the canonical hourly-entry slots with their break-adjusted hours', async () => {
  const env = { DB: d1() };
  const { body } = await json(await getCellHourly({ date: DAY }, env));
  assert.equal(body.slots[0].slot, '7:00 AM – 8:00 AM');
  assert.equal(body.slots.find(s => s.slot === '9:00 AM – 10:00 AM').hours, 0.83);
  assert.equal(body.slots.find(s => s.slot === '12:30 PM – 1:00 PM').hours, 0.5);
});

test('saves are field by field: tops, then quality, then notes land on one row without wiping each other', async () => {
  const env = { DB: d1() };
  const base = { date: DAY, slot: SLOT, stationId: 'table7' };
  assert.equal((await json(await setCellHourly({ ...base, tops: 0.84, cultivar: '2026 - Sour Lifter / Sungrown' }, env))).status, 200);
  await setCellHourly({ ...base, quality: 'pass' }, env);
  await setCellHourly({ ...base, notes: 'good pace' }, env);
  const { body } = await json(await getCellHourly({ date: DAY }, env));
  assert.equal(body.rows.length, 1);
  assert.deepEqual(
    (({ stationId, slot, tops, quality, notes, cultivar, source }) => ({ stationId, slot, tops, quality, notes, cultivar, source }))(body.rows[0]),
    { stationId: 'table7', slot: SLOT, tops: 0.84, quality: 'pass', notes: 'good pace', cultivar: '2026 - Sour Lifter / Sungrown', source: 'manual' },
  );
});

test('a plain hyphen slot is stored under the canonical en-dash key', async () => {
  const env = { DB: d1() };
  await setCellHourly({ date: DAY, slot: '9:00 AM - 10:00 AM', stationId: 'table1', tops: 1 }, env);
  const { body } = await json(await getCellHourly({ date: DAY }, env));
  assert.equal(body.rows[0].slot, SLOT);
});

test('null clears a field; quality can go back to not checked', async () => {
  const env = { DB: d1() };
  const base = { date: DAY, slot: SLOT, stationId: 'table2' };
  await setCellHourly({ ...base, tops: 1.2, quality: 'fail', notes: 'stems' }, env);
  await setCellHourly({ ...base, tops: null, quality: null }, env);
  const { body } = await json(await getCellHourly({ date: DAY }, env));
  assert.equal(body.rows[0].tops, null);
  assert.equal(body.rows[0].quality, null);
  assert.equal(body.rows[0].notes, 'stems');
});

test('bad input is refused and writes nothing', async () => {
  const env = { DB: d1() };
  const base = { date: DAY, slot: SLOT, stationId: 'table3' };
  const cases = [
    { ...base, tops: -1 }, { ...base, tops: 51 }, { ...base, tops: 'abc' },
    { ...base, quality: 'ok' }, { ...base, slot: '7:48 AM – 8:00 AM', tops: 1 },
    { ...base, slot: '5:00 PM – 6:00 PM', tops: 1 }, { ...base, date: '2026-13-40', tops: 1 },
    { ...base, stationId: 'table99', tops: 1 }, { ...base },
  ];
  for (const c of cases) assert.equal((await setCellHourly(c, env)).status, 400, JSON.stringify(c));
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM cell_hourly').get().n, 0);
});

test('room smalls is one number per hour, kept apart from the cells', async () => {
  const env = { DB: d1() };
  await setRoomSmalls({ date: DAY, slot: SLOT, smalls: 3.4, cultivar: '2026 - Lifter / Sungrown' }, env);
  await setRoomSmalls({ date: DAY, slot: SLOT, smalls: 3.6 }, env);
  const { body } = await json(await getCellHourly({ date: DAY }, env));
  assert.deepEqual(body.room.map(r => [r.slot, r.smalls, r.cultivar]), [[SLOT, 3.6, '2026 - Lifter / Sungrown']]);
  assert.equal(body.rows.length, 0);
  assert.equal((await setRoomSmalls({ date: DAY, slot: SLOT, smalls: 201 }, env)).status, 400);
});

test('adding a cell takes the next table number, even after one is removed', async () => {
  const env = { DB: d1() };
  const added = (await json(await saveCellRoster({ label: 'Maria', lane: 'wholesale' }, env))).body;
  assert.equal(added.stationId, 'table22');
  await saveCellRoster({ stationId: 'table22', label: 'Maria', lane: 'wholesale', active: false }, env);
  const again = (await json(await saveCellRoster({}, env))).body;
  assert.equal(again.stationId, 'table23');
  assert.equal(again.label, 'Cell 23');
  const { body } = await json(await getCellHourly({ date: DAY }, env));
  assert.equal(body.roster.find(c => c.stationId === 'table22').active, false, 'removed, not deleted');
});

test('renaming keeps the station id and its rows; a bad lane is refused', async () => {
  const env = { DB: d1() };
  await setCellHourly({ date: DAY, slot: SLOT, stationId: 'table12', tops: 0.5 }, env);
  await saveCellRoster({ stationId: 'table12', label: 'Juana', lane: 'retail' }, env);
  const { body } = await json(await getCellHourly({ date: DAY }, env));
  const cell = body.roster.find(c => c.stationId === 'table12');
  assert.equal(cell.label, 'Juana');
  assert.equal(body.rows[0].stationId, 'table12');
  assert.equal((await saveCellRoster({ stationId: 'table12', label: 'x', lane: 'bulk' }, env)).status, 400);
});

test('the migrations are safe to run twice', () => {
  const db = d1().raw;
  db.exec(readFileSync(new URL('../migrations/0050-cell-hourly.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../migrations/0051-cell-quality-checks.sql', import.meta.url), 'utf8'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cell_roster').get().n, 21);
});

// With the scale tables from 0049 present, cells with a scale get hourly auto values.
function d1WithScale() {
  const env = { DB: d1() };
  env.DB.raw.exec(`CREATE TABLE scale_readings (station_id TEXT PRIMARY KEY, weight REAL, target_weight REAL, unit TEXT, updated_at TEXT);`);
  env.DB.raw.exec(readFileSync(new URL('../migrations/0049-cell-table-stations.sql', import.meta.url), 'utf8'));
  env.DB.raw.exec(`INSERT INTO scale_stations (station_id, label, kind, token_hash) VALUES ('table1', 'Cell 1', 'table', 'x');`);
  return env;
}

test('a cell with a scale gets hourly auto tops from its net readings, and a mid-job TARE is flagged', async () => {
  const env = d1WithScale();
  // 2026-11-02 (PST, UTC-8): basket tared on the scale at 9:00 (reads 0), net 160 g by 9:40,
  // 220 g by 10:10, then the scale's TARE pressed mid-job (straight to 0) and 30 g more.
  const ev = (utc, g) => env.DB.raw.prepare('INSERT INTO scale_events (station_id, ts, weight_kg) VALUES (?, ?, ?)').run('table1', utc, g / 1000);
  ev('2026-11-02 17:00:00', 0); ev('2026-11-02 17:20:00', 70); ev('2026-11-02 17:40:00', 160);
  ev('2026-11-02 18:10:00', 220); ev('2026-11-02 18:20:00', 0); ev('2026-11-02 18:30:00', 30);
  assert.equal((await scaleMark({ stationId: 'table1', kind: 'pickup', kg: 0.22 }, env)).status, 200);
  const { body } = await json(await getCellHourly({ date: '2026-11-02' }, env));
  assert.deepEqual(body.auto.map(a => [a.stationId, a.slot, a.tops, a.final, a.flag]), [
    ['table1', '9:00 AM – 10:00 AM', 0.35, true, null],
    ['table1', '10:00 AM – 11:00 AM', 0.2, true, 'scaleTared'],
  ]);
});

test('scale marks are refused for a station without a scale, or with a bad kind or weight', async () => {
  const env = d1WithScale();
  for (const b of [{ stationId: 'table2', kind: 'tare', kg: 0.05 }, { stationId: 'table1', kind: 'zero', kg: 0 }, { stationId: 'table1', kind: 'tare', kg: 11 }]) {
    assert.equal((await scaleMark(b, env)).status, 400, JSON.stringify(b));
  }
});

test('without the 0049 scale tables the day still loads, with no auto values', async () => {
  const { body } = await json(await getCellHourly({ date: DAY }, { DB: d1() }));
  assert.deepEqual(body.auto, []);
});

const batchesOf = async (env, stationId) =>
  (await json(await getCellHourly({ date: DAY }, env))).body.batches.filter(b => b.stationId === stationId);

test('quality is by batch: four checks scored 1-4, all 3 or 4 = pass, any 1 or 2 = redo', async () => {
  const env = { DB: d1() };
  const base = { date: DAY, stationId: 'table4', batch: 1 };
  await setCellQuality({ ...base, qTrim: 4, qStems: 3, checkedBy: 'MG', cultivar: '2026 - Lifter' }, env);
  assert.equal((await batchesOf(env, 'table4'))[0].quality, null, 'two of four scored: not done yet');
  await setCellQuality({ ...base, qMold: 4, qInsects: 3 }, env);
  let [b] = await batchesOf(env, 'table4');
  assert.equal(b.batch, 1);
  assert.equal(b.quality, 'pass');
  assert.deepEqual(b.checks, { qTrim: 4, qStems: 3, qMold: 4, qInsects: 3 });
  assert.equal(b.checkedBy, 'MG');
  assert.equal(b.cultivar, '2026 - Lifter');
  assert.equal(b.alert, null);
  const res = (await json(await setCellQuality({ ...base, qTrim: 2 }, env))).body;
  assert.equal(res.quality, 'fail', 'a 2 means redo, and the save says so');
  await setCellQuality({ ...base, qTrim: 3 }, env);
  assert.equal((await batchesOf(env, 'table4'))[0].quality, 'pass', 'fixing a typo re-scores the batch');
});

test('batches are kept apart: batch 2 never touches batch 1, and the hourly rows stay empty', async () => {
  const env = { DB: d1() };
  await setCellQuality({ date: DAY, stationId: 'table4', batch: 1, qTrim: 1, qStems: 4, qMold: 4, qInsects: 4 }, env);
  await setCellQuality({ date: DAY, stationId: 'table4', batch: 2, qTrim: 4, qStems: 4, qMold: 4, qInsects: 4 }, env);
  await setCellQuality({ date: DAY, stationId: 'table5', batch: 1, qMold: 3 }, env);
  const b = await batchesOf(env, 'table4');
  assert.deepEqual(b.map(x => [x.batch, x.quality]), [[1, 'fail'], [2, 'pass']], 'the redo stays on record');
  assert.equal((await batchesOf(env, 'table5')).length, 1);
  assert.equal((await json(await getCellHourly({ date: DAY }, env))).body.rows.length, 0);
});

test('one low score is a redo before the rest are scored; a 1 on mold or insects is a stop', async () => {
  const env = { DB: d1() };
  await setCellQuality({ date: DAY, stationId: 'table6', batch: 1, qStems: 1 }, env);
  let [b] = await batchesOf(env, 'table6');
  assert.equal(b.quality, 'fail');
  assert.equal(b.alert, null, 'a 1 on stems is a redo, not a stop');
  for (const [n, key] of [[2, 'qMold'], [3, 'qInsects']]) {
    await setCellQuality({ date: DAY, stationId: 'table6', batch: n, [key]: 1 }, env);
    b = (await batchesOf(env, 'table6')).find(x => x.batch === n);
    assert.equal(b.alert, 'stop', key);
    assert.equal(b.quality, 'fail', key);
  }
});

test('bad scores, batch numbers and cells are refused and nothing is written', async () => {
  const env = { DB: d1() };
  const base = { date: DAY, stationId: 'table4', batch: 1 };
  for (const v of [0, 5, 2.5, 'pass', 'fail']) {
    assert.equal((await setCellQuality({ ...base, qTrim: v }, env)).status, 400, String(v));
  }
  for (const batch of [0, -1, 1.5, 501, 'x', undefined]) {
    assert.equal((await setCellQuality({ ...base, batch, qTrim: 3 }, env)).status, 400, String(batch));
  }
  assert.equal((await setCellQuality({ ...base, stationId: 'table99', qTrim: 3 }, env)).status, 400);
  assert.equal((await setCellQuality(base, env)).status, 400, 'nothing to save');
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM cell_quality').get().n, 0);
});

test('the hourly save no longer takes scores', async () => {
  const env = { DB: d1() };
  await setCellHourly({ date: DAY, slot: SLOT, stationId: 'table4', tops: 0.5, qTrim: 1 }, env);
  const { body } = await json(await getCellHourly({ date: DAY }, env));
  assert.equal(body.rows[0].quality, null);
  assert.equal(body.batches.length, 0);
});

test('without migration 0051 the day still loads, with no batches', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0050-cell-hourly.sql', import.meta.url), 'utf8'));
  const stmt = (sql, params) => ({
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => ({ meta: { changes: db.prepare(sql).run(...params).changes } }),
  });
  const env = { DB: { prepare: sql => ({ bind: (...p) => stmt(sql, p), ...stmt(sql, []) }) } };
  const r = await json(await getCellHourly({ date: DAY }, env));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.batches, []);
});
