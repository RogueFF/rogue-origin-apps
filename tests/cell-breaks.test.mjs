// The crew's breaks on the cell screen (src/js/cell/breaks.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BREAKS, breakAt, breakMsBetween, clockOf, pacificMinutes } from '../src/js/cell/breaks.mjs';

// Tuesday 2026-11-10 is PST (UTC-8): 9:00 am Pacific = 17:00 UTC.
const at = (hhmm, day = '2026-11-10') => Date.parse(`${day}T${hhmm}:00-08:00`);
const MIN = 60000;

test('the three breaks, as Koa gave them', () => {
  assert.deepEqual(BREAKS.map(b => [clockOf(b.start), clockOf(b.end)]), [['9:00', '9:10'], ['12:00', '12:30'], ['2:30', '2:40']]);
  assert.equal(breakAt(9 * 60).kind, 'break');
  assert.equal(breakAt(9 * 60 + 9.99).start, 540);
  assert.equal(breakAt(9 * 60 + 10), null, 'the break ends at 9:10');
  assert.equal(breakAt(12 * 60 + 15).kind, 'lunch');
  assert.equal(breakAt(14 * 60 + 35).start, 870);
  assert.equal(breakAt(16 * 60 + 25), null, '4:20 cleanup is not a break');
  assert.equal(breakAt(8 * 60 + 59), null);
});

test('Pacific minutes, through DST', () => {
  assert.equal(pacificMinutes(at('09:00')), 540);
  assert.equal(pacificMinutes(at('12:30') + 30000), 750.5);
  assert.equal(pacificMinutes(Date.parse('2026-07-15T09:00:00-07:00')), 540, 'summer, PDT');
});

test('break time inside a gap', () => {
  assert.equal(breakMsBetween(at('08:00'), at('08:55')), 0);
  assert.equal(breakMsBetween(at('08:55'), at('09:05')), 5 * MIN, 'slept into the break');
  assert.equal(breakMsBetween(at('08:55'), at('09:20')), 10 * MIN, 'slept through it');
  assert.equal(breakMsBetween(at('09:05'), at('09:07')), 2 * MIN, 'inside it');
  assert.equal(breakMsBetween(at('07:00'), at('16:30')), 50 * MIN, 'the whole day: 10 + 30 + 10');
  assert.equal(breakMsBetween(at('15:00'), at('09:05', '2026-11-11')), 5 * MIN, 'overnight into tomorrow morning');
  assert.equal(breakMsBetween(at('12:10') + 1234, at('12:40')), 20 * MIN - 1234, 'to the millisecond');
});
