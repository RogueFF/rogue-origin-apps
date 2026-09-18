/**
 * What a counted rack holds.
 *
 * The hourly SMS log has always collected `racks` as a bare tally. Koa,
 * 2026-09-18, supplied the anatomy behind it: a rack (the crew's "stick") is
 * seven hangers, and a hanger takes 7–9 branches ON EITHER SIDE.
 *
 * Two things this suite defends:
 *
 * 1. BOTH SIDES COUNT. "7-9 branches on either side" is 14–18 on the arm, not
 *    7–9. Halving it is the obvious misreading and it halves every number the
 *    barn is planned from.
 *
 * 2. THE INVERSE FLIPS ITS BANDS. Racks needed for a pile of branches uses
 *    max-per-rack to get the FEWEST racks. Carrying the bands straight through
 *    would tell a foreman a bay fits more than it does, and the rack that does
 *    not fit is a trailer left loaded.
 *
 * Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const mod = (p) => join(REPO, p).replace(/\\/g, '/').replace(/^/, 'file:///');

const {
  HANGERS_PER_RACK, SIDES_PER_HANGER, BRANCHES_PER_HANGER_SIDE,
  BRANCHES_PER_HANGER, BRANCHES_PER_RACK,
  branchesForRacks, hangersForRacks, racksForBranches, formatBand,
} = await import(mod('workers/src/lib/rack-facts.js'));

test('the operator numbers are what is stored', () => {
  assert.equal(HANGERS_PER_RACK, 7);
  assert.equal(SIDES_PER_HANGER, 2);
  assert.deepEqual(BRANCHES_PER_HANGER_SIDE, { min: 7, typical: 8, max: 9 });
});

test('a hanger is both of its sides, not one', () => {
  assert.deepEqual(BRANCHES_PER_HANGER, { min: 14, typical: 16, max: 18 });
});

test('a rack is seven hangers', () => {
  assert.deepEqual(BRANCHES_PER_RACK, { min: 98, typical: 112, max: 126 });
});

test('a day of racks becomes a band of branches', () => {
  // 27 racks — the day total in the PARAR reply the SMS doc walks through.
  assert.deepEqual(branchesForRacks(27), { min: 2646, typical: 3024, max: 3402 });
  assert.deepEqual(branchesForRacks(1), BRANCHES_PER_RACK);
  assert.deepEqual(branchesForRacks(0), { min: 0, typical: 0, max: 0 });
});

test('hangers filled scale with racks', () => {
  assert.equal(hangersForRacks(4), 28);
  assert.equal(hangersForRacks(0), 0);
});

test('an unanswered hour stays unanswered instead of becoming zero', () => {
  for (const bad of [null, undefined, -1, 2.5, '12', NaN, true, [4]]) {
    assert.equal(branchesForRacks(bad), null, String(bad));
    assert.equal(hangersForRacks(bad), null, String(bad));
    assert.equal(racksForBranches(bad), null, String(bad));
  }
});

test('racks needed inverts the bands — fullest packing needs the fewest racks', () => {
  const r = racksForBranches(3000);
  assert.deepEqual(r, { min: 24, typical: 27, max: 31 });
  assert.ok(r.min < r.max, 'min racks must come from max branches per rack');
});

test('a part-full rack still occupies a rack', () => {
  assert.deepEqual(racksForBranches(1), { min: 1, typical: 1, max: 1 });
  assert.equal(racksForBranches(127).min, 2);
  assert.equal(racksForBranches(126).min, 1);
});

test('the two directions agree on a whole rack', () => {
  const branches = branchesForRacks(10);
  assert.equal(racksForBranches(branches.typical).typical, 10);
});

test('a band reads as an estimate, never as a count', () => {
  assert.equal(formatBand(branchesForRacks(27), 'branches'), '≈2,646–3,402 branches');
  assert.equal(formatBand({ min: 0, typical: 0, max: 0 }), '≈0');
  assert.equal(formatBand(null), '—');
});
