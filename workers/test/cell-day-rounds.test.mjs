// Continuous rounds in cellDay (Koa 2026-11-11): the pickup timeline (when each
// round started, was picked up and was collected), changeovers between cultivars
// with the leftover weighed in them, and verified tops/sack per cultivar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { pickupTimeline, yieldByCultivar, cultivarKey } from '../src/lib/cell-day.js';
import { getCellDay } from '../src/handlers/production/cell-day.js';

const DAY = '2026-11-12';   // Thursday, PST (UTC-8)
const utc = (h, m, s = 0) => new Date(Date.UTC(2026, 10, 12, h + 8, m, s)).toISOString().slice(0, 19).replace('T', ' ');
const ms = (h, m, s = 0) => Date.UTC(2026, 10, 12, h + 8, m, s);
const A = '2026 - Sour Lifter / Sungrown', B = '2026 - Lifter / Sungrown';
const LB = 453.59237;

test('cultivarKey: the Shopify name and the sack scan name are the same raw', () => {
  assert.equal(cultivarKey(A), 'sour lifter');
  assert.equal(cultivarKey('Sour Lifter'), 'sour lifter');
  assert.equal(cultivarKey(null), '');
});

test('pickup timeline: round start from the screen log, wait to Collected, time between with lunch out', () => {
  const jobs = [
    { at: ms(11, 40), g: 410, cultivar: A, collectedAt: ms(11, 46) },
    { at: ms(12, 50), g: 430, cultivar: A, collectedAt: null },            // never tapped
    { at: ms(13, 20), g: 391, cultivar: A, collectedAt: ms(13, 48) },
  ];
  const log = [
    { ts: utc(11, 5), phase: 'running' }, { ts: utc(11, 20), phase: 'running' },   // a pause/resume: first one counts
    { ts: utc(11, 41), phase: 'armed' }, { ts: utc(12, 31), phase: 'running' },
    { ts: utc(12, 52), phase: 'running' },
  ];
  const { list, summary } = pickupTimeline(jobs, log);
  assert.deepEqual(list.map(p => [p.startedAt, p.collectedAt, p.sinceLastS, p.waitS]), [
    [ms(11, 5), ms(11, 46), null, 360],
    [ms(12, 31), null, (70 - 30) * 60, null],      // 11:40 -> 12:50 is 70 min, lunch 12:00-12:30 out
    [ms(12, 52), ms(13, 48), 30 * 60, 28 * 60],
  ]);
  assert.deepEqual(summary, {
    count: 3, totalG: 1231, avgG: 410.33,
    intervalAvgS: 35 * 60, intervalMaxS: 40 * 60, intervalMaxEndAt: ms(12, 50),
    waitAvgS: 17 * 60, waitMaxS: 28 * 60, waitMaxAt: ms(13, 20), uncollected: 1,
  });
  assert.deepEqual(Object.keys(list[0]).slice(0, 3), ['at', 'g', 'collectedAt'], 'the scorecard\'s field names');
});

test('per cultivar: A -> B -> A; only leftover weighed after a cultivar\'s last round counts', () => {
  const jobs = [
    { at: ms(8, 0), g: 400, cultivar: A }, { at: ms(8, 40), g: 420, cultivar: A },
    { at: ms(9, 30), g: 380, cultivar: B }, { at: ms(10, 15), g: 390, cultivar: B },
    { at: ms(11, 0), g: 300, cultivar: A },
  ];
  const sacks = [{ cultivar: 'Sour Lifter', lbs: 35 }, { cultivar: 'Sour Lifter', lbs: 35 }, { cultivar: 'Lifter', lbs: 35 }];
  const leftovers = [
    { cultivar: A, g: 1820.4, at: ms(8, 47) }, { cultivar: A, g: 912.1, at: ms(8, 48) },   // changeover 1: A came back later
    { cultivar: B, g: 5624.55, at: ms(10, 22) },                                          // changeover 2: bench, 12.4 lb
    { cultivar: A, g: 2000, at: ms(16, 25) },                                             // End of day
  ];
  const by = Object.fromEntries(yieldByCultivar({ jobs, sacks, leftovers }).map(c => [cultivarKey(c.cultivar), c]));
  const tA = Math.round((1120 / LB) * 100) / 100, tB = Math.round((770 / LB) * 100) / 100;
  assert.deepEqual([by['sour lifter'].rounds, by['sour lifter'].topsLb, by['sour lifter'].sacksLb, by['sour lifter'].leftoverLb], [3, tA, 70, 4.41]);
  assert.equal(by['sour lifter'].topsPerSack, Math.round((tA * 35 / (70 - 2000 / LB)) * 100) / 100);
  assert.deepEqual([by.lifter.rounds, by.lifter.topsLb, by.lifter.sacksLb, by.lifter.leftoverLb], [2, tB, 35, 12.4]);
  assert.equal(by.lifter.topsPerSack, Math.round((tB * 35 / (35 - 5624.55 / LB)) * 100) / 100);
  assert.equal(by['sour lifter'].cultivar, A, 'named as the screen names it');
  // B never weighed after its last round: not verified.
  const noB = Object.fromEntries(yieldByCultivar({ jobs, sacks, leftovers: leftovers.filter(l => l.cultivar !== B) }).map(c => [cultivarKey(c.cultivar), c]));
  assert.deepEqual([noB.lifter.verified, noB.lifter.topsPerSack, noB['sour lifter'].verified], [false, null, true]);
  // Untagged leftover rows (before 0063) belong to the day's last cultivar.
  const old = Object.fromEntries(yieldByCultivar({ jobs, sacks, leftovers: [{ cultivar: null, g: 2000, at: ms(16, 25) }] }).map(c => [cultivarKey(c.cultivar), c]));
  assert.deepEqual([old['sour lifter'].leftoverLb, old.lifter.verified], [4.41, false]);
});

// ---- one day with 2 changeovers, end to end ------------------------------------
const mig = name => readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8');
function d1({ with0063 = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE scale_readings (station_id TEXT PRIMARY KEY, weight REAL, target_weight REAL, unit TEXT, updated_at TEXT);`);
  db.exec(`CREATE TABLE harvest_sacks (sack_id TEXT PRIMARY KEY, serial INTEGER, season INTEGER, cultivar TEXT, fill_lbs REAL,
           opened_at TEXT, voided_at TEXT, is_test INTEGER NOT NULL DEFAULT 0);`);
  for (const m of ['0049-cell-table-stations', '0050-cell-hourly', '0051-cell-quality-checks', '0052-cell-job-order',
    '0053-scale-down-since', '0055-scale-node-battery', '0060-pickup-spot', '0062-cell-day']) db.exec(mig(m));
  // Migration 0063 (Continuous build, PR #177): the leftover-raw tags.
  if (with0063) db.exec(`ALTER TABLE cell_eod ADD COLUMN cultivar TEXT; ALTER TABLE cell_eod ADD COLUMN reason TEXT; ALTER TABLE cell_eod ADD COLUMN source TEXT;`);
  db.exec(`INSERT INTO scale_stations (station_id, label, kind, token_hash) VALUES ('table1', 'Cell 1', 'table', 'x');`);
  const stmt = (sql, p) => ({
    first: async () => db.prepare(sql).get(...p) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...p) }),
    run: async () => ({ meta: { changes: db.prepare(sql).run(...p).changes } }),
  });
  return { raw: db, env: { DB: { prepare: sql => ({ bind: (...p) => stmt(sql, p), ...stmt(sql, []) }) } } };
}

function seedDay(raw, { eodWeigh = true } = {}) {
  const ev = raw.prepare(`INSERT INTO scale_events (station_id, ts, weight_kg) VALUES ('table1', ?, ?)`);
  const mk = raw.prepare(`INSERT INTO scale_marks (station_id, ts, kind, kg, cultivar, bag, cycle_s, collected_at) VALUES ('table1', ?, 'pickup', ?, ?, 'cont', ?, ?)`);
  const log = raw.prepare(`INSERT INTO cell_screen_log (station_id, ts, phase, cultivar, bag) VALUES ('table1', ?, ?, ?, 'cont')`);
  // round(start, pickup, grams, cultivar, collected): trimming from 0.3 g, a lift, back about empty.
  const round = ([sh, sm], [ph, pm], g, cultivar, [ch, cm]) => {
    ev.run(utc(sh, sm), 0.0003); ev.run(utc(sh, sm + 1), 0.0003 + g / 2000); ev.run(utc(ph, pm - 1), (g + 0.3) / 1000);
    ev.run(utc(ph, pm, 0), -0.15); ev.run(utc(ph, pm, 30), 0.0003);
    log.run(utc(sh, sm + 1), 'running', cultivar);
    mk.run(utc(ph, pm, 32), (g + 0.3) / 1000, cultivar, ((ph - sh) * 60 + pm - sm) * 60, utc(ch, cm));
    log.run(utc(ph, pm, 33), 'armed', cultivar);
  };
  round([7, 30], [8, 0], 400, A, [8, 6]);
  round([8, 2], [8, 40], 420, A, [8, 44]);
  // Changeover 1, 8:41-8:56: A's leftover on the cell scale in two parts (its window keeps them out of tops).
  const eod = raw.prepare(`INSERT INTO cell_eod (station_id, production_date, kind, grams, batt_mv, ts, ended_at, cultivar, reason, source) VALUES ('table1', ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  eod.run(DAY, 'window', null, null, utc(8, 41), utc(8, 50), A, 'changeover', null);
  ev.run(utc(8, 44), 1.8204); ev.run(utc(8, 45), 0.0003); ev.run(utc(8, 46), 0.9121); ev.run(utc(8, 47), 0.0003);
  eod.run(DAY, 'raw', 1820.4, 3910, utc(8, 44, 10), null, A, 'changeover', 'scale');
  eod.run(DAY, 'raw', 912.1, 3905, utc(8, 46, 10), null, A, 'changeover', 'scale');
  round([8, 56], [9, 30], 380, B, [9, 35]);
  round([9, 32], [10, 15], 390, B, [10, 30]);
  // Changeover 2, 10:16-10:24: B's partial supersack typed from the bench scale (12.4 lb).
  eod.run(DAY, 'window', null, null, utc(10, 16), utc(10, 22), B, 'changeover', null);
  eod.run(DAY, 'raw', 5624.55, null, utc(10, 20), null, B, 'changeover', 'bench');
  round([10, 24], [11, 0], 300, A, [11, 9]);
  if (eodWeigh) {
    eod.run(DAY, 'window', null, null, utc(16, 22), utc(16, 30), null, 'eod', null);
    eod.run(DAY, 'raw', 2000, 3880, utc(16, 25), null, A, 'eod', 'scale');
    eod.run(DAY, 'tote', 455, 3880, utc(16, 26), null, null, 'eod', 'scale');
  }
  const sack = raw.prepare(`INSERT INTO harvest_sacks VALUES (?, ?, 2026, ?, NULL, ?, NULL, 0)`);
  const tick = raw.prepare(`INSERT INTO cell_sacks (production_date, sack_id, station_id) VALUES (?, ?, 'table1')`);
  for (const [id, n, c, at] of [['26-SL-1', 1, 'Sour Lifter', utc(7, 5)], ['26-SL-2', 2, 'Sour Lifter', utc(10, 23)], ['26-L-1', 3, 'Lifter', utc(8, 50)]]) {
    sack.run(id, n, c, at); tick.run(DAY, id);
  }
}

test('cellDay: a day with 2 changeovers (scale-weighed and bench-typed leftover)', async () => {
  const { raw, env } = d1();
  seedDay(raw);
  const d = await (await getCellDay({ stationId: 'table1', date: DAY }, env, ms(17, 0))).json();
  // Pickups: five rounds with their times.
  assert.deepEqual(d.pickups.map(p => [p.g, p.cultivar === A ? 'A' : 'B', p.startedAt, p.collectedAt]), [
    [400.3, 'A', ms(7, 31), ms(8, 6)], [420.3, 'A', ms(8, 3), ms(8, 44)],
    [380.3, 'B', ms(8, 57), ms(9, 35)], [390.3, 'B', ms(9, 33), ms(10, 30)], [300.3, 'A', ms(10, 25), ms(11, 9)],
  ]);
  assert.equal(d.pickupSummary.count, 5);
  assert.equal(d.pickupSummary.uncollected, 0);
  assert.equal(d.pickupSummary.waitMaxS, Math.round((ms(10, 30) - ms(10, 15, 32)) / 1000));
  // Changeovers: two between cultivars, each with the leftover weighed inside it.
  const cv = d.changeovers.list.filter(c => c.cultivarChange);
  assert.equal(d.changeovers.cultivarChanges, 2);
  assert.deepEqual(cv.map(c => [c.fromCultivar, c.toCultivar, c.leftoverG]), [[A, B, 2732.5], [B, A, 5624.55]]);
  assert.ok(cv.every(c => c.s > 0));
  // Per cultivar: A's changeover-1 leftover is superseded (A came back); End of day counts.
  const by = Object.fromEntries(d.yieldByCultivar.map(c => [cultivarKey(c.cultivar), c]));
  assert.deepEqual([by['sour lifter'].rounds, by['sour lifter'].sacksLb, by['sour lifter'].leftoverLb, by['sour lifter'].verified], [3, 70, 4.41, true]);
  assert.deepEqual([by.lifter.rounds, by.lifter.sacksLb, by.lifter.leftoverLb, by.lifter.verified], [2, 35, 12.4, true]);
  // The day: every leftover comes off the raw; End of day verifies it.
  assert.deepEqual(d.eod, { rawG: 10357.05, toteG: 455, changeoverRawG: 8357.05 });
  assert.equal(d.yield.usedLb, Math.round((105 - 10357.05 / LB) * 100) / 100);
  assert.notEqual(d.yield.topsPerSack, null);
  assert.equal(d.battery.mv, 3880, 'battery from the End of day weigh, never a changeover weigh');
  // Hourly tops: the changeover weighs never count.
  assert.ok(Math.abs(d.tops.lb - Math.round(((400 + 420 + 380 + 390 + 300) / LB) * 100) / 100) <= 0.03, String(d.tops.lb));
});

test('cellDay: changeover weighs alone never verify the day (it needs the End of day weigh)', async () => {
  const { raw, env } = d1();
  seedDay(raw, { eodWeigh: false });
  const d = await (await getCellDay({ stationId: 'table1', date: DAY }, env, ms(17, 0))).json();
  assert.equal(d.eod.rawG, null);
  assert.equal(d.yield.topsPerSack, null);
  assert.equal(d.eod.changeoverRawG, 8357.05);
  assert.equal(d.battery, null, 'a changeover weigh is mid-shift, not the End of day battery');
  const by = Object.fromEntries(d.yieldByCultivar.map(c => [cultivarKey(c.cultivar), c]));
  assert.deepEqual([by.lifter.verified, by['sour lifter'].verified], [true, false], 'B was weighed after its last round; A was not');
});

test('cellDay before 0063: still loads; leftovers count untagged', async () => {
  const { raw, env } = d1({ with0063: false });
  raw.prepare(`INSERT INTO scale_marks (station_id, ts, kind, kg, cultivar, bag) VALUES ('table1', ?, 'pickup', 0.4, ?, 'cont')`).run(utc(9, 0), A);
  raw.prepare(`INSERT INTO cell_eod (station_id, production_date, kind, grams, ts) VALUES ('table1', ?, 'raw', 2000, ?)`).run(DAY, utc(16, 25));
  const r = await getCellDay({ stationId: 'table1', date: DAY }, env, ms(17, 0));
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.deepEqual([d.eod.rawG, d.eod.changeoverRawG, d.pickups.length, d.yieldByCultivar[0].leftoverLb], [2000, 0, 1, 4.41]);
});
