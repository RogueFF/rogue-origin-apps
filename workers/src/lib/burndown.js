/**
 * Burn-down — allocating recorded production to the orders waiting on it.
 *
 * The queue used to be purely a forecast. This is what makes it a progress
 * tracker: every hour the floor logs on the hourly-entry sheet is credited to
 * an order, so a block drains as the work happens and "how far along is this?"
 * has an answer that nobody has to type.
 *
 * THE RULE, in the operator's words:
 *
 *   "If an order is put in the day before and it's first in line, any hourly
 *    entries with that cultivar should count towards that order."
 *
 * So: walk the entries oldest to newest, and pour each pound into the
 * highest-ranked order that still needs that cultivar and form. Overflow runs
 * to the next order in line. Nothing is credited to an order that did not yet
 * exist when the work happened.
 *
 * WHY EVERYTHING HERE IS PACIFIC WALL-CLOCK STRINGS.
 * The same reasoning as work-calendar.js. Hourly entries are Pacific by
 * construction — a human on the floor typed "9:00 AM". If an order's accrual
 * start were held as a UTC instant, comparing the two would mean a timezone
 * conversion on every row, wrong by a different amount across a DST change. A
 * moment here is the string 'YYYY-MM-DD HH:MM' in Pacific, and comparing two of
 * them is a string comparison, because zero-padded ISO-ish text sorts
 * chronologically. There is no Date object in this file.
 *
 * Design: docs/plans/2026-08-20-order-blocks-restructure.md §5
 */

import { parseSlotTimeToMinutes } from './production-helpers.js';

const FORMS = ['tops', 'smalls'];

/**
 * Minutes since midnight for the START of an hourly slot.
 *
 * `time_slot` is free text: "9:00 AM – 10:00 AM", sometimes with a hyphen or an
 * em-dash instead of the en-dash, sometimes an odd start like "7:21 AM – 8:00 AM"
 * where a shift began late. Only the start matters for ordering.
 *
 * This exists because **time_slot does not sort chronologically as a string**:
 * "12:30 PM" sorts before "7:21 AM", so an ORDER BY time_slot would hand the
 * allocator the afternoon before the morning and credit the wrong order.
 *
 * Returns null for anything unparseable, which the caller treats as unallocated
 * rather than guessing at a position in the day.
 */
export function slotStartMinutes(timeSlot) {
  if (!timeSlot) return null;
  // Match the leading time token rather than splitting on a known separator.
  // Splitting assumes the separator is one of `-`, `–` or `—`; anything else —
  // a stray encoding, a slot typed with "to" — leaves the whole string to be
  // handed to an anchored parser, which rejects it, and the hour's pounds go
  // unallocated for a reason nobody would guess from the board.
  const m = String(timeSlot).match(/^\s*(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
  return m ? parseSlotTimeToMinutes(m[1].trim()) : null;
}

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' + minutes -> 'YYYY-MM-DD HH:MM', the comparable moment. */
export function moment(date, minutes) {
  return `${date} ${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/**
 * Allocate recorded production across order lines.
 *
 * @param entries  [{ date, timeSlot, cultivarId, topsLbs, smallsLbs }]
 *                 Already resolved through cultivar_aliases by the caller's SQL,
 *                 so cultivarId is canonical and no fuzzy matching happens here.
 * @param lines    [{ lineId, orderId, cultivarId, form, qtyLbs, rank, sortOrder,
 *                    accrualStart }]
 *                 `rank` is the position of the line's ORDER in the queue;
 *                 `sortOrder` is the line's position within that order. Together
 *                 they are the priority: first order in line, first line in it.
 *
 * @returns { byLine, byOrder, unallocated }
 */
export function allocate({ entries = [], lines = [] }) {
  // Remaining capacity per line, in priority order. Sorting once here means the
  // inner loop never re-sorts: for a given cultivar and form, the eligible lines
  // are always encountered best-first.
  const open = lines
    .map(l => {
      const qty = Math.max(0, l.qtyLbs);
      // A CREDIT: pounds the order is owed that the trim line will never
      // produce, because they were already in stock. Demand-side only — it
      // reduces what this line still wants and never invents production, so
      // crew rate and floor output are untouched.
      //
      // Clamped to the line's own quantity. A credit typed as 100 on a 10 lb
      // line, or a credit entered and then the cultivar trimmed anyway, must
      // not let a line report more done than was ordered; the surplus pounds
      // surface as unallocated, which is the honest answer.
      const credit = Math.min(qty, Math.max(0, Number(l.creditedLbs) || 0));
      return { ...l, creditedLbs: credit, doneLbs: credit, remaining: qty - credit };
    })
    .sort((a, b) =>
      (a.rank - b.rank) || (a.sortOrder - b.sortOrder) || String(a.lineId).localeCompare(String(b.lineId)));

  const byLine = new Map(open.map(l => [l.lineId, l]));
  const unallocated = [];

  // Chronological. Entries with an unreadable slot are not silently dropped to
  // the front or the back of the day — they are refused outright below.
  const dated = entries.map(e => {
    const mins = slotStartMinutes(e.timeSlot);
    return { ...e, mins, at: mins == null ? null : moment(e.date, mins) };
  });
  const ordered = dated
    .filter(e => e.at !== null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.mins - b.mins));

  for (const e of dated) {
    if (e.at === null) {
      for (const form of FORMS) {
        const lbs = form === 'tops' ? (e.topsLbs || 0) : (e.smallsLbs || 0);
        if (lbs > 0) {
          unallocated.push({
            date: e.date, timeSlot: e.timeSlot, cultivarId: e.cultivarId,
            form, lbs, reason: 'unreadable-time-slot',
          });
        }
      }
    }
  }

  for (const e of ordered) {
    for (const form of FORMS) {
      let lbs = form === 'tops' ? (e.topsLbs || 0) : (e.smallsLbs || 0);
      if (!(lbs > 0)) continue;

      for (const line of open) {
        if (lbs <= 0) break;
        if (line.remaining <= 0) continue;
        if (line.cultivarId !== e.cultivarId || line.form !== form) continue;
        // An order cannot be credited with work done before it existed.
        if (line.accrualStart && line.accrualStart > e.at) continue;

        const take = Math.min(lbs, line.remaining);
        line.doneLbs += take;
        line.remaining -= take;
        lbs -= take;
      }

      if (lbs > 0) {
        // Deliberately surfaced rather than discarded. Pounds that match no
        // waiting order are the ordinary case — most of what the floor trims is
        // not against a wholesale order at all — but silently dropping them
        // would look identical to an order mysteriously running behind.
        unallocated.push({
          date: e.date, timeSlot: e.timeSlot, cultivarId: e.cultivarId,
          form, lbs, reason: 'no-open-line',
        });
      }
    }
  }

  const byOrder = new Map();
  for (const line of open) {
    const o = byOrder.get(line.orderId)
      || { orderId: line.orderId, doneLbs: 0, totalLbs: 0, complete: true };
    o.doneLbs += line.doneLbs;
    o.totalLbs += line.qtyLbs;
    if (line.remaining > 0) o.complete = false;
    byOrder.set(line.orderId, o);
  }

  return {
    byLine: Object.fromEntries([...byLine.values()].map(l => [l.lineId, {
      lineId: l.lineId,
      orderId: l.orderId,
      doneLbs: l.doneLbs,
      // Surfaced separately so the board can show credited pounds differently
      // from trimmed ones. They are both "done", but only one of them was work.
      creditedLbs: l.creditedLbs,
      remainingLbs: l.remaining,
      qtyLbs: l.qtyLbs,
      pct: l.qtyLbs > 0 ? l.doneLbs / l.qtyLbs : 1,
    }])),
    byOrder: Object.fromEntries([...byOrder.values()].map(o => [o.orderId, {
      ...o,
      pct: o.totalLbs > 0 ? o.doneLbs / o.totalLbs : 1,
      // An order with no lines is vacuously complete, which would flip it
      // straight to `finished`. Guard that here rather than in the caller.
      complete: o.totalLbs > 0 && o.complete,
    }])),
    unallocated,
  };
}

/**
 * The status an order's progress implies. Decision 5: fully automatic.
 *
 * Returns null when progress implies nothing — no pounds recorded — so the
 * caller can leave a hand-set status alone rather than forcing every untouched
 * order back to `in_queue` on every cron tick.
 */
export function impliedStatus(progress) {
  if (!progress) return null;
  if (progress.complete) return 'finished';
  if (progress.doneLbs > 0) return 'in_production';
  return null;
}
