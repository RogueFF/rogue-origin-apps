/**
 * Wholesale Orders API
 * Migrated from Apps Script to Vercel Functions
 *
 * Sheet Tabs:
 * - Customers: Customer directory
 * - MasterOrders: Order commitments
 * - Shipments: Individual shipments with line items
 * - Payments: Payment records
 * - PriceHistory: Last price per strain+type
 * - COA_Index: COA files from Google Drive (read-only in Vercel)
 *
 * Endpoints:
 * - GET  ?action=test              - Test API
 * - GET  ?action=validatePassword  - Validate password
 * - GET  ?action=getCustomers      - Get all customers
 * - GET  ?action=getMasterOrders   - Get all orders
 * - GET  ?action=getShipments      - Get shipments (optional: orderID filter)
 * - GET  ?action=getPayments       - Get payments (optional: orderID filter)
 * - GET  ?action=getOrderFinancials - Get order financial summary
 * - GET  ?action=getPriceHistory   - Get price history
 * - GET  ?action=getCOAIndex       - Get COA index
 * - GET  ?action=syncCOAIndex      - Sync COA index from Drive
 * - GET  ?action=getCOAsForStrains - Get COA PDFs as base64
 * - POST ?action=saveCustomer      - Create/update customer
 * - POST ?action=deleteCustomer    - Delete customer
 * - POST ?action=saveMasterOrder   - Create/update order
 * - POST ?action=deleteMasterOrder - Delete order (and related records)
 * - POST ?action=saveShipment      - Save shipment
 * - POST ?action=deleteShipment    - Delete shipment
 * - POST ?action=savePayment       - Save payment
 * - POST ?action=deletePayment     - Delete payment
 * - POST ?action=updateOrderPriority - Update order priority
 */

const { google } = require('googleapis');
const { createHandler, success } = require('../_lib/response');
const { readSheet, appendSheet, writeSheet, clearSheet } = require('../_lib/sheets');
const { sanitizeForSheets } = require('../_lib/validate');
const { createError } = require('../_lib/errors');

const SHEET_ID = process.env.ORDERS_SHEET_ID;
const ORDERS_PASSWORD = process.env.ORDERS_PASSWORD;
const COA_FOLDER_ID = '1vNjWtq701h_hSCA1gvjlD37xOZv6QbfO';

// Cache Drive client
let cachedDrive = null;

/**
 * Get authenticated Drive API client
 */
async function getDriveClient() {
  if (cachedDrive) {
    return cachedDrive;
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !privateKey) {
    throw createError('INTERNAL_ERROR', 'Drive API not configured');
  }

  const key = privateKey.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n');

  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });

  cachedDrive = google.drive({ version: 'v3', auth });
  return cachedDrive;
}

// Sheet tab names
const SHEETS = {
  customers: 'Customers',
  orders: 'MasterOrders',
  shipments: 'Shipments',
  payments: 'Payments',
  priceHistory: 'PriceHistory',
  coaIndex: 'COA_Index',
};

// Helper to format dates for JSON
function formatDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  return null;
}

// ===== AUTHENTICATION =====

async function validatePassword(req, res) {
  const password = req.query?.password || '';

  if (!ORDERS_PASSWORD) {
    throw createError('INTERNAL_ERROR', 'Password not configured');
  }

  if (password === ORDERS_PASSWORD) {
    // Generate simple session token
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const tokenString = `${timestamp}-${random}`;
    const sessionToken = Buffer.from(tokenString).toString('base64').substring(0, 32);

    success(res, {
      success: true,
      sessionToken,
      expiresIn: 30 * 24 * 60 * 60 * 1000, // 30 days
    });
  } else {
    success(res, {
      success: false,
      error: 'Invalid password',
    });
  }
}

// ===== CUSTOMERS =====

async function getCustomers(req, res) {
  const data = await readSheet(SHEET_ID, `${SHEETS.customers}!A:K`);

  if (data.length <= 1) {
    return success(res, { success: true, customers: [] });
  }

  const customers = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;

    customers.push({
      id: row[0],
      companyName: row[1] || '',
      contactName: row[2] || '',
      email: row[3] || '',
      phone: row[4] || '',
      shipToAddress: row[5] || '',
      billToAddress: row[6] || '',
      country: row[7] || '',
      notes: row[8] || '',
      createdDate: formatDate(row[9]),
      lastOrderDate: formatDate(row[10]),
    });
  }

  success(res, { success: true, customers });
}

async function saveCustomer(req, res, body) {
  const customerData = body;

  if (!customerData.companyName) {
    throw createError('VALIDATION_ERROR', 'Company name is required');
  }

  // Find existing or generate new ID
  const data = await readSheet(SHEET_ID, `${SHEETS.customers}!A:A`);
  let existingRow = -1;

  if (customerData.id) {
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === customerData.id) {
        existingRow = i + 1;
        break;
      }
    }
  }

  if (!customerData.id) {
    customerData.id = `CUST-${String(data.length).padStart(3, '0')}`;
  }

  const row = [
    customerData.id,
    sanitizeForSheets(customerData.companyName || ''),
    sanitizeForSheets(customerData.contactName || ''),
    sanitizeForSheets(customerData.email || ''),
    sanitizeForSheets(customerData.phone || ''),
    sanitizeForSheets(customerData.shipToAddress || ''),
    sanitizeForSheets(customerData.billToAddress || ''),
    sanitizeForSheets(customerData.country || ''),
    sanitizeForSheets(customerData.notes || ''),
    customerData.createdDate || new Date().toISOString(),
    customerData.lastOrderDate || '',
  ];

  if (existingRow > 0) {
    await writeSheet(SHEET_ID, `${SHEETS.customers}!A${existingRow}:K${existingRow}`, [row]);
  } else {
    await appendSheet(SHEET_ID, `${SHEETS.customers}!A:K`, [row]);
  }

  success(res, { success: true, customer: customerData });
}

async function deleteCustomer(req, res, body) {
  const { id } = body;
  if (!id) {
    throw createError('VALIDATION_ERROR', 'Customer ID is required');
  }

  const data = await readSheet(SHEET_ID, `${SHEETS.customers}!A:A`);
  let rowNum = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      rowNum = i + 1;
      break;
    }
  }

  if (rowNum === -1) {
    throw createError('NOT_FOUND', 'Customer not found');
  }

  await clearSheet(SHEET_ID, `${SHEETS.customers}!A${rowNum}:K${rowNum}`);
  success(res, { success: true });
}

// ===== MASTER ORDERS =====

async function getMasterOrders(req, res) {
  const data = await readSheet(SHEET_ID, `${SHEETS.orders}!A:V`);

  if (data.length <= 1) {
    return success(res, { success: true, orders: [] });
  }

  const orders = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;

    orders.push({
      id: row[0],
      customerID: row[1] || '',
      customerName: row[2] || '',
      commitmentAmount: parseFloat(row[3]) || 0,
      currency: row[4] || 'USD',
      status: row[5] || 'pending',
      poNumber: row[6] || '',
      terms: row[7] || 'DAP',
      createdDate: formatDate(row[8]),
      dueDate: formatDate(row[9]),
      shipTo_Contact: row[10] || '',
      shipTo_Company: row[11] || '',
      shipTo_Address: row[12] || '',
      shipTo_Phone: row[13] || '',
      shipTo_Email: row[14] || '',
      soldTo_Contact: row[15] || '',
      soldTo_Company: row[16] || '',
      soldTo_Address: row[17] || '',
      soldTo_Phone: row[18] || '',
      soldTo_Email: row[19] || '',
      notes: row[20] || '',
      priority: parseInt(row[21]) || null,
    });
  }

  success(res, { success: true, orders });
}

async function saveMasterOrder(req, res, body) {
  const orderData = body;

  // Find existing or generate new ID
  const data = await readSheet(SHEET_ID, `${SHEETS.orders}!A:A`);
  let existingRow = -1;

  if (orderData.id) {
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === orderData.id) {
        existingRow = i + 1;
        break;
      }
    }
  }

  if (!orderData.id) {
    const year = new Date().getFullYear();
    // Find highest existing order number for this year
    let maxOrderNum = 0;
    for (let i = 1; i < data.length; i++) {
      const existingId = data[i][0];
      if (existingId && existingId.toString().startsWith(`MO-${year}-`)) {
        const numStr = existingId.toString().split('-')[2];
        const num = parseInt(numStr, 10);
        if (num > maxOrderNum) maxOrderNum = num;
      }
    }
    orderData.id = `MO-${year}-${String(maxOrderNum + 1).padStart(3, '0')}`;
  }

  const row = [
    orderData.id,
    sanitizeForSheets(orderData.customerID || ''),
    sanitizeForSheets(orderData.customerName || ''),
    orderData.commitmentAmount || 0,
    sanitizeForSheets(orderData.currency || 'USD'),
    sanitizeForSheets(orderData.status || 'pending'),
    sanitizeForSheets(orderData.poNumber || ''),
    sanitizeForSheets(orderData.terms || 'DAP'),
    orderData.createdDate || new Date().toISOString(),
    orderData.dueDate || '',
    sanitizeForSheets(orderData.shipTo_Contact || ''),
    sanitizeForSheets(orderData.shipTo_Company || ''),
    sanitizeForSheets(orderData.shipTo_Address || ''),
    sanitizeForSheets(orderData.shipTo_Phone || ''),
    sanitizeForSheets(orderData.shipTo_Email || ''),
    sanitizeForSheets(orderData.soldTo_Contact || ''),
    sanitizeForSheets(orderData.soldTo_Company || ''),
    sanitizeForSheets(orderData.soldTo_Address || ''),
    sanitizeForSheets(orderData.soldTo_Phone || ''),
    sanitizeForSheets(orderData.soldTo_Email || ''),
    sanitizeForSheets(orderData.notes || ''),
    orderData.priority || '',
  ];

  if (existingRow > 0) {
    await writeSheet(SHEET_ID, `${SHEETS.orders}!A${existingRow}:V${existingRow}`, [row]);
  } else {
    await appendSheet(SHEET_ID, `${SHEETS.orders}!A:V`, [row]);
  }

  success(res, { success: true, order: orderData });
}

async function deleteMasterOrder(req, res, body) {
  const orderID = body.orderID;
  if (!orderID) {
    throw createError('VALIDATION_ERROR', 'Order ID is required');
  }

  // Delete order
  const orderData = await readSheet(SHEET_ID, `${SHEETS.orders}!A:A`);
  let orderRow = -1;
  for (let i = 1; i < orderData.length; i++) {
    if (orderData[i][0] === orderID) {
      orderRow = i + 1;
      break;
    }
  }

  if (orderRow === -1) {
    throw createError('NOT_FOUND', 'Order not found');
  }

  await clearSheet(SHEET_ID, `${SHEETS.orders}!A${orderRow}:V${orderRow}`);

  // Delete associated shipments
  const shipmentData = await readSheet(SHEET_ID, `${SHEETS.shipments}!A:B`);
  for (let i = shipmentData.length - 1; i >= 1; i--) {
    if (shipmentData[i][1] === orderID) {
      await clearSheet(SHEET_ID, `${SHEETS.shipments}!A${i + 1}:O${i + 1}`);
    }
  }

  // Delete associated payments
  const paymentData = await readSheet(SHEET_ID, `${SHEETS.payments}!A:B`);
  for (let i = paymentData.length - 1; i >= 1; i--) {
    if (paymentData[i][1] === orderID) {
      await clearSheet(SHEET_ID, `${SHEETS.payments}!A${i + 1}:I${i + 1}`);
    }
  }

  success(res, { success: true, message: 'Order and associated records deleted' });
}

async function updateOrderPriority(req, res, body) {
  const { orderID, newPriority } = body;

  if (!orderID) {
    throw createError('VALIDATION_ERROR', 'Order ID is required');
  }

  const data = await readSheet(SHEET_ID, `${SHEETS.orders}!A:A`);
  let rowNum = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === orderID) {
      rowNum = i + 1;
      break;
    }
  }

  if (rowNum === -1) {
    throw createError('NOT_FOUND', 'Order not found');
  }

  // Update priority column (V = column 22)
  await writeSheet(SHEET_ID, `${SHEETS.orders}!V${rowNum}`, [[newPriority || '']]);
  success(res, { success: true });
}

// ===== SHIPMENTS =====

async function getShipments(req, res) {
  const orderID = req.query?.orderID;
  const data = await readSheet(SHEET_ID, `${SHEETS.shipments}!A:O`);

  if (data.length <= 1) {
    return success(res, { success: true, shipments: [] });
  }

  const shipments = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    if (orderID && row[1] !== orderID) continue;

    const shipment = {
      id: row[0],
      orderID: row[1] || '',
      invoiceNumber: row[2] || '',
      shipmentDate: formatDate(row[3]),
      startDateTime: row[4] ? String(row[4]) : null,
      status: row[5] || 'pending',
      dimensionsJSON: row[6] || '{}',
      lineItemsJSON: row[7] || '[]',
      subTotal: parseFloat(row[8]) || 0,
      discount: parseFloat(row[9]) || 0,
      freightCost: parseFloat(row[10]) || 0,
      totalAmount: parseFloat(row[11]) || 0,
      trackingNumber: row[12] || '',
      carrier: row[13] || '',
      notes: row[14] || '',
    };

    // Parse JSON fields
    try {
      shipment.dimensions = JSON.parse(shipment.dimensionsJSON);
      shipment.lineItems = JSON.parse(shipment.lineItemsJSON);
    } catch {
      shipment.dimensions = {};
      shipment.lineItems = [];
    }

    shipments.push(shipment);
  }

  success(res, { success: true, shipments });
}

async function saveShipment(req, res, body) {
  const shipmentData = body;

  // Find existing or generate new ID
  const data = await readSheet(SHEET_ID, `${SHEETS.shipments}!A:C`);
  let existingRow = -1;

  if (shipmentData.id) {
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === shipmentData.id) {
        existingRow = i + 1;
        break;
      }
    }
  }

  if (!shipmentData.id) {
    const orderNum = shipmentData.orderID ? shipmentData.orderID.split('-').pop() : '000';
    shipmentData.id = `SH-${orderNum}-${String(data.length).padStart(2, '0')}`;
  }

  // Generate invoice number if not provided
  if (!shipmentData.invoiceNumber) {
    const year = new Date().getFullYear();
    let maxNum = 0;
    for (let i = 1; i < data.length; i++) {
      const invoice = data[i][2] || '';
      if (invoice.indexOf(`INV-${year}`) === 0) {
        const num = parseInt(invoice.split('-').pop());
        if (num > maxNum) maxNum = num;
      }
    }
    shipmentData.invoiceNumber = `INV-${year}-${String(maxNum + 1).padStart(4, '0')}`;
  }

  const row = [
    shipmentData.id,
    sanitizeForSheets(shipmentData.orderID || ''),
    shipmentData.invoiceNumber,
    shipmentData.shipmentDate || new Date().toISOString(),
    shipmentData.startDateTime ? String(shipmentData.startDateTime) : '',
    sanitizeForSheets(shipmentData.status || 'pending'),
    JSON.stringify(shipmentData.dimensions || {}),
    JSON.stringify(shipmentData.lineItems || []),
    shipmentData.subTotal || 0,
    shipmentData.discount || 0,
    shipmentData.freightCost || 0,
    shipmentData.totalAmount || 0,
    sanitizeForSheets(shipmentData.trackingNumber || ''),
    sanitizeForSheets(shipmentData.carrier || ''),
    sanitizeForSheets(shipmentData.notes || ''),
  ];

  if (existingRow > 0) {
    await writeSheet(SHEET_ID, `${SHEETS.shipments}!A${existingRow}:O${existingRow}`, [row]);
  } else {
    await appendSheet(SHEET_ID, `${SHEETS.shipments}!A:O`, [row]);
  }

  // Update price history for line items
  if (shipmentData.lineItems && shipmentData.lineItems.length > 0) {
    await updatePriceHistoryForItems(shipmentData.lineItems);
  }

  success(res, { success: true, shipment: shipmentData });
}

async function deleteShipment(req, res, body) {
  const shipmentID = body.shipmentID;
  if (!shipmentID) {
    throw createError('VALIDATION_ERROR', 'Shipment ID is required');
  }

  const data = await readSheet(SHEET_ID, `${SHEETS.shipments}!A:A`);
  let rowNum = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === shipmentID) {
      rowNum = i + 1;
      break;
    }
  }

  if (rowNum === -1) {
    throw createError('NOT_FOUND', 'Shipment not found');
  }

  await clearSheet(SHEET_ID, `${SHEETS.shipments}!A${rowNum}:O${rowNum}`);
  success(res, { success: true, message: 'Shipment deleted' });
}

// ===== PAYMENTS =====

async function getPayments(req, res) {
  const orderID = req.query?.orderID;
  const data = await readSheet(SHEET_ID, `${SHEETS.payments}!A:I`);

  if (data.length <= 1) {
    return success(res, { success: true, payments: [] });
  }

  const payments = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    if (orderID && row[1] !== orderID) continue;

    payments.push({
      id: row[0],
      orderID: row[1] || '',
      paymentDate: formatDate(row[2]),
      amount: parseFloat(row[3]) || 0,
      method: row[4] || '',
      reference: row[5] || '',
      notes: row[6] || '',
      recordedBy: row[7] || '',
      recordedDate: formatDate(row[8]),
    });
  }

  success(res, { success: true, payments });
}

async function savePayment(req, res, body) {
  const paymentData = body;

  if (!paymentData.orderID) {
    throw createError('VALIDATION_ERROR', 'Order ID is required');
  }

  const data = await readSheet(SHEET_ID, `${SHEETS.payments}!A:A`);
  let existingRow = -1;

  if (paymentData.id) {
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === paymentData.id) {
        existingRow = i + 1;
        break;
      }
    }
  }

  if (!paymentData.id) {
    paymentData.id = `PAY-${String(data.length).padStart(5, '0')}`;
  }

  const row = [
    paymentData.id,
    sanitizeForSheets(paymentData.orderID || ''),
    paymentData.paymentDate || new Date().toISOString(),
    paymentData.amount || 0,
    sanitizeForSheets(paymentData.method || ''),
    sanitizeForSheets(paymentData.reference || ''),
    sanitizeForSheets(paymentData.notes || ''),
    sanitizeForSheets(paymentData.recordedBy || ''),
    paymentData.recordedDate || new Date().toISOString(),
  ];

  if (existingRow > 0) {
    await writeSheet(SHEET_ID, `${SHEETS.payments}!A${existingRow}:I${existingRow}`, [row]);
  } else {
    await appendSheet(SHEET_ID, `${SHEETS.payments}!A:I`, [row]);
  }

  success(res, { success: true, payment: paymentData });
}

async function deletePayment(req, res, body) {
  const paymentID = body.paymentID;
  if (!paymentID) {
    throw createError('VALIDATION_ERROR', 'Payment ID is required');
  }

  const data = await readSheet(SHEET_ID, `${SHEETS.payments}!A:A`);
  let rowNum = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === paymentID) {
      rowNum = i + 1;
      break;
    }
  }

  if (rowNum === -1) {
    throw createError('NOT_FOUND', 'Payment not found');
  }

  await clearSheet(SHEET_ID, `${SHEETS.payments}!A${rowNum}:I${rowNum}`);
  success(res, { success: true, message: 'Payment deleted' });
}

// ===== PRICE HISTORY =====

async function getPriceHistory(req, res) {
  const data = await readSheet(SHEET_ID, `${SHEETS.priceHistory}!A:E`);

  if (data.length <= 1) {
    return success(res, { success: true, prices: [] });
  }

  const prices = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;

    prices.push({
      strain: row[0] || '',
      type: row[1] || '',
      lastPrice: parseFloat(row[2]) || 0,
      lastUsedDate: formatDate(row[3]),
      customerID: row[4] || '',
    });
  }

  success(res, { success: true, prices });
}

async function updatePriceHistoryForItems(lineItems) {
  if (!lineItems || !lineItems.length) return;

  const data = await readSheet(SHEET_ID, `${SHEETS.priceHistory}!A:E`);

  for (const item of lineItems) {
    if (!item.strain || !item.type || !item.unitPrice) continue;

    let existingRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === item.strain && data[i][1] === item.type) {
        existingRow = i + 1;
        break;
      }
    }

    const row = [
      item.strain,
      item.type,
      item.unitPrice,
      new Date().toISOString(),
      item.customerID || '',
    ];

    if (existingRow > 0) {
      await writeSheet(SHEET_ID, `${SHEETS.priceHistory}!A${existingRow}:E${existingRow}`, [row]);
    } else {
      await appendSheet(SHEET_ID, `${SHEETS.priceHistory}!A:E`, [row]);
    }
  }
}

// ===== ORDER FINANCIALS =====

async function getOrderFinancials(req, res) {
  const orderID = req.query?.orderID;
  if (!orderID) {
    throw createError('VALIDATION_ERROR', 'Order ID is required');
  }

  // Get order commitment
  const orderData = await readSheet(SHEET_ID, `${SHEETS.orders}!A:D`);
  let commitment = 0;
  let orderFound = false;

  for (let i = 1; i < orderData.length; i++) {
    if (orderData[i][0] === orderID) {
      commitment = parseFloat(orderData[i][3]) || 0;
      orderFound = true;
      break;
    }
  }

  if (!orderFound) {
    throw createError('NOT_FOUND', 'Order not found');
  }

  // Calculate fulfilled total from shipments
  const shipmentData = await readSheet(SHEET_ID, `${SHEETS.shipments}!A:L`);
  let fulfilled = 0;
  for (let i = 1; i < shipmentData.length; i++) {
    if (shipmentData[i][1] === orderID) {
      fulfilled += parseFloat(shipmentData[i][11]) || 0; // totalAmount column
    }
  }

  // Calculate paid total from payments
  const paymentData = await readSheet(SHEET_ID, `${SHEETS.payments}!A:D`);
  let paid = 0;
  for (let i = 1; i < paymentData.length; i++) {
    if (paymentData[i][1] === orderID) {
      paid += parseFloat(paymentData[i][3]) || 0; // amount column
    }
  }

  success(res, {
    success: true,
    commitment,
    fulfilled,
    paid,
    outstanding: commitment - fulfilled,
    balance: fulfilled - paid,
  });
}

// ===== COA INDEX =====

async function getCOAIndex(req, res) {
  const data = await readSheet(SHEET_ID, `${SHEETS.coaIndex}!A:F`);

  if (data.length <= 1) {
    return success(res, { success: true, coas: [] });
  }

  const coas = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;

    coas.push({
      strain: row[0] || '',
      fileName: row[1] || '',
      fileID: row[2] || '',
      url: row[3] || '',
      downloadURL: row[4] || '',
      lastSynced: formatDate(row[5]),
    });
  }

  success(res, { success: true, coas });
}

/**
 * Sync COA index from Google Drive folder
 * Scans the COA folder and updates the index in the Sheet
 */
async function syncCOAIndex(req, res) {
  const drive = await getDriveClient();

  // List all PDF files in the COA folder
  const response = await drive.files.list({
    q: `'${COA_FOLDER_ID}' in parents and mimeType='application/pdf' and trashed=false`,
    fields: 'files(id, name, webViewLink)',
    pageSize: 1000,
  });

  const files = response.data.files || [];
  const coaData = [];

  for (const file of files) {
    // Extract strain name from filename
    const strain = file.name
      .replace(/\.pdf$/i, '')
      .replace(/[\s_-]*COA[\s_-]*/gi, '')
      .replace(/_/g, ' ')
      .trim();

    coaData.push([
      strain,
      file.name,
      file.id,
      file.webViewLink || '',
      `https://drive.google.com/uc?export=download&id=${file.id}`,
      new Date().toISOString(),
    ]);
  }

  // Clear existing data and write new
  if (coaData.length > 0) {
    // Write headers if needed
    const existing = await readSheet(SHEET_ID, `${SHEETS.coaIndex}!A1:F1`);
    if (!existing || existing.length === 0) {
      await writeSheet(SHEET_ID, `${SHEETS.coaIndex}!A1:F1`, [
        ['Strain', 'FileName', 'FileID', 'URL', 'DownloadURL', 'LastSynced'],
      ]);
    }

    // Clear old data (rows 2+)
    await clearSheet(SHEET_ID, `${SHEETS.coaIndex}!A2:F1000`);

    // Write new data
    await writeSheet(SHEET_ID, `${SHEETS.coaIndex}!A2:F${coaData.length + 1}`, coaData);
  }

  success(res, { success: true, count: coaData.length });
}

/**
 * Get COA PDFs for a list of strains as base64
 * Uses fuzzy matching to find best COA match
 */
async function getCOAsForStrains(req, res) {
  const strainsParam = req.query?.strains;
  if (!strainsParam) {
    throw createError('VALIDATION_ERROR', 'Missing strains parameter');
  }

  const strainList = strainsParam.split(',').map(s => s.trim());
  const drive = await getDriveClient();

  // Get COA index
  const indexData = await readSheet(SHEET_ID, `${SHEETS.coaIndex}!A:C`);
  const coaIndex = [];
  for (let i = 1; i < indexData.length; i++) {
    if (indexData[i][0]) {
      coaIndex.push({
        strain: indexData[i][0],
        fileName: indexData[i][1],
        fileID: indexData[i][2],
      });
    }
  }

  const results = [];

  for (const requestedStrain of strainList) {
    const normalized = normalizeStrainName(requestedStrain);

    // Find best match
    let bestMatch = null;
    let bestScore = 0;

    for (const coa of coaIndex) {
      const coaNormalized = normalizeStrainName(coa.fileName);

      // Check if strain name is contained in filename
      if (coaNormalized.includes(normalized)) {
        bestScore = 1.0;
        bestMatch = coa;
        break;
      }

      // Fall back to word overlap scoring
      const score = calculateMatchScore(normalized, coaNormalized);
      if (score > bestScore && score >= 0.6) {
        bestScore = score;
        bestMatch = coa;
      }
    }

    if (bestMatch) {
      try {
        // Fetch file content as base64
        const fileResponse = await drive.files.get({
          fileId: bestMatch.fileID,
          alt: 'media',
        }, { responseType: 'arraybuffer' });

        const base64 = Buffer.from(fileResponse.data).toString('base64');

        results.push({
          strain: requestedStrain,
          matched: true,
          matchedStrain: bestMatch.strain,
          fileName: bestMatch.fileName,
          base64,
        });
      } catch (fileError) {
        console.error(`Failed to fetch COA for ${bestMatch.strain}:`, fileError.message);
        results.push({
          strain: requestedStrain,
          matched: false,
          error: 'Failed to fetch COA file',
        });
      }
    } else {
      results.push({
        strain: requestedStrain,
        matched: false,
        error: 'No matching COA found',
      });
    }
  }

  success(res, { success: true, coas: results });
}

/**
 * Normalize strain name for matching
 */
function normalizeStrainName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/^20\d{2}\s+/, '') // Remove year prefixes
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculate match score between two strain names
 */
function calculateMatchScore(name1, name2) {
  if (name1 === name2) return 1.0;
  if (!name1 || !name2) return 0;

  if (name1.includes(name2) || name2.includes(name1)) {
    return 0.9;
  }

  // Word overlap scoring
  const words1 = name1.split(' ');
  const words2 = name2.split(' ');
  let matchedWords = 0;

  for (const w1 of words1) {
    for (const w2 of words2) {
      if (w1 === w2 && w1.length > 2) {
        matchedWords++;
        break;
      }
    }
  }

  return matchedWords / Math.max(words1.length, words2.length);
}

// ===== TEST =====

async function test(req, res) {
  success(res, {
    ok: true,
    message: 'Wholesale Orders API is working (Vercel)',
    timestamp: new Date().toISOString(),
  });
}

// Export handler with all actions
module.exports = createHandler({
  // Auth
  validatePassword,

  // Customers
  getCustomers,
  saveCustomer,
  deleteCustomer,

  // Master Orders
  getMasterOrders,
  saveMasterOrder,
  deleteMasterOrder,
  updateOrderPriority,

  // Shipments
  getShipments,
  saveShipment,
  deleteShipment,

  // Payments
  getPayments,
  savePayment,
  deletePayment,

  // Price History
  getPriceHistory,

  // Order Financials
  getOrderFinancials,

  // COA
  getCOAIndex,
  syncCOAIndex,
  getCOAsForStrains,

  // Test
  test,
});
