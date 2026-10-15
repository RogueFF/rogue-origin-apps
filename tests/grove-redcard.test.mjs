/**
 * Grove red ORDER card: makeLaneKit + scanCard through the real router, on the
 * in-memory D1 stand-in. No mail transport is configured in the fake env, so
 * notifyReorderHandler's send throws and is recorded as notify_state 'failed'.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeEnv, call } from './helpers/fake-d1.mjs';

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

test('makeLaneKit makes a 10-char base32 token and retires the previous red card', async () => {
  const env = fakeEnv();
  const a = await call(env, 'makeLaneKit', { cardId: 21 });
  assert.match(a.redCard.token, /^[a-z2-7]{10}$/);
  assert.match(a.redCard.url, new RegExp(`/k/${a.redCard.token}$`));
  assert.equal(a.card.id, 21);
  assert.equal(a.lane.redCard.token, a.redCard.token);
  const b = await call(env, 'makeLaneKit', { cardId: 21 });
  assert.notEqual(b.redCard.token, a.redCard.token);
  const rows = env.db.prepare(`SELECT token, retired, created_at FROM kanban_bin_cards WHERE card_id = 21 ORDER BY id`).all();
  assert.deepEqual(rows.map(r => [r.token, r.retired]), [[a.redCard.token, 1], [b.redCard.token, 0]]);
  assert.match(rows[1].created_at, ISO);
  assert.equal(b.lane.redCard.token, b.redCard.token);
});

test('makeLaneKit: unknown card / no lane config are 404', async () => {
  const env = fakeEnv();
  await assert.rejects(call(env, 'makeLaneKit', { cardId: 12345 }), (e) => e.code === 'NOT_FOUND');
  await assert.rejects(call(env, 'makeLaneKit', { cardId: 7 }), (e) => e.code === 'NOT_FOUND');
  await assert.rejects(call(env, 'makeLaneKit', { cardId: 'x' }), (e) => e.code === 'VALIDATION_ERROR');
});

test('scanCard: red event with ISO at, lane flips to order, request created then already_open', async () => {
  const env = fakeEnv();
  // A deep, older baseline: the lane is 'ok' on stock alone, so only the red scan can make it 'order'.
  await call(env, 'recount', { cardId: 21, sealedBins: 100 });
  env.db.exec(`UPDATE kanban_baselines SET at = '${new Date(Date.now() - 3600e3).toISOString()}'`);
  const { redCard } = await call(env, 'makeLaneKit', { cardId: 21 });
  assert.equal((await call(env, 'getBinStatus&cardId=21')).lanes[0].status, 'ok');

  const r = await call(env, 'scanCard', { token: redCard.token, by: 'Nico' });
  assert.equal(r.lane.status, 'order');
  assert.equal(r.request.outcome, 'created');
  const ev = env.db.prepare(`SELECT kind, bin_card, by, at FROM kanban_bin_events WHERE kind = 'red'`).all();
  assert.equal(ev.length, 1);
  assert.equal(ev[0].by, 'Nico');
  assert.match(ev[0].at, ISO);
  assert.equal(env.db.prepare(`SELECT notify_state FROM kanban_reorder_requests`).get().notify_state, 'failed');

  const again = await call(env, 'scanCard', { token: redCard.token.toUpperCase() });
  assert.equal(again.request.outcome, 'already_open');
  assert.equal(again.request.id, r.request.id);
  assert.equal(env.db.prepare(`SELECT COUNT(*) AS n FROM kanban_reorder_requests`).get().n, 1);
});

test('scanCard: retired token is 400, unknown or garbage token is 404', async () => {
  const env = fakeEnv();
  const old = (await call(env, 'makeLaneKit', { cardId: 21 })).redCard.token;
  await call(env, 'makeLaneKit', { cardId: 21 });
  await assert.rejects(call(env, 'scanCard', { token: old }), (e) => e.code === 'VALIDATION_ERROR' && /replaced/.test(e.message));
  await assert.rejects(call(env, 'scanCard', { token: 'aaaaaaaaaa' }), (e) => e.code === 'NOT_FOUND');
  await assert.rejects(call(env, 'scanCard', { token: '<script>' }), (e) => e.code === 'NOT_FOUND');
  await assert.rejects(call(env, 'scanCard', {}), (e) => e.code === 'NOT_FOUND');
  assert.equal(env.db.prepare(`SELECT COUNT(*) AS n FROM kanban_bin_events`).get().n, 0);
});

test('scanCard: request rows carry an ISO requested_at; a rescan reports retried', async () => {
  const env = fakeEnv();
  const { redCard } = await call(env, 'makeLaneKit', { cardId: 21 });
  const r = await call(env, 'scanCard', { token: redCard.token });
  assert.match(r.request.requestedAt, ISO);
  assert.match(env.db.prepare(`SELECT requested_at FROM kanban_reorder_requests`).get().requested_at, ISO);
  // First send failed (no transport), so the rescan re-sends.
  assert.equal((await call(env, 'scanCard', { token: redCard.token })).request.retried, true);
  env.db.exec(`UPDATE kanban_reorder_requests SET notify_state = 'sent'`);
  assert.equal((await call(env, 'scanCard', { token: redCard.token })).request.retried, false);
});

test('scanCard: a request that cannot be raised leaves no orphan red event', async () => {
  const env = fakeEnv();
  const { redCard } = await call(env, 'makeLaneKit', { cardId: 21 });
  env.db.exec('DROP TABLE kanban_reorder_requests');
  await assert.rejects(call(env, 'scanCard', { token: redCard.token }));
  assert.equal(env.db.prepare(`SELECT COUNT(*) AS n FROM kanban_bin_events`).get().n, 0);
});

test('addToCart on a Grove card still answers over HTTP with the reorder_request shape', async () => {
  const env = fakeEnv();
  const r = await call(env, 'addToCart', { cardId: 21 });
  assert.equal(r.mode, 'reorder_request');
  assert.equal(r.request.outcome, 'created');
  assert.equal((await call(env, 'addToCart', { cardId: 21 })).request.outcome, 'already_open');
});
