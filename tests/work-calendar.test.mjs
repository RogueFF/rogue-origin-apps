/**
 * Unit tests for the work calendar.
 *
 * Ported from addWorkHours in apps-script/production-tracking/Code.gs:2230,
 * with one deliberate change: the original walks a Date and reads getHours(),
 * which returns Pacific in Apps Script but UTC in a Cloudflare Worker. Every
 * finish date would silently shift by the offset. This version does integer
 * arithmetic on a civil date and minutes-since-midnight, so it has no timezone
 * behaviour to get wrong.
 *
 * The schedule it encodes (CLAUDE.md, Break Schedule):
 *   Mon-Fri 07:00-16:30, Sat 07:00-12:00, Sun off
 *   breaks 09:00+10m, 12:00+30m, 14:30+10m, 16:20+10m
 *
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WORK_DAY,
  dayOfWeek,
  addDays,
  addWorkHours,
  workMinutesOnDay,
  hoursToWorkDays,
} from '../workers/src/lib/work-calendar.js';

const at = (date, h, m = 0) => ({ date, minutes: h * 60 + m });
const show = (p) => `${p.date} ${String(Math.floor(p.minutes / 60)).padStart(2, '0')}:${String(p.minutes % 60).padStart(2, '0')}`;

// 2026-08-20 is a Thursday; 08-22 Saturday; 08-23 Sunday; 08-24 Monday.
const THU = '2026-08-20';
const SAT = '2026-08-22';
const SUN = '2026-08-23';
const MON = '2026-08-24';

// --- calendar primitives -------------------------------------------------

test('day of week is computed without a timezone', () => {
  assert.equal(dayOfWeek(THU), 4);
  assert.equal(dayOfWeek(SAT), 6);
  assert.equal(dayOfWeek(SUN), 0);
  assert.equal(dayOfWeek(MON), 1);
});

test('adding days rolls month and year boundaries', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');  // leap year
});

test('a weekday yields 8.5 productive hours after breaks', () => {
  // 07:00-16:30 is 570 minutes; the four breaks remove 60.
  assert.equal(workMinutesOnDay(THU, WORK_DAY), 510);
});

test('Saturday is a half day and loses only the breaks that fall inside it', () => {
  // 07:00-12:00 is 300 minutes, minus the 09:00 ten-minute break.
  assert.equal(workMinutesOnDay(SAT, WORK_DAY), 290);
});

test('Sunday is not a work day', () => {
  assert.equal(workMinutesOnDay(SUN, WORK_DAY), 0);
});

// --- addWorkHours --------------------------------------------------------

test('adding no time returns the start untouched', () => {
  const r = addWorkHours(at(THU, 9), 0, WORK_DAY);
  assert.deepEqual(r, at(THU, 9));
});

test('an hour inside a clear stretch simply advances the clock', () => {
  assert.equal(show(addWorkHours(at(THU, 7), 1, WORK_DAY)), `${THU} 08:00`);
});

test('work pauses for the morning break and resumes after it', () => {
  // 08:30 + 1h: 30 min to 09:00, break to 09:10, then 30 more.
  assert.equal(show(addWorkHours(at(THU, 8, 30), 1, WORK_DAY)), `${THU} 09:40`);
});

test('the half-hour lunch is skipped, not worked through', () => {
  // 11:30 + 1h: 30 min to 12:00, lunch to 12:30, then 30 more.
  assert.equal(show(addWorkHours(at(THU, 11, 30), 1, WORK_DAY)), `${THU} 13:00`);
});

test('a start before the shift is pulled forward to the opening bell', () => {
  assert.equal(show(addWorkHours(at(THU, 5), 1, WORK_DAY)), `${THU} 08:00`);
});

test('a start after the shift rolls to the next morning', () => {
  assert.equal(show(addWorkHours(at(THU, 20), 1, WORK_DAY)), `2026-08-21 08:00`);
});

test('work that outruns the day continues the next morning', () => {
  // 16:00 Thu + 1h: 16:00-16:20 is 20 min, the cleanup break ends the day,
  // so the remaining 40 min land on Friday morning.
  assert.equal(show(addWorkHours(at(THU, 16), 1, WORK_DAY)), `2026-08-21 07:40`);
});

test('Saturday stops at noon and the remainder skips Sunday entirely', () => {
  // 11:00 Sat + 3h: one hour to noon, then Sunday is off, so two hours land on
  // Monday — 07:00 to 09:00 exactly, stopping at the lip of the morning break
  // rather than stepping over it, because the work is already done.
  assert.equal(show(addWorkHours(at(SAT, 11), 3, WORK_DAY)), `${MON} 09:00`);
});

test('a full weekday of work ends at 16:20, not the 16:30 closing bell', () => {
  // The shift is 07:00-16:30, but the last ten minutes are the cleanup break.
  // So a day holds 8.5 productive hours and the last of them is worked at
  // 16:20. Worth stating out loud: it is the kind of off-by-one-break that
  // would otherwise show up as an order finishing a day late.
  assert.equal(show(addWorkHours(at(THU, 7), 8.5, WORK_DAY)), `${THU} 16:20`);
});

test('more than a day of work accumulates across days', () => {
  // 8.5h fills Thursday, the next 8.5h fills Friday to its last worked minute.
  assert.equal(show(addWorkHours(at(THU, 7), 17, WORK_DAY)), `2026-08-21 16:20`);
});

test('a long run crosses a weekend without working through it', () => {
  // Thu + Fri = 17h, Sat adds 290 min (4.833h). 22h leaves 0.167h for Monday.
  const r = addWorkHours(at(THU, 7), 22, WORK_DAY);
  assert.equal(r.date, MON);
});

test('a start on Sunday waits for Monday', () => {
  assert.equal(show(addWorkHours(at(SUN, 9), 1, WORK_DAY)), `${MON} 08:00`);
});

test('negative hours are refused rather than walking the calendar backwards', () => {
  assert.throws(() => addWorkHours(at(THU, 9), -1, WORK_DAY), /hours/i);
});

// --- work-day conversion -------------------------------------------------

test('hours convert to whole work days for display', () => {
  assert.equal(hoursToWorkDays(8.5), 1);
  assert.equal(hoursToWorkDays(17), 2);
  assert.equal(hoursToWorkDays(1), 1);     // any work at all is a day on the board
  assert.equal(hoursToWorkDays(0), 0);
});
