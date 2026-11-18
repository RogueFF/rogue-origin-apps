// Staff money lock on /api/consign: a caller without the owner password never gets money back.
// Real SQLite (node:sqlite). Made-up farms, cultivars and numbers only: the prices, the payment
// and the reference below are sentinels, chosen so they cannot collide with any pound figure.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshConsignDb, post, sqliteOk } from './helpers/consign-sqlite.mjs';
import { handleConsignD1, isOwner } from '../workers/src/handlers/consign-d1.js';
import { staffView, STAFF_VIEW_ACTIONS } from '../workers/src/lib/consign-staff-view.js';

before((t) => { if (!sqliteOk) t.skip('node:sqlite unavailable'); });

const OWNER = { owner_password: 'owner-pw' };
const TOPS = 13.37;
const SMALLS = 7.77;
const PAID = 4242.42;
const REF = 'REF-SENTINEL';
const PAY_NOTE = 'PAYNOTE-SENTINEL';
const METHOD = 'check';

/** The whole envelope: { success, data, owner }. */
const raw = async (env, action, body = {}) => (await handleConsignD1(post(action, body), env, {})).json();
const staff = async (env, action, body = {}) => (await raw(env, action, body)).data;
const owner = (env, action, body = {}) => staff(env, action, { ...body, ...OWNER });

const FORBIDDEN_KEYS = ['price_per_lb', 'smalls_price_per_lb', 'owed', 'balance', 'paid', 'amount', 'payments', 'totals',
  // Not in the brief's list, but money all the same:
  'credit', 'value', 'estimate', 'method', 'reference', 'payment'];

/** Every key anywhere in a JSON value. */
function keysOf(v, out = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out); }
  return out;
}
/** Every number anywhere in a JSON value. */
function numbersOf(v, out = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => numbersOf(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => numbersOf(x, out));
  else if (typeof v === 'number') out.add(v);
  return out;
}
/** Money values an owner reply carries (prices, owed, balances, payments): the sentinels a staff reply must not echo. */
const MONEY_KEYS = new Set(['price_per_lb', 'smalls_price_per_lb', 'owed', 'balance', 'paid', 'amount', 'credit', 'value']);
function moneyNumbersOf(v, out = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => moneyNumbersOf(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (MONEY_KEYS.has(k) && typeof x === 'number' && x !== 0) out.add(x);
      moneyNumbersOf(x, out);
    }
  }
  return out;
}

const seen = new Set([TOPS, SMALLS, PAID]);
/** A staff reply: no money key, no money number, no payment text. */
function assertNoMoney(data, label, { allowKeys = [] } = {}) {
  const s = JSON.stringify(data);
  for (const needle of ['13.37', '7.77', '4242.42', REF, PAY_NOTE]) assert.ok(!s.includes(needle), `${label}: carries ${needle}`);
  const keys = keysOf(data);
  for (const k of FORBIDDEN_KEYS) if (!allowKeys.includes(k)) assert.ok(!keys.has(k), `${label}: carries key ${k}`);
  const nums = numbersOf(data);
  for (const n of seen) assert.ok(!nums.has(n), `${label}: carries the money figure ${n}`);
}
/** Remember the money figures an owner reply carried, so staff replies are checked against them too. */
function learn(ownerData) { for (const n of moneyNumbersOf(ownerData)) seen.add(n); }

async function world() {
  const db = freshConsignDb();
  const { env } = db;
  const { farm } = await owner(env, 'saveFarm', { name: 'Farm A', default_term: 'dropoff' });
  const { farm: b } = await owner(env, 'saveFarm', { name: 'Farm B', default_term: 'sold' });
  for (const [f, c, ty, p] of [[farm, 'Alpha', 'tops', TOPS], [farm, 'Alpha', 'smalls', SMALLS], [b, 'Alpha', 'tops', TOPS], [b, 'Alpha', 'smalls', SMALLS]]) {
    await owner(env, 'savePricePoint', { farm_id: f.id, cultivar: c, type: ty, price_per_lb: p, effective_from: '2026-01-01' });
  }
  await owner(env, 'savePayment', { farm_id: farm.id, amount: PAID, method: METHOD, reference: REF, note: PAY_NOTE, client_key: 'p1' });
  await owner(env, 'savePayment', { farm_id: b.id, amount: PAID, method: METHOD, reference: REF, note: PAY_NOTE, client_key: 'p2' });
  return { ...db, farm, b };
}

const lineSet = [
  { cultivar: 'Alpha', type: 'tops', intake_lbs: 100 },
  { cultivar: 'Alpha', type: 'smalls', intake_lbs: 40 },
  { cultivar: 'Beta', type: 'tops' },
];

test('isOwner: true only for the configured secret, false when it is unset, never throws', () => {
  assert.equal(isOwner({ owner_password: 'owner-pw' }, { CONSIGN_OWNER_PASSWORD: 'owner-pw' }), true);
  assert.equal(isOwner({ owner_password: 'owner-pX' }, { CONSIGN_OWNER_PASSWORD: 'owner-pw' }), false);
  assert.equal(isOwner({}, { CONSIGN_OWNER_PASSWORD: 'owner-pw' }), false);
  assert.equal(isOwner({ owner_password: 42 }, { CONSIGN_OWNER_PASSWORD: 'owner-pw' }), false);
  assert.equal(isOwner({ owner_password: '' }, { CONSIGN_OWNER_PASSWORD: '' }), false);
  assert.equal(isOwner({ owner_password: 'x' }, {}), false);
  assert.equal(isOwner(null, {}), false);
});

test('every read and every write reply: staff get no money, the owner gets all of it', async () => {
  const { env, farm, b } = await world();

  // ---- writes, staff caller ----
  const d = await staff(env, 'saveDropoff', { farm_id: farm.id, client_key: 'k1', lines: lineSet });
  assertNoMoney(d, 'saveDropoff');
  const again = await staff(env, 'saveDropoff', { farm_id: farm.id, client_key: 'k1', lines: lineSet });
  assert.equal(again.duplicate, true);
  assertNoMoney(again, 'saveDropoff resend');
  const [tops, smalls, beta] = d.lots;
  assert.equal(beta.money.needs_price, true, 'staff still see that a lot needs a price');
  assert.equal(tops.money.needs_price, false);

  const w = await staff(env, 'setWeight', { lot_id: beta.id, intake_lbs: 30 });
  assertNoMoney(w, 'setWeight');
  assert.equal(w.lot.intake_lbs, 30);

  const run = { pulled_lbs: 100, final_lbs: 80, to_smalls_lbs: 10, biomass_lbs: 8, mold_lbs: 2, finishes_lot: true, client_key: 'r1' };
  const r = await staff(env, 'saveScreenRun', { lot_id: tops.id, ...run });
  assertNoMoney(r, 'saveScreenRun');
  assert.equal(r.lot.money.final_lbs, 80);
  assertNoMoney(await staff(env, 'saveScreenRun', { lot_id: tops.id, ...run }), 'saveScreenRun resend');

  await staff(env, 'saveScreenRun', { lot_id: smalls.id, pulled_lbs: 40, final_lbs: 40, client_key: 'r2' });
  const c = await staff(env, 'closeLot', { lot_id: smalls.id });
  assertNoMoney(c, 'closeLot');
  const cAgain = await staff(env, 'closeLot', { lot_id: smalls.id });
  assert.equal(cAgain.already, true);
  assertNoMoney(cAgain, 'closeLot already');

  const ds = await staff(env, 'saveDropoff', { farm_id: b.id, client_key: 'k2', lines: [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 50 }] });
  const sl = ds.lots[0];
  await staff(env, 'saveScreenRun', { lot_id: sl.id, pulled_lbs: 50, final_lbs: 40, to_smalls_lbs: 10, finishes_lot: true, client_key: 'r3' });
  const sold = await staff(env, 'saveSold', { lot_id: sl.id, lbs: 15, kind: 'main', client_key: 's1' });
  assertNoMoney(sold, 'saveSold');
  assert.equal(sold.lot.money.on_hand_lbs, 35, 'staff still see pounds on hand');
  assertNoMoney(await staff(env, 'saveSold', { lot_id: sl.id, lbs: 15, kind: 'main', client_key: 's1' }), 'saveSold resend');

  // ---- reads, staff caller, then the same read as owner ----
  for (const [action, body] of [['farms', {}], ['farm', { farm_id: farm.id }], ['farm', { farm_id: b.id }], ['open', {}], ['dropoff', { dropoff_id: d.dropoff.id }], ['dropoff', { dropoff_id: ds.dropoff.id }]]) {
    const o = await owner(env, action, body);
    learn(o);
    assertNoMoney(await staff(env, action, body), `${action} ${JSON.stringify(body)}`);
    // A wrong owner password on a read is a staff read, not an error.
    const wrong = await raw(env, action, { ...body, owner_password: 'not-it' });
    assert.equal(wrong.success, true);
    assert.equal(wrong.owner, false);
    assertNoMoney(wrong.data, `${action} with a wrong owner password`);
  }
  // Every figure learnt from owner reads must be absent from what staff got earlier too.
  for (const [label, data] of [['saveDropoff', d], ['setWeight', w], ['saveScreenRun', r], ['closeLot', c], ['saveSold', sold]]) assertNoMoney(data, `${label} (rechecked)`);

  // ---- voids, staff caller ----
  const runId = (await owner(env, 'dropoff', { dropoff_id: ds.dropoff.id })).lots[0].runs[0].id;
  const soldId = (await owner(env, 'dropoff', { dropoff_id: ds.dropoff.id })).lots[0].sold[0].id;
  for (const [table, id] of [['sold', soldId], ['run', runId], ['lot', beta.id], ['dropoff', ds.dropoff.id]]) {
    const v = await staff(env, 'voidRow', { table, id, reason: 'test' });
    assert.deepEqual(v, { ok: true });
    assertNoMoney(v, `voidRow ${table}`);
    assertNoMoney(await staff(env, 'voidRow', { table, id, reason: 'test' }), `voidRow ${table} again`);
  }

  // ---- the owner still sees it all ----
  const of = await owner(env, 'farm', { farm_id: farm.id });
  assert.equal(of.payments[0].amount, PAID);
  assert.equal(of.payments[0].reference, REF);
  assert.ok(of.price_points.some((p) => p.price_per_lb === TOPS));
  assert.ok('balance' in of.totals && 'owed' in of.totals && 'paid' in of.totals);
  const ofs = await owner(env, 'farms');
  assert.ok(ofs.every((f) => 'balance' in f && 'owed' in f && 'paid' in f && 'credit' in f));
  const od = await owner(env, 'dropoff', { dropoff_id: d.dropoff.id });
  assert.equal(od.lots[0].price_per_lb, TOPS);
  assert.ok(od.lots[0].money.owed > 0);
});

test('owner replies keep today\'s shape: the same keys as before the lock', async () => {
  const { env, farm } = await world();
  const d = await owner(env, 'saveDropoff', { farm_id: farm.id, client_key: 'k1', lines: lineSet });
  const LOT = ['id', 'dropoff_id', 'farm_id', 'cultivar', 'type', 'term', 'intake_lbs', 'weighed_at', 'price_per_lb', 'smalls_price_per_lb',
    'closed_at', 'note', 'note_visible', 'voided_at', 'void_reason', 'farm_name', 'dropped_at', 'runs', 'sold', 'money'].sort();
  const MONEY = ['status', 'estimate', 'needs_price', 'intake_lbs', 'pulled_lbs', 'final_lbs', 'to_smalls_lbs', 'biomass_lbs', 'mold_lbs',
    'remainder_lbs', 'payable_main_lbs', 'payable_smalls_lbs', 'sold_main_lbs', 'sold_smalls_lbs', 'on_hand_lbs', 'value', 'owed'].sort();
  assert.deepEqual(Object.keys(d).sort(), ['dropoff', 'lots']);
  assert.deepEqual(Object.keys(d.lots[0]).sort(), LOT);
  assert.deepEqual(Object.keys(d.lots[0].money).sort(), MONEY);
  const f = await owner(env, 'farm', { farm_id: farm.id });
  assert.deepEqual(Object.keys(f).sort(), ['access', 'dropoffs', 'farm', 'payments', 'price_points', 'totals']);
  assert.deepEqual(Object.keys(f.totals).sort(), ['balance', 'credit', 'estimate', 'needs_price', 'owed', 'paid']);
  assert.deepEqual(Object.keys(f.payments[0]).sort(), ['amount', 'client_key', 'farm_id', 'id', 'method', 'note', 'paid_on', 'reference', 'void_reason', 'voided_at']);
  assert.deepEqual(Object.keys(f.price_points[0]).sort(), ['created_at', 'cultivar', 'effective_from', 'farm_id', 'id', 'price_per_lb', 'type']);
  const list = await owner(env, 'farms');
  assert.deepEqual(Object.keys(list[0]).sort(), ['active', 'balance', 'contact', 'created_at', 'credit', 'default_term', 'estimate', 'id', 'lang', 'name', 'needs_price', 'owed', 'paid']);
  const o = await owner(env, 'open');
  assert.deepEqual(Object.keys(o).sort(), ['needs_price', 'to_screen', 'to_weigh']);
  // The envelope says who the server took the caller for.
  assert.equal((await raw(env, 'farms', OWNER)).owner, true);
  assert.equal((await raw(env, 'farms')).owner, false);
});

test('staff replies carry exactly these fields', async () => {
  const { env, farm } = await world();
  const d = await staff(env, 'saveDropoff', { farm_id: farm.id, client_key: 'k1', lines: lineSet, dropped_by: 'T', note: 'n' });
  assert.deepEqual(Object.keys(d.dropoff).sort(), ['dropped_at', 'dropped_by', 'farm_id', 'farm_name', 'id', 'note', 'source', 'void_reason', 'voided_at']);
  assert.deepEqual(Object.keys(d.lots[0]).sort(), ['closed_at', 'cultivar', 'dropoff_id', 'dropped_at', 'farm_id', 'farm_name', 'id', 'intake_lbs',
    'money', 'note', 'note_visible', 'runs', 'sold', 'term', 'type', 'void_reason', 'voided_at', 'weighed_at']);
  assert.deepEqual(Object.keys(d.lots[0].money).sort(), ['biomass_lbs', 'final_lbs', 'intake_lbs', 'mold_lbs', 'needs_price', 'on_hand_lbs',
    'payable_main_lbs', 'payable_smalls_lbs', 'pulled_lbs', 'remainder_lbs', 'sold_main_lbs', 'sold_smalls_lbs', 'status', 'to_smalls_lbs']);
  const r = await staff(env, 'saveScreenRun', { lot_id: d.lots[0].id, pulled_lbs: 100, final_lbs: 100, client_key: 'r1' });
  assert.deepEqual(Object.keys(r.lot.runs[0]).sort(), ['biomass_lbs', 'diff_lbs', 'final_lbs', 'id', 'lot_id', 'mold_lbs', 'note', 'pulled_lbs',
    'run_at', 'to_smalls_lbs', 'void_reason', 'voided_at']);
  const f = await staff(env, 'farm', { farm_id: farm.id });
  assert.deepEqual(Object.keys(f).sort(), ['dropoffs', 'farm', 'price_points']);
  assert.deepEqual(Object.keys(f.farm).sort(), ['active', 'contact', 'created_at', 'default_term', 'id', 'lang', 'name']);
  // Cultivars and types to pre-fill the dropoff grid; never a price.
  assert.deepEqual(f.price_points, [{ cultivar: 'Alpha', type: 'tops' }, { cultivar: 'Alpha', type: 'smalls' }]);
  assert.deepEqual(Object.keys(f.dropoffs[0]).sort(), ['dropped_at', 'dropped_by', 'farm_id', 'id', 'lots', 'note', 'source', 'void_reason', 'voided_at']);
  const list = await staff(env, 'farms');
  assert.deepEqual(Object.keys(list[0]).sort(), ['active', 'contact', 'created_at', 'default_term', 'id', 'lang', 'name', 'needs_price']);
  assert.equal(list.find((x) => x.id === farm.id).needs_price, true);
  const o = await staff(env, 'open');
  assert.deepEqual(Object.keys(o).sort(), ['needs_price', 'to_screen', 'to_weigh']);
  assert.equal(o.needs_price.length, 1);
  // client_key stays on the server: the page never reads it back.
  assert.ok(!JSON.stringify([d, r, f, list, o]).includes('client_key'));
});

test('a column added to a table later does not reach staff', async () => {
  const { env, sqlite, farm } = await world();
  for (const tbl of ['cl_farms', 'cl_lots', 'cl_dropoffs', 'cl_screen_runs', 'cl_sold', 'cl_price_points']) sqlite.exec(`ALTER TABLE ${tbl} ADD COLUMN secret_cost REAL DEFAULT 9191.19`);
  const d = await staff(env, 'saveDropoff', { farm_id: farm.id, client_key: 'k1', lines: lineSet });
  await staff(env, 'saveScreenRun', { lot_id: d.lots[1].id, pulled_lbs: 40, final_lbs: 40, client_key: 'r1' });
  for (const [action, body] of [['farms', {}], ['farm', { farm_id: farm.id }], ['open', {}], ['dropoff', { dropoff_id: d.dropoff.id }]]) {
    const s = JSON.stringify(await staff(env, action, body));
    assert.ok(!s.includes('secret_cost') && !s.includes('9191.19'), action);
  }
  assert.ok(JSON.stringify(await owner(env, 'farm', { farm_id: farm.id })).includes('secret_cost'), 'owner reply is untouched');
});

test('savePayment and voiding a payment are owner only', async () => {
  const { env, sqlite, farm } = await world();
  const before = sqlite.prepare('SELECT COUNT(*) AS n FROM cl_payments').get().n;
  await assert.rejects(handleConsignD1(post('savePayment', { farm_id: farm.id, amount: 5, client_key: 'px' }), env, {}), /owner/i);
  await assert.rejects(handleConsignD1(post('savePayment', { farm_id: farm.id, amount: 5, client_key: 'px', owner_password: 'nope' }), env, {}), /owner/i);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM cl_payments').get().n, before);
  const { payment, totals } = await owner(env, 'savePayment', { farm_id: farm.id, amount: 5, client_key: 'px' });
  assert.equal(payment.amount, 5);
  assert.ok('balance' in totals);

  await assert.rejects(handleConsignD1(post('voidRow', { table: 'payment', id: payment.id, reason: 'x' }), env, {}), /owner/i);
  await assert.rejects(handleConsignD1(post('voidRow', { table: 'payment', id: payment.id, reason: 'x', owner_password: 'nope' }), env, {}), /owner/i);
  assert.equal(sqlite.prepare('SELECT voided_at FROM cl_payments WHERE id = ?').get(payment.id).voided_at, null);
  assert.deepEqual(await owner(env, 'voidRow', { table: 'payment', id: payment.id, reason: 'x' }), { ok: true });
  assert.ok(sqlite.prepare('SELECT voided_at FROM cl_payments WHERE id = ?').get(payment.id).voided_at);
  // A wrong owner password on a staff write is just a staff write.
  const d = await staff(env, 'saveDropoff', { farm_id: farm.id, client_key: 'kw', lines: [lineSet[0]], owner_password: 'nope' });
  assertNoMoney(d, 'saveDropoff with a wrong owner password');
});

test('readSheet replies to staff carry no money', async () => {
  const { env, farm } = await world();
  env.ANTHROPIC_API_KEY = 'test-key';
  const model = { code: `DROP-F${farm.id}`, farm: 'Farm A', date: null, dropped_by: 'Sam', note: null,
    rows: [{ cultivar: 'alpha', cultivar_unsure: false, tops: { value: 52.25, unsure: false, check: false }, smalls: { value: null, unsure: true, check: false }, note: null }] };
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(model) }], stop_reason: 'end_turn' }), { status: 200 });
  try {
    const out = await staff(env, 'readSheet', { kind: 'dropoff', image_b64: 'AAAA', media_type: 'image/jpeg', farm_id: farm.id });
    assert.ok(out.read.rows.length);
    // A read row's weight boxes are { value, unsure }: pounds, so `value` is allowed here.
    assertNoMoney(out, 'readSheet', { allowKeys: ['value'] });
  } finally { globalThis.fetch = orig; }
});

test('every action is either owner only or has a staff view, so a new action cannot leak by default', () => {
  const src = readFileSync(new URL('../workers/src/handlers/consign-d1.js', import.meta.url), 'utf8');
  const cases = [...src.matchAll(/case '(\w+)': return /g)].map((m) => m[1]);
  const owners = [...src.match(/const OWNER_ACTIONS = new Set\(\[([^\]]*)\]\)/)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
  assert.ok(cases.length >= 17);
  for (const a of cases) assert.ok(owners.includes(a) || STAFF_VIEW_ACTIONS.includes(a), `${a} has no staff view and is not owner only`);
  assert.ok(owners.includes('savePayment'));
  assert.throws(() => staffView('someNewAction', { anything: 1 }), /staff view/i);
});


test('the page sends the owner password at send time only: held entries never store it', () => {
  const src = readFileSync(new URL('../src/js/consign/api.js', import.meta.url), 'utf8');
  assert.match(src, /owner_password: pw/);
  const save = readFileSync(new URL('../src/js/consign/save.js', import.meta.url), 'utf8');
  assert.ok(!/owner_password/.test(save));
  const held = readFileSync(new URL('../src/js/consign/held.js', import.meta.url), 'utf8');
  assert.ok(!/owner_password/.test(held));
});
