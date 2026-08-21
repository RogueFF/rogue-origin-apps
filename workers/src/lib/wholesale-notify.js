/**
 * What the board has to say, and when to say it.
 *
 * Pure: given the queue, the status changes the cron just made, and a record of
 * what has already been announced, it returns the messages that are new. No
 * database, no network, no clock of its own — so the awkward part, deciding
 * whether something is worth waking somebody's phone for, is unit-testable.
 *
 * THE HARD PART IS NOT SENDING, IT IS NOT RE-SENDING. The cron runs every five
 * minutes and recomputes everything from scratch, so "Berry Bliss has started"
 * is true on every tick for the next two weeks. Each event therefore carries a
 * `rule` and a `key`, and the caller keeps them in `alerts_sent`, whose
 * UNIQUE(rule, dedup_key) is what actually stops the repeat. That table already
 * exists for the machine-telemetry alerts and works the same way here.
 *
 * The one event that is not once-and-done is a slipping date: it should speak
 * again when it slips FURTHER, so it carries the date it reported and compares
 * against the last one rather than against nothing.
 */

/** A day of slip below which nobody needs telling. */
const SLIP_DAYS = 1;

/** What to call an order in a message: what the floor calls it, else its number. */
export function orderLabel(order) {
  return order?.nickname || order?.shopifyOrderName || order?.id || 'order';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-09-09' -> 'Wed Sep 9'. Parsed as parts; never through local Date parsing. */
export function shortDate(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${dow} ${MONTHS[m - 1]} ${d}`;
}

/** Whole days between two 'YYYY-MM-DD' strings, b - a. */
function daysBetween(a, b) {
  const p = (s) => { const [y, m, d] = String(s).split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / 86400000);
}

const fmt = (n) => `${Math.round(n).toLocaleString('en-US')} lb`;

/**
 * @param blocks   scheduled blocks, each with passes and per-line progress
 * @param orders   every order, for labels and for what left the queue
 * @param moved    [{ id, from, to }] status changes the cron just applied
 * @param sent     Map of `${rule}:${key}` -> parsed metadata, from alerts_sent
 * @param today    'YYYY-MM-DD' in Pacific. Passed in, not read from a clock —
 *                 this file has no timezone behaviour to get wrong.
 * @returns [{ rule, key, text, meta }] — only what has not been said before
 */
export function deriveEvents({ blocks = [], orders = [], moved = [], sent = new Map(), today }) {
  const byId = new Map(orders.map(o => [o.id, o]));
  const out = [];
  const seen = new Set();

  const push = (rule, key, text, meta) => {
    const id = `${rule}:${key}`;
    // `seen` guards against one run producing the same event twice, which the
    // database's unique index would reject rather than ignore.
    if (sent.has(id) || seen.has(id)) return;
    seen.add(id);
    out.push({ rule, key, text, meta });
  };

  // --- what the status sync just changed -----------------------------------

  for (const m of moved) {
    const label = orderLabel(byId.get(m.id));
    if (m.to === 'in_production') {
      push('order_started', m.id, `▶️ Started *${label}*.`);
    }
    if (m.to === 'finished') {
      const o = byId.get(m.id);
      const total = o ? fmt(o.totalLbs) : '';
      push('order_finished', m.id, `🎉 *${label}* is finished${total ? ` — ${total}` : ''}.`);
    }
  }

  // --- what the floor is doing, strain by strain ---------------------------

  blocks.forEach((block, bi) => {
    const label = orderLabel(byId.get(block.orderId));

    block.passes.forEach((pass, pi) => {
      const done = pass.lines.reduce((s, l) => s + l.doneLbs, 0);
      const total = pass.lines.reduce((s, l) => s + l.qtyLbs, 0);
      const key = `${block.orderId}:${pass.cultivarId}`;

      if (done > 0) {
        push('strain_started', key,
          `▶️ Now trimming *${pass.cultivarName}* for ${label} — ${fmt(total)}.`);
      }

      // Complete means every line of the pass, not just the binding one: tops
      // can be filled while smalls are still coming off the same lot.
      if (total > 0 && pass.lines.every(l => l.pct >= 1)) {
        const next = block.passes[pi + 1]?.cultivarName
          || blocks[bi + 1]?.passes[0]?.cultivarName;
        push('strain_finished', key,
          `✅ *${pass.cultivarName}* done for ${label}${next ? `. Next up: *${next}*` : ''}.`);
      }
    });

    // --- a date that has moved the wrong way -------------------------------

    const slipKey = block.orderId;
    const prior = sent.get(`promise_date:${slipKey}`)?.finish;
    const now = block.finish.date;
    if (prior && daysBetween(prior, now) >= SLIP_DAYS) {
      // Not deduped on the order alone — a further slip is news again, so the
      // key carries the date being reported.
      push('running_behind', `${slipKey}:${now}`,
        `⚠️ *${label}* slipped to ${shortDate(now)} — was ${shortDate(prior)}.`,
        { finish: now });
    }
    // Always record where the date stands, whether or not anything was said.
    out.push({ rule: 'promise_date', key: slipKey, text: null, meta: { finish: now }, silent: true });
  });

  // --- nothing left to run -------------------------------------------------

  if (!blocks.length) {
    // Keyed by day so it can be said again the next time the floor clears,
    // rather than once and never.
    push('queue_clear', today, '📭 Queue is clear — no wholesale orders waiting.');
  }

  return out;
}
