/**
 * API client rollup logging.
 *
 * Purpose: answer "who actually reads these endpoints?" before deciding what
 * to put behind auth. Locking down /api/production is easy; locking it down
 * without blanking the barn scoreboard mid-shift or silently breaking an
 * integration requires knowing who is calling first.
 *
 * This records one row per DISTINCT client (path + action + origin + UA), not
 * one per request, so a 3-second polling display adds a single row and then
 * only bumps a counter. Row count is bounded by real callers, not traffic.
 *
 * Privacy: no IP addresses are stored. The user-agent is kept because it is
 * what distinguishes "the barn TV" from "someone's phone" from "a bot", and
 * the country code comes from Cloudflare's own request metadata.
 *
 * This is deliberately best-effort: it runs in waitUntil so it never adds
 * latency, and any failure is swallowed so instrumentation can never take an
 * endpoint down.
 */

/** djb2 — cheap, stable, and sufficient for de-duplicating a user-agent. */
function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * Record one API access as a rollup upsert.
 * @param {Request} request
 * @param {object} env  - needs env.DB
 * @param {string} path - url.pathname
 * @param {string|null} action - the ?action= parameter, if any
 */
export async function recordClient(request, env, path, action) {
  if (!env || !env.DB) return;

  const h = request.headers;
  const ua = (h.get('user-agent') || '').slice(0, 180);
  const origin = (h.get('origin') || '').slice(0, 120);
  const referer = (h.get('referer') || '').slice(0, 180);
  const country = (request.cf && request.cf.country) || '';
  const uaHash = hashString(ua || 'none');

  await env.DB.prepare(
    `INSERT INTO api_client_log (path, action, origin, referer, ua, ua_hash, country, requests, first_seen, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
     ON CONFLICT(path, action, origin, ua_hash)
     DO UPDATE SET requests = requests + 1,
                   last_seen = datetime('now'),
                   referer = excluded.referer,
                   country = excluded.country`
  )
    .bind(path, action || '', origin, referer, ua, uaHash, country)
    .run();
}

/**
 * Fire-and-forget wrapper. Never throws, never delays the response.
 */
export function logClient(request, env, ctx, path, action) {
  try {
    const p = recordClient(request, env, path, action).catch(() => {});
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
  } catch {
    // Instrumentation must never break a request.
  }
}
