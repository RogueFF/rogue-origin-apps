/**
 * Unit tests for the pure core of the wholesale order queue.
 *
 * Covers the arithmetic that decides what the floor runs and what date an
 * order gets promised. The D1 round-trips are integration surface — see
 * docs/plans/2026-08-19-order-blocks-design.md §7.
 *
 * The load-bearing idea under all of this: tops and smalls are joint products
 * of ONE trimming pass, verified against 45 days of monthly_production. A lot
 * is therefore sized by whichever form is binding, and the other form comes off
 * as surplus. Getting that backwards is what the first design draft did.
 *
 * Run with `node --test` (matches .github/workflows/test.yml).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LB_PER_KG,
  toLbs,
  fromLbs,
  lotSize,
  pickRate,
  poolDemand,
} from '../workers/src/lib/wholesale.js';

const near = (a, b, tol = 0.01) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${a} to be within ${tol} of ${b}`);

// --- unit conversion -----------------------------------------------------

test('pounds pass through untouched', () => {
  assert.equal(toLbs(100, 'lb'), 100);
});

test('kilograms convert with a single shared constant', () => {
  // The tree previously carried 2.205 in one place and 2.20462 in another.
  near(toLbs(100, 'kg'), 220.462);
  assert.equal(LB_PER_KG, 2.20462);
});

test('conversion round-trips so a kg order redisplays as the kg it was entered in', () => {
  const entered = 140;
  near(fromLbs(toLbs(entered, 'kg'), 'kg'), entered, 1e-9);
});

test('an unknown unit is rejected rather than silently treated as pounds', () => {
  assert.throws(() => toLbs(10, 'g'), /unit/i);
  assert.throws(() => toLbs(10, ''), /unit/i);
});

test('negative and non-finite quantities are rejected', () => {
  assert.throws(() => toLbs(-1, 'lb'), /quantity/i);
  assert.throws(() => toLbs(NaN, 'lb'), /quantity/i);
  assert.throws(() => toLbs('140', 'kg'), /quantity/i);
});

// --- lot sizing ----------------------------------------------------------

test('a tops-only order sizes the lot off the tops fraction', () => {
  // Sour Lifter: 484 lb of tops ordered, 60.2% tops => 804 lb of lot.
  const r = lotSize({ topsLbs: 484, smallsLbs: 0, topsFraction: 0.602 });
  near(r.lotLbs, 804.0, 0.5);
  assert.equal(r.binding, 'tops');
});

test('the non-binding form comes off as surplus, not waste', () => {
  const r = lotSize({ topsLbs: 484, smallsLbs: 0, topsFraction: 0.602 });
  near(r.yieldSmalls, 320, 1);
  near(r.surplusSmalls, 320, 1);
  near(r.surplusTops, 0, 0.01);
});

test('smalls can be the binding form and drive a bigger lot than tops alone would', () => {
  // Lifter: 231 lb tops + 220 lb smalls at 54.6% tops.
  // tops alone needs 423 lb of lot; smalls needs 485. Smalls wins.
  const r = lotSize({ topsLbs: 231, smallsLbs: 220, topsFraction: 0.546 });
  near(r.lotLbs, 484.6, 0.5);
  assert.equal(r.binding, 'smalls');
  near(r.surplusTops, 33.6, 0.5);
  near(r.surplusSmalls, 0, 0.01);
});

test('a lot always covers both forms it was asked for', () => {
  for (const [t, s, f] of [[484, 0, 0.602], [231, 220, 0.546], [110, 94, 0.539], [0, 132, 0.521]]) {
    const r = lotSize({ topsLbs: t, smallsLbs: s, topsFraction: f });
    assert.ok(r.yieldTops >= t - 1e-6, `tops yield ${r.yieldTops} must cover ${t}`);
    assert.ok(r.yieldSmalls >= s - 1e-6, `smalls yield ${r.yieldSmalls} must cover ${s}`);
  }
});

test('no demand means no lot', () => {
  const r = lotSize({ topsLbs: 0, smallsLbs: 0, topsFraction: 0.54 });
  assert.equal(r.lotLbs, 0);
  assert.equal(r.binding, null);
});

test('an impossible tops fraction is rejected instead of dividing by zero', () => {
  // 100% tops cannot ever yield smalls; asking for smalls is unsatisfiable.
  assert.throws(() => lotSize({ topsLbs: 0, smallsLbs: 50, topsFraction: 1 }), /fraction/i);
  assert.throws(() => lotSize({ topsLbs: 50, smallsLbs: 0, topsFraction: 0 }), /fraction/i);
  assert.throws(() => lotSize({ topsLbs: 1, smallsLbs: 1, topsFraction: 1.4 }), /fraction/i);
});

// --- rate selection ------------------------------------------------------

const THICK = { lbs: 900, topsLbs: 480, hours: 500 };
const THIN = { lbs: 20, topsLbs: 11, hours: 7 };
const FALLBACK = { ratePerTrimmerHour: 1.67, topsFraction: 0.539 };

test('same-year history is preferred when it is thick enough', () => {
  const r = pickRate({ sameYear: THICK, allYears: THICK, minHours: 20, fallback: FALLBACK });
  assert.equal(r.basis, 'same-year');
  near(r.ratePerTrimmerHour, 1.8);
  near(r.topsFraction, 0.5333);
});

test('a thin current year widens to all years rather than guessing', () => {
  const r = pickRate({ sameYear: THIN, allYears: THICK, minHours: 20, fallback: FALLBACK });
  assert.equal(r.basis, 'all-years');
  near(r.hours, 500);
});

test('no usable history at all falls back to the farm average, and says so', () => {
  // Alium OG and Sour Brulee both sell but have never been trimmed.
  const r = pickRate({ sameYear: null, allYears: null, minHours: 20, fallback: FALLBACK });
  assert.equal(r.basis, 'fallback');
  near(r.ratePerTrimmerHour, 1.67);
  near(r.topsFraction, 0.539);
});

test('history thinner than the floor everywhere is treated as no history', () => {
  const r = pickRate({ sameYear: THIN, allYears: THIN, minHours: 20, fallback: FALLBACK });
  assert.equal(r.basis, 'fallback');
});

test('zero trimmer-hours never produces a divide-by-zero rate', () => {
  const empty = { lbs: 0, topsLbs: 0, hours: 0 };
  const r = pickRate({ sameYear: empty, allYears: empty, minHours: 20, fallback: FALLBACK });
  assert.equal(r.basis, 'fallback');
  assert.ok(Number.isFinite(r.ratePerTrimmerHour));
});

// --- demand pooling ------------------------------------------------------

const ITEMS = [
  { orderId: 'MO-1', cultivarId: 'sour-lifter', form: 'tops', qtyLbs: 308 },
  { orderId: 'MO-1', cultivarId: 'lifter', form: 'tops', qtyLbs: 143 },
  { orderId: 'MO-1', cultivarId: 'lifter', form: 'smalls', qtyLbs: 220 },
  { orderId: 'MO-2', cultivarId: 'lifter', form: 'tops', qtyLbs: 88 },
  { orderId: 'MO-3', cultivarId: 'sour-lifter', form: 'tops', qtyLbs: 176 },
];

test('demand pools by cultivar, not by cultivar and form', () => {
  const pools = poolDemand(ITEMS);
  assert.deepEqual(pools.map(p => p.cultivarId).sort(), ['lifter', 'sour-lifter']);
});

test('a pool sums both forms across every order that needs the cultivar', () => {
  const lifter = poolDemand(ITEMS).find(p => p.cultivarId === 'lifter');
  near(lifter.topsLbs, 231);   // 143 + 88, two different orders
  near(lifter.smallsLbs, 220);
});

test('a pool records which orders it feeds, so a run can name them', () => {
  const lifter = poolDemand(ITEMS).find(p => p.cultivarId === 'lifter');
  assert.deepEqual([...lifter.orderIds].sort(), ['MO-1', 'MO-2']);
});

test('pooling an empty order book yields no runs rather than throwing', () => {
  assert.deepEqual(poolDemand([]), []);
});

test('an unknown form is rejected rather than being silently dropped from demand', () => {
  const bad = [{ orderId: 'MO-1', cultivarId: 'lifter', form: 'biomass', qtyLbs: 5 }];
  assert.throws(() => poolDemand(bad), /form/i);
});
