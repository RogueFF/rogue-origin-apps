/**
 * API communication layer
 * Handles all fetch requests to backend with error handling, timeouts, and retries
 * @module core/api
 */

import { API_URL } from './config.js';

// Detect if running in Apps Script context
const isAppsScript = typeof google !== 'undefined' && google.script;

// Default timeout (15 seconds)
const DEFAULT_TIMEOUT = 15000;

// Retry configuration
const MAX_RETRIES = 2;
const RETRY_DELAY = 1000;

// Active request controllers for cancellation
const activeRequests = new Map();

/**
 * Make an API call to the backend
 * Supports both Cloudflare Workers and Apps Script modes
 *
 * @param {string} action - API action name
 * @param {Object} params - Parameters to send
 * @param {string} method - HTTP method ('GET' or 'POST')
 * @param {Object} options - Additional options
 * @param {number} options.timeout - Request timeout in ms
 * @param {boolean} options.retry - Whether to retry on failure
 * @param {string} options.requestId - Unique ID for cancellation
 * @returns {Promise<Object>} Response data
 * @throws {Error} On network or API error
 */
export async function apiCall(action, params = {}, method = 'GET', options = {}) {
  const { timeout = DEFAULT_TIMEOUT, retry = true, requestId } = options;

  if (isAppsScript) {
    return appsScriptCall(action, params);
  }

  return fetchWithRetry(action, params, method, { timeout, retry, requestId });
}

/**
 * Fetch with retry logic
 * @private
 */
async function fetchWithRetry(action, params, method, options) {
  const { timeout, retry, requestId } = options;
  let lastError;

  for (let attempt = 0; attempt <= (retry ? MAX_RETRIES : 0); attempt++) {
    try {
      if (attempt > 0) {
        // Wait before retry
        await sleep(RETRY_DELAY * attempt);
        console.log(`Retrying ${action} (attempt ${attempt + 1})`);
      }

      return await fetchCall(action, params, method, timeout, requestId);
    } catch (error) {
      lastError = error;

      // Don't retry on client errors (4xx) or abort
      if (error.name === 'AbortError' || (error.status >= 400 && error.status < 500)) {
        throw error;
      }
    }
  }

  throw lastError;
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
async function fetchCall(action, params, method, timeout, requestId) {
  // Create abort controller for timeout and cancellation
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // Track request for cancellation
  if (requestId) {
    cancelRequest(requestId); // Cancel any existing request with same ID
    activeRequests.set(requestId, controller);
  }

  try {
    let response;

    if (method === 'GET') {
      const queryParams = new URLSearchParams({ action });

      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          queryParams.set(key, typeof value === 'object' ? JSON.stringify(value) : value);
        }
      });

      response = await fetch(`${API_URL}?${queryParams.toString()}`, {
        signal: controller.signal
      });
    } else {
      response = await fetch(`${API_URL}?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: controller.signal
      });
    }

    if (!response.ok) {
      const error = new Error(`API error: ${response.status} ${response.statusText}`);
      error.status = response.status;
      throw error;
    }

    const raw = await response.json();

    // Check for API-level errors
    if (raw.success === false && raw.error) {
      const error = new Error(raw.error);
      error.status = 400;
      throw error;
    }

    // Unwrap Cloudflare/Vercel response wrapper
    return raw.data || raw;
  } finally {
    clearTimeout(timeoutId);
    if (requestId) {
      activeRequests.delete(requestId);
    }
  }
}

/**
 * Cancel a pending request by ID
 * @param {string} requestId
 */
export function cancelRequest(requestId) {
  const controller = activeRequests.get(requestId);
  if (controller) {
    controller.abort();
    activeRequests.delete(requestId);
  }
}

/**
 * Cancel all pending requests
 */
export function cancelAllRequests() {
  activeRequests.forEach(controller => controller.abort());
  activeRequests.clear();
}

/**
 * Sleep helper
 * @private
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
