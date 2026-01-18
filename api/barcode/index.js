/**
 * Barcode/Label Manager API
 * Migrated from Apps Script to Vercel Functions
 *
 * Endpoints:
 * - GET  ?action=products  - Get all products
 * - GET  ?action=test      - Test API
 * - POST ?action=add       - Add product
 * - POST ?action=update    - Update product
 * - POST ?action=delete    - Delete product
 * - POST ?action=import    - Import CSV
 */

const { createHandler, success } = require('../_lib/response');
const { readSheet, appendSheet, writeSheet, clearSheet } = require('../_lib/sheets');
const { validateOrThrow, sanitizeForSheets, CommonSchemas } = require('../_lib/validate');
const { createError } = require('../_lib/errors');

const SHEET_ID = process.env.BARCODE_SHEET_ID;
const SHEET_NAME = 'Sheet1'; // Default sheet name

// Validation schemas
const productSchema = {
  header: { type: 'string', required: true, maxLength: 200 },
  sku: { type: 'string', required: true, maxLength: 100 },
  barcode: { type: 'string', maxLength: 100, pattern: /^[A-Za-z0-9\-_. ]*$/ },
};

const updateSchema = {
  row: { type: 'number', required: true, min: 2, integer: true },
  header: { type: 'string', required: true, maxLength: 200 },
  sku: { type: 'string', required: true, maxLength: 100 },
  barcode: { type: 'string', maxLength: 100, pattern: /^[A-Za-z0-9\-_. ]*$/ },
};

const deleteSchema = {
  row: { type: 'number', required: true, min: 2, integer: true },
};

const importSchema = {
  csv: { type: 'string', required: true, maxLength: 1000000 }, // 1MB limit
};

/**
 * Get all products from the sheet
 */
async function getProducts(req, res) {
  const data = await readSheet(SHEET_ID, `${SHEET_NAME}!A:C`);

  if (data.length <= 1) {
    return success(res, { success: true, products: [] });
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

  success(res, { success: true, products });
}

/**
 * Test endpoint
 */
async function test(req, res) {
  success(res, {
    ok: true,
    message: 'Barcode API is working (Vercel)',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Add a new product
 */
async function addProduct(req, res, body) {
  const data = validateOrThrow(body, productSchema);

  // Sanitize for sheets
  const header = sanitizeForSheets(data.header);
  const sku = sanitizeForSheets(data.sku);
  const barcode = sanitizeForSheets(data.barcode || '');

  // Check for duplicate SKU
  const existing = await readSheet(SHEET_ID, `${SHEET_NAME}!B:B`);
  for (let i = 1; i < existing.length; i++) {
    if (existing[i][0] && String(existing[i][0]) === sku) {
      throw createError('VALIDATION_ERROR', 'SKU already exists');
    }
  }

  // Append new row
  await appendSheet(SHEET_ID, `${SHEET_NAME}!A:C`, [[header, sku, barcode]]);

  success(res, { success: true, message: 'Product added successfully' });
}

/**
 * Update an existing product
 */
async function updateProduct(req, res, body) {
  const data = validateOrThrow(body, updateSchema);

  // Sanitize for sheets
  const header = sanitizeForSheets(data.header);
  const sku = sanitizeForSheets(data.sku);
  const barcode = sanitizeForSheets(data.barcode || '');

  // Update the row
  await writeSheet(SHEET_ID, `${SHEET_NAME}!A${data.row}:C${data.row}`, [[header, sku, barcode]]);

  success(res, { success: true, message: 'Product updated' });
}

/**
 * Delete a product by row number
 */
async function deleteProduct(req, res, body) {
  const data = validateOrThrow(body, deleteSchema);

  // Clear the row (Sheets API doesn't have true row delete via values API)
  // We'll clear it and the frontend can filter out empty rows
  await clearSheet(SHEET_ID, `${SHEET_NAME}!A${data.row}:C${data.row}`);

  success(res, { success: true, message: 'Product deleted' });
}

/**
 * Import products from CSV
 */
async function importCSV(req, res, body) {
  const data = validateOrThrow(body, importSchema);

  const lines = data.csv.split('\n');
  const newRows = [];
  let skipped = 0;
  let rejected = 0;

  // Get existing SKUs to avoid duplicates
  const existing = await readSheet(SHEET_ID, `${SHEET_NAME}!B:B`);
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

      // Sanitize
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
    await appendSheet(SHEET_ID, `${SHEET_NAME}!A:C`, newRows);
  }

  let message = `Imported ${newRows.length} products. Skipped ${skipped} items.`;
  if (rejected > 0) {
    message += ` Rejected ${rejected} items due to invalid data.`;
  }

  success(res, { success: true, message });
}

// Export handler with all actions
module.exports = createHandler({
  products: getProducts,
  test: test,
  add: addProduct,
  update: updateProduct,
  delete: deleteProduct,
  import: importCSV,
});
