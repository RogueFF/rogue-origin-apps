/**
 * Shopify SKU parsing.
 *
 * A wholesale line's SKU already carries everything the order board needs —
 * cultivar, form, and pack size — so an imported order is built by reading
 * SKUs, not by reading product titles off a screenshot. cultivars.sku_prefix
 * then makes the cultivar lookup an exact join.
 *
 * Two shapes exist across all 362 rows of the catalogue export:
 *   PREFIX-FLWR-SUN-TOP-1/4-LB-2025   domestic, 7 segments, explicit form
 *   PREFIX-INTL-HT-5-KG-2025          international, 6 segments, HT = tops
 *
 * Everything here refuses rather than guesses. A SKU that does not parse means
 * pounds attached to the wrong cultivar, which would silently reprice every
 * date behind it in the production queue — a loud failure is much cheaper.
 */

import { LB_PER_KG } from './wholesale.js';

const OZ_PER_LB = 16;

const FORMS = {
  TOP: 'tops',
  SM: 'smalls',
  HT: 'tops',      // the international line's "hemp tops"
};

/** Pack weight in pounds. Size may be a fraction, as in `1/4`. */
export function packLbs(size, unit) {
  const m = String(size).match(/^(\d+)(?:\/(\d+))?$/);
  if (!m) throw new Error(`Invalid pack size: "${size}"`);
  const value = m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid pack size: "${size}"`);

  const u = String(unit).toUpperCase();
  if (u === 'LB') return value;
  if (u === 'OZ') return value / OZ_PER_LB;
  if (u === 'KG') return value * LB_PER_KG;
  throw new Error(`Unknown pack unit: "${unit}"`);
}

/**
 * @returns { prefix, form, size, unit, packLbs, year }
 * @throws on anything it cannot read with certainty
 */
export function parseSku(sku) {
  if (!sku || typeof sku !== 'string') throw new Error(`Invalid sku: ${sku}`);

  const parts = sku.trim().toUpperCase().split('-');

  // 7: PREFIX FLWR SUN FORM SIZE UNIT YEAR
  // 6: PREFIX INTL HT SIZE UNIT YEAR
  let prefix, formCode, size, unit, year;
  if (parts.length === 7) {
    [prefix, , , formCode, size, unit, year] = parts;
  } else if (parts.length === 6) {
    [prefix, , formCode, size, unit, year] = parts;
  } else {
    throw new Error(`Unrecognised sku shape: "${sku}"`);
  }

  const form = FORMS[formCode];
  if (!form) throw new Error(`Unknown form segment "${formCode}" in sku "${sku}"`);

  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) {
    throw new Error(`Unrecognised sku year "${year}" in "${sku}"`);
  }

  return { prefix, form, size, unit, packLbs: packLbs(size, unit), year: y };
}
