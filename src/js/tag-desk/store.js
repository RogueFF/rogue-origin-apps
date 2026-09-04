/**
 * Tag & Desk — desk memory (this device).
 *
 * The lifecycle state that has no D1 tables yet lives here: receipts with
 * per-item receiving, push-offs, red-card acknowledgements, Grove "ordered
 * with Damon" and bins, print state, per-card preferences, hidden cards and
 * level-change dates. Phase A moves these server-side; the page says so in
 * its footer. Everything is plain JSON under one key.
 */
const KEY = 'ro-tagdesk-v1';

/** Level-change dates known from the wiki (uline-reorder-cadence, sticker-stocking, box resize). */
const LEVELS_CHANGED_SEED = {
  29: '2026-07-17', 25: '2026-07-17', 112: '2026-07-17', 114: '2026-07-17', 58: '2026-07-17',
  100: '2026-06-15', 101: '2026-06-15', 102: '2026-06-15',
  57: '2026-06-09', 59: '2026-06-09', 60: '2026-06-09', 61: '2026-06-09', 49: '2026-06-09', 30: '2026-06-09', 22: '2026-06-09', 23: '2026-06-09',
};

export function defaults() {
  return {
    v: 1,
    receipts: {},      // vendor → { orderId, whenISO, expected, est, n, qtys:{id:qty}, open:[ids], short:[ids], restore:[[id,qty]] }
    undone: {},        // orderId → true (kanban_orders row that Undo re-added to the cart)
    received: {},      // cardId → ISO day
    backorder: {},     // cardId → { at, vendor }
    dismissed: {},     // cardId → ISO day it comes back
    outAck: {},        // cartId → true (red-card alarm cleared on this desk)
    nudged: {},        // cardId → ISO day Damon was asked again
    groveOrdered: {},  // cardId → { at, expected }
    bins: {},          // cardId → { total, sealed, perBin, at, lot }
    printed: {},       // cardId → ISO timestamp last printed from this page
    prefs: {},         // cardId → { unit, printFmt }
    archived: [],      // cardIds hidden on this desk
    levelsChanged: { ...LEVELS_CHANGED_SEED },
    outLog: {},        // cardId → count of red-card scans seen
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const d = defaults(); const s = JSON.parse(raw);
    for (const k of Object.keys(d)) if (s[k] !== undefined) d[k] = s[k];
    d.levelsChanged = { ...LEVELS_CHANGED_SEED, ...(s.levelsChanged || {}) };
    return d;
  } catch { return defaults(); }
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: desk memory is per session */ }
}
