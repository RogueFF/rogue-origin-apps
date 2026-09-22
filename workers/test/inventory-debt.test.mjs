import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IN_FLIGHT, inFlight, classifyDebt, summariseDebts, DEBT_SQL } from '../src/lib/inventory-debt.js';

// ---------------------------------------------------------------------------
// classifyDebt — the three states have to stay apart, because what the row says
// is the only way to tell later what Shopify actually holds
// ---------------------------------------------------------------------------

test('a voided tag Shopify still counts owes -1', () => {
  const d = classifyDebt({ sack_id: 'A', voided_at: '2026-09-22', shopify_added_at: '2026-09-22', shopify_add_error: null });
  assert.equal(d.owes, -1);
});

test('a printed tag that never reached Shopify owes +1', () => {
  const d = classifyDebt({ sack_id: 'A', voided_at: null, shopify_added_at: null, shopify_add_error: 'HTTP 500' });
  assert.equal(d.owes, 1);
});

test('an answered failure is "failed" — safe to retry', () => {
  const d = classifyDebt({ sack_id: 'A', voided_at: null, shopify_added_at: null, shopify_add_error: 'HTTP 500' });
  assert.equal(d.state, 'failed');
});

test('a call that started and never answered is "unknown" — NOT safe to retry', () => {
  const d = classifyDebt({ sack_id: 'A', voided_at: null, shopify_added_at: null, shopify_add_error: inFlight('add') });
  assert.equal(
    d.state, 'unknown',
    'the script may have applied the change and failed on the way back; replaying doubles it',
  );
});

test('the in-flight marker is recognised by its prefix, not an exact string', () => {
  const d = classifyDebt({ sack_id: 'A', voided_at: null, shopify_added_at: null,
    shopify_add_error: `${IN_FLIGHT}2026-09-22T17:55:57.000Z (void rollback)` });
  assert.equal(d.state, 'unknown');
});

// ---------------------------------------------------------------------------
// summariseDebts — what a screen shows at a glance
// ---------------------------------------------------------------------------

test('a clean board summarises to nothing owed and nothing to show', () => {
  const s = summariseDebts([]);
  assert.equal(s.total, 0);
  assert.equal(s.show, false);
});

test('any debt at all makes the screen show it', () => {
  const s = summariseDebts([{ sack_id: 'A', voided_at: null, shopify_added_at: null, shopify_add_error: 'HTTP 500' }]);
  assert.equal(s.show, true);
  assert.equal(s.total, 1);
});

test('failed and unknown are counted separately — they need different actions', () => {
  const s = summariseDebts([
    { sack_id: 'A', voided_at: null, shopify_added_at: null, shopify_add_error: 'HTTP 500' },
    { sack_id: 'B', voided_at: null, shopify_added_at: null, shopify_add_error: inFlight('add') },
    { sack_id: 'C', voided_at: '2026-09-22', shopify_added_at: '2026-09-22', shopify_add_error: null },
  ]);
  // Two retryable: the answered failure (A) and the void whose -1 has not been
  // recorded (C). Only B is unknown. "failed" here means "safe to replay",
  // which is the distinction the sweep acts on — not "something errored".
  assert.equal(s.failed, 2);
  assert.equal(s.unknown, 1, 'unknown is the one a human must check in Shopify first');
  assert.equal(s.total, 3);
  assert.equal(s.owedPlus, 2);
  assert.equal(s.owedMinus, 1);
});

test('the summary carries the sack ids, so the screen can name them', () => {
  const s = summariseDebts([{ sack_id: '26-PURPSNOW-7', voided_at: null, shopify_added_at: null, shopify_add_error: 'HTTP 500' }]);
  assert.ok(s.items.some(i => i.sack_id === '26-PURPSNOW-7'));
});

test('the id list is capped so one bad night cannot flood a screen', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({
    sack_id: `S-${i}`, voided_at: null, shopify_added_at: null, shopify_add_error: 'HTTP 500',
  }));
  const s = summariseDebts(many);
  assert.equal(s.total, 200, 'the count stays honest');
  assert.ok(s.items.length <= 20, 'but the list is trimmed');
});

// ---------------------------------------------------------------------------
// One definition of "owed"
// ---------------------------------------------------------------------------

test('DEBT_SQL matches both debts and nothing that is settled', () => {
  assert.match(DEBT_SQL, /voided_at IS NOT NULL AND shopify_added_at IS NOT NULL/);
  assert.match(DEBT_SQL, /voided_at IS NULL AND shopify_added_at IS NULL AND shopify_add_error IS NOT NULL/);
});
