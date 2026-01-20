/**
 * Order management feature
 * @module features/orders
 */

import { apiCall } from '../core/api.js';
import {
  getOrders, setOrders, getCustomers,
  getEditingOrderID, setEditingOrderID,
  getCurrentOrderID, findOrder, updateOrder, addOrder
} from '../core/state.js';
import { openModal, closeModal, clearForm } from '../ui/modals.js';
import { showToast } from '../ui/toast.js';
import { renderOrdersTable } from '../ui/table.js';
import { updateStats } from '../ui/stats.js';
import { formatNumber } from '../utils/format.js';

const MODAL_ID = 'order-modal';
const FORM_ID = 'order-form';

/**
 * Load orders from API and update state
 */
export async function loadOrders() {
  try {
    const result = await apiCall('getMasterOrders');
    if (result.success !== false) {
      const orders = result.orders || result || [];
      setOrders(orders);
      renderOrdersTable();
    }
  } catch (error) {
    console.error('Error loading orders:', error);
    showToast('Error loading orders', 'error');
  }
}

/**
 * Open new order modal
 */
export function openNewOrderModal() {
  setEditingOrderID(null);
  clearForm(FORM_ID);

  // Set defaults
  setFieldValue('order-currency', 'USD');
  setFieldValue('order-terms', 'DAP');

  const submitBtn = document.getElementById('order-submit-btn');
  if (submitBtn) submitBtn.textContent = 'Create Order';

  openModal(MODAL_ID);
}

/**
 * Close order modal
 */
export function closeOrderModal() {
  closeModal(MODAL_ID);
  setEditingOrderID(null);
}

/**
 * Edit existing order
 * @param {string} orderID
 */
export function editOrder(orderID) {
  const orders = getOrders();
  const order = orders.find(o => o.id === orderID);
  if (!order) return;

  setEditingOrderID(orderID);

  // Populate customer dropdown
  const customerSelect = document.getElementById('order-customer');
  if (customerSelect) {
    for (let i = 0; i < customerSelect.options.length; i++) {
      const opt = customerSelect.options[i];
      if (opt.dataset.customer) {
        const cust = JSON.parse(opt.dataset.customer);
        if (cust.id === order.customerID) {
          customerSelect.selectedIndex = i;
          break;
        }
      }
    }
  }

  // Populate form fields
  setFieldValue('order-commitment', order.commitmentAmount);
  setFieldValue('order-currency', order.currency || 'USD');
  setFieldValue('order-po', order.poNumber);
  setFieldValue('order-terms', order.terms || 'DAP');

  // Ship To
  setFieldValue('order-ship-contact', order.shipTo_Contact);
  setFieldValue('order-ship-company', order.shipTo_Company);
  setFieldValue('order-ship-address', order.shipTo_Address);
  setFieldValue('order-ship-phone', order.shipTo_Phone);
  setFieldValue('order-ship-email', order.shipTo_Email);

  // Sold To
  setFieldValue('order-sold-contact', order.soldTo_Contact);
  setFieldValue('order-sold-company', order.soldTo_Company);
  setFieldValue('order-sold-address', order.soldTo_Address);
  setFieldValue('order-sold-phone', order.soldTo_Phone);
  setFieldValue('order-sold-email', order.soldTo_Email);

  setFieldValue('order-notes', order.notes);

  // Update button text
  const submitBtn = document.getElementById('order-submit-btn');
  if (submitBtn) submitBtn.textContent = 'Update Order';

  openModal(MODAL_ID);
}

/**
 * Save master order (create or update)
 */
export async function saveMasterOrder() {
  const select = document.getElementById('order-customer');
  const selectedCustomer = select?.options[select.selectedIndex];

  if (!selectedCustomer || !selectedCustomer.dataset.customer) {
    showToast('Please select a customer', 'warning');
    return;
  }

  const customer = JSON.parse(selectedCustomer.dataset.customer);
  const editingOrderID = getEditingOrderID();

  const orderData = {
    customerID: customer.id,
    customerName: customer.companyName,
    commitmentAmount: parseFloat(getFieldValue('order-commitment')) || 0,
    currency: getFieldValue('order-currency') || 'USD',
    poNumber: getFieldValue('order-po'),
    terms: getFieldValue('order-terms') || 'DAP',
    shipTo_Contact: getFieldValue('order-ship-contact'),
    shipTo_Company: getFieldValue('order-ship-company'),
    shipTo_Address: getFieldValue('order-ship-address'),
    shipTo_Phone: getFieldValue('order-ship-phone'),
    shipTo_Email: getFieldValue('order-ship-email'),
    soldTo_Contact: getFieldValue('order-sold-contact'),
    soldTo_Company: getFieldValue('order-sold-company'),
    soldTo_Address: getFieldValue('order-sold-address'),
    soldTo_Phone: getFieldValue('order-sold-phone'),
    soldTo_Email: getFieldValue('order-sold-email'),
    notes: getFieldValue('order-notes')
  };

  // Add ID if editing, or created date if new
  if (editingOrderID) {
    orderData.id = editingOrderID;
  } else {
    orderData.createdDate = new Date().toISOString();
  }

  // Validation
  if (orderData.commitmentAmount <= 0) {
    showToast('Commitment amount must be greater than 0', 'warning');
    return;
  }

  try {
    const result = await apiCall('saveMasterOrder', orderData, 'POST');

    if (result.success !== false) {
      closeOrderModal();

      const orders = getOrders();

      if (editingOrderID) {
        // Update existing
        const index = orders.findIndex(o => o.id === editingOrderID);
        if (index !== -1) {
          orders[index] = { ...orders[index], ...orderData };
          setOrders(orders);
          updateOrderRowInDOM(editingOrderID, orders[index]);
        }
      } else {
        // Add new
        const newOrder = {
          ...orderData,
          id: result.order?.id || result.id,
          status: 'pending',
          fulfilled: 0,
          paid: 0
        };
        orders.push(newOrder);
        setOrders(orders);
        addOrderRowToDOM(newOrder);
      }

      updateStats();

      // Refresh detail panel if open for this order
      if (editingOrderID && getCurrentOrderID() === editingOrderID) {
        // Trigger detail panel refresh
        window.orderActions?.openDetail?.(editingOrderID);
      }

      showToast(editingOrderID ? 'Order updated successfully!' : 'Order created successfully!');
    } else {
      showToast('Error saving order: ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (error) {
    console.error('Error saving order:', error);
    showToast('Error saving order', 'error');
  }
}

/**
 * Delete an order
 * @param {string} orderID
 */
export async function deleteOrder(orderID) {
  if (!confirm('Are you sure you want to delete this order? This action cannot be undone.')) {
    return;
  }

  try {
    const result = await apiCall('deleteMasterOrder', { orderID }, 'POST');

    if (result.success !== false) {
      // Remove from state
      const orders = getOrders().filter(o => o.id !== orderID);
      setOrders(orders);

      // Remove from DOM
      removeOrderRowFromDOM(orderID);
      updateStats();

      // Close detail panel if open for this order
      if (getCurrentOrderID() === orderID) {
        window.orderActions?.closeDetail?.();
      }

      showToast('Order deleted successfully!');
    } else {
      showToast('Error deleting order: ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (error) {
    console.error('Error deleting order:', error);
    showToast('Error deleting order', 'error');
  }
}

// ============================================
// DOM Helpers (fast row updates)
// ============================================

/**
 * Update a single order row in DOM
 * @private
 */
function updateOrderRowInDOM(orderID, order) {
  const row = document.querySelector(`tr[onclick*="${orderID}"]`);
  if (!row) return;

  const fulfillPct = order.commitmentAmount > 0
    ? Math.round((order.fulfilled || 0) / order.commitmentAmount * 100)
    : 0;

  if (row.cells[1]) row.cells[1].textContent = order.customerName || 'Unknown';
  if (row.cells[2]) row.cells[2].innerHTML = `<span class="order-amount">$${formatNumber(order.commitmentAmount)}</span>`;
  if (row.cells[3]) row.cells[3].innerHTML = `<span class="order-amount">$${formatNumber(order.fulfilled || 0)}</span>`;
  if (row.cells[4]) {
    row.cells[4].innerHTML = `
      ${fulfillPct}%
      <div class="progress-mini">
        <div class="progress-mini-fill" style="width: ${fulfillPct}%"></div>
      </div>
    `;
  }
  if (row.cells[5]) row.cells[5].innerHTML = `<span class="order-status ${order.status}">${order.status}</span>`;
}

/**
 * Add a new order row to DOM
 * @private
 */
function addOrderRowToDOM(order) {
  const tbody = document.getElementById('orders-table-body');
  if (!tbody) return;

  // Remove "no orders" message if present
  const emptyRow = tbody.querySelector('td[colspan]');
  if (emptyRow) {
    tbody.innerHTML = '';
  }

  const fulfillPct = order.commitmentAmount > 0
    ? Math.round((order.fulfilled || 0) / order.commitmentAmount * 100)
    : 0;

  const row = document.createElement('tr');
  row.setAttribute('onclick', `window.orderActions.openDetail('${order.id}')`);
  row.style.cursor = 'pointer';
  row.innerHTML = `
    <td data-label="Order ID" class="order-id">${order.id}</td>
    <td data-label="Customer">${order.customerName || 'Unknown'}</td>
    <td data-label="Commitment" class="order-amount">$${formatNumber(order.commitmentAmount)}</td>
    <td data-label="Fulfilled" class="order-amount">$${formatNumber(order.fulfilled || 0)}</td>
    <td data-label="Progress" class="progress-cell">
      ${fulfillPct}%
      <div class="progress-mini">
        <div class="progress-mini-fill" style="width: ${fulfillPct}%"></div>
      </div>
    </td>
    <td data-label="Status"><span class="order-status ${order.status}">${order.status}</span></td>
    <td data-label="Actions" onclick="event.stopPropagation()" style="white-space: nowrap;">
      <button class="btn-icon" onclick="window.orderActions.editOrder('${order.id}')" title="Edit Order">
        <i class="ph ph-pencil-simple"></i>
      </button>
      <button class="btn-icon" onclick="window.orderActions.deleteOrder('${order.id}')" title="Delete Order" style="color: var(--danger);">
        <i class="ph ph-trash"></i>
      </button>
    </td>
  `;
  tbody.appendChild(row);
}

/**
 * Remove an order row from DOM
 * @private
 */
function removeOrderRowFromDOM(orderID) {
  const row = document.querySelector(`tr[onclick*="${orderID}"]`);
  if (row) row.remove();
}

/**
 * Helper to set field value
 * @private
 */
function setFieldValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value || '';
}

/**
 * Helper to get field value
 * @private
 */
function getFieldValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}
