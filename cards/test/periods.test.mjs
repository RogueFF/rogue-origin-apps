import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pacificDate, lastCompleteWeek, weekRange, slotLabel, slotEnd, weekdayName } from '../src/periods.js';

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
