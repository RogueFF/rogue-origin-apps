/**
 * Unit tests for order coverage — the over-commit warning's arithmetic.
 *
 * Compares what has been promised against what is actually packed and sellable.
 *
 * Two things it deliberately does NOT do:
 *
 * 1. It does not project raw supersacks into finished pounds. That math already
 *    exists in supersack-d1's tops_breakdown, which is auth-gated and cached;
 *    a second copy here would drift from it. Raw sacks are reported as a count,
 *    for context, so an operator can tell "nothing packed yet" apart from
 *    "nothing to pack".
 *
 * 2. It does not treat a shortfall as an error. Mid-season most inventory is
 *    raw, so being short on packed goods is the normal state, not an alarm.
 *
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeInventory, assessCoverage } from '../workers/src/lib/coverage.js';

const near = (a, b, tol = 0.01) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${a} to be within ${tol} of ${b}`);

const PREFIXES = { LIFT: 'lifter', BB: 'berry-bliss', SLIFT: 'sour-lifter' };

// --- inventory summarising -----------------------------------------------

test('a packed SKU becomes finished pounds for its cultivar and form', () => {
  // 198 x 5 kg bags of Lifter tops
  const r = summarizeInventory([{ sku: 'LIFT-INTL-HT-5-KG-2025', units: 198 }], PREFIXES);
  near(r.finished['lifter|tops'], 2182.57, 0.5);
});

test('pack sizes of the same cultivar and form add up', () => {
  const r = summarizeInventory([
    { sku: 'BB-FLWR-SUN-TOP-1-LB-2025', units: 10 },
    { sku: 'BB-FLWR-SUN-TOP-10-LB-2025', units: 3 },
  ], PREFIXES);
  near(r.finished['berry-bliss|tops'], 40);
});

test('tops and smalls are counted separately', () => {
  const r = summarizeInventory([
    { sku: 'BB-FLWR-SUN-TOP-1-LB-2025', units: 5 },
    { sku: 'BB-FLWR-SUN-SM-1-LB-2025', units: 7 },
  ], PREFIXES);
  near(r.finished['berry-bliss|tops'], 5);
  near(r.finished['berry-bliss|smalls'], 7);
});

test('raw supersacks are counted as sacks, never as finished pounds', () => {
  // A SUPRSAK is unprocessed material. Counting it as packed inventory would
  // say an order can ship when nothing has been trimmed.
  const r = summarizeInventory([{ sku: 'LIFT-SG-SUPRSAK-2025', units: 85 }], PREFIXES);
  assert.equal(r.finished['lifter|tops'], undefined);
  assert.equal(r.rawSacks['lifter'], 85);
});

test('a SKU that does not parse is skipped and reported, not guessed at', () => {
  const r = summarizeInventory([
    { sku: 'TEST-SKU-001', units: 100 },
    { sku: 'BB-FLWR-SUN-TOP-1-LB-2025', units: 4 },
  ], PREFIXES);
  near(r.finished['berry-bliss|tops'], 4);
  assert.ok(r.skipped.includes('TEST-SKU-001'));
});

test('a SKU for a cultivar we do not know is skipped, not attributed elsewhere', () => {
  const r = summarizeInventory([{ sku: 'ZZZ-FLWR-SUN-TOP-1-LB-2025', units: 50 }], PREFIXES);
  assert.deepEqual(r.finished, {});
  assert.ok(r.skipped.some(s => s.includes('ZZZ')));
});

test('zero and negative unit counts are ignored', () => {
  const r = summarizeInventory([
    { sku: 'BB-FLWR-SUN-TOP-1-LB-2025', units: 0 },
    { sku: 'BB-FLWR-SUN-SM-1-LB-2025', units: -3 },
  ], PREFIXES);
  assert.deepEqual(r.finished, {});
});

// --- coverage ------------------------------------------------------------

const inv = {
  finished: { 'lifter|tops': 2182.57, 'berry-bliss|tops': 40 },
  rawSacks: { lifter: 85, 'berry-bliss': 120 },
  skipped: [],
};

test('demand within packed inventory is covered', () => {
  const r = assessCoverage([{ cultivarId: 'lifter', form: 'tops', committedLbs: 500 }], inv);
  assert.equal(r[0].short, false);
  near(r[0].shortfallLbs, 0);
});

test('demand beyond packed inventory is short by the difference', () => {
  const r = assessCoverage([{ cultivarId: 'berry-bliss', form: 'tops', committedLbs: 110 }], inv);
  assert.equal(r[0].short, true);
  near(r[0].shortfallLbs, 70);
  near(r[0].finishedLbs, 40);
});

test('a shortfall carries the raw sack count, so it can be read in context', () => {
  const r = assessCoverage([{ cultivarId: 'berry-bliss', form: 'tops', committedLbs: 110 }], inv);
  assert.equal(r[0].rawSacks, 120);
});

test('a cultivar with nothing packed and nothing raw is short and says so', () => {
  const r = assessCoverage([{ cultivarId: 'sour-lifter', form: 'tops', committedLbs: 300 }], inv);
  assert.equal(r[0].short, true);
  near(r[0].finishedLbs, 0);
  assert.equal(r[0].rawSacks, 0);
});

test('exactly enough is not short', () => {
  const r = assessCoverage([{ cultivarId: 'berry-bliss', form: 'tops', committedLbs: 40 }], inv);
  assert.equal(r[0].short, false);
});

test('an empty order book produces no rows to worry about', () => {
  assert.deepEqual(assessCoverage([], inv), []);
});
