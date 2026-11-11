// NOW / NEXT on the cell screen (src/js/cell/queue.mjs, order flow slice 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyQueue, shortCultivar } from '../src/js/cell/queue.mjs';

const NOW = { id: 7, orderName: '#9001', cultivar: '2026 - Sour Lifter / Sungrown', bag: 'oz1', targetG: 120 };
const blank = () => ({ cultivar: '', bag: '', targetG: 0, jobId: null });

test('the NOW job becomes the order, with its basket target (4 x 1 oz = 120 g)', () => {
  const s = blank();
  assert.equal(applyQueue(s, NOW, { locked: false }), 'set');
  assert.deepEqual([s.jobId, s.cultivar, s.bag, s.targetG, s.orderName], [7, NOW.cultivar, 'oz1', 120, '#9001']);
  assert.equal(applyQueue(s, NOW, { locked: false }), null, 'same job: nothing changes');
});

test('never under a running or finished job', () => {
  const s = { ...blank(), jobId: 7, cultivar: 'x', bag: 'oz1', targetG: 120 };
  assert.equal(applyQueue(s, { ...NOW, id: 8 }, { locked: true }), null);
  assert.equal(s.jobId, 7);
});

test('a job just closed here is ignored until the Worker moves on', () => {
  const s = blank();
  assert.equal(applyQueue(s, NOW, { locked: false, closed: new Set([7]) }), null);
  assert.equal(s.jobId, null);
});

test('a job moved away before trimming clears the order; a hand-picked order stays', () => {
  const s = { ...blank(), jobId: 7, cultivar: NOW.cultivar, bag: 'oz1', targetG: 120 };
  assert.equal(applyQueue(s, null, { locked: false }), 'cleared');
  assert.deepEqual([s.jobId, s.cultivar, s.bag, s.targetG], [null, '', '', 0]);
  const hand = { ...blank(), cultivar: 'hand', bag: 'lb1', targetG: 460 };
  assert.equal(applyQueue(hand, null, { locked: false }), null);
  assert.equal(hand.cultivar, 'hand');
});

test('an unknown bag size is never taken', () => {
  const s = blank();
  assert.equal(applyQueue(s, { ...NOW, bag: 'lb10' }, { locked: false, bagOk: k => k !== 'lb10' }), null);
});

test('short cultivar names', () => {
  assert.equal(shortCultivar('2026 - Sour Lifter / Sungrown'), 'Sour Lifter');
  assert.equal(shortCultivar(''), '');
});
