/**
 * The bag timer's break-and-shift arithmetic, pinned against wall-clock times.
 *
 * Every case builds `now` with `new Date(2026, 8, 2, h, m, s)` (local time,
 * per the phase 1 spec) rather than parsing an ISO string, so the assertions
 * are immune to the runner's timezone. 2026-09-02 is a plain Wednesday with
 * no daylight-saving edge nearby.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TIMER_BREAKS,
  WORKDAY_START_MINUTES,
  WORKDAY_END_MINUTES,
  isOnBreakOrAfterHours,
  getWorkingSecondsSinceInternal,
  getWorkingSecondsCarryOver,
  getWorkingSecondsSince,
  timerReading,
} from '../src/js/floor/clock.js';

const at = (h, m = 0, s = 0) => new Date(2026, 8, 2, h, m, s);
const yesterdayAt = (h, m = 0, s = 0) => new Date(2026, 8, 1, h, m, s);

test('workday and break constants match the legacy schedule', () => {
  assert.equal(WORKDAY_START_MINUTES, 7 * 60);
  assert.equal(WORKDAY_END_MINUTES, 16 * 60 + 30);
  assert.deepEqual(TIMER_BREAKS, [
    [9, 0, 9, 10],
    [12, 0, 12, 30],
    [14, 30, 14, 40],
    [16, 20, 16, 30],
  ]);
});

test('isOnBreakOrAfterHours flags the lunch window and the closed hours', () => {
  assert.deepEqual(isOnBreakOrAfterHours(at(12, 15)), { onBreak: true, afterHours: false });
  assert.deepEqual(isOnBreakOrAfterHours(at(12, 0)), { onBreak: true, afterHours: false }); // inclusive start
  assert.deepEqual(isOnBreakOrAfterHours(at(12, 29, 59)), { onBreak: true, afterHours: false });
  assert.deepEqual(isOnBreakOrAfterHours(at(12, 30)), { onBreak: false, afterHours: false }); // exclusive end
  assert.deepEqual(isOnBreakOrAfterHours(at(6, 59)), { onBreak: true, afterHours: true });
  assert.deepEqual(isOnBreakOrAfterHours(at(16, 30)), { onBreak: true, afterHours: true });
  assert.deepEqual(isOnBreakOrAfterHours(at(11, 0)), { onBreak: false, afterHours: false });
});

test('a completed break is subtracted from the elapsed span', () => {
  // 8:50 -> 9:20 spans the whole 9:00-9:10 break; only the 20 working
  // minutes either side of it should count.
  const seconds = getWorkingSecondsSinceInternal(at(8, 50), at(9, 20));
  assert.equal(seconds, 20 * 60);
});

test('a break with no overlap leaves the span untouched', () => {
  const seconds = getWorkingSecondsSinceInternal(at(10, 0), at(10, 30));
  assert.equal(seconds, 30 * 60);
});

test('after hours the elapsed time freezes at 4:20 PM (cleanup start)', () => {
  const atClose = getWorkingSecondsSinceInternal(at(15, 0), at(16, 20));
  const wellAfter = getWorkingSecondsSinceInternal(at(15, 0), at(18, 0));
  assert.equal(atClose, wellAfter, 'reading an hour later must not move the freeze point');
  // 15:00 -> 16:20 is 80 minutes, minus the 14:30-14:40 break does not
  // overlap (it ends before 15:00 starts), so nothing else is subtracted.
  assert.equal(atClose, 80 * 60);
});

test('before the workday starts, the afterHours branch also freezes at 4:20 (a legacy quirk, ported as-is)', () => {
  // now (6:30, before the 7:00 open) is "after hours" by the same nowMins
  // check that catches the close of day, so endTime is pinned to 16:20 same
  // as the post-close case. A 6:00-16:20 span is 620 minutes, minus the
  // three completed breaks that fall inside it (10 + 30 + 10 = 50 minutes);
  // the 4:20-4:30 cleanup break itself is excluded because endMins (980)
  // does not exceed its start (980) under the strict '>' overlap check.
  const seconds = getWorkingSecondsSinceInternal(at(6, 0), at(6, 30));
  assert.equal(seconds, 570 * 60);
});

test('carryover from yesterday adds what was left of yesterday to today so far', () => {
  // Bag started 3:50 PM yesterday: 40 minutes remained in yesterday's shift,
  // minus the 10 minutes of the 4:20-4:30 cleanup break that falls inside
  // it, leaving 30 working minutes carried over. Today opens at 7:00 and
  // "now" is 7:30, adding 30 more.
  const seconds = getWorkingSecondsCarryOver(yesterdayAt(15, 50), at(7, 30));
  assert.equal(seconds, 60 * 60);
});

test('getWorkingSecondsSince dispatches to carryover only across a day boundary', () => {
  const sameDay = getWorkingSecondsSince(at(10, 0), at(10, 30));
  assert.equal(sameDay, 30 * 60);

  const acrossDays = getWorkingSecondsSince(yesterdayAt(15, 50), at(7, 30));
  assert.equal(acrossDays, getWorkingSecondsCarryOver(yesterdayAt(15, 50), at(7, 30)));
});

test('timerReading: waiting when there is no bag and no shift start', () => {
  const reading = timerReading({ lastBagTime: null, shiftStart: null, now: at(9, 30) });
  assert.deepEqual(reading, { kind: 'waiting', seconds: 0, progress: 0, elapsedSeconds: 0 });
});

test('timerReading: break kind during 12:00-12:30, frozen off the last bag', () => {
  // Bag logged at 11:50; by 12:15 (mid-lunch) elapsed working time is frozen
  // at the 12:00 break start: 10 minutes elapsed, not 25.
  const reading = timerReading({
    lastBagTime: at(11, 50),
    targetSeconds: 20 * 60,
    shiftStart: null,
    now: at(12, 15),
  });
  assert.equal(reading.kind, 'break');
  assert.equal(reading.elapsedSeconds, 10 * 60);
  assert.equal(reading.seconds, 10 * 60); // target 20min - elapsed 10min remaining, frozen
});

test('timerReading: break kind with no bag logged yet shows a zeroed reading', () => {
  const reading = timerReading({ lastBagTime: null, targetSeconds: 600, shiftStart: at(7, 0), now: at(12, 10) });
  assert.deepEqual(reading, { kind: 'break', seconds: 0, progress: 0, elapsedSeconds: 0 });
});

test('timerReading: ended (after hours) freezes the remaining time at 4:20', () => {
  const reading = timerReading({
    lastBagTime: at(15, 0),
    targetSeconds: 100 * 60, // 100 minutes
    shiftStart: null,
    now: at(17, 0),
  });
  assert.equal(reading.kind, 'ended');
  assert.equal(reading.elapsedSeconds, 80 * 60); // frozen at 16:20, same as the getWorkingSecondsSinceInternal case above
  assert.equal(reading.seconds, 20 * 60); // 100 - 80 minutes remaining
});

test('timerReading: overtime carries the absolute value and a distinct kind', () => {
  const reading = timerReading({
    lastBagTime: at(10, 0),
    targetSeconds: 10 * 60,
    shiftStart: null,
    now: at(10, 20),
  });
  assert.equal(reading.kind, 'overtime');
  assert.equal(reading.elapsedSeconds, 20 * 60);
  assert.equal(reading.seconds, 10 * 60); // |600 - 1200| = 600, always positive
  assert.equal(reading.progress, 1);
});

test('timerReading: remaining counts down toward the target with progress in [0,1]', () => {
  const reading = timerReading({
    lastBagTime: at(10, 0),
    targetSeconds: 20 * 60,
    shiftStart: null,
    now: at(10, 5),
  });
  assert.equal(reading.kind, 'remaining');
  assert.equal(reading.elapsedSeconds, 5 * 60);
  assert.equal(reading.seconds, 15 * 60);
  assert.equal(reading.progress, 0.25);
});

test('timerReading: elapsed kind when there is no target at all', () => {
  const reading = timerReading({
    lastBagTime: at(10, 0),
    targetSeconds: 0,
    shiftStart: null,
    now: at(10, 5),
  });
  assert.deepEqual(reading, { kind: 'elapsed', seconds: 5 * 60, progress: 0, elapsedSeconds: 5 * 60 });
});

test('timerReading: falls back to shiftStart when no bag has been logged yet today', () => {
  const reading = timerReading({
    lastBagTime: null,
    targetSeconds: 30 * 60,
    shiftStart: at(7, 0),
    now: at(7, 20),
  });
  assert.equal(reading.kind, 'remaining');
  assert.equal(reading.elapsedSeconds, 20 * 60);
  assert.equal(reading.seconds, 10 * 60);
});

test('timerReading: carryover applies when the reference time was yesterday', () => {
  const reading = timerReading({
    lastBagTime: yesterdayAt(15, 50),
    targetSeconds: 90 * 60,
    shiftStart: null,
    now: at(7, 30),
  });
  assert.equal(reading.elapsedSeconds, 60 * 60); // same carryover total pinned above
  assert.equal(reading.kind, 'remaining');
  assert.equal(reading.seconds, 30 * 60);
});
