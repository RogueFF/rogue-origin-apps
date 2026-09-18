/**
 * Barn rack anatomy: how a counted rack turns into a branch count.
 *
 * The hourly SMS log asks the barn foreman for one number — `racks` — and
 * nothing downstream knew what a rack held. "27 racks today" was a tally of an
 * undefined unit: fine for comparing one day against the next, useless for
 * asking how much of a zone is hanging, or whether a bay is going to hold the
 * trailer already on its way.
 *
 * Operator-supplied structure (Koa, 2026-09-18, with photos of the bottom
 * barn): a rack — the crew calls it a STICK, the horizontal strut carrying the
 * hanger arms — holds SEVEN hangers, and each hanger takes SEVEN TO NINE
 * branches ON EITHER SIDE. The branches straddle the notched arm, so a hanger
 * is two sides, not one.
 *
 * TERMS. The unit the crew counts is the stick; the unit the code, the SMS
 * parser and the dashboard have always called it is the rack. They are the
 * same object, and this file is the one place that says so — so if it turns out
 * a reported "rack" is something coarser than one stick, the fix is
 * HANGERS_PER_RACK here and nothing else.
 *
 * A RANGE, NOT A NUMBER. Seven to nine is a real spread — a bushy Z14 branch
 * does not pack like a lower cut — so every conversion carries min/typical/max
 * rather than a single figure that would read as a measurement. Anything shown
 * to a foreman off these numbers is an estimate and must be labelled as one.
 */

/** Hanger arms on one stick. */
export const HANGERS_PER_RACK = 7;

/** A branch straddles the arm: both sides fill. */
export const SIDES_PER_HANGER = 2;

/** Branches per arm, per side. */
export const BRANCHES_PER_HANGER_SIDE = { min: 7, typical: 8, max: 9 };

const scale = (band, by) => ({
  min: band.min * by, typical: band.typical * by, max: band.max * by,
});

/** 14–18 branches on one hanger arm. */
export const BRANCHES_PER_HANGER = scale(BRANCHES_PER_HANGER_SIDE, SIDES_PER_HANGER);

/** 98–126 branches on one rack. */
export const BRANCHES_PER_RACK = scale(BRANCHES_PER_HANGER, HANGERS_PER_RACK);

/** Whole, non-negative, and actually a number — an SMS count reaches here. */
const isCount = (n) => Number.isInteger(n) && n >= 0;

/**
 * Branches hanging on `racks` racks.
 * Null for anything that is not a whole count, so a missing hour (null racks)
 * stays missing instead of becoming a confident zero.
 */
export function branchesForRacks(racks) {
  if (!isCount(racks)) return null;
  return scale(BRANCHES_PER_RACK, racks);
}

/** Hanger arms filled by `racks` racks. */
export function hangersForRacks(racks) {
  if (!isCount(racks)) return null;
  return racks * HANGERS_PER_RACK;
}

/**
 * Racks needed to hang `branches` branches.
 *
 * The bands invert: packing a rack at its fullest (max branches) needs the
 * FEWEST racks, so max-per-rack feeds `min`. Ceilings throughout — a part-full
 * rack is still a rack occupied, and rounding down would promise barn space
 * that is not there.
 */
export function racksForBranches(branches) {
  if (!isCount(branches)) return null;
  return {
    min: Math.ceil(branches / BRANCHES_PER_RACK.max),
    typical: Math.ceil(branches / BRANCHES_PER_RACK.typical),
    max: Math.ceil(branches / BRANCHES_PER_RACK.min),
  };
}

/** "≈1,800–2,300 branches" — one way of writing a band, so every screen agrees. */
export function formatBand(band, unit) {
  if (!band) return '—';
  const n = (x) => x.toLocaleString('en-US');
  const tail = unit ? ' ' + unit : '';
  return band.min === band.max ? '≈' + n(band.min) + tail
    : '≈' + n(band.min) + '–' + n(band.max) + tail;
}
