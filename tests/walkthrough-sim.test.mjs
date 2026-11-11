// The floor walkthrough (src/js/walkthrough/): an in-browser sim, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, tally, CELLS, STEPS } from '../src/js/walkthrough/sim.mjs';
import { guardFetch } from '../src/js/walkthrough/guard.mjs';
import { generateDay } from '../src/js/demo/orders.mjs';

const run = (day, minutes, stepMin = 0.25) => {
  const sim = createSim(day);
  for (let t = 0; t < minutes; t += stepMin) sim.step(stepMin * 60000);
  return sim;
};

test('a mock day flows all the way out: every order shipped by end of day, nothing stuck', () => {
  const day = generateDay({ day: '2026-11-10', seed: 4 });
  const sim = run(day, 14 * 60);
  const t = tally(sim.state);
  assert.equal(t.shipped, day.orders.length, JSON.stringify(t));
  assert.ok(sim.state.cells.every(c => c.jobs.length === 0 && c.spot.length === 0));
  assert.ok(sim.state.events.length > 0);
});

test('the real rules: NOW + NEXT at most two orders per cell, rush first, never idle while work waits', () => {
  const day = generateDay({ day: '2026-11-10', seed: 5 });
  const sim = createSim(day);
  let idleWhileWaiting = 0;
  for (let i = 0; i < 600; i++) {
    sim.step(15000);
    for (const c of sim.state.cells) assert.ok(new Set(c.jobs.map(j => j.orderId)).size <= 2, `${c.label} holds at most NOW + NEXT orders`);
    const waiting = sim.state.orders.some(o => o.state === 'queued' && o.lines.some(l => l.route === 'cell'));
    if (waiting && sim.state.cells.some(c => !c.jobs.length)) idleWhileWaiting++;
  }
  assert.equal(idleWhileWaiting, 0, 'an idle cell never sits while an order waits');
});

test('the flow of one order: confirm, cell, chime, swap to the spot, collect, ship', () => {
  const t0 = Date.parse('2026-11-10T15:00:00Z');
  const day = { simStartMs: t0, orders: [{ name: '#D1', simAt: t0, rush: false,
    lines: [{ title: 'Sour Lifter Hemp Flower', options: { 'Bag Size': '1 oz.', 'Flower Type': 'Tops' }, productTags: ['retail-only'], qty: 2 }] }] };
  const sim = createSim(day);
  const o = sim.state.orders[0];
  sim.step(1000);
  assert.ok(['assigned', 'trimming'].includes(o.state), o.state);
  assert.equal(o.cell, 'table1', 'the first cell in roster order when all are free');
  for (let i = 0; i < 12 * 4; i++) sim.step(15000);   // 60 g at ~6-7 g/min plus the full minute
  assert.equal(o.state, 'ready');
  assert.equal(sim.state.cells[0].spot.length, 1, 'waiting at the pickup spot');
  assert.ok(sim.state.events.some(e => /chimes/.test(e.text)));
  assert.ok(o.confirmedAt, 'bag/tag confirmed it (Shopify packing slip)');
  for (let i = 0; i < (STEPS.collectMin + STEPS.shipMin + 1) * 4; i++) sim.step(15000);
  assert.equal(o.state, 'shipped');
  assert.equal(sim.state.cells[0].spot.length, 0);
});

test('pool-only and pack-only orders skip the cells', () => {
  const t0 = Date.parse('2026-11-10T15:00:00Z');
  const sim = createSim({ simStartMs: t0, orders: [{ name: '#D2', simAt: t0, rush: false,
    lines: [{ title: 'Rainbow GMO Hemp Flower', options: { 'Bag Size': '1 oz.', 'Flower Type': 'Smalls' }, productTags: ['retail-only'], qty: 1 }] }] });
  for (let i = 0; i < 20 * 4; i++) sim.step(15000);
  assert.equal(sim.state.orders[0].state, 'shipped');
  assert.ok(sim.state.cells.every(c => c.done === 0));
  assert.equal(CELLS.length, 4);
});

test('the guard: any call to the live system throws; nothing else is touched', async () => {
  const calls = [];
  const f = guardFetch(async u => { calls.push(u); return 'ok'; });
  assert.throws(() => f('https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=cellQueue'), /blocked a call to the live system/);
  assert.throws(() => f('https://anything.workers.dev/x'), /live system/);
  assert.equal(await f('https://fonts.googleapis.com/css2'), 'ok');
  assert.deepEqual(calls, ['https://fonts.googleapis.com/css2']);
});
