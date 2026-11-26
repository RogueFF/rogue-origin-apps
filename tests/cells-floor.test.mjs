// The Cells board's floor (src/js/cells/floor.mjs), Koa 2026-11-25: the trim line from
// above, 16 tables in a staggered zigzag (1 top-left, 2 below it half a step right...).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seatXY, floorModel, floorSvg, G_PER_LB } from '../src/js/cells/floor.mjs';

test('numbering: odd seats on top, even below half a step right, left to right', () => {
  const [s1, s2, s3, s4, s16] = [1, 2, 3, 4, 16].map(seatXY);
  assert.equal(s1.top, true);
  assert.equal(s2.top, false);
  assert.ok(s1.x < s2.x && s2.x < s3.x && s3.x < s4.x, 'a zigzag running left to right');
  assert.equal(s3.x - s1.x, 2 * (s2.x - s1.x), 'the bottom seat sits halfway between two top seats');
  assert.equal(s16.top, false);
});

test('seat states and the hour ring', () => {
  const cells = [
    { stationId: 'table1', scale: { live: true, weightG: 200 }, job: { phase: 'running', tabletOnline: true } },
    { stationId: 'table2', scale: { live: true, weightG: 460 }, job: { phase: 'finished', tabletOnline: true } },
    { stationId: 'table3', scale: { live: false }, job: { phase: 'running', tabletOnline: true } },
  ];
  const rows = [
    { stationId: 'table1', personId: 5, name: 'Diego Ramos', g: 1.2 * G_PER_LB, min: 50 },
    { stationId: 'table2', personId: 6, name: 'Ana', g: 0.4 * G_PER_LB, min: 50 },
  ];
  const m = floorModel(cells, rows, { table4: 'Beto' }, 1.1, '8-9');
  const by = Object.fromEntries(m.seats.map((s) => [Number(s.stationId.replace('table', '')), s]));   // by station (table1 sits at seat 2)
  assert.equal(m.seats.length, 16);
  assert.equal(by[1].state, 'filling');
  assert.equal(by[1].met, true, '1.2 lb of a 1.10 lb goal');
  assert.equal(by[2].state, 'ready');
  assert.ok(by[2].frac > 0.3 && by[2].frac < 0.4);
  assert.equal(by[3].state, 'down');
  assert.equal(by[4].state, 'empty');
  assert.equal(by[4].name, 'Beto', 'the last name seen today at an idle seat');
  const svg = floorSvg(m, { lang: 'en' });
  assert.equal((svg.match(/data-station="table/g) || []).length, 16);
  assert.match(svg, />Diego</, 'first name on the floor');
  assert.match(svg, /Ready for pickup/);
  assert.match(svg, /seat filling met/);
  assert.match(floorSvg(m, { lang: 'es' }), /Lista para recoger/);
});

test('the station-to-seat map: table1 (built for Cell 1) is at seat 2, where Diego trims', async () => {
  const { seatOf, stationAt } = await import('../src/js/cell/seats.mjs');
  assert.equal(seatOf('table1'), 2);
  assert.equal(seatOf('table2'), 1);
  assert.equal(seatOf('table7'), 7);
  assert.equal(stationAt(2), 'table1');
  assert.equal(stationAt(1), 'table2');
  assert.equal(stationAt(9), 'table9');
  const m = floorModel([{ stationId: 'table1', scale: { live: true }, job: { phase: 'running', tabletOnline: true } }],
    [{ stationId: 'table1', personId: 5, name: 'Diego', g: 300, min: 30 }], {}, 1.1, '2-3');
  const seat2 = m.seats.find((s) => s.n === 2);
  assert.equal(seat2.stationId, 'table1');
  assert.equal(seat2.name, 'Diego');
  assert.equal(seat2.state, 'filling');
  assert.equal(m.seats.find((s) => s.n === 1).state, 'empty');
});
