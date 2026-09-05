/**
 * Scoreboard v3 pace math, pinned against the 2026-09-02 shift.
 *
 * The board's promise is that the fill, the plan tick, the hour dividers and
 * the end-of-day marker all sit on one axis (the day goal in pounds). These
 * tests hold that promise and the dial/column arithmetic behind it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSlot,
  parseClock,
  slotBounds,
  slotElapsedFraction,
  daySegments,
  planNowFraction,
  hourExpectedNow,
  hourSoFarLbs,
  bagExpectedGrams,
  bagLandsAtSec,
  realizedRate,
  needleAngle,
  arcFractionFromOffset,
  wedgePath,
} from '../src/js/scoreboard-v3/pace-math.js';

// Completed hours through 1–2 PM on 2026-09-02, as the scoreboard action returns them
// (including the mojibake dash the live API ships).
const RATE = 1.0909878522645917;
const ROWS = [
  { timeSlot: '7:01 AM â€“ 8:00 AM', rate: 1.288, target: 1.1133936186230378, trimmers: 13, effectiveTrimmers: 13.5, lbs: 17.1, multiplier: 0.9833333333333333 },
  { timeSlot: '8:00 AM â€“ 9:00 AM', rate: 0.951, target: 1.1189760930747839, trimmers: 12, effectiveTrimmers: 12.2, lbs: 11.6, multiplier: 1 },
  { timeSlot: '9:00 AM â€“ 10:00 AM', rate: 0.923, target: 1.1189760930747839, trimmers: 14, effectiveTrimmers: 13.7, lbs: 10.5, multiplier: 0.83 },
  { timeSlot: '10:00 AM â€“ 11:00 AM', rate: 0.955, target: 1.1189760930747839, trimmers: 16, effectiveTrimmers: 15.6, lbs: 14.9, multiplier: 1 },
  { timeSlot: '11:00 AM â€“ 12:00 PM', rate: 0.925, target: 1.1189760930747839, trimmers: 16, effectiveTrimmers: 16, lbs: 14.8, multiplier: 1 },
  { timeSlot: '12:30 PM â€“ 1:00 PM', rate: 0.623, target: 1.1189760930747839, trimmers: 15, effectiveTrimmers: 15.1, lbs: 4.7, multiplier: 0.5 },
  { timeSlot: '1:00 PM â€“ 2:00 PM', rate: 1.0, target: 1.0513030643116943, trimmers: 16, effectiveTrimmers: 16, lbs: 16, multiplier: 1 },
];
const TODAY_TARGET = ROWS.reduce((a, r) => a + r.effectiveTrimmers * r.target * r.multiplier, 0);
const CURRENT_SLOT = '2:00 PM – 3:00 PM';
const CURRENT_TARGET = 17 * RATE * 0.83;
const DAILY_GOAL = 143;
const NOW = 14 * 60 + 41; // 2:41 PM

test('slot labels parse whichever dash the API sends', () => {
  assert.equal(normalizeSlot('4:00 PM â€“ 4:30 PM'), '4:00 PM – 4:30 PM');
  assert.equal(normalizeSlot('4:00 PM - 4:30 PM'), '4:00 PM – 4:30 PM');
  assert.equal(parseClock('7:01 AM'), 421);
  assert.equal(parseClock('12:30 PM'), 750);
  assert.equal(parseClock('12:05 AM'), 5);
  assert.deepEqual(slotBounds('12:30 PM – 1:00 PM'), { start: 750, end: 780 });
  assert.equal(slotBounds('nonsense'), null);
});

test('elapsed fraction clamps outside the slot', () => {
  assert.equal(slotElapsedFraction(CURRENT_SLOT, 14 * 60), 0);
  assert.ok(Math.abs(slotElapsedFraction(CURRENT_SLOT, NOW) - 41 / 60) < 1e-9);
  assert.equal(slotElapsedFraction(CURRENT_SLOT, 16 * 60), 1);
});

test('day segments cover the goal exactly and land the plan tick inside the current hour', () => {
  const segs = daySegments({ hourlyRates: ROWS, currentSlot: CURRENT_SLOT, currentHourTarget: CURRENT_TARGET, dailyGoal: DAILY_GOAL });
  assert.equal(segs.length, 10);
  assert.equal(segs[0].frac0, 0);
  assert.ok(Math.abs(segs[9].frac1 - 1) < 1e-9);
  for (let i = 1; i < segs.length; i++) assert.ok(segs[i].frac0 >= segs[i - 1].frac0);
  assert.deepEqual(segs.map((s) => s.state), ['done', 'done', 'done', 'done', 'done', 'done', 'done', 'current', 'future', 'future']);

  // The 7:01 first slot still matches the canonical 7–8 row.
  assert.ok(Math.abs((segs[0].frac1 - segs[0].frac0) * DAILY_GOAL - 13.5 * 1.1133936186230378 * 0.9833333333333333) < 1e-6);

  const plan = planNowFraction({ todayTarget: TODAY_TARGET, currentHourTarget: CURRENT_TARGET, currentSlot: CURRENT_SLOT, nowMin: NOW, dailyGoal: DAILY_GOAL });
  const cur = segs[7];
  assert.ok(plan > cur.frac0 && plan < cur.frac1, `plan ${plan} should sit inside the 2–3 segment [${cur.frac0}, ${cur.frac1}]`);
  // 41 minutes into the hour = 41/60 of the way across that segment.
  assert.ok(Math.abs((plan - cur.frac0) / (cur.frac1 - cur.frac0) - 41 / 60) < 1e-9);
});

test('future slots share the remaining goal by multiplier', () => {
  const segs = daySegments({ hourlyRates: ROWS, currentSlot: CURRENT_SLOT, currentHourTarget: CURRENT_TARGET, dailyGoal: DAILY_GOAL });
  const w3 = segs[8].frac1 - segs[8].frac0; // 3–4 PM, mult 1.0
  const w4 = segs[9].frac1 - segs[9].frac0; // 4–4:30 PM, mult 0.33
  assert.ok(Math.abs(w3 / w4 - 1 / 0.33) < 1e-6);
  const remaining = DAILY_GOAL - TODAY_TARGET - CURRENT_TARGET;
  assert.ok(Math.abs((w3 + w4) * DAILY_GOAL - remaining) < 1e-6);
});

test('before the first row the bar still reads as a day', () => {
  const segs = daySegments({ hourlyRates: [], currentSlot: '', currentHourTarget: 0, dailyGoal: 0 });
  assert.equal(segs.length, 10);
  assert.ok(Math.abs(segs[9].frac1 - 1) < 1e-9);
  assert.equal(planNowFraction({ dailyGoal: 0 }), 0);
});

test('plan is the whole goal once the shift has ended', () => {
  assert.equal(planNowFraction({ todayTarget: 143.29, currentHourTarget: 0, currentSlot: '', nowMin: 21 * 60, dailyGoal: 141.87, shiftEnded: true }), 1);
});

test('hour so far counts bags inside the slot plus what is on the scale', () => {
  const bagMinutes = [13 * 60 + 7, 13 * 60 + 53, 14 * 60 + 20]; // 1:07, 1:53, 2:20
  const lbs = hourSoFarLbs({ bagMinutes, bagLbs: 10, scaleGrams: 3333, scaleStale: false, currentSlot: CURRENT_SLOT });
  assert.ok(Math.abs(lbs - (10 + 3333 / 453.592)) < 1e-9);
  assert.equal(hourSoFarLbs({ bagMinutes, bagLbs: 10, scaleGrams: 3333, scaleStale: true, currentSlot: CURRENT_SLOT }), 10);
  assert.equal(hourSoFarLbs({ bagMinutes, currentSlot: '' }), 0);

  // A bag that started at 1:53 and is weighed at 2:41 gives this hour 41 of its 48 minutes.
  const shared = hourSoFarLbs({ bagMinutes: [], bagLbs: 10, scaleGrams: 3333, scaleStale: false, currentSlot: CURRENT_SLOT, bagStartMin: 13 * 60 + 53, nowMin: NOW });
  assert.ok(Math.abs(shared - (3333 / 453.592) * (41 / 48)) < 1e-9);
  // A bag that started inside the hour is credited whole.
  const own = hourSoFarLbs({ bagMinutes: [], bagLbs: 10, scaleGrams: 3333, scaleStale: false, currentSlot: CURRENT_SLOT, bagStartMin: 14 * 60 + 5, nowMin: NOW });
  assert.ok(Math.abs(own - 3333 / 453.592) < 1e-9);
  const expected = hourExpectedNow({ currentHourTarget: CURRENT_TARGET, currentSlot: CURRENT_SLOT, nowMin: NOW });
  assert.ok(Math.abs(expected - CURRENT_TARGET * (41 / 60)) < 1e-9);
});

test('bag dial: expected grams follow the clock and landing time follows the fill rate', () => {
  const target = 26 * 60 + 11;
  const elapsed = 22 * 60 + 41;
  const expected = bagExpectedGrams(elapsed, target, 4536);
  assert.ok(Math.abs(expected - 4536 * (elapsed / target)) < 1e-9);
  assert.equal(bagExpectedGrams(target * 2, target, 4536), 4536);
  const lands = bagLandsAtSec(elapsed, 3333, 4536);
  assert.ok(Math.abs(lands - elapsed * (4536 / 3333)) < 1e-9);
  assert.equal(bagLandsAtSec(elapsed, 0, 4536), null);
});

test('realised rate and needle', () => {
  const rate = realizedRate(ROWS);
  const lbs = ROWS.reduce((a, r) => a + r.lbs, 0);
  const hours = ROWS.reduce((a, r) => a + r.effectiveTrimmers * r.multiplier, 0);
  assert.ok(Math.abs(rate - lbs / hours) < 1e-12);
  assert.equal(needleAngle(1.09, 1.09), 0);
  assert.ok(needleAngle(0.93, 1.09) < 0);
  assert.equal(needleAngle(3, 1), 90);
  assert.equal(needleAngle(0, 1), -90);
  assert.equal(needleAngle(1, 0), 0);
});

test('ring offsets read back as fractions and the wedge sits between the two tips', () => {
  assert.ok(Math.abs(arcFractionFromOffset('86.7px', 647) - (1 - 86.7 / 647)) < 1e-9);
  assert.equal(arcFractionFromOffset('', 647), 0);
  assert.equal(wedgePath(120, 120, 101, 82, 0.5, 0.5), '');
  const d = wedgePath(120, 120, 101, 82, 0.735, 0.866);
  assert.match(d, /^M .* A 101 101 0 0 1 .* L .* A 82 82 0 0 0 .* Z$/);
  // The order of the two fractions does not matter.
  assert.equal(d, wedgePath(120, 120, 101, 82, 0.866, 0.735));
  // A wedge wider than half the ring takes the large-arc flag.
  assert.match(wedgePath(120, 120, 101, 82, 0.1, 0.8), / A 101 101 0 1 1 /);
});
