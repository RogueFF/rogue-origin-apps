/**
 * Kanban Card Manager API Handler for Cloudflare Workers
 * Migrated from Vercel Functions
 *
 * Endpoints:
 * - GET  ?action=cards        - Get all cards
 * - GET  ?action=test         - Test API
 * - POST ?action=add          - Add card
 * - POST ?action=update       - Update card
 * - POST ?action=delete       - Delete card
 * - POST ?action=fetchProduct - Auto-fill from URL
 */

import { readSheet, appendSheet, writeSheet, clearSheet } from '../lib/sheets.js';
import { successResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { sanitizeForSheets } from '../lib/validate.js';

const SHEET_NAME = '12.12 Supplies';

/**
 * Validate card data
 */
function validateCard(data) {
  if (!data.item || typeof data.item !== 'string') {
    throw createError('VALIDATION_ERROR', 'Item name is required');
  }
  if (data.item.length > 500) {
    throw createError('VALIDATION_ERROR', 'Item name must be 500 characters or less');
  }
  return data;
}

/**
 * Get all cards from the sheet
 */
async function getCards(params, env) {
  const sheetId = env.KANBAN_SHEET_ID;
  const data = await readSheet(sheetId, `${SHEET_NAME}!A:J`, env);

  if (data.length <= 1) {
    return successResponse({ success: true, cards: [] });
  }

  // Find column indices from headers
  const headers = data[0].map((h) => String(h).toLowerCase());
  const colMap = {
    item: headers.findIndex((h) => h.includes('item') || h.includes('name')),
    supplier: headers.findIndex((h) => h.includes('supplier')),
    orderQty: headers.findIndex((h) => h.includes('order') && h.includes('qty')),
    deliveryTime: headers.findIndex((h) => h.includes('delivery')),
    price: headers.findIndex((h) => h.includes('price')),
    crumbtrail: headers.findIndex((h) => h.includes('crumb') || h.includes('location')),
    url: headers.findIndex((h) => h === 'url' || h.includes('order url')),
    picture: headers.findIndex((h) => h.includes('picture') || h.includes('image')),
    orderWhen: headers.findIndex((h) => h.includes('order when')),
    imageFile: headers.findIndex((h) => h.includes('image file')),
  };

  // Defaults if not found (standard column order)
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

  const cards = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const item = row[colMap.item] ? String(row[colMap.item]) : '';
    // Skip empty rows
    if (!item.trim()) continue;

    cards.push({
      id: i + 1, // Row number (1-indexed, +1 for header)
      item,
      supplier: row[colMap.supplier] ? String(row[colMap.supplier]) : '',
      orderQty: row[colMap.orderQty] ? String(row[colMap.orderQty]) : '',
      deliveryTime: row[colMap.deliveryTime] ? String(row[colMap.deliveryTime]) : '',
      price: row[colMap.price] ? String(row[colMap.price]) : '',
      crumbtrail: row[colMap.crumbtrail] ? String(row[colMap.crumbtrail]) : '',
      url: row[colMap.url] ? String(row[colMap.url]) : '',
      picture: row[colMap.picture] ? String(row[colMap.picture]) : '',
      orderWhen: row[colMap.orderWhen] ? String(row[colMap.orderWhen]) : '',
      imageFile: row[colMap.imageFile] ? String(row[colMap.imageFile]) : '',
    });
  }

  return successResponse({ success: true, cards });
}

/**
 * Test endpoint
 */
async function test() {
  return successResponse({
    ok: true,
    message: 'Kanban API is working (Cloudflare Workers)',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Add a new card
 */
async function addCard(params, body, env) {
  const sheetId = env.KANBAN_SHEET_ID;
  const data = validateCard(body);

  const row = [
    sanitizeForSheets(data.item),
    sanitizeForSheets(data.supplier || ''),
    sanitizeForSheets(data.orderQty || ''),
    sanitizeForSheets(data.deliveryTime || ''),
    sanitizeForSheets(data.price || ''),
    sanitizeForSheets(data.crumbtrail || ''),
    sanitizeForSheets(data.url || ''),
    sanitizeForSheets(data.picture || ''),
    sanitizeForSheets(data.orderWhen || ''),
    sanitizeForSheets(data.imageFile || ''),
  ];

  await appendSheet(sheetId, `${SHEET_NAME}!A:J`, [row], env);

  return successResponse({ success: true, message: 'Card added successfully' });
}

/**
 * Update an existing card
 */
async function updateCard(params, body, env) {
  const sheetId = env.KANBAN_SHEET_ID;

  if (!body.id || typeof body.id !== 'number' || body.id < 2) {
    throw createError('VALIDATION_ERROR', 'Valid card ID is required');
  }

  const data = validateCard(body);

  const row = [
    sanitizeForSheets(data.item),
    sanitizeForSheets(data.supplier || ''),
    sanitizeForSheets(data.orderQty || ''),
    sanitizeForSheets(data.deliveryTime || ''),
    sanitizeForSheets(data.price || ''),
    sanitizeForSheets(data.crumbtrail || ''),
    sanitizeForSheets(data.url || ''),
    sanitizeForSheets(data.picture || ''),
    sanitizeForSheets(data.orderWhen || ''),
    sanitizeForSheets(data.imageFile || ''),
  ];

  await writeSheet(sheetId, `${SHEET_NAME}!A${body.id}:J${body.id}`, [row], env);

  return successResponse({ success: true, message: 'Card updated' });
}

/**
 * Delete a card by row number
 */
async function deleteCard(params, body, env) {
  const sheetId = env.KANBAN_SHEET_ID;

  if (!body.id || typeof body.id !== 'number' || body.id < 2) {
    throw createError('VALIDATION_ERROR', 'Valid card ID is required');
  }

  await clearSheet(sheetId, `${SHEET_NAME}!A${body.id}:J${body.id}`, env);

  return successResponse({ success: true, message: 'Card deleted' });
}

/**
 * Fetch product info from URL (auto-fill feature)
 */
async function fetchProduct(params, body, env) {
  if (!body.url || typeof body.url !== 'string') {
    throw createError('VALIDATION_ERROR', 'URL is required');
  }

  const url = body.url;

  // Validate URL format
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
    // Fetch the page
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

    // Extract product info using regex patterns
    const result = {
      success: true,
      title: null,
      price: null,
      image: null,
      supplier: null,
    };

    // Try to extract title
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

    // Try to extract price
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

    // Try to extract image
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

// ===== MAIN HANDLER =====

export async function handleKanban(request, env) {
  const action = getAction(request);
  const params = getQueryParams(request);
  const body = request.method === 'POST' ? await parseBody(request) : {};

  const actions = {
    cards: () => getCards(params, env),
    test: () => test(),
    add: () => addCard(params, body, env),
    update: () => updateCard(params, body, env),
    delete: () => deleteCard(params, body, env),
    fetchProduct: () => fetchProduct(params, body, env),
  };

  if (!action || !actions[action]) {
    throw createError('VALIDATION_ERROR', `Unknown action: ${action}`);
  }

  return actions[action]();
}
