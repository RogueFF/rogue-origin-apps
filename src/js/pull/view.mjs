/**
 * The water spider's pull list (pull.html; order flow, Koa 2026-11-11: "a light
 * 'what to bring, where' pull list only"). Pure, so it's unit-tested
 * (tests/pull-view.test.mjs). No weighing: roughly how much raw, from the same
 * rates as SOP-028 (rawout/rates.mjs).
 */
import { rateFor, roundRaw } from '../rawout/rates.mjs';

/** "2026 - Sour Lifter / Sungrown" -> "Sour Lifter". */
export const shortName = c => String(c || '').replace(/^\s*\d{4}\s*-\s*/, '').replace(/\s*\/.*$/, '').trim();

/** About how much raw a basket needs: target x the cultivar's rate (10% extra in), rounded like the chart. */
export function rawFor(job) {
  if (!job || !(job.targetG > 0)) return null;
  return roundRaw(job.targetG * rateFor(job.cultivar).factor);
}

/**
 * One row per cell, NOW then NEXT. A NEXT of the same cultivar as NOW is marked
 * "same as NOW": what's already at the cell may cover it.
 * Cells with work come first, in roster order.
 */
export function pullRows(cells = []) {
  return cells
    .filter(c => c.takesOrders || c.now)
    .map(c => ({
      stationId: c.stationId, label: c.label,
      now: c.now ? { ...c.now, name: shortName(c.now.cultivar), rawG: rawFor(c.now) } : null,
      next: c.next ? { ...c.next, name: shortName(c.next.cultivar), rawG: rawFor(c.next),
        sameAsNow: !!(c.now && c.now.cultivar === c.next.cultivar) } : null,
    }))
    .sort((a, b) => (b.now ? 1 : 0) - (a.now ? 1 : 0));
}
