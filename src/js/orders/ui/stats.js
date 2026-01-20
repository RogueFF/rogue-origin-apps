/**
 * Stats bar calculations and rendering
 * @module ui/stats
 */

import { getOrders } from '../core/state.js';
import { formatCurrency } from '../utils/format.js';

/**
 * Update the stats bar with current order totals
 */
export function updateStats() {
  const orders = getOrders();

  // Calculate totals
  const totals = orders.reduce((acc, order) => ({
    commitment: acc.commitment + (parseFloat(order.commitmentAmount) || 0),
    fulfilled: acc.fulfilled + (parseFloat(order.fulfilledAmount) || 0),
    paid: acc.paid + (parseFloat(order.paidAmount) || 0)
  }), { commitment: 0, fulfilled: 0, paid: 0 });

  const outstanding = totals.commitment - totals.fulfilled;
  const balance = totals.fulfilled - totals.paid;

  // Update DOM
  setStatValue('stat-commitment', formatCurrency(totals.commitment));
  setStatValue('stat-fulfilled', formatCurrency(totals.fulfilled));
  setStatValue('stat-paid', formatCurrency(totals.paid));
  setStatValue('stat-outstanding', formatCurrency(outstanding));
  setStatValue('stat-balance', formatCurrency(balance));
}

/**
 * Set a stat value element
 * @private
 */
function setStatValue(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = value;
  }
}

/**
 * Get calculated stats (for use elsewhere)
 * @returns {Object} { commitment, fulfilled, paid, outstanding, balance }
 */
export function getStats() {
  const orders = getOrders();

  const totals = orders.reduce((acc, order) => ({
    commitment: acc.commitment + (parseFloat(order.commitmentAmount) || 0),
    fulfilled: acc.fulfilled + (parseFloat(order.fulfilledAmount) || 0),
    paid: acc.paid + (parseFloat(order.paidAmount) || 0)
  }), { commitment: 0, fulfilled: 0, paid: 0 });

  return {
    ...totals,
    outstanding: totals.commitment - totals.fulfilled,
    balance: totals.fulfilled - totals.paid
  };
}
