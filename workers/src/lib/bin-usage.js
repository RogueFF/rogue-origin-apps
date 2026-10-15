/** Shopify Flow → usage rows. Pure. Design §4 (docs/plans/2026-10-14-grove-bins-design.md). */

/**
 * Normalise the Flow "Order created" body.
 * { order: '#1001', at?: ISO, items: [{ variant_id: 'gid://…/111' | '111', qty }] }
 * → { ref, at, items: [{ variantId, qty }] }. Items with no id or qty ≤ 0 / NaN are dropped.
 */
export function parseFlowOrder(body) {
  const ref = String(body?.order || '').trim();
  if (!ref) throw new Error('order (name) is required');
  const at = body.at ? String(body.at) : new Date().toISOString();
  const items = [];
  for (const it of Array.isArray(body.items) ? body.items : []) {
    const variantId = String(it?.variant_id || '').replace(/^gid:\/\/shopify\/ProductVariant\//, '').trim();
    const qty = Number(it?.qty);
    if (!variantId || !(qty > 0)) continue;
    items.push({ variantId, qty });
  }
  return { ref, at, items };
}

/**
 * One kanban_usage row per (line item × recipe). A variant with no recipe becomes
 * a card_id 0 'shopify:unmapped' row so it shows up on the recipes screen, never silence.
 */
export function usageRowsFor(order, recipes) {
  const byVariant = new Map();
  for (const r of recipes) {
    if (!byVariant.has(r.variant_id)) byVariant.set(r.variant_id, []);
    byVariant.get(r.variant_id).push(r);
  }
  const rows = [];
  for (const it of order.items) {
    const rs = byVariant.get(it.variantId);
    if (!rs) {
      rows.push({ card_id: 0, qty: it.qty, source: 'shopify:unmapped', ref: order.ref, variant_id: it.variantId, at: order.at });
      continue;
    }
    for (const r of rs) {
      const q = it.qty * Number(r.qty);
      if (q > 0) rows.push({ card_id: r.card_id, qty: q, source: 'shopify', ref: order.ref, variant_id: it.variantId, at: order.at });
    }
  }
  return rows;
}
