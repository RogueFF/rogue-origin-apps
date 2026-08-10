/**
 * Kanban Card Manager API Handler - D1 Version
 * Migrated from Google Sheets to Cloudflare D1
 */

import { query, queryOne, insert, update, deleteRows, execute } from '../lib/db.js';
import { readSheet } from '../lib/sheets.js';
import { sendEmail } from '../lib/gmail.js';
import { successResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { createError } from '../lib/errors.js';

const SHEET_NAME = '12.12 Supplies';

/**
 * Vendors whose reordering runs outside the Friday cart. Scanning one of these
 * cards raises a reorder request and emails the person who handles that vendor,
 * instead of queueing the item.
 *
 * See docs/plans/2026-08-10-grove-reorder-alert-design.md
 */
const REORDER_ALERT_VENDORS = ['Grove'];

/** Pure: does this supplier route to a reorder alert rather than the cart? */
export function isReorderAlertVendor(supplier) {
  return REORDER_ALERT_VENDORS.includes(String(supplier || '').trim());
}

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
    item: data.item,
    supplier: (data.supplier || ''),
    order_qty: (data.orderQty || ''),
    delivery_time: (data.deliveryTime || ''),
    price: (data.price || ''),
    crumbtrail: (data.crumbtrail || ''),
    url: (data.url || ''),
    picture: (data.picture || ''),
    order_when: (data.orderWhen || ''),
    image_file: (data.imageFile || ''),
  });

  return successResponse({ success: true, message: 'Card added successfully', id });
}

async function updateCard(body, env) {
  if (!body.id || typeof body.id !== 'number' || body.id < 1) {
    throw createError('VALIDATION_ERROR', 'Valid card ID is required');
  }

  const data = validateCard(body);

  const changes = await update(env.DB, 'kanban_cards', {
    item: data.item,
    supplier: (data.supplier || ''),
    order_qty: (data.orderQty || ''),
    delivery_time: (data.deliveryTime || ''),
    price: (data.price || ''),
    crumbtrail: (data.crumbtrail || ''),
    url: (data.url || ''),
    picture: (data.picture || ''),
    order_when: (data.orderWhen || ''),
    image_file: (data.imageFile || ''),
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
function isPrivateHostname(hostname) {
  // Block localhost variants
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
  if (hostname.endsWith('.localhost')) return true;

  // Block private IPv4 ranges
  const parts = hostname.split('.');
  if (parts.length === 4 && parts.every(p => /^\d+$/.test(p))) {
    const [a, b] = parts.map(Number);
    if (a === 10) return true;                          // 10.x.x.x
    if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16-31.x.x
    if (a === 192 && b === 168) return true;             // 192.168.x.x
    if (a === 169 && b === 254) return true;             // 169.254.x.x (link-local)
    if (a === 127) return true;                          // 127.x.x.x
    if (a === 0) return true;                            // 0.x.x.x
  }

  // Block private IPv6
  if (hostname.startsWith('[')) {
    const inner = hostname.slice(1, -1).toLowerCase();
    if (inner === '::1') return true;
    if (inner.startsWith('fc') || inner.startsWith('fd')) return true;   // ULA
    if (inner.startsWith('fe80')) return true;                            // link-local
  }

  return false;
}

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

  // SSRF protection: block private/internal hostnames
  if (isPrivateHostname(parsedUrl.hostname)) {
    throw createError('VALIDATION_ERROR', 'URL points to a private/internal address');
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KanbanBot/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Check for redirects to private IPs
    if (response.url && response.url !== url) {
      try {
        const redirected = new URL(response.url);
        if (isPrivateHostname(redirected.hostname)) {
          throw new Error('Redirected to a private/internal address');
        }
      } catch (e) {
        if (e.message.includes('private')) throw e;
      }
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // Limit response size to 1MB
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 1024 * 1024) {
      throw new Error('Response too large');
    }

    const html = await response.text();

    if (html.length > 1024 * 1024) {
      throw new Error('Response too large');
    }

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
    console.error('[kanban] product info fetch failed:', err);
    return successResponse({
      success: false,
      error: 'Could not fetch product info',
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
      item: item,
      supplier: (row[colMap.supplier] ? String(row[colMap.supplier]) : ''),
      order_qty: (row[colMap.orderQty] ? String(row[colMap.orderQty]) : ''),
      delivery_time: (row[colMap.deliveryTime] ? String(row[colMap.deliveryTime]) : ''),
      price: (row[colMap.price] ? String(row[colMap.price]) : ''),
      crumbtrail: (row[colMap.crumbtrail] ? String(row[colMap.crumbtrail]) : ''),
      url: (row[colMap.url] ? String(row[colMap.url]) : ''),
      picture: (row[colMap.picture] ? String(row[colMap.picture]) : ''),
      order_when: (row[colMap.orderWhen] ? String(row[colMap.orderWhen]) : ''),
      image_file: (row[colMap.imageFile] ? String(row[colMap.imageFile]) : ''),
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

// =====================================================================
// FRIDAY CART + ORDER HISTORY (Phase 2)
// See RogueFamilyFarms/docs/plans/2026-05-01-kanban-cart-design.md
// =====================================================================

/**
 * Get current cart, JOINed with cards, grouped by vendor (supplier).
 * Empty cart → { success: true, cart: {}, count: 0 }
 */
async function getCart(env) {
  const rows = await query(env.DB, `
    SELECT c.id AS cartId, c.card_id AS cardId, c.qty, c.added_at AS addedAt,
           c.added_by AS addedBy, c.note,
           k.item, k.supplier, k.url, k.picture, k.crumbtrail, k.order_qty AS orderQty,
           k.delivery_time AS deliveryTime, k.price
    FROM kanban_cart c
    JOIN kanban_cards k ON k.id = c.card_id
    ORDER BY k.supplier, c.added_at
  `);

  const cart = {};
  for (const r of rows) {
    const vendor = r.supplier || '(Unspecified)';
    if (!cart[vendor]) cart[vendor] = [];
    cart[vendor].push(r);
  }

  return successResponse({ success: true, cart, count: rows.length });
}

/**
 * Add a card to the cart (UPSERT — re-queueing the same card bumps qty).
 * Body: { cardId, qty?, note? }
 *
 * Returns a discriminated shape so callers can tell the two lanes apart:
 *   { mode: 'cart',            cartItem: {...} }
 *   { mode: 'reorder_request', request:  {...} }
 * The front-end switches on `mode`; see reorder() in src/pages/kanban.html.
 */
async function addToCart(body, env, ctx) {
  const cardId = Number(body.cardId);
  if (!cardId || cardId < 1) {
    throw createError('VALIDATION_ERROR', 'cardId is required (positive integer)');
  }
  const qty = Math.max(1, Math.floor(Number(body.qty) || 1));
  const note = body.note ? String(body.note).slice(0, 500) : null;
  const addedBy = body.addedBy ? String(body.addedBy).slice(0, 100) : null;

  // Verify card exists. Selects supplier + item too: supplier decides the lane,
  // item goes in the alert email.
  const card = await queryOne(
    env.DB,
    'SELECT id, item, supplier FROM kanban_cards WHERE id = ?',
    [cardId]
  );
  if (!card) throw createError('NOT_FOUND', `Card ${cardId} not found`);

  // Vendors handled outside the Friday cart never touch kanban_cart.
  if (isReorderAlertVendor(card.supplier)) {
    return raiseReorderRequest(card, env, ctx);
  }

  // UPSERT: if card_id already in cart, bump qty; else insert new row
  await execute(env.DB, `
    INSERT INTO kanban_cart (card_id, qty, added_by, note)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(card_id) DO UPDATE SET
      qty = qty + excluded.qty,
      added_at = datetime('now'),
      added_by = COALESCE(excluded.added_by, added_by),
      note = COALESCE(excluded.note, note)
  `, [cardId, qty, addedBy, note]);

  const cartRow = await queryOne(env.DB, `
    SELECT c.id AS cartId, c.card_id AS cardId, c.qty, c.note, k.item, k.supplier
    FROM kanban_cart c JOIN kanban_cards k ON k.id = c.card_id
    WHERE c.card_id = ?
  `, [cardId]);

  return successResponse({ success: true, mode: 'cart', cartItem: cartRow });
}

/**
 * Raise (or find) the open reorder request for a card, then email the handler.
 *
 * Ordering is deliberate: the row is committed BEFORE the send is attempted, so
 * a failed email leaves a visible, retryable record rather than vanishing. The
 * send itself runs in ctx.waitUntil so the person scanning isn't held up by
 * Gmail.
 */
async function raiseReorderRequest(card, env, ctx) {
  const existing = await queryOne(
    env.DB,
    `SELECT id, requested_at AS requestedAt, notify_state AS notifyState,
            close_token AS closeToken
       FROM kanban_reorder_requests
      WHERE card_id = ? AND status = 'open'`,
    [card.id]
  );

  if (existing) {
    // The partial unique index would reject a second open row anyway, so we
    // never create a duplicate. But a re-scan is exactly what someone does when
    // nothing appeared to happen — and if the first notification failed, that
    // is precisely the case. Retry the send rather than swallowing the scan,
    // otherwise a failed alert is a permanent dead end: the row stays open, no
    // scan can ever re-trigger it, and nobody finds out until the shelf is bare.
    const retried = existing.notifyState !== 'sent';
    if (retried) {
      const job = notifyReorderHandler(env, card, existing.id, existing.closeToken);
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(job);
      else await job;
    }

    return successResponse({
      success: true,
      mode: 'reorder_request',
      request: {
        id: existing.id,
        cardId: card.id,
        item: card.item,
        status: 'open',
        outcome: 'already_open',
        retried,
        requestedAt: existing.requestedAt,
      },
    });
  }

  const closeToken = crypto.randomUUID().replace(/-/g, '');
  const id = await insert(env.DB, 'kanban_reorder_requests', {
    card_id: card.id,
    close_token: closeToken,
  });

  const row = await queryOne(
    env.DB,
    'SELECT requested_at AS requestedAt FROM kanban_reorder_requests WHERE id = ?',
    [id]
  );

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(notifyReorderHandler(env, card, id, closeToken));
  } else {
    // No ctx (direct call / test): don't drop the notification silently.
    await notifyReorderHandler(env, card, id, closeToken);
  }

  return successResponse({
    success: true,
    mode: 'reorder_request',
    request: {
      id,
      cardId: card.id,
      item: card.item,
      status: 'open',
      outcome: 'created',
      requestedAt: row?.requestedAt || null,
    },
  });
}

/**
 * Send the alert and record the outcome on the request row. Never throws — a
 * send failure must land in notify_state, not bubble out of ctx.waitUntil.
 */
async function notifyReorderHandler(env, card, requestId, closeToken) {
  const confirmUrl =
    `${env.PUBLIC_API_BASE || 'https://rogue-origin-api.roguefamilyfarms.workers.dev'}` +
    `/api/kanban?action=reorderRequest&token=${closeToken}`;

  try {
    await sendEmail(env, {
      to: env.DAMON_EMAIL,
      cc: env.REORDER_CC || undefined,
      subject: `Reorder needed: ${card.item}`,
      text:
        `${card.item} (${card.supplier}) was flagged for reorder in the supply closet.\n\n` +
        `Once you've placed the order, mark it done here:\n${confirmUrl}\n\n` +
        `Until then, re-scanning this card won't send another email.\n\n` +
        `— Rogue Origin supply kanban`,
    });

    await update(
      env.DB,
      'kanban_reorder_requests',
      { notify_state: 'sent', notify_error: null },
      'id = ?',
      [requestId]
    );
  } catch (e) {
    console.error('[kanban][reorder-alert]', e);
    await update(
      env.DB,
      'kanban_reorder_requests',
      { notify_state: 'failed', notify_error: String(e.message || e).slice(0, 500) },
      'id = ?',
      [requestId]
    ).catch(() => {});
  }
}

/**
 * GET ?action=reorderRequest&token=<t>
 *
 * Renders a confirmation page and changes NOTHING. Gmail and Outlook prefetch
 * and security-scan links on delivery, so a state-changing GET here would close
 * requests nobody acted on. The button below POSTs.
 */
async function showReorderRequest(request, env) {
  const { token } = getQueryParams(request);
  const row = token
    ? await queryOne(
        env.DB,
        `SELECT r.id, r.status, r.requested_at AS requestedAt, r.closed_at AS closedAt,
                k.item, k.supplier
           FROM kanban_reorder_requests r
           JOIN kanban_cards k ON k.id = r.card_id
          WHERE r.close_token = ?`,
        [token]
      )
    : null;

  return new Response(reorderConfirmPage(row, token), {
    headers: { 'Content-Type': 'text/html;charset=utf-8' },
  });
}

/**
 * POST ?action=closeReorderRequest  { token, closedBy? }
 * Idempotent: closing an already-closed request is a no-op success.
 */
async function closeReorderRequest(body, env) {
  const token = body.token ? String(body.token) : '';
  if (!token) throw createError('VALIDATION_ERROR', 'token is required');

  const row = await queryOne(
    env.DB,
    'SELECT id, status FROM kanban_reorder_requests WHERE close_token = ?',
    [token]
  );
  if (!row) throw createError('NOT_FOUND', 'Reorder request not found');

  if (row.status === 'ordered') {
    return successResponse({ success: true, alreadyClosed: true });
  }

  await update(
    env.DB,
    'kanban_reorder_requests',
    {
      status: 'ordered',
      closed_at: new Date().toISOString(),
      closed_by: body.closedBy ? String(body.closedBy).slice(0, 100) : 'email-link',
    },
    'id = ?',
    [row.id]
  );

  return successResponse({ success: true, alreadyClosed: false });
}

/** List reorder requests. ?status=open|ordered|all (default open). */
async function getReorderRequests(request, env) {
  const { status = 'open' } = getQueryParams(request);
  const where = status === 'all' ? '' : 'WHERE r.status = ?';
  const params = status === 'all' ? [] : [status];

  const rows = await query(
    env.DB,
    `SELECT r.id, r.card_id AS cardId, r.requested_at AS requestedAt, r.status,
            r.notify_state AS notifyState, r.notify_error AS notifyError,
            r.closed_at AS closedAt, r.closed_by AS closedBy,
            k.item, k.supplier
       FROM kanban_reorder_requests r
       JOIN kanban_cards k ON k.id = r.card_id
       ${where}
      ORDER BY r.requested_at DESC`,
    params
  );

  return successResponse({ success: true, requests: rows, count: rows.length });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/** Minimal self-contained confirmation page for the email link. */
function reorderConfirmPage(row, token) {
  const shell = (inner) =>
    `<!DOCTYPE html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Reorder request</title><style>` +
    `body{font-family:system-ui,sans-serif;background:#faf8f5;color:#1f2a20;` +
    `display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}` +
    `.card{background:#fff;border:1px solid #e2ddd3;border-radius:14px;padding:28px;max-width:420px;width:100%;` +
    `box-shadow:0 1px 3px rgba(0,0,0,.06)}h1{font-size:20px;margin:0 0 6px}` +
    `p{color:#5d6b5f;line-height:1.5;margin:0 0 18px}` +
    `button{background:#668971;color:#fff;border:0;border-radius:8px;padding:13px 22px;` +
    `font-size:16px;font-weight:600;cursor:pointer;width:100%}` +
    `button:disabled{opacity:.6;cursor:default}.ok{color:#668971;font-weight:600}` +
    `</style></head><body><div class="card">${inner}</div></body></html>`;

  if (!row) {
    return shell(
      `<h1>Link not recognized</h1><p>This reorder link is invalid or has been removed.</p>`
    );
  }

  if (row.status === 'ordered') {
    return shell(
      `<h1>${escapeHtml(row.item)}</h1>` +
        `<p class="ok">Already marked as ordered${row.closedAt ? ` on ${escapeHtml(String(row.closedAt).slice(0, 10))}` : ''}.</p>`
    );
  }

  return shell(
    `<h1>${escapeHtml(row.item)}</h1>` +
      `<p>${escapeHtml(row.supplier)} &middot; requested ${escapeHtml(String(row.requestedAt || '').slice(0, 10))}<br>` +
      `Mark this as ordered?</p>` +
      `<button id="b">Yes — I've ordered it</button>` +
      `<script>document.getElementById('b').onclick=function(){` +
      `var b=this;b.disabled=true;b.textContent='Saving…';` +
      `fetch('?action=closeReorderRequest',{method:'POST',` +
      `headers:{'Content-Type':'text/plain;charset=utf-8'},` +
      `body:JSON.stringify({token:${JSON.stringify(token)}})})` +
      `.then(function(r){return r.json()}).then(function(r){` +
      `b.outerHTML=r.success?'<p class="ok">Marked as ordered. Thanks!</p>':` +
      `'<p>Something went wrong — try again.</p>'})` +
      `.catch(function(){b.disabled=false;b.textContent="Yes — I've ordered it"})};` +
      `<\/script>`
  );
}

/**
 * Set the qty on a cart row.
 * Body: { cardId, qty }
 */
async function updateCartQty(body, env) {
  const cardId = Number(body.cardId);
  const qty = Math.max(1, Math.floor(Number(body.qty)));
  if (!cardId || cardId < 1) throw createError('VALIDATION_ERROR', 'cardId required');
  if (!qty || qty < 1) throw createError('VALIDATION_ERROR', 'qty must be >= 1');

  const changes = await update(env.DB, 'kanban_cart', { qty }, 'card_id = ?', [cardId]);
  if (changes === 0) throw createError('NOT_FOUND', 'Cart entry not found');
  return successResponse({ success: true });
}

/**
 * Remove a card from the cart.
 * Body: { cardId }
 */
async function removeFromCart(body, env) {
  const cardId = Number(body.cardId);
  if (!cardId || cardId < 1) throw createError('VALIDATION_ERROR', 'cardId required');

  const changes = await deleteRows(env.DB, 'kanban_cart', 'card_id = ?', [cardId]);
  if (changes === 0) throw createError('NOT_FOUND', 'Cart entry not found');
  return successResponse({ success: true });
}

/**
 * Move a vendor's cart items into kanban_orders and clear them from cart.
 * Atomic via D1 batch (no transactions across separate awaits — see design doc).
 * Body: { vendor, placedBy? }
 */
async function markOrdered(body, env) {
  const vendor = body.vendor ? String(body.vendor).trim() : null;
  if (!vendor) throw createError('VALIDATION_ERROR', 'vendor is required');
  const placedBy = body.placedBy ? String(body.placedBy).slice(0, 100) : null;

  // Read what we're about to order (snapshot)
  const items = await query(env.DB, `
    SELECT c.card_id AS cardId, c.qty, k.item
    FROM kanban_cart c JOIN kanban_cards k ON k.id = c.card_id
    WHERE k.supplier = ?
    ORDER BY k.item
  `, [vendor]);

  if (items.length === 0) {
    throw createError('NOT_FOUND', `No cart items for vendor "${vendor}"`);
  }

  const itemsJson = JSON.stringify(items.map(r => ({ cardId: r.cardId, item: r.item, qty: r.qty })));

  // Atomic batch: insert order row + delete cart rows for this vendor
  const result = await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO kanban_orders (vendor, placed_by, items_json) VALUES (?, ?, ?)'
    ).bind(vendor, placedBy, itemsJson),
    env.DB.prepare(
      'DELETE FROM kanban_cart WHERE card_id IN (SELECT id FROM kanban_cards WHERE supplier = ?)'
    ).bind(vendor),
  ]);

  const orderId = result[0]?.meta?.last_row_id;
  return successResponse({
    success: true,
    orderId,
    vendor,
    itemCount: items.length,
    items,
  });
}

/**
 * Bulk analytics for all cards that have any order history. Cards without
 * orders are simply absent from the response. Lets the frontend annotate
 * every card without making N requests.
 * Returns { byCardId: { [cardId]: { orderCount, lastOrderedAt, daysSinceLastOrder, avgGapDays } } }
 */
async function getAllAnalytics(env) {
  // For each cardId mentioned in any order, get the list of ordered_at timestamps
  const rows = await query(env.DB, `
    SELECT
      CAST(json_extract(value, '$.cardId') AS INTEGER) AS cardId,
      ordered_at AS orderedAt
    FROM kanban_orders, json_each(items_json)
    ORDER BY cardId, ordered_at ASC
  `);

  const byCardId = {};
  const now = Date.now();
  for (const row of rows) {
    const id = row.cardId;
    if (!byCardId[id]) byCardId[id] = { _ts: [] };
    byCardId[id]._ts.push(Date.parse(row.orderedAt + 'Z'));
  }
  for (const id of Object.keys(byCardId)) {
    const ts = byCardId[id]._ts;
    const last = ts[ts.length - 1];
    let avg = null;
    if (ts.length >= 2) {
      let sum = 0;
      for (let i = 1; i < ts.length; i++) sum += (ts[i] - ts[i - 1]) / 86400000;
      avg = Math.round(sum / (ts.length - 1));
    }
    byCardId[id] = {
      orderCount: ts.length,
      lastOrderedAt: new Date(last).toISOString(),
      daysSinceLastOrder: Math.floor((now - last) / 86400000),
      avgGapDays: avg,
    };
  }

  return successResponse({ success: true, byCardId });
}

/**
 * Per-card reorder analytics: when last ordered, how often, how many times.
 * Query params: ?cardId=X (required)
 * Returns lastOrderedAt, daysSinceLastOrder, avgGapDays, orderCount.
 */
async function getCardAnalytics(request, env) {
  const params = getQueryParams(request);
  const cardId = Number(params.cardId);
  if (!cardId || cardId < 1) {
    throw createError('VALIDATION_ERROR', 'cardId query param required');
  }

  const rows = await query(env.DB, `
    SELECT ordered_at FROM kanban_orders
    WHERE EXISTS (
      SELECT 1 FROM json_each(items_json)
      WHERE CAST(json_extract(value, '$.cardId') AS INTEGER) = ?
    )
    ORDER BY ordered_at ASC
  `, [cardId]);

  if (rows.length === 0) {
    return successResponse({
      success: true,
      cardId,
      orderCount: 0,
      lastOrderedAt: null,
      daysSinceLastOrder: null,
      avgGapDays: null,
    });
  }

  const timestamps = rows.map(r => Date.parse(r.ordered_at + 'Z'));
  const lastTs = timestamps[timestamps.length - 1];
  const now = Date.now();
  const daysSince = Math.floor((now - lastTs) / 86400000);

  let avgGap = null;
  if (timestamps.length >= 2) {
    const gaps = [];
    for (let i = 1; i < timestamps.length; i++) {
      gaps.push((timestamps[i] - timestamps[i - 1]) / 86400000);
    }
    avgGap = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
  }

  return successResponse({
    success: true,
    cardId,
    orderCount: rows.length,
    lastOrderedAt: rows[rows.length - 1].ordered_at,
    daysSinceLastOrder: daysSince,
    avgGapDays: avgGap,
  });
}

/**
 * Get historical orders, optionally filtered.
 * Query params: ?cardId=X | ?vendor=Y | ?limit=N (default 50)
 */
async function getOrderHistory(request, env) {
  const params = getQueryParams(request);
  const limit = Math.min(500, Math.max(1, parseInt(params.limit) || 50));
  const vendor = params.vendor ? String(params.vendor).trim() : null;
  const cardId = params.cardId ? Number(params.cardId) : null;

  let sql, args;
  if (cardId) {
    // Card-specific history: filter on JSON contents
    sql = `
      SELECT id, vendor, ordered_at AS orderedAt, placed_by AS placedBy, items_json AS itemsJson
      FROM kanban_orders
      WHERE EXISTS (
        SELECT 1 FROM json_each(items_json)
        WHERE CAST(json_extract(value, '$.cardId') AS INTEGER) = ?
      )
      ORDER BY ordered_at DESC
      LIMIT ?
    `;
    args = [cardId, limit];
  } else if (vendor) {
    sql = `
      SELECT id, vendor, ordered_at AS orderedAt, placed_by AS placedBy, items_json AS itemsJson
      FROM kanban_orders
      WHERE vendor = ?
      ORDER BY ordered_at DESC
      LIMIT ?
    `;
    args = [vendor, limit];
  } else {
    sql = `
      SELECT id, vendor, ordered_at AS orderedAt, placed_by AS placedBy, items_json AS itemsJson
      FROM kanban_orders
      ORDER BY ordered_at DESC
      LIMIT ?
    `;
    args = [limit];
  }

  const rows = await query(env.DB, sql, args);
  // Parse items_json on the way out
  const orders = rows.map(r => ({
    id: r.id,
    vendor: r.vendor,
    orderedAt: r.orderedAt,
    placedBy: r.placedBy,
    items: r.itemsJson ? JSON.parse(r.itemsJson) : [],
  }));

  return successResponse({ success: true, orders, count: orders.length });
}

export async function handleKanbanD1(request, env, ctx) {
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
    // Phase 2: Friday cart + order history
    getCart: () => getCart(env),
    addToCart: () => addToCart(body, env, ctx),
    updateCartQty: () => updateCartQty(body, env),
    removeFromCart: () => removeFromCart(body, env),
    markOrdered: () => markOrdered(body, env),
    getOrderHistory: () => getOrderHistory(request, env),
    getCardAnalytics: () => getCardAnalytics(request, env),
    getAllAnalytics: () => getAllAnalytics(env),
    // Vendor-routed reorder alerts (Grove) — see design doc 2026-08-10
    reorderRequest: () => showReorderRequest(request, env),
    closeReorderRequest: () => closeReorderRequest(body, env),
    getReorderRequests: () => getReorderRequests(request, env),
  };

  if (!action || !actions[action]) {
    throw createError('VALIDATION_ERROR', `Unknown action: ${action}`);
  }

  return actions[action]();
}
