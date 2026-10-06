/**
 * Which cultivars the hourly-entry dropdown offers.
 *
 * The current crop (2026) comes from the Super Sack inventory product in
 * Shopify, one entry per cultivar and harvest type, spelled the way the floor
 * spells it: the variant "2026 - Sour Lifter / Sungrown / 1st Cut" is offered
 * as "2026 - Sour Lifter / Sungrown". Supersack attribution and the wholesale
 * burn-down both read that spelling. Every 2026 cultivar is listed, bags or not.
 *
 * Older crops are listed only while their bags are still on the floor. Shopify
 * cannot tell us which ones those are: the last 2025 Lifter and Sugar Shaker
 * sit in the "2025 - Mix" variant, and the floor logged 2025 Lifter on
 * 2026-10-06 while Shopify showed none. So the carryover list is written down
 * here, and a strain comes off it when its bags are gone (Koa, 2026-10-06).
 */

export const CURRENT_CROP = '2026';

export const CARRYOVER = [
  '2025 - Lifter / Sungrown',
  '2025 - Passion Fruit OG / Sungrown',
  '2025 - Sugar Cookez (Cookies) / Sungrown',
  '2025 - Sugar Shaker / Sungrown',
];

/** "2026 - X / Sungrown / 1st Cut" variant -> "2026 - X / Sungrown". */
export function variantCultivar(variant) {
  const opt = (name) => (variant.options || []).find((o) => o.name === name)?.value;
  const cultivar = opt('Cultivar');
  const type = opt('Harvest Type');
  if (cultivar && type) return `${cultivar} / ${type}`;
  // No options on the variant: fall back to the title without its cut.
  return String(variant.title || '').replace(/\s*\/\s*\d+(st|nd|rd|th) Cut\s*$/i, '').trim();
}

/**
 * @param {string[]} history  spellings already logged (production getCultivars)
 * @param {Array<{title:string, options?:Array<{name:string,value:string}>}>} variants
 *        Super Sack variants from the pool API; [] when it could not be reached
 * @returns {string[]} sorted, de-duplicated dropdown options
 */
export function buildCultivarOptions(history = [], variants = []) {
  const isCurrent = (c) => c.startsWith(CURRENT_CROP);
  const out = new Set(CARRYOVER);
  history.filter(isCurrent).forEach((c) => out.add(c));
  variants.map(variantCultivar).filter((c) => c && isCurrent(c)).forEach((c) => out.add(c));
  return [...out].sort();
}
