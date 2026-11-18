// End-to-end money scenarios for the consignment lot ledger, through the
// handler only. Design: docs/plans/2026-11-16-consignment-lot-ledger-design.md §6.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshConsignDb, post, sqliteOk, payOnFinalWeight } from './helpers/consign-sqlite.mjs';

// These tests are about lots paid on their after-loss numbers.
payOnFinalWeight();
import { handleConsignD1 } from '../workers/src/handlers/consign-d1.js';

before((t) => { if (!sqliteOk) t.skip('node:sqlite unavailable'); });

const OWNER = { owner_password: 'owner-pw' };
const call = async (env, action, body) => {
  const res = await handleConsignD1(post(action, body), env, {});
  return (await res.json()).data;
};
// Totals are money: only the owner gets them (staff money lock).
const totals = async (env, farmId) => (await call(env, 'farm', { farm_id: farmId, ...OWNER })).totals;

async function setup(env, { term = 'dropoff', prices = true } = {}) {
  const { farm } = await call(env, 'saveFarm', { name: 'Farm A', default_term: term, ...OWNER });
  if (prices) {
    await call(env, 'savePricePoint', { farm_id: farm.id, cultivar: 'Alpha', type: 'tops', price_per_lb: 10, effective_from: '2026-01-01', ...OWNER });
    await call(env, 'savePricePoint', { farm_id: farm.id, cultivar: 'Alpha', type: 'smalls', price_per_lb: 4, effective_from: '2026-01-01', ...OWNER });
  }
  return farm;
}
let keyN = 0;
const drop = (env, farmId, lines) => call(env, 'saveDropoff', { farm_id: farmId, lines, client_key: `d${++keyN}` });

test('paid on dropoff, screened lower: the credit owed to us carries forward', async () => {
  const { env } = freshConsignDb();
  const farm = await setup(env);
  const d = await drop(env, farm.id, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100 }]);
  let t = await totals(env, farm.id);
  assert.equal(t.owed, 1000);
  assert.equal(t.estimate, true);

  await call(env, 'savePayment', { farm_id: farm.id, amount: 1000, method: 'check', client_key: 'p1', ...OWNER });
  t = await totals(env, farm.id);
  assert.equal(t.balance, 0);

  await call(env, 'saveScreenRun', { lot_id: d.lots[0].id, pulled_lbs: 100, final_lbs: 80, to_smalls_lbs: 10, biomass_lbs: 8, mold_lbs: 2, finishes_lot: true });
  t = await totals(env, farm.id);
  assert.equal(t.owed, 840);
  assert.equal(t.balance, -160);
  assert.equal(t.credit, 160);
  assert.equal(t.estimate, false);

  await drop(env, farm.id, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 50 }]);
  t = await totals(env, farm.id);
  assert.equal(t.owed, 1340);
  assert.equal(t.balance, 340);
  assert.equal(t.credit, 0);
});

test('dropped with no weights, weighed days later', async () => {
  const { env } = freshConsignDb();
  const farm = await setup(env);
  const d = await drop(env, farm.id, [{ cultivar: 'Alpha', type: 'tops' }, { cultivar: 'Alpha', type: 'smalls' }]);
  assert.equal((await totals(env, farm.id)).owed, 0);
  let o = await call(env, 'open');
  assert.deepEqual(o.to_weigh.map((l) => l.id), d.lots.map((l) => l.id));
  assert.equal(o.to_screen.length, 0);

  await call(env, 'setWeight', { lot_id: d.lots[0].id, intake_lbs: 100 });
  await call(env, 'setWeight', { lot_id: d.lots[1].id, intake_lbs: 20 });
  assert.equal((await totals(env, farm.id)).owed, 1000 + 80);
  o = await call(env, 'open');
  assert.equal(o.to_weigh.length, 0);
  assert.deepEqual(o.to_screen.map((l) => l.id), d.lots.map((l) => l.id));
});

test('split screening: owed after each run', async () => {
  const { env } = freshConsignDb();
  const farm = await setup(env);
  const d = await drop(env, farm.id, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100 }]);
  const lotId = d.lots[0].id;
  const a = await call(env, 'saveScreenRun', { lot_id: lotId, pulled_lbs: 40, final_lbs: 30, to_smalls_lbs: 5, biomass_lbs: 4, mold_lbs: 1, finishes_lot: false });
  assert.equal(a.lot.money.status, 'screening');
  assert.equal((await totals(env, farm.id)).owed, 30 * 10 + 5 * 4 + 60 * 10);
  const b = await call(env, 'saveScreenRun', { lot_id: lotId, pulled_lbs: 60, final_lbs: 50, to_smalls_lbs: 5, biomass_lbs: 4, mold_lbs: 1, finishes_lot: true });
  assert.equal(b.lot.money.status, 'closed');
  const t = await totals(env, farm.id);
  assert.equal(t.owed, 80 * 10 + 10 * 4);
  assert.equal(t.estimate, false);
});

test('price change mid-season applies to later dropoffs only', async () => {
  const { env } = freshConsignDb();
  const farm = await setup(env);
  const d1 = await drop(env, farm.id, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 10 }]);
  await call(env, 'savePricePoint', { farm_id: farm.id, cultivar: 'Alpha', type: 'tops', price_per_lb: 12, ...OWNER });
  const d2 = await drop(env, farm.id, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 10 }]);
  const f = await call(env, 'farm', { farm_id: farm.id, ...OWNER });
  const lot = (id) => f.dropoffs.flatMap((x) => x.lots).find((l) => l.id === id);
  assert.equal(lot(d1.lots[0].id).money.owed, 100);
  assert.equal(lot(d2.lots[0].id).money.owed, 120);
  assert.equal(f.totals.owed, 220);
});

test('partly on consignment: a line split across terms', async () => {
  const { env } = freshConsignDb();
  const farm = await setup(env);
  const d = await drop(env, farm.id, [
    { cultivar: 'Alpha', type: 'tops', term: 'dropoff', intake_lbs: 30 },
    { cultivar: 'Alpha', type: 'tops', term: 'sold', intake_lbs: 70 },
  ]);
  assert.equal((await totals(env, farm.id)).owed, 300);
  const consign = d.lots.find((l) => l.term === 'sold');
  const s = await call(env, 'saveSold', { lot_id: consign.id, lbs: 20, kind: 'main', client_key: 's1' });
  assert.equal(s.lot.money.on_hand_lbs, 50);
  assert.equal((await totals(env, farm.id)).owed, 500);
});

test('needs price: owed is zero until the owner prices it', async () => {
  const { env } = freshConsignDb();
  const farm = await setup(env);
  await drop(env, farm.id, [{ cultivar: 'Beta', type: 'tops', intake_lbs: 10 }]);
  let t = await totals(env, farm.id);
  assert.equal(t.owed, 0);
  assert.equal(t.needs_price, true);
  const p = await call(env, 'savePricePoint', { farm_id: farm.id, cultivar: 'Beta', type: 'tops', price_per_lb: 10, apply_to_unpriced: true, ...OWNER });
  assert.equal(p.lots_priced, 1);
  t = await totals(env, farm.id);
  assert.equal(t.owed, 100);
  assert.equal(t.needs_price, false);
});

test('voids correct the balance: a voided payment and a voided lot drop out', async () => {
  const { env } = freshConsignDb();
  const farm = await setup(env);
  const d = await drop(env, farm.id, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100 }, { cultivar: 'Alpha', type: 'smalls', intake_lbs: 10 }]);
  const { payment } = await call(env, 'savePayment', { farm_id: farm.id, amount: 500, client_key: 'p1', ...OWNER });
  let t = await totals(env, farm.id);
  assert.equal(t.owed, 1040);
  assert.equal(t.paid, 500);
  await call(env, 'voidRow', { table: 'payment', id: payment.id, reason: 'wrong farm', ...OWNER });
  t = await totals(env, farm.id);
  assert.equal(t.paid, 0);
  await call(env, 'voidRow', { table: 'lot', id: d.lots[1].id, reason: 'entered twice' });
  t = await totals(env, farm.id);
  assert.equal(t.owed, 1000);
  assert.equal(t.balance, 1000);
});
