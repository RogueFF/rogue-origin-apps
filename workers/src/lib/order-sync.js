/**
 * Shopify open orders -> shop_orders / shop_order_lines (migration 0058; design
 * doc §2e slice 1). Runs on the 5-minute cron during the day and on the bag/tag
 * page's Refresh.
 *
 * The query asks for no customer, address, email or price field, so no buyer
 * data ever reaches the Worker (§2e rule). Only open, unfulfilled orders created
 * in the last LOOKBACK_DAYS are read, a page of PAGE orders at a time, to stay
 * well under Shopify's 1,000-point query cost.
 *
 * What goes in the queue: not cancelled, some line still unfulfilled, and
 * (Nathan's m2o-line / wholesale-line tag, or created on/after the go-live date
 * ORDER_QUEUE_GO_LIVE, YYYY-MM-DD Pacific). The date rule means a change to his
 * Flow can never empty the queue silently (Koa 2026-11-10: "as recommended").
 *
 * Dedup: upsert on the Shopify order and line ids, so a re-poll changes nothing.
 * An order we hold that a poll no longer returns is looked up by id: cancelled
 * -> 'cancelled', fulfilled (e.g. its label was bought in Shopify) -> 'fulfilled'.
 */
import { shopifyGraphql, shopifyConfigured } from './shopify.js';
import { routeLine, rushOf, intakeTag } from './order-route.js';
import { pacificDay } from './pacific.js';
import { dropQueuedJobs } from '../handlers/production/order-flow.js';

export const LOOKBACK_DAYS = 21;
export const PAGE = 10;           // orders per page; 25 lines each keeps the cost ~800
export const LINES = 25;
export const MAX_PAGES = 15;
export const REFRESH_GAP_MS = 20e3;

export const ORDERS_QUERY = `query OpenOrders($q: String!, $after: String) {
  orders(first: ${PAGE}, after: $after, sortKey: CREATED_AT, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt cancelledAt displayFulfillmentStatus tags
      shippingLine { title }
      lineItems(first: ${LINES}) {
        nodes {
          id title variantTitle quantity unfulfilledQuantity
          product { title productType tags }
          variant { selectedOptions { name value } }
        }
      }
    }
  }
}`;

export const STATUS_QUERY = `query OrderStatus($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Order { id cancelledAt displayFulfillmentStatus } }
}`;


export function searchQuery(now = new Date()) {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86400e3).toISOString().slice(0, 10);
  return `created_at:>=${since} AND (fulfillment_status:unshipped OR fulfillment_status:partial) AND -status:cancelled`;
}

/** Shopify order node -> what we keep, or null when it doesn't belong in the queue. */
export function normalizeOrder(node, goLive = null) {
  const tags = node.tags || [];
  const tag = intakeTag(tags);
  const placedDay = pacificDay(new Date(node.createdAt));
  if (!tag && !(goLive && placedDay >= goLive)) return null;
  if (node.cancelledAt) return null;
  const lines = ((node.lineItems && node.lineItems.nodes) || []).map((li, i) => {
    const options = {};
    for (const o of (li.variant && li.variant.selectedOptions) || []) options[o.name] = o.value;
    const r = routeLine({
      title: li.title, variantTitle: li.variantTitle, hasProduct: !!li.product,
      productTitle: li.product && li.product.title, productType: li.product && li.product.productType,
      productTags: (li.product && li.product.tags) || [], options,
    }, { tags });
    return {
      gid: li.id, title: li.title, variantTitle: li.variantTitle || null,
      qty: Number(li.quantity) || 0, qtyOpen: Number(li.unfulfilledQuantity) || 0, sort: i, ...r,
    };
  });
  if (!lines.some(l => l.qtyOpen > 0)) return null;
  const rushWhy = rushOf(node.shippingLine && node.shippingLine.title);
  return {
    gid: node.id, name: String(node.name || '').slice(0, 20), placedAt: node.createdAt,
    intakeTag: tag, rush: rushWhy ? 1 : 0, rushWhy, shopStatus: node.displayFulfillmentStatus || null, lines,
  };
}

export async function upsertOrder(env, o) {
  const row = await env.DB.prepare(
    `INSERT INTO shop_orders (shop_gid, name, placed_at, intake_tag, rush, rush_why, shop_status, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT (shop_gid) DO UPDATE SET
       name = excluded.name, intake_tag = excluded.intake_tag,
       rush = MAX(shop_orders.rush, excluded.rush), rush_why = COALESCE(excluded.rush_why, shop_orders.rush_why),
       shop_status = excluded.shop_status, last_seen_at = excluded.last_seen_at
     RETURNING id, state`
  ).bind(o.gid, o.name, o.placedAt, o.intakeTag, o.rush, o.rushWhy, o.shopStatus).first();
  const before = new Map(((await env.DB.prepare(
    `SELECT shop_line_gid, qty_open FROM shop_order_lines WHERE order_id = ?`).bind(row.id).all()).results || [])
    .map(r => [r.shop_line_gid, r.qty_open]));
  let changed = false;
  for (const l of o.lines) {
    if (before.has(l.gid) && before.get(l.gid) !== l.qtyOpen) changed = true;
    if (!before.has(l.gid) && before.size) changed = true;
    await env.DB.prepare(
      `INSERT INTO shop_order_lines (order_id, shop_line_gid, title, variant_title, cultivar, floor_cultivar, form, bag, qty, qty_open, route, route_why, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (shop_line_gid) DO UPDATE SET
         title = excluded.title, variant_title = excluded.variant_title, cultivar = excluded.cultivar,
         floor_cultivar = excluded.floor_cultivar, form = excluded.form, bag = excluded.bag, qty = excluded.qty,
         qty_open = excluded.qty_open, sort = excluded.sort,
         -- a route bag/tag picked by hand (0061) is never overwritten by the next poll
         route = CASE WHEN shop_order_lines.route_set_by IS NULL THEN excluded.route ELSE shop_order_lines.route END,
         route_why = CASE WHEN shop_order_lines.route_set_by IS NULL THEN excluded.route_why ELSE shop_order_lines.route_why END`
    ).bind(row.id, l.gid, l.title, l.variantTitle, l.cultivar, l.floorCultivar, l.form, l.bag, l.qty, l.qtyOpen,
      l.route, l.why, l.sort).run();
  }
  // A line removed in Shopify: nothing left open on it.
  for (const gid of before.keys()) {
    if (!o.lines.some(l => l.gid === gid)) {
      changed = true;
      await env.DB.prepare(`UPDATE shop_order_lines SET qty_open = 0 WHERE shop_line_gid = ?`).bind(gid).run();
    }
  }
  // An edit after the order has left the queue is flagged, never applied silently (slice 2+ acts on it).
  if (changed && row.state !== 'queued') {
    await env.DB.prepare(`UPDATE shop_orders SET shop_changed_at = datetime('now') WHERE id = ?`).bind(row.id).run();
  }
  return row.id;
}

/** Orders we hold that the poll didn't return: ask Shopify what became of them. */
async function reconcile(env, seen, gql) {
  const held = ((await env.DB.prepare(
    `SELECT id, shop_gid FROM shop_orders WHERE state NOT IN ('fulfilled', 'cancelled')`).all()).results || [])
    .filter(r => !seen.has(r.shop_gid));
  let closed = 0;
  for (let i = 0; i < held.length; i += 25) {
    const batch = held.slice(i, i + 25);
    const data = await gql(STATUS_QUERY, { ids: batch.map(r => r.shop_gid) });
    for (const n of (data && data.nodes) || []) {
      if (!n || !n.id) continue;
      const r = batch.find(b => b.shop_gid === n.id);
      if (!r) continue;
      if (n.cancelledAt) {
        await env.DB.prepare(`UPDATE shop_orders SET state = 'cancelled', cancelled_at = ?, shop_status = ? WHERE id = ?`)
          .bind(n.cancelledAt, n.displayFulfillmentStatus || null, r.id).run();
        await dropQueuedJobs(env, r.id);
        closed++;
      } else if (n.displayFulfillmentStatus === 'FULFILLED') {
        await env.DB.prepare(`UPDATE shop_orders SET state = 'fulfilled', fulfilled_at = datetime('now'), shop_status = 'FULFILLED' WHERE id = ?`)
          .bind(r.id).run();
        await dropQueuedJobs(env, r.id);
        closed++;
      }
    }
  }
  return closed;
}

const utcText = d => d.toISOString().replace('T', ' ').slice(0, 19);

async function noteSync(env, now, fields) {
  await env.DB.prepare(
    `INSERT INTO shop_sync (id, last_try_at, last_ok_at, last_error, last_count) VALUES (1, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET last_try_at = excluded.last_try_at,
       last_ok_at = COALESCE(excluded.last_ok_at, shop_sync.last_ok_at),
       last_error = excluded.last_error, last_count = COALESCE(excluded.last_count, shop_sync.last_count)`
  ).bind(utcText(now), fields.ok ? utcText(now) : null, fields.error || null, fields.count ?? null).run();
}

/**
 * @param {object} env
 * @param {object} [o]
 * @param {Function} [o.gql]  (query, variables) => data; defaults to Shopify. Tests pass fixtures.
 * @returns {Promise<{ok:boolean, skipped?:string, orders?:number, closed?:number, error?:string}>}
 */
export async function syncShopOrders(env, { gql, now = new Date(), force = false } = {}) {
  if (!gql && !shopifyConfigured(env)) return { ok: false, skipped: 'not-configured' };
  const call = gql || ((q, v) => shopifyGraphql(env, q, v));
  if (!force) {
    const last = await env.DB.prepare(`SELECT last_try_at FROM shop_sync WHERE id = 1`).first();
    if (last && last.last_try_at && now.getTime() - Date.parse(last.last_try_at.replace(' ', 'T') + 'Z') < REFRESH_GAP_MS) {
      return { ok: true, skipped: 'too-soon' };
    }
  }
  const goLive = /^\d{4}-\d{2}-\d{2}$/.test(env.ORDER_QUEUE_GO_LIVE || '') ? env.ORDER_QUEUE_GO_LIVE : null;
  try {
    const seen = new Set();
    let after = null, n = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await call(ORDERS_QUERY, { q: searchQuery(now), after });
      const conn = data && data.orders;
      for (const node of (conn && conn.nodes) || []) {
        const o = normalizeOrder(node, goLive);
        if (!o) continue;
        seen.add(o.gid);
        await upsertOrder(env, o);
        n++;
      }
      if (!conn || !conn.pageInfo || !conn.pageInfo.hasNextPage) break;
      after = conn.pageInfo.endCursor;
    }
    const closed = await reconcile(env, seen, call);
    await noteSync(env, now, { ok: true, count: n });
    return { ok: true, orders: n, closed };
  } catch (e) {
    const error = String((e && e.message) || e).slice(0, 200);
    await noteSync(env, now, { ok: false, error });
    return { ok: false, error };
  }
}

/** The cron's gate: 5 am to 7 pm Pacific, so the overnight wave is in before the 7:00 start. */
export function inPollHours(now = new Date()) {
  const h = Number(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' }));
  return h >= 5 && h < 19;
}

