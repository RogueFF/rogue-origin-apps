/**
 * Buyer lock: who an order is FOR only leaves the worker for callers that
 * carry the shared password. The queue itself — order refs, pounds, percent
 * done, finish dates — stays readable, because the open Floor Manager page and
 * the hourly-entry banner read the queue brief without a login.
 *
 * Same idea as lib/cost-lock.js, but by exact key name rather than a pattern:
 * a buyer field has no common substring the way every cost figure contains
 * "cost", and a pattern broad enough to catch one would eat unrelated keys.
 */

/**
 * Keys that identify a buyer. Removed at every depth for a caller without the
 * password. Add a key here (e.g. 'orderRef') to stop it leaving too.
 */
export const BUYER_KEYS = ['nickname'];

/**
 * Remove every key named in `keys` from `value`, recursively. Returns a new
 * value. The key is DELETED, not nulled: `"nickname": null` still tells a
 * reader the field exists and invites a client to render it.
 */
export function stripKeys(value, keys) {
  if (Array.isArray(value)) return value.map(v => stripKeys(v, keys));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (keys.includes(k)) continue;
      out[k] = stripKeys(v, keys);
    }
    return out;
  }
  return value;
}

/**
 * The payload an unauthenticated caller gets: buyer keys gone, and a top-level
 * `ordersLocked: true` so the page can offer an unlock instead of blanks.
 */
export function lockBuyers(payload) {
  const stripped = stripKeys(payload, BUYER_KEYS);
  if (stripped && typeof stripped === 'object' && !Array.isArray(stripped)) stripped.ordersLocked = true;
  return stripped;
}
