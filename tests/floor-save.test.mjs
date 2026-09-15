/**
 * The autosave loop, pinned — above all the in-flight case.
 *
 * The legacy page dropped any edit made while a save was in the air
 * (index.js:1553) and still showed "Saved", so the floor trusted a number the
 * server had never seen. `a schedule during an in-flight send is sent after it`
 * below is the regression test for that; the rest keep the debounce, the failure
 * bookkeeping and the retry honest.
 *
 * Settling is waited on with a real timer rather than by counting microtasks:
 * the drain chain awaits several times per send, and microtask counting is how
 * these tests go flaky.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createSaver } from '../src/js/floor/save.js';

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fake transport that records what it was handed and can be made to fail. */
function makeSend() {
  const calls = [];
  let fail = null;
  let gate = null;

  const send = (payload) => {
    calls.push(payload);
    if (fail) return Promise.reject(new Error(fail));
    if (gate) return gate.promise;
    return Promise.resolve({ success: true });
  };

  return {
    send,
    calls,
    failWith(message) { fail = message; },
    succeed() { fail = null; },
    /** Hold the next sends open until release() is called. */
    hold() {
      let release;
      const promise = new Promise((resolve) => { release = resolve; });
      gate = { promise, release };
      return () => { gate = null; release({ success: true }); };
    },
  };
}

const KEY = '2026-09-02|9:00 AM – 10:00 AM';
const OTHER = '2026-09-02|10:00 AM – 11:00 AM';

test('two edits inside the debounce window coalesce into one send of the latest form', async () => {
  const t = makeSend();
  // getPayload runs at send time, so the form that goes out is the freshest one
  // rather than a snapshot taken when the key was typed.
  let tops = 1;
  const saver = createSaver({ send: t.send, debounceMs: 5 });

  saver.schedule(KEY, () => ({ tops1: tops }));
  tops = 2;
  saver.schedule(KEY, () => ({ tops1: tops }));
  tops = 7.2;

  assert.equal(saver.isPending(KEY), true, 'unsaved while the debounce is running');
  await settle();

  assert.equal(t.calls.length, 1);
  assert.deepEqual(t.calls[0], { tops1: 7.2 });
  assert.equal(saver.isPending(KEY), false);
  assert.deepEqual(saver.pendingKeys(), []);
  saver.destroy();
});

test('a schedule during an in-flight send is sent after it, not dropped', async () => {
  const t = makeSend();
  const saver = createSaver({ send: t.send, debounceMs: 5 });
  const release = t.hold();

  saver.schedule(KEY, () => ({ tops1: 1 }));
  await settle(15);
  assert.equal(t.calls.length, 1, 'the first send is in the air');

  // This is the legacy bug: the edit below was silently discarded.
  saver.schedule(KEY, () => ({ tops1: 9 }));
  await settle(15);
  assert.equal(t.calls.length, 1, 'still only one request in the air at a time');
  assert.equal(saver.isPending(KEY), true);

  release();
  await settle();

  assert.equal(t.calls.length, 2);
  assert.deepEqual(t.calls[1], { tops1: 9 });
  assert.equal(saver.isPending(KEY), false);
  saver.destroy();
});

test('a mid-flight edit survives a caller that reuses one payload function', async () => {
  // main is free to wire the saver as `schedule(key, editor.payload)` — one
  // stable reference for the life of the page. Deciding whether an edit landed
  // mid-flight by the function's identity would find it unchanged and clear the
  // key, dropping the edit exactly the way the legacy guard did. The saver
  // tokens each schedule instead, so the reference tells it nothing.
  const t = makeSend();
  const saver = createSaver({ send: t.send, debounceMs: 5 });
  const release = t.hold();

  let tops = 1;
  const payload = () => ({ tops1: tops });

  saver.schedule(KEY, payload);
  await settle(15);
  assert.equal(t.calls.length, 1, 'the first send is in the air');

  tops = 9;
  saver.schedule(KEY, payload);
  await settle(15);
  assert.equal(saver.isPending(KEY), true, 'the edit is queued behind the request');

  release();
  await settle();

  assert.equal(t.calls.length, 2, 'the second edit still goes out');
  assert.deepEqual(t.calls[1], { tops1: 9 });
  assert.equal(saver.isPending(KEY), false);
  saver.destroy();
});

test('a second hour queued behind an in-flight send goes out after it', async () => {
  const t = makeSend();
  const saver = createSaver({ send: t.send, debounceMs: 5 });
  const release = t.hold();

  saver.schedule(KEY, () => ({ slot: 1 }));
  await settle(15);
  saver.flush();
  saver.schedule(OTHER, () => ({ slot: 2 }));
  await settle(15);

  assert.equal(t.calls.length, 1);
  assert.deepEqual(saver.pendingKeys(), [KEY, OTHER]);

  release();
  await settle();

  assert.deepEqual(t.calls, [{ slot: 1 }, { slot: 2 }]);
  assert.deepEqual(saver.pendingKeys(), []);
  saver.destroy();
});

test('flush cancels the debounce and sends at once', async () => {
  const t = makeSend();
  const saver = createSaver({ send: t.send, debounceMs: 5000 });

  saver.schedule(KEY, () => ({ tops1: 7.2 }));
  await saver.flush();

  assert.equal(t.calls.length, 1, 'the 5 s debounce was not waited on');
  assert.deepEqual(t.calls[0], { tops1: 7.2 });
  assert.equal(saver.isPending(KEY), false);
  saver.destroy();
});

test('flush with nothing pending is a no-op that still resolves', async () => {
  const t = makeSend();
  const saver = createSaver({ send: t.send, debounceMs: 5 });
  await saver.flush();
  assert.equal(t.calls.length, 0);
  saver.destroy();
});

test('a failure keeps the hour pending and retry clears it', async () => {
  const t = makeSend();
  const states = [];
  const saver = createSaver({
    send: t.send,
    debounceMs: 5,
    onState: (s) => states.push(s),
  });

  t.failWith('Line 1: enter Buckers, Trimmers, or T-Zero');
  saver.schedule(KEY, () => ({ tops1: 7.2 }));
  await settle();

  assert.equal(t.calls.length, 1);
  assert.equal(saver.isPending(KEY), true, 'a failed hour stays unsaved');
  assert.deepEqual(states.map((s) => s.state), ['saving', 'error']);
  assert.equal(states[1].message, 'Line 1: enter Buckers, Trimmers, or T-Zero');
  assert.equal(states[1].key, KEY);

  // A failed key waits rather than spinning: nothing resends on its own.
  await settle();
  assert.equal(t.calls.length, 1);

  t.succeed();
  await saver.retry();

  assert.equal(t.calls.length, 2);
  assert.equal(saver.isPending(KEY), false);
  assert.deepEqual(states.map((s) => s.state), ['saving', 'error', 'saving', 'saved']);
  saver.destroy();
});

test('retry resends every failed hour', async () => {
  const t = makeSend();
  const saver = createSaver({ send: t.send, debounceMs: 5 });

  t.failWith('offline');
  saver.schedule(KEY, () => ({ slot: 1 }));
  await settle();
  saver.schedule(OTHER, () => ({ slot: 2 }));
  await settle();
  assert.deepEqual(saver.pendingKeys(), [KEY, OTHER]);

  t.succeed();
  await saver.retry();
  assert.deepEqual(saver.pendingKeys(), [], 'the strip badge clears for both hours');
  saver.destroy();
});

test('a fresh edit on a failed hour is attempted again without waiting for retry', async () => {
  const t = makeSend();
  const saver = createSaver({ send: t.send, debounceMs: 5 });

  t.failWith('offline');
  saver.schedule(KEY, () => ({ tops1: 1 }));
  await settle();
  assert.equal(saver.isPending(KEY), true);

  t.succeed();
  saver.schedule(KEY, () => ({ tops1: 2 }));
  await settle();

  assert.deepEqual(t.calls[1], { tops1: 2 });
  assert.equal(saver.isPending(KEY), false);
  saver.destroy();
});

test('onState reports the save clock so the footer can read "Saved 9:58 AM"', async () => {
  const t = makeSend();
  const at = new Date(2026, 8, 2, 9, 58, 0);
  const states = [];
  const saver = createSaver({
    send: t.send,
    debounceMs: 5,
    now: () => at,
    onState: (s) => states.push(s),
  });

  saver.schedule(KEY, () => ({}));
  await settle();

  const saved = states.find((s) => s.state === 'saved');
  assert.equal(saved.at, at);
  assert.equal(saved.key, KEY);
  saver.destroy();
});

test('a throwing getPayload fails the save instead of breaking the loop', async () => {
  const t = makeSend();
  const states = [];
  const saver = createSaver({ send: t.send, debounceMs: 5, onState: (s) => states.push(s) });

  saver.schedule(KEY, () => { throw new Error('form is gone'); });
  await settle();

  assert.equal(t.calls.length, 0);
  assert.equal(saver.isPending(KEY), true);
  assert.equal(states.at(-1).state, 'error');
  assert.equal(states.at(-1).message, 'form is gone');
  saver.destroy();
});

test('a throwing onState listener does not fail the save that reported to it', async () => {
  const t = makeSend();
  const saver = createSaver({
    send: t.send,
    debounceMs: 5,
    onState: () => { throw new Error('render blew up'); },
  });

  saver.schedule(KEY, () => ({}));
  await settle();

  assert.equal(t.calls.length, 1);
  assert.equal(saver.isPending(KEY), false);
  saver.destroy();
});

test('the timers are injectable, so the page can be torn down cleanly', async () => {
  const t = makeSend();
  const set = [];
  const cleared = [];
  const saver = createSaver({
    send: t.send,
    debounceMs: 5,
    setTimer: (fn, ms) => { const id = setTimeout(fn, ms); set.push(id); return id; },
    clearTimer: (id) => { cleared.push(id); clearTimeout(id); },
  });

  saver.schedule(KEY, () => ({}));
  saver.schedule(KEY, () => ({}));
  assert.equal(set.length, 2);
  assert.equal(cleared.length, 1, 'the second edit replaces the first debounce');

  saver.destroy();
  await settle();
  assert.equal(t.calls.length, 0, 'destroy cancels the pending debounce');
  assert.deepEqual(saver.pendingKeys(), []);
});

test('destroy during an in-flight send emits nothing further and queues nothing', async () => {
  const t = makeSend();
  const states = [];
  const saver = createSaver({ send: t.send, debounceMs: 5, onState: (s) => states.push(s) });
  const release = t.hold();

  saver.schedule(KEY, () => ({}));
  await settle(15);
  assert.deepEqual(states.map((s) => s.state), ['saving']);

  saver.destroy();
  release();
  await settle();

  assert.deepEqual(states.map((s) => s.state), ['saving'], 'no state after teardown');
  saver.schedule(KEY, () => ({}));
  await settle();
  assert.equal(t.calls.length, 1);
});

test('a flush with nothing pending does not wedge later sends', async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sends = [];
  const saver = createSaver({ send: async (p) => { sends.push(p); }, debounceMs: 5 });
  await saver.flush();
  saver.schedule('k1', () => ({ tops1: 1 }));
  await sleep(40);
  assert.equal(sends.length, 1);
  await saver.flush();
  saver.schedule('k2', () => ({ tops1: 2 }));
  await saver.flush();
  assert.equal(sends.length, 2);
  assert.deepEqual(saver.pendingKeys(), []);
});
