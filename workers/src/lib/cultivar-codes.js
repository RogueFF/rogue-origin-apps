/**
 * Cultivar code used in printed bag numbers — 26-SLIFT-1.
 *
 * THE CODE IS cultivars.sku_prefix. Not a scheme of our own.
 *
 * That table already defines the universal cultivar code for this farm: it is
 * what builds Shopify SKUs (SLIFT-SG-SUPRSAK-2026, PFOG-SG-SUPRSAK-2025) and
 * what the wholesale board joins orders on. Using anything else here would put
 * a second, competing set of cultivar codes into circulation — which is exactly
 * what an earlier version of this file did, inventing SL for Sour Lifter when
 * the farm has said SLIFT for years.
 *
 * So there is no map in this file. It reads the database, because the database
 * is the source of truth and a copy here would drift from it.
 *
 * Trial cultivars that had never been sold were registered in `cultivars` with
 * active=0 (2026-08-24): they get a real prefix for harvest without appearing
 * in the wholesale order picker.
 */

/**
 * Look up a cultivar's SKU prefix.
 *
 * Refuses rather than guesses. A derived code would look plausible, print onto
 * physical tags, and silently disagree with the SKU the same cultivar uses
 * everywhere else — and bag numbers restart per cultivar, so a wrong code also
 * means a wrong sequence. Better to fail loudly while it is still on screen.
 */
export async function cultivarCode(db, cultivar) {
  const name = String(cultivar || '').trim();
  if (!name) throw new Error('cultivarCode: no cultivar given');

  const row = await db
    .prepare(`SELECT sku_prefix FROM cultivars WHERE name = ? COLLATE NOCASE`)
    .bind(name)
    .first();

  if (!row || !row.sku_prefix) {
    throw new Error(
      `Cultivar "${name}" has no sku_prefix in the cultivars table. ` +
      `Add it (active=0 if it is not sold yet) before tagging bags — the prefix ` +
      `is what makes the bag number unique and what links it to the Shopify SKU.`
    );
  }
  return String(row.sku_prefix).trim().toUpperCase();
}

/** Supersack SKU for a cultivar+season, e.g. SLIFT-SG-SUPRSAK-2026. */
export function supersackSku(prefix, season, harvestType = 'SG') {
  return `${prefix}-${harvestType}-SUPRSAK-${season}`;
}
