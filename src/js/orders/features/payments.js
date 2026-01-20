/**
 * Payment management feature
 * @module features/payments
 */

import { apiCall } from '../core/api.js';
import {
  getCurrentOrderID, getCachedPayments, setCachedPayments,
  getEditingPaymentID, setEditingPaymentID, invalidateCache
} from '../core/state.js';
import { openModal, closeModal, clearForm } from '../ui/modals.js';
import { showToast } from '../ui/toast.js';
import { formatCurrency, formatDate } from '../utils/format.js';

const MODAL_ID = 'payment-modal';
const FORM_ID = 'payment-form';
const DETAIL_MODAL_ID = 'payment-detail-modal';

/**
 * Open payment modal for current order
 * @param {string} orderID - Optional order ID override
 */
export function openPaymentModal(orderID = null) {
  const targetOrderID = orderID || getCurrentOrderID();
  if (!targetOrderID) {
    showToast('Please select an order first', 'warning');
    return;
  }

  setEditingPaymentID(null);
  clearForm(FORM_ID);

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
export function editPayment(paymentId) {
  const payments = getCachedPayments();
  const payment = payments.find(p => p.id === paymentId);
  if (!payment) {
    showToast('Payment not found', 'error');
    return;
  }

  setEditingPaymentID(paymentId);

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

  try {
    const action = editingId ? 'updatePayment' : 'recordPayment';
    const result = await apiCall(action, paymentData, 'POST');

    if (result.success !== false) {
      closePaymentModal();
      invalidateCache(orderID);

      // Refresh payments list
      await refreshPayments(orderID);

      showToast(editingId ? 'Payment updated!' : 'Payment recorded!');
    } else {
      showToast('Error saving payment: ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (error) {
    console.error('Error saving payment:', error);
    showToast('Error saving payment', 'error');
  }
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
export function openPaymentDetailModal(paymentId) {
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
