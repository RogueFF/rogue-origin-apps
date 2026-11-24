// Line trimmer seat (src/js/cell/line.mjs + seat.mjs), Koa 2026-11-24: one-hour
// batches ("1 hour batch, not a 1lb batch"), two baskets per trimmer, tops per
// clock hour from the live weight, the cultivar from Hourly entry with a
// changeover that waits for the next batch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slotAt, lineCultivarAt, applyLineCultivar, nextBasketCultivar, personToday, createTally, tickMinutes, paceLbHr,
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
function rig({ person = 7, cultivar = 'Alpha', t0 = 8 * 60 + 58 } = {}) {
  const state = { phase: 'idle', cultivar, nextCultivar: '' };
  const tally = createTally(null, 'day');
  const events = [];
  let line = cultivar;
  const min = (at) => t0 + at / 60000;
  const seat = createSeat({
    state, tally, slotOf: (at) => slotAt(min(at)), hourOver: (at, key) => batchOver(min(at), key),
    personId: () => person, lineCultivar: () => line,
    on: { pickup: (p) => events.push({ kind: 'pickup', ...p }), finish: () => events.push({ kind: 'finish' }) },
  });
  let at = 0;
  const feed = (g, ms = 250) => { for (let i = 0; i < Math.round(ms / 250); i++) { at += 250; seat.reading(at, g); } };
  const ramp = (from, to, ms) => { const n = Math.round(ms / 250); for (let i = 1; i <= n; i++) { at += 250; seat.reading(at, from + (to - from) * i / n); } };
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
