/**
 * The Super Sack Inventory count in Shopify, reached through the Pool
 * Inventory Service.
 *
 * All supersacks are ONE Shopify product ("Super Sack Inventory") whose
 * variants are cultivar-year-cuts: "2026 - Sour Lifter / Sungrown / 1st Cut".
 * Each variant's quantity is a count of sacks on hand. The variant carries a
 * SKU (SLIFT-SG-C1-SUPRSAK-2026) but the pool service does not return it, so
 * matching is by TITLE — the same way the supersack tracker page already does.
 *
 * THE CUT SPLIT (Koa, 2026-09-16). Until then a variant was a cultivar-year,
 * "2026 - Sour Lifter / Sungrown". Every 2026 variant was split into 1st Cut
 * and 2nd Cut — the old variants renamed in place to "/ 1st Cut", new ones
 * created for "/ 2nd Cut". First cut is the whole plant and second cut is side
 * branches, so they are different material and different stock. 2025 and older
 * variants keep the two-part title; the harvest system has no sacks from them.
 *
 * This reuses `update_supersack_inventory` through the existing pool proxy
 * rather than calling Shopify directly. A second write path to the same count
 * would drift from the first, and the proxy already holds the API key.
 */

/**
 * The cut as Super Sack Inventory spells it. Only two exist: a third cut has no
 * variant, and naming one here would only move the miss somewhere quieter.
 */
export function cutLabel(cut) {
  const n = Number(cut);
  return n === 1 ? '1st Cut' : n === 2 ? '2nd Cut' : null;
}

/**
 * Variant title for a cultivar-year, e.g. "2026 - Sour Lifter / Sungrown", and
 * with a cut "2026 - Sour Lifter / Sungrown / 1st Cut".
 */
export function variantTitle(season, cultivar, harvestType = 'Sungrown', cut = null) {
  const base = `${season} - ${String(cultivar).trim()} / ${harvestType}`;
  const label = cutLabel(cut);
  return label ? `${base} / ${label}` : base;
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
 * Variant titles this cultivar is EXPLICITLY known by, for one season, one
 * harvest type and one cut.
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
 * An alias names the CULTIVAR, so it may be recorded without a cut ("2026 -
 * Rainbow GMO / Sungrown") and the sack's cut is added to it; one row then
 * serves both cuts, and the rows recorded before the split keep working. An
 * alias recorded WITH a cut is used only for that cut.
 *
 * The season, harvest-type and cut filters are the second guard: a 2025 alias
 * can never satisfy a 2026 request, a Greenhouse title never satisfies a
 * Sungrown one, and a 2nd Cut title never satisfies a 1st Cut bag, whatever
 * anyone puts in the table.
 */
async function aliasedTitles(db, season, cultivar, harvestType, label) {
  if (!db) return [];
  const head = `${season} - `.toLowerCase();
  const base = ` / ${harvestType}`.toLowerCase();
  const full = `${base} / ${label}`.toLowerCase();
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
    .filter(t => t.toLowerCase().startsWith(head))
    .map(t => {
      const k = t.toLowerCase();
      if (k.endsWith(full)) return t;
      if (k.endsWith(base)) return `${t} / ${label}`;
      return null;
    })
    .filter(Boolean);
}

/**
 * The variant a sack of this cultivar, zone and cut counts on, from a variant
 * list already fetched. Returns { variant, title, matchedBy, error }: exactly
 * one of `variant` and `error` is set.
 */
export async function matchSupersackVariant(variants, db, { season, cultivar, zone, cut }) {
  const harvestType = harvestTypeForZone(zone);
  const label = cutLabel(cut);
  if (!label) {
    return { variant: null, title: null, matchedBy: null,
      error: `No Super Sack Inventory variant exists for cut ${cut ?? '?'} — there are 1st Cut and 2nd Cut variants only.` };
  }
  const title = variantTitle(season, cultivar, harvestType, cut);

  const exact = findVariant(variants, title);
  if (exact) return { variant: exact, title, matchedBy: 'name', error: null };

  const hits = new Map();
  for (const t of await aliasedTitles(db, season, cultivar, harvestType, label)) {
    const hit = findVariant(variants, t);
    if (hit) hits.set(hit.id, hit);
  }
  if (hits.size === 1) return { variant: [...hits.values()][0], title, matchedBy: 'alias', error: null };
  if (hits.size > 1) {
    // Two recorded names both landing on real variants is a data problem,
    // not a tie to break. Picking one would put bags on the wrong count.
    return { variant: null, title, matchedBy: null,
      error: `"${cultivar}" has ${hits.size} aliased ${season} ${harvestType} ${label} variants — refusing to guess which.` };
  }
  return { variant: null, title, matchedBy: null,
    error: `No Super Sack Inventory variant titled "${title}", and no alias recorded for one. Rename the variant in Shopify, or add a cultivar_aliases row for the title it does have.` };
}

/**
 * Would a tag printed for this lot move a count? Asked at Start takedown,
 * before a serial is spent — the miss is otherwise silent: the tag prints, the
 * sack saves, and only a column on the sack row knows the count never moved.
 *
 * Returns { ok: true, title } | { ok: false, error } | { ok: null, error } when
 * the check itself could not run. Never throws.
 */
export async function checkSupersackVariant(env, db, lot) {
  try {
    const variants = await listSupersackVariants(env);
    const m = await matchSupersackVariant(variants, db, lot);
    return m.variant ? { ok: true, title: m.variant.title, error: null } : { ok: false, title: m.title, error: m.error };
  } catch (e) {
    return { ok: null, title: null, error: String(e.message || e).slice(0, 300) };
  }
}

/**
 * Move a sack count. `delta` is signed: -1 when a bag is opened, +1 to put one
 * back.
 *
 * `variantId` is where an earlier move for this sack LANDED. A void or an
 * opening undoes or debits exactly that variant, whatever it is called now —
 * re-matching by title is how a rename sends a correction to a different count.
 * If that variant is gone, the move is refused rather than re-matched.
 *
 * Returns { ok, variantId, matchedBy, error }. Never throws — the caller has
 * already recorded a measurement it must not lose over a bookkeeping call.
 */
export async function adjustSupersackCount(env, { season, cultivar, zone, cut, delta, note, db = null, variantId = null }) {
  try {
    const variants = await listSupersackVariants(env);
    let v, matchedBy;

    if (variantId) {
      v = variants.find(x => String(x.id) === String(variantId)) || null;
      matchedBy = 'id';
      if (!v) {
        return { ok: false, variantId: null, matchedBy: null,
          error: `The Super Sack Inventory variant this sack was counted on (${variantId}) no longer exists — refusing to move a different one.` };
      }
    } else {
      const m = await matchSupersackVariant(variants, db, { season, cultivar, zone, cut });
      if (!m.variant) return { ok: false, variantId: null, matchedBy: null, error: m.error };
      v = m.variant;
      matchedBy = m.matchedBy;
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
