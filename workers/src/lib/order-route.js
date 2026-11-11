/**
 * Where a Shopify order line goes on the floor (design doc §2c "Reading a
 * Shopify order line" and §2e; Koa 2026-11-10). Pure: no I/O, no buyer data.
 *
 * Routes:
 *   cell       2026 Sungrown Tops, 1/4 oz to 1 lb: trimmed at a cell
 *   bagging    already in inventory, just bagged: Smalls, trim/biomass, all
 *              Greenhouse, older crop and Mids, and Tops bigger than one cell fill
 *              (10 lb, kg, pallet: pulled from the wholesale 5 kg rounds)
 *   pack       finished goods (prerolls, merch): straight to packing
 *   wholesale  the order carries Nathan's `wholesale-line` tag: it stays on the
 *              existing wholesale queue, never a cell job from here (Koa: retail first)
 *   ask        a custom line with no product (a typed draft-order line): bag/tag picks
 *
 * Read off the catalog (Sidekick read 2026-11-10, 36 products / 442 variants):
 *   - cultivar: the `Cultivar` option if any, else the product title without
 *     " Hemp Flower" and any [2025] / [Mid-Grade] / [Mids] prefix. SKUs are not parsed.
 *   - size: the `Bag Size` option. Flower type: the `Flower Type` option.
 *   - 2026 retail products carry the `retail-only` tag (`coming-soon` while new).
 *   - a `prebagged` product tag sends any line to bagging (the override the plan keeps).
 * Unsure means bagging or ask, never a cell: a wrong "cell" sends a trimmer the
 * wrong work, a wrong "bagging" only shows up on the bag/tag screen.
 */

export const CURRENT_CROP = '2026';

/** Bag Size option value -> the floor's bag key (cell screen PRESETS keys, plus the big ones). */
const BAG_KEYS = [
  [/^1\/4oz$/, 'qOz'], [/^1\/2oz$/, 'hOz'], [/^1oz$/, 'oz1'],
  [/^1\/4lbs?$/, 'qLb'], [/^1\/2lbs?$/, 'hLb'], [/^1lbs?$/, 'lb1'],
  [/^10lbs?$/, 'lb10'], [/^1kgs?$/, 'kg1'], [/^5kgs?$/, 'kg5'], [/pallet/, 'pallet'],
];
export const CELL_BAGS = ['qOz', 'hOz', 'oz1', 'qLb', 'hLb', 'lb1'];

export function bagKey(value) {
  const v = String(value || '').toLowerCase().replace(/[\s.]/g, '');
  if (!v) return null;
  for (const [re, key] of BAG_KEYS) if (re.test(v)) return key;
  return null;
}

/** "Payton's" is the Shopify spelling, "Peyton's" the COA audit's (2026-11-05). */
export function fixSpelling(name) {
  return String(name || '').replace(/\bPayton'?s\b/gi, "Peyton's");
}

/** One key for matching cultivar names across Shopify, the floor and the COA library. */
export function cultivarKey(name) {
  return fixSpelling(name).toLowerCase()
    .replace(/^\s*\d{4}\s*-\s*/, '').replace(/\s*\/.*$/, '')
    .replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

const PREFIX = /^\s*\[([^\]]+)\]\s*/;
/** Product title -> cultivar: "[2025] Lifter Hemp Flower" -> "Lifter". */
export function titleCultivar(title) {
  let t = String(title || '');
  while (PREFIX.test(t)) t = t.replace(PREFIX, '');
  return t.replace(/\s*hemp\s+flower\s*/i, ' ').replace(/\s+/g, ' ').trim();
}

function bracketTags(title) {
  const out = [];
  let t = String(title || '');
  let m;
  while ((m = PREFIX.exec(t))) { out.push(m[1].trim()); t = t.slice(m[0].length); }
  return out;
}

const PACK = /pre-?rolls?|kief|merch|shirt|hoodie|\bhat\b|beanie|grinder|sticker|gift\s*card|lighter|rolling\s*paper/i;
const TRIM = /\btrim\b|biomass/i;
const GREENHOUSE = /greenhouse|\bgh\d?\b/i;
const OLD = /mid-?grade|\bmids\b|mystery/i;

/**
 * @param {object} line
 * @param {string} line.title            line item title (the product title)
 * @param {string} [line.variantTitle]
 * @param {boolean} line.hasProduct      false for a custom line
 * @param {string} [line.productTitle]
 * @param {string} [line.productType]
 * @param {string[]} [line.productTags]
 * @param {Object<string,string>} [line.options]  selectedOptions by name
 * @param {object} order
 * @param {string[]} [order.tags]
 * @returns {{cultivar:string|null, floorCultivar:string|null, form:string|null, bag:string|null, route:string, why:string}}
 */
export function routeLine(line, order = {}) {
  const opts = line.options || {};
  const tags = (line.productTags || []).map(t => String(t).toLowerCase());
  const orderTags = (order.tags || []).map(t => String(t).toLowerCase());
  const productTitle = line.productTitle || line.title || '';
  const flowerType = String(opts['Flower Type'] || '').trim();
  const bag = bagKey(opts['Bag Size']) ||
    bagKey(String(line.variantTitle || '').split('/').map(s => s.trim()).find(s => bagKey(s)) || '');
  const cultivarRaw = opts.Cultivar || (flowerType || opts['Bag Size'] ? titleCultivar(productTitle) : null);
  const cultivar = cultivarRaw ? fixSpelling(cultivarRaw) : null;
  const text = [productTitle, line.variantTitle, line.productType, ...Object.values(opts), ...tags].join(' ');
  let form = /^tops$/i.test(flowerType) ? 'tops' : /^smalls$/i.test(flowerType) ? 'smalls'
    : TRIM.test(flowerType) || TRIM.test(productTitle) ? 'trim' : null;
  const out = (route, why) => ({
    cultivar, form, bag, route, why,
    floorCultivar: route === 'cell' && cultivarRaw ? `${CURRENT_CROP} - ${cultivarRaw} / Sungrown` : null,
  });

  if (orderTags.includes('wholesale-line')) return out('wholesale', 'Wholesale order: stays on the wholesale queue');
  if (!line.hasProduct) {
    form = /\btops\b/i.test(line.title) ? 'tops' : /\bsmalls\b/i.test(line.title) ? 'smalls' : form;
    return out('ask', 'Custom line: pick where it goes');
  }
  if (tags.includes('prebagged')) return out('bagging', 'Tagged prebagged');
  if (PACK.test(`${productTitle} ${line.productType || ''}`) && !flowerType) return out('pack', 'Finished goods: straight to packing');
  if (form === 'smalls') return out('bagging', 'Smalls: bagged from the pool');
  if (form === 'trim') return out('bagging', 'Trim: bagged from the pool');
  if (form !== 'tops') {
    if (!flowerType && !opts['Bag Size']) return out('pack', 'Not flower: straight to packing');
    return out('ask', 'No flower type on this line: pick where it goes');
  }
  // Tops from here on.
  const brackets = bracketTags(productTitle);
  const oldYear = brackets.find(b => /^\d{4}$/.test(b) && b < CURRENT_CROP);
  if (oldYear) return out('bagging', `${oldYear} crop: already trimmed`);
  if (OLD.test(productTitle) || brackets.some(b => OLD.test(b))) return out('bagging', 'Mids / mystery: already trimmed');
  if (GREENHOUSE.test(text)) return out('bagging', 'Greenhouse: already in inventory');
  if (bag && !CELL_BAGS.includes(bag)) return out('bagging', 'Bigger than one cell fill: from the 5 kg rounds');
  if (!bag) return out('ask', 'No bag size on this line: pick where it goes');
  if (!tags.includes('retail-only') && !tags.includes('coming-soon')) {
    return out('bagging', 'No 2026 retail tag: older stock, already trimmed');
  }
  return out('cell', '2026 Sungrown Tops: trimmed at a cell');
}

/** Expedited shipping jumps the FIFO line (§2c: Next Day Air, 2nd Day Air). */
export function rushOf(shippingTitle) {
  const t = String(shippingTitle || '');
  return /next\s*day|2nd\s*day|second\s*day|overnight|express/i.test(t) ? t.slice(0, 80) : null;
}

/** Nathan's Flow intake tags on the order. */
export function intakeTag(tags = []) {
  const t = tags.map(x => String(x).toLowerCase());
  if (t.includes('wholesale-line')) return 'wholesale';
  if (t.includes('m2o-line')) return 'm2o';
  return null;
}
