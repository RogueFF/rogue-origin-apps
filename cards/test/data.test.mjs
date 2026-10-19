import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeApi, UpstreamError } from '../src/data.js';

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/** A fake fetch that records every call and answers with `body` / `status`. */
function recorder(body = '{}', status = 200) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    return new Response(body, { status });
  };
  return { calls, fetchFn };
}

test('fetchDashboard forwards the bearer and parses JSON', async () => {
  const { calls, fetchFn } = recorder(fixture('dashboard-2026-W42.unlocked.json'));
  const api = makeApi({ base: 'https://api.example/api', fetchFn, bearer: 'secret' });
  const d = await api.dashboard('2026-10-12', '2026-10-16');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.example/api/production?action=dashboard&start=2026-10-12&end=2026-10-16');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret');
  assert.equal(d.daily.length, 4);
});

test('no bearer → no Authorization header', async () => {
  const { calls, fetchFn } = recorder(fixture('dashboard-2026-W42.locked.json'));
  const api = makeApi({ base: 'https://api.example/api', fetchFn });
  const d = await api.dashboard('2026-10-12', '2026-10-16');
  assert.equal(Object.hasOwn(calls[0].init.headers, 'Authorization'), false);
  assert.equal(d.daily.length, 4);
});

test('a trailing slash on base is trimmed', async () => {
  const { calls, fetchFn } = recorder(fixture('scoreboard-2026-10-16.json'));
  await makeApi({ base: 'https://api.example/api/', fetchFn }).scoreboard('2026-10-16');
  assert.equal(calls[0].url, 'https://api.example/api/production?action=scoreboard&date=2026-10-16');
});

test('scoreboard(date) and supersackSummary(start,end) hit the right actions without a bearer', async () => {
  const { calls, fetchFn } = recorder(fixture('scoreboard-2026-10-16.json'));
  const api = makeApi({ base: 'https://api.example/api', fetchFn, bearer: 'secret' });
  const s = await api.scoreboard('2026-10-16');
  assert.equal(calls[0].url, 'https://api.example/api/production?action=scoreboard&date=2026-10-16');
  assert.equal(Object.hasOwn(calls[0].init.headers, 'Authorization'), false);
  assert.equal(s.date, '2026-10-16');

  const sacks = recorder(fixture('supersack-2026-W42.json'));
  const api2 = makeApi({ base: 'https://api.example/api', fetchFn: sacks.fetchFn, bearer: 'secret' });
  const summary = await api2.supersackSummary('2026-10-12', '2026-10-16');
  assert.equal(sacks.calls[0].url, 'https://api.example/api/supersack?action=summary&start=2026-10-12&end=2026-10-16');
  assert.equal(Object.hasOwn(sacks.calls[0].init.headers, 'Authorization'), false);
  assert.ok(Array.isArray(summary.periods));
});

test('upstream non-200 throws UpstreamError with the status and url', async () => {
  const { fetchFn } = recorder('{"error":"boom"}', 500);
  const api = makeApi({ base: 'https://api.example/api', fetchFn });
  await assert.rejects(api.scoreboard('2026-10-16'), (err) => {
    assert.ok(err instanceof UpstreamError);
    assert.equal(err.status, 500);
    assert.equal(err.url, 'https://api.example/api/production?action=scoreboard&date=2026-10-16');
    return true;
  });
});

test('fetch aborts after the timeout', async () => {
  let seenSignal;
  const fetchFn = (url, init) => new Promise((resolve, reject) => {
    seenSignal = init.signal;
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
  const api = makeApi({ base: 'https://api.example/api', fetchFn, timeoutMs: 10 });
  await assert.rejects(api.scoreboard('2026-10-16'), (err) => {
    assert.ok(err instanceof UpstreamError, 'a timeout is an upstream failure');
    assert.equal(err.status, 504);
    assert.equal(err.url, 'https://api.example/api/production?action=scoreboard&date=2026-10-16');
    return true;
  });
  assert.equal(seenSignal.aborted, true);
});
