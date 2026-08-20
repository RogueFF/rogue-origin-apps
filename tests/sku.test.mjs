/**
 * Unit tests for SKU parsing.
 *
 * A Shopify line carries a SKU that already encodes everything the order board
 * needs: which cultivar, tops or smalls, and how much is in the pack. Reading
 * the SKU is far more reliable than reading the product title off a screenshot,
 * and cultivars.sku_prefix makes the cultivar lookup an exact join rather than
 * a fuzzy name match.
 *
 * Two real shapes exist in the catalogue (verified against all 362 rows of the
 * products export):
 *   PREFIX-FLWR-SUN-TOP-1/4-LB-2025   domestic flower, 7 segments, explicit form
 *   PREFIX-INTL-HT-5-KG-2025          international, 6 segments, HT means tops
 *
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSku, packLbs } from '../workers/src/lib/sku.js';

const near = (a, b, tol = 0.001) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${a} to be within ${tol} of ${b}`);

// --- the domestic shape --------------------------------------------------

test('a domestic tops SKU yields prefix, form and pack size', () => {
  const r = parseSku('AOG-FLWR-SUN-TOP-1-OZ-2025');
  assert.equal(r.prefix, 'AOG');
  assert.equal(r.form, 'tops');
  assert.equal(r.year, 2025);
  near(r.packLbs, 0.0625);
});

test('SM means smalls', () => {
  assert.equal(parseSku('AOG-FLWR-SUN-SM-1/4-LB-2025').form, 'smalls');
});

test('fractional pack sizes are read as fractions, not truncated', () => {
  near(parseSku('BB-FLWR-SUN-TOP-1/4-LB-2025').packLbs, 0.25);
  near(parseSku('BB-FLWR-SUN-TOP-1/2-LB-2025').packLbs, 0.5);
});

test('every pack size in the live catalogue resolves', () => {
  near(packLbs('1', 'OZ'), 0.0625);
  near(packLbs('1/4', 'LB'), 0.25);
  near(packLbs('1/2', 'LB'), 0.5);
  near(packLbs('1', 'LB'), 1);
  near(packLbs('10', 'LB'), 10);
  near(packLbs('5', 'KG'), 11.0231);
});

// --- the international shape ---------------------------------------------

test('the six-segment international SKU parses, with HT meaning tops', () => {
  const r = parseSku('LIFT-INTL-HT-5-KG-2025');
  assert.equal(r.prefix, 'LIFT');
  assert.equal(r.form, 'tops');
  near(r.packLbs, 11.0231);
});

// --- refusal -------------------------------------------------------------

test('an unrecognised SKU is refused rather than guessed at', () => {
  // Guessing here would attach real pounds to the wrong cultivar and silently
  // reprice every date behind it in the queue.
  assert.throws(() => parseSku('NOT-A-SKU'), /sku/i);
  assert.throws(() => parseSku(''), /sku/i);
  assert.throws(() => parseSku(null), /sku/i);
});

test('an unknown unit is refused rather than assumed to be pounds', () => {
  assert.throws(() => parseSku('BB-FLWR-SUN-TOP-1-TON-2025'), /unit/i);
});

test('an unknown form segment is refused', () => {
  assert.throws(() => parseSku('BB-FLWR-SUN-XX-1-LB-2025'), /form/i);
});

test('a non-numeric pack size is refused', () => {
  assert.throws(() => parseSku('BB-FLWR-SUN-TOP-BULK-LB-2025'), /size/i);
});

// --- the whole catalogue -------------------------------------------------

test('parsing is case-insensitive, since a screenshot may be read either way', () => {
  const r = parseSku('aog-flwr-sun-top-1-oz-2025');
  assert.equal(r.prefix, 'AOG');
  assert.equal(r.form, 'tops');
});

test('surrounding whitespace is tolerated', () => {
  assert.equal(parseSku('  BB-FLWR-SUN-TOP-1-LB-2025 ').prefix, 'BB');
});

test('a line total is quantity times pack size', () => {
  // Five 1-oz jars is a third of a pound; four 10-lb boxes is forty.
  near(parseSku('BB-FLWR-SUN-TOP-1-OZ-2025').packLbs * 5, 0.3125);
  near(parseSku('BB-FLWR-SUN-TOP-10-LB-2025').packLbs * 4, 40);
});
