import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { setCellState, getCellBoard } from '../src/handlers/production/cell-board.js';

const mig = name => readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8');
function d1({ board = true, scale = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(mig('0050-cell-hourly'));
  if (scale) {
    db.exec(`CREATE TABLE scale_readings (station_id TEXT PRIMARY KEY, weight REAL, target_weight REAL, unit TEXT, updated_at TEXT);`);
    db.exec(mig('0049-cell-table-stations'));
    db.exec(`INSERT INTO scale_stations (station_id, label, kind, token_hash) VALUES ('table1', 'Cell 1', 'table', 'x');`);
  }
  if (board) db.exec(mig('0054-cell-screen-state'));
  const stmt = (sql, p) => ({
    first: async () => db.prepare(sql).get(...p) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...p) }),
    run: async () => ({ meta: { changes: db.prepare(sql).run(...p).changes } }),
  });
  return { raw: db, env: { DB: { prepare: sql => ({ bind: (...p) => stmt(sql, p), ...stmt(sql, []) }) } } };
}
const json = async r => ({ status: r.status, body: await r.json() });
const T0 = Date.parse('2026-11-09T22:00:00Z');
const cell1 = async (env, now) => (await json(await getCellBoard({}, env, now))).body.cells.find(c => c.stationId === 'table1');

test('a running job is stored as a start on the Worker clock, so the board can tick it', async () => {
  const { env } = d1();
  const order = { stationId: 'table1', cultivar: '2026 - Sour Lifter / Sungrown', bag: 'hOz', targetG: 15 };
  assert.equal((await setCellState({ ...order, phase: 'running', elapsedMs: 42000 }, env, T0)).status, 200);
  const c = await cell1(env, T0 + 5000);
  assert.equal(c.job.phase, 'running');
  assert.equal(c.job.clockStart, T0 - 42000);
  assert.equal(c.job.clockMs, null);
  assert.equal(c.job.bag, 'hOz');
  assert.equal(c.job.tabletOnline, true);
  assert.equal(c.label, 'Cell 1');
});

test('paused and finished clocks are frozen; finished_at stays put until the bag is lifted', async () => {
  const { env } = d1();
  const base = { stationId: 'table1', cultivar: 'Lifter', bag: 'qOz', targetG: 7.5 };
  await setCellState({ ...base, phase: 'running', elapsedMs: 60000, paused: true, pauseNote: 'Need help' }, env, T0);
  let c = await cell1(env, T0);
  assert.deepEqual([c.job.clockStart, c.job.clockMs, c.job.paused, c.job.pauseNote], [null, 60000, true, 'Need help']);
  await setCellState({ ...base, phase: 'finished', elapsedMs: 95000, finishedNetG: 7.62 }, env, T0 + 1000);
  await setCellState({ ...base, phase: 'finished', elapsedMs: 95000, finishedNetG: 7.62 }, env, T0 + 31000);  // heartbeat
  c = await cell1(env, T0 + 32000);
  assert.deepEqual([c.job.phase, c.job.clockMs, c.job.finishedNetG, c.job.finishedAt], ['finished', 95000, 7.62, T0 + 1000]);
  await setCellState({ ...base, phase: 'idle' }, env, T0 + 40000);
  c = await cell1(env, T0 + 40000);
  assert.deepEqual([c.job.phase, c.job.finishedAt, c.job.clockMs], ['idle', null, null]);
});

test('the board carries each scale\'s live weight and goes stale on the station\'s own time', async () => {
  const { raw, env } = d1();
  raw.prepare(`INSERT INTO scale_readings (station_id, weight, unit, stable, updated_at) VALUES ('table1', 0.00981, 'kg', 1, '2026-11-09 22:00:00')`).run();
  let c = await cell1(env, T0 + 10000);
  assert.deepEqual(c.scale, { weightG: 9.81, stable: true, live: true, updatedAt: T0, battery: null });
  c = await cell1(env, T0 + 46000);
  assert.equal(c.scale.live, false, 'past 45 s');
  const other = (await json(await getCellBoard({}, env, T0))).body.cells.find(x => x.stationId === 'table2');
  assert.equal(other.scale, null, 'no scale at this cell yet');
  assert.equal(other.job, null);
});

test('a tablet that stopped reporting shows offline after 90 s', async () => {
  const { env } = d1();
  await setCellState({ stationId: 'table1', phase: 'idle' }, env, T0);
  assert.equal((await cell1(env, T0 + 89000)).job.tabletOnline, true);
  assert.equal((await cell1(env, T0 + 91000)).job.tabletOnline, false);
});

test('bad input is refused and writes nothing', async () => {
  const { raw, env } = d1();
  for (const b of [
    { stationId: 'table1', phase: 'done' },
    { stationId: 'table99', phase: 'idle' },
    { stationId: 'table1', phase: 'running', elapsedMs: -1 },
    { stationId: 'table1', phase: 'idle', targetG: 99999 },
  ]) assert.equal((await setCellState(b, env, T0)).status, 400, JSON.stringify(b));
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM cell_screen_state').get().n, 0);
  await setCellState({ stationId: 'table1', phase: 'idle', bag: '10lb' }, env, T0);
  assert.equal((await cell1(env, T0)).job.bag, null, 'an unknown bag is dropped, not refused');
});

test('before 0054 (and without the scale tables) the board still loads', async () => {
  const { env } = d1({ board: false, scale: false });
  const r = await json(await getCellBoard({}, env, T0));
  assert.equal(r.status, 200);
  assert.equal(r.body.cells.length, 21);
  assert.equal(r.body.cells[0].job, null);
});

test('the migration is safe to run twice', () => {
  const { raw } = d1();
  raw.exec(mig('0054-cell-screen-state'));
});

// ---- Waiting at the pickup spot (Koa 2026-11-11, migration 0060)
import { collectPickup } from '../src/handlers/production/cell-board.js';
function withMarks() {
  const x = d1();
  x.raw.exec(mig('0052-cell-job-order'));
  x.raw.exec(mig('0060-pickup-spot'));
  return x;
}
const at = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

test('a pickup not yet collected waits at the spot; collected, it leaves the board; undo puts it back', async () => {
  const { raw, env } = withMarks();
  raw.prepare(`INSERT INTO scale_marks (station_id, ts, kind, kg, cultivar, bag, cycle_s) VALUES ('table1', ?, 'pickup', 0.0142, '2026 - Lifter / Sungrown', 'hOz', 1500)`).run(at(T0 - 60e3));
  raw.prepare(`INSERT INTO scale_marks (station_id, ts, kind, kg) VALUES ('table1', ?, 'tare', 0)`).run(at(T0 - 50e3));
  let b = (await json(await getCellBoard({}, env, T0))).body;
  assert.equal(b.waiting.length, 1);
  assert.deepEqual({ ...b.waiting[0], id: 0 }, { id: 0, stationId: 'table1', label: 'Cell 1', at: T0 - 60e3, g: 14.2, cultivar: '2026 - Lifter / Sungrown', bag: 'hOz', cycleS: 1500, jobId: null });
  const id = b.waiting[0].id;
  assert.equal((await collectPickup({ id }, env, T0)).status, 200);
  assert.equal((await collectPickup({ id }, env, T0)).status, 409);          // already collected
  b = (await json(await getCellBoard({}, env, T0))).body;
  assert.equal(b.waiting.length, 0);
  assert.equal((await collectPickup({ id, undo: true }, env, T0 + 5 * 60e3)).status, 200);
  assert.equal((await json(await getCellBoard({}, env, T0 + 5 * 60e3))).body.waiting.length, 1);
  await collectPickup({ id }, env, T0);
  assert.equal((await collectPickup({ id, undo: true }, env, T0 + 11 * 60e3)).status, 409);   // too late
});

test('pickups from before 0060 count as collected, and nothing older than a day waits', async () => {
  const { raw, env } = d1();
  raw.exec(mig('0052-cell-job-order'));
  raw.prepare(`INSERT INTO scale_marks (station_id, ts, kind, kg) VALUES ('table1', ?, 'pickup', 0.02)`).run(at(T0 - 60e3));
  raw.exec(mig('0060-pickup-spot'));
  raw.prepare(`INSERT INTO scale_marks (station_id, ts, kind, kg) VALUES ('table1', ?, 'pickup', 0.03)`).run(at(T0 - 25 * 3600e3));
  assert.equal((await json(await getCellBoard({}, env, T0))).body.waiting.length, 0);
});

test('before 0060: the board still loads with nothing waiting, and collect says not ready', async () => {
  const { env } = d1();
  assert.deepEqual((await json(await getCellBoard({}, env, T0))).body.waiting, []);
  assert.equal((await collectPickup({ id: 1 }, env, T0)).status, 503);
});
