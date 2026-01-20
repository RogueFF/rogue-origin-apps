/**
 * Shopify CSV import feature
 * @module features/shopify-import
 */

import { apiCall } from '../core/api.js';
import { getOrders, getParsedShopifyData, setParsedShopifyData, invalidateCache } from '../core/state.js';
import { openModal, closeModal } from '../ui/modals.js';
import { showToast } from '../ui/toast.js';
import { formatCurrency } from '../utils/format.js';

const MODAL_ID = 'shopify-import-modal';

/**
 * Open Shopify import modal
 */
export function openShopifyImportModal() {
  const fileInput = document.getElementById('shopify-csv-file');
  if (fileInput) fileInput.value = '';

  const preview = document.getElementById('import-preview');
  if (preview) preview.style.display = 'none';

  const confirmBtn = document.getElementById('import-confirm-btn');
  if (confirmBtn) confirmBtn.style.display = 'none';

  setParsedShopifyData([]);
  openModal(MODAL_ID);
}

/**
 * Close Shopify import modal
 */
export function closeShopifyImportModal() {
  closeModal(MODAL_ID);
}

/**
 * Handle file upload
 * @param {Event} event
 */
export function handleShopifyFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const csvText = e.target.result;
    parseShopifyCSV(csvText);
  };
  reader.readAsText(file);
}

/**
 * Parse Shopify CSV content
 * @param {string} csvText
 */
function parseShopifyCSV(csvText) {
  try {
    const lines = csvText.split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));

    // Find column indices
    const cols = {
      orderNum: headers.indexOf('Name'),
      email: headers.indexOf('Email'),
      financialStatus: headers.indexOf('Financial Status'),
      fulfillmentStatus: headers.indexOf('Fulfillment Status'),
      total: headers.indexOf('Total'),
      lineItemTitle: headers.indexOf('Lineitem name'),
      lineItemQty: headers.indexOf('Lineitem quantity'),
      lineItemPrice: headers.indexOf('Lineitem price'),
      shipping: headers.indexOf('Shipping'),
      billingName: headers.indexOf('Billing Name'),
      billingCompany: headers.indexOf('Billing Company')
    };

    // Group by order number
    const ordersMap = {};

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;

      const values = parseCSVLine(lines[i]);
      const orderNum = values[cols.orderNum];
      const fulfillmentStatus = values[cols.fulfillmentStatus];

      // Only import fulfilled orders
      if (fulfillmentStatus !== 'fulfilled') continue;

      if (!ordersMap[orderNum]) {
        ordersMap[orderNum] = {
          orderNumber: orderNum,
          email: values[cols.email],
          customerName: values[cols.billingCompany] || values[cols.billingName],
          total: parseFloat(values[cols.total]) || 0,
          shipping: parseFloat(values[cols.shipping]) || 0,
          lineItems: []
        };
      }

      // Add line item
      if (values[cols.lineItemTitle]) {
        ordersMap[orderNum].lineItems.push({
          title: values[cols.lineItemTitle],
          quantity: parseFloat(values[cols.lineItemQty]) || 0,
          price: parseFloat(values[cols.lineItemPrice]) || 0
        });
      }
    }

    const parsedOrders = Object.values(ordersMap);

    if (parsedOrders.length === 0) {
      showToast('No fulfilled orders found in CSV', 'warning');
      return;
    }

    matchShopifyOrders(parsedOrders);
  } catch (error) {
    console.error('CSV parsing error:', error);
    showToast('Error parsing CSV: ' + error.message, 'error');
  }
}

/**
 * Parse a single CSV line (handles quoted values)
 * @private
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());

  return result;
}

/**
 * Match Shopify orders to master orders
 * @param {Array} shopifyOrders
 */
function matchShopifyOrders(shopifyOrders) {
  const orders = getOrders();
  const matched = [];
  const unmatched = [];

  shopifyOrders.forEach(shopifyOrder => {
    const masterOrder = orders.find(mo => {
      const nameLower = (mo.customerName || '').toLowerCase();
      const shopifyNameLower = (shopifyOrder.customerName || '').toLowerCase();

      // Match by email or name
      const emailMatch = mo.shipTo_Email && shopifyOrder.email &&
        mo.shipTo_Email.toLowerCase() === shopifyOrder.email.toLowerCase();
      const nameMatch = shopifyNameLower && nameLower.includes(shopifyNameLower);

      return emailMatch || nameMatch;
    });

    if (masterOrder) {
      matched.push({ shopifyOrder, masterOrder });
    } else {
      unmatched.push(shopifyOrder);
    }
  });

  setParsedShopifyData(matched);
  displayImportPreview(matched, unmatched);
}

/**
 * Display import preview
 * @param {Array} matched
 * @param {Array} unmatched
 */
function displayImportPreview(matched, unmatched) {
  const container = document.getElementById('import-preview-content');
  if (!container) return;

  let html = '';

  if (matched.length > 0) {
    html += '<h5 style="color: var(--success);">Matched Orders</h5>';
    html += '<table class="preview-table"><thead><tr><th>Shopify Order</th><th>Master Order</th><th>Amount</th></tr></thead><tbody>';

    matched.forEach(({ shopifyOrder, masterOrder }) => {
      html += `
        <tr>
          <td>${shopifyOrder.orderNumber}<br><small>${shopifyOrder.customerName || ''}</small></td>
          <td>${masterOrder.id}<br><small>${masterOrder.customerName}</small></td>
          <td>${formatCurrency(shopifyOrder.total)}</td>
        </tr>
      `;
    });

    html += '</tbody></table>';
  }

  if (unmatched.length > 0) {
    html += '<h5 style="color: var(--warning); margin-top: 16px;">Unmatched Orders</h5>';
    html += '<p style="font-size: 12px; color: var(--text-muted);">These orders could not be matched to a master order</p>';
    html += '<ul style="font-size: 13px;">';

    unmatched.forEach(order => {
      html += `<li>${order.orderNumber} - ${order.customerName || 'Unknown'} (${formatCurrency(order.total)})</li>`;
    });

    html += '</ul>';
  }

  container.innerHTML = html;

  // Show preview and confirm button
  const preview = document.getElementById('import-preview');
  if (preview) preview.style.display = 'block';

  const confirmBtn = document.getElementById('import-confirm-btn');
  if (confirmBtn && matched.length > 0) {
    confirmBtn.style.display = 'inline-flex';
    const countSpan = document.getElementById('import-count');
    if (countSpan) countSpan.textContent = matched.length;
  }
}

/**
 * Confirm and execute import
 */
export async function confirmShopifyImport() {
  const matched = getParsedShopifyData();

  if (matched.length === 0) {
    showToast('No orders to import', 'warning');
    return;
  }

  const confirmBtn = document.getElementById('import-confirm-btn');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Importing...';
  }

  let successCount = 0;
  let errorCount = 0;

  for (const { shopifyOrder, masterOrder } of matched) {
    try {
      // Create shipment from Shopify order
      const shipmentData = {
        orderID: masterOrder.id,
        shipmentDate: new Date().toISOString().split('T')[0],
        carrier: 'Shopify Import',
        lineItems: shopifyOrder.lineItems.map(item => ({
          strain: extractStrainFromTitle(item.title),
          type: item.title.toLowerCase().includes('small') ? 'smalls' : 'tops',
          quantity: item.quantity,
          unitPrice: item.price,
          total: item.quantity * item.price
        })),
        subTotal: shopifyOrder.total - shopifyOrder.shipping,
        freightCost: shopifyOrder.shipping,
        totalAmount: shopifyOrder.total,
        notes: `Imported from Shopify order ${shopifyOrder.orderNumber}`
      };

      const result = await apiCall('saveShipment', shipmentData, 'POST');

      if (result.success !== false) {
        successCount++;
        invalidateCache(masterOrder.id);
      } else {
        errorCount++;
        console.error('Import error for order', shopifyOrder.orderNumber, result.error);
      }
    } catch (error) {
      errorCount++;
      console.error('Import error for order', shopifyOrder.orderNumber, error);
    }
  }

  closeShopifyImportModal();

  if (successCount > 0) {
    showToast(`Imported ${successCount} shipment${successCount > 1 ? 's' : ''} successfully!`);
  }
  if (errorCount > 0) {
    showToast(`${errorCount} import${errorCount > 1 ? 's' : ''} failed`, 'error');
  }

  // Refresh orders table
  window.location.reload();
}

/**
 * Extract strain name from Shopify product title
 * @private
 */
function extractStrainFromTitle(title) {
  // Try to extract strain name from common patterns
  // e.g., "Lifter - Tops 5kg" -> "Lifter"
  const match = title.match(/^([^-–]+)/);
  return match ? match[1].trim() : title;
}
