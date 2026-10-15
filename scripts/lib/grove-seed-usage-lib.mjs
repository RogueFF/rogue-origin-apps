// Pure helpers for scripts/grove-seed-usage.mjs (unit-tested in tests/grove-seed-usage.test.mjs).
import { cardFor } from './grove-card-for.mjs';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** '2025-11' | '2025-11-01' (or a full ISO stamp) | 'Nov 2025' / 'November 2025' → 'YYYY-MM', else null. */
export function parseMonth(value) {
  const s = String(value ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?(?:[T ].*)?$/);
  if (m) {
    const mo = Number(m[2]);
    return mo >= 1 && mo <= 12 ? `${m[1]}-${String(mo).padStart(2, '0')}` : null;
  }
  m = s.match(/^([a-z]{3,})\.?,?\s+(\d{4})$/i);
  if (m) {
    const word = m[1].toLowerCase();
    const i = MONTHS.indexOf(word.slice(0, 3));
    return i >= 0 ? `${m[2]}-${String(i + 1).padStart(2, '0')}` : null;
  }
  return null;
}

/** Index of the first candidate present in the header (case/space-insensitive), or -1. */
export function pickColumn(header, candidates) {
  const cols = header.map(c => String(c).trim().toLowerCase());
  for (const c of candidates) {
    const i = cols.indexOf(c.trim().toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

/** Mid-month noon UTC for 'YYYY-MM'. */
export const seedAt = month => new Date(`${month}-15T12:00:00Z`).toISOString();

/**
 * records: [{ month, variantId, title, sku, qty }] (raw strings from the CSV).
 * → { rows: [{ card, qty, month, variantId, at, sql }], unmapped: [{ variantId, title }],
 *     bad: [{ variantId, title, reason }] }
 * One row per (month, variant, card), qty summed. Rows with qty ≤ 0 are skipped before anything else.
 */
export function seedRows(records) {
  const agg = new Map(), unmapped = [], bad = [];
  const seenUnmapped = new Set();
  for (const r of records) {
    const variantId = String(r.variantId ?? '').trim();
    const title = String(r.title ?? '').trim();
    const qty = Number(String(r.qty ?? '').replace(/,/g, '').trim());
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (!/^\d+$/.test(variantId)) { bad.push({ variantId, title, reason: 'id' }); continue; }
    const month = parseMonth(r.month);
    if (!month) { bad.push({ variantId, title, reason: `month ${String(r.month ?? '').trim()}` }); continue; }
    const card = cardFor(`${title} ${r.sku ?? ''}`);
    if (!card) {
      if (!seenUnmapped.has(variantId)) { seenUnmapped.add(variantId); unmapped.push({ variantId, title }); }
      continue;
    }
    const key = `${month}|${variantId}|${card}`;
    const row = agg.get(key) || { card, qty: 0, month, variantId };
    row.qty += qty;
    agg.set(key, row);
  }
  const rows = [...agg.values()]
    .sort((a, b) => a.month.localeCompare(b.month) || a.card - b.card || a.variantId.localeCompare(b.variantId))
    .map(r => {
      const at = seedAt(r.month);
      return {
        ...r, at,
        sql: `INSERT OR IGNORE INTO kanban_usage (card_id, qty, source, ref, variant_id, at) VALUES (${r.card}, ${r.qty}, 'shopify:seed', '${r.month}', '${r.variantId}', '${at}');`,
      };
    });
  return { rows, unmapped, bad };
}

/** { 'YYYY-MM': { card: qty } } for the stderr eyeball summary. */
export function monthlyTotals(rows) {
  const out = {};
  for (const r of rows) {
    const m = (out[r.month] ||= {});
    m[r.card] = (m[r.card] || 0) + r.qty;
  }
  return out;
}
