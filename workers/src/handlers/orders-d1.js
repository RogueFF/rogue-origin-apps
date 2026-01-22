/**
 * Wholesale Orders API Handler - D1 Version
 * Migrated from Google Sheets to Cloudflare D1
 */

import { query, queryOne, insert, update, deleteRows, execute } from '../lib/db.js';
import { readSheet } from '../lib/sheets.js';
import { successResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { sanitizeForSheets } from '../lib/validate.js';

const COA_FOLDER_ID = '1vNjWtq701h_hSCA1gvjlD37xOZv6QbfO';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Sheet names for migration
const SHEETS = {
  customers: 'Customers',
  orders: 'MasterOrders',
  shipments: 'Shipments',
  payments: 'Payments',
  priceHistory: 'PriceHistory',
  coaIndex: 'COA_Index',
};

// Drive token cache
let driveTokenCache = { token: null, expiresAt: 0 };

async function getDriveAccessToken(env) {
  if (driveTokenCache.token && Date.now() < driveTokenCache.expiresAt) {
    return driveTokenCache.token;
  }

  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = env.GOOGLE_PRIVATE_KEY;

  if (!email || !privateKey) {
    throw createError('INTERNAL_ERROR', 'Drive API not configured');
  }

  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: DRIVE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const base64url = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const headerB64 = base64url(header);
  const payloadB64 = base64url(payload);
  const signatureInput = `${headerB64}.${payloadB64}`;

  const key = privateKey.replace(/\\n/g, '\n').replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s/g, '');
  const binaryKey = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signatureInput));
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const jwt = `${signatureInput}.${signatureB64}`;

  const response = await fetch(DRIVE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });

  if (!response.ok) throw createError('INTERNAL_ERROR', 'Failed to authenticate with Google Drive');

  const data = await response.json();
  driveTokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return driveTokenCache.token;
}

async function driveRequest(url, env) {
  const token = await getDriveAccessToken(env);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw createError('INTERNAL_ERROR', `Drive API error: ${response.status}`);
  return response;
}

function formatDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.trim()) return value;
  return null;
}

// ===== AUTHENTICATION =====

async function validatePassword(params, env) {
  const password = params.password || '';
  const expectedPassword = env.ORDERS_PASSWORD;

  if (!expectedPassword) throw createError('INTERNAL_ERROR', 'Password not configured');

  if (password === expectedPassword) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const sessionToken = btoa(`${timestamp}-${random}`).substring(0, 32);
    return successResponse({ success: true, sessionToken, expiresIn: 30 * 24 * 60 * 60 * 1000 });
  }
  return successResponse({ success: false, error: 'Invalid password' });
}

// ===== CUSTOMERS =====

async function getCustomers(env) {
  const customers = await query(env.DB, `
    SELECT id, company, name, email, phone, address, city, state, zip, notes, created_at
    FROM customers ORDER BY company
  `);

  return successResponse({
    success: true,
    customers: customers.map(c => ({
      id: c.id,
      companyName: c.company || '',
      contactName: c.name || '',
      email: c.email || '',
      phone: c.phone || '',
      shipToAddress: c.address || '',
      billToAddress: c.address || '',
      country: '',
      notes: c.notes || '',
      createdDate: c.created_at,
      lastOrderDate: null,
    }))
  });
}

async function saveCustomer(body, env) {
  if (!body.companyName) throw createError('VALIDATION_ERROR', 'Company name is required');

  const existing = body.id ? await queryOne(env.DB, 'SELECT id FROM customers WHERE id = ?', [body.id]) : null;

  if (existing) {
    await update(env.DB, 'customers', {
      company: sanitizeForSheets(body.companyName || ''),
      name: sanitizeForSheets(body.contactName || ''),
      email: sanitizeForSheets(body.email || ''),
      phone: sanitizeForSheets(body.phone || ''),
      address: sanitizeForSheets(body.shipToAddress || ''),
      notes: sanitizeForSheets(body.notes || ''),
    }, 'id = ?', [body.id]);
  } else {
    const count = await query(env.DB, 'SELECT COUNT(*) as cnt FROM customers');
    const newId = body.id || `CUST-${String((count[0]?.cnt || 0) + 1).padStart(3, '0')}`;
    await insert(env.DB, 'customers', {
      id: newId,
      company: sanitizeForSheets(body.companyName || ''),
      name: sanitizeForSheets(body.contactName || ''),
      email: sanitizeForSheets(body.email || ''),
      phone: sanitizeForSheets(body.phone || ''),
      address: sanitizeForSheets(body.shipToAddress || ''),
      notes: sanitizeForSheets(body.notes || ''),
    });
    body.id = newId;
  }

  return successResponse({ success: true, customer: body });
}

async function deleteCustomer(body, env) {
  if (!body.id) throw createError('VALIDATION_ERROR', 'Customer ID is required');
  const changes = await deleteRows(env.DB, 'customers', 'id = ?', [body.id]);
  if (changes === 0) throw createError('NOT_FOUND', 'Customer not found');
  return successResponse({ success: true });
}

// ===== MASTER ORDERS =====

async function getMasterOrders(env) {
  const orders = await query(env.DB, `
    SELECT id, customer_id, order_date, status, strain, type, commitment_kg, commitment_price,
           fulfilled_kg, fulfilled_value, paid_amount, balance_due, ship_date, tracking_number,
           notes, source, shopify_order_id, shopify_order_name, payment_terms, priority, created_at, updated_at
    FROM orders ORDER BY created_at DESC
  `);

  return successResponse({
    success: true,
    orders: orders.map(o => ({
      id: o.id,
      customerID: o.customer_id || '',
      customerName: '',
      commitmentAmount: o.commitment_price || 0,
      currency: 'USD',
      status: o.status || 'pending',
      poNumber: '',
      terms: o.payment_terms || 'DAP',
      createdDate: o.created_at,
      dueDate: o.ship_date,
      notes: o.notes || '',
      priority: o.priority,
    }))
  });
}

async function saveMasterOrder(body, env) {
  const existing = body.id ? await queryOne(env.DB, 'SELECT id FROM orders WHERE id = ?', [body.id]) : null;

  if (!body.id) {
    const year = new Date().getFullYear();
    const result = await query(env.DB, `SELECT id FROM orders WHERE id LIKE 'MO-${year}-%' ORDER BY id DESC LIMIT 1`);
    let maxNum = 0;
    if (result.length > 0) {
      const numStr = result[0].id.split('-')[2];
      maxNum = parseInt(numStr, 10) || 0;
    }
    body.id = `MO-${year}-${String(maxNum + 1).padStart(3, '0')}`;
  }

  const data = {
    customer_id: sanitizeForSheets(body.customerID || ''),
    order_date: body.createdDate || new Date().toISOString(),
    status: sanitizeForSheets(body.status || 'pending'),
    commitment_price: body.commitmentAmount || 0,
    payment_terms: sanitizeForSheets(body.terms || 'DAP'),
    ship_date: body.dueDate || '',
    notes: sanitizeForSheets(body.notes || ''),
    priority: body.priority || null,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    await update(env.DB, 'orders', data, 'id = ?', [body.id]);
  } else {
    await insert(env.DB, 'orders', { id: body.id, ...data, created_at: new Date().toISOString() });
  }

  return successResponse({ success: true, order: body });
}

async function deleteMasterOrder(body, env) {
  const orderID = body.orderID;
  if (!orderID) throw createError('VALIDATION_ERROR', 'Order ID is required');

  // Check order exists first
  const order = await queryOne(env.DB, 'SELECT id FROM orders WHERE id = ?', [orderID]);
  if (!order) throw createError('NOT_FOUND', 'Order not found');

  // Delete associated records FIRST (foreign key constraints require this order)
  await deleteRows(env.DB, 'shipments', 'order_id = ?', [orderID]);
  await deleteRows(env.DB, 'payments', 'order_id = ?', [orderID]);

  // Now delete the order
  await deleteRows(env.DB, 'orders', 'id = ?', [orderID]);

  return successResponse({ success: true, message: 'Order and associated records deleted' });
}

async function updateOrderPriority(body, env) {
  const { orderID, newPriority } = body;
  if (!orderID) throw createError('VALIDATION_ERROR', 'Order ID is required');

  const changes = await update(env.DB, 'orders', { priority: newPriority || null }, 'id = ?', [orderID]);
  if (changes === 0) throw createError('NOT_FOUND', 'Order not found');

  return successResponse({ success: true });
}

// ===== SHIPMENTS =====

async function getShipments(params, env) {
  const orderID = params.orderID;
  let sql = `SELECT * FROM shipments`;
  const sqlParams = [];

  if (orderID) {
    sql += ` WHERE order_id = ?`;
    sqlParams.push(orderID);
  }
  sql += ` ORDER BY created_at DESC`;

  const shipments = await query(env.DB, sql, sqlParams);

  return successResponse({
    success: true,
    shipments: shipments.map(s => ({
      id: s.id,
      orderID: s.order_id || '',
      invoiceNumber: s.invoice_number || '',
      shipmentDate: s.ship_date,
      startDateTime: s.ship_date,
      status: s.status || 'pending',
      dimensionsJSON: '{}',
      lineItemsJSON: s.notes || '[]',
      subTotal: s.total_value || 0,
      discount: 0,
      freightCost: 0,
      totalAmount: s.total_value || 0,
      trackingNumber: s.tracking_number || '',
      carrier: s.carrier || '',
      notes: '',
      dimensions: {},
      lineItems: s.notes ? JSON.parse(s.notes) : [],
    }))
  });
}

async function saveShipment(body, env) {
  const existing = body.id ? await queryOne(env.DB, 'SELECT id FROM shipments WHERE id = ?', [body.id]) : null;

  if (!body.id) {
    const orderNum = body.orderID ? body.orderID.split('-').pop() : '000';
    // Use MAX to find highest existing shipment number, not COUNT (which fails after deletions)
    const maxResult = await query(env.DB, `SELECT MAX(CAST(SUBSTR(id, -2) AS INTEGER)) as maxNum FROM shipments WHERE id LIKE 'SH-${orderNum}-%'`);
    const maxNum = maxResult[0]?.maxNum || 0;
    body.id = `SH-${orderNum}-${String(maxNum + 1).padStart(2, '0')}`;
  }

  if (!body.invoiceNumber) {
    const year = new Date().getFullYear();
    const result = await query(env.DB, `SELECT invoice_number FROM shipments WHERE invoice_number LIKE 'INV-${year}-%' ORDER BY invoice_number DESC LIMIT 1`);
    let maxNum = 0;
    if (result.length > 0 && result[0].invoice_number) {
      const numStr = result[0].invoice_number.split('-').pop();
      maxNum = parseInt(numStr, 10) || 0;
    }
    body.invoiceNumber = `INV-${year}-${String(maxNum + 1).padStart(4, '0')}`;
  }

  const data = {
    order_id: sanitizeForSheets(body.orderID || ''),
    invoice_number: body.invoiceNumber,
    ship_date: body.shipmentDate || new Date().toISOString(),
    status: sanitizeForSheets(body.status || 'pending'),
    quantity_kg: body.lineItems?.reduce((sum, i) => sum + (parseFloat(i.quantity) || 0), 0) || 0,
    total_value: body.totalAmount || 0,
    tracking_number: sanitizeForSheets(body.trackingNumber || ''),
    carrier: sanitizeForSheets(body.carrier || ''),
    notes: JSON.stringify(body.lineItems || []),
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    await update(env.DB, 'shipments', data, 'id = ?', [body.id]);
  } else {
    await insert(env.DB, 'shipments', { id: body.id, ...data, created_at: new Date().toISOString() });
  }

  // Update price history
  if (body.lineItems?.length > 0) {
    await updatePriceHistoryForItems(body.lineItems, env);
  }

  return successResponse({ success: true, shipment: body });
}

async function deleteShipment(body, env) {
  if (!body.shipmentID) throw createError('VALIDATION_ERROR', 'Shipment ID is required');
  const changes = await deleteRows(env.DB, 'shipments', 'id = ?', [body.shipmentID]);
  if (changes === 0) throw createError('NOT_FOUND', 'Shipment not found');
  return successResponse({ success: true, message: 'Shipment deleted' });
}

// ===== PAYMENTS =====

async function getPayments(params, env) {
  const orderID = params.orderID;
  let sql = `SELECT * FROM payments`;
  const sqlParams = [];

  if (orderID) {
    sql += ` WHERE order_id = ?`;
    sqlParams.push(orderID);
  }
  sql += ` ORDER BY created_at DESC`;

  const payments = await query(env.DB, sql, sqlParams);

  return successResponse({
    success: true,
    payments: payments.map(p => ({
      id: p.id,
      orderID: p.order_id || '',
      paymentDate: p.payment_date,
      amount: p.amount || 0,
      method: p.method || '',
      reference: p.reference || '',
      notes: p.notes || '',
      recordedBy: '',
      recordedDate: p.created_at,
    }))
  });
}

async function savePayment(body, env) {
  if (!body.orderID) throw createError('VALIDATION_ERROR', 'Order ID is required');

  const existing = body.id ? await queryOne(env.DB, 'SELECT id FROM payments WHERE id = ?', [body.id]) : null;

  if (!body.id) {
    const count = await query(env.DB, 'SELECT COUNT(*) as cnt FROM payments');
    body.id = `PAY-${String((count[0]?.cnt || 0) + 1).padStart(5, '0')}`;
  }

  const data = {
    order_id: sanitizeForSheets(body.orderID || ''),
    payment_date: body.paymentDate || new Date().toISOString(),
    amount: body.amount || 0,
    method: sanitizeForSheets(body.method || ''),
    reference: sanitizeForSheets(body.reference || ''),
    notes: sanitizeForSheets(body.notes || ''),
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    await update(env.DB, 'payments', data, 'id = ?', [body.id]);
  } else {
    await insert(env.DB, 'payments', { id: body.id, ...data, created_at: new Date().toISOString() });
  }

  return successResponse({ success: true, payment: body });
}

async function deletePayment(body, env) {
  if (!body.paymentID) throw createError('VALIDATION_ERROR', 'Payment ID is required');
  const changes = await deleteRows(env.DB, 'payments', 'id = ?', [body.paymentID]);
  if (changes === 0) throw createError('NOT_FOUND', 'Payment not found');
  return successResponse({ success: true, message: 'Payment deleted' });
}

// ===== PRICE HISTORY =====

async function getPriceHistory(env) {
  const prices = await query(env.DB, `SELECT * FROM price_history ORDER BY effective_date DESC`);

  return successResponse({
    success: true,
    prices: prices.map(p => ({
      strain: p.strain || '',
      type: p.type || '',
      lastPrice: p.price || 0,
      lastUsedDate: p.effective_date,
      customerID: '',
    }))
  });
}

async function updatePriceHistoryForItems(lineItems, env) {
  if (!lineItems?.length) return;

  for (const item of lineItems) {
    if (!item.strain || !item.type || !item.unitPrice) continue;

    const existing = await queryOne(env.DB,
      'SELECT id FROM price_history WHERE strain = ? AND type = ?',
      [item.strain, item.type]
    );

    if (existing) {
      await update(env.DB, 'price_history', {
        price: item.unitPrice,
        effective_date: new Date().toISOString(),
      }, 'id = ?', [existing.id]);
    } else {
      await insert(env.DB, 'price_history', {
        strain: item.strain,
        type: item.type,
        price: item.unitPrice,
        effective_date: new Date().toISOString(),
      });
    }
  }
}

// ===== ORDER FINANCIALS =====

async function getOrderFinancials(params, env) {
  const orderID = params.orderID;
  if (!orderID) throw createError('VALIDATION_ERROR', 'Order ID is required');

  const order = await queryOne(env.DB, 'SELECT commitment_price FROM orders WHERE id = ?', [orderID]);
  if (!order) throw createError('NOT_FOUND', 'Order not found');

  const commitment = order.commitment_price || 0;

  const shipmentResult = await query(env.DB, 'SELECT SUM(total_value) as total FROM shipments WHERE order_id = ?', [orderID]);
  const fulfilled = shipmentResult[0]?.total || 0;

  const paymentResult = await query(env.DB, 'SELECT SUM(amount) as total FROM payments WHERE order_id = ?', [orderID]);
  const paid = paymentResult[0]?.total || 0;

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

async function getCOAIndex(env) {
  const coas = await query(env.DB, `SELECT * FROM coa_index ORDER BY strain`);

  return successResponse({
    success: true,
    coas: coas.map(c => ({
      strain: c.strain || '',
      fileName: c.lab_name || '',
      fileID: c.test_date || '',
      url: c.file_url || '',
      downloadURL: c.file_url ? `https://drive.google.com/uc?export=download&id=${c.test_date}` : '',
      lastSynced: c.created_at,
    }))
  });
}

async function syncCOAIndex(env) {
  const listUrl = `${DRIVE_API_BASE}/files?q='${COA_FOLDER_ID}'+in+parents+and+mimeType='application/pdf'+and+trashed=false&fields=files(id,name,webViewLink)&pageSize=1000`;
  const response = await driveRequest(listUrl, env);
  const result = await response.json();

  const files = result.files || [];

  // Clear existing COA index
  await execute(env.DB, 'DELETE FROM coa_index');

  for (const file of files) {
    const strain = file.name.replace(/\.pdf$/i, '').replace(/[\s_-]*COA[\s_-]*/gi, '').replace(/_/g, ' ').trim();

    await insert(env.DB, 'coa_index', {
      strain,
      lab_name: file.name,
      test_date: file.id,
      file_url: file.webViewLink || '',
    });
  }

  return successResponse({ success: true, count: files.length });
}

async function getCOAsForStrains(params, env) {
  const strainsParam = params.strains;
  if (!strainsParam) throw createError('VALIDATION_ERROR', 'Missing strains parameter');

  const strainList = strainsParam.split(',').map(s => s.trim());
  const coaIndex = await query(env.DB, 'SELECT strain, lab_name as fileName, test_date as fileID FROM coa_index');

  const results = [];

  for (const requestedStrain of strainList) {
    const normalized = requestedStrain.toLowerCase().trim();

    let bestMatch = null;
    for (const coa of coaIndex) {
      const coaNormalized = (coa.fileName || '').toLowerCase().trim();
      if (coaNormalized.includes(normalized)) {
        bestMatch = coa;
        break;
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
      } catch {
        results.push({ strain: requestedStrain, matched: false, error: 'Failed to fetch COA file' });
      }
    } else {
      results.push({ strain: requestedStrain, matched: false, error: 'No matching COA found' });
    }
  }

  return successResponse({ success: true, coas: results });
}

// ===== SCOREBOARD ORDER QUEUE =====
// Note: This still reads from production tracking sheet for bag counting

async function count5kgBagsForStrain(strain, startDateTime, env) {
  const productionSheetId = env.PRODUCTION_SHEET_ID;
  if (!productionSheetId) return 0;

  try {
    const trackingData = await readSheet(productionSheetId, "'Rogue Origin Production Tracking'!A1:F2001", env);
    if (!trackingData || trackingData.length < 2) return 0;

    const headers = trackingData[0];
    const timestampCol = headers.indexOf('Timestamp');
    const sizeCol = headers.indexOf('Size');
    if (timestampCol === -1 || sizeCol === -1) return 0;

    let startFilter = startDateTime ? new Date(startDateTime) : null;
    if (startFilter && isNaN(startFilter.getTime())) startFilter = null;

    const now = new Date();
    const pacificOffset = -8 * 60;
    const pacificDate = new Date(now.getTime() + (pacificOffset + now.getTimezoneOffset()) * 60000);
    const year = pacificDate.getFullYear();
    const month = String(pacificDate.getMonth() + 1).padStart(2, '0');
    const monthSheetName = `${year}-${month}`;

    let productionData = [];
    try {
      productionData = await readSheet(productionSheetId, `'${monthSheetName}'!A:L`, env);
    } catch { /* ignore */ }

    // Build cultivar timeline
    let cultivarCol = -1;
    let headerRowIndex = -1;
    for (let i = 0; i < productionData.length; i++) {
      const row = productionData[i];
      const cultivarIndex = row.findIndex(cell => String(cell || '').trim() === 'Cultivar 1');
      if (cultivarIndex !== -1) {
        cultivarCol = cultivarIndex;
        headerRowIndex = i;
        break;
      }
    }

    if (cultivarCol === -1) return 0;

    const cultivarTimeline = [];
    for (let i = headerRowIndex + 1; i < productionData.length; i++) {
      const row = productionData[i];
      if (!row[0] || row[0] === 'Date:') continue;
      const timeSlot = String(row[0] || '');
      const cultivar = String(row[cultivarCol] || '').trim();
      if (timeSlot.includes(':') && cultivar) {
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
    const todayStr = `${pacificDate.getFullYear()}-${String(pacificDate.getMonth() + 1).padStart(2, '0')}-${String(pacificDate.getDate()).padStart(2, '0')}`;

    for (let i = 1; i < trackingData.length; i++) {
      const row = trackingData[i];
      const size = String(row[sizeCol] || '').toUpperCase();
      if (!size.includes('5KG') && !size.includes('5 KG')) continue;

      let bagTimestamp = row[timestampCol];
      if (!bagTimestamp) continue;

      let bagDate;
      if (typeof bagTimestamp === 'string') {
        let cleanTs = bagTimestamp.trim();
        const usMatch = cleanTs.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
        if (usMatch) {
          const [, m, d, y, h, min, sec, ampm] = usMatch;
          let hours = parseInt(h, 10);
          if (ampm) {
            if (ampm.toUpperCase() === 'PM' && hours !== 12) hours += 12;
            if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;
          }
          cleanTs = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${String(hours).padStart(2, '0')}:${min}:${sec || '00'}-08:00`;
        }
        bagDate = new Date(cleanTs);
      } else if (typeof bagTimestamp === 'number') {
        if (bagTimestamp < 1) {
          const hours = Math.floor(bagTimestamp * 24);
          const minutes = Math.floor((bagTimestamp * 24 - hours) * 60);
          bagDate = new Date(`${todayStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00-08:00`);
        } else {
          bagDate = new Date((bagTimestamp - 25569) * 86400 * 1000);
        }
      } else {
        bagDate = new Date(bagTimestamp);
      }

      if (!bagDate || isNaN(bagDate.getTime())) continue;

      // Skip blacklisted bags
      const badBagStart = new Date('2026-01-19T20:34:14Z');
      const badBagEnd = new Date('2026-01-19T20:38:05Z');
      if (bagDate >= badBagStart && bagDate <= badBagEnd) continue;

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

    return bagCount;
  } catch {
    return 0;
  }
}

async function getScoreboardOrderQueue(env) {
  try {
    const orders = await query(env.DB, `SELECT * FROM orders WHERE status NOT IN ('completed', 'cancelled') ORDER BY priority, created_at`);
    const shipments = await query(env.DB, `SELECT * FROM shipments`);

    const topsLineItems = [];

    for (const shipment of shipments) {
      const parentOrder = orders.find(o => o.id === shipment.order_id);
      if (!parentOrder) continue;

      let lineItems = [];
      try { lineItems = JSON.parse(shipment.notes || '[]'); } catch { lineItems = []; }

      for (const item of lineItems) {
        if (item.type && item.type.toLowerCase() === 'tops') {
          topsLineItems.push({
            masterOrderId: parentOrder.id,
            shipmentId: shipment.id,
            customer: parentOrder.customer_id,
            strain: item.strain,
            type: item.type,
            quantityKg: parseFloat(item.quantity) || 0,
            completedKg: parseFloat(item.completedKg) || null,
            adjustmentKg: parseFloat(item.adjustmentKg) || 0,
            startDateTime: shipment.ship_date,
            dueDate: parentOrder.ship_date,
            orderPriority: parentOrder.priority,
            createdDate: parentOrder.created_at,
            invoiceNumber: shipment.invoice_number,
          });
        }
      }
    }

    topsLineItems.sort((a, b) => {
      if (a.orderPriority != null && b.orderPriority != null) return a.orderPriority - b.orderPriority;
      if (a.orderPriority != null) return -1;
      if (b.orderPriority != null) return 1;
      return new Date(a.createdDate) - new Date(b.createdDate);
    });

    const currentItems = [];
    let next = null;
    let currentShipmentId = topsLineItems.length > 0 ? topsLineItems[0].shipmentId : null;

    for (const item of topsLineItems) {
      if (item.shipmentId === currentShipmentId) {
        const bagCount = await count5kgBagsForStrain(item.strain, item.startDateTime, env);
        const bagKg = bagCount * 5;
        const adjustmentKg = item.adjustmentKg || 0;
        let completedKg = item.completedKg != null ? item.completedKg : bagKg + adjustmentKg;
        if (completedKg < 0) completedKg = 0;

        let percentComplete = item.quantityKg > 0 ? Math.round((completedKg / item.quantityKg) * 100) : 0;
        if (percentComplete > 100) percentComplete = 100;

        currentItems.push({
          masterOrderId: item.masterOrderId,
          shipmentId: item.shipmentId,
          customer: item.customer,
          strain: item.strain,
          type: item.type,
          quantityKg: item.quantityKg,
          completedKg,
          percentComplete,
          dueDate: item.dueDate,
          estimatedHoursRemaining: 0,
          invoiceNumber: item.invoiceNumber,
          bagCount,
          bagKg,
          adjustmentKg,
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

    return successResponse({
      success: true,
      current: currentItems.length > 0 ? currentItems[0] : null,
      currentItems,
      next,
      queue: {
        totalShipments: topsLineItems.length,
        totalKg: topsLineItems.reduce((sum, item) => sum + item.quantityKg, 0),
      },
    });
  } catch (error) {
    console.error('[getScoreboardOrderQueue] Error:', error.message);
    throw createError('INTERNAL_ERROR', error.message);
  }
}

// ===== TEST =====

async function test() {
  return successResponse({
    ok: true,
    message: 'Wholesale Orders API is working (Cloudflare D1)',
    timestamp: new Date().toISOString(),
  });
}

// ===== MIGRATION =====

async function migrateFromSheets(env) {
  const sheetId = env.ORDERS_SHEET_ID;
  if (!sheetId) throw createError('INTERNAL_ERROR', 'ORDERS_SHEET_ID not configured');

  let customersMigrated = 0, ordersMigrated = 0, shipmentsMigrated = 0, paymentsMigrated = 0;

  // Migrate Customers
  try {
    const data = await readSheet(sheetId, `${SHEETS.customers}!A:K`, env);
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;
      const existing = await queryOne(env.DB, 'SELECT id FROM customers WHERE id = ?', [row[0]]);
      if (existing) continue;

      await insert(env.DB, 'customers', {
        id: row[0],
        company: sanitizeForSheets(row[1] || ''),
        name: sanitizeForSheets(row[2] || ''),
        email: sanitizeForSheets(row[3] || ''),
        phone: sanitizeForSheets(row[4] || ''),
        address: sanitizeForSheets(row[5] || ''),
        notes: sanitizeForSheets(row[8] || ''),
        created_at: row[9] || new Date().toISOString(),
      });
      customersMigrated++;
    }
  } catch (e) { console.error('Error migrating customers:', e); }

  // Migrate Orders
  try {
    const data = await readSheet(sheetId, `${SHEETS.orders}!A:V`, env);
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;
      const existing = await queryOne(env.DB, 'SELECT id FROM orders WHERE id = ?', [row[0]]);
      if (existing) continue;

      await insert(env.DB, 'orders', {
        id: row[0],
        customer_id: sanitizeForSheets(row[1] || ''),
        status: sanitizeForSheets(row[5] || 'pending'),
        commitment_price: parseFloat(row[3]) || 0,
        payment_terms: sanitizeForSheets(row[7] || 'DAP'),
        ship_date: row[9] || '',
        notes: sanitizeForSheets(row[20] || ''),
        priority: parseInt(row[21]) || null,
        created_at: row[8] || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      ordersMigrated++;
    }
  } catch (e) { console.error('Error migrating orders:', e); }

  // Migrate Shipments
  try {
    const data = await readSheet(sheetId, `${SHEETS.shipments}!A:O`, env);
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;
      const existing = await queryOne(env.DB, 'SELECT id FROM shipments WHERE id = ?', [row[0]]);
      if (existing) continue;

      await insert(env.DB, 'shipments', {
        id: row[0],
        order_id: sanitizeForSheets(row[1] || ''),
        invoice_number: row[2] || '',
        ship_date: row[3] || new Date().toISOString(),
        status: sanitizeForSheets(row[5] || 'pending'),
        quantity_kg: 0,
        total_value: parseFloat(row[11]) || 0,
        tracking_number: sanitizeForSheets(row[12] || ''),
        carrier: sanitizeForSheets(row[13] || ''),
        notes: row[7] || '[]',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      shipmentsMigrated++;
    }
  } catch (e) { console.error('Error migrating shipments:', e); }

  // Migrate Payments
  try {
    const data = await readSheet(sheetId, `${SHEETS.payments}!A:I`, env);
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;
      const existing = await queryOne(env.DB, 'SELECT id FROM payments WHERE id = ?', [row[0]]);
      if (existing) continue;

      await insert(env.DB, 'payments', {
        id: row[0],
        order_id: sanitizeForSheets(row[1] || ''),
        payment_date: row[2] || new Date().toISOString(),
        amount: parseFloat(row[3]) || 0,
        method: sanitizeForSheets(row[4] || ''),
        reference: sanitizeForSheets(row[5] || ''),
        notes: sanitizeForSheets(row[6] || ''),
        created_at: row[8] || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      paymentsMigrated++;
    }
  } catch (e) { console.error('Error migrating payments:', e); }

  return successResponse({
    success: true,
    message: `Migration complete. Customers: ${customersMigrated}, Orders: ${ordersMigrated}, Shipments: ${shipmentsMigrated}, Payments: ${paymentsMigrated}`,
    customersMigrated,
    ordersMigrated,
    shipmentsMigrated,
    paymentsMigrated,
  });
}

// ===== MAIN HANDLER =====

export async function handleOrdersD1(request, env) {
  const action = getAction(request);
  const params = getQueryParams(request);
  const body = request.method === 'POST' ? await parseBody(request) : {};

  const actions = {
    validatePassword: () => validatePassword(params, env),
    getCustomers: () => getCustomers(env),
    saveCustomer: () => saveCustomer(body, env),
    deleteCustomer: () => deleteCustomer(body, env),
    getMasterOrders: () => getMasterOrders(env),
    saveMasterOrder: () => saveMasterOrder(body, env),
    deleteMasterOrder: () => deleteMasterOrder(body, env),
    updateOrderPriority: () => updateOrderPriority(body, env),
    getShipments: () => getShipments(params, env),
    saveShipment: () => saveShipment(body, env),
    deleteShipment: () => deleteShipment(body, env),
    getPayments: () => getPayments(params, env),
    savePayment: () => savePayment(body, env),
    deletePayment: () => deletePayment(body, env),
    getPriceHistory: () => getPriceHistory(env),
    getOrderFinancials: () => getOrderFinancials(params, env),
    getCOAIndex: () => getCOAIndex(env),
    syncCOAIndex: () => syncCOAIndex(env),
    getCOAsForStrains: () => getCOAsForStrains(params, env),
    getScoreboardOrderQueue: () => getScoreboardOrderQueue(env),
    test: () => test(),
    migrate: () => migrateFromSheets(env),
  };

  if (!action || !actions[action]) {
    throw createError('VALIDATION_ERROR', `Unknown action: ${action}`);
  }

  return actions[action]();
}
