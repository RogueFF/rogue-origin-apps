import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSackPayload, proposeOrder } from '../workers/src/lib/sack-out.js';
import { classifyDebt, IN_FLIGHT } from '../workers/src/lib/inventory-debt.js';

// Stand-in for harvest-d1's normalizeSackId on the shapes these tests use.
const norm = (q) => {
  const m = q.match(/\/s\/([^/?#\s]+)/i); if (m) q = m[1];
  q = q.toUpperCase();
  if (/^\d+$/.test(q)) return { ambiguous: Number(q) };
  const c = q.match(/^([A-Z]+)-?(\d+)$/); if (c) return `26-${c[1]}-${Number(c[2])}`;
  return q;
};

test('parse: tag URL, bare id, code+number', () => {
  assert.deepEqual(parseSackPayload({ q: 'https://x.dev/s/26-SLIFT-151' }, norm, 2026), { id: '26-SLIFT-151' });
  assert.deepEqual(parseSackPayload({ q: '26-SLIFT-151' }, norm, 2026), { id: '26-SLIFT-151' });
  assert.deepEqual(parseSackPayload({ code: 'SLIFT', number: 151 }, norm, 2026), { id: '26-SLIFT-151' });
});

test('parse: a non-tag QR is not_a_tag, a bare number is ambiguous', () => {
  assert.deepEqual(parseSackPayload({ q: 'https://menu.example.com/lunch' }, norm, 2026), { notATag: true });
  assert.deepEqual(parseSackPayload({ q: 'hello world' }, norm, 2026), { notATag: true });
  assert.deepEqual(parseSackPayload({ q: '151' }, norm, 2026), { ambiguous: 151 });
});

test('propose: top-ranked open order still wanting the cultivar; none -> stock', () => {
  const queue = { blocks: [
    { orderId: 'A', passes: [{ cultivarId: 7, remainingTopsLbs: 0, sacksNeeded: 0 }] },
    { orderId: 'B', passes: [{ cultivarId: 7, remainingTopsLbs: 40, sacksNeeded: 14 }] },
    { orderId: 'C', passes: [{ cultivarId: 7, remainingTopsLbs: 10, sacksNeeded: 3 }] },
  ] };
  const r = proposeOrder([7], queue);
  assert.equal(r.proposed.id, 'B');
  assert.deepEqual(r.options.map(o => [o.id, o.sacks_needed]), [['B', 14], ['C', 3]]);
  assert.equal(proposeOrder([9], queue).proposed, null);
});

test('debt: an out whose -1 never answered is an unknown -1 debt', () => {
  const d = classifyDebt({ sack_id: 'x', opened_at: 't', shopify_added_at: 't',
    shopify_synced_at: null, shopify_sync_error: `${IN_FLIGHT}now (out)` });
  assert.equal(d.owes, -1); assert.equal(d.kind, 'out'); assert.equal(d.state, 'unknown');
});
