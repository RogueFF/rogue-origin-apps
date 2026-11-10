/**
 * What a basket lift on the cell scale was: a pickup or a shake (Koa
 * 2026-11-10, SOP-027 code check). The cell screen uses it to close a job; it
 * follows the same rule as the Worker's hourly tops (workers/src/lib/cell-auto.js),
 * so the screen and the hourly log always agree.
 *
 * The scale is tared with the basket on, so it reads net: about 0 = empty
 * basket, negative = basket off the pan.
 *   - A lift starts when the reading goes below -LIFT_G. What was in the basket
 *     is the highest net seen in the PRE_LIFT_MS before it (lifting only takes
 *     weight off, trimming only adds it).
 *   - It ends when the basket is back and the reading has held for SETTLE_MS, so
 *     a full basket being lowered through 0 is never read as an empty one.
 *   - Back about empty (within EMPTY_G of 0): a pickup. Anything else: a shake,
 *     and what fell out was never tops.
 *   - A scale TARE within GRACE_MS of a basket coming back non-empty means a new
 *     basket went on: the lift was a pickup after all.
 *
 * Any time, any phase: the bagger's cart takes tops on continuous rounds (design
 * doc §2d), so a pickup before the target is as normal as one after it.
 */
export const LIFT_G = 1.0;       // below -1 g: the basket is off the pan (cell-auto LIFT_G)
export const EMPTY_G = 2.0;      // back within 2 g of zero: empty (cell-auto EMPTY_G)
export const GRACE_MS = 90 * 1000; // cell-auto GRACE_MS
export const SETTLE_MS = 1000;   // the basket is back once the reading holds this long
export const SETTLE_TOL_G = 1.0; // "holds": stays within 1 g
export const PRE_LIFT_MS = 2000;

export function createLiftWatch() {
  let recent = [];   // [{ at, net }] on-pan readings in the last PRE_LIFT_MS
  let lift = null;   // { fromNet, landing: { at, gross, net } | null }
  let back = null;   // { at, fromNet }: back non-empty, waiting to see if a TARE follows

  return {
    /** True while a basket is off the pan or not yet settled back on it. */
    get lifted() { return lift !== null; },

    /**
     * One scale reading. gross = what the scale reads (g), net = job progress
     * (gross plus anything banked). Returns null, or
     *   { kind: 'pickup', g }  the basket came back empty; g = what it held
     *   { kind: 'shake', g, backNet }  it came back with weight; g = what fell out
     */
    reading(at, gross, net) {
      if (gross < -LIFT_G) {
        if (!lift) {
          lift = { fromNet: Math.max(0, ...recent.map(r => r.net)), landing: null };
          back = null;
        } else {
          lift.landing = null;                            // up again before it settled
        }
        return null;
      }
      if (!lift) {
        recent = recent.filter(r => at - r.at <= PRE_LIFT_MS);
        recent.push({ at, net });
        return null;
      }
      if (!lift.landing || Math.abs(gross - lift.landing.gross) > SETTLE_TOL_G) {
        lift.landing = { at, gross, net };                // still coming down
        return null;
      }
      if (at - lift.landing.at < SETTLE_MS) return null;
      const { fromNet } = lift;
      lift = null;
      recent = [{ at, net }];
      if (Math.abs(gross) <= EMPTY_G) return { kind: 'pickup', g: fromNet };
      back = { at, fromNet };
      return { kind: 'shake', g: Math.max(0, fromNet - net), backNet: net };
    },

    /** A confirmed scale TARE. Returns { kind: 'pickup', g } if it turns the last lift into one. */
    tare(at) {
      const b = back;
      back = null;
      recent = [];
      return b && at - b.at <= GRACE_MS ? { kind: 'pickup', g: b.fromNet } : null;
    },

    reset() { recent = []; lift = null; back = null; },
  };
}
