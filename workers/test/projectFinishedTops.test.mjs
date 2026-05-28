/**
 * Unit tests for projectFinishedTops — the pure projection behind both
 * /api/supersack?action=tops_remaining and ?action=tops_breakdown.
 *
 * Zero dependencies: run with `node --test` (Node 18+). Covers the contract
 * invariants + rate_source branches + edge cases the web team specified.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectFinishedTops } from '../src/handlers/supersack-d1.js';

// --- helpers mirroring the tops_breakdown handler's total computation ---
const totalTops = (cultivars) =>
  Math.round(cultivars.reduce((s, c) => s + c.projected_finished_tops_lbs, 0));
const totalSacks = (cultivars) =>
  cultivars.reduce((s, c) => s + c.inventory_sacks, 0);

// A spread of 7 cultivar rates: a tight cluster (2.0–3.2), one obvious HIGH
// anomaly (9.0), and one low-but-trusted rate (2.0) that becomes the floor.
const STATS = [
  { strain: 'Alpha',  sacks: 100, tops: 300 }, // 3.00
  { strain: 'Bravo',  sacks: 100, tops: 280 }, // 2.80
  { strain: 'Charlie',sacks: 100, tops: 320 }, // 3.20
  { strain: 'Delta',  sacks: 100, tops: 300 }, // 3.00
  { strain: 'Echo',   sacks: 100, tops: 310 }, // 3.10
  { strain: 'Foxtrot',sacks: 100, tops: 200 }, // 2.00  (low, trusted → floor)
  { strain: 'Hotel',  sacks:   2, tops:  18 }, // 9.00  (HIGH anomaly)
];

const INV = [
  { id: 'gid://shopify/ProductVariant/1', title: 'Alpha',   quantity: 100 }, // own
  { id: 'gid://shopify/ProductVariant/2', title: 'Bravo',   quantity: 50 },  // own
  { id: 'gid://shopify/ProductVariant/3', title: 'Foxtrot', quantity: 20 },  // own (low kept)
  { id: 'gid://shopify/ProductVariant/4', title: 'Hotel',   quantity: 10 },  // floor_anomaly_high
  { id: 'gid://shopify/ProductVariant/5', title: 'Ghost',   quantity: 5 },   // floor_unknown_cultivar (no history)
  { id: 'gid://shopify/ProductVariant/6', title: 'EmptyBin',quantity: 0 },   // excluded (qty 0)
];

test('floor is the lowest trusted rate; high anomaly fenced out', () => {
  const { floor_rate, upper_fence } = projectFinishedTops(STATS, INV);
  assert.equal(floor_rate, 2.0, 'floor = lowest non-anomalous rate');
  assert.ok(upper_fence !== null && upper_fence < 9.0, 'fence sits below the 9.0 anomaly');
});

test('rate_source branches + measured/effective per cultivar', () => {
  const { floor_rate, cultivars } = projectFinishedTops(STATS, INV);
  const by = Object.fromEntries(cultivars.map(c => [c.cultivar_name, c]));

  // own — measured == effective == its own rate
  assert.equal(by.Alpha.rate_source, 'own');
  assert.equal(by.Alpha.measured_rate_lbs_per_sack, 3.0);
  assert.equal(by.Alpha.effective_rate_lbs_per_sack, 3.0);

  // low rate kept as own (no low-side fence)
  assert.equal(by.Foxtrot.rate_source, 'own');
  assert.equal(by.Foxtrot.effective_rate_lbs_per_sack, 2.0);

  // high anomaly — measured retained for visibility, effective dropped to floor
  assert.equal(by.Hotel.rate_source, 'floor_anomaly_high');
  assert.equal(by.Hotel.measured_rate_lbs_per_sack, 9.0);
  assert.equal(by.Hotel.effective_rate_lbs_per_sack, floor_rate);

  // unknown cultivar — null measured, zero history, floor effective
  assert.equal(by.Ghost.rate_source, 'floor_unknown_cultivar');
  assert.equal(by.Ghost.measured_rate_lbs_per_sack, null);
  assert.equal(by.Ghost.clean_history_sacks, 0);
  assert.equal(by.Ghost.effective_rate_lbs_per_sack, floor_rate);
});

test('contract invariants hold', () => {
  const { floor_rate, cultivars } = projectFinishedTops(STATS, INV);

  // #6 every cultivar has inventory_sacks > 0 (qty-0 bin excluded)
  assert.ok(cultivars.every(c => c.inventory_sacks > 0));
  assert.ok(!cultivars.some(c => c.cultivar_name === 'EmptyBin'));

  // #7 / #8 names and variant GIDs unique
  assert.equal(new Set(cultivars.map(c => c.cultivar_name)).size, cultivars.length);
  assert.equal(new Set(cultivars.map(c => c.shopify_variant_id)).size, cultivars.length);

  // #4 own → effective == measured; #5 non-own → effective == floor
  for (const c of cultivars) {
    if (c.rate_source === 'own') {
      assert.equal(c.effective_rate_lbs_per_sack, c.measured_rate_lbs_per_sack);
    } else {
      assert.equal(c.effective_rate_lbs_per_sack, floor_rate);
    }
    // projected == round(sacks × effective, 1)
    assert.equal(
      c.projected_finished_tops_lbs,
      Math.round(c.inventory_sacks * c.effective_rate_lbs_per_sack * 10) / 10
    );
  }

  // #1 / #2 totals reconcile with the per-cultivar rows
  assert.equal(totalSacks(cultivars), 185);          // 100+50+20+10+5
  assert.equal(totalTops(cultivars), 510);           // 300+140+40+20+10
});

test('history-but-zero-current-inventory cultivars are absent', () => {
  // Charlie/Delta/Echo have history but no inventory row → not in output.
  const { cultivars } = projectFinishedTops(STATS, INV);
  for (const name of ['Charlie', 'Delta', 'Echo']) {
    assert.ok(!cultivars.some(c => c.cultivar_name === name));
  }
});

test('fewer than 5 rates → no anomaly fence, everything is own', () => {
  const stats = [
    { strain: 'X', sacks: 10, tops: 30 },  // 3.0
    { strain: 'Y', sacks: 10, tops: 90 },  // 9.0 — would be an anomaly if fence applied
  ];
  const inv = [
    { id: 'gid://1', title: 'X', quantity: 5 },
    { id: 'gid://2', title: 'Y', quantity: 5 },
  ];
  const { upper_fence, cultivars } = projectFinishedTops(stats, inv);
  assert.equal(upper_fence, null, 'fence is null with <5 rates');
  assert.ok(cultivars.every(c => c.rate_source === 'own'), 'no fence → all own');
});

test('zero MAD (identical rates) → no fence applied', () => {
  const stats = Array.from({ length: 6 }, (_, i) => ({ strain: `S${i}`, sacks: 10, tops: 30 })); // all 3.0
  const inv = stats.map((s, i) => ({ id: `gid://${i}`, title: s.strain, quantity: 1 }));
  const { upper_fence, cultivars } = projectFinishedTops(stats, inv);
  assert.equal(upper_fence, null, 'MAD==0 → fence null');
  assert.ok(cultivars.every(c => c.rate_source === 'own'));
});
