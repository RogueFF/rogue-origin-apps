/**
 * Customer management feature
 * @module features/customers
 */

import { apiCall, fetchCustomers } from '../core/api.js';
import { getCustomers, setCustomers, addCustomer } from '../core/state.js';
import { openModal, closeModal, clearForm } from '../ui/modals.js';
import { showToast } from '../ui/toast.js';
import { withButtonLoading } from '../ui/loading.js';

const MODAL_ID = 'customer-modal';
const FORM_ID = 'customer-form';

/**
 * Load customers from API and update state
 */
export async function loadCustomers() {
  try {
    const result = await apiCall('getCustomers');
    if (result.success !== false) {
      const customers = result.customers || result || [];
      setCustomers(customers);
      populateCustomerDropdown();
    }
  } catch (error) {
    console.error('Error loading customers:', error);
    showToast('Error loading customers', 'error');
  }
}

/**
 * Populate customer dropdown in order form
 */
export function populateCustomerDropdown() {
  const select = document.getElementById('order-customer');
  if (!select) return;

  const customers = getCustomers();
  select.innerHTML = '<option value="">Select a customer...</option>';

  customers.forEach(customer => {
    const option = document.createElement('option');
    option.value = customer.id;
    option.textContent = customer.companyName;
    option.dataset.customer = JSON.stringify(customer);
    select.appendChild(option);
  });
}

/**
 * Open new customer modal
 */
export function openNewCustomerModal() {
  clearForm(FORM_ID);
  // Set default country
  const countryInput = document.getElementById('customer-country');
  if (countryInput) {
    countryInput.value = 'USA';
  }
  openModal(MODAL_ID);
}

/**
 * Close customer modal
 */
export function closeCustomerModal() {
  closeModal(MODAL_ID);
}

/**
 * Save customer (create new)
 */
export async function saveCustomer() {
  const customerData = gatherCustomerFormData();

  // Validation
  if (!customerData.companyName || !customerData.contactName) {
    showToast('Company Name and Contact Name are required', 'warning');
    return;
  }

  await withButtonLoading('customer-submit-btn', async () => {
    const result = await apiCall('saveCustomer', customerData, 'POST');

    if (result.success !== false) {
      closeCustomerModal();

      // Add to state and refresh dropdown
      if (result.customer) {
        addCustomer(result.customer);
      }
      await loadCustomers(); // Refresh full list to ensure sync

      showToast('Customer saved successfully!');
    } else {
      showToast('Error saving customer: ' + (result.error || 'Unknown error'), 'error');
    }
  }, 'Saving...');
}

/**
 * Gather customer form data
 * @private
 */
function gatherCustomerFormData() {
  const shipAddress = document.getElementById('customer-ship-address')?.value || '';
  const billAddress = document.getElementById('customer-bill-address')?.value;

  return {
    companyName: document.getElementById('customer-company')?.value || '',
    contactName: document.getElementById('customer-contact')?.value || '',
    email: document.getElementById('customer-email')?.value || '',
    phone: document.getElementById('customer-phone')?.value || '',
    shipToAddress: shipAddress,
    billToAddress: billAddress || shipAddress, // Default to ship address
    country: document.getElementById('customer-country')?.value || 'USA'
  };
}

/**
 * Populate customer info into order form when selected
 */
export function populateCustomerInfo() {
  const select = document.getElementById('order-customer');
  const selected = select?.options[select.selectedIndex];

  if (!selected || !selected.dataset.customer) return;

  const customer = JSON.parse(selected.dataset.customer);

  // Ship To
  setFieldValue('order-ship-contact', customer.contactName);
  setFieldValue('order-ship-company', customer.companyName);
  setFieldValue('order-ship-address', customer.shipToAddress);
  setFieldValue('order-ship-phone', customer.phone);
  setFieldValue('order-ship-email', customer.email);

  // Check "same as ship to" and copy
  const sameCheckbox = document.getElementById('order-sold-same');
  if (sameCheckbox) {
    sameCheckbox.checked = true;
    copySoldToFromShipTo();
  }
}

/**
 * Copy Sold To fields from Ship To
 */
export function copySoldToFromShipTo() {
  const sameCheckbox = document.getElementById('order-sold-same');
  if (!sameCheckbox?.checked) return;

  setFieldValue('order-sold-contact', getFieldValue('order-ship-contact'));
  setFieldValue('order-sold-company', getFieldValue('order-ship-company'));
  setFieldValue('order-sold-address', getFieldValue('order-ship-address'));
  setFieldValue('order-sold-phone', getFieldValue('order-ship-phone'));
  setFieldValue('order-sold-email', getFieldValue('order-ship-email'));
}

/**
 * Helper to set field value safely
 * @private
 */
function setFieldValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value || '';
}

/**
 * Helper to get field value safely
 * @private
 */
function getFieldValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}
