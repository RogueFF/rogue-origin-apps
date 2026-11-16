import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenTolerance, checkRun, lotMoney, farmTotals } from '../workers/src/lib/consign-ledger.js';

const lot = (o = {}) => ({ type: 'tops', term: 'dropoff', intake_lbs: 100, price_per_lb: 10, smalls_price_per_lb: 4, closed_at: null, voided_at: null, ...o });
const run = (o = {}) => ({ pulled_lbs: 100, final_lbs: 80, to_smalls_lbs: 10, biomass_lbs: 8, mold_lbs: 2, voided_at: null, ...o });

test('tolerance is 0.5 lb or 1 percent, whichever is larger', () => {
  assert.equal(screenTolerance(10), 0.5);
  assert.equal(screenTolerance(200), 2);
});

test('checkRun accepts outputs that add up and reports the difference', () => {
  assert.deepEqual(checkRun(run(), 'tops'), { ok: true, diff: 0, tolerance: 1 });
  const off = checkRun(run({ final_lbs: 70 }), 'tops');
  assert.equal(off.ok, false);
  assert.equal(off.diff, 10);
});

test('checkRun rejects to_smalls on a smalls lot', () => {
  assert.equal(checkRun(run({ final_lbs: 90, to_smalls_lbs: 0 }), 'smalls').ok, true);
  assert.equal(checkRun(run(), 'smalls').ok, false);
});

test('unweighed lot owes nothing and is an estimate', () => {
  const m = lotMoney(lot({ intake_lbs: null }));
  assert.equal(m.status, 'dropped');
  assert.equal(m.owed, 0);
  assert.equal(m.estimate, true);
});

test('weighed, unscreened lot is estimated at intake weight', () => {
  const m = lotMoney(lot());
  assert.equal(m.status, 'weighed');
  assert.equal(m.owed, 1000);
  assert.equal(m.estimate, true);
});

test('closed lot pays final tops plus turned-to-smalls, nothing for biomass or mold', () => {
  const m = lotMoney(lot({ closed_at: 'x' }), [run()]);
  assert.equal(m.status, 'closed');
  assert.equal(m.owed, 80 * 10 + 10 * 4);
  assert.equal(m.estimate, false);
  assert.equal(m.biomass_lbs, 8);
  assert.equal(m.mold_lbs, 2);
});

test('partly screened lot pays outputs plus the unscreened remainder', () => {
  const m = lotMoney(lot(), [run({ pulled_lbs: 40, final_lbs: 30, to_smalls_lbs: 5, biomass_lbs: 4, mold_lbs: 1 })]);
  assert.equal(m.status, 'screening');
  assert.equal(m.remainder_lbs, 60);
  assert.equal(m.owed, 30 * 10 + 5 * 4 + 60 * 10);
  assert.equal(m.estimate, true);
});

test('a closed lot pays no remainder even when pulled is under intake', () => {
  const m = lotMoney(lot({ closed_at: 'x' }), [run({ pulled_lbs: 99, final_lbs: 80, to_smalls_lbs: 10, biomass_lbs: 7, mold_lbs: 2 })]);
  assert.equal(m.remainder_lbs, 0);
  assert.equal(m.owed, 840);
});

test('voided runs are ignored', () => {
  const m = lotMoney(lot(), [run({ voided_at: 'x' })]);
  assert.equal(m.status, 'weighed');
});

test('missing price flags needs_price and owes zero', () => {
  const m = lotMoney(lot({ price_per_lb: null }));
  assert.equal(m.needs_price, true);
  assert.equal(m.owed, 0);
});

test('missing smalls price is flagged only when tops turned to smalls', () => {
  assert.equal(lotMoney(lot({ smalls_price_per_lb: null, closed_at: 'x' }), [run({ final_lbs: 90, to_smalls_lbs: 0 })]).needs_price, false);
  assert.equal(lotMoney(lot({ smalls_price_per_lb: null, closed_at: 'x' }), [run()]).needs_price, true);
});

test('sold-term lot owes only for sold pounds and shows on hand', () => {
  const sold = [{ lbs: 20, kind: 'main', voided_at: null }, { lbs: 4, kind: 'smalls', voided_at: null }];
  const m = lotMoney(lot({ term: 'sold', closed_at: 'x' }), [run()], sold);
  assert.equal(m.owed, 20 * 10 + 4 * 4);
  assert.equal(m.on_hand_lbs, 60 + 6);
});

test('farm totals show a credit when payments exceed owed', () => {
  const t = farmTotals([lotMoney(lot({ closed_at: 'x' }), [run()])], [{ amount: 1000, voided_at: null }, { amount: 50, voided_at: 'x' }]);
  assert.equal(t.owed, 840);
  assert.equal(t.paid, 1000);
  assert.equal(t.balance, -160);
  assert.equal(t.credit, 160);
});

test('money is rounded to cents', () => {
  const m = lotMoney(lot({ intake_lbs: 33.33, price_per_lb: 3.33 }));
  assert.equal(m.owed, 110.99);
});
