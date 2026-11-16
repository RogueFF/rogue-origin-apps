/**
 * Held entries: saves made with no signal wait here and are sent, oldest first,
 * when the signal is back. Each body keeps its client_key, so a resend after a
 * lost response cannot double-save. Stage 1 keeps them in localStorage (key
 * consign_held_v1) instead of IndexedDB; entries are a few hundred bytes.
 *
 * Written against a storage object and a sender so tests/consign-queue.test.mjs
 * can run it without a browser.
 */
export function makeQueue({ storage, send, key = 'consign_held_v1' }) {
  const read = () => { try { return JSON.parse(storage.getItem(key) || '[]'); } catch { return []; } };
  const write = (rows) => { try { storage.setItem(key, JSON.stringify(rows)); return true; } catch { return false; } };
  return {
    list: read,
    /** Returns false when the entry could not be kept (storage full or blocked). */
    hold(action, body) {
      const rows = read();
      rows.push({ action, body, held_at: Date.now() });
      return write(rows);
    },
    /**
     * Send held entries oldest first. Stops at the first network failure, leaving
     * that entry at the head. Drops entries the server refuses and returns them.
     */
    async flush() {
      const rejected = [];
      let rows = read();
      while (rows.length) {
        const [head, ...rest] = rows;
        try {
          await send(head.action, head.body);
        } catch (e) {
          if (e && e.network) break; // keep head (and everything after it) held
          rejected.push({ ...head, error: String((e && e.message) || e) });
        }
        rows = rest;
        write(rows);
      }
      return { left: read().length, rejected };
    },
  };
}
