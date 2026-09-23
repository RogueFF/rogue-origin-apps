/**
 * What each drying bay holds, in sticks.
 *
 * Counted by hand and photographed into the notebook (Koa, 2026-09-23 —
 * raw/barn/2026-09-23-bay-stick-capacities.webp in the wiki). Measured, not
 * derived: every earlier capacity figure on the farm came from multiplying
 * structure (sections x walls x racks) and the structure numbers contradicted
 * each other. These are counts of the actual sticks a bay takes.
 *
 * A STICK IS A RACK — one unit, two words (see wiki/farm/upper-barn § Units).
 * So these are directly comparable with harvest_hourly.racks, which is what the
 * barn reports each hour.
 *
 * BAYS 1-3 ARE ABSENT ON PURPOSE. They exist, but hang on a different system
 * that the apps do not measure (Koa, 2026-09-23). Absent means "no capacity
 * known", never "no bay" — bayCapacity returns null for them, and a null must
 * be shown as unknown rather than folded into a total as zero.
 */

export const BAY_STICKS = {
  4: 411, 5: 415, 6: 409, 7: 418, 8: 482,   // bottom barn
  9: 512, 10: 512, 11: 516, 12: 516,        // top barn
};

/** Sticks this bay holds, or null when it is not on the measured system. */
export function bayCapacity(bay) {
  const n = Number(bay);
  return Number.isInteger(n) && BAY_STICKS[n] !== undefined ? BAY_STICKS[n] : null;
}

const sum = (bays) => bays.reduce((t, b) => t + BAY_STICKS[b], 0);

/** Bottom 4-8 = 2,135 · top 9-12 = 2,056 · 4,191 hanging at once. */
export const BARN_STICKS = {
  bottom: sum([4, 5, 6, 7, 8]),
  top: sum([9, 10, 11, 12]),
};

export const FARM_STICKS = BARN_STICKS.bottom + BARN_STICKS.top;

/**
 * The sustainable cut rate: everything hanging, divided by the dry cycle. The
 * ceiling that sets harvest duration ahead of labour — see
 * wiki/operations/harvest-takt-model-2026.
 */
export function dailyCeiling(dryDays = 10) {
  return Math.round(FARM_STICKS / dryDays);
}
