/**
 * Raw sacks needed to finish a line — the inverse of the tops projection.
 *
 * `tops_breakdown` already answers "how many pounds of tops will this pile of
 * sacks make". The order board needs the question the other way round: this
 * line still wants N pounds, how much raw does that take. Same measured rate,
 * so the two can never disagree — which is why the rate maths lives in one file
 * rather than being copied.
 *
 * The rate is TOPS PER SACK, measured from supersack_entries. Smalls are not
 * projected: they are the byproduct of the same lot, not a separate demand on
 * raw material.
 *
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRates, effectiveRate, sacksFor, preferSeason } from '../workers/src/lib/sack-rates.js';

const near = (a, b, tol = 0.001) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${a} to be within ${tol} of ${b}`);

/** Live shape: rows of { key, sacks, tops } aggregated per cultivar. */
const rows = (...pairs) => pairs.map(([key, sacks, tops]) => ({ key, sacks, tops }));

// --- the rate table --------------------------------------------------------

test('a rate is total tops over total sacks, not an average of daily rates', () => {
  // Weighting matters: a day that opened one sack must not count as much as a
  // day that opened forty.
  const { rateMap } = buildRates(rows(['lifter', 100, 443]));
  near(rateMap.get('lifter'), 4.43);
});

test('a cultivar with no sacks opened gets no rate rather than a divide by zero', () => {
  const { rateMap } = buildRates(rows(['ghost', 0, 12]));
  assert.equal(rateMap.has('ghost'), false);
});

test('the floor is the lowest trusted rate, so an unknown cultivar is costed pessimistically', () => {
  const { floor } = buildRates(rows(
    ['a', 10, 50], ['b', 10, 40], ['c', 10, 30], ['d', 10, 45], ['e', 10, 35]));
  near(floor, 3.0);
});

test('an implausibly high rate is fenced out of the floor', () => {
  // One cultivar reporting 40 lb/sack against a field of ~3-5 would otherwise
  // drag the fence up and let other anomalies through.
  const { upperFence } = buildRates(rows(
    ['a', 10, 40], ['b', 10, 42], ['c', 10, 38], ['d', 10, 41], ['e', 10, 400]));
  assert.ok(upperFence < 40, `fence ${upperFence} should exclude the 40 lb/sack outlier`);
});

test('with too few cultivars there is no fence to speak of', () => {
  // A median-absolute-deviation fence over three points is noise, not statistics.
  const { upperFence } = buildRates(rows(['a', 10, 40], ['b', 10, 42], ['c', 10, 38]));
  assert.equal(upperFence, Infinity);
});

// --- which rate a given cultivar gets --------------------------------------

test('a cultivar with its own believable rate uses it', () => {
  const r = effectiveRate(4.43, { upperFence: 6, floor: 2.85 });
  near(r.rate, 4.43);
  assert.equal(r.source, 'own');
});

test('a cultivar with no history falls back to the floor', () => {
  const r = effectiveRate(null, { upperFence: 6, floor: 2.85 });
  near(r.rate, 2.85);
  assert.equal(r.source, 'floor_unknown_cultivar');
});

test('a cultivar whose own rate is above the fence falls back to the floor', () => {
  // Trusting it would UNDER-order raw, which is the expensive direction.
  const r = effectiveRate(40, { upperFence: 6, floor: 2.85 });
  near(r.rate, 2.85);
  assert.equal(r.source, 'floor_anomaly_high');
});

// --- pounds to sacks -------------------------------------------------------

test('sacks needed is pounds left over the rate', () => {
  // Unrounded on purpose: the projection keeps full precision and each surface
  // rounds for display. Rounding here would bake one screen's formatting into
  // the maths.
  near(sacksFor(18.8, 3.32), 18.8 / 3.32);
  near(sacksFor(18.8, 3.32), 5.6627, 0.001);
});

test('a line with nothing left needs no raw', () => {
  assert.equal(sacksFor(0, 3.32), 0);
});

test('a line already over-delivered needs no raw rather than a negative amount', () => {
  assert.equal(sacksFor(-5, 3.32), 0);
});

test('THE GUARD: no rate means no projection, not an infinite one', () => {
  // A cultivar nobody has ever trimmed, on a farm with no history at all, would
  // otherwise divide by zero and report Infinity sacks on the board.
  assert.equal(sacksFor(20, 0), null);
  assert.equal(sacksFor(20, null), null);
});

// --- this year's crop, by itself ---------------------------------------------
//
// 2026-10-14: Sour Lifter's 2025 history (35 sacks at 4.89 lb) was being summed
// with the first two 2026 days (46 sacks at 5.39 lb). Koa: "use this week's
// rate, it's new 2026 product". A season's rate stands on its own once it has
// enough sacks to mean something; before that, every year counts.

const seasonRows = (...rows) => rows.map(([key, season, sacks, tops]) => ({ key, season, sacks, tops }));

test('preferSeason: the current season replaces older history once it has enough sacks', () => {
  const rows = seasonRows(['sl', 2025, 35, 171.3], ['sl', 2026, 46, 248]);
  const out = preferSeason(rows, 2026, 10);
  assert.deepEqual(out, [{ key: 'sl', sacks: 46, tops: 248 }]);
  near(buildRates(out).rateMap.get('sl'), 248 / 46);
});

test('preferSeason: too few current-season sacks -> every season is summed, as before', () => {
  const rows = seasonRows(['sl', 2025, 35, 171.3], ['sl', 2026, 5, 27]);
  assert.deepEqual(preferSeason(rows, 2026, 10), [{ key: 'sl', sacks: 40, tops: 198.3 }]);
});

test('preferSeason: decided per cultivar; no current-season rows at all -> all history', () => {
  const rows = seasonRows(['sl', 2025, 35, 171.3], ['sl', 2026, 46, 248], ['lift', 2024, 12, 60], ['lift', 2025, 20, 90]);
  assert.deepEqual(preferSeason(rows, 2026, 10), [{ key: 'sl', sacks: 46, tops: 248 }, { key: 'lift', sacks: 32, tops: 150 }]);
});

test('preferSeason: a NULL season is old history, and two current-season spellings add up', () => {
  const rows = seasonRows(['sl', null, 9, 40], ['sl', 2026, 6, 30], ['sl', 2026, 6, 33]);
  assert.deepEqual(preferSeason(rows, 2026, 10), [{ key: 'sl', sacks: 12, tops: 63 }]);
  assert.deepEqual(preferSeason(rows, 2026, 20), [{ key: 'sl', sacks: 21, tops: 103 }]);
  assert.deepEqual(preferSeason([], 2026, 10), []);
});
