/**
 * Re-scanning the red ORDER card while its request is open records the
 * delivery (SOP-024 step 6, Koa 2026-10-22: "when they re-scan the ordered
 * card it triggers an inventory add … the option to add how many cases arrived").
 * Through the real router on the fake D1. Run with `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeEnv, call } from './helpers/fake-d1.mjs';

/** Lane 21 with 6 bins on the rack, a red card, and that card scanned once (request open, mail fails harmlessly). */
async function orderedLane() {
  const env = fakeEnv();
  await call(env, 'recount', { cardId: 21, sealedBins: 6 });
  const { redCard } = await call(env, 'makeLaneKit', { cardId: 21 });
  await call(env, 'scanCard', { token: redCard.token, by: 'Nico' });
  return { env, token: redCard.token };
}

test('cardState: read-only — reports the lane and its open request, writes nothing', async () => {
  const { env, token } = await orderedLane();
  const events = env.db.prepare('SELECT COUNT(*) AS n FROM kanban_bin_events').get().n;
  const r = await call(env, `cardState&token=${token.toUpperCase()}`);
  assert.equal(r.success, true);
  assert.equal(r.lane.cardId, 21);
  assert.ok(r.openRequest && r.openRequest.id, 'open request reported');
  assert.equal(r.lane.config.bagsPerBox, 100);
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM kanban_bin_events').get().n, events);
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM kanban_reorder_requests').get().n, 1);
});

test('cardState: no open request → openRequest null; unknown token 404; retired card 400', async () => {
  const env = fakeEnv();
  const { redCard } = await call(env, 'makeLaneKit', { cardId: 21 });
  assert.equal((await call(env, `cardState&token=${redCard.token}`)).openRequest, null);
  await assert.rejects(call(env, 'cardState&token=aaaaaaaaaa'), (e) => e.code === 'NOT_FOUND');
  await call(env, 'makeLaneKit', { cardId: 21 });                        // retires the first card
  await assert.rejects(call(env, `cardState&token=${redCard.token}`), (e) => e.code === 'VALIDATION_ERROR' && /replaced/.test(e.message));
});

test('receiveFromCard: cases arrive → baseline = bins on the rack × 50 + boxes × 100, request closed, event by card', async () => {
  const { env, token } = await orderedLane();
  const r = await call(env, 'receiveFromCard', { token, boxes: 3, leftoverBins: 2 });
  assert.equal(r.success, true);
  assert.equal(r.lane.baseline.bags, 2 * 50 + 3 * 100);
  assert.equal(r.lane.baseline.reason, 'receive');
  assert.equal(r.lane.openRequest, null);
  assert.equal(env.db.prepare('SELECT status FROM kanban_reorder_requests').get().status, 'ordered');
  const ev = env.db.prepare(`SELECT by, note FROM kanban_bin_events WHERE kind = 'receive'`).get();
  assert.equal(ev.by, 'card');
  assert.match(ev.note, /3 boxes/);
});

test('receiveFromCard: leftoverBins omitted → the lane keeps its current bins', async () => {
  const { env, token } = await orderedLane();                            // the recount put 6 bins on the rack
  const r = await call(env, 'receiveFromCard', { token, boxes: 3 });
  assert.equal(r.lane.baseline.bags, 6 * 50 + 300);
  assert.equal(r.needsRecount, false);
});

test('receiveFromCard: boxes must be a whole number ≥ 1; bad tokens are 404', async () => {
  const { env, token } = await orderedLane();
  for (const boxes of [0, -1, 1.5, 'x', undefined]) {
    await assert.rejects(call(env, 'receiveFromCard', { token, boxes }), (e) => e.code === 'VALIDATION_ERROR', `boxes=${boxes}`);
  }
  await assert.rejects(call(env, 'receiveFromCard', { token: 'aaaaaaaaaa', boxes: 3 }), (e) => e.code === 'NOT_FOUND');
});

test('receiveFromCard works with no open request too (a hand-placed order landing)', async () => {
  const env = fakeEnv();
  const { redCard } = await call(env, 'makeLaneKit', { cardId: 21 });
  const r = await call(env, 'receiveFromCard', { token: redCard.token, boxes: 6, leftoverBins: 0 });
  assert.equal(r.lane.baseline.bags, 600);
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM kanban_orders').get().n, 0);
});
