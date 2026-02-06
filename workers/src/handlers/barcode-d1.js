/**
 * Barcode/Label Manager API Handler - D1 Version
 * Migrated from Google Sheets to Cloudflare D1
 */

import { query, queryOne, insert, update, deleteRows } from '../lib/db.js';
import { readSheet } from '../lib/sheets.js';
import { successResponse, parseBody, getAction } from '../lib/response.js';
import { createError } from '../lib/errors.js';

const SHEET_NAME = 'Sheet1';

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

async function getProducts(env) {
  const products = await query(env.DB, `
    SELECT id, header, sku, barcode
    FROM products
    ORDER BY id
  `);

  return successResponse({
    success: true,
    products: products.map(p => ({
      row: p.id,  // Keep 'row' for backward compatibility with frontend
      header: p.header || '',
      sku: p.sku || '',
      barcode: p.barcode || '',
    }))
  });
}

async function test() {
  return successResponse({
    ok: true,
    message: 'Barcode API is working (Cloudflare D1)',
    timestamp: new Date().toISOString(),
  });
}

async function addProduct(body, env) {
  const data = validateProduct(body);

  // Check for duplicate SKU
  const existing = await queryOne(env.DB,
    'SELECT id FROM products WHERE sku = ?',
    [data.sku]
  );
  if (existing) {
    throw createError('VALIDATION_ERROR', 'SKU already exists');
  }

  await insert(env.DB, 'products', {
    header: data.header,
    sku: data.sku,
    barcode: (data.barcode || ''),
  });

  return successResponse({ success: true, message: 'Product added successfully' });
}

async function updateProduct(body, env) {
  if (!body.row || typeof body.row !== 'number' || body.row < 1) {
    throw createError('VALIDATION_ERROR', 'Valid row number is required');
  }

  const data = validateProduct(body);

  const changes = await update(env.DB, 'products', {
    header: data.header,
    sku: data.sku,
    barcode: (data.barcode || ''),
  }, 'id = ?', [body.row]);

  if (changes === 0) {
    throw createError('NOT_FOUND', 'Product not found');
  }

  return successResponse({ success: true, message: 'Product updated' });
}

async function deleteProduct(body, env) {
  if (!body.row || typeof body.row !== 'number' || body.row < 1) {
    throw createError('VALIDATION_ERROR', 'Valid row number is required');
  }

  const changes = await deleteRows(env.DB, 'products', 'id = ?', [body.row]);

  if (changes === 0) {
    throw createError('NOT_FOUND', 'Product not found');
  }

  return successResponse({ success: true, message: 'Product deleted' });
}

async function importCSV(body, env) {
  if (!body.csv || typeof body.csv !== 'string') {
    throw createError('VALIDATION_ERROR', 'CSV data is required');
  }

  if (body.csv.length > 1000000) {
    throw createError('VALIDATION_ERROR', 'CSV data exceeds 1MB limit');
  }

  const lines = body.csv.split('\n');
  let added = 0;
  let skipped = 0;
  let rejected = 0;

  // Get existing SKUs
  const existing = await query(env.DB, 'SELECT sku FROM products');
  const existingSKUs = new Set(existing.map(p => p.sku));

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.includes('\t') ? line.split('\t') : line.split(',');

    if (parts.length >= 3) {
      const headerRaw = parts[0].trim().replace(/^["']|["']$/g, '');
      const skuRaw = parts[1].trim().replace(/^["']|["']$/g, '');
      const barcodeRaw = parts[2].trim().replace(/^["']|["']$/g, '');

      if (barcodeRaw && !/^[A-Za-z0-9\-_. ]*$/.test(barcodeRaw)) {
        rejected++;
        continue;
      }

      if (headerRaw && skuRaw && !existingSKUs.has(skuRaw)) {
        await insert(env.DB, 'products', {
          header: headerRaw,
          sku: skuRaw,
          barcode: barcodeRaw,
        });
        existingSKUs.add(skuRaw);
        added++;
      } else {
        skipped++;
      }
    }
  }

  let message = `Imported ${added} products. Skipped ${skipped} items.`;
  if (rejected > 0) {
    message += ` Rejected ${rejected} items due to invalid data.`;
  }

  return successResponse({ success: true, message });
}

/**
 * Migrate data from Google Sheets to D1 (one-time migration)
 */
async function migrateFromSheets(env) {
  const sheetId = env.BARCODE_SHEET_ID;
  if (!sheetId) {
    throw createError('INTERNAL_ERROR', 'BARCODE_SHEET_ID not configured');
  }

  // Read from Google Sheets
  const data = await readSheet(sheetId, `${SHEET_NAME}!A:C`, env);

  if (data.length <= 1) {
    return successResponse({ success: true, message: 'No data to migrate', migrated: 0 });
  }

  // Find column indices from headers
  const headers = data[0].map(h => String(h).toLowerCase());
  let headerIdx = headers.findIndex(h => h.includes('header') || h.includes('product') || h.includes('name'));
  let skuIdx = headers.findIndex(h => h.includes('sku'));
  let barcodeIdx = headers.findIndex(h => h.includes('barcode'));

  if (headerIdx === -1) headerIdx = 0;
  if (skuIdx === -1) skuIdx = 1;
  if (barcodeIdx === -1) barcodeIdx = 2;

  // Get existing SKUs in D1 to avoid duplicates
  const existing = await query(env.DB, 'SELECT sku FROM products');
  const existingSKUs = new Set(existing.map(p => p.sku));

  let migrated = 0;
  let skipped = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const header = row[headerIdx] ? String(row[headerIdx]) : '';
    const sku = row[skuIdx] ? String(row[skuIdx]) : '';
    const barcode = row[barcodeIdx] ? String(row[barcodeIdx]) : '';

    if (!sku || existingSKUs.has(sku)) {
      skipped++;
      continue;
    }

    await insert(env.DB, 'products', {
      header: header,
      sku: sku,
      barcode: barcode,
    });
    existingSKUs.add(sku);
    migrated++;
  }

  return successResponse({
    success: true,
    message: `Migration complete. Migrated ${migrated} products, skipped ${skipped}.`,
    migrated,
    skipped,
  });
}

export async function handleBarcodeD1(request, env) {
  const action = getAction(request);
  const body = request.method === 'POST' ? await parseBody(request) : {};

  const actions = {
    products: () => getProducts(env),
    test: () => test(),
    add: () => addProduct(body, env),
    update: () => updateProduct(body, env),
    delete: () => deleteProduct(body, env),
    import: () => importCSV(body, env),
    migrate: () => migrateFromSheets(env),
  };

  if (!action || !actions[action]) {
    throw createError('VALIDATION_ERROR', `Unknown action: ${action}`);
  }

  return actions[action]();
}
