import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeApi, UpstreamError } from '../src/data.js';

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const BASE = 'https://api.example/api';
const SCOREBOARD_URL = `${BASE}/production?action=scoreboard&date=2026-10-16`;

/** A fake fetch that records every call and answers with `body` / `status`. */
function recorder(body = '{}', status = 200) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    return new Response(body, { status });
  };
  return { calls, fetchFn };
}

/** Asserts `promise` rejects with an UpstreamError of `status` at `url`; returns the error. */
async function rejectsUpstream(promise, status, url) {
  let caught;
  await assert.rejects(promise, (err) => {
    caught = err;
    return true;
  });
  assert.ok(caught instanceof UpstreamError, `expected UpstreamError, got ${caught?.name}: ${caught?.message}`);
  assert.equal(caught.status, status);
  assert.equal(caught.url, url);
  return caught;
}

test('dashboard forwards the bearer and parses JSON', async () => {
  const { calls, fetchFn } = recorder(fixture('dashboard-2026-W42.unlocked.json'));
  const api = makeApi({ base: BASE, fetchFn, bearer: 'secret' });
  const d = await api.dashboard('2026-10-12', '2026-10-16');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${BASE}/production?action=dashboard&start=2026-10-12&end=2026-10-16`);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret');
  assert.equal(d.daily.length, 4);
});

test('no bearer → no Authorization header', async () => {
  const { calls, fetchFn } = recorder(fixture('dashboard-2026-W42.locked.json'));
  const api = makeApi({ base: BASE, fetchFn });
  const d = await api.dashboard('2026-10-12', '2026-10-16');
  assert.equal(Object.hasOwn(calls[0].init.headers, 'Authorization'), false);
  assert.equal(d.daily.length, 4);
});

test('a trailing slash on base is trimmed', async () => {
  const { calls, fetchFn } = recorder(fixture('scoreboard-2026-10-16.json'));
  await makeApi({ base: `${BASE}/`, fetchFn }).scoreboard('2026-10-16');
  assert.equal(calls[0].url, SCOREBOARD_URL);
});

test('undefined params are left out of the query, never sent as "undefined"', async () => {
  const { calls, fetchFn } = recorder();
  const api = makeApi({ base: BASE, fetchFn });
  await api.scoreboard();
  await api.dashboard('2026-10-16');
  await api.supersackSummary(undefined, '2026-10-16');
  assert.deepEqual(calls.map((c) => c.url), [
    `${BASE}/production?action=scoreboard`,
    `${BASE}/production?action=dashboard&start=2026-10-16`,
    `${BASE}/supersack?action=summary&end=2026-10-16`,
  ]);
  for (const { url } of calls) assert.doesNotMatch(url, /undefined/);
});

test('scoreboard(date) and supersackSummary(start,end) hit the right actions without a bearer', async () => {
  const { calls, fetchFn } = recorder(fixture('scoreboard-2026-10-16.json'));
  const api = makeApi({ base: BASE, fetchFn, bearer: 'secret' });
  const s = await api.scoreboard('2026-10-16');
  assert.equal(calls[0].url, SCOREBOARD_URL);
  assert.equal(Object.hasOwn(calls[0].init.headers, 'Authorization'), false);
  assert.equal(s.date, '2026-10-16');

  const sacks = recorder(fixture('supersack-2026-W42.json'));
  const api2 = makeApi({ base: BASE, fetchFn: sacks.fetchFn, bearer: 'secret' });
  const summary = await api2.supersackSummary('2026-10-12', '2026-10-16');
  assert.equal(sacks.calls[0].url, `${BASE}/supersack?action=summary&start=2026-10-12&end=2026-10-16`);
  assert.equal(Object.hasOwn(sacks.calls[0].init.headers, 'Authorization'), false);
  assert.ok(Array.isArray(summary.periods));
});

test('a successful call leaves the signal un-aborted, even after the timeout would have fired', async () => {
  const { calls, fetchFn } = recorder(fixture('scoreboard-2026-10-16.json'));
  const api = makeApi({ base: BASE, fetchFn, timeoutMs: 20 });
  await api.scoreboard('2026-10-16');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(calls[0].init.signal.aborted, false);
});

test('upstream non-200 throws UpstreamError with the status and url', async () => {
  const { fetchFn } = recorder('{"error":"boom"}', 500);
  await rejectsUpstream(makeApi({ base: BASE, fetchFn }).scoreboard('2026-10-16'), 500, SCOREBOARD_URL);
});

test('a non-200 answer has its body cancelled before the throw', async () => {
  let cancelled = 0;
  const fetchFn = async () => ({
    status: 503,
    body: { cancel: async () => { cancelled += 1; } },
    json: async () => assert.fail('a non-200 body must not be parsed'),
  });
  await rejectsUpstream(makeApi({ base: BASE, fetchFn }).scoreboard('2026-10-16'), 503, SCOREBOARD_URL);
  assert.equal(cancelled, 1);
});

test('a 2xx other than 200 (204 No Content) is an UpstreamError, not a JSON parse error', async () => {
  const { fetchFn } = recorder(null, 204);
  await rejectsUpstream(
    makeApi({ base: BASE, fetchFn }).dashboard('2026-10-12', '2026-10-16'),
    204,
    `${BASE}/production?action=dashboard&start=2026-10-12&end=2026-10-16`,
  );
});

test('a network error is an UpstreamError 502 carrying the cause', async () => {
  const boom = new TypeError('fetch failed');
  const fetchFn = async () => { throw boom; };
  const err = await rejectsUpstream(makeApi({ base: BASE, fetchFn }).scoreboard('2026-10-16'), 502, SCOREBOARD_URL);
  assert.equal(err.cause, boom);
});

test('a 200 whose body is not JSON is an UpstreamError 502 carrying the SyntaxError', async () => {
  const { fetchFn } = recorder('<html>oops</html>', 200);
  const err = await rejectsUpstream(makeApi({ base: BASE, fetchFn }).scoreboard('2026-10-16'), 502, SCOREBOARD_URL);
  assert.ok(err.cause instanceof SyntaxError);
});

test('fetch aborts after the timeout', async () => {
  let seenSignal;
  const fetchFn = (url, init) => new Promise((resolve, reject) => {
    seenSignal = init.signal;
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
  const api = makeApi({ base: BASE, fetchFn, timeoutMs: 10 });
  const err = await rejectsUpstream(api.scoreboard('2026-10-16'), 504, SCOREBOARD_URL);
  assert.equal(seenSignal.aborted, true);
  assert.equal(err.cause, seenSignal.reason);
});

test('sackOutToday(date) reads the salida scan-out without a bearer', async () => {
  const { calls, fetchFn } = recorder(fixture('sack-out-2026-10-20.json'));
  const api = makeApi({ base: BASE, fetchFn, bearer: 'secret' });
  const out = await api.sackOutToday('2026-10-20');
  assert.equal(calls[0].url, `${BASE}/harvest?action=sack_out_today&date=2026-10-20`);
  assert.equal(Object.hasOwn(calls[0].init.headers, 'Authorization'), false);
  assert.equal(out.total, 10);
});
