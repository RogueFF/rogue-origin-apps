/**
 * API communication layer
 * Handles all fetch requests to backend
 * @module core/api
 */

import { API_URL } from './config.js';

// Detect if running in Apps Script context
const isAppsScript = typeof google !== 'undefined' && google.script;

/**
 * Make an API call to the backend
 * Supports both Cloudflare Workers and Apps Script modes
 *
 * @param {string} action - API action name
 * @param {Object} params - Parameters to send
 * @param {string} method - HTTP method ('GET' or 'POST')
 * @returns {Promise<Object>} Response data
 * @throws {Error} On network or API error
 */
export async function apiCall(action, params = {}, method = 'GET') {
  if (isAppsScript) {
    return appsScriptCall(action, params);
  }
  return fetchCall(action, params, method);
}

/**
 * Apps Script mode API call
 * @private
 */
function appsScriptCall(action, params) {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler(reject)
      [action](params);
  });
}

/**
 * Fetch mode API call (Cloudflare Workers)
 * @private
 */
async function fetchCall(action, params, method) {
  let response;

  if (method === 'GET') {
    const queryParams = new URLSearchParams({ action });

    // Add params to query string
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        queryParams.set(key, typeof value === 'object' ? JSON.stringify(value) : value);
      }
    });

    response = await fetch(`${API_URL}?${queryParams.toString()}`);
  } else {
    response = await fetch(`${API_URL}?action=${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
  }

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  const raw = await response.json();

  // Unwrap Cloudflare/Vercel response wrapper
  return raw.data || raw;
}

/**
 * Validate password with backend
 * @param {string} password
 * @returns {Promise<Object>} { success, sessionToken, expiresIn } or { success: false, error }
 */
export async function validatePassword(password) {
  const url = `${API_URL}?action=validatePassword&password=${encodeURIComponent(password)}`;
  const response = await fetch(url);
  const raw = await response.json();
  return raw.data || raw;
}

// ============================================
// Specific API Calls (convenience wrappers)
// ============================================

/**
 * Load all customers
 * @returns {Promise<Array>}
 */
export async function fetchCustomers() {
  const result = await apiCall('getCustomers');
  return result.customers || result || [];
}

/**
 * Load all master orders
 * @returns {Promise<Array>}
 */
export async function fetchOrders() {
  const result = await apiCall('getMasterOrders');
  return result.orders || result || [];
}

/**
 * Load order details (shipments, payments)
 * @param {string} orderID
 * @returns {Promise<Object>}
 */
export async function fetchOrderDetails(orderID) {
  return apiCall('getOrderDetails', { orderID });
}

/**
 * Create a new customer
 * @param {Object} customer
 * @returns {Promise<Object>}
 */
export async function createCustomer(customer) {
  return apiCall('createCustomer', customer, 'POST');
}

/**
 * Create a new master order
 * @param {Object} order
 * @returns {Promise<Object>}
 */
export async function createOrder(order) {
  return apiCall('createMasterOrder', order, 'POST');
}

/**
 * Update an existing order
 * @param {Object} order
 * @returns {Promise<Object>}
 */
export async function updateOrderAPI(order) {
  return apiCall('updateMasterOrder', order, 'POST');
}

/**
 * Create a shipment
 * @param {Object} shipment
 * @returns {Promise<Object>}
 */
export async function createShipment(shipment) {
  return apiCall('createShipment', shipment, 'POST');
}

/**
 * Update a shipment
 * @param {Object} shipment
 * @returns {Promise<Object>}
 */
export async function updateShipmentAPI(shipment) {
  return apiCall('updateShipment', shipment, 'POST');
}

/**
 * Delete a shipment
 * @param {string} shipmentID
 * @returns {Promise<Object>}
 */
export async function deleteShipmentAPI(shipmentID) {
  return apiCall('deleteShipment', { shipmentID }, 'POST');
}

/**
 * Create a payment
 * @param {Object} payment
 * @returns {Promise<Object>}
 */
export async function createPayment(payment) {
  return apiCall('recordPayment', payment, 'POST');
}

/**
 * Update a payment
 * @param {Object} payment
 * @returns {Promise<Object>}
 */
export async function updatePaymentAPI(payment) {
  return apiCall('updatePayment', payment, 'POST');
}

/**
 * Delete a payment
 * @param {string} paymentID
 * @returns {Promise<Object>}
 */
export async function deletePaymentAPI(paymentID) {
  return apiCall('deletePayment', { paymentID }, 'POST');
}
