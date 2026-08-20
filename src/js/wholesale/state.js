/**
 * Wholesale order board — shared state and API surface.
 *
 * Design: docs/plans/2026-08-19-order-blocks-design.md
 */

import { makeApi } from '../shared/api.js';

export const api = makeApi('wholesale', { auth: true });

/** Mirrors the CHECK constraint on orders.status (migration 0018). */
export const STATUSES = ['draft', 'open', 'in_production', 'shipped', 'closed'];

export const state = {
  orders: [],
  customers: [],
  cultivars: [],
  filter: 'active',   // 'active' | one of STATUSES
  editing: null,      // the order being edited, or null
  view: 'board',      // 'board' | 'queue'
  queue: null,        // last getQueue response
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

export function statusLabel(s) {
  return s === 'in_production' ? 'In production' : s.charAt(0).toUpperCase() + s.slice(1);
}

/** Orders matching the current filter. "active" hides closed and shipped. */
export function visibleOrders() {
  if (state.filter === 'active') {
    return state.orders.filter(o => o.status !== 'closed' && o.status !== 'shipped');
  }
  return state.orders.filter(o => o.status === state.filter);
}

export async function loadAll() {
  const [cultivars, customers, orders] = await Promise.all([
    api.get('getCultivars'),
    api.get('getCustomers'),
    api.get('getOrders', { includeClosed: 'true' }),
  ]);
  state.cultivars = cultivars.cultivars || [];
  state.customers = customers.customers || [];
  state.orders = orders.orders || [];
}
