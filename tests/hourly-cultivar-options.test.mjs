/**
 * The hourly-entry cultivar dropdown: the whole 2026 crop from the Super Sack
 * variants, plus only the 2025 strains still being trimmed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCultivarOptions, variantCultivar, CARRYOVER } from '../src/js/hourly-entry/cultivar-options.mjs';

const variant = (cultivar, type, cut, quantity = 0) => ({
  title: `${cultivar} / ${type} / ${cut}`,
  quantity,
  options: [
    { name: 'Cultivar', value: cultivar },
    { name: 'Harvest Type', value: type },
    { name: 'Cut', value: cut },
  ],
});

test('a variant is offered without its cut, keeping the harvest type', () => {
  assert.equal(variantCultivar(variant('2026 - Sour Lifter', 'Sungrown', '1st Cut')), '2026 - Sour Lifter / Sungrown');
  assert.equal(variantCultivar(variant('2026 - Gravy Train', 'Greenhouse', '2nd Cut')), '2026 - Gravy Train / Greenhouse');
  assert.equal(variantCultivar({ title: '2026 - Lemon / Sungrown / 3rd Cut' }), '2026 - Lemon / Sungrown');
});

test('every 2026 cultivar is listed once, bags or not', () => {
  const opts = buildCultivarOptions([], [
    variant('2026 - Sour Lifter', 'Sungrown', '1st Cut', 128),
    variant('2026 - Sour Lifter', 'Sungrown', '2nd Cut', 0),
    variant('2026 - Angel Cake', 'Sungrown', '1st Cut', 0),
  ]);
  assert.ok(opts.includes('2026 - Sour Lifter / Sungrown'));
  assert.ok(opts.includes('2026 - Angel Cake / Sungrown'));
  assert.equal(opts.filter((c) => c === '2026 - Sour Lifter / Sungrown').length, 1);
});

test('2025 is the carryover list only, whatever history or Shopify hold', () => {
  const opts = buildCultivarOptions(
    ['2025 - Lifter / Sungrown', '2025 - Elektra / Sungrown', '2024 - Lifter / Sungrown', 'LOG', 'Lifter'],
    [variant('2025 - Mix', 'Sungrown', '1st Cut', 114), variant('2024 - Bubba Kush 18', 'Sungrown', '1st Cut', 1)],
  );
  assert.deepEqual(opts, [...CARRYOVER].sort());
});

test('Shopify down: carryover plus any 2026 spelling already logged', () => {
  const opts = buildCultivarOptions(['2026 - Rainbow GMO / Sungrown', '2025 - Catnip / Sungrown'], []);
  assert.deepEqual(opts, [...CARRYOVER, '2026 - Rainbow GMO / Sungrown'].sort());
});
