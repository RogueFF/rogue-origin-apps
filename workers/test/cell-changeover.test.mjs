// Change cultivar in Continuous mode (Koa 2026-11-11, migration 0063): the old
// cultivar's leftover raw is weighed between rounds (cell scale in parts, or typed
// from the bench scale), tagged with that cultivar; the changeover window keeps
// those weighs out of tops and pickups; the board says "Changeover · A → B".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { autoTops } from '../src/lib/cell-auto.js';
import { windowsOf } from '../src/lib/cell-eod.js';
import { getCellEod, eodWindow, eodWeigh, eodUndo } from '../src/handlers/production/cell-eod.js';
import { setCellState, getCellBoard, changeoverOf } from '../src/handlers/production/cell-board.js';

const mig = name => readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8');
function d1({ with0063 = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE scale_readings (station_id TEXT PRIMARY KEY, weight REAL, target_weight REAL, unit TEXT, updated_at TEXT);`);
  for (const m of ['0049-cell-table-stations', '0050-cell-hourly', '0052-cell-job-order', '0054-cell-screen-state', '0055-scale-node-battery',
    '0060-pickup-spot', '0062-cell-day', ...(with0063 ? ['0063-cell-changeover'] : [])]) db.exec(mig(m));
  db.exec(`INSERT OR IGNORE INTO scale_stations (station_id, label, kind, token_hash) VALUES ('table1', 'Cell 1', 'table', 'x');`);
  db.exec(`INSERT INTO scale_readings (station_id, weight, unit, updated_at, batt_mv) VALUES ('table1', 0, 'kg', '2026-11-12 18:00:00', 3920);`);
  const stmt = (sql, p) => ({
    first: async () => db.prepare(sql).get(...p) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...p) }),
    run: async () => { const r = db.prepare(sql).run(...p); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return { raw: db, env: { DB: { prepare: sql => ({ bind: (...p) => stmt(sql, p), ...stmt(sql, []) }) } } };
}
const json = async r => ({ status: r.status, body: await r.json() });
const A = '2026 - Sour Lifter / Sungrown', B = '2026 - Lifter / Sungrown';
// Thursday 2026-11-12, PST: 10:00 am Pacific = 18:00 UTC.
const T = (h, m, s = 0) => Date.parse('2026-11-12T08:00:00Z') + ((h * 60 + m) * 60 + s) * 1000;

test('changeover weighs: scale parts and a bench number, tagged with the old cultivar; the window says changeover from A', async () => {
  const { env } = d1();
  const now = T(10, 1);
  assert.equal((await eodWindow({ stationId: 'table1', open: true, reason: 'changeover', cultivar: A }, env, now)).status, 200);
  await eodWeigh({ stationId: 'table1', kind: 'raw', grams: 1820.4, cultivar: A, reason: 'changeover', source: 'scale' }, env, now + 30000);
  await eodWeigh({ stationId: 'table1', kind: 'raw', grams: 912.1, cultivar: A, reason: 'changeover', source: 'scale' }, env, now + 60000);
  await eodWeigh({ stationId: 'table1', kind: 'raw', grams: 5624.55, cultivar: A, reason: 'changeover', source: 'bench' }, env, now + 90000);
  const { body } = await json(await getCellEod({ stationId: 'table1' }, env, now + 100000));
  assert.deepEqual(body.windowOpen && [body.windowOpen.reason, body.windowOpen.cultivar], ['changeover', A]);
  assert.deepEqual(body.weighs.map(w => [w.g, w.cultivar, w.reason, w.source, w.battMv]), [
    [1820.4, A, 'changeover', 'scale', 3920],
    [912.1, A, 'changeover', 'scale', 3920],
    [5624.55, A, 'changeover', 'bench', null],   // never on the cell scale: no battery
  ]);
  assert.equal(body.rawG, 8357.05);
  // Undo within 10 minutes, same as End of day.
  assert.equal((await eodUndo({ id: body.weighs[2].id }, env, now + 120000)).status, 200);
  assert.equal((await json(await getCellEod({ stationId: 'table1' }, env, now + 130000))).body.rawG, 2732.5);
});

test('End of day leftover raw takes a cultivar; the tote never has one; bad tags fall back, never refuse', async () => {
  const { env } = d1();
  const now = T(16, 25);
  await eodWindow({ stationId: 'table1', open: true }, env, now);
  await eodWeigh({ stationId: 'table1', kind: 'raw', grams: 640, cultivar: B }, env, now + 1000);
  await eodWeigh({ stationId: 'table1', kind: 'tote', grams: 455, cultivar: B }, env, now + 2000);
  await eodWeigh({ stationId: 'table1', kind: 'raw', grams: 10, cultivar: '  ', reason: 'nonsense', source: 'magic' }, env, now + 3000);
  const { body } = await json(await getCellEod({ stationId: 'table1' }, env, now + 4000));
  assert.deepEqual(body.windowOpen && body.windowOpen.reason, 'eod');
  assert.deepEqual(body.weighs.map(w => [w.kind, w.cultivar, w.reason, w.source]), [
    ['raw', B, 'eod', 'scale'], ['tote', null, 'eod', 'scale'], ['raw', null, 'eod', 'scale'],
  ]);
});

test('before 0063 the weighs and the window still save, untagged (never lost)', async () => {
  const { raw, env } = d1({ with0063: false });
  assert.equal((await eodWindow({ stationId: 'table1', open: true, reason: 'changeover', cultivar: A }, env, T(10, 1))).status, 200);
  assert.equal((await eodWeigh({ stationId: 'table1', kind: 'raw', grams: 500, cultivar: A, reason: 'changeover' }, env, T(10, 2))).status, 200);
  assert.deepEqual(raw.prepare(`SELECT kind, grams FROM cell_eod ORDER BY id`).all().map(r => [r.kind, r.grams]), [['window', null], ['raw', 500]]);
  const { body } = await json(await getCellEod({ stationId: 'table1' }, env, T(10, 3)));
  assert.equal(body.weighs[0].cultivar, null);
});

// ---- the board ---------------------------------------------------------------
test('changeoverOf: from the old cultivar\'s last pickup until the new one\'s first gram', () => {
  const co = { cultivar: A, ts: '2026-11-12 18:01:00' };
  const job = (o = {}) => ({ phase: 'idle', bag: 'cont', cultivar: null, ...o });
  assert.deepEqual(changeoverOf(job(), co, '2026-11-12 18:00:00'), { from: A, to: null, since: Date.parse('2026-11-12T18:01:00Z') });
  assert.deepEqual(changeoverOf(job({ phase: 'armed', cultivar: B }), co, '2026-11-12 18:00:00').to, B);
  assert.equal(changeoverOf(job({ phase: 'running', cultivar: B }), co, '2026-11-12 18:00:00'), null, 'B is trimming');
  assert.equal(changeoverOf(job({ phase: 'armed', cultivar: B }), co, '2026-11-12 18:40:00'), null, 'B\'s first round was picked up');
  assert.equal(changeoverOf(job({ bag: 'oz1' }), co, null), null, 'retail');
  assert.equal(changeoverOf(job(), null, null), null);
});

test('board: the tile reads Changeover A → B through the whole changeover, then back to rounds', async () => {
  const { raw, env } = d1();
  raw.prepare(`INSERT INTO scale_marks (station_id, ts, kind, kg, cultivar, bag) VALUES ('table1', '2026-11-12 18:00:00', 'pickup', 0.2, ?, 'cont')`).run(A);
  await eodWindow({ stationId: 'table1', open: true, reason: 'changeover', cultivar: A }, env, T(10, 1));
  const tile = async now => (await json(await getCellBoard({}, env, now))).body.cells.find(c => c.stationId === 'table1');
  await setCellState({ stationId: 'table1', phase: 'idle', bag: 'cont', cultivar: null }, env, T(10, 2));
  let c = await tile(T(10, 2));
  assert.deepEqual([c.changeover.from, c.changeover.to], [A, null]);
  assert.equal(c.notRecording, null, 'weighing in the changeover window is never NOT RECORDING');
  await eodWindow({ stationId: 'table1', open: false }, env, T(10, 4));
  await setCellState({ stationId: 'table1', phase: 'armed', bag: 'cont', cultivar: B }, env, T(10, 5));
  c = await tile(T(10, 5));
  assert.deepEqual([c.changeover.from, c.changeover.to], [A, B]);
  await setCellState({ stationId: 'table1', phase: 'running', bag: 'cont', cultivar: B, elapsedMs: 1000 }, env, T(10, 6));
  assert.equal((await tile(T(10, 6))).changeover, null);
});

// ---- a day with 2 changeovers through the hourly rules ------------------------
// Rounds of Sour Lifter, a changeover (leftover weighed on the cell scale in two
// parts inside the window), rounds of Lifter, a changeover with a bench number
// (nothing on the cell scale), Sour Lifter again. Readings are NET (basket tared).
const utc = (h, m, s = 0) => new Date(T(h, m, s)).toISOString().slice(0, 19).replace('T', ' ');
const SLOTS = [{ slot: '9-10', startMin: 540, endMin: 600 }, { slot: '10-11', startMin: 600, endMin: 660 }, { slot: '11-12', startMin: 660, endMin: 720 }];
test('a day with 2 changeovers: every round counts once, the changeover weighs never count as tops', () => {
  const R = [], M = [];
  const round = (h, m, g, cultivar) => {   // 20 min of trimming to g, then a pickup back about empty
    R.push({ ts: utc(h, m), kg: 0.0003 }, { ts: utc(h, m + 10), kg: g / 2000 }, { ts: utc(h, m + 20), kg: (g + 0.3) / 1000 });
    R.push({ ts: utc(h, m + 20, 30), kg: -0.15 }, { ts: utc(h, m + 21), kg: 0.0003 });
    M.push({ ts: utc(h, m + 21, 2), kind: 'pickup', kg: (g + 0.3) / 1000, cultivar });
  };
  round(9, 0, 120, A); round(9, 22, 135, A);
  // Changeover 1 (9:44-9:50): the tray of A's leftover on the cell scale, two parts.
  R.push({ ts: utc(9, 45), kg: 0.4 }, { ts: utc(9, 45, 30), kg: 1.8204 }, { ts: utc(9, 46), kg: 0.0003 },
    { ts: utc(9, 47), kg: 0.3 }, { ts: utc(9, 47, 30), kg: 0.9121 }, { ts: utc(9, 48), kg: 0.0003 });
  round(9, 51, 140, B); round(10, 13, 150, B);
  // Changeover 2 (10:35-10:38): B's big leftover typed from the bench scale, the cell scale untouched.
  round(10, 40, 110, A);
  const windows = windowsOf([
    { kind: 'window', ts: utc(9, 44), ended_at: utc(9, 50) },
    { kind: 'window', ts: utc(10, 35), ended_at: utc(10, 38) },
  ]);
  const out = autoTops({ day: '2026-11-12', readings: R, marks: M, slots: SLOTS, windows });
  assert.equal(out.pickups.length, 5, 'five rounds, five pickups; no weigh is a pickup');
  const total = Object.values(out.bySlot).reduce((a, x) => a + x, 0);
  const want = (120 + 135 + 140 + 150 + 110) / 453.59237;
  assert.ok(Math.abs(total - want) <= 0.015, `${total} vs ${want}`);
  const leak = autoTops({ day: '2026-11-12', readings: R, marks: M, slots: SLOTS, windows: [] });
  assert.ok(Object.values(leak.bySlot).reduce((a, x) => a + x, 0) > total + 1, 'without the window the leftover would have counted');
});
