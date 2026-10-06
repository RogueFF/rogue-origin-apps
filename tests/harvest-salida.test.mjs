// /salida — the water spider's scan-out screen. The pure logic is tested here
// directly; the same functions are serialised into the page, so the page's
// inline script is also parsed to catch the silent "syntax error = dead page".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  parseTag, isScannerBurst, debounceSeen, queueReduce, feedbackFor,
  groupToday, escapeHtml, embedJson, LOGIC_SOURCE, pacificTime, countText, busyRetry,
  undoNeedsConfirm, orderChips, rememberCode, queueLoad,
} from '../workers/src/handlers/harvest-salida-logic.js';
import { SALIDA_STRINGS } from '../workers/src/handlers/harvest-salida-strings.js';
import { salidaPageBody } from '../workers/src/handlers/harvest-salida-page.js';
import { salidaDecoderResponse, SALIDA_DECODER_PATH } from '../workers/src/handlers/harvest-salida-decoder.js';

const S = SALIDA_STRINGS.es;
const URL_ = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/s/';

test('parseTag: tag URL, bare id, lower case, trailing slash and whitespace', () => {
  assert.deepEqual(parseTag(URL_ + '26-SLIFT-151'), { id: '26-SLIFT-151' });
  assert.deepEqual(parseTag(' 26-slift-151 \n'), { id: '26-SLIFT-151' });
  assert.deepEqual(parseTag(URL_ + '26-SLIFT-151/?x=1'), { id: '26-SLIFT-151' });
  assert.deepEqual(parseTag('http://localhost:8787/s/25-GG4-7'), { id: '25-GG4-7' });
});

test('parseTag: hostile and foreign input is not a tag', () => {
  for (const q of ['', null, undefined, 42, 'hello', '151', 'https://evil.example/x',
    URL_ + '26-SLIFT-151<script>', '26-SLIFT-151"onload="x', 'javascript:alert(1)//s/26-A-1',
    URL_ + '26-SLIFT-', 'x'.repeat(5000), URL_ + '../admin', 'WIFI:S:barn;T:WPA;P:x;;']) {
    assert.equal(parseTag(q), null, String(q).slice(0, 40));
  }
});

test('isScannerBurst: fast keystrokes ending in a tag are a scan, a person typing is not', () => {
  const keys = (s, gap) => [...s].map((ch, i) => ({ ch, t: 1000 + i * gap }));
  assert.equal(isScannerBurst(keys(URL_ + '26-SLIFT-151', 8)), true);
  assert.equal(isScannerBurst(keys('26-SLIFT-151', 15)), true);
  assert.equal(isScannerBurst(keys('151', 5)), false, 'short digits are typing even if fast');
  assert.equal(isScannerBurst(keys('26-SLIFT-151', 180)), false, 'human speed');
  // ...but the page still routes slow tag-shaped input as a scan via parseTag, never as a bag number.
  assert.ok(parseTag('26-SLIFT-151'));
  assert.equal(isScannerBurst(keys('abcdefghijkl', 5)), false, 'fast but not a tag');
  assert.equal(isScannerBurst([]), false);
});

test('debounceSeen: same sack within the window is ignored, other sacks pass', () => {
  let r = debounceSeen({}, 'A', 1000, 4000);
  assert.equal(r.accept, true);
  r = debounceSeen(r.seen, 'A', 3000, 4000);
  assert.equal(r.accept, false);
  assert.equal(debounceSeen(r.seen, 'B', 3000, 4000).accept, true);
  assert.equal(debounceSeen(r.seen, 'A', 5500, 4000).accept, true);
});

test('queueReduce: add, dedupe, resolve, and keep on failure', () => {
  const p = { q: '26-SLIFT-151', by: 'scan' };
  let q = queueReduce([], { type: 'add', key: 'k1', payload: p, at: 1 });
  q = queueReduce(q, { type: 'add', key: 'k1', payload: p, at: 2 });
  assert.equal(q.length, 1);
  assert.deepEqual(queueReduce(q, { type: 'fail', key: 'k1' })[0].tries, 1);
  assert.deepEqual(queueReduce(q, { type: 'done', key: 'k1' }), []);
  assert.deepEqual(queueReduce(q, { type: 'bogus' }), q);
  assert.deepEqual(queueReduce('garbage', { type: 'done', key: 'x' }), []);
});

test('feedbackFor: already_out for a sack from OUR pending queue is a success', () => {
  const resp = { state: 'already_out', sack: { cultivar: 'Sour Lifter', serial: 151, opened_at: '2026-10-06 16:42:10' }, order: null };
  assert.equal(feedbackFor(resp, S, true).tone, 'ok');
  const warn = feedbackFor(resp, S, false);
  assert.equal(warn.tone, 'warn');
  assert.deepEqual(warn.vibrate, [120, 80, 120]);
});

test('feedbackFor: every state maps to a tone and escapes nothing itself (text only)', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const tones = {};
  for (const state of ['out', 'already_out', 'voided', 'not_found', 'not_a_tag', 'ambiguous', 'weird']) {
    const f = feedbackFor({ state, sack: { cultivar: evil, serial: 1 }, order: { nickname: evil }, candidates: [] }, S, false);
    tones[state] = f.tone;
    assert.equal(typeof f.line, 'string');
  }
  assert.deepEqual(tones, { out: 'ok', already_out: 'warn', voided: 'bad', not_found: 'bad', not_a_tag: 'bad', ambiguous: 'pick', weird: 'bad' });
  assert.match(feedbackFor({ state: 'out', sack: { cultivar: 'SL', serial: 9 }, order: null }, S, false).line, /Inventario/);
});

test('groupToday: "6 de 14", no "de N" when null, pending rows shown', () => {
  const today = { groups: [
    { cultivar: 'Sour Lifter', order: { nickname: 'Miami' }, sacks_today: 6, sacks_needed: 14,
      sacks: [{ sack_id: '26-SLIFT-151', serial: 151, zone: 'Z16', cut_number: 1, opened_at: '2026-10-06 16:42:10' }] },
    { cultivar: 'GG4', order: null, sacks_today: 2, sacks_needed: null, sacks: [] }] };
  const g = groupToday(today, [{ key: 'k', payload: { q: '26-GG4-3' }, at: 0 }], S);
  assert.equal(g[0].title, 'Sour Lifter · Miami');
  assert.equal(g[0].count, '6 de 14 bolsas');
  assert.equal(g[0].rows[0].time, '9:42 a.m.');
  assert.equal(g[1].count, '2 bolsas');
  assert.match(g[1].title, /Inventario/);
  assert.equal(g[2].pending, true);
  assert.deepEqual(groupToday(null, [], S), []);
});

test('escapeHtml and embedJson cannot be broken out of', () => {
  assert.equal(escapeHtml(`<a href="x" onclick='y'>&`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;');
  const j = embedJson({ nick: `</script><script>alert("x")</script> 'q' ` });
  assert.ok(!j.includes('</script'));
  assert.ok(!j.includes(' '));
  assert.equal(JSON.parse(j).nick, `</script><script>alert("x")</script> 'q' `);
});

const realisticBoot = (lang) => ({ api: '/api/harvest', lang, is_test: true, today: {
  date: '2026-10-06', total: 1, chips: [{ code: 'SLIFT', cultivar: 'Sour</script>"Lifter', in_inventory: 148 }],
  groups: [{ cultivar: 'Sour Lifter', order: { nickname: `</script><b>"Mia'mi"` }, sacks_today: 1, sacks_needed: 14,
    sacks: [{ sack_id: '26-SLIFT-151', serial: 151, zone: 'Z16', cut_number: 1, opened_at: '2026-10-06 16:42:10' }] }] } });

function scriptsOf(html) {
  return [...html.matchAll(/<script(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

for (const lang of ['es', 'en']) {
  test(`salidaPageBody renders (${lang}) with realistic and empty boot; scripts parse`, () => {
    for (const boot of [realisticBoot(lang), {}, null]) {
      const html = salidaPageBody({ lang, t: (k) => k }, boot);
      assert.equal((html.match(/<\/script>/g) || []).length, (html.match(/<script/g) || []).length, 'no breakout');
      assert.ok(!html.includes('<b>"Mia'), 'nickname never raw in markup');
      const scripts = scriptsOf(html);
      assert.ok(scripts.length >= 1);
      for (const s of scripts) assert.doesNotThrow(() => new vm.Script(s), 'inline script is valid JS');
      assert.ok(html.includes(lang === 'es' ? 'Escanea' : 'Scan'));
      assert.ok(html.includes('wholesale.html'));
    }
  });
}

test('LOGIC_SOURCE is valid JS and defines the same functions', () => {
  const ctx = {};
  vm.runInNewContext(LOGIC_SOURCE + ';this.p=parseTag;', ctx);
  assert.deepEqual({ ...ctx.p(URL_ + '26-SLIFT-151') }, { id: '26-SLIFT-151' });
});

test('decoder response is cacheable JavaScript', async () => {
  const r = salidaDecoderResponse();
  assert.match(r.headers.get('content-type'), /javascript/);
  assert.match(r.headers.get('cache-control'), /max-age=\d{6,}/);
  assert.match(await r.text(), /jsQR/);
  assert.match(SALIDA_DECODER_PATH, /^\/salida\/jsqr-1\.4\.0\.js$/);
});

// Boot the real inline script against a stub DOM: catches startup
// ReferenceErrors a parse check cannot, and proves sim -> sack_out wiring.
test('page script boots on a stub DOM and a simulated scan POSTs sack_out once', async () => {
  const html = salidaPageBody({ lang: 'es' }, realisticBoot('es'));
  const json = html.match(/<script type="application\/json" id="salida-boot">([\s\S]*?)<\/script>/)[1];
  const el = () => new Proxy({ style: {}, dataset: {}, classList: { add() {}, remove() {} }, hidden: false, value: '' }, {
    get: (o, k) => (k in o ? o[k] : (k === 'textContent' ? json : () => el())), set: (o, k, v) => { o[k] = v; return true; } });
  const els = {};
  const calls = [];
  const win = {
    document: { getElementById: (id) => (els[id] ||= el()), createElement: () => el(), addEventListener() {}, hidden: false, body: el(), head: el() },
    localStorage: { getItem: () => null, setItem() {} },
    navigator: {}, location: { search: '?sim=1' },
    addEventListener() {}, setInterval() {}, setTimeout() {}, clearInterval() {}, clearTimeout() {}, requestAnimationFrame() {},
    fetch: async (url, opt) => { calls.push([url, opt && opt.body]); return { ok: true, status: 200, json: async () => ({ success: true, state: 'out', sack: { sack_id: '26-SLIFT-151', cultivar: 'SL', serial: 151 }, order: null, order_options: [] }) }; },
    Date, JSON, Set, Promise, Object, Array, String, Number, Math, isNaN,
  };
  win.window = win;
  const script = scriptsOf(html)[0];
  vm.runInNewContext(script, win);
  win.salidaSim(URL_ + '26-SLIFT-151');
  win.salidaSim(URL_ + '26-SLIFT-151');
  win.salidaSim('https://example.com/menu');
  await new Promise((r) => setTimeout(r, 20));
  const posts = calls.filter(([u]) => /action=sack_out$/.test(u));
  assert.equal(posts.length, 1, 'debounced, foreign QR ignored');
  assert.deepEqual(JSON.parse(posts[0][1]), { q: '26-SLIFT-151', by: 'scan', order_id: null });
});

const EN = SALIDA_STRINGS.en;

test('countText: whole bags rounded UP, singular/plural in both languages', () => {
  assert.equal(countText(3, 14.1, S), '3 de 15 bolsas');
  assert.equal(countText(3, 14, S), '3 de 14 bolsas');
  assert.equal(countText(1, null, S), '1 bolsa');
  assert.equal(countText(0, null, S), '0 bolsas');
  assert.equal(countText(0, 0.4, S), '0 de 1 bolsa');
  assert.equal(countText(1, null, EN), '1 sack');
  assert.equal(countText(2, 2.5, EN), '2 of 3 sacks');
});

test('pacificTime: a.m./p.m., PDT/PST, and a UTC date boundary', () => {
  assert.equal(pacificTime('2026-10-06 16:42:10'), '9:42 a.m.');
  assert.equal(pacificTime('2026-10-07 03:10:00'), '8:10 p.m.'); // next UTC day, same Pacific evening
  assert.equal(pacificTime('2026-12-01 20:05:00'), '12:05 p.m.'); // PST
  assert.equal(pacificTime(''), '');
});

test('busyRetry: three calm retries 1.5 s apart, then stop', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(busyRetry), [1500, 1500, 1500, null, null]);
  assert.equal(feedbackFor({ state: 'busy' }, S, false).tone, 'wait');
  assert.equal(feedbackFor({ state: 'stuck' }, S, false).tone, 'warn');
});

test('feedbackFor: refused / unknown_order show the server message, red, with an icon', () => {
  for (const state of ['refused', 'unknown_order']) {
    const f = feedbackFor({ success: false, state, message: 'Pedido cerrado' }, S, false);
    assert.equal(f.tone, 'bad'); assert.equal(f.line, 'Pedido cerrado'); assert.equal(f.icon, '✕');
  }
  assert.equal(feedbackFor({ state: 'refused' }, S, false).line, S.error);
  assert.equal(feedbackFor({ state: 'out', sack: {} }, S, false).icon, '✓');
});

test('feedbackFor: already_out with a live undo_until offers undo; expired does not', () => {
  const sack = { cultivar: 'Sour Lifter', serial: 7, opened_at: '2026-10-06 16:42:10' };
  const live = feedbackFor({ state: 'already_out', sack, undo_until: new Date(Date.now() + 30000).toISOString() }, S, false);
  assert.equal(live.undoLive, true); assert.match(live.line, /9:42 a\.m\./);
  assert.equal(feedbackFor({ state: 'already_out', sack, undo_until: null }, S, false).undoLive, false);
});

test('groupToday: can_undo passes through only when true; progress numbers rounded up', () => {
  const g = groupToday({ groups: [{ cultivar: 'SL', order: { nickname: 'Miami' }, sacks_today: 3, sacks_needed: 14.1,
    sacks: [{ sack_id: 'a', serial: 1, can_undo: true }, { sack_id: 'b', serial: 2, can_undo: false }, { sack_id: 'c', serial: 3 }] }] }, [], S);
  assert.deepEqual(g[0].rows.map((r) => r.can_undo), [true, false, false]);
  assert.equal(g[0].need, 15); assert.equal(g[0].dest, 'Miami'); assert.equal(g[0].count, '3 de 15 bolsas');
});

test('undoNeedsConfirm: one tap inside 60 s, confirm on older rows', () => {
  const now = Date.parse('2026-10-06T16:43:00Z');
  assert.equal(undoNeedsConfirm('2026-10-06 16:42:30', now), false);
  assert.equal(undoNeedsConfirm('2026-10-06 16:41:30', now), true);
  assert.equal(undoNeedsConfirm(null, now), true);
});

test('orderChips: most recently used first, then by count', () => {
  const chips = [{ code: 'A', in_inventory: 1 }, { code: 'B', in_inventory: 9 }, { code: 'C', in_inventory: 5 }, { code: 'D', in_inventory: 0 }];
  assert.deepEqual(orderChips(chips, ['D', 'A']).map((c) => c.code), ['D', 'A', 'B', 'C']);
  assert.deepEqual(orderChips(chips, []).map((c) => c.code), ['B', 'C', 'A', 'D']);
  assert.deepEqual(rememberCode(['A', 'B'], 'B'), ['B', 'A']);
});

test('queue survives a reload through localStorage text; corrupt storage is empty', () => {
  const ls = new Map();
  let q = queueReduce([], { type: 'add', key: 'q:26-SLIFT-7', payload: { q: '26-SLIFT-7' }, at: 1 });
  q = queueReduce(q, { type: 'add', key: 't:SLIFT-8', payload: { code: 'SLIFT', number: 8 }, at: 2 });
  ls.set('salida.queue.v1', JSON.stringify(q));
  const back = queueLoad(ls.get('salida.queue.v1'));
  assert.deepEqual(back.map((x) => x.key), ['q:26-SLIFT-7', 't:SLIFT-8']);
  assert.deepEqual(queueLoad('{oops'), []); assert.deepEqual(queueLoad(null), []);
});

test('inlined logic survives the bundler renaming a function', async () => {
  // esbuild shipped `function parseTag2(` on the live worker while the client
  // called `parseTag`; the page rendered as an empty shell. logicSource must
  // define BOTH names, whatever the bundle calls the function.
  const { logicSource } = await import('../workers/src/handlers/harvest-salida-logic.js');
  function parseTag2(t) { return `seen:${t}`; }
  const src = logicSource([['parseTag', parseTag2]]);
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(`${src}
this.a = parseTag('x'); this.b = parseTag2('y');`, ctx);
  assert.equal(ctx.a, 'seen:x');
  assert.equal(ctx.b, 'seen:y');
  assert.equal(logicSource([['same', function same() { return 1; }]]).includes('var same'), false);  // esbuild's keep-names helper rides along in the serialised source.
  const kept = {}; vm.createContext(kept);
  vm.runInContext(`${logicSource([['f', function f() { return 2; }]])}
this.r = /* @__PURE__ */ __name(() => 3, "g")();`, kept);
  assert.equal(kept.r, 3);
});
