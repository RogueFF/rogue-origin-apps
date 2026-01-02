// =====================================================
// ORDERS MANAGEMENT - Add to Production Code.gs
// Copy this code into your Google Apps Script editor
// =====================================================

// Sheet name for orders data
const ORDERS_SHEET_NAME = 'Orders';

// =====================================================
// Orders API Handlers - Add to doGet() switch statement
// =====================================================

/*
Add these cases to your existing doGet(e) function:

case 'getOrders':
  result = getOrders();
  break;
case 'getOrder':
  result = getOrder(e.parameter.id);
  break;

Add this case to your existing doPost(e) function:

case 'saveOrder':
  result = saveOrder(data);
  break;
case 'deleteOrder':
  result = deleteOrder(data.id);
  break;
*/

// =====================================================
// Orders Functions
// =====================================================

/**
 * Get all orders
 */
function getOrders() {
  try {
    const ss = SpreadsheetApp.openById('1dARXrKU2u4KJY08ylA3GUKrT0zwmxCmtVh7IJxnn7is');
    let sheet = ss.getSheetByName(ORDERS_SHEET_NAME);

    // Create sheet if it doesn't exist
    if (!sheet) {
      sheet = createOrdersSheet(ss);
    }

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return { success: true, orders: [] };
    }

    const headers = data[0];
    const orders = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue; // Skip empty rows

      const order = {
        id: row[0],
        customer: row[1],
        totalKg: parseFloat(row[2]) || 0,
        completedKg: parseFloat(row[3]) || 0,
        status: row[4] || 'pending',
        createdDate: formatDateForJSON(row[5]),
        dueDate: formatDateForJSON(row[6]),
        notes: row[7] || '',
        pallets: JSON.parse(row[8] || '[]')
      };
      orders.push(order);
    }

    return { success: true, orders: orders };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get a single order by ID
 */
function getOrder(orderId) {
  try {
    const result = getOrders();
    if (!result.success) return result;

    const order = result.orders.find(o => o.id === orderId);
    if (!order) {
      return { success: false, error: 'Order not found' };
    }

    return { success: true, order: order };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Save (create or update) an order
 */
function saveOrder(orderData) {
  try {
    const ss = SpreadsheetApp.openById('1dARXrKU2u4KJY08ylA3GUKrT0zwmxCmtVh7IJxnn7is');
    let sheet = ss.getSheetByName(ORDERS_SHEET_NAME);

    // Create sheet if it doesn't exist
    if (!sheet) {
      sheet = createOrdersSheet(ss);
    }

    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;

    // Find existing row
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === orderData.id) {
        rowIndex = i + 1; // 1-indexed for Sheets
        break;
      }
    }

    // Prepare row data
    const rowData = [
      orderData.id,
      orderData.customer,
      orderData.totalKg,
      orderData.completedKg || 0,
      orderData.status || 'pending',
      orderData.createdDate || new Date().toISOString().split('T')[0],
      orderData.dueDate || '',
      orderData.notes || '',
      JSON.stringify(orderData.pallets || [])
    ];

    if (rowIndex > 0) {
      // Update existing row
      sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
    } else {
      // Append new row
      sheet.appendRow(rowData);
    }

    return { success: true, order: orderData };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Delete an order
 */
function deleteOrder(orderId) {
  try {
    const ss = SpreadsheetApp.openById('1dARXrKU2u4KJY08ylA3GUKrT0zwmxCmtVh7IJxnn7is');
    const sheet = ss.getSheetByName(ORDERS_SHEET_NAME);

    if (!sheet) {
      return { success: false, error: 'Orders sheet not found' };
    }

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === orderId) {
        sheet.deleteRow(i + 1);
        return { success: true };
      }
    }

    return { success: false, error: 'Order not found' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Create the Orders sheet with headers
 */
function createOrdersSheet(ss) {
  const sheet = ss.insertSheet(ORDERS_SHEET_NAME);
  const headers = [
    'OrderID',
    'Customer',
    'TotalKg',
    'CompletedKg',
    'Status',
    'CreatedDate',
    'DueDate',
    'Notes',
    'Pallets'
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  // Set column widths
  sheet.setColumnWidth(1, 100);  // OrderID
  sheet.setColumnWidth(2, 150);  // Customer
  sheet.setColumnWidth(3, 80);   // TotalKg
  sheet.setColumnWidth(4, 100);  // CompletedKg
  sheet.setColumnWidth(5, 100);  // Status
  sheet.setColumnWidth(6, 100);  // CreatedDate
  sheet.setColumnWidth(7, 100);  // DueDate
  sheet.setColumnWidth(8, 200);  // Notes
  sheet.setColumnWidth(9, 300);  // Pallets (JSON)

  return sheet;
}

/**
 * Helper to format dates for JSON
 */
function formatDateForJSON(date) {
  if (!date) return '';
  if (date instanceof Date) {
    return date.toISOString().split('T')[0];
  }
  return String(date);
}

// =====================================================
// Orders Summary for AI Agent
// Add this to gatherProductionContext() or similar
// =====================================================

/**
 * Get orders summary for AI context
 */
function getOrdersSummary() {
  try {
    const result = getOrders();
    if (!result.success || !result.orders.length) {
      return null;
    }

    const orders = result.orders;
    const active = orders.filter(o => !['completed', 'shipped'].includes(o.status));
    const processing = orders.filter(o => o.status === 'processing');

    // Calculate totals
    const totalPendingKg = orders
      .filter(o => o.status === 'pending')
      .reduce((sum, o) => sum + o.totalKg, 0);

    const totalInProgressKg = processing
      .reduce((sum, o) => sum + (o.totalKg - o.completedKg), 0);

    const totalReadyKg = orders
      .filter(o => o.status === 'ready')
      .reduce((sum, o) => sum + o.totalKg, 0);

    return {
      totalOrders: orders.length,
      activeOrders: active.length,
      processingOrders: processing.length,
      pendingKg: totalPendingKg,
      inProgressKg: totalInProgressKg,
      readyToShipKg: totalReadyKg,
      orders: active.map(o => ({
        id: o.id,
        customer: o.customer,
        totalKg: o.totalKg,
        completedKg: o.completedKg,
        percentComplete: Math.round((o.completedKg / o.totalKg) * 100),
        status: o.status,
        dueDate: o.dueDate
      }))
    };
  } catch (error) {
    console.log('Error getting orders summary:', error);
    return null;
  }
}

// =====================================================
// Test Function
// =====================================================

function testOrdersAPI() {
  // Test getOrders
  console.log('Testing getOrders...');
  const orders = getOrders();
  console.log(JSON.stringify(orders, null, 2));

  // Test saveOrder
  console.log('Testing saveOrder...');
  const testOrder = {
    id: 'TEST-001',
    customer: 'Test Customer',
    totalKg: 100,
    completedKg: 50,
    status: 'processing',
    createdDate: '2026-01-02',
    dueDate: '2026-02-01',
    notes: 'Test order',
    pallets: [
      { id: 'P001', cultivars: 'Sour Lifter', weightKg: 50, status: 'completed' },
      { id: 'P002', cultivars: 'Lifter', weightKg: 50, status: 'pending' }
    ]
  };
  const saveResult = saveOrder(testOrder);
  console.log(JSON.stringify(saveResult, null, 2));

  // Test getOrdersSummary
  console.log('Testing getOrdersSummary...');
  const summary = getOrdersSummary();
  console.log(JSON.stringify(summary, null, 2));
}
