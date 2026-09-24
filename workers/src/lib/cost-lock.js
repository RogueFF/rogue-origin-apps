/**
 * Cost lock: labor-cost figures only leave the worker for callers that carry
 * the shared password. Everything else in a production payload (pounds, rates,
 * hours, crew) stays public, because the barn TV and the floor page read it
 * without a login.
 *
 * Any key whose name contains "cost" (laborCost, costPerLb, topsCostPerLb,
 * totalLaborCost, ...) is treated as a cost figure, at every depth. Hours keys
 * never match, so labor HOURS stay visible.
 */
import { isAuthenticated } from './auth.js';

const COST_KEY = /cost/i;

/** Remove every cost key from `value`, recursively. Returns a new value. */
export function stripCosts(value) {
  if (Array.isArray(value)) return value.map(stripCosts);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (COST_KEY.test(k)) continue;
      out[k] = stripCosts(v);
    }
    return out;
  }
  return value;
}

/**
 * Gate a handler's JSON Response. Authenticated callers get it untouched;
 * everyone else gets the same payload with cost keys removed and a top-level
 * `costsLocked: true` so the page can show an unlock prompt instead of blanks.
 */
export async function lockCosts(response, request, body, env) {
  if (isAuthenticated(request, body, env)) return response;
  if (!response.ok) return response;
  let payload;
  try {
    payload = await response.clone().json();
  } catch {
    return response;
  }
  const stripped = stripCosts(payload);
  if (stripped && typeof stripped === 'object' && !Array.isArray(stripped)) stripped.costsLocked = true;
  return new Response(JSON.stringify(stripped), { status: response.status, headers: response.headers });
}
