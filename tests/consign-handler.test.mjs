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
