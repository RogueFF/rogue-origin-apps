/**
 * What the inventory owes Shopify — one definition, shared by the sweep and the
 * screens.
 *
 * A tag's +1 and a void's -1 both run in `waitUntil`, after the crew already has
 * their answer, against a Google Apps Script that can return an HTML error page
 * or simply never answer. Three states have to stay apart, because what the row
 * says is the only way to tell them apart later:
 *
 *   counted   `shopify_added_at` set,  no error        — Shopify holds the +1
 *   failed    marker unchanged,        error recorded  — safe to retry
 *   unknown   marker unchanged,        IN_FLIGHT       — started, never answered
 *
 * `IN_FLIGHT` is written BEFORE the call, which is the whole trick: a background
 * job that dies mid-call writes nothing, so without a mark laid down first it is
 * indistinguishable from one that never ran.
 *
 * WHY THIS MOVED OUT OF THE SWEEP. The repair tool (`?action=inventory_sweep`)
 * already found these rows — but it is an endpoint somebody has to know to call.
 * On 2026-09-22 two sacks sat owed for hours with nothing on any screen saying
 * so. A debt nobody is shown is a debt nobody pays, so the reconcile screen and
 * the dashboard now read the same rows through the same SQL. One definition of
 * "owed": if the sweep and a screen could disagree, the screen would be teaching
 * the crew to ignore it.
 */

/** Prefix of the marker laid down before an inventory call is attempted. */
export const IN_FLIGHT = 'in flight since ';

/** The marker itself, stamped with when the attempt began and what it was. */
export const inFlight = (what) => `${IN_FLIGHT}${new Date().toISOString()} (${what})`;

/** At most this many ids travel to a screen; the COUNT is always exact. */
export const DEBT_LIST_CAP = 20;

/**
 * The rows that owe Shopify something. Kept as a fragment rather than a whole
 * query so callers choose their own columns and ordering, but never their own
 * idea of what counts as a debt.
 */
export const DEBT_SQL = `
  (voided_at IS NOT NULL AND shopify_added_at IS NOT NULL)
  OR (voided_at IS NULL AND shopify_added_at IS NULL AND shopify_add_error IS NOT NULL)
`;

/**
 * Which debt a row carries, and whether anyone may safely replay it.
 *
 * An `unknown` row is never retried automatically: the script may have applied
 * the change and failed on the way back, and replaying that moves the count
 * twice — which reads exactly like an honest count.
 */
export function classifyDebt(row) {
  const owes = row.voided_at ? -1 : 1;
  const unknown = String(row.shopify_add_error || '').startsWith(IN_FLIGHT);
  return {
    sack_id: row.sack_id,
    owes,
    state: unknown ? 'unknown' : 'failed',
    error: row.shopify_add_error || null,
  };
}

/**
 * Roll the rows up into what a screen shows at a glance.
 *
 * `failed` and `unknown` are counted apart because they need different actions:
 * a failure can be swept, an unknown has to be checked in Shopify by a person
 * first. Collapsing them would hand someone a button that silently doubles a
 * count.
 */
export function summariseDebts(rows) {
  const items = (rows || []).map(classifyDebt);
  const failed = items.filter(i => i.state === 'failed').length;
  const unknown = items.filter(i => i.state === 'unknown').length;
  return {
    total: items.length,
    failed,
    unknown,
    owedPlus: items.filter(i => i.owes > 0).length,
    owedMinus: items.filter(i => i.owes < 0).length,
    show: items.length > 0,
    // Trimmed for display only — `total` above stays exact, so one bad night
    // reads as "47 tags" rather than flooding a screen with 47 ids.
    items: items.slice(0, DEBT_LIST_CAP),
  };
}
