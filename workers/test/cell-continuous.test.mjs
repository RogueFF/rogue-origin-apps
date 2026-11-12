// Continuous (wholesale) rounds, Worker side (Koa 2026-11-11): a round is a job
// (one pickup mark, bag 'cont'), hourly tops count every round exactly once, the
// End of day weighs stay out, the board says the round, and a cell between rounds
// is never NOT RECORDING.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { autoTops } from '../src/lib/cell-auto.js';
import { getCellHourly, scaleMark } from '../src/handlers/production/cell-hourly.js';
import { setCellState, getCellBoard, pacificMidnight } from '../src/handlers/production/cell-board.js';
import { recording, notRecording } from '../src/lib/untracked.js';

const mig = name => readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE scale_readings (station_id TEXT PRIMARY KEY, weight REAL, target_weight REAL, unit TEXT, updated_at TEXT);`);
  for (const m of ['0049-cell-table-stations', '0050-cell-hourly', '0051-cell-quality-checks', '0052-cell-job-order',
    '0054-cell-screen-state', '0060-pickup-spot', '0062-cell-day']) db.exec(mig(m));
  db.exec(`CREATE TABLE IF NOT EXISTS scale_readings (station_id TEXT PRIMARY KEY, weight REAL, target_weight REAL, unit TEXT, updated_at TEXT);`);
  db.exec(`INSERT OR IGNORE INTO scale_stations (station_id, label, kind, token_hash) VALUES ('table1', 'Cell 1', 'table', 'x');`);
  const stmt = (sql, p) => ({
    first: async () => db.prepare(sql).get(...p) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...p) }),
    run: async () => ({ meta: { changes: db.prepare(sql).run(...p).changes } }),
  });
  return { raw: db, env: { DB: { prepare: sql => ({ bind: (...p) => stmt(sql, p), ...stmt(sql, []) }) } } };
}
const json = async r => ({ status: r.status, body: await r.json() });

// ---- a full day of rounds ---------------------------------------------------
// Monday 2026-11-09, PST (UTC-8). Minutes are Pacific minutes since midnight.
const DAY = '2026-11-09';
// PST: Pacific + 8 h, rolling into the next UTC day after 4 pm.
const utc = (min, sec = 0) => new Date(Date.parse(`${DAY}T08:00:00Z`) + Math.round(min * 60 + sec) * 1000).toISOString().slice(0, 19).replace('T', ' ');
const BREAKS = [[540, 550], [720, 750], [870, 880]];   // 9:00, lunch 12:00, 2:30
const worked = (a, b) => (b - a) - BREAKS.reduce((s, [x, y]) => s + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);
const RATE = 3;        // g per worked minute
const CRUMBS = 0.3;    // the basket comes back about empty

/**
 * 7:00 to 16:10: rounds of 40 min whenever the bagger comes by, a pickup each
 * (lifted off, back about empty), round 5 a two-basket swap (new basket + TARE).
 * Then the End of day panel: the leftover raw and the tote weighed on the scale.
 */
function day() {
  const readings = [], marks = [], rounds = [];
  let start = 420, n = 0, base = 0;
  while (start + 40 <= 970) {
    n++;
    const end = start + 40;
    // The first round starts from a tared 0; later ones from the reading the basket came back at.
    for (let t = n === 1 ? start : start + 5; t < end; t += 5) readings.push({ ts: utc(t), kg: (base + RATE * worked(start, t)) / 1000 });
    const g = RATE * worked(start, end);
    readings.push({ ts: utc(end), kg: (base + g) / 1000 });
    readings.push({ ts: utc(end + 0.5), kg: -150 / 1000 });                 // basket lifted
    if (n === 5) {
      readings.push({ ts: utc(end + 1), kg: 6 / 1000 });                   // the other basket, 6 g heavier
      readings.push({ ts: utc(end + 1, 30), kg: 0 });                      // TARE: back to 0
      marks.push({ ts: utc(end + 1, 31), kind: 'pickup', kg: (base + g) / 1000 });
    } else {
      readings.push({ ts: utc(end + 1), kg: CRUMBS / 1000 });
      marks.push({ ts: utc(end + 1, 2), kind: 'pickup', kg: (base + g) / 1000 });
    }
    rounds.push({ g, base });
    base = n === 5 ? 0 : CRUMBS;
    start = end + 1;
  }
  // End of day, 16:20-16:30: the leftover raw (820 g) handed into the basket on
  // the scale and lifted off, then the tote (455 g). Outside a window the raw
  // reads exactly like a round being trimmed and picked up.
  const eod = [[981, 200], [981.5, 450], [982, 820], [982.5, -150], [983, CRUMBS], [983.5, 455], [984, -150], [984.5, CRUMBS]];
  for (const [t, g] of eod) readings.push({ ts: utc(t), kg: g / 1000 });
  const windows = [{ fromMs: Date.parse(utc(980).replace(' ', 'T') + 'Z'), toMs: Date.parse(utc(990).replace(' ', 'T') + 'Z') }];
  return { readings, marks, rounds, windows };
}
const SLOTS = [
  [420, 480], [480, 540], [540, 600], [600, 660], [660, 720], [750, 780], [780, 840], [840, 900], [900, 960], [960, 990],
].map(([startMin, endMin]) => ({ slot: `${startMin}`, startMin, endMin }));
const LB = g => g / 453.59237;

test('a full day of continuous rounds: every round is one pickup and counts once; EOD weighs add nothing', () => {
  const { readings, marks, rounds, windows } = day();
  assert.equal(rounds.length, 13);
  const out = autoTops({ day: DAY, readings, marks, slots: SLOTS, windows });
  assert.equal(out.pickups.length, rounds.length, 'one pickup per round, the swap included');
  assert.deepEqual(out.pickups.map(p => Math.round(p.g * 10) / 10), rounds.map(r => Math.round((r.g + r.base) * 10) / 10));
  const total = Object.values(out.bySlot).reduce((a, x) => a + x, 0);
  const want = rounds.reduce((a, r) => a + r.g, 0);
  // Each hour is rounded to 0.01 lb.
  assert.ok(Math.abs(total - LB(want)) <= 0.005 * SLOTS.length, `${total} vs ${LB(want)}`);
  assert.deepEqual(out.flags, {});
  // Neutral check: with no EOD window, the weighs would have counted.
  const leak = autoTops({ day: DAY, readings, marks, slots: SLOTS, windows: [] });
  assert.ok(Object.values(leak.bySlot).reduce((a, x) => a + x, 0) > total + 0.5);
});

test('the same day end to end: marks with bag cont, the hourly log matches the rounds', async () => {
  const { raw, env } = d1();
  const { readings, marks, rounds } = day();
  const ev = raw.prepare('INSERT INTO scale_events (station_id, ts, weight_kg) VALUES (?, ?, ?)');
  for (const r of readings) ev.run('table1', r.ts, r.kg);
  const mk = raw.prepare(`INSERT INTO scale_marks (station_id, ts, kind, kg, cultivar, bag, cycle_s) VALUES ('table1', ?, 'pickup', ?, '2026 - Sour Lifter / Sungrown', 'cont', 2400)`);
  for (const m of marks) mk.run(m.ts, m.kg);
  raw.prepare(`INSERT INTO cell_eod (station_id, production_date, kind, ts, ended_at) VALUES ('table1', ?, 'window', ?, ?)`).run(DAY, utc(980), utc(990));
  const { body } = await json(await getCellHourly({ date: DAY }, env));
  const total = body.auto.filter(a => a.stationId === 'table1').reduce((a, x) => a + x.tops, 0);
  assert.ok(Math.abs(total - LB(rounds.reduce((a, r) => a + r.g, 0))) <= 0.05, String(total));
  assert.ok(body.auto.every(a => a.flag === null));
});

test('scaleMark keeps bag cont on a round\'s pickup (it used to drop unknown bags to null)', async () => {
  const { raw, env } = d1();
  const r = await scaleMark({ stationId: 'table1', kind: 'pickup', kg: 0.312, cultivar: '2026 - Lifter / Sungrown', bag: 'cont', cycleS: 1800 }, env);
  assert.equal(r.status, 200);
  assert.deepEqual({ ...raw.prepare(`SELECT kind, bag, cultivar, cycle_s FROM scale_marks`).get() },
    { kind: 'pickup', bag: 'cont', cultivar: '2026 - Lifter / Sungrown', cycle_s: 1800 });
});

// ---- the Cells board ----------------------------------------------------------
const NOW = Date.parse('2026-11-10T00:40:00Z');   // 4:40 pm Pacific, 2026-11-09

test('pacificMidnight: the start of the Pacific day, PST and PDT', () => {
  assert.equal(new Date(pacificMidnight(NOW)).toISOString(), '2026-11-09T08:00:00.000Z');
  assert.equal(new Date(pacificMidnight(Date.parse('2026-07-01T06:59:30Z'))).toISOString(), '2026-06-30T07:00:00.000Z');
});

test('board: a continuous cell carries bag cont and the rounds it closed today', async () => {
  const { raw, env } = d1();
  const mk = raw.prepare(`INSERT INTO scale_marks (station_id, ts, kind, kg, cultivar, bag) VALUES ('table1', ?, 'pickup', ?, 'x', ?)`);
  mk.run('2026-11-09 16:00:00', 0.2, 'cont');   // 8:00 am today
  mk.run('2026-11-09 18:00:00', 0.25, 'cont');  // 10:00 am today
  mk.run('2026-11-09 23:00:00', 0.18, 'cont');  // 3:00 pm today
  mk.run('2026-11-09 07:30:00', 0.3, 'cont');   // yesterday (11:30 pm 11-08): not today's
  mk.run('2026-11-09 20:00:00', 0.03, 'oz1');   // a retail job: not a round
  mk.run('2026-11-09 21:00:00', 0, 'cont');     // an empty tap: not a round
  assert.equal((await setCellState({ stationId: 'table1', phase: 'running', cultivar: '2026 - Lifter / Sungrown', bag: 'cont', targetG: 0, elapsedMs: 60000 }, env, NOW)).status, 200);
  const cell = (await json(await getCellBoard({}, env, NOW))).body.cells.find(c => c.stationId === 'table1');
  assert.equal(cell.job.bag, 'cont');
  assert.equal(cell.job.rounds, 3, 'round 4 is on the scale');
  // A retail job has no round count.
  await setCellState({ stationId: 'table1', phase: 'running', cultivar: 'x', bag: 'oz1', targetG: 30, elapsedMs: 1000 }, env, NOW);
  assert.equal((await json(await getCellBoard({}, env, NOW))).body.cells.find(c => c.stationId === 'table1').job.rounds, null);
});

test('board: rounds still load before 0052 (no bag column): zero, never an error', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE scale_readings (station_id TEXT PRIMARY KEY, weight REAL, target_weight REAL, unit TEXT, updated_at TEXT);`);
  for (const m of ['0049-cell-table-stations', '0050-cell-hourly', '0054-cell-screen-state']) db.exec(mig(m));
  db.exec(`CREATE TABLE IF NOT EXISTS scale_readings (station_id TEXT PRIMARY KEY, weight REAL, target_weight REAL, unit TEXT, updated_at TEXT);`);
  db.exec(`INSERT OR IGNORE INTO scale_stations (station_id, label, kind, token_hash) VALUES ('table1', 'Cell 1', 'table', 'x');`);
  const stmt = (sql, p) => ({ first: async () => db.prepare(sql).get(...p) ?? null, all: async () => ({ results: db.prepare(sql).all(...p) }), run: async () => ({ meta: { changes: db.prepare(sql).run(...p).changes } }) });
  const env = { DB: { prepare: sql => ({ bind: (...p) => stmt(sql, p), ...stmt(sql, []) }) } };
  await setCellState({ stationId: 'table1', phase: 'armed', cultivar: 'x', bag: 'cont' }, env, NOW);
  const r = await getCellBoard({}, env, NOW);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).cells.find(c => c.stationId === 'table1').job.rounds, 0);
});

// ---- NOT RECORDING -------------------------------------------------------------
const job = (o = {}) => ({ phase: 'armed', bag: 'cont', cultivar: '2026 - Lifter / Sungrown', updated_at: NOW - 20000, ...o });
const T = min => new Date(NOW - min * 60000).toISOString().replace('T', ' ').slice(0, 19);
const trimming = [{ ts: T(5), weight_kg: 0.002 }, { ts: T(4), weight_kg: 0.006 }, { ts: T(3), weight_kg: 0.0095 }, { ts: T(1), weight_kg: 0.014 }];

test('between rounds (armed on continuous with a cultivar) is recording; armed retail still is not', () => {
  assert.equal(recording(job(), NOW), true);
  assert.equal(notRecording({ scaleLive: true, events: trimming, job: job(), now: NOW }), null);
  assert.equal(recording(job({ bag: 'oz1' }), NOW), false, 'armed on a retail order: the old rule');
  assert.equal(recording(job({ cultivar: null }), NOW), false, 'no cultivar: nothing to record it as');
  assert.equal(recording(job({ updated_at: NOW - 91000 }), NOW), false, 'tablet silent: not recording');
  assert.equal(recording(job({ phase: 'idle' }), NOW), false);
});
