/**
 * Unit tests for the queue brief — the small projection of the board that the
 * dashboard widget and the hourly-entry banner read.
 *
 * Two things here are worth more than the rest.
 *
 * The first is WHICH PASS the headline names. Allocation matches by cultivar,
 * not by pass order, so a block's second pass can be finished while its first
 * has not started — that is the live shape of MO-2026-002 on 2026-08-21. A
 * headline that just reads pass 0 would name a cultivar nobody is working on,
 * and a headline that reads "the last pass with progress" would name one
 * already done.
 *
 * The second is `queueAliases`. The queue says 'Purple Frosty'; the hourly-entry
 * dropdown says '2025 - Purple Frosty / Sungrown'. Against live data a naive
 * strip-the-year match scores 0 out of 23 — it would float nothing, ever, while
 * looking exactly like a working feature. These strings have to come back
 * verbatim from the alias table or the whole float-to-top does nothing and says
 * nothing.
 *
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQueueBrief } from '../workers/src/lib/queue-brief.js';

const line = (o = {}) => ({
  lineId: 'L1', form: 'tops', qtyLbs: 100, doneLbs: 0, remainingLbs: 100, pct: 0, ...o,
});

const pass = (o = {}) => ({
  cultivarId: 'berry-bliss', cultivarName: 'Berry Bliss',
  lines: [line()], finish: { date: '2026-09-09', minutes: 600 }, ...o,
});

const block = (o = {}) => ({
  orderId: 'MO-1', passes: [pass()], doneLbs: 0, totalLbs: 100, pct: 0,
  finish: { date: '2026-09-09', minutes: 600 }, ...o,
});

const order = (o = {}) => ({ id: 'MO-1', nickname: null, shopifyOrderName: '#5674', ...o });

const brief = (o = {}) => buildQueueBrief({ blocks: [], orders: [], aliases: [], ...o });

// --- which pass the headline names ----------------------------------------

test('the headline names the first pass with work left, not pass zero', () => {
  // MO-2026-002 as it stands on 2026-08-21: Purple Frosty untouched, and the
  // Berry Bliss pass behind it already fully allocated.
  const b = brief({
    blocks: [block({
      orderId: 'MO-2026-002', doneLbs: 50, totalLbs: 100, pct: 0.5,
      passes: [
        pass({
          cultivarId: 'purple-frosty', cultivarName: 'Purple Frosty',
          lines: [line({ qtyLbs: 50, doneLbs: 0, remainingLbs: 50, pct: 0 })],
        }),
        pass({
          cultivarId: 'berry-bliss', cultivarName: 'Berry Bliss',
          lines: [line({ qtyLbs: 50, doneLbs: 50, remainingLbs: 0, pct: 1 })],
        }),
      ],
    })],
    orders: [order({ id: 'MO-2026-002' })],
  });

  assert.equal(b.headline.cultivarName, 'Purple Frosty');
  assert.equal(b.headline.form, 'tops');
});

test('a block whose passes are all finished is not the headline', () => {
  const done = block({
    orderId: 'MO-DONE',
    passes: [pass({ lines: [line({ doneLbs: 100, remainingLbs: 0, pct: 1 })] })],
  });
  const live = block({
    orderId: 'MO-LIVE',
    passes: [pass({ cultivarId: 'lifter', cultivarName: 'Lifter' })],
  });

  const b = brief({ blocks: [done, live], orders: [order({ id: 'MO-LIVE' })] });

  assert.equal(b.headline.orderId, 'MO-LIVE');
  assert.equal(b.headline.cultivarName, 'Lifter');
});

// --- mode ------------------------------------------------------------------

test('work already recorded against the front block reads as now trimming', () => {
  const b = brief({
    blocks: [block({ doneLbs: 50, totalLbs: 100, pct: 0.5 })],
    orders: [order()],
  });

  assert.equal(b.headline.mode, 'now');
});

test('a queue nobody has started yet reads as next up, not now trimming', () => {
  // MO-2026-002's own start is 16:31 — past the 16:20 productive end. Deciding
  // this on the clock would have called it "now trimming" on day one.
  const b = brief({
    blocks: [block({ doneLbs: 0, totalLbs: 100, pct: 0 })],
    orders: [order()],
  });

  assert.equal(b.headline.mode, 'next');
});

test('an empty queue is clear, and carries no order', () => {
  const b = brief({ blocks: [], orders: [] });

  assert.equal(b.headline.mode, 'clear');
  assert.equal(b.headline.orderId, null);
  assert.equal(b.next, null);
  assert.deepEqual(b.blocks, []);
  assert.equal(b.blocksTotal, 0);
});

test('a queue of nothing but finished blocks is also clear', () => {
  const b = brief({
    blocks: [block({ passes: [pass({ lines: [line({ doneLbs: 100, remainingLbs: 0, pct: 1 })] })] })],
    orders: [order()],
  });

  assert.equal(b.headline.mode, 'clear');
});

// --- next ------------------------------------------------------------------

test('next is the following unfinished pass in the same block', () => {
  const b = brief({
    blocks: [block({
      passes: [
        pass({ cultivarId: 'lifter', cultivarName: 'Lifter' }),
        pass({ cultivarId: 'elektra', cultivarName: 'Elektra' }),
      ],
    })],
    orders: [order()],
  });

  assert.equal(b.headline.cultivarName, 'Lifter');
  assert.equal(b.next.cultivarName, 'Elektra');
});

test('next spills into the following block when this one has nothing left', () => {
  const b = brief({
    blocks: [
      block({ orderId: 'MO-1' }),
      block({ orderId: 'MO-2', passes: [pass({ cultivarId: 'lifter', cultivarName: 'Lifter' })] }),
    ],
    orders: [order({ id: 'MO-1' }), order({ id: 'MO-2', nickname: 'Ashanti' })],
  });

  assert.equal(b.next.cultivarName, 'Lifter');
  assert.equal(b.next.orderId, 'MO-2');
  assert.equal(b.next.nickname, 'Ashanti');
});

test('the last pass in the queue has nothing after it', () => {
  const b = brief({ blocks: [block()], orders: [order()] });

  assert.equal(b.next, null);
});

// --- order identity --------------------------------------------------------

test('an order carries both its number and its nickname, unmerged', () => {
  // The widget shows them in different positions, so the brief must not decide
  // which one wins the way orderLabel() does for a Telegram sentence.
  const b = brief({
    blocks: [block()],
    orders: [order({ nickname: 'Ashanti', shopifyOrderName: '#35095' })],
  });

  assert.equal(b.headline.nickname, 'Ashanti');
  assert.equal(b.headline.orderRef, '#35095');
});

test('an order the queue knows nothing about does not crash the brief', () => {
  const b = brief({ blocks: [block({ orderId: 'MO-GHOST' })], orders: [] });

  assert.equal(b.headline.orderId, 'MO-GHOST');
  assert.equal(b.headline.nickname, null);
  assert.equal(b.headline.orderRef, null);
});

// --- the block list --------------------------------------------------------

test('the block list is capped but the total is not', () => {
  const blocks = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(id => block({ orderId: id }));

  const b = brief({ blocks, orders: [], limit: 4 });

  assert.equal(b.blocks.length, 4);
  assert.equal(b.blocksTotal, 7);
  assert.deepEqual(b.blocks.map(x => x.orderId), ['a', 'b', 'c', 'd']);
});

test('a block row names the cultivar it is actually waiting on', () => {
  const b = brief({
    blocks: [block({
      passes: [
        pass({ cultivarId: 'purple-frosty', cultivarName: 'Purple Frosty',
          lines: [line({ doneLbs: 50, remainingLbs: 0, pct: 1 })] }),
        pass({ cultivarId: 'lifter', cultivarName: 'Lifter' }),
      ],
    })],
    orders: [order()],
  });

  assert.equal(b.blocks[0].cultivarName, 'Lifter');
});

test('finished blocks are left out of the list entirely', () => {
  const b = brief({
    blocks: [
      block({ orderId: 'MO-DONE',
        passes: [pass({ lines: [line({ doneLbs: 100, remainingLbs: 0, pct: 1 })] })] }),
      block({ orderId: 'MO-LIVE' }),
    ],
    orders: [],
  });

  assert.deepEqual(b.blocks.map(x => x.orderId), ['MO-LIVE']);
  assert.equal(b.blocksTotal, 1);
});

// --- queueAliases ----------------------------------------------------------

test('aliases come back as the dropdown spells them, verbatim', () => {
  // The whole point. Anything that reformats these breaks the exact match the
  // client does, and breaks it silently.
  const b = brief({
    blocks: [block({ passes: [pass({ cultivarId: 'purple-frosty', cultivarName: 'Purple Frosty' })] })],
    orders: [],
    aliases: [{ alias: '2025 - Purple Frosty / Sungrown', cultivarId: 'purple-frosty' }],
  });

  assert.deepEqual(b.queueAliases, ['2025 - Purple Frosty / Sungrown']);
});

test('aliases are listed in queue order', () => {
  const b = brief({
    blocks: [
      block({ orderId: 'MO-1', passes: [pass({ cultivarId: 'purple-frosty', cultivarName: 'Purple Frosty' })] }),
      block({ orderId: 'MO-2', passes: [pass({ cultivarId: 'lifter', cultivarName: 'Lifter' })] }),
    ],
    orders: [],
    aliases: [
      { alias: '2025 - Lifter / Sungrown', cultivarId: 'lifter' },
      { alias: '2025 - Purple Frosty / Sungrown', cultivarId: 'purple-frosty' },
    ],
  });

  assert.deepEqual(b.queueAliases,
    ['2025 - Purple Frosty / Sungrown', '2025 - Lifter / Sungrown']);
});

test('one cultivar with several spellings contributes all of them', () => {
  const b = brief({
    blocks: [block({ passes: [pass({ cultivarId: 'lifter', cultivarName: 'Lifter' })] })],
    orders: [],
    aliases: [
      { alias: '2025 - Lifter / Sungrown', cultivarId: 'lifter' },
      { alias: '2025 - Lifter (Early Harvest) / Sungrown', cultivarId: 'lifter' },
    ],
  });

  assert.deepEqual(b.queueAliases,
    ['2025 - Lifter / Sungrown', '2025 - Lifter (Early Harvest) / Sungrown']);
});

test('a cultivar with no alias row contributes nothing, and invents nothing', () => {
  // Floating a string the production dropdown does not contain would offer a
  // value the save path rejects.
  const b = brief({
    blocks: [block({ passes: [pass({ cultivarId: 'catnip', cultivarName: 'Catnip' })] })],
    orders: [],
    aliases: [{ alias: '2025 - Lifter / Sungrown', cultivarId: 'lifter' }],
  });

  assert.deepEqual(b.queueAliases, []);
});

test('a cultivar already trimmed out contributes no alias', () => {
  const b = brief({
    blocks: [block({
      passes: [
        pass({ cultivarId: 'purple-frosty', cultivarName: 'Purple Frosty',
          lines: [line({ doneLbs: 50, remainingLbs: 0, pct: 1 })] }),
        pass({ cultivarId: 'lifter', cultivarName: 'Lifter' }),
      ],
    })],
    orders: [],
    aliases: [
      { alias: '2025 - Purple Frosty / Sungrown', cultivarId: 'purple-frosty' },
      { alias: '2025 - Lifter / Sungrown', cultivarId: 'lifter' },
    ],
  });

  assert.deepEqual(b.queueAliases, ['2025 - Lifter / Sungrown']);
});

test('a cultivar wanted twice is listed once, at its first position', () => {
  const b = brief({
    blocks: [
      block({ orderId: 'MO-1', passes: [pass({ cultivarId: 'lifter', cultivarName: 'Lifter' })] }),
      block({ orderId: 'MO-2', passes: [pass({ cultivarId: 'elektra', cultivarName: 'Elektra' })] }),
      block({ orderId: 'MO-3', passes: [pass({ cultivarId: 'lifter', cultivarName: 'Lifter' })] }),
    ],
    orders: [],
    aliases: [
      { alias: '2025 - Lifter / Sungrown', cultivarId: 'lifter' },
      { alias: '2025 - Elektra / Sungrown', cultivarId: 'elektra' },
    ],
  });

  assert.deepEqual(b.queueAliases,
    ['2025 - Lifter / Sungrown', '2025 - Elektra / Sungrown']);
});

// --- joint passes ----------------------------------------------------------

test('a pass with tops and smalls both outstanding names both forms', () => {
  const b = brief({
    blocks: [block({
      passes: [pass({
        lines: [
          line({ lineId: 'L1', form: 'tops', qtyLbs: 60, remainingLbs: 60 }),
          line({ lineId: 'L2', form: 'smalls', qtyLbs: 40, remainingLbs: 40 }),
        ],
      })],
    })],
    orders: [order()],
  });

  assert.equal(b.headline.form, 'tops + smalls');
});

test('a joint pass whose smalls are done names only the form still owed', () => {
  const b = brief({
    blocks: [block({
      passes: [pass({
        lines: [
          line({ lineId: 'L1', form: 'tops', qtyLbs: 60, remainingLbs: 60 }),
          line({ lineId: 'L2', form: 'smalls', qtyLbs: 40, doneLbs: 40, remainingLbs: 0, pct: 1 }),
        ],
      })],
    })],
    orders: [order()],
  });

  assert.equal(b.headline.form, 'tops');
});

test('the headline reports the pass lbs, not the whole order', () => {
  const b = brief({
    blocks: [block({
      doneLbs: 50, totalLbs: 100, pct: 0.5,
      passes: [
        pass({ cultivarId: 'purple-frosty', cultivarName: 'Purple Frosty',
          lines: [line({ qtyLbs: 50, doneLbs: 10, remainingLbs: 40, pct: 0.2 })] }),
        pass({ cultivarId: 'berry-bliss', cultivarName: 'Berry Bliss',
          lines: [line({ qtyLbs: 50, doneLbs: 50, remainingLbs: 0, pct: 1 })] }),
      ],
    })],
    orders: [order()],
  });

  assert.equal(b.headline.doneLbs, 10);
  assert.equal(b.headline.totalLbs, 50);
  assert.equal(b.headline.pct, 0.2);
});

// --- passes on a block row -------------------------------------------------
//
// The hourly-entry Order Queue tab lists each order with the strains under it,
// so the lead can see the whole board without leaving the entry screen. The
// banner above the fields answers "what now"; the tab answers "what after
// that". Both read this one projection rather than a second API call.

test('a block row carries its passes, in queue order', () => {
  const b = brief({
    blocks: [block({
      orderId: 'MO-1', doneLbs: 30, totalLbs: 60, pct: 0.5,
      passes: [
        pass({ cultivarId: 'lifter', cultivarName: 'Lifter',
          lines: [line({ qtyLbs: 30, doneLbs: 30, remainingLbs: 0, pct: 1 })] }),
        pass({ cultivarId: 'berry-bliss', cultivarName: 'Berry Bliss',
          lines: [line({ qtyLbs: 30, doneLbs: 0, remainingLbs: 30, pct: 0 })] }),
      ],
    })],
    orders: [order({ id: 'MO-1' })],
  });

  assert.equal(b.blocks[0].passes.length, 2);
  assert.deepEqual(b.blocks[0].passes.map(p => p.cultivarName), ['Lifter', 'Berry Bliss']);
});

test('each pass reports its own pounds and share, not the order total', () => {
  const b = brief({
    blocks: [block({
      orderId: 'MO-1', doneLbs: 30, totalLbs: 60, pct: 0.5,
      passes: [
        pass({ cultivarId: 'lifter', cultivarName: 'Lifter',
          lines: [line({ qtyLbs: 30, doneLbs: 30, remainingLbs: 0, pct: 1 })] }),
        pass({ cultivarId: 'berry-bliss', cultivarName: 'Berry Bliss',
          lines: [line({ qtyLbs: 40, doneLbs: 10, remainingLbs: 30, pct: 0.25 })] }),
      ],
    })],
    orders: [order({ id: 'MO-1' })],
  });

  const [a, c] = b.blocks[0].passes;
  assert.equal(a.doneLbs, 30);
  assert.equal(a.totalLbs, 30);
  assert.equal(a.pct, 1);
  assert.equal(c.doneLbs, 10);
  assert.equal(c.totalLbs, 40);
  assert.equal(c.pct, 0.25);
});

test('a joint pass sums both forms into one row', () => {
  // Tops and smalls of one cultivar are one pass on one lot, so the tab shows
  // them as a single strain line rather than implying two stretches of work.
  const b = brief({
    blocks: [block({
      orderId: 'MO-1', doneLbs: 0, totalLbs: 50,
      passes: [pass({
        cultivarId: 'lifter', cultivarName: 'Lifter',
        lines: [
          line({ lineId: 'T', form: 'tops', qtyLbs: 30, doneLbs: 10, remainingLbs: 20 }),
          line({ lineId: 'S', form: 'smalls', qtyLbs: 20, doneLbs: 0, remainingLbs: 20 }),
        ],
      })],
    })],
    orders: [order({ id: 'MO-1' })],
  });

  assert.equal(b.blocks[0].passes.length, 1);
  assert.equal(b.blocks[0].passes[0].totalLbs, 50);
  assert.equal(b.blocks[0].passes[0].doneLbs, 10);
  assert.equal(b.blocks[0].passes[0].form, 'tops + smalls');
});

test('a finished pass still appears inside an order still running', () => {
  // Unlike the headline, which names only work still to do, the tab is a
  // picture of the order — hiding what is done would make a half-finished
  // order look smaller than it is.
  //
  // The order itself must still be open: a block whose every pass is finished
  // leaves the queue altogether, which is the separate behaviour asserted by
  // 'an all-finished block is not in the queue at all'.
  const b = brief({
    blocks: [block({
      orderId: 'MO-1', doneLbs: 10, totalLbs: 40, pct: 0.25,
      passes: [
        pass({ cultivarId: 'lifter', cultivarName: 'Lifter',
          lines: [line({ qtyLbs: 10, doneLbs: 10, remainingLbs: 0, pct: 1 })] }),
        pass({ cultivarId: 'berry-bliss', cultivarName: 'Berry Bliss',
          lines: [line({ qtyLbs: 30, doneLbs: 0, remainingLbs: 30, pct: 0 })] }),
      ],
    })],
    orders: [order({ id: 'MO-1' })],
  });

  const done = b.blocks[0].passes.find(p => p.cultivarName === 'Lifter');
  assert.equal(done.pct, 1, 'the finished strain is still listed');
  assert.equal(b.blocks[0].passes.length, 2);
});
