/**
 * Every network call the hub makes, in one place.
 * Reads are public; chat/tts carry the shared password as a Bearer token.
 */
import { apiGet, apiPost, API_ROOT } from '../shared/api.js';

export const getDashboard = (start, end) => apiGet('production', 'dashboard', { start, end });
export const getScoreboard = () => apiGet('production', 'scoreboard');
export const getMorningReport = () => apiGet('production', 'morningReport');

export const getQueueBrief = () => apiGet('wholesale', 'getQueueBrief', { limit: 6 });
export const getCoverage = () => apiGet('wholesale', 'getCoverage');
export const getTopsRemaining = () => apiGet('supersack', 'tops_remaining');

export const getComplaintStats = () => apiGet('complaints', 'stats');
export const getReorderRequests = () => apiGet('kanban', 'getReorderRequests', { status: 'open' });
export const getCart = () => apiGet('kanban', 'getCart');

export async function getSupersackQA() {
  const res = await fetch(`${API_ROOT}/supersack-qa`);
  if (!res.ok) throw new Error(`supersack-qa: ${res.status}`);
  return res.json();
}

export const chat = (body) => apiPost('production', 'chat', body, { auth: true });
export const tts = (text) => apiPost('production', 'tts', { text }, { auth: true });

/** Validate the shared password against the worker. Resolves true/false. */
export async function validatePassword(password) {
  const res = await fetch(`${API_ROOT}/orders?action=validatePassword`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ password }),
  });
  let raw = {};
  try { raw = await res.json(); } catch { /* non-JSON body */ }
  const result = raw.data || raw;
  return Boolean(res.ok && result.success);
}

/**
 * Run several fetches, never reject. Returns { key: value|null, errors: {key: message} }.
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
