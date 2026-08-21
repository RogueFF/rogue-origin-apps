/**
 * Wholesale order board — shared state and API surface.
 *
 * Design: docs/plans/2026-08-19-order-blocks-design.md
 */

import { makeApi } from '../shared/api.js';
import { t } from '../shared/i18n.js';

export const api = makeApi('wholesale', { auth: true });

/**
 * Mirrors the CHECK constraint on orders.status (migration 0019) exactly — every
 * status the database accepts is offered here, and nothing else is.
 *
 * The five-word vocabulary 0018 guessed at is gone: `draft` was never created by
 * anything, and `shipped` vs `closed` was a distinction nothing downstream ever
 * branched on. These three are the words the floor says.
 */
export const STATUSES = ['in_queue', 'in_production', 'finished'];

export const state = {
  orders: [],
  customers: [],
  cultivars: [],
  editing: null,      // the order being edited, or null
  queue: null,        // last getQueue response
  coverage: null,     // last getCoverage response
};

/**
 * Pounds per kilogram. Must match LB_PER_KG in workers/src/lib/wholesale.js —
 * the server is authoritative and recomputes on save; this copy exists only so
 * the editor can show the operator what the conversion will produce before
 * they commit to it.
 */
export const LB_PER_KG = 2.20462;

export const toLbs = (qty, unit) => (unit === 'kg' ? qty * LB_PER_KG : qty);

export const fmtLbs = (n) =>
  `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })} lb`;

/** Whole pounds, for figures a tenth of a pound cannot honestly resolve — a lot
 *  size derived from a measured trim rate, or a shortfall against sack counts. */
export const fmtLbs0 = (n) =>
  `${Math.round(n).toLocaleString('en-US')} lb`;

export const fmtUsd = (n) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Build an <option>. Avoids the Option constructor, which is not in the lint
 *  environment's browser globals and reads less plainly than this. */
export function option(label, value, selected = false) {
  const o = document.createElement('option');
  o.textContent = label;
  o.value = value;
  o.selected = selected;
  return o;
}

/**
 * Translated, unlike the sentence-case fallback this replaced — the status is
 * the one word on a card that says what to do about it, and the floor reads the
 * board in Spanish. The fallback still covers a value the database has but this
 * build has not heard of, which is what a mid-deploy front end sees.
 */
export function statusLabel(s) {
  const key = `status_${s}`;
  const label = t(key);
  return label === key ? s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : label;
}

export async function loadCoverage() {
  state.coverage = await api.get('getCoverage');
}

export async function loadAll() {
  const [cultivars, customers, orders] = await Promise.all([
    api.get('getCultivars'),
    api.get('getCustomers'),
    api.get('getOrders', { includeFinished: 'true' }),
  ]);
  state.cultivars = cultivars.cultivars || [];
  state.customers = customers.customers || [];
  state.orders = orders.orders || [];
}
