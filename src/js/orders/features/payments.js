/**
 * Payment management feature
 * @module features/payments
 */

import { apiCall } from '../core/api.js';
import {
  getCurrentOrderID, getCachedPayments, setCachedPayments,
  getEditingPaymentID, setEditingPaymentID, invalidateCache,
  getCachedShipments
} from '../core/state.js';
import { openModal, closeModal, clearForm } from '../ui/modals.js';
import { showToast } from '../ui/toast.js';
import { formatCurrency, formatDate } from '../utils/format.js';
import { withButtonLoading } from '../ui/loading.js';

const MODAL_ID = 'payment-modal';
const FORM_ID = 'payment-form';
const DETAIL_MODAL_ID = 'payment-detail-modal';

// Track selected shipments for linking
let selectedShipmentIds = [];

/**
 * Open payment modal for current order
 * @param {string} orderID - Optional order ID override
 */
export async function openPaymentModal(orderID = null) {
  const targetOrderID = orderID || getCurrentOrderID();
  if (!targetOrderID) {
    showToast('Please select an order first', 'warning');
    return;
  }

  setEditingPaymentID(null);
  clearForm(FORM_ID);
  selectedShipmentIds = [];

  // Set today's date
  const dateInput = document.getElementById('payment-date');
  if (dateInput) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }

  // Set default method
  const methodSelect = document.getElementById('payment-method');
  if (methodSelect) {
    methodSelect.value = 'Wire';
  }

  // Update modal title
  const titleEl = document.getElementById('payment-modal-title');
  if (titleEl) titleEl.textContent = 'Record Payment';

  const submitBtn = document.getElementById('payment-submit-btn');
  if (submitBtn) submitBtn.textContent = 'Record Payment';

  // Store order ID for save
  const modal = document.getElementById(MODAL_ID);
  if (modal) modal.dataset.orderID = targetOrderID;

  // Load and display shipments for linking
  await loadShipmentsForLinking(targetOrderID);

  openModal(MODAL_ID);
}

/**
 * Close payment modal
 */
export function closePaymentModal() {
  closeModal(MODAL_ID);
  setEditingPaymentID(null);
}

/**
 * Edit existing payment
 * @param {string} paymentId
 */
export async function editPayment(paymentId) {
  const payments = getCachedPayments();
  const payment = payments.find(p => p.id === paymentId);
  if (!payment) {
    showToast('Payment not found', 'error');
    return;
  }

  setEditingPaymentID(paymentId);
  selectedShipmentIds = [];

  // Populate form
  setFieldValue('payment-amount', payment.amount);
  setFieldValue('payment-date', payment.paymentDate ? payment.paymentDate.split('T')[0] : '');
  setFieldValue('payment-method', payment.method || 'Wire');
  setFieldValue('payment-reference', payment.reference);
  setFieldValue('payment-notes', payment.notes);

  // Update modal title and button
  const titleEl = document.getElementById('payment-modal-title');
  if (titleEl) titleEl.textContent = 'Edit Payment';

  const submitBtn = document.getElementById('payment-submit-btn');
  if (submitBtn) submitBtn.textContent = 'Update Payment';

  // Load shipments and existing links
  const orderID = payment.orderID || getCurrentOrderID();
  await loadShipmentsForLinking(orderID, paymentId);

  openModal(MODAL_ID);
}

/**
 * Save payment (create or update)
 */
export async function savePayment() {
  const orderID = getCurrentOrderID() || document.getElementById(MODAL_ID)?.dataset.orderID;
  if (!orderID) {
    showToast('No order selected', 'error');
    return;
  }

  const editingId = getEditingPaymentID();

  const paymentData = {
    orderID,
    amount: parseFloat(getFieldValue('payment-amount')) || 0,
    paymentDate: getFieldValue('payment-date'),
    method: getFieldValue('payment-method') || 'Wire',
    reference: getFieldValue('payment-reference'),
    notes: getFieldValue('payment-notes')
  };

  // Validation
  if (paymentData.amount <= 0) {
    showToast('Please enter a valid payment amount', 'warning');
    return;
  }

  if (!paymentData.paymentDate) {
    showToast('Please select a payment date', 'warning');
    return;
  }

  // Add ID if editing
  if (editingId) {
    paymentData.id = editingId;
  }

  // Include linked shipment IDs
  paymentData.linkedShipmentIds = selectedShipmentIds;

  const isEditing = !!editingId;
  await withButtonLoading('payment-submit-btn', async () => {
    // Backend uses savePayment for both create and update
    const result = await apiCall('savePayment', paymentData, 'POST');

    if (result.success !== false) {
      const paymentId = result.payment?.id || editingId;

      // Save shipment links
      if (paymentId && selectedShipmentIds.length > 0) {
        await savePaymentShipmentLinks(paymentId, selectedShipmentIds);
      } else if (paymentId && isEditing) {
        // Clear existing links if none selected during edit
        await clearPaymentShipmentLinks(paymentId);
      }

      closePaymentModal();
      invalidateCache(orderID);

      // Refresh payments and shipments list (to update payment status)
      await refreshPayments(orderID);
      await refreshShipmentPaymentStatus(orderID);

      showToast(isEditing ? 'Payment updated!' : 'Payment recorded!');
    } else {
      showToast('Error saving payment: ' + (result.error || 'Unknown error'), 'error');
    }
  }, isEditing ? 'Updating...' : 'Recording...');
}

/**
 * Delete a payment
 * @param {string} paymentId
 */
export async function deletePayment(paymentId) {
  if (!confirm('Are you sure you want to delete this payment?')) {
    return;
  }

  const orderID = getCurrentOrderID();

  try {
    const result = await apiCall('deletePayment', { paymentID: paymentId }, 'POST');

    if (result.success !== false) {
      invalidateCache(orderID);
      await refreshPayments(orderID);
      showToast('Payment deleted');
    } else {
      showToast('Error deleting payment: ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (error) {
    console.error('Error deleting payment:', error);
    showToast('Error deleting payment', 'error');
  }
}

/**
 * Open payment detail modal
 * @param {string} paymentId
 */
export async function openPaymentDetailModal(paymentId) {
  const payments = getCachedPayments();
  const payment = payments.find(p => p.id === paymentId);
  if (!payment) return;

  // Populate detail fields
  setDetailValue('detail-payment-amount', formatCurrency(payment.amount));
  setDetailValue('detail-payment-date', formatDate(payment.paymentDate));
  setDetailValue('detail-payment-method', payment.method || '-');
  setDetailValue('detail-payment-reference', payment.reference || '-');
  setDetailValue('detail-payment-notes', payment.notes || '-');
  setDetailValue('detail-payment-recorded', payment.createdAt ? formatDate(payment.createdAt) : '-');

  // Load and display linked shipments
  await loadLinkedShipmentsForDetail(paymentId);

  // Store payment ID for edit button
  const editBtn = document.getElementById('detail-edit-btn');
  if (editBtn) editBtn.dataset.paymentId = paymentId;

  openModal(DETAIL_MODAL_ID);
}

/**
 * Close payment detail modal
 */
export function closePaymentDetailModal() {
  closeModal(DETAIL_MODAL_ID);
}

/**
 * Edit payment from detail modal
 */
export function editPaymentFromDetail() {
  const editBtn = document.getElementById('detail-edit-btn');
  const paymentId = editBtn?.dataset.paymentId;
  if (paymentId) {
    closePaymentDetailModal();
    editPayment(paymentId);
  }
}

/**
 * Render payments list in detail panel
 * @param {Array} payments
 */
export function renderPayments(payments) {
  const container = document.getElementById('payments-list');
  if (!container) return;

  setCachedPayments(payments);

  if (!payments || payments.length === 0) {
    container.innerHTML = '<div class="empty-state">No payments recorded</div>';
    return;
  }

  container.innerHTML = payments.map(payment => `
    <div class="payment-card" onclick="window.paymentActions.openDetail('${payment.id}')">
      <div class="payment-header">
        <span class="payment-amount">${formatCurrency(payment.amount)}</span>
        <span class="payment-method">${payment.method || 'Unknown'}</span>
      </div>
      <div class="payment-meta">
        <span class="payment-date">${formatDate(payment.paymentDate)}</span>
        ${payment.reference ? `<span class="payment-ref">#${payment.reference}</span>` : ''}
      </div>
      <div class="payment-actions" onclick="event.stopPropagation()">
        <button class="btn-icon" onclick="window.paymentActions.edit('${payment.id}')" title="Edit">
          <i class="ph ph-pencil-simple"></i>
        </button>
        <button class="btn-icon" onclick="window.paymentActions.delete('${payment.id}')" title="Delete" style="color: var(--danger);">
          <i class="ph ph-trash"></i>
        </button>
      </div>
    </div>
  `).join('');
}

/**
 * Refresh payments for an order
 * @param {string} orderID
 */
async function refreshPayments(orderID) {
  try {
    const result = await apiCall('getPayments', { orderID });
    if (result.success !== false) {
      renderPayments(result.payments || []);
    }
  } catch (error) {
    console.error('Error refreshing payments:', error);
  }
}

// Helper functions
function setFieldValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value || '';
}

function getFieldValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

function setDetailValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || '';
}

/**
 * Load shipments for linking in payment modal
 * @param {string} orderID
 * @param {string} [paymentId] - If editing, load existing links
 */
async function loadShipmentsForLinking(orderID, paymentId = null) {
  const container = document.getElementById('payment-shipments-list');
  if (!container) return;

  container.innerHTML = '<span class="text-muted">Loading shipments...</span>';

  try {
    // Get shipments from cache or fetch
    let shipments = getCachedShipments();
    if (!shipments || shipments.length === 0) {
      const result = await apiCall('getShipments', { orderID });
      shipments = result.shipments || [];
    }

    // If editing, get existing links
    let linkedIds = [];
    if (paymentId) {
      const linksResult = await apiCall('getPaymentLinks', { paymentID: paymentId });
      linkedIds = (linksResult.links || []).map(l => l.shipmentId);
    }
    selectedShipmentIds = [...linkedIds];

    if (shipments.length === 0) {
      container.innerHTML = '<span class="text-muted">No shipments to link</span>';
      return;
    }

    container.innerHTML = shipments.map(shipment => {
      const isLinked = linkedIds.includes(shipment.id);
      return `
        <label class="shipment-checkbox-item ${isLinked ? 'selected' : ''}" data-shipment-id="${shipment.id}">
          <input type="checkbox" ${isLinked ? 'checked' : ''} onchange="window.toggleShipmentSelection('${shipment.id}', this)">
          <div class="shipment-checkbox-info">
            <div>
              <span class="shipment-checkbox-label">${shipment.invoiceNumber || 'No Invoice'}</span>
              <span class="shipment-checkbox-date">${formatDate(shipment.shipmentDate)}</span>
            </div>
            <span class="shipment-checkbox-amount">${formatCurrency(shipment.totalAmount)}</span>
          </div>
        </label>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading shipments for linking:', error);
    container.innerHTML = '<span class="text-muted">Error loading shipments</span>';
  }
}

/**
 * Toggle shipment selection for payment linking
 * @param {string} shipmentId
 * @param {HTMLInputElement} checkbox
 */
export function toggleShipmentSelection(shipmentId, checkbox) {
  const item = checkbox.closest('.shipment-checkbox-item');
  if (checkbox.checked) {
    if (!selectedShipmentIds.includes(shipmentId)) {
      selectedShipmentIds.push(shipmentId);
    }
    item?.classList.add('selected');
  } else {
    selectedShipmentIds = selectedShipmentIds.filter(id => id !== shipmentId);
    item?.classList.remove('selected');
  }
}

// Expose to window for onclick
window.toggleShipmentSelection = toggleShipmentSelection;

/**
 * Save payment-shipment links
 * @param {string} paymentId
 * @param {string[]} shipmentIds
 */
async function savePaymentShipmentLinks(paymentId, shipmentIds) {
  try {
    // Clear existing links first
    await apiCall('deletePaymentLink', { paymentId, all: true }, 'POST');

    // Create new links
    for (const shipmentId of shipmentIds) {
      await apiCall('savePaymentLink', { paymentId, shipmentId }, 'POST');
    }
  } catch (error) {
    console.error('Error saving payment-shipment links:', error);
  }
}

/**
 * Clear all links for a payment
 * @param {string} paymentId
 */
async function clearPaymentShipmentLinks(paymentId) {
  try {
    await apiCall('deletePaymentLink', { paymentId, all: true }, 'POST');
  } catch (error) {
    console.error('Error clearing payment-shipment links:', error);
  }
}

/**
 * Load linked shipments for payment detail modal
 * @param {string} paymentId
 */
async function loadLinkedShipmentsForDetail(paymentId) {
  const container = document.getElementById('detail-payment-shipments');
  if (!container) return;

  try {
    const linksResult = await apiCall('getPaymentLinks', { paymentID: paymentId });
    const links = linksResult.links || [];

    if (links.length === 0) {
      container.innerHTML = '<span class="text-muted">No linked shipments</span>';
      return;
    }

    // Get shipment details
    const shipments = getCachedShipments() || [];
    container.innerHTML = links.map(link => {
      const shipment = shipments.find(s => s.id === link.shipmentId);
      return `
        <div class="linked-shipment-item">
          <span class="linked-shipment-invoice">${shipment?.invoiceNumber || link.shipmentId}</span>
          <span class="linked-shipment-amount">${formatCurrency(shipment?.totalAmount || 0)}</span>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading linked shipments:', error);
    container.innerHTML = '<span class="text-muted">Error loading linked shipments</span>';
  }
}

/**
 * Refresh shipment payment status after payment changes
 * @param {string} orderID
 */
async function refreshShipmentPaymentStatus(orderID) {
  // Trigger shipment list refresh to update payment status badges
  const { renderShipments } = await import('./shipments.js');
  try {
    const result = await apiCall('getShipments', { orderID });
    if (result.success !== false) {
      // Get payment status for each shipment
      const shipments = result.shipments || [];
      for (const shipment of shipments) {
        const statusResult = await apiCall('getShipmentPaymentStatus', { shipmentId: shipment.id });
        if (statusResult.success !== false) {
          shipment.paymentStatus = statusResult.status;
          shipment.paidAmount = statusResult.paidAmount;
        }
      }
      renderShipments(shipments);
    }
  } catch (error) {
    console.error('Error refreshing shipment payment status:', error);
  }
}
