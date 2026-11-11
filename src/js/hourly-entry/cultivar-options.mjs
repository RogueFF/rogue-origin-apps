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
 * The 2025 carryover is done; the list is empty (Koa, 2026-11-02).
 *
 * 2026 Sungrown comes first in every list: it is what the floor runs. The cells
 * run 2026 Sungrown tops only (Koa, 2026-11-10: "Cells: Sungrown only"), so the
 * cell screen and the raw hand-out pass { sungrownOnly: true } and never offer a
 * Greenhouse entry (two wrong picks that day: Purple Snowman and Strawberry
 * Doughnuts / Greenhouse). The hourly log keeps the full list.
 */

export const CURRENT_CROP = '2026';

export const CARRYOVER = [];

/** "2026 - X / Sungrown" (the current crop, sun-grown). */
export const isCurrentSungrown = (c) => String(c).startsWith(CURRENT_CROP) && /\/\s*Sungrown\s*$/i.test(String(c));

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
 * @param {{sungrownOnly?: boolean}} [opts] sungrownOnly: 2026 Sungrown only (the cells)
 * @returns {string[]} de-duplicated dropdown options, 2026 Sungrown first, each part sorted
 */
export function buildCultivarOptions(history = [], variants = [], { sungrownOnly = false } = {}) {
  const isCurrent = (c) => c.startsWith(CURRENT_CROP);
  const out = new Set(CARRYOVER);
  history.filter(isCurrent).forEach((c) => out.add(c));
  variants.map(variantCultivar).filter((c) => c && isCurrent(c)).forEach((c) => out.add(c));
  const list = [...out].filter((c) => !sungrownOnly || isCurrentSungrown(c));
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return list.sort((a, b) => (isCurrentSungrown(b) - isCurrentSungrown(a)) || cmp(a, b));
}
