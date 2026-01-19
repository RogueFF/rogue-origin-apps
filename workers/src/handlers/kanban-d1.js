/**
 * Kanban Card Manager API Handler - D1 Version
 * Migrated from Google Sheets to Cloudflare D1
 */

import { query, queryOne, insert, update, deleteRows } from '../lib/db.js';
import { readSheet } from '../lib/sheets.js';
import { successResponse, parseBody, getAction } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { sanitizeForSheets } from '../lib/validate.js';

const SHEET_NAME = '12.12 Supplies';

function validateCard(data) {
  if (!data.item || typeof data.item !== 'string') {
    throw createError('VALIDATION_ERROR', 'Item name is required');
  }
  if (data.item.length > 500) {
    throw createError('VALIDATION_ERROR', 'Item name must be 500 characters or less');
  }
  return data;
}

async function getCards(env) {
  const cards = await query(env.DB, `
    SELECT id, item, supplier, order_qty, delivery_time, price,
           crumbtrail, url, picture, order_when, image_file
    FROM kanban_cards
    ORDER BY id
  `);

  return successResponse({
    success: true,
    cards: cards.map(c => ({
      id: c.id,
      item: c.item || '',
      supplier: c.supplier || '',
      orderQty: c.order_qty || '',
      deliveryTime: c.delivery_time || '',
      price: c.price || '',
      crumbtrail: c.crumbtrail || '',
      url: c.url || '',
      picture: c.picture || '',
      orderWhen: c.order_when || '',
      imageFile: c.image_file || '',
    }))
  });
}

async function test() {
  return successResponse({
    ok: true,
    message: 'Kanban API is working (Cloudflare D1)',
    timestamp: new Date().toISOString(),
  });
}

async function addCard(body, env) {
  const data = validateCard(body);

  const id = await insert(env.DB, 'kanban_cards', {
    item: sanitizeForSheets(data.item),
    supplier: sanitizeForSheets(data.supplier || ''),
    order_qty: sanitizeForSheets(data.orderQty || ''),
    delivery_time: sanitizeForSheets(data.deliveryTime || ''),
    price: sanitizeForSheets(data.price || ''),
    crumbtrail: sanitizeForSheets(data.crumbtrail || ''),
    url: sanitizeForSheets(data.url || ''),
    picture: sanitizeForSheets(data.picture || ''),
    order_when: sanitizeForSheets(data.orderWhen || ''),
    image_file: sanitizeForSheets(data.imageFile || ''),
  });

  return successResponse({ success: true, message: 'Card added successfully', id });
}

async function updateCard(body, env) {
  if (!body.id || typeof body.id !== 'number' || body.id < 1) {
    throw createError('VALIDATION_ERROR', 'Valid card ID is required');
  }

  const data = validateCard(body);

  const changes = await update(env.DB, 'kanban_cards', {
    item: sanitizeForSheets(data.item),
    supplier: sanitizeForSheets(data.supplier || ''),
    order_qty: sanitizeForSheets(data.orderQty || ''),
    delivery_time: sanitizeForSheets(data.deliveryTime || ''),
    price: sanitizeForSheets(data.price || ''),
    crumbtrail: sanitizeForSheets(data.crumbtrail || ''),
    url: sanitizeForSheets(data.url || ''),
    picture: sanitizeForSheets(data.picture || ''),
    order_when: sanitizeForSheets(data.orderWhen || ''),
    image_file: sanitizeForSheets(data.imageFile || ''),
  }, 'id = ?', [body.id]);

  if (changes === 0) {
    throw createError('NOT_FOUND', 'Card not found');
  }

  return successResponse({ success: true, message: 'Card updated' });
}

async function deleteCard(body, env) {
  if (!body.id || typeof body.id !== 'number' || body.id < 1) {
    throw createError('VALIDATION_ERROR', 'Valid card ID is required');
  }

  const changes = await deleteRows(env.DB, 'kanban_cards', 'id = ?', [body.id]);

  if (changes === 0) {
    throw createError('NOT_FOUND', 'Card not found');
  }

  return successResponse({ success: true, message: 'Card deleted' });
}

/**
 * Fetch product info from URL (auto-fill feature)
 * Same as original - doesn't use database
 */
async function fetchProduct(body) {
  if (!body.url || typeof body.url !== 'string') {
    throw createError('VALIDATION_ERROR', 'URL is required');
  }

  const url = body.url;

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Invalid protocol');
    }
  } catch {
    throw createError('VALIDATION_ERROR', 'Invalid URL format');
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KanbanBot/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    const result = {
      success: true,
      title: null,
      price: null,
      image: null,
      supplier: null,
    };

    // Extract title
    const titlePatterns = [
      /<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i,
      /<meta[^>]*name="title"[^>]*content="([^"]+)"/i,
      /<title[^>]*>([^<]+)</i,
      /<h1[^>]*>([^<]+)</i,
    ];

    for (const pattern of titlePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        result.title = match[1].trim().substring(0, 200);
        break;
      }
    }

    // Extract price
    const pricePatterns = [
      /\$(\d+(?:\.\d{2})?)/,
      /<meta[^>]*property="product:price:amount"[^>]*content="([^"]+)"/i,
      /"price"[^}]*"value":\s*"?(\d+(?:\.\d{2})?)"?/i,
    ];

    for (const pattern of pricePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        result.price = '$' + parseFloat(match[1]).toFixed(2);
        break;
      }
    }

    // Extract image
    const imagePatterns = [
      /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i,
      /<meta[^>]*name="twitter:image"[^>]*content="([^"]+)"/i,
    ];

    for (const pattern of imagePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        result.image = match[1];
        break;
      }
    }

    // Detect supplier from URL
    const host = parsedUrl.hostname.toLowerCase();
    if (host.includes('amazon')) result.supplier = 'Amazon';
    else if (host.includes('walmart')) result.supplier = 'Walmart';
    else if (host.includes('uline')) result.supplier = 'Uline';
    else if (host.includes('homedepot')) result.supplier = 'Home Depot';
    else if (host.includes('lowes')) result.supplier = 'Lowes';
    else if (host.includes('costco')) result.supplier = 'Costco';
    else if (host.includes('target')) result.supplier = 'Target';
    else if (host.includes('ebay')) result.supplier = 'eBay';

    return successResponse(result);
  } catch (err) {
    return successResponse({
      success: false,
      error: 'Could not fetch product info: ' + err.message,
    });
  }
}

/**
 * Migrate data from Google Sheets to D1 (one-time migration)
 */
async function migrateFromSheets(env) {
  const sheetId = env.KANBAN_SHEET_ID;
  if (!sheetId) {
    throw createError('INTERNAL_ERROR', 'KANBAN_SHEET_ID not configured');
  }

  const data = await readSheet(sheetId, `${SHEET_NAME}!A:J`, env);

  if (data.length <= 1) {
    return successResponse({ success: true, message: 'No data to migrate', migrated: 0 });
  }

  // Find column indices from headers
  const headers = data[0].map(h => String(h).toLowerCase());
  const colMap = {
    item: headers.findIndex(h => h.includes('item') || h.includes('name')),
    supplier: headers.findIndex(h => h.includes('supplier')),
    orderQty: headers.findIndex(h => h.includes('order') && h.includes('qty')),
    deliveryTime: headers.findIndex(h => h.includes('delivery')),
    price: headers.findIndex(h => h.includes('price')),
    crumbtrail: headers.findIndex(h => h.includes('crumb') || h.includes('location')),
    url: headers.findIndex(h => h === 'url' || h.includes('order url')),
    picture: headers.findIndex(h => h.includes('picture') || h.includes('image')),
    orderWhen: headers.findIndex(h => h.includes('order when')),
    imageFile: headers.findIndex(h => h.includes('image file')),
  };

  // Defaults
  if (colMap.item === -1) colMap.item = 0;
  if (colMap.supplier === -1) colMap.supplier = 1;
  if (colMap.orderQty === -1) colMap.orderQty = 2;
  if (colMap.deliveryTime === -1) colMap.deliveryTime = 3;
  if (colMap.price === -1) colMap.price = 4;
  if (colMap.crumbtrail === -1) colMap.crumbtrail = 5;
  if (colMap.url === -1) colMap.url = 6;
  if (colMap.picture === -1) colMap.picture = 7;
  if (colMap.orderWhen === -1) colMap.orderWhen = 8;
  if (colMap.imageFile === -1) colMap.imageFile = 9;

  let migrated = 0;
  let skipped = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const item = row[colMap.item] ? String(row[colMap.item]).trim() : '';

    if (!item) {
      skipped++;
      continue;
    }

    await insert(env.DB, 'kanban_cards', {
      item: sanitizeForSheets(item),
      supplier: sanitizeForSheets(row[colMap.supplier] ? String(row[colMap.supplier]) : ''),
      order_qty: sanitizeForSheets(row[colMap.orderQty] ? String(row[colMap.orderQty]) : ''),
      delivery_time: sanitizeForSheets(row[colMap.deliveryTime] ? String(row[colMap.deliveryTime]) : ''),
      price: sanitizeForSheets(row[colMap.price] ? String(row[colMap.price]) : ''),
      crumbtrail: sanitizeForSheets(row[colMap.crumbtrail] ? String(row[colMap.crumbtrail]) : ''),
      url: sanitizeForSheets(row[colMap.url] ? String(row[colMap.url]) : ''),
      picture: sanitizeForSheets(row[colMap.picture] ? String(row[colMap.picture]) : ''),
      order_when: sanitizeForSheets(row[colMap.orderWhen] ? String(row[colMap.orderWhen]) : ''),
      image_file: sanitizeForSheets(row[colMap.imageFile] ? String(row[colMap.imageFile]) : ''),
    });
    migrated++;
  }

  return successResponse({
    success: true,
    message: `Migration complete. Migrated ${migrated} cards, skipped ${skipped}.`,
    migrated,
    skipped,
  });
}

export async function handleKanbanD1(request, env) {
  const action = getAction(request);
  const body = request.method === 'POST' ? await parseBody(request) : {};

  const actions = {
    cards: () => getCards(env),
    test: () => test(),
    add: () => addCard(body, env),
    update: () => updateCard(body, env),
    delete: () => deleteCard(body, env),
    fetchProduct: () => fetchProduct(body),
    migrate: () => migrateFromSheets(env),
  };

  if (!action || !actions[action]) {
    throw createError('VALIDATION_ERROR', `Unknown action: ${action}`);
  }

  return actions[action]();
}
