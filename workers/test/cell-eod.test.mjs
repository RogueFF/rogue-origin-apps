import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { autoTops } from '../src/lib/cell-auto.js';
import { windowsOf, inWindow, WINDOW_MAX_MS } from '../src/lib/cell-eod.js';
import { notRecording } from '../src/lib/untracked.js';
import { getCellEod, eodWindow, eodWeigh, eodUndo, cellSack } from '../src/handlers/production/cell-eod.js';
import { autoRows } from '../src/handlers/production/cell-hourly.js';
import { getCellBoard } from '../src/handlers/production/cell-board.js';
import { runScaleWatch, runUntrackedWatch } from '../src/lib/scale-watch.js';

// 2026-11-12 (Thu, Phase 1 day 1) is PST (UTC-8): 3:50 pm Pacific is 23:50 UTC.
const DAY = '2026-11-12';
const utc = (h, m, s = 0) => {
  const d = new Date(Date.UTC(2026, 10, 12, h + 8, m, s));
  return d.toISOString().slice(0, 19).replace('T', ' ');
};
const ms = (h, m, s = 0) => Date.parse(utc(h, m, s).replace(' ', 'T') + 'Z');
const r = (h, m, g, s = 0) => ({ ts: utc(h, m, s), kg: g / 1000 });
const tap = (h, m, s = 0) => ({ ts: utc(h, m, s), kind: 'pickup', kg: 0 });
const SLOTS = [
  { slot: '2-3', startMin: 840, endMin: 900 },
  { slot: '3-4', startMin: 900, endMin: 960 },
  { slot: '4-4:20', startMin: 960, endMin: 980 },
];
const LB = g => Math.round((g / 453.59237) * 100) / 100;
const run = (readings, marks = [], windows = []) => autoTops({ day: DAY, readings, marks, slots: SLOTS, windows });

// ---- cell-auto: weighs inside an End of day window are never tops -------------

test('EOD window: leftover raw and the tote weighed on the cell scale add nothing to tops', () => {
  const trim = [r(15, 0, 0), r(15, 20, 80), r(15, 40, 160)];
  const swap = [r(15, 45, 0.4)];                                  // two-basket swap, tapped
  const weighs = [r(15, 50, -170), r(15, 51, 820), r(15, 52, 0), r(15, 53, 455), r(15, 54, 0)];
  const after = [r(16, 5, 0.2)];
  const win = [{ fromMs: ms(15, 49), toMs: ms(15, 56) }];
  const out = run([...trim, ...swap, ...weighs, ...after], [tap(15, 45)], win);
  assert.deepEqual(out.bySlot, { '3-4': LB(160) });
  assert.equal(out.pickups.length, 1, 'only the real swap');
  assert.deepEqual(out.flags, {});

  // Without the window the same log reads the weighs as more pickups (proves the test sees them).
  const bare = run([...trim, ...swap, ...weighs, ...after], [tap(15, 45)]);
  assert.ok(bare.pickups.length > 1 || bare.bySlot['3-4'] !== LB(160));
});

test('EOD window: a zero pending when the panel opens is settled first (tapped = pickup), nothing carries in', () => {
  const out = run(
    [r(15, 0, 0), r(15, 20, 90), r(15, 40, 150), r(15, 45, 0.3), r(15, 50, 700), r(15, 52, 0)],
    [tap(15, 45, 1)],
    [{ fromMs: ms(15, 49), toMs: ms(15, 55) }],
  );
  assert.deepEqual(out.bySlot, { '3-4': LB(150) });
  assert.equal(out.pickups.length, 1);
  assert.equal(Math.round(out.pickups[0].g), 150);
});

test('EOD window: after it, a basket left on starts fresh like the day\'s first reading', () => {
  const out = run(
    [r(14, 50, 0), r(15, 10, 100), r(15, 30, 0.2), r(15, 40, 400), r(15, 41, 0), r(15, 50, 168), r(16, 0, 200)],
    [tap(15, 30, 1)],
    [{ fromMs: ms(15, 35), toMs: ms(15, 45) }],
  );
  // 100 before; 168 is the basket set back on (never tops); 32 after.
  assert.deepEqual(out.bySlot, { '3-4': LB(100), '4-4:20': LB(32) });
});

test('windowsOf: an unclosed window ends WINDOW_MAX_MS after it opened; inWindow has a quiet tail', () => {
  const w = windowsOf([
    { kind: 'window', ts: utc(15, 50), ended_at: null },
    { kind: 'window', ts: utc(15, 0), ended_at: utc(15, 5) },
    { kind: 'raw', ts: utc(15, 51), ended_at: null },
  ]);
  assert.deepEqual(w, [
    { fromMs: ms(15, 50), toMs: ms(15, 50) + WINDOW_MAX_MS },
    { fromMs: ms(15, 0), toMs: ms(15, 5) },
  ]);
  assert.equal(inWindow(w, ms(15, 6)), false);
  assert.equal(inWindow(w, ms(15, 6), 6 * 60e3), true);
});

test('notRecording is quiet during End of day weighs', () => {
  const events = [{ ts: utc(15, 50), weight_kg: 0 }, { ts: utc(15, 52), weight_kg: 0.8 }];
  const args = { scaleLive: true, events, job: null, now: ms(15, 53) };
  assert.equal(notRecording(args).why, 'noScreen');
  assert.equal(notRecording({ ...args, eod: true }), null);
});

// ---- the real tables in SQLite -------------------------------------------------

const mig = name => readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8');
function d1({ eod = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE scale_readings (station_id TEXT PRIMARY KEY, weight REAL, target_weight REAL, unit TEXT, updated_at TEXT);`);
  db.exec(`CREATE TABLE harvest_sacks (sack_id TEXT PRIMARY KEY, serial INTEGER, season INTEGER, cultivar TEXT, fill_lbs REAL,
           opened_at TEXT, voided_at TEXT, is_test INTEGER NOT NULL DEFAULT 0);`);
  for (const m of ['0049-cell-table-stations', '0050-cell-hourly', '0053-scale-down-since', '0054-cell-screen-state', '0055-scale-node-battery', '0056-scale-untracked-since']) db.exec(mig(m));
  if (eod) db.exec(mig('0062-cell-day'));
  db.exec(`INSERT INTO scale_stations (station_id, label, kind, token_hash) VALUES ('table1', 'Cell 1', 'table', 'x'), ('table2', 'Cell 2', 'table', 'y');`);
  const stmt = (sql, p) => ({
    first: async () => db.prepare(sql).get(...p) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...p) }),
    run: async () => { const x = db.prepare(sql).run(...p); return { meta: { changes: x.changes, last_row_id: Number(x.lastInsertRowid) } }; },
  });
  return { raw: db, env: { DB: { prepare: sql => ({ bind: (...p) => stmt(sql, p), ...stmt(sql, []) }) } } };
}
const json = async res => ({ status: res.status, body: await res.json() });
const NOW = ms(15, 50);

test('EOD weighs: several parts sum per kind, battery is kept on the row, Undo within 10 min only', async () => {
  const { raw, env } = d1();
  raw.prepare(`INSERT INTO scale_readings (station_id, weight, unit, updated_at, batt_mv) VALUES ('table1', 0, 'kg', ?, 3920)`).run(utc(15, 49));
  assert.equal((await eodWindow({ stationId: 'table1', open: true }, env, NOW)).status, 200);
  const a = (await json(await eodWeigh({ stationId: 'table1', kind: 'raw', grams: 1850.456 }, env, NOW + 60e3))).body;
  await eodWeigh({ stationId: 'table1', kind: 'raw', grams: 1210 }, env, NOW + 120e3);
  const t = (await json(await eodWeigh({ stationId: 'table1', kind: 'tote', grams: 455.5 }, env, NOW + 180e3))).body;
  assert.equal(a.g, 1850.46);

  let day = (await json(await getCellEod({ stationId: 'table1' }, env, NOW + 200e3))).body;
  assert.equal(day.date, DAY);
  assert.equal(day.rawG, 3060.46);
  assert.equal(day.toteG, 455.5);
  assert.ok(day.windowOpen);
  assert.deepEqual(day.weighs.map(w => w.battMv), [3920, 3920, 3920]);

  assert.equal((await eodUndo({ id: t.id }, env, NOW + 300e3)).status, 200);
  assert.equal((await eodUndo({ id: t.id }, env, NOW + 301e3)).status, 409, 'not twice');
  assert.equal((await eodUndo({ id: a.id }, env, NOW + 60e3 + 10 * 60e3 + 1000)).status, 409, 'too late');
  await eodWindow({ stationId: 'table1', open: false }, env, NOW + 400e3);
  day = (await json(await getCellEod({ stationId: 'table1' }, env, NOW + 401e3))).body;
  assert.equal(day.toteG, 0);
  assert.equal(day.rawG, 3060.46);
  assert.equal(day.windowOpen, null);
});

test('EOD weighs are refused when bad; before 0062 the panel says not set up (503)', async () => {
  const { env } = d1();
  assert.equal((await eodWeigh({ stationId: 'table1', kind: 'tops', grams: 5 }, env, NOW)).status, 400);
  assert.equal((await eodWeigh({ stationId: 'table1', kind: 'raw', grams: 0 }, env, NOW)).status, 400);
  assert.equal((await eodWeigh({ stationId: 'nope', kind: 'raw', grams: 5 }, env, NOW)).status, 400);
  const { env: old } = d1({ eod: false });
  assert.equal((await eodWeigh({ stationId: 'table1', kind: 'raw', grams: 5 }, old, NOW)).status, 503);
  assert.equal((await getCellEod({ stationId: 'table1' }, old, NOW)).status, 503);
  // ...and the readers carry on without it.
  assert.ok(Array.isArray(await autoRows(old, DAY, ['table1'], new Date(NOW))));
  assert.equal((await getCellBoard({}, old, NOW)).status, 200);
});

test('Open twice keeps one window; the hourly tops skip what was weighed inside it', async () => {
  const { raw, env } = d1();
  const ins = raw.prepare(`INSERT INTO scale_events (station_id, ts, weight_kg) VALUES ('table1', ?, ?)`);
  for (const [h, m, g] of [[15, 0, 0], [15, 20, 80], [15, 40, 160], [15, 52, 900], [15, 54, 0], [16, 5, 0]]) ins.run(utc(h, m), g / 1000);
  raw.prepare(`INSERT INTO scale_marks (station_id, ts, kind, kg) VALUES ('table1', ?, 'pickup', 0.16)`).run(utc(15, 45));
  ins.run(utc(15, 45, 5), 0.0003);
  const one = (await json(await eodWindow({ stationId: 'table1', open: true }, env, ms(15, 50)))).body;
  const two = (await json(await eodWindow({ stationId: 'table1', open: true }, env, ms(15, 51)))).body;
  assert.equal(one.id, two.id);
  await eodWindow({ stationId: 'table1', open: false }, env, ms(15, 56));
  const rows = await autoRows(env, DAY, ['table1'], new Date(ms(16, 30)));
  const tops = rows.reduce((s, x) => s + x.tops, 0);
  assert.equal(Math.round(tops * 100) / 100, LB(160));
});

test('Sacks: only today\'s scanned-out sacks can be ticked, one cell each; fill_lbs or the crop-year sack', async () => {
  const { raw, env } = d1();
  const sack = raw.prepare(`INSERT INTO harvest_sacks (sack_id, serial, season, cultivar, fill_lbs, opened_at, voided_at, is_test) VALUES (?, ?, 2026, ?, ?, ?, ?, ?)`);
  sack.run('26-SL-1', 1, '2026 - Sour Lifter / Sungrown', null, utc(7, 5), null, 0);
  sack.run('26-SL-2', 2, '2026 - Sour Lifter / Sungrown', 18, utc(11, 0), null, 0);
  sack.run('26-SL-3', 3, '2026 - Sour Lifter / Sungrown', null, '2026-11-11 18:00:00', null, 0);   // yesterday
  sack.run('26-SL-4', 4, '2026 - Sour Lifter / Sungrown', null, utc(9, 0), null, 1);               // test sack
  sack.run('26-SL-5', 5, '2026 - Sour Lifter / Sungrown', null, utc(9, 0), utc(9, 1), 0);          // voided
  assert.equal((await cellSack({ stationId: 'table1', sackId: '26-SL-1', on: true }, env, NOW)).status, 200);
  assert.equal((await cellSack({ stationId: 'table1', sackId: '26-SL-1', on: true }, env, NOW)).status, 200, 'again: no change');
  assert.equal((await cellSack({ stationId: 'table2', sackId: '26-SL-1', on: true }, env, NOW)).status, 409);
  assert.equal((await cellSack({ stationId: 'table1', sackId: '26-SL-3', on: true }, env, NOW)).status, 400);
  await cellSack({ stationId: 'table2', sackId: '26-SL-2', on: true }, env, NOW);

  const day1 = (await json(await getCellEod({ stationId: 'table1' }, env, NOW))).body;
  assert.deepEqual(day1.sacks.map(s => [s.sackId, s.lbs, s.stationId]), [['26-SL-1', 35, 'table1']], 'table2\'s sack hidden, test/voided/yesterday out');
  const day2 = (await json(await getCellEod({ stationId: 'table2' }, env, NOW))).body;
  assert.deepEqual(day2.sacks.map(s => [s.sackId, s.lbs, s.stationId]), [['26-SL-2', 18, 'table2']]);

  await cellSack({ stationId: 'table1', sackId: '26-SL-1', on: false }, env, NOW);
  const after = (await json(await getCellEod({ stationId: 'table2' }, env, NOW))).body;
  assert.equal(after.sacks.length, 2, 'untick frees it for any cell');
});

test('the board flags a cell in End of day and does not call it NOT RECORDING', async () => {
  const { raw, env } = d1();
  raw.prepare(`INSERT INTO scale_readings (station_id, weight, unit, updated_at, stable) VALUES ('table1', 0.8, 'kg', ?, 1)`).run(utc(15, 52, 50));
  const ins = raw.prepare(`INSERT INTO scale_events (station_id, ts, weight_kg) VALUES ('table1', ?, ?)`);
  ins.run(utc(15, 50), 0); ins.run(utc(15, 52), 0.8);
  const cell = async () => (await json(await getCellBoard({}, env, ms(15, 53)))).body.cells.find(c => c.stationId === 'table1');
  assert.ok((await cell()).notRecording, 'without a window: red');
  await eodWindow({ stationId: 'table1', open: true }, env, ms(15, 49));
  const c = await cell();
  assert.equal(c.notRecording, null);
  assert.equal(c.eod, true);
});

// ---- episode history (scale_episodes) -----------------------------------------

test('offline episodes are logged with the outage times even when no Telegram chat is set', async () => {
  const { raw, env } = d1();
  raw.prepare(`INSERT INTO scale_readings (station_id, weight, unit, updated_at) VALUES ('table1', 0.01, 'kg', ?)`).run(utc(10, 0));
  await runScaleWatch(env, new Date(ms(10, 5)));
  await runScaleWatch(env, new Date(ms(10, 10)));
  let eps = raw.prepare(`SELECT station_id, kind, from_ts, to_ts FROM scale_episodes`).all();
  assert.deepEqual(eps.map(e => ({ ...e })), [{ station_id: 'table1', kind: 'offline', from_ts: utc(10, 0), to_ts: null }]);
  raw.prepare(`UPDATE scale_readings SET updated_at = ? WHERE station_id = 'table1'`).run(utc(10, 12, 30));
  await runScaleWatch(env, new Date(ms(10, 15)));
  eps = raw.prepare(`SELECT from_ts, to_ts FROM scale_episodes`).all();
  assert.deepEqual(eps.map(e => ({ ...e })), [{ from_ts: utc(10, 0), to_ts: utc(10, 12, 30) }]);
});

test('NOT RECORDING episodes open on a rise with no job and close once a job records; none during EOD', async () => {
  const { raw, env } = d1();
  raw.prepare(`INSERT INTO scale_readings (station_id, weight, unit, updated_at) VALUES ('table1', 0.02, 'kg', ?)`).run(utc(10, 4, 50));
  const ins = raw.prepare(`INSERT INTO scale_events (station_id, ts, weight_kg) VALUES ('table1', ?, ?)`);
  ins.run(utc(10, 1), 0); ins.run(utc(10, 4), 0.02);
  await runUntrackedWatch(env, new Date(ms(10, 5)));
  await runUntrackedWatch(env, new Date(ms(10, 6)));
  let eps = raw.prepare(`SELECT kind, from_ts, to_ts, why FROM scale_episodes`).all();
  assert.deepEqual(eps.map(e => ({ ...e })), [{ kind: 'untracked', from_ts: utc(10, 5), to_ts: null, why: 'noScreen' }]);
  raw.prepare(`INSERT INTO cell_screen_state (station_id, phase, updated_at) VALUES ('table1', 'running', ?)`).run(ms(10, 9, 50));
  raw.prepare(`UPDATE scale_readings SET updated_at = ? WHERE station_id = 'table1'`).run(utc(10, 9, 55));
  await runUntrackedWatch(env, new Date(ms(10, 10)));
  eps = raw.prepare(`SELECT to_ts FROM scale_episodes`).all();
  assert.equal(eps[0].to_ts, utc(10, 10));

  // End of day: the lead's weighs on an idle screen open nothing.
  const { raw: raw2, env: env2 } = d1();
  raw2.prepare(`INSERT INTO scale_readings (station_id, weight, unit, updated_at) VALUES ('table1', 0.9, 'kg', ?)`).run(utc(15, 52, 50));
  const ins2 = raw2.prepare(`INSERT INTO scale_events (station_id, ts, weight_kg) VALUES ('table1', ?, ?)`);
  ins2.run(utc(15, 50), 0); ins2.run(utc(15, 52), 0.9);
  await eodWindow({ stationId: 'table1', open: true }, env2, ms(15, 49));
  await runUntrackedWatch(env2, new Date(ms(15, 53)));
  assert.equal(raw2.prepare(`SELECT COUNT(*) AS n FROM scale_episodes`).get().n, 0);
});
