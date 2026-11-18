import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshConsignDb, post, sqliteOk } from './helpers/consign-sqlite.mjs';
import { handleConsignD1 } from '../workers/src/handlers/consign-d1.js';
import { dropoffPrompt, screenPrompt } from '../workers/src/lib/consign-sheet-prompt.js';

before((t) => { if (!sqliteOk) t.skip('node:sqlite unavailable'); });

const OWNER = { owner_password: 'owner-pw' };
const IMG = 'AAAA'; // a valid, tiny base64 string; the model is stubbed
const FRIENDLY = 'Could not read the sheet. Enter the numbers by hand.';
const call = async (env, action, body, opts) => (await (await handleConsignD1(post(action, body, opts), env, {})).json()).data;

async function seeded() {
  const db = freshConsignDb();
  const { env } = db;
  env.ANTHROPIC_API_KEY = 'test-key';
  const { farm: a } = await call(env, 'saveFarm', { name: 'Farm A', ...OWNER });
  const { farm: b } = await call(env, 'saveFarm', { name: 'Farm B', ...OWNER });
  for (const [f, c, t] of [[a, 'Alpha', 'tops'], [a, 'Alpha', 'smalls'], [a, 'Beta', 'tops'], [b, 'Gamma', 'tops']]) {
    await call(env, 'savePricePoint', { farm_id: f.id, cultivar: c, type: t, price_per_lb: 10, effective_from: '2026-01-01', ...OWNER });
  }
  const { dropoff, lots } = await call(env, 'saveDropoff', {
    farm_id: a.id, client_key: 'd1',
    lines: [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100 }, { cultivar: 'Alpha', type: 'smalls', intake_lbs: 40 }, { cultivar: 'Beta', type: 'tops' }],
  });
  return { ...db, a, b, dropoff, lots };
}

const counts = (sqlite) => {
  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'cl\\_%' ESCAPE '\\'").all().map((r) => r.name);
  assert.equal(tables.length, 9); // 0066 + cl_farm_access (0067)
  return Object.fromEntries(tables.map((t) => [t, sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
};

const reply = (obj, extra = {}) => new Response(JSON.stringify({
  content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }], stop_reason: 'end_turn', ...extra,
}), { status: 200, headers: { 'content-type': 'application/json' } });

async function withFetch(impl, fn) {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init, body: JSON.parse(init.body) }); return impl(url, init); };
  try { return await fn(calls); } finally { globalThis.fetch = orig; }
}

const box = (value, unsure = false) => ({ value, unsure, check: false });

test('readSheet dropoff: one image block, the model id, the farm\'s cultivars; normalised rows back', async () => {
  const { env, a } = await seeded();
  const model = { code: `DROP-F${a.id}`, farm: 'Farm A', date: null, dropped_by: 'Sam', note: null,
    rows: [{ cultivar: 'alpha', cultivar_unsure: false, tops: box(52.25), smalls: box(null, true), note: null }] };
  await withFetch(() => reply(model), async (calls) => {
    const { read } = await call(env, 'readSheet', { kind: 'dropoff', image_b64: IMG, media_type: 'image/jpeg', farm_id: a.id });
    assert.equal(calls.length, 1);
    const { url, init, body } = calls[0];
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(init.headers['x-api-key'], 'test-key');
    assert.equal(body.model, 'claude-sonnet-5-5');
    const images = body.messages[0].content.filter((c) => c.type === 'image');
    assert.equal(images.length, 1);
    assert.deepEqual(images[0].source, { type: 'base64', media_type: 'image/jpeg', data: IMG });
    assert.equal(body.output_config.format.type, 'json_schema');
    const text = body.system + body.messages[0].content.filter((c) => c.type === 'text').map((c) => c.text).join('');
    for (const n of ['Farm A', 'Alpha', 'Beta']) assert.ok(text.includes(n), n);
    for (const n of ['Farm B', 'Gamma']) assert.ok(!text.includes(n), `another farm leaked: ${n}`);
    assert.equal(read.farm_id, a.id);
    assert.equal(read.dropped_by, 'Sam');
    assert.deepEqual(read.rows, [{
      cultivar: 'Alpha', cultivar_known: true,
      tops: { value: 52.3, unsure: false, on: true }, tops_final: { value: null, unsure: false },
      smalls: { value: null, unsure: true, on: false }, smalls_final: { value: null, unsure: false }, note: '',
    }]);
  });
});

test('readSheet dropoff without a farm: farm names only, cultivars matched once the farm is known', async () => {
  const { env, b } = await seeded();
  const model = { code: 'DROP', farm: 'farm b', date: null, dropped_by: null, note: null,
    rows: [{ cultivar: 'GAMMA', cultivar_unsure: false, tops: box(5), smalls: box(null), note: null }] };
  await withFetch(() => reply(model), async (calls) => {
    const { read } = await call(env, 'readSheet', { kind: 'dropoff', image_b64: IMG, media_type: 'image/png' });
    const text = calls[0].body.messages[0].content.find((c) => c.type === 'text').text;
    assert.ok(text.includes('Farm A') && text.includes('Farm B'));
    assert.ok(!text.includes('Alpha') && !text.includes('Gamma'), 'no cultivar list before the farm is known');
    assert.equal(read.farm_id, b.id);
    assert.equal(read.rows[0].cultivar, 'Gamma');
    assert.equal(read.rows[0].cultivar_known, true);
  });
});

test('readSheet screen: lots listed in printed order; rows map to lot ids', async () => {
  const { env, dropoff, lots } = await seeded();
  const [alphaTops, alphaSmalls] = lots;
  const model = { code: `SCREEN-D${dropoff.id}`, rows: [
    { index: 1, cultivar: 'Alpha', type: 'tops', pulled: box(100), final: box(80), to_smalls: box(10), biomass: box(9), mold: box(1), finished: { value: true, unsure: false } },
    { index: 2, cultivar: 'Alpha', type: 'smalls', pulled: box(40), final: box(40), to_smalls: box(null), biomass: box(null), mold: box(0), finished: { value: false, unsure: false } },
  ] };
  await withFetch(() => reply(model), async (calls) => {
    const { read } = await call(env, 'readSheet', { kind: 'screen', image_b64: IMG, media_type: 'image/webp', dropoff_id: dropoff.id });
    const text = calls[0].body.messages[0].content.find((c) => c.type === 'text').text;
    assert.match(text, /1\. Alpha \(tops\), before 100 lb\n2\. Alpha \(smalls\), before 40 lb/);
    assert.ok(!text.includes('Beta'), 'an unweighed lot is not a printed row');
    assert.ok(!text.includes('Farm B'));
    assert.deepEqual(read.rows.map((r) => r.lot_id), [alphaTops.id, alphaSmalls.id]);
    assert.equal(read.rows[0].finishes.value, true);
  });
});

test('readSheet never writes: every cl_ table has the same row count after reads', async () => {
  const { env, sqlite, a, dropoff } = await seeded();
  const before = counts(sqlite);
  await withFetch(() => reply({ code: null, farm: 'Farm A', date: null, dropped_by: null, note: null, rows: [] }), async () => {
    await call(env, 'readSheet', { kind: 'dropoff', image_b64: IMG, media_type: 'image/jpeg', farm_id: a.id });
    await call(env, 'readSheet', { kind: 'dropoff', image_b64: IMG, media_type: 'image/jpeg' });
  });
  await withFetch(() => reply({ code: null, rows: [{ index: 1, pulled: box(100), final: box(100) }] }), async () => {
    await call(env, 'readSheet', { kind: 'screen', image_b64: IMG, media_type: 'image/jpeg', dropoff_id: dropoff.id });
  });
  await withFetch(() => new Response('boom', { status: 500 }), async () => {
    await assert.rejects(call(env, 'readSheet', { kind: 'dropoff', image_b64: IMG, media_type: 'image/jpeg' }));
  });
  assert.deepEqual(counts(sqlite), before);
});

test('readSheet refuses bad input before any fetch', async () => {
  const { env, sqlite, a, dropoff } = await seeded();
  await withFetch(() => reply({}), async (calls) => {
    await assert.rejects(handleConsignD1(post('readSheet', { kind: 'dropoff', image_b64: IMG, media_type: 'image/jpeg' }, { auth: false }), env, {}), /Password required/);
    const bigB64 = 'A'.repeat(Math.ceil((3.75 * 1024 * 1024 + 4) / 3) * 4);
    await assert.rejects(handleConsignD1(post('readSheet', { kind: 'dropoff', image_b64: bigB64, media_type: 'image/jpeg' }), env, {}), /too large/i);
    await assert.rejects(handleConsignD1(post('readSheet', { kind: 'dropoff', image_b64: IMG, media_type: 'image/gif' }), env, {}), /JPEG/);
    await assert.rejects(handleConsignD1(post('readSheet', { kind: 'dropoff', image_b64: 'not base64!', media_type: 'image/jpeg' }), env, {}), /photo/i);
    await assert.rejects(handleConsignD1(post('readSheet', { kind: 'dropoff', media_type: 'image/jpeg' }), env, {}), /photo/i);
    await assert.rejects(handleConsignD1(post('readSheet', { kind: 'payments', image_b64: IMG, media_type: 'image/jpeg' }), env, {}), /kind/i);
    await assert.rejects(handleConsignD1(post('readSheet', { kind: 'screen', image_b64: IMG, media_type: 'image/jpeg', dropoff_id: 999 }), env, {}), /dropoff/i);
    await assert.rejects(handleConsignD1(post('readSheet', { kind: 'screen', image_b64: IMG, media_type: 'image/jpeg' }), env, {}), /dropoff/i);
    await assert.rejects(handleConsignD1(post('readSheet', { kind: 'dropoff', image_b64: IMG, media_type: 'image/jpeg', farm_id: 999 }), env, {}), /farm/i);
    await call(env, 'voidRow', { table: 'dropoff', id: dropoff.id, reason: 'test' });
    await assert.rejects(handleConsignD1(post('readSheet', { kind: 'screen', image_b64: IMG, media_type: 'image/jpeg', dropoff_id: dropoff.id }), env, {}), /dropoff/i);
    assert.equal(calls.length, 0);
    assert.ok(a.id && sqlite);
  });
});

test('readSheet with no API key says it is not set up, and does not fetch', async () => {
  const { env } = await seeded();
  delete env.ANTHROPIC_API_KEY;
  await withFetch(() => reply({}), async (calls) => {
    await assert.rejects(handleConsignD1(post('readSheet', { kind: 'dropoff', image_b64: IMG, media_type: 'image/jpeg' }), env, {}),
      (e) => e.code === 'INTERNAL_ERROR' && /not set up/.test(e.message));
    assert.equal(calls.length, 0);
  });
});

test('readSheet hides upstream failures behind one friendly error', async () => {
  const { env } = await seeded();
  env.CONSIGN_SHEET_TIMEOUT_MS = 50;
  const SECRET = 'UPSTREAM-SECRET-TEXT';
  const never = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error(`aborted ${SECRET}`)));
  });
  const cases = [
    () => new Response(`{"error":"${SECRET}"}`, { status: 500 }),
    () => reply(`I could not do that ${SECRET}`),
    () => reply(`{"rows": [ ${SECRET}`),
    () => reply({ rows: [] }, { stop_reason: 'refusal' }),
    () => reply({ rows: [] }, { stop_reason: 'max_tokens' }),
    () => new Response(SECRET, { status: 200 }),
    () => { throw new Error(SECRET); },
    never,
  ];
  for (const impl of cases) {
    await withFetch(impl, async () => {
      const res = await handleConsignD1(post('readSheet', { kind: 'dropoff', image_b64: IMG, media_type: 'image/jpeg' }), env, {})
        .then(() => null, (e) => e);
      assert.ok(res, 'should fail');
      assert.equal(res.code, 'INTERNAL_ERROR');
      assert.equal(res.message, FRIENDLY);
      assert.ok(!JSON.stringify({ m: res.message, d: res.details }).includes(SECRET));
    });
  }
});

test('the model id can be overridden by config; a junk value falls back', async () => {
  const { env } = await seeded();
  const prepare = env.DB.prepare;
  let value = 'claude-opus-5-5';
  env.DB = { ...env.DB, prepare: (q) => (q.includes('system_config')
    ? { bind: () => ({ first: async () => ({ value, value_type: 'string' }) }) }
    : prepare(q)) };
  await withFetch(() => reply({ code: null, farm: null, date: null, dropped_by: null, note: null, rows: [] }), async (calls) => {
    await call(env, 'readSheet', { kind: 'dropoff', image_b64: IMG, media_type: 'image/jpeg' });
    value = 'gpt; drop';
    await call(env, 'readSheet', { kind: 'dropoff', image_b64: IMG, media_type: 'image/jpeg' });
    assert.equal(calls[0].body.model, 'claude-opus-5-5');
    assert.equal(calls[1].body.model, 'claude-sonnet-5-5');
  });
});

test('prompt builders are pure and list only what ctx gives them', () => {
  const ctx = { farms: [{ id: 1, name: 'Farm A' }], cultivars: ['Alpha', 'Beta'] };
  const p1 = dropoffPrompt(ctx);
  assert.deepEqual(dropoffPrompt(ctx), p1);
  const all = p1.system + p1.user;
  for (const n of ['Farm A', 'Alpha', 'Beta']) assert.ok(all.includes(n));
  assert.ok(!/Farm B|Gamma/.test(all));
  assert.ok(/never guess a digit/i.test(p1.system));
  const s = screenPrompt({ farms: [{ id: 1, name: 'Farm A' }], lots: [{ id: 9, cultivar: 'Alpha', type: 'smalls', remainder_lbs: 12.5 }] });
  assert.match(s.user, /1\. Alpha \(smalls\), before 12\.5 lb/);
  assert.ok(!/Farm B|Gamma|Beta/.test(s.system + s.user));
  assert.equal(p1.schema.additionalProperties, false);
});

test('readSheet screen with the printed lot ids: numbered as printed, even after a lot is weighed or closed', async () => {
  const { env, dropoff, lots } = await seeded();
  const [alphaTops, alphaSmalls, beta] = lots;
  // printed when only the two Alpha lots were open; Beta was weighed later, Alpha smalls closed
  await call(env, 'setWeight', { lot_id: beta.id, intake_lbs: 30 });
  await call(env, 'saveScreenRun', { lot_id: alphaSmalls.id, pulled_lbs: 40, final_lbs: 40, finishes_lot: true, client_key: 'r1' });
  const model = { code: `SCREEN-D${dropoff.id}`, rows: [
    { index: 1, cultivar: 'Alpha', type: 'tops', pulled: box(100), final: box(100), to_smalls: box(null), biomass: box(null), mold: box(null), finished: { value: true, unsure: false } },
    { index: 2, cultivar: 'Alpha', type: 'smalls', pulled: box(40), final: box(40), to_smalls: box(null), biomass: box(null), mold: box(null), finished: { value: true, unsure: false } },
  ] };
  await withFetch(() => reply(model), async (calls) => {
    const { read } = await call(env, 'readSheet', { kind: 'screen', image_b64: IMG, media_type: 'image/jpeg', dropoff_id: dropoff.id, lot_ids: [alphaTops.id, alphaSmalls.id] });
    const text = calls[0].body.messages[0].content.find((c) => c.type === 'text').text;
    assert.match(text, /1\. Alpha \(tops\)/);
    assert.match(text, /2\. Alpha \(smalls\)/);
    assert.ok(!text.includes('Beta'), 'a lot weighed after printing is not a printed row');
    assert.deepEqual(read.rows.map((r) => r.lot_id), [alphaTops.id]);
    assert.deepEqual(read.warnings, ['lot_changed']);
  });
});

test('readSheet refuses printed lot ids that are not this dropoff\'s', async () => {
  const { env, dropoff, a } = await seeded();
  const { lots: other } = await call(env, 'saveDropoff', { farm_id: a.id, client_key: 'd2', lines: [{ cultivar: 'Beta', type: 'tops', intake_lbs: 5 }] });
  await withFetch(() => reply({}), async (calls) => {
    for (const ids of [[other[0].id], ['x'], Array.from({ length: 60 }, (_, i) => i + 1)]) {
      await assert.rejects(handleConsignD1(post('readSheet', { kind: 'screen', image_b64: IMG, media_type: 'image/jpeg', dropoff_id: dropoff.id, lot_ids: ids }), env, {}), /sheet/i);
    }
    assert.equal(calls.length, 0);
  });
});

test('readSheet dropoff says when the farm came from handwriting', async () => {
  const { env, a } = await seeded();
  const model = { code: null, farm: 'Farm A', date: null, dropped_by: null, note: null, rows: [] };
  await withFetch(() => reply(model), async () => {
    const { read } = await call(env, 'readSheet', { kind: 'dropoff', image_b64: IMG, media_type: 'image/jpeg' });
    assert.equal(read.farm_id, a.id);
    assert.equal(read.farm_from, 'name');
  });
});

test('readSheet dropoff: the schema and prompt ask for the finals; finals come back normalised', async () => {
  const p = dropoffPrompt({ farms: [{ id: 1, name: 'Farm A' }], cultivars: ['Alpha'] });
  const row = p.schema.properties.rows.items;
  for (const k of ['tops_final', 'smalls_final']) {
    assert.ok(row.required.includes(k), k);
    assert.deepEqual(Object.keys(row.properties[k].properties).sort(), ['unsure', 'value']);
  }
  assert.match(p.system, /Tops lb \| Tops final \| Smalls lb \| Smalls final \| Note/);
  assert.match(p.system, /final/i);

  const { env, sqlite, a } = await seeded();
  const before = counts(sqlite);
  const model = { code: `DROP-F${a.id}`, farm: 'Farm A', date: null, dropped_by: null, note: null,
    rows: [{ cultivar: 'Alpha', cultivar_unsure: false, tops: box(100), tops_final: { value: 90, unsure: false }, smalls: box(null), smalls_final: { value: 30, unsure: true }, note: null }] };
  await withFetch(() => reply(model), async () => {
    const { read } = await call(env, 'readSheet', { kind: 'dropoff', image_b64: IMG, media_type: 'image/jpeg', farm_id: a.id });
    assert.deepEqual(read.rows[0].tops_final, { value: 90, unsure: false });
    assert.deepEqual(read.rows[0].smalls_final, { value: 30, unsure: true });
    assert.equal(read.rows[0].smalls.on, true);
  });
  assert.deepEqual(counts(sqlite), before, 'readSheet still never writes');
});
