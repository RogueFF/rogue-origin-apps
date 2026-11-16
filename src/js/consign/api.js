/**
 * Consignment lot ledger API client. Route: /api/consign (workers/src/handlers/consign-d1.js).
 *
 * Not built on shared/api.js makeApi: that pins the production root and turns every
 * failure into one message, while this page needs the ?api=localhost override
 * (as crew-board/main.js does) and must tell "no signal" apart from "the server said no".
 */
import { storedPassword } from '../shared/api.js';

const PROD_ROOT = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api';
const apiParam = new URLSearchParams(location.search).get('api') || '';
export const ROOT = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api$/.test(apiParam) ? apiParam : PROD_ROOT;

const OWNER_KEY = 'consign_owner_pw';
// Owner password lives in sessionStorage only: gone when the tab closes.
export const ownerPw = () => { try { return sessionStorage.getItem(OWNER_KEY) || ''; } catch { return ''; } };
export const setOwnerPw = (v) => { try { if (v) sessionStorage.setItem(OWNER_KEY, v); else sessionStorage.removeItem(OWNER_KEY); } catch { /* private mode */ } };

const TIMEOUT_MS = 20000;
const OWNER_ACTIONS = new Set(['saveFarm', 'savePricePoint', 'setLotTerms']);

function networkError() {
  const err = new Error('network');
  err.network = true;
  return err;
}

/**
 * POST one action. Resolves with `data`. Rejects with an Error whose message is the
 * server's own; `err.network` is true when the request never got an answer, and
 * `err.owner` when the owner password was refused. opts.timeoutMs: give up after this long
 * (a sheet photo read takes longer than a save).
 */
export async function call(action, body = {}, { timeoutMs = TIMEOUT_MS } = {}) {
  const owner = OWNER_ACTIONS.has(action);
  const payload = owner ? { ...body, owner_password: ownerPw() } : body;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw networkError();
  let res;
  // A barn connection can be "online" and still dead: give up after a while and
  // treat it as no signal. client_key makes the later resend safe.
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    res = await fetch(`${ROOT}/consign?action=${encodeURIComponent(action)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${storedPassword()}` },
      body: JSON.stringify(payload),
      signal: ctl ? ctl.signal : undefined,
    });
  } catch {
    throw networkError();
  } finally {
    if (timer) clearTimeout(timer);
  }
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  // A gateway error with no JSON body is the network, not a refusal.
  if (!json && (res.status === 0 || res.status >= 502)) throw networkError();
  if (!res.ok || !json || json.success === false) {
    const err = new Error((json && json.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = json && json.code;
    err.owner = owner && res.status === 401 && /owner/i.test(err.message);
    // Worth trying again later (a held entry stays held): auth, timeout, rate limit,
    // server trouble. Only 400/404 mean the entry itself is wrong.
    err.retry = !err.owner && (res.status === 401 || res.status === 408 || res.status === 429 || res.status >= 500);
    throw err;
  }
  return json.data;
}

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
