/**
 * Kanban Card Manager API
 * Migrated from Apps Script to Vercel Functions
 *
 * Endpoints:
 * - GET  ?action=cards        - Get all cards
 * - GET  ?action=test         - Test API
 * - POST ?action=add          - Add card
 * - POST ?action=update       - Update card
 * - POST ?action=delete       - Delete card
 * - POST ?action=fetchProduct - Auto-fill from URL
 */

const { createHandler, success } = require('../_lib/response');
const { readSheet, appendSheet, writeSheet, clearSheet } = require('../_lib/sheets');
const { validateOrThrow, sanitizeForSheets } = require('../_lib/validate');
const { createError } = require('../_lib/errors');

const SHEET_ID = process.env.KANBAN_SHEET_ID;
const SHEET_NAME = '12.12 Supplies';

// Validation schemas
const cardSchema = {
  item: { type: 'string', required: true, maxLength: 500 },
  supplier: { type: 'string', maxLength: 200 },
  orderQty: { type: 'string', maxLength: 100 },
  deliveryTime: { type: 'string', maxLength: 100 },
  price: { type: 'string', maxLength: 50 },
  crumbtrail: { type: 'string', maxLength: 500 },
  url: { type: 'string', maxLength: 2000 },
  picture: { type: 'string', maxLength: 2000 },
  orderWhen: { type: 'string', maxLength: 200 },
  imageFile: { type: 'string', maxLength: 500 },
};

const updateSchema = {
  id: { type: 'number', required: true, min: 2, integer: true },
  ...cardSchema,
};

const deleteSchema = {
  id: { type: 'number', required: true, min: 2, integer: true },
};

const fetchProductSchema = {
  url: { type: 'string', required: true, maxLength: 2000 },
};

/**
 * Get all cards from the sheet
 */
async function getCards(req, res) {
  const data = await readSheet(SHEET_ID, `${SHEET_NAME}!A:J`);

  if (data.length <= 1) {
    return success(res, { success: true, cards: [] });
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

  success(res, { success: true, cards });
}

/**
 * Test endpoint
 */
async function test(req, res) {
  success(res, {
    ok: true,
    message: 'Kanban API is working (Vercel)',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Add a new card
 */
async function addCard(req, res, body) {
  const data = validateOrThrow(body, cardSchema);

  // Sanitize all fields
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

  await appendSheet(SHEET_ID, `${SHEET_NAME}!A:J`, [row]);

  success(res, { success: true, message: 'Card added successfully' });
}

/**
 * Update an existing card
 */
async function updateCard(req, res, body) {
  const data = validateOrThrow(body, updateSchema);

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

  await writeSheet(SHEET_ID, `${SHEET_NAME}!A${data.id}:J${data.id}`, [row]);

  success(res, { success: true, message: 'Card updated' });
}

/**
 * Delete a card by row number
 */
async function deleteCard(req, res, body) {
  const data = validateOrThrow(body, deleteSchema);

  await clearSheet(SHEET_ID, `${SHEET_NAME}!A${data.id}:J${data.id}`);

  success(res, { success: true, message: 'Card deleted' });
}

/**
 * Fetch product info from URL (auto-fill feature)
 */
async function fetchProduct(req, res, body) {
  const data = validateOrThrow(body, fetchProductSchema);
  const url = data.url;

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

    success(res, result);
  } catch (err) {
    success(res, {
      success: false,
      error: 'Could not fetch product info: ' + err.message,
    });
  }
}

// Export handler with all actions
module.exports = createHandler({
  cards: getCards,
  test: test,
  add: addCard,
  update: updateCard,
  delete: deleteCard,
  fetchProduct: fetchProduct,
});
