// A dropoff can carry a past date (catch-up entry). Real SQLite, no mocks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshConsignDb, post, sqliteOk } from './helpers/consign-sqlite.mjs';
import { handleConsignD1 } from '../workers/src/handlers/consign-d1.js';

const opts = { skip: !sqliteOk };
const call = async (env, action, body) => (await handleConsignD1(post(action, { owner_password: 'owner-pw', ...body }), env, {})).json();
const data = async (env, action, body) => (await call(env, action, body)).data;
async function refused(env, action, body) {
  try { await call(env, action, body); } catch (e) { return e; }
  throw new Error(`${action} was not refused`);
}
const pacificToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const daysAgo = (n) => new Date(Date.parse(`${pacificToday()}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);

async function seed(env) {
  const { farm } = await data(env, 'saveFarm', { name: 'Farm A' });
  await data(env, 'savePricePoint', { farm_id: farm.id, cultivar: 'Alpha', type: 'tops', price_per_lb: 10, effective_from: daysAgo(30) });
  await data(env, 'savePricePoint', { farm_id: farm.id, cultivar: 'Alpha', type: 'tops', price_per_lb: 12, effective_from: daysAgo(5) });
  return farm;
}

test('a past date is stored at noon Pacific and uses the price in force that day', opts, async () => {
  const { env } = freshConsignDb();
  const farm = await seed(env);
  const day = daysAgo(10);
  const d = await data(env, 'saveDropoff', { farm_id: farm.id, dropped_on: day, client_key: 'k1', lines: [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 20 }] });
  assert.equal(d.dropoff.dropped_at, `${day} 20:00:00`);
  assert.equal(d.lots[0].price_per_lb, 10, 'the older price, not the one that started later');
  const now = await data(env, 'saveDropoff', { farm_id: farm.id, client_key: 'k2', lines: [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 20 }] });
  assert.equal(now.lots[0].price_per_lb, 12);
  assert.notEqual(now.dropoff.dropped_at.slice(11), '20:00:00');
  // Newest first on the farm page: today's entry above the back-dated one.
  const f = await data(env, 'farm', { farm_id: farm.id });
  assert.deepEqual(f.dropoffs.map((x) => x.id), [now.dropoff.id, d.dropoff.id]);
});

test("today's date, an empty date and no date all mean now", opts, async () => {
  const { env } = freshConsignDb();
  const farm = await seed(env);
  for (const [i, dropped_on] of [pacificToday(), '', null, undefined].entries()) {
    const d = await data(env, 'saveDropoff', { farm_id: farm.id, dropped_on, client_key: `k${i}`, lines: [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 1 }] });
    assert.equal(d.dropoff.dropped_at.slice(0, 4), String(new Date().getUTCFullYear()));
    assert.equal(d.lots[0].price_per_lb, 12);
  }
});

test('a future date, a date over a year back and a bad date are refused; nothing is saved', opts, async () => {
  const { env, sqlite } = freshConsignDb();
  const farm = await seed(env);
  for (const dropped_on of [daysAgo(-1), daysAgo(400), '2026-02-30', '11/04/2026', 'yesterday', 20261104]) {
    const e = await refused(env, 'saveDropoff', { farm_id: farm.id, dropped_on, client_key: `bad-${dropped_on}`, lines: [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 1 }] });
    assert.equal(e.code, 'VALIDATION_ERROR', String(dropped_on));
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM cl_dropoffs').get().n, 0);
});

test('a back-dated dropoff with a final still closes the lot, and a resend is not doubled', opts, async () => {
  const { env, sqlite } = freshConsignDb();
  const farm = await seed(env);
  const body = { farm_id: farm.id, dropped_on: daysAgo(3), client_key: 'kf',
    lines: [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 20, final: { final_lbs: 19, biomass_lbs: 1 } }] };
  const a = await data(env, 'saveDropoff', body);
  assert.equal(a.lots[0].money.status, 'closed');
  assert.equal(a.lots[0].money.final_lbs, 19);
  const b = await data(env, 'saveDropoff', body);
  assert.equal(b.duplicate, true);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM cl_dropoffs').get().n, 1);
});
