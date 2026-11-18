/**
 * What barn staff get back from /api/consign: everything they need to record dropoffs,
 * weights, screening and sold pounds, and no money. Pure, no I/O.
 * The owner (valid owner_password) gets the handler's reply untouched; see consign-d1.js.
 *
 * Built field by field from the allowlists below, as consign-farm-view.js does for the
 * partner farm page. No row is ever spread into a reply, so a column added to a table later
 * does not reach staff by default.
 *
 * Never in here: prices (a lot's or a price point's), owed, value, balance, paid, credit,
 * the "estimate" money tag, payments of any kind, farm totals, client keys, the farm's
 * page link state (owner only). Kept: the plain needs_price flag, never a price value.
 *
 * The lot's `money` object keeps its name (the page reads money.status, money.remainder_lbs...)
 * but in a staff reply it holds only the status, needs_price and pounds.
 */
import { createError } from './errors.js';

export const STAFF_KEYS = Object.freeze({
  farm: ['id', 'name', 'contact', 'default_term', 'lang', 'active', 'created_at'],
  price_point: ['cultivar', 'type'],
  dropoff: ['id', 'farm_id', 'farm_name', 'dropped_at', 'dropped_by', 'note', 'source', 'voided_at', 'void_reason'],
  lot: ['id', 'dropoff_id', 'farm_id', 'farm_name', 'dropped_at', 'cultivar', 'type', 'term', 'intake_lbs', 'weighed_at',
    'closed_at', 'note', 'note_visible', 'voided_at', 'void_reason'],
  money: ['status', 'needs_price', 'intake_lbs', 'pulled_lbs', 'final_lbs', 'to_smalls_lbs', 'biomass_lbs', 'mold_lbs',
    'remainder_lbs', 'payable_main_lbs', 'payable_smalls_lbs', 'sold_main_lbs', 'sold_smalls_lbs', 'on_hand_lbs'],
  run: ['id', 'lot_id', 'run_at', 'pulled_lbs', 'final_lbs', 'to_smalls_lbs', 'biomass_lbs', 'mold_lbs', 'diff_lbs', 'note', 'voided_at', 'void_reason'],
  sold: ['id', 'lot_id', 'sold_on', 'lbs', 'kind', 'note', 'voided_at', 'void_reason'],
  // Reply flags of the write actions.
  flags: ['duplicate', 'already', 'ok'],
});

/** Copy only the named keys that the source has. */
function pick(src, keys) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  for (const k of keys) if (Object.hasOwn(src, k)) out[k] = src[k];
  return out;
}
const list = (rows, fn) => (Array.isArray(rows) ? rows.map(fn) : []);

export function staffLot(l) {
  return {
    ...pick(l, STAFF_KEYS.lot),
    runs: list(l.runs, (r) => pick(r, STAFF_KEYS.run)),
    sold: list(l.sold, (s) => pick(s, STAFF_KEYS.sold)),
    money: pick(l.money, STAFF_KEYS.money),
  };
}
const flags = (d) => pick(d, STAFF_KEYS.flags);
const dropoffReply = (d) => ({ dropoff: pick(d.dropoff, STAFF_KEYS.dropoff), lots: list(d.lots, staffLot), ...flags(d) });
const lotReply = (d) => ({ lot: staffLot(d.lot), ...flags(d) });

const VIEWS = {
  farms: (d) => list(d, (f) => ({ ...pick(f, STAFF_KEYS.farm), needs_price: !!f.needs_price })),
  // The farm's cultivars and types (to pre-fill the dropoff grid), never their prices.
  farm: (d) => ({
    farm: pick(d.farm, STAFF_KEYS.farm),
    price_points: list(d.price_points, (p) => pick(p, STAFF_KEYS.price_point)),
    dropoffs: list(d.dropoffs, (x) => ({ ...pick(x, STAFF_KEYS.dropoff), lots: list(x.lots, staffLot) })),
  }),
  open: (d) => ({ to_weigh: list(d.to_weigh, staffLot), to_screen: list(d.to_screen, staffLot), needs_price: list(d.needs_price, staffLot) }),
  dropoff: dropoffReply,
  saveDropoff: dropoffReply,
  setWeight: lotReply,
  saveScreenRun: lotReply,
  closeLot: lotReply,
  saveSold: lotReply,
  voidRow: flags,
  // A sheet read is built from the photo and normalizeSheetRead (lib/consign-sheet.js): cultivars,
  // pounds, names, lot ids. No price is ever in it; it passes as is (tests/consign-staff-lock.test.mjs).
  readSheet: (d) => ({ read: d.read }),
};

/** Actions staff may call, each with its view. Every other action is owner only. */
export const STAFF_VIEW_ACTIONS = Object.freeze(Object.keys(VIEWS));

/** The staff reply for an action. An action with no staff view fails closed: it never passes through. */
export function staffView(action, data) {
  if (!Object.hasOwn(VIEWS, action)) throw createError('INTERNAL_ERROR', `No staff view for ${action}`);
  return VIEWS[action](data);
}
