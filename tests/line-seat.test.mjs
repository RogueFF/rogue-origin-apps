// Line trimmer seat (src/js/cell/line.mjs + seat.mjs), Koa 2026-11-24: one-hour
// batches ("1 hour batch, not a 1lb batch"), two baskets per trimmer, tops per
// clock hour from the live weight, the cultivar from Hourly entry with a
// changeover that waits for the next batch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hourGoalG, slotAt, lineCultivarAt, applyLineCultivar, nextBasketCultivar, personToday, createTally, tickMinutes, paceLbHr,
  batchOver, hourFraction, G_PER_LB,
} from '../src/js/cell/line.mjs';
import { createSeat } from '../src/js/cell/seat.mjs';
import { breakAt } from '../src/js/cell/breaks.mjs';

test('hours: the line\'s ten rows; lunch goes to 12-1, before 7 to 7-8, after 4:30 to 4-4:30', () => {
  assert.equal(slotAt(6 * 60 + 50), '7-8');
  assert.equal(slotAt(8 * 60 + 59.99), '8-9');
  assert.equal(slotAt(9 * 60), '9-10');
  assert.equal(slotAt(12 * 60 + 10), '12-1', 'lunch: the next hour');
  assert.equal(slotAt(12 * 60 + 45), '12-1');
  assert.equal(slotAt(16 * 60 + 20), '4-4:30');
  assert.equal(slotAt(17 * 60), '4-4:30');
});

test('the line\'s cultivar: the hour\'s, after its change time; an untyped hour keeps the last one', () => {
  const hours = [
    { slot: '7-8', cultivar: 'Alpha' },
    { slot: '9-10', cultivar: 'Alpha', changeAt: '09:40', changeCultivar: 'Beta' },
  ];
  assert.equal(lineCultivarAt([], 8 * 60), '', 'nothing typed yet');
  assert.equal(lineCultivarAt(hours, 7 * 60 + 5), 'Alpha');
  assert.equal(lineCultivarAt(hours, 8 * 60 + 30), 'Alpha', '8-9 not typed: 7-8\'s');
  assert.equal(lineCultivarAt(hours, 9 * 60 + 39), 'Alpha');
  assert.equal(lineCultivarAt(hours, 9 * 60 + 40), 'Beta', 'after the change time');
  assert.equal(lineCultivarAt(hours, 10 * 60 + 5), 'Beta', 'the next hour, not typed yet: the change cultivar');
});

test('changeover: a basket with tops finishes on its cultivar; the next basket takes the new one', () => {
  const s = { phase: 'running', cultivar: 'Alpha', nextCultivar: '' };
  assert.equal(applyLineCultivar(s, 'Beta'), true);
  assert.deepEqual([s.cultivar, s.nextCultivar], ['Alpha', 'Beta'], '"New cultivar next basket"');
  nextBasketCultivar(s, 'Beta');
  assert.deepEqual([s.cultivar, s.nextCultivar], ['Beta', '']);
  const armed = { phase: 'armed', cultivar: 'Alpha', nextCultivar: '' };
  applyLineCultivar(armed, 'Beta');
  assert.deepEqual([armed.cultivar, armed.nextCultivar], ['Beta', ''], 'an empty basket switches at once');
  const blank = { phase: 'running', cultivar: '', nextCultivar: '' };
  applyLineCultivar(blank, 'Gamma');
  assert.equal(blank.cultivar, 'Gamma', 'a basket started before Hourly entry had a cultivar takes it');
});

test('the name holds for the day only', () => {
  const s = { person: { id: 3, name: 'Ana', day: '2026-11-24' } };
  assert.equal(personToday(s, '2026-11-24').id, 3);
  assert.equal(personToday(s, '2026-11-25'), null);
  assert.equal(s.person, null);
});

test('minutes seated: working minutes only, none across a long gap', () => {
  const at = (h, m) => Date.UTC(2026, 10, 24, 0, 0) + (h * 60 + m) * 60000;   // a fake clock: minutes since midnight
  const minutesAt = (ms) => (ms - Date.UTC(2026, 10, 24, 0, 0)) / 60000;
  assert.equal(tickMinutes(at(8, 0), at(8, 0) + 1000, minutesAt, breakAt), 1 / 60);
  assert.equal(tickMinutes(at(9, 4), at(9, 4) + 1000, minutesAt, breakAt), 0, 'the 9:00 break');
  assert.equal(tickMinutes(at(12, 10), at(12, 10) + 1000, minutesAt, breakAt), 0, 'lunch');
  assert.equal(tickMinutes(at(8, 0), at(8, 5), minutesAt, breakAt), 0, 'a tablet that slept');
  assert.equal(paceLbHr(G_PER_LB, 60), 1);
  assert.equal(paceLbHr(100, 2), null);
});

test('tally: totals per hour, person and cultivar; dirty rows go out as absolute totals', () => {
  const t = createTally(null, '2026-11-24');
  t.credit('8-9', 3, 'Alpha', 200);
  t.credit('8-9', 3, 'Alpha', 50);
  t.credit('9-10', 3, 'Beta', 100);
  t.addMin('8-9', 3, 'Alpha', 30);
  t.addMin('8-9', 0, '', 30);
  assert.equal(t.hourG('8-9', 3), 250);
  assert.equal(t.dayG(3), 350);
  const { rows, keys } = t.takeDirty();
  assert.deepEqual(rows, [{ slot: '8-9', personId: 3, cultivar: 'Alpha', g: 250, min: 30 }, { slot: '9-10', personId: 3, cultivar: 'Beta', g: 100, min: 0 }]);
  assert.equal(t.takeDirty().rows.length, 0);
  t.markDirty(keys);
  assert.equal(t.takeDirty().rows.length, 2, 'a failed send goes again');
  assert.equal(createTally(t.data, '2026-11-25').empty, true, 'a new day starts empty');
  const seeded = createTally(null, '2026-11-24');
  seeded.seed([{ slot: '7-8', personId: 3, cultivar: 'Alpha', g: 320, min: 55 }]);
  assert.equal(seeded.hourG('7-8', 3), 320);
  assert.equal(seeded.takeDirty().rows.length, 0, 'seeded rows are not sent back');
});


test('batches: an hour ends at its slot\'s end (lunch ends 11-12 at 12:00); the ring follows the clock', () => {
  assert.equal(batchOver(8 * 60 + 59, '8-9'), false);
  assert.equal(batchOver(9 * 60, '8-9'), true);
  assert.equal(batchOver(12 * 60, '11-12'), true);
  assert.equal(batchOver(16 * 60 + 29, '4-4:30'), false);
  assert.equal(batchOver(16 * 60 + 30, '4-4:30'), true);
  assert.equal(hourFraction(8 * 60 + 30, '8-9'), 0.5);
  assert.equal(hourFraction(12 * 60 + 45, '12-1'), 0.5, '12:30-1:00');
});

// ---- The seat, run on a fake clock: 250 ms readings from t0 (Pacific minutes).
function rig({ person = 7, cultivar = 'Alpha', t0 = 8 * 60 + 58, step = 250 } = {}) {
  const state = { phase: 'idle', cultivar, nextCultivar: '' };
  const tally = createTally(null, 'day');
  const events = [];
  let line = cultivar;
  const min = (at) => t0 + at / 60000;
  const seat = createSeat({
    state, tally, slotOf: (at) => slotAt(min(at)), hourOver: (at, key) => batchOver(min(at), key),
    personId: () => person, lineCultivar: () => line,
    on: { pickup: (p) => events.push({ kind: 'pickup', ...p }), finish: (reason) => events.push({ kind: 'finish', reason }) },
  });
  let at = 0;
  const feed = (g, ms = step) => { for (let i = 0; i < Math.max(1, Math.round(ms / step)); i++) { at += step; seat.reading(at, g); } };
  const ramp = (from, to, ms) => { const n = Math.max(1, Math.round(ms / step)); for (let i = 1; i <= n; i++) { at += step; seat.reading(at, from + (to - from) * i / n); } };
  return { state, tally, seat, events, feed, ramp, setLine: (c) => { line = c; }, now: () => at };
}
const total = (tally, p = 7) => Math.round(tally.dayG(p) * 10) / 10;
const near = (a, b, tol = 0.6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

/** Basket on the pan reading its own weight, then the scale's TARE: armed. */
function tareEmptyBasket(r) {
  r.feed(168, 3000);
  r.feed(0, 2500);
  assert.equal(r.state.phase, 'armed');
}

test('the hour mark ends the batch (the chime); tops after it count for the next hour; the pickup closes it', () => {
  const r = rig();
  tareEmptyBasket(r);
  // 8:58:05.5 to 8:59:55.5: 230 g in the basket.
  r.ramp(0, 230, 110000);
  assert.equal(r.state.phase, 'running');
  r.feed(230, 5000);
  assert.equal(r.state.phase, 'finished', 'the 8-9 batch is done at 9:00');
  assert.deepEqual(r.events.map((e) => e.kind), ['finish']);
  const at900 = r.tally.hourG('8-9', 7);
  near(at900, 230, 1);
  // The trimmer keeps going a minute before the swap: that goes to 9-10.
  r.ramp(230, 300, 60000);
  r.feed(300, 2500);
  r.feed(-160, 750);           // basket A off
  r.feed(0.4, 1500);           // the matched basket B on, about empty
  const p = r.events.filter((e) => e.kind === 'pickup');
  assert.equal(p.length, 1);
  near(p[0].g, 300);
  near(r.tally.hourG('8-9', 7), 230, 1);
  near(r.tally.hourG('9-10', 7), 70, 1);
  assert.equal(r.state.phase, 'armed', 'the next batch starts by itself');
  r.ramp(0, 20, 10000);
  assert.equal(r.state.batchSlot, '9-10');
  assert.equal(r.tally.picks(7), 1);
});

test('a basket lifted early is a pickup with its weight; the next batch is the same hour', () => {
  const r = rig({ t0: 8 * 60 + 10 });
  tareEmptyBasket(r);
  r.ramp(0, 212, 60000);
  r.feed(212, 2500);
  r.feed(-150, 500);
  r.feed(0, 1500);
  assert.deepEqual(r.events.map((e) => e.kind), ['pickup']);
  near(r.events[0].g, 212);
  near(total(r.tally), 212);
  assert.equal(r.state.phase, 'armed');
  r.ramp(0, 10, 10000);
  assert.equal(r.state.batchSlot, '8-9');
});

test('basket B a few grams heavier: back heavy, then TARE within 90 s = a pickup of basket A, not a tiny one', () => {
  const r = rig();
  tareEmptyBasket(r);
  r.ramp(0, 465, 120000);
  r.feed(465, 3500);
  assert.equal(r.state.phase, 'finished');
  r.feed(-160, 750);          // A off
  r.feed(6.5, 4000);          // B on, 6.5 g heavier: looks like a shake for now
  assert.equal(r.seat.swapPending(r.now()), true, 'the screen asks for the TARE');
  near(total(r.tally), 465, 1);   // nothing taken back while B may be on
  r.feed(0, 2500);            // TARE
  const p = r.events.filter((e) => e.kind === 'pickup');
  assert.equal(p.length, 1);
  near(p[0].g, 465);
  near(total(r.tally), 465, 1);
  assert.equal(r.state.phase, 'armed');
});

test('a real shake: back with less and no TARE, what fell out comes back off the hour', () => {
  const r = rig({ t0: 8 * 60 + 10 });
  tareEmptyBasket(r);
  r.ramp(0, 300, 60000);
  r.feed(300, 2500);
  r.feed(-150, 500);
  r.feed(288, 3000);
  r.feed(288, 91000);          // past the 90 s grace
  near(total(r.tally), 288, 1);
  assert.equal(r.state.phase, 'running');
});

test('changeover mid-batch: the batch finishes on the old cultivar, the next is the new one', () => {
  const r = rig();
  tareEmptyBasket(r);
  r.ramp(0, 200, 30000);
  r.setLine('Beta');
  applyLineCultivar(r.state, 'Beta');
  assert.equal(r.state.nextCultivar, 'Beta');
  r.ramp(200, 300, 100000);
  assert.equal(r.state.phase, 'finished');
  r.feed(300, 2500);
  r.feed(-150, 500);
  r.feed(0.2, 1500);
  assert.equal(r.events.find((e) => e.kind === 'pickup').cultivar, 'Alpha');
  assert.equal(r.state.cultivar, 'Beta');
  r.ramp(0, 50, 30000);
  const rows = r.tally.takeDirty().rows;
  near(rows.filter((x) => x.cultivar === 'Alpha').reduce((a, x) => a + x.g, 0), 300, 1);
  near(rows.filter((x) => x.cultivar === 'Beta').reduce((a, x) => a + x.g, 0), 50, 1);
});

test('nobody tapped in: the weight still counts, as person 0', () => {
  const r = rig({ person: 0, t0: 8 * 60 });
  tareEmptyBasket(r);
  r.ramp(0, 120, 60000);
  near(total(r.tally, 0), 120);
});

test('a name tap on a tared empty basket arms it; a loaded or untared scale does not', () => {
  const r = rig();
  assert.equal(r.seat.start(0.3), true);
  assert.equal(r.state.phase, 'armed');
  const r2 = rig();
  assert.equal(r2.seat.start(168), false, 'an untared basket would count as tops');
});

test("at the screen's 1 s reading rate: the hour mark, a matched swap, and a heavier basket B tared", () => {
  const r = rig({ step: 1000 });
  r.feed(168, 3000);
  r.feed(0, 3000);
  assert.equal(r.state.phase, 'armed');
  r.ramp(0, 230, 110000);
  r.feed(230, 6000);
  assert.equal(r.state.phase, 'finished');
  r.feed(-160, 2000);
  r.feed(0.4, 3000);
  assert.equal(r.events.filter((e) => e.kind === 'pickup').length, 1);
  near(r.events.find((e) => e.kind === 'pickup').g, 230);
  assert.equal(r.state.phase, 'armed');
  r.ramp(0, 300, 120000);
  r.feed(300, 3000);
  r.feed(-160, 2000);
  r.feed(6.5, 4000);
  r.feed(0, 3000);
  const p = r.events.filter((e) => e.kind === 'pickup');
  assert.equal(p.length, 2);
  near(p[1].g, 300);
  near(total(r.tally), 530, 1.5);
});

test('a near-empty basket at the hour mark asks for no swap: the batch carries on into the new hour', () => {
  const r = rig({ t0: 8 * 60 + 59 });
  tareEmptyBasket(r);
  r.ramp(0, 6, 20000);
  r.feed(6, 40000);            // past 9:00 with 6 g in the basket
  assert.equal(r.state.phase, 'running');
  assert.equal(r.state.batchSlot, '9-10');
  assert.deepEqual(r.events, [], 'no chime, no pickup');
});

test("the hour goal: lb per trimmer-hour x the hour's working minutes; none without a rate", () => {
  assert.equal(Math.round(hourGoalG(1.1, '8-9')), Math.round(1.1 * G_PER_LB));
  assert.equal(Math.round(hourGoalG(1.2, '9-10')), Math.round(1.2 * G_PER_LB * 50 / 60), 'the 9:00 break comes out');
  assert.equal(Math.round(hourGoalG(1.2, '12-1')), Math.round(1.2 * G_PER_LB / 2), '12:30-1:00');
  assert.equal(hourGoalG(null, '8-9'), null);
  assert.equal(hourGoalG(1.1, 'nope'), null);
});

// ---- Seat 1, 2026-11-25, 1:59-2:03 PM (Diego, Lifter): the settled readings from
// scale_events, held between posts. Live, the swap closed basket A (483 g) as a 3.3 g
// pickup and the 480 g came back off 2-3, which then sat at 0 g for 15 minutes.
const SEAT1_SWAP = [[0, 470], [41, 483.49], [73, -131.55], [80, -131.81], [101, 483.29], [121, -131.79], [146, 3.33],
  [156, -117.9], [157, 0], [162, 121.19], [163, 0], [204, 3.04], [222, 7.98], [234, 10.81], [260, 20]];
function replaySeat1(step) {
  const r = rig({ t0: 13 * 60 + 59, step });
  r.seat.start(0);
  let i = 0;
  let low = 0;
  for (let at = 0; at <= 260000; at += step) {
    while (i + 1 < SEAT1_SWAP.length && SEAT1_SWAP[i + 1][0] * 1000 <= at) i++;
    r.seat.reading(at, SEAT1_SWAP[i][1]);
    low = Math.min(low, r.tally.data.b['2-3|7|Alpha']?.g ?? 0);
  }
  return { r, low };
}
for (const step of [1000, 250]) {
  test(`Seat 1's 2:00 swap, replayed at ${step} ms: basket A is picked up at its 483 g, 2-3 never goes negative`, () => {
    const { r, low } = replaySeat1(step);
    const picks = r.events.filter((e) => e.kind === 'pickup').map((e) => Math.round(e.g * 10) / 10);
    assert.deepEqual(picks, [483.5, 121.2], 'basket A, then the 121 g TAREd at 2:01:43');
    near(r.tally.hourG('1-2', 7), 483.5, 0.2);
    near(r.tally.hourG('2-3', 7), 141.2, 1);
    assert.ok(low > -1, `2-3 dipped to ${low}`);
  });
}

test('1 lb or the hour, whichever comes first: a 1 lb swap mid-hour, then a ~480 g swap at 2:00 with B heavier, a dip and TARE', () => {
  const r = rig({ t0: 13 * 60 + 25 });   // 1:25 PM
  tareEmptyBasket(r);
  r.ramp(0, 456, 120000);
  r.feed(456, 4000);
  assert.equal(r.state.phase, 'finished', 'the basket is full at 1 lb, before the hour');
  r.feed(-131.6, 2000);    // A off
  r.feed(0.4, 3000);       // matched B on
  assert.equal(r.events.filter((e) => e.kind === 'pickup').length, 1);
  assert.equal(r.state.phase, 'armed');
  r.ramp(0, 480, 1800000); // to 1:57:xx
  r.feed(480, 200000);     // past 2:00
  assert.equal(r.state.phase, 'finished', 'the second batch is done (1 lb came first)');
  r.feed(-131.8, 3000);    // A off
  r.feed(3.3, 9000);       // B on, 3.3 g heavier
  r.feed(-117.9, 1000);    // a dip
  r.feed(0, 4000);         // TARE
  const picks = r.events.filter((e) => e.kind === 'pickup').map((e) => Math.round(e.g));
  assert.deepEqual(picks, [456, 480]);
  assert.deepEqual(r.events.filter((e) => e.kind === 'finish').map((e) => e.reason), ['full', 'full'], 'both baskets passed 1 lb before 2:00: each ends at 1 lb (the hour mark ends batches under 1 lb, tests above)');
  near(r.tally.hourG('1-2', 7), 936, 1);
  assert.ok(r.tally.hourG('2-3', 7) < 1, 'nothing owed by 2-3');
  assert.ok((r.tally.data.b['2-3|7|Alpha']?.g ?? 0) > -1, '2-3 carries no hidden deficit');
  assert.equal(r.state.phase, 'armed');
});
