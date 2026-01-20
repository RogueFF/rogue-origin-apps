/**
 * Centralized state management
 * Replaces 8+ global variables with controlled access
 * @module core/state
 */

import { CACHE_TTL } from './config.js';

// Private state object
const state = {
  customers: [],
  orders: [],
  currentOrderID: null,
  editingOrderID: null,
  editingPaymentID: null,
  cachedShipments: [],
  cachedPayments: [],
  pdfLibrariesLoaded: false,
  parsedShopifyData: []
};

// Order detail cache with TTL
const orderCache = new Map();

// ============================================
// State Getters
// ============================================

/**
 * Get entire state (read-only snapshot)
 * @returns {Object} Current state
 */
export function getState() {
  return { ...state };
}

/**
 * Get customers array
 * @returns {Array} Customers
 */
export function getCustomers() {
  return state.customers;
}

/**
 * Get orders array
 * @returns {Array} Orders
 */
export function getOrders() {
  return state.orders;
}

/**
 * Get current order ID (detail panel)
 * @returns {string|null} Order ID
 */
export function getCurrentOrderID() {
  return state.currentOrderID;
}

/**
 * Get editing order ID (edit modal)
 * @returns {string|null} Order ID
 */
export function getEditingOrderID() {
  return state.editingOrderID;
}

/**
 * Get editing payment ID
 * @returns {string|null} Payment ID
 */
export function getEditingPaymentID() {
  return state.editingPaymentID;
}

/**
 * Check if PDF libraries are loaded
 * @returns {boolean}
 */
export function isPdfLibrariesLoaded() {
  return state.pdfLibrariesLoaded;
}

/**
 * Get parsed Shopify import data
 * @returns {Array}
 */
export function getParsedShopifyData() {
  return state.parsedShopifyData;
}

/**
 * Get cached shipments
 * @returns {Array}
 */
export function getCachedShipments() {
  return state.cachedShipments;
}

/**
 * Get cached payments
 * @returns {Array}
 */
export function getCachedPayments() {
  return state.cachedPayments;
}

// ============================================
// State Setters
// ============================================

/**
 * Set customers array
 * @param {Array} data
 */
export function setCustomers(data) {
  state.customers = Array.isArray(data) ? data : [];
}

/**
 * Set orders array
 * @param {Array} data
 */
export function setOrders(data) {
  state.orders = Array.isArray(data) ? data : [];
}

/**
 * Set current order ID
 * @param {string|null} id
 */
export function setCurrentOrderID(id) {
  state.currentOrderID = id;
}

/**
 * Set editing order ID
 * @param {string|null} id
 */
export function setEditingOrderID(id) {
  state.editingOrderID = id;
}

/**
 * Set editing payment ID
 * @param {string|null} id
 */
export function setEditingPaymentID(id) {
  state.editingPaymentID = id;
}

/**
 * Set PDF libraries loaded flag
 * @param {boolean} loaded
 */
export function setPdfLibrariesLoaded(loaded) {
  state.pdfLibrariesLoaded = loaded;
}

/**
 * Set parsed Shopify data
 * @param {Array} data
 */
export function setParsedShopifyData(data) {
  state.parsedShopifyData = Array.isArray(data) ? data : [];
}

/**
 * Set cached shipments
 * @param {Array} data
 */
export function setCachedShipments(data) {
  state.cachedShipments = Array.isArray(data) ? data : [];
}

/**
 * Set cached payments
 * @param {Array} data
 */
export function setCachedPayments(data) {
  state.cachedPayments = Array.isArray(data) ? data : [];
}

// ============================================
// Order Detail Cache
// ============================================

/**
 * Get cached order data if not expired
 * @param {string} orderID
 * @returns {Object|null} Cached data or null
 */
export function getCachedOrder(orderID) {
  const cached = orderCache.get(orderID);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

/**
 * Set cached order data
 * @param {string} orderID
 * @param {Object} data
 */
export function setCachedOrder(orderID, data) {
  orderCache.set(orderID, {
    data,
    timestamp: Date.now()
  });
}

/**
 * Invalidate cached order (after mutations)
 * @param {string} orderID - Specific order, or null for all
 */
export function invalidateCache(orderID = null) {
  if (orderID) {
    orderCache.delete(orderID);
  } else {
    orderCache.clear();
  }
}

/**
 * Find order by ID
 * @param {string} orderID
 * @returns {Object|undefined}
 */
export function findOrder(orderID) {
  return state.orders.find(o => o.orderID === orderID);
}

/**
 * Find customer by ID
 * @param {string} customerID
 * @returns {Object|undefined}
 */
export function findCustomer(customerID) {
  return state.customers.find(c => c.customerID === customerID);
}

/**
 * Update an order in state
 * @param {string} orderID
 * @param {Object} updates
 */
export function updateOrder(orderID, updates) {
  const index = state.orders.findIndex(o => o.orderID === orderID);
  if (index !== -1) {
    state.orders[index] = { ...state.orders[index], ...updates };
  }
}

/**
 * Add a new order to state
 * @param {Object} order
 */
export function addOrder(order) {
  state.orders.unshift(order);
}

/**
 * Add a new customer to state
 * @param {Object} customer
 */
export function addCustomer(customer) {
  state.customers.push(customer);
}
