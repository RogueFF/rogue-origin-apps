// Guard for the shared password gate (src/js/shared/page-gate.js).
//
// Two halves:
//   1. Classification. Every page in src/pages is either gated or open, never
//      both and never neither, so a new page fails here until someone decides.
//   2. The gate's decision logic, run from the real classic script inside a vm
//      sandbox (no document, so it only publishes globalThis.ROGateCore).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = join(ROOT, 'src', 'pages');
const GATE_FILE = join(ROOT, 'src', 'js', 'shared', 'page-gate.js');

// Gated by the shared page-gate.js script.
const GATED = [
  'index.html',               // Ops Hub
  'supersack-entry.html',     // Supersack Tracker
  'supersack-analytics.html',
  'wholesale.html',
  'complaints.html',
  'consignment.html',         // its old login overlay now defers to the gate
];
// Left open to the public on purpose.
const OPEN = [
  'hourly-entry.html',        // Floor Manager
  'scoreboard-v2.html',       // Scoreboard
  'scoreboard-v3.html',       // Scoreboard sibling
  'scale-display.html',
  'tag-desk.html',            // Supply Kanban
  'kanban.html',              // Kanban (old page)
  'sop-manager.html',
];

// Gated pages with no language toggle of their own: the gate tag pins the
// dialog language with data-lang instead of following shared storage.
const FIXED_LANG = { 'index.html': 'en', 'consignment.html': 'en' };

const read = (name) => readFileSync(join(PAGES, name), 'utf8');
const GATE_TAG = /<script\b[^>]*\bsrc=["']\.\.\/js\/shared\/page-gate\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/i;
const ANY_GATE_REF = /page-gate\.js/i;
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

/** Attributes of an opening tag, valueless ones (nomodule, async) included. */
function tagAttrs(tag) {
  const open = tag.match(/^<script\b([^>]*)>/i)[1];
  const attrs = {};
  for (const m of open.matchAll(/([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

test('every page in src/pages is classified exactly once', () => {
  const all = readdirSync(PAGES).filter((f) => f.endsWith('.html')).sort();
  const lists = [...GATED, ...OPEN];
  assert.equal(new Set(lists).size, lists.length, 'a page appears in more than one list');
  const unclassified = all.filter((f) => !lists.includes(f));
  assert.deepEqual(unclassified, [], `unclassified pages (add to GATED or OPEN): ${unclassified.join(', ')}`);
  const missing = lists.filter((f) => !all.includes(f));
  assert.deepEqual(missing, [], `listed pages that do not exist: ${missing.join(', ')}`);
});

for (const name of GATED) {
  test(`${name} loads the gate as the first, synchronous, classic script in <head>`, () => {
    const html = read(name);
    // Comments out: a commented-out tag is no gate at all.
    const head = stripComments(html.slice(0, html.search(/<\/head>/i)));
    const tag = head.match(GATE_TAG);
    assert.ok(tag, `${name}: page-gate.js tag missing from <head> (or commented out)`);
    // Only src (and data-lang where the page pins it). Anything else can stop
    // the script running or delay it: type, nomodule, async, defer, ...
    const attrs = tagAttrs(tag[0]);
    const allowed = FIXED_LANG[name] ? ['src', 'data-lang'] : ['src'];
    const extra = Object.keys(attrs).filter((a) => !allowed.includes(a));
    assert.deepEqual(extra, [], `${name}: gate tag carries attributes that can stop or delay it: ${extra.join(', ')}`);
    assert.equal(attrs['data-lang'], FIXED_LANG[name], `${name}: gate data-lang should be ${FIXED_LANG[name]}`);
    const firstScript = head.search(/<script\b/i);
    assert.equal(firstScript, head.indexOf(tag[0]), `${name}: another <script> runs before the gate`);
    assert.equal((html.match(/page-gate\.js/g) || []).length, 1, `${name}: gate referenced more than once`);
  });
}

for (const name of OPEN) {
  test(`${name} stays open (no gate)`, () => {
    assert.doesNotMatch(read(name), ANY_GATE_REF);
  });
}

// ---------------------------------------------------------------------------
// Decision logic, from the real script.

function loadCore() {
  const sandbox = { URL }; // the browser has URL; a bare vm context does not
  vm.runInNewContext(readFileSync(GATE_FILE, 'utf8'), sandbox, { filename: 'page-gate.js' });
  assert.ok(sandbox.ROGateCore, 'page-gate.js must publish globalThis.ROGateCore');
  return sandbox.ROGateCore;
}

test('API host matches the shared API root', () => {
  const core = loadCore();
  const api = readFileSync(join(ROOT, 'src', 'js', 'shared', 'api.js'), 'utf8');
  const root = api.match(/API_ROOT\s*=\s*'([^']+)'/)[1];
  assert.equal(core.API_ORIGIN, new URL(root).origin);
  assert.equal(core.PASSWORD_KEY, 'ro_api_password');
});

test('isApiUrl holds only requests to the API origin', () => {
  const core = loadCore();
  const base = 'https://rogueff.github.io/rogue-origin-apps/src/pages/index.html';
  assert.equal(core.isApiUrl('https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=scoreboard', base), true);
  assert.equal(core.isApiUrl({ url: 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/pool' }, base), true);
  assert.equal(core.isApiUrl({ href: 'https://rogue-origin-api.roguefamilyfarms.workers.dev/salida' }, base), true);
  assert.equal(core.isApiUrl('https://rogue-origin-api.roguefamilyfarms.workers.dev.evil.example/api', base), false);
  assert.equal(core.isApiUrl('../js/hub/main.js', base), false);
  assert.equal(core.isApiUrl('https://cdn.jsdelivr.net/npm/chart.js', base), false);
  assert.equal(core.isApiUrl(undefined, base), false);
  assert.equal(core.isApiUrl('http://[bad', base), false);
});

test('classifyValidation: success, explicit rejection, everything else is an error', () => {
  const { classifyValidation: c } = loadCore();
  assert.equal(c({ ok: true, status: 200, body: { success: true, data: { success: true } } }), 'ok');
  assert.equal(c({ ok: true, status: 200, body: { success: true } }), 'ok');
  assert.equal(c({ ok: true, status: 200, body: { data: { success: false } } }), 'rejected');
  assert.equal(c({ ok: true, status: 200, body: { success: false } }), 'rejected');
  assert.equal(c({ ok: false, status: 401, body: { success: false, error: 'Invalid password' } }), 'rejected');
  assert.equal(c({ ok: false, status: 401, body: null }), 'rejected');
  assert.equal(c({ ok: false, status: 500, body: { success: false } }), 'error');
  assert.equal(c({ ok: false, status: 503, body: null }), 'error');
  // sw.js answers a failed POST with 408 { success:false } while offline: not a rejection.
  assert.equal(c({ ok: false, status: 408, body: { success: false, error: 'Network timeout' } }), 'error');
  assert.equal(c({ ok: true, status: 200, body: null }), 'error');
  assert.equal(c({ ok: true, status: 200, body: {} }), 'error');
});

test('classifyValidation: only a boolean true unlocks; a non-true success answer is a rejection', () => {
  const core = loadCore();
  const c = core.classifyValidation;
  for (const body of [
    { success: 'false' },          // truthy string
    { success: 'true' },
    { success: 1 },
    { data: { success: 'false' } },
    { data: { success: 'true' } },
    { success: true, data: { success: 'true' } },
  ]) {
    const got = c({ ok: true, status: 200, body });
    assert.equal(got, 'rejected', `${JSON.stringify(body)} -> ${got}`);
    // Neither path may open the page on such an answer.
    assert.notEqual(core.afterStoredCheck(got), 'reveal', `stored key revealed on ${JSON.stringify(body)}`);
    assert.ok(!['reveal', 'store-and-reload'].includes(core.afterTyped(got, true)), `typed unlocked on ${JSON.stringify(body)}`);
  }
});

test('load decisions: no key prompts, a key is validated, only a rejection clears it', () => {
  const core = loadCore();
  assert.equal(core.decideLoad(''), 'prompt');
  assert.equal(core.decideLoad(null), 'prompt');
  assert.equal(core.decideLoad('secret'), 'validate');
  assert.equal(core.afterStoredCheck('ok'), 'reveal');
  assert.equal(core.afterStoredCheck('error'), 'reveal');        // offline / timeout / 5xx
  assert.equal(core.afterStoredCheck('rejected'), 'forget-and-prompt');
});

test('typed password decisions', () => {
  const core = loadCore();
  assert.equal(core.afterTyped('ok', true), 'store-and-reload');
  assert.equal(core.afterTyped('ok', false), 'reveal');          // storage blocked: unlock this load only
  assert.equal(core.afterTyped('rejected', true), 'wrong');
  assert.equal(core.afterTyped('error', true), 'offline');
});

test('pickLang follows i18n storage, falls back to both when storage throws', () => {
  const { pickLang } = loadCore();
  const from = (obj) => (k) => (k in obj ? obj[k] : null);
  assert.equal(pickLang(from({ 'ro-lang': 'es' })), 'es');
  assert.equal(pickLang(from({ 'ro-lang': 'en' })), 'en');
  assert.equal(pickLang(from({ 'supersack-lang': 'es' })), 'es');   // legacy key i18n still migrates
  assert.equal(pickLang(from({ 'ro-lang': 'xx', kanbanLang: 'es' })), 'es');
  assert.equal(pickLang(from({})), 'en');                           // i18n's own default
  assert.equal(pickLang(() => { throw new Error('SecurityError'); }), 'both');
});

test('pickLang: a page that pins its language (data-lang) ignores storage', () => {
  const { pickLang } = loadCore();
  const from = (obj) => (k) => (k in obj ? obj[k] : null);
  assert.equal(pickLang(from({ 'ro-lang': 'es' }), 'en'), 'en');   // English-only Hub, es set elsewhere
  assert.equal(pickLang(from({ 'ro-lang': 'en' }), 'es'), 'es');
  assert.equal(pickLang(() => { throw new Error('SecurityError'); }, 'en'), 'en');
  assert.equal(pickLang(from({ 'ro-lang': 'es' }), 'xx'), 'es');   // junk pin: follow storage
  assert.equal(pickLang(from({ 'ro-lang': 'es' }), null), 'es');
});

// ---------------------------------------------------------------------------
// Browser half, from the real script, in a vm with a stub window/document/fetch.

const API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev';
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

function fakeEl(tag, registry) {
  const el = {
    tagName: String(tag).toUpperCase(), id: '', className: '', type: '', title: '', hidden: false,
    textContent: '', innerHTML: '', value: '', disabled: false, parentNode: null, removed: false,
    isConnected: true, focused: false,
    children: [], attrs: {}, sub: {}, listeners: {},
    classList: {
      set: new Set(),
      add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); },
    },
    get firstChild() { return this.children[0] || null; },
    get nextSibling() { const p = this.parentNode; return p ? p.children[p.children.indexOf(this) + 1] || null : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, focus() { this.focused = true; },
    querySelector(sel) { return (this.sub[sel] ||= fakeEl(sel, registry)); },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    insertBefore(c, ref) {
      c.parentNode = this;
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
      return c;
    },
    remove() { this.removed = true; },
  };
  registry.push(el);
  return el;
}

/** Boot page-gate.js in a sandbox. The validate call stays pending until the test answers it. */
function bootGate({ stored = '', storage = {}, dataLang = null, slots = {} } = {}) {
  const created = [];
  const store = { ...storage };
  if (stored) store.ro_api_password = stored;
  const calls = [];
  const requests = []; // { url, method, auth } for every call that reached the network
  const validates = [];
  const timers = [];
  const events = []; // everything dispatched on the document
  const script = fakeEl('script', []);
  if (dataLang) script.setAttribute('data-lang', dataLang);
  const document = {
    readyState: 'complete',
    activeElement: null,
    currentScript: script,
    documentElement: fakeEl('html', []),
    head: fakeEl('head', []),
    body: fakeEl('body', []),
    createElement: (t) => fakeEl(t, created),
    getElementById: (id) => created.find((e) => e.id === id && e.parentNode && !e.removed) || slots[`#${id}`] || null,
    querySelector: (sel) => slots[sel] || null,
    addEventListener() {},
    dispatchEvent(e) { e.callsSoFar = calls.slice(); events.push(e); return true; },
  };
  const response = (url) => ({ ok: true, status: 200, url, json: async () => ({ url }), clone: () => response(url) });
  const stubFetch = (input, init) => {
    const url = String((input && input.url) || input);
    calls.push(url);
    // What the server would see: init.headers wins over a Request's own headers.
    const sent = init && init.headers !== undefined ? new Headers(init.headers)
      : input instanceof Request ? input.headers : new Headers();
    const method = String((init && init.method) || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    requests.push({ url, method, auth: sent.get('authorization'), type: sent.get('content-type') });
    if (url.includes('action=validatePassword')) {
      // Honours init.signal like the real fetch: an aborted check rejects at once.
      return new Promise((resolve, reject) => {
        let password;
        try { password = JSON.parse(init.body).password; } catch { password = undefined; }
        const entry = { resolve, reject, password, signal: init && init.signal };
        if (entry.signal) entry.signal.addEventListener('abort', () => reject(new Error('AbortError')));
        validates.push(entry);
      });
    }
    return Promise.resolve(response(url));
  };
  const winListeners = {};
  const sandbox = {
    URL, AbortController, Headers, Request, document,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    location: { href: 'https://rogueff.github.io/rogue-origin-apps/src/pages/index.html', reload() { sandbox.reloaded = true; } },
    MutationObserver: class { observe() {} disconnect() {} },
    CustomEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    // Fake timers: nothing fires unless a test runs it, nothing keeps node alive.
    setTimeout: (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; },
    addEventListener(type, fn) { (winListeners[type] ||= []).push(fn); },
    fetch: stubFetch,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(readFileSync(GATE_FILE, 'utf8'), sandbox, { filename: 'page-gate.js' });
  const answer = (body, { ok = true, status = 200 } = {}) =>
    validates.shift().resolve({ ok, status, json: async () => body });
  const lockButton = () => created.find((e) => e.id === 'ro-gate-lock' && e.parentNode && !e.removed) || null;
  const gate = () => created.find((e) => e.id === 'ro-gate' && !e.removed) || null;
  /** Another tab changed localStorage: update the shared store, then fire the storage event here. */
  const otherTab = (key, value) => {
    if (value == null) delete store[key]; else store[key] = value;
    for (const fn of winListeners.storage || []) fn({ key });
  };
  const gated = () => document.documentElement.classList.contains('ro-gated');
  const authEvents = () => events.filter((e) => e.type === 'ro:authchange').map((e) => e.detail.unlocked);
  return {
    sandbox, document, stubFetch, calls, requests, timers, events, answer, lockButton, gate, store, validates,
    otherTab, gated, authEvents,
  };
}

/** Boot with a stored key the server accepts, so the page is open. */
async function bootOpen(opts = {}) {
  const g = bootGate({ stored: 'k', ...opts });
  g.answer({ success: true });
  await flush();
  assert.equal(g.sandbox.ROGate.isUnlocked(), true, 'precondition: page open');
  return g;
}

/**
 * Run an ES module from src/js in a vm: imports are dropped (the sandbox
 * supplies those names) and its exports come back as an object. The repo is
 * "type": "commonjs", so node cannot import these files directly.
 */
function runModule(rel, sandbox) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  const names = [...src.matchAll(/^export (?:const|let|async function|function) (\w+)/gm)].map((m) => m[1]);
  const body = src.replace(/^import [^;]+;$/gm, '').replace(/^export (const|let|async function|function) /gm, '$1 ');
  vm.runInNewContext(`${body}\n;globalThis.__exports = { ${names.join(', ')} };`, sandbox, { filename: rel });
  return sandbox.__exports;
}

/** Type a password into the gate form and fire its real submit handler; resolves when it finishes. */
async function submitPassword(g, password) {
  const form = g.gate().querySelector('form');
  assert.equal((form.listeners.submit || []).length, 1, 'the gate form must have exactly one submit handler');
  g.gate().querySelector('input').value = password; // onSubmit reads the input from the gate root
  let prevented = false;
  const done = form.listeners.submit[0]({ preventDefault() { prevented = true; } });
  await flush(); // the handler is now waiting on the validate call
  return { done, prevented: () => prevented };
}

test('browser: window.fetch is replaced and API calls wait for unlock', async () => {
  const g = bootGate({ stored: 'k' });
  assert.notEqual(g.sandbox.window.fetch, g.stubFetch, 'page-gate.js must replace window.fetch');
  assert.ok(g.document.documentElement.classList.contains('ro-gated'), 'page hidden while locked');

  let apiSettled = false;
  g.sandbox.window.fetch(`${API}/api/pool?action=list`).then(() => { apiSettled = true; });
  g.sandbox.window.fetch(new URL(`${API}/api/production`));
  g.sandbox.window.fetch('https://cdn.jsdelivr.net/npm/chart.js');
  await flush();
  assert.deepEqual(g.calls.filter((u) => !u.includes('validatePassword')), ['https://cdn.jsdelivr.net/npm/chart.js'],
    'only non-API requests go out before unlock');
  assert.equal(apiSettled, false, 'API call must stay pending until unlock');

  g.answer({ success: true });
  await flush();
  assert.equal(g.document.documentElement.classList.contains('ro-gated'), false, 'page revealed');
  assert.ok(g.calls.includes(`${API}/api/pool?action=list`), 'held API call released');
  assert.ok(g.calls.includes(`${API}/api/production`), 'held URL-object call released');
  assert.equal(apiSettled, true);
});

test('browser: a stored key the server rejects (success:"false") is forgotten and the page stays locked', async () => {
  const g = bootGate({ stored: 'k' });
  let apiSettled = false;
  g.sandbox.window.fetch(`${API}/api/pool`).then(() => { apiSettled = true; });
  g.answer({ success: 'false' });
  await flush();
  assert.ok(g.document.documentElement.classList.contains('ro-gated'), 'page must stay hidden');
  assert.equal(g.store.ro_api_password, undefined, 'rejected key is forgotten');
  assert.equal(apiSettled, false);
  assert.ok(!g.calls.includes(`${API}/api/pool`));
});

test('browser: the English-only Hub (data-lang="en") stays English when storage says es', async () => {
  const locked = bootGate({ dataLang: 'en', storage: { 'ro-lang': 'es' } });
  assert.equal(locked.gate().querySelector('h1').textContent, 'Locked');
  assert.equal(locked.gate().querySelector('button').textContent, 'Unlock');

  const open = bootGate({ stored: 'k', dataLang: 'en', storage: { 'ro-lang': 'es' } });
  open.answer({ success: true });
  await flush();
  const b = open.lockButton();
  assert.ok(b, 'lock control mounted after unlock');
  assert.equal(b.getAttribute('aria-label'), 'Lock this device (forget the password)');

  // A page with its own toggle (no data-lang) still follows storage.
  const es = bootGate({ storage: { 'ro-lang': 'es' } });
  assert.equal(es.gate().querySelector('h1').textContent, 'Bloqueado');
});

test('browser: the cover says "Checking…" only once the stored-key check runs long', async () => {
  const g = bootGate({ stored: 'k', storage: { 'ro-lang': 'es' } });
  const wait = g.gate().querySelector('.ro-gate-wait');
  assert.equal(wait.textContent, '', 'no text at first: a quick check should not flash');
  const hint = g.timers.find((t) => t.ms >= 300 && t.ms <= 600 && !t.cleared);
  assert.ok(hint, 'a ~400 ms hint timer is armed during the stored-key check');
  hint.fn();
  assert.equal(wait.hidden, false);
  assert.equal(wait.textContent, 'Comprobando…');
  g.answer({ success: true });
  await flush();
  assert.equal(hint.cleared || g.gate() === null, true);
});

test('browser: the lock control mounts in the page\'s own slot when it has one', async () => {
  for (const [sel, cls] of [['.rail-foot', 'ro-lock-rail'], ['.sidebar-footer', 'ro-lock-side']]) {
    const slot = fakeEl('div', []);
    const g = bootGate({ stored: 'k', slots: { [sel]: slot } });
    g.answer({ success: true });
    await flush();
    const b = g.lockButton();
    assert.equal(b.parentNode, slot, `${sel}: lock inside the slot`);
    assert.equal(b.className, cls);
  }
  // Supersack pages: the last item of the page's main column (their headers
  // have no room at phone widths).
  const main = fakeEl('div', []);
  main.appendChild(fakeEl('div', []));
  const g = bootGate({ stored: 'k', slots: { 'body > .main': main } });
  g.answer({ success: true });
  await flush();
  const b = g.lockButton();
  assert.equal(b.parentNode, main);
  assert.equal(main.children.indexOf(b), main.children.length - 1, 'last in the main column');
  assert.equal(b.className, 'ro-lock-end');
  // Nowhere to go: a small floating icon.
  const bare = bootGate({ stored: 'k' });
  bare.answer({ success: true });
  await flush();
  assert.equal(bare.lockButton().className, 'ro-lock-float');
});

test('browser: an API request is held whatever the case of its host', async () => {
  const g = bootGate({ stored: 'k' });
  const upper = 'https://ROGUE-ORIGIN-API.roguefamilyfarms.workers.dev/api/x';
  let settled = false;
  g.sandbox.window.fetch(upper).then(() => { settled = true; });
  await flush();
  assert.ok(!g.calls.includes(upper), 'uppercase-host API call must not go out before unlock');
  assert.equal(settled, false, 'uppercase-host API call must stay pending');
  assert.equal(g.sandbox.ROGateCore.isApiUrl(upper, g.sandbox.location.href), true);

  g.answer({ success: true });
  await flush();
  assert.ok(g.calls.includes(upper), 'held call released on unlock');
  assert.equal(settled, true);
});

test('browser: a typed password the server rejects is not stored, the field is cleared and the page stays gated', async () => {
  const g = bootGate(); // no stored key: the dialog is showing
  const input = g.gate().querySelector('input');
  const { done, prevented } = await submitPassword(g, 'wrong-one');
  assert.ok(g.calls.some((u) => u.includes('action=validatePassword')), 'the password was sent to the server');
  g.answer({ success: false });
  await done;
  await flush();
  assert.equal(prevented(), true, 'submit default prevented');
  assert.equal(g.store.ro_api_password, undefined, 'a rejected password must not be stored');
  assert.equal(input.value, '', 'field cleared so a retype cannot append');
  assert.equal(g.gate().querySelector('.ro-gate-error').textContent, 'Wrong password');
  assert.ok(g.document.documentElement.classList.contains('ro-gated'), 'page stays hidden');
  assert.equal(g.sandbox.ROGate.isUnlocked(), false);
  assert.notEqual(g.sandbox.reloaded, true, 'no reload on a wrong password');
});

test('browser: a typed password the server accepts is stored and the page reloads', async () => {
  const g = bootGate();
  const { done } = await submitPassword(g, 'right-one');
  assert.equal(g.store.ro_api_password, undefined, 'nothing stored while the check is still running');
  g.answer({ success: true });
  await done;
  await flush();
  assert.equal(g.store.ro_api_password, 'right-one', 'accepted password stored');
  assert.equal(g.sandbox.reloaded, true, 'reload requested so every script starts with the key');
});

test('browser: lock() forgets the password, announces ro:authchange and reloads', async () => {
  const g = bootGate({ stored: 'k' });
  g.answer({ success: true });
  await flush();
  assert.equal(g.sandbox.ROGate.isUnlocked(), true);
  assert.equal(g.store.ro_api_password, 'k');
  assert.notEqual(g.sandbox.reloaded, true);
  assert.equal(g.events.length, 0);

  g.sandbox.window.ROGate.lock();
  assert.equal(g.store.ro_api_password, undefined, 'key removed');
  const ev = g.events.filter((e) => e.type === 'ro:authchange');
  assert.equal(ev.length, 1, 'ro:authchange dispatched once');
  assert.equal(ev[0].bubbles, true);
  assert.equal(ev[0].detail.unlocked, false);
  assert.equal(g.sandbox.reloaded, true, 'reload requested');
});

// ---------------------------------------------------------------------------
// Re-gating in place. Losing the key must never reload an open page: that
// throws away typed weights, half-written complaints and open editors. The
// cover comes back over the page as it stands, API calls are held again, and
// unlocking from that cover reveals the same page without a reload.

test('decisions: an in-place unlock reveals, a late rejection re-gates, anything else late keeps the page', () => {
  const core = loadCore();
  assert.equal(core.afterTyped('ok', true, true), 'reveal');
  assert.equal(core.afterTyped('ok', false, true), 'reveal');
  assert.equal(core.afterTyped('ok', true, false), 'store-and-reload');
  assert.equal(core.afterTyped('rejected', true, true), 'wrong');
  assert.equal(core.afterStoredCheck('slow'), 'reveal');
  assert.equal(core.afterLateCheck('rejected'), 'forget-and-relock');
  assert.equal(core.afterLateCheck('ok'), 'keep');
  assert.equal(core.afterLateCheck('error'), 'keep');
});

test('browser: another tab removing the key re-gates this tab in place (no reload), and unlocking reveals it in place', async () => {
  const g = await bootOpen();
  const work = g.document.body.appendChild(fakeEl('input', []));
  work.value = '12.5'; // a weight typed into the page

  g.otherTab('ro_api_password', null);
  assert.notEqual(g.sandbox.reloaded, true, 'key removed elsewhere must not reload this tab');
  assert.equal(g.gated(), true, 'cover back over the page');
  assert.equal(g.sandbox.ROGate.isUnlocked(), false);
  assert.ok(g.gate(), 'gate cover mounted again');
  assert.equal(g.gate().querySelector('form').hidden, false, 'password form showing');
  assert.deepEqual(g.authEvents(), [false], 'ro:authchange {unlocked:false} announced');
  assert.equal(work.removed, false, 'page DOM kept');
  assert.equal(work.value, '12.5', 'typed input kept');

  const url = `${API}/api/pool?action=afterRelock`;
  let settled = false;
  g.sandbox.window.fetch(url).then(() => { settled = true; });
  await flush();
  assert.ok(!g.calls.includes(url), 'API hold re-engaged for new requests');
  assert.equal(settled, false);

  const { done } = await submitPassword(g, 'again');
  g.answer({ success: true });
  await done;
  await flush();
  assert.notEqual(g.sandbox.reloaded, true, 'unlocking the in-place cover reveals without a reload');
  assert.equal(g.gated(), false, 'page revealed');
  assert.equal(g.sandbox.ROGate.isUnlocked(), true);
  assert.equal(g.store.ro_api_password, 'again', 'new key stored');
  assert.deepEqual(g.authEvents(), [false, true], 'ro:authchange {unlocked:true} announced for the Hub cost lock');
  assert.ok(g.calls.includes(url), 'request held during the re-lock released');
  assert.equal(settled, true);
  assert.equal(work.value, '12.5', 'typed input still there after re-unlock');
});

test('browser: ro:authchange {unlocked:true} fires only after the requests held during the re-lock went out', async () => {
  // The Hub refetches its dashboard on this event. The held calls go out first
  // (with the key put in as they leave), so the page hears unlocked:true only
  // once everything it asked for while gated is on its way.
  const g = await bootOpen();
  g.otherTab('ro_api_password', null);
  const stale = `${API}/api/production?action=dashboard&stale=1`;
  g.sandbox.window.fetch(stale);
  const { done } = await submitPassword(g, 'again');
  g.answer({ success: true });
  await done;
  await flush();
  const ev = g.events.filter((e) => e.type === 'ro:authchange' && e.detail.unlocked === true);
  assert.equal(ev.length, 1);
  assert.ok(ev[0].callsSoFar.includes(stale), 'held request was already sent when the page heard unlocked:true');
});

test('browser: storage.clear() in another tab (key null) also re-gates in place', async () => {
  const g = await bootOpen();
  delete g.store.ro_api_password;
  g.otherTab(null, null);
  assert.equal(g.gated(), true);
  assert.notEqual(g.sandbox.reloaded, true);
});

test('browser: ROGate.relock() forgets the key and re-gates in place without a reload', async () => {
  const g = await bootOpen();
  assert.equal(typeof g.sandbox.ROGate.relock, 'function', 'ROGate.relock exists');
  g.sandbox.ROGate.relock();
  assert.equal(g.store.ro_api_password, undefined, 'key forgotten');
  assert.equal(g.gated(), true, 're-gated');
  assert.equal(g.sandbox.ROGate.isUnlocked(), false);
  assert.notEqual(g.sandbox.reloaded, true, 'no reload');
  assert.deepEqual(g.authEvents(), [false]);
});

test('browser: a key added in another tab while this tab is gated reveals in place once it validates', async () => {
  // Fresh tab sitting on the dialog.
  const g = bootGate();
  g.otherTab('ro_api_password', 'fresh');
  assert.notEqual(g.sandbox.reloaded, true, 'no reload on a key added elsewhere');
  assert.equal(g.gated(), true, 'still gated until the key validates');
  assert.equal(g.validates.length, 1, 'the new key is checked');
  g.answer({ success: true });
  await flush();
  assert.equal(g.gated(), false, 'revealed in place');
  assert.notEqual(g.sandbox.reloaded, true);
  assert.deepEqual(g.authEvents(), [true]);

  // A tab re-gated in place, then unlocked elsewhere: held calls go out.
  const h = await bootOpen();
  h.otherTab('ro_api_password', null);
  const url = `${API}/api/pool?action=held`;
  h.sandbox.window.fetch(url);
  h.otherTab('ro_api_password', 'k2');
  h.answer({ success: true });
  await flush();
  assert.equal(h.gated(), false);
  assert.notEqual(h.sandbox.reloaded, true);
  assert.ok(h.calls.includes(url), 'held request released');
  assert.deepEqual(h.authEvents(), [false, true]);

  // A key that does not validate leaves the tab gated, still without a reload.
  const r = bootGate();
  r.otherTab('ro_api_password', 'bad');
  r.answer({ success: false }, { ok: false, status: 401 });
  await flush();
  assert.equal(r.gated(), true);
  assert.notEqual(r.sandbox.reloaded, true);
});

test('hub/auth.js forget() re-gates the Hub in place through the gate (no reload)', async () => {
  const g = await bootOpen({ dataLang: 'en' });
  const { forget } = runModule('src/js/hub/auth.js', g.sandbox);
  forget();
  assert.equal(g.store.ro_api_password, undefined, 'key forgotten');
  assert.equal(g.gated(), true, 'Hub re-gated');
  assert.notEqual(g.sandbox.reloaded, true, 'a chat 401 must not reload the Hub');
  assert.deepEqual(g.authEvents(), [false], 'announced once, by the gate');

  // Without the gate it clears and announces, as before.
  const store = { ro_api_password: 'k' };
  const events = [];
  const bare = runModule('src/js/hub/auth.js', {
    window: {},
    localStorage: { getItem: (k) => store[k] ?? null, removeItem: (k) => { delete store[k]; } },
    document: { dispatchEvent: (e) => events.push(e) },
    CustomEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
  });
  bare.forget();
  assert.equal(store.ro_api_password, undefined);
  assert.deepEqual(events.map((e) => [e.type, e.detail.unlocked]), [['ro:authchange', false]]);
});

test('wholesale/auth.js forgetPassword() re-gates its own tab when the gate is present', async () => {
  const g = await bootOpen();
  const { forgetPassword } = runModule('src/js/wholesale/auth.js', g.sandbox);
  forgetPassword();
  assert.equal(g.store.ro_api_password, undefined, 'key forgotten');
  assert.equal(g.gated(), true, 'Clear password re-gates this tab');
  assert.notEqual(g.sandbox.reloaded, true, 'in place, no reload');

  // Without the gate: a plain removal, as before.
  const store = { ro_api_password: 'k' };
  const bare = runModule('src/js/wholesale/auth.js', {
    window: {},
    localStorage: { getItem: (k) => store[k] ?? null, removeItem: (k) => { delete store[k]; } },
  });
  bare.forgetPassword();
  assert.equal(store.ro_api_password, undefined);
});

test('browser: a stored check slower than 3 s reveals, keeps listening, and a late rejection re-gates in place', async () => {
  const g = bootGate({ stored: 'k' });
  const slow = g.timers.find((t) => t.ms === 3000 && !t.cleared);
  assert.ok(slow, 'a 3 s timer is armed for the stored check');
  slow.fn();
  await flush();
  assert.equal(g.gated(), false, 'no answer in 3 s: the page opens (barn on bad wifi)');
  assert.equal(g.validates.length, 1, 'the validate call is still outstanding');
  assert.equal(Boolean(g.validates[0].signal && g.validates[0].signal.aborted), false, 'not aborted at 3 s');
  assert.ok(g.timers.some((t) => t.ms >= 30000 && !t.cleared), 'a generous ceiling (>= 30 s) still bounds it');

  g.answer({ success: false, error: 'Invalid password' }, { ok: false, status: 401 });
  await flush();
  assert.equal(g.store.ro_api_password, undefined, 'late rejection forgets the key');
  assert.equal(g.gated(), true, 'late rejection re-gates the page');
  assert.notEqual(g.sandbox.reloaded, true, 'in place, no reload');
  assert.deepEqual(g.authEvents(), [false]);
});

test('browser: after a slow reveal, a late success, 5xx or network error keeps the page open', async () => {
  for (const [body, init] of [[{ success: true }, {}], [{ success: false }, { ok: false, status: 503 }]]) {
    const g = bootGate({ stored: 'k' });
    g.timers.find((t) => t.ms === 3000).fn();
    await flush();
    g.answer(body, init);
    await flush();
    assert.equal(g.gated(), false, `late ${init.status || 200} keeps the page open`);
    assert.equal(g.store.ro_api_password, 'k', 'key kept');
  }
  // Network failure after the slow reveal.
  const n = bootGate({ stored: 'k' });
  n.timers.find((t) => t.ms === 3000).fn();
  await flush();
  n.validates.shift().reject(new TypeError('Failed to fetch'));
  await flush();
  assert.equal(n.gated(), false);
  assert.equal(n.store.ro_api_password, 'k');
});

test('browser: a late rejection of a key that has since changed does not forget the new one', async () => {
  const g = bootGate({ stored: 'k' });
  g.timers.find((t) => t.ms === 3000).fn();
  await flush();
  g.otherTab('ro_api_password', 'k2'); // rotated in another tab while we waited
  g.answer({ success: false }, { ok: false, status: 401 });
  await flush();
  assert.equal(g.store.ro_api_password, 'k2', 'the newer key survives');
  assert.equal(g.gated(), false);
});

test('browser: identical GETs held while gated go out once and each caller gets a response', async () => {
  const g = bootGate({ stored: 'k' });
  const url = `${API}/api/production?action=dashboard`;
  const gets = [1, 2, 3].map(() => g.sandbox.window.fetch(url, { headers: { Authorization: 'Bearer k' } }));
  const other = g.sandbox.window.fetch(url, { headers: { Authorization: 'Bearer other' } });
  const posts = [1, 2].map(() => g.sandbox.window.fetch(`${API}/api/orders?action=save`, { method: 'POST', body: '{}' }));
  g.answer({ success: true });
  await flush();
  assert.equal(g.calls.filter((u) => u === url).length, 2, 'three identical GETs coalesced into one; different headers kept apart');
  const res = await Promise.all([...gets, other]);
  for (const r of res) assert.equal(r.url, url, 'every caller resolves with a response');
  await Promise.all(posts);
  assert.equal(g.calls.filter((u) => u.includes('action=save')).length, 2, 'POSTs are never merged');
});

test('consignment.html: its old login overlay defers to the gate and never asks a second time', () => {
  const script = read('consignment.html').match(/<!-- Auth Script -->\s*<script>([\s\S]*?)<\/script>/);
  assert.ok(script, 'auth script found');
  const cls = (...init) => { const s = new Set(init); return { has: (c) => s.has(c), add: (c) => s.add(c), remove: (c) => s.delete(c) }; };
  const run = (withGate) => {
    const els = {};
    const el = (id) => (els[id] ||= { id, focused: false, classList: cls(), focus() { this.focused = true; }, addEventListener() {} });
    const body = { classList: cls('auth-required') };
    const sandbox = {
      localStorage: { getItem: () => null, setItem() {} },
      document: { body, getElementById: el },
      window: withGate ? { ROGate: { isUnlocked: () => false, ready: new Promise(() => {}) } } : {},
    };
    vm.runInNewContext(script[1], sandbox);
    return { body, overlay: el('auth-overlay'), input: el('password-input') };
  };
  const gated = run(true);
  assert.equal(gated.body.classList.has('auth-required'), false, 'page content not held back by the old overlay');
  assert.equal(gated.overlay.classList.has('hidden'), true, 'old overlay out of the way: the gate asks instead');
  assert.equal(gated.input.focused, false, 'old password field not focused');
  // Without the gate (its script failed to load), the old overlay still stands.
  const bare = run(false);
  assert.equal(bare.overlay.classList.has('hidden'), false);
  assert.equal(bare.body.classList.has('auth-required'), true);
});

// ---------------------------------------------------------------------------
// What a held request carries, and keys that change under a check.

/** Unlock a re-gated page by typing a password the server accepts. */
async function typeUnlock(g, password) {
  const { done } = await submitPassword(g, password);
  g.answer({ success: true });
  await done;
  await flush();
}

test('browser: requests held during an in-place re-gate go out with the key that unlocked the page', async () => {
  // The key was gone when these were built, so a keyless dashboard GET or a
  // write with "Bearer " (empty) would otherwise reach the API without it.
  const g = await bootOpen();
  g.sandbox.ROGate.relock();
  const f = g.sandbox.window.fetch;
  const get = `${API}/api/production?action=dashboard`;
  const post = `${API}/api/consignment?action=savePartner`;
  const mine = `${API}/api/pool?action=mine`;
  const req = `${API}/api/complaints?action=save`;
  f(get);
  f(post, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' }, body: '{}' });
  f(mine, { headers: { Authorization: 'Bearer caller' } });
  f(new Request(req, { method: 'POST', headers: { authorization: 'Bearer   ', 'Content-Type': 'text/plain' }, body: '{}' }));
  await flush();
  assert.ok(![get, post, mine, req].some((u) => g.calls.includes(u)), 'all four held while gated');

  await typeUnlock(g, 'again');
  const sent = (u) => g.requests.filter((r) => r.url === u).map((r) => [r.method, r.auth, r.type]);
  assert.deepEqual(sent(get), [['GET', 'Bearer again', null]], 'held keyless GET carries the key');
  assert.deepEqual(sent(post), [['POST', 'Bearer again', 'application/json']], 'held "Bearer " POST carries the key, other headers kept');
  assert.deepEqual(sent(mine), [['GET', 'Bearer caller', null]], 'a key the caller set is never overwritten');
  assert.deepEqual(sent(req), [['POST', 'Bearer again', 'text/plain']], 'a held Request is rebuilt with the key');
});

test('browser: on a first load with a stored key, held requests go out exactly as the page built them', async () => {
  // Built while the key was on file: a request with no Authorization is a
  // public read on purpose (adding a key would cost a CORS preflight per URL),
  // and one built with the key keeps it.
  const g = bootGate({ stored: 'k' });
  const pub = `${API}/api/production?action=scoreboard`;
  const keyed = `${API}/api/production?action=dashboard`;
  g.sandbox.window.fetch(pub);
  g.sandbox.window.fetch(keyed, { headers: { Authorization: 'Bearer k' } });
  await flush();
  assert.ok(![pub, keyed].some((u) => g.calls.includes(u)), 'both held while the stored key is checked');
  g.answer({ success: true });
  await flush();
  assert.equal(g.gated(), false);
  assert.deepEqual(g.requests.filter((r) => r.url === pub).map((r) => r.auth), [null], 'public read stays keyless');
  assert.deepEqual(g.requests.filter((r) => r.url === keyed).map((r) => r.auth), ['Bearer k'], 'keyed request keeps its key');

  // Storage that throws when the request is built: the page could not read a
  // key either, so the request counts as built keyless and gets the key.
  const h = bootGate({ stored: 'k' });
  const getItem = h.sandbox.localStorage.getItem;
  h.sandbox.localStorage.getItem = () => { throw new Error('SecurityError'); };
  h.sandbox.window.fetch(pub);
  h.sandbox.localStorage.getItem = getItem;
  h.answer({ success: true });
  await flush();
  assert.deepEqual(h.requests.filter((r) => r.url === pub).map((r) => r.auth), ['Bearer k'], 'blocked storage counts as keyless');
});

test('browser: held GETs that differ only by a missing or empty key coalesce once the key is in', async () => {
  const g = await bootOpen();
  g.sandbox.ROGate.relock();
  const f = g.sandbox.window.fetch;
  const url = `${API}/api/production?action=dashboard`;
  const all = [
    f(url),
    f(url, { headers: { Authorization: 'Bearer ' } }),
    f(url, { headers: { authorization: '' } }),
    f(url, { headers: { Authorization: 'Bearer again' } }),
    f(url, { headers: { Authorization: 'Bearer other' } }),
  ];
  await typeUnlock(g, 'again');
  assert.deepEqual(g.requests.filter((r) => r.url === url).map((r) => r.auth).sort(), ['Bearer again', 'Bearer other'],
    'four become one keyed GET; a different caller key stays apart');
  for (const r of await Promise.all(all)) assert.equal(r.url, url, 'every caller resolves');
});

test('browser: a key added in another tab reveals a fresh tab and its held keyless calls carry that key', async () => {
  const g = bootGate();
  const url = `${API}/api/pool?action=list`;
  g.sandbox.window.fetch(url);
  g.otherTab('ro_api_password', 'fresh');
  g.answer({ success: true });
  await flush();
  assert.equal(g.gated(), false);
  assert.deepEqual(g.requests.filter((r) => r.url === url).map((r) => r.auth), ['Bearer fresh']);
});

test('browser: a key removed by another tab during the stored-key check prompts instead of revealing', async () => {
  for (const finish of ['ok', 'error', 'slow']) {
    const g = bootGate({ stored: 'k' });
    const url = `${API}/api/pool?action=list`;
    g.sandbox.window.fetch(url);
    g.otherTab('ro_api_password', null); // another tab locks during the check
    if (finish === 'ok') g.answer({ success: true });
    else if (finish === 'error') g.answer({ success: false }, { ok: false, status: 503 });
    else g.timers.find((t) => t.ms === 3000 && !t.cleared).fn();
    await flush();
    assert.equal(g.gated(), true, `${finish}: page stays covered`);
    assert.equal(g.sandbox.ROGate.isUnlocked(), false, `${finish}: not unlocked`);
    assert.ok(g.gate(), `${finish}: cover still mounted`);
    assert.equal(g.gate().querySelector('form').querySelector('input').focused, true, `${finish}: password prompt shown (its field focused)`);
    assert.ok(!g.calls.includes(url), `${finish}: held API call not released`);
    if (finish === 'slow') {
      g.answer({ success: true }); // the removed key's answer lands late
      await flush();
      assert.equal(g.gated(), true, 'a late ok for the removed key does not open the page');
    }
  }
});

test('browser: a key replaced by another tab during the stored-key check is validated instead', async () => {
  const g = bootGate({ stored: 'k' });
  const url = `${API}/api/pool?action=list`;
  g.sandbox.window.fetch(url);
  g.otherTab('ro_api_password', 'k2');
  assert.equal(g.validates.length, 1, 'one check at a time: the stored check re-reads the key when it settles');
  g.answer({ success: true }); // the answer for k
  await flush();
  assert.equal(g.gated(), true, 'k is no longer on file: its ok does not reveal');
  assert.equal(g.validates.length, 1, 'the key now on file is checked');
  assert.equal(g.validates[0].password, 'k2');
  g.answer({ success: true });
  await flush();
  assert.equal(g.gated(), false, 'revealed on the new key');
  assert.equal(g.store.ro_api_password, 'k2');
  // Built while k was on file and sent with no Authorization: a public read,
  // so it goes out as built; the key swap does not add one.
  assert.deepEqual(g.requests.filter((r) => r.url === url).map((r) => r.auth), [null]);
});

test('browser: a page revealed on a key another tab put in during the stored-key check announces it once, after the held calls', async () => {
  // The Hub built its dashboard call with the key on file at load ("old-key"),
  // so it goes out as built and comes back with costs locked. It only refetches
  // with the new key if the page tells it the key changed.
  const ok = (g, password) => {
    const i = g.validates.findIndex((v) => v.password === password);
    assert.ok(i >= 0, `a check of ${password} is pending`);
    g.validates.splice(i, 1)[0].resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
  };
  for (const oldEnds of ['rejected', 'ok', 'slow']) {
    const g = bootGate({ stored: 'old-key' });
    const dash = `${API}/api/production?action=dashboard`;
    g.sandbox.window.fetch(dash, { headers: { Authorization: 'Bearer old-key' } });
    g.otherTab('ro_api_password', 'new-key');
    if (oldEnds === 'rejected') g.answer({ success: false }, { ok: false, status: 401 });
    else if (oldEnds === 'ok') g.answer({ success: true });
    else g.timers.find((t) => t.ms === 3000 && !t.cleared).fn();
    await flush();
    assert.equal(g.gated(), true, `${oldEnds}: not revealed on old-key`);
    assert.deepEqual(g.authEvents(), [], `${oldEnds}: nothing announced yet`);
    ok(g, 'new-key');
    await flush();
    assert.equal(g.gated(), false, `${oldEnds}: revealed on new-key`);
    const ev = g.events.filter((e) => e.type === 'ro:authchange');
    assert.deepEqual(ev.map((e) => e.detail.unlocked), [true], `${oldEnds}: exactly one ro:authchange {unlocked:true}`);
    assert.ok(ev[0].callsSoFar.includes(dash), `${oldEnds}: the held dashboard call went out before the announce`);
    assert.deepEqual(g.requests.filter((r) => r.url === dash).map((r) => r.auth), ['Bearer old-key'],
      `${oldEnds}: the held call still goes out as built`);
  }

  // A normal first load (the key on file never changes) announces nothing,
  // whether the check answers or runs slow, so nothing fetches twice.
  for (const ends of ['ok', 'slow']) {
    const g = bootGate({ stored: 'k' });
    g.sandbox.window.fetch(`${API}/api/production?action=dashboard`, { headers: { Authorization: 'Bearer k' } });
    if (ends === 'ok') g.answer({ success: true });
    else g.timers.find((t) => t.ms === 3000 && !t.cleared).fn();
    await flush();
    assert.equal(g.gated(), false, `${ends}: revealed`);
    assert.deepEqual(g.authEvents(), [], `${ends}: unchanged key, no ro:authchange`);
  }
});

test('browser: a key stored by another tab while a typed password is checked is used when the typed one is wrong', async () => {
  const g = bootGate();
  const { done } = await submitPassword(g, 'bad');
  g.otherTab('ro_api_password', 'good'); // arrives while busy
  g.answer({ success: false }, { ok: false, status: 401 });
  await done;
  await flush();
  assert.equal(g.validates.length, 1, 'the key now on file is checked after the typed one is rejected');
  assert.equal(g.validates[0].password, 'good');
  g.answer({ success: true });
  await flush();
  assert.equal(g.gated(), false, 'revealed with the stored key');
  assert.equal(g.store.ro_api_password, 'good');
  assert.notEqual(g.sandbox.reloaded, true);

  // Nothing new on file: a wrong password stays wrong, no extra check.
  const h = bootGate();
  const typed = await submitPassword(h, 'bad');
  h.answer({ success: false }, { ok: false, status: 401 });
  await typed.done;
  await flush();
  assert.equal(h.validates.length, 0);
  assert.equal(h.gated(), true);
});

test('browser: an in-place re-unlock gives focus back to the field the operator was in', async () => {
  const g = await bootOpen();
  const work = g.document.body.appendChild(fakeEl('input', []));
  let focusedOnOpenPage = null;
  work.focus = () => { focusedOnOpenPage = !g.gated() && !g.gate(); };
  g.document.activeElement = work;
  g.sandbox.ROGate.relock();
  g.document.activeElement = g.gate().querySelector('input'); // the prompt takes focus
  await typeUnlock(g, 'again');
  assert.equal(focusedOnOpenPage, true, 'focus returned to the field, after the cover is gone');

  // A field that left the page meanwhile is not focused.
  const h = await bootOpen();
  const gone = h.document.body.appendChild(fakeEl('input', []));
  h.document.activeElement = gone;
  h.sandbox.ROGate.relock();
  gone.isConnected = false;
  await typeUnlock(h, 'again');
  assert.equal(gone.focused, false);
});
