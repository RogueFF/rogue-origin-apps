// Upstream client for the production API. The fetch is injectable so tests run
// with a recording fake; the bearer is the caller's own and goes only to the
// dashboard, the one endpoint whose cost figures the API locks behind it.

/**
 * Every failed upstream call, so a route needs one branch for all of them:
 * the upstream's own status for any answer other than 200, 504 when our
 * timeout fired, 502 for a network error or a 200 whose body is not JSON.
 * The underlying error, when there is one, is `cause`.
 */
export class UpstreamError extends Error {
  constructor(status, url, options) {
    super(`upstream ${status} at ${url}`, options);
    this.name = 'UpstreamError';
    this.status = status;
    this.url = url;
  }
}

/** Drop an unread body so the runtime can release the connection. */
function discardBody(res) {
  try {
    res.body?.cancel()?.catch?.(() => {});
  } catch {
    // already consumed or locked; nothing to release
  }
}

export function makeApi({ base, fetchFn = (url, init) => globalThis.fetch(url, init), bearer, timeoutMs = 8000 }) {
  const root = String(base).replace(/\/+$/, '');

  async function getJson(url, { auth = false } = {}) {
    const headers = { Accept: 'application/json' };
    if (auth && bearer) headers.Authorization = `Bearer ${bearer}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
    try {
      const res = await fetchFn(url, { headers, signal: controller.signal });
      if (res.status !== 200) {
        discardBody(res);
        throw new UpstreamError(res.status, url);
      }
      return await res.json();
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      throw new UpstreamError(controller.signal.aborted ? 504 : 502, url, { cause: err });
    } finally {
      clearTimeout(timer);
    }
  }

  const url = (path, params) => {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined));
    return `${root}/${path}?${query}`;
  };

  return {
    dashboard: (start, end) => getJson(url('production', { action: 'dashboard', start, end }), { auth: true }),
    scoreboard: (date) => getJson(url('production', { action: 'scoreboard', date })),
    supersackSummary: (start, end) => getJson(url('supersack', { action: 'summary', start, end })),
    // The salida scan-out for one Pacific day: { total, groups, by_strain, ... }. Public, no bearer.
    sackOutToday: (date) => getJson(url('harvest', { action: 'sack_out_today', date })),
  };
}
