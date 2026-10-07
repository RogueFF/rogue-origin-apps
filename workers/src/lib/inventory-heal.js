/**
 * Paying inventory debts without a person — the retry queue (Koa, 2026-10-07).
 *
 * The queue is the debt rows themselves (lib/inventory-debt.js). What was
 * missing was something that drains them: the sweep only replays DEFINITE
 * failures and only when somebody calls it, and most debts are not definite.
 * On 2026-10-07, 8 of 78 tag batches never confirmed — 30 tags — and Shopify
 * was only 12 short: 18 of them had landed after the worker stopped listening.
 * Replaying the 30 would have put Shopify 18 high. Replaying is the wrong move.
 *
 * So this never replays a row. It works per variant, on what Shopify HOLDS:
 *
 *   drift = our unopened bags - Shopify's count
 *
 * and corrects drift only when the unsettled rows can explain it. Each owed
 * +1 contributes 0 (it landed) or +1 (it didn't); each owed -1 contributes 0 or
 * -1. A drift inside that range is the debts and nothing else, so sending it is
 * exactly right whichever of them landed. A drift outside it is a question about
 * the physical count and is reported, never written — reconcile's rule, kept.
 *
 * TWO TIMING RULES, both from the 2026-10-07 change log:
 *
 * 1. QUIET FIRST. Google keeps running a call after the worker gives up on it:
 *    a batch marked in flight at 16:37:18 landed after 16:40:18. A heal that
 *    read drift in that gap would have sent a +5 the late call then doubled.
 *    So nothing happens until no inventory call has started for HEAL_QUIET_MS.
 *    During takedown that means the heal waits for a pause; that is fine, the
 *    debts are on the dashboard meanwhile.
 *
 * 2. SETTLE ON OBSERVATION. A sent correction does not settle anything. A later
 *    quiet tick that sees drift 0 settles every row on the variant. If the
 *    correction's own answer is lost, the next tick finds out from Shopify
 *    instead of minting a new unknown.
 */

import { classifyDebt } from './inventory-debt.js';

/** No inventory call for this long before the heal may look. */
export const HEAL_QUIET_MS = 15 * 60 * 1000;

/** harvest_settings key: when the last Super Sack count call started. */
export const LAST_CALL_KEY = 'inventory_last_call';

/** Stamp the start of a count call. Best effort; the markers are the backup. */
export async function stampInventoryCall(db, at = new Date()) {
  if (!db) return;
  try {
    await db.prepare(`
      INSERT INTO harvest_settings (key, value, updated_at, updated_by)
      VALUES (?, ?, datetime('now'), 'inventory')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
    `).bind(LAST_CALL_KEY, at.toISOString()).run();
  } catch (e) {
    console.error('[inventory] stamp failed', e);
  }
}

/** What a debt row can have done to the drift: [lowest, highest]. */
export function debtRange(row) {
  return classifyDebt(row).owes > 0 ? [0, 1] : [-1, 0];
}

/**
 * The whole decision, pure. `debts` are the owed rows on ONE variant.
 *
 *   none    nothing owed and nothing off
 *   report  off, and the debts cannot explain it — a person's question
 *   wait    a call started too recently to trust what Shopify says
 *   settle  Shopify already matches — mark every owed row paid
 *   send    send `amount`, settle on a later tick
 */
export function decideHeal({ drift, debts, lastCallAt, now, quietMs = HEAL_QUIET_MS }) {
  const owed = debts || [];
  if (drift === null || drift === undefined) {
    return owed.length ? { action: 'report', reason: 'no Shopify variant to compare against' } : { action: 'none' };
  }
  if (!owed.length) {
    return drift === 0 ? { action: 'none' } : { action: 'report', reason: `off by ${drift} with nothing owed` };
  }
  if (lastCallAt !== null && lastCallAt !== undefined && now - lastCallAt < quietMs) {
    return { action: 'wait' };
  }
  if (drift === 0) return { action: 'settle' };
  let lo = 0, hi = 0;
  for (const row of owed) {
    const [a, b] = debtRange(row);
    lo += a; hi += b;
  }
  if (drift >= lo && drift <= hi) return { action: 'send', amount: drift, lo, hi };
  return { action: 'report', reason: `off by ${drift}, but the ${owed.length} owed can explain only ${lo}..${hi}` };
}

/** Newest in-flight marker time among the rows, or null. */
export function latestMarkerAt(rows) {
  let latest = null;
  for (const row of rows || []) {
    for (const text of [row.shopify_add_error, row.shopify_sync_error]) {
      const m = /in flight since (\S+)/.exec(String(text || ''));
      const at = m ? Date.parse(m[1]) : NaN;
      if (Number.isFinite(at) && (latest === null || at > latest)) latest = at;
    }
  }
  return latest;
}

const SNAPSHOT = ['opened_at', 'voided_at', 'shopify_added_at', 'shopify_add_error',
  'shopify_synced_at', 'shopify_sync_error'];

/**
 * The UPDATE that marks one owed row paid, once Shopify was seen to match.
 *
 * "Paid" means the row now says what Shopify holds for this sack: counted if
 * it is on hand, not counted if it is voided or out. Guarded on every column
 * read: a row the floor touched since is left alone and looked at next tick.
 */
export function settleStatement(row, { variantId = null, at = new Date().toISOString() } = {}) {
  const { kind } = classifyDebt(row);
  let set, setParams;
  if (kind === 'void') {
    set = 'shopify_added_at = NULL, shopify_add_error = NULL, shopify_sync_error = NULL';
    setParams = [];
  } else if (kind === 'out') {
    set = 'shopify_synced_at = ?, shopify_sync_error = NULL';
    setParams = [at];
  } else if (kind === 'undo') {
    set = 'shopify_sync_error = NULL';
    setParams = [];
  } else if (row.opened_at) {
    // An add whose answer never came, on a sack since taken out: Shopify holds
    // nothing for it either way, so it reads as added and taken out.
    set = 'shopify_added_at = ?, shopify_add_error = NULL, shopify_synced_at = ?, shopify_sync_error = NULL, shopify_variant_id = COALESCE(shopify_variant_id, ?)';
    setParams = [at, at, variantId];
  } else {
    set = 'shopify_added_at = ?, shopify_add_error = NULL, shopify_sync_error = NULL, shopify_variant_id = COALESCE(shopify_variant_id, ?)';
    setParams = [at, variantId];
  }
  const guard = SNAPSHOT.map(c => `${c} IS ?`).join(' AND ');
  return {
    sql: `UPDATE harvest_sacks SET ${set} WHERE sack_id = ? AND ${guard}`,
    params: [...setParams, row.sack_id, ...SNAPSHOT.map(c => row[c] ?? null)],
  };
}
