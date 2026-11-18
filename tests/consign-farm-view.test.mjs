import { test } from 'node:test';
import assert from 'node:assert/strict';
import { farmView, VIEW_KEYS } from '../workers/src/lib/consign-farm-view.js';
import { lotMoney, farmTotals } from '../workers/src/lib/consign-ledger.js';

// Raw rows shaped like the D1 tables, every forbidden field carrying a sentinel.
const SENTINELS = ['INTERNAL-NOTE', 'STAFF-NAME', 'CLIENT-KEY', 'VOID-REASON', 'CONTACT', 'SOLD-NOTE', 'PAY-NOTE', 'RUN-NOTE', 'Farm B'];

function rows() {
  const farm = { id: 1, name: 'Farm A', contact: 'CONTACT', default_term: 'dropoff', lang: 'es', active: 1, created_at: '2026-01-01 00:00:00' };
  const price_points = [
    { id: 1, farm_id: 1, cultivar: 'Alpha', type: 'tops', price_per_lb: 9, effective_from: '2026-01-01', created_at: 'x' },
    { id: 2, farm_id: 1, cultivar: 'Alpha', type: 'tops', price_per_lb: 10, effective_from: '2026-06-01', created_at: 'x' },
    { id: 3, farm_id: 1, cultivar: 'Alpha', type: 'tops', price_per_lb: 99, effective_from: '2027-01-01', created_at: 'x' }, // future
    { id: 4, farm_id: 1, cultivar: 'Alpha', type: 'smalls', price_per_lb: 4, effective_from: '2026-01-01', created_at: 'x' },
    { id: 5, farm_id: 1, cultivar: 'Beta', type: 'tops', price_per_lb: 12, effective_from: '2026-01-01', created_at: 'x' },
    { id: 6, farm_id: 2, cultivar: 'Gamma', type: 'tops', price_per_lb: 77, effective_from: '2026-01-01', created_at: 'x' }, // other farm
  ];
  const dropoffs = [
    { id: 10, farm_id: 1, dropped_at: '2026-11-01 17:00:00', dropped_by: 'STAFF-NAME', note: 'INTERNAL-NOTE', source: 'app', client_key: 'CLIENT-KEY', voided_at: null, void_reason: null },
    { id: 11, farm_id: 1, dropped_at: '2026-11-05 17:00:00', dropped_by: 'STAFF-NAME', note: 'INTERNAL-NOTE', source: 'paper', client_key: 'CLIENT-KEY', voided_at: null, void_reason: null },
    { id: 12, farm_id: 1, dropped_at: '2026-11-06 17:00:00', dropped_by: 'STAFF-NAME', note: 'INTERNAL-NOTE', source: 'app', client_key: 'CLIENT-KEY', voided_at: '2026-11-06 18:00:00', void_reason: 'VOID-REASON' },
    { id: 13, farm_id: 2, dropped_at: '2026-11-07 17:00:00', dropped_by: 'STAFF-NAME', note: 'Farm B', source: 'app', client_key: 'CLIENT-KEY', voided_at: null, void_reason: null },
  ];
  const lot = (o) => ({
    farm_id: 1, term: 'dropoff', intake_lbs: 100, weighed_at: 'x', price_per_lb: 10, smalls_price_per_lb: 4,
    closed_at: null, note: 'INTERNAL-NOTE', note_visible: 0, voided_at: null, void_reason: null, farm_name: 'Farm A', dropped_at: 'x', ...o,
  });
  const lots = [
    lot({ id: 100, dropoff_id: 10, cultivar: 'Alpha', type: 'tops', closed_at: '2026-11-02 00:00:00' }), // screened, hidden note
    lot({ id: 101, dropoff_id: 10, cultivar: 'Alpha', type: 'smalls', smalls_price_per_lb: null, price_per_lb: 4, note: 'Shown to the farm', note_visible: 1 }),
    lot({ id: 102, dropoff_id: 11, cultivar: 'Beta', type: 'tops', term: 'sold', price_per_lb: 12, closed_at: '2026-11-06 00:00:00' }),
    lot({ id: 103, dropoff_id: 11, cultivar: 'Delta', type: 'tops', price_per_lb: null, intake_lbs: null, weighed_at: null }), // needs price, unweighed
    lot({ id: 104, dropoff_id: 11, cultivar: 'Alpha', type: 'tops', voided_at: 'x', void_reason: 'VOID-REASON' }), // voided lot
    lot({ id: 105, dropoff_id: 12, cultivar: 'Alpha', type: 'tops', voided_at: 'x', void_reason: 'VOID-REASON' }), // in voided dropoff
    lot({ id: 106, dropoff_id: 13, farm_id: 2, cultivar: 'Gamma', type: 'tops', farm_name: 'Farm B', note: 'Farm B', note_visible: 1 }), // other farm
  ];
  const runs = [
    { id: 1, lot_id: 100, run_at: 'x', pulled_lbs: 100, final_lbs: 80, to_smalls_lbs: 10, biomass_lbs: 8, mold_lbs: 2, diff_lbs: 0, note: 'RUN-NOTE', client_key: 'CLIENT-KEY', voided_at: null, void_reason: null },
    { id: 2, lot_id: 100, run_at: 'x', pulled_lbs: 50, final_lbs: 50, to_smalls_lbs: 0, biomass_lbs: 0, mold_lbs: 0, diff_lbs: 0, note: 'RUN-NOTE', client_key: 'CLIENT-KEY', voided_at: 'x', void_reason: 'VOID-REASON' },
    { id: 3, lot_id: 102, run_at: 'x', pulled_lbs: 100, final_lbs: 90, to_smalls_lbs: 0, biomass_lbs: 10, mold_lbs: 0, diff_lbs: 0, note: 'RUN-NOTE', client_key: 'CLIENT-KEY', voided_at: null, void_reason: null },
  ];
  const sold = [
    { id: 1, lot_id: 102, sold_on: '2026-11-08', lbs: 30, kind: 'main', note: 'SOLD-NOTE', client_key: 'CLIENT-KEY', voided_at: null, void_reason: null },
    { id: 2, lot_id: 102, sold_on: '2026-11-08', lbs: 20, kind: 'main', note: 'SOLD-NOTE', client_key: 'CLIENT-KEY', voided_at: 'x', void_reason: 'VOID-REASON' },
  ];
  const payments = [
    { id: 1, farm_id: 1, paid_on: '2026-11-03', amount: 500, method: 'check', reference: '1001', note: 'PAY-NOTE', client_key: 'CLIENT-KEY', voided_at: null, void_reason: null },
    { id: 2, farm_id: 1, paid_on: '2026-11-09', amount: 300, method: 'cash', reference: null, note: 'PAY-NOTE', client_key: 'CLIENT-KEY', voided_at: 'x', void_reason: 'VOID-REASON' },
    { id: 3, farm_id: 1, paid_on: '2026-11-04', amount: 200, method: 'ach', reference: 'R-2', note: 'PAY-NOTE', client_key: 'CLIENT-KEY', voided_at: null, void_reason: null },
    { id: 4, farm_id: 2, paid_on: '2026-11-10', amount: 9999, method: 'cash', reference: 'Farm B', note: 'Farm B', client_key: 'CLIENT-KEY', voided_at: null, void_reason: null },
  ];
  return { farm, price_points, dropoffs, lots, runs, sold, payments, today: '2026-11-17' };
}

const keys = (o) => Object.keys(o).sort();

test('no forbidden field reaches the reply', () => {
  const s = JSON.stringify(farmView(rows()));
  for (const bad of SENTINELS) assert.ok(!s.includes(bad), `leaked ${bad}`);
  for (const col of ['client_key', 'dropped_by', 'void_reason', 'voided_at', 'contact', 'farm_id', 'farm_name', 'source', 'diff_lbs', 'note_visible']) {
    assert.ok(!s.includes(`"${col}"`), `column ${col} in reply`);
  }
});

test('every object has exactly the allowlisted keys', () => {
  const v = farmView(rows());
  assert.deepEqual(keys(v), [...VIEW_KEYS.top].sort());
  assert.deepEqual(keys(v.farm), [...VIEW_KEYS.farm].sort());
  assert.deepEqual(keys(v.totals), [...VIEW_KEYS.totals].sort());
  for (const p of v.price_points) assert.deepEqual(keys(p), [...VIEW_KEYS.price_point].sort());
  for (const d of v.dropoffs) {
    assert.deepEqual(keys(d), [...VIEW_KEYS.dropoff].sort());
    for (const l of d.lots) assert.deepEqual(keys(l), [...VIEW_KEYS.lot].sort());
  }
  for (const p of v.payments) assert.deepEqual(keys(p), [...VIEW_KEYS.payment].sort());
  assert.deepEqual(VIEW_KEYS.lot, ['id', 'cultivar', 'type', 'term', 'status', 'intake_lbs', 'price_per_lb', 'smalls_price_per_lb', 'needs_price', 'estimate', 'owed',
    'final_lbs', 'to_smalls_lbs', 'biomass_lbs', 'mold_lbs', 'sold_lbs', 'on_hand_lbs', 'note']);
  assert.deepEqual(VIEW_KEYS.totals, ['balance', 'owed', 'paid', 'estimate', 'last_payment_on']);
});

test('a new column added to a row does not leak', () => {
  const r = rows();
  for (const list of [r.dropoffs, r.lots, r.runs, r.sold, r.payments, r.price_points]) for (const x of list) x.buyer = 'BUYER-NAME';
  r.farm.sale_price = 'SALE-PRICE';
  const s = JSON.stringify(farmView(r));
  assert.ok(!s.includes('BUYER-NAME'));
  assert.ok(!s.includes('SALE-PRICE'));
});

test('only this farm: other farm rows passed in by mistake are dropped', () => {
  const v = farmView(rows());
  assert.deepEqual(v.price_points.map((p) => p.cultivar), ['Alpha', 'Alpha', 'Beta']);
  assert.deepEqual(v.dropoffs.map((d) => d.id), [11, 10]);
  assert.deepEqual(v.payments.map((p) => p.amount), [200, 500]);
});

test('current price points: newest effective on or before today, tops before smalls', () => {
  const v = farmView(rows());
  assert.deepEqual(v.price_points, [
    { cultivar: 'Alpha', type: 'tops', price_per_lb: 10 },
    { cultivar: 'Alpha', type: 'smalls', price_per_lb: 4 },
    { cultivar: 'Beta', type: 'tops', price_per_lb: 12 },
  ]);
});

test('voided dropoffs, lots, runs, sold entries and payments are absent', () => {
  const v = farmView(rows());
  const lotIds = v.dropoffs.flatMap((d) => d.lots.map((l) => l.id));
  assert.deepEqual(lotIds.sort(), [100, 101, 102, 103]);
  const a = v.dropoffs.find((d) => d.id === 10).lots.find((l) => l.id === 100);
  assert.equal(a.final_lbs, 80, 'voided run not counted');
  const b = v.dropoffs.find((d) => d.id === 11).lots.find((l) => l.id === 102);
  assert.equal(b.sold_lbs, 30, 'voided sold entry not counted');
  assert.equal(v.payments.length, 2);
});

test('lot fields: after numbers once screened, sold numbers for sold lots, note only when visible', () => {
  const v = farmView(rows());
  const all = Object.fromEntries(v.dropoffs.flatMap((d) => d.lots).map((l) => [l.id, l]));
  assert.deepEqual(all[100], {
    id: 100, cultivar: 'Alpha', type: 'tops', term: 'dropoff', status: 'closed', intake_lbs: 100, price_per_lb: 10, smalls_price_per_lb: 4,
    needs_price: false, estimate: false, owed: 840, final_lbs: 80, to_smalls_lbs: 10, biomass_lbs: 8, mold_lbs: 2, sold_lbs: null, on_hand_lbs: null, note: null,
  });
  assert.equal(all[101].note, 'Shown to the farm');
  assert.equal(all[101].final_lbs, null, 'not screened: no after numbers');
  assert.equal(all[101].estimate, true);
  assert.equal(all[101].smalls_price_per_lb, null);
  assert.equal(all[102].sold_lbs, 30);
  assert.equal(all[102].on_hand_lbs, 60);
  assert.equal(all[102].owed, 360);
  assert.equal(all[103].needs_price, true);
  assert.equal(all[103].intake_lbs, null);
  assert.equal(all[103].status, 'dropped');
});

test('totals are farmTotals over the same live rows (same maths as the staff page)', () => {
  const r = rows();
  const v = farmView(r);
  const live = r.lots.filter((l) => l.farm_id === 1 && !l.voided_at);
  const want = farmTotals(live.map((l) => lotMoney(l, r.runs.filter((x) => x.lot_id === l.id), r.sold.filter((x) => x.lot_id === l.id))), r.payments.filter((p) => p.farm_id === 1));
  assert.equal(v.totals.owed, want.owed);
  assert.equal(v.totals.paid, want.paid);
  assert.equal(v.totals.balance, want.balance);
  assert.equal(v.totals.estimate, want.estimate);
  assert.equal(v.totals.last_payment_on, '2026-11-04');
  assert.equal(v.totals.owed, 840 + 400 + 360);
  assert.equal(v.totals.paid, 700);
});

test('a credit balance stays below zero, never clamped', () => {
  const r = rows();
  r.payments.push({ id: 9, farm_id: 1, paid_on: '2026-11-12', amount: 5000, method: 'check', reference: null, note: null, voided_at: null });
  const v = farmView(r);
  assert.equal(v.totals.balance, 1600 - 5700);
  assert.equal(v.totals.last_payment_on, '2026-11-12');
});

test('farm block is name and lang only; empty farm gives empty lists', () => {
  const v = farmView({ farm: { id: 3, name: 'Farm C', lang: 'en', contact: 'CONTACT' }, today: '2026-11-17' });
  assert.deepEqual(v.farm, { name: 'Farm C', lang: 'en' });
  assert.deepEqual(v.dropoffs, []);
  assert.deepEqual(v.payments, []);
  assert.deepEqual(v.totals, { balance: 0, owed: 0, paid: 0, estimate: false, last_payment_on: null });
});
