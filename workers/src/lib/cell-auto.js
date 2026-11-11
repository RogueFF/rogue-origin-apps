/**
 * Hourly tops for a cell, worked out from its scale (Koa 2026-11-09: cell 1
 * fills itself from table1).
 *
 * The crew tare on the scale itself with the basket on (tare test 2026-11-09:
 * after TARE the scale sends net weight; with v6.3 firmware a lifted basket
 * reads negative). So every reading is net: about 0 = empty basket, negative
 * = basket lifted. Inputs, one station and one Pacific day:
 *   readings  settled weights from scale_events: [{ ts, kg }] (ts = SQLite UTC text)
 *   marks     from the cell screen, scale_marks: [{ ts, kind, kg }]; only
 *             kind 'pickup' is used (the screen's lift-to-close)
 *   slots     [{ slot, startMin, endMin }] in Pacific minutes
 *
 * Rules (main session, addendum 2 + the tare-on-scale change):
 *   - Tops made = the change in net weight, credited to the hour of the reading
 *     that shows it: an hour's total is "net at its end - net at its start" plus
 *     whatever was picked up in between.
 *   - A lift (net below -LIFT_G) is not a change. What comes back decides it:
 *       about empty (|net| <= EMPTY_G), a pickup mark during the lift, or a
 *       scale TARE (a drop to about 0) within GRACE_MS of coming back: pickup.
 *       Anything else: a shake, and the drop is credited (shaken-out biomass
 *       was never tops).
 *   - The hour mark landing mid-lift: the hour keeps the last reading from
 *     before the lift; the outcome lands in the hour the basket comes back in.
 *   - A straight drop to about 0 with no lift in between is either someone
 *     pressing the scale's TARE or, on a scale nobody tared (it reads GROSS,
 *     bench test 2026-11-11), a basket lifted off: an un-tared lift reads 0, not
 *     negative. The two look the same until the next settled reading, so the
 *     zero waits for it (Koa 2026-11-11, "automatic + guard"):
 *       a basket-sized jump back (>= BASKET_MIN_G, while the segment's first
 *       rise was a basket of that size): an un-tared LIFT. That first rise was
 *       the basket, not tops, so it comes back out of its hour, and the scale's
 *       empty-basket reading is remembered. Then, like a negative lift:
 *         back within EMPTY_G of the empty basket: pickup (what it held);
 *         back within EMPTY_G of where it was: set down with everything, no change;
 *         anywhere else: a shake, the difference is credited.
 *       a pickup mark from the cell screen during the zero: a two-basket swap
 *       (Koa 2026-11-11: full basket to the pickup spot, the matched empty one
 *       on, within EMPTY_G) that showed no settled negative. A pickup. The
 *       screen sees the live stream; this log only keeps settled readings, so
 *       the screen's mark is how it knows. After trimming, "about 0" is within
 *       EMPTY_G, since a matched basket reads up to 2 g either way.
 *       anything else (a small rise as trimming carries on, a negative lift, or
 *       the zero holding past GRACE_MS): it was the scale's TARE after all.
 *         The reading before was an empty basket (a single jump from about 0,
 *         or the remembered empty-basket reading): that jump was the basket,
 *         taken back out, and the scale now reads net.
 *         After trimming: a mid-job TARE. What was on the pan is banked as tops
 *         (nothing taken back) and the hour is flagged so a lead can check it.
 */
import { pacificParts, parseSqliteUtc } from './pacific.js';

export const LIFT_G = 1.0;       // net below -1 g: the basket is off the pan
export const ZERO_G = 0.5;       // a TARE'd scale reads 0.00; this is "about 0"
export const EMPTY_G = 2.0;      // a basket back within 2 g of zero is empty
export const GRACE_MS = 90 * 1000;
// An empty basket weighs well over this (168 g on the bench) and a first handful
// of tops well under it: a jump this big off about 0 is a basket going on.
export const BASKET_MIN_G = 50;
// The JINXUAN streams ~10 lines/s with no stability marker, so every reading
// arrives marked stable. A reading only counts as settled if the scale held it:
// the next logged reading is at least SETTLE_MS later (logs are to the second).
// Readings passing through while a basket goes on or off are skipped.
// v6.5 firmware only posts stable=1 once the weight has held (bench 2026-11-11:
// settled posts 4.3-5.0 s apart, floor ~1.5 s), and scale_events keeps only
// those. Timestamps are whole seconds, so 1.2 s and 2 s pass the same readings.
export const SETTLE_MS = 2000;
const G_PER_LB = 453.59237;

/** Pacific day + minutes of a SQLite UTC timestamp. */
export function pacificAt(ts) {
  const d = parseSqliteUtc(ts);
  const p = pacificParts(d);
  return { day: p.day, minutes: p.hour * 60 + p.minute, ms: d.getTime() };
}

/** The slot a moment belongs to; a gap (lunch) goes to the next slot. */
export function slotFor(minutes, slots) {
  for (const s of slots) if (minutes >= s.startMin && minutes < s.endMin) return s.slot;
  const next = slots.find(s => s.startMin >= minutes);
  return (next || slots[slots.length - 1]).slot;
}

/**
 * @returns {{ bySlot: Object<string, number>, flags: Object<string, string[]>,
 *             pickups: Array<{ts:string, g:number}> }}  bySlot in lb (2 dp)
 */
export function autoTops({ day, readings = [], marks = [], slots }) {
  const timeline = [
    ...readings.map(r => ({ type: 'reading', ts: r.ts, g: r.kg * 1000 })),
    ...marks.filter(m => m.kind === 'pickup').map(m => ({ type: 'pickup', ts: m.ts })),
  ]
    .map(e => ({ ...e, at: pacificAt(e.ts) }))
    .filter(e => e.at.day === day)
    // Same second: keep log order (ts, id); a reading sorts before a mark.
    .sort((a, b) => a.at.ms - b.at.ms || (b.type === 'reading') - (a.type === 'reading'))
    .filter((e, i, all) => {
      if (e.type !== 'reading') return true;
      const next = all.slice(i + 1).find(x => x.type === 'reading');
      return !next || next.at.ms - e.at.ms >= SETTLE_MS;
    });

  const gBySlot = {};
  const flags = {};
  const pickups = [];
  let lastNet = null;       // net at the last on-pan reading
  let lift = null;          // { fromNet, tapped }
  // Credits since the scale last read about 0, so a basket set down and then
  // tared can be taken back out of the hours it landed in.
  let segment = [];         // [{ slot, g }] positive and negative changes since about-0
  let rises = 0;            // how many rises since about-0
  // A scale nobody tared reads GROSS: emptyG is its empty-basket reading once a
  // lift has shown it (0 = the scale reads net). pending: a drop to about 0
  // waiting for the next settled reading to say TARE or un-tared lift.
  let emptyG = 0;
  let pending = null;       // { fromNet, minutes, ms, tapped }
  let segStart = 0;         // where the segment started: 0, or the day's first reading (a basket already on)

  const credit = (g, minutes) => {
    if (!g) return;
    const s = slotFor(minutes, slots);
    gBySlot[s] = (gBySlot[s] || 0) + g;
    segment.push({ slot: s, g });
    if (g > 0) rises++;
  };
  const flag = (minutes, what) => {
    const s = slotFor(minutes, slots);
    (flags[s] = flags[s] || []).includes(what) || flags[s].push(what);
  };
  const atZero = () => { segment = []; rises = 0; segStart = 0; };
  // The segment's first rise, when it was basket-sized: the basket going on.
  const basketRise = () => (segment[0] && segment[0].g >= BASKET_MIN_G ? segment[0] : null);
  // Is there a basket to measure against: remembered, already on when the day
  // began (never credited), or the segment's first, basket-sized rise.
  const hasBasket = () => emptyG > 0 || segStart >= BASKET_MIN_G || basketRise() !== null;
  // The empty basket's reading on an un-tared scale: remembered, or the first
  // rise (taken back out of its hour: it was the basket, never tops).
  const learnEmpty = () => {
    if (emptyG > 0) return emptyG;
    if (segStart >= BASKET_MIN_G) { emptyG = segStart; return emptyG; }
    const b = basketRise();
    if (!b) return 0;
    gBySlot[b.slot] -= b.g;
    emptyG = b.g;
    b.g = 0;
    return emptyG;
  };
  // The pending zero was the scale's TARE after all.
  const tared = () => {
    const p = pending;
    pending = null;
    if (emptyG > 0 ? p.fromNet - emptyG <= EMPTY_G : rises <= 1) {
      // An empty basket, then TARE: that jump was the basket.
      if (emptyG === 0) for (const c of segment) gBySlot[c.slot] -= c.g;
    } else {
      flag(p.minutes, 'scaleTared');                       // mid-job TARE: bank it, flag it
    }
    emptyG = 0; lastNet = 0; atZero();
  };

  for (let i = 0; i < timeline.length; i++) {
    const e = timeline[i];
    if (e.type === 'pickup') { if (lift) lift.tapped = true; if (pending) pending.tapped = true; continue; }

    const net = e.g;
    if (pending) {
      if (Math.abs(net) <= pending.tol && e.at.ms - pending.ms <= GRACE_MS) continue;   // still off, or tared and empty
      const basket = hasBasket();
      if (net >= BASKET_MIN_G && basket && e.at.ms - pending.ms <= GRACE_MS) {
        // An un-tared lift: the basket is back.
        const { fromNet, tapped } = pending;
        pending = null;
        const empty = learnEmpty();
        if (tapped || Math.abs(net - empty) <= EMPTY_G) {
          // An empty basket lifted and set back is not a pickup.
          if (tapped || fromNet - empty > EMPTY_G) pickups.push({ ts: e.ts, g: fromNet - empty });
          lastNet = net; atZero();
        } else if (Math.abs(net - fromNet) > EMPTY_G) {
          credit(net - fromNet, e.at.minutes);             // a shake
          lastNet = net;
        } else {
          lastNet = net;                                   // set down with everything
        }
        continue;
      }
      if (pending.tapped) {
        // The cell screen closed the job during the zero (its pickup mark): a
        // two-basket swap with no settled negative between. A pickup, not a TARE.
        pickups.push({ ts: e.ts, g: pending.fromNet - emptyG });
        pending = null; lastNet = 0; atZero();
      } else {
        tared();                                           // then this reading as usual
      }
    }
    if (net < -LIFT_G) {                                   // basket off the pan
      if (!lift && lastNet !== null) lift = { fromNet: lastNet, tapped: false };
      continue;
    }
    if (lastNet === null) { lastNet = net; if (Math.abs(net) <= ZERO_G) atZero(); else segStart = net; continue; }

    if (lift) {
      // A TARE shortly after it comes back means a new basket went on: pickup.
      const tareSoon = timeline.slice(i + 1).find(x => x.type === 'reading'
        && x.at.ms - e.at.ms <= GRACE_MS && Math.abs(x.g) <= ZERO_G);
      const liftedBetween = tareSoon && timeline.slice(i + 1, timeline.indexOf(tareSoon))
        .some(x => x.type === 'reading' && x.g < -LIFT_G);
      if (Math.abs(net) <= EMPTY_G || lift.tapped || (tareSoon && !liftedBetween)) {
        pickups.push({ ts: e.ts, g: lift.fromNet - (lift.tapped ? Math.max(0, net) : 0) });
        lift = null; lastNet = net; atZero();
        // A heavier or lighter new basket: skip to its TARE, which zeroes it.
        if (tareSoon && !liftedBetween && Math.abs(net) > EMPTY_G) { i = timeline.indexOf(tareSoon); lastNet = 0; }
        continue;
      }
      credit(net - lift.fromNet, e.at.minutes);            // a shake
      lift = null; lastNet = net;
      continue;
    }

    // About 0: within ZERO_G, or within EMPTY_G after trimming (a matched empty
    // basket swapped on reads up to 2 g either way).
    const tol = rises > 1 || segStart >= BASKET_MIN_G ? EMPTY_G : ZERO_G;
    if (Math.abs(net) <= tol && lastNet > EMPTY_G) {
      // A straight drop to about 0, no lift: the scale's TARE, or a basket lifted
      // off a scale nobody tared. The next settled reading decides (see above).
      pending = { fromNet: lastNet, minutes: e.at.minutes, ms: e.at.ms, ts: e.ts, tapped: false, tol };
      continue;
    }

    credit(net - lastNet, e.at.minutes);
    lastNet = net;
    if (Math.abs(net) <= ZERO_G) atZero();
  }

  // The log ended on the zero (no reading since): the screen's pickup mark, if it
  // sent one, says swap; otherwise the TARE rule stands.
  if (pending && pending.tapped) pickups.push({ ts: pending.ts, g: pending.fromNet - emptyG });
  else if (pending) tared();

  const bySlot = {};
  for (const [s, g] of Object.entries(gBySlot)) {
    const lb = Math.round((g / G_PER_LB) * 100) / 100;
    if (lb !== 0 || flags[s]) bySlot[s] = lb;
  }
  return { bySlot, flags, pickups };
}
