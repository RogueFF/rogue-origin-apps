/**
 * Wholesale Orders API Handler for Cloudflare Workers
 * Migrated from Vercel Functions
 *
 * Sheet Tabs:
 * - Customers: Customer directory
 * - MasterOrders: Order commitments
 * - Shipments: Individual shipments with line items
 * - Payments: Payment records
 * - PriceHistory: Last price per strain+type
 * - COA_Index: COA files from Google Drive
 */

import { readSheet, writeSheet, appendSheet, clearSheet } from '../lib/sheets.js';
import { successResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { sanitizeForSheets } from '../lib/validate.js';

const COA_FOLDER_ID = '1vNjWtq701h_hSCA1gvjlD37xOZv6QbfO';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Sheet tab names
const SHEETS = {
  customers: 'Customers',
  orders: 'MasterOrders',
  shipments: 'Shipments',
  payments: 'Payments',
  priceHistory: 'PriceHistory',
  coaIndex: 'COA_Index',
};

// Cache Drive access token
let driveTokenCache = {
  token: null,
  expiresAt: 0,
};

/**
 * Get Drive API access token using service account JWT
 */
async function getDriveAccessToken(env) {
  // Check cache
  if (driveTokenCache.token && Date.now() < driveTokenCache.expiresAt) {
    return driveTokenCache.token;
  }

  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = env.GOOGLE_PRIVATE_KEY;

  if (!email || !privateKey) {
    throw createError('INTERNAL_ERROR', 'Drive API not configured');
  }

  // Create JWT for Drive API
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: DRIVE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const base64url = (obj) => {
    const json = JSON.stringify(obj);
    const base64 = btoa(json);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  };

  const headerB64 = base64url(header);
  const payloadB64 = base64url(payload);
  const signatureInput = `${headerB64}.${payloadB64}`;

  // Parse and sign with private key
  const key = privateKey
    .replace(/\\n/g, '\n')
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');

  const binaryKey = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signatureInput)
  );

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  const jwt = `${signatureInput}.${signatureB64}`;

  // Exchange JWT for access token
  const response = await fetch(DRIVE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Drive token fetch failed:', error);
    throw createError('INTERNAL_ERROR', 'Failed to authenticate with Google Drive');
  }

  const data = await response.json();
  driveTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };

  return driveTokenCache.token;
}

/**
 * Make authenticated request to Drive API
 */
async function driveRequest(url, env, options = {}) {
  const token = await getDriveAccessToken(env);

  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`Drive API error (${response.status}):`, error);
    throw createError('INTERNAL_ERROR', `Drive API error: ${response.status}`);
  }

  return response;
}

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

async function validatePassword(params, env) {
  const password = params.password || '';
  const expectedPassword = env.ORDERS_PASSWORD;

  if (!expectedPassword) {
    throw createError('INTERNAL_ERROR', 'Password not configured');
  }

  if (password === expectedPassword) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const tokenString = `${timestamp}-${random}`;
    const sessionToken = btoa(tokenString).substring(0, 32);

    return successResponse({
      success: true,
      sessionToken,
      expiresIn: 30 * 24 * 60 * 60 * 1000, // 30 days
    });
  } else {
    return successResponse({
      success: false,
      error: 'Invalid password',
    });
  }
}

// ===== CUSTOMERS =====

async function getCustomers(params, env) {
  const sheetId = env.ORDERS_SHEET_ID;
  const data = await readSheet(sheetId, `${SHEETS.customers}!A:K`, env);

  if (data.length <= 1) {
    return successResponse({ success: true, customers: [] });
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

  return successResponse({ success: true, customers });
}

async function saveCustomer(params, body, env) {
  const sheetId = env.ORDERS_SHEET_ID;
  const customerData = body;

  if (!customerData.companyName) {
    throw createError('VALIDATION_ERROR', 'Company name is required');
  }

  const data = await readSheet(sheetId, `${SHEETS.customers}!A:A`, env);
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
    await writeSheet(sheetId, `${SHEETS.customers}!A${existingRow}:K${existingRow}`, [row], env);
  } else {
    await appendSheet(sheetId, `${SHEETS.customers}!A:K`, [row], env);
  }

  return successResponse({ success: true, customer: customerData });
}

async function deleteCustomer(params, body, env) {
  const sheetId = env.ORDERS_SHEET_ID;
  const { id } = body;

  if (!id) {
    throw createError('VALIDATION_ERROR', 'Customer ID is required');
  }

  const data = await readSheet(sheetId, `${SHEETS.customers}!A:A`, env);
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

  await clearSheet(sheetId, `${SHEETS.customers}!A${rowNum}:K${rowNum}`, env);
  return successResponse({ success: true });
}

// ===== MASTER ORDERS =====

async function getMasterOrders(params, env) {
  const sheetId = env.ORDERS_SHEET_ID;
  const data = await readSheet(sheetId, `${SHEETS.orders}!A:V`, env);

  if (data.length <= 1) {
    return successResponse({ success: true, orders: [] });
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

  return successResponse({ success: true, orders });
}

async function saveMasterOrder(params, body, env) {
  const sheetId = env.ORDERS_SHEET_ID;
  const orderData = body;

  const data = await readSheet(sheetId, `${SHEETS.orders}!A:A`, env);
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
    await writeSheet(sheetId, `${SHEETS.orders}!A${existingRow}:V${existingRow}`, [row], env);
  } else {
    await appendSheet(sheetId, `${SHEETS.orders}!A:V`, [row], env);
  }

  return successResponse({ success: true, order: orderData });
}

async function deleteMasterOrder(params, body, env) {
  const sheetId = env.ORDERS_SHEET_ID;
  const orderID = body.orderID;

  if (!orderID) {
    throw createError('VALIDATION_ERROR', 'Order ID is required');
  }

  const orderData = await readSheet(sheetId, `${SHEETS.orders}!A:A`, env);
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

  await clearSheet(sheetId, `${SHEETS.orders}!A${orderRow}:V${orderRow}`, env);

  // Delete associated shipments
  const shipmentData = await readSheet(sheetId, `${SHEETS.shipments}!A:B`, env);
  for (let i = shipmentData.length - 1; i >= 1; i--) {
    if (shipmentData[i][1] === orderID) {
      await clearSheet(sheetId, `${SHEETS.shipments}!A${i + 1}:O${i + 1}`, env);
    }
  }

  // Delete associated payments
  const paymentData = await readSheet(sheetId, `${SHEETS.payments}!A:B`, env);
  for (let i = paymentData.length - 1; i >= 1; i--) {
    if (paymentData[i][1] === orderID) {
      await clearSheet(sheetId, `${SHEETS.payments}!A${i + 1}:I${i + 1}`, env);
    }
  }

  return successResponse({ success: true, message: 'Order and associated records deleted' });
}

async function updateOrderPriority(params, body, env) {
  const sheetId = env.ORDERS_SHEET_ID;
  const { orderID, newPriority } = body;

  if (!orderID) {
    throw createError('VALIDATION_ERROR', 'Order ID is required');
  }

  const data = await readSheet(sheetId, `${SHEETS.orders}!A:A`, env);
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

  await writeSheet(sheetId, `${SHEETS.orders}!V${rowNum}`, [[newPriority || '']], env);
  return successResponse({ success: true });
}

// ===== SHIPMENTS =====

async function getShipments(params, env) {
  const sheetId = env.ORDERS_SHEET_ID;
  const orderID = params.orderID;
  const data = await readSheet(sheetId, `${SHEETS.shipments}!A:O`, env);

  if (data.length <= 1) {
    return successResponse({ success: true, shipments: [] });
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

    try {
      shipment.dimensions = JSON.parse(shipment.dimensionsJSON);
      shipment.lineItems = JSON.parse(shipment.lineItemsJSON);
    } catch {
      shipment.dimensions = {};
      shipment.lineItems = [];
    }

    shipments.push(shipment);
  }

  return successResponse({ success: true, shipments });
}

async function saveShipment(params, body, env) {
  const sheetId = env.ORDERS_SHEET_ID;
  const shipmentData = body;

  const data = await readSheet(sheetId, `${SHEETS.shipments}!A:C`, env);
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
    await writeSheet(sheetId, `${SHEETS.shipments}!A${existingRow}:O${existingRow}`, [row], env);
  } else {
    await appendSheet(sheetId, `${SHEETS.shipments}!A:O`, [row], env);
  }

  // Update price history for line items
  if (shipmentData.lineItems && shipmentData.lineItems.length > 0) {
    await updatePriceHistoryForItems(shipmentData.lineItems, env);
  }

  return successResponse({ success: true, shipment: shipmentData });
}

async function deleteShipment(params, body, env) {
  const sheetId = env.ORDERS_SHEET_ID;
  const shipmentID = body.shipmentID;

  if (!shipmentID) {
    throw createError('VALIDATION_ERROR', 'Shipment ID is required');
  }

  const data = await readSheet(sheetId, `${SHEETS.shipments}!A:A`, env);
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

  await clearSheet(sheetId, `${SHEETS.shipments}!A${rowNum}:O${rowNum}`, env);
  return successResponse({ success: true, message: 'Shipment deleted' });
}

// ===== PAYMENTS =====

async function getPayments(params, env) {
  const sheetId = env.ORDERS_SHEET_ID;
  const orderID = params.orderID;
  const data = await readSheet(sheetId, `${SHEETS.payments}!A:I`, env);

  if (data.length <= 1) {
    return successResponse({ success: true, payments: [] });
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

  return successResponse({ success: true, payments });
}

async function savePayment(params, body, env) {
  const sheetId = env.ORDERS_SHEET_ID;
  const paymentData = body;

  if (!paymentData.orderID) {
    throw createError('VALIDATION_ERROR', 'Order ID is required');
  }

  const data = await readSheet(sheetId, `${SHEETS.payments}!A:A`, env);
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
    await writeSheet(sheetId, `${SHEETS.payments}!A${existingRow}:I${existingRow}`, [row], env);
  } else {
    await appendSheet(sheetId, `${SHEETS.payments}!A:I`, [row], env);
  }

  return successResponse({ success: true, payment: paymentData });
}

async function deletePayment(params, body, env) {
  const sheetId = env.ORDERS_SHEET_ID;
  const paymentID = body.paymentID;

  if (!paymentID) {
    throw createError('VALIDATION_ERROR', 'Payment ID is required');
  }

  const data = await readSheet(sheetId, `${SHEETS.payments}!A:A`, env);
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

  await clearSheet(sheetId, `${SHEETS.payments}!A${rowNum}:I${rowNum}`, env);
  return successResponse({ success: true, message: 'Payment deleted' });
}

// ===== PRICE HISTORY =====

async function getPriceHistory(params, env) {
  const sheetId = env.ORDERS_SHEET_ID;
  const data = await readSheet(sheetId, `${SHEETS.priceHistory}!A:E`, env);

  if (data.length <= 1) {
    return successResponse({ success: true, prices: [] });
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

  return successResponse({ success: true, prices });
}

async function updatePriceHistoryForItems(lineItems, env) {
  if (!lineItems || !lineItems.length) return;

  const sheetId = env.ORDERS_SHEET_ID;
  const data = await readSheet(sheetId, `${SHEETS.priceHistory}!A:E`, env);

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
      await writeSheet(sheetId, `${SHEETS.priceHistory}!A${existingRow}:E${existingRow}`, [row], env);
    } else {
      await appendSheet(sheetId, `${SHEETS.priceHistory}!A:E`, [row], env);
    }
  }
}

// ===== ORDER FINANCIALS =====

async function getOrderFinancials(params, env) {
  const sheetId = env.ORDERS_SHEET_ID;
  const orderID = params.orderID;

  if (!orderID) {
    throw createError('VALIDATION_ERROR', 'Order ID is required');
  }

  const orderData = await readSheet(sheetId, `${SHEETS.orders}!A:D`, env);
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

  const shipmentData = await readSheet(sheetId, `${SHEETS.shipments}!A:L`, env);
  let fulfilled = 0;
  for (let i = 1; i < shipmentData.length; i++) {
    if (shipmentData[i][1] === orderID) {
      fulfilled += parseFloat(shipmentData[i][11]) || 0;
    }
  }

  const paymentData = await readSheet(sheetId, `${SHEETS.payments}!A:D`, env);
  let paid = 0;
  for (let i = 1; i < paymentData.length; i++) {
    if (paymentData[i][1] === orderID) {
      paid += parseFloat(paymentData[i][3]) || 0;
    }
  }

  return successResponse({
    success: true,
    commitment,
    fulfilled,
    paid,
    outstanding: commitment - fulfilled,
    balance: fulfilled - paid,
  });
}

// ===== COA INDEX =====

async function getCOAIndex(params, env) {
  const sheetId = env.ORDERS_SHEET_ID;
  const data = await readSheet(sheetId, `${SHEETS.coaIndex}!A:F`, env);

  if (data.length <= 1) {
    return successResponse({ success: true, coas: [] });
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

  return successResponse({ success: true, coas });
}

/**
 * Sync COA index from Google Drive folder using REST API
 */
async function syncCOAIndex(params, env) {
  const sheetId = env.ORDERS_SHEET_ID;

  // List PDF files in COA folder using Drive REST API
  const listUrl = `${DRIVE_API_BASE}/files?q='${COA_FOLDER_ID}'+in+parents+and+mimeType='application/pdf'+and+trashed=false&fields=files(id,name,webViewLink)&pageSize=1000`;
  const response = await driveRequest(listUrl, env);
  const result = await response.json();

  const files = result.files || [];
  const coaData = [];

  for (const file of files) {
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

  if (coaData.length > 0) {
    const existing = await readSheet(sheetId, `${SHEETS.coaIndex}!A1:F1`, env);
    if (!existing || existing.length === 0) {
      await writeSheet(sheetId, `${SHEETS.coaIndex}!A1:F1`, [
        ['Strain', 'FileName', 'FileID', 'URL', 'DownloadURL', 'LastSynced'],
      ], env);
    }

    await clearSheet(sheetId, `${SHEETS.coaIndex}!A2:F1000`, env);
    await writeSheet(sheetId, `${SHEETS.coaIndex}!A2:F${coaData.length + 1}`, coaData, env);
  }

  return successResponse({ success: true, count: coaData.length });
}

/**
 * Get COA PDFs for strains as base64 using Drive REST API
 */
async function getCOAsForStrains(params, env) {
  const strainsParam = params.strains;
  if (!strainsParam) {
    throw createError('VALIDATION_ERROR', 'Missing strains parameter');
  }

  const strainList = strainsParam.split(',').map(s => s.trim());
  const sheetId = env.ORDERS_SHEET_ID;

  const indexData = await readSheet(sheetId, `${SHEETS.coaIndex}!A:C`, env);
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

    let bestMatch = null;
    let bestScore = 0;

    for (const coa of coaIndex) {
      const coaNormalized = normalizeStrainName(coa.fileName);

      if (coaNormalized.includes(normalized)) {
        bestScore = 1.0;
        bestMatch = coa;
        break;
      }

      const score = calculateMatchScore(normalized, coaNormalized);
      if (score > bestScore && score >= 0.6) {
        bestScore = score;
        bestMatch = coa;
      }
    }

    if (bestMatch) {
      try {
        const fileUrl = `${DRIVE_API_BASE}/files/${bestMatch.fileID}?alt=media`;
        const fileResponse = await driveRequest(fileUrl, env);
        const arrayBuffer = await fileResponse.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

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

  return successResponse({ success: true, coas: results });
}

function normalizeStrainName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/^20\d{2}\s+/, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function calculateMatchScore(name1, name2) {
  if (name1 === name2) return 1.0;
  if (!name1 || !name2) return 0;

  if (name1.includes(name2) || name2.includes(name1)) {
    return 0.9;
  }

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

// ===== SCOREBOARD ORDER QUEUE =====

async function count5kgBagsForStrain(strain, startDateTime, env) {
  const productionSheetId = env.PRODUCTION_SHEET_ID;
  if (!productionSheetId) {
    console.log('[count5kgBagsForStrain] PRODUCTION_SHEET_ID not configured');
    return 0;
  }

  try {
    const trackingData = await readSheet(productionSheetId, "'Rogue Origin Production Tracking'!A1:F2001", env);
    if (!trackingData || trackingData.length < 2) return 0;

    const headers = trackingData[0];
    const timestampCol = headers.indexOf('Timestamp');
    const sizeCol = headers.indexOf('Size');

    if (timestampCol === -1 || sizeCol === -1) {
      console.log('[count5kgBagsForStrain] Required columns not found');
      return 0;
    }

    let startFilter = null;
    if (startDateTime) {
      startFilter = new Date(startDateTime);
      if (isNaN(startFilter.getTime())) startFilter = null;
    }

    const now = new Date();
    const pacificOffset = -8 * 60;
    const pacificDate = new Date(now.getTime() + (pacificOffset + now.getTimezoneOffset()) * 60000);
    const year = pacificDate.getFullYear();
    const month = String(pacificDate.getMonth() + 1).padStart(2, '0');
    const monthSheetName = `${year}-${month}`;

    let productionData = [];
    try {
      productionData = await readSheet(productionSheetId, `'${monthSheetName}'!A:L`, env);
    } catch (e) {
      console.log('[count5kgBagsForStrain] Could not read month sheet:', e.message);
    }

    const cultivarTimeline = [];
    let currentCultivar = null;
    const cultivarCol = 4;

    for (let i = 1; i < productionData.length; i++) {
      const row = productionData[i];
      if (!row[0]) continue;
      if (row[0] === 'Date:') continue;

      const timeSlot = String(row[0] || '');
      const cultivar = String(row[cultivarCol] || '').trim();

      if (timeSlot.includes(':') && cultivar) {
        currentCultivar = cultivar;
        const timeParts = timeSlot.split(':');
        if (timeParts.length >= 2) {
          const hour = parseInt(timeParts[0]);
          const min = parseInt(timeParts[1]) || 0;
          const timestamp = new Date(pacificDate);
          timestamp.setHours(hour, min, 0, 0);
          cultivarTimeline.push({ timestamp, cultivar });
        }
      }
    }

    let bagCount = 0;
    const normalizedStrain = strain.toLowerCase().trim();

    for (let i = 1; i < trackingData.length; i++) {
      const row = trackingData[i];
      const size = String(row[sizeCol] || '').toUpperCase();

      if (!size.includes('5KG') && !size.includes('5 KG')) continue;

      let bagTimestamp = row[timestampCol];
      if (!bagTimestamp) continue;

      let bagDate;
      if (bagTimestamp instanceof Date) {
        bagDate = bagTimestamp;
      } else {
        const cleanTs = String(bagTimestamp).trim();
        bagDate = new Date(cleanTs);
        if (isNaN(bagDate.getTime())) {
          const usMatch = cleanTs.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
          if (usMatch) {
            const [, m, d, y, h, min, sec, ampm] = usMatch;
            let hours = parseInt(h);
            if (ampm) {
              if (ampm.toUpperCase() === 'PM' && hours !== 12) hours += 12;
              if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;
            }
            bagDate = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${String(hours).padStart(2, '0')}:${min}:${sec || '00'}-08:00`);
          }
        }
      }

      if (!bagDate || isNaN(bagDate.getTime())) continue;
      if (startFilter && bagDate < startFilter) continue;

      let bagCultivar = null;
      for (let j = cultivarTimeline.length - 1; j >= 0; j--) {
        if (bagDate >= cultivarTimeline[j].timestamp) {
          bagCultivar = cultivarTimeline[j].cultivar;
          break;
        }
      }

      if (bagCultivar) {
        const normalizedCultivar = bagCultivar.toLowerCase().trim();
        if (normalizedCultivar.includes(normalizedStrain) || normalizedStrain.includes(normalizedCultivar)) {
          bagCount++;
        }
      }
    }

    console.log(`[count5kgBagsForStrain] Found ${bagCount} bags for strain "${strain}"`);
    return bagCount;
  } catch (error) {
    console.error('[count5kgBagsForStrain] Error:', error.message);
    return 0;
  }
}

async function calculateOrderProgress(shipmentId, strain, type, targetKg, manualCompletedKg, startDateTime, manualAdjustmentKg, env) {
  try {
    if (manualCompletedKg != null && manualCompletedKg > 0) {
      const completedKg = parseFloat(manualCompletedKg) || 0;
      let percentComplete = targetKg > 0 ? Math.round((completedKg / targetKg) * 100) : 0;
      if (percentComplete > 100) percentComplete = 100;

      let estimatedHoursRemaining = 0;
      const remainingKg = targetKg - completedKg;
      if (remainingKg > 0) {
        const crewRate = 5.0;
        const remainingLbs = remainingKg * 2.205;
        estimatedHoursRemaining = crewRate > 0 ? Math.ceil(remainingLbs / crewRate) : 0;
      }

      return { completedKg, percentComplete, estimatedHoursRemaining };
    }

    const bagCount = await count5kgBagsForStrain(strain, startDateTime, env);
    const adjustmentKg = parseFloat(manualAdjustmentKg) || 0;

    if (bagCount > 0 || adjustmentKg !== 0) {
      const bagKg = bagCount * 5;
      let completedKg = bagKg + adjustmentKg;
      if (completedKg < 0) completedKg = 0;

      let percentComplete = targetKg > 0 ? Math.round((completedKg / targetKg) * 100) : 0;
      if (percentComplete > 100) percentComplete = 100;

      let estimatedHoursRemaining = 0;
      const remainingKg = targetKg - completedKg;
      if (remainingKg > 0) {
        const crewRate = 5.0;
        const remainingLbs = remainingKg * 2.205;
        estimatedHoursRemaining = crewRate > 0 ? Math.ceil(remainingLbs / crewRate) : 0;
      }

      console.log(`[calculateOrderProgress] Bags: ${bagCount} (${bagKg}kg) + Adjustment: ${adjustmentKg}kg = ${completedKg}kg for ${strain}`);
      return { completedKg, percentComplete, estimatedHoursRemaining, bagCount, bagKg, adjustmentKg };
    }

    return { completedKg: 0, percentComplete: 0, estimatedHoursRemaining: 0 };
  } catch (error) {
    console.error('[calculateOrderProgress] Error:', error.message);
    return { completedKg: 0, percentComplete: 0, estimatedHoursRemaining: 0 };
  }
}

async function getScoreboardOrderQueue(params, env) {
  const sheetId = env.ORDERS_SHEET_ID;

  try {
    let ordersData;
    try {
      ordersData = await readSheet(sheetId, `${SHEETS.orders}!A:V`, env);
    } catch (orderError) {
      if (orderError.code === 'RATE_LIMITED') {
        throw orderError;
      }
      console.error('[getScoreboardOrderQueue] Failed to read orders:', orderError.message);
      ordersData = [];
    }

    const orders = [];
    for (let i = 1; i < ordersData.length; i++) {
      const row = ordersData[i];
      if (!row[0]) continue;
      orders.push({
        id: row[0],
        customerID: row[1] || '',
        customerName: row[2] || '',
        status: row[5] || 'pending',
        createdDate: formatDate(row[8]),
        dueDate: formatDate(row[9]),
        priority: parseInt(row[21]) || null,
      });
    }

    let shipmentsData;
    try {
      shipmentsData = await readSheet(sheetId, `${SHEETS.shipments}!A:O`, env);
    } catch (shipmentError) {
      if (shipmentError.code === 'RATE_LIMITED') {
        throw shipmentError;
      }
      console.error('[getScoreboardOrderQueue] Failed to read shipments:', shipmentError.message);
      shipmentsData = [];
    }

    const shipments = [];
    for (let i = 1; i < shipmentsData.length; i++) {
      const row = shipmentsData[i];
      if (!row[0]) continue;
      let lineItems = [];
      try {
        lineItems = JSON.parse(row[7] || '[]');
      } catch (e) {
        lineItems = [];
      }
      shipments.push({
        id: row[0],
        orderID: row[1] || '',
        invoiceNumber: row[2] || '',
        startDateTime: row[4] ? String(row[4]) : null,
        status: row[5] || 'pending',
        lineItems,
      });
    }

    const topsLineItems = [];

    for (const shipment of shipments) {
      const parentOrder = orders.find(o => o.id === shipment.orderID);
      if (!parentOrder) continue;
      if (parentOrder.status === 'completed' || parentOrder.status === 'cancelled') continue;

      for (const item of shipment.lineItems) {
        if (item.type && item.type.toLowerCase() === 'tops') {
          topsLineItems.push({
            masterOrderId: parentOrder.id,
            shipmentId: shipment.id,
            customer: parentOrder.customerName,
            strain: item.strain,
            type: item.type,
            quantityKg: parseFloat(item.quantity) || 0,
            completedKg: parseFloat(item.completedKg) || null,
            adjustmentKg: parseFloat(item.adjustmentKg) || 0,
            startDateTime: shipment.startDateTime || null,
            dueDate: parentOrder.dueDate,
            orderPriority: parentOrder.priority,
            createdDate: parentOrder.createdDate,
            invoiceNumber: shipment.invoiceNumber,
            orderStatus: parentOrder.status,
            shipmentStatus: shipment.status,
          });
        }
      }
    }

    topsLineItems.sort((a, b) => {
      if (a.orderPriority != null && b.orderPriority != null) {
        return a.orderPriority - b.orderPriority;
      }
      if (a.orderPriority != null) return -1;
      if (b.orderPriority != null) return 1;
      const dateA = new Date(a.createdDate);
      const dateB = new Date(b.createdDate);
      return dateA - dateB;
    });

    const currentItems = [];
    let next = null;
    let currentShipmentId = null;

    if (topsLineItems.length > 0) {
      currentShipmentId = topsLineItems[0].shipmentId;

      for (const item of topsLineItems) {
        if (item.shipmentId === currentShipmentId) {
          const progress = await calculateOrderProgress(
            item.shipmentId,
            item.strain,
            item.type,
            item.quantityKg,
            item.completedKg,
            item.startDateTime,
            item.adjustmentKg,
            env
          );

          currentItems.push({
            masterOrderId: item.masterOrderId,
            shipmentId: item.shipmentId,
            customer: item.customer,
            strain: item.strain,
            type: item.type,
            quantityKg: item.quantityKg,
            completedKg: progress.completedKg,
            percentComplete: progress.percentComplete,
            dueDate: item.dueDate,
            estimatedHoursRemaining: progress.estimatedHoursRemaining,
            invoiceNumber: item.invoiceNumber,
            bagCount: progress.bagCount || 0,
            bagKg: progress.bagKg || 0,
            adjustmentKg: progress.adjustmentKg || item.adjustmentKg,
          });
        } else if (!next) {
          next = {
            masterOrderId: item.masterOrderId,
            shipmentId: item.shipmentId,
            customer: item.customer,
            strain: item.strain,
            type: item.type,
            quantityKg: item.quantityKg,
            dueDate: item.dueDate,
            invoiceNumber: item.invoiceNumber,
          };
        }
      }
    }

    const current = currentItems.length > 0 ? currentItems[0] : null;

    console.log(`[getScoreboardOrderQueue] Total topsLineItems: ${topsLineItems.length}, currentItems: ${currentItems.length}`);

    return successResponse({
      success: true,
      current,
      currentItems,
      next,
      queue: {
        totalShipments: topsLineItems.length,
        totalKg: topsLineItems.reduce((sum, item) => sum + item.quantityKg, 0),
      },
    });
  } catch (error) {
    console.error('[getScoreboardOrderQueue] Error:', error.message, error.code);
    if (error.code === 'RATE_LIMITED') {
      throw error;
    }
    throw createError('INTERNAL_ERROR', error.message);
  }
}

// ===== TEST =====

async function test() {
  return successResponse({
    ok: true,
    message: 'Wholesale Orders API is working (Cloudflare Workers)',
    timestamp: new Date().toISOString(),
  });
}

// ===== MAIN HANDLER =====

export async function handleOrders(request, env) {
  const action = getAction(request);
  const params = getQueryParams(request);
  const body = request.method === 'POST' ? await parseBody(request) : {};

  const actions = {
    // Auth
    validatePassword: () => validatePassword(params, env),

    // Customers
    getCustomers: () => getCustomers(params, env),
    saveCustomer: () => saveCustomer(params, body, env),
    deleteCustomer: () => deleteCustomer(params, body, env),

    // Master Orders
    getMasterOrders: () => getMasterOrders(params, env),
    saveMasterOrder: () => saveMasterOrder(params, body, env),
    deleteMasterOrder: () => deleteMasterOrder(params, body, env),
    updateOrderPriority: () => updateOrderPriority(params, body, env),

    // Shipments
    getShipments: () => getShipments(params, env),
    saveShipment: () => saveShipment(params, body, env),
    deleteShipment: () => deleteShipment(params, body, env),

    // Payments
    getPayments: () => getPayments(params, env),
    savePayment: () => savePayment(params, body, env),
    deletePayment: () => deletePayment(params, body, env),

    // Price History
    getPriceHistory: () => getPriceHistory(params, env),

    // Order Financials
    getOrderFinancials: () => getOrderFinancials(params, env),

    // COA
    getCOAIndex: () => getCOAIndex(params, env),
    syncCOAIndex: () => syncCOAIndex(params, env),
    getCOAsForStrains: () => getCOAsForStrains(params, env),

    // Scoreboard
    getScoreboardOrderQueue: () => getScoreboardOrderQueue(params, env),

    // Test
    test: () => test(),
  };

  if (!action || !actions[action]) {
    throw createError('VALIDATION_ERROR', `Unknown action: ${action}`);
  }

  return actions[action]();
}
