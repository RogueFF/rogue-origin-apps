// Upstream client for the production API. The fetch is injectable so tests run
// with a recording fake; the bearer is the caller's own and goes only to the
// dashboard, the one endpoint whose cost figures the API locks behind it.

/** A failed upstream call: a non-2xx answer, or 504 when our timeout fired. */
export class UpstreamError extends Error {
  constructor(status, url) {
    super(`upstream ${status} at ${url}`);
    this.name = 'UpstreamError';
    this.status = status;
    this.url = url;
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
      if (!res.ok) throw new UpstreamError(res.status, url);
      return await res.json();
    } catch (err) {
      if (controller.signal.aborted && !(err instanceof UpstreamError)) throw new UpstreamError(504, url);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  const url = (path, params) => `${root}/${path}?${new URLSearchParams(params)}`;

  return {
    dashboard: (start, end) => getJson(url('production', { action: 'dashboard', start, end }), { auth: true }),
    scoreboard: (date) => getJson(url('production', { action: 'scoreboard', date })),
    supersackSummary: (start, end) => getJson(url('supersack', { action: 'summary', start, end })),
  };
}
