# Orders Page Optimization Design

**Date**: 2026-01-20
**Status**: Approved
**Scope**: Architecture refactor + Performance + UX + Code Quality

---

## Overview

Refactor the 3,824-line monolithic `orders.html` (148KB) into a professional ES6 module architecture, then apply performance, UX, and code quality improvements.

### Current State
- `src/pages/orders.html`: 3,824 lines (700 HTML + 3,100 inline JS)
- `src/css/orders.css`: 1,060 lines (24KB)
- Backend: Cloudflare Workers + D1 (already optimized)

### Goals
1. **Architecture**: Split into ~18 ES6 modules with clear separation of concerns
2. **Performance**: Lazy loading, reduced bundle size
3. **UX**: Better loading states, error feedback
4. **Code Quality**: Centralized state, error handling, no memory leaks

---

## Module Structure

```
src/js/orders/
├── index.js              # Entry point, wires everything together
│
├── core/                 # Zero DOM dependencies, testable in Node
│   ├── config.js         # API_URL, AUTH_STORAGE_KEY, CACHE_TTL
│   ├── state.js          # Centralized state + getters/setters
│   └── api.js            # apiCall() with fetch + error handling
│
├── features/             # Business logic + DOM for each feature
│   ├── auth.js           # checkAuth, handleLogin, handleLogout
│   ├── customers.js      # openCustomerModal, saveCustomer, loadCustomers
│   ├── orders.js         # openOrderModal, saveOrder, loadOrders
│   ├── shipments.js      # openShipmentModal, saveShipment, addLineItem
│   ├── payments.js       # openPaymentModal, savePayment
│   ├── detail-panel.js   # openDetailPanel, renderShipments, renderPayments
│   ├── shopify-import.js # parseCSV, handleFileUpload, confirmImport
│   └── pdf-generator.js  # ensurePDFLibraries, generateInvoice, generatePackingSlip
│
├── ui/                   # Shared UI components
│   ├── theme.js          # initTheme, toggleTheme
│   ├── table.js          # renderOrdersTable
│   ├── stats.js          # updateStats
│   ├── modals.js         # openModal, closeModal (generic helpers)
│   └── toast.js          # showToast
│
└── utils/                # Pure functions, no side effects
    ├── format.js         # formatCurrency, formatDate, formatPercent
    └── validate.js       # validateEmail, validateRequired
```

### Dependency Flow

```
index.js → features/* → ui/* → core/* → utils/*
```

Lower layers never import from higher layers.

---

## Core Modules

### `core/config.js`
```javascript
// API endpoints
export const API_BASE = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api';
export const API_URL = `${API_BASE}/orders`;

// Auth
export const AUTH_STORAGE_KEY = 'orders_auth_session';
export const SESSION_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

// Caching
export const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// PDF libraries (lazy loaded)
export const PDF_LIBS = {
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  autotable: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js',
  jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
};
```

### `core/state.js`
```javascript
// Centralized state (replaces 8+ global variables)
const state = {
  customers: [],
  orders: [],
  currentOrderID: null,
  editingOrderID: null,
  cachedShipments: [],
  cachedPayments: [],
  pdfLibrariesLoaded: false,
  parsedShopifyData: []
};

// Order detail cache (5 min TTL)
const orderCache = new Map();

// Getters & setters for controlled access
export const getState = () => state;
export const setCustomers = (data) => { state.customers = data; };
export const setOrders = (data) => { state.orders = data; };
export const setCurrentOrderID = (id) => { state.currentOrderID = id; };
export const setEditingOrderID = (id) => { state.editingOrderID = id; };
export const setCachedShipments = (data) => { state.cachedShipments = data; };
export const setCachedPayments = (data) => { state.cachedPayments = data; };
export const setPdfLibrariesLoaded = (val) => { state.pdfLibrariesLoaded = val; };
export const setParsedShopifyData = (data) => { state.parsedShopifyData = data; };

// Cache helpers
export function getCachedOrder(orderID) {
  const cached = orderCache.get(orderID);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

export function setCachedOrder(orderID, data) {
  orderCache.set(orderID, { data, timestamp: Date.now() });
}

export function invalidateCache(orderID) {
  if (orderID) {
    orderCache.delete(orderID);
  } else {
    orderCache.clear();
  }
}
```

### `core/api.js`
```javascript
import { API_URL } from './config.js';

export async function apiCall(action, params = {}, method = 'GET') {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);

  if (method === 'GET') {
    Object.entries(params).forEach(([k, v]) =>
      url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : v)
    );
  }

  const options = { method };
  if (method === 'POST') {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(params);
  }

  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const raw = await response.json();
  return raw.data || raw; // Unwrap Cloudflare wrapper
}
```

---

## UI Modules

### `ui/theme.js`
```javascript
export function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcon(saved);
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeIcon(next);
}

function updateThemeIcon(theme) {
  const icon = document.getElementById('theme-icon');
  if (icon) {
    icon.className = theme === 'light' ? 'ph ph-moon' : 'ph ph-sun';
  }
}
```

### `ui/toast.js`
```javascript
export function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
```

### `ui/modals.js`
```javascript
export function openModal(modalId) {
  document.getElementById(modalId).classList.add('active');
}

export function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

export function clearForm(formId) {
  document.getElementById(formId).reset();
}
```

### `ui/table.js`
```javascript
import { getState } from '../core/state.js';
import { formatCurrency } from '../utils/format.js';

export function renderOrdersTable() {
  const { orders } = getState();
  const tbody = document.getElementById('orders-table-body');

  if (!orders.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No orders yet. Create your first order above.</td></tr>`;
    return;
  }

  tbody.innerHTML = orders.map(order => {
    const fulfillPct = order.commitmentAmount > 0
      ? Math.min(100, (order.fulfilledAmount / order.commitmentAmount) * 100)
      : 0;

    return `
      <tr onclick="window.orderActions.openDetail('${order.orderID}')">
        <td class="mono">${order.orderID}</td>
        <td>${order.customerName || ''}</td>
        <td class="mono">${formatCurrency(order.commitmentAmount)}</td>
        <td class="mono">${formatCurrency(order.fulfilledAmount)}</td>
        <td>${renderProgressBar(fulfillPct)}</td>
        <td>${renderStatusBadge(order.status)}</td>
        <td class="actions" onclick="event.stopPropagation()">
          <button class="btn-icon" onclick="window.orderActions.openShipmentModal('${order.orderID}')" title="Add Shipment">
            <i class="ph ph-package"></i>
          </button>
          <button class="btn-icon" onclick="window.orderActions.openPaymentModal('${order.orderID}')" title="Record Payment">
            <i class="ph ph-currency-dollar"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderProgressBar(percent) {
  return `
    <div class="progress-bar">
      <div class="progress-fill" style="width: ${percent}%"></div>
      <span class="progress-text">${percent.toFixed(0)}%</span>
    </div>
  `;
}

function renderStatusBadge(status) {
  const statusClass = {
    'Open': 'status-open',
    'Partial': 'status-partial',
    'Fulfilled': 'status-fulfilled',
    'Paid': 'status-paid'
  }[status] || 'status-open';

  return `<span class="status-badge ${statusClass}">${status || 'Open'}</span>`;
}
```

### `ui/stats.js`
```javascript
import { getState } from '../core/state.js';
import { formatCurrency } from '../utils/format.js';

export function updateStats() {
  const { orders } = getState();

  const totals = orders.reduce((acc, o) => ({
    commitment: acc.commitment + (o.commitmentAmount || 0),
    fulfilled: acc.fulfilled + (o.fulfilledAmount || 0),
    paid: acc.paid + (o.paidAmount || 0)
  }), { commitment: 0, fulfilled: 0, paid: 0 });

  const outstanding = totals.commitment - totals.fulfilled;
  const balance = totals.fulfilled - totals.paid;

  document.getElementById('stat-commitment').textContent = formatCurrency(totals.commitment);
  document.getElementById('stat-fulfilled').textContent = formatCurrency(totals.fulfilled);
  document.getElementById('stat-paid').textContent = formatCurrency(totals.paid);
  document.getElementById('stat-outstanding').textContent = formatCurrency(outstanding);
  document.getElementById('stat-balance').textContent = formatCurrency(balance);
}
```

---

## Utils Modules

### `utils/format.js`
```javascript
export function formatCurrency(amount, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency
  }).format(amount || 0);
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

export function formatPercent(value, decimals = 0) {
  return `${(value * 100).toFixed(decimals)}%`;
}
```

### `utils/validate.js`
```javascript
export function validateRequired(value, fieldName) {
  if (!value || (typeof value === 'string' && !value.trim())) {
    return `${fieldName} is required`;
  }
  return null;
}

export function validateEmail(email) {
  if (!email) return null;
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email) ? null : 'Invalid email format';
}

export function validatePositiveNumber(value, fieldName) {
  const num = parseFloat(value);
  if (isNaN(num) || num < 0) {
    return `${fieldName} must be a positive number`;
  }
  return null;
}
```

---

## Entry Point

### `index.js`
```javascript
// Core
import { API_URL } from './core/config.js';
import { getState, setCustomers, setOrders } from './core/state.js';
import { apiCall } from './core/api.js';

// Features
import { checkAuth, handleLogin, handleLogout } from './features/auth.js';
import { openCustomerModal, saveCustomer, closeCustomerModal, loadCustomers } from './features/customers.js';
import { openOrderModal, saveOrder, closeOrderModal, populateCustomerDropdown, populateCustomerInfo, copySoldToFromShipTo } from './features/orders.js';
import { openShipmentModal, saveShipment, closeShipmentModal, addLineItem, removeLine, calculateShipmentTotal, saveShipmentAndGenerateDocs } from './features/shipments.js';
import { openPaymentModal, savePayment, closePaymentModal, openPaymentDetailModal, closePaymentDetailModal, editPaymentFromDetail } from './features/payments.js';
import { openDetailPanel, closeDetailPanel } from './features/detail-panel.js';
import { openShopifyImportModal, closeShopifyImportModal, handleShopifyFileUpload, confirmShopifyImport } from './features/shopify-import.js';

// UI
import { initTheme, toggleTheme } from './ui/theme.js';
import { renderOrdersTable } from './ui/table.js';
import { updateStats } from './ui/stats.js';
import { showToast } from './ui/toast.js';

// Expose actions to HTML onclick handlers (grouped by feature)
window.orderActions = {
  openDetail: openDetailPanel,
  closeDetail: closeDetailPanel,
  openCustomerModal,
  openOrderModal,
  openShipmentModal,
  openPaymentModal,
  openShopifyImportModal
};

window.shipmentActions = {
  calculate: calculateShipmentTotal,
  removeLine,
  addLine: addLineItem
};

// Global functions for inline handlers (backwards compatibility)
window.handleLogin = handleLogin;
window.handleLogout = handleLogout;
window.toggleTheme = toggleTheme;

window.openNewCustomerModal = openCustomerModal;
window.closeCustomerModal = closeCustomerModal;
window.saveCustomer = saveCustomer;

window.openNewOrderModal = openOrderModal;
window.closeOrderModal = closeOrderModal;
window.saveOrder = saveOrder;
window.populateCustomerInfo = populateCustomerInfo;
window.copySoldToFromShipTo = copySoldToFromShipTo;

window.openShipmentModal = openShipmentModal;
window.closeShipmentModal = closeShipmentModal;
window.saveShipment = saveShipment;
window.saveShipmentAndGenerateDocs = saveShipmentAndGenerateDocs;
window.addLineItem = addLineItem;
window.calculateShipmentTotal = calculateShipmentTotal;

window.openPaymentModal = openPaymentModal;
window.closePaymentModal = closePaymentModal;
window.savePayment = savePayment;
window.openPaymentDetailModal = openPaymentDetailModal;
window.closePaymentDetailModal = closePaymentDetailModal;
window.editPaymentFromDetail = editPaymentFromDetail;

window.openShopifyImportModal = openShopifyImportModal;
window.closeShopifyImportModal = closeShopifyImportModal;
window.handleShopifyFileUpload = handleShopifyFileUpload;
window.confirmShopifyImport = confirmShopifyImport;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();

  // Check authentication first
  if (!checkAuth()) return;

  // Load initial data in parallel
  try {
    const [customersData, ordersData] = await Promise.all([
      apiCall('getCustomers'),
      apiCall('getMasterOrders')
    ]);

    setCustomers(customersData.customers || customersData || []);
    setOrders(ordersData.orders || ordersData || []);

    populateCustomerDropdown();
    renderOrdersTable();
    updateStats();
  } catch (err) {
    showToast('Failed to load data', 'error');
    console.error('Initial load error:', err);
  }
});
```

---

## HTML Changes

Minimal changes to `orders.html`:

```html
<!-- Remove the inline <script>...</script> (3100 lines) -->

<!-- Add at end of body -->
<script type="module" src="../js/orders/index.js"></script>
```

Keep original inline script commented out for rollback safety until verified.

---

## Migration Plan

### Phase 1: Create structure, move code (Day 1)
- [ ] Create `src/js/orders/` folder structure
- [ ] Extract `utils/format.js` (pure functions)
- [ ] Extract `utils/validate.js`
- [ ] Extract `core/config.js` (constants)
- [ ] Extract `core/state.js`
- [ ] Extract `core/api.js`
- [ ] Verify: page still works

### Phase 2: Extract UI modules (Day 1-2)
- [ ] Extract `ui/toast.js`
- [ ] Extract `ui/theme.js`
- [ ] Extract `ui/modals.js`
- [ ] Extract `ui/table.js`
- [ ] Extract `ui/stats.js`
- [ ] Verify: page still works

### Phase 3: Extract features (Day 2-3)
- [ ] Extract `features/auth.js` → test login/logout
- [ ] Extract `features/customers.js` → test CRUD
- [ ] Extract `features/orders.js` → test CRUD
- [ ] Extract `features/shipments.js` → test CRUD
- [ ] Extract `features/payments.js` → test CRUD
- [ ] Extract `features/detail-panel.js` → test panel
- [ ] Extract `features/shopify-import.js` → test import
- [ ] Extract `features/pdf-generator.js` → test PDF

### Phase 4: Wire up entry point (Day 3)
- [ ] Create `index.js` entry point
- [ ] Comment out inline `<script>` from HTML
- [ ] Add `<script type="module">`
- [ ] Full regression test

### Phase 5: Post-refactor optimizations (Day 4+)
- [ ] Performance: Lazy load PDF libraries
- [ ] UX: Add loading states to all async operations
- [ ] UX: Improve error messages
- [ ] Code Quality: Add input validation
- [ ] Code Quality: Review for memory leaks

---

## Success Criteria

1. **All existing functionality works** - no regressions
2. **File size reduced** - target <100KB for main HTML
3. **Modules load correctly** - no console errors
4. **Each module testable** - core/ has no DOM dependencies
5. **Clear dependency flow** - no circular imports

---

## Rollback Plan

If issues arise:
1. Uncomment original inline `<script>` in HTML
2. Remove/comment `<script type="module">` line
3. Page reverts to original monolithic version
