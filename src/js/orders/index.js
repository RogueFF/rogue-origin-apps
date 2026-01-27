/**
 * Orders Module Entry Point
 * Wires together all modules and exposes functions to window for HTML onclick handlers
 * @module orders/index
 */

// ============================================
// Core Imports
// ============================================
import { API_URL } from './core/config.js';
import {
  getState, setCustomers, setOrders, setCurrentOrderID,
  getOrders, getCustomers, getCurrentOrderID,
  resetState, clearSessionState
} from './core/state.js';
import { apiCall, cancelAllRequests } from './core/api.js';

// ============================================
// Event Cleanup Import (for memory leak prevention)
// ============================================
import { registerEventListener, cleanupAllListeners } from '../modules/event-cleanup.js';

// ============================================
// UI Imports
// ============================================
import { initTheme, toggleTheme } from './ui/theme.js';
import { showToast, showError, showSuccess, showWarning } from './ui/toast.js';
import { renderOrdersTable } from './ui/table.js';
import { updateStats } from './ui/stats.js';
import { initModals } from './ui/modals.js';

// ============================================
// Feature Imports
// ============================================
import { checkAuth, handleLogin, handleLogout } from './features/auth.js';
import {
  loadCustomers, populateCustomerDropdown,
  openNewCustomerModal, closeCustomerModal, saveCustomer,
  populateCustomerInfo, copySoldToFromShipTo
} from './features/customers.js';
import {
  loadOrders, openNewOrderModal, closeOrderModal,
  editOrder, saveMasterOrder, deleteOrder
} from './features/orders.js';
import {
  openShipmentModal, closeShipmentModal, editShipment,
  saveShipment, saveShipmentAndGenerateDocs, deleteShipment,
  addLineItem, removeLineItem, calculateLineTotal, calculateShipmentTotal,
  renderShipments,
  openShipmentDetailModal, closeShipmentDetailModal, editShipmentFromDetail
} from './features/shipments.js';
import {
  openPaymentModal, closePaymentModal, editPayment,
  savePayment, deletePayment,
  openPaymentDetailModal, closePaymentDetailModal, editPaymentFromDetail,
  renderPayments
} from './features/payments.js';
import {
  openDetailPanel, closeDetailPanel, switchTab, refreshDetailPanel
} from './features/detail-panel.js';
import {
  openShopifyImportModal, closeShopifyImportModal,
  handleShopifyFileUpload, confirmShopifyImport
} from './features/shopify-import.js';
import {
  generateDocumentBundle, generateSingleInvoice, generateSinglePackingSlip
} from './features/pdf-generator.js';

// ============================================
// Window Action Groups (for HTML onclick)
// ============================================

/**
 * Order-related actions
 */
window.orderActions = {
  openDetail: openDetailPanel,
  closeDetail: closeDetailPanel,
  editOrder,
  deleteOrder,
  openCustomerModal: openNewCustomerModal,
  openOrderModal: openNewOrderModal,
  openShipmentModal,
  openPaymentModal,
  openShopifyImportModal
};

/**
 * Shipment-related actions
 */
window.shipmentActions = {
  openDetail: openShipmentDetailModal,
  edit: editShipment,
  delete: deleteShipment,
  addLine: addLineItem,
  removeLine: removeLineItem,
  removeLineItem,
  calculateLineTotal,
  calculate: calculateShipmentTotal
};

/**
 * Payment-related actions
 */
window.paymentActions = {
  edit: editPayment,
  delete: deletePayment,
  openDetail: openPaymentDetailModal
};

/**
 * PDF-related actions
 */
window.pdfActions = {
  generateDocumentBundle,
  generateInvoice: generateSingleInvoice,
  generatePackingSlip: generateSinglePackingSlip
};

// ============================================
// Global Functions (backwards compatibility)
// ============================================

// Auth
window.handleLogin = handleLogin;
window.handleLogout = handleLogout;

// Theme
window.toggleTheme = toggleTheme;

// Customers
window.openNewCustomerModal = openNewCustomerModal;
window.closeCustomerModal = closeCustomerModal;
window.saveCustomer = saveCustomer;
window.populateCustomerInfo = populateCustomerInfo;
window.copySoldToFromShipTo = copySoldToFromShipTo;

// Orders
window.openNewOrderModal = openNewOrderModal;
window.closeOrderModal = closeOrderModal;
window.editOrder = editOrder;
window.deleteOrder = deleteOrder;
window.saveMasterOrder = saveMasterOrder;

// Shipments
window.openShipmentModal = openShipmentModal;
window.closeShipmentModal = closeShipmentModal;
window.saveShipment = saveShipment;
window.saveShipmentAndGenerateDocs = saveShipmentAndGenerateDocs;
window.addLineItem = addLineItem;
window.removeLineItem = removeLineItem;
window.calculateLineTotal = calculateLineTotal;
window.calculateShipmentTotal = calculateShipmentTotal;

// Payments
window.openPaymentModal = openPaymentModal;
window.closePaymentModal = closePaymentModal;
window.savePayment = savePayment;
window.openPaymentDetailModal = openPaymentDetailModal;
window.closePaymentDetailModal = closePaymentDetailModal;
window.editPaymentFromDetail = editPaymentFromDetail;

// Shipment Detail Modal
window.openShipmentDetailModal = openShipmentDetailModal;
window.closeShipmentDetailModal = closeShipmentDetailModal;
window.editShipmentFromDetail = editShipmentFromDetail;

// Detail Panel
window.openDetailPanel = openDetailPanel;
window.closeDetailPanel = closeDetailPanel;
window.switchTab = switchTab;

// Shopify Import
window.openShopifyImportModal = openShopifyImportModal;
window.closeShopifyImportModal = closeShopifyImportModal;
window.handleShopifyFileUpload = handleShopifyFileUpload;
window.confirmShopifyImport = confirmShopifyImport;

// PDF
window.generateDocumentBundle = generateDocumentBundle;

// Toast (for inline error handlers)
window.showToast = showToast;

// ============================================
// Initialization
// ============================================

/**
 * Set today's date on date inputs
 */
function setTodayDates() {
  const today = new Date().toISOString().split('T')[0];
  const dateInputs = ['shipment-date', 'payment-date'];
  dateInputs.forEach(id => {
    const input = document.getElementById(id);
    if (input && !input.value) {
      input.value = today;
    }
  });
}

/**
 * Load initial data
 */
async function loadInitialData() {
  try {
    // Load in parallel for speed
    const [customersResult, ordersResult] = await Promise.all([
      apiCall('getCustomers'),
      apiCall('getMasterOrders')
    ]);

    // Process customers
    const customers = customersResult.customers || customersResult || [];
    setCustomers(customers);
    populateCustomerDropdown();

    // Process orders
    const orders = ordersResult.orders || ordersResult || [];
    setOrders(orders);
    renderOrdersTable();

    // Update stats
    updateStats();

    console.log(`Loaded ${customers.length} customers and ${orders.length} orders`);
  } catch (error) {
    console.error('Error loading initial data:', error);
    showToast('Error loading data. Please refresh the page.', 'error');
  }
}

/**
 * Main initialization
 */
const initHandler = async () => {
  console.log('Orders module initializing...');

  // Initialize theme
  initTheme();

  // Initialize modal behaviors
  initModals();

  // Set default dates
  setTodayDates();

  // Check authentication
  if (!checkAuth()) {
    console.log('Authentication required');
    return;
  }

  // Load data
  await loadInitialData();

  console.log('Orders module initialized');
};

// Register DOMContentLoaded with cleanup tracking
registerEventListener(document, 'DOMContentLoaded', initHandler);

// ============================================
// Cleanup
// ============================================

/**
 * Clean up on page unload
 * Prevents memory leaks by canceling pending requests, clearing state, and removing all event listeners
 */
function cleanup() {
  console.log('Orders module cleanup starting...');
  
  // Cancel any pending API requests
  cancelAllRequests();
  
  // Clear application state
  resetState();
  
  // Remove all registered event listeners
  cleanupAllListeners();
  
  console.log('Orders module cleanup complete');
}

// Register cleanup handlers with tracking
registerEventListener(window, 'beforeunload', cleanup);
registerEventListener(window, 'pagehide', cleanup);

// ============================================
// Global Error Handler
// ============================================

/**
 * Handle uncaught errors in async operations
 */
const unhandledRejectionHandler = (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  // Don't show toast for aborted requests
  if (event.reason?.name !== 'AbortError') {
    showToast('An unexpected error occurred', 'error');
  }
};

// Register error handler with tracking
registerEventListener(window, 'unhandledrejection', unhandledRejectionHandler);

// ============================================
// Export for potential external use
// ============================================
export {
  loadInitialData,
  loadCustomers,
  loadOrders,
  renderOrdersTable,
  updateStats,
  cleanup
};
