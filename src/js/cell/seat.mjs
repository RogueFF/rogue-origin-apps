/**
 * One trimmer seat's batch, run off the scale (line screen, Koa 2026-11-24).
 * The same basket rules as the cell screen had (lift.mjs: lifts, shakes, the
 * scale's TARE, an un-tared lift, a two-basket swap). A batch is one clock hour
 * of the line (Koa 2026-11-24: "1 hour batch, not a 1lb batch"), and every gram
 * is credited to the clock hour it was read in (line.mjs). Pure apart from the
 * callbacks, so it is unit-tested with a fake clock.
 *
 * phase: idle (needs a tared empty basket) -> armed -> running -> finished -> idle
 *   · The scale's TARE with the empty basket on arms it; so does a name tap on a
 *     tared scale, and after a pickup the next batch arms itself.
 *   · The first START_G starts the batch, in the hour it lands in.
 *   · That hour ends: finished, the chime, "ready for pickup" on the Cells board.
 *     Tops still going in after the mark count for the next hour all the same.
 *   · A pickup (the basket off and back about empty, a swap and TARE, or a
 *     loaded drop to 0) closes it: at the hour mark, or early with its weight.
 */
import { createLiftWatch, createZeroWatch, EMPTY_G, BASKET_MIN_G } from './lift.mjs';
import { creditBasket, closeBasket, nextBasketCultivar } from './line.mjs';

export const START_G = 1.0;     // two steps of the 0.5 g scale, so last-digit noise can't start it
export const ON_SCALE_G = 2.0;  // more than this on an idle scale: not a tared empty basket
// Less than this in the basket at the hour mark (the trimmer was away, or just
// swapped): no swap is asked for, the batch simply goes on into the new hour.
export const SWAP_MIN_G = 10;

export function clearPauses(state) {
  state.pausedMs = 0; state.pausedAt = null; state.pauseNote = ''; state.pauseLog = [];
  state.breakPause = false; state.breakEndsAt = null;
}

/** Working time on the basket at `at`: wall time minus every pause, one in progress included. */
export function elapsedMs(state, at) {
  if (!state.startedAt) return null;
  return at - state.startedAt - (state.pausedMs || 0) - (state.pausedAt ? at - state.pausedAt : 0);
}

/**
 * @param {object} o
 * @param {object} o.state     the screen's saved state (mutated)
 * @param {object} o.tally     line.mjs createTally()
 * @param {(at:number)=>string} o.slotOf   the hour key of a moment
 * @param {(at:number, key:string)=>boolean} o.hourOver  that hour has ended at `at`
 * @param {()=>number} o.personId  who is tapped in (0 = nobody)
 * @param {()=>string} o.lineCultivar  Hourly entry's cultivar now
 * @param {{pickup?:Function, finish?:Function}} [o.on]
 */
export function createSeat({ state, tally, slotOf, hourOver, personId, lineCultivar, on = {} }) {
  const watch = createLiftWatch();
  const zero = createZeroWatch();
  let tareAt = null;
  const busy = () => state.phase === 'running' || state.phase === 'finished';
  const net = (gross) => Math.max(0, gross) + (state.bankedG || 0);
  const credit = (at, g) => { if (g) tally.credit(slotOf(at), personId(), state.cultivar, g); };

  function toIdle() {
    state.phase = 'idle'; state.startedAt = null; state.finishedMs = null; state.finishedNetG = null; state.batchSlot = null;
    state.bankedG = 0; state.tareFlagG = 0; clearPauses(state);
  }
  function arm(gross = 0) {
    state.phase = 'armed'; state.startedAt = null; state.finishedMs = null; state.finishedNetG = null; state.batchSlot = null;
    // Crumbs left in a basket back on the scale (under ON_SCALE_G) aren't the next basket's tops.
    state.bankedG = -Math.max(0, gross); state.tareFlagG = 0; state.basketBack = false; state.basketG = 0; clearPauses(state);
  }
  /** After a pickup the basket is back about empty on the tared scale: the next basket arms with no tap. */
  function armIfReady(gross) {
    if (state.basketBack && state.phase === 'idle' && Math.abs(gross) <= ON_SCALE_G) arm(gross);
  }

  function pickup(at, g, gross) {
    const ms = state.phase === 'finished' ? state.finishedMs : elapsedMs(state, at);
    credit(at, closeBasket(state, g));
    const cultivar = state.cultivar;
    tally.pickup(personId());
    if (on.pickup) on.pickup({ g, cultivar, cycleMs: ms, personId: personId() });
    toIdle();
    state.lastMs = ms;
    nextBasketCultivar(state, lineCultivar());
    state.basketBack = true;
    armIfReady(gross);
  }

  // A lift settled: a pickup closes the batch; a shake just carries on (no target to fall under).
  function onLift(at, ev, gross) {
    if (ev.kind === 'pickup') {
      if (!busy()) return false;
      pickup(at, ev.g, gross);
      return true;
    }
    if (state.phase === 'finished') { state.finishedNetG = ev.backNet; return true; }
    return false;
  }

  return {
    get lifted() { return watch.lifted; },
    /** Basket B may be on: the screen asks for the TARE. */
    swapPending(at) { return watch.swapPending(at); },
    get provisional() { return zero.provisional; },
    net,

    /**
     * One live reading (g, what the scale shows). Returns what happened:
     * 'pickup' | 'armed' | 'start' | 'finish' | 'undo' | 'lift' | null.
     */
    reading(at, gross) {
      const loaded = (before) => busy() && before + (state.bankedG || 0) > EMPTY_G;
      const z = zero.reading(at, gross, loaded);
      const lift = watch.reading(at, gross, net(gross));
      if (z && z.kind === 'undoTare') {
        // The basket came back: that "TARE" was an un-tared lift of an empty basket.
        // Undo the basket it started (and anything credited to it).
        if ((state.phase === 'armed' || state.phase === 'running') && tareAt !== null && (!state.startedAt || state.startedAt >= tareAt)) {
          credit(at, -(state.basketG || 0));
          state.basketG = 0;
          toIdle();
        }
        tareAt = null;
        return 'undo';
      }
      if (z && (z.kind === 'pickup' || z.kind === 'tare')) {
        // A drop to 0 right after a basket came back heavy: basket B went on and
        // was tared, so the lift was a pickup of what basket A held. Checked first:
        // B a few grams heavier than A would otherwise read as a tiny pickup.
        const swap = watch.tare(at);
        if (swap && busy()) { if (z.kind === 'tare') tareAt = at; pickup(at, swap.g, gross); return 'pickup'; }
      }
      if (z && z.kind === 'pickup' && busy()) { pickup(at, z.before + (state.bankedG || 0), gross); return 'pickup'; }
      if (z && z.kind === 'tare') {
        tareAt = at;
        if (state.phase === 'idle') { arm(0); return 'armed'; }
        if (state.phase === 'running') {
          // TARE pressed mid-basket with tops in it: keep what was there, and say so.
          state.bankedG = (state.bankedG || 0) + z.before;
          state.tareFlagG = (state.tareFlagG || 0) + z.before;
        }
      }
      if (lift && onLift(at, lift, gross)) return 'lift';
      // Basket off the pan or still coming down: nothing is read off it.
      if (watch.lifted) return null;
      // Just after an empty-basket TARE, a basket-sized reading may be that basket coming back.
      if (zero.provisional && gross >= BASKET_MIN_G) return null;
      let what = null;
      if (state.phase === 'idle' && state.basketBack) { armIfReady(gross); if (state.phase === 'armed') return 'armed'; }
      const n = net(gross);
      if (state.phase === 'armed' && n >= START_G) {
        state.phase = 'running'; state.startedAt = at; state.finishedMs = null; state.batchSlot = slotOf(at); clearPauses(state);
        what = 'start';
      }
      // A basket back heavy with no TARE yet may be basket B: what it reads isn't
      // basket A's tops, so the credit waits until the TARE (a pickup) or GRACE_MS (a shake).
      const waiting = watch.swapPending(at);
      if (!waiting && (state.phase === 'armed' || state.phase === 'running' || state.phase === 'finished')) credit(at, creditBasket(state, Math.max(0, n)));
      if (state.phase === 'running' && state.batchSlot && hourOver(at, state.batchSlot)) {
        if (n < SWAP_MIN_G) {
          state.batchSlot = slotOf(at);   // next to nothing to pick up: carry on into the new hour
        } else {
          state.phase = 'finished'; state.finishedMs = elapsedMs(state, at); state.finishedNetG = n;
          if (on.finish) on.finish();
          what = 'finish';
        }
      }
      return what;
    },

    /** A name tap: on a tared empty basket the next basket is ready. Returns true when it armed. */
    start(gross) {
      if (state.phase !== 'idle' || gross === null || Math.abs(gross) > ON_SCALE_G) return false;
      arm(gross);
      return true;
    },

    /** Hold to reset: the basket goes back to idle. What was already credited to the hours stays. */
    reset() {
      toIdle();
      state.basketBack = false;
      state.basketG = 0;
      watch.reset(); zero.reset(); tareAt = null;
    },
  };
}
