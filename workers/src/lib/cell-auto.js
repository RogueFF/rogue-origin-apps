/**
 * Hourly tops for a cell, worked out from its scale (Koa 2026-11-09: cell 1
 * fills itself from table1).
 *
 * The scale reports what is on the pan now (gross, basket included), not what
 * was made. Inputs, all for one station and one Pacific day:
 *   readings  settled weights from scale_events: [{ ts, kg }] (ts = SQLite UTC text)
 *   marks     from the cell screen, scale_marks: [{ ts, kind: 'tare'|'pickup', kg }]
 *             tare   = the empty basket's gross when Tare was pressed
 *             pickup = the job was lifted off for bagging (the screen's lift-to-close)
 *   slots     [{ slot, startMin, endMin }] in Pacific minutes
 *
 * Rules (main session, addendum 2):
 *   - Tops made = the change in net weight on the pan, net = gross - basket.
 *     Each change is credited to the hour of the reading that shows it, so an
 *     hour's total is "net at the end of the hour - net at its start" plus
 *     whatever was picked up in between.
 *   - A lift (the pan reads under the basket weight) is not a change. What
 *     comes back decides it:
 *       about empty (|net| <= EMPTY_G)            pickup: nothing lost
 *       a pickup mark during the lift              pickup (partial): the drop isn't lost
 *       a Tare within GRACE_MS after it comes back a new basket for the next job: pickup
 *       anything else                              a shake: the drop is credited
 *                                                  (shaken-out biomass was never tops)
 *   - The hour mark landing mid-lift: the hour keeps the last reading from
 *     before the lift, and the outcome lands in the hour it comes back in.
 *   - Without a Tare on the screen, the basket weight is the first settled
 *     reading after an empty pan (or the day's first reading).
 */
import { pacificParts, parseSqliteUtc } from './pacific.js';

export const EMPTY_PAN_G = 1.0;   // the pan itself is empty below this
export const EMPTY_G = 2.0;       // a basket within this of its tare is empty
export const GRACE_MS = 90 * 1000;
const G_PER_LB = 453.59237;

function liftThreshold(tareG) {
  return Math.max(EMPTY_PAN_G, Math.min(5, tareG * 0.5));
}

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
 * @returns {{ bySlot: Object<string, number>, pickups: Array<{ts:string, g:number}> }}
 *          bySlot in lb (2 dp), only slots with any change.
 */
export function autoTops({ day, readings = [], marks = [], slots }) {
  const timeline = [
    ...readings.map(r => ({ type: 'reading', ts: r.ts, g: r.kg * 1000 })),
    ...marks.map(m => ({ type: m.kind, ts: m.ts, g: (m.kg || 0) * 1000 })),
  ]
    .map(e => ({ ...e, at: pacificAt(e.ts) }))
    .filter(e => e.at.day === day)
    .sort((a, b) => a.at.ms - b.at.ms || (a.type === 'reading' ? -1 : 1));

  const gBySlot = {};
  const pickups = [];
  let tare = null;          // basket gross, g
  let lastNet = null;       // net on the pan at the last on-pan reading
  let lift = null;          // { fromNet, startMs, tapped }
  const credit = (g, minutes) => {
    if (!g) return;
    const s = slotFor(minutes, slots);
    gBySlot[s] = (gBySlot[s] || 0) + g;
  };

  for (let i = 0; i < timeline.length; i++) {
    const e = timeline[i];
    if (e.type === 'tare') {
      tare = e.g;
      if (lift) { // a new basket went on during a lift: whatever was lifted is a pickup
        pickups.push({ ts: e.ts, g: lift.fromNet });
        lift = null;
      }
      lastNet = 0;
      continue;
    }
    if (e.type === 'pickup') {
      if (lift) lift.tapped = true;
      else if (lastNet !== null) { pickups.push({ ts: e.ts, g: lastNet }); }
      continue;
    }

    // a settled reading
    if (tare === null) {
      if (e.g < EMPTY_PAN_G) continue;          // nothing on the pan yet
      tare = e.g; lastNet = 0; continue;        // no Tare pressed: the first basket on is the tare
    }
    const lifted = e.g < tare - liftThreshold(tare);
    if (lifted) {
      if (!lift && lastNet !== null) lift = { fromNet: lastNet, startMs: e.at.ms, tapped: false };
      continue;
    }
    const net = e.g - tare;
    if (lift) {
      const tareSoon = timeline.slice(i + 1).find(x => x.type === 'tare' && x.at.ms - e.at.ms <= GRACE_MS);
      if (tareSoon) continue;                    // the Tare that follows settles it as a new basket
      if (Math.abs(net) <= EMPTY_G || lift.tapped) {
        pickups.push({ ts: e.ts, g: lift.fromNet - (lift.tapped ? net : 0) });
      } else {
        credit(net - lift.fromNet, e.at.minutes);  // a shake
      }
      lift = null; lastNet = net;
      continue;
    }
    if (lastNet === null) { lastNet = net; continue; }
    credit(net - lastNet, e.at.minutes);
    lastNet = net;
  }

  const bySlot = {};
  for (const [s, g] of Object.entries(gBySlot)) bySlot[s] = Math.round((g / G_PER_LB) * 100) / 100;
  return { bySlot, pickups };
}
