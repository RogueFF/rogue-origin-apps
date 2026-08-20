/**
 * The production queue scheduler.
 *
 * Turns pooled demand into a dated, ranked sequence of cultivar runs, and reads
 * an order's promise date back off it.
 *
 * The shape of this is the whole design argument. The floor does not trim an
 * order — it trims a cultivar lot, and both tops and smalls come off the same
 * pass. So the queue ranks CULTIVARS, each run is sized by whichever form binds,
 * and an order's date is the latest of the runs that supply it. An order needing
 * three cultivars sits at three points in this queue; dragging one of them moves
 * that order's date only if it happens to be the one holding it up.
 *
 * Design: docs/plans/2026-08-19-order-blocks-design.md
 */

import { lotSize } from './wholesale.js';
import { addWorkHours, hoursToWorkDays, WORK_DAY } from './work-calendar.js';

const DEFAULT_FALLBACK = { ratePerTrimmerHour: 1.91, topsFraction: 0.501 };

/**
 * @param pools     from poolDemand(): [{ cultivarId, topsLbs, smallsLbs, orderIds }]
 * @param rates     { [cultivarId]: { ratePerTrimmerHour, topsFraction, basis } }
 * @param crew      trimmers on the line
 * @param start     { date, minutes } — when the queue begins
 * @param rank      optional cultivarId order; unranked cultivars follow, in pool order
 * @param fallback  rate used for a cultivar with no history
 */
export function scheduleQueue({
  pools,
  rates = {},
  crew,
  start,
  rank = [],
  fallback = DEFAULT_FALLBACK,
  calendar = WORK_DAY,
}) {
  if (typeof crew !== 'number' || !Number.isFinite(crew) || crew <= 0) {
    throw new Error(`Invalid crew size: ${crew} — must be greater than zero`);
  }
  if (!pools.length) return { runs: [], orders: {} };

  // Ranked cultivars first, in rank order; everything else keeps pool order.
  // A cultivar that was ranked and then removed from the order book simply
  // does not appear, rather than scheduling an empty run.
  const byId = new Map(pools.map(p => [p.cultivarId, p]));
  const ordered = [
    ...rank.map(id => byId.get(id)).filter(Boolean),
    ...pools.filter(p => !rank.includes(p.cultivarId)),
  ];

  const runs = [];
  let cursor = start;
  // Runs are sequential, so a guessed duration early in the queue shifts every
  // date after it. Tracking that here means a well-measured run sitting behind
  // a fallback still reports its start time as soft, which is the truth.
  let estimateUpstream = false;

  for (const p of ordered) {
    const rate = rates[p.cultivarId];
    const usable = rate && Number.isFinite(rate.ratePerTrimmerHour) && rate.ratePerTrimmerHour > 0;
    const basis = usable ? (rate.basis || 'all-years') : 'fallback';
    const ratePerTrimmerHour = usable ? rate.ratePerTrimmerHour : fallback.ratePerTrimmerHour;
    const topsFraction = usable ? rate.topsFraction : fallback.topsFraction;

    const lot = lotSize({ topsLbs: p.topsLbs, smallsLbs: p.smallsLbs, topsFraction });
    const hours = lot.lotLbs / (ratePerTrimmerHour * crew);

    const runStart = cursor;
    const finish = addWorkHours(runStart, hours, calendar);
    cursor = finish;

    runs.push({
      cultivarId: p.cultivarId,
      orderIds: [...p.orderIds],
      topsLbs: p.topsLbs,
      smallsLbs: p.smallsLbs,
      ...lot,
      ratePerTrimmerHour,
      topsFraction,
      rateBasis: basis,
      // Every date here is an estimate; this flag marks the ones resting on a
      // farm average rather than on the cultivar's own history, which is a
      // materially weaker claim and should not read the same on the board.
      estimated: basis === 'fallback',
      // This run's own rate may be solid while its start time is not.
      dependsOnEstimate: estimateUpstream || basis === 'fallback',
      hours,
      workDays: hoursToWorkDays(hours, calendar),
      start: runStart,
      finish,
    });

    if (basis === 'fallback') estimateUpstream = true;
  }

  // An order is done when the last run supplying it is done.
  const orders = {};
  for (const run of runs) {
    for (const orderId of run.orderIds) {
      const current = orders[orderId];
      const later = !current
        || run.finish.date > current.finish.date
        || (run.finish.date === current.finish.date && run.finish.minutes > current.finish.minutes);
      if (later) {
        orders[orderId] = {
          finish: run.finish,
          heldBy: run.cultivarId,
          runIndex: runs.indexOf(run),
          // The holding run decides the date, so its uncertainty decides the
          // date's. dependsOnEstimate already folds in everything queued ahead
          // of it, so a firm run behind a guessed one is still reported soft.
          estimated: run.dependsOnEstimate,
        };
      }
    }
  }

  return { runs, orders };
}
