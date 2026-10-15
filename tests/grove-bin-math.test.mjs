/**
 * Unit tests for the pure Grove lane math (workers/src/lib/bin-math.js).
 *
 * Design §5: on hand from baseline minus usage, rate from the ledger / seed /
 * last season, reorder point and red tape depth, order-by and run-out dates.
 *
 * Run with `node --test` (matches .github/workflows/test.yml).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY, laneStatus, seasonWindow } from '../workers/src/lib/bin-math.js';

const base = () => ({
  per: 50,
  lead: 75,
  safety: 30,
  moq: 2500,
  seedPerMonth: 600,
  baseline: { bags: 2000, at: '2026-10-01T00:00:00Z' },
  usageSince: 200,
  usage56: 1120,
  usageDays: 56,
  seasonUsage: null,
  redScanned: false,
  today: new Date('2026-10-14T12:00:00Z'),
});
const lane = (over = {}) => laneStatus({ ...base(), ...over });

test('DAY is one day in ms', () => {
  assert.equal(DAY, 86400000);
});

// --- on hand ---------------------------------------------------------------

test('on hand = baseline minus usage since baseline', () => {
  const r = lane();
  assert.equal(r.onHand, 1800);
  assert.equal(r.bins, 36);
});

test('on hand never goes negative', () => {
  const r = lane({ usageSince: 2500 });
  assert.equal(r.onHand, 0);
  assert.equal(r.bins, 0);
});

test('bins floors partial bins', () => {
  assert.equal(lane({ usageSince: 230 }).bins, 35); // 1770 / 50 = 35.4
});

// --- rate ------------------------------------------------------------------

test('rate comes from the ledger once it has 14 days', () => {
  const r = lane();
  assert.equal(r.rate, 20); // 1120 / 56
  assert.equal(r.rateSource, 'ledger');
});

test('ledger window is the days available, capped at 56', () => {
  const r = lane({ usageDays: 28, usage56: 560 });
  assert.equal(r.rate, 20); // 560 / 28
  assert.equal(r.rateSource, 'ledger');
  assert.equal(lane({ usageDays: 90 }).rate, 20); // still / 56
});

test('rate falls back to the seed under 14 days of ledger', () => {
  const r = lane({ usageDays: 3 });
  assert.ok(Math.abs(r.rate - 600 / 30.4) < 1e-9);
  assert.equal(r.rateSource, 'seed');
  assert.equal(lane({ usageDays: 13 }).rateSource, 'seed');
  assert.equal(lane({ usageDays: 14 }).rateSource, 'ledger');
});

test('last season wins when it was busier', () => {
  const r = lane({ seasonUsage: 105 * 30 });
  assert.equal(r.rate, 30);
  assert.equal(r.rateSource, 'season');
});

test('a season tie keeps the ledger as the source', () => {
  const r = lane({ seasonUsage: 105 * 20 });
  assert.equal(r.rate, 20);
  assert.equal(r.rateSource, 'ledger');
});

test('last season is ignored when it was quieter', () => {
  const r = lane({ seasonUsage: 105 * 10 });
  assert.equal(r.rate, 20);
  assert.equal(r.rateSource, 'ledger');
});

// --- reorder point, red tape, dates ---------------------------------------

test('reorder point and red tape depth', () => {
  const r = lane();
  assert.equal(r.reorderPoint, 2100); // 20 × 105
  assert.equal(r.redTapeAtBins, 42); // ceil(2100 / 50)
});

test('reorder point rounds to a whole bag', () => {
  // 1121 / 56 = 20.0178… × 105 = 2101.875
  assert.equal(lane({ usage56: 1121 }).reorderPoint, 2102);
});

test('red tape depth rounds up to a whole bin', () => {
  const r = lane({ usage56: 1075.2 }); // rate 19.2 → RP 2016 → 40.32 bins
  assert.equal(r.reorderPoint, 2016);
  assert.equal(r.redTapeAtBins, 41);
});

test('order-by is when on hand hits lead-time cover', () => {
  // (1800 − 20×75) / 20 = 15 days after 2026-10-14
  assert.equal(lane().orderBy, '2026-10-29');
});

test('order-by may be in the past', () => {
  // onHand 1000: (1000 − 1500) / 20 = −25 days
  assert.equal(lane({ usageSince: 1000 }).orderBy, '2026-09-19');
});

test('run-out is on hand / rate days out', () => {
  // 1800 / 20 = 90 days after 2026-10-14
  assert.equal(lane().runOut, '2027-01-12');
});

// --- status ----------------------------------------------------------------

test('status order when on hand is at or under the reorder point', () => {
  assert.equal(lane().status, 'order'); // 1800 ≤ 2100
  assert.equal(lane({ baseline: { bags: 2100, at: '2026-10-01T00:00:00Z' }, usageSince: 0 }).status, 'order');
});

test('status soon inside 14 days of the reorder point', () => {
  // 2300 ≤ 2100 + 14×20 = 2380
  assert.equal(lane({ baseline: { bags: 2300, at: '2026-10-01T00:00:00Z' }, usageSince: 0 }).status, 'soon');
  assert.equal(lane({ baseline: { bags: 2380, at: '2026-10-01T00:00:00Z' }, usageSince: 0 }).status, 'soon');
});

test('status ok above that', () => {
  assert.equal(lane({ baseline: { bags: 2600, at: '2026-10-01T00:00:00Z' }, usageSince: 0 }).status, 'ok');
  assert.equal(lane({ baseline: { bags: 2381, at: '2026-10-01T00:00:00Z' }, usageSince: 0 }).status, 'ok');
});

test('a scanned red card forces order', () => {
  const r = lane({ baseline: { bags: 2600, at: '2026-10-01T00:00:00Z' }, usageSince: 0, redScanned: true });
  assert.equal(r.status, 'order');
});

// --- suggested qty ---------------------------------------------------------

test('suggested qty is four months rounded up to 100, floored at MOQ', () => {
  assert.equal(lane().suggestedQty, 2500); // 2400 < MOQ
  assert.equal(lane({ moq: 0 }).suggestedQty, 2400);
  assert.equal(lane({ moq: 0, usage56: 1176 }).suggestedQty, 2600); // rate 21 → 2520 → 2600
});

// --- recount ---------------------------------------------------------------

test('recount flags a physical count more than a bin off', () => {
  assert.equal(lane({ leftoverBins: 36 }).recount, false); // 1800 vs 1800
  assert.equal(lane({ leftoverBins: 35 }).recount, false); // off by exactly one bin
  assert.equal(lane({ leftoverBins: 33 }).recount, true); // 1650 vs 1800
  assert.equal(lane({ leftoverBins: 39 }).recount, true); // 1950 vs 1800
});

test('no baseline = no estimate: on hand 0, recount false even with a count', () => {
  const r = lane({ baseline: null, usageSince: 0, leftoverBins: 10 });
  assert.equal(r.onHand, 0);
  assert.equal(r.recount, false);
});

test('recount is false with no physical count', () => {
  assert.equal(lane().recount, false);
  assert.equal(lane({ leftoverBins: null }).recount, false);
});

// --- zero rate -------------------------------------------------------------

test('zero rate: no dates, status ok', () => {
  const r = lane({ usage56: 0, seedPerMonth: 0 });
  assert.equal(r.rate, 0);
  assert.equal(r.runOut, null);
  assert.equal(r.orderBy, null);
  assert.equal(r.status, 'ok');
  assert.equal(r.reorderPoint, 0);
});

test('zero rate with a red scan is still order', () => {
  assert.equal(lane({ usage56: 0, seedPerMonth: 0, redScanned: true }).status, 'order');
});

// --- purity ----------------------------------------------------------------

test('does not mutate its input', () => {
  const i = base();
  const snap = JSON.stringify(i);
  laneStatus(i);
  assert.equal(JSON.stringify(i), snap);
});

// --- season window ---------------------------------------------------------

test('season window is [today, today+lead+safety] a year back, end day inclusive', () => {
  assert.deepEqual(seasonWindow(new Date('2026-10-14T12:00:00Z'), 75, 30), {
    from: '2025-10-14T00:00:00.000Z',
    to: '2026-01-27T23:59:59.999Z',
  });
});

test('season window for a short-lead lane', () => {
  assert.deepEqual(seasonWindow(new Date('2026-10-14T12:00:00Z'), 7, 7), {
    from: '2025-10-14T00:00:00.000Z',
    to: '2025-10-28T23:59:59.999Z',
  });
});
