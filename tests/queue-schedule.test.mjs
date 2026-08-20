/**
 * Unit tests for the production queue scheduler.
 *
 * This is where the three pieces meet: demand pooled by cultivar, a lot sized
 * by whichever form binds, and the work calendar turning hours into a date.
 *
 * The load-bearing claim it must satisfy: an order finishes when its SLOWEST
 * cultivar finishes, not when its own hours are done. An order needing three
 * cultivars is spread across three points in the queue, so its promise date is
 * set by wherever the last of them lands.
 *
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleQueue } from '../workers/src/lib/queue-schedule.js';

const THU = '2026-08-20';                       // Thursday
const START = { date: THU, minutes: 7 * 60 };

// Real measured figures for these cultivars (see migration 0017 header).
const RATES = {
  'sour-lifter': { ratePerTrimmerHour: 1.77, topsFraction: 0.601, basis: 'all-years' },
  lifter: { ratePerTrimmerHour: 1.93, topsFraction: 0.508, basis: 'all-years' },
  'berry-bliss': { ratePerTrimmerHour: 1.88, topsFraction: 0.530, basis: 'all-years' },
  'alium-og': { ratePerTrimmerHour: 1.91, topsFraction: 0.501, basis: 'fallback' },
};

const pool = (cultivarId, topsLbs, smallsLbs, orderIds) =>
  ({ cultivarId, topsLbs, smallsLbs, orderIds: new Set(orderIds) });

const base = { rates: RATES, crew: 8, start: START };

// --- shape ---------------------------------------------------------------

test('an empty order book schedules nothing', () => {
  const r = scheduleQueue({ ...base, pools: [] });
  assert.deepEqual(r.runs, []);
  assert.deepEqual(r.orders, {});
});

test('a run reports the lot it needs, not the pounds ordered', () => {
  // 484 lb of tops at 60.1% tops needs an 805 lb lot.
  const r = scheduleQueue({ ...base, pools: [pool('sour-lifter', 484, 0, ['MO-1'])] });
  assert.equal(Math.round(r.runs[0].lotLbs), 805);
  assert.equal(r.runs[0].binding, 'tops');
  assert.ok(r.runs[0].surplusSmalls > 300, 'the smalls that fall out are real inventory');
});

test('duration comes from the lot, the rate and the crew', () => {
  const r = scheduleQueue({ ...base, pools: [pool('sour-lifter', 484, 0, ['MO-1'])] });
  // 805 lb / (1.77 lb per trimmer-hour x 8 trimmers) = 56.8 hours
  assert.ok(Math.abs(r.runs[0].hours - 56.8) < 0.5, `got ${r.runs[0].hours}`);
});

test('halving the crew roughly doubles the time', () => {
  const p = [pool('sour-lifter', 484, 0, ['MO-1'])];
  const eight = scheduleQueue({ ...base, pools: p }).runs[0].hours;
  const four = scheduleQueue({ ...base, crew: 4, pools: p }).runs[0].hours;
  assert.ok(Math.abs(four - eight * 2) < 0.01);
});

test('a crew of zero is refused rather than producing an infinite date', () => {
  assert.throws(
    () => scheduleQueue({ ...base, crew: 0, pools: [pool('lifter', 10, 0, ['MO-1'])] }),
    /crew/i,
  );
});

// --- sequencing ----------------------------------------------------------

test('runs are sequential: each starts where the previous one finished', () => {
  const r = scheduleQueue({
    ...base,
    pools: [pool('lifter', 100, 0, ['MO-1']), pool('berry-bliss', 100, 0, ['MO-2'])],
  });
  assert.deepEqual(r.runs[1].start, r.runs[0].finish);
});

test('rank decides the order, not the order the pools arrive in', () => {
  const pools = [pool('lifter', 100, 0, ['MO-1']), pool('berry-bliss', 100, 0, ['MO-2'])];
  const r = scheduleQueue({ ...base, pools, rank: ['berry-bliss', 'lifter'] });
  assert.deepEqual(r.runs.map(x => x.cultivarId), ['berry-bliss', 'lifter']);
});

test('a cultivar missing from the rank still gets scheduled, after the ranked ones', () => {
  const pools = [pool('lifter', 100, 0, ['MO-1']), pool('berry-bliss', 100, 0, ['MO-2'])];
  const r = scheduleQueue({ ...base, pools, rank: ['berry-bliss'] });
  assert.deepEqual(r.runs.map(x => x.cultivarId), ['berry-bliss', 'lifter']);
});

test('no run finishes before the queue starts', () => {
  const r = scheduleQueue({
    ...base,
    pools: [pool('lifter', 50, 0, ['MO-1']), pool('berry-bliss', 50, 0, ['MO-1'])],
  });
  for (const run of r.runs) assert.ok(run.finish.date >= THU);
});

// --- the load-bearing claim ----------------------------------------------

test('an order finishes with its slowest cultivar, not its first', () => {
  // MO-1 needs Lifter (run 1) and Berry Bliss (run 2). Its date is run 2's.
  const r = scheduleQueue({
    ...base,
    pools: [pool('lifter', 100, 0, ['MO-1']), pool('berry-bliss', 400, 0, ['MO-1'])],
    rank: ['lifter', 'berry-bliss'],
  });
  assert.deepEqual(r.orders['MO-1'].finish, r.runs[1].finish);
  assert.equal(r.orders['MO-1'].heldBy, 'berry-bliss');
});

test('the order held up by a late run says so even when its own lines are early', () => {
  const r = scheduleQueue({
    ...base,
    pools: [
      pool('lifter', 100, 0, ['MO-1', 'MO-2']),
      pool('berry-bliss', 400, 0, ['MO-2']),
    ],
    rank: ['lifter', 'berry-bliss'],
  });
  // MO-1 only needs Lifter, so it clears first.
  assert.deepEqual(r.orders['MO-1'].finish, r.runs[0].finish);
  assert.equal(r.orders['MO-1'].heldBy, 'lifter');
  // MO-2 waits for Berry Bliss.
  assert.equal(r.orders['MO-2'].heldBy, 'berry-bliss');
});

test('one pooled run serves every order needing that cultivar', () => {
  const r = scheduleQueue({
    ...base,
    pools: [pool('lifter', 231, 220, ['MO-1', 'MO-2'])],
  });
  assert.equal(r.runs.length, 1);
  assert.deepEqual([...r.runs[0].orderIds].sort(), ['MO-1', 'MO-2']);
  assert.deepEqual(r.orders['MO-1'].finish, r.orders['MO-2'].finish);
});

// --- provenance ----------------------------------------------------------

test('a run priced off the fallback is flagged, so the board can say so', () => {
  const r = scheduleQueue({ ...base, pools: [pool('alium-og', 220, 0, ['MO-1'])] });
  assert.equal(r.runs[0].rateBasis, 'fallback');
  assert.equal(r.runs[0].estimated, true);
});

test('a run priced off real history is not flagged', () => {
  const r = scheduleQueue({ ...base, pools: [pool('lifter', 220, 0, ['MO-1'])] });
  assert.equal(r.runs[0].rateBasis, 'all-years');
  assert.equal(r.runs[0].estimated, false);
});

test('a cultivar with no rate at all falls back rather than throwing', () => {
  const r = scheduleQueue({
    ...base,
    pools: [pool('never-grown', 100, 0, ['MO-1'])],
    fallback: { ratePerTrimmerHour: 1.91, topsFraction: 0.501 },
  });
  assert.equal(r.runs[0].rateBasis, 'fallback');
  assert.ok(r.runs[0].hours > 0);
});

test('a date sitting behind a guessed run is itself a guess', () => {
  // Alium OG has no trim history, so run 1 is priced off the farm average.
  // Lifter has 7,000+ hours, but run 2 cannot start until run 1 ends — so
  // MO-1's date inherits run 1's uncertainty even though its holding run is
  // the well-measured one. Reporting it as firm would be a lie of omission.
  const r = scheduleQueue({
    ...base,
    pools: [pool('alium-og', 300, 0, ['MO-2']), pool('lifter', 100, 0, ['MO-1'])],
    rank: ['alium-og', 'lifter'],
  });
  assert.equal(r.runs[0].estimated, true);
  assert.equal(r.runs[1].estimated, false, 'the run itself is well measured');
  assert.equal(r.runs[1].dependsOnEstimate, true, 'but its start time is not');
  assert.equal(r.orders['MO-1'].estimated, true);
});

test('a queue with no fallback anywhere reports firm dates', () => {
  const r = scheduleQueue({
    ...base,
    pools: [pool('lifter', 100, 0, ['MO-1']), pool('berry-bliss', 100, 0, ['MO-2'])],
    rank: ['lifter', 'berry-bliss'],
  });
  assert.equal(r.orders['MO-1'].estimated, false);
  assert.equal(r.orders['MO-2'].estimated, false);
});
