import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pacificDay, pacificParts, justEndedHour, sqliteUtc, parseSqliteUtc } from '../src/lib/pacific.js';

test('pacificDay: 2am UTC is still the previous Pacific day', () => {
  assert.equal(pacificDay(new Date('2026-10-15T02:00:00Z')), '2026-10-14');
});

test('pacificParts across the November DST change', () => {
  // 2026-11-01 09:30 UTC = 02:30 PDT? No: clocks fell back at 2am, so it is 01:30 PST.
  assert.deepEqual(pacificParts(new Date('2026-11-01T09:30:00Z')), { day: '2026-11-01', hour: 1, minute: 30 });
  // PDT in October: 17:07 UTC = 10:07 PDT
  assert.deepEqual(pacificParts(new Date('2026-10-15T17:07:00Z')), { day: '2026-10-15', hour: 10, minute: 7 });
  // PST in November: 17:07 UTC = 09:07 PST
  assert.deepEqual(pacificParts(new Date('2026-11-15T17:07:00Z')), { day: '2026-11-15', hour: 9, minute: 7 });
});

test('justEndedHour: at 10:07 the hour that just ended is 09:00', () => {
  assert.deepEqual(justEndedHour(new Date('2026-10-15T17:07:00Z')), { harvest_date: '2026-10-15', hour_start: '09:00' });
});

test('justEndedHour: at 00:xx nothing ended today', () => {
  assert.equal(justEndedHour(new Date('2026-10-15T07:20:00Z')), null); // 00:20 PDT
});

test('sqliteUtc round-trips through parseSqliteUtc', () => {
  const d = new Date('2026-10-15T17:07:09Z');
  assert.equal(sqliteUtc(d), '2026-10-15 17:07:09');
  assert.equal(parseSqliteUtc('2026-10-15 17:07:09').getTime(), d.getTime());
});
