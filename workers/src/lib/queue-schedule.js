/**
 * The production queue scheduler.
 *
 * Turns order blocks into a dated, ranked sequence and reads an order's promise
 * date off the end of it.
 *
 * A BLOCK IS AN ORDER. The queue ranks orders, and inside an order the passes
 * run in the sequence the line items were typed. This reverses the pooled-
 * cultivar model the queue first shipped with: a cultivar wanted by two orders
 * is now trimmed twice, once per order, because that is how the floor works.
 *
 * What survives from the old model is the pass. Tops and smalls of one cultivar
 * inside one order come off a single lot in a single pass, sized by whichever
 * form binds, with the other form falling out as surplus. Scheduling those two
 * lines separately would over-promise by half again on the one number this
 * whole board exists to produce.
 *
 * Design: docs/plans/2026-08-20-order-blocks-restructure.md
 */

import { lotSize } from './wholesale.js';
import { addWorkHours, hoursToWorkDays, WORK_DAY } from './work-calendar.js';

const DEFAULT_FALLBACK = { ratePerTrimmerHour: 1.91, topsFraction: 0.501 };

/**
 * @param blocks    from orderBlocks(): [{ orderId, passes: [{ cultivarId, seq,
 *                  topsLbs, smallsLbs, lines }] }]
 * @param rates     { [cultivarId]: { ratePerTrimmerHour, topsFraction, basis } }
 * @param crew      trimmers on the line
 * @param start     { date, minutes } — when the queue begins
 * @param rank      optional orderId order; unranked orders follow, in block order
 * @param progress  optional { [lineId]: { doneLbs } } from burndown.allocate(),
 *                  folded onto each line so the board can draw a bar
 * @param fallback  rate used for a cultivar with no history
 */
export function scheduleQueue({
  blocks,
  rates = {},
  crew,
  start,
  rank = [],
  progress = {},
  fallback = DEFAULT_FALLBACK,
  calendar = WORK_DAY,
}) {
  if (typeof crew !== 'number' || !Number.isFinite(crew) || crew <= 0) {
    throw new Error(`Invalid crew size: ${crew} — must be greater than zero`);
  }
  if (!blocks.length) return { blocks: [], orders: {} };

  // Ranked orders first, in rank order; everything else keeps block order. An
  // order that was ranked and then closed simply does not appear, rather than
  // scheduling an empty block.
  const byId = new Map(blocks.map(b => [b.orderId, b]));
  const ordered = [
    ...rank.map(id => byId.get(id)).filter(Boolean),
    ...blocks.filter(b => !rank.includes(b.orderId)),
  ];

  const out = [];
  let cursor = start;
  // Blocks are sequential, so a guessed duration early in the queue shifts every
  // date after it. Tracking that here means a well-measured pass sitting behind
  // a fallback still reports its start as soft, which is the truth.
  let estimateUpstream = false;

  for (const block of ordered) {
    const passes = [];
    const blockStart = cursor;
    let blockEstimated = false;

    for (const p of block.passes) {
      const rate = rates[p.cultivarId];
      const usable = rate && Number.isFinite(rate.ratePerTrimmerHour) && rate.ratePerTrimmerHour > 0;
      const basis = usable ? (rate.basis || 'all-years') : 'fallback';
      const ratePerTrimmerHour = usable ? rate.ratePerTrimmerHour : fallback.ratePerTrimmerHour;
      const topsFraction = usable ? rate.topsFraction : fallback.topsFraction;

      // The lot is sized on what is still OUTSTANDING, not on what was ordered.
      // Without this the promise date never moves: an order 90% trimmed would
      // still be quoted its original finish, which is the one thing a board
      // built around "when can I promise this?" must not do.
      const doneBy = (form) => p.lines
        .filter(l => l.form === form)
        .reduce((t, l) => t + (progress[l.lineId]?.doneLbs || 0), 0);
      const leftTops = Math.max(0, p.topsLbs - doneBy('tops'));
      const leftSmalls = Math.max(0, p.smallsLbs - doneBy('smalls'));

      // One lot for the whole pass. This is the line that stops an order's tops
      // and smalls being counted as two separate stretches of floor time.
      const lot = lotSize({ topsLbs: leftTops, smallsLbs: leftSmalls, topsFraction });
      const hours = lot.lotLbs / (ratePerTrimmerHour * crew);

      const passStart = cursor;
      const finish = addWorkHours(passStart, hours, calendar);
      cursor = finish;
      if (basis === 'fallback') { estimateUpstream = true; blockEstimated = true; }

      const lines = p.lines.map(l => {
        const done = progress[l.lineId]?.doneLbs || 0;
        return {
          ...l,
          doneLbs: done,
          remainingLbs: Math.max(0, l.qtyLbs - done),
          pct: l.qtyLbs > 0 ? Math.min(1, done / l.qtyLbs) : 1,
        };
      });

      passes.push({
        cultivarId: p.cultivarId,
        topsLbs: p.topsLbs,
        smallsLbs: p.smallsLbs,
        // What the lot was actually sized on, so the card can say "sized by
        // tops 853 lb" rather than repeating the 900 that was ordered.
        remainingTopsLbs: leftTops,
        remainingSmallsLbs: leftSmalls,
        ...lot,
        ratePerTrimmerHour,
        topsFraction,
        rateBasis: basis,
        // Every date here is an estimate; this flag marks the ones resting on a
        // farm average rather than on the cultivar's own history, which is a
        // materially weaker claim and should not read the same on the board.
        estimated: basis === 'fallback',
        // This pass's own rate may be solid while its start time is not.
        dependsOnEstimate: estimateUpstream || basis === 'fallback',
        hours,
        workDays: hoursToWorkDays(hours, calendar),
        start: passStart,
        finish,
        // Both lines of a joint pass carry the same span, which is the point:
        // one lot, one stretch of floor time, two things being filled by it.
        lines,
        jointPass: lines.length > 1,
      });
    }

    const last = passes[passes.length - 1];
    const doneLbs = passes.reduce((s, p) => s + p.lines.reduce((t, l) => t + l.doneLbs, 0), 0);
    const totalLbs = passes.reduce((s, p) => s + p.lines.reduce((t, l) => t + l.qtyLbs, 0), 0);

    out.push({
      orderId: block.orderId,
      passes,
      hours: passes.reduce((s, p) => s + p.hours, 0),
      start: blockStart,
      finish: last ? last.finish : blockStart,
      doneLbs,
      totalLbs,
      pct: totalLbs > 0 ? doneLbs / totalLbs : 0,
      estimated: blockEstimated,
      dependsOnEstimate: passes.some(p => p.dependsOnEstimate),
    });
  }

  // An order is done when its own last pass is done. Under order blocks this is
  // simply the block's finish — there is no longer a cross-order pool that could
  // hold an order up from somewhere else in the queue.
  const orders = {};
  out.forEach((b, i) => {
    orders[b.orderId] = {
      finish: b.finish,
      blockIndex: i,
      estimated: b.dependsOnEstimate,
      pct: b.pct,
    };
  });

  return { blocks: out, orders };
}
