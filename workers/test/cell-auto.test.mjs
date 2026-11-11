import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoTops, slotFor } from '../src/lib/cell-auto.js';

// Readings are NET: the crew tare on the scale itself with the basket on, so an
// empty basket reads about 0 and a lifted basket reads negative (v6.3 firmware).
// 2026-11-09 is PST (UTC-8): 9:00 Pacific is 17:00 UTC.
const DAY = '2026-11-09';
const at = (h, m, s = 0) => `${DAY} ${String(h + 8).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
const r = (h, m, g, s = 0) => ({ ts: at(h, m, s), kg: g / 1000 });
const tap = (h, m, s = 0) => ({ ts: at(h, m, s), kind: 'pickup', kg: 0 });
const SLOTS = [
  { slot: '9-10', startMin: 540, endMin: 600 },
  { slot: '10-11', startMin: 600, endMin: 660 },
  { slot: '11-12', startMin: 660, endMin: 720 },
  { slot: '12:30-1', startMin: 750, endMin: 780 },
];
const LB = g => Math.round((g / 453.59237) * 100) / 100;
const run = (readings, marks = []) => autoTops({ day: DAY, readings, marks, slots: SLOTS });

test('steady trimming from a tared basket: tops = net added', () => {
  const out = run([r(9, 0, 0), r(9, 10, 30), r(9, 20, 80), r(9, 40, 160)]);
  assert.deepEqual(out.bySlot, { '9-10': LB(160) });
  assert.deepEqual(out.flags, {});
});

test('the hour mark splits the work: each hour gets its own net change', () => {
  const out = run([r(9, 0, 0), r(9, 50, 100), r(10, 10, 160)]);
  assert.deepEqual(out.bySlot, { '9-10': LB(100), '10-11': LB(60) });
});

test('a shake (lifted negative, back with weight): the shaken-out biomass comes off', () => {
  const out = run([r(9, 0, 0), r(9, 10, 100), r(9, 30, 200), r(9, 31, -50), r(9, 32, 190)]);
  assert.deepEqual(out.bySlot, { '9-10': LB(190) });
  assert.equal(out.pickups.length, 0);
});

test('a full pickup (lifted, back about empty): nothing is lost and trimming carries on', () => {
  const out = run([r(9, 0, 0), r(9, 10, 100), r(9, 30, 200), r(9, 31, -50), r(9, 33, 0.3), r(9, 50, 30.3)]);
  assert.deepEqual(out.bySlot, { '9-10': LB(200 + 30) });
  assert.deepEqual(out.pickups.map(p => Math.round(p.g)), [200]);
});

test('a partial pickup without a tap reads as a shake (known undercount)', () => {
  const out = run([r(9, 0, 0), r(9, 10, 100), r(9, 30, 200), r(9, 31, -50), r(9, 32, 80)]);
  assert.deepEqual(out.bySlot, { '9-10': LB(80) });
});

test('a partial pickup with a tap: the picked-up part is not lost', () => {
  const out = run(
    [r(9, 0, 0), r(9, 10, 100), r(9, 30, 200), r(9, 31, -50), r(9, 32, 80)],
    [tap(9, 31, 30)],
  );
  assert.deepEqual(out.bySlot, { '9-10': LB(200) });
  assert.deepEqual(out.pickups.map(p => Math.round(p.g)), [120]);
});

test('the hour mark lands mid-lift: the hour keeps the pre-lift weight, the shake lands next hour', () => {
  const out = run([r(9, 0, 0), r(9, 30, 150), r(9, 58, 300), r(9, 59, -50), r(10, 1, 290)]);
  assert.deepEqual(out.bySlot, { '9-10': LB(300), '10-11': LB(-10) });
});

test('a new basket of a different weight, then the scale TARE within 90 s: a pickup, no credit', () => {
  const out = run([r(9, 0, 0), r(9, 10, 100), r(9, 30, 200), r(9, 31, -50), r(9, 32, 6), r(9, 32, 0, 30), r(9, 45, 40)]);
  assert.deepEqual(out.bySlot, { '9-10': LB(200 + 40) });
  assert.deepEqual(out.pickups.map(p => Math.round(p.g)), [200]);
});

test('a basket set on an untared scale and then tared is not tops', () => {
  const out = run([r(9, 0, 0), r(9, 1, 50), r(9, 2, 0), r(9, 20, 70)]);
  assert.deepEqual(out.bySlot, { '9-10': LB(70) });
  assert.deepEqual(out.flags, {});
});

test('the scale TARE pressed mid-job: what was on the pan is banked, and the hour is flagged', () => {
  const out = run([r(9, 0, 0), r(9, 10, 20), r(9, 20, 60), r(9, 30, 120), r(9, 31, 0), r(9, 45, 30)]);
  assert.deepEqual(out.bySlot, { '9-10': LB(150) });
  assert.deepEqual(out.flags, { '9-10': ['scaleTared'] });
});

test('readings from another Pacific day are ignored', () => {
  const out = run([{ ts: '2026-11-09 07:30:00', kg: 0.05 }, r(9, 0, 0), r(9, 10, 20)]);
  assert.deepEqual(out.bySlot, { '9-10': LB(20) }); // 07:30 UTC is 11:30 pm on 11-08
});

test('a reading in the lunch gap counts toward the next slot', () => {
  assert.equal(slotFor(12 * 60 + 10, SLOTS), '12:30-1');
  const out = run([r(11, 50, 0), r(12, 10, 40)]);
  assert.deepEqual(out.bySlot, { '12:30-1': LB(40) });
});

test('readings passing through during a lift are skipped (the scale sends no settle flag)', () => {
  // 200 g held; lifting passes through 120, 30 and 0.3 within a second, then the
  // empty pan (-50) holds; putting it back passes 150 and settles at 190: a shake.
  const out = run([
    r(9, 0, 0), r(9, 10, 100), r(9, 30, 200),
    r(9, 31, 120, 0), r(9, 31, 30, 0), r(9, 31, 0.3, 1), r(9, 31, -50, 1),
    r(9, 32, 150, 0), r(9, 32, 190, 1),
  ]);
  assert.deepEqual(out.bySlot, { '9-10': LB(190) });
  assert.deepEqual(out.flags, {}, 'a lift is not a scale TARE');
});

test('a scale TARE that holds at 0 is still seen through the settle filter', () => {
  const out = run([r(9, 0, 0), r(9, 10, 40, 0), r(9, 10, 60, 0), r(9, 20, 120), r(9, 30, 0), r(9, 45, 30)]);
  assert.deepEqual(out.bySlot, { '9-10': LB(150) });
  assert.deepEqual(out.flags, { '9-10': ['scaleTared'] });
});

// ---- A scale nobody tared reads GROSS (bench test 2026-11-11, v6.5, JINXUAN):
// a 168 g basket lifted off reads 0.00, not negative, and holds there ~4 s.
// Koa 2026-11-11 ("automatic + guard"): a zero from a loaded basket is a lift
// when the basket comes back; only an empty basket's zero is the scale's TARE.

test('un-tared: basket on, trimming, lifted (reads 0), back empty = pickup of the tops only', () => {
  const out = run([r(9, 0, 0), r(9, 1, 168), r(9, 10, 175), r(9, 30, 200), r(9, 31, 0, 0), r(9, 31, 0, 4), r(9, 31, 168.2, 6)]);
  assert.deepEqual(out.bySlot, { '9-10': LB(32) });          // not 200, and not 368
  assert.deepEqual(out.flags, {});
  assert.equal(out.pickups.length, 1);
  assert.ok(Math.abs(out.pickups[0].g - 32) < 1e-9);
});

test('un-tared: back with tops still in it = a shake; the next pickup is measured from the empty basket', () => {
  const out = run([r(9, 0, 0), r(9, 1, 168), r(9, 30, 200), r(9, 31, 0), r(9, 31, 190, 5),
    r(9, 40, 220), r(9, 41, 0), r(9, 41, 168.3, 5)]);
  assert.deepEqual(out.bySlot, { '9-10': LB(22 + 30) });     // 32 made, 10 shaken out, 30 more
  assert.equal(out.pickups.length, 1);
  assert.ok(Math.abs(out.pickups[0].g - 52) < 1e-9);
  assert.deepEqual(out.flags, {});
});

test('un-tared: an empty basket lifted and set back changes nothing', () => {
  const out = run([r(9, 0, 0), r(9, 1, 168.6), r(9, 2, 0), r(9, 2, 168.22, 6)]);
  assert.deepEqual(out.bySlot, {});
  assert.equal(out.pickups.length, 0);
});

test('un-tared: a loaded basket lifted and set straight back changes nothing', () => {
  const out = run([r(9, 0, 0), r(9, 1, 168), r(9, 20, 200), r(9, 21, 0), r(9, 21, 200.4, 5), r(9, 30, 210)]);
  assert.deepEqual(out.bySlot, { '9-10': LB(42) });
  assert.equal(out.pickups.length, 0);
});

test('un-tared, then the crew press TARE with the empty basket on: the scale reads net from then on', () => {
  const out = run([r(9, 0, 0), r(9, 1, 168), r(9, 30, 200), r(9, 31, 0), r(9, 31, 168, 5),   // pickup 32
    r(9, 35, 0), r(9, 40, 20), r(9, 45, -150), r(9, 46, 0.2)]);                               // TARE, 20 g, pickup
  assert.deepEqual(out.bySlot, { '9-10': LB(52) });
  assert.deepEqual(out.pickups.map(p => Math.round(p.g)), [32, 20]);
  assert.deepEqual(out.flags, {});
});

test('a loaded zero that never comes back within GRACE_MS is the scale TARE: banked and flagged', () => {
  const out = run([r(9, 0, 0), r(9, 1, 168), r(9, 30, 200), r(9, 31, 0), r(9, 40, 0.4), r(9, 50, 20)]);
  assert.deepEqual(out.flags, { '9-10': ['scaleTared'] });
  assert.equal(out.pickups.length, 0);
});

test('tared scale, mid-job TARE with tops in (small first handful): still banked and flagged', () => {
  const out = run([r(9, 0, 0), r(9, 5, 10), r(9, 10, 30), r(9, 11, 0), r(9, 12, 2), r(9, 13, 60)]);
  assert.deepEqual(out.bySlot, { '9-10': LB(30 + 60) });
  assert.deepEqual(out.flags, { '9-10': ['scaleTared'] });
});

test('un-tared, the basket already on when the day began: a lift and set-back credits nothing', () => {
  // The first reading of the day is the basket itself (no rise from 0 to see).
  const out = run([r(9, 0, 168.6), r(9, 2, 0), r(9, 2, 168.22, 6)]);
  assert.deepEqual(out.bySlot, {});
  assert.deepEqual(out.flags, {});
});

test('un-tared, the basket already on when the day began: trimming, lift, back empty = pickup of the tops', () => {
  const out = run([r(9, 0, 168), r(9, 10, 175), r(9, 30, 200), r(9, 31, 0), r(9, 31, 168.1, 6)]);
  assert.deepEqual(out.bySlot, { '9-10': LB(32) });
  assert.equal(out.pickups.length, 1);
  assert.ok(Math.abs(out.pickups[0].g - 32) < 1e-9);
});
