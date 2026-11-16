// A lot finished at dropoff: the dropoff line carries a Final lb (and where any
// difference went), and the lot is saved weighed, screened and closed in one batch.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshConsignDb, post, sqliteOk } from './helpers/consign-sqlite.mjs';
import { handleConsignD1 } from '../workers/src/handlers/consign-d1.js';

before((t) => { if (!sqliteOk) t.skip('node:sqlite unavailable'); });

const OWNER = { owner_password: 'owner-pw' };
const call = async (env, action, body) => (await (await handleConsignD1(post(action, body), env, {})).json()).data;
const refuse = (env, action, body, re) => assert.rejects(handleConsignD1(post(action, body), env, {}), re);
const count = (sqlite, tbl) => sqlite.prepare(`SELECT COUNT(*) AS n FROM ${tbl}`).get().n;

async function setup(env) {
  const { farm } = await call(env, 'saveFarm', { name: 'Farm A', default_term: 'dropoff', ...OWNER });
  for (const [cultivar, type, p] of [['Alpha', 'tops', 10], ['Alpha', 'smalls', 4], ['Beta', 'tops', 12], ['Beta', 'smalls', 5]]) {
    await call(env, 'savePricePoint', { farm_id: farm.id, cultivar, type, price_per_lb: p, effective_from: '2026-01-01', ...OWNER });
  }
  return farm;
}
const drop = (env, farm, lines, key = 'k1') => call(env, 'saveDropoff', { farm_id: farm.id, client_key: key, lines });

test('final equal to intake: lot saved weighed, screened and closed, owed at the lot price', async () => {
  const { env, sqlite } = freshConsignDb();
  const farm = await setup(env);
  const d = await drop(env, farm, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 50, final: { final_lbs: 50 } }]);
  const [lot] = d.lots;
  assert.equal(lot.intake_lbs, 50);
  assert.ok(lot.weighed_at);
  assert.ok(lot.closed_at);
  assert.equal(lot.runs.length, 1);
  assert.equal(lot.runs[0].pulled_lbs, 50);
  assert.equal(lot.runs[0].final_lbs, 50);
  assert.equal(lot.runs[0].diff_lbs, 0);
  assert.equal(lot.runs[0].client_key, 'k1#0');
  assert.equal(lot.money.status, 'closed');
  assert.equal(lot.money.estimate, false);
  assert.equal(lot.money.owed, 500);
  assert.equal(count(sqlite, 'cl_screen_runs'), 1);
});

test('tops with smalls, biomass and mold out of it: owed = final at lot price + smalls at smalls price', async () => {
  const { env } = freshConsignDb();
  const farm = await setup(env);
  const d = await drop(env, farm, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100, final: { final_lbs: 80, to_smalls_lbs: 10, biomass_lbs: 8, mold_lbs: 2 } }]);
  const [lot] = d.lots;
  assert.equal(lot.price_per_lb, 10);
  assert.equal(lot.smalls_price_per_lb, 4);
  assert.deepEqual([lot.runs[0].to_smalls_lbs, lot.runs[0].biomass_lbs, lot.runs[0].mold_lbs], [10, 8, 2]);
  assert.equal(lot.money.status, 'closed');
  assert.equal(lot.money.estimate, false);
  assert.equal(lot.money.owed, 80 * 10 + 10 * 4);
});

test('smalls with biomass only', async () => {
  const { env } = freshConsignDb();
  const farm = await setup(env);
  const d = await drop(env, farm, [{ cultivar: 'Alpha', type: 'smalls', intake_lbs: 40, final: { final_lbs: 36, biomass_lbs: 4 } }]);
  const [lot] = d.lots;
  assert.equal(lot.money.status, 'closed');
  assert.equal(lot.runs[0].mold_lbs, 0);
  assert.equal(lot.runs[0].to_smalls_lbs, 0);
  assert.equal(lot.money.owed, 36 * 4);
});

test('final-only line: intake = final + losses, nothing removed when losses are 0', async () => {
  const { env } = freshConsignDb();
  const farm = await setup(env);
  const d = await drop(env, farm, [
    { cultivar: 'Alpha', type: 'tops', final: { final_lbs: 70 } },
    { cultivar: 'Beta', type: 'tops', intake_lbs: '', final: { final_lbs: 60, biomass_lbs: 5 } },
  ]);
  const [a, b] = d.lots;
  assert.equal(a.intake_lbs, 70);
  assert.ok(a.weighed_at, 'a derived intake still stamps weighed_at');
  assert.equal(a.runs[0].pulled_lbs, 70);
  assert.equal(a.money.owed, 700);
  assert.equal(b.intake_lbs, 65);
  assert.equal(b.runs[0].pulled_lbs, 65);
  assert.equal(b.money.status, 'closed');
});

test('a small difference inside the tolerance is saved and recorded on the run', async () => {
  const { env } = freshConsignDb();
  const farm = await setup(env);
  const d = await drop(env, farm, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100, final: { final_lbs: 99.4 } }]);
  assert.equal(d.lots[0].runs[0].diff_lbs, 0.6);
  assert.equal(d.lots[0].money.status, 'closed');
});

test('final lower than intake with no losses is refused, and saves nothing', async () => {
  const { env, sqlite } = freshConsignDb();
  const farm = await setup(env);
  await refuse(env, 'saveDropoff', { farm_id: farm.id, client_key: 'k1', lines: [
    { cultivar: 'Beta', type: 'tops', intake_lbs: 30 },
    { cultivar: 'Alpha', type: 'tops', intake_lbs: 100, final: { final_lbs: 80 } },
  ] }, /Line 2.*off by 20/i);
  assert.equal(count(sqlite, 'cl_dropoffs'), 0);
  assert.equal(count(sqlite, 'cl_lots'), 0);
  assert.equal(count(sqlite, 'cl_screen_runs'), 0);
});

test('final above intake beyond tolerance is refused', async () => {
  const { env, sqlite } = freshConsignDb();
  const farm = await setup(env);
  await refuse(env, 'saveDropoff', { farm_id: farm.id, lines: [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 50, final: { final_lbs: 52 } }] }, /Line 1.*final.*more than/i);
  // Inside the tolerance (0.5 lb) is a weighing difference, not an error.
  const d = await drop(env, farm, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 50, final: { final_lbs: 50.4 } }]);
  assert.equal(d.lots[0].runs[0].diff_lbs, -0.4);
  assert.equal(count(sqlite, 'cl_dropoffs'), 1);
});

test('a smalls line cannot turn to smalls', async () => {
  const { env } = freshConsignDb();
  const farm = await setup(env);
  await refuse(env, 'saveDropoff', { farm_id: farm.id, lines: [{ cultivar: 'Alpha', type: 'smalls', intake_lbs: 40, final: { final_lbs: 30, to_smalls_lbs: 10 } }] }, /smalls lot cannot turn into smalls/i);
});

test('negative, empty and junk numbers in a final are refused', async () => {
  const { env, sqlite } = freshConsignDb();
  const farm = await setup(env);
  const line = (final) => ({ farm_id: farm.id, lines: [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 10, final }] });
  await refuse(env, 'saveDropoff', line({ final_lbs: -1 }), /Line 1: final/i);
  await refuse(env, 'saveDropoff', line({ final_lbs: '' }), /Line 1: final.*required/i);
  await refuse(env, 'saveDropoff', line({}), /Line 1: final.*required/i);
  await refuse(env, 'saveDropoff', line({ final_lbs: 'abc' }), /Line 1: final/i);
  await refuse(env, 'saveDropoff', line({ final_lbs: 8, biomass_lbs: -2 }), /Line 1: biomass/i);
  await refuse(env, 'saveDropoff', line({ final_lbs: 8, mold_lbs: 'x' }), /Line 1: mold/i);
  await refuse(env, 'saveDropoff', line(5), /Line 1: final/i);
  assert.equal(count(sqlite, 'cl_dropoffs'), 0);
});

test('final 0 only when the losses explain the intake', async () => {
  const { env } = freshConsignDb();
  const farm = await setup(env);
  await refuse(env, 'saveDropoff', { farm_id: farm.id, lines: [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 10, final: { final_lbs: 0 } }] }, /off by 10/i);
  // Nothing at all: a 0 lb final with no weight and no losses is no lot.
  await refuse(env, 'saveDropoff', { farm_id: farm.id, lines: [{ cultivar: 'Alpha', type: 'tops', final: { final_lbs: 0 } }] }, /Line 1/);
  const d = await drop(env, farm, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 10, final: { final_lbs: 0, mold_lbs: 10 } }]);
  assert.equal(d.lots[0].money.status, 'closed');
  assert.equal(d.lots[0].money.owed, 0);
});

test('a split line with a final on each part', async () => {
  const { env } = freshConsignDb();
  const farm = await setup(env);
  const d = await drop(env, farm, [
    { cultivar: 'Alpha', type: 'tops', term: 'dropoff', intake_lbs: 30, final: { final_lbs: 30 } },
    { cultivar: 'Alpha', type: 'tops', term: 'sold', intake_lbs: 70, final: { final_lbs: 60, to_smalls_lbs: 6, biomass_lbs: 4 } },
  ]);
  const [a, b] = d.lots;
  assert.equal(a.term, 'dropoff');
  assert.equal(a.runs.length, 1);
  assert.equal(a.runs[0].final_lbs, 30);
  assert.equal(b.term, 'sold');
  assert.equal(b.runs.length, 1);
  assert.equal(b.runs[0].final_lbs, 60);
  assert.equal(b.runs[0].client_key, 'k1#1');
  assert.equal(a.money.owed, 300);
  // Owed as sold: nothing until sold, but the lot is closed with 60 + 6 on hand.
  assert.equal(b.money.status, 'closed');
  assert.equal(b.money.owed, 0);
  assert.equal(b.money.on_hand_lbs, 66);
});

test('lines without a final behave exactly as before, beside a finished line', async () => {
  const { env } = freshConsignDb();
  const farm = await setup(env);
  const d = await drop(env, farm, [
    { cultivar: 'Alpha', type: 'tops', intake_lbs: 100 },
    { cultivar: 'Alpha', type: 'smalls' },
    { cultivar: 'Beta', type: 'tops', intake_lbs: 20, final: { final_lbs: 20 } },
  ]);
  const [a, s, b] = d.lots;
  assert.equal(a.closed_at, null);
  assert.equal(a.runs.length, 0);
  assert.equal(a.money.status, 'weighed');
  assert.equal(s.money.status, 'dropped');
  assert.equal(b.money.status, 'closed');
});

test('resending the same dropoff does not make a second run', async () => {
  const { env, sqlite } = freshConsignDb();
  const farm = await setup(env);
  const lines = [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100, final: { final_lbs: 90, biomass_lbs: 10 } }];
  await drop(env, farm, lines);
  const again = await drop(env, farm, lines);
  assert.equal(again.duplicate, true);
  assert.equal(again.lots[0].runs.length, 1);
  assert.equal(count(sqlite, 'cl_dropoffs'), 1);
  assert.equal(count(sqlite, 'cl_lots'), 1);
  assert.equal(count(sqlite, 'cl_screen_runs'), 1);
});

test('a resend racing the first send (key clash on the run) answers with the saved dropoff', async () => {
  const { env, sqlite } = freshConsignDb();
  const farm = await setup(env);
  const lines = [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100, final: { final_lbs: 100 } }];
  await drop(env, farm, lines);
  // Make the early duplicate check miss once, as if both sends passed it before either wrote.
  const realPrepare = env.DB.prepare;
  let missed = false;
  env.DB.prepare = (q) => {
    const st = realPrepare(q);
    if (!missed && q === 'SELECT id FROM cl_dropoffs WHERE client_key = ?') {
      missed = true;
      return { bind: () => ({ first: async () => null }) };
    }
    return st;
  };
  const again = await drop(env, farm, lines);
  assert.equal(again.duplicate, true);
  assert.equal(count(sqlite, 'cl_screen_runs'), 1);
});

test('if the run insert fails, the dropoff and its lots roll back with it', async () => {
  const { env, sqlite } = freshConsignDb();
  const farm = await setup(env);
  // A screen run already holding the key the second line's run will use.
  const seed = await drop(env, farm, [{ cultivar: 'Beta', type: 'smalls', intake_lbs: 5 }], 'seed');
  sqlite.prepare("INSERT INTO cl_screen_runs (lot_id, pulled_lbs, client_key) VALUES (?, 1, 'k9#1')").run(seed.lots[0].id);
  const before = [count(sqlite, 'cl_dropoffs'), count(sqlite, 'cl_lots'), count(sqlite, 'cl_screen_runs')];
  // The clash is not this dropoff's key, so it must surface as an error, not a fake duplicate.
  await assert.rejects(handleConsignD1(post('saveDropoff', { farm_id: farm.id, client_key: 'k9', lines: [
    { cultivar: 'Alpha', type: 'tops', intake_lbs: 10, final: { final_lbs: 10 } },
    { cultivar: 'Alpha', type: 'smalls', intake_lbs: 10, final: { final_lbs: 10 } },
  ] }), env, {}));
  assert.deepEqual([count(sqlite, 'cl_dropoffs'), count(sqlite, 'cl_lots'), count(sqlite, 'cl_screen_runs')], before);
});

test('open work never lists a lot finished at dropoff; the farm page shows its after numbers', async () => {
  const { env } = freshConsignDb();
  const farm = await setup(env);
  const d = await drop(env, farm, [
    { cultivar: 'Alpha', type: 'tops', intake_lbs: 100, final: { final_lbs: 80, to_smalls_lbs: 10, biomass_lbs: 10 } },
    { cultivar: 'Alpha', type: 'smalls', final: { final_lbs: 20 } },
  ]);
  const o = await call(env, 'open');
  const ids = new Set(d.lots.map((l) => l.id));
  assert.equal(o.to_weigh.filter((l) => ids.has(l.id)).length, 0);
  assert.equal(o.to_screen.filter((l) => ids.has(l.id)).length, 0);
  const f = await call(env, 'farm', { farm_id: farm.id });
  const lots = f.dropoffs[0].lots;
  assert.equal(lots[0].money.final_lbs, 80);
  assert.equal(lots[0].money.to_smalls_lbs, 10);
  assert.equal(lots[1].money.final_lbs, 20);
  assert.equal(f.totals.owed, 80 * 10 + 10 * 4 + 20 * 4);
  assert.equal(f.totals.estimate, false);
});

test('voiding the dropoff run reopens the lot for screening', async () => {
  const { env } = freshConsignDb();
  const farm = await setup(env);
  const d = await drop(env, farm, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100, final: { final_lbs: 100 } }]);
  await call(env, 'voidRow', { table: 'run', id: d.lots[0].runs[0].id, reason: 'typo' });
  const o = await call(env, 'open');
  assert.deepEqual(o.to_screen.map((l) => l.id), [d.lots[0].id]);
});

test('scenario: paid on dropoff for the weight, finished at dropoff lower: a credit owed to us', async () => {
  const { env } = freshConsignDb();
  const farm = await setup(env);
  await drop(env, farm, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100, final: { final_lbs: 85, to_smalls_lbs: 5, biomass_lbs: 7, mold_lbs: 3 } }]);
  // The farm was paid for the 100 lb it brought, at the tops price.
  await call(env, 'savePayment', { farm_id: farm.id, amount: 1000, method: 'check', client_key: 'p1' });
  const t = (await call(env, 'farm', { farm_id: farm.id })).totals;
  assert.equal(t.owed, 85 * 10 + 5 * 4);
  assert.equal(t.estimate, false);
  assert.equal(t.balance, -130);
  assert.equal(t.credit, 130);
});
