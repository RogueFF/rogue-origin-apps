/**
 * The autosave loop: debounce, one send at a time, nothing dropped.
 *
 * The legacy page guarded its save with `if (isSaving) return` (index.js:1553),
 * so any edit made while a request was in the air was thrown away with no state
 * change and no error — the form said "Saved" over a value the server had never
 * seen. Here an edit during an in-flight send is queued instead: the send loop
 * re-checks the pending map after every settle, and the newest `getPayload` for
 * a key wins.
 *
 * `send` is the single transport seam. Phase 2's offline outbox wraps it — it
 * takes a payload and returns a promise, and nothing else in this module knows
 * how a save reaches the network, which is what keeps the outbox a wrapper
 * rather than a rewrite.
 */

/**
 * @param {object} opts
 * @param {(payload: object) => Promise<any>} opts.send transport; rejects to fail the save
 * @param {(s: {state: 'saving'|'saved'|'error', key: string, at: Date, message?: string}) => void} [opts.onState]
 * @param {number} [opts.debounceMs]
 * @param {() => Date} [opts.now]
 * @param {typeof setTimeout} [opts.setTimer]
 * @param {typeof clearTimeout} [opts.clearTimer]
 */
export function createSaver({
  send,
  onState,
  debounceMs = 1000,
  now = () => new Date(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  /** key -> { getPayload, seq }. A key stays here until its own payload lands. */
  const pending = new Map();
  /** Keys whose last attempt failed; they wait for retry() rather than spinning. */
  const failed = new Set();

  let seq = 0;
  let timer = null;
  let running = null;
  let destroyed = false;

  const emit = (state) => {
    if (!onState) return;
    // A throwing listener must not fail the save that reported to it.
    try {
      onState(state);
    } catch (err) {
      console.error('floor/save onState:', err);
    }
  };

  const cancelTimer = () => {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  };

  const nextKey = () => {
    for (const key of pending.keys()) {
      if (!failed.has(key)) return key;
    }
    return null;
  };

  async function sendOne(key) {
    const entry = pending.get(key);
    emit({ state: 'saving', key, at: now() });

    try {
      const payload = entry.getPayload();
      await send(payload);
      if (destroyed) return;
      // Only clear the key if it still holds the intent we just sent. A
      // schedule that landed mid-flight replaced the entry, and dropping it
      // here would lose the newer edit exactly the way the legacy guard did.
      // The token is a sequence number rather than the function's identity: a
      // caller passing a stable reference (`schedule(key, editor.payload)`)
      // would look unchanged and have its mid-flight edit dropped.
      if (pending.get(key)?.seq === entry.seq) pending.delete(key);
      failed.delete(key);
      emit({ state: 'saved', key, at: now() });
    } catch (err) {
      if (destroyed) return;
      failed.add(key);
      emit({ state: 'error', key, at: now(), message: err?.message || 'Save failed' });
    }
  }

  /**
   * Send pending keys one at a time until none is sendable. Re-entrant calls
   * join the running loop rather than starting a second one, so there is never
   * more than one request in the air.
   */
  function drain() {
    if (running) return running;

    // The loop body starts in a microtask, not inline. An async IIFE with an
    // empty queue completes synchronously, so its finally cleared `running`
    // before the assignment below had happened — and every later drain joined
    // that settled promise forever. An Enter on an unchanged field was enough
    // to trip it, after which nothing was ever sent again.
    running = Promise.resolve().then(async () => {
      try {
        for (;;) {
          if (destroyed) break;
          const key = nextKey();
          if (!key) break;
          await sendOne(key);
        }
      } finally {
        running = null;
      }
    });

    return running;
  }

  return {
    /** Debounce an edit. `getPayload` runs at send time so the freshest form goes out. */
    schedule(key, getPayload) {
      if (destroyed) return;
      pending.set(key, { getPayload, seq: ++seq });
      // A fresh edit deserves a fresh attempt, even on a key that just failed.
      failed.delete(key);
      cancelTimer();
      timer = setTimer(() => {
        timer = null;
        drain();
      }, debounceMs);
    },

    /** Send now. Resolves when the send it caused settles; never rejects. */
    flush() {
      if (destroyed) return Promise.resolve();
      cancelTimer();
      return drain();
    },

    /** Re-attempt everything that failed. */
    retry() {
      if (destroyed) return Promise.resolve();
      failed.clear();
      cancelTimer();
      return drain();
    },

    /** Unsaved: queued, in flight, or failed. */
    isPending(key) {
      return pending.has(key);
    },

    pendingKeys() {
      return [...pending.keys()];
    },

    destroy() {
      destroyed = true;
      cancelTimer();
      pending.clear();
      failed.clear();
    },
  };
}
