/**
 * Barn intake — which lot does an arriving trailer belong to?
 *
 * Zone sessions form a chain of enters: scanning into the next zone closes the
 * one before it. But a trailer loaded in the old zone is still on the road when
 * that happens, so it reaches the barn *after* its own lot has closed.
 *
 * The correction is a grace window. A load logged within GRACE of a zone's
 * close is attributed to that zone, not to whatever the crew has since moved
 * into.
 *
 * **The error is one-sided, and that is why the window can be generous.** A
 * genuine load for the NEW zone cannot arrive this fast — the crew has to cut
 * and fill 18-22 bins there first, then drive. So widening the window costs
 * almost nothing in false positives, while a window narrower than the transit
 * time misses the exact case it exists for. Field-to-barn transit is ~6 min
 * (Koa, 2026-09-02), which is the window.
 *
 * Without this, a load picked against an already-closed zone records a NULL
 * attribution — and the lot ledger counts loads and bins by joining on it, so
 * those bins would land on no lot at all rather than merely the wrong one.
 *
 * Times are epoch milliseconds. Parsing SQLite's `datetime('now')` stays with
 * the caller, so this module is pure and directly testable.
 */

/** Field-to-barn transit, measured by Koa 2026-09-02. */
export const BARN_GRACE_MS = 6 * 60 * 1000;

/**
 * Is a lot that closed at `closedAtMs` still close enough to own a load
 * arriving now?
 *
 * A close in the future is rejected rather than treated as zero elapsed: it
 * means clock skew, and silently accepting it would attribute loads to a lot
 * that has not closed yet.
 */
export function withinBarnGrace(closedAtMs, nowMs, graceMs = BARN_GRACE_MS) {
  if (!Number.isFinite(closedAtMs) || !Number.isFinite(nowMs)) return false;
  const elapsed = nowMs - closedAtMs;
  return elapsed >= 0 && elapsed <= graceMs;
}

/**
 * Which zone should the intake form pre-select?
 *
 * During the grace window after a zone change, any trailer pulling in was
 * almost certainly loaded in the zone before — so that is the default, with the
 * dropdown left in place to override it.
 *
 * Returns null when there is nothing to suggest, which includes the case that
 * matters most: a crew re-entering the SAME zone (a within-shift cut resume)
 * closes and reopens it, and suggesting a zone against itself would be noise
 * dressed up as a correction.
 */
export function suggestedIntakeZone({
  activeZone = null,
  lastClosedZone = null,
  lastClosedAtMs = null,
  nowMs,
  graceMs = BARN_GRACE_MS,
} = {}) {
  if (!lastClosedZone) return null;
  if (lastClosedZone === activeZone) return null;
  if (!withinBarnGrace(lastClosedAtMs, nowMs, graceMs)) return null;
  return lastClosedZone;
}
