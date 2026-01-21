/**
 * Order detail panel feature
 * @module features/detail-panel
 */

import { apiCall } from '../core/api.js';
import {
  getCurrentOrderID, setCurrentOrderID,
  getOrders, setOrders, findOrder,
  getCachedOrder, setCachedOrder, invalidateCache,
  setCachedShipments, setCachedPayments
} from '../core/state.js';
import { showToast } from '../ui/toast.js';
import { updateStats } from '../ui/stats.js';
import { formatCurrency, formatNumber } from '../utils/format.js';
import { renderShipments } from './shipments.js';
import { renderPayments } from './payments.js';
import { showSkeleton } from '../ui/loading.js';

/**
 * Open detail panel for an order
 * @param {string} orderID
 */
export async function openDetailPanel(orderID) {
  setCurrentOrderID(orderID);

  const orders = getOrders();
  // Support both 'orderID' and 'id' property names
  const order = orders.find(o => (o.orderID || o.id) === orderID);
  if (!order) {
    showToast('Order not found', 'error');
    return;
  }

  // Show panel immediately
  const panel = document.getElementById('detail-panel');
  if (panel) panel.classList.add('active');

  // Set header info
  setTextContent('detail-order-id', order.id || order.orderID);
  setTextContent('detail-customer-name', order.customerName);

  // Check session cache first
  const cached = getCachedOrder(orderID);
  if (cached) {
    applyOrderData(orderID, cached.financials, cached.shipments, cached.payments);
    switchTab('summary');
    return;
  }

  // Show skeleton loading state
  showSkeleton('shipments-list', 2);
  showSkeleton('payments-list', 2);

  switchTab('summary');

  // Load all data in parallel
  try {
    const [financials, shipmentsResult, paymentsResult] = await Promise.all([
      apiCall('getOrderFinancials', { orderID }),
      apiCall('getShipments', { orderID }),
      apiCall('getPayments', { orderID })
    ]);

    // Cache the results
    setCachedOrder(orderID, {
      financials,
      shipments: shipmentsResult,
      payments: paymentsResult
    });

    // Apply the data
    applyOrderData(orderID, financials, shipmentsResult, paymentsResult);
  } catch (error) {
    console.error('Error loading order details:', error);
    showToast('Error loading order details', 'error');
  }
}

/**
 * Close detail panel
 */
export function closeDetailPanel() {
  const panel = document.getElementById('detail-panel');
  if (panel) panel.classList.remove('active');
  setCurrentOrderID(null);
}

/**
 * Apply order data to panel
 * @private
 */
function applyOrderData(orderID, financials, shipmentsResult, paymentsResult) {
  // Process financials
  if (financials && financials.success !== false) {
    updateSummaryTab(financials);

    // Update order in state
    const orders = getOrders();
    // Support both 'orderID' and 'id' property names
    const orderIndex = orders.findIndex(o => (o.orderID || o.id) === orderID);
    if (orderIndex !== -1) {
      orders[orderIndex].fulfilled = financials.fulfilled;
      orders[orderIndex].paid = financials.paid;
      setOrders(orders);
      updateOrderRowInTable(orderID, orders[orderIndex]);
    }
    updateStats();
  }

  // Process shipments
  if (shipmentsResult && shipmentsResult.success !== false) {
    const shipments = shipmentsResult.shipments || [];
    setCachedShipments(shipments);
    renderShipments(shipments);
  }

  // Process payments
  if (paymentsResult && paymentsResult.success !== false) {
    const payments = paymentsResult.payments || [];
    setCachedPayments(payments);
    renderPayments(payments);
  }
}

/**
 * Update summary tab with financial data
 * @private
 */
function updateSummaryTab(financials) {
  setTextContent('summary-commitment', formatCurrency(financials.commitment || 0));
  setTextContent('summary-fulfilled', formatCurrency(financials.fulfilled || 0));
  setTextContent('summary-paid', formatCurrency(financials.paid || 0));
  setTextContent('summary-balance', formatCurrency(financials.balance || 0));

  // Update progress bar
  const progressBar = document.getElementById('summary-progress-bar');
  const progressText = document.getElementById('summary-progress-text');
  if (progressBar && financials.commitment > 0) {
    const pct = Math.min(100, (financials.fulfilled / financials.commitment) * 100);
    progressBar.style.width = `${pct}%`;
    if (progressText) progressText.textContent = `${pct.toFixed(0)}%`;
  }
}

/**
 * Switch between tabs in detail panel
 * @param {string} tabName - 'summary', 'shipments', or 'payments'
 */
export function switchTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.detail-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });

  // Update tab content
  document.querySelectorAll('.detail-tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `tab-${tabName}`);
  });
}

/**
 * Update a single row in the orders table
 * @private
 */
function updateOrderRowInTable(orderID, order) {
  const row = document.querySelector(`tr[onclick*="${orderID}"]`);
  if (!row) return;

  const fulfillPct = order.commitmentAmount > 0
    ? Math.round((order.fulfilled || 0) / order.commitmentAmount * 100)
    : 0;

  if (row.cells[3]) {
    row.cells[3].innerHTML = `<span class="order-amount">$${formatNumber(order.fulfilled || 0)}</span>`;
  }
  if (row.cells[4]) {
    row.cells[4].innerHTML = `
      ${fulfillPct}%
      <div class="progress-mini">
        <div class="progress-mini-fill" style="width: ${fulfillPct}%"></div>
      </div>
    `;
  }
}

/**
 * Refresh detail panel data
 */
export async function refreshDetailPanel() {
  const orderID = getCurrentOrderID();
  if (orderID) {
    invalidateCache(orderID);
    await openDetailPanel(orderID);
  }
}

// Helper function
function setTextContent(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || '';
}
