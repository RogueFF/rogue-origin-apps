/**********************************************************
 * WHOLESALE ORDER MANAGEMENT SYSTEM
 * Standalone Google Apps Script Backend
 *
 * Data Sheets:
 * - Customers: Customer directory
 * - MasterOrders: Order commitments (~$56K each)
 * - Shipments: Individual shipments with line items
 * - Payments: Payment records
 * - PriceHistory: Last price per strain+type
 * - COA_Index: COA files from Google Drive
 **********************************************************/

// ===== CONFIGURATION =====
// TODO: Replace with your Sheet ID after creating the spreadsheet
var SHEET_ID = 'YOUR_SHEET_ID_HERE';
var COA_FOLDER_ID = '1efudtjpm8fsSA6PZUirhtsmCO5-oS2Me';

// ===== WEB APP ROUTING =====
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  var result = {};

  try {
    if (action === 'getCustomers') {
      result = getCustomers();
    } else if (action === 'getMasterOrders') {
      result = getMasterOrders();
    } else if (action === 'getShipments') {
      result = getShipments(e.parameter.orderID || null);
    } else if (action === 'getPayments') {
      result = getPayments(e.parameter.orderID || null);
    } else if (action === 'getPriceHistory') {
      result = getPriceHistory();
    } else if (action === 'getCOAIndex') {
      result = getCOAIndex();
    } else if (action === 'syncCOAIndex') {
      result = syncCOAIndex();
    } else if (action === 'getOrderFinancials') {
      result = getOrderFinancials(e.parameter.orderID);
    } else if (action === 'test') {
      result = { ok: true, message: 'Wholesale Orders API working', timestamp: new Date().toISOString() };
    } else {
      result = {
        ok: true,
        message: 'Rogue Origin Wholesale Orders API',
        endpoints: ['getCustomers', 'getMasterOrders', 'getShipments', 'getPayments', 'test'],
        timestamp: new Date().toISOString()
      };
    }
  } catch (err) {
    console.error('doGet error:', err.message, err.stack);
    result = { error: err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  var result = {};

  try {
    if (action === 'saveCustomer') {
      var customerData = e.postData ? JSON.parse(e.postData.contents) : {};
      result = saveCustomer(customerData);
    } else if (action === 'deleteCustomer') {
      var deleteData = e.postData ? JSON.parse(e.postData.contents) : {};
      result = deleteCustomer(deleteData.id);
    } else if (action === 'saveMasterOrder') {
      var orderData = e.postData ? JSON.parse(e.postData.contents) : {};
      result = saveMasterOrder(orderData);
    } else if (action === 'saveShipment') {
      var shipmentData = e.postData ? JSON.parse(e.postData.contents) : {};
      result = saveShipment(shipmentData);
    } else if (action === 'savePayment') {
      var paymentData = e.postData ? JSON.parse(e.postData.contents) : {};
      result = savePayment(paymentData);
    } else {
      result = { error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== CUSTOMERS MANAGEMENT =====
var CUSTOMERS_SHEET_NAME = 'Customers';

function getCustomers() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(CUSTOMERS_SHEET_NAME);
    if (!sheet) sheet = createCustomersSheet_(ss);

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, customers: [] };

    var customers = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      customers.push({
        id: row[0],
        companyName: row[1],
        contactName: row[2],
        email: row[3],
        phone: row[4],
        shipToAddress: row[5],
        billToAddress: row[6],
        country: row[7],
        notes: row[8],
        createdDate: formatDateForJSON_(row[9]),
        lastOrderDate: formatDateForJSON_(row[10])
      });
    }
    return { success: true, customers: customers };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function saveCustomer(customerData) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(CUSTOMERS_SHEET_NAME);
    if (!sheet) sheet = createCustomersSheet_(ss);

    var data = sheet.getDataRange().getValues();
    var existingRow = -1;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === customerData.id) {
        existingRow = i + 1;
        break;
      }
    }

    if (!customerData.id) {
      customerData.id = 'CUST-' + String(data.length).padStart(3, '0');
    }

    var row = [
      customerData.id,
      customerData.companyName || '',
      customerData.contactName || '',
      customerData.email || '',
      customerData.phone || '',
      customerData.shipToAddress || '',
      customerData.billToAddress || '',
      customerData.country || '',
      customerData.notes || '',
      customerData.createdDate || new Date(),
      customerData.lastOrderDate || ''
    ];

    if (existingRow > 0) {
      sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
    return { success: true, customer: customerData };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function deleteCustomer(customerId) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(CUSTOMERS_SHEET_NAME);
    if (!sheet) return { success: false, error: 'Customers sheet not found' };

    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === customerId) {
        sheet.deleteRow(i + 1);
        return { success: true };
      }
    }
    return { success: false, error: 'Customer not found' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function createCustomersSheet_(ss) {
  var sheet = ss.insertSheet(CUSTOMERS_SHEET_NAME);
  var headers = [
    'CustomerID', 'CompanyName', 'ContactName', 'Email', 'Phone',
    'ShipToAddress', 'BillToAddress', 'Country', 'Notes',
    'CreatedDate', 'LastOrderDate'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

// ===== MASTER ORDERS MANAGEMENT =====
var MASTER_ORDERS_SHEET_NAME = 'MasterOrders';

function getMasterOrders() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(MASTER_ORDERS_SHEET_NAME);
    if (!sheet) sheet = createMasterOrdersSheet_(ss);

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, orders: [] };

    var orders = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      orders.push({
        id: row[0],
        customerID: row[1],
        customerName: row[2],
        commitmentAmount: parseFloat(row[3]) || 0,
        currency: row[4] || 'USD',
        status: row[5] || 'pending',
        poNumber: row[6],
        terms: row[7] || 'DAP',
        createdDate: formatDateForJSON_(row[8]),
        dueDate: formatDateForJSON_(row[9]),
        shipTo_Contact: row[10],
        shipTo_Company: row[11],
        shipTo_Address: row[12],
        shipTo_Phone: row[13],
        shipTo_Email: row[14],
        soldTo_Contact: row[15],
        soldTo_Company: row[16],
        soldTo_Address: row[17],
        soldTo_Phone: row[18],
        soldTo_Email: row[19],
        notes: row[20]
      });
    }
    return { success: true, orders: orders };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function saveMasterOrder(orderData) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(MASTER_ORDERS_SHEET_NAME);
    if (!sheet) sheet = createMasterOrdersSheet_(ss);

    var data = sheet.getDataRange().getValues();
    var existingRow = -1;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === orderData.id) {
        existingRow = i + 1;
        break;
      }
    }

    if (!orderData.id) {
      var year = new Date().getFullYear();
      orderData.id = 'MO-' + year + '-' + String(data.length).padStart(3, '0');
    }

    var row = [
      orderData.id,
      orderData.customerID || '',
      orderData.customerName || '',
      orderData.commitmentAmount || 0,
      orderData.currency || 'USD',
      orderData.status || 'pending',
      orderData.poNumber || '',
      orderData.terms || 'DAP',
      orderData.createdDate || new Date(),
      orderData.dueDate || '',
      orderData.shipTo_Contact || '',
      orderData.shipTo_Company || '',
      orderData.shipTo_Address || '',
      orderData.shipTo_Phone || '',
      orderData.shipTo_Email || '',
      orderData.soldTo_Contact || '',
      orderData.soldTo_Company || '',
      orderData.soldTo_Address || '',
      orderData.soldTo_Phone || '',
      orderData.soldTo_Email || '',
      orderData.notes || ''
    ];

    if (existingRow > 0) {
      sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
    return { success: true, order: orderData };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function createMasterOrdersSheet_(ss) {
  var sheet = ss.insertSheet(MASTER_ORDERS_SHEET_NAME);
  var headers = [
    'OrderID', 'CustomerID', 'CustomerName', 'CommitmentAmount', 'Currency',
    'Status', 'PONumber', 'Terms', 'CreatedDate', 'DueDate',
    'ShipTo_Contact', 'ShipTo_Company', 'ShipTo_Address', 'ShipTo_Phone', 'ShipTo_Email',
    'SoldTo_Contact', 'SoldTo_Company', 'SoldTo_Address', 'SoldTo_Phone', 'SoldTo_Email',
    'Notes'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

// ===== SHIPMENTS MANAGEMENT =====
var SHIPMENTS_SHEET_NAME = 'Shipments';

function getShipments(orderID) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHIPMENTS_SHEET_NAME);
    if (!sheet) sheet = createShipmentsSheet_(ss);

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, shipments: [] };

    var shipments = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      if (orderID && row[1] !== orderID) continue;

      var shipment = {
        id: row[0],
        orderID: row[1],
        invoiceNumber: row[2],
        shipmentDate: formatDateForJSON_(row[3]),
        status: row[4] || 'pending',
        dimensionsJSON: row[5] || '{}',
        lineItemsJSON: row[6] || '[]',
        subTotal: parseFloat(row[7]) || 0,
        discount: parseFloat(row[8]) || 0,
        freightCost: parseFloat(row[9]) || 0,
        totalAmount: parseFloat(row[10]) || 0,
        trackingNumber: row[11] || '',
        carrier: row[12] || '',
        notes: row[13] || ''
      };

      try {
        shipment.dimensions = JSON.parse(shipment.dimensionsJSON);
        shipment.lineItems = JSON.parse(shipment.lineItemsJSON);
      } catch (e) {
        shipment.dimensions = {};
        shipment.lineItems = [];
      }
      shipments.push(shipment);
    }
    return { success: true, shipments: shipments };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function saveShipment(shipmentData) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHIPMENTS_SHEET_NAME);
    if (!sheet) sheet = createShipmentsSheet_(ss);

    var data = sheet.getDataRange().getValues();
    var existingRow = -1;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === shipmentData.id) {
        existingRow = i + 1;
        break;
      }
    }

    if (!shipmentData.id) {
      var orderNum = shipmentData.orderID ? shipmentData.orderID.split('-').pop() : '000';
      shipmentData.id = 'SH-' + orderNum + '-' + String(data.length).padStart(2, '0');
    }
    if (!shipmentData.invoiceNumber) {
      shipmentData.invoiceNumber = getNextInvoiceNumber();
    }

    var row = [
      shipmentData.id,
      shipmentData.orderID || '',
      shipmentData.invoiceNumber,
      shipmentData.shipmentDate || new Date(),
      shipmentData.status || 'pending',
      JSON.stringify(shipmentData.dimensions || {}),
      JSON.stringify(shipmentData.lineItems || []),
      shipmentData.subTotal || 0,
      shipmentData.discount || 0,
      shipmentData.freightCost || 0,
      shipmentData.totalAmount || 0,
      shipmentData.trackingNumber || '',
      shipmentData.carrier || '',
      shipmentData.notes || ''
    ];

    if (existingRow > 0) {
      sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }

    // Update price history
    if (shipmentData.lineItems && shipmentData.lineItems.length > 0) {
      for (var j = 0; j < shipmentData.lineItems.length; j++) {
        var item = shipmentData.lineItems[j];
        if (item.strain && item.type && item.unitPrice) {
          updatePriceHistory(item.strain, item.type, item.unitPrice);
        }
      }
    }
    return { success: true, shipment: shipmentData };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function getNextInvoiceNumber() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(SHIPMENTS_SHEET_NAME);
    if (!sheet) return 'INV-' + new Date().getFullYear() + '-0001';

    var data = sheet.getDataRange().getValues();
    var year = new Date().getFullYear();
    var maxNum = 0;
    for (var i = 1; i < data.length; i++) {
      var invoice = data[i][2] || '';
      if (invoice.indexOf('INV-' + year) === 0) {
        var num = parseInt(invoice.split('-').pop());
        if (num > maxNum) maxNum = num;
      }
    }
    return 'INV-' + year + '-' + String(maxNum + 1).padStart(4, '0');
  } catch (error) {
    return 'INV-' + new Date().getFullYear() + '-0001';
  }
}

function createShipmentsSheet_(ss) {
  var sheet = ss.insertSheet(SHIPMENTS_SHEET_NAME);
  var headers = [
    'ShipmentID', 'OrderID', 'InvoiceNumber', 'ShipmentDate', 'Status',
    'DimensionsJSON', 'LineItemsJSON', 'SubTotal', 'Discount', 'FreightCost',
    'TotalAmount', 'TrackingNumber', 'Carrier', 'Notes'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

// ===== PAYMENTS MANAGEMENT =====
var PAYMENTS_SHEET_NAME = 'Payments';

function getPayments(orderID) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(PAYMENTS_SHEET_NAME);
    if (!sheet) sheet = createPaymentsSheet_(ss);

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, payments: [] };

    var payments = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      if (orderID && row[1] !== orderID) continue;
      payments.push({
        id: row[0],
        orderID: row[1],
        paymentDate: formatDateForJSON_(row[2]),
        amount: parseFloat(row[3]) || 0,
        method: row[4] || '',
        reference: row[5] || '',
        notes: row[6] || '',
        recordedBy: row[7] || '',
        recordedDate: formatDateForJSON_(row[8])
      });
    }
    return { success: true, payments: payments };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function savePayment(paymentData) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(PAYMENTS_SHEET_NAME);
    if (!sheet) sheet = createPaymentsSheet_(ss);

    var data = sheet.getDataRange().getValues();
    var existingRow = -1;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === paymentData.id) {
        existingRow = i + 1;
        break;
      }
    }

    if (!paymentData.id) {
      paymentData.id = 'PAY-' + String(data.length).padStart(5, '0');
    }

    var row = [
      paymentData.id,
      paymentData.orderID || '',
      paymentData.paymentDate || new Date(),
      paymentData.amount || 0,
      paymentData.method || '',
      paymentData.reference || '',
      paymentData.notes || '',
      paymentData.recordedBy || '',
      paymentData.recordedDate || new Date()
    ];

    if (existingRow > 0) {
      sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
    return { success: true, payment: paymentData };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function createPaymentsSheet_(ss) {
  var sheet = ss.insertSheet(PAYMENTS_SHEET_NAME);
  var headers = [
    'PaymentID', 'OrderID', 'PaymentDate', 'Amount', 'Method',
    'Reference', 'Notes', 'RecordedBy', 'RecordedDate'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

// ===== PRICE HISTORY =====
var PRICE_HISTORY_SHEET_NAME = 'PriceHistory';

function getPriceHistory() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(PRICE_HISTORY_SHEET_NAME);
    if (!sheet) sheet = createPriceHistorySheet_(ss);

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, prices: [] };

    var prices = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      prices.push({
        strain: row[0],
        type: row[1],
        lastPrice: parseFloat(row[2]) || 0,
        lastUsedDate: formatDateForJSON_(row[3]),
        customerID: row[4] || ''
      });
    }
    return { success: true, prices: prices };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function updatePriceHistory(strain, type, price, customerID) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(PRICE_HISTORY_SHEET_NAME);
    if (!sheet) sheet = createPriceHistorySheet_(ss);

    var data = sheet.getDataRange().getValues();
    var existingRow = -1;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === strain && data[i][1] === type) {
        if (!customerID || data[i][4] === customerID) {
          existingRow = i + 1;
          break;
        }
      }
    }

    var row = [strain, type, price, new Date(), customerID || ''];
    if (existingRow > 0) {
      sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function createPriceHistorySheet_(ss) {
  var sheet = ss.insertSheet(PRICE_HISTORY_SHEET_NAME);
  var headers = ['Strain', 'Type', 'LastPrice', 'LastUsedDate', 'CustomerID'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

// ===== COA INDEX =====
var COA_INDEX_SHEET_NAME = 'COA_Index';

function syncCOAIndex() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(COA_INDEX_SHEET_NAME);
    if (!sheet) sheet = createCOAIndexSheet_(ss);

    var folder = DriveApp.getFolderById(COA_FOLDER_ID);
    var files = folder.getFiles();
    var coaData = [];

    while (files.hasNext()) {
      var file = files.next();
      var fileName = file.getName();
      if (fileName.toLowerCase().indexOf('coa') !== -1 && fileName.toLowerCase().indexOf('.pdf') !== -1) {
        var strain = fileName.replace(/_COA\.pdf$/i, '').replace(/_/g, ' ').trim();
        coaData.push([
          strain,
          fileName,
          file.getId(),
          file.getUrl(),
          'https://drive.google.com/uc?export=download&id=' + file.getId(),
          new Date()
        ]);
      }
    }

    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).clearContent();
    }
    if (coaData.length > 0) {
      sheet.getRange(2, 1, coaData.length, 6).setValues(coaData);
    }
    return { success: true, count: coaData.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function getCOAIndex() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(COA_INDEX_SHEET_NAME);
    if (!sheet) {
      sheet = createCOAIndexSheet_(ss);
      syncCOAIndex();
      sheet = ss.getSheetByName(COA_INDEX_SHEET_NAME);
    }

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, coas: [] };

    var coas = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      coas.push({
        strain: row[0],
        fileName: row[1],
        fileID: row[2],
        url: row[3],
        downloadURL: row[4],
        lastSynced: formatDateForJSON_(row[5])
      });
    }
    return { success: true, coas: coas };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function createCOAIndexSheet_(ss) {
  var sheet = ss.insertSheet(COA_INDEX_SHEET_NAME);
  var headers = ['Strain', 'FileName', 'FileID', 'URL', 'DownloadURL', 'LastSynced'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

// ===== ORDER FINANCIALS HELPER =====
function getOrderFinancials(orderID) {
  try {
    var orderResult = getMasterOrders();
    if (!orderResult.success) return orderResult;

    var order = null;
    for (var i = 0; i < orderResult.orders.length; i++) {
      if (orderResult.orders[i].id === orderID) {
        order = orderResult.orders[i];
        break;
      }
    }
    if (!order) return { success: false, error: 'Order not found' };

    var shipmentsResult = getShipments(orderID);
    var totalFulfilled = 0;
    if (shipmentsResult.success) {
      for (var j = 0; j < shipmentsResult.shipments.length; j++) {
        totalFulfilled += shipmentsResult.shipments[j].totalAmount;
      }
    }

    var paymentsResult = getPayments(orderID);
    var totalPaid = 0;
    if (paymentsResult.success) {
      for (var k = 0; k < paymentsResult.payments.length; k++) {
        totalPaid += paymentsResult.payments[k].amount;
      }
    }

    return {
      success: true,
      commitment: order.commitmentAmount,
      fulfilled: totalFulfilled,
      paid: totalPaid,
      outstanding: order.commitmentAmount - totalFulfilled,
      balance: totalFulfilled - totalPaid
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ===== HELPER FUNCTIONS =====
function formatDateForJSON_(dateVal) {
  if (!dateVal) return null;
  if (dateVal instanceof Date) {
    return dateVal.toISOString();
  }
  if (typeof dateVal === 'string') {
    return new Date(dateVal).toISOString();
  }
  return null;
}
