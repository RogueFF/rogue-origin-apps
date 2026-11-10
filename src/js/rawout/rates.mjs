/**
 * Raw to hand out per order: SOP-028 (wiki operations/sop-cell-raw-handout.md),
 * design doc §2d. Koa 2026-11-10: "look at the sour lifter or lifter numbers, and
 * add 10% more." Raw = bag target ÷ cell yield × 1.10.
 *
 * The one place the rates live. Change a rate here and the wall sheet with it.
 * Phase 2 (not built): a cultivar with ~3 weighed lots gets its own rate from
 * rawBoard's byCultivar.rawPerTops.
 */
const TEN_PCT = 1.1;
/** Sour Lifter: 6.6 lb tops per 35 lb sack (11/3 full weigh). Every cultivar without its own rate uses it. */
export const DEFAULT_RATE = { factor: (35 / 6.6) * TEN_PCT, basis: 'Sour Lifter' };
/** Own rates, by strain name exactly (Sour Lifter and Limey Lifter are NOT Lifter). */
export const RATES = {
  lifter: { factor: 4 * TEN_PCT, basis: 'Lifter' },     // 8.75 lb tops per sack (11/9 scans, not yet verified)
};

/** Bag targets: the cell screen's fill standards (src/js/cell/main.js PRESETS). */
export const BAGS = [
  { key: 'qOz', g: 7.5 }, { key: 'hOz', g: 15.0 }, { key: 'oz1', g: 30.0 },
  { key: 'qLb', g: 115.0 }, { key: 'hLb', g: 230.0 }, { key: 'lb1', g: 460.0 },
];

/** "2026 - Sour Lifter / Sungrown" -> "sour lifter". */
export function strainOf(cultivar) {
  return String(cultivar || '').replace(/^\s*\d{4}\s*-\s*/, '').replace(/\s*\/.*$/, '').trim().toLowerCase();
}
export function rateFor(cultivar) {
  return RATES[strainOf(cultivar)] || DEFAULT_RATE;
}
/** SOP-028 rounding: to 5 g, and to 0.05 kg from 1 kg up. */
export function roundRaw(g) {
  const step = g >= 1000 ? 50 : 5;
  return Math.round(g / step) * step;
}
/** Raw for one bag, rounded like the chart; several bags multiply it (4 × 1 oz SL = 700 g). */
export function rawPerBag(cultivar, bagKey) {
  const bag = BAGS.find(b => b.key === bagKey);
  return bag ? roundRaw(bag.g * rateFor(cultivar).factor) : null;
}
export function suggestRaw(cultivar, bagKey, bags = 1) {
  const one = rawPerBag(cultivar, bagKey);
  return one === null ? null : one * Math.max(1, Math.floor(bags) || 1);
}
