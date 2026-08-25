/**
 * The Super Sack Inventory count in Shopify, reached through the Pool
 * Inventory Service.
 *
 * All supersacks are ONE Shopify product ("Super Sack Inventory") whose
 * variants are cultivar-years: "2026 - Sour Lifter / Sungrown". Each variant's
 * quantity is a count of sacks on hand. The variant carries a SKU
 * (SLIFT-SG-SUPRSAK-2026) but the pool service does not return it, so matching
 * is by TITLE — the same way the supersack tracker page already does it.
 *
 * This reuses `update_supersack_inventory` through the existing pool proxy
 * rather than calling Shopify directly. A second write path to the same count
 * would drift from the first, and the proxy already holds the API key.
 */

/** Variant title for a cultivar-year, e.g. "2026 - Sour Lifter / Sungrown". */
export function variantTitle(season, cultivar, harvestType = 'Sungrown') {
  return `${season} - ${String(cultivar).trim()} / ${harvestType}`;
}

/**
 * Greenhouse zones grow under glass; everything else is sungrown. The variant
 * titles carry this distinction, so a bag from GH1 must not be matched against
 * a Sungrown variant of the same cultivar.
 */
export function harvestTypeForZone(zone) {
  return /^GH/i.test(String(zone || '')) ? 'Greenhouse' : 'Sungrown';
}

async function poolCall(env, action, body) {
  if (!env.POOL_INVENTORY_API_URL || !env.POOL_INVENTORY_API_KEY) {
    throw new Error('Pool Inventory API not configured');
  }
  const res = await fetch(env.POOL_INVENTORY_API_URL, {
    method: 'POST',
    // text/plain on purpose: Google Apps Script 302s on application/json.
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action, apiKey: env.POOL_INVENTORY_API_KEY, ...body }),
    redirect: 'follow',
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`Pool API returned non-JSON: ${text.slice(0, 160)}`); }
  if (data.error) throw new Error(data.error);
  return data;
}

export async function listSupersackVariants(env) {
  const data = await poolCall(env, 'get_supersack_variants', {});
  return Array.isArray(data.variants) ? data.variants : [];
}

/** Exact title match, case/whitespace tolerant. */
export function findVariant(variants, title) {
  const want = title.trim().toLowerCase().replace(/\s+/g, ' ');
  return variants.find(v =>
    String(v.title || '').trim().toLowerCase().replace(/\s+/g, ' ') === want) || null;
}

/**
 * Move a cultivar-year's sack count. `delta` is signed: -1 when a bag is
 * opened, +1 to put one back.
 *
 * Returns { ok, variantId, error }. Never throws — the caller has already
 * recorded a measurement it must not lose over a bookkeeping call.
 */
export async function adjustSupersackCount(env, { season, cultivar, zone, delta, note }) {
  const title = variantTitle(season, cultivar, harvestTypeForZone(zone));
  try {
    const variants = await listSupersackVariants(env);
    const v = findVariant(variants, title);
    if (!v) {
      return { ok: false, variantId: null,
        error: `No Super Sack Inventory variant titled "${title}". Create it in Shopify before its bags are opened.` };
    }
    await poolCall(env, 'update_supersack_inventory', {
      variantId: v.id,
      inventoryItemId: v.inventoryItemId,
      locationId: v.locationId,
      operation: delta < 0 ? 'subtract' : 'add',
      amount: Math.abs(delta),
      note,
    });
    return { ok: true, variantId: v.id, error: null };
  } catch (e) {
    return { ok: false, variantId: null, error: String(e.message || e).slice(0, 300) };
  }
}
