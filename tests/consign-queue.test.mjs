import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeQueue } from '../src/js/consign/queue.mjs';

const fakeStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
};
const netErr = () => Object.assign(new Error('network'), { network: true });

test('hold then list returns the entry; a storage that throws makes hold return false', () => {
  const q = makeQueue({ storage: fakeStorage(), send: async () => {} });
  assert.equal(q.hold('savePayment', { amount: 5, client_key: 'p1' }), true);
  assert.equal(q.list().length, 1);
  assert.equal(q.list()[0].action, 'savePayment');
  const broken = makeQueue({ storage: { getItem: () => null, setItem: () => { throw new Error('full'); } }, send: async () => {} });
  assert.equal(broken.hold('savePayment', {}), false);
});

test('flush sends in order and empties the queue', async () => {
  const sent = [];
  const q = makeQueue({ storage: fakeStorage(), send: async (a, b) => { sent.push(b.client_key); } });
  q.hold('saveDropoff', { client_key: 'a' });
  q.hold('saveScreenRun', { client_key: 'b' });
  const r = await q.flush();
  assert.deepEqual(sent, ['a', 'b']);
  assert.equal(r.left, 0);
  assert.equal(q.list().length, 0);
});

test('a network error on the second entry leaves the second and third held, in order', async () => {
  const sent = [];
  const q = makeQueue({ storage: fakeStorage(), send: async (a, b) => { if (b.client_key === 'b') throw netErr(); sent.push(b.client_key); } });
  q.hold('x', { client_key: 'a' });
  q.hold('x', { client_key: 'b' });
  q.hold('x', { client_key: 'c' });
  const r = await q.flush();
  assert.deepEqual(sent, ['a']);
  assert.equal(r.left, 2);
  assert.deepEqual(q.list().map((e) => e.body.client_key), ['b', 'c']);
});

test('a server rejection drops that entry, reports it, and carries on', async () => {
  const sent = [];
  const q = makeQueue({ storage: fakeStorage(), send: async (a, b) => { if (b.client_key === 'b') throw new Error('Outputs are off by 10 lb'); sent.push(b.client_key); } });
  q.hold('x', { client_key: 'a' });
  q.hold('saveScreenRun', { client_key: 'b' });
  q.hold('x', { client_key: 'c' });
  const r = await q.flush();
  assert.deepEqual(sent, ['a', 'c']);
  assert.equal(r.left, 0);
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0].action, 'saveScreenRun');
  assert.match(r.rejected[0].error, /off by 10/);
});

test('each held body keeps its client_key, so a resend cannot double-save', async () => {
  const keys = [];
  let fail = true;
  const q = makeQueue({ storage: fakeStorage(), send: async (a, b) => { keys.push(b.client_key); if (fail) throw netErr(); } });
  q.hold('saveDropoff', { client_key: 'k-123', lines: [] });
  await q.flush();
  fail = false;
  await q.flush();
  assert.deepEqual(keys, ['k-123', 'k-123']);
  assert.equal(q.list().length, 0);
});

test('an entry held while a flush is running is kept and sent, not overwritten', async () => {
  const sent = [];
  let q;
  q = makeQueue({ storage: fakeStorage(), send: async (a, b) => {
    sent.push(b.client_key);
    if (b.client_key === 'a') q.hold('saveDropoff', { client_key: 'c' }); // signal dropped mid-flush
  } });
  q.hold('x', { client_key: 'a' });
  q.hold('x', { client_key: 'b' });
  const r = await q.flush();
  assert.deepEqual(sent, ['a', 'b', 'c']);
  assert.equal(r.left, 0);
});

test('auth, rate-limit and server errors keep the entry held instead of dropping it', async () => {
  const q = makeQueue({ storage: fakeStorage(), send: async () => { throw Object.assign(new Error('Invalid password'), { retry: true }); } });
  q.hold('saveDropoff', { client_key: 'a' });
  const r = await q.flush();
  assert.equal(r.left, 1);
  assert.equal(r.rejected.length, 0);
});

test('a refused entry is handed to onReject before it leaves the held list', async () => {
  const storage = fakeStorage();
  const seen = [];
  const q = makeQueue({ storage, send: async () => { throw new Error('Unknown farm'); },
    onReject: (row) => seen.push({ row, stillHeld: JSON.parse(storage.getItem('consign_held_v1')).some((r) => r.id === row.id) }) });
  q.hold('saveDropoff', { client_key: 'a' });
  await q.flush();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].stillHeld, true);
  assert.equal(q.list().length, 0);
});
