/**
 * The dashboard handler end to end on a fake D1: the day view and the daily list
 * both carry the slot-length hours (lib/labor-split.js), and nothing 500s.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashboard } from '../src/handlers/production/scoreboard.js';

const DAY = '2026-11-10';
const ROWS = [
  ['7:03 AM – 8:00 AM', 24, 8.3, 10], ['8:00 AM – 9:00 AM', 24, 7.1, 0], ['10:00 AM – 11:00 AM', 23, 7.7, 0],
  ['11:00 AM – 12:00 PM', 20, 5.8, 10], ['12:30 PM – 1:00 PM', 15, 2.7, 0], ['1:00 PM – 2:00 PM', 13, 3.5, 0],
  ['2:00 PM – 3:00 PM', 13, 2.8, 0], ['3:00 PM – 4:00 PM', 17, 3.9, 0], ['4:00 PM – 4:30 PM', 17, 1.2, 0],
].map(([time_slot, t, tops, smalls]) => ({ production_date: DAY, time_slot, trimmers_line1: t, buckers_line1: 0, tzero_line1: 1, tops_lbs1: tops, smalls_lbs1: smalls, cultivar1: '2026 - Lifter / Sungrown' }));

// Answers the labor-row queries with ROWS, the daily aggregate with their sums, everything else empty.
function fakeDb() {
  const answer = (sql) => {
    if (/SELECT production_date, time_slot, trimmers_line1, buckers_line1, tzero_line1, tops_lbs1, smalls_lbs1\s+FROM monthly_production/.test(sql)) return ROWS;
    if (/GROUP BY production_date\s+ORDER BY production_date/.test(sql)) {
      return [{ production_date: DAY, total_tops: 43, total_smalls: 20, trimmer_hours: 166, bucker_hours: 0, tzero_hours: 9, operator_hours: 175, hours_with_data: 9, dominant_cultivar: '2026 - Lifter / Sungrown', peak_crew: 25, notes: '' }];
    }
    return [];
  };
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    all: async () => ({ results: answer(sql, args) }),
    first: async () => answer(sql, args)[0] ?? null,
    run: async () => ({ success: true }),
  });
  return { prepare: (sql) => stmt(sql) };
}

test('dashboard for a past day: hours by slot length in the day view and the daily list', async () => {
  const res = await dashboard({ start: DAY, end: DAY, date: DAY }, { DB: fakeDb() });
  assert.equal(res.status, 200);
  const body = await res.json();
  const data = body.data || body;
  const day = (data.daily || []).find(d => d.date === DAY);
  assert.ok(day, 'the day is in the daily list');
  assert.ok(Math.abs(day.operatorHours - 166.5) < 0.1, `daily operatorHours ${day.operatorHours}`);
  // the day view (today here: no cost config in the fake DB, so the costs are 0)
  assert.ok(Math.abs(data.today.operatorHours - 166.5) < 0.1, `today operatorHours ${data.today.operatorHours}`);
  assert.equal(data.today.totalTops, 43);
});
