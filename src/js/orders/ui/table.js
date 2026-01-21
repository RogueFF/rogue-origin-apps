/**
 * Orders table rendering
 * @module ui/table
 */

import { getOrders, getCustomers } from '../core/state.js';
import { formatCurrency } from '../utils/format.js';

/**
 * Render the orders table
 */
export function renderOrdersTable() {
  const orders = getOrders();
  const tbody = document.getElementById('orders-table-body');

  if (!tbody) return;

  if (!orders.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">
          No orders yet. Create your first order above.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = orders.map(order => renderOrderRow(order)).join('');
}

/**
 * Render a single order row
 * @private
 */
function renderOrderRow(order) {
  // Support both 'orderID' and 'id' property names
  const orderID = order.orderID || order.id;

  // Get customer name - try order first, then lookup from customers
  let customerName = order.customerName;
  if (!customerName && order.customerID) {
    const customers = getCustomers();
    const customer = customers.find(c => c.id === order.customerID);
    customerName = customer?.companyName || '';
  }

  const commitment = parseFloat(order.commitmentAmount) || 0;
  const fulfilled = parseFloat(order.fulfilledAmount || order.fulfilled) || 0;
  const fulfillPct = commitment > 0
    ? Math.min(100, (fulfilled / commitment) * 100)
    : 0;

  return `
    <tr onclick="window.orderActions.openDetail('${orderID}')" style="cursor: pointer;">
      <td style="font-family: var(--font-mono);">${escapeHtml(orderID)}</td>
      <td>${escapeHtml(customerName || '')}</td>
      <td style="font-family: var(--font-mono);">${formatCurrency(commitment)}</td>
      <td style="font-family: var(--font-mono);">${formatCurrency(fulfilled)}</td>
      <td>${renderProgressBar(fulfillPct)}</td>
      <td>${renderStatusBadge(order.status)}</td>
      <td class="actions" onclick="event.stopPropagation()">
        ${renderActionButtons(orderID)}
      </td>
    </tr>
  `;
}

/**
 * Render progress bar
 * @private
 */
function renderProgressBar(percent) {
  const color = percent >= 100 ? 'var(--success)' :
                percent >= 50 ? 'var(--gold)' :
                'var(--ro-green)';

  return `
    <div class="progress-bar" style="background: var(--bg-tertiary); border-radius: 4px; height: 8px; width: 100%; overflow: hidden;">
      <div class="progress-fill" style="width: ${percent}%; height: 100%; background: ${color}; transition: width 0.3s;"></div>
    </div>
    <span style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">${percent.toFixed(0)}%</span>
  `;
}

/**
 * Render status badge
 * @private
 */
function renderStatusBadge(status) {
  const statusConfig = {
    'Open': { class: 'status-open', color: 'var(--text-muted)' },
    'Partial': { class: 'status-partial', color: 'var(--gold)' },
    'Fulfilled': { class: 'status-fulfilled', color: 'var(--success)' },
    'Paid': { class: 'status-paid', color: 'var(--ro-green)' },
    'Closed': { class: 'status-closed', color: 'var(--text-muted)' }
  };

  const config = statusConfig[status] || statusConfig['Open'];
  const displayStatus = status || 'Open';

  return `<span class="status-badge ${config.class}">${displayStatus}</span>`;
}

/**
 * Render action buttons
 * @private
 */
function renderActionButtons(orderID) {
  return `
    <button class="icon-btn" onclick="window.orderActions.openShipmentModal('${orderID}')" title="Add Shipment">
      <i class="ph ph-package"></i>
    </button>
    <button class="icon-btn" onclick="window.orderActions.openPaymentModal('${orderID}')" title="Record Payment">
      <i class="ph ph-currency-dollar"></i>
    </button>
  `;
}

/**
 * Escape HTML to prevent XSS
 * @private
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
