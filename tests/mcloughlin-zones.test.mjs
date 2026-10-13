import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VALID_ZONES } from '../workers/src/lib/zones.js';
import { ZONE_CULTIVARS, MCLOUGHLIN_ZONES, mcloughlinZonesFor, mcloughlinCultivars, isHarvestTracked }
  from '../workers/src/lib/zone-cultivars.js';

test('McLoughlin zones MZ1-MZ4 are valid, harvest-tracked zones', () => {
  for (const z of ['MZ1', 'MZ2', 'MZ3', 'MZ4']) {
    assert.ok(VALID_ZONES.has(z), `${z} valid`);
    assert.ok(isHarvestTracked(z), `${z} tracked`);
  }
  assert.deepEqual(MCLOUGHLIN_ZONES, ['MZ1', 'MZ2', 'MZ3', 'MZ4']);
});

test('every cultivar resolves to its McLoughlin zone from the verified layout', () => {
  assert.deepEqual(mcloughlinZonesFor('Critical Berries'), ['MZ1']);
  assert.deepEqual(mcloughlinZonesFor('Runtz'), ['MZ3']);
  assert.deepEqual(mcloughlinZonesFor('Sour Suver Haze'), ['MZ4']);
  // Grown at the Egg Farm too, but an add is always McLoughlin.
  assert.deepEqual(mcloughlinZonesFor('Animal Muffins'), ['MZ3']);
  assert.deepEqual(mcloughlinZonesFor('Strawberry Doughnuts'), ['MZ3']);
  assert.deepEqual(mcloughlinZonesFor('GMO Belly'), ['MZ4']);
  assert.deepEqual(mcloughlinZonesFor('Sour Lifter'), ['MZ4']);
  // The only two planted in two McLoughlin zones.
  assert.deepEqual(mcloughlinZonesFor('Angel Cake'), ['MZ1', 'MZ2']);
  assert.deepEqual(mcloughlinZonesFor('King Kush'), ['MZ2', 'MZ4']);
  assert.deepEqual(mcloughlinZonesFor('Lifter'), []);
  assert.deepEqual(mcloughlinZonesFor('  critical berries '), ['MZ1'], 'case and space insensitive');
});

test('mcloughlinCultivars lists 25 names once, sorted', () => {
  const list = mcloughlinCultivars();
  assert.equal(list.length, 25);
  assert.equal(new Set(list).size, 25);
  assert.deepEqual(list, [...list].sort((a, b) => a.localeCompare(b, 'en')));
  assert.equal(ZONE_CULTIVARS.MZ3.length, 6);
});
