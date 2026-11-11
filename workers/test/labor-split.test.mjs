import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laborSplit, CELL_MODE_FROM } from '../src/lib/labor-split.js';

// 2026-11-10 as logged (live D1): one row per slot.
const DAY = '2026-11-10';
const row = (time_slot, t, z, tops, smalls = 0, b = 0) =>
  ({ production_date: DAY, time_slot, trimmers_line1: t, buckers_line1: b, tzero_line1: z, tops_lbs1: tops, smalls_lbs1: smalls });
const NOV10 = [
  row('7:00 AM – 8:00 AM', 21, 1, 0),          // no tops: not counted
  row('7:03 AM – 8:00 AM', 24, 1, 8.3, 10),
  row('8:00 AM – 9:00 AM', 24, 1, 7.1),
  row('9:00 AM – 10:00 AM', 0, 1, 0),           // training meeting
  row('10:00 AM – 11:00 AM', 23, 1, 7.7),
  row('11:00 AM – 12:00 PM', 20, 1, 5.8, 10),
  row('12:30 PM – 1:00 PM', 15, 1, 2.7),
  row('1:00 PM – 2:00 PM', 13, 1, 3.5),
  row('2:00 PM – 3:00 PM', 13, 1, 2.8),
  row('3:00 PM – 4:00 PM', 17, 1, 3.9),
  row('4:00 PM – 4:30 PM', 17, 1, 1.2),
];
const RATE = 10;   // synthetic $/person-hr; the real one lives in D1 only
const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('each slot counts for its real length, not a full hour (11/10: 193 -> 166.5)', () => {
  const y = laborSplit(NOV10, { loadedRate: RATE });
  // full hours would be 166 trim + 9 T-Zero + 9 water spider + 9 inspector = 193
  assert.equal(y.heads.trimmers + y.heads.tzero + 2 * y.heads.slots, 193);
  const m = 0.95 + 1 + 1 + 1 + 0.5 + 1 + 0.83 + 1 + 0.33;   // 7:03 start = 57 min
  close(y.hours.trimmer, 24 * 0.95 + 24 + 23 + 20 + 15 * 0.5 + 13 + 13 * 0.83 + 17 + 17 * 0.33);
  close(y.hours.tzero, m);
  close(y.hours.spider, m);
  close(y.hours.inspector, m);
  close(y.operatorHours, 166.53);
});

test('cell days: T-Zero goes 100% to smalls; the water spider still splits by weight', () => {
  assert.ok(DAY >= CELL_MODE_FROM);
  const y = laborSplit(NOV10, { loadedRate: RATE });
  assert.equal(y.cellMode, true);
  const topsShare = 43 / 63;
  close(y.topsHours, y.hours.trimmer + y.hours.spider * topsShare);
  close(y.smallsHours, y.hours.spider * (1 - topsShare) + y.hours.inspector + y.hours.tzero);
  close(y.topsCostPerLb, (y.topsHours * RATE) / 43);
  close(y.smallsCostPerLb, (y.smallsHours * RATE) / 20);
  close(y.totalLaborCost, y.operatorHours * RATE);
});

test('line days keep the T-Zero weight split', () => {
  const line = NOV10.map(r => ({ ...r, production_date: '2026-11-06' }));
  const y = laborSplit(line, { loadedRate: RATE });
  assert.equal(y.cellMode, false);
  const topsShare = 43 / 63;
  close(y.topsHours, y.hours.trimmer + (y.hours.spider + y.hours.tzero) * topsShare);
  close(y.smallsHours, (y.hours.spider + y.hours.tzero) * (1 - topsShare) + y.hours.inspector);
});

test('config overrides: cell-mode date, inspector count, slot table', () => {
  const y = laborSplit(NOV10, { loadedRate: RATE, cellModeFrom: '2026-12-01', inspectors: 2, multipliers: { '8:00 AM – 9:00 AM': 0.5 } });
  assert.equal(y.cellMode, false);
  close(y.hours.inspector, 2 * y.hours.spider);
  // a slot missing from the table falls back to its parsed length (10-11 = 1 h); 8-9 uses the table
  close(y.hours.trimmer - (24 * 0.95 + 23 + 20 + 15 * 0.5 + 13 + 13 * 0.83 + 17 + 17 * 0.33), 24 * 0.5, 0.2);
});

test('no rows, or nothing counted, costs nothing', () => {
  assert.equal(laborSplit([], { loadedRate: RATE }).totalLaborCost, 0);
  const y = laborSplit([row('9:00 AM – 10:00 AM', 0, 1, 0, 5)], { loadedRate: RATE });
  assert.equal(y.operatorHours, 0);
  assert.equal(y.smallsCostPerLb, 0);
});
