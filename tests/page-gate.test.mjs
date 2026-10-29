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
];
// Gated by a login of its own; must NOT also load page-gate.js.
const SELF_GATED = ['consignment.html'];
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
const FIXED_LANG = { 'index.html': 'en' };

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
  const lists = [...GATED, ...SELF_GATED, ...OPEN];
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

for (const name of SELF_GATED) {
  test(`${name} keeps its own login and does not load the shared gate`, () => {
    const html = read(name);
    assert.doesNotMatch(html, ANY_GATE_REF);
    assert.match(html, /id=["']login-form["']/);
    assert.match(html, /action=validatePassword/);
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
    children: [], attrs: {}, sub: {}, listeners: {},
    classList: {
      set: new Set(),
      add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); },
    },
    get firstChild() { return this.children[0] || null; },
    get nextSibling() { const p = this.parentNode; return p ? p.children[p.children.indexOf(this) + 1] || null : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, focus() {},
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
  const validates = [];
  const timers = [];
  const events = []; // everything dispatched on the document
  const script = fakeEl('script', []);
  if (dataLang) script.setAttribute('data-lang', dataLang);
  const document = {
    readyState: 'complete',
    currentScript: script,
    documentElement: fakeEl('html', []),
    head: fakeEl('head', []),
    body: fakeEl('body', []),
    createElement: (t) => fakeEl(t, created),
    getElementById: (id) => created.find((e) => e.id === id && e.parentNode && !e.removed) || slots[`#${id}`] || null,
    querySelector: (sel) => slots[sel] || null,
    addEventListener() {},
    dispatchEvent(e) { events.push(e); return true; },
  };
  const stubFetch = (input) => {
    const url = String((input && input.url) || input);
    calls.push(url);
    if (url.includes('action=validatePassword')) return new Promise((resolve) => validates.push(resolve));
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  };
  const sandbox = {
    URL, AbortController, document,
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
    addEventListener() {},
    fetch: stubFetch,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(readFileSync(GATE_FILE, 'utf8'), sandbox, { filename: 'page-gate.js' });
  const answer = (body, { ok = true, status = 200 } = {}) =>
    validates.shift()({ ok, status, json: async () => body });
  const lockButton = () => created.find((e) => e.id === 'ro-gate-lock' && e.parentNode && !e.removed) || null;
  const gate = () => created.find((e) => e.id === 'ro-gate' && !e.removed) || null;
  return { sandbox, document, stubFetch, calls, timers, events, answer, lockButton, gate, store };
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
