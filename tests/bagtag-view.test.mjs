// Bag/tag queue helpers (src/js/bagtag/view.mjs, design doc §2e slice 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bagLabel, ageText, lineText, splitLists, routeCounts, syncAgeMin, whyText, cellLine } from '../src/js/bagtag/view.mjs';

const NOW = Date.parse('2026-11-10T18:00:00Z');

test('age reads in minutes, hours, then days', () => {
  assert.equal(ageText('2026-11-10T17:48:00Z', NOW), '12 min');
  assert.equal(ageText('2026-11-10T15:00:00Z', NOW), '3 h');
  assert.equal(ageText('2026-11-07T18:00:00Z', NOW), '3 d');
  assert.equal(ageText('2026-11-10T18:05:00Z', NOW), '0 min', 'a clock a little ahead never goes negative');
});

test('a line reads cultivar · form · size × count', () => {
  assert.equal(lineText({ cultivar: 'Sour Lifter', form: 'tops', bag: 'oz1', qty: 4, qtyOpen: 4 }), 'Sour Lifter · Tops · 1 oz × 4');
  assert.equal(lineText({ cultivar: null, title: 'Hemp Pre-Rolls 5 pack', form: null, bag: null, qty: 2, qtyOpen: 1 }), 'Hemp Pre-Rolls 5 pack · × 1');
  assert.equal(bagLabel('lb10'), '10 lb');
  assert.equal(bagLabel('nope'), '');
});

test('lists and counts', () => {
  const orders = [
    { state: 'queued', lines: [{ route: 'cell' }, { route: 'bagging' }] },
    { state: 'queued', lines: [{ route: 'pack' }] },
    { state: 'assigned', confirmedAt: 'x', lines: [{ route: 'cell' }] },
    { state: 'assigned', lines: [{ route: 'cell' }] },                         // not confirmed yet
    { state: 'ready', lines: [{ route: 'cell' }] },                            // at the pickup spot
    { state: 'ready', collectedAt: 'x', lines: [{ route: 'cell' }] },
  ];
  const { toStart, inCells, ready } = splitLists(orders);
  assert.deepEqual([toStart.length, inCells.length, ready.length], [3, 2, 1]);
  assert.deepEqual(routeCounts(toStart), { cell: 2, bagging: 1, pack: 1, wholesale: 0, ask: 0 });
});

test('route reasons read in Spanish; unknown ones pass through', () => {
  assert.equal(whyText('2025 crop: already trimmed', 'es'), 'Cosecha 2025: ya podada');
  assert.equal(whyText('Smalls: bagged from the pool', 'es'), 'Smalls: se embolsa del inventario');
  assert.equal(whyText('Smalls: bagged from the pool', 'en'), 'Smalls: bagged from the pool');
  assert.equal(whyText('Something new', 'es'), 'Something new');
});

test('cell line: at a cell, waiting, or no cell work', () => {
  assert.deepEqual(cellLine({ cellLines: 0, cell: null }), { kind: 'bagOnly' });
  assert.deepEqual(cellLine({ cellLines: 1, cell: { waiting: true, label: 'Cell 13', inMin: 25 } }), { kind: 'waiting', label: 'Cell 13', inMin: 25 });
  assert.equal(cellLine({ cellLines: 1, cell: { label: 'Cell 1', slot: 'NOW', baskets: 2, done: 1 } }).slot, 'NOW');
});

test('sync age', () => {
  assert.equal(syncAgeMin({ lastOkAt: '2026-11-10 17:57:00' }, NOW), 3);
  assert.equal(syncAgeMin(null, NOW), null);
  assert.equal(syncAgeMin({ lastOkAt: null }, NOW), null);
});
