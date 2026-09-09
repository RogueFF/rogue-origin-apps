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
 * Variant titles this cultivar is EXPLICITLY known by, for one season and one
 * harvest type.
 *
 * The website does not always carry the farm's name for a cultivar — "Rainbow
 * GMO Quik" is listed as "Rainbow GMO" (Koa, 2026-09-09) — so an exact title
 * built from the cultivar name can miss a variant that genuinely is the right
 * one.
 *
 * WHY THIS READS A TABLE INSTEAD OF PARSING THE NAME. The obvious fix is to
 * drop trailing words until something matches. That is unsafe here and the
 * field proves it: **Platinum is a strict prefix of Platinum M A4, and both
 * grow in Z8** — one of the three trial blocks whose entire purpose is telling
 * cultivars apart. A loosening rule would post Platinum M A4's bags onto
 * Platinum's count, silently, in the one place it matters most.
 *
 * So the mapping is recorded, never inferred. `cultivar_aliases` already exists
 * for this and the allocation path already reads it, so one row fixes both the
 * count and the weights.
 *
 * The season and harvest-type filters are the second guard: a 2025 alias can
 * never satisfy a 2026 request, and a Greenhouse title can never satisfy a
 * Sungrown one, whatever anyone puts in the table.
 */
async function aliasedTitles(db, season, cultivar, harvestType) {
  if (!db) return [];
  const head = `${season} - `.toLowerCase();
  const tail = ` / ${harvestType}`.toLowerCase();
  let rows;
  try {
    rows = await db.prepare(`
      SELECT a.alias FROM cultivar_aliases a
      JOIN cultivars c ON c.id = a.cultivar_id
      WHERE c.name = ? COLLATE NOCASE
    `).bind(cultivar).all();
  } catch { return []; }
  return (rows?.results || [])
    .map(r => String(r.alias || '').trim())
    .filter(t => {
      const k = t.toLowerCase();
      return k.startsWith(head) && k.endsWith(tail);
    });
}

/**
 * Move a cultivar-year's sack count. `delta` is signed: -1 when a bag is
 * opened, +1 to put one back.
 *
 * Returns { ok, variantId, matchedBy, error }. Never throws — the caller has
 * already recorded a measurement it must not lose over a bookkeeping call.
 */
export async function adjustSupersackCount(env, { season, cultivar, zone, delta, note, db = null }) {
  const harvestType = harvestTypeForZone(zone);
  const title = variantTitle(season, cultivar, harvestType);
  try {
    const variants = await listSupersackVariants(env);
    let v = findVariant(variants, title);
    let matchedBy = 'name';

    if (!v) {
      const titles = await aliasedTitles(db, season, cultivar, harvestType);
      const hits = new Map();
      for (const t of titles) {
        const hit = findVariant(variants, t);
        if (hit) hits.set(hit.id, hit);
      }
      if (hits.size === 1) {
        v = [...hits.values()][0];
        matchedBy = 'alias';
      } else if (hits.size > 1) {
        // Two recorded names both landing on real variants is a data problem,
        // not a tie to break. Picking one would put bags on the wrong count.
        return { ok: false, variantId: null, matchedBy: null,
          error: `"${cultivar}" has ${hits.size} aliased ${season} ${harvestType} variants — refusing to guess which.` };
      }
    }

    if (!v) {
      return { ok: false, variantId: null, matchedBy: null,
        error: `No Super Sack Inventory variant titled "${title}", and no alias recorded for one. Rename the variant in Shopify, or add a cultivar_aliases row for the title it does have.` };
    }
    await poolCall(env, 'update_supersack_inventory', {
      variantId: v.id,
      inventoryItemId: v.inventoryItemId,
      locationId: v.locationId,
      operation: delta < 0 ? 'subtract' : 'add',
      amount: Math.abs(delta),
      note,
    });
    return { ok: true, variantId: v.id, matchedBy, error: null };
  } catch (e) {
    return { ok: false, variantId: null, matchedBy: null, error: String(e.message || e).slice(0, 300) };
  }
}
