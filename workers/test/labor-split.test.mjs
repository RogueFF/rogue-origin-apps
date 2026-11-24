import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laborSplit, CELL_MODE_FROM, isCellSlot } from '../src/lib/labor-split.js';

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
  close(y.hours.bagger, m, 0.01);   // a cell day: one bagger/tagger per counted slot
  close(y.operatorHours, 166.53 + m);
});

test('cell days: T-Zero goes 100% to smalls; the water spider still splits by weight', () => {
  assert.ok(DAY >= CELL_MODE_FROM);
  const y = laborSplit(NOV10, { loadedRate: RATE });
  assert.equal(y.cellMode, true);
  const topsShare = 43 / 63;
  close(y.topsHours, y.hours.trimmer + y.hours.bagger + y.hours.spider * topsShare);
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

// Koa 2026-11-18: "Always will have a T-zero op to run smalls, and a Waterspider to
// feed raw goods. Same with Bagging/Tagging, is usually 1 person" -- the bagger on
// cell days only (Koa's pick), charged to tops.
const M = 0.95 + 1 + 1 + 1 + 0.5 + 1 + 0.83 + 1 + 0.33;   // the counted slots' real length
test('a cell day adds one bagger/tagger per counted slot, all on tops', () => {
  const y = laborSplit(NOV10, { loadedRate: RATE });
  close(y.hours.bagger, M);
  const without = laborSplit(NOV10, { loadedRate: RATE, baggers: 0 });
  assert.equal(without.hours.bagger, 0);
  close(y.operatorHours - without.operatorHours, M);
  close(y.topsHours - without.topsHours, M, 0.01);
  close(y.smallsHours, without.smallsHours);
  close(y.totalLaborCost - without.totalLaborCost, M * RATE);
  close(laborSplit(NOV10, { loadedRate: RATE, baggers: 2 }).hours.bagger, 2 * M);   // labor.bagger_count
});

test('a line day before 11/9 is unchanged: no bagger, same hours and cost as before', () => {
  const line = NOV10.map(r => ({ ...r, production_date: '2026-11-06' }));
  const y = laborSplit(line, { loadedRate: RATE });
  assert.equal(y.cellMode, false);
  assert.equal(y.hours.bagger, 0);
  close(y.operatorHours, 166.53);   // the 11/10 figure from before the bagger existed
  const topsShare = 43 / 63;
  close(y.topsHours, y.hours.trimmer + (y.hours.spider + y.hours.tzero) * topsShare);
  close(y.totalLaborCost, 166.53 * RATE, 0.1);
  // and the bagger count never reaches a line day
  assert.equal(laborSplit(line, { loadedRate: RATE, baggers: 3 }).hours.bagger, 0);
});

// Koa 2026-11-24: cells abandoned, back on the line from 11/24 12:30. Cell or line
// is per slot: an hour with buckers entered is a line hour (line rules: T-Zero
// shared by weight, no bagger); a no-bucker hour from 11/9 on keeps the cell rules.
const SPLIT = '2026-11-24';
const at = (date) => (time_slot, t, b, z, tops, smalls = 0) =>
  ({ production_date: date, time_slot, trimmers_line1: t, buckers_line1: b, tzero_line1: z, tops_lbs1: tops, smalls_lbs1: smalls });
const s24 = at(SPLIT);
const SPLIT_DAY = [
  s24('7:00 AM – 8:00 AM', 20, 0, 1, 10, 4),     // cells
  s24('8:00 AM – 9:00 AM', 20, 0, 1, 10, 0),     // cells
  s24('12:30 PM – 1:00 PM', 12, 8, 1, 6, 0),     // line from 12:30
  s24('1:00 PM – 2:00 PM', 12, 8, 1, 12, 6),     // line
];

test('isCellSlot: from 11/9, no buckers = cell hour; buckers entered = line hour', () => {
  assert.equal(isCellSlot('2026-11-24', 0), true);
  assert.equal(isCellSlot('2026-11-24', 8), false);
  assert.equal(isCellSlot('2026-11-06', 0), false, 'before 11/9 is always the line');
  assert.equal(isCellSlot('2026-11-24', 0, ''), false, 'no cell-mode date: never cells');
});

test('a split day: cell rules in the morning, line rules from 12:30', () => {
  const y = laborSplit(SPLIT_DAY, { loadedRate: RATE });
  assert.equal(y.heads.cellSlots, 2);
  assert.equal(y.heads.lineSlots, 2);
  assert.equal(y.cellMode, true, 'a split day still has cell hours');
  close(y.hours.bagger, 2, 0.001, 'one bagger for the two cell hours only');
  close(y.hours.tzero, 3.5, 0.001);
  close(y.hours.bucker, 12, 0.001);   // 8 × 0.5 + 8 × 1
  const topsShare = 38 / 48;
  // T-Zero: the cell morning (2 h) on smalls; the line afternoon (1.5 h) shared by weight
  const shared = y.hours.bucker + y.hours.spider + 1.5;
  close(y.topsHours, y.hours.trimmer + y.hours.bagger + shared * topsShare);
  close(y.smallsHours, shared * (1 - topsShare) + y.hours.inspector + 2);
  close(y.totalLaborCost, y.operatorHours * RATE);
});

test('a line-only day after 11/24: line rules throughout, as before 11/9', () => {
  const line = SPLIT_DAY.map((r) => ({ ...r, production_date: '2026-11-25', buckers_line1: 8 }));
  const y = laborSplit(line, { loadedRate: RATE, baggers: 3 });
  assert.equal(y.cellMode, false);
  assert.equal(y.heads.cellSlots, 0);
  assert.equal(y.hours.bagger, 0);
  // identical to the same rows on a pre-cell date
  const before = laborSplit(line.map((r) => ({ ...r, production_date: '2026-11-06' })), { loadedRate: RATE });
  close(y.topsHours, before.topsHours);
  close(y.smallsHours, before.smallsHours);
  close(y.totalLaborCost, before.totalLaborCost);
});
