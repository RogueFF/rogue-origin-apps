// The water spider's raw hand-out must match the SOP-028 wall sheet, row for row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rawPerBag, suggestRaw, rateFor, strainOf } from '../src/js/rawout/rates.mjs';

const BAG_KEYS = ['qOz', 'hOz', 'oz1', 'qLb', 'hLb', 'lb1'];

test('the SOP-028 chart, every row', () => {
  assert.deepEqual(BAG_KEYS.map(b => rawPerBag('2026 - Lifter / Sungrown', b)), [35, 65, 130, 505, 1000, 2000]);
  assert.deepEqual(BAG_KEYS.map(b => rawPerBag('2026 - Sour Lifter / Sungrown', b)), [45, 90, 175, 670, 1350, 2700]);
});

test('several bags multiply the rounded row: 4 × 1 oz Sour Lifter = 700 g', () => {
  assert.equal(suggestRaw('2026 - Sour Lifter / Sungrown', 'oz1', 4), 700);
  assert.equal(suggestRaw('2026 - Sour Lifter / Sungrown', 'nope', 4), null);
});

test('only Lifter itself gets the Lifter rate', () => {
  assert.equal(strainOf('2026 - Sour Lifter / Sungrown'), 'sour lifter');
  assert.equal(rateFor('2026 - Lifter / Sungrown').basis, 'Lifter');
  assert.equal(rateFor('Lifter').basis, 'Lifter');
  assert.equal(rateFor('2026 - Limey Lifter / Sungrown').basis, 'Sour Lifter');
  assert.equal(rateFor('2026 - Sour Lifter / Sungrown').basis, 'Sour Lifter');
  assert.equal(rateFor('2026 - Strawberry Fritter / Greenhouse').basis, 'Sour Lifter');
});
