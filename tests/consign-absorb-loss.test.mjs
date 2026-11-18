// "We absorb the loss": a lot owed on dropoff is paid on its dropoff weight unless told otherwise.
// Real SQLite. This file does NOT call payOnFinalWeight(): it tests the default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshConsignDb, post, sqliteOk } from './helpers/consign-sqlite.mjs';
import { handleConsignD1 } from '../workers/src/handlers/consign-d1.js';
import { handleConsignFarmD1 } from '../workers/src/handlers/consign-farm-d1.js';
import { lotMoney } from '../workers/src/lib/consign-ledger.js';

const opts = { skip: !sqliteOk };
const owner = async (env, action, body) => (await (await handleConsignD1(post(action, { owner_password: 'owner-pw', ...body }), env, {})).json()).data;
const staff = async (env, action, body) => (await (await handleConsignD1(post(action, body), env, {})).json()).data;

async function world() {
  const { env, sqlite } = freshConsignDb();
  const { farm } = await owner(env, 'saveFarm', { name: 'Farm A' });
  await owner(env, 'savePricePoint', { farm_id: farm.id, cultivar: 'Alpha', type: 'tops', price_per_lb: 10, effective_from: '2026-01-01' });
  await owner(env, 'savePricePoint', { farm_id: farm.id, cultivar: 'Alpha', type: 'smalls', price_per_lb: 4, effective_from: '2026-01-01' });
  return { env, sqlite, farm };
}
const final99 = { final_lbs: 99, biomass_lbs: 1 };

test('default: paid on arrival, screened lower, no credit; the loss still shows', opts, async () => {
  const { env, farm } = await world();
  const d = await owner(env, 'saveDropoff', { farm_id: farm.id, client_key: 'k1', lines: [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100, final: final99 }] });
  const m = d.lots[0].money;
  assert.equal(d.lots[0].absorb_loss, 1);
  assert.equal(m.owed, 1000);
  assert.equal(m.final_lbs, 99);
  assert.equal(m.biomass_lbs, 1);
  assert.equal(m.estimate, false);
  await owner(env, 'savePayment', { farm_id: farm.id, amount: 1000, client_key: 'p1' });
  const t = (await owner(env, 'farm', { farm_id: farm.id })).totals;
  assert.equal(t.balance, 0);
  assert.equal(t.credit, 0);
});

test('a line can say the farm carries the loss: paid on the after-loss numbers, a credit to us', opts, async () => {
  const { env, farm } = await world();
  const d = await owner(env, 'saveDropoff', { farm_id: farm.id, client_key: 'k1',
    lines: [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100, final: final99, absorb_loss: false }] });
  assert.equal(d.lots[0].absorb_loss, 0);
  assert.equal(d.lots[0].money.owed, 990);
  await owner(env, 'savePayment', { farm_id: farm.id, amount: 1000, client_key: 'p1' });
  assert.equal((await owner(env, 'farm', { farm_id: farm.id })).totals.credit, 10);
});

test('the owner can flip a lot either way; history keeps it', opts, async () => {
  const { env, sqlite, farm } = await world();
  const d = await owner(env, 'saveDropoff', { farm_id: farm.id, client_key: 'k1', lines: [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100, final: final99 }] });
  const id = d.lots[0].id;
  assert.equal((await owner(env, 'setLotTerms', { lot_id: id, absorb_loss: false })).lot.money.owed, 990);
  assert.equal((await owner(env, 'setLotTerms', { lot_id: id, absorb_loss: true })).lot.money.owed, 1000);
  // Leaving it out keeps it.
  assert.equal((await owner(env, 'setLotTerms', { lot_id: id, price_per_lb: 11 })).lot.money.owed, 1100);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM cl_history WHERE action = 'setLotTerms'").get().n, 3);
});

test('a lot owed as sold never absorbs: it pays on what sold, and the flag stays off', opts, async () => {
  const { env, farm } = await world();
  const d = await owner(env, 'saveDropoff', { farm_id: farm.id, client_key: 'k1',
    lines: [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100, term: 'sold', absorb_loss: true }] });
  assert.equal(d.lots[0].absorb_loss, 0);
  assert.equal(d.lots[0].money.owed, 0);
  // Switching a dropoff lot to as-sold turns the flag off.
  const e = await owner(env, 'saveDropoff', { farm_id: farm.id, client_key: 'k2', lines: [{ cultivar: 'Alpha', type: 'smalls', intake_lbs: 10 }] });
  assert.equal(e.lots[0].absorb_loss, 1);
  assert.equal((await owner(env, 'setLotTerms', { lot_id: e.lots[0].id, term: 'sold' })).lot.absorb_loss, 0);
});

test('absorbing: tops that turned to smalls need no smalls price, and an unweighed lot owes nothing yet', opts, () => {
  const lot = { type: 'tops', term: 'dropoff', intake_lbs: 100, price_per_lb: 10, smalls_price_per_lb: null, absorb_loss: 1, closed_at: 'x' };
  const m = lotMoney(lot, [{ pulled_lbs: 100, final_lbs: 80, to_smalls_lbs: 15, biomass_lbs: 5, mold_lbs: 0 }]);
  assert.equal(m.owed, 1000);
  assert.equal(m.needs_price, false);
  const un = lotMoney({ type: 'tops', term: 'dropoff', intake_lbs: null, price_per_lb: 10, absorb_loss: 1 });
  assert.equal(un.owed, 0);
  assert.equal(un.estimate, true);
});

test('staff never see the flag; the farm page owes the same as the owner page', opts, async () => {
  const { env, farm } = await world();
  await owner(env, 'saveDropoff', { farm_id: farm.id, client_key: 'k1', lines: [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100, final: final99 }] });
  const s = JSON.stringify(await staff(env, 'farm', { farm_id: farm.id }));
  assert.ok(!s.includes('absorb_loss'));
  const { token } = await owner(env, 'issueFarmAccess', { farm_id: farm.id });
  const req = (action, body) => new Request(`https://x/api/consign-farm?action=${action}`, { method: 'POST', body: JSON.stringify(body) });
  const view = (await (await handleConsignFarmD1(req('setPin', { token, pin: '1234' }), env, {})).json()).data;
  assert.equal(view.totals.owed, 1000);
  assert.equal(view.dropoffs[0].lots[0].final_lbs, 99);
});

test('migration: lots that were owed on dropoff before take the usual case', opts, () => {
  const { sqlite } = freshConsignDb();
  // The helper applies 0071 to an empty table; replay its UPDATE on rows written the old way.
  sqlite.exec("INSERT INTO cl_farms (name) VALUES ('Farm A')");
  sqlite.exec("INSERT INTO cl_dropoffs (farm_id, client_key) VALUES (1, 'k')");
  sqlite.exec("INSERT INTO cl_lots (dropoff_id, farm_id, cultivar, type, term) VALUES (1, 1, 'Alpha', 'tops', 'dropoff'), (1, 1, 'Alpha', 'smalls', 'sold')");
  assert.deepEqual(sqlite.prepare('SELECT absorb_loss FROM cl_lots ORDER BY id').all().map((r) => r.absorb_loss), [0, 0]);
  sqlite.exec("UPDATE cl_lots SET absorb_loss = 1 WHERE term = 'dropoff'");
  assert.deepEqual(sqlite.prepare('SELECT absorb_loss FROM cl_lots ORDER BY id').all().map((r) => r.absorb_loss), [1, 0]);
});
