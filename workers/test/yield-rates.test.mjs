/**
 * yield_rates — measured finished pounds per sack, per sack type.
 * Pure contract tests for lib/yield-rates.js. Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildYieldRates, filterSackTypes, parseSackTitle } from '../src/lib/yield-rates.js';
import { projectFinishedTops } from '../src/handlers/supersack-d1.js';

const H = (strain, tops_sacks, tops_lbs, run_sacks, smalls_lbs, trim_lbs, first = '2026-10-01', last = '2026-10-20') => ({
  strain, tops_sacks, tops_lbs, tops_first: tops_sacks ? first : null, tops_last: tops_sacks ? last : null,
  run_sacks, smalls_lbs, trim_lbs, run_first: first, run_last: last,
});

// Five in a cluster so the fence exists, one obvious high anomaly.
const HISTORY = [
  H('2026 - Sour Lifter / Sungrown / 1st Cut', 40, 160, 42, 84, 63),      // 4.00
  H('2026 - Lifter / Sungrown / 1st Cut', 10, 30, 10, 20, 15),            // 3.00
  H('2026 - Alpha / Sungrown / 1st Cut', 20, 70, 20, 0, 10),              // 3.50
  H('2026 - Bravo / Sungrown / 1st Cut', 20, 64, 20, 30, 10),             // 3.20
  H('2026 - Charlie / Greenhouse / 1st Cut', 20, 76, 20, 30, 10),         // 3.80
  H('2026 - Hotel / Sungrown / 1st Cut', 2, 30, 2, 4, 2),                 // 15.0 high
  H('2025 - Lifter / Sungrown', 100, 350, 100, 120, 200, '2025-11-01', '2026-03-01'),
  H('2026 - Rainbow GMO Quik / Sungrown / 1st Cut', 16, 48, 16, 16, 8),
];
const V = (id, title, quantity) => ({ id, title, quantity });
const VARIANTS = [
  V('gid://shopify/ProductVariant/111', '2026 - Sour Lifter / Sungrown / 1st Cut', 2240),
  V('gid://shopify/ProductVariant/222', '2026 - Sour Lifter / Sungrown / 2nd Cut', 113),
  V('gid://shopify/ProductVariant/333', '2026 - Hotel / Sungrown / 1st Cut', 0),
  V('gid://shopify/ProductVariant/444', '2025 - Lifter / Sungrown / 1st Cut', 5),
  V('gid://shopify/ProductVariant/555', '2026 - Alpha / Sungrown / 1st Cut', 9),
  V('gid://shopify/ProductVariant/666', '2026 - Rainbow GMO / Sungrown / 1st Cut', 7),
  V('gid://shopify/ProductVariant/777', '2026 - Lifter / Sungrown / 1st Cut', 3),
];
const CULTIVARS = new Map([
  ['2026 - Rainbow GMO Quik / Sungrown / 1st Cut', 'Rainbow GMO Quik'],
  ['2026 - Rainbow GMO / Sungrown / 1st Cut', 'Rainbow GMO Quik'],
]);
const build = () => buildYieldRates(HISTORY, VARIANTS, CULTIVARS, '2026-11-11T13:00:00.000Z');
const row = (out, tail) => out.sack_types.find(s => String(s.variant_id).endsWith(tail));

test('parseSackTitle splits year, strain, harvest type and cut', () => {
  assert.deepEqual(parseSackTitle('2026 - Sour Lifter / Sungrown / 2nd Cut'),
    { harvest_year: 2026, strain: 'Sour Lifter', harvest_type: 'Sungrown', cut: '2nd Cut' });
  assert.equal(parseSackTitle('2025 - Lifter / Sungrown').cut, null);
});

test('one row per variant, in order, zero-sack variants included', () => {
  const out = build();
  assert.equal(out.api_version, 1);
  assert.equal(out.as_of, '2026-11-11T13:00:00.000Z');
  assert.deepEqual(out.sack_types.map(s => s.variant_id), VARIANTS.map(v => v.id));
  assert.equal(row(out, '333').inventory_sacks, 0);
});

test('measured type: total lb / total sacks, with range and confidence', () => {
  const s = row(build(), '111');
  assert.deepEqual([s.strain, s.harvest_year, s.harvest_type, s.cut], ['Sour Lifter', 2026, 'Sungrown', '1st Cut']);
  assert.equal(s.per_cut, true);
  assert.deepEqual(s.tops, {
    avg_lb_per_sack: 4, sacks_counted: 40, first_day: '2026-10-01', last_day: '2026-10-20',
    confidence: 'ok', rate_source: 'measured',
  });
  // Smalls and trim run over the WHOLE run (42 sacks), not the tops-rated days.
  assert.equal(s.smalls.avg_lb_per_sack, 2);
  assert.equal(s.smalls.sacks_counted, 42);
  assert.equal(s.smalls.rate_source, 'measured');
  assert.equal(s.trim.avg_lb_per_sack, 1.5);
  assert.equal(s.trim.rate_source, 'attributed');
});

test('a cut with no history is blank, never the floor, and never the other cut', () => {
  const s = row(build(), '222');
  for (const k of ['tops', 'smalls', 'trim']) {
    assert.deepEqual(s[k], {
      avg_lb_per_sack: null, sacks_counted: 0, first_day: null, last_day: null,
      confidence: 'none', rate_source: 'no_history',
    });
  }
  assert.equal(s.per_cut, true);
});

test('thin below 15 sacks', () => {
  assert.equal(row(build(), '777').tops.confidence, 'thin');
});

test('tops above the fence keeps its value and is flagged', () => {
  const out = build();
  const s = row(out, '333');
  assert.equal(s.tops.avg_lb_per_sack, 15);
  assert.equal(s.tops.rate_source, 'anomaly_high');
  assert.ok(out.tops_anomaly_fence_lbs_per_sack < 15);
});

test('zero pounds logged is no history, not a zero rate', () => {
  assert.equal(row(build(), '555').smalls.rate_source, 'no_history');
  assert.equal(row(build(), '555').smalls.avg_lb_per_sack, null);
});

test('cut-less history gives the strain average with per_cut false, same year only', () => {
  const s = row(build(), '444');
  assert.equal(s.per_cut, false);
  assert.equal(s.tops.avg_lb_per_sack, 3.5);
  assert.equal(s.tops.sacks_counted, 100);
  // 2026 Lifter has its own cut history and must not be touched by 2025's.
  assert.equal(row(build(), '777').tops.avg_lb_per_sack, 3);
});

test('floor and variant titles that spell a cultivar differently still join', () => {
  const s = row(build(), '666');
  assert.equal(s.tops.avg_lb_per_sack, 3);
  assert.equal(s.tops.sacks_counted, 16);
});

test('floor and fence use the same maths as tops_breakdown, given the same history', () => {
  const out = build();
  const stats = HISTORY.map(h => ({ strain: h.strain, sacks: h.tops_sacks, tops: h.tops_lbs }));
  const tb = projectFinishedTops(stats, [], new Map());
  assert.equal(out.tops_floor_lbs_per_sack, tb.floor_rate);
  assert.equal(out.tops_anomaly_fence_lbs_per_sack, Math.round(tb.upper_fence * 100) / 100);
});

test('no fence yet (under five rates) is null, not Infinity', () => {
  const out = buildYieldRates(HISTORY.slice(0, 2), VARIANTS, CULTIVARS);
  assert.equal(out.tops_anomaly_fence_lbs_per_sack, null);
  assert.equal(JSON.parse(JSON.stringify(out)).sack_types.length, VARIANTS.length);
});

test('trim_all_types is the weighed total over every sack of the crop year', () => {
  const out = build();
  const y26 = out.trim_all_types.find(t => t.harvest_year === 2026);
  const rows = HISTORY.filter(h => h.strain.startsWith('2026'));
  const lbs = rows.reduce((s, h) => s + h.trim_lbs, 0);
  const sacks = rows.reduce((s, h) => s + h.run_sacks, 0);
  assert.equal(y26.avg_lb_per_sack, Math.round((lbs / sacks) * 100) / 100);
  assert.equal(y26.sacks_counted, sacks);
  assert.equal(y26.rate_source, 'measured');
  assert.deepEqual(out.trim_all_types.map(t => t.harvest_year), [2025, 2026]);
});

test('empty history: every row blank, nothing throws', () => {
  const out = buildYieldRates([], VARIANTS, new Map());
  assert.equal(out.tops_floor_lbs_per_sack, null);
  assert.ok(out.sack_types.every(s => s.tops.rate_source === 'no_history' && s.per_cut === true));
});

test('filter: variant id as GID or number; strain/year/cut; unknown matches nothing', () => {
  const all = build().sack_types;
  assert.equal(filterSackTypes(all, {}).length, all.length);
  assert.equal(filterSackTypes(all, { variant_id: '222' })[0].cut, '2nd Cut');
  assert.equal(filterSackTypes(all, { variant_id: 'gid://shopify/ProductVariant/222' }).length, 1);
  assert.equal(filterSackTypes(all, { variant_id: '22' }).length, 0);
  assert.equal(filterSackTypes(all, { variant_id: 'abc' }).length, 0);
  assert.equal(filterSackTypes(all, { strain: 'sour lifter', year: '2026' }).length, 2);
  assert.equal(filterSackTypes(all, { strain: 'Sour Lifter', year: '2026', cut: '2nd cut' }).length, 1);
  assert.equal(filterSackTypes(all, { strain: 'Nope' }).length, 0);
});

// --- the action's gate: fail closed before any work or cache ---
import { handleSupersackD1 } from '../src/handlers/supersack-d1.js';
const call = (env, headers = {}, qs = 'action=yield_rates&v=1') =>
  handleSupersackD1(new Request(`https://x.test/api/supersack?${qs}`, { headers }), env, {});

test('yield_rates: unset, missing or wrong token is 401 unauthorized', async () => {
  for (const [env, headers] of [
    [{}, { authorization: 'Bearer anything' }],
    [{ BREAKDOWN_API_KEY: 'k' }, {}],
    [{ BREAKDOWN_API_KEY: 'k' }, { authorization: 'Bearer nope' }],
    [{ BREAKDOWN_API_KEY: 'k' }, { authorization: 'k' }],
  ]) {
    const res = await call(env, headers);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'unauthorized' });
  }
});

test('yield_rates: an unknown version is refused, after auth', async () => {
  const res = await call({ BREAKDOWN_API_KEY: 'k' }, { authorization: 'Bearer k' }, 'action=yield_rates&v=2');
  assert.equal(res.status, 400);
  assert.equal((await call({ BREAKDOWN_API_KEY: 'k' }, {}, 'action=yield_rates&v=2')).status, 401);
});
