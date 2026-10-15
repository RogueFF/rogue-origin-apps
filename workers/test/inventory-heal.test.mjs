import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inFlight } from '../src/lib/inventory-debt.js';
import { decideHeal, debtRange, latestMarkerAt, settleStatement, HEAL_QUIET_MS } from '../src/lib/inventory-heal.js';

const NOW = Date.parse('2026-10-07T22:30:00Z');
const QUIET = NOW - HEAL_QUIET_MS - 1;

const add = (id, err = inFlight('add')) => ({ sack_id: id, voided_at: null, opened_at: null,
  shopify_added_at: null, shopify_add_error: err, shopify_synced_at: null, shopify_sync_error: null });
const voidDebt = (id) => ({ sack_id: id, voided_at: '2026-10-07', opened_at: null,
  shopify_added_at: '2026-10-07', shopify_add_error: null, shopify_synced_at: null, shopify_sync_error: null });
const outDebt = (id) => ({ sack_id: id, voided_at: null, opened_at: '2026-10-07',
  shopify_added_at: '2026-10-07', shopify_add_error: null, shopify_synced_at: null, shopify_sync_error: 'HTTP 500' });

const many = (n, make) => Array.from({ length: n }, (_, i) => make(`26-SLIFT-${i}`));

// ---------------------------------------------------------------------------
// decideHeal
// ---------------------------------------------------------------------------

test('2026-10-07: 30 owed, Shopify 12 short — send the 12, not the 30', () => {
  const d = decideHeal({ drift: 12, debts: many(30, add), lastCallAt: QUIET, now: NOW });
  assert.equal(d.action, 'send');
  assert.equal(d.amount, 12);
});

test('a later quiet tick that sees drift 0 settles every owed row', () => {
  assert.equal(decideHeal({ drift: 0, debts: many(30, add), lastCallAt: QUIET, now: NOW }).action, 'settle');
});

test('everything owed had in fact landed: settle, no call', () => {
  assert.equal(decideHeal({ drift: 0, debts: many(5, add), lastCallAt: QUIET, now: NOW }).action, 'settle');
});

test('a call started inside the quiet window: wait — a late landing would double a heal', () => {
  const d = decideHeal({ drift: 5, debts: many(5, add), lastCallAt: NOW - 3 * 60 * 1000, now: NOW });
  assert.equal(d.action, 'wait');
});

test('even settling waits for quiet: drift 0 now may be a late landing still coming the other way', () => {
  assert.equal(decideHeal({ drift: 0, debts: [voidDebt('A')], lastCallAt: NOW - 60_000, now: NOW }).action, 'wait');
});

test('more short than the owed rows can explain: report, never write', () => {
  const d = decideHeal({ drift: 31, debts: many(30, add), lastCallAt: QUIET, now: NOW });
  assert.equal(d.action, 'report');
});

test('Shopify HIGH while only +1s are owed: report — no debt can explain it', () => {
  assert.equal(decideHeal({ drift: -2, debts: many(3, add), lastCallAt: QUIET, now: NOW }).action, 'report');
});

test('drift with nothing owed is reported, never corrected', () => {
  assert.equal(decideHeal({ drift: 4, debts: [], lastCallAt: QUIET, now: NOW }).action, 'report');
  assert.equal(decideHeal({ drift: 0, debts: [], lastCallAt: QUIET, now: NOW }).action, 'none');
});

test('mixed signs: anything between the sum of the -1s and the sum of the +1s is explained', () => {
  const debts = [add('A'), add('B'), voidDebt('C'), outDebt('D')];
  assert.equal(decideHeal({ drift: -2, debts, lastCallAt: QUIET, now: NOW }).amount, -2);
  assert.equal(decideHeal({ drift: 2, debts, lastCallAt: QUIET, now: NOW }).amount, 2);
  assert.equal(decideHeal({ drift: 3, debts, lastCallAt: QUIET, now: NOW }).action, 'report');
});

test('no variant to compare against: report', () => {
  assert.equal(decideHeal({ drift: null, debts: [add('A')], lastCallAt: QUIET, now: NOW }).action, 'report');
});

test('never stamped (null last call) counts as quiet', () => {
  assert.equal(decideHeal({ drift: 1, debts: [add('A')], lastCallAt: null, now: NOW }).action, 'send');
});

// ---------------------------------------------------------------------------
// debtRange / latestMarkerAt
// ---------------------------------------------------------------------------

test('an add can have done 0 or +1; a void or out 0 or -1', () => {
  assert.deepEqual(debtRange(add('A')), [0, 1]);
  assert.deepEqual(debtRange(voidDebt('A')), [-1, 0]);
  assert.deepEqual(debtRange(outDebt('A')), [-1, 0]);
});

test('an unanswered add on a sack since taken out can only have made Shopify high', () => {
  assert.deepEqual(debtRange({ ...add('A'), opened_at: '2026-10-07' }), [-1, 0]);
});

test('latestMarkerAt reads the newest in-flight stamp in either column', () => {
  const rows = [
    add('A', 'in flight since 2026-10-07T16:32:38.844Z (add)'),
    { ...outDebt('B'), shopify_sync_error: 'in flight since 2026-10-07T18:00:00.000Z (out)' },
    add('C', 'Pool API returned non-JSON'),
  ];
  assert.equal(latestMarkerAt(rows), Date.parse('2026-10-07T18:00:00.000Z'));
  assert.equal(latestMarkerAt([add('C', 'HTTP 500')]), null);
});

// ---------------------------------------------------------------------------
// settleStatement
// ---------------------------------------------------------------------------

test('settling an add marks it counted and is guarded on what was read', () => {
  const row = add('26-SLIFT-243');
  const { sql, params } = settleStatement(row, { variantId: 'gid://v/1', at: 'T' });
  assert.match(sql, /SET shopify_added_at = \?, shopify_add_error = NULL/);
  assert.match(sql, /WHERE sack_id = \? AND opened_at IS \? AND voided_at IS \? AND shopify_added_at IS \? AND shopify_add_error IS \?/);
  assert.deepEqual(params, ['T', 'gid://v/1', '26-SLIFT-243', null, null, null, row.shopify_add_error, null, null]);
});

test('settling a void clears the count it no longer holds', () => {
  const { sql } = settleStatement(voidDebt('A'));
  assert.match(sql, /SET shopify_added_at = NULL, shopify_add_error = NULL, shopify_sync_error = NULL/);
});

test('settling an out marks the -1 synced', () => {
  const { sql, params } = settleStatement(outDebt('A'), { at: 'T' });
  assert.match(sql, /SET shopify_synced_at = \?, shopify_sync_error = NULL/);
  assert.equal(params[0], 'T');
});
