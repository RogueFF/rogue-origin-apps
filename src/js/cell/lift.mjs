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

// ---- Drops to about 0 (Koa 2026-11-11, "automatic + guard"; bench test on v6.5).
// A straight drop to about 0 (no negative reading seen on the way) is the crew
// pressing the scale's TARE, a basket lifted off a scale nobody tared (it reads
// GROSS: a 168 g basket lifted off reads 0.00, not negative, and held there ~4 s
// on the bench), or a basket swap fast enough that no negative reading came
// through. The zero has to hold TARE_HOLD_MS first (a basket being lowered passes
// through 0). Then:
//   - the job holds no tops (the reading before was an empty basket: shift
//     start, a basket swap): a TARE, as before ('tare'). It stays undoable for
//     GRACE_MS: if the same basket comes back (a basket-sized reading within
//     EMPTY_G of the one before), it was an un-tared lift after all ('undoTare').
//   - the job holds tops: not a TARE. Koa's rule: a loaded drop to about 0 is a
//     lift, and back about empty is a pickup ('pickup'). With two weight-matched
//     baskets (Koa 2026-11-11) that is the full basket going to the pickup spot
//     and the empty one going on, so "about 0" here is within EMPTY_G (2 g).
//     Running jobs start tared, so an un-tared lift of a loaded basket can't
//     happen on this screen.
// Same rule as the Worker's hourly tops (workers/src/lib/cell-auto.js).
export const ZERO_G = 0.5;        // the scale's TARE reads 0.00: "about 0"
export const ON_SCALE_G = 2.0;    // more than this is weight on the pan
export const TARE_HOLD_MS = 1800; // two polls at 0
export const BASKET_MIN_G = 50;   // an empty basket weighs more (168 g bench); a first handful less

export function createZeroWatch() {
  let prev = null;          // the reading before this one
  let anchor = null;        // { at, g }: the reading the scale is holding at
  let settled = null;       // the last reading that held SETTLE_MS
  let heldNow = false;      // this reading has held SETTLE_MS
  let wentNegative = false; // a lift (negative) since the reading was last up
  let cand = null;          // { before, since, tol }: a zero waiting to hold TARE_HOLD_MS
  let provisional = null;   // { before, at }: an empty-basket TARE a returning basket can undo

  const track = (at, g) => {
    if (anchor && Math.abs(g - anchor.g) <= SETTLE_TOL_G) {
      heldNow = at - anchor.at >= SETTLE_MS;
      if (heldNow && Math.abs(g) > EMPTY_G) settled = g;
    } else {
      anchor = { at, g };
      heldNow = false;
    }
  };

  return {
    /** An empty-basket TARE that a returning basket could still undo. */
    get provisional() { return provisional !== null; },

    /**
     * One reading. loaded(before) says whether the job holds tops, given the
     * reading before the drop. Returns null, or
     *   { kind: 'tare', before }       a TARE: handle it as one
     *   { kind: 'pickup', before }     a loaded basket off, back about empty
     *   { kind: 'undoTare', before }   the last TARE was an un-tared lift
     */
    reading(at, gross, loaded = () => false) {
      track(at, gross);

      if (provisional) {
        if (gross < -LIFT_G || at - provisional.at > GRACE_MS) provisional = null;
        else if (heldNow && gross >= BASKET_MIN_G && Math.abs(gross - provisional.before) <= EMPTY_G) {
          const before = provisional.before;
          provisional = null;
          return { kind: 'undoTare', before };
        } else if (heldNow && gross > ZERO_G && gross < BASKET_MIN_G) provisional = null;   // trimming started
      }

      if (gross < -LIFT_G) { wentNegative = true; cand = null; }
      else if (gross > ON_SCALE_G) wentNegative = false;
      if (!cand && prev !== null && prev > ON_SCALE_G && !wentNegative) {
        // The reading before is the last one the scale held (a lift passes
        // through moving readings on its way down), else the one just before.
        const before = settled !== null && settled > ON_SCALE_G ? settled : prev;
        const tol = loaded(before) ? EMPTY_G : ZERO_G;
        if (Math.abs(gross) <= tol) cand = { before, since: at, tol };
      } else if (cand && Math.abs(gross) > cand.tol && at - cand.since < TARE_HOLD_MS) {
        cand = null;                                                          // passing through 0
      }
      prev = gross;
      if (cand && Math.abs(gross) <= cand.tol && at - cand.since >= TARE_HOLD_MS) {
        const { before } = cand;
        cand = null;
        if (loaded(before)) return { kind: 'pickup', before };
        provisional = { before, at };
        return { kind: 'tare', before };
      }
      return null;
    },

    reset() { prev = null; anchor = null; settled = null; heldNow = false; wentNegative = false; cand = null; provisional = null; },
  };
}
