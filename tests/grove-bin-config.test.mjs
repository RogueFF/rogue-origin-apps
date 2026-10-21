/**
 * Unit tests for Grove bin config validation (workers/src/lib/bin-config.js).
 * bags_per_bin is a divisor downstream, so bad values must never pass.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBinConfig } from '../workers/src/lib/bin-config.js';

test('valid full set maps camelCase to columns', () => {
  const { data, error } = validateBinConfig({ bagsPerBox: 100, bagsPerBin: 50, leadDays: 75, safetyDays: 30, moq: 2500, seedPerMonth: 412.5, colour: 'orange' });
  assert.equal(error, null);
  assert.deepEqual(data, { bags_per_box: 100, bags_per_bin: 50, lead_days: 75, safety_days: 30, moq: 2500, seed_per_month: 412.5, colour: 'orange' });
});

test('bagsPerBin 0 rejected', () => {
  const r = validateBinConfig({ bagsPerBin: 0 });
  assert.equal(r.data, null);
  assert.match(r.error, /bagsPerBin/);
});

test('fractional bagsPerBin rejected', () => {
  assert.match(validateBinConfig({ bagsPerBin: 12.5 }).error, /bagsPerBin/);
});

test('negative lead rejected', () => {
  assert.match(validateBinConfig({ leadDays: -1 }).error, /leadDays/);
});

test('non-numeric value rejected', () => {
  assert.match(validateBinConfig({ moq: 'lots' }).error, /moq/);
});

test('colour too long rejected', () => {
  assert.match(validateBinConfig({ colour: 'x'.repeat(21) }).error, /colour/);
});

test('empty body → nothing to set', () => {
  assert.deepEqual(validateBinConfig({}), { data: null, error: 'nothing to set' });
  assert.equal(validateBinConfig(undefined).error, 'nothing to set');
});

test('null values are "not provided", not zero', () => {
  assert.equal(validateBinConfig({ leadDays: null, bagsPerBin: null }).error, 'nothing to set');
  assert.deepEqual(validateBinConfig({ leadDays: null, moq: 0 }).data, { moq: 0 });
});

test('unknown keys (incl. cardId) ignored', () => {
  assert.equal(validateBinConfig({ cardId: 21, hack: 'DROP TABLE' }).error, 'nothing to set');
  assert.deepEqual(validateBinConfig({ cardId: 21, safetyDays: 14, bogus: 1 }).data, { safety_days: 14 });
});

test('non-number/non-string types rejected (Number(true) is 1, Number([50]) is 50)', () => {
  assert.match(validateBinConfig({ bagsPerBin: true }).error, /bagsPerBin/);
  assert.match(validateBinConfig({ bagsPerBin: [50] }).error, /bagsPerBin/);
  assert.match(validateBinConfig({ colour: 7 }).error, /colour/);
  assert.match(validateBinConfig({ moq: '  ' }).error, /moq/);
  assert.deepEqual(validateBinConfig({ bagsPerBin: '25' }).data, { bags_per_bin: 25 });
});

test('planPerMonth maps to plan_per_month; 0 switches the plan off; negatives rejected', () => {
  assert.deepEqual(validateBinConfig({ planPerMonth: 1500 }).data, { plan_per_month: 1500 });
  assert.deepEqual(validateBinConfig({ planPerMonth: 0 }).data, { plan_per_month: 0 });
  assert.deepEqual(validateBinConfig({ planPerMonth: '1500' }).data, { plan_per_month: 1500 });
  assert.match(validateBinConfig({ planPerMonth: -1 }).error, /planPerMonth/);
});

test('orderDays maps to order_days as an integer ≥ 0', () => {
  assert.deepEqual(validateBinConfig({ orderDays: 14 }).data, { order_days: 14 });
  assert.deepEqual(validateBinConfig({ orderDays: 0 }).data, { order_days: 0 });
  assert.match(validateBinConfig({ orderDays: 1.5 }).error, /orderDays/);
  assert.match(validateBinConfig({ orderDays: -7 }).error, /orderDays/);
});
