// Continuous (wholesale) rounds on the cell screen (src/js/cell/rounds.mjs, Koa
// 2026-11-11): no target, never finished, a pickup ends the round and the next
// is ready on the same cultivar; the order is for today only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONT, CONT_BAG, isContinuous, canFinish, roundNo, roundsToday, afterPickup, expireContinuous, endContinuous, queueMayApply,
  changeState, afterChangeover, pickedAfterChangeover, benchGrams,
} from '../src/js/cell/rounds.mjs';
import { applyQueue } from '../src/js/cell/queue.mjs';

const DAY = '2026-11-12';
const cont = (o = {}) => ({ cultivar: '2026 - Sour Lifter / Sungrown', bag: CONT, targetG: 0, phase: 'running', contDay: DAY, ...o });

test('continuous has no target and never finishes, however much is in the basket', () => {
  assert.deepEqual(CONT_BAG, { key: 'cont', g: 0, continuous: true });
  for (const g of [0, 1, 7.5, 460, 2000]) assert.equal(canFinish(cont(), g), false, `${g} g`);
  // A retail job still finishes at its fill standard.
  assert.equal(canFinish({ bag: 'oz1', targetG: 30 }, 29.9), false);
  assert.equal(canFinish({ bag: 'oz1', targetG: 30 }, 30), true);
  // No bag picked (target 0) is never "finished" either.
  assert.equal(canFinish({ bag: '', targetG: 0 }, 5), false);
});

test('a pickup ends the round: the cultivar stays, the round count goes up, ORDER_PER_JOB never clears it', () => {
  const s = cont();
  assert.equal(afterPickup(s, { day: DAY, perJob: true }), 'round');
  assert.deepEqual([s.cultivar, s.bag, s.round, s.roundDay], ['2026 - Sour Lifter / Sungrown', CONT, 1, DAY]);
  assert.equal(roundNo(s, DAY), 2, 'the next round on the scale is round 2');
  // Retail, one order per job: the pickup clears it as before.
  const r = { cultivar: 'x', bag: 'oz1', targetG: 30 };
  assert.equal(afterPickup(r, { day: DAY, perJob: true }), 'cleared');
  assert.deepEqual([r.cultivar, r.bag, r.targetG], ['', '', 0]);
  const k = { cultivar: 'x', bag: 'oz1', targetG: 30 };
  assert.equal(afterPickup(k, { day: DAY, perJob: false }), 'kept');
  assert.equal(k.bag, 'oz1');
});

test('a full day: 13 rounds, each one pickup; the count restarts the next day', () => {
  const s = cont();
  for (let i = 0; i < 13; i++) {
    assert.equal(roundNo(s, DAY), i + 1);
    s.phase = 'running';
    afterPickup(s, { day: DAY, perJob: true });
    s.phase = 'armed';   // main.js armIfReady: the basket is back on the tared scale
    assert.equal(isContinuous(s.bag), true, `still continuous after round ${i + 1}`);
  }
  assert.equal(roundsToday(s, DAY), 13);
  assert.equal(roundsToday(s, '2026-11-13'), 0);
  assert.equal(roundNo(s, '2026-11-13'), 1);
});

test('continuous is for one day: idle or armed on a new day it clears; a round in progress is never touched', () => {
  const armed = cont({ phase: 'armed' });
  assert.equal(expireContinuous(armed, DAY), false, 'same day: stays');
  assert.equal(expireContinuous(armed, '2026-11-13'), true);
  assert.deepEqual([armed.bag, armed.cultivar, armed.phase, armed.basketBack], ['', '', 'idle', true]);
  const running = cont({ phase: 'running' });
  assert.equal(expireContinuous(running, '2026-11-13'), false);
  assert.equal(running.bag, CONT);
  // An order saved before contDay existed gets today's date, not cleared.
  const old = cont({ phase: 'idle', contDay: undefined });
  assert.equal(expireContinuous(old, DAY), false);
  assert.equal(old.contDay, DAY);
  // Retail orders are left alone.
  const retail = { bag: 'oz1', cultivar: 'x', phase: 'idle', contDay: '2026-01-01' };
  assert.equal(expireContinuous(retail, DAY), false);
  assert.equal(retail.bag, 'oz1');
});

test('End continuous between rounds clears the order and keeps the basket ready', () => {
  const s = cont({ phase: 'armed' });
  endContinuous(s);
  assert.deepEqual([s.bag, s.cultivar, s.targetG, s.phase, s.basketBack], ['', '', 0, 'idle', true]);
});

test('the queue never replaces a continuous order; a retail order still takes NOW', () => {
  const NOW = { id: 7, orderName: '#9001', cultivar: '2026 - Lifter / Sungrown', bag: 'oz1', targetG: 120 };
  const s = cont({ phase: 'armed' });
  const changed = queueMayApply(s) && applyQueue(s, NOW, { locked: false });
  assert.equal(changed, false);
  assert.equal(s.bag, CONT);
  const r = { cultivar: '', bag: '', targetG: 0, jobId: null };
  assert.equal(queueMayApply(r) && applyQueue(r, NOW, { locked: false }), 'set');
});

// ---- Change cultivar (Koa 2026-11-11: more than one changeover a day) ----

test('Change cultivar only between rounds: a round trimming says finish it first', () => {
  assert.equal(changeState(cont({ phase: 'armed' })), 'ok');
  assert.equal(changeState(cont({ phase: 'idle' })), 'ok');
  assert.equal(changeState(cont({ phase: 'running' })), 'finishFirst', 'tops in the basket: never mix cultivars');
  assert.equal(changeState(cont({ phase: 'armed', cultivar: '' })), 'hidden', 'no cultivar yet');
  assert.equal(changeState(cont({ phase: 'idle', changeFrom: 'x', cultivar: '' })), 'hidden', 'already changing');
  assert.equal(changeState({ bag: 'oz1', cultivar: 'x', phase: 'armed' }), 'hidden', 'retail: one order per job already');
});

test('a day with 2 changeovers: A -> B -> A, rounds keep their own cultivar and count on', () => {
  const A = '2026 - Sour Lifter / Sungrown', B = '2026 - Lifter / Sungrown';
  const s = cont({ cultivar: A });
  const rounds = [];
  const round = () => { s.phase = 'running'; rounds.push(s.cultivar); afterPickup(s, { day: DAY, perJob: true }); s.phase = 'armed'; };
  round(); round(); round();
  afterChangeover(s, A);                                  // leftover of A weighed
  assert.deepEqual([s.cultivar, s.changeFrom, s.bag, s.phase, s.basketBack], ['', A, CONT, 'idle', true]);
  assert.equal(changeState(s), 'hidden', 'no second Change cultivar mid-changeover');
  s.cultivar = B; assert.equal(pickedAfterChangeover(s), true); assert.equal(s.changeFrom, '');
  s.phase = 'armed'; round(); round();
  afterChangeover(s, B);
  s.cultivar = A; pickedAfterChangeover(s);
  s.phase = 'armed'; round();
  assert.deepEqual(rounds, [A, A, A, B, B, A]);
  assert.equal(roundsToday(s, DAY), 6, 'the round count for the day runs across cultivars');
});

test('bench-scale numbers: lb or g to grams; nothing that is not a weight', () => {
  assert.equal(benchGrams('12.4', 'lb'), 5624.55);
  assert.equal(benchGrams('12,4', 'lb'), 5624.55, 'a comma decimal');
  assert.equal(benchGrams('820', 'g'), 820);
  for (const bad of ['', 'abc', '0', '-3', '0.1']) assert.equal(benchGrams(bad, 'g'), null, bad);
  assert.equal(benchGrams('200', 'lb'), null, 'over 110 lb is a typo');
});
