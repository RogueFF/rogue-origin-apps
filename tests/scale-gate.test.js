/**
 * Standalone node test for the bag-size weight gate logic.
 *
 * Does NOT require a DOM or network. Mirrors the production gate + logBag
 * normalization in-process, runs synthetic scale readings through them,
 * asserts correct button state and size normalization.
 *
 * Usage:  node tests/scale-gate.test.js
 * Exits 0 on all-pass, 1 on any failure.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ===== constants — must match production code =====
const BAG5KG_MIN_G  = 5196;
const BAG5KG_MAX_G  = 5317;
const BAG10LB_MIN_G = 4642;
const BAG10LB_MAX_G = 4763;

// ===== Pure gate model mirroring src/js/scoreboard/scale.js applyGate/gateBagButton =====
// A "btn" here is a plain object { disabled, gated, busy, title }.
function makeBtn() { return { disabled: false, gated: false, busy: false, title: '' }; }

function applyGate(btn, inRange, grams, minG, maxG) {
  btn.gated = !inRange;
  if (!btn.busy) btn.disabled = !inRange;
  btn.title = inRange
    ? ''
    : `Scale reads ${grams} g — bag must be ${minG}–${maxG} g (with bag) to log.`;
}

function clearGate(btn) {
  btn.gated = false;
  if (!btn.busy) btn.disabled = false;
  btn.title = '';
}

function gate({ btn5, btn10, scaleData }) {
  const isStale = !scaleData || scaleData.isStale !== false;
  if (isStale) {
    if (btn5)  clearGate(btn5);
    if (btn10) clearGate(btn10);
    return;
  }
  const grams = Math.round((scaleData.weight || 0) * 1000);
  if (btn5) {
    const in5 = grams >= BAG5KG_MIN_G && grams <= BAG5KG_MAX_G;
    applyGate(btn5, in5, grams, BAG5KG_MIN_G, BAG5KG_MAX_G);
  }
  if (btn10) {
    const in10 = grams >= BAG10LB_MIN_G && grams <= BAG10LB_MAX_G;
    applyGate(btn10, in10, grams, BAG10LB_MIN_G, BAG10LB_MAX_G);
  }
}

// ===== logBag size normalization (mirrors workers/src/handlers/production/bag-tracking.js) =====
function normalizeLogBag(body) {
  const rawSize = (body.size || '5kg').toString().toLowerCase();
  const is10lb = /10\s*lb/.test(rawSize);
  return {
    normalizedSize: is10lb ? '10lb' : '5kg',
    sizeDisplay: is10lb ? '10 lb.' : '5 kg.',
    bagWeightKg: is10lb ? 4.5359 : 5.0,
    sku: is10lb ? 'MANUAL-10LB-BAG' : 'MANUAL-5KG-BAG',
  };
}

// ===== classifyBagSize (mirrors getBagTimerData helper) =====
function classifyBagSize(row) {
  const sizeStr = (row.size || '').toLowerCase();
  const skuStr = (row.sku || '').toLowerCase();
  if (/10\s*lb/.test(sizeStr) || /-?10lb-?/.test(skuStr)) return '10lb';
  return '5kg';
}

// ===== test infra =====
let passed = 0, failed = 0;
const failures = [];
function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; failures.push(label); }
}
function eq(a, b, label) { assert(a === b, `${label}  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// ============================================================
// GROUP 1 — weight-gate boundaries (5kg)
// ============================================================
(function group1_5kgBoundaries() {
  const cases = [
    { w: null,       stale: true,  want5: false, label: '5kg: no data → enabled (failsafe)' },
    { w: 5.226,      stale: true,  want5: false, label: '5kg: stale data → enabled (failsafe)' },
    { w: 0,          stale: false, want5: true,  label: '5kg: empty scale → disabled' },
    { w: 5.000,      stale: false, want5: true,  label: '5kg: filling to 5000g (product-only) → disabled (bag not on)' },
    { w: 5.195,      stale: false, want5: true,  label: '5kg: 1g below min (5195g) → disabled' },
    { w: 5.196,      stale: false, want5: false, label: '5kg: at min (5196g) → enabled' },
    { w: 5.2268,     stale: false, want5: false, label: '5kg: at spec target (5227g) → enabled' },
    { w: 5.317,      stale: false, want5: false, label: '5kg: at max (5317g) → enabled' },
    { w: 5.318,      stale: false, want5: true,  label: '5kg: 1g over max (5318g) → disabled' },
    { w: 6.500,      stale: false, want5: true,  label: '5kg: way overweight → disabled' },
  ];
  for (const c of cases) {
    const btn5 = makeBtn();
    const scaleData = c.w === null ? null : { weight: c.w, isStale: c.stale };
    gate({ btn5, btn10: null, scaleData });
    eq(btn5.disabled, c.want5, c.label);
  }
})();

// ============================================================
// GROUP 2 — weight-gate boundaries (10lb)
// ============================================================
(function group2_10lbBoundaries() {
  const cases = [
    { w: null,   stale: true,  want10: false, label: '10lb: no data → enabled (failsafe)' },
    { w: 0,      stale: false, want10: true,  label: '10lb: empty → disabled' },
    { w: 4.641,  stale: false, want10: true,  label: '10lb: 1g below min (4641g) → disabled' },
    { w: 4.642,  stale: false, want10: false, label: '10lb: at min (4642g) → enabled' },
    { w: 4.672,  stale: false, want10: false, label: '10lb: at spec target (4672g) → enabled' },
    { w: 4.763,  stale: false, want10: false, label: '10lb: at max (4763g) → enabled' },
    { w: 4.764,  stale: false, want10: true,  label: '10lb: 1g over max (4764g) → disabled' },
    { w: 5.226,  stale: false, want10: true,  label: '10lb: 5kg-weight on scale → disabled (10lb button)' },
  ];
  for (const c of cases) {
    const btn10 = makeBtn();
    const scaleData = c.w === null ? null : { weight: c.w, isStale: c.stale };
    gate({ btn5: null, btn10, scaleData });
    eq(btn10.disabled, c.want10, c.label);
  }
})();

// ============================================================
// GROUP 3 — mutual exclusion: only one button enabled at a time
// ============================================================
(function group3_mutualExclusion() {
  const cases = [
    { w: 4.672, label: '10lb weight: only 10lb enabled',          want5: true,  want10: false },
    { w: 5.226, label: '5kg weight: only 5kg enabled',            want5: false, want10: true  },
    { w: 4.900, label: 'between windows: BOTH disabled',          want5: true,  want10: true  },
    { w: 0,     label: 'empty: BOTH disabled',                    want5: true,  want10: true  },
    { w: 7.000, label: 'overweight past both: BOTH disabled',     want5: true,  want10: true  },
  ];
  for (const c of cases) {
    const btn5 = makeBtn(); const btn10 = makeBtn();
    gate({ btn5, btn10, scaleData: { weight: c.w, isStale: false } });
    eq(btn5.disabled,  c.want5,  `mutex (${c.label}) — 5kg.disabled`);
    eq(btn10.disabled, c.want10, `mutex (${c.label}) — 10lb.disabled`);
  }

  // Scale offline: both should be enabled (failsafe)
  const btn5 = makeBtn(); const btn10 = makeBtn();
  gate({ btn5, btn10, scaleData: null });
  eq(btn5.disabled,  false, 'mutex (scale offline) — 5kg enabled');
  eq(btn10.disabled, false, 'mutex (scale offline) — 10lb enabled');
})();

// ============================================================
// GROUP 4 — busy flag protects click-handler's in-flight state
// ============================================================
(function group4_busyFlag() {
  // User clicks 5kg button at 5227g (in-range). Handler sets busy=true, disabled=true.
  // Scale poll arrives with same 5227g — gate MUST NOT re-enable mid-flight.
  const btn5 = makeBtn();
  btn5.busy = true;
  btn5.disabled = true;
  gate({ btn5, btn10: null, scaleData: { weight: 5.227, isStale: false } });
  eq(btn5.disabled, true, 'busy + in-range: gate does NOT re-enable mid-API call');
  eq(btn5.gated, false, 'busy + in-range: gated flag reflects weight (false)');

  // User has bag on scale, logs it, then removes it while busy.
  // Weight drops to 0. Gate sees out-of-range but must NOT flip disabled
  // (handler still owns the button).
  const btn5b = makeBtn();
  btn5b.busy = true;
  btn5b.disabled = true;
  gate({ btn5: btn5b, btn10: null, scaleData: { weight: 0, isStale: false } });
  eq(btn5b.disabled, true,  'busy + out-of-range: disabled stays true');
  eq(btn5b.gated,    true,  'busy + out-of-range: gated flag updates for post-busy snap');

  // After busy clears, gated flag should govern disabled on next poll.
  btn5b.busy = false;
  gate({ btn5: btn5b, btn10: null, scaleData: { weight: 0, isStale: false } });
  eq(btn5b.disabled, true, 'after busy clears: gate re-applies (still out of range)');
})();

// ============================================================
// GROUP 5 — logBag size normalization
// ============================================================
(function group5_logBagNormalization() {
  const cases = [
    { in: {},                 want: '5kg',  label: 'logBag: no size → default 5kg' },
    { in: { size: '5kg' },    want: '5kg',  label: 'logBag: "5kg" → 5kg' },
    { in: { size: '5 kg' },   want: '5kg',  label: 'logBag: "5 kg" → 5kg (space)' },
    { in: { size: '5 kg.' },  want: '5kg',  label: 'logBag: "5 kg." → 5kg (legacy trailing period)' },
    { in: { size: '10lb' },   want: '10lb', label: 'logBag: "10lb" → 10lb' },
    { in: { size: '10 lb' },  want: '10lb', label: 'logBag: "10 lb" → 10lb (space)' },
    { in: { size: '10 LB.' }, want: '10lb', label: 'logBag: "10 LB." → 10lb (uppercase + period)' },
    { in: { size: 'unknown' },want: '5kg',  label: 'logBag: garbage → 5kg fallback' },
  ];
  for (const c of cases) {
    const r = normalizeLogBag(c.in);
    eq(r.normalizedSize, c.want, c.label);
  }

  // Spot-check correlated fields
  const ten = normalizeLogBag({ size: '10lb' });
  eq(ten.sku,          'MANUAL-10LB-BAG', 'logBag: 10lb SKU');
  eq(ten.sizeDisplay,  '10 lb.',          'logBag: 10lb display');
  assert(Math.abs(ten.bagWeightKg - 4.5359) < 1e-6, 'logBag: 10lb weight ≈ 4.5359 kg');

  const five = normalizeLogBag({ size: '5kg' });
  eq(five.sku,         'MANUAL-5KG-BAG',  'logBag: 5kg SKU');
  eq(five.bagWeightKg, 5.0,               'logBag: 5kg weight 5.0 kg');
})();

// ============================================================
// GROUP 6 — classifyBagSize (backend counter-split)
// ============================================================
(function group6_classify() {
  const cases = [
    { row: { size: '5kg', sku: 'X' },             want: '5kg' },
    { row: { size: '5 kg' },                      want: '5kg' },
    { row: { size: '10lb' },                      want: '10lb' },
    { row: { size: '10 LB' },                     want: '10lb' },
    { row: { size: '', sku: 'MANUAL-10LB-BAG' },  want: '10lb' },
    { row: { size: '', sku: 'SHOPIFY-10LB-ABC' }, want: '10lb' },
    { row: { size: '', sku: 'MANUAL-5KG-BAG' },   want: '5kg' },
    { row: { size: null, sku: null },             want: '5kg' },
  ];
  for (const c of cases) {
    eq(classifyBagSize(c.row), c.want, `classify ${JSON.stringify(c.row)} → ${c.want}`);
  }
})();

// ============================================================
// GROUP 7 — simulated full bag-fill cycle (5kg then 10lb)
// ============================================================
(function group7_fullCycle() {
  const btn5 = makeBtn(); const btn10 = makeBtn();
  const feed = [
    // phase 1 — empty scale, pre-work
    { w: 0,     expect5: true,  expect10: true,  note: 'empty' },
    // phase 2 — 5kg bag fill
    { w: 0.136, expect5: true,  expect10: true,  note: 'bag only on scale' },
    { w: 2.500, expect5: true,  expect10: true,  note: '5kg bag: halfway' },
    // DESIGN NOTE: during a 5kg fill, scale briefly passes the 10lb window
    // (4642-4763g). The gate only sees the instantaneous weight, so the 10lb
    // button enables during that sliver. Acceptable risk: operator should
    // wait until the scale stabilizes at their target before clicking.
    { w: 4.700, expect5: true,  expect10: false, note: '5kg fill passing 4700g: 10lb enables (known overlap, operator discipline)' },
    { w: 4.800, expect5: true,  expect10: true,  note: '5kg fill past 10lb max: both disabled' },
    { w: 5.227, expect5: false, expect10: true,  note: '5kg bag: at target → 5kg enables' },
    { w: 0,     expect5: true,  expect10: true,  note: '5kg bag: removed' },
    // phase 3 — 10lb bag fill
    { w: 0.136, expect5: true,  expect10: true,  note: '10lb: bag only' },
    { w: 3.000, expect5: true,  expect10: true,  note: '10lb: partial' },
    { w: 4.672, expect5: true,  expect10: false, note: '10lb: at target' },
    { w: 0,     expect5: true,  expect10: true,  note: '10lb: removed' },
  ];
  for (const step of feed) {
    gate({ btn5, btn10, scaleData: { weight: step.w, isStale: false } });
    eq(btn5.disabled,  step.expect5,  `cycle@${step.w}kg (${step.note}) — 5kg`);
    eq(btn10.disabled, step.expect10, `cycle@${step.w}kg (${step.note}) — 10lb`);
  }
})();

// ============================================================
// Report
// ============================================================
console.log('\n' + '='.repeat(60));
console.log(`Scale-gate test suite — ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('✓ All assertions pass.');
process.exit(0);
