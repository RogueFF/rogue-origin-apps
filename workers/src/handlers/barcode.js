/**
 * Barcode/Label Manager API Handler for Cloudflare Workers
 * Migrated from Vercel Functions
 *
 * Endpoints:
 * - GET  ?action=products  - Get all products
 * - GET  ?action=test      - Test API
 * - POST ?action=add       - Add product
 * - POST ?action=update    - Update product
 * - POST ?action=delete    - Delete product
 * - POST ?action=import    - Import CSV
 */

import { readSheet, appendSheet, writeSheet, clearSheet } from '../lib/sheets.js';
import { successResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { sanitizeForSheets } from '../lib/validate.js';

const SHEET_NAME = 'Sheet1';

/**
 * Validate product data
 */
function validateProduct(data) {
  if (!data.header || typeof data.header !== 'string') {
    throw createError('VALIDATION_ERROR', 'Header is required');
  }
  if (!data.sku || typeof data.sku !== 'string') {
    throw createError('VALIDATION_ERROR', 'SKU is required');
  }
  if (data.header.length > 200) {
    throw createError('VALIDATION_ERROR', 'Header must be 200 characters or less');
  }
  if (data.sku.length > 100) {
    throw createError('VALIDATION_ERROR', 'SKU must be 100 characters or less');
  }
  if (data.barcode && !/^[A-Za-z0-9\-_. ]*$/.test(data.barcode)) {
    throw createError('VALIDATION_ERROR', 'Barcode contains invalid characters');
  }
  return data;
}

/**
 * Get all products from the sheet
 */
async function getProducts(params, env) {
  const sheetId = env.BARCODE_SHEET_ID;
  const data = await readSheet(sheetId, `${SHEET_NAME}!A:C`, env);

  if (data.length <= 1) {
    return successResponse({ success: true, products: [] });
  }

  // Find column indices from headers
  const headers = data[0].map(h => String(h).toLowerCase());
  let headerIdx = headers.findIndex(h => h.includes('header') || h.includes('product') || h.includes('name'));
  let skuIdx = headers.findIndex(h => h.includes('sku'));
  let barcodeIdx = headers.findIndex(h => h.includes('barcode'));

  // Defaults if not found
  if (headerIdx === -1) headerIdx = 0;
  if (skuIdx === -1) skuIdx = 1;
  if (barcodeIdx === -1) barcodeIdx = 2;

  const products = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[headerIdx] || row[skuIdx]) {
      products.push({
        row: i + 1,
        header: row[headerIdx] ? String(row[headerIdx]) : '',
        sku: row[skuIdx] ? String(row[skuIdx]) : '',
        barcode: row[barcodeIdx] ? String(row[barcodeIdx]) : '',
      });
    }
  }

  return successResponse({ success: true, products });
}

/**
 * Test endpoint
 */
async function test() {
  return successResponse({
    ok: true,
    message: 'Barcode API is working (Cloudflare Workers)',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Add a new product
 */
async function addProduct(params, body, env) {
  const sheetId = env.BARCODE_SHEET_ID;
  const data = validateProduct(body);

  // Sanitize for sheets
  const header = sanitizeForSheets(data.header);
  const sku = sanitizeForSheets(data.sku);
  const barcode = sanitizeForSheets(data.barcode || '');

  // Check for duplicate SKU
  const existing = await readSheet(sheetId, `${SHEET_NAME}!B:B`, env);
  for (let i = 1; i < existing.length; i++) {
    if (existing[i][0] && String(existing[i][0]) === sku) {
      throw createError('VALIDATION_ERROR', 'SKU already exists');
    }
  }

  // Append new row
  await appendSheet(sheetId, `${SHEET_NAME}!A:C`, [[header, sku, barcode]], env);

  return successResponse({ success: true, message: 'Product added successfully' });
}

/**
 * Update an existing product
 */
async function updateProduct(params, body, env) {
  const sheetId = env.BARCODE_SHEET_ID;

  if (!body.row || typeof body.row !== 'number' || body.row < 2) {
    throw createError('VALIDATION_ERROR', 'Valid row number is required');
  }

  const data = validateProduct(body);

  const header = sanitizeForSheets(data.header);
  const sku = sanitizeForSheets(data.sku);
  const barcode = sanitizeForSheets(data.barcode || '');

  await writeSheet(sheetId, `${SHEET_NAME}!A${body.row}:C${body.row}`, [[header, sku, barcode]], env);

  return successResponse({ success: true, message: 'Product updated' });
}

/**
 * Delete a product by row number
 */
async function deleteProduct(params, body, env) {
  const sheetId = env.BARCODE_SHEET_ID;

  if (!body.row || typeof body.row !== 'number' || body.row < 2) {
    throw createError('VALIDATION_ERROR', 'Valid row number is required');
  }

  await clearSheet(sheetId, `${SHEET_NAME}!A${body.row}:C${body.row}`, env);

  return successResponse({ success: true, message: 'Product deleted' });
}

/**
 * Import products from CSV
 */
async function importCSV(params, body, env) {
  const sheetId = env.BARCODE_SHEET_ID;

  if (!body.csv || typeof body.csv !== 'string') {
    throw createError('VALIDATION_ERROR', 'CSV data is required');
  }

  if (body.csv.length > 1000000) {
    throw createError('VALIDATION_ERROR', 'CSV data exceeds 1MB limit');
  }

  const lines = body.csv.split('\n');
  const newRows = [];
  let skipped = 0;
  let rejected = 0;

  // Get existing SKUs to avoid duplicates
  const existing = await readSheet(sheetId, `${SHEET_NAME}!B:B`, env);
  const existingSKUs = new Set();
  for (let i = 1; i < existing.length; i++) {
    if (existing[i][0]) {
      existingSKUs.add(String(existing[i][0]));
    }
  }

  // Process CSV (skip header line)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Handle both comma and tab delimiters
    const parts = line.includes('\t') ? line.split('\t') : line.split(',');

    if (parts.length >= 3) {
      const headerRaw = parts[0].trim().replace(/^["']|["']$/g, '');
      const skuRaw = parts[1].trim().replace(/^["']|["']$/g, '');
      const barcodeRaw = parts[2].trim().replace(/^["']|["']$/g, '');

      // Validate barcode format
      if (barcodeRaw && !/^[A-Za-z0-9\-_. ]*$/.test(barcodeRaw)) {
        rejected++;
        continue;
      }

      const header = sanitizeForSheets(headerRaw);
      const sku = sanitizeForSheets(skuRaw);
      const barcode = sanitizeForSheets(barcodeRaw);

      if (header && sku && barcode && !existingSKUs.has(sku)) {
        newRows.push([header, sku, barcode]);
        existingSKUs.add(sku);
      } else {
        skipped++;
      }
    }
  }

  // Append all new rows at once
  if (newRows.length > 0) {
    await appendSheet(sheetId, `${SHEET_NAME}!A:C`, newRows, env);
  }

  let message = `Imported ${newRows.length} products. Skipped ${skipped} items.`;
  if (rejected > 0) {
    message += ` Rejected ${rejected} items due to invalid data.`;
  }

  return successResponse({ success: true, message });
}

// ===== MAIN HANDLER =====

export async function handleBarcode(request, env) {
  const action = getAction(request);
  const params = getQueryParams(request);
  const body = request.method === 'POST' ? await parseBody(request) : {};

  const actions = {
    products: () => getProducts(params, env),
    test: () => test(),
    add: () => addProduct(params, body, env),
    update: () => updateProduct(params, body, env),
    delete: () => deleteProduct(params, body, env),
    import: () => importCSV(params, body, env),
  };

  if (!action || !actions[action]) {
    throw createError('VALIDATION_ERROR', `Unknown action: ${action}`);
  }

  return actions[action]();
}
