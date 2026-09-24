/**
 * Pure-function tests for src/js/floor/format.js — the small formatters the
 * rest of the floor page calls on every render. No DOM, no i18n; plain
 * value-in/string-out checks against the examples the build spec pins.
 *
 * Run with `node --test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  num,
  lbsText,
  clockTime,
  mmss,
  hourTitle,
  tickLabel,
  cultivarParts,
  cultivarLabel,
  fieldText,
  dateHeading,
  etaText,
  esc,
} from '../src/js/floor/format.js';

test('num: one decimal by default, dash for anything not a finite number', () => {
  assert.equal(num(17.14), '17.1');
  assert.equal(num(17.16), '17.2');
  assert.equal(num(0), '0.0');
  assert.equal(num(3, 0), '3');
  assert.equal(num(NaN), '—');
  assert.equal(num(Infinity), '—');
  assert.equal(num(null), '—');
  assert.equal(num(undefined), '—');
  assert.equal(num('12'), '—'); // strings are not numbers here, even numeric-looking ones
});

test('lbsText: one decimal, never a dangling .0', () => {
  assert.equal(lbsText(10), '10');
  assert.equal(lbsText(10.0), '10');
  assert.equal(lbsText(10.5), '10.5');
  assert.equal(lbsText(10.04), '10');
  assert.equal(lbsText(10.06), '10.1');
  assert.equal(lbsText(null), '0');
  assert.equal(lbsText(undefined), '0');
  assert.equal(lbsText(NaN), '0');
});

test('clockTime: local 12-hour clock, no leading zero on the hour', () => {
  const d = new Date(2026, 8, 2, 9, 58, 0);
  assert.equal(clockTime(d), '9:58 AM');
  const noon = new Date(2026, 8, 2, 12, 0, 0);
  assert.equal(clockTime(noon), '12:00 PM');
});

test('mmss: minutes:seconds, no hour rollover', () => {
  assert.equal(mmss(0), '0:00');
  assert.equal(mmss(48), '0:48');
  assert.equal(mmss(1908), '31:48');
  assert.equal(mmss(90 * 60), '90:00'); // 90 minutes stays "90:00", never "1:30:00"
  assert.equal(mmss(NaN), '0:00');
});

test('hourTitle: same-meridiem slots collapse to one, cross-meridian keeps both', () => {
  assert.equal(hourTitle('7:00 AM – 8:00 AM'), '7–8 AM');
  assert.equal(hourTitle('12:30 PM – 1:00 PM'), '12:30–1 PM');
  assert.equal(hourTitle('4:00 PM – 4:30 PM'), '4–4:30 PM');
  assert.equal(hourTitle('7:30 AM – 8:00 AM'), '7:30–8 AM');
  assert.equal(hourTitle('11:00 AM – 12:00 PM'), '11 AM–12 PM');
});

const ALL_TIME_SLOTS = [
  '7:00 AM – 8:00 AM', '8:00 AM – 9:00 AM', '9:00 AM – 10:00 AM',
  '10:00 AM – 11:00 AM', '11:00 AM – 12:00 PM', '12:30 PM – 1:00 PM',
  '1:00 PM – 2:00 PM', '2:00 PM – 3:00 PM', '3:00 PM – 4:00 PM', '4:00 PM – 4:30 PM',
];

test('tickLabel: every tick carries its own meridiem in the compact ledger form', () => {
  assert.equal(tickLabel(ALL_TIME_SLOTS[0], 0, ALL_TIME_SLOTS), '7a');
  assert.equal(tickLabel(ALL_TIME_SLOTS[1], 1, ALL_TIME_SLOTS), '8a');
  assert.equal(tickLabel(ALL_TIME_SLOTS[4], 4, ALL_TIME_SLOTS), '11a');
  // the 12:30 PM half-slot keeps its minutes and says which side of noon it is
  assert.equal(tickLabel(ALL_TIME_SLOTS[5], 5, ALL_TIME_SLOTS), '12:30p');
  assert.equal(tickLabel(ALL_TIME_SLOTS[6], 6, ALL_TIME_SLOTS), '1p');
  // index 9's slot is '4:00 PM – 4:30 PM' — the tick reads the slot's START, not its end
  assert.equal(tickLabel(ALL_TIME_SLOTS[9], 9, ALL_TIME_SLOTS), '4p');
  // anything that is not a slot label comes back whole
  assert.equal(tickLabel('lunch', 0, []), 'lunch');
});

test('tickLabel: a custom (shift-start) first slot keeps its minutes', () => {
  const slots = ['7:30 AM – 8:00 AM', ...ALL_TIME_SLOTS.slice(1)];
  assert.equal(tickLabel(slots[0], 0, slots), '7:30a');
});

test('cultivarParts / cultivarLabel: the stored string typeset as name · method · year', () => {
  assert.deepEqual(cultivarParts('2025 - Godfather OG / Sungrown'), { year: '2025', name: 'Godfather OG', grow: 'Sungrown' });
  assert.deepEqual(cultivarParts('2025 - Lifter'), { year: '2025', name: 'Lifter', grow: '' });
  // not in the catalogue shape: the whole string is the name, nothing invented
  assert.deepEqual(cultivarParts('Cherry Wine'), { name: 'Cherry Wine', grow: '', year: '' });
  assert.deepEqual(cultivarParts(''), { name: '—', grow: '', year: '' });
  assert.equal(cultivarLabel('2025 - Godfather OG / Sungrown'), 'Godfather OG · Sungrown · 2025');
  assert.equal(cultivarLabel('2025 - Lifter'), 'Lifter · 2025');
});

test('fieldText: one decimal for a recorded weight, empty for none, never rounds stored precision', () => {
  assert.equal(fieldText(5.3), '5.3');
  assert.equal(fieldText(10), '10.0');
  assert.equal(fieldText(0), '');
  assert.equal(fieldText(null), '');
  assert.equal(fieldText('abc'), '');
  assert.equal(fieldText(17.15), '17.15');
});

test('dateHeading: built from y/m/d parts, en and es', () => {
  assert.deepEqual(dateHeading('2026-09-02', 'en'), { weekday: 'Wednesday', date: 'Sep 2, 2026' });
  assert.deepEqual(dateHeading('2026-09-02', 'es'), { weekday: 'miércoles', date: '2 sep 2026' });
});

test('etaText: day-of-week and 12-hour clock from { date, minutes }, verbatim port', () => {
  // 2026-08-27 is a Thursday; 9:56 AM = 596 minutes since midnight.
  assert.equal(etaText({ date: '2026-08-27', minutes: 9 * 60 + 56 }), 'Thu Aug 27 9:56 AM');
  assert.equal(etaText({ date: '2026-08-27', minutes: 13 * 60 + 5 }), 'Thu Aug 27 1:05 PM');
  assert.equal(etaText(null), '');
  assert.equal(etaText({}), '');
});

test('esc: escapes & < > " \'', () => {
  assert.equal(esc(`<b>Tops & "Smalls"</b> it's`), '&lt;b&gt;Tops &amp; &quot;Smalls&quot;&lt;/b&gt; it&#39;s');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});
