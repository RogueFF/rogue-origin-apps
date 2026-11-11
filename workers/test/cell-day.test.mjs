import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { changeovers, breakMsIn, episodesInDay, verifiedYield, median, qualityOf, CELL_BREAKS } from '../src/lib/cell-day.js';
import { autoTops } from '../src/lib/cell-auto.js';
import { getCellDay, pacificDayMs } from '../src/handlers/production/cell-day.js';

// Thu 2026-11-12, PST (UTC-8).
const DAY = '2026-11-12';
const utc = (h, m, s = 0) => new Date(Date.UTC(2026, 10, 12, h + 8, m, s)).toISOString().slice(0, 19).replace('T', ' ');
const ms = (h, m, s = 0) => Date.UTC(2026, 10, 12, h + 8, m, s);

test('#159 breaks only (no 4:20 cleanup); break time inside a span is counted', () => {
  assert.deepEqual(CELL_BREAKS, [[540, 550], [720, 750], [870, 880]]);
  assert.equal(breakMsIn(ms(8, 55), ms(9, 20)), 10 * 60e3);
  assert.equal(breakMsIn(ms(11, 50), ms(12, 10)), 10 * 60e3);
  assert.equal(breakMsIn(ms(10, 0), ms(10, 30)), 0);
  assert.deepEqual(pacificDayMs(DAY), [ms(0, 0), ms(24, 0)]);
});

test('changeover: pickup to the next first gram, or the queue Start if sooner; breaks out; last pickup none', () => {
  const pickups = [{ ms: ms(10, 0), jobId: 7 }, { ms: ms(11, 55) }, { ms: ms(14, 0) }];
  const rises = [
    { ms: ms(9, 30), g: 40 },
    { ms: ms(10, 0, 30), g: 0.4 },        // drift: under START_G
    { ms: ms(10, 2), g: 3.1 },            // first gram
    { ms: ms(12, 33), g: 5 },             // after lunch
  ];
  const co = changeovers(pickups, rises, [ms(10, 1, 30)]);
  assert.deepEqual(co.map(c => [c.s, c.by, c.breakS, c.jobId]), [
    [90, 'start', 0, 7],                  // Start at 10:01:30 beats the 10:02 gram
    [38 * 60 - 30 * 60, 'gram', 30 * 60, null],   // 11:55 -> 12:33, lunch out: 8 min
  ]);
  assert.equal(median([90, 480]), 285);
  assert.equal(median([]), null);
});

test('changeover: a basket set down then tared is not the first gram (autoTops rises are real tops only)', () => {
  const slots = [{ slot: '10-11', startMin: 600, endMin: 660 }];
  const out = autoTops({
    day: DAY, slots,
    readings: [[10, 0, 0], [10, 10, 200], [10, 20, 0.3], [10, 22, 168], [10, 23, 0], [10, 30, 6], [10, 40, 50]]
      .map(([h, m, g]) => ({ ts: utc(h, m), kg: g / 1000 })),
    marks: [{ ts: utc(10, 20, 1), kind: 'pickup', kg: 0.2 }],
  });
  const co = changeovers([{ ms: ms(10, 20, 1) }], out.rises.map(r => ({ ms: Date.parse(r.ts.replace(' ', 'T') + 'Z'), g: r.g })));
  assert.equal(co.length, 1);
  assert.equal(co[0].toMs, ms(10, 30), 'the 168 g basket at 10:22 (then tared) is skipped');
});

test('episodes clip to the day, breaks out, an open one runs to now', () => {
  const [from, to] = pacificDayMs(DAY);
  const eps = episodesInDay([
    { kind: 'offline', from_ts: utc(8, 50), to_ts: utc(9, 20) },
    { kind: 'untracked', from_ts: utc(15, 0), to_ts: null, why: 'noJob' },
    { kind: 'offline', from_ts: '2026-11-11 23:00:00', to_ts: '2026-11-11 23:30:00' },
  ], from, to, ms(15, 12));
  assert.deepEqual(eps.map(e => [e.kind, e.minutes, e.toMs === null]), [['offline', 20, false], ['untracked', 12, true]]);
});

test('verified tops/sack = tops x 35 / (sack lbs in - EOD leftover); no carry-in; none without an EOD weigh', () => {
  const v = verifiedYield({ topsLb: 12, sacksLb: 35, eodRawG: 453.59237 * 4, toteG: 453.59237 * 1.5 });
  assert.deepEqual([v.rawInLb, v.usedLb, v.toteLb, v.topsPerSack, v.accountedPct], [35, 31, 1.5, 13.55, 44]);
  assert.equal(v.carryInLb, undefined);
  assert.equal(verifiedYield({ topsLb: 12, sacksLb: 35, eodRawG: null }).topsPerSack, null);
  assert.equal(verifiedYield({ topsLb: 12, sacksLb: 0, eodRawG: 100 }).topsPerSack, null);
});

test('quality: scored batches, redos, and STOP calls', () => {
  assert.deepEqual(qualityOf([
    { quality: 'pass' }, { quality: 'fail', q_mold: 1 }, { quality: null }, { quality: 'pass' },
  ]), { batches: 3, pass: 2, redo: 1, stop: 1 });
});

// ---- the whole read, on the real tables -----------------------------------

const mig = name => readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8');
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE scale_readings (station_id TEXT PRIMARY KEY, weight REAL, target_weight REAL, unit TEXT, updated_at TEXT);`);
  db.exec(`CREATE TABLE harvest_sacks (sack_id TEXT PRIMARY KEY, serial INTEGER, season INTEGER, cultivar TEXT, fill_lbs REAL,
           opened_at TEXT, voided_at TEXT, is_test INTEGER NOT NULL DEFAULT 0);`);
  for (const m of ['0049-cell-table-stations', '0050-cell-hourly', '0051-cell-quality-checks', '0052-cell-job-order',
    '0053-scale-down-since', '0055-scale-node-battery', '0060-pickup-spot', '0062-cell-day']) db.exec(mig(m));
  db.exec(`INSERT INTO scale_stations (station_id, label, kind, token_hash) VALUES ('table1', 'Cell 1', 'table', 'x');`);
  const stmt = (sql, p) => ({
    first: async () => db.prepare(sql).get(...p) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...p) }),
    run: async () => ({ meta: { changes: db.prepare(sql).run(...p).changes } }),
  });
  return { raw: db, env: { DB: { prepare: sql => ({ bind: (...p) => stmt(sql, p), ...stmt(sql, []) }) } } };
}

test('cellDay: one Phase 1 day end to end', async () => {
  const { raw, env } = d1();
  const ev = raw.prepare(`INSERT INTO scale_events (station_id, ts, weight_kg) VALUES ('table1', ?, ?)`);
  // 9-10: 0 -> 227 g, pickup at 9:50 (swap), back on at ~0, trims again from 9:53.
  for (const [h, m, g] of [[9, 12, 0], [9, 30, 120], [9, 48, 227], [9, 50, 0.3], [9, 53, 4], [10, 40, 230]]) ev.run(utc(h, m), g / 1000);
  const mk = raw.prepare(`INSERT INTO scale_marks (station_id, ts, kind, kg, cultivar, bag, cycle_s, collected_at) VALUES ('table1', ?, 'pickup', ?, ?, ?, ?, ?)`);
  mk.run(utc(9, 50, 1), 0.227, '2026 - Sour Lifter / Sungrown', 'hLb', 2280, utc(9, 55));
  mk.run(utc(10, 41), 0.226, '2026 - Sour Lifter / Sungrown', 'hLb', 2820, null);
  // The lead typed 10-11 by hand: it wins over the scale.
  raw.prepare(`INSERT INTO cell_hourly (production_date, station_id, time_slot, tops_lbs, source) VALUES (?, 'table1', '10:00 AM – 11:00 AM', 0.6, 'manual')`).run(DAY);
  raw.prepare(`INSERT INTO cell_quality (production_date, station_id, batch_no, quality) VALUES (?, 'table1', 1, 'pass'), (?, 'table1', 2, 'fail')`).run(DAY, DAY);
  raw.prepare(`INSERT INTO scale_episodes (station_id, kind, from_ts, to_ts) VALUES ('table1', 'offline', ?, ?)`).run(utc(11, 0), utc(11, 6));
  raw.prepare(`INSERT INTO harvest_sacks VALUES ('26-SL-1', 1, 2026, '2026 - Sour Lifter / Sungrown', NULL, ?, NULL, 0)`).run(utc(7, 5));
  raw.prepare(`INSERT INTO cell_sacks (production_date, sack_id, station_id) VALUES (?, '26-SL-1', 'table1')`).run(DAY);
  const eod = raw.prepare(`INSERT INTO cell_eod (station_id, production_date, kind, grams, batt_mv, ts, undone_at) VALUES ('table1', ?, ?, ?, ?, ?, ?)`);
  eod.run('2026-11-11', 'raw', 2268, 3900, '2026-11-12 00:05:00', null);      // yesterday's leftover: went back, never counts
  eod.run(DAY, 'raw', 1814.4, 3810, utc(15, 50), null);
  eod.run(DAY, 'raw', 500, 3810, utc(15, 51), utc(15, 52));                   // undone
  eod.run(DAY, 'tote', 680.4, 3805, utc(15, 53), null);

  const res = await getCellDay({ stationId: 'table1', date: DAY }, env, ms(17, 10));
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.label, 'Cell 1');
  assert.deepEqual([d.cultivar, d.cultivarShare, d.mixed], ['2026 - Sour Lifter / Sungrown', 1, false]);
  assert.equal(d.tops.personH, 1.18, '9:30 first gram to the 10:41 pickup');
  assert.equal(d.yield.accountedPct, 8, '(1.11 + 1.5) / 31');
  assert.deepEqual(d.tops.hourly.map(h => [h.source, h.lb]), [['scale', 0.51], ['typed', 0.6]]);
  assert.equal(d.tops.lb, 1.11);
  assert.equal(d.tops.workedH, 1.83, '9-10 is 0.83 h (9:00 break)');
  assert.deepEqual(d.jobs.map(j => [j.g, j.bag, j.cycleS]), [[227, 'hLb', 2280], [226, 'hLb', 2820]]);
  assert.equal(d.changeovers.count, 1);
  assert.equal(d.changeovers.medianS, 3 * 60 - 1, '9:50:01 pickup -> 9:53 first gram');
  // 11:00-11:06 offline is after the 10:41 last pickup: listed, not counted.
  assert.deepEqual([d.gaps.offline.count, d.gaps.offline.minutes, d.gaps.notRecording.count], [0, 0, 0]);
  assert.deepEqual(d.gaps.offline.uncounted.map(e => e.minutes), [6]);
  assert.deepEqual(d.quality, { batches: 2, pass: 1, redo: 1, stop: 0 });
  assert.deepEqual([d.sacks.count, d.sacks.lb], [1, 35]);
  assert.deepEqual(d.eod, { rawG: 1814.4, toteG: 680.4 });
  assert.deepEqual([d.yield.rawInLb, d.yield.eodRawLb, d.yield.usedLb, d.yield.toteLb], [35, 4, 31, 1.5]);
  assert.equal(d.yield.topsPerSack, Math.round((1.11 * 35 / 31) * 100) / 100);
  assert.deepEqual([d.battery.mv, d.battery.from], [3805, 'eod']);
});

test('cellDay: unknown station 400; a bare day reads empty, not an error', async () => {
  const { env } = d1();
  assert.equal((await getCellDay({ stationId: 'nope' }, env, ms(12, 0))).status, 400);
  const d = await (await getCellDay({ stationId: 'table1', date: DAY }, env, ms(12, 0))).json();
  assert.deepEqual([d.tops.lb, d.jobs.length, d.changeovers.medianS, d.yield.topsPerSack, d.battery], [0, 0, null, null, null]);
});

test('cellDay: an episode left open overnight counts only inside each day\'s shift (6:00 to 4:20)', async () => {
  const { raw, env } = d1();
  // Scale switched off at cleanup with weight on: NOT RECORDING from 3:59 pm, closed 7:10 next morning.
  raw.prepare(`INSERT INTO scale_episodes (station_id, kind, from_ts, to_ts, why) VALUES ('table1', 'untracked', ?, ?, 'noJob')`)
    .run(utc(15, 59), '2026-11-13 15:10:00');
  const thu = await (await getCellDay({ stationId: 'table1', date: DAY }, env, ms(40, 0))).json();
  const fri = await (await getCellDay({ stationId: 'table1', date: '2026-11-13' }, env, ms(40, 0))).json();
  assert.equal(thu.gaps.notRecording.minutes, 21, '3:59 to the 4:20 cleanup');
  assert.equal(fri.gaps.notRecording.minutes, 70, '6:00 to 7:10 next morning');
});

test('a day with no sack ticked has no verified figure (the leftover goes back each night)', () => {
  assert.equal(verifiedYield({ topsLb: 3, sacksLb: 0, eodRawG: 453.59237 * 2 }).topsPerSack, null);
});

test('cellDay raw=1: the day\'s scale events, marks, screen log, EOD rows and episodes; not without it', async () => {
  const { raw, env } = d1();
  raw.exec(readFileSync(new URL('../migrations/0054-cell-screen-state.sql', import.meta.url), 'utf8'));
  raw.exec(readFileSync(new URL('../migrations/0062-cell-day.sql', import.meta.url), 'utf8'));   // safe twice
  raw.prepare(`INSERT INTO scale_events (station_id, ts, weight_kg) VALUES ('table1', ?, 0.0123), ('table1', ?, 0.5)`).run(utc(9, 0), '2026-11-11 20:00:00');
  raw.prepare(`INSERT INTO scale_marks (station_id, ts, kind, kg) VALUES ('table1', ?, 'tare', 0.168)`).run(utc(9, 1));
  raw.prepare(`INSERT INTO cell_screen_log (station_id, ts, phase) VALUES ('table1', ?, 'running')`).run(utc(9, 2));
  raw.prepare(`INSERT INTO cell_eod (station_id, production_date, kind, ts, ended_at) VALUES ('table1', ?, 'window', ?, ?)`).run(DAY, utc(15, 50), utc(15, 58));
  const d = await (await getCellDay({ stationId: 'table1', date: DAY, raw: '1' }, env, ms(17, 0))).json();
  assert.deepEqual(d.raw.scaleEvents, [{ ts: utc(9, 0), g: 12.3 }], 'only that Pacific day');
  assert.deepEqual([d.raw.scaleMarks.length, d.raw.scaleMarks[0].kind], [1, 'tare']);
  assert.deepEqual(d.raw.screenLog.map(r => r.phase), ['running']);
  assert.deepEqual(d.raw.eod.map(r => r.kind), ['window']);
  assert.ok(Array.isArray(d.raw.episodes));
  const plain = await (await getCellDay({ stationId: 'table1', date: DAY }, env, ms(17, 0))).json();
  assert.equal(plain.raw, undefined);
});

test('offline minutes count only inside the working window (first gram to last pickup); before and after are listed, not counted', async () => {
  const { raw, env } = d1();
  const ev = raw.prepare(`INSERT INTO scale_events (station_id, ts, weight_kg) VALUES ('table1', ?, ?)`);
  for (const [h, m, g] of [[7, 30, 0], [7, 40, 20], [9, 50, 227], [10, 20, 0.3], [10, 25, 30], [14, 0, 230]]) ev.run(utc(h, m), g / 1000);
  raw.prepare(`INSERT INTO scale_marks (station_id, ts, kind, kg) VALUES ('table1', ?, 'pickup', 0.227), ('table1', ?, 'pickup', 0.2)`).run(utc(10, 20, 1), utc(14, 1));
  const ep = raw.prepare(`INSERT INTO scale_episodes (station_id, kind, from_ts, to_ts) VALUES ('table1', 'offline', ?, ?)`);
  ep.run(utc(6, 10), utc(7, 25));     // off before anyone sat down
  ep.run(utc(11, 0), utc(11, 5));     // mid-job: a real gap
  ep.run(utc(14, 30), null);          // charging after the last pickup
  const d = await (await getCellDay({ stationId: 'table1', date: DAY }, env, ms(17, 0))).json();
  assert.deepEqual([d.gaps.offline.count, d.gaps.offline.minutes], [1, 5]);
  assert.deepEqual(d.gaps.offline.uncounted.map(e => e.minutes), [75, 100], '6:10-7:25, and 2:30-4:20 less the 2:30-2:40 break');
  assert.deepEqual([d.gaps.window.fromMs, d.gaps.window.toMs], [ms(7, 40), ms(14, 1)]);
});

test('a blend (no cultivar at 80% of the raw) is mixed', async () => {
  const { mainCultivar } = await import('../src/lib/cell-day.js');
  assert.deepEqual(mainCultivar([{ cultivar: 'A', lbs: 35 }, { cultivar: 'B', lbs: 18 }], []), { name: 'A', share: 0.66, mixed: true });
  assert.deepEqual(mainCultivar([{ cultivar: 'A', lbs: 35 }, { cultivar: 'B', lbs: 5 }], []), { name: 'A', share: 0.88, mixed: false });
  assert.deepEqual(mainCultivar([], []), { name: null, share: null, mixed: false });
});
