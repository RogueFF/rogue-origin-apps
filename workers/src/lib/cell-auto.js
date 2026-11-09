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
 *   - A straight drop to about 0 with no lift in between is someone pressing
 *     the scale's TARE:
 *       after a single jump from about 0 (a basket set down, then tared):
 *         that jump was the basket, not tops, so it is taken back out;
 *       after trimming (more than one rise): a mid-job TARE. What was on the
 *         pan is banked as tops (nothing taken back) and the hour is flagged
 *         so a lead can check it.
 */
import { pacificParts, parseSqliteUtc } from './pacific.js';

export const LIFT_G = 1.0;       // net below -1 g: the basket is off the pan
export const ZERO_G = 0.5;       // a TARE'd scale reads 0.00; this is "about 0"
export const EMPTY_G = 2.0;      // a basket back within 2 g of zero is empty
export const GRACE_MS = 90 * 1000;
// The JINXUAN streams ~10 lines/s with no stability marker, so every reading
// arrives marked stable. A reading only counts as settled if the scale held it:
// the next logged reading is at least SETTLE_MS later (logs are to the second).
// Readings passing through while a basket goes on or off are skipped.
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
  const atZero = () => { segment = []; rises = 0; };

  for (let i = 0; i < timeline.length; i++) {
    const e = timeline[i];
    if (e.type === 'pickup') { if (lift) lift.tapped = true; continue; }

    const net = e.g;
    if (net < -LIFT_G) {                                   // basket off the pan
      if (!lift && lastNet !== null) lift = { fromNet: lastNet, tapped: false };
      continue;
    }
    if (lastNet === null) { lastNet = net; if (Math.abs(net) <= ZERO_G) atZero(); continue; }

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

    if (Math.abs(net) <= ZERO_G && lastNet > EMPTY_G) {
      // A straight drop to about 0, no lift: someone pressed the scale's TARE.
      if (rises <= 1) {
        // A basket set down, then tared: take that jump back out.
        for (const c of segment) gBySlot[c.slot] -= c.g;
      } else {
        flag(e.at.minutes, 'scaleTared');                  // mid-job TARE: bank it, flag it
      }
      lastNet = net; atZero();
      continue;
    }

    credit(net - lastNet, e.at.minutes);
    lastNet = net;
    if (Math.abs(net) <= ZERO_G) atZero();
  }

  const bySlot = {};
  for (const [s, g] of Object.entries(gBySlot)) {
    const lb = Math.round((g / G_PER_LB) * 100) / 100;
    if (lb !== 0 || flags[s]) bySlot[s] = lb;
  }
  return { bySlot, flags, pickups };
}
