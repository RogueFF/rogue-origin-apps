/**
 * Scoreboard v3 — pace math.
 *
 * Pure functions behind the "where are we against where we should be" marks:
 * the day bar cut into hours with a moving plan tick, the current-hour fill
 * column, the bag dial's time-vs-weight wedge, and the rate needle. No DOM,
 * no Date.now() — callers pass "now" in so the module is testable.
 *
 * Every fraction returned here is 0..1 along one axis: the day's goal in
 * pounds. That is what lets the fill, the plan tick, the hour dividers and the
 * end-of-day marker all sit on the same bar without lying to each other.
 */

/** The ten canonical slots and their break-adjusted multipliers (mirrors the worker). */
export const DEFAULT_SLOTS = [
  { label: '7:00 AM – 8:00 AM', mult: 1.0 },
  { label: '8:00 AM – 9:00 AM', mult: 1.0 },
  { label: '9:00 AM – 10:00 AM', mult: 0.83 },
  { label: '10:00 AM – 11:00 AM', mult: 1.0 },
  { label: '11:00 AM – 12:00 PM', mult: 1.0 },
  { label: '12:30 PM – 1:00 PM', mult: 0.5 },
  { label: '1:00 PM – 2:00 PM', mult: 1.0 },
  { label: '2:00 PM – 3:00 PM', mult: 0.83 },
  { label: '3:00 PM – 4:00 PM', mult: 1.0 },
  { label: '4:00 PM – 4:30 PM', mult: 0.33 },
];

export const BAG_LBS = { '5kg': 11.0231, '10lb': 10 };
export const GRAMS_PER_LB = 453.592;

/** Normalise the dash in a slot label; the API sometimes ships a mojibake en dash. */
export function normalizeSlot(slot) {
  return String(slot || '')
    .replace(/â€“|â€”|Ã¢â‚¬â€œ|[-–—]/g, '–')
    .replace(/\s+/g, ' ')
    .trim();
}

/** '7:01 AM' -> minutes since midnight, or null. */
export function parseClock(str) {
  const m = String(str || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return h * 60 + parseInt(m[2], 10);
}

/** { start, end } in minutes for a slot label, or null. */
export function slotBounds(slot) {
  const parts = normalizeSlot(slot).split('–');
  if (parts.length !== 2) return null;
  const start = parseClock(parts[0]);
  const end = parseClock(parts[1]);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

/** How far through a slot "now" is, 0..1. Outside the slot clamps. */
export function slotElapsedFraction(slot, nowMin) {
  const b = slotBounds(slot);
  if (!b) return 0;
  return clamp((nowMin - b.start) / (b.end - b.start), 0, 1);
}

/** Slot end time, used to match a custom first slot ('7:01 AM – 8:00 AM') to its canonical row. */
function slotEnd(slot) {
  const b = slotBounds(slot);
  return b ? b.end : null;
}

/**
 * The day bar, cut into hours, on the pounds axis.
 *
 * Completed hours use the target the worker graded them against
 * (effective trimmers × rate × multiplier). The hour in progress uses
 * currentHourTarget. Whatever goal is left is spread over the remaining slots
 * in proportion to their multipliers — the same shape the worker's dailyGoal
 * uses, so the last divider lands on the goal.
 *
 * Returns [{ label, frac0, frac1, state }] with state 'done' | 'current' | 'future'.
 */
export function daySegments({ hourlyRates = [], currentSlot = '', currentHourTarget = 0, dailyGoal = 0 } = {}) {
  const byEnd = new Map();
  for (const row of hourlyRates) {
    const end = slotEnd(row.timeSlot);
    if (end === null) continue;
    const target = (row.effectiveTrimmers || row.trimmers || 0) * (row.target || 0) * (row.multiplier || 1);
    byEnd.set(end, { target, mult: row.multiplier || 1 });
  }
  const curEnd = slotEnd(currentSlot);

  const slots = DEFAULT_SLOTS.map((s) => {
    const end = slotEnd(s.label);
    const done = byEnd.get(end);
    if (done) return { label: s.label, lbs: done.target, state: 'done', mult: done.mult };
    if (curEnd !== null && end === curEnd) return { label: s.label, lbs: currentHourTarget, state: 'current', mult: s.mult };
    return { label: s.label, lbs: 0, state: 'future', mult: s.mult };
  });

  const committed = slots.reduce((a, s) => a + (s.state === 'future' ? 0 : s.lbs), 0);
  const futureMult = slots.reduce((a, s) => a + (s.state === 'future' ? s.mult : 0), 0);
  const remaining = Math.max(0, dailyGoal - committed);
  for (const s of slots) {
    if (s.state === 'future') s.lbs = futureMult > 0 ? remaining * (s.mult / futureMult) : 0;
  }

  let total = slots.reduce((a, s) => a + s.lbs, 0);
  if (!(total > 0)) {
    // Nothing known yet: fall back to multiplier widths so the bar still reads as a day.
    total = slots.reduce((a, s) => a + s.mult, 0);
    for (const s of slots) s.lbs = s.mult;
  }

  let acc = 0;
  return slots.map((s) => {
    const frac0 = acc / total;
    acc += s.lbs;
    return { label: s.label, frac0, frac1: acc / total, state: s.state };
  });
}

/**
 * Where the plan says we should be right now, as a fraction of the day goal.
 * Completed hours' targets plus the current hour's target scaled by how far
 * through the hour we are. After the shift the plan is the whole goal.
 */
export function planNowFraction({ todayTarget = 0, currentHourTarget = 0, currentSlot = '', nowMin = 0, dailyGoal = 0, shiftEnded = false } = {}) {
  if (!(dailyGoal > 0)) return 0;
  if (shiftEnded) return 1;
  const expected = todayTarget + currentHourTarget * slotElapsedFraction(currentSlot, nowMin);
  return clamp(expected / dailyGoal, 0, 1);
}

/** Pounds expected so far in the current hour. */
export function hourExpectedNow({ currentHourTarget = 0, currentSlot = '', nowMin = 0 } = {}) {
  return currentHourTarget * slotElapsedFraction(currentSlot, nowMin);
}

/**
 * Pounds produced so far in the current hour, estimated from what the crew can
 * see: bags logged inside the slot plus whatever is on the scale now.
 * `bagMinutes` are bag completion times already converted to local minutes.
 *
 * The bag on the scale may have started before this hour. Without a weight
 * history the fairest split is by time: the hour is credited with the share of
 * the bag's life that falls inside it (`bagStartMin` is the previous bag's
 * completion; omit it to credit the whole scale reading).
 */
export function hourSoFarLbs({ bagMinutes = [], bagLbs = 10, scaleGrams = 0, scaleStale = true, currentSlot = '', bagStartMin = null, nowMin = null } = {}) {
  const b = slotBounds(currentSlot);
  if (!b) return 0;
  const bags = bagMinutes.filter((m) => m >= b.start && m < b.end).length;
  let onScale = scaleStale ? 0 : Math.max(0, scaleGrams) / GRAMS_PER_LB;
  if (onScale > 0 && bagStartMin !== null && nowMin !== null && bagStartMin < b.start && nowMin > bagStartMin) {
    onScale *= clamp((nowMin - b.start) / (nowMin - bagStartMin), 0, 1);
  }
  return bags * bagLbs + onScale;
}

/** Grams the scale should read at this point in the bag, if the bag is to land on target. */
export function bagExpectedGrams(elapsedSec, targetSec, targetGrams) {
  if (!(targetSec > 0) || !(targetGrams > 0)) return 0;
  return Math.min(targetGrams, targetGrams * (elapsedSec / targetSec));
}

/** At the current fill rate, seconds from bag start to a full bag. Null before any weight. */
export function bagLandsAtSec(elapsedSec, grams, targetGrams) {
  if (!(grams > 0) || !(targetGrams > 0) || !(elapsedSec > 0)) return null;
  return elapsedSec * (targetGrams / grams);
}

/** Today's realised rate: tops per effective trimmer-hour across completed hours. */
export function realizedRate(hourlyRates = []) {
  let lbs = 0;
  let hours = 0;
  for (const r of hourlyRates) {
    lbs += r.lbs || 0;
    hours += (r.effectiveTrimmers || r.trimmers || 0) * (r.multiplier || 1);
  }
  return hours > 0 ? lbs / hours : 0;
}

/** Needle angle in degrees: 0 = on target, ±90 = ±50% of target. */
export function needleAngle(rate, target) {
  if (!(target > 0) || !(rate >= 0)) return 0;
  return clamp((rate / target - 1) * 180, -90, 90);
}

/** Progress fraction implied by a stroke-dashoffset the ring modules wrote. */
export function arcFractionFromOffset(offset, circumference) {
  const o = parseFloat(offset);
  if (!isFinite(o) || !(circumference > 0)) return 0;
  return clamp(1 - o / circumference, 0, 1);
}

/**
 * Annular sector between two ring fractions, in the ring SVG's own frame.
 * The scoreboard rotates the SVG -90deg so a circle's dash starts at 12 o'clock;
 * this path is written in the un-rotated frame (0 = 3 o'clock, clockwise) so it
 * lands under the same rotation. Empty string when the gap is too small to see.
 */
export function wedgePath(cx, cy, rOuter, rInner, fracA, fracB) {
  const a = clamp(Math.min(fracA, fracB), 0, 1);
  let b = clamp(Math.max(fracA, fracB), 0, 1);
  if (b - a < 0.005) return '';
  if (b - a > 0.9999) b = a + 0.9999;
  const ta = a * 2 * Math.PI;
  const tb = b * 2 * Math.PI;
  const large = b - a > 0.5 ? 1 : 0;
  const p = (r, t) => `${(cx + r * Math.cos(t)).toFixed(2)} ${(cy + r * Math.sin(t)).toFixed(2)}`;
  return `M ${p(rOuter, ta)} A ${rOuter} ${rOuter} 0 ${large} 1 ${p(rOuter, tb)} L ${p(rInner, tb)} A ${rInner} ${rInner} 0 ${large} 0 ${p(rInner, ta)} Z`;
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
