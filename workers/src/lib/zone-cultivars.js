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
