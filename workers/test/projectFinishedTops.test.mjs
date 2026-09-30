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

// --- 2026-09-30: a new crop year borrows its cultivar's history ---------------
test('a 2026 variant with no history of its own borrows its cultivar\'s 2025 rate, scaled to the 35 lb sack', () => {
  // Every 2026 variant is a new title, so it used to fall to the floor. Real
  // titles, real spellings: the floor's 2025 title and the 2026 variant spell
  // the cultivar differently, which is why they join on the cultivar.
  const stats = [
    { strain: '2025 - Lifter / Sungrown',           sacks: 100, tops: 370 }, // 3.70 per 37 lb sack
    { strain: '2025 - Sour Lifter / Sungrown',      sacks: 100, tops: 296 }, // 2.96
    { strain: '2025 - Rainbow GMO Quik / Sungrown', sacks: 100, tops: 333 }, // 3.33
    { strain: '2025 - Bubba Kush / Sungrown',       sacks: 100, tops: 222 }, // 2.22 (floor)
    { strain: '2025 - Sugar Cookez / Sungrown',     sacks: 100, tops: 350 }, // 3.50
  ];
  const inv = [
    { id: 'v1', title: '2026 - Lifter / Sungrown / 1st Cut',      quantity: 10 },
    { id: 'v2', title: '2026 - Rainbow GMO / Sungrown / 1st Cut', quantity: 10 },
    { id: 'v3', title: '2026 - Angel Cake / Sungrown / 1st Cut',  quantity: 10 },  // never ran in 2025
    { id: 'v4', title: '2025 - Lifter / Sungrown',                quantity: 10 },  // its own history
  ];
  const cultivarOf = new Map([
    ['2025 - Lifter / Sungrown', 'Lifter'],
    ['2025 - Sour Lifter / Sungrown', 'Sour Lifter'],
    ['2025 - Rainbow GMO Quik / Sungrown', 'Rainbow GMO Quik'],
    ['2025 - Bubba Kush / Sungrown', 'Bubba Kush'],
    ['2025 - Sugar Cookez / Sungrown', 'Sugar Cookez'],
    ['2026 - Lifter / Sungrown / 1st Cut', 'Lifter'],
    ['2026 - Rainbow GMO / Sungrown / 1st Cut', 'Rainbow GMO Quik'],
    ['2026 - Angel Cake / Sungrown / 1st Cut', 'Angel Cake'],
  ]);
  const { floor_rate, cultivars, finished_tops_lbs } = projectFinishedTops(stats, inv, cultivarOf);
  const by = Object.fromEntries(cultivars.map(c => [c.cultivar_name, c]));

  const lifter26 = by['2026 - Lifter / Sungrown / 1st Cut'];
  assert.equal(lifter26.rate_source, 'cultivar_other_crop');
  assert.equal(lifter26.effective_rate_lbs_per_sack, 3.5, '3.70 per 37 lb = 0.1 per lb, x 35');
  assert.equal(lifter26.measured_rate_lbs_per_sack, null, 'nothing measured on this variant yet');
  assert.equal(lifter26.borrowed_history_sacks, 100);
  assert.equal(lifter26.projected_finished_tops_lbs, 35);

  assert.equal(by['2026 - Rainbow GMO / Sungrown / 1st Cut'].rate_source, 'cultivar_other_crop',
    'joined on the cultivar, not the title');
  assert.equal(by['2026 - Angel Cake / Sungrown / 1st Cut'].rate_source, 'floor_unknown_cultivar');
  assert.equal(by['2026 - Angel Cake / Sungrown / 1st Cut'].effective_rate_lbs_per_sack, floor_rate);
  assert.equal(by['2025 - Lifter / Sungrown'].rate_source, 'own', 'its own history still wins');
  assert.equal(finished_tops_lbs, Math.round(35 + 10 * 3.33 * 35 / 37 + 10 * 2.22 + 37));
});

test('without cultivar resolution the projection is unchanged', () => {
  const stats = [{ strain: '2025 - Lifter / Sungrown', sacks: 10, tops: 37 }];
  const inv = [{ id: 'v1', title: '2026 - Lifter / Sungrown / 1st Cut', quantity: 4 }];
  const { cultivars } = projectFinishedTops(stats, inv);
  assert.equal(cultivars[0].rate_source, 'floor_unknown_cultivar');
});

// --- 2026-09-30: the tops cache expires by its own as_of, not the Cache API ---
test('a cached projection is served only while its as_of is under five minutes old', async () => {
  const { freshHit, FRESH_MS } = await import('../src/handlers/supersack-d1.js');
  const store = new Map();
  const cache = {
    async match(k) { const b = store.get(k); return b ? new Response(b) : undefined; },
    async delete(k) { return store.delete(k); },
  };
  const now = Date.parse('2026-09-30T20:30:00Z');
  store.set('k', JSON.stringify({ finished_tops_lbs: 174, as_of: new Date(now - 60_000).toISOString() }));
  assert.ok(await freshHit(cache, 'k', now), 'one minute old: served');

  store.set('k', JSON.stringify({ finished_tops_lbs: 113, as_of: new Date(now - FRESH_MS - 1).toISOString() }));
  assert.equal(await freshHit(cache, 'k', now), null, 'past five minutes: a miss, recomputed');
  assert.equal(store.has('k'), false, 'and the stale entry is dropped');

  store.set('k', 'not json');
  assert.equal(await freshHit(cache, 'k', now), null, 'unreadable: a miss');
  assert.equal(await freshHit(cache, 'absent', now), null);
});

// --- 2026-09-30: D1 caps a statement at 100 bound variables ------------------
test('resolving ~120 titles to cultivars never binds more than D1 allows', async () => {
  const { resolveTitleCultivars } = await import('../src/handlers/supersack-d1.js');
  const rowsFor = sql => /FROM cultivar_aliases/.test(sql)
    ? [{ alias: '2026 - Rainbow GMO / Sungrown', name: 'Rainbow GMO Quik' },
       { alias: '2025 - Rainbow GMO Quik / Sungrown', name: 'Rainbow GMO Quik' }]
    : [{ name: 'Rainbow GMO Quik' }, { name: 'Platinum' }, { name: 'Platinum M A4' }, { name: 'Lifter' }];
  const stmt = (sql, args = []) => {
    if (args.length > 100) throw new Error('D1_ERROR: too many SQL variables');
    return { bind: (...a) => stmt(sql, a), all: async () => ({ results: rowsFor(sql) }) };
  };
  const db = { prepare: sql => stmt(sql) };
  const titles = [
    ...Array.from({ length: 118 }, (_, i) => `2026 - Filler ${i} / Sungrown / 1st Cut`),
    '2026 - Rainbow GMO / Sungrown / 2nd Cut', '2026 - Platinum M A4 / Sungrown / 1st Cut',
    '2025 - Lifter / Sungrown',
  ];
  const out = await resolveTitleCultivars(db, titles);
  assert.equal(out.get('2026 - Rainbow GMO / Sungrown / 2nd Cut'), 'Rainbow GMO Quik', 'alias, with the cut dropped');
  assert.equal(out.get('2026 - Platinum M A4 / Sungrown / 1st Cut'), 'Platinum M A4', 'exact name, never the Platinum prefix');
  assert.equal(out.get('2025 - Lifter / Sungrown'), 'Lifter');
  assert.equal(out.has('2026 - Filler 3 / Sungrown / 1st Cut'), false, 'unknown names resolve to nothing');
});
