/**
 * What each bay holds, in sticks.
 *
 * Counted by hand and photographed 2026-09-23. Every capacity figure before
 * this one was derived from structure — sections x walls x racks — and the
 * structure numbers contradicted each other badly enough that the wiki page
 * carried a warning not to use them. These are counts.
 *
 * The number matters beyond the barn wall: total capacity divided by the dry
 * cycle is the sustainable cut rate, which is the ceiling that sets harvest
 * duration ahead of labour. A wrong total moves the whole harvest plan.
 *
 * BAYS 1-3 MUST STAY ABSENT rather than zero. They exist, on a system the apps
 * do not measure, and a zero would quietly subtract real drying space from
 * every total that sums the map.
 *
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const { BAY_STICKS, bayCapacity, BARN_STICKS, FARM_STICKS, dailyCeiling } = await import(
  join(REPO, 'workers/src/lib/bay-facts.js').replace(/\\/g, '/').replace(/^/, 'file:///')
);
const { buildMetrics } = await import(
  join(REPO, 'workers/src/lib/harvest-metrics.js').replace(/\\/g, '/').replace(/^/, 'file:///')
);

test('every measured bay is the number that was counted', () => {
  assert.deepEqual(BAY_STICKS, {
    4: 411, 5: 415, 6: 409, 7: 418, 8: 482,
    9: 512, 10: 512, 11: 516, 12: 516,
  });
});

test('the barn totals and the farm ceiling follow from the counts', () => {
  assert.equal(BARN_STICKS.bottom, 2135, 'bays 4-8');
  assert.equal(BARN_STICKS.top, 2056, 'bays 9-12');
  assert.equal(FARM_STICKS, 4191, 'everything that can hang at once');
  assert.equal(dailyCeiling(10), 419, 'the sustainable cut rate on a 10-day dry');
  assert.equal(dailyCeiling(12), 349, 'a longer dry lowers the ceiling');
});

test('an unmeasured bay is unknown, never zero', () => {
  for (const bay of [1, 2, 3]) {
    assert.equal(bayCapacity(bay), null,
      `bay ${bay} hangs on another system — a zero would subtract real space from every total`);
  }
  assert.equal(bayCapacity(9), 512);
  assert.equal(bayCapacity('9'), 512, 'a bay arrives from a query string as text');
  assert.equal(bayCapacity(99), null);
  assert.equal(bayCapacity(null), null);
});

test('the rack board carries each bay capacity through to the page', () => {
  const m = buildMetrics({
    lots: [], sessions: [], loads: [], sacks: [],
    dryWindow: { min: 8, max: 12 }, bottomBarnLastBay: 8, bayCount: 12,
    now: new Date('2026-09-23T18:00:00Z'),
  });
  const byBay = new Map(m.racks.map(r => [r.bay, r]));

  assert.equal(byBay.get(9).capacity, 512);
  assert.equal(byBay.get(8).capacity, 482);
  assert.equal(byBay.get(1).capacity, null, 'and an unmeasured bay is still reported, as unknown');
  assert.equal(byBay.get(1).state, 'empty', 'a bay with no capacity is still a bay');
});
