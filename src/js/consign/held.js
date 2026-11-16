/**
 * The page's held-entries queue (queue.mjs over localStorage) plus the list of
 * entries the server refused on resend, kept until someone dismisses them so
 * nothing disappears silently.
 */
import { makeQueue } from './queue.mjs';
import { call } from './api.js';

const REJECTED_KEY = 'consign_rejected_v1';
// localStorage itself can throw (private mode, blocked site data).
const storage = {
  getItem: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => localStorage.setItem(k, v),
};

export function rejectedList() {
  try { return JSON.parse(storage.getItem(REJECTED_KEY) || '[]'); } catch { return []; }
}
function addRejected(row) {
  try { storage.setItem(REJECTED_KEY, JSON.stringify([...rejectedList(), row])); } catch { /* storage blocked */ }
}
export function clearRejected() {
  try { storage.setItem(REJECTED_KEY, '[]'); } catch { /* storage blocked */ }
  changed();
}

// A refused entry is kept in the "not saved" list before it leaves the held list.
export const queue = makeQueue({ storage, send: (action, body) => call(action, body), onReject: addRejected });

/** Put refused entries back in the held list (after the cause is fixed) and send them. */
export function retryRejected() {
  const rows = rejectedList();
  for (const r of rows) queue.hold(r.action, r.body);
  clearRejected();
  return flush();
}

const changed = () => document.dispatchEvent(new CustomEvent('consign:held'));

/** Keep an entry that could not be sent. False when the device could not keep it either. */
export function hold(action, body) {
  const ok = queue.hold(action, body);
  changed();
  return ok;
}

let flushing = null;
/** Send held entries. Resolves {sent, left, rejected}. Safe to call repeatedly. */
export function flush() {
  if (flushing) return flushing;
  const before = queue.list().length;
  flushing = (async () => {
    try {
      if (!before) return { sent: 0, left: 0, rejected: [] };
      const r = await queue.flush();
      return { sent: before - r.left - r.rejected.length, ...r };
    } finally {
      flushing = null;
      changed();
    }
  })();
  return flushing;
}
