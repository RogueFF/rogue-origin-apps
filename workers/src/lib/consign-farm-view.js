/**
 * What a partner farm sees on its own page. Pure, no I/O.
 * Plan: docs/plans/2026-11-16-consignment-lot-ledger-stage4.md, task 3.
 *
 * The reply is built field by field from the allowlists below. No row is ever spread
 * into it, so a column added to a table later does not reach a farm by default.
 * Never in here: other farms, internal notes (a lot note only when note_visible),
 * staff names, client keys, history, void reasons, voided rows, the farm's contact,
 * sale entries' notes, buyers.
 *
 * Money comes from lotMoney and farmTotals, the same maths as the staff page.
 */
import { lotMoney, farmTotals, round2 } from './consign-ledger.js';

export const VIEW_KEYS = Object.freeze({
  top: ['farm', 'totals', 'price_points', 'dropoffs', 'payments'],
  farm: ['name', 'lang'],
  totals: ['balance', 'owed', 'paid', 'estimate', 'last_payment_on'],
  price_point: ['cultivar', 'type', 'price_per_lb'],
  dropoff: ['id', 'dropped_at', 'lots'],
  lot: ['id', 'cultivar', 'type', 'term', 'status', 'intake_lbs', 'price_per_lb', 'smalls_price_per_lb', 'needs_price', 'estimate', 'owed',
    'final_lbs', 'to_smalls_lbs', 'biomass_lbs', 'mold_lbs', 'sold_lbs', 'on_hand_lbs', 'note'],
  payment: ['paid_on', 'amount', 'method', 'reference'],
});

const live = (r) => r && !r.voided_at;
const numOrNull = (v) => (v == null ? null : Number(v));
const strOrNull = (v) => (v == null || v === '' ? null : String(v));
const byDesc = (a, b) => (a < b ? 1 : a > b ? -1 : 0);

/** Newest price per cultivar and type, effective on or before today. Tops before smalls. */
function currentPrices(rows, today) {
  const best = new Map();
  for (const p of rows) {
    if (!(String(p.effective_from) <= today)) continue;
    const k = `${String(p.cultivar).toLowerCase()}|${p.type}`;
    const cur = best.get(k);
    if (!cur || p.effective_from > cur.effective_from || (p.effective_from === cur.effective_from && p.id > cur.id)) best.set(k, p);
  }
  return [...best.values()]
    .sort((a, b) => String(a.cultivar).localeCompare(String(b.cultivar)) || (a.type === b.type ? 0 : a.type === 'tops' ? -1 : 1))
    .map((p) => ({ cultivar: String(p.cultivar), type: p.type, price_per_lb: Number(p.price_per_lb) }));
}

function lotOut(l, m) {
  const screened = m.pulled_lbs > 0;
  const soldTerm = l.term === 'sold';
  return {
    id: l.id,
    cultivar: String(l.cultivar),
    type: l.type,
    term: l.term,
    status: m.status,
    intake_lbs: m.intake_lbs,
    price_per_lb: numOrNull(l.price_per_lb),
    smalls_price_per_lb: l.type === 'tops' ? numOrNull(l.smalls_price_per_lb) : null,
    needs_price: !!m.needs_price,
    // Same rule as the staff page and farmTotals: an estimate that carries money.
    estimate: !!(m.estimate && m.owed > 0),
    owed: m.owed,
    final_lbs: screened ? m.final_lbs : null,
    to_smalls_lbs: screened ? m.to_smalls_lbs : null,
    biomass_lbs: screened ? m.biomass_lbs : null,
    mold_lbs: screened ? m.mold_lbs : null,
    sold_lbs: soldTerm ? round2(m.sold_main_lbs + m.sold_smalls_lbs) : null,
    on_hand_lbs: soldTerm ? m.on_hand_lbs : null,
    note: Number(l.note_visible) === 1 ? strOrNull(l.note) : null,
  };
}

/**
 * @param {object} rows { farm, price_points, dropoffs, lots, runs, sold, payments, today (YYYY-MM-DD) }
 *   Raw table rows. Rows of other farms or voided rows passed in by mistake are dropped here too.
 */
export function farmView({ farm, price_points = [], dropoffs = [], lots = [], runs = [], sold = [], payments = [], today }) {
  const farmId = farm.id;
  const mine = (r) => r && r.farm_id === farmId;

  const liveDropoffs = dropoffs.filter((d) => mine(d) && live(d));
  const dropoffIds = new Set(liveDropoffs.map((d) => d.id));
  // Totals use every live lot of the farm (as the staff page does); a live lot always sits in a live dropoff.
  const liveLots = lots.filter((l) => mine(l) && live(l));
  const moneyOf = new Map(liveLots.map((l) => [l.id, lotMoney(l, runs.filter((r) => r.lot_id === l.id), sold.filter((s) => s.lot_id === l.id))]));
  const livePayments = payments.filter((p) => mine(p) && live(p));

  const t = farmTotals([...moneyOf.values()], livePayments);
  const lastPaid = livePayments.reduce((a, p) => (a == null || p.paid_on > a ? p.paid_on : a), null);

  return {
    farm: { name: String(farm.name), lang: farm.lang === 'es' ? 'es' : 'en' },
    totals: { balance: t.balance, owed: t.owed, paid: t.paid, estimate: !!t.estimate, last_payment_on: lastPaid },
    price_points: currentPrices(price_points.filter(mine), String(today)),
    dropoffs: liveDropoffs
      .sort((a, b) => byDesc(a.dropped_at, b.dropped_at) || b.id - a.id)
      .map((d) => ({
        id: d.id,
        dropped_at: d.dropped_at,
        lots: liveLots.filter((l) => l.dropoff_id === d.id && dropoffIds.has(l.dropoff_id)).map((l) => lotOut(l, moneyOf.get(l.id))),
      })),
    payments: livePayments
      .sort((a, b) => byDesc(a.paid_on, b.paid_on) || b.id - a.id)
      .map((p) => ({ paid_on: p.paid_on, amount: Number(p.amount), method: strOrNull(p.method), reference: strOrNull(p.reference) })),
  };
}
