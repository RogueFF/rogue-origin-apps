/**
 * One-click print, browser path (order flow slice 4, design doc §2e; Koa
 * 2026-11-11: "1 click printing"). Bag/tag's Print + confirm opens one print
 * tab (print.html) for the order, which reads this:
 *
 *   GET ?action=orderPrint&orderId=N   the order's papers: the Shopify admin link for
 *                                      Shopify's own packing slip, each cultivar's COA
 *   GET ?action=coaPdf&file=NAME       a COA PDF from R2, inline (for the print tab)
 *
 * Packing slip: Shopify's own (Koa 2026-11-11). The print tab opens the order in
 * Shopify admin in the staff browser, which is already signed in, and Shopify
 * prints it; no buyer field ever reaches this Worker.
 * COAs: lib/order-coa.js. A missing COA is a warning, never a block.
 * Silent printing with no dialogs is slice 6 (the print agent).
 */
import { successResponse, errorResponse } from '../../lib/response.js';
import { coaFiles, coaFor, safeCoaFile, COA_PREFIX } from '../../lib/order-coa.js';

const notReady = e => /no such (table|column)/i.test(String(e && e.message));

/** gid://shopify/Order/123 -> the order's page in Shopify admin, or null when the store isn't set. */
export function adminOrderUrl(env, shopGid) {
  const store = String(env.SHOPIFY_ADMIN_STORE || env.SHOPIFY_SHOP || '').replace(/\.myshopify\.com$/i, '').trim();
  const id = /\/Order\/(\d+)$/.exec(String(shopGid || ''));
  return store && id ? `https://admin.shopify.com/store/${encodeURIComponent(store)}/orders/${id[1]}` : null;
}

/** Every cultivar of an order's open lines, cell and pool alike: each gets its COA. */
export async function orderCoas(env, lines) {
  const files = await coaFiles(env);
  const cultivars = [...new Set(lines.filter(l => l.qty_open > 0 && l.cultivar && (l.form === 'tops' || l.form === 'smalls'))
    .map(l => l.cultivar))];
  return cultivars.map(c => ({ cultivar: c, ...coaFor(c, files) }));
}

export async function getOrderPrint(params, env) {
  const id = Number(params.orderId);
  if (!Number.isInteger(id) || id < 1) return errorResponse('orderId is required', 'VALIDATION_ERROR', 400);
  let order, lines;
  try {
    order = await env.DB.prepare(`SELECT id, shop_gid, name, rush, confirmed_at FROM shop_orders WHERE id = ?`).bind(id).first();
    if (!order) return errorResponse('Unknown order', 'NOT_FOUND', 404);
    lines = (await env.DB.prepare(`SELECT cultivar, form, bag, qty, qty_open, route, title FROM shop_order_lines WHERE order_id = ? ORDER BY sort, id`).bind(id).all()).results || [];
  } catch (e) {
    if (notReady(e)) return errorResponse('The order queue is not set up yet', 'NOT_READY', 503);
    throw e;
  }
  return successResponse({
    order: { id: order.id, name: order.name, rush: order.rush === 1, confirmedAt: order.confirmed_at || null },
    slipUrl: adminOrderUrl(env, order.shop_gid),
    lines: lines.filter(l => l.qty_open > 0).map(l => ({ cultivar: l.cultivar, title: l.title, form: l.form, bag: l.bag, qty: l.qty_open, route: l.route })),
    coas: await orderCoas(env, lines),
  });
}

export async function coaPdf(params, env) {
  const file = String(params.file || '');
  if (!safeCoaFile(file)) return errorResponse('Not a COA file', 'VALIDATION_ERROR', 400);
  if (!env.MEDIA_BUCKET) return errorResponse('COA storage is not set up', 'NOT_READY', 503);
  const obj = await env.MEDIA_BUCKET.get(COA_PREFIX + file);
  if (!obj) return errorResponse('That COA is not in the store yet', 'NOT_FOUND', 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${file}"`,
      'Cache-Control': 'public, max-age=3600',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
