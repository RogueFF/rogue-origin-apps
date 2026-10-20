// The fetch handler (makeApp) with the real Node renderer and a fake API and cache.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, bearerOf } from '../src/app.js';
import { UpstreamError } from '../src/data.js';
import { nodeRuntime } from '../src/runtime-node.mjs';
import { fixture, pngSize } from './helpers.mjs';

// Costs the API adds for a caller with the password (the fixtures were captured without it).
const COSTS = {
  '2026-10-16': { laborCost: 4588.5, costPerLb: 21.84, topsCostPerLb: 27.51, smallsCostPerLb: 14.27 },
  '2026-10-15': { laborCost: 5322.66, costPerLb: 22.51, topsCostPerLb: 30.94, smallsCostPerLb: 12.81 },
};
const withCosts = (d) => ({ ...d, costsLocked: false, daily: d.daily.map((day) => ({ ...day, ...COSTS[day.date] })) });

const DASHBOARDS = {
  '2026-10-12..2026-10-16': 'dashboard-2026-W42.locked.json',
  '2026-10-05..2026-10-09': 'dashboard-2026-W41.locked.json',
  '2026-10-15..2026-10-15': 'dashboard-2026-10-15.locked.json',
  '2026-10-16..2026-10-16': 'dashboard-2026-10-16.locked.json',
  '2026-10-19..2026-10-19': 'dashboard-2026-10-19.locked.json',
};
const SCOREBOARDS = ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19'];
const SACKS = {
  '2026-10-12..2026-10-16': 'supersack-2026-W42.json',
  '2026-10-16..2026-10-16': 'supersack-2026-10-16.json',
  '2026-10-19..2026-10-19': 'supersack-2026-10-19.json',
};

/**
 * A fake API over the fixtures. Unknown dashboard ranges answer like the real API
 * (the fallback shape); `unlocked` adds the cost keys, as the password would.
 * `failOn` makes one method throw the UpstreamError a failed upstream call throws.
 */
function fakeApi({ unlocked = false, failOn, fallback = {}, sackOut = {} } = {}) {
  const calls = [];
  const fail = (method, url) => {
    if (failOn === method) throw new UpstreamError(500, url);
  };
  return {
    calls,
    async dashboard(start, end) {
      calls.push(['dashboard', start, end]);
      fail('dashboard', `https://api.test/production?action=dashboard&start=${start}&end=${end}`);
      if (fallback[`${start}..${end}`]) return fallback[`${start}..${end}`];
      const name = DASHBOARDS[`${start}..${end}`];
      if (!name) return fixture('dashboard-2026-10-10.empty.json');
      if (name === 'dashboard-2026-W42.locked.json' && unlocked) return fixture('dashboard-2026-W42.unlocked.json');
      return unlocked ? withCosts(fixture(name)) : fixture(name);
    },
    async scoreboard(date) {
      calls.push(['scoreboard', date]);
      fail('scoreboard', `https://api.test/production?action=scoreboard&date=${date}`);
      return SCOREBOARDS.includes(date) ? fixture(`scoreboard-${date}.json`) : { scoreboard: { hourlyRates: [] }, date };
    },
    async sackOutToday(date) {
      calls.push(['sackout', date]);
      fail('sackout', `https://api.test/harvest?action=sack_out_today&date=${date}`);
      return sackOut[date] ?? fixture('sack-out-2026-10-18.empty.json');
    },
    async supersackSummary(start, end) {
      calls.push(['supersack', start, end]);
      fail('supersack', `https://api.test/supersack?action=summary&start=${start}&end=${end}`);
      const name = SACKS[`${start}..${end}`];
      return name ? fixture(name) : { periods: [], strains: [] };
    },
  };
}

/** A Cache API stand-in that records keys. */
function fakeCache() {
  const store = new Map();
  const puts = [];
  const matches = [];
  return {
    store, puts, matches,
    async match(req) {
      matches.push(req.url);
      const hit = store.get(req.url);
      return hit ? hit.clone() : undefined;
    },
    async put(req, res) {
      puts.push(req.url);
      store.set(req.url, res.clone());
    },
  };
}

// Mon Oct 19 2026, 12:35 PDT.
const NOW = new Date('2026-10-19T19:35:00Z');

function app({ api = fakeApi(), cache = fakeCache(), now = () => NOW } = {}) {
  return { api, cache, app: makeApp({ api, runtime: nodeRuntime, now, cache }) };
}
const get = (a, path, headers = {}) => a.fetch(new Request(`https://cards.test${path}`, { headers }));
const BEARER = { Authorization: 'Bearer right-password' };

test('bearerOf reads a Bearer token and nothing else', () => {
  const req = (h) => new Request('https://cards.test/', { headers: h });
  assert.equal(bearerOf(req({ Authorization: 'Bearer abc' })), 'abc');
  assert.equal(bearerOf(req({ authorization: 'bearer  abc ' })), 'abc');
  assert.equal(bearerOf(req({ Authorization: 'Basic abc' })), null);
  assert.equal(bearerOf(req({ Authorization: 'Bearer ' })), null);
  assert.equal(bearerOf(req({})), null);
});

test('GET /health → 200 {"ok":true} without touching the API', async () => {
  const t = app();
  const res = await get(t.app, '/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(t.api.calls.length, 0);
});

test('unknown path → 404 JSON; other methods → 405', async () => {
  const t = app();
  const res = await get(t.app, '/nope');
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'not found' });
  const post = await t.app.fetch(new Request('https://cards.test/eod', { method: 'POST' }));
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('Allow'), 'GET, HEAD');
});

test('GET /weekly?week=2026-W42 → a 1080x1350 PNG with card headers and a day cache for a finished week', async () => {
  const t = app();
  const res = await get(t.app, '/weekly?week=2026-W42');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'image/png');
  assert.equal(res.headers.get('X-Card'), 'weekly');
  assert.equal(res.headers.get('X-Costs'), 'locked');
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=86400');
  assert.deepEqual(pngSize(new Uint8Array(await res.arrayBuffer())), { width: 1080, height: 1350 });
});

test('weekly fetches this week, the week before, a scoreboard per weekday and the week of sacks', async () => {
  const t = app();
  await get(t.app, '/weekly?week=2026-W42&format=json');
  const sorted = t.api.calls.map((c) => c.join(' ')).sort();
  assert.deepEqual(sorted, [
    'dashboard 2026-10-05 2026-10-09',
    'dashboard 2026-10-12 2026-10-16',
    'scoreboard 2026-10-12', 'scoreboard 2026-10-13', 'scoreboard 2026-10-14', 'scoreboard 2026-10-15', 'scoreboard 2026-10-16',
    'supersack 2026-10-12 2026-10-16',
  ]);
});

test('/weekly defaults to the last complete week in Pacific time', async () => {
  const t = app();
  const model = await (await get(t.app, '/weekly?format=json')).json();
  assert.equal(model.title, 'Week 42');
  // Sunday evening Pacific is already Monday in UTC: the week just finished is still the default.
  const sunday = app({ now: () => new Date('2026-10-26T05:00:00Z') }); // Sun Oct 25, 22:00 PDT
  await get(sunday.app, '/weekly?format=json');
  assert.ok(sunday.api.calls.some((c) => c.join(' ') === 'dashboard 2026-10-19 2026-10-23'));
});

test('bad week or date → 400 with a one-line JSON error, no upstream calls', async () => {
  const t = app();
  for (const [path, error] of [
    ['/weekly?week=garbage', 'week must look like 2026-W42'],
    ['/weekly?week=2026-W60', 'week must look like 2026-W42'],
    ['/eod?date=2026-13-01', 'date must look like 2026-10-16'],
    ['/midday?date=yesterday', 'date must look like 2026-10-16'],
  ]) {
    const res = await get(t.app, path);
    assert.equal(res.status, 400, path);
    assert.deepEqual(await res.json(), { error }, path);
  }
  assert.equal(t.api.calls.length, 0);
});

test('/eod fetches the day, the prior weekday, the scoreboard, the tracker and the scan-out; defaults to today Pacific', async () => {
  const t = app();
  const res = await get(t.app, '/eod?date=2026-10-16');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Card'), 'eod');
  assert.deepEqual(t.api.calls.map((c) => c.join(' ')).sort(), [
    'dashboard 2026-10-15 2026-10-15', 'dashboard 2026-10-16 2026-10-16', 'sackout 2026-10-16', 'scoreboard 2026-10-16', 'supersack 2026-10-16 2026-10-16',
  ]);
  const today = app();
  const model = await (await get(today.app, '/eod?format=json')).json();
  assert.equal(model.title, 'Monday');
  assert.ok(today.api.calls.some((c) => c.join(' ') === 'dashboard 2026-10-16 2026-10-16'), 'Monday’s prior weekday is Friday');
});

test('/midday fetches the scoreboard, the day, the prior weekday and the scan-out (never the tracker); today is a short cache', async () => {
  const t = app();
  const res = await get(t.app, '/midday');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Card'), 'midday');
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=120');
  assert.deepEqual(t.api.calls.map((c) => c.join(' ')).sort(), [
    'dashboard 2026-10-16 2026-10-16', 'dashboard 2026-10-19 2026-10-19', 'sackout 2026-10-19', 'scoreboard 2026-10-19',
  ]);
});

test('no production for the period → 204 with no body (Saturday, the API fallback shape)', async () => {
  const t = app();
  for (const path of ['/eod?date=2026-10-10', '/midday?date=2026-10-10', '/weekly?week=2026-W40']) {
    const res = await get(t.app, path);
    assert.equal(res.status, 204, path);
    assert.equal(await res.text(), '');
  }
  assert.equal(t.cache.puts.length, 0);
});

test('a prior period in the API fallback shape gives no deltas, whatever day the fallback carries', async () => {
  // The prior weekday (Thu 10-15) had no production; this fallback answer carries Wed 10-14's figures.
  const stale = fixture('dashboard-2026-10-15.locked.json');
  stale.fallback = { active: true, date: '2026-10-14' };
  for (const day of stale.daily) day.date = '2026-10-14';
  const t = app({ api: fakeApi({ fallback: { '2026-10-15..2026-10-15': stale } }) });
  const model = await (await get(t.app, '/eod?date=2026-10-16&format=json')).json();
  assert.deepEqual(model.tiles[1].chips, []);
  // Control: the same day against the real Thursday has its delta.
  const control = await (await get(app().app, '/eod?date=2026-10-16&format=json')).json();
  assert.deepEqual(control.tiles[1].chips, [{ kind: 'good', text: '▲ +0.34 vs Thu' }]);
});

test('?format=json → the card model', async () => {
  const t = app();
  const res = await get(t.app, '/eod?date=2026-10-16&format=json');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Type'), /^application\/json/);
  const model = await res.json();
  assert.equal(model.kind, 'eod');
  assert.equal(model.costsLocked, true);
  assert.equal(model.title, 'Friday');
});

test('an upstream failure → 502 naming the status and URL; never cached', async () => {
  const t = app({ api: fakeApi({ failOn: 'scoreboard' }) });
  const res = await get(t.app, '/eod?date=2026-10-16');
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: 'upstream 500 at https://api.test/production?action=scoreboard&date=2026-10-16' });
  assert.equal(t.cache.puts.length, 0);
});

test('any other error → 500 with its message; never cached', async () => {
  const api = fakeApi();
  api.supersackSummary = async () => { throw new Error('boom'); };
  const t = app({ api });
  const res = await get(t.app, '/eod?date=2026-10-16');
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'boom' });
  assert.equal(t.cache.puts.length, 0);
});

test('cache: a locked card without a bearer is stored and served on the next request', async () => {
  const t = app();
  const first = await get(t.app, '/eod?date=2026-10-16');
  assert.equal(first.headers.get('X-Cache'), 'MISS');
  assert.deepEqual(t.cache.puts, ['https://cards.test/eod?date=2026-10-16']);
  const calls = t.api.calls.length;
  const second = await get(t.app, '/eod?date=2026-10-16');
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('X-Cache'), 'HIT');
  assert.equal(t.api.calls.length, calls, 'a hit does not call the API');
});

test('cache: an unlocked card is stored under a key tied to that bearer and is private to the client', async () => {
  const t = app({ api: fakeApi({ unlocked: true }) });
  const res = await get(t.app, '/eod?date=2026-10-16', BEARER);
  assert.equal(res.headers.get('X-Costs'), 'unlocked');
  assert.equal(res.headers.get('Cache-Control'), 'private, max-age=86400');
  assert.equal(t.cache.puts.length, 1);
  const key = new URL(t.cache.puts[0]);
  assert.equal(key.pathname + '?date=' + key.searchParams.get('date'), '/eod?date=2026-10-16');
  assert.match(key.searchParams.get('_auth'), /^[0-9a-f]{64}$/);
  assert.ok(!t.cache.puts[0].includes('right-password'));
  const hit = await get(t.app, '/eod?date=2026-10-16', BEARER);
  assert.equal(hit.headers.get('X-Cache'), 'HIT');
  assert.equal(hit.headers.get('Cache-Control'), 'private, max-age=86400');
});

test('cache: a wrong bearer never reaches the unlocked entry, and its locked card is not stored', async () => {
  const cache = fakeCache();
  const right = app({ api: fakeApi({ unlocked: true }), cache });
  await get(right.app, '/eod?date=2026-10-16', BEARER);
  // Same cache, an API that rejects this bearer (locked answer).
  const wrong = app({ api: fakeApi({ unlocked: false }), cache });
  const res = await get(wrong.app, '/eod?date=2026-10-16', { Authorization: 'Bearer guess' });
  assert.equal(res.headers.get('X-Cache'), 'MISS');
  assert.equal(res.headers.get('X-Costs'), 'locked');
  assert.equal(cache.puts.length, 1, 'the locked answer to a bearer is not cached');
  // No bearer at all: the plain key, also a miss (nothing locked stored yet), and an _auth in the query is ignored.
  const sneaky = await get(wrong.app, `/eod?date=2026-10-16&_auth=${new URL(cache.puts[0]).searchParams.get('_auth')}`);
  assert.equal(sneaky.headers.get('X-Costs'), 'locked');
  assert.equal(sneaky.headers.get('X-Cache'), 'MISS');
});

test('cache: an unlocked answer without a bearer (cannot happen, but) is never stored under the plain key', async () => {
  const t = app({ api: fakeApi({ unlocked: true }) });
  const res = await get(t.app, '/eod?date=2026-10-16');
  assert.equal(res.headers.get('X-Costs'), 'unlocked');
  assert.equal(t.cache.puts.length, 0);
});

test('HEAD is answered like GET', async () => {
  const t = app();
  const res = await t.app.fetch(new Request('https://cards.test/weekly?week=2026-W42', { method: 'HEAD' }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Costs'), 'locked');
});

test('midday counts the sacks scanned out today', async () => {
  const t = app({ api: fakeApi({ sackOut: { '2026-10-19': fixture('sack-out-2026-10-20.json') } }) });
  const model = await (await get(t.app, '/midday?format=json')).json();
  assert.equal(model.minis[2].sub, 'sacks scanned: 10');
  assert.ok(!model.flags.some((f) => /sacks/.test(f.text)));
  const none = await (await get(app().app, '/midday?format=json')).json();
  assert.equal(none.minis[2].sub, 'sacks scanned: 0');
});

test('eod falls back to the scan-out count when the tracker has no rows for the day', async () => {
  const t = app({ api: fakeApi({ sackOut: { '2026-10-19': fixture('sack-out-2026-10-20.json') } }) });
  const model = await (await get(t.app, '/eod?date=2026-10-19&format=json')).json();
  assert.deepEqual(model.minis[1], { label: 'Supersacks', value: '10', unit: 'scanned', sub: 'tracker not filled yet' });
});

test('a failed scan-out call is an upstream failure (502), like any other', async () => {
  const t = app({ api: fakeApi({ failOn: 'sackout' }) });
  const res = await get(t.app, '/midday?date=2026-10-19');
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: 'upstream 500 at https://api.test/harvest?action=sack_out_today&date=2026-10-19' });
});
