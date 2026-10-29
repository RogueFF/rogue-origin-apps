// The worker is about to lock the reads of /api/wholesale, /api/complaints and
// /api/consignment behind the shared password. page-gate.js stores the key in
// localStorage 'ro_api_password' but does not add it to reads, so every read on a
// gated page has to carry it itself. These tests RUN the real helpers in a vm with
// a stubbed fetch and localStorage and look at the headers that go out.
//
//   hub/api.js          queue brief, coverage, complaint stats (Ops Hub)
//   consignment/api.js  every apiGet-backed read (Consignment)
//   complaints.html     its inline apiGet / apiPost / getPassword
//
// Floor Manager (hourly-entry) is an OPEN page: its getQueueBrief request must stay
// header-free, so that is pinned here too.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FAKE_KEY = 'test-pw';

/** fetch + localStorage stubs. `key` null means this device never unlocked. */
function makeEnv(key) {
  const calls = [];
  const store = new Map();
  if (key !== null) store.set('ro_api_password', key);
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ success: true, data: [] }),
    };
  };
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  return { calls, store, sandbox: { fetch, localStorage, URL, URLSearchParams, console } };
}

/** Headers of a recorded call as a plain object (copied out of the vm realm). */
const headersOf = (call) => JSON.parse(JSON.stringify(call.init?.headers || {}));
const urlOf = (call) => new URL(call.url);

/**
 * Run an ES module from src/js in a vm: imports are dropped (the sandbox supplies
 * those names) and its exports come back as an object. The repo is "type":
 * "commonjs", so node cannot import these files directly.
 */
function runModule(rel, sandbox) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  const names = [...src.matchAll(/^export (?:const|let|async function|function) (\w+)/gm)].map((m) => m[1]);
  const body = src.replace(/^import [^;]+;$/gm, '').replace(/^export (const|let|async function|function) /gm, '$1 ');
  vm.runInNewContext(`${body}\n;globalThis.__exports = { ${names.join(', ')} };`, sandbox, { filename: rel });
  return sandbox.__exports;
}

/** Slice `function name(...) { ... }` (optionally async) out of inline script text by brace matching. */
function sliceFunction(src, name) {
  const m = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(src);
  assert.ok(m, `function ${name} not found`);
  // Skip the parameter list first: a default like `params = {}` has braces of its own.
  let parens = 0;
  let i0 = src.indexOf('(', m.index);
  for (; i0 < src.length; i0++) {
    if (src[i0] === '(') parens++;
    else if (src[i0] === ')' && --parens === 0) break;
  }
  const open = src.indexOf('{', i0);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(m.index, i + 1);
  }
  throw new Error(`function ${name} is not closed`);
}

// ---------------------------------------------------------------------------
// Ops Hub

function loadHub(key) {
  const env = makeEnv(key);
  const shared = runModule('src/js/shared/api.js', env.sandbox);
  const hub = runModule('src/js/hub/api.js', { ...env.sandbox, apiGet: shared.apiGet, apiPost: shared.apiPost, API_ROOT: shared.API_ROOT });
  return { ...env, hub };
}

const HUB_READS = [
  ['getQueueBrief', 'wholesale', 'getQueueBrief'],
  ['getCoverage', 'wholesale', 'getCoverage'],
  ['getComplaintStats', 'complaints', 'stats'],
];

for (const [fn, endpoint, action] of HUB_READS) {
  test(`hub ${fn}: sends the stored key as a Bearer token`, async () => {
    const { calls, hub } = loadHub(FAKE_KEY);
    await hub[fn]();
    assert.equal(calls.length, 1);
    const u = urlOf(calls[0]);
    assert.ok(u.pathname.endsWith(`/api/${endpoint}`), u.pathname);
    assert.equal(u.searchParams.get('action'), action);
    assert.equal(headersOf(calls[0]).Authorization, `Bearer ${FAKE_KEY}`);
  });

  test(`hub ${fn}: sends no Authorization header when no key is stored`, async () => {
    const { calls, hub } = loadHub(null);
    await hub[fn]();
    assert.equal(calls.length, 1);
    assert.equal('Authorization' in headersOf(calls[0]), false);
  });
}

test('hub getQueueBrief keeps its limit param next to the auth header', async () => {
  const { calls, hub } = loadHub(FAKE_KEY);
  await hub.getQueueBrief();
  assert.equal(urlOf(calls[0]).searchParams.get('limit'), '6');
});

// ---------------------------------------------------------------------------
// Consignment

function loadConsignment(key) {
  const env = makeEnv(key);
  Object.assign(env.sandbox, {
    navigator: { onLine: true },
    window: { addEventListener() {} },
    document: { dispatchEvent() {} },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  });
  return { ...env, api: runModule('src/js/consignment/api.js', env.sandbox) };
}

const CONSIGNMENT_READS = [
  ['getPartners', [], 'getConsignmentPartners'],
  ['getPartnerDetail', [7], 'getConsignmentPartnerDetail'],
  ['getStrains', [], 'getConsignmentStrains'],
  ['getInventory', [7], 'getConsignmentInventory'],
  ['getActivity', [{ limit: 5 }], 'getConsignmentActivity'],
];

for (const [fn, args, action] of CONSIGNMENT_READS) {
  test(`consignment ${fn}: sends the stored key as a Bearer token`, async () => {
    const { calls, api } = loadConsignment(FAKE_KEY);
    await api[fn](...args);
    assert.equal(calls.length, 1);
    const u = urlOf(calls[0]);
    assert.ok(u.pathname.endsWith('/api/consignment'), u.pathname);
    assert.equal(u.searchParams.get('action'), action);
    assert.equal(headersOf(calls[0]).Authorization, `Bearer ${FAKE_KEY}`);
  });

  test(`consignment ${fn}: sends no Authorization header when no key is stored`, async () => {
    const { calls, api } = loadConsignment(null);
    await api[fn](...args);
    assert.equal(calls.length, 1);
    assert.equal('Authorization' in headersOf(calls[0]), false);
  });
}

test('consignment writes still carry the stored key (unchanged)', async () => {
  const { calls, api } = loadConsignment(FAKE_KEY);
  await api.savePartner({ name: 'x' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(headersOf(calls[0]).Authorization, `Bearer ${FAKE_KEY}`);
});

// ---------------------------------------------------------------------------
// Complaints (inline script in the page)

function loadComplaints(key) {
  const html = readFileSync(join(ROOT, 'src', 'pages', 'complaints.html'), 'utf8');
  // The page's main inline script is the one that defines apiGet.
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const main = scripts.find((s) => /function\s+apiGet\s*\(/.test(s));
  assert.ok(main, 'complaints.html: inline script with apiGet not found');
  const apiConst = main.match(/^\s*const API = '[^']+';/m);
  assert.ok(apiConst, 'complaints.html: API constant not found');
  const code = [
    apiConst[0],
    sliceFunction(main, 'getPassword'),
    sliceFunction(main, 'apiGet'),
    sliceFunction(main, 'apiPost'),
    'globalThis.__exports = { getPassword, apiGet, apiPost };',
  ].join('\n');
  const env = makeEnv(key);
  vm.runInNewContext(code, env.sandbox, { filename: 'complaints.html' });
  return { ...env, page: env.sandbox.__exports };
}

for (const [action, params] of [['complaints', {}], ['complaint', { id: 3 }], ['stats', {}], ['recent', {}]]) {
  test(`complaints apiGet(${action}): sends the stored key as a Bearer token`, async () => {
    const { calls, page } = loadComplaints(FAKE_KEY);
    await page.apiGet(action, params);
    assert.equal(calls.length, 1);
    const u = urlOf(calls[0]);
    assert.ok(u.pathname.endsWith('/api/complaints'), u.pathname);
    assert.equal(u.searchParams.get('action'), action);
    assert.equal(headersOf(calls[0]).Authorization, `Bearer ${FAKE_KEY}`);
  });
}

test('complaints apiGet: sends no Authorization header when no key is stored', async () => {
  const { calls, page } = loadComplaints(null);
  await page.apiGet('complaints');
  assert.equal(calls.length, 1);
  assert.equal('Authorization' in headersOf(calls[0]), false);
});

test('complaints apiGet: an empty stored key sends no Authorization header', async () => {
  const { calls, page } = loadComplaints('');
  await page.apiGet('stats');
  assert.equal('Authorization' in headersOf(calls[0]), false);
});

test("complaints getPassword reads 'ro_api_password', not the never-set 'ro-auth-token'", () => {
  const { store, page } = loadComplaints(FAKE_KEY);
  assert.equal(page.getPassword(), FAKE_KEY);
  store.set('ro-auth-token', 'stale');
  assert.equal(page.getPassword(), FAKE_KEY);
  store.delete('ro_api_password');
  assert.equal(page.getPassword(), '', 'a leftover ro-auth-token is not the key');
});

test('complaints apiPost puts the real key in the body password', async () => {
  const { calls, page } = loadComplaints(FAKE_KEY);
  await page.apiPost('saveComplaint', { id: 1 });
  assert.equal(JSON.parse(calls[0].init.body).password, FAKE_KEY);
});

// ---------------------------------------------------------------------------
// Floor Manager stays byte-identical: an open page, no Authorization on its brief read.

test('hourly-entry getQueueBrief request is still header-free', async () => {
  const env = makeEnv(FAKE_KEY);
  const shared = runModule('src/js/shared/api.js', env.sandbox);
  const src = readFileSync(join(ROOT, 'src/js/hourly-entry/index.js'), 'utf8');
  assert.match(src, /const wholesaleApi = makeApi\('wholesale'\);/, 'Floor Manager reads through an unauthenticated wholesale client');
  const wholesaleApi = shared.makeApi('wholesale');
  await wholesaleApi.get('getQueueBrief');
  assert.equal(env.calls.length, 1);
  assert.equal('Authorization' in headersOf(env.calls[0]), false);
  assert.equal(urlOf(env.calls[0]).searchParams.get('action'), 'getQueueBrief');
});
