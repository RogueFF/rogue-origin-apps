/**
 * Short code per cultivar, used in printed bag numbers: 26-SL-1, 26-L-1.
 *
 * Bag numbers restart at 1 for each cultivar (Koa 2026-08-24), so the number
 * alone is NOT unique — 26-SL-1 and 26-L-1 are different bags. The code is what
 * keeps them apart, which makes collisions a correctness bug, not a cosmetic
 * one: two cultivars sharing a code would share a sequence and their counts
 * would both be wrong.
 *
 * Plain initials collide on this list (Lemon/Lifter, Sauciere/Snickerdoodle,
 * Spruce Dough/Strawberry Doughnuts), so codes extend until unique. Sour Lifter
 * and Lifter are pinned to SL and L: they are the main crop and will carry most
 * of the tags.
 *
 * APPEND-ONLY. Changing an existing code invalidates every tag already printed
 * with it. Add new cultivars; never edit an existing line.
 */

export const CULTIVAR_CODES = {
  "Animal Muffins": "AM",
  "Blue Pineapple Quik": "BPQ",
  "Demi Glaze": "DG",
  "GMO Belly": "GB",
  "Key Lime CBG": "KLC",
  "Lemon": "LEM",
  "Lifter": "L",
  "Limey Lifter": "LL",
  "Mandarin Chocolate": "MC",
  "Mountain Apple": "MA",
  "Orange Fritter": "OF",
  "Orange Pineapple Quik": "OPQ",
  "Platinum": "P",
  "Platinum M A4": "PMA",
  "Puff Pastries": "PP",
  "Purple Snow": "PS",
  "Rainbow Cake": "RC",
  "Rainbow GMO Quik": "RGQ",
  "Rocket Sauce": "RS",
  "Sauciere": "S",
  "Snickerdoodle": "SNI",
  "Sour Lifter": "SL",
  "Spruce Dough": "SD",
  "Strawberry Cream": "SC",
  "Strawberry Doughnuts": "STD",
  "Strawberry Fritter": "SF",
  "Strawberry Sauce": "SS",
  "Tahitian": "T",
};

/**
 * Code for a cultivar. Unknown cultivars fall back to initials so a new one
 * still prints, but it is logged: an unmapped name risks colliding with a
 * mapped code and silently sharing its sequence.
 */
export function cultivarCode(cultivar) {
  const name = String(cultivar || '').trim();
  if (CULTIVAR_CODES[name]) return CULTIVAR_CODES[name];
  const derived = (name.match(/[A-Za-z0-9]+/g) || [])
    .map(w => w[0]).join('').toUpperCase() || 'XX';
  console.warn(`[harvest] cultivar "${name}" is not in CULTIVAR_CODES — using "${derived}". Add it to src/lib/cultivar-codes.js.`);
  return derived;
}
