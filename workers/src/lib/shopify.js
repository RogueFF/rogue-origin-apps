/**
 * Shopify Admin GraphQL, read-only, for the order queue (design doc §2e).
 *
 * Auth: a Dev Dashboard app installed on the store (Shopify stopped new legacy
 * custom apps on 2026-01-01). The Worker trades the app's Client ID and secret
 * for a 24-hour token (client credentials grant) and keeps that token in memory
 * only: it is never written to D1 or logged.
 *   SHOPIFY_SHOP           store subdomain, without .myshopify.com
 *   SHOPIFY_CLIENT_ID      secret
 *   SHOPIFY_CLIENT_SECRET  secret
 *   SHOPIFY_ADMIN_TOKEN    optional instead of the two above: a token from an
 *                          existing legacy custom app (shpat_...), if one exists
 *   SHOPIFY_API_VERSION    optional, default API_VERSION below
 * Scopes the app needs: read_orders, read_products. Nothing here can write.
 */

export const API_VERSION = '2026-10';
const EARLY_MS = 60e3;   // fetch a new token a minute before it runs out

let cached = null;       // { key, token, until }

export function shopifyConfigured(env) {
  return !!(env && env.SHOPIFY_SHOP && (env.SHOPIFY_ADMIN_TOKEN || (env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET)));
}

/**
 * gid://shopify/Order/123 -> that order's page in Shopify admin, or null when the
 * store isn't set. Bag/tag prints there (Koa 2026-11-11: "it goes through shopify
 * on back-end"): Print > Print packing slips, and later Create shipping label >
 * Buy > Print label. SHOPIFY_ADMIN_STORE only if the admin handle differs.
 */
export function adminOrderUrl(env, shopGid) {
  const store = String((env && (env.SHOPIFY_ADMIN_STORE || env.SHOPIFY_SHOP)) || '').replace(/\.myshopify\.com$/i, '').trim();
  const id = /\/Order\/(\d+)$/.exec(String(shopGid || ''));
  return store && id ? `https://admin.shopify.com/store/${encodeURIComponent(store)}/orders/${id[1]}` : null;
}

export class ShopifyError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

const shopHost = env => `${String(env.SHOPIFY_SHOP).replace(/\.myshopify\.com$/i, '').trim()}.myshopify.com`;

/** For tests: forget the cached token. */
export function resetTokenCache() { cached = null; }

export async function adminToken(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (env.SHOPIFY_ADMIN_TOKEN) return env.SHOPIFY_ADMIN_TOKEN;
  const key = `${env.SHOPIFY_SHOP}|${env.SHOPIFY_CLIENT_ID}`;
  if (cached && cached.key === key && cached.until > now) return cached.token;
  const res = await fetchImpl(`https://${shopHost(env)}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.SHOPIFY_CLIENT_ID,
      client_secret: env.SHOPIFY_CLIENT_SECRET,
    }).toString(),
  });
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !data || !data.access_token) {
    const why = (data && (data.error_description || data.error)) || `HTTP ${res.status}`;
    throw new ShopifyError(`Shopify token refused: ${String(why).slice(0, 120)}`, 'TOKEN');
  }
  const life = Number(data.expires_in) > 0 ? Number(data.expires_in) * 1000 : 3600e3;
  cached = { key, token: data.access_token, until: now + life - EARLY_MS };
  return data.access_token;
}

export async function shopifyGraphql(env, query, variables = {}, { fetchImpl = fetch } = {}) {
  const token = await adminToken(env, { fetchImpl });
  const version = env.SHOPIFY_API_VERSION || API_VERSION;
  const res = await fetchImpl(`https://${shopHost(env)}/admin/api/${version}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401 || res.status === 403) {
    cached = null;
    throw new ShopifyError(`Shopify refused the token (HTTP ${res.status}): check the app's scopes`, 'AUTH');
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !data) throw new ShopifyError(`Shopify HTTP ${res.status}`, 'HTTP');
  if (Array.isArray(data.errors) && data.errors.length) {
    throw new ShopifyError(`Shopify: ${String(data.errors[0].message || 'error').slice(0, 160)}`, 'GRAPHQL');
  }
  return data.data;
}
