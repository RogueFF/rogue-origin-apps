/**
 * Order coverage — how much of what has been promised is actually packed.
 *
 * Compares committed pounds against finished, sellable inventory, and reports
 * raw supersacks alongside as a count.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO
 *
 * It does not project raw sacks into finished pounds. That projection already
 * exists in supersack-d1 (`tops_breakdown`), where it is auth-gated, cached and
 * marked competitively sensitive. Reimplementing it here would create a second
 * answer to the same question, and the two would drift.
 *
 * It does not treat a shortfall as an error. Through most of a season the bulk
 * of inventory is raw material waiting to be trimmed, so "committed more than
 * is packed" is the ordinary state of affairs. The point is to tell an operator
 * the difference between *nothing packed yet* and *nothing to pack* — which is
 * why the raw sack count travels with the shortfall.
 *
 * Design: docs/plans/2026-08-19-order-blocks-design.md §6
 */

import { parseSku } from './sku.js';

/** Raw, unprocessed supersacks — material, not product. */
const RAW_MARKER = 'SUPRSAK';

const key = (cultivarId, form) => `${cultivarId}|${form}`;

/**
 * Fold live inventory rows into finished pounds per (cultivar, form) and raw
 * sacks per cultivar.
 *
 * Finished goods resolve by SKU prefix: the catalogue SKU is the contract, and
 * `parseSku` reads form and pack size out of it. Supersacks resolve by their
 * variant TITLE first. The sack variants in Shopify were coded by hand and do
 * not always reuse the catalogue prefix (Sugar Cookez is SUGCOOK on a bag of
 * tops but SCOOK on the sack), so by prefix alone two of the biggest raw
 * inventories read as zero. Their titles, though, are the production-sheet
 * spelling ("2025 - Sugar Cookez (Cookies) / Sungrown") that cultivar_aliases
 * already maps — the same seam the rate lookups and the queue's sack history
 * join on. The prefix stays as the fallback for a sack with no usable title.
 *
 * @param rows      [{ sku, units, title? }] — latest count per sku
 * @param prefixMap { SKU_PREFIX: cultivarId }
 * @param aliasMap  { UPPERCASED ALIAS: cultivarId } — from cultivar_aliases
 */
export function summarizeInventory(rows, prefixMap, aliasMap = {}) {
  const finished = {};
  const rawSacks = {};
  const skipped = [];

  for (const row of rows) {
    const sku = String(row.sku || '').trim().toUpperCase();
    const units = Number(row.units);
    if (!sku || !Number.isFinite(units) || units <= 0) continue;

    const prefix = sku.split('-')[0];
    const byPrefix = prefixMap[prefix];

    // A supersack is unprocessed. Counting one as packed inventory would say an
    // order can ship when nothing has been trimmed for it.
    if (sku.includes(RAW_MARKER)) {
      const title = String(row.title || '').trim().toUpperCase();
      const cultivarId = (title && aliasMap[title]) || byPrefix;
      if (!cultivarId) { skipped.push(sku); continue; }
      rawSacks[cultivarId] = (rawSacks[cultivarId] || 0) + units;
      continue;
    }

    const cultivarId = byPrefix;
    if (!cultivarId) { skipped.push(sku); continue; }

    let parsed;
    try {
      parsed = parseSku(sku);
    } catch {
      skipped.push(sku);
      continue;
    }

    const k = key(cultivarId, parsed.form);
    finished[k] = (finished[k] || 0) + units * parsed.packLbs;
  }

  return { finished, rawSacks, skipped };
}

/**
 * @param demand [{ cultivarId, form, committedLbs }]
 * @param inv    the result of summarizeInventory
 */
export function assessCoverage(demand, inv) {
  return demand.map(d => {
    const finishedLbs = inv.finished[key(d.cultivarId, d.form)] || 0;
    const shortfallLbs = Math.max(0, d.committedLbs - finishedLbs);
    return {
      cultivarId: d.cultivarId,
      form: d.form,
      committedLbs: d.committedLbs,
      finishedLbs,
      rawSacks: inv.rawSacks[d.cultivarId] || 0,
      shortfallLbs,
      short: shortfallLbs > 0,
    };
  });
}
