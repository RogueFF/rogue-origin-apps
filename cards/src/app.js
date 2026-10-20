/* global Response, Request */
// The card worker's request handling, free of Workers globals so tests can drive
// it: routes, period defaults, upstream fetches, 204/400/404/502/500, the card
// cache and the response headers. index.js wires it to the Workers runtime.
//
//   GET /health                       → {"ok":true}
//   GET /weekly[?week=2026-W42]        → the week's card (default: last complete Mon–Fri week, Pacific)
//   GET /eod[?date=2026-10-16]         → end-of-day card (default: today, Pacific)
//   GET /midday[?date=2026-10-19]      → midday card (default: today, Pacific)
//   ?format=json                       → the card model instead of the PNG
import { UpstreamError } from './data.js';
import { weeklyModel, eodModel, middayModel } from './model.js';
import { cardTree } from './layout.js';
import { renderPng } from './render.js';
import { pacificDate, lastCompleteWeek, weekRange, weekDates, isYmd, priorWeekday, addDaysYmd } from './periods.js';

const DAY = 86400;
const TODAY = 120;
const AUTH_PARAM = '_auth';

class BadRequest extends Error {}

/** The token of an `Authorization: Bearer <token>` header, or null. */
export function bearerOf(request) {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') ?? '');
  const token = m?.[1].trim();
  return token || null;
}

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Cache key for a request. With a bearer the key carries a hash of it, so an
 * unlocked card is only ever served back to the bearer that unlocked it: a
 * constant marker would hand it to any bearer, a wrong password included.
 * (A query parameter, not a #fragment: fragments are not part of HTTP cache
 * keys.) An `_auth` the caller put in the URL is dropped first.
 */
async function cacheKey(url, bearer) {
  const key = new URL(url);
  key.searchParams.delete(AUTH_PARAM);
  if (bearer) key.searchParams.set(AUTH_PARAM, await sha256Hex(bearer));
  return new Request(key.toString(), { method: 'GET' });
}

/** A dashboard answered in the API's fallback shape holds another day's figures: no data for the period. */
const real = (dashboard) => (dashboard?.fallback?.active ? null : dashboard);

function dateParam(url, today) {
  const date = url.searchParams.get('date') ?? today;
  if (!isYmd(date)) throw new BadRequest('date must look like 2026-10-16');
  return date;
}

function weekParam(url, today) {
  const week = (url.searchParams.get('week') ?? lastCompleteWeek(today)).toUpperCase();
  try {
    weekRange(week);
  } catch {
    throw new BadRequest('week must look like 2026-W42');
  }
  return week;
}

/** Each card: its period end (for Cache-Control) and how to build its model from the API. */
const CARDS = {
  weekly: {
    period: (url, today) => {
      const week = weekParam(url, today);
      return { week, end: weekRange(week).end };
    },
    async model(api, { week }, generatedAt) {
      const { start, end } = weekRange(week);
      const dates = weekDates(week);
      const [dashboard, prior, sacks, ...boards] = await Promise.all([
        api.dashboard(start, end),
        api.dashboard(addDaysYmd(start, -7), addDaysYmd(end, -7)),
        api.supersackSummary(start, end),
        ...dates.map((date) => api.scoreboard(date)),
      ]);
      if (!real(dashboard)) return null;
      const scoreboards = Object.fromEntries(dates.map((date, i) => [date, boards[i]]));
      return weeklyModel({ week, dashboard, prior: real(prior), scoreboards, sacks, generatedAt });
    },
  },
  eod: {
    period: (url, today) => {
      const date = dateParam(url, today);
      return { date, end: date };
    },
    async model(api, { date }, generatedAt) {
      const before = priorWeekday(date);
      const [dashboard, priorDay, scoreboard, sacks, sackOut] = await Promise.all([
        api.dashboard(date, date), api.dashboard(before, before), api.scoreboard(date),
        api.supersackSummary(date, date), api.sackOutToday(date),
      ]);
      if (!real(dashboard)) return null;
      return eodModel({ date, dashboard, priorDay: real(priorDay), scoreboard, sacks, sackOut, generatedAt });
    },
  },
  midday: {
    period: (url, today) => {
      const date = dateParam(url, today);
      return { date, end: date };
    },
    async model(api, { date }, generatedAt) {
      const before = priorWeekday(date);
      // The live sack count is the salida scan-out; the supersack tracker is end-of-day only.
      const [scoreboard, dashboardToday, priorDay, sackOut] = await Promise.all([
        api.scoreboard(date), api.dashboard(date, date), api.dashboard(before, before), api.sackOutToday(date),
      ]);
      if (!real(dashboardToday)) return null;
      return middayModel({ date, scoreboard, dashboardToday, priorDay: real(priorDay), sackOut, generatedAt });
    },
  },
};

/** Cache-Control for a card: a day for a finished period, two minutes for today; unlocked cards are private. */
const cacheControl = (seconds, unlocked) => `${unlocked ? 'private' : 'public'}, max-age=${seconds}`;

/** The response a client gets: unlocked cards are never public, whatever the stored copy says. */
function forClient(res, hit) {
  const out = new Response(res.body, res);
  if (out.headers.get('X-Costs') === 'unlocked') {
    out.headers.set('Cache-Control', out.headers.get('Cache-Control').replace(/^public/, 'private'));
  }
  out.headers.set('X-Cache', hit ? 'HIT' : 'MISS');
  return out;
}

/**
 * The card worker's fetch handler. `api` is the upstream client for this request
 * (built with its bearer), `runtime()` resolves to `{ satori, Resvg, fonts }`
 * (only called to draw a PNG), `now()` is the clock, `cache` a Cache API object,
 * `waitUntil` (optional) lets the cache write finish after the response.
 */
export function makeApp({ api, runtime, now = () => new Date(), cache, waitUntil }) {
  async function card(request, url, name) {
    const spec = CARDS[name];
    const generatedAt = now();
    const today = pacificDate(generatedAt);
    const period = spec.period(url, today);
    const format = url.searchParams.get('format') === 'json' ? 'json' : 'png';
    const bearer = bearerOf(request);
    const key = cache ? await cacheKey(url, bearer) : null;
    const cached = key ? await cache.match(key) : undefined;
    if (cached) return forClient(cached, true);

    const model = await spec.model(api, period, generatedAt);
    if (!model) return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

    const unlocked = model.costsLocked === false;
    const headers = {
      'Cache-Control': cacheControl(period.end < today ? DAY : TODAY, false),
      'X-Card': model.kind,
      'X-Costs': unlocked ? 'unlocked' : 'locked',
    };
    let res;
    if (format === 'json') {
      res = new Response(JSON.stringify(model), { headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
    } else {
      const rt = await runtime();
      const png = await renderPng(cardTree(model), { fonts: rt.fonts, satori: rt.satori, resvg: rt.Resvg });
      res = new Response(png, { headers: { ...headers, 'Content-Type': 'image/png' } });
    }
    // Store only a card whose lock matches the key: unlocked under a bearer's key,
    // locked under the plain one. A wrong password (locked under a bearer) is never stored.
    if (key && Boolean(bearer) === unlocked) {
      const put = cache.put(key, res.clone());
      if (waitUntil) waitUntil(put);
      else await put;
    }
    return forClient(res, false);
  }

  return {
    async fetch(request) {
      const url = new URL(request.url);
      const name = url.pathname.replace(/\/+$/, '').slice(1);
      if (url.pathname === '/health') return json(200, { ok: true });
      if (!Object.hasOwn(CARDS, name)) return json(404, { error: 'not found' });
      if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'method not allowed' }, { Allow: 'GET, HEAD' });
      try {
        return await card(request, url, name);
      } catch (err) {
        if (err instanceof BadRequest) return json(400, { error: err.message });
        if (err instanceof UpstreamError) return json(502, { error: err.message });
        return json(500, { error: err?.message || String(err) });
      }
    },
  };
}
