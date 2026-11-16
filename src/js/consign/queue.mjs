/**
 * Held entries: saves made with no signal wait here and are sent, oldest first,
 * when the signal is back. Each body keeps its client_key, so a resend after a
 * lost response cannot double-save. Stage 1 keeps them in localStorage (key
 * consign_held_v1) instead of IndexedDB; entries are a few hundred bytes.
 *
 * Every step re-reads storage and removes only the entry it just sent, so an
 * entry held while a flush is running is never overwritten.
 *
 * Written against a storage object and a sender so tests/consign-queue.test.mjs
 * can run it without a browser.
 */

/** Errors worth trying again later: no answer, a timeout, auth, rate limit, server trouble. */
export const isRetryable = (e) => !!(e && (e.network || e.retry));

export function makeQueue({ storage, send, key = 'consign_held_v1', onReject = () => {} }) {
  const read = () => { try { return JSON.parse(storage.getItem(key) || '[]'); } catch { return []; } };
  const write = (rows) => { try { storage.setItem(key, JSON.stringify(rows)); return true; } catch { return false; } };
  const newId = () => `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return {
    list: read,
    /** Returns false when the entry could not be kept (storage full or blocked). */
    hold(action, body) {
      const rows = read();
      rows.push({ id: (body && body.client_key) || newId(), action, body, held_at: Date.now() });
      return write(rows);
    },
    /**
     * Send held entries oldest first. Stops at the first retryable failure, leaving
     * that entry where it is. An entry the server refuses is handed to onReject
     * (which must keep it) before it leaves the held list, then reported.
     */
    async flush() {
      const rejected = [];
      const tried = new Set();
      for (;;) {
        const head = read().find((r) => !tried.has(r.id));
        if (!head) break;
        tried.add(head.id);
        try {
          await send(head.action, head.body);
        } catch (e) {
          if (isRetryable(e)) break; // keep it (and everything after it) held
          const row = { ...head, error: String((e && e.message) || e) };
          onReject(row);
          rejected.push(row);
        }
        write(read().filter((r) => r.id !== head.id));
      }
      return { left: read().length, rejected };
    },
  };
}
