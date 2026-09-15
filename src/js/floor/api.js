/**
 * Every network call the Floor Manager makes, in one place.
 *
 * Mirrors src/js/hub/api.js: thin named wrappers over apiGet/apiPost, nothing
 * else in this file talks to fetch directly. That keeps the backend contract
 * (Phase 1 spec, "Backend contract") in one auditable spot instead of spread
 * across editor.js/timer.js/queue.js/drawer.js call sites.
 */
import { apiGet, apiPost } from '../shared/api.js';

export const getProduction = (date) => apiGet('production', 'getProduction', { date });

export const addProduction = (payload) => apiPost('production', 'addProduction', payload);

// The backend returns every crop year it has ever seen a strain harvested
// under; legacy kept only startsWith('2025') (index.js:1706) because that is
// the crop year the floor is currently on — port the filter or last year's
// names show up as selectable options today.
export async function getCultivars() {
  const { cultivars } = await apiGet('production', 'getCultivars');
  return (cultivars || []).filter((name) => name.startsWith('2025'));
}

export const getShiftStart = (date) => apiGet('production', 'getShiftStart', { date });

// Body shape pinned by the phase 1 spec: { time: ISO|null }, null meaning
// "server now" (used to clear a manual start back to the default).
export const setShiftStart = (timeIso) => apiPost('production', 'setShiftStart', { time: timeIso ?? null });

// date is omitted (not sent as `undefined`) so the worker defaults to today,
// same as the hub's getScoreboard() — apiGet already drops undefined params.
export const getScoreboard = (date) => apiGet('production', 'scoreboard', { date });

export const getScaleWeight = () => apiGet('production', 'scaleWeight');

export const logBag = (size) => apiPost('production', 'logBag', { size });

export const setBagMode = (mode) => apiPost('production', 'setBagMode', { mode });

export const getVersion = () => apiGet('production', 'version');

export const listPoolProducts = (poolType) => apiPost('pool', 'list_products', { poolType });

export const updatePool = ({ productId, operation, amount, note, poolType }) =>
  apiPost('pool', 'update_pool', { productId, operation, amount, note, poolType });

export const getRecentPoolChanges = (count = 10) => apiPost('pool', 'get_recent_changes', { count });

export const getQueueBrief = () => apiGet('wholesale', 'getQueueBrief');

// Only mutating call in this file that needs auth: setLineCredit edits an
// order line's credited pounds, same Bearer scheme as hub's chat/tts.
export const setLineCredit = ({ lineId, creditedLbs }) =>
  apiPost('wholesale', 'setLineCredit', { lineId, creditedLbs }, { auth: true });

/**
 * Run several fetches, never reject. Returns { key: value|null, errors: {key: message} }.
 * Copied from src/js/hub/api.js: the boot sequence in main.js needs one bad
 * endpoint (say, the queue brief) to not block production/scoreboard/cultivars
 * from rendering.
 */
export async function settle(map) {
  const keys = Object.keys(map);
  const results = await Promise.allSettled(keys.map((k) => map[k]));
  const out = { errors: {} };
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') out[keys[i]] = r.value;
    else { out[keys[i]] = null; out.errors[keys[i]] = r.reason?.message || String(r.reason); }
  });
  return out;
}
