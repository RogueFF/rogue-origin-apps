/**
 * Unit tests for the production queue scheduler.
 *
 * This is where the pieces meet: orders grouped into blocks, each block's passes
 * sized by whichever form binds, and the work calendar turning hours into a date.
 *
 * The load-bearing claim it must satisfy, since the 2026-08-20 restructure: a
 * BLOCK IS AN ORDER. An order finishes when its own last pass finishes — there
 * is no cross-order pool that can hold it up from elsewhere in the queue. And
 * tops and smalls of one cultivar inside one order are ONE pass, so they finish
 * together and are never charged for twice.
 *
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleQueue } from '../workers/src/lib/queue-schedule.js';
import { orderBlocks } from '../workers/src/lib/wholesale.js';

const THU = '2026-08-20';                       // Thursday
const START = { date: THU, minutes: 7 * 60 };

// Real measured figures for these cultivars (see migration 0017 header).
const RATES = {
  'sour-lifter': { ratePerTrimmerHour: 1.77, topsFraction: 0.601, basis: 'all-years' },
  lifter: { ratePerTrimmerHour: 1.93, topsFraction: 0.508, basis: 'all-years' },
  'berry-bliss': { ratePerTrimmerHour: 1.88, topsFraction: 0.530, basis: 'all-years' },
  'alium-og': { ratePerTrimmerHour: 1.91, topsFraction: 0.501, basis: 'fallback' },
};

const base = { rates: RATES, crew: 8, start: START };

/** A line item, as orderBlocks() wants it. */
let seq = 0;
const item = (orderId, cultivarId, form, qtyLbs, sortOrder) => ({
  lineId: `L${++seq}`, orderId, cultivarId, form, qtyLbs,
  sortOrder: sortOrder ?? 0,
});

const near = (a, b, tol = 0.01) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${a} to be within ${tol} of ${b}`);

// --- shape ---------------------------------------------------------------

test('an empty order book schedules nothing', () => {
  const r = scheduleQueue({ ...base, blocks: [] });
  assert.deepEqual(r.blocks, []);
  assert.deepEqual(r.orders, {});
});

test('one order becomes one block', () => {
  const r = scheduleQueue({
    ...base,
    blocks: orderBlocks([item('MO-1', 'lifter', 'tops', 100)]),
  });
  assert.equal(r.blocks.length, 1);
  assert.equal(r.blocks[0].orderId, 'MO-1');
  assert.equal(r.blocks[0].passes.length, 1);
});

test('a crew size of zero is refused rather than dividing by it', () => {
  assert.throws(
    () => scheduleQueue({ ...base, crew: 0, blocks: orderBlocks([item('MO-1', 'lifter', 'tops', 10)]) }),
    /crew/i);
});

// --- THE double-count guard, design §4 -----------------------------------

test('tops and smalls of one cultivar in one order are ONE pass', () => {
  const blocks = orderBlocks([
    item('MO-1', 'berry-bliss', 'tops', 900, 0),
    item('MO-1', 'berry-bliss', 'smalls', 400, 3),
  ]);
  assert.equal(blocks[0].passes.length, 1, 'two lines of one cultivar are one pass');

  const r = scheduleQueue({ ...base, blocks });
  assert.equal(r.blocks[0].passes.length, 1);
  assert.equal(r.blocks[0].passes[0].jointPass, true);
  assert.equal(r.blocks[0].passes[0].lines.length, 2);
});

test('a joint pass is NOT charged for both forms separately', () => {
  const tf = RATES['berry-bliss'].topsFraction;
  const joint = scheduleQueue({
    ...base,
    blocks: orderBlocks([
      item('MO-1', 'berry-bliss', 'tops', 900, 0),
      item('MO-1', 'berry-bliss', 'smalls', 400, 1),
    ]),
  });

  // 900 lb of tops binds: the lot is 900/0.53, and its smalls yield (~798 lb)
  // already covers the 400 lb smalls line for free.
  const expectedLot = 900 / tf;
  near(joint.blocks[0].passes[0].lotLbs, expectedLot);
  near(joint.blocks[0].hours, expectedLot / (RATES['berry-bliss'].ratePerTrimmerHour * 8));

  // Scheduling them apart would cost 900/tf + 400/(1-tf) — half again as much.
  const naive = 900 / tf + 400 / (1 - tf);
  assert.ok(joint.blocks[0].passes[0].lotLbs < naive * 0.75,
    `joint lot ${joint.blocks[0].passes[0].lotLbs} should be far below the naive ${naive}`);
});

test('both lines of a joint pass carry the same span, so they finish together', () => {
  const r = scheduleQueue({
    ...base,
    blocks: orderBlocks([
      item('MO-1', 'berry-bliss', 'tops', 900, 0),
      item('MO-1', 'berry-bliss', 'smalls', 400, 3),
    ]),
  });
  const pass = r.blocks[0].passes[0];
  assert.deepEqual(pass.finish, r.blocks[0].finish);
  assert.equal(pass.lines.length, 2);
});

test('a joint pass sits at the position of its EARLIEST line', () => {
  // Berry Bliss smalls is typed last, but its tops line is first, so the whole
  // Berry Bliss pass runs before Lifter.
  const blocks = orderBlocks([
    item('MO-1', 'berry-bliss', 'tops', 100, 0),
    item('MO-1', 'lifter', 'tops', 100, 1),
    item('MO-1', 'berry-bliss', 'smalls', 50, 2),
  ]);
  assert.deepEqual(blocks[0].passes.map(p => p.cultivarId), ['berry-bliss', 'lifter']);
});

// --- sequencing within an order ------------------------------------------

test('line items run in the order they were typed', () => {
  const r = scheduleQueue({
    ...base,
    blocks: orderBlocks([
      item('MO-1', 'lifter', 'tops', 100, 1),
      item('MO-1', 'sour-lifter', 'tops', 100, 0),
    ]),
  });
  assert.deepEqual(r.blocks[0].passes.map(p => p.cultivarId), ['sour-lifter', 'lifter']);
});

test('a later pass starts exactly where the previous one finished', () => {
  const r = scheduleQueue({
    ...base,
    blocks: orderBlocks([
      item('MO-1', 'sour-lifter', 'tops', 100, 0),
      item('MO-1', 'lifter', 'tops', 100, 1),
    ]),
  });
  const [a, b] = r.blocks[0].passes;
  assert.deepEqual(b.start, a.finish);
});

// --- sequencing between orders -------------------------------------------

test('blocks are sequential — the second order starts when the first ends', () => {
  const r = scheduleQueue({
    ...base,
    blocks: orderBlocks([
      item('MO-1', 'lifter', 'tops', 100),
      item('MO-2', 'sour-lifter', 'tops', 100),
    ]),
  });
  assert.deepEqual(r.blocks[1].start, r.blocks[0].finish);
});

test('rank decides which order runs first', () => {
  const blocks = orderBlocks([
    item('MO-1', 'lifter', 'tops', 100),
    item('MO-2', 'sour-lifter', 'tops', 100),
  ]);
  const r = scheduleQueue({ ...base, blocks, rank: ['MO-2', 'MO-1'] });
  assert.deepEqual(r.blocks.map(b => b.orderId), ['MO-2', 'MO-1']);
});

test('an order missing from the rank still runs, after the ranked ones', () => {
  const blocks = orderBlocks([
    item('MO-1', 'lifter', 'tops', 100),
    item('MO-2', 'sour-lifter', 'tops', 100),
  ]);
  const r = scheduleQueue({ ...base, blocks, rank: ['MO-2'] });
  assert.deepEqual(r.blocks.map(b => b.orderId), ['MO-2', 'MO-1']);
});

test('a rank naming an order that no longer exists does not schedule a ghost', () => {
  const blocks = orderBlocks([item('MO-1', 'lifter', 'tops', 100)]);
  const r = scheduleQueue({ ...base, blocks, rank: ['MO-GONE', 'MO-1'] });
  assert.deepEqual(r.blocks.map(b => b.orderId), ['MO-1']);
});

test('THE SAME CULTIVAR IN TWO ORDERS IS TRIMMED TWICE', () => {
  // The 2026-08-20 reversal. Under the old pooled model this was one run
  // serving both orders; now the floor runs it once per order.
  const r = scheduleQueue({
    ...base,
    blocks: orderBlocks([
      item('MO-1', 'lifter', 'tops', 100),
      item('MO-2', 'lifter', 'tops', 100),
    ]),
  });
  assert.equal(r.blocks.length, 2);
  assert.equal(r.blocks[0].passes[0].cultivarId, 'lifter');
  assert.equal(r.blocks[1].passes[0].cultivarId, 'lifter');
  near(r.blocks[0].hours, r.blocks[1].hours);
});

// --- an order's promise date ---------------------------------------------

test("an order's date is its own last pass, not something elsewhere in the queue", () => {
  const r = scheduleQueue({
    ...base,
    blocks: orderBlocks([
      item('MO-1', 'lifter', 'tops', 100, 0),
      item('MO-1', 'sour-lifter', 'tops', 100, 1),
      item('MO-2', 'berry-bliss', 'tops', 5000),
    ]),
  });
  const b1 = r.blocks.find(b => b.orderId === 'MO-1');
  assert.deepEqual(r.orders['MO-1'].finish, b1.passes[b1.passes.length - 1].finish);
  assert.deepEqual(r.orders['MO-1'].finish, b1.finish);
});

// --- estimate provenance --------------------------------------------------

test('a cultivar with no history is flagged as estimated', () => {
  const r = scheduleQueue({
    ...base,
    blocks: orderBlocks([item('MO-1', 'alium-og', 'tops', 100)]),
  });
  assert.equal(r.blocks[0].passes[0].estimated, true);
  assert.equal(r.blocks[0].passes[0].rateBasis, 'fallback');
});

test('a cultivar with no rate at all falls back rather than dividing by zero', () => {
  const r = scheduleQueue({
    ...base,
    blocks: orderBlocks([item('MO-1', 'never-grown', 'tops', 100)]),
  });
  assert.equal(r.blocks[0].passes[0].rateBasis, 'fallback');
  assert.ok(Number.isFinite(r.blocks[0].passes[0].hours));
});

test('a firm order queued behind a guessed one reports a soft START', () => {
  const r = scheduleQueue({
    ...base,
    blocks: orderBlocks([
      item('MO-1', 'alium-og', 'tops', 100),
      item('MO-2', 'lifter', 'tops', 100),
    ]),
  });
  const second = r.blocks[1].passes[0];
  assert.equal(second.estimated, false, 'its own rate is measured');
  assert.equal(second.dependsOnEstimate, true, 'but everything ahead of it was not');
  assert.equal(r.orders['MO-2'].estimated, true);
});

// --- progress folded in ---------------------------------------------------

test('burn-down progress lands on the line it belongs to', () => {
  const items = [
    item('MO-1', 'berry-bliss', 'tops', 100, 0),
    item('MO-1', 'berry-bliss', 'smalls', 100, 1),
  ];
  const [tops, smalls] = items;
  const r = scheduleQueue({
    ...base,
    blocks: orderBlocks(items),
    progress: { [tops.lineId]: { doneLbs: 25 }, [smalls.lineId]: { doneLbs: 50 } },
  });
  const lines = r.blocks[0].passes[0].lines;
  near(lines.find(l => l.form === 'tops').pct, 0.25);
  near(lines.find(l => l.form === 'smalls').pct, 0.5);
  near(r.blocks[0].pct, 0.375);
  near(r.blocks[0].doneLbs, 75);
});

test('over-delivery does not push a line past 100%', () => {
  const items = [item('MO-1', 'lifter', 'tops', 100, 0)];
  const r = scheduleQueue({
    ...base,
    blocks: orderBlocks(items),
    progress: { [items[0].lineId]: { doneLbs: 150 } },
  });
  assert.equal(r.blocks[0].passes[0].lines[0].pct, 1);
  assert.equal(r.blocks[0].passes[0].lines[0].remainingLbs, 0);
});

test('no progress data means nothing is done, not that everything is', () => {
  const r = scheduleQueue({
    ...base,
    blocks: orderBlocks([item('MO-1', 'lifter', 'tops', 100)]),
  });
  assert.equal(r.blocks[0].pct, 0);
  assert.equal(r.blocks[0].doneLbs, 0);
});

// --- the date moves as the work gets done ---------------------------------

test('the lot is sized on what is OUTSTANDING, so the date shrinks', () => {
  const items = [item('MO-1', 'lifter', 'tops', 1000, 0)];
  const fresh = scheduleQueue({ ...base, blocks: orderBlocks(items) });
  const half = scheduleQueue({
    ...base,
    blocks: orderBlocks(items),
    progress: { [items[0].lineId]: { doneLbs: 500 } },
  });
  near(half.blocks[0].hours, fresh.blocks[0].hours / 2, 0.05);
  assert.ok(half.blocks[0].finish.date <= fresh.blocks[0].finish.date,
    'a half-trimmed order must not still be quoted its original finish');
});

test('a fully trimmed order costs no more floor time', () => {
  const items = [item('MO-1', 'lifter', 'tops', 1000, 0)];
  const r = scheduleQueue({
    ...base,
    blocks: orderBlocks(items),
    progress: { [items[0].lineId]: { doneLbs: 1000 } },
  });
  near(r.blocks[0].hours, 0);
  assert.equal(r.blocks[0].passes[0].lotLbs, 0);
});

test('finishing the front of the queue pulls everything behind it forward', () => {
  const items = [
    item('MO-1', 'lifter', 'tops', 1000, 0),
    item('MO-2', 'sour-lifter', 'tops', 100, 0),
  ];
  const fresh = scheduleQueue({ ...base, blocks: orderBlocks(items), rank: ['MO-1', 'MO-2'] });
  const done = scheduleQueue({
    ...base, blocks: orderBlocks(items), rank: ['MO-1', 'MO-2'],
    progress: { [items[0].lineId]: { doneLbs: 1000 } },
  });
  assert.ok(done.blocks[1].finish.date < fresh.blocks[1].finish.date,
    'MO-2 should move up once MO-1 is trimmed');
});

test('a joint pass is sized on whichever form is still outstanding', () => {
  // Tops binds when fresh. Trim all the tops and the smalls line becomes the
  // binding constraint, so the lot must re-size around smalls rather than
  // collapsing to zero.
  const items = [
    item('MO-1', 'berry-bliss', 'tops', 900, 0),
    item('MO-1', 'berry-bliss', 'smalls', 400, 1),
  ];
  const r = scheduleQueue({
    ...base,
    blocks: orderBlocks(items),
    progress: { [items[0].lineId]: { doneLbs: 900 } },
  });
  const pass = r.blocks[0].passes[0];
  assert.equal(pass.binding, 'smalls');
  near(pass.lotLbs, 400 / (1 - RATES['berry-bliss'].topsFraction));
});

test('over-delivery does not produce a negative lot', () => {
  const items = [item('MO-1', 'lifter', 'tops', 100, 0)];
  const r = scheduleQueue({
    ...base,
    blocks: orderBlocks(items),
    progress: { [items[0].lineId]: { doneLbs: 250 } },
  });
  assert.equal(r.blocks[0].passes[0].lotLbs, 0);
  assert.ok(r.blocks[0].hours >= 0);
});

// --- the calendar still applies ------------------------------------------

test('a long block runs past the end of the day onto the next work day', () => {
  const r = scheduleQueue({
    ...base,
    blocks: orderBlocks([item('MO-1', 'lifter', 'tops', 2000)]),
  });
  assert.ok(r.blocks[0].finish.date > THU, 'should not finish the same day');
  assert.ok(r.blocks[0].workDays !== 0 || r.blocks[0].hours > 8);
});

test('a block never finishes on a weekend', () => {
  // Saturday was a half day until 2026-08-21 and is now a day off, so this
  // covers both weekend days rather than Sunday alone.
  const NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  for (const lbs of [500, 1500, 3000, 6000, 12000]) {
    const r = scheduleQueue({
      ...base,
      blocks: orderBlocks([item('MO-1', 'lifter', 'tops', lbs)]),
    });
    for (const moment of [r.blocks[0].start, r.blocks[0].finish]) {
      const [y, m, day] = moment.date.split('-').map(Number);
      const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
      assert.ok(dow !== 0 && dow !== 6,
        `${lbs} lb landed on a ${NAME[dow]} (${moment.date})`);
    }
  }
});
