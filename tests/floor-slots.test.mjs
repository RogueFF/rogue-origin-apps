/**
 * The slot-label contract, pinned.
 *
 * These labels key every row in `monthly_production` and are validated
 * server-side; renaming one silently orphans data (2f31c614). Phase 0 of the
 * Floor Manager rebuild is this file existing before any UI moves.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
  SLOT_DEFS,
  BREAK_ADJUSTED_MULTIPLIERS,
  buildSlots,
  normalizeFirstSlotKey,
  rowHasRecordedData,
  isSlotVisible,
  getSlotMultiplier,
  getCurrentSlot,
  formatSlotShort,
  formatDateLocal,
} from '../src/js/floor/slots.js';

const require = createRequire(import.meta.url);
const { ALL_TIME_SLOTS, TIME_SLOT_MULTIPLIERS } = require('../workers/src/lib/production-helpers.js');

const at = (h, m = 0) => { const d = new Date(2026, 8, 2, h, m, 0); return d; };

test('the ten labels match the backend list exactly, en dash included', () => {
  const { slots } = buildSlots(null);
  assert.deepEqual(slots, ALL_TIME_SLOTS);
  assert.equal(slots.length, SLOT_DEFS.length);
});

test('slot boundaries are minutes since midnight', () => {
  const { startMinutes, endMinutes } = buildSlots(null);
  assert.equal(startMinutes['7:00 AM – 8:00 AM'], 7 * 60);
  assert.equal(endMinutes['7:00 AM – 8:00 AM'], 8 * 60);
  assert.equal(startMinutes['12:30 PM – 1:00 PM'], 12 * 60 + 30);
  assert.equal(endMinutes['4:00 PM – 4:30 PM'], 16 * 60 + 30);
});

test('a shift starting mid-first-hour renames only the first slot', () => {
  const { slots, startMinutes, endMinutes, renamedFrom } = buildSlots(at(7, 30));
  assert.equal(slots[0], '7:30 AM – 8:00 AM');
  assert.equal(renamedFrom, '7:00 AM – 8:00 AM');
  assert.deepEqual(slots.slice(1), ALL_TIME_SLOTS.slice(1));
  assert.equal(startMinutes['7:30 AM – 8:00 AM'], 7 * 60 + 30);
  assert.equal(endMinutes['7:30 AM – 8:00 AM'], 8 * 60);
  assert.equal(startMinutes['7:00 AM – 8:00 AM'], undefined, 'stale key is dropped');
});

test('the custom first label keeps the form the backend accepts', () => {
  // validateTimeSlot only matches /^(\d{1,2}):(\d{2}) (AM|PM) - 8:00 (AM|PM)$/
  // after normalising dashes and whitespace.
  const { slots } = buildSlots(at(7, 5));
  const normalised = slots[0].replace(/[–—]/g, '-').replace(/\s+/g, ' ');
  assert.match(normalised, /^(\d{1,2}):(\d{2}) AM - 8:00 AM$/);
});

test('a start on the hour, or after the first hour, renames nothing', () => {
  assert.equal(buildSlots(at(7, 0)).renamedFrom, null);
  assert.equal(buildSlots(at(8, 15)).renamedFrom, null);
  assert.equal(buildSlots(at(9, 30)).renamedFrom, null);
  assert.deepEqual(buildSlots(at(9, 30)).slots, ALL_TIME_SLOTS);
});

test('first-hour data written under the other label is folded in, not lost', () => {
  const dayData = { '7:00 AM – 8:00 AM': { tops1: 17.1, trimmers1: 12 } };
  normalizeFirstSlotKey(dayData, '7:30 AM – 8:00 AM');
  assert.deepEqual(Object.keys(dayData), ['7:30 AM – 8:00 AM']);
  assert.equal(dayData['7:30 AM – 8:00 AM'].tops1, 17.1);
});

test('when both first-hour keys carry rows, the one with data survives', () => {
  const dayData = {
    '7:00 AM – 8:00 AM': { tops1: 17.1 },
    '7:30 AM – 8:00 AM': { tops1: 0, trimmers1: 0 },
  };
  normalizeFirstSlotKey(dayData, '7:30 AM – 8:00 AM');
  assert.equal(dayData['7:30 AM – 8:00 AM'].tops1, 17.1);
});

test('later hours are never folded into the first slot', () => {
  const dayData = { '1:00 PM – 2:00 PM': { tops1: 16 } };
  normalizeFirstSlotKey(dayData, '7:30 AM – 8:00 AM');
  assert.equal(dayData['1:00 PM – 2:00 PM'].tops1, 16);
});

test('rowHasRecordedData counts crew as well as pounds', () => {
  assert.equal(rowHasRecordedData(null), false);
  assert.equal(rowHasRecordedData({}), false);
  assert.equal(rowHasRecordedData({ tops1: 0, trimmers1: 0 }), false);
  assert.equal(rowHasRecordedData({ trimmers1: 12 }), true);
  assert.equal(rowHasRecordedData({ smalls2: 3.2 }), true);
});

test('hours before the shift start are hidden, with 15 minutes of tolerance', () => {
  const { startMinutes } = buildSlots(null);
  const opts = (h, m, row = null) => ({ startMinutes, shiftStartTime: at(h, m), row });

  assert.equal(isSlotVisible('7:00 AM – 8:00 AM', opts(9, 0)), false);
  assert.equal(isSlotVisible('9:00 AM – 10:00 AM', opts(9, 0)), true);
  assert.equal(isSlotVisible('9:00 AM – 10:00 AM', opts(9, 10)), true, 'started 10 min late, hour still shows');
  assert.equal(isSlotVisible('9:00 AM – 10:00 AM', opts(9, 20)), false);
});

test('an hour with recorded data is visible whatever the shift start says', () => {
  const { startMinutes } = buildSlots(null);
  const visible = isSlotVisible('7:00 AM – 8:00 AM', {
    startMinutes,
    shiftStartTime: at(11, 0),
    row: { tops1: 17.1 },
  });
  assert.equal(visible, true, 'a late Start Day must never hide an hour the crew worked');
});

test('every hour multiplier matches the backend table', () => {
  const { startMinutes, endMinutes } = buildSlots(null);
  for (const slot of ALL_TIME_SLOTS) {
    const mine = getSlotMultiplier(slot, { startMinutes, endMinutes, isToday: false });
    assert.equal(mine, TIME_SLOT_MULTIPLIERS[slot], `${slot} drifted from the worker`);
  }
});

test('breaks and the short hours keep their overrides', () => {
  assert.equal(BREAK_ADJUSTED_MULTIPLIERS['9:00 AM – 10:00 AM'], 0.83);
  assert.equal(BREAK_ADJUSTED_MULTIPLIERS['2:00 PM – 3:00 PM'], 0.83);
  assert.equal(BREAK_ADJUSTED_MULTIPLIERS['4:00 PM – 4:30 PM'], 0.33);
});

test('a shift that starts after an hour ends zeroes that hour', () => {
  const { startMinutes, endMinutes } = buildSlots(null);
  const m = getSlotMultiplier('7:00 AM – 8:00 AM', {
    startMinutes, endMinutes, shiftStartTime: at(11, 0), isToday: true,
  });
  assert.equal(m, 0);
});

test('a shift starting mid-hour prorates that hour', () => {
  const { startMinutes, endMinutes } = buildSlots(null);
  const m = getSlotMultiplier('10:00 AM – 11:00 AM', {
    startMinutes, endMinutes, shiftStartTime: at(10, 15), isToday: true,
  });
  assert.equal(m, 0.75);
});

test('proration scales a break hour rather than replacing it', () => {
  const { startMinutes, endMinutes } = buildSlots(null);
  const m = getSlotMultiplier('9:00 AM – 10:00 AM', {
    startMinutes, endMinutes, shiftStartTime: at(9, 30), isToday: true,
  });
  assert.equal(m, 0.5 * 0.83);
});

test('an hour with data keeps its full target instead of being prorated away', () => {
  const { startMinutes, endMinutes } = buildSlots(null);
  const m = getSlotMultiplier('7:00 AM – 8:00 AM', {
    startMinutes, endMinutes, shiftStartTime: at(11, 0), isToday: true, row: { tops1: 17.1 },
  });
  assert.equal(m, 1);
});

test('a past date is never prorated by today\'s shift start', () => {
  const { startMinutes, endMinutes } = buildSlots(null);
  const m = getSlotMultiplier('7:00 AM – 8:00 AM', {
    startMinutes, endMinutes, shiftStartTime: at(11, 0), isToday: false,
  });
  assert.equal(m, 1);
});

test('getCurrentSlot finds the hour the clock is in, and nothing outside the shift', () => {
  const { slots, startMinutes, endMinutes } = buildSlots(null);
  const opts = (h, m) => ({ startMinutes, endMinutes, now: at(h, m) });

  assert.equal(getCurrentSlot(slots, opts(15, 20)), '3:00 PM – 4:00 PM');
  assert.equal(getCurrentSlot(slots, opts(12, 15)), null, 'lunch is not an hour');
  assert.equal(getCurrentSlot(slots, opts(6, 0)), null);
  assert.equal(getCurrentSlot(slots, opts(17, 0)), null);
});

test('formatSlotShort keeps half hours and drops the rest', () => {
  assert.equal(formatSlotShort('7:00 AM – 8:00 AM'), '7-8 AM');
  assert.equal(formatSlotShort('7:30 AM – 8:00 AM'), '7-8 AM');
  assert.equal(formatSlotShort('12:30 PM – 1:00 PM'), '12-1 PM');
  assert.equal(formatSlotShort('4:00 PM – 4:30 PM'), '4-4:30 PM');
  assert.equal(formatSlotShort('nonsense'), 'nonsense');
});

test('formatDateLocal is the local date, not the UTC one', () => {
  const evening = new Date(2026, 8, 2, 23, 30, 0);
  assert.equal(formatDateLocal(evening), '2026-09-02');
  // The bug this replaces: toISOString() rolls over to the 3rd west of UTC.
  assert.equal(formatDateLocal(new Date(2026, 0, 5, 0, 15, 0)), '2026-01-05');
});
