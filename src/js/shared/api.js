/**
 * Shared API helper for Cloudflare Workers backend.
 * Standardizes URL construction, CORS-safe content-type, auth, and response unwrapping.
 */

export const API_ROOT = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api';

function buildUrl(endpoint, action, params = {}) {
  const url = new URL(`${API_ROOT}/${endpoint}`);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  return url.toString();
}

function unwrap(raw) {
  return raw && typeof raw === 'object' && 'data' in raw ? raw.data : raw;
}

async function parseOrThrow(res, endpoint, action) {
  if (!res.ok) {
    let err;
    try { err = (await res.json()).error; } catch { err = res.statusText; }
    throw new Error(`${endpoint}/${action}: ${err || res.status}`);
  }
  return res.json();
}

export async function apiGet(endpoint, action, params = {}) {
  const res = await fetch(buildUrl(endpoint, action, params));
  return unwrap(await parseOrThrow(res, endpoint, action));
}

export async function apiPost(endpoint, action, body, { auth = false } = {}) {
  const headers = { 'Content-Type': 'text/plain' };
  if (auth) {
    const pw = localStorage.getItem('ro_api_password') || '';
    headers.Authorization = `Bearer ${pw}`;
  }
  const res = await fetch(buildUrl(endpoint, action), {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });
  return unwrap(await parseOrThrow(res, endpoint, action));
}

export function makeApi(endpoint, opts = {}) {
  return {
    get: (action, params) => apiGet(endpoint, action, params),
    post: (action, body) => apiPost(endpoint, action, body, opts),
  };
}
