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

const lines2 = [
  { cultivar: 'Alpha', type: 'tops', intake_lbs: 100 },
  { cultivar: 'Alpha', type: 'smalls', intake_lbs: 40 },
  { cultivar: 'Beta', type: 'tops' },
];

test('saveDropoff writes one dropoff and a lot per line, copying prices', async () => {
  const { env } = freshConsignDb();
  const farm = await seedFarm(env);
  await price(env, farm.id, 'Alpha', 'tops', 10);
  await price(env, farm.id, 'Alpha', 'smalls', 4);
  const d = await call(env, 'saveDropoff', { farm_id: farm.id, dropped_by: 'T', lines: lines2, client_key: 'k1' });
  assert.equal(d.lots.length, 3);
  const [aTops, aSmalls, bTops] = d.lots;
  assert.equal(aTops.price_per_lb, 10);
  assert.equal(aTops.smalls_price_per_lb, 4);
  assert.equal(aSmalls.price_per_lb, 4);
  assert.equal(aTops.term, 'dropoff');
  assert.ok(aTops.weighed_at);
  assert.equal(bTops.intake_lbs, null);
  assert.equal(bTops.weighed_at, null);
  assert.equal(bTops.money.needs_price, true);
  assert.equal(bTops.money.status, 'dropped');
  assert.ok(d.dropoff.dropped_at);
});

test('a later price change does not touch an existing lot', async () => {
  const { env } = freshConsignDb();
  const farm = await seedFarm(env);
  await price(env, farm.id, 'Alpha', 'tops', 10, { effective_from: '2026-01-01' });
  const d = await call(env, 'saveDropoff', { farm_id: farm.id, lines: [lines2[0]], client_key: 'k1' });
  await price(env, farm.id, 'Alpha', 'tops', 12);
  const again = await call(env, 'dropoff', { dropoff_id: d.dropoff.id });
  assert.equal(again.lots[0].price_per_lb, 10);
  const d2 = await call(env, 'saveDropoff', { farm_id: farm.id, lines: [lines2[0]], client_key: 'k2' });
  assert.equal(d2.lots[0].price_per_lb, 12);
});

test('resending the same client_key does not create a second dropoff', async () => {
  const { env, sqlite } = freshConsignDb();
  const farm = await seedFarm(env);
  await call(env, 'saveDropoff', { farm_id: farm.id, lines: lines2, client_key: 'k1' });
  const again = await call(env, 'saveDropoff', { farm_id: farm.id, lines: lines2, client_key: 'k1' });
  assert.equal(again.duplicate, true);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM cl_dropoffs').get().n, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM cl_lots').get().n, 3);
});

test('a bad line saves nothing', async () => {
  const { env, sqlite } = freshConsignDb();
  const farm = await seedFarm(env);
  const linesBad = [lines2[0], { cultivar: 'Beta', type: 'tops', intake_lbs: -5 }];
  await assert.rejects(handleConsignD1(post('saveDropoff', { farm_id: farm.id, lines: linesBad, client_key: 'k1' }), env, {}), /weight|positive/i);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM cl_dropoffs').get().n, 0);
});

test('one cultivar line can be split across terms, but not duplicated', async () => {
  const { env } = freshConsignDb();
  const farm = await seedFarm(env);
  const split = [{ cultivar: 'Alpha', type: 'tops', term: 'dropoff', intake_lbs: 30 }, { cultivar: 'Alpha', type: 'tops', term: 'sold', intake_lbs: 70 }];
  const d = await call(env, 'saveDropoff', { farm_id: farm.id, lines: split, client_key: 'k1' });
  assert.deepEqual(d.lots.map((l) => l.term), ['dropoff', 'sold']);
  const dup = [split[0], split[0]];
  await assert.rejects(handleConsignD1(post('saveDropoff', { farm_id: farm.id, lines: dup, client_key: 'k2' }), env, {}), /twice|duplicate/i);
});

test('saveDropoff rejects an unknown farm and an empty line list', async () => {
  const { env } = freshConsignDb();
  await assert.rejects(handleConsignD1(post('saveDropoff', { farm_id: 99, lines: lines2 }), env, {}), /farm/i);
  const farm = await seedFarm(env);
  await assert.rejects(handleConsignD1(post('saveDropoff', { farm_id: farm.id, lines: [] }), env, {}), /line/i);
});

async function dropTwo(env) {
  const farm = await seedFarm(env);
  await price(env, farm.id, 'Alpha', 'tops', 10);
  await price(env, farm.id, 'Alpha', 'smalls', 4);
  const d = await call(env, 'saveDropoff', { farm_id: farm.id, client_key: 'k1', lines: [{ cultivar: 'Alpha', type: 'tops' }, { cultivar: 'Alpha', type: 'smalls', intake_lbs: 40 }] });
  return { farm, tops: d.lots[0], smalls: d.lots[1] };
}
const goodRun = { pulled_lbs: 100, final_lbs: 80, to_smalls_lbs: 10, biomass_lbs: 8, mold_lbs: 2, finishes_lot: true };

test('setWeight fills a late weight and stamps weighed_at', async () => {
  const { env } = freshConsignDb();
  const { tops } = await dropTwo(env);
  const { lot } = await call(env, 'setWeight', { lot_id: tops.id, intake_lbs: 100, actor: 'T' });
  assert.equal(lot.intake_lbs, 100);
  assert.ok(lot.weighed_at);
  assert.equal(lot.money.status, 'weighed');
});

test('a lot cannot be screened before it is weighed', async () => {
  const { env } = freshConsignDb();
  const { tops } = await dropTwo(env);
  await assert.rejects(handleConsignD1(post('saveScreenRun', { lot_id: tops.id, ...goodRun }), env, {}), /weigh/i);
});

test('a whole-lot run closes the lot and sets the money', async () => {
  const { env } = freshConsignDb();
  const { tops } = await dropTwo(env);
  await call(env, 'setWeight', { lot_id: tops.id, intake_lbs: 100 });
  const { lot } = await call(env, 'saveScreenRun', { lot_id: tops.id, ...goodRun, client_key: 'r1' });
  assert.equal(lot.money.status, 'closed');
  assert.equal(lot.money.owed, 840);
  assert.equal(lot.runs[0].diff_lbs, 0);
});

test('outputs that do not add up are refused, and the message says by how much', async () => {
  const { env, sqlite } = freshConsignDb();
  const { tops } = await dropTwo(env);
  await call(env, 'setWeight', { lot_id: tops.id, intake_lbs: 100 });
  await assert.rejects(handleConsignD1(post('saveScreenRun', { lot_id: tops.id, ...goodRun, final_lbs: 70 }), env, {}), /10/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM cl_screen_runs').get().n, 0);
});

test('a small difference inside the tolerance is saved and recorded', async () => {
  const { env } = freshConsignDb();
  const { tops } = await dropTwo(env);
  await call(env, 'setWeight', { lot_id: tops.id, intake_lbs: 100 });
  const { lot } = await call(env, 'saveScreenRun', { lot_id: tops.id, ...goodRun, final_lbs: 79.4 });
  assert.equal(lot.runs[0].diff_lbs, 0.6);
});

test('split screening: two runs, the second closes the lot', async () => {
  const { env } = freshConsignDb();
  const { tops } = await dropTwo(env);
  await call(env, 'setWeight', { lot_id: tops.id, intake_lbs: 100 });
  const a = await call(env, 'saveScreenRun', { lot_id: tops.id, pulled_lbs: 40, final_lbs: 30, to_smalls_lbs: 5, biomass_lbs: 4, mold_lbs: 1, finishes_lot: false });
  assert.equal(a.lot.money.status, 'screening');
  assert.equal(a.lot.money.remainder_lbs, 60);
  const b = await call(env, 'saveScreenRun', { lot_id: tops.id, pulled_lbs: 60, final_lbs: 50, to_smalls_lbs: 5, biomass_lbs: 4, mold_lbs: 1, finishes_lot: true });
  assert.equal(b.lot.money.status, 'closed');
  assert.equal(b.lot.money.owed, 80 * 10 + 10 * 4);
});

test('cannot pull more than is left, screen a closed lot, or turn smalls to smalls', async () => {
  const { env } = freshConsignDb();
  const { tops, smalls } = await dropTwo(env);
  await call(env, 'setWeight', { lot_id: tops.id, intake_lbs: 100 });
  await assert.rejects(handleConsignD1(post('saveScreenRun', { lot_id: tops.id, ...goodRun, pulled_lbs: 150, final_lbs: 130 }), env, {}), /left|more than/i);
  await call(env, 'saveScreenRun', { lot_id: tops.id, ...goodRun });
  await assert.rejects(handleConsignD1(post('saveScreenRun', { lot_id: tops.id, ...goodRun }), env, {}), /closed/i);
  await assert.rejects(handleConsignD1(post('saveScreenRun', { lot_id: smalls.id, pulled_lbs: 40, final_lbs: 30, to_smalls_lbs: 5, biomass_lbs: 4, mold_lbs: 1 }), env, {}), /smalls/i);
});

test('resending a run with the same client_key does not double it', async () => {
  const { env, sqlite } = freshConsignDb();
  const { tops } = await dropTwo(env);
  await call(env, 'setWeight', { lot_id: tops.id, intake_lbs: 100 });
  await call(env, 'saveScreenRun', { lot_id: tops.id, ...goodRun, client_key: 'r1' });
  await call(env, 'saveScreenRun', { lot_id: tops.id, ...goodRun, client_key: 'r1' });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM cl_screen_runs').get().n, 1);
});

test('setWeight correction is refused below what was already pulled, and is logged', async () => {
  const { env, sqlite } = freshConsignDb();
  const { tops } = await dropTwo(env);
  await call(env, 'setWeight', { lot_id: tops.id, intake_lbs: 100 });
  await call(env, 'saveScreenRun', { lot_id: tops.id, pulled_lbs: 40, final_lbs: 30, to_smalls_lbs: 5, biomass_lbs: 4, mold_lbs: 1 });
  await assert.rejects(handleConsignD1(post('setWeight', { lot_id: tops.id, intake_lbs: 20 }), env, {}), /pulled/i);
  await call(env, 'setWeight', { lot_id: tops.id, intake_lbs: 90, actor: 'T' });
  const h = sqlite.prepare("SELECT * FROM cl_history WHERE tbl = 'cl_lots' AND action = 'setWeight' ORDER BY id DESC").get();
  assert.match(h.before_json, /100/);
  assert.match(h.after_json, /90/);
  assert.equal(h.actor, 'T');
});

export { dropTwo, goodRun };
