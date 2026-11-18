// Owner edits on /api/consign: change a saved row in place, logged before and after.
// Real SQLite (node:sqlite). Made-up farms, cultivars and numbers only.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshConsignDb, post, sqliteOk } from './helpers/consign-sqlite.mjs';
import { handleConsignD1 } from '../workers/src/handlers/consign-d1.js';

before((t) => { if (!sqliteOk) t.skip('node:sqlite unavailable'); });

const OWNER = { owner_password: 'owner-pw' };
const send = (env, action, body) => handleConsignD1(post(action, body), env, {});
const owner = async (env, action, body = {}) => (await (await send(env, action, { ...body, ...OWNER })).json()).data;
/** The refusal of an owner call: the thrown error. */
async function refused(env, action, body, re) {
  try { await send(env, action, { ...body, ...OWNER }); } catch (e) { if (re) assert.match(e.message, re); return e; }
  throw new Error(`${action} was not refused`);
}
const pacificToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const daysAgo = (n) => new Date(Date.parse(`${pacificToday()}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
const histories = (sqlite, tbl, id) => sqlite.prepare('SELECT * FROM cl_history WHERE tbl = ? AND row_id = ? ORDER BY id').all(tbl, id)
  .map((h) => ({ ...h, before: JSON.parse(h.before_json), after: JSON.parse(h.after_json) }));
const lastHistory = (sqlite, tbl, id) => histories(sqlite, tbl, id).at(-1);
const historyCount = (sqlite) => sqlite.prepare('SELECT COUNT(*) AS n FROM cl_history').get().n;

/** Farm A (owed on dropoff) and Farm B (owed as sold), each with Alpha tops 10 / smalls 4. */
async function world() {
  const db = freshConsignDb();
  const { env } = db;
  const { farm } = await owner(env, 'saveFarm', { name: 'Farm A', default_term: 'dropoff' });
  const { farm: b } = await owner(env, 'saveFarm', { name: 'Farm B', default_term: 'sold' });
  const pp = {};
  for (const f of [farm, b]) {
    pp[f.id] = {
      tops: (await owner(env, 'savePricePoint', { farm_id: f.id, cultivar: 'Alpha', type: 'tops', price_per_lb: 10, effective_from: daysAgo(30) })).price_point,
      smalls: (await owner(env, 'savePricePoint', { farm_id: f.id, cultivar: 'Alpha', type: 'smalls', price_per_lb: 4, effective_from: daysAgo(30) })).price_point,
    };
  }
  return { ...db, farm, b, pp };
}
let keyN = 0;
const dropoff = (env, farmId, lines, extra = {}) => owner(env, 'saveDropoff', { farm_id: farmId, client_key: `k${++keyN}`, lines, ...extra });
const run = (env, lotId, r) => owner(env, 'saveScreenRun', { lot_id: lotId, client_key: `r${++keyN}`, ...r });

/* ---------- every edit is owner only ---------- */

test('every edit is refused without the owner password, and with a wrong one; nothing changes', async () => {
  const { env, sqlite, farm, pp } = await world();
  const d = await dropoff(env, farm.id, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100 }]);
  const lot = d.lots[0];
  const r = await run(env, lot.id, { pulled_lbs: 50, final_lbs: 50 });
  const { payment } = await owner(env, 'savePayment', { farm_id: farm.id, amount: 20, client_key: 'p1' });
  const cases = [
    ['editPricePoint', { id: pp[farm.id].tops.id, price_per_lb: 11 }],
    ['deletePricePoint', { id: pp[farm.id].tops.id }],
    ['editDropoff', { dropoff_id: d.dropoff.id, note: 'x' }],
    ['editLot', { lot_id: lot.id, note: 'x' }],
    ['editScreenRun', { run_id: r.lot.runs[0].id, note: 'x' }],
    ['editSold', { sold_id: 1, lbs: 1 }],
    ['editPayment', { payment_id: payment.id, amount: 30 }],
  ];
  const n = historyCount(sqlite);
  const snap = () => JSON.stringify(['cl_price_points', 'cl_dropoffs', 'cl_lots', 'cl_screen_runs', 'cl_payments'].map((tb) => sqlite.prepare(`SELECT * FROM ${tb}`).all()));
  const was = snap();
  for (const [action, body] of cases) {
    await assert.rejects(send(env, action, body), /owner/i, `${action} without the owner password`);
    await assert.rejects(send(env, action, { ...body, owner_password: 'nope' }), /owner/i, `${action} with a wrong owner password`);
  }
  delete env.CONSIGN_OWNER_PASSWORD;
  for (const [action, body] of cases) await assert.rejects(send(env, action, { ...body, ...OWNER }), /owner/i, `${action} with no secret set`);
  assert.equal(historyCount(sqlite), n);
  assert.equal(snap(), was);
});

/* ---------- editPricePoint ---------- */

test('editPricePoint: changes the point, logs before and after, replies with the row as the farm read has it', async () => {
  const { env, sqlite, farm, pp } = await world();
  const id = pp[farm.id].tops.id;
  const out = await owner(env, 'editPricePoint', { id, price_per_lb: 12.5, effective_from: daysAgo(20) });
  assert.deepEqual(Object.keys(out).sort(), ['lots_updated', 'price_point']);
  assert.equal(out.lots_updated, 0);
  assert.equal(out.price_point.price_per_lb, 12.5);
  assert.equal(out.price_point.cultivar, 'Alpha', 'a field left out keeps its value');
  const f = await owner(env, 'farm', { farm_id: farm.id });
  assert.deepEqual(f.price_points.find((p) => p.id === id), out.price_point);
  const h = lastHistory(sqlite, 'cl_price_points', id);
  assert.equal(h.action, 'editPricePoint');
  assert.equal(h.actor, 'owner');
  assert.deepEqual(h.before, { price_per_lb: 10, effective_from: daysAgo(30) });
  assert.deepEqual(h.after, { price_per_lb: 12.5, effective_from: daysAgo(20) });
});

test('editPricePoint update_lots: only lots that had the old price follow; a hand-set price and other farms stay', async () => {
  const { env, sqlite, farm, b, pp } = await world();
  const d = await dropoff(env, farm.id, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100 }, { cultivar: 'Alpha', type: 'smalls', intake_lbs: 10 }]);
  const d2 = await dropoff(env, farm.id, [{ cultivar: 'alpha', type: 'tops', intake_lbs: 50 }]);
  const hand = await dropoff(env, farm.id, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 20 }]);
  await owner(env, 'setLotTerms', { lot_id: hand.lots[0].id, price_per_lb: 9 });
  const voided = await dropoff(env, farm.id, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 30 }]);
  await owner(env, 'voidRow', { table: 'lot', id: voided.lots[0].id, reason: 'test' });
  const other = await dropoff(env, b.id, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 40 }]);
  const [tops, smalls] = d.lots;
  // Closed lots follow too: their pounds are still owed at the price.
  await run(env, d2.lots[0].id, { pulled_lbs: 50, final_lbs: 50, finishes_lot: true });

  const before = await owner(env, 'farm', { farm_id: farm.id });
  assert.equal(before.totals.owed, 100 * 10 + 10 * 4 + 50 * 10 + 20 * 9);
  const out = await owner(env, 'editPricePoint', { id: pp[farm.id].tops.id, price_per_lb: 11, update_lots: true });
  assert.equal(out.lots_updated, 2);
  const price = (id) => sqlite.prepare('SELECT price_per_lb FROM cl_lots WHERE id = ?').get(id).price_per_lb;
  assert.equal(price(tops.id), 11);
  assert.equal(price(d2.lots[0].id), 11, 'cultivar matched without case');
  assert.equal(price(hand.lots[0].id), 9, 'a hand-set price is untouched');
  assert.equal(price(voided.lots[0].id), 10, 'a voided lot is untouched');
  assert.equal(price(other.lots[0].id), 10, 'another farm is untouched');
  assert.equal(price(smalls.id), 4, 'a smalls lot does not follow a tops price');
  const after = await owner(env, 'farm', { farm_id: farm.id });
  assert.equal(after.totals.owed, 100 * 11 + 10 * 4 + 50 * 11 + 20 * 9);
  // One history row per lot changed, plus the point's own.
  const h = lastHistory(sqlite, 'cl_lots', tops.id);
  assert.equal(h.action, 'editPricePoint');
  assert.deepEqual(h.before, { price_per_lb: 10 });
  assert.deepEqual(h.after, { price_per_lb: 11, price_point_id: pp[farm.id].tops.id });
  assert.equal(histories(sqlite, 'cl_lots', hand.lots[0].id).filter((x) => x.action === 'editPricePoint').length, 0);
  assert.equal(histories(sqlite, 'cl_price_points', pp[farm.id].tops.id).length, 1);
});

test('editPricePoint update_lots on a smalls point: smalls lots and the smalls price of tops lots follow', async () => {
  const { env, sqlite, farm, pp } = await world();
  const d = await dropoff(env, farm.id, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100 }, { cultivar: 'Alpha', type: 'smalls', intake_lbs: 10 }]);
  const [tops, smalls] = d.lots;
  await run(env, tops.id, { pulled_lbs: 100, final_lbs: 80, to_smalls_lbs: 20, finishes_lot: true });
  const owedBefore = (await owner(env, 'farm', { farm_id: farm.id })).totals.owed;
  assert.equal(owedBefore, 80 * 10 + 20 * 4 + 10 * 4);
  const out = await owner(env, 'editPricePoint', { id: pp[farm.id].smalls.id, price_per_lb: 5, update_lots: true });
  assert.equal(out.lots_updated, 2);
  const row = (id) => sqlite.prepare('SELECT price_per_lb, smalls_price_per_lb FROM cl_lots WHERE id = ?').get(id);
  assert.deepEqual({ ...row(tops.id) }, { price_per_lb: 10, smalls_price_per_lb: 5 });
  assert.equal(row(smalls.id).price_per_lb, 5);
  assert.equal((await owner(env, 'farm', { farm_id: farm.id })).totals.owed, 80 * 10 + 20 * 5 + 10 * 5);
  assert.deepEqual(lastHistory(sqlite, 'cl_lots', tops.id).after, { smalls_price_per_lb: 5, price_point_id: pp[farm.id].smalls.id });
});

test('editPricePoint without update_lots (or with it not exactly true) changes no lot', async () => {
  const { env, sqlite, farm, pp } = await world();
  const d = await dropoff(env, farm.id, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100 }]);
  for (const update_lots of [undefined, false, 'yes', 1, 'true']) {
    // From the lot's own price each time, so a lot that followed would show.
    const out = await owner(env, 'editPricePoint', { id: pp[farm.id].tops.id, price_per_lb: 20, update_lots });
    assert.equal(out.lots_updated, 0, String(update_lots));
    await owner(env, 'editPricePoint', { id: pp[farm.id].tops.id, price_per_lb: 10 });
  }
  assert.equal(sqlite.prepare('SELECT price_per_lb FROM cl_lots WHERE id = ?').get(d.lots[0].id).price_per_lb, 10);
  assert.equal((await owner(env, 'farm', { farm_id: farm.id })).totals.owed, 1000);
  // Price unchanged, other fields changed: no lot is touched even with update_lots.
  const same = await owner(env, 'editPricePoint', { id: pp[farm.id].tops.id, effective_from: daysAgo(10), update_lots: true });
  assert.equal(same.lots_updated, 0);
});

test('editPricePoint refusals: bad price, type, date, empty cultivar, unknown id; nothing written', async () => {
  const { env, sqlite, farm, pp } = await world();
  const id = pp[farm.id].tops.id;
  const n = historyCount(sqlite);
  await refused(env, 'editPricePoint', { id, price_per_lb: 0 }, /Price per lb must be a positive number/);
  await refused(env, 'editPricePoint', { id, price_per_lb: '12abc' }, /Price per lb must be a positive number/);
  await refused(env, 'editPricePoint', { id, type: 'buds' }, /type must be tops or smalls/);
  await refused(env, 'editPricePoint', { id, effective_from: '2026-02-30' }, /Start date must be a real date/);
  await refused(env, 'editPricePoint', { id, cultivar: '  ' }, /Cultivar is required/);
  const e = await refused(env, 'editPricePoint', { id: 99999, price_per_lb: 3 }, /Price point not found/);
  assert.equal(e.code, 'NOT_FOUND');
  assert.equal(historyCount(sqlite), n);
  assert.equal(sqlite.prepare('SELECT price_per_lb FROM cl_price_points WHERE id = ?').get(id).price_per_lb, 10);
});

test('editPricePoint with nothing changed writes no history', async () => {
  const { env, sqlite, farm, pp } = await world();
  const n = historyCount(sqlite);
  const out = await owner(env, 'editPricePoint', { id: pp[farm.id].tops.id, price_per_lb: 10, cultivar: 'Alpha' });
  assert.equal(out.price_point.price_per_lb, 10);
  assert.equal(historyCount(sqlite), n);
});

/* ---------- deletePricePoint ---------- */

test('deletePricePoint removes the row, history keeps all of it, lots keep their price', async () => {
  const { env, sqlite, farm, pp } = await world();
  const d = await dropoff(env, farm.id, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100 }]);
  const row = sqlite.prepare('SELECT * FROM cl_price_points WHERE id = ?').get(pp[farm.id].tops.id);
  assert.deepEqual(await owner(env, 'deletePricePoint', { id: row.id }), { ok: true });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM cl_price_points WHERE id = ?').get(row.id).n, 0);
  const h = lastHistory(sqlite, 'cl_price_points', row.id);
  assert.equal(h.action, 'deletePricePoint');
  assert.deepEqual(h.before, { ...row });
  assert.equal(h.after, null);
  assert.equal(sqlite.prepare('SELECT price_per_lb FROM cl_lots WHERE id = ?').get(d.lots[0].id).price_per_lb, 10);
  assert.equal((await owner(env, 'farm', { farm_id: farm.id })).totals.owed, 1000);
  await refused(env, 'deletePricePoint', { id: row.id }, /Price point not found/);
});

/* ---------- editDropoff ---------- */

test('editDropoff: date at 20:00 UTC, received by and note; lots are not re-priced; reply is the dropoff read', async () => {
  const { env, sqlite, farm, pp } = await world();
  await owner(env, 'savePricePoint', { farm_id: farm.id, cultivar: 'Alpha', type: 'tops', price_per_lb: 15, effective_from: daysAgo(100) });
  const d = await dropoff(env, farm.id, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100 }], { dropped_by: 'T', note: 'first' });
  assert.ok(pp);
  const out = await owner(env, 'editDropoff', { dropoff_id: d.dropoff.id, dropped_on: daysAgo(3), note: '' });
  assert.deepEqual(Object.keys(out).sort(), ['dropoff', 'lots']);
  assert.equal(out.dropoff.dropped_at, `${daysAgo(3)} 20:00:00`);
  assert.equal(out.dropoff.dropped_by, 'T', 'left out: kept');
  assert.equal(out.dropoff.note, null, "'' clears");
  assert.equal(out.lots[0].price_per_lb, 10, 'not re-priced');
  assert.deepEqual(out, await owner(env, 'dropoff', { dropoff_id: d.dropoff.id }));
  const h = lastHistory(sqlite, 'cl_dropoffs', d.dropoff.id);
  assert.equal(h.action, 'editDropoff');
  assert.deepEqual(h.before, { dropped_at: d.dropoff.dropped_at, note: 'first' });
  assert.deepEqual(h.after, { dropped_at: `${daysAgo(3)} 20:00:00`, note: null });
  // The same day again keeps the stored time.
  const again = await owner(env, 'editDropoff', { dropoff_id: d.dropoff.id, dropped_on: daysAgo(3), dropped_by: 'U' });
  assert.equal(again.dropoff.dropped_at, `${daysAgo(3)} 20:00:00`);
  assert.equal(again.dropoff.dropped_by, 'U');
});

test("editDropoff: today's date on a dropoff saved today keeps its time", async () => {
  const { env, farm } = await world();
  const d = await dropoff(env, farm.id, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 1 }]);
  const out = await owner(env, 'editDropoff', { dropoff_id: d.dropoff.id, dropped_on: pacificToday() });
  assert.equal(out.dropoff.dropped_at, d.dropoff.dropped_at);
});

test('editDropoff refusals: bad, future and too-old dates, another farm, voided, unknown', async () => {
  const { env, sqlite, farm, b } = await world();
  const d = await dropoff(env, farm.id, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 1 }]);
  const n = historyCount(sqlite);
  const id = d.dropoff.id;
  await refused(env, 'editDropoff', { dropoff_id: id, dropped_on: '2026-02-30' }, /Dropoff date must be a real date, YYYY-MM-DD/);
  await refused(env, 'editDropoff', { dropoff_id: id, dropped_on: '' }, /Dropoff date must be a real date/);
  await refused(env, 'editDropoff', { dropoff_id: id, dropped_on: daysAgo(-1) }, /Dropoff date cannot be in the future/);
  await refused(env, 'editDropoff', { dropoff_id: id, dropped_on: daysAgo(400) }, /Dropoff date cannot be more than a year back/);
  await refused(env, 'editDropoff', { dropoff_id: id, farm_id: b.id }, /cannot move to another farm. Void it and enter it again/);
  assert.equal(historyCount(sqlite), n);
  // The same farm id is not a move.
  await owner(env, 'editDropoff', { dropoff_id: id, farm_id: farm.id, note: 'ok' });
  await owner(env, 'voidRow', { table: 'dropoff', id, reason: 'test' });
  await refused(env, 'editDropoff', { dropoff_id: id, note: 'x' }, /This dropoff was voided/);
  await refused(env, 'editDropoff', { dropoff_id: 99999, note: 'x' }, /Dropoff not found/);
});

/* ---------- editLot ---------- */

test('editLot: cultivar, type, weight, note; history; price not re-looked-up; reply is the lot', async () => {
  const { env, sqlite, farm } = await world();
  const d = await dropoff(env, farm.id, [{ cultivar: 'Alpha', type: 'tops', note: 'n1' }]);
  const lot = d.lots[0];
  assert.equal(lot.weighed_at, null);
  const out = await owner(env, 'editLot', { lot_id: lot.id, cultivar: 'Beta', type: 'smalls', intake_lbs: 42, note: null });
  assert.deepEqual(Object.keys(out), ['lot']);
  assert.equal(out.lot.cultivar, 'Beta');
  assert.equal(out.lot.type, 'smalls');
  assert.equal(out.lot.intake_lbs, 42);
  assert.ok(out.lot.weighed_at, 'a first weight stamps weighed_at');
  assert.equal(out.lot.note, null);
  assert.equal(out.lot.price_per_lb, 10, 'the price stays; it is edited on its own');
  assert.equal(out.lot.money.status, 'weighed');
  const h = lastHistory(sqlite, 'cl_lots', lot.id);
  assert.equal(h.action, 'editLot');
  assert.deepEqual(h.before, { cultivar: 'Alpha', type: 'tops', intake_lbs: null, note: 'n1' });
  assert.deepEqual(h.after, { cultivar: 'Beta', type: 'smalls', intake_lbs: 42, note: null });
  const [read] = (await owner(env, 'dropoff', { dropoff_id: d.dropoff.id })).lots;
  assert.deepEqual(out.lot, read);
});

test('editLot refusals: type with runs or sold, weight below pulled, closed lot weight, duplicate, bad values, voided', async () => {
  const { env, sqlite, farm, b } = await world();
  const d = await dropoff(env, farm.id, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100 }, { cultivar: 'Alpha', type: 'smalls', intake_lbs: 10 }, { cultivar: 'Gamma', type: 'tops', intake_lbs: 30 }]);
  const [tops, smalls, gamma] = d.lots;
  await run(env, tops.id, { pulled_lbs: 60, final_lbs: 60 });
  await run(env, gamma.id, { pulled_lbs: 30, final_lbs: 30, finishes_lot: true });
  const n = historyCount(sqlite);
  await refused(env, 'editLot', { lot_id: tops.id, type: 'smalls' }, /type can only change before the lot is screened or sold/);
  await refused(env, 'editLot', { lot_id: tops.id, intake_lbs: 50 }, /Weight cannot be below the 60 lb already pulled for screening/);
  await refused(env, 'editLot', { lot_id: gamma.id, intake_lbs: 40 }, /This lot is closed, so its screening runs set its weight. Edit the screening run instead/);
  await refused(env, 'editLot', { lot_id: smalls.id, type: 'tops' }, /This dropoff already has a Alpha tops lot. Edit that one instead/);
  await refused(env, 'editLot', { lot_id: gamma.id, cultivar: 'alpha', type: 'smalls' }, /type can only change/);
  await refused(env, 'editLot', { lot_id: smalls.id, intake_lbs: 0 }, /Weight must be a positive number/);
  await refused(env, 'editLot', { lot_id: smalls.id, intake_lbs: 200000 }, /Weight must be 100000 lb or less/);
  await refused(env, 'editLot', { lot_id: smalls.id, type: 'buds' }, /type must be tops or smalls/);
  await refused(env, 'editLot', { lot_id: smalls.id, cultivar: '' }, /Cultivar is required/);
  assert.equal(historyCount(sqlite), n);
  // Weight above pulled on an open lot is fine; a cultivar case fix is not a clash.
  assert.equal((await owner(env, 'editLot', { lot_id: tops.id, intake_lbs: 61 })).lot.money.remainder_lbs, 1);
  assert.equal((await owner(env, 'editLot', { lot_id: tops.id, cultivar: 'ALPHA' })).lot.cultivar, 'ALPHA');

  // A sold lot: the type is fixed once anything is sold, and the weight cannot drop below what sold.
  const ds = await dropoff(env, b.id, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100 }]);
  const sl = ds.lots[0];
  await owner(env, 'saveSold', { lot_id: sl.id, lbs: 90, client_key: 's1' });
  await refused(env, 'editLot', { lot_id: sl.id, type: 'smalls' }, /type can only change/);
  await refused(env, 'editLot', { lot_id: sl.id, intake_lbs: 80 }, /would leave 80 lb to sell, but 90 lb is already sold. Lower or void the sold entries first/);
  await owner(env, 'voidRow', { table: 'lot', id: smalls.id, reason: 'test' });
  await refused(env, 'editLot', { lot_id: smalls.id, note: 'x' }, /This lot was voided/);
  await refused(env, 'editLot', { lot_id: 99999, note: 'x' }, /Lot not found/);
});

/* ---------- editScreenRun ---------- */

test('editScreenRun: re-checked, diff recomputed, history; reply is the lot', async () => {
  const { env, sqlite, farm } = await world();
  const d = await dropoff(env, farm.id, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100 }]);
  const r = await run(env, d.lots[0].id, { pulled_lbs: 50, final_lbs: 40, to_smalls_lbs: 10 });
  const runId = r.lot.runs[0].id;
  const out = await owner(env, 'editScreenRun', { run_id: runId, final_lbs: 39.8, biomass_lbs: 10, to_smalls_lbs: 0, note: 'fixed' });
  assert.deepEqual(Object.keys(out), ['lot']);
  const row = out.lot.runs[0];
  assert.equal(row.final_lbs, 39.8);
  assert.equal(row.pulled_lbs, 50, 'left out: kept');
  assert.equal(row.diff_lbs, 0.2);
  assert.equal(row.note, 'fixed');
  assert.equal(out.lot.money.final_lbs, 39.8);
  const h = lastHistory(sqlite, 'cl_screen_runs', runId);
  assert.equal(h.action, 'editScreenRun');
  assert.deepEqual(h.before, { final_lbs: 40, to_smalls_lbs: 10, biomass_lbs: 0, diff_lbs: 0, note: null });
  assert.deepEqual(h.after, { final_lbs: 39.8, to_smalls_lbs: 0, biomass_lbs: 10, diff_lbs: 0.2, note: 'fixed' });
});

test('editScreenRun refusals: off outputs, smalls into smalls, over the intake, closed-lot shortfall, sold above payable, voided', async () => {
  const { env, sqlite, farm, b } = await world();
  const d = await dropoff(env, farm.id, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100 }, { cultivar: 'Alpha', type: 'smalls', intake_lbs: 20 }]);
  const [tops, smalls] = d.lots;
  const r1 = (await run(env, tops.id, { pulled_lbs: 50, final_lbs: 50 })).lot.runs[0].id;
  await run(env, tops.id, { pulled_lbs: 30, final_lbs: 30 });
  const rs = (await run(env, smalls.id, { pulled_lbs: 20, final_lbs: 20 })).lot.runs[0].id;
  const n = historyCount(sqlite);
  await refused(env, 'editScreenRun', { run_id: r1, final_lbs: 40 }, /Outputs are off by 10 lb \(allowed 0.5 lb\)/);
  await refused(env, 'editScreenRun', { run_id: rs, final_lbs: 15, to_smalls_lbs: 5 }, /A smalls lot cannot turn into smalls/);
  await refused(env, 'editScreenRun', { run_id: r1, pulled_lbs: 80, final_lbs: 80 }, /Only 70 lb is left to screen for this run, cannot pull more than that/);
  await refused(env, 'editScreenRun', { run_id: r1, pulled_lbs: 0 }, /Pounds pulled must be a positive number/);
  await refused(env, 'editScreenRun', { run_id: r1, mold_lbs: -1 }, /Mold must be a number, 0 or more/);
  assert.equal(historyCount(sqlite), n);
  // Within the intake is fine.
  assert.equal((await owner(env, 'editScreenRun', { run_id: r1, pulled_lbs: 70, final_lbs: 70 })).lot.money.remainder_lbs, 0);

  // Finished at dropoff: the run may not pull more than the intake, and may not leave the closed lot short.
  const fin = await dropoff(env, farm.id, [{ cultivar: 'Delta', type: 'tops', intake_lbs: 20, final: { final_lbs: 19, biomass_lbs: 1 } }]);
  const fr = fin.lots[0].runs[0].id;
  await refused(env, 'editScreenRun', { run_id: fr, pulled_lbs: 25, final_lbs: 24 }, /Only 20 lb is left to screen for this run/);
  await refused(env, 'editScreenRun', { run_id: fr, pulled_lbs: 10, final_lbs: 9 }, /This lot is closed; pulling 10 lb would leave 10 lb unscreened. Void this run and enter it again instead/);
  const ok = await owner(env, 'editScreenRun', { run_id: fr, final_lbs: 18, biomass_lbs: 2 });
  assert.equal(ok.lot.intake_lbs, 20, 'the intake never changes here');
  assert.equal(ok.lot.money.final_lbs, 18);

  // A sold lot: lowering the final below what sold is refused.
  const ds = await dropoff(env, b.id, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 50 }]);
  const sr = (await run(env, ds.lots[0].id, { pulled_lbs: 50, final_lbs: 50, finishes_lot: true })).lot.runs[0].id;
  await owner(env, 'saveSold', { lot_id: ds.lots[0].id, lbs: 45, client_key: 's9' });
  await refused(env, 'editScreenRun', { run_id: sr, final_lbs: 40, biomass_lbs: 10 }, /would leave 40 lb to sell, but 45 lb is already sold/);

  await owner(env, 'voidRow', { table: 'run', id: rs, reason: 'test' });
  await refused(env, 'editScreenRun', { run_id: rs, note: 'x' }, /This screening run was voided/);
  await refused(env, 'editScreenRun', { run_id: 99999, note: 'x' }, /Screening run not found/);
});

/* ---------- editSold ---------- */

test('editSold: pounds, date, note; the cap counts the entry\'s own pounds; history; reply is the lot', async () => {
  const { env, sqlite, b } = await world();
  const ds = await dropoff(env, b.id, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100 }]);
  const lot = ds.lots[0];
  await run(env, lot.id, { pulled_lbs: 100, final_lbs: 80, to_smalls_lbs: 20, finishes_lot: true });
  const s1 = (await owner(env, 'saveSold', { lot_id: lot.id, lbs: 50, client_key: 's1' })).lot.sold[0].id;
  await owner(env, 'saveSold', { lot_id: lot.id, lbs: 20, client_key: 's2' });
  await owner(env, 'saveSold', { lot_id: lot.id, lbs: 5, kind: 'smalls', client_key: 's3' });
  // 80 main: 70 sold. s1 may go up to 60.
  const out = await owner(env, 'editSold', { sold_id: s1, lbs: 60, sold_on: daysAgo(2), note: 'n' });
  assert.deepEqual(Object.keys(out), ['lot']);
  assert.equal(out.lot.money.sold_main_lbs, 80);
  assert.equal(out.lot.money.owed, 80 * 10 + 5 * 4);
  const h = lastHistory(sqlite, 'cl_sold', s1);
  assert.equal(h.action, 'editSold');
  assert.deepEqual(h.before, { lbs: 50, sold_on: pacificToday(), note: null });
  assert.deepEqual(h.after, { lbs: 60, sold_on: daysAgo(2), note: 'n' });
  // Saving the same pounds again is not refused by the cap.
  await owner(env, 'editSold', { sold_id: s1, lbs: 60, note: 'm' });
  const n = historyCount(sqlite);
  await refused(env, 'editSold', { sold_id: s1, lbs: 61 }, /Only 60 lb is left on hand for this lot/);
  const s3 = out.lot.sold.find((s) => s.kind === 'smalls').id;
  await refused(env, 'editSold', { sold_id: s3, lbs: 21 }, /Only 20 lb is left on hand for this lot/);
  await refused(env, 'editSold', { sold_id: s1, lbs: 0 }, /Pounds sold must be a positive number/);
  await refused(env, 'editSold', { sold_id: s1, sold_on: 'yesterday' }, /Sold date must be a real date, YYYY-MM-DD/);
  assert.equal(historyCount(sqlite), n);
  await owner(env, 'voidRow', { table: 'sold', id: s3, reason: 'test' });
  await refused(env, 'editSold', { sold_id: s3, lbs: 1 }, /This sold entry was voided/);
  await refused(env, 'editSold', { sold_id: 99999, lbs: 1 }, /Sold entry not found/);
});

/* ---------- editPayment ---------- */

test('editPayment: amount, date, method, reference, note; history; totals follow; refusals', async () => {
  const { env, sqlite, farm } = await world();
  await dropoff(env, farm.id, [{ cultivar: 'Alpha', type: 'tops', intake_lbs: 100 }]);
  const { payment } = await owner(env, 'savePayment', { farm_id: farm.id, amount: 300, method: 'check', reference: 'R1', note: 'n', client_key: 'p1' });
  const out = await owner(env, 'editPayment', { payment_id: payment.id, amount: 400, paid_on: daysAgo(1), method: 'cash', reference: '' });
  assert.deepEqual(Object.keys(out).sort(), ['payment', 'totals']);
  assert.equal(out.payment.amount, 400);
  assert.equal(out.payment.reference, null);
  assert.equal(out.payment.note, 'n', 'left out: kept');
  assert.equal(out.totals.paid, 400);
  assert.equal(out.totals.balance, 600);
  const f = await owner(env, 'farm', { farm_id: farm.id });
  assert.deepEqual(f.payments[0], out.payment);
  assert.equal(f.totals.balance, 600);
  const h = lastHistory(sqlite, 'cl_payments', payment.id);
  assert.equal(h.action, 'editPayment');
  assert.deepEqual(h.before, { amount: 300, paid_on: pacificToday(), method: 'check', reference: 'R1' });
  assert.deepEqual(h.after, { amount: 400, paid_on: daysAgo(1), method: 'cash', reference: null });
  const n = historyCount(sqlite);
  await refused(env, 'editPayment', { payment_id: payment.id, amount: -5 }, /Amount must be a positive number/);
  await refused(env, 'editPayment', { payment_id: payment.id, paid_on: '2026-13-01' }, /Payment date must be a real date, YYYY-MM-DD/);
  assert.equal(historyCount(sqlite), n);
  await owner(env, 'voidRow', { table: 'payment', id: payment.id, reason: 'test' });
  await refused(env, 'editPayment', { payment_id: payment.id, amount: 5 }, /This payment was voided/);
  await refused(env, 'editPayment', { payment_id: 99999, amount: 5 }, /Payment not found/);
});

test('an edit and its history row are one batch: a failing history write rolls the edit back', async () => {
  const { env, sqlite, farm } = await world();
  const { payment } = await owner(env, 'savePayment', { farm_id: farm.id, amount: 300, client_key: 'p1' });
  sqlite.exec("CREATE TRIGGER no_history BEFORE INSERT ON cl_history BEGIN SELECT RAISE(ABORT, 'history down'); END");
  await assert.rejects(send(env, 'editPayment', { payment_id: payment.id, amount: 1, ...OWNER }), /history down/);
  assert.equal(sqlite.prepare('SELECT amount FROM cl_payments WHERE id = ?').get(payment.id).amount, 300);
});
