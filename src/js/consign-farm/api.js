/**
 * The farm page's API client. Route: /api/consign-farm (workers/src/handlers/consign-farm-d1.js).
 * Sends the link and PIN in the POST body only, never in a URL. No shared password,
 * no Authorization header, no cookies, nothing stored.
 */
const PROD_ROOT = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api';
const apiParam = new URLSearchParams(location.search).get('api') || '';
const ROOT = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api$/.test(apiParam) ? apiParam : PROD_ROOT;
const TIMEOUT_MS = 20000;

/**
 * POST one action. Resolves with `data`. Rejects with an Error carrying
 * code (UNAUTHORIZED | VALIDATION_ERROR | RATE_LIMITED | ...), details, and network: true
 * when there was no answer.
 */
export async function farmCall(action, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${ROOT}/consign-farm?action=${encodeURIComponent(action)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: ctl.signal,
    });
  } catch {
    const e = new Error('network');
    e.network = true;
    throw e;
  } finally {
    clearTimeout(timer);
  }
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  if (!json && (res.status === 0 || res.status >= 502 || res.status === 408)) {
    const e = new Error('network');
    e.network = true;
    throw e;
  }
  if (!res.ok || !json || json.success === false) {
    const e = new Error((json && json.error) || `HTTP ${res.status}`);
    e.status = res.status;
    e.code = json && json.code;
    e.details = (json && json.details) || {};
    e.network = res.status === 408;
    throw e;
  }
  return json.data;
}
