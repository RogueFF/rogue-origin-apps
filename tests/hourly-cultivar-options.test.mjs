/**
 * The hourly-entry cultivar dropdown: the whole 2026 crop from the Super Sack
 * variants, plus only the older strains still being trimmed (none since 2026-11-02).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCultivarOptions, variantCultivar, CARRYOVER, isCurrentSungrown } from '../src/js/hourly-entry/cultivar-options.mjs';

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

test('the 2025 carryover is finished: no 2025 strain is offered', () => {
  const opts = buildCultivarOptions(['2025 - Lifter / Sungrown'], [variant('2025 - Sugar Shaker', 'Sungrown', '1st Cut', 3)]);
  assert.equal(opts.filter((c) => c.startsWith('2025')).length, 0);
});

test('Shopify down: carryover plus any 2026 spelling already logged', () => {
  const opts = buildCultivarOptions(['2026 - Rainbow GMO / Sungrown', '2025 - Catnip / Sungrown'], []);
  assert.deepEqual(opts, [...CARRYOVER, '2026 - Rainbow GMO / Sungrown'].sort());
});

// Koa 2026-11-10: "Cells: Sungrown only". Two Greenhouse picks that day.
const MIXED = [
  variant('2026 - Purple Snowman', 'Greenhouse', '1st Cut'),
  variant('2026 - Purple Snowman', 'Sungrown', '1st Cut'),
  variant('2026 - Strawberry Doughnuts', 'Greenhouse', '1st Cut'),
  variant('2026 - Strawberry Doughnuts', 'Sungrown', '1st Cut'),
  variant('2026 - Angel Cake', 'Sungrown', '1st Cut'),
];

test('the hourly log keeps every 2026 entry, with Sungrown first', () => {
  const opts = buildCultivarOptions(['2026 - Gravy Train / Greenhouse'], MIXED);
  assert.deepEqual(opts, [
    '2026 - Angel Cake / Sungrown',
    '2026 - Purple Snowman / Sungrown',
    '2026 - Strawberry Doughnuts / Sungrown',
    '2026 - Gravy Train / Greenhouse',
    '2026 - Purple Snowman / Greenhouse',
    '2026 - Strawberry Doughnuts / Greenhouse',
  ]);
});

test('cells (cell screen, raw hand-out): 2026 Sungrown only', () => {
  const opts = buildCultivarOptions(['2026 - Gravy Train / Greenhouse', '2026 - Lifter / Sungrown'], MIXED, { sungrownOnly: true });
  assert.deepEqual(opts, [
    '2026 - Angel Cake / Sungrown',
    '2026 - Lifter / Sungrown',
    '2026 - Purple Snowman / Sungrown',
    '2026 - Strawberry Doughnuts / Sungrown',
  ]);
  assert.ok(opts.every((c) => isCurrentSungrown(c)));
  assert.equal(isCurrentSungrown('2026 - Lifter / Greenhouse'), false);
  assert.equal(isCurrentSungrown('2025 - Lifter / Sungrown'), false);
});
