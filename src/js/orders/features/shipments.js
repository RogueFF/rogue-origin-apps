/**
 * Shipment management feature
 * @module features/shipments
 */

import { apiCall } from '../core/api.js';
import {
  getCurrentOrderID, getCachedShipments, setCachedShipments,
  invalidateCache, getOrders, setOrders
} from '../core/state.js';
import { openModal, closeModal, clearForm } from '../ui/modals.js';
import { showToast } from '../ui/toast.js';
import { formatCurrency, formatDate, formatNumber } from '../utils/format.js';
import { updateStats } from '../ui/stats.js';

const MODAL_ID = 'shipment-modal';
const FORM_ID = 'shipment-form';

// Prevent double submission
let isSavingShipment = false;

/**
 * Open shipment modal for current order
 * @param {string} orderID - Optional order ID override
 */
export function openShipmentModal(orderID = null) {
  const targetOrderID = orderID || getCurrentOrderID();
  if (!targetOrderID) {
    showToast('Please select an order first', 'warning');
    return;
  }

  clearForm(FORM_ID);
  delete document.getElementById(MODAL_ID)?.dataset.editingShipmentId;

  // Set today's date
  const dateInput = document.getElementById('shipment-date');
  if (dateInput) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }

  // Reset line items
  const tbody = document.getElementById('line-items-body');
  if (tbody) {
    tbody.innerHTML = '';
    addLineItem();
  }

  calculateShipmentTotal();

  // Store order ID
  const modal = document.getElementById(MODAL_ID);
  if (modal) modal.dataset.orderID = targetOrderID;

  openModal(MODAL_ID);
}

/**
 * Close shipment modal
 */
export function closeShipmentModal() {
  closeModal(MODAL_ID);
  delete document.getElementById(MODAL_ID)?.dataset.editingShipmentId;
}

/**
 * Edit existing shipment
 * @param {string} shipmentId
 */
export function editShipment(shipmentId) {
  const shipments = getCachedShipments();
  const shipment = shipments.find(s => s.id === shipmentId);
  if (!shipment) {
    showToast('Shipment not found', 'error');
    return;
  }

  // Store editing ID
  const modal = document.getElementById(MODAL_ID);
  if (modal) modal.dataset.editingShipmentId = shipmentId;

  // Populate form
  setFieldValue('shipment-date', shipment.shipmentDate ? shipment.shipmentDate.split('T')[0] : '');
  setFieldValue('shipment-carrier', shipment.carrier);
  setFieldValue('shipment-tracking', shipment.trackingNumber);
  setFieldValue('shipment-notes', shipment.notes);

  // Populate dimensions
  const dims = shipment.dimensions || {};
  setFieldValue('shipment-length', dims.length);
  setFieldValue('shipment-width', dims.width);
  setFieldValue('shipment-height', dims.height);
  setFieldValue('shipment-weight', dims.weight);

  // Populate line items
  let lineItems = shipment.lineItems || [];
  if (typeof lineItems === 'string') {
    try { lineItems = JSON.parse(lineItems); } catch (e) { lineItems = []; }
  }

  const tbody = document.getElementById('line-items-body');
  if (tbody && lineItems.length > 0) {
    tbody.innerHTML = lineItems.map(item => createLineItemRow(item)).join('');
  } else if (tbody) {
    tbody.innerHTML = '';
    addLineItem();
  }

  // Populate financials
  setFieldValue('shipment-discount', shipment.discount || 0);
  setFieldValue('shipment-freight', shipment.freightCost || 0);
  calculateShipmentTotal();

  openModal(MODAL_ID);
}

/**
 * Add a new line item row
 */
export function addLineItem() {
  const tbody = document.getElementById('line-items-body');
  if (!tbody) return;

  const row = createLineItemRow();
  tbody.insertAdjacentHTML('beforeend', row);
}

/**
 * Create line item row HTML
 * @private
 */
function createLineItemRow(item = {}) {
  return `
    <tr>
      <td><input type="text" class="form-input" value="${item.strain || ''}" placeholder="Lifter" list="strains-list"></td>
      <td>
        <select class="form-select">
          <option value="tops" ${item.type === 'tops' ? 'selected' : ''}>Tops</option>
          <option value="smalls" ${item.type === 'smalls' ? 'selected' : ''}>Smalls</option>
        </select>
      </td>
      <td><input type="number" class="form-input" step="0.01" value="${item.quantity || ''}" placeholder="5" oninput="window.shipmentActions.calculateLineTotal(this)"></td>
      <td><input type="number" class="form-input" step="1" value="${item.adjustmentKg || 0}" title="Manual adjustment (kg)"></td>
      <td><input type="number" class="form-input" step="0.01" value="${item.unitPrice || ''}" placeholder="350" oninput="window.shipmentActions.calculateLineTotal(this)"></td>
      <td><span class="line-item-total">$${formatNumber((item.quantity || 0) * (item.unitPrice || 0))}</span></td>
      <td>
        <button type="button" class="line-item-remove" onclick="window.shipmentActions.removeLineItem(this)">
          <i class="ph ph-trash"></i>
        </button>
      </td>
    </tr>
  `;
}

/**
 * Remove a line item row
 * @param {HTMLElement} btn - The remove button
 */
export function removeLineItem(btn) {
  const row = btn.closest('tr');
  if (row) {
    row.remove();
    calculateShipmentTotal();
  }
}

/**
 * Calculate line total when quantity or price changes
 * @param {HTMLElement} input - The input that changed
 */
export function calculateLineTotal(input) {
  const row = input.closest('tr');
  if (!row) return;

  const qty = parseFloat(row.children[2]?.querySelector('input')?.value) || 0;
  const price = parseFloat(row.children[4]?.querySelector('input')?.value) || 0;
  const totalSpan = row.querySelector('.line-item-total');

  if (totalSpan) {
    totalSpan.textContent = formatCurrency(qty * price);
  }

  calculateShipmentTotal();
}

/**
 * Calculate shipment totals
 */
export function calculateShipmentTotal() {
  const rows = document.querySelectorAll('#line-items-body tr');
  let subtotal = 0;

  rows.forEach(row => {
    const qty = parseFloat(row.children[2]?.querySelector('input')?.value) || 0;
    const price = parseFloat(row.children[4]?.querySelector('input')?.value) || 0;
    subtotal += qty * price;
  });

  const discount = parseFloat(document.getElementById('shipment-discount')?.value) || 0;
  const freight = parseFloat(document.getElementById('shipment-freight')?.value) || 0;
  const total = subtotal - discount + freight;

  const subtotalEl = document.getElementById('shipment-subtotal');
  const totalEl = document.getElementById('shipment-total');

  if (subtotalEl) subtotalEl.textContent = formatCurrency(subtotal);
  if (totalEl) totalEl.textContent = formatCurrency(total);
}

/**
 * Save shipment
 */
export async function saveShipment() {
  if (isSavingShipment) {
    console.log('Already saving, ignoring duplicate call');
    return false;
  }
  isSavingShipment = true;

  try {
    const modal = document.getElementById(MODAL_ID);
    const orderID = modal?.dataset.orderID || getCurrentOrderID();

    if (!orderID) {
      showToast('Please select an order first', 'error');
      return false;
    }

    const lineItems = collectLineItems();
    if (lineItems.length === 0) {
      showToast('Please add at least one line item with strain and quantity', 'warning');
      return false;
    }

    const dimensions = {
      length: parseFloat(getFieldValue('shipment-length')) || 0,
      width: parseFloat(getFieldValue('shipment-width')) || 0,
      height: parseFloat(getFieldValue('shipment-height')) || 0,
      weight: parseFloat(getFieldValue('shipment-weight')) || 0
    };

    const subtotal = parseFloat(document.getElementById('shipment-subtotal')?.textContent.replace(/[$,]/g, '')) || 0;
    const discount = parseFloat(getFieldValue('shipment-discount')) || 0;
    const freight = parseFloat(getFieldValue('shipment-freight')) || 0;
    const total = parseFloat(document.getElementById('shipment-total')?.textContent.replace(/[$,]/g, '')) || 0;

    const editingShipmentId = modal?.dataset.editingShipmentId;

    const shipmentData = {
      orderID,
      shipmentDate: getFieldValue('shipment-date'),
      startDateTime: getFieldValue('shipment-start-datetime') || null,
      carrier: getFieldValue('shipment-carrier'),
      dimensions,
      lineItems,
      subTotal: subtotal,
      discount,
      freightCost: freight,
      totalAmount: total,
      trackingNumber: getFieldValue('shipment-tracking'),
      notes: getFieldValue('shipment-notes')
    };

    if (editingShipmentId) {
      shipmentData.id = editingShipmentId;
    }

    const action = editingShipmentId ? 'updateShipment' : 'saveShipment';
    const result = await apiCall(action, shipmentData, 'POST');

    if (result.success !== false) {
      closeShipmentModal();
      invalidateCache(orderID);

      // Refresh shipments
      await refreshShipments(orderID);
      updateStats();

      showToast(editingShipmentId ? 'Shipment updated!' : 'Shipment saved!');
      return true;
    } else {
      showToast('Error saving shipment: ' + (result.error || 'Unknown error'), 'error');
      return false;
    }
  } catch (error) {
    console.error('Error saving shipment:', error);
    showToast('Error saving shipment', 'error');
    return false;
  } finally {
    isSavingShipment = false;
  }
}

/**
 * Save shipment and generate documents
 */
export async function saveShipmentAndGenerateDocs() {
  const saved = await saveShipment();
  if (saved) {
    // Trigger PDF generation
    window.pdfActions?.generateDocumentBundle?.();
  }
}

/**
 * Delete a shipment
 * @param {string} shipmentId
 */
export async function deleteShipment(shipmentId) {
  if (!confirm('Are you sure you want to delete this shipment?')) {
    return;
  }

  const orderID = getCurrentOrderID();

  try {
    const result = await apiCall('deleteShipment', { shipmentID: shipmentId }, 'POST');

    if (result.success !== false) {
      invalidateCache(orderID);
      await refreshShipments(orderID);
      updateStats();
      showToast('Shipment deleted');
    } else {
      showToast('Error deleting shipment: ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (error) {
    console.error('Error deleting shipment:', error);
    showToast('Error deleting shipment', 'error');
  }
}

/**
 * Render shipments list in detail panel
 * @param {Array} shipments
 */
export function renderShipments(shipments) {
  const container = document.getElementById('shipments-list');
  if (!container) return;

  setCachedShipments(shipments);

  if (!shipments || shipments.length === 0) {
    container.innerHTML = '<div class="empty-state">No shipments yet</div>';
    return;
  }

  container.innerHTML = shipments.map(shipment => `
    <div class="shipment-card ${shipment.isPending ? 'pending' : ''}">
      <div class="shipment-header">
        <span class="shipment-invoice">${shipment.invoiceNumber || 'New Shipment'}</span>
        <span class="shipment-amount">${formatCurrency(shipment.totalAmount)}</span>
      </div>
      <div class="shipment-meta">
        <span class="shipment-date">${formatDate(shipment.shipmentDate)}</span>
        ${shipment.carrier ? `<span class="shipment-carrier">${shipment.carrier}</span>` : ''}
      </div>
      <div class="shipment-actions">
        <button class="btn-icon" onclick="window.shipmentActions.edit('${shipment.id}')" title="Edit">
          <i class="ph ph-pencil-simple"></i>
        </button>
        <button class="btn-icon" onclick="window.shipmentActions.delete('${shipment.id}')" title="Delete" style="color: var(--danger);">
          <i class="ph ph-trash"></i>
        </button>
      </div>
    </div>
  `).join('');
}

/**
 * Collect line items from form
 * @private
 */
function collectLineItems() {
  const rows = document.querySelectorAll('#line-items-body tr');
  const items = [];

  rows.forEach(row => {
    const strain = row.children[0]?.querySelector('input')?.value?.trim();
    const type = row.children[1]?.querySelector('select')?.value || 'tops';
    const qty = parseFloat(row.children[2]?.querySelector('input')?.value) || 0;
    const adjustment = parseFloat(row.children[3]?.querySelector('input')?.value) || 0;
    const price = parseFloat(row.children[4]?.querySelector('input')?.value) || 0;

    if (strain && qty > 0) {
      items.push({
        strain,
        type,
        quantity: qty,
        adjustmentKg: adjustment,
        unitPrice: price,
        total: qty * price
      });
    }
  });

  return items;
}

/**
 * Refresh shipments for an order
 * @param {string} orderID
 */
async function refreshShipments(orderID) {
  try {
    const result = await apiCall('getShipments', { orderID });
    if (result.success !== false) {
      renderShipments(result.shipments || []);
    }
  } catch (error) {
    console.error('Error refreshing shipments:', error);
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
