/**
 * How much product is in a supersack.
 *
 * A FULL SACK DEPENDS ON THE CROP YEAR. 37 lb through the 2025 crop; 35 lb from
 * the 2026 crop on (Koa, 2026-09-28). A sack keeps its crop year's weight for
 * its whole life, so 2025 sacks trimmed during 2026 are still 37 lb sacks — the
 * year is the one in the Super Sack variant title ("2025 - Lifter / Sungrown"),
 * never the date the sack was opened.
 *
 * A BAG CAN BE WEIGHED OFF-STANDARD. The last bag of a lot goes out light, and
 * the crew had been writing its weight into the tag's note ("18lb"). Since
 * 2026-09-28 it is a number: harvest_sacks.fill_lbs, null meaning a full sack.
 * That reverses the 2026-09-02 call to accept the light last sack as full — the
 * crew was recording the weight anyway, so the only thing missing was a box a
 * sum could read.
 *
 * Kept in one module so the harvest ledger, the allocator, the floor tracker's
 * API and the bag page cannot disagree about what a sack weighs.
 */

/** Full-sack weight from each crop year on; earlier years fall back to LEGACY. */
const FULL_SACK_LBS_FROM = [[2026, 35]];
const LEGACY_FULL_SACK_LBS = 37;

/** A typed fill weight outside this range is a typo, not a bag. */
export const FILL_LBS_MIN = 1;
export const FILL_LBS_MAX = 60;

export function fullSackLbs(season) {
  const y = Number(season);
  let lbs = LEGACY_FULL_SACK_LBS;
  if (!Number.isFinite(y)) return lbs;
  for (const [from, w] of FULL_SACK_LBS_FROM) if (y >= from) lbs = w;
  return lbs;
}

/** "2026 - Sour Lifter / Sungrown / 1st Cut" -> 2026, or null. */
export function seasonFromTitle(title) {
  const m = /^\s*(\d{4})\s*-/.exec(String(title || ''));
  return m ? Number(m[1]) : null;
}

/**
 * Full-sack weight for a floor strain title. A title with no year is legacy
 * data (the one "Unknown" row), so it keeps the old weight.
 */
export function fullSackLbsForTitle(title) {
  return fullSackLbs(seasonFromTitle(title));
}

/** What one tagged bag weighs: its own fill if it was weighed off-standard. */
export function sackLbs(sack) {
  const fill = Number(sack?.fill_lbs);
  return sack?.fill_lbs != null && Number.isFinite(fill) && fill > 0 ? fill : fullSackLbs(sack?.season);
}

/**
 * A fill weight from a form or JSON body. Blank means a full sack (null).
 * Anything else must be a plausible number of pounds, refused rather than
 * clamped — a clamped typo would read as a real bag.
 */
export function parseFillLbs(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const n = Number(String(raw).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < FILL_LBS_MIN || n > FILL_LBS_MAX) {
    throw new RangeError(`Bag weight must be between ${FILL_LBS_MIN} and ${FILL_LBS_MAX} lb.`);
  }
  return Math.round(n * 10) / 10;
}
