/**
 * Which cultivars are planted in each 2026 zone.
 *
 * A harvest lot is zone x cultivar x cut, so a zone holding more than one
 * cultivar needs the cutter to say WHICH one they are cutting - the zone sign
 * QR shows a picker before opening the session. Single-cultivar zones skip
 * the picker entirely and go straight in.
 *
 * GENERATED from the authoritative sign data in the wiki repo:
 *   outputs/presentations/build-2026-zone-signs.py (ZONE_META + STRAIN_LAYOUTS)
 * Re-generate rather than hand-editing if the planting plan changes.
 */

export const ZONE_CULTIVARS = {
  'Z1': ["Sour Lifter"],
  'Z2': ["Sour Lifter"],
  'Z3': ["Sour Lifter"],
  'Z4': ["Sour Lifter"],
  'Z5': ["Sour Lifter"],
  'Z6': ["Sour Lifter"],
  'Z7': ["Sour Lifter"],
  'Z8': [
    "Lemon",
    "Platinum",
    "Platinum M A4",
    "Rainbow GMO Quik",
    "Rainbow Cake",
    "Blue Pineapple Quik",
    "Orange Pineapple Quik",
  ],
  'Z9': ["Sour Lifter"],
  'Z10': [
    "Puff Pastries",
    "Demi Glaze",
    "Mandarin Chocolate",
    "Strawberry Cream",
    "Strawberry Doughnuts",
    "Snickerdoodle",
    "Animal Muffins",
    "Mountain Apple",
    "Tahitian",
    "Limey Lifter",
    "Key Lime CBG",
    "Spruce Dough",
    "Rocket Sauce",
    "Lemon",
    "GMO Belly",
  ],
  'Z11': ["Sour Lifter"],
  'Z12': ["Sour Lifter"],
  'Z13': ["Sour Lifter"],
  'Z14': [
    "Lifter",
    "Sour Lifter",
  ],
  'Z15': [
    "Lifter",
    "Sour Lifter",
  ],
  'Z16': ["Sour Lifter"],
  'Z17': ["Sour Lifter"],
  'Z18': ["Sour Lifter"],
  'Z19': ["Lifter"],
  'Z20': ["Lifter"],
  'Z21': ["Lifter"],
  'R1': [
    "Orange Fritter",
    "Strawberry Fritter",
    "Strawberry Sauce",
    "Purple Snow",
    "Sauciere",
    "Animal Muffins",
    "Strawberry Doughnuts",
  ],
};


/**
 * Rows per cultivar, for the zones that hold more than one.
 *
 * A trial zone is planted in bands running the full width of the zone, so a
 * cultivar's share of the ground is its share of the rows. Without this every
 * lot in a trial zone reported the WHOLE ZONE as its area: a Rainbow GMO Quik
 * tag read 0.468 ac and ~906 plants when its six bands are 0.076 ac and ~147
 * plants — 6x over, on the denominator of every yield-per-acre and
 * yield-per-plant figure, in the three blocks that exist to compare cultivars.
 * (Koa spotted it on a printed tag, 2026-09-09.)
 *
 * ROW SHARE IS THE FARM'S OWN METHOD, not one invented here. R1 is recorded
 * with both rows and acres and reproduces exactly: 4 of 54 rows x 0.705 ac =
 * 0.052 against a stated 0.05, and 15 rows = 0.196 against a stated 0.20. The
 * approved FSA-578 derives Z8 the same way.
 *
 * Counts come from the zone pages in the wiki and are the CURRENT layout. Z8's
 * 578 acres are deliberately not used: they predate the 2026-07-29 correction
 * (Rainbow GMO Quik went 12 rows to 6) and a revised 578 is owed.
 *
 * Fractions are real — Z10 was hand-planted and some bands are half rows.
 */
export const ZONE_CULTIVAR_ROWS = {
  // 37 rows, bands E-W stacked N->S. wiki/farm/zones/z8.md, corrected 2026-07-29.
  'Z8': {
    'Lemon': 1, 'Platinum': 5, 'Platinum M A4': 9, 'Rainbow GMO Quik': 6,
    'Rainbow Cake': 6, 'Blue Pineapple Quik': 4, 'Orange Pineapple Quik': 6,
  },
  // 37 rows over 15 cultivars, hand-planted N->S. wiki/farm/zones/z10.md.
  'Z10': {
    'Puff Pastries': 5, 'Demi Glaze': 6, 'Mandarin Chocolate': 4,
    'Strawberry Cream': 2, 'Strawberry Doughnuts': 2, 'Snickerdoodle': 2,
    'Animal Muffins': 2, 'Mountain Apple': 2, 'Tahitian': 2,
    'Limey Lifter': 2.5, 'Key Lime CBG': 1.5, 'Spruce Dough': 1,
    'Rocket Sauce': 1, 'Lemon': 2.5, 'GMO Belly': 1.5,
  },
  // 54 rows. wiki/farm/zones/r1.md, which also states the acres this reproduces.
  'R1': {
    'Orange Fritter': 4, 'Strawberry Fritter': 5, 'Strawberry Sauce': 6,
    'Purple Snow': 5, 'Sauciere': 5, 'Animal Muffins': 14,
    'Strawberry Doughnuts': 15,
  },
  // ~48 rows: 22 north Lifter, the balance south Sour Lifter.
  'Z14': { 'Lifter': 22, 'Sour Lifter': 26 },
  'Z15': { 'Lifter': 22, 'Sour Lifter': 26 },
};

/** Total rows in a zone, or null where the split is not recorded. */
export function zoneRowTotal(zone) {
  const m = ZONE_CULTIVAR_ROWS[zone];
  if (!m) return null;
  return Object.values(m).reduce((t, n) => t + n, 0);
}

/**
 * A cultivar's share of its zone, 0-1, or null when it cannot be known.
 *
 * Null rather than 1 for an unrecorded cultivar in a split zone: claiming the
 * whole zone is the bug this exists to fix, and a silent 1 would reinstate it
 * for anything planted later. A single-cultivar zone returns 1 because there
 * the whole zone really is the lot.
 */
export function cultivarShare(zone, cultivar) {
  const m = ZONE_CULTIVAR_ROWS[zone];
  if (!m) return isMultiCultivar(zone) ? null : 1;
  const rows = m[cultivar];
  const total = zoneRowTotal(zone);
  if (!rows || !total) return null;
  return rows / total;
}

export function cultivarsFor(zone) {
  return ZONE_CULTIVARS[zone] || [];
}

export function isMultiCultivar(zone) {
  return cultivarsFor(zone).length > 1;
}

/**
 * Does harvest track this zone at all?
 *
 * Driven by the data, not a hardcoded list: a zone with no cultivars here is
 * not part of harvest. That covers the greenhouses (GH1/GH2), which are grown
 * and irrigated but deliberately not counted at harvest (Koa 2026-08-25), and
 * it will cover anything else dropped from the plan without a code change.
 *
 * The shared VALID_ZONES cannot be used for this — irrigation legitimately
 * logs the greenhouses, so the zone is valid there and untracked here.
 */
export function isHarvestTracked(zone) {
  return cultivarsFor(zone).length > 0;
}
