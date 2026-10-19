import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  pacificDate, pacificClock, lastCompleteWeek, weekRange, weekDates, slotLabel, slotEnd, weekdayName, shortWeekday,
  isYmd, addDaysYmd, priorWeekday, rangeLabel, monthDay, slotMinutes, slotClock, slotSpan,
} from '../src/periods.js';

const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

test('pacificDate renders a UTC instant as a Pacific YYYY-MM-DD', () => {
  assert.equal(pacificDate(new Date('2026-10-20T03:30:00Z')), '2026-10-19'); // 8:30 PM PDT Oct 19
  assert.equal(pacificDate(new Date('2026-10-19T13:10:00Z')), '2026-10-19');
});

test('weekRange maps an ISO week to its Monday..Friday', () => {
  assert.deepEqual(weekRange('2026-W42'), { start: '2026-10-12', end: '2026-10-16', week: 42, year: 2026 });
  assert.throws(() => weekRange('2026-W99'), /week/);
  assert.throws(() => weekRange('garbage'), /week/);
});

test('weekRange handles week 1 across a year boundary and rejects a missing week 53', () => {
  // 2026-01-01 is a Thursday, so ISO 2026-W01 starts Monday 2025-12-29.
  assert.deepEqual(weekRange('2026-W01'), { start: '2025-12-29', end: '2026-01-02', week: 1, year: 2026 });
  assert.deepEqual(weekRange('2026-W53'), { start: '2026-12-28', end: '2027-01-01', week: 53, year: 2026 });
  assert.throws(() => weekRange('2025-W53'), /week/); // 2025 has only 52 ISO weeks
  assert.throws(() => weekRange('2026-W00'), /week/);
});

test('lastCompleteWeek is the previous Mon–Fri on Mon–Sun alike', () => {
  assert.equal(lastCompleteWeek('2026-10-19'), '2026-W42'); // a Monday
  assert.equal(lastCompleteWeek('2026-10-17'), '2026-W42'); // Saturday after W42
  assert.equal(lastCompleteWeek('2026-10-16'), '2026-W41'); // Friday still inside W42
});

test('lastCompleteWeek crosses the ISO year boundary', () => {
  assert.equal(lastCompleteWeek('2026-01-05'), '2026-W01'); // Monday of W02 → W01 (Dec 29 – Jan 2)
  assert.equal(lastCompleteWeek('2026-01-02'), '2025-W52'); // Friday of 2026-W01 → the week before
  assert.equal(lastCompleteWeek('2027-01-02'), '2026-W53'); // Saturday after 2026's week 53
});

test('slot labels and ends', () => {
  assert.equal(slotLabel('7:00 AM – 8:00 AM'), '7');
  assert.equal(slotLabel('12:30 PM – 1:00 PM'), '12½');
  assert.equal(slotLabel('4:00 PM – 4:30 PM'), '4');
  assert.equal(slotEnd('12:30 PM – 1:00 PM'), '13:00');
  assert.equal(slotEnd('11:00 AM – 12:00 PM'), '12:00');
});

test('slot helpers parse the exact API strings (en dash) and hyphens alike', () => {
  const slots = fixture('scoreboard-2026-10-16.json').scoreboard.hourlyRates.map((h) => h.timeSlot);
  assert.deepEqual(slots.map(slotLabel), ['7', '8', '9', '10', '11', '12½', '1', '2', '3', '4']);
  assert.deepEqual(slots.map(slotEnd), ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '16:30']);
  assert.equal(slotLabel('9:00 AM - 10:00 AM'), '9');
  assert.equal(slotEnd('9:00 AM - 10:00 AM'), '10:00');
});

test('weekdayName', () => {
  assert.equal(weekdayName('2026-10-16'), 'Friday');
  assert.equal(weekdayName('2026-10-19'), 'Monday');
});

test('weekRange accepts a lowercase w', () => {
  assert.deepEqual(weekRange('2026-w42'), { start: '2026-10-12', end: '2026-10-16', week: 42, year: 2026 });
});

test('slotLabel and slotEnd return null for an unreadable slot', () => {
  for (const bad of ['', 'garbage', null, undefined]) {
    assert.equal(slotLabel(bad), null);
    assert.equal(slotEnd(bad), null);
  }
  assert.equal(slotEnd('7:00 AM'), null); // a start with no end
});

test('isYmd is true only for a real calendar date in YYYY-MM-DD', () => {
  assert.equal(isYmd('2026-10-16'), true);
  assert.equal(isYmd('2028-02-29'), true);
  for (const bad of ['2026-02-29', '2026-13-01', '2026-10-32', '2026-1-16', '20261016', '2026-10-16T00:00', '', null, undefined, 20261016]) {
    assert.equal(isYmd(bad), false, String(bad));
  }
});

test('addDaysYmd moves by calendar days across months, years and DST', () => {
  assert.equal(addDaysYmd('2026-10-16', 3), '2026-10-19');
  assert.equal(addDaysYmd('2026-10-01', -1), '2026-09-30');
  assert.equal(addDaysYmd('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysYmd('2026-10-31', 2), '2026-11-02'); // over the Nov 1 DST change
  assert.equal(addDaysYmd('2026-10-16', 0), '2026-10-16');
  assert.throws(() => addDaysYmd('garbage', 1), /date/);
});

test('priorWeekday is the previous Mon–Fri date', () => {
  assert.equal(priorWeekday('2026-10-19'), '2026-10-16'); // Monday → the Friday before
  assert.equal(priorWeekday('2026-10-16'), '2026-10-15'); // Friday → Thursday
  assert.equal(priorWeekday('2026-10-13'), '2026-10-12'); // Tuesday → Monday
  assert.equal(priorWeekday('2026-10-17'), '2026-10-16'); // Saturday → Friday
  assert.equal(priorWeekday('2026-10-18'), '2026-10-16'); // Sunday → Friday
});

test('weekDates lists the five Mon–Fri dates of an ISO week', () => {
  assert.deepEqual(weekDates('2026-W42'), ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
  assert.deepEqual(weekDates('2026-W01'), ['2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02']);
  assert.throws(() => weekDates('2026-W99'), /week/);
});

test('rangeLabel', () => {
  assert.equal(rangeLabel('2026-10-12', '2026-10-16'), 'Oct 12–16, 2026');
  assert.equal(rangeLabel('2026-09-28', '2026-10-02'), 'Sep 28–Oct 2, 2026');
  assert.equal(rangeLabel('2025-12-29', '2026-01-02'), 'Dec 29, 2025–Jan 2, 2026');
  assert.equal(rangeLabel('2026-10-16', '2026-10-16'), 'Oct 16, 2026');
});

test('rangeLabel throws when the end is before the start', () => {
  assert.throws(() => rangeLabel('2026-10-16', '2026-10-12'), /before/);
  assert.throws(() => rangeLabel('2026-01-02', '2025-12-29'), /before/);
});

test('shortWeekday', () => {
  assert.equal(shortWeekday('2026-10-15'), 'Thu');
  assert.equal(shortWeekday('2026-10-19'), 'Mon');
  assert.equal(shortWeekday('2026-10-18'), 'Sun');
});

test('pacificClock renders an instant as 24-hour HH:MM in America/Los_Angeles', () => {
  assert.equal(pacificClock(new Date('2026-10-19T13:05:00Z')), '06:05'); // PDT, UTC−7
  assert.equal(pacificClock(new Date('2026-11-02T14:05:00Z')), '06:05'); // PST, UTC−8
  assert.equal(pacificClock(new Date('2026-10-20T07:00:00Z')), '00:00'); // midnight is 00, not 24
  assert.equal(pacificClock(new Date('2026-10-20T00:30:00Z')), '17:30');
});

test('monthDay is the short month and day of a date', () => {
  assert.equal(monthDay('2026-10-19'), 'Oct 19');
  assert.equal(monthDay('2026-01-02'), 'Jan 2');
  assert.throws(() => monthDay('2026-13-01'), /date/);
});

test('slotMinutes reads a slot as minutes since midnight', () => {
  assert.deepEqual(slotMinutes('3:00 PM – 4:00 PM'), { start: 900, end: 960 });
  assert.deepEqual(slotMinutes('12:30 PM – 1:00 PM'), { start: 750, end: 780 });
  assert.deepEqual(slotMinutes('7:11 AM – 8:00 AM'), { start: 431, end: 480 });
  assert.deepEqual(slotMinutes('12:00 AM - 1:00 AM'), { start: 0, end: 60 });
  assert.deepEqual(slotMinutes('4:00 PM'), { start: 960, end: null });
  assert.equal(slotMinutes('lunch'), null);
});

test('slotClock is the 12-hour start of a slot', () => {
  assert.equal(slotClock('2:00 PM – 3:00 PM'), '2 PM');
  assert.equal(slotClock('12:30 PM – 1:00 PM'), '12:30 PM');
  assert.equal(slotClock('7:11 AM – 8:00 AM'), '7:11 AM');
  assert.equal(slotClock(''), null);
});

test('slotSpan draws both ends of a slot the way slotLabel draws a start', () => {
  assert.equal(slotSpan('3:00 PM – 4:00 PM'), '3–4');
  assert.equal(slotSpan('11:00 AM – 12:00 PM'), '11–12');
  assert.equal(slotSpan('12:30 PM – 1:00 PM'), '12½–1');
  assert.equal(slotSpan('4:00 PM'), null);
  assert.equal(slotSpan(undefined), null);
});
