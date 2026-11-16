/**
 * Consignment lot ledger maths. Pure functions, no I/O.
 * Design: docs/plans/2026-11-16-consignment-lot-ledger-design.md section 6.
 */

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const n0 = (v) => Number(v) || 0;
const live = (rows) => (rows || []).filter((r) => !r.voided_at);
const sum = (rows, key) => rows.reduce((a, r) => a + n0(r[key]), 0);

/** Allowed gap between pounds pulled and the outputs: 0.5 lb or 1%, whichever is larger. */
export function screenTolerance(pulledLbs) {
  return Math.max(0.5, 0.01 * n0(pulledLbs));
}

/** Does a screening run add up? diff = pulled - outputs. */
export function checkRun(run, lotType) {
  const pulled = n0(run.pulled_lbs);
  const toSmalls = n0(run.to_smalls_lbs);
  const diff = round2(pulled - (n0(run.final_lbs) + toSmalls + n0(run.biomass_lbs) + n0(run.mold_lbs)));
  const tolerance = round2(screenTolerance(pulled));
  const ok = pulled > 0 && Math.abs(diff) <= tolerance && !(lotType === 'smalls' && toSmalls > 0);
  return { ok, diff, tolerance };
}

/**
 * Everything the screens need to know about one lot.
 * status: voided | dropped | weighed | screening | closed
 */
export function lotMoney(lot, runs = [], sold = []) {
  const rs = live(runs);
  const ss = live(sold);
  const intake = lot.intake_lbs == null ? null : n0(lot.intake_lbs);
  const pulled = sum(rs, 'pulled_lbs');
  const finalLbs = sum(rs, 'final_lbs');
  const toSmalls = lot.type === 'tops' ? sum(rs, 'to_smalls_lbs') : 0;
  const closed = !!lot.closed_at;

  let status = 'weighed';
  if (lot.voided_at) status = 'voided';
  else if (intake == null) status = 'dropped';
  else if (closed) status = 'closed';
  else if (pulled > 0) status = 'screening';

  const remainder = intake == null || closed ? 0 : Math.max(intake - pulled, 0);
  const price = lot.price_per_lb == null ? null : n0(lot.price_per_lb);
  const smallsPrice = lot.smalls_price_per_lb == null ? null : n0(lot.smalls_price_per_lb);
  const needsPrice = price == null || (toSmalls > 0 && smallsPrice == null);

  const mainLbs = finalLbs + remainder;
  const value = mainLbs * n0(price) + toSmalls * n0(smallsPrice);

  const soldMain = sum(ss.filter((s) => s.kind !== 'smalls'), 'lbs');
  const soldSmalls = sum(ss.filter((s) => s.kind === 'smalls'), 'lbs');

  let owed = 0;
  if (status !== 'voided') {
    owed = lot.term === 'sold' ? soldMain * n0(price) + soldSmalls * n0(smallsPrice) : value;
  }

  return {
    status,
    estimate: status !== 'closed' && status !== 'voided',
    needs_price: status !== 'voided' && needsPrice,
    intake_lbs: intake,
    pulled_lbs: round2(pulled),
    final_lbs: round2(finalLbs),
    to_smalls_lbs: round2(toSmalls),
    biomass_lbs: round2(sum(rs, 'biomass_lbs')),
    mold_lbs: round2(sum(rs, 'mold_lbs')),
    remainder_lbs: round2(remainder),
    payable_main_lbs: round2(mainLbs),
    payable_smalls_lbs: round2(toSmalls),
    sold_main_lbs: round2(soldMain),
    sold_smalls_lbs: round2(soldSmalls),
    on_hand_lbs: lot.term === 'sold' ? round2(mainLbs - soldMain + toSmalls - soldSmalls) : null,
    value: round2(value),
    owed: round2(owed),
  };
}

/** Farm totals. balance below zero = credit owed back to us. Never clamped. */
export function farmTotals(lotMoneys, payments = []) {
  const owed = round2(lotMoneys.reduce((a, m) => a + m.owed, 0));
  const paid = round2(sum(live(payments), 'amount'));
  const balance = round2(owed - paid);
  return {
    owed,
    paid,
    balance,
    credit: balance < 0 ? round2(-balance) : 0,
    estimate: lotMoneys.some((m) => m.estimate && m.owed > 0),
    needs_price: lotMoneys.some((m) => m.needs_price),
  };
}
