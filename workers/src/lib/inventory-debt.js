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

/**
 * A waitUntil cannot outlive ~30 s, so a marker older than this will never be
 * answered. LIVE means "busy — wait or refuse for now"; anything else that
 * starts with IN_FLIGHT (stale, or already annotated "check Shopify") means
 * "unknown — a person must check", never "busy forever".
 */
export const IN_FLIGHT_STALE_MS = 2 * 60 * 1000;

export function isLiveInFlight(text, now = Date.now()) {
  const t = String(text || '');
  if (!t.startsWith(IN_FLIGHT) || t.includes('check Shopify')) return false;
  const at = Date.parse(t.slice(IN_FLIGHT.length).split(' ')[0]);
  return Number.isFinite(at) && now - at <= IN_FLIGHT_STALE_MS;
}

export const isStaleInFlight = (text, now = Date.now()) =>
  String(text || '').startsWith(IN_FLIGHT) && !isLiveInFlight(text, now);

/** Text no machine may settle: an operation whose outcome nobody saw. */
const needsPerson = (text) => {
  const t = String(text || '');
  return t.startsWith(IN_FLIGHT) || t.includes('check Shopify');
};

/**
 * A +1 that lands on a sack already scanned out. The scan correctly sent no -1
 * (no +1 had landed yet), so Shopify is now one high: every write-back that
 * records a landed +1 sets this in the same statement, turning the row into an
 * ordinary out-debt (owes -1, failed, sweepable). Binds ONE param: 1 if the
 * add landed, else 0.
 */
export const ADD_LANDED_AFTER_OUT = 'add landed after out';
export const ADD_LANDED_AFTER_OUT_SQL = `CASE WHEN ? = 1 AND opened_at IS NOT NULL AND voided_at IS NULL
  AND shopify_synced_at IS NULL AND shopify_sync_error IS NULL
  THEN '${ADD_LANDED_AFTER_OUT}' ELSE shopify_sync_error END`;

/** At most this many ids travel to a screen; the COUNT is always exact. */
export const DEBT_LIST_CAP = 20;

/**
 * The rows that owe Shopify something. Kept as a fragment rather than a whole
 * query so callers choose their own columns and ordering, but never their own
 * idea of what counts as a debt.
 */
export const DEBT_SQL = `
  (voided_at IS NOT NULL AND shopify_added_at IS NOT NULL)
  OR (voided_at IS NULL AND shopify_added_at IS NULL AND shopify_add_error IS NOT NULL
      AND (opened_at IS NULL OR shopify_add_error LIKE '${IN_FLIGHT}%'))
  OR (voided_at IS NULL AND opened_at IS NOT NULL AND shopify_added_at IS NOT NULL
      AND shopify_synced_at IS NULL AND shopify_sync_error IS NOT NULL)
  OR (voided_at IS NULL AND opened_at IS NULL AND shopify_added_at IS NOT NULL
      AND shopify_sync_error IS NOT NULL)
`;

/**
 * A sack that left inventory (opened_at) whose -1 never landed. It rides the
 * open's own columns — shopify_synced_at / shopify_sync_error — with the same
 * IN_FLIGHT marker the add uses, so Shopify still counting a sack that is gone
 * shows up beside the other two debts instead of in a parallel list.
 */
/** An undone scan-out whose +1 back has not landed: Shopify is one short. */
const undoOwed = (row) => !row.voided_at && !row.opened_at && !!row.shopify_added_at && !!row.shopify_sync_error;

const outOwed = (row) => !row.voided_at && !!row.opened_at && !!row.shopify_added_at
  && !row.shopify_synced_at && !!row.shopify_sync_error;

/**
 * Which debt a row carries, and whether anyone may safely replay it.
 *
 * An `unknown` row is never retried automatically: the script may have applied
 * the change and failed on the way back, and replaying that moves the count
 * twice — which reads exactly like an honest count.
 */
export function classifyDebt(row) {
  const out = outOwed(row);
  const owes = (row.voided_at || out) ? -1 : 1;
  const undo = undoOwed(row);
  const error = (out || undo) ? row.shopify_sync_error : row.shopify_add_error;
  const unknown = needsPerson(error);
  // A FAILED add on a sack that is out is no debt (DEBT_SQL drops it: the
  // missing +1 and the never-sent -1 cancel). One still IN FLIGHT is shown but
  // owes nothing either way: if it landed Shopify is one high, if not it is right.
  if (!out && !undo && !row.voided_at && row.opened_at) {
    return {
      sack_id: row.sack_id, owes: 0, kind: 'add', state: 'unknown',
      error: `${error} — sack is out; if this add landed, Shopify is one high`,
    };
  }
  // A sack voided while its count was already in doubt ("undone; check
  // Shopify"): Shopify may hold 0 or 1 for it, the target is 0. Still a void
  // debt, but one only a person can settle — the sync column carries why.
  const voidUnknown = !!row.voided_at && needsPerson(row.shopify_sync_error);
  return {
    sack_id: row.sack_id,
    owes,
    kind: out ? 'out' : undo ? 'undo' : (row.voided_at ? 'void' : 'add'),
    state: (unknown || voidUnknown) ? 'unknown' : 'failed',
    error: (voidUnknown ? row.shopify_sync_error : error) || null,
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
