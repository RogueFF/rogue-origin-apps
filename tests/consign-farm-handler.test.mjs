// The partner farm's route, /api/consign-farm, against real SQLite (node:sqlite).
// Made-up farms, cultivars and prices only. Links are generated at run time.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { freshConsignDb, post, sqliteOk } from './helpers/consign-sqlite.mjs';
import { handleConsignD1 } from '../workers/src/handlers/consign-d1.js';
import { handleConsignFarmD1 } from '../workers/src/handlers/consign-farm-d1.js';
import { newToken } from '../workers/src/lib/consign-access.js';

before((t) => { if (!sqliteOk) t.skip('node:sqlite unavailable'); });

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const worker = (await import(join(REPO, 'workers/src/index.js').replace(/\\/g, '/').replace(/^/, 'file:///'))).default;
const wctx = { waitUntil() {} };

const OWNER = { owner_password: 'owner-pw' };
const staff = async (env, action, body = {}) => (await (await handleConsignD1(post(action, { ...body }), env, {})).json()).data;
const owner = (env, action, body = {}) => staff(env, action, { ...body, ...OWNER });

const farmReq = (action, body) => new Request(`https://x/api/consign-farm?action=${action}`, {
  method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body),
});
/** Clock the tests move by hand. */
function clock(start = '2026-11-17T16:00:00Z') {
  let t = new Date(start).getTime();
  const now = () => new Date(t);
  now.add = (min) => { t += min * 60000; };
  return now;
}
const farm = async (env, action, body, now = clock()) => (await (await handleConsignFarmD1(farmReq(action, body), env, {}, { now })).json()).data;
async function refused(env, action, body, now = clock()) {
  try { await handleConsignFarmD1(farmReq(action, body), env, {}, { now }); } catch (e) { return e; }
  throw new Error(`${action} was not refused`);
}
/** Through the real worker entry, so status codes and bodies are what a browser sees. */
async function viaWorker(env, path, action, body) {
  const res = await worker.fetch(new Request(`https://x${path}?action=${action}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) }), env, wctx);
  return { status: res.status, text: await res.text() };
}

/** Two farms with different cultivars, prices, notes and payments. */
async function seedTwo(env) {
  const { farm: a } = await owner(env, 'saveFarm', { name: 'Farm A', lang: 'es', contact: 'CONTACT-A' });
  const { farm: b } = await owner(env, 'saveFarm', { name: 'Farm B', default_term: 'sold', contact: 'CONTACT-B' });
  await owner(env, 'savePricePoint', { farm_id: a.id, cultivar: 'Alpha', type: 'tops', price_per_lb: 10, effective_from: '2026-01-01' });
  await owner(env, 'savePricePoint', { farm_id: a.id, cultivar: 'Alpha', type: 'smalls', price_per_lb: 4, effective_from: '2026-01-01' });
  await owner(env, 'savePricePoint', { farm_id: b.id, cultivar: 'Beta', type: 'tops', price_per_lb: 33, effective_from: '2026-01-01' });

  const da = await staff(env, 'saveDropoff', { farm_id: a.id, dropped_by: 'STAFF-NAME', note: 'INTERNAL-NOTE', client_key: 'ka1',
    lines: [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100, note: 'LOT-NOTE-HIDDEN' }, { cultivar: 'Alpha', type: 'smalls', intake_lbs: 40, note: 'Shown to the farm' }] });
  const [tops, smalls] = da.lots;
  await staff(env, 'saveScreenRun', { lot_id: tops.id, pulled_lbs: 100, final_lbs: 80, to_smalls_lbs: 10, biomass_lbs: 8, mold_lbs: 2, finishes_lot: true, note: 'RUN-NOTE', client_key: 'r1' });
  await owner(env, 'setLotTerms', { lot_id: smalls.id, note_visible: true });
  const dv = await staff(env, 'saveDropoff', { farm_id: a.id, client_key: 'ka2', lines: [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 5 }] });
  await staff(env, 'voidRow', { table: 'dropoff', id: dv.dropoff.id, reason: 'VOID-REASON' });
  await staff(env, 'savePayment', { farm_id: a.id, amount: 300, method: 'check', reference: '1001', note: 'PAY-NOTE', paid_on: '2026-11-10', client_key: 'pa1' });
  const pv = await staff(env, 'savePayment', { farm_id: a.id, amount: 77, method: 'cash', note: 'PAY-NOTE', paid_on: '2026-11-11', client_key: 'pa2' });
  await staff(env, 'voidRow', { table: 'payment', id: pv.payment.id, reason: 'VOID-REASON' });

  const db = await staff(env, 'saveDropoff', { farm_id: b.id, dropped_by: 'STAFF-B', note: 'B-NOTE', client_key: 'kb1',
    lines: [{ cultivar: 'Beta', type: 'tops', intake_lbs: 50, note: 'B-LOT-NOTE' }] });
  await owner(env, 'setLotTerms', { lot_id: db.lots[0].id, note_visible: true });
  await staff(env, 'savePayment', { farm_id: b.id, amount: 999, method: 'ach', reference: 'B-REF', paid_on: '2026-11-12', client_key: 'pb1' });

  const { token: ta } = await owner(env, 'issueFarmAccess', { farm_id: a.id });
  const { token: tb } = await owner(env, 'issueFarmAccess', { farm_id: b.id });
  return { a, b, ta, tb };
}

const B_VALUES = ['Farm B', 'Beta', 'B-NOTE', 'B-LOT-NOTE', 'B-REF', 'STAFF-B', 'CONTACT-B', '999', '33'];
const FORBIDDEN = ['STAFF-NAME', 'INTERNAL-NOTE', 'LOT-NOTE-HIDDEN', 'RUN-NOTE', 'PAY-NOTE', 'VOID-REASON', 'CONTACT-A', 'ka1', 'pa1', 'client_key', 'token_hash', 'pin_hash'];

test('router: /api/consign-farm is an exact match, beside /api/consign', () => {
  const src = readFileSync(join(REPO, 'workers/src/index.js'), 'utf8');
  assert.match(src, /path === '\/api\/consign-farm'\)/);
  assert.match(src, /'\/api\/consign', '\/api\/consign-farm'/);
});

test('each link returns only its own farm, and nothing internal', async () => {
  const { env } = freshConsignDb();
  const { ta, tb } = await seedTwo(env);
  const st = await farm(env, 'status', { token: ta });
  assert.deepEqual(st, { needs_pin: true, locked: false, minutes_left: 0, lang: 'es' });
  const va = await farm(env, 'setPin', { token: ta, pin: '1234' });
  const sa = JSON.stringify(va);
  for (const x of [...B_VALUES, ...FORBIDDEN]) assert.ok(!sa.includes(x), `Farm A reply carries ${x}`);
  assert.equal(va.farm.name, 'Farm A');
  assert.ok(sa.includes('Shown to the farm'));
  assert.equal(va.payments.length, 1, 'voided payment absent');
  assert.equal(va.dropoffs.length, 1, 'voided dropoff absent');

  const vb = await farm(env, 'setPin', { token: tb, pin: '9876' });
  const sb = JSON.stringify(vb);
  for (const x of ['Farm A', 'Alpha', 'Shown to the farm', '1001', ...FORBIDDEN]) assert.ok(!sb.includes(x), `Farm B reply carries ${x}`);
  assert.equal(vb.farm.name, 'Farm B');
});

test('status says nothing about the farm before the PIN', async () => {
  const { env } = freshConsignDb();
  const { ta } = await seedTwo(env);
  const st = await farm(env, 'status', { token: ta });
  assert.deepEqual(Object.keys(st).sort(), ['lang', 'locked', 'minutes_left', 'needs_pin']);
  await farm(env, 'setPin', { token: ta, pin: '1234' });
  assert.equal((await farm(env, 'status', { token: ta })).needs_pin, false);
});

test('totals equal the staff farm action for the same data', async () => {
  const { env } = freshConsignDb();
  const { a, ta } = await seedTwo(env);
  const v = await farm(env, 'setPin', { token: ta, pin: '1234' });
  const s = await staff(env, 'farm', { farm_id: a.id });
  for (const k of ['balance', 'owed', 'paid', 'estimate']) assert.equal(v.totals[k], s.totals[k], k);
  assert.equal(v.totals.owed, 840 + 160);
  assert.equal(v.totals.last_payment_on, '2026-11-10');
});

test('five wrong PINs lock the link; the right PIN is refused while locked; after 15 minutes it works', async () => {
  const { env } = freshConsignDb();
  const { ta } = await seedTwo(env);
  const now = clock();
  await farm(env, 'setPin', { token: ta, pin: '1234' }, now);
  for (let i = 1; i <= 4; i++) {
    const e = await refused(env, 'view', { token: ta, pin: '0000' }, now);
    assert.equal(e.code, 'VALIDATION_ERROR');
    assert.deepEqual(e.details, { tries_left: 5 - i });
  }
  const fifth = await refused(env, 'view', { token: ta, pin: '0000' }, now);
  assert.equal(fifth.code, 'RATE_LIMITED');
  assert.deepEqual(fifth.details, { locked: true, minutes_left: 15 });
  const sixth = await refused(env, 'view', { token: ta, pin: '1234' }, now);
  assert.equal(sixth.code, 'RATE_LIMITED', 'right PIN refused while locked');
  now.add(10);
  assert.deepEqual(await farm(env, 'status', { token: ta }, now), { needs_pin: false, locked: true, minutes_left: 5, lang: 'es' });
  assert.equal((await refused(env, 'view', { token: ta, pin: '1234' }, now)).details.minutes_left, 5);
  now.add(5);
  const v = await farm(env, 'view', { token: ta, pin: '1234' }, now);
  assert.equal(v.farm.name, 'Farm A');
});

test('after a lock runs out, the count starts over (one wrong try does not re-lock)', async () => {
  const { env, sqlite } = freshConsignDb();
  const { ta } = await seedTwo(env);
  const now = clock();
  await farm(env, 'setPin', { token: ta, pin: '1234' }, now);
  for (let i = 0; i < 5; i++) await refused(env, 'view', { token: ta, pin: '0000' }, now);
  now.add(16);
  const e = await refused(env, 'view', { token: ta, pin: '0000' }, now);
  assert.deepEqual(e.details, { tries_left: 4 });
  await farm(env, 'view', { token: ta, pin: '1234' }, now);
  assert.equal(sqlite.prepare('SELECT failed_tries FROM cl_farm_access WHERE revoked_at IS NULL AND pin_hash IS NOT NULL').get().failed_tries, 0);
});

test('parallel wrong PINs never get more than five tries past the lock', async () => {
  const { env, sqlite } = freshConsignDb();
  const { ta } = await seedTwo(env);
  const now = clock();
  await farm(env, 'setPin', { token: ta, pin: '1234' }, now);
  const pins = Array.from({ length: 20 }, (_, i) => String(1000 + i * 37).padStart(4, '0')).filter((p) => p !== '1234');
  const errs = await Promise.all(pins.map((pin) => refused(env, 'view', { token: ta, pin }, now)));
  // Four "wrong, N left" replies, then every other try refused as locked; the count stops at five.
  assert.equal(errs.filter((e) => e.code === 'VALIDATION_ERROR').length, 4);
  assert.equal(errs.filter((e) => e.code === 'RATE_LIMITED').length, pins.length - 4);
  assert.equal(sqlite.prepare('SELECT failed_tries FROM cl_farm_access WHERE pin_hash IS NOT NULL').get().failed_tries, 5);
  assert.equal((await refused(env, 'view', { token: ta, pin: '1234' }, now)).code, 'RATE_LIMITED');
});

test('a correct PIN resets the count', async () => {
  const { env } = freshConsignDb();
  const { ta } = await seedTwo(env);
  const now = clock();
  await farm(env, 'setPin', { token: ta, pin: '1234' }, now);
  for (let i = 0; i < 4; i++) await refused(env, 'view', { token: ta, pin: '0000' }, now);
  await farm(env, 'view', { token: ta, pin: '1234' }, now);
  assert.deepEqual((await refused(env, 'view', { token: ta, pin: '0000' }, now)).details, { tries_left: 4 });
});

test('setPin only once; a second setPin is refused and the PIN is unchanged', async () => {
  const { env } = freshConsignDb();
  const { ta } = await seedTwo(env);
  await farm(env, 'setPin', { token: ta, pin: '1234' });
  const e = await refused(env, 'setPin', { token: ta, pin: '5555' });
  assert.match(e.message, /already set/);
  await farm(env, 'view', { token: ta, pin: '1234' });
  assert.equal((await refused(env, 'view', { token: ta, pin: '5555' })).code, 'VALIDATION_ERROR');
});

test('two racing first opens: only one PIN wins', async () => {
  const { env } = freshConsignDb();
  const { ta } = await seedTwo(env);
  const r = await Promise.allSettled([farm(env, 'setPin', { token: ta, pin: '1111' }), farm(env, 'setPin', { token: ta, pin: '2222' })]);
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
});

test('view before a PIN is set, and malformed PINs, are refused without counting', async () => {
  const { env, sqlite } = freshConsignDb();
  const { ta } = await seedTwo(env);
  assert.deepEqual((await refused(env, 'view', { token: ta, pin: '1234' })).details, { needs_pin: true });
  for (const pin of ['123', '12345', 1234, 'abcd', null]) assert.equal((await refused(env, 'setPin', { token: ta, pin })).code, 'VALIDATION_ERROR');
  await farm(env, 'setPin', { token: ta, pin: '1234' });
  for (const pin of ['123', 1234, '']) assert.equal((await refused(env, 'view', { token: ta, pin })).code, 'VALIDATION_ERROR');
  assert.equal(sqlite.prepare('SELECT MAX(failed_tries) AS n FROM cl_farm_access').get().n, 0);
});

test('unknown, revoked and malformed links: one identical generic refusal, from status and view', async () => {
  const { env } = freshConsignDb();
  const { a, ta } = await seedTwo(env);
  await farm(env, 'setPin', { token: ta, pin: '1234' });
  await owner(env, 'revokeFarmAccess', { farm_id: a.id });
  for (const action of ['status', 'view', 'setPin']) {
    const replies = [];
    for (const token of [newToken(), ta, 'not-a-link', undefined]) replies.push(await viaWorker(env, '/api/consign-farm', action, { token, pin: '1234' }));
    for (const r of replies) assert.equal(r.status, 401);
    assert.equal(new Set(replies.map((r) => r.text)).size, 1, `${action}: replies differ`);
  }
});

test('reissue kills the old link and its PIN; the new link needs a new PIN', async () => {
  const { env } = freshConsignDb();
  const { a, ta } = await seedTwo(env);
  await farm(env, 'setPin', { token: ta, pin: '1234' });
  const { token: t2 } = await owner(env, 'issueFarmAccess', { farm_id: a.id });
  assert.notEqual(t2, ta);
  assert.equal((await refused(env, 'view', { token: ta, pin: '1234' })).code, 'UNAUTHORIZED');
  assert.deepEqual(await farm(env, 'status', { token: t2 }), { needs_pin: true, locked: false, minutes_left: 0, lang: 'es' });
  assert.equal((await refused(env, 'view', { token: t2, pin: '1234' })).code, 'VALIDATION_ERROR');
});

test('a body carrying farm_id for the other farm changes nothing', async () => {
  const { env } = freshConsignDb();
  const { b, ta } = await seedTwo(env);
  await farm(env, 'setPin', { token: ta, pin: '1234', farm_id: b.id });
  const v = await farm(env, 'view', { token: ta, pin: '1234', farm_id: b.id, farmId: b.id, id: b.id });
  assert.equal(v.farm.name, 'Farm A');
  assert.ok(!JSON.stringify(v).includes('Beta'));
});

test('the two doors stay separate', async () => {
  const { env } = freshConsignDb();
  const { ta } = await seedTwo(env);
  await farm(env, 'setPin', { token: ta, pin: '1234' });
  // The shared password alone does not open the farm route: the same generic refusal.
  const generic = await viaWorker(env, '/api/consign-farm', 'view', { token: 'x', pin: '1234' });
  const pwOnly = await viaWorker(env, '/api/consign-farm', 'view', { password: 'pw', pin: '1234' });
  assert.equal(pwOnly.status, 401);
  assert.equal(pwOnly.text, generic.text);
  const bearer = await worker.fetch(new Request('https://x/api/consign-farm?action=status', { method: 'POST', headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer pw' }, body: '{}' }), env, wctx);
  assert.equal(bearer.status, 401);
  // A farm link + PIN do not open the staff route.
  for (const body of [{ token: ta, pin: '1234' }, { password: ta }, { password: '1234' }]) {
    const r = await viaWorker(env, '/api/consign', 'farms', body);
    assert.equal(r.status, 401);
  }
  // The token is read from the body only, never the query string.
  const q = await worker.fetch(new Request(`https://x/api/consign-farm?action=status&token=${ta}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' }), env, wctx);
  assert.equal(q.status, 401);
});

test('GET is refused', async () => {
  const { env } = freshConsignDb();
  const res = await worker.fetch(new Request('https://x/api/consign-farm?action=status'), env, wctx);
  assert.equal(res.status, 404);
});

test('voided lots, runs and sold entries are absent; a sold lot shows on hand and sold', async () => {
  const { env } = freshConsignDb();
  const { b, tb } = await seedTwo(env);
  const d = await staff(env, 'saveDropoff', { farm_id: b.id, client_key: 'kb2', lines: [{ cultivar: 'Beta', type: 'smalls', term: 'sold', intake_lbs: 20 }, { cultivar: 'Gone', type: 'tops', intake_lbs: 9 }] });
  const [sm, gone] = d.lots;
  await staff(env, 'voidRow', { table: 'lot', id: gone.id, reason: 'VOID-REASON' });
  const run = await staff(env, 'saveScreenRun', { lot_id: sm.id, pulled_lbs: 20, final_lbs: 20, client_key: 'rb1' });
  await staff(env, 'saveSold', { lot_id: sm.id, lbs: 5, client_key: 'sb1', note: 'SOLD-NOTE' });
  const s2 = await staff(env, 'saveSold', { lot_id: sm.id, lbs: 3, client_key: 'sb2', note: 'SOLD-NOTE' });
  const soldId = s2.lot.sold.find((x) => x.client_key === 'sb2').id;
  await staff(env, 'voidRow', { table: 'sold', id: soldId, reason: 'VOID-REASON' });
  const v = await farm(env, 'setPin', { token: tb, pin: '1234' });
  const lots = v.dropoffs.flatMap((x) => x.lots);
  assert.ok(!lots.some((l) => l.cultivar === 'Gone'));
  const l = lots.find((x) => x.id === sm.id);
  assert.equal(l.sold_lbs, 5);
  assert.equal(l.on_hand_lbs, 15);
  assert.equal(l.final_lbs, 20);
  const s = JSON.stringify(v);
  for (const x of ['SOLD-NOTE', 'VOID-REASON', 'sb1', 'rb1']) assert.ok(!s.includes(x), x);
  // A voided run drops out too.
  const runId = run.lot.runs[0].id;
  await staff(env, 'voidRow', { table: 'run', id: runId, reason: 'VOID-REASON' });
  const v2 = await farm(env, 'view', { token: tb, pin: '1234' });
  assert.equal(v2.dropoffs.flatMap((x) => x.lots).find((x) => x.id === sm.id).final_lbs, null);
});

test('last_seen_at is set on a good PIN', async () => {
  const { env, sqlite } = freshConsignDb();
  const { ta } = await seedTwo(env);
  const now = clock('2026-11-17T16:00:00Z');
  await farm(env, 'setPin', { token: ta, pin: '1234' }, now);
  now.add(60);
  await farm(env, 'view', { token: ta, pin: '1234' }, now);
  assert.equal(sqlite.prepare('SELECT last_seen_at FROM cl_farm_access WHERE pin_hash IS NOT NULL').get().last_seen_at, '2026-11-17 17:00:00');
});

/* ---------- owner actions on the staff route ---------- */

test('issueFarmAccess and revokeFarmAccess are owner only', async () => {
  const { env } = freshConsignDb();
  const { a } = await seedTwo(env);
  for (const action of ['issueFarmAccess', 'revokeFarmAccess']) {
    await assert.rejects(handleConsignD1(post(action, { farm_id: a.id }), env, {}), /owner/i);
    await assert.rejects(handleConsignD1(post(action, { farm_id: a.id, owner_password: 'nope' }), env, {}), /owner/i);
  }
  await assert.rejects(handleConsignD1(post('issueFarmAccess', { farm_id: 999, ...OWNER }), env, {}), /Unknown farm/);
});

test('issueFarmAccess returns the link once; only its hash is stored; history has neither', async () => {
  const { env, sqlite } = freshConsignDb();
  const { a } = await seedTwo(env);
  const out = await owner(env, 'issueFarmAccess', { farm_id: a.id });
  assert.deepEqual(Object.keys(out), ['token']);
  assert.match(out.token, /^[A-Za-z0-9_-]{43}$/);
  const rows = sqlite.prepare('SELECT * FROM cl_farm_access').all();
  assert.ok(!JSON.stringify(rows).includes(out.token), 'raw link stored');
  const hashes = rows.map((r) => r.token_hash);
  const hist = JSON.stringify(sqlite.prepare('SELECT * FROM cl_history').all());
  assert.ok(!hist.includes(out.token));
  for (const h of hashes) assert.ok(!hist.includes(h), 'hash in history');
  assert.match(hist, /issueFarmAccess/);
  // Earlier links of the same farm are revoked in the same batch; the other farm's is not.
  const live = sqlite.prepare('SELECT farm_id, COUNT(*) AS n FROM cl_farm_access WHERE revoked_at IS NULL GROUP BY farm_id').all();
  assert.deepEqual(live.map((r) => [r.farm_id, r.n]), [[1, 1], [2, 1]]);
});

test('staff farm read carries the link state, never a hash', async () => {
  const { env, sqlite } = freshConsignDb();
  const { farm: c } = await owner(env, 'saveFarm', { name: 'Farm C' });
  assert.equal((await staff(env, 'farm', { farm_id: c.id })).access, null);
  const { token: t } = await owner(env, 'issueFarmAccess', { farm_id: c.id });
  let acc = (await staff(env, 'farm', { farm_id: c.id })).access;
  assert.deepEqual(Object.keys(acc).sort(), ['active', 'issued_at', 'last_seen_at', 'locked', 'pin_set']);
  assert.equal(acc.active, true);
  assert.equal(acc.pin_set, false);
  assert.equal(acc.last_seen_at, null);
  await farm(env, 'setPin', { token: t, pin: '1234' }, () => new Date());
  const reply = await staff(env, 'farm', { farm_id: c.id });
  acc = reply.access;
  assert.equal(acc.pin_set, true);
  assert.ok(acc.last_seen_at);
  const row = sqlite.prepare('SELECT token_hash, pin_hash FROM cl_farm_access').get();
  const s = JSON.stringify(reply);
  assert.ok(!s.includes(row.token_hash) && !s.includes(row.pin_hash) && !s.includes(t));
  for (let i = 0; i < 5; i++) await refused(env, 'view', { token: t, pin: '0000' }, () => new Date());
  assert.equal((await staff(env, 'farm', { farm_id: c.id })).access.locked, true);
  const off = await owner(env, 'revokeFarmAccess', { farm_id: c.id });
  assert.equal(off.revoked, 1);
  assert.equal(off.access.active, false);
  assert.equal(off.access.locked, false);
});

test('setLotTerms sets note_visible (owner), logged in history; default stays hidden', async () => {
  const { env, sqlite } = freshConsignDb();
  const { farm: c } = await owner(env, 'saveFarm', { name: 'Farm C' });
  const d = await staff(env, 'saveDropoff', { farm_id: c.id, client_key: 'kc', lines: [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 10, note: 'Damp bag' }] });
  const id = d.lots[0].id;
  assert.equal(d.lots[0].note_visible, 0);
  let r = await owner(env, 'setLotTerms', { lot_id: id, note_visible: true });
  assert.equal(r.lot.note_visible, 1);
  r = await owner(env, 'setLotTerms', { lot_id: id, price_per_lb: 11 });
  assert.equal(r.lot.note_visible, 1, 'unchanged when not sent');
  r = await owner(env, 'setLotTerms', { lot_id: id, note_visible: false });
  assert.equal(r.lot.note_visible, 0);
  const h = sqlite.prepare("SELECT after_json FROM cl_history WHERE action = 'setLotTerms' ORDER BY id").all().map((x) => JSON.parse(x.after_json).note_visible);
  assert.deepEqual(h, [1, 1, 0]);
  await assert.rejects(handleConsignD1(post('setLotTerms', { lot_id: id, note_visible: true }), env, {}), /owner/i);
});
