// Cell screen lift rule (src/js/cell/lift.mjs): pickup vs shake, any time
// (SOP-027 code check 2026-11-10: a post-chime shake was logged as a pickup, and
// a pre-chime pickup left the job running across two baskets).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiftWatch, GRACE_MS } from '../src/js/cell/lift.mjs';

// Feed [ms, gross] readings (net = gross here); return every non-null result.
function run(w, readings) {
  const out = [];
  for (const [at, g] of readings) { const r = w.reading(at, g, Math.max(0, g)); if (r) out.push({ at, ...r }); }
  return out;
}
// A reading every 250 ms from `from` to `to` (inclusive) at weight g.
const hold = (from, to, g) => { const r = []; for (let t = from; t <= to; t += 250) r.push([t, g]); return r; };

test('after the chime: lifted, shaken, set back with most of it = a shake, not a pickup', () => {
  const w = createLiftWatch();
  const out = run(w, [...hold(0, 2000, 470), [2250, 300], [2500, -150], [2750, -150], [3000, -40],
    ...hold(3250, 4500, 455)]);
  assert.deepEqual(out.map(o => o.kind), ['shake']);
  assert.equal(out[0].g, 15);
  assert.equal(out[0].backNet, 455);
});

test('after the chime: set back about empty = a pickup of what the basket held', () => {
  const w = createLiftWatch();
  const out = run(w, [...hold(0, 2000, 470), [2250, -150], ...hold(2500, 3750, 0.3)]);
  assert.deepEqual(out, [{ at: 3500, kind: 'pickup', g: 470 }]);
});

test('before the chime: the bagger takes a part-full basket, it comes back empty = a pickup', () => {
  const w = createLiftWatch();
  const out = run(w, [...hold(0, 1000, 180), ...hold(1250, 2000, 212.5), [2250, -140], [2500, -140],
    ...hold(2750, 4000, -0.2)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'pickup');
  assert.equal(out[0].g, 212.5);
});

test('lifting off counts what was on the pan before the lift, not a reading on the way up', () => {
  const w = createLiftWatch();
  const out = run(w, [...hold(0, 1500, 400), [1750, 120], [2000, -150], ...hold(2250, 3500, 0)]);
  assert.equal(out[0].g, 400);
});

test('a full basket lowered back through 0 is not read as an empty one', () => {
  const w = createLiftWatch();
  const out = run(w, [...hold(0, 2000, 460), [2250, -150], [2500, 0.4], [2750, 210], ...hold(3000, 4250, 452)]);
  assert.deepEqual(out.map(o => o.kind), ['shake']);
});

test('lifted again before it settled: still one lift', () => {
  const w = createLiftWatch();
  const out = run(w, [...hold(0, 2000, 300), [2250, -150], [2500, 0.1], [2750, -150], ...hold(3000, 4250, 0.1)]);
  assert.deepEqual(out.map(o => o.kind), ['pickup']);
  assert.equal(out[0].g, 300);
});

test('a new, heavier basket then the scale TARE within the grace time = a pickup', () => {
  const w = createLiftWatch();
  const out = run(w, [...hold(0, 2000, 470), [2250, -150], ...hold(2500, 3750, 38)]);
  assert.deepEqual(out.map(o => o.kind), ['shake']);   // what it looks like until the TARE
  assert.deepEqual(w.tare(3750 + 20000), { kind: 'pickup', g: 470 });
  assert.equal(w.tare(3750 + 21000), null);             // only once
});

test('a TARE long after a shake is just a TARE', () => {
  const w = createLiftWatch();
  run(w, [...hold(0, 2000, 470), [2250, -150], ...hold(2500, 3750, 455)]);
  assert.equal(w.tare(3750 + GRACE_MS + 1), null);
});

test('no lift, no result; an empty basket lifted and set back is a pickup of 0', () => {
  const w = createLiftWatch();
  assert.deepEqual(run(w, hold(0, 3000, 120)), []);
  const w2 = createLiftWatch();
  const out = run(w2, [...hold(0, 1000, 0), [1250, -150], ...hold(1500, 2750, 0)]);
  assert.deepEqual(out.map(o => [o.kind, o.g]), [['pickup', 0]]);
});

// ---- Drops to about 0: the scale's TARE vs a lift (Koa 2026-11-11, "automatic
// + guard"; bench test on v6.5, JINXUAN) and the two-basket swap (Koa 2026-11-11).
import { createZeroWatch } from '../src/js/cell/lift.mjs';
const zrun = (readings, loaded = () => false) => {
  const z = createZeroWatch();
  const out = [];
  for (const [at, g] of readings) { const e = z.reading(at, g, loaded); if (e) out.push({ at, ...e }); }
  return { out, z };
};

test('bench: an empty basket lifted off an UN-TARED scale reads 0, holds 4 s, comes back: TARE then undone', () => {
  const { out, z } = zrun([...hold(0, 2000, 168.6), [2250, 120], [2500, 191], [2750, 40],
    ...hold(3000, 7000, 0), [7250, 90], ...hold(7500, 9000, 168.22)]);
  assert.deepEqual(out.map(o => o.kind), ['tare', 'undoTare']);
  assert.equal(out[0].before, 168.6);   // the held reading, not the 191 g press spike
  assert.equal(z.provisional, false);
});

test('a real TARE at shift start: basket on, TARE, trimming starts from 0: it stands', () => {
  const { out, z } = zrun([...hold(0, 2000, 168.6), ...hold(2250, 5000, 0), ...hold(5250, 7000, 3.2), ...hold(7250, 9000, 170)]);
  assert.deepEqual(out.map(o => o.kind), ['tare']);
  assert.equal(z.provisional, false);   // trimming started: no basket coming back can undo it
});

test('two baskets, fast swap with no negative reading: full basket off, matched empty on = pickup, never a TARE', () => {
  // 200 g of tops; the matched empty basket reads +1.4 g (within 2 g)
  const { out } = zrun([...hold(0, 2000, 200), [2250, 60], ...hold(2500, 6000, 1.4)], () => true);
  assert.deepEqual(out, [{ at: 4500, kind: 'pickup', before: 200 }]);
});

test('a loaded drop to 0 that holds (TARE pressed with tops in) is read as a pickup of what was there', () => {
  const { out } = zrun([...hold(0, 2000, 200), ...hold(2250, 6000, 0)], () => true);
  assert.deepEqual(out.map(o => [o.kind, o.before]), [['pickup', 200]]);
});

test('an idle drop to 1.4 g is no TARE (only a loaded drop gets the 2 g tolerance)', () => {
  const { out } = zrun([...hold(0, 2000, 168), ...hold(2250, 6000, 1.4)]);
  assert.deepEqual(out, []);
});

test('two baskets, swap with the negative seen (tared): the lift rule closes it, the zero watch stays out', () => {
  const readings = [...hold(0, 2000, 200), [2250, -150], ...hold(2500, 3500, -168), ...hold(3750, 5500, 1.2)];
  assert.deepEqual(zrun(readings, () => true).out, []);
  const w = createLiftWatch();
  assert.deepEqual(run(w, readings).map(o => [o.kind, o.g]), [['pickup', 200]]);
});

test('two baskets that differ by more than 2 g: heavier reads as a shake until the TARE makes it a pickup', () => {
  const w = createLiftWatch();
  const out = run(w, [...hold(0, 2000, 200), [2250, -150], ...hold(2500, 3500, -168), ...hold(3750, 5500, 5)]);
  assert.deepEqual(out.map(o => o.kind), ['shake']);
  assert.deepEqual(w.tare(7000), { kind: 'pickup', g: 200 });
});

test('a tared lift (negative) is no zero event at all', () => {
  const { out } = zrun([...hold(0, 2000, 200), [2250, -150], ...hold(2500, 4000, -168), ...hold(4250, 6000, 0.2)]);
  assert.deepEqual(out, []);
});
