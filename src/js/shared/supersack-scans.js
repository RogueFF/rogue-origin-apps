/**
 * Decisions the end-of-day supersack form makes about SCANNED strains.
 *
 * From the 2026 crop every sack leaves inventory by a scan at the trim line,
 * and that scan already took it off the Shopify "Super Sack Inventory" count.
 * If the form also subtracted its own count, every sack would leave twice. So
 * for a scan-counted strain the form shows the scanned count, never types it,
 * and never touches the supersack count in Shopify. 2025 strains are exactly
 * as before. Pure functions so tests/supersack-day-form.test.mjs can pin them;
 * the page imports this same file (one copy, no build step).
 */

export const FIRST_SCANNED_SEASON = 2026;

/** Year off the front of a strain title — the same structural read the page uses for sack weight. */
export function seasonOfTitle(title) {
  const m = String(title || '').match(/^\s*(\d{4})\s*-/);
  return m ? Number(m[1]) : null;
}

/**
 * Fail safe: a title is scan-counted when its leading year is 2026+, or when
 * any standalone 20xx year in it is (an odd "2026-Lifter" / "Lifter 2026"
 * must never fall back to typed counts). The page keeps an identical inline
 * copy (yearScanCounted) so the guard holds even if this module never loads.
 */
export function isScanCounted(title) {
  const y = seasonOfTitle(title);
  if (y !== null && y >= FIRST_SCANNED_SEASON) return true;
  return (String(title || '').match(/\b20\d\d\b/g) || []).some(t => Number(t) >= FIRST_SCANNED_SEASON);
}

// Shopify ids arrive as numbers or gid://shopify/ProductVariant/123 strings.
const idTail = (id) => { const m = String(id ?? '').match(/(\d+)\s*$/); return m ? m[1] : null; };

/**
 * Land each scanned sack on the form row it belongs to.
 *
 * rows: [{ title, productId }] — the form's strain rows (Shopify variants).
 * byStrain: the scanned_day payload.
 * A sack whose tag carries a variant id goes to the row with that variant —
 * that is how two cuts of one cultivar stay on their own rows. A sack without
 * one goes to the cultivar's row only when that season has exactly one row on
 * the form; otherwise it is returned in `unmapped`, never dropped.
 */
export function scanCountsForRows(rows, byStrain) {
  const counts = {};
  const unmapped = [];
  for (const r of rows) if (isScanCounted(r.title)) counts[r.title] = 0;
  // Only scan-counted rows take a variant: a count on a 2025 row would be
  // ignored by the form, so such a sack is reported as unmapped instead.
  const byVariant = new Map(rows.filter(r => isScanCounted(r.title) && idTail(r.productId)).map(r => [idTail(r.productId), r.title]));
  for (const g of (byStrain || [])) {
    const own = rows.filter(r => (g.strain_titles || []).includes(r.title));
    const only = own.length === 1 ? own[0].title : null;
    const place = (n, why) => {
      if (!n) return;
      if (only) counts[only] = (counts[only] || 0) + n;
      else unmapped.push({ season: g.season, cultivar: g.cultivar, sacks: n, reason: why });
    };
    for (const v of (g.by_variant || [])) {
      const title = byVariant.get(idTail(v.shopify_variant_id));
      if (title) counts[title] = (counts[title] || 0) + v.sacks;
      else place(v.sacks, 'variant_not_on_form');
    }
    place((g.no_variant || []).length, own.length ? 'no_variant_several_rows' : 'no_form_row');
  }
  return { counts, unmapped };
}

/**
 * The Shopify supersack operation the form performs for one strain.
 * delta > 0 = sacks opened (subtract), < 0 = a correction that put some back
 * (add). Null when nothing should happen — always for a scan-counted strain.
 * For a 2025 strain this is exactly the operation and note the page sent
 * before scan-out.
 */
export function supersackOp(title, delta, name, date, mode = 'new') {
  if (isScanCounted(title) || !delta) return null;
  if (mode === 'new') {
    if (delta < 0) return null; // original: only when s.sacks > 0
    return { operation: 'subtract', amount: delta,
      note: `[Supersack Tracker] ${delta} supersacks opened — ${name} (${date})` };
  }
  return { operation: delta > 0 ? 'subtract' : 'add', amount: Math.abs(delta),
    note: `[Supersack Tracker] Correction: ${name} ${delta > 0 ? '+' : ''}${delta} sacks (${date})` };
}

// "2026 - Blue Pineapple / Sungrown / 2nd Cut" -> "2026 - blue pineapple / sungrown"
const baseTitle = (t) => String(t || '').replace(/\s*\/\s*\d+\s*(st|nd|rd|th)?\s*cut\s*$/i, '').trim().toLowerCase();

/**
 * Which form rows a day has, and which scoreboard strain's pounds go on each.
 *
 * scoreboardStrains: strain names in scoreboard order (no cut on them).
 * variants: [{ id, title }] — the Super Sack Inventory variants.
 * scans: the scanned_day by_strain payload (or [] when the scans were not read).
 * Returns { rows: [{ title, variantId, fromScans, strain, poundsOn }], missing }.
 *   strain   — the scoreboard strain whose pounds go on this row (null: none)
 *   poundsOn — for a scan-only row, the row that carries its cultivar's pounds
 *   missing  — scanned variant ids with no variant in the list (reported, not dropped)
 * 2025 strains: exactly the old rule (exact title, else the first title that
 * includes the strain name, else the strain name). 2026+: a cut-less strain
 * prefers the cut variant(s) scanned that day, and every scanned variant gets
 * a row even when the scoreboard never named it.
 */
export function rowsForDay({ scoreboardStrains = [], variants = [], scans = [] } = {}) {
  const scanned = new Map(); // idTail -> sacks
  for (const g of (scans || [])) for (const v of (g.by_variant || [])) {
    const k = idTail(v.shopify_variant_id);
    if (k && v.sacks > 0) scanned.set(k, (scanned.get(k) || 0) + v.sacks);
  }
  const rows = [];
  const byTitle = new Map();
  const add = (title, variantId, fromScans, strain, poundsOn = null) => {
    const have = byTitle.get(title);
    if (have) { if (strain) { have.strain = strain; have.fromScans = false; have.poundsOn = null; } return have; }
    const r = { title, variantId: variantId ?? null, fromScans, strain, poundsOn };
    byTitle.set(title, r); rows.push(r); return r;
  };
  for (const strain of scoreboardStrains) {
    const exact = variants.find(v => v.title === strain);
    if (exact) { add(exact.title, exact.id, false, strain); continue; }
    const s = String(strain).toLowerCase().trim();
    const cands = variants.filter(v => String(v.title).toLowerCase().includes(s));
    if (!cands.length) { add(strain, null, false, strain); continue; }
    const hot = isScanCounted(cands[0].title) ? cands.filter(v => scanned.has(idTail(v.id))) : [];
    const pick = hot[0] || cands[0];
    add(pick.title, pick.id, false, strain);
  }
  // Every other scanned 2026 variant gets its own row; a second cut of a
  // scoreboard row points its pounds at that row (they cannot be split).
  const missing = [];
  for (const k of scanned.keys()) {
    const v = variants.find(x => idTail(x.id) === k);
    if (!v) { missing.push(k); continue; }
    if (!isScanCounted(v.title) || byTitle.has(v.title)) continue;
    const twin = rows.find(r => r.strain && baseTitle(r.title) === baseTitle(v.title));
    add(v.title, v.id, true, null, twin ? twin.title : null);
  }
  return { rows, missing };
}

const sumCounts = (c) => Object.values(c || {}).reduce((a, n) => a + (n || 0), 0);

/**
 * Re-read on save: compare the scans the page loaded with a fresh read.
 * loaded: { date, ok, counts }; fresh: { date, ok, counts } or null when the
 * fetch failed. Scans from another date are never used.
 * Returns { ok, reason: 'same'|'more'|'fewer'|'fetch_failed'|'wrong_date', delta }.
 */
export function scanRefresh({ date, loaded, fresh }) {
  if (!fresh || !fresh.ok) return { ok: false, reason: 'fetch_failed', delta: 0 };
  if (fresh.date !== date) return { ok: false, reason: 'wrong_date', delta: 0 };
  const before = loaded && loaded.ok && loaded.date === date ? sumCounts(loaded.counts) : 0;
  const delta = sumCounts(fresh.counts) - before;
  return { ok: true, reason: delta > 0 ? 'more' : delta < 0 ? 'fewer' : 'same', delta };
}

/** "Remaining" for display: Shopify already reflects today's scans for a scan-counted strain. */
export function sacksRemaining(title, poolValue, sacks) {
  return isScanCounted(title) ? poolValue : poolValue - sacks;
}

/** Strains with weights entered but no scanned sack — that output will reach no sack. */
export function weightsWithoutScans(entries, counts) {
  return entries.filter(e => isScanCounted(e.title)
    && (e.tops || e.smalls || e.biomass || e.trim) && !(counts[e.title] > 0)).map(e => e.title);
}
