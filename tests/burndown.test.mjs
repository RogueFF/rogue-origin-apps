/**
 * Unit tests for burn-down — crediting recorded production to waiting orders.
 *
 * The rule under test, in the operator's words: "If an order is put in the day
 * before and it's first in line, any hourly entries with that cultivar should
 * count towards that order."
 *
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocate, slotStartMinutes, moment, impliedStatus } from '../workers/src/lib/burndown.js';

const near = (a, b, tol = 0.001) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${a} to be within ${tol} of ${b}`);

/** A line, with the boilerplate defaulted. */
const line = (o) => ({
  lineId: 'L1', orderId: 'MO-1', cultivarId: 'berry-bliss', form: 'tops',
  qtyLbs: 100, rank: 0, sortOrder: 0, accrualStart: null, ...o,
});

/** An hourly entry. */
const entry = (o) => ({
  date: '2026-08-20', timeSlot: '9:00 AM – 10:00 AM',
  cultivarId: 'berry-bliss', topsLbs: 0, smallsLbs: 0, ...o,
});

// --- the time_slot sorting trap ------------------------------------------

test('slot start is read from the start of the range, not the end', () => {
  assert.equal(slotStartMinutes('9:00 AM – 10:00 AM'), 9 * 60);
  assert.equal(slotStartMinutes('7:21 AM – 8:00 AM'), 7 * 60 + 21);
  assert.equal(slotStartMinutes('12:30 PM – 1:00 PM'), 12 * 60 + 30);
});

test('noon and midnight do not fall a half day out', () => {
  assert.equal(slotStartMinutes('12:00 AM – 1:00 AM'), 0);
  assert.equal(slotStartMinutes('12:00 PM – 1:00 PM'), 12 * 60);
});

test('a hyphen or em-dash separates a slot just as an en-dash does', () => {
  assert.equal(slotStartMinutes('9:00 AM - 10:00 AM'), 9 * 60);
  assert.equal(slotStartMinutes('9:00 AM — 10:00 AM'), 9 * 60);
});

test('any separator works, because only the leading time matters', () => {
  // Real rows have come through with the en-dash mangled by an encoding hop.
  // Splitting on a known separator turns those into unreadable slots and quietly
  // drops the hour; reading the leading token does not care what follows it.
  assert.equal(slotStartMinutes('9:00 AM â€“ 10:00 AM'), 9 * 60);
  assert.equal(slotStartMinutes('9:00 AM to 10:00 AM'), 9 * 60);
  assert.equal(slotStartMinutes('9:00 AM'), 9 * 60);
  assert.equal(slotStartMinutes(' 7:21 AM – 8:00 AM'), 7 * 60 + 21);
});

test('an unreadable slot is refused rather than guessed at', () => {
  assert.equal(slotStartMinutes('sometime after lunch'), null);
  assert.equal(slotStartMinutes(''), null);
  assert.equal(slotStartMinutes(null), null);
});

test('THE TRAP: afternoon slots sort before morning ones as raw text', () => {
  // This is why the allocator cannot ORDER BY time_slot. If it did, the 12:30 PM
  // entry would be handed to the allocator first and would fill the order that
  // the 7:21 AM work should have filled.
  assert.ok('12:30 PM – 1:00 PM' < '7:21 AM – 8:00 AM',
    'if this ever stops being true the trap is gone and this test can go');
  assert.ok(slotStartMinutes('12:30 PM – 1:00 PM') > slotStartMinutes('7:21 AM – 8:00 AM'));
});

test('a moment is a comparable Pacific wall-clock string', () => {
  assert.equal(moment('2026-08-20', 9 * 60), '2026-08-20 09:00');
  assert.equal(moment('2026-08-20', 7 * 60 + 21), '2026-08-20 07:21');
  // Zero-padding is what makes plain string comparison chronological.
  assert.ok(moment('2026-08-20', 7 * 60 + 21) < moment('2026-08-20', 12 * 60 + 30));
});

// --- allocation ----------------------------------------------------------

test('recorded pounds land on the line that wants that cultivar and form', () => {
  const r = allocate({
    lines: [line({ qtyLbs: 100 })],
    entries: [entry({ topsLbs: 30 })],
  });
  near(r.byLine.L1.doneLbs, 30);
  near(r.byLine.L1.remainingLbs, 70);
  near(r.byLine.L1.pct, 0.3);
  assert.equal(r.unallocated.length, 0);
});

test('tops and smalls fill their own lines and never each other', () => {
  const r = allocate({
    lines: [
      line({ lineId: 'T', form: 'tops', qtyLbs: 100 }),
      line({ lineId: 'S', form: 'smalls', qtyLbs: 100, sortOrder: 1 }),
    ],
    entries: [entry({ topsLbs: 30, smallsLbs: 40 })],
  });
  near(r.byLine.T.doneLbs, 30);
  near(r.byLine.S.doneLbs, 40);
});

test('the first order in line fills before the second', () => {
  const r = allocate({
    lines: [
      line({ lineId: 'A', orderId: 'MO-1', rank: 0, qtyLbs: 50 }),
      line({ lineId: 'B', orderId: 'MO-2', rank: 1, qtyLbs: 50 }),
    ],
    entries: [entry({ topsLbs: 30 })],
  });
  near(r.byLine.A.doneLbs, 30);
  near(r.byLine.B.doneLbs, 0);
});

test('overflow runs on to the next order rather than being lost', () => {
  const r = allocate({
    lines: [
      line({ lineId: 'A', orderId: 'MO-1', rank: 0, qtyLbs: 50 }),
      line({ lineId: 'B', orderId: 'MO-2', rank: 1, qtyLbs: 50 }),
    ],
    entries: [entry({ topsLbs: 80 })],
  });
  near(r.byLine.A.doneLbs, 50);
  near(r.byLine.B.doneLbs, 30);
  assert.equal(r.unallocated.length, 0);
});

test('within one order, the earlier line item fills first', () => {
  const r = allocate({
    lines: [
      line({ lineId: 'second', sortOrder: 3, qtyLbs: 50 }),
      line({ lineId: 'first', sortOrder: 0, qtyLbs: 50 }),
    ],
    entries: [entry({ topsLbs: 60 })],
  });
  near(r.byLine.first.doneLbs, 50);
  near(r.byLine.second.doneLbs, 10);
});

test('rank beats sort order — a later line of a leading order wins', () => {
  const r = allocate({
    lines: [
      line({ lineId: 'lead-late', orderId: 'MO-1', rank: 0, sortOrder: 9, qtyLbs: 50 }),
      line({ lineId: 'next-early', orderId: 'MO-2', rank: 1, sortOrder: 0, qtyLbs: 50 }),
    ],
    entries: [entry({ topsLbs: 40 })],
  });
  near(r.byLine['lead-late'].doneLbs, 40);
  near(r.byLine['next-early'].doneLbs, 0);
});

// --- accrual start -------------------------------------------------------

test('an order is not credited with work done before it existed', () => {
  const r = allocate({
    lines: [line({ accrualStart: '2026-08-20 14:00' })],
    entries: [entry({ timeSlot: '9:00 AM – 10:00 AM', topsLbs: 30 })],
  });
  near(r.byLine.L1.doneLbs, 0);
  assert.equal(r.unallocated.length, 1);
  assert.equal(r.unallocated[0].reason, 'no-open-line');
  near(r.unallocated[0].lbs, 30);
});

test('work at the accrual moment itself counts', () => {
  const r = allocate({
    lines: [line({ accrualStart: '2026-08-20 09:00' })],
    entries: [entry({ timeSlot: '9:00 AM – 10:00 AM', topsLbs: 30 })],
  });
  near(r.byLine.L1.doneLbs, 30);
});

test('an order entered yesterday collects today, which is the operator example', () => {
  const r = allocate({
    lines: [line({ accrualStart: '2026-08-19 15:30', qtyLbs: 100 })],
    entries: [
      entry({ date: '2026-08-19', timeSlot: '9:00 AM – 10:00 AM', topsLbs: 11 }),
      entry({ date: '2026-08-20', timeSlot: '7:21 AM – 8:00 AM', topsLbs: 8.9 }),
    ],
  });
  // Yesterday morning predates the order; this morning does not.
  near(r.byLine.L1.doneLbs, 8.9);
});

test('a later order takes the overflow only from after its own start', () => {
  const r = allocate({
    lines: [
      line({ lineId: 'A', orderId: 'MO-1', rank: 0, qtyLbs: 10, accrualStart: '2026-08-20 07:00' }),
      line({ lineId: 'B', orderId: 'MO-2', rank: 1, qtyLbs: 90, accrualStart: '2026-08-20 13:00' }),
    ],
    entries: [
      entry({ timeSlot: '8:00 AM – 9:00 AM', topsLbs: 30 }),
      entry({ timeSlot: '2:00 PM – 3:00 PM', topsLbs: 30 }),
    ],
  });
  near(r.byLine.A.doneLbs, 10);      // capped by its own quantity
  near(r.byLine.B.doneLbs, 30);      // only the afternoon entry
  near(r.unallocated.reduce((s, u) => s + u.lbs, 0), 20);  // the morning overflow
});

// --- chronology matters to the outcome, not just the ordering ------------

test('the morning fills the leading order even when logged after the afternoon', () => {
  // Both entries are for the same cultivar, and only 10 lb of capacity exists on
  // the leading order. Which entry fills it depends entirely on chronological
  // ordering — and the afternoon row sorts FIRST as raw text.
  const r = allocate({
    lines: [
      line({ lineId: 'A', orderId: 'MO-1', rank: 0, qtyLbs: 10, accrualStart: '2026-08-20 07:00' }),
      line({ lineId: 'B', orderId: 'MO-2', rank: 1, qtyLbs: 10, accrualStart: '2026-08-20 12:00' }),
    ],
    entries: [
      entry({ timeSlot: '12:30 PM – 1:00 PM', topsLbs: 10 }),
      entry({ timeSlot: '7:21 AM – 8:00 AM', topsLbs: 10 }),
    ],
  });
  // Morning work (7:21) hits A, filling it. B did not exist at 7:21, so the only
  // pounds that can reach B are the 12:30 ones. Reverse the sort and the 12:30
  // entry fills A instead, leaving B with nothing and the morning unallocated —
  // so this asserts chronology, not just that both numbers happen to be 10.
  near(r.byLine.A.doneLbs, 10);
  near(r.byLine.B.doneLbs, 10);
});

// --- a finished order keeps its claim ------------------------------------

test('an order that already consumed its pounds keeps them, once it is finished', () => {
  // Allocation is a replay, not a ledger. A finished order dropped from the
  // replay releases everything it consumed, and the next order in line is
  // credited with work that is physically already spent. Live evidence: once
  // MO-2026-001 flipped to finished, all 22.4 lb of Passion Fruit OG tops read
  // as unallocated, including the 10 lb it had eaten.
  const lines = [
    line({ lineId: 'spent', orderId: 'DONE', rank: -1, qtyLbs: 10 }),
    line({ lineId: 'live', orderId: 'MO-2', rank: 0, qtyLbs: 100 }),
  ];
  const r = allocate({ lines, entries: [entry({ topsLbs: 22.4 })] });

  near(r.byLine.spent.doneLbs, 10);
  near(r.byLine.live.doneLbs, 12.4, 0.01);

  // Drop the finished order and the live one is handed the full 22.4.
  const without = allocate({ lines: [lines[1]], entries: [entry({ topsLbs: 22.4 })] });
  near(without.byLine.live.doneLbs, 22.4, 0.01);
  assert.ok(without.byLine.live.doneLbs > r.byLine.live.doneLbs,
    'this is the bug: dropping a finished order inflates the next one');
});

test('a finished order claims before anything still in the queue', () => {
  // Negative ranks are how the caller expresses "this already happened". If a
  // finished order sorted after the live queue it would only get leftovers.
  const r = allocate({
    lines: [
      line({ lineId: 'live', orderId: 'MO-2', rank: 0, qtyLbs: 100 }),
      line({ lineId: 'spent', orderId: 'DONE', rank: -1, qtyLbs: 10 }),
    ],
    entries: [entry({ topsLbs: 10 })],
  });
  near(r.byLine.spent.doneLbs, 10);
  near(r.byLine.live.doneLbs, 0);
});

// --- what does not get allocated -----------------------------------------

test('production for a cultivar nobody ordered is reported, not discarded', () => {
  const r = allocate({
    lines: [line({ cultivarId: 'lifter' })],
    entries: [entry({ cultivarId: 'berry-bliss', topsLbs: 12 })],
  });
  near(r.byLine.L1.doneLbs, 0);
  assert.equal(r.unallocated.length, 1);
  near(r.unallocated[0].lbs, 12);
  assert.equal(r.unallocated[0].cultivarId, 'berry-bliss');
});

test('an entry with an unreadable slot is reported rather than misdated', () => {
  const r = allocate({
    lines: [line()],
    entries: [entry({ timeSlot: 'after lunch', topsLbs: 12 })],
  });
  near(r.byLine.L1.doneLbs, 0);
  assert.equal(r.unallocated[0].reason, 'unreadable-time-slot');
});

test('zero-pound entries produce no unallocated noise', () => {
  const r = allocate({
    lines: [line({ cultivarId: 'lifter' })],
    entries: [entry({ cultivarId: 'sugar-cookez', topsLbs: 0, smallsLbs: 0 })],
  });
  assert.equal(r.unallocated.length, 0);
});

// --- order-level rollup ---------------------------------------------------

test('an order rolls up its lines and is complete only when all of them are', () => {
  const r = allocate({
    lines: [
      line({ lineId: 'T', form: 'tops', qtyLbs: 100 }),
      line({ lineId: 'S', form: 'smalls', qtyLbs: 100, sortOrder: 1 }),
    ],
    entries: [entry({ topsLbs: 100, smallsLbs: 50 })],
  });
  const o = r.byOrder['MO-1'];
  near(o.doneLbs, 150);
  near(o.totalLbs, 200);
  near(o.pct, 0.75);
  assert.equal(o.complete, false);
});

test('an order with every line filled is complete', () => {
  const r = allocate({
    lines: [line({ qtyLbs: 100 })],
    entries: [entry({ topsLbs: 100 })],
  });
  assert.equal(r.byOrder['MO-1'].complete, true);
});

test('an order with no lines is not silently complete', () => {
  const r = allocate({ lines: [], entries: [entry({ topsLbs: 10 })] });
  assert.deepEqual(r.byOrder, {});
});

// --- automatic status -----------------------------------------------------

test('the first recorded pound implies in_production', () => {
  assert.equal(impliedStatus({ doneLbs: 0.1, totalLbs: 100, complete: false }), 'in_production');
});

test('a fully trimmed order implies finished', () => {
  assert.equal(impliedStatus({ doneLbs: 100, totalLbs: 100, complete: true }), 'finished');
});

test('no production implies nothing, so a hand-set status is left alone', () => {
  assert.equal(impliedStatus({ doneLbs: 0, totalLbs: 100, complete: false }), null);
  assert.equal(impliedStatus(null), null);
});

// --- credited pounds: work the floor never had to do ----------------------
//
// "Lifter was already in stock so they did not have to trim it." The pounds are
// owed to the customer and will ship, but no hour on the trim line will ever be
// logged against them — so left alone the line sits at 0% forever, holds its
// place in the queue, and pushes every promise date behind it out.
//
// A credit is DEMAND-SIDE. It reduces what the line still wants; it never
// invents production. Nothing here writes to monthly_production, so crew rate
// and floor output are untouched — the only thing that moves is what the queue
// still has to do.

test('a credited line needs nothing trimmed and shows as done', () => {
  const r = allocate({
    lines: [line({ qtyLbs: 10, creditedLbs: 10 })],
    entries: [],
  });
  near(r.byLine.L1.doneLbs, 10);
  near(r.byLine.L1.remainingLbs, 0);
  near(r.byLine.L1.pct, 1);
});

test('a partial credit still leaves the rest to trim', () => {
  const r = allocate({
    lines: [line({ qtyLbs: 10, creditedLbs: 6 })],
    entries: [entry({ topsLbs: 4 })],
  });
  near(r.byLine.L1.doneLbs, 10);
  near(r.byLine.L1.remainingLbs, 0);
  assert.equal(r.unallocated.length, 0, 'the 4 lb trimmed should land on the gap');
});

test('THE POINT: production skips a credited line and runs to the next order', () => {
  // Lifter is covered from stock on the leading order. What the floor trims
  // today belongs to the order behind it, not to the one already satisfied.
  const r = allocate({
    lines: [
      line({ lineId: 'A', orderId: 'MO-1', rank: 0, qtyLbs: 10, creditedLbs: 10 }),
      line({ lineId: 'B', orderId: 'MO-2', rank: 1, qtyLbs: 10 }),
    ],
    entries: [entry({ topsLbs: 10 })],
  });
  near(r.byLine.A.doneLbs, 10);
  near(r.byLine.B.doneLbs, 10);
  assert.equal(r.unallocated.length, 0);
});

test('a credit never lets a line exceed what was ordered', () => {
  // Fat-fingered 100 on a 10 lb line, or a credit typed and then the cultivar
  // trimmed anyway. Either way the line is capped at its own quantity.
  const r = allocate({
    lines: [line({ qtyLbs: 10, creditedLbs: 100 })],
    entries: [entry({ topsLbs: 5 })],
  });
  near(r.byLine.L1.doneLbs, 10);
  near(r.byLine.L1.remainingLbs, 0);
  near(r.byLine.L1.pct, 1);
  assert.equal(r.unallocated.length, 1, 'the 5 lb trimmed had nowhere to go');
  assert.equal(r.unallocated[0].reason, 'no-open-line');
});

test('a negative credit is ignored rather than inflating what is owed', () => {
  const r = allocate({ lines: [line({ qtyLbs: 10, creditedLbs: -5 })], entries: [] });
  near(r.byLine.L1.doneLbs, 0);
  near(r.byLine.L1.remainingLbs, 10);
});

test('an order whose every line is credited counts as complete', () => {
  const r = allocate({
    lines: [
      line({ lineId: 'A', form: 'tops', qtyLbs: 10, creditedLbs: 10 }),
      line({ lineId: 'B', form: 'smalls', qtyLbs: 10, creditedLbs: 10 }),
    ],
    entries: [],
  });
  near(r.byOrder['MO-1'].doneLbs, 20);
  near(r.byOrder['MO-1'].pct, 1);
  assert.equal(r.byOrder['MO-1'].complete, true);
  assert.equal(impliedStatus(r.byOrder['MO-1']), 'finished');
});

test('a line with no credit behaves exactly as before', () => {
  const r = allocate({
    lines: [line({ qtyLbs: 100 })],
    entries: [entry({ topsLbs: 30 })],
  });
  near(r.byLine.L1.doneLbs, 30);
  near(r.byLine.L1.remainingLbs, 70);
});
