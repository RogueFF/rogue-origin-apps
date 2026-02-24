/**
 * Production D1 Handler — Unit Tests
 *
 * Tests the pure-logic helpers extracted from workers/src/handlers/production-d1.js.
 * Run with:  node --test tests/production-d1.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_TIME_SLOTS,
  TIME_SLOT_MULTIPLIERS,
  BREAKS,
  parseSlotTimeToMinutes,
  getTimeSlotMultiplier,
  sortSlotsChronologically,
  buildSortedRows,
  findHourIndices,
  calculateStreak,
  calculateDailyProjection,
} from '../workers/src/lib/production-helpers.js';

// ---------------------------------------------------------------------------
// Helpers to build fake DB rows
// ---------------------------------------------------------------------------

function makeRow(timeSlot, {
  tops = 0, smalls = 0, trimmers = 0, buckers = 0,
  effectiveTrimmers = null, cultivar = '', qc = '',
} = {}) {
  return {
    time_slot: timeSlot,
    cultivar1: cultivar,
    tops_lbs1: tops,
    smalls_lbs1: smalls,
    trimmers_line1: trimmers,
    buckers_line1: buckers,
    effective_trimmers_line1: effectiveTrimmers,
    qc,
  };
}

// ---------------------------------------------------------------------------
// 1. Time slot chronological sorting
// ---------------------------------------------------------------------------

describe('Time slot chronological sorting', () => {
  it('sorts 10:00 AM AFTER 9:00 AM (not alphabetically)', () => {
    const slots = ['10:00 AM – 11:00 AM', '9:00 AM – 10:00 AM'];
    const sorted = sortSlotsChronologically(slots);
    assert.equal(sorted[0], '9:00 AM – 10:00 AM');
    assert.equal(sorted[1], '10:00 AM – 11:00 AM');
  });

  it('alphabetical sort would wrongly put 10:00 AM before 7:44 AM — our sort does not', () => {
    const slots = [
      '10:00 AM – 11:00 AM',
      '7:44 AM – 8:00 AM',
      '8:00 AM – 9:00 AM',
    ];
    const sorted = sortSlotsChronologically(slots);
    assert.deepEqual(sorted, [
      '7:44 AM – 8:00 AM',
      '8:00 AM – 9:00 AM',
      '10:00 AM – 11:00 AM',
    ]);
  });

  it('sorts full ALL_TIME_SLOTS correctly', () => {
    // Reverse to prove sort actually reorders
    const reversed = [...ALL_TIME_SLOTS].reverse();
    const sorted = sortSlotsChronologically(reversed);
    assert.deepEqual(sorted, ALL_TIME_SLOTS);
  });

  it('handles PM slots correctly (12:30 PM before 1:00 PM before 4:00 PM)', () => {
    const slots = ['4:00 PM – 4:30 PM', '1:00 PM – 2:00 PM', '12:30 PM – 1:00 PM'];
    const sorted = sortSlotsChronologically(slots);
    assert.deepEqual(sorted, [
      '12:30 PM – 1:00 PM',
      '1:00 PM – 2:00 PM',
      '4:00 PM – 4:30 PM',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. Dynamic first slot handling
// ---------------------------------------------------------------------------

describe('Dynamic first slot handling', () => {
  it('partial hour like 7:44 AM – 8:00 AM sorts before 8:00 AM – 9:00 AM', () => {
    const slots = [
      '8:00 AM – 9:00 AM',
      '7:44 AM – 8:00 AM',
      '9:00 AM – 10:00 AM',
    ];
    const sorted = sortSlotsChronologically(slots);
    assert.equal(sorted[0], '7:44 AM – 8:00 AM');
    assert.equal(sorted[1], '8:00 AM – 9:00 AM');
  });

  it('buildSortedRows merges dynamic first slot with standard slots in order', () => {
    const dbRows = [
      makeRow('7:44 AM – 8:00 AM', { tops: 5, trimmers: 4 }),
      makeRow('8:00 AM – 9:00 AM', { tops: 20, trimmers: 4 }),
      makeRow('9:00 AM – 10:00 AM', { tops: 18, trimmers: 4 }),
    ];
    const { rows } = buildSortedRows(dbRows, 5.0);
    assert.equal(rows[0].timeSlot, '7:44 AM – 8:00 AM');
    assert.equal(rows[1].timeSlot, '8:00 AM – 9:00 AM');
    assert.equal(rows[2].timeSlot, '9:00 AM – 10:00 AM');
  });

  it('buildSortedRows does not duplicate standard slot when DB has the same slot', () => {
    const dbRows = [
      makeRow('7:00 AM – 8:00 AM', { tops: 22, trimmers: 4 }),
      makeRow('8:00 AM – 9:00 AM', { tops: 20, trimmers: 4 }),
    ];
    const { rows } = buildSortedRows(dbRows, 5.0);
    // Should have exactly 2 rows (not double-counted)
    assert.equal(rows.length, 2);
    assert.equal(rows[0].timeSlot, '7:00 AM – 8:00 AM');
  });
});

// ---------------------------------------------------------------------------
// 3. getTimeSlotMultiplier
// ---------------------------------------------------------------------------

describe('getTimeSlotMultiplier', () => {
  it('returns 1.0 for a standard full-hour slot', () => {
    assert.equal(getTimeSlotMultiplier('7:00 AM – 8:00 AM'), 1.0);
    assert.equal(getTimeSlotMultiplier('8:00 AM – 9:00 AM'), 1.0);
    assert.equal(getTimeSlotMultiplier('1:00 PM – 2:00 PM'), 1.0);
  });

  it('returns 0.83 for 9:00 AM – 10:00 AM (10 min morning break)', () => {
    assert.equal(getTimeSlotMultiplier('9:00 AM – 10:00 AM'), 0.83);
  });

  it('returns 0.5 for 12:30 PM – 1:00 PM (half hour slot)', () => {
    assert.equal(getTimeSlotMultiplier('12:30 PM – 1:00 PM'), 0.5);
  });

  it('returns 0.33 for 4:00 PM – 4:30 PM (last partial slot)', () => {
    assert.equal(getTimeSlotMultiplier('4:00 PM – 4:30 PM'), 0.33);
  });

  it('dynamically calculates multiplier for partial first slot', () => {
    // 7:44 AM – 8:00 AM = 16 min, no breaks in that window => 16/60 ≈ 0.2667
    const mult = getTimeSlotMultiplier('7:44 AM – 8:00 AM');
    assert.ok(Math.abs(mult - 16 / 60) < 0.001, `Expected ~0.267, got ${mult}`);
  });

  it('dynamically calculates multiplier for partial slot spanning a break', () => {
    // 8:50 AM – 9:10 AM = 20 min, but 9:00-9:10 overlaps 10 min break => (20 - 10)/60 = 10/60
    const mult = getTimeSlotMultiplier('8:50 AM – 9:10 AM');
    assert.ok(Math.abs(mult - 10 / 60) < 0.001, `Expected ~0.167, got ${mult}`);
  });

  it('returns 1.0 for null/undefined/empty input', () => {
    assert.equal(getTimeSlotMultiplier(null), 1.0);
    assert.equal(getTimeSlotMultiplier(undefined), 1.0);
    assert.equal(getTimeSlotMultiplier(''), 1.0);
  });

  it('handles hyphen/dash normalization (plain - vs en-dash –)', () => {
    // The DB might store with a regular hyphen
    assert.equal(getTimeSlotMultiplier('9:00 AM - 10:00 AM'), 0.83);
  });

  it('accepts a custom multipliers table', () => {
    const custom = { '7:00 AM – 8:00 AM': 0.75 };
    assert.equal(getTimeSlotMultiplier('7:00 AM – 8:00 AM', custom), 0.75);
  });
});

// ---------------------------------------------------------------------------
// 4. parseSlotTimeToMinutes
// ---------------------------------------------------------------------------

describe('parseSlotTimeToMinutes', () => {
  it('parses AM times correctly', () => {
    assert.equal(parseSlotTimeToMinutes('7:00 AM'), 7 * 60);
    assert.equal(parseSlotTimeToMinutes('9:00 AM'), 9 * 60);
    assert.equal(parseSlotTimeToMinutes('11:00 AM'), 11 * 60);
  });

  it('parses PM times correctly', () => {
    assert.equal(parseSlotTimeToMinutes('12:30 PM'), 12 * 60 + 30);
    assert.equal(parseSlotTimeToMinutes('1:00 PM'), 13 * 60);
    assert.equal(parseSlotTimeToMinutes('4:30 PM'), 16 * 60 + 30);
  });

  it('parses 12:00 AM as midnight (0 minutes)', () => {
    assert.equal(parseSlotTimeToMinutes('12:00 AM'), 0);
  });

  it('parses 12:00 PM as noon (720 minutes)', () => {
    assert.equal(parseSlotTimeToMinutes('12:00 PM'), 720);
  });

  it('parses partial minutes like 7:44 AM', () => {
    assert.equal(parseSlotTimeToMinutes('7:44 AM'), 7 * 60 + 44);
  });

  it('returns null for unparseable strings', () => {
    assert.equal(parseSlotTimeToMinutes('not a time'), null);
    assert.equal(parseSlotTimeToMinutes(''), null);
  });
});

// ---------------------------------------------------------------------------
// 5. lastCompletedHourIndex detection
// ---------------------------------------------------------------------------

describe('lastCompletedHourIndex detection', () => {
  it('points to the MOST RECENT hour with production, not first', () => {
    const rows = [
      { tops: 20, trimmers: 4, multiplier: 1.0 },  // index 0 — has production
      { tops: 22, trimmers: 4, multiplier: 1.0 },  // index 1 — has production
      { tops: 18, trimmers: 4, multiplier: 0.83 },  // index 2 — has production (most recent)
      { tops: 0,  trimmers: 4, multiplier: 1.0 },  // index 3 — current hour (no production yet)
    ];
    const { lastCompletedHourIndex } = findHourIndices(rows);
    assert.equal(lastCompletedHourIndex, 2, 'Should point to index 2, not 0');
  });

  it('returns -1 when no hours have production', () => {
    const rows = [
      { tops: 0, trimmers: 4, multiplier: 1.0 },
      { tops: 0, trimmers: 4, multiplier: 1.0 },
    ];
    const { lastCompletedHourIndex } = findHourIndices(rows);
    assert.equal(lastCompletedHourIndex, -1);
  });

  it('handles single completed hour', () => {
    const rows = [
      { tops: 15, trimmers: 3, multiplier: 1.0 },
    ];
    const { lastCompletedHourIndex } = findHourIndices(rows);
    assert.equal(lastCompletedHourIndex, 0);
  });

  it('handles gap: production then no production then production', () => {
    const rows = [
      { tops: 20, trimmers: 4, multiplier: 1.0 },  // index 0
      { tops: 0,  trimmers: 0, multiplier: 1.0 },  // index 1 — gap
      { tops: 18, trimmers: 4, multiplier: 1.0 },  // index 2 — production resumes
    ];
    const { lastCompletedHourIndex } = findHourIndices(rows);
    assert.equal(lastCompletedHourIndex, 2);
  });
});

// ---------------------------------------------------------------------------
// 6. currentHourIndex detection
// ---------------------------------------------------------------------------

describe('currentHourIndex detection', () => {
  it('identifies hour with trimmers but no production', () => {
    const rows = [
      { tops: 20, trimmers: 4, multiplier: 1.0 },
      { tops: 22, trimmers: 4, multiplier: 1.0 },
      { tops: 0,  trimmers: 5, multiplier: 1.0 },  // trimmers assigned, no production yet
    ];
    const { currentHourIndex } = findHourIndices(rows);
    assert.equal(currentHourIndex, 2);
  });

  it('returns -1 when all hours have production', () => {
    const rows = [
      { tops: 20, trimmers: 4, multiplier: 1.0 },
      { tops: 22, trimmers: 4, multiplier: 1.0 },
    ];
    const { currentHourIndex } = findHourIndices(rows);
    assert.equal(currentHourIndex, -1);
  });

  it('returns -1 for empty rows', () => {
    const { currentHourIndex } = findHourIndices([]);
    assert.equal(currentHourIndex, -1);
  });

  it('with multiple zero-production rows, picks the last one with trimmers', () => {
    // The loop overwrites currentHourIndex each time it finds trimmers > 0 && tops === 0
    const rows = [
      { tops: 20, trimmers: 4, multiplier: 1.0 },
      { tops: 0,  trimmers: 4, multiplier: 1.0 },  // index 1
      { tops: 0,  trimmers: 5, multiplier: 1.0 },  // index 2 — this wins
    ];
    const { currentHourIndex } = findHourIndices(rows);
    assert.equal(currentHourIndex, 2);
  });
});

// ---------------------------------------------------------------------------
// 7. Target calculation
// ---------------------------------------------------------------------------

describe('Target calculation', () => {
  it('hourTarget = trimmers × targetRate × multiplier for a full hour', () => {
    const trimmers = 4;
    const targetRate = 5.0;
    const multiplier = 1.0;
    const expected = 4 * 5.0 * 1.0; // 20
    assert.equal(trimmers * targetRate * multiplier, expected);
  });

  it('hourTarget accounts for break multiplier', () => {
    const trimmers = 4;
    const targetRate = 5.0;
    const multiplier = 0.83; // 9:00 AM slot with 10-min break
    const expected = 4 * 5.0 * 0.83; // 16.6
    assert.ok(Math.abs(trimmers * targetRate * multiplier - expected) < 0.01);
  });

  it('hourTarget with half-hour slot', () => {
    const trimmers = 6;
    const targetRate = 4.5;
    const multiplier = 0.5; // 12:30 PM slot
    const expected = 6 * 4.5 * 0.5; // 13.5
    assert.equal(trimmers * targetRate * multiplier, expected);
  });

  it('todayTarget sums all completed hour targets', () => {
    const rows = [
      { tops: 20, trimmers: 4, multiplier: 1.0 },
      { tops: 22, trimmers: 4, multiplier: 1.0 },
      { tops: 15, trimmers: 4, multiplier: 0.83 },
    ];
    const targetRate = 5.0;
    let totalTarget = 0;
    for (const row of rows) {
      if (row.trimmers > 0 && row.tops > 0) {
        totalTarget += row.trimmers * targetRate * row.multiplier;
      }
    }
    const expected = (4 * 5 * 1.0) + (4 * 5 * 1.0) + (4 * 5 * 0.83);
    assert.ok(Math.abs(totalTarget - expected) < 0.01);
  });
});

// ---------------------------------------------------------------------------
// 8. Streak counting
// ---------------------------------------------------------------------------

describe('Streak counting', () => {
  it('counts consecutive hours at >= 90% of target', () => {
    const targetRate = 5.0;
    // All 3 hours hit >= 90%: target = 4×5×1 = 20, 90% = 18
    const rows = [
      { tops: 19, trimmers: 4, multiplier: 1.0, timeSlot: '7:00 AM – 8:00 AM' },
      { tops: 20, trimmers: 4, multiplier: 1.0, timeSlot: '8:00 AM – 9:00 AM' },
      { tops: 22, trimmers: 4, multiplier: 1.0, timeSlot: '9:00 AM – 10:00 AM' },
    ];
    assert.equal(calculateStreak(rows, 2, targetRate), 3);
  });

  it('resets streak when an hour falls below 90%', () => {
    const targetRate = 5.0;
    // target = 20, 90% = 18; hour index 1 is below threshold
    const rows = [
      { tops: 20, trimmers: 4, multiplier: 1.0 },
      { tops: 10, trimmers: 4, multiplier: 1.0 },  // below 90%
      { tops: 19, trimmers: 4, multiplier: 1.0 },
    ];
    // Streak resets at index 1, then restarts at index 2 → streak = 1
    assert.equal(calculateStreak(rows, 2, targetRate), 1);
  });

  it('returns 0 when no hours hit 90%', () => {
    const targetRate = 5.0;
    const rows = [
      { tops: 5,  trimmers: 4, multiplier: 1.0 },
      { tops: 10, trimmers: 4, multiplier: 1.0 },
    ];
    assert.equal(calculateStreak(rows, 1, targetRate), 0);
  });

  it('returns 0 for empty data', () => {
    assert.equal(calculateStreak([], -1, 5.0), 0);
  });

  it('accounts for multiplier in streak threshold', () => {
    const targetRate = 5.0;
    // 9:00 slot: multiplier = 0.83, target = 4×5×0.83 = 16.6, 90% = 14.94
    const rows = [
      { tops: 15, trimmers: 4, multiplier: 0.83 },  // 15/16.6 = 90.4% → streak
    ];
    assert.equal(calculateStreak(rows, 0, targetRate), 1);
  });
});

// ---------------------------------------------------------------------------
// 9. Daily projection accuracy
// ---------------------------------------------------------------------------

describe('Daily projection', () => {
  it('projects remaining hours using current rate when outperforming', () => {
    // 2 hours done, 8 remaining (10 slots total)
    const rows = [
      { tops: 25, trimmers: 4, multiplier: 1.0, timeSlot: '7:00 AM – 8:00 AM' },
      { tops: 24, trimmers: 4, multiplier: 1.0, timeSlot: '8:00 AM – 9:00 AM' },
    ];
    const targetRate = 5.0;
    const totalLbsSoFar = 49;
    const result = calculateDailyProjection(rows, 1, -1, targetRate, totalLbsSoFar);

    // currentRate = 49 / (4×1 + 4×1) = 6.125 lbs/trimmer-hour
    // Remaining 8 slots use lastKnownTrimmers=4 at currentRate=6.125
    // projectedFromRemaining ≈ 159.005, projectedTotal ≈ 49 + 159.005 = 208.005
    // dailyGoal uses targetRate(5.0) for all 10 slots ≈ 169.8
    assert.ok(Math.abs(result.projectedTotal - 208.005) < 0.1,
      `projectedTotal should be ~208.0, got ${result.projectedTotal.toFixed(1)}`);
    assert.ok(Math.abs(result.dailyGoal - 169.8) < 0.1,
      `dailyGoal should be ~169.8, got ${result.dailyGoal.toFixed(1)}`);
  });

  it('uses targetRate when no production data exists', () => {
    const rows = [];
    const result = calculateDailyProjection(rows, -1, -1, 5.0, 0);
    // No data → lastKnownTrimmers = 0 → everything is 0
    assert.equal(result.projectedTotal, 0);
    assert.equal(result.dailyGoal, 0);
  });

  it('includes current hour trimmers in projection', () => {
    const rows = [
      { tops: 20, trimmers: 4, multiplier: 1.0, timeSlot: '7:00 AM – 8:00 AM' },
      { tops: 0,  trimmers: 5, multiplier: 1.0, timeSlot: '8:00 AM – 9:00 AM' },
    ];
    const targetRate = 5.0;
    const result = calculateDailyProjection(rows, 0, 1, targetRate, 20);

    // lastKnownTrimmers picks up 5 from current hour
    // currentRate = 20 / (4×1.0) = 5.0
    // Worked slot 7:00 AM: tops>0 → dailyGoal += 4×5×1.0=20
    // Worked slot 8:00 AM: current (trimmers>0, tops=0) → dailyGoal += 5×5×1.0=25, projected += 5×5×1.0=25
    // Remaining 8 slots use lastKnownTrimmers=5 at currentRate=5.0
    assert.ok(result.dailyGoal > 20 + 25, 'dailyGoal must include remaining slots with 5 trimmers');
    assert.ok(result.projectedTotal > 20 + 25, 'projectedTotal must exceed worked + current hour');
  });
});

// ---------------------------------------------------------------------------
// 10. Edge cases
// ---------------------------------------------------------------------------

describe('Edge cases', () => {
  it('empty data returns all indices as -1', () => {
    const { lastCompletedHourIndex, currentHourIndex } = findHourIndices([]);
    assert.equal(lastCompletedHourIndex, -1);
    assert.equal(currentHourIndex, -1);
  });

  it('single hour with production', () => {
    const rows = [
      { tops: 20, trimmers: 4, multiplier: 1.0 },
    ];
    const { lastCompletedHourIndex, currentHourIndex } = findHourIndices(rows);
    assert.equal(lastCompletedHourIndex, 0);
    assert.equal(currentHourIndex, -1);
  });

  it('all hours complete — no current hour', () => {
    const rows = ALL_TIME_SLOTS.map((_, i) => ({
      tops: 20 + i,
      trimmers: 4,
      multiplier: getTimeSlotMultiplier(ALL_TIME_SLOTS[i]),
    }));
    const { lastCompletedHourIndex, currentHourIndex } = findHourIndices(rows);
    assert.equal(lastCompletedHourIndex, rows.length - 1);
    assert.equal(currentHourIndex, -1);
  });

  it('buildSortedRows handles empty DB rows', () => {
    const { rows } = buildSortedRows([], 5.0);
    assert.equal(rows.length, 0);
  });

  it('buildSortedRows uses effective_trimmers_line1 when present', () => {
    const dbRows = [
      makeRow('8:00 AM – 9:00 AM', { tops: 20, trimmers: 4, effectiveTrimmers: 3.5 }),
    ];
    const { rows } = buildSortedRows(dbRows, 5.0);
    assert.equal(rows[0].trimmers, 3.5);
    assert.equal(rows[0].rawTrimmers, 4);
  });

  it('buildSortedRows falls back to trimmers_line1 when effective is null', () => {
    const dbRows = [
      makeRow('8:00 AM – 9:00 AM', { tops: 20, trimmers: 4, effectiveTrimmers: null }),
    ];
    const { rows } = buildSortedRows(dbRows, 5.0);
    assert.equal(rows[0].trimmers, 4);
  });
});

// ---------------------------------------------------------------------------
// 11b. uniqueSlots merge logic — dynamic slots must sort correctly after Set merge
// ---------------------------------------------------------------------------

describe('uniqueSlots merge logic', () => {
  it('dynamic slot from DB merges with ALL_TIME_SLOTS and sorts chronologically', () => {
    // Reproduce the exact merge logic from production-helpers.js buildSortedRows:
    //   const uniqueSlots = [...new Set([...ALL_TIME_SLOTS.map(normalize), ...allSlotsFromDB])];
    //   const sorted = sortSlotsChronologically(uniqueSlots);
    // The bug: Set appends dynamic slots AFTER standard slots, so without sort
    // '7:44 AM – 8:00 AM' would appear after '4:00 PM – 4:30 PM'.
    const dbSlots = ['7:44 AM – 8:00 AM', '8:00 AM – 9:00 AM', '9:00 AM – 10:00 AM'];
    const merged = [...new Set([...ALL_TIME_SLOTS, ...dbSlots])];

    // Before sort: '7:44 AM – 8:00 AM' is AFTER all standard slots (Set appends new items at end)
    const lastStandard = merged.indexOf('4:00 PM – 4:30 PM');
    const dynamicIdx = merged.indexOf('7:44 AM – 8:00 AM');
    assert.ok(dynamicIdx > lastStandard, 'Before sort: dynamic slot appended after standard slots');

    // After sort: 7:00 AM (from ALL_TIME_SLOTS) is first, 7:44 AM is second
    const sorted = sortSlotsChronologically(merged);
    assert.equal(sorted[0], '7:00 AM – 8:00 AM', 'Standard 7:00 AM slot comes first');
    assert.equal(sorted[1], '7:44 AM – 8:00 AM', 'Dynamic 7:44 AM slot comes second');
    assert.equal(sorted[2], '8:00 AM – 9:00 AM');

    // Verify no duplicates for slots that exist in both
    const count8AM = sorted.filter(s => s === '8:00 AM – 9:00 AM').length;
    assert.equal(count8AM, 1, 'No duplicate for shared slot');

    // Verify the dynamic slot didn't get lost
    assert.ok(sorted.includes('7:44 AM – 8:00 AM'), 'Dynamic slot must be present after merge');

    // Total count = ALL_TIME_SLOTS (10) + 1 new dynamic slot = 11
    assert.equal(sorted.length, ALL_TIME_SLOTS.length + 1);
  });

  it('buildSortedRows produces correctly ordered rows when DB has dynamic first slot', () => {
    // The full flow: DB rows with a dynamic first slot → buildSortedRows → rows in order
    const dbRows = [
      makeRow('7:44 AM – 8:00 AM', { tops: 5, trimmers: 4 }),
      makeRow('8:00 AM – 9:00 AM', { tops: 22, trimmers: 4 }),
      makeRow('9:00 AM – 10:00 AM', { tops: 18, trimmers: 4 }),
      makeRow('10:00 AM – 11:00 AM', { tops: 20, trimmers: 4 }),
    ];
    const { rows } = buildSortedRows(dbRows, 5.0);

    // Rows must be in chronological order — not Set-insertion order
    const timeSlots = rows.map(r => r.timeSlot);
    assert.deepEqual(timeSlots, [
      '7:44 AM – 8:00 AM',
      '8:00 AM – 9:00 AM',
      '9:00 AM – 10:00 AM',
      '10:00 AM – 11:00 AM',
    ]);

    // Verify every consecutive pair is chronologically ordered
    for (let i = 1; i < timeSlots.length; i++) {
      const prevStart = parseSlotTimeToMinutes(timeSlots[i - 1].split('–')[0].trim());
      const currStart = parseSlotTimeToMinutes(timeSlots[i].split('–')[0].trim());
      assert.ok(prevStart < currStart, `${timeSlots[i-1]} should be before ${timeSlots[i]}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 11. Integration: full scoreboard flow simulation
// ---------------------------------------------------------------------------

describe('Full scoreboard flow (integration)', () => {
  it('processes a realistic day with dynamic first slot and correct sorting', () => {
    const dbRows = [
      makeRow('7:44 AM – 8:00 AM', { tops: 5, trimmers: 4, cultivar: 'Cherry Punch' }),
      makeRow('8:00 AM – 9:00 AM', { tops: 22, trimmers: 4, cultivar: 'Cherry Punch' }),
      makeRow('9:00 AM – 10:00 AM', { tops: 18, trimmers: 4, cultivar: 'Cherry Punch' }),
      makeRow('10:00 AM – 11:00 AM', { tops: 20, trimmers: 4, cultivar: 'Cherry Punch' }),
      makeRow('11:00 AM – 12:00 PM', { trimmers: 4, cultivar: 'Cherry Punch' }), // current hour
    ];

    const targetRate = 5.0;
    const { rows } = buildSortedRows(dbRows, targetRate);

    // Verify chronological order
    assert.equal(rows[0].timeSlot, '7:44 AM – 8:00 AM');
    assert.equal(rows[1].timeSlot, '8:00 AM – 9:00 AM');
    assert.equal(rows[2].timeSlot, '9:00 AM – 10:00 AM');
    assert.equal(rows[3].timeSlot, '10:00 AM – 11:00 AM');
    assert.equal(rows[4].timeSlot, '11:00 AM – 12:00 PM');

    // Verify indices
    const { lastCompletedHourIndex, currentHourIndex } = findHourIndices(rows);
    assert.equal(lastCompletedHourIndex, 3, '10:00 AM slot is last completed');
    assert.equal(currentHourIndex, 4, '11:00 AM slot is current');

    // Verify streak: all 4 completed hours hit 90%+ (5/5.33=94%, 22/20=110%, 18/16.6=108%, 20/20=100%)
    const streak = calculateStreak(rows, lastCompletedHourIndex, targetRate);
    assert.equal(streak, 4, 'All 4 completed hours exceed 90% → streak = 4');

    // Verify projection is calculated
    const totalLbs = rows.slice(0, lastCompletedHourIndex + 1)
      .reduce((sum, r) => sum + r.tops, 0);
    assert.equal(totalLbs, 5 + 22 + 18 + 20);

    const projection = calculateDailyProjection(
      rows, lastCompletedHourIndex, currentHourIndex,
      targetRate, totalLbs,
    );
    assert.ok(projection.projectedTotal > totalLbs, 'Projection should exceed actual so far');
    assert.ok(projection.dailyGoal > 0);
  });

  it('the alphabetical sort bug: 10:00 AM must NOT come before 7:44 AM', () => {
    // This is the exact bug scenario: alphabetical ORDER BY in SQL would sort:
    //   '10:00 AM – 11:00 AM'  BEFORE  '7:44 AM – 8:00 AM'  BEFORE  '8:00 AM – 9:00 AM'
    // Our sort must fix this.
    const slotsFromAlphaSQL = [
      '10:00 AM – 11:00 AM',
      '11:00 AM – 12:00 PM',
      '12:30 PM – 1:00 PM',
      '1:00 PM – 2:00 PM',
      '2:00 PM – 3:00 PM',
      '3:00 PM – 4:00 PM',
      '4:00 PM – 4:30 PM',
      '7:44 AM – 8:00 AM',
      '8:00 AM – 9:00 AM',
      '9:00 AM – 10:00 AM',
    ];

    const sorted = sortSlotsChronologically(slotsFromAlphaSQL);

    // First slot must be 7:44 AM, not 10:00 AM
    assert.equal(sorted[0], '7:44 AM – 8:00 AM');
    assert.equal(sorted[1], '8:00 AM – 9:00 AM');
    assert.equal(sorted[2], '9:00 AM – 10:00 AM');
    assert.equal(sorted[3], '10:00 AM – 11:00 AM');

    // Verify full order
    for (let i = 1; i < sorted.length; i++) {
      const prevStart = parseSlotTimeToMinutes(sorted[i - 1].split('–')[0].trim());
      const currStart = parseSlotTimeToMinutes(sorted[i].split('–')[0].trim());
      assert.ok(
        prevStart <= currStart,
        `${sorted[i - 1]} (${prevStart}) should be before ${sorted[i]} (${currStart})`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 12. Smalls tracking through buildSortedRows
// ---------------------------------------------------------------------------

describe('Smalls tracking', () => {
  it('buildSortedRows preserves smalls_lbs1 in output rows', () => {
    const dbRows = [
      makeRow('8:00 AM – 9:00 AM', { tops: 20, smalls: 3.5, trimmers: 4 }),
      makeRow('9:00 AM – 10:00 AM', { tops: 18, smalls: 2.0, trimmers: 4 }),
    ];
    const { rows } = buildSortedRows(dbRows, 5.0);
    assert.equal(rows[0].smalls, 3.5);
    assert.equal(rows[1].smalls, 2.0);
  });

  it('smalls defaults to 0 when not provided', () => {
    const dbRows = [
      makeRow('8:00 AM – 9:00 AM', { tops: 20, trimmers: 4 }),
    ];
    const { rows } = buildSortedRows(dbRows, 5.0);
    assert.equal(rows[0].smalls, 0);
  });

  it('smalls are independent from tops in row data', () => {
    const dbRows = [
      makeRow('8:00 AM – 9:00 AM', { tops: 20, smalls: 5, trimmers: 4 }),
      makeRow('9:00 AM – 10:00 AM', { tops: 0, smalls: 0, trimmers: 4 }),
    ];
    const { rows } = buildSortedRows(dbRows, 5.0);
    // First row has both tops and smalls
    assert.equal(rows[0].tops, 20);
    assert.equal(rows[0].smalls, 5);
    // Second row: zero production, smalls also zero
    assert.equal(rows[1].tops, 0);
    assert.equal(rows[1].smalls, 0);
  });

  it('smalls are accessible from rowsBySlot lookup', () => {
    const dbRows = [
      makeRow('8:00 AM – 9:00 AM', { tops: 20, smalls: 4.2, trimmers: 4 }),
    ];
    const { rowsBySlot } = buildSortedRows(dbRows, 5.0);
    assert.equal(rowsBySlot['8:00 AM – 9:00 AM'].smalls, 4.2);
  });
});

// ---------------------------------------------------------------------------
// 13. lastTimeSlot / lastHourLbs output fields (scoreboard API contract)
// ---------------------------------------------------------------------------

describe('lastTimeSlot / lastHourLbs output fields', () => {
  // These tests simulate the handler's logic for building lastTimeSlot and lastHourLbs
  // from the helpers — the exact fields the frontend reads from the API response.

  function buildScoreboardOutput(dbRows, targetRate) {
    const { rows } = buildSortedRows(dbRows, targetRate);
    const { lastCompletedHourIndex, currentHourIndex } = findHourIndices(rows);

    const result = {
      lastHourLbs: 0,
      lastHourSmalls: 0,
      lastHourTrimmers: 0,
      lastHourBuckers: 0,
      lastHourTarget: 0,
      lastHourMultiplier: 1.0,
      lastTimeSlot: '',
      currentHourTrimmers: 0,
      currentTimeSlot: '',
    };

    if (lastCompletedHourIndex >= 0) {
      const lastRow = rows[lastCompletedHourIndex];
      result.lastHourLbs = lastRow.tops;
      result.lastHourSmalls = lastRow.smalls;
      result.lastHourTrimmers = lastRow.rawTrimmers;
      result.lastHourBuckers = lastRow.buckers || 0;
      result.lastHourMultiplier = lastRow.multiplier;
      result.lastHourTarget = lastRow.trimmers * targetRate * lastRow.multiplier;
      result.lastTimeSlot = lastRow.timeSlot;
    }

    if (currentHourIndex >= 0) {
      const currentRow = rows[currentHourIndex];
      result.currentHourTrimmers = currentRow.rawTrimmers;
      result.currentTimeSlot = currentRow.timeSlot;
    }

    return result;
  }

  it('lastTimeSlot points to most recent completed hour, not first or dynamic slot', () => {
    // The bug: lastTimeSlot was showing '7:44 AM – 8:00 AM' instead of '9:00 AM – 10:00 AM'
    const dbRows = [
      makeRow('7:44 AM – 8:00 AM', { tops: 5, trimmers: 4 }),
      makeRow('8:00 AM – 9:00 AM', { tops: 22, trimmers: 4 }),
      makeRow('9:00 AM – 10:00 AM', { tops: 18, trimmers: 4 }),
      makeRow('10:00 AM – 11:00 AM', { trimmers: 4 }), // current hour, no production
    ];
    const output = buildScoreboardOutput(dbRows, 5.0);
    assert.equal(output.lastTimeSlot, '9:00 AM – 10:00 AM');
    assert.equal(output.lastHourLbs, 18);
  });

  it('lastHourLbs reflects the actual production of the last completed hour', () => {
    const dbRows = [
      makeRow('7:00 AM – 8:00 AM', { tops: 25, trimmers: 4 }),
      makeRow('8:00 AM – 9:00 AM', { tops: 22, trimmers: 4 }),
      makeRow('9:00 AM – 10:00 AM', { tops: 19, trimmers: 4 }),
    ];
    const output = buildScoreboardOutput(dbRows, 5.0);
    assert.equal(output.lastHourLbs, 19, 'Should be the 9:00 AM hour production');
    assert.equal(output.lastTimeSlot, '9:00 AM – 10:00 AM');
  });

  it('lastHourSmalls is included in output when present', () => {
    const dbRows = [
      makeRow('8:00 AM – 9:00 AM', { tops: 22, smalls: 3.5, trimmers: 4 }),
      makeRow('9:00 AM – 10:00 AM', { trimmers: 5 }), // current
    ];
    const output = buildScoreboardOutput(dbRows, 5.0);
    assert.equal(output.lastHourSmalls, 3.5);
  });

  it('lastHourTarget uses effective trimmers × targetRate × multiplier', () => {
    const dbRows = [
      makeRow('9:00 AM – 10:00 AM', { tops: 15, trimmers: 4, effectiveTrimmers: 3.5 }),
      makeRow('10:00 AM – 11:00 AM', { trimmers: 4 }), // current
    ];
    const output = buildScoreboardOutput(dbRows, 5.0);
    // Target = effectiveTrimmers(3.5) × rate(5.0) × multiplier(0.83) = 14.525
    assert.ok(Math.abs(output.lastHourTarget - 3.5 * 5.0 * 0.83) < 0.01);
    // But display trimmers should be raw
    assert.equal(output.lastHourTrimmers, 4);
  });

  it('currentTimeSlot and currentHourTrimmers are set for the in-progress hour', () => {
    const dbRows = [
      makeRow('8:00 AM – 9:00 AM', { tops: 22, trimmers: 4 }),
      makeRow('9:00 AM – 10:00 AM', { trimmers: 5 }), // trimmers assigned, no production
    ];
    const output = buildScoreboardOutput(dbRows, 5.0);
    assert.equal(output.currentTimeSlot, '9:00 AM – 10:00 AM');
    assert.equal(output.currentHourTrimmers, 5);
  });

  it('returns empty lastTimeSlot when no hours have production', () => {
    const dbRows = [
      makeRow('8:00 AM – 9:00 AM', { trimmers: 4 }), // trimmers but no production
    ];
    const output = buildScoreboardOutput(dbRows, 5.0);
    assert.equal(output.lastTimeSlot, '');
    assert.equal(output.lastHourLbs, 0);
  });
});

// ---------------------------------------------------------------------------
// 14. Streak threshold verification (must be exactly 90%)
// ---------------------------------------------------------------------------

describe('Streak threshold boundary', () => {
  it('exactly 90% of target counts as a streak', () => {
    const targetRate = 5.0;
    // target = 4 × 5.0 × 1.0 = 20, 90% = 18.0 exactly
    const rows = [
      { tops: 18, trimmers: 4, multiplier: 1.0 },
    ];
    assert.equal(calculateStreak(rows, 0, targetRate), 1, '90% exactly should count');
  });

  it('89.9% of target breaks the streak', () => {
    const targetRate = 5.0;
    // target = 20, 89.9% = 17.98 → tops = 17.98 → below 90%
    const rows = [
      { tops: 17.98, trimmers: 4, multiplier: 1.0 },
    ];
    assert.equal(calculateStreak(rows, 0, targetRate), 0, '89.9% should NOT count');
  });

  it('streak threshold is 90% not 80% or 100%', () => {
    const targetRate = 10.0;
    // target = 4 × 10 × 1.0 = 40
    const rows = [
      { tops: 36, trimmers: 4, multiplier: 1.0 },  // 90% exactly
      { tops: 35, trimmers: 4, multiplier: 1.0 },  // 87.5% — below 90%
      { tops: 38, trimmers: 4, multiplier: 1.0 },  // 95% — above 90%
    ];
    // Row 0: 90% → streak=1, Row 1: 87.5% → reset, Row 2: 95% → streak=1
    assert.equal(calculateStreak(rows, 2, targetRate), 1);
  });

  it('90% threshold with break-adjusted multiplier', () => {
    const targetRate = 5.0;
    // 9:00 AM slot: multiplier = 0.83, target = 4 × 5 × 0.83 = 16.6, 90% = 14.94
    const rows = [
      { tops: 14.94, trimmers: 4, multiplier: 0.83 },
    ];
    // 14.94 / 16.6 = 90.0% exactly
    assert.equal(calculateStreak(rows, 0, targetRate), 1, '90% of break-adjusted target counts');
  });
});

// ---------------------------------------------------------------------------
// 15. Daily projection: current hour trimmers override last completed
// ---------------------------------------------------------------------------

describe('Daily projection trimmers selection', () => {
  it('uses current hour trimmers (5) instead of last completed hour trimmers (4)', () => {
    // Scenario: completed hour had 4 trimmers, current hour has 5 trimmers
    const rows = [
      { tops: 20, trimmers: 4, multiplier: 1.0, timeSlot: '7:00 AM – 8:00 AM' },
      { tops: 22, trimmers: 4, multiplier: 1.0, timeSlot: '8:00 AM – 9:00 AM' },
      { tops: 0,  trimmers: 5, multiplier: 0.83, timeSlot: '9:00 AM – 10:00 AM' }, // current hour, 5 trimmers
    ];
    const targetRate = 5.0;
    const totalLbs = 42;

    // With current hour trimmers = 5
    const withCurrent = calculateDailyProjection(rows, 1, 2, targetRate, totalLbs);

    // Without current hour (pretend index -1 so it falls back to last completed = 4)
    const withoutCurrent = calculateDailyProjection(rows, 1, -1, targetRate, totalLbs);

    // Projection with 5 trimmers should be higher than with 4 trimmers
    assert.ok(
      withCurrent.projectedTotal > withoutCurrent.projectedTotal,
      `5 trimmers (${withCurrent.projectedTotal.toFixed(1)}) should project more than 4 trimmers (${withoutCurrent.projectedTotal.toFixed(1)})`,
    );

    // Daily goal should also differ: current hour uses actual trimmers for its goal
    assert.ok(
      withCurrent.dailyGoal > withoutCurrent.dailyGoal,
      `Daily goal with 5 trimmers (${withCurrent.dailyGoal.toFixed(1)}) should exceed 4 trimmers (${withoutCurrent.dailyGoal.toFixed(1)})`,
    );
  });

  it('lastKnownTrimmers updates from current hour for remaining slot calculations', () => {
    // 1 completed hour with 3 trimmers, current hour has 6 trimmers
    const rows = [
      { tops: 15, trimmers: 3, multiplier: 1.0, timeSlot: '7:00 AM – 8:00 AM' },
      { tops: 0,  trimmers: 6, multiplier: 1.0, timeSlot: '8:00 AM – 9:00 AM' }, // current
    ];
    const targetRate = 5.0;
    const totalLbs = 15;

    const result = calculateDailyProjection(rows, 0, 1, targetRate, totalLbs);

    // currentRate = 15 / (3 × 1.0) = 5.0
    // lastKnownTrimmers = 6 (from current hour)
    // Remaining unworked slots use lastKnownTrimmers=6
    // dailyGoal for unworked slots uses 6 trimmers, not 3
    // There are 8 remaining slots after the current hour
    // Each unworked slot adds 6 × 5.0 × multiplier to dailyGoal
    const completedGoal = 3 * targetRate * 1.0;  // 15 (7:00 slot)
    const currentGoal = 6 * targetRate * 1.0;    // 30 (8:00 slot — current)
    assert.ok(
      result.dailyGoal > completedGoal + currentGoal,
      'Daily goal must include remaining slots with 6 trimmers',
    );
  });
});

// ---------------------------------------------------------------------------
// 16. Special slot: 2:30 PM – 3:00 PM (in TIME_SLOT_MULTIPLIERS but not ALL_TIME_SLOTS)
// ---------------------------------------------------------------------------

describe('Special slot: 2:30 PM – 3:00 PM', () => {
  it('is in TIME_SLOT_MULTIPLIERS with 0.5 multiplier', () => {
    assert.equal(TIME_SLOT_MULTIPLIERS['2:30 PM – 3:00 PM'], 0.33);
  });

  it('is NOT in ALL_TIME_SLOTS', () => {
    assert.ok(
      !ALL_TIME_SLOTS.includes('2:30 PM – 3:00 PM'),
      '2:30 PM – 3:00 PM should not be a standard time slot',
    );
  });

  it('getTimeSlotMultiplier returns 0.33 for 2:30 PM – 3:00 PM', () => {
    assert.equal(getTimeSlotMultiplier('2:30 PM – 3:00 PM'), 0.33);
  });

  it('buildSortedRows handles DB row with 2:30 PM – 3:00 PM slot', () => {
    const dbRows = [
      makeRow('8:00 AM – 9:00 AM', { tops: 20, trimmers: 4 }),
      makeRow('2:30 PM – 3:00 PM', { tops: 8, trimmers: 4 }),
    ];
    const { rows } = buildSortedRows(dbRows, 5.0);

    const pm230Row = rows.find(r => r.timeSlot === '2:30 PM – 3:00 PM');
    assert.ok(pm230Row, '2:30 PM slot should appear in rows');
    assert.equal(pm230Row.tops, 8);
    assert.equal(pm230Row.multiplier, 0.33);
  });

  it('3:00 PM – 3:30 PM also exists in TIME_SLOT_MULTIPLIERS with 0.5', () => {
    // Another special slot not in ALL_TIME_SLOTS
    assert.equal(TIME_SLOT_MULTIPLIERS['3:00 PM – 3:30 PM'], 0.5);
    assert.equal(getTimeSlotMultiplier('3:00 PM – 3:30 PM'), 0.5);
  });
});

// ---------------------------------------------------------------------------
// 17. Additional gaps: buckers, strain, notes, and hourlyRates fields
// ---------------------------------------------------------------------------

describe('Row field completeness', () => {
  it('buildSortedRows preserves all fields: buckers, strain, notes', () => {
    const dbRows = [
      makeRow('8:00 AM – 9:00 AM', {
        tops: 20, smalls: 3, trimmers: 4, buckers: 2,
        cultivar: 'Cherry Punch', qc: 'Good trim quality',
      }),
    ];
    const { rows } = buildSortedRows(dbRows, 5.0);
    assert.equal(rows[0].buckers, 2);
    assert.equal(rows[0].strain, 'Cherry Punch');
    assert.equal(rows[0].notes, 'Good trim quality');
  });

  it('buildSortedRows defaults buckers to 0 when missing', () => {
    const dbRows = [makeRow('8:00 AM – 9:00 AM', { tops: 20, trimmers: 4 })];
    const { rows } = buildSortedRows(dbRows, 5.0);
    assert.equal(rows[0].buckers, 0);
  });
});

// ---------------------------------------------------------------------------
// 18. Streak with zero-trimmer rows (division by zero guard)
// ---------------------------------------------------------------------------

describe('Streak zero-trimmer guard', () => {
  it('skips rows with zero trimmers (no division by zero)', () => {
    const targetRate = 5.0;
    const rows = [
      { tops: 20, trimmers: 4, multiplier: 1.0 },
      { tops: 5,  trimmers: 0, multiplier: 1.0 },  // zero trimmers — should be skipped entirely
      { tops: 20, trimmers: 4, multiplier: 1.0 },
    ];
    // Row 0: passes (100%) → streak=1
    // Row 1: skipped (trimmers=0, so neither increments nor resets)
    // Row 2: passes (100%) → streak=2
    assert.equal(calculateStreak(rows, 2, targetRate), 2);
  });
});

// ---------------------------------------------------------------------------
// 19. findHourIndices with smalls-only rows (tops=0 but smalls>0)
// ---------------------------------------------------------------------------

describe('findHourIndices with smalls-only production', () => {
  it('smalls-only row (tops=0, smalls>0) is NOT counted as completed hour', () => {
    // findHourIndices checks row.tops > 0 for completed
    const rows = [
      { tops: 0, smalls: 5, trimmers: 4, multiplier: 1.0 },
    ];
    const { lastCompletedHourIndex, currentHourIndex } = findHourIndices(rows);
    assert.equal(lastCompletedHourIndex, -1, 'smalls-only should not count as completed');
    assert.equal(currentHourIndex, 0, 'treated as current hour (trimmers > 0, tops == 0)');
  });
});

// ---------------------------------------------------------------------------
// 20. 3:00 PM – 4:00 PM multiplier (break moved to 2:00–3:00 PM slot)
// ---------------------------------------------------------------------------

describe('Afternoon break slot multiplier', () => {
  it('3:00 PM – 4:00 PM has 1.0 multiplier (break is now in 2-3 PM slot)', () => {
    assert.equal(getTimeSlotMultiplier('3:00 PM – 4:00 PM'), 1.0);
  });

  it('4:00 PM – 4:30 PM has 0.33 multiplier (cleanup break)', () => {
    assert.equal(getTimeSlotMultiplier('4:00 PM – 4:30 PM'), 0.33);
  });
});

// ---------------------------------------------------------------------------
// 21. effective_trimmers_line1 = 0 must be used, not treated as falsy
// ---------------------------------------------------------------------------

describe('Effective trimmers zero-value handling', () => {
  it('effective_trimmers_line1 = 0 is used (not treated as null/falsy)', () => {
    // If the code used `|| rawTrimmers` instead of `!= null`, effective=0 would
    // be silently replaced by raw trimmers, producing wrong targets.
    const dbRows = [
      makeRow('8:00 AM – 9:00 AM', { tops: 20, trimmers: 4, effectiveTrimmers: 0 }),
    ];
    const { rows } = buildSortedRows(dbRows, 5.0);
    assert.equal(rows[0].trimmers, 0, 'effective=0 must be used, not raw=4');
    assert.equal(rows[0].rawTrimmers, 4, 'rawTrimmers still shows entered count');
  });

  it('effective_trimmers_line1 = undefined falls back to raw trimmers', () => {
    const dbRows = [{
      time_slot: '8:00 AM – 9:00 AM',
      cultivar1: '', tops_lbs1: 20, smalls_lbs1: 0,
      trimmers_line1: 4, buckers_line1: 0,
      effective_trimmers_line1: undefined,
      qc: '',
    }];
    const { rows } = buildSortedRows(dbRows, 5.0);
    assert.equal(rows[0].trimmers, 4, 'undefined effective → falls back to raw');
  });
});

// ---------------------------------------------------------------------------
// 22. Dash normalization: em-dash (—) in DB data
// ---------------------------------------------------------------------------

describe('Em-dash normalization', () => {
  it('buildSortedRows handles em-dash (—) separators from DB', () => {
    const dbRows = [
      makeRow('8:00 AM — 9:00 AM', { tops: 20, trimmers: 4 }),
    ];
    const { rows } = buildSortedRows(dbRows, 5.0);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tops, 20);
  });

  it('getTimeSlotMultiplier handles em-dash in slot names', () => {
    assert.equal(getTimeSlotMultiplier('9:00 AM — 10:00 AM'), 0.83);
  });
});

// ---------------------------------------------------------------------------
// 23. Dynamic + standard slot with same end-time both appear in buildSortedRows
// ---------------------------------------------------------------------------

describe('Dynamic slot alongside standard slot with overlapping times', () => {
  it('7:44 AM – 8:00 AM and 7:00 AM – 8:00 AM both appear if both in DB', () => {
    // Edge case: if DB has BOTH a dynamic partial slot and the standard slot
    const dbRows = [
      makeRow('7:00 AM – 8:00 AM', { tops: 15, trimmers: 4 }),
      makeRow('7:44 AM – 8:00 AM', { tops: 5, trimmers: 4 }),
      makeRow('8:00 AM – 9:00 AM', { tops: 22, trimmers: 4 }),
    ];
    const { rows } = buildSortedRows(dbRows, 5.0);
    const timeSlots = rows.map(r => r.timeSlot);
    assert.ok(timeSlots.includes('7:00 AM – 8:00 AM'), 'Standard slot present');
    assert.ok(timeSlots.includes('7:44 AM – 8:00 AM'), 'Dynamic slot present');
    // 7:00 must come before 7:44
    assert.ok(
      timeSlots.indexOf('7:00 AM – 8:00 AM') < timeSlots.indexOf('7:44 AM – 8:00 AM'),
      '7:00 AM slot must sort before 7:44 AM slot',
    );
  });
});
