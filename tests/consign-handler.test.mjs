import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshConsignDb, post, sqliteOk } from './helpers/consign-sqlite.mjs';
import { handleConsignD1 } from '../workers/src/handlers/consign-d1.js';

before((t) => { if (!sqliteOk) t.skip('node:sqlite unavailable'); });

const call = async (env, action, body, opts) => {
  const res = await handleConsignD1(post(action, body, opts), env, {});
  return (await res.json()).data;
};
const OWNER = { owner_password: 'owner-pw' };

test('every action needs the shared password', async () => {
  const { env } = freshConsignDb();
  await assert.rejects(handleConsignD1(post('farms', {}, { auth: false }), env, {}), /Password required/);
});

test('unknown action is NOT_FOUND', async () => {
  const { env } = freshConsignDb();
  await assert.rejects(handleConsignD1(post('nope'), env, {}), /Unknown consign action/);
});

test('owner actions refuse without the owner secret, and when it is not configured', async () => {
  const { env } = freshConsignDb();
  await assert.rejects(handleConsignD1(post('saveFarm', { name: 'Farm A' }), env, {}), /owner/i);
  await assert.rejects(handleConsignD1(post('saveFarm', { name: 'Farm A', owner_password: 'wrong' }), env, {}), /owner/i);
  delete env.CONSIGN_OWNER_PASSWORD;
  await assert.rejects(handleConsignD1(post('saveFarm', { name: 'Farm A', ...OWNER }), env, {}), /owner/i);
});

test('router matches /api/consign exactly, after /api/consignment', () => {
  const src = readFileSync(new URL('../workers/src/index.js', import.meta.url), 'utf8');
  assert.match(src, /path === '\/api\/consign' \|\| path\.startsWith\('\/api\/consign\/'\)/);
  assert.ok(src.indexOf("startsWith('/api/consignment')") < src.indexOf("path === '/api/consign'"));
});

export { call, OWNER };

async function seedFarm(env, o = {}) {
  const { farm } = await call(env, 'saveFarm', { name: 'Farm A', default_term: 'dropoff', ...o, ...OWNER });
  return farm;
}
async function price(env, farmId, cultivar, type, p, extra = {}) {
  return call(env, 'savePricePoint', { farm_id: farmId, cultivar, type, price_per_lb: p, ...extra, ...OWNER });
}

test('saveFarm inserts, then updates by id', async () => {
  const { env } = freshConsignDb();
  const farm = await seedFarm(env);
  assert.equal(farm.default_term, 'dropoff');
  const { farm: again } = await call(env, 'saveFarm', { id: farm.id, name: 'Farm A', default_term: 'sold', ...OWNER });
  assert.equal(again.id, farm.id);
  assert.equal(again.default_term, 'sold');
});

test('saveFarm rejects an empty name and a bad term', async () => {
  const { env } = freshConsignDb();
  await assert.rejects(handleConsignD1(post('saveFarm', { name: ' ', ...OWNER }), env, {}), /name/i);
  await assert.rejects(handleConsignD1(post('saveFarm', { name: 'Farm A', default_term: 'x', ...OWNER }), env, {}), /term/i);
});

test('savePricePoint rejects zero and negative prices', async () => {
  const { env } = freshConsignDb();
  const farm = await seedFarm(env);
  await assert.rejects(handleConsignD1(post('savePricePoint', { farm_id: farm.id, cultivar: 'Alpha', type: 'tops', price_per_lb: 0, ...OWNER }), env, {}), /price/i);
});

export { seedFarm, price };
