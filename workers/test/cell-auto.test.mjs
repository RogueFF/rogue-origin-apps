import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoTops, slotFor } from '../src/lib/cell-auto.js';

// 2026-11-09 is PST (UTC-8): 9:00 Pacific is 17:00 UTC.
const DAY = '2026-11-09';
const at = (h, m, s = 0) => `${DAY} ${String(h + 8).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
const r = (h, m, g, s = 0) => ({ ts: at(h, m, s), kg: g / 1000 });
const tare = (h, m, g, s = 0) => ({ ts: at(h, m, s), kind: 'tare', kg: g / 1000 });
const tap = (h, m, s = 0) => ({ ts: at(h, m, s), kind: 'pickup', kg: 0 });
const SLOTS = [
  { slot: '9-10', startMin: 540, endMin: 600 },
  { slot: '10-11', startMin: 600, endMin: 660 },
  { slot: '11-12', startMin: 660, endMin: 720 },
  { slot: '12:30-1', startMin: 750, endMin: 780 },
];
const LB = g => Math.round((g / 453.59237) * 100) / 100;
const run = (readings, marks = []) => autoTops({ day: DAY, readings, marks, slots: SLOTS });

test('steady trimming in one hour: tops = net added', () => {
  const out = run([r(9, 0, 50), r(9, 10, 80), r(9, 20, 130), r(9, 40, 210)], [tare(9, 0, 50, 5)]);
  assert.deepEqual(out.bySlot, { '9-10': LB(160) });
});

test('the hour mark splits the work: each hour gets its own net change', () => {
  const out = run([r(9, 0, 50), r(9, 50, 150), r(10, 10, 210)], [tare(9, 0, 50, 5)]);
  assert.deepEqual(out.bySlot, { '9-10': LB(100), '10-11': LB(60) });
});

test('a shake (lifted, back with weight): the shaken-out biomass comes off', () => {
  const out = run([r(9, 0, 50), r(9, 30, 250), r(9, 31, 0), r(9, 32, 240)], [tare(9, 0, 50, 5)]);
  assert.deepEqual(out.bySlot, { '9-10': LB(190) });
  assert.equal(out.pickups.length, 0);
});

test('a full pickup (lifted, back about empty): nothing is lost and trimming carries on', () => {
  const out = run(
    [r(9, 0, 50), r(9, 30, 250), r(9, 31, 0), r(9, 33, 50.5), r(9, 50, 80)],
    [tare(9, 0, 50, 5)],
  );
  assert.deepEqual(out.bySlot, { '9-10': LB(200 + 30) });
  assert.deepEqual(out.pickups.map(p => Math.round(p.g)), [200]);
});

test('a partial pickup without a tap reads as a shake (known undercount)', () => {
  const out = run([r(9, 0, 50), r(9, 30, 250), r(9, 31, 0), r(9, 32, 130)], [tare(9, 0, 50, 5)]);
  assert.deepEqual(out.bySlot, { '9-10': LB(80) });
});

test('a partial pickup with a tap: the picked-up part is not lost', () => {
  const out = run(
    [r(9, 0, 50), r(9, 30, 250), r(9, 31, 0), r(9, 32, 130)],
    [tare(9, 0, 50, 5), tap(9, 31, 30)],
  );
  assert.deepEqual(out.bySlot, { '9-10': LB(200) });
  assert.deepEqual(out.pickups.map(p => Math.round(p.g)), [120]);
});

test('the hour mark lands mid-lift: the hour keeps the pre-lift weight, the shake lands next hour', () => {
  const out = run([r(9, 0, 50), r(9, 58, 350), r(9, 59, 0), r(10, 1, 340)], [tare(9, 0, 50, 5)]);
  assert.deepEqual(out.bySlot, { '9-10': LB(300), '10-11': LB(-10) });
});

test('a new basket tared within 90 s of coming back is a pickup, even at a new weight', () => {
  const out = run(
    [r(9, 0, 50), r(9, 30, 250), r(9, 31, 0), r(9, 32, 60), r(9, 45, 100)],
    [tare(9, 0, 50, 5), tare(9, 32, 60, 20)],
  );
  assert.deepEqual(out.bySlot, { '9-10': LB(200 + 40) });
  assert.deepEqual(out.pickups.map(p => Math.round(p.g)), [200]);
});

test('no Tare pressed: the first basket on the pan is the tare', () => {
  const out = run([r(9, 0, 0), r(9, 1, 50), r(9, 20, 120)]);
  assert.deepEqual(out.bySlot, { '9-10': LB(70) });
});

test('readings from another Pacific day are ignored', () => {
  const out = run([{ ts: '2026-11-09 07:30:00', kg: 0.05 }, r(9, 0, 50), r(9, 10, 70)], [tare(9, 0, 50, 5)]);
  assert.deepEqual(out.bySlot, { '9-10': LB(20) }); // 07:30 UTC is 11:30 pm on 11-08
});

test('a reading in the lunch gap counts toward the next slot', () => {
  assert.equal(slotFor(12 * 60 + 10, SLOTS), '12:30-1');
  const out = run([r(11, 50, 50), r(12, 10, 90)], [tare(11, 50, 50, 5)]);
  assert.deepEqual(out.bySlot, { '12:30-1': LB(40) });
});
