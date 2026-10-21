/**
 * Kanban Card Manager API Handler - D1 Version
 * Migrated from Google Sheets to Cloudflare D1
 */

import { query, queryOne, insert, update, deleteRows, execute } from '../lib/db.js';
import { readSheet } from '../lib/sheets.js';
import { sendEmail } from '../lib/mailer.js';
import { successResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { parseFlowOrder, usageRowsFor } from '../lib/bin-usage.js';
import { DAY, laneStatus, seasonWindow } from '../lib/bin-math.js';
import { validateBinConfig } from '../lib/bin-config.js';

const SHEET_NAME = '12.12 Supplies';

/** Grove 10 LB card: its usage comes from production (inventory_adjustments), not the Shopify ledger. */
const TEN_LB_CARD = 99;
/** The sku production's logBag writes on every barn 10 lb bag scan. */
const TEN_LB_SCAN_SKU = 'MANUAL-10LB-BAG';

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
    // order_qty and crumbtrail ride along so the alert can tell the handler how
    // much to order and where the card lives, without a second lookup.
    'SELECT id, item, supplier, order_qty, crumbtrail FROM kanban_cards WHERE id = ?',
    [cardId]
  );
  if (!card) throw createError('NOT_FOUND', `Card ${cardId} not found`);

  // Vendors handled outside the Friday cart never touch kanban_cart.
  if (isReorderAlertVendor(card.supplier)) {
    // A Grove card with a bin lane gets the order-by email; one without keeps the old body.
    // A lane error falls back to the old email: it must never fail a scan that used to work.
    let lane = null;
    try {
      const rows = await laneRows(env, card.id);
      lane = rows[0] ? await computeLane(env, rows[0]) : null;
    } catch (e) {
      console.error('[grove][addToCart] lane read failed, sending the plain alert', e);
      lane = null;
    }
    return successResponse(await raiseReorderRequest(card, env, ctx, lane));
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
 *
 * Returns a plain payload ({ success, mode, request }); HTTP callers wrap it in
 * successResponse, internal callers (scanCard) use it directly.
 */
async function raiseReorderRequest(card, env, ctx, lane = null) {
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
      const job = notifyReorderHandler(env, card, existing.id, existing.closeToken, lane);
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(job);
      else await job;
    }

    return {
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
    };
  }

  const closeToken = crypto.randomUUID().replace(/-/g, '');
  // ISO, set explicitly: migration 0013's default is SQLite's 'YYYY-MM-DD HH:MM:SS'.
  const requestedAt = new Date().toISOString();
  const id = await insert(env.DB, 'kanban_reorder_requests', {
    card_id: card.id,
    close_token: closeToken,
    requested_at: requestedAt,
  });

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(notifyReorderHandler(env, card, id, closeToken, lane));
  } else {
    // No ctx (direct call / test): don't drop the notification silently.
    await notifyReorderHandler(env, card, id, closeToken, lane);
  }

  return {
    success: true,
    mode: 'reorder_request',
    request: {
      id,
      cardId: card.id,
      item: card.item,
      status: 'open',
      outcome: 'created',
      retried: false,
      requestedAt,
    },
  };
}

/**
 * Body of the reorder alert. Pure — unit-tested.
 *
 * Order quantity leads, because it is the one thing the handler needs in order
 * to act; the item name alone means looking the amount up somewhere else.
 * Fields the card happens to be missing are omitted rather than printed empty.
 */
export function buildReorderEmailBody(card, confirmUrl, lane = null) {
  if (lane) return groveLaneEmailBody(card, confirmUrl, lane);
  const facts = [
    ['Item', card.item],
    ['Order', card.order_qty],
    ['Location', card.crumbtrail],
    ['Supplier', card.supplier],
  ].filter(([, v]) => v);

  return (
    `${card.item} was flagged for reorder in the supply closet.\n\n` +
    facts.map(([k, v]) => `${k}: ${v}`).join('\n') +
    `\n\nOnce you've placed the order, mark it done here:\n${confirmUrl}\n\n` +
    `Until then, re-scanning this card won't send another email.\n\n` +
    `— Rogue Origin supply kanban`
  );
}

/** 'YYYY-MM-DD' → 'Sep 15' (UTC); missing → '—'. */
const fmtMD = (iso) => iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—';
const fmtN = (x) => (Number(x) || 0).toLocaleString('en-US');
const RATE_SOURCE = { ledger: 'from the usage ledger', season: "last fall's pace", seed: 'seed estimate' };

/**
 * Grove bin lane email (design §7): the order-by date leads, because that is
 * the decision; then how much, what is left, how fast it goes, when it runs out.
 */
function groveLaneEmailBody(card, confirmUrl, lane) {
  const rate = Number(lane.rate) || 0, moq = lane.config?.moq, lead = lane.config?.leadDays ?? 75;
  const cover = rate > 0 ? ` ≈ ${Math.round(lane.suggestedQty / rate / 30.4)} months of cover` : '';
  const facts = [
    ['Suggest', `${fmtN(lane.suggestedQty)}${moq && lane.suggestedQty === moq ? ' (MOQ)' : ''}${cover}`],
    ['On hand', `${fmtN(lane.onHand)} bags (${lane.bins} bins)`],
    ['Using', rate > 0 ? `~${fmtN(Math.round(rate * 7))} / week (${RATE_SOURCE[lane.rateSource] || lane.rateSource})` : null],
    ['Runs out', lane.runOut ? `~${fmtMD(lane.runOut)} · lead ${lead} days` : null],
    ['Location', card.crumbtrail],
    ['Supplier', card.supplier],
  ].filter(([, v]) => v);
  return `${card.item} — order by ${fmtMD(lane.orderBy)}.\n\n` +
    facts.map(([k, v]) => `${k}: ${v}`).join('\n') +
    `\n\nOnce you've placed the order, mark it done here:\n${confirmUrl}\n\n— Rogue Origin supply kanban`;
}

/**
 * Send the alert and record the outcome on the request row. Never throws — a
 * send failure must land in notify_state, not bubble out of ctx.waitUntil.
 */
async function notifyReorderHandler(env, card, requestId, closeToken, lane = null) {
  const confirmUrl =
    `${env.PUBLIC_API_BASE || 'https://rogue-origin-api.roguefamilyfarms.workers.dev'}` +
    `/api/kanban?action=reorderRequest&token=${closeToken}`;

  try {
    await sendEmail(env, {
      to: env.DAMON_EMAIL,
      cc: env.REORDER_CC || undefined,
      subject: `Reorder needed: ${card.item}`,
      text: buildReorderEmailBody(card, confirmUrl, lane),
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

  const closedBy = body.closedBy ? String(body.closedBy).slice(0, 100) : 'email-link';
  const closedAt = new Date().toISOString();
  const card = await queryOne(env.DB, 'SELECT k.id, k.item, k.supplier FROM kanban_reorder_requests r JOIN kanban_cards k ON k.id = r.card_id WHERE r.id = ?', [row.id]);
  const cfg = card ? await queryOne(env.DB, 'SELECT moq FROM kanban_bin_config WHERE card_id = ?', [card.id]) : null;
  let lane = null;
  if (card) { try { lane = await computeLane(env, await laneRow(env, card.id)); } catch { lane = null; } }

  // Closing is the order being placed: log it in kanban_orders (same batch, so
  // a request is never closed without its history row) so Grove orders show in
  // the Desk history beside the Friday-cart vendors. qty is the suggested order
  // at close time — what the email told Damon to buy — not a confirmed amount.
  const stmts = [
    env.DB.prepare(`UPDATE kanban_reorder_requests SET status = 'ordered', closed_at = ?, closed_by = ? WHERE id = ?`).bind(closedAt, closedBy, row.id),
  ];
  if (card) {
    stmts.push(env.DB.prepare('INSERT INTO kanban_orders (vendor, placed_by, items_json) VALUES (?, ?, ?)').bind(
      card.supplier || 'Grove', closedBy,
      JSON.stringify([{ cardId: card.id, item: card.item, qty: lane?.suggestedQty ?? cfg?.moq ?? null }])));
  }
  await env.DB.batch(stmts);

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

/**
 * After usage is written: any touched Grove lane now at 'order' with no open
 * request → raise it (dedup is raiseReorderRequest's). Never throws — the
 * webhook must not fail (and be retried by Flow) over a notification.
 */
async function checkLedgerTriggers(cardIds, env, ctx) {
  for (const id of cardIds) {
    try {
      const rows = await laneRows(env, id);
      if (!rows[0]) continue;
      const lane = await computeLane(env, rows[0]);
      // No baseline = no estimate (design §5): an uncounted lane reads onHand 0,
      // which is 'order' at any rate. Firing on it would email Damon "0 bags"
      // for every lane nobody has counted yet.
      if (!lane.baseline) continue;
      if (lane.status !== 'order' || lane.openRequest) continue;
      // Already on order: Damon closed a request after the last delivery was
      // received. The lane stays 'order' through the whole lead time (nothing
      // re-baselines until receiveBins), so without this every Shopify order
      // would email him again and invite a duplicate order. Keyed on the last
      // receive, not any baseline: a mid-lead recount must not re-arm it.
      // An order older than lead + safety with no receive is stale (pre-Grove
      // closes, or a delivery nobody logged), so the trigger re-arms then.
      // closed_at is always ISO (closeReorderRequest / receiveBins write it).
      // Both of these are intended:
      //  (a) The red card deliberately bypasses this hold — scanCard never checks
      //      it. It is the human escape hatch: someone looking at a near-empty
      //      lane can always get Damon told again.
      //  (b) A delivery later than lead + safety with nothing received re-emails
      //      once (the hold has gone stale), then dedups via the open request.
      const staleBefore = new Date(Date.now() - (rows[0].lead_days + rows[0].safety_days) * DAY).toISOString();
      const inFlight = await queryOne(env.DB, `SELECT r.id FROM kanban_reorder_requests r
        WHERE r.card_id = ? AND r.status = 'ordered' AND COALESCE(r.closed_by, '') <> 'receive' AND r.closed_at > ?
          AND r.closed_at > COALESCE((SELECT MAX(at) FROM kanban_bin_events WHERE card_id = ? AND kind = 'receive'), '')
        LIMIT 1`, [id, staleBefore, id]);
      if (inFlight) continue;
      const card = await queryOne(env.DB, 'SELECT * FROM kanban_cards WHERE id = ?', [id]);
      if (card) await raiseReorderRequest(card, env, null, lane);   // null ctx → the send is awaited inside this job
    } catch (e) {
      console.error('[grove][ledger-trigger]', id, e);
    }
  }
}

/**
 * POST ?action=orderUsage&secret=<WEBHOOK_SECRET>  — Shopify Flow "Order created".
 * Writes one kanban_usage row per (line item × recipe). Idempotent on
 * (source, ref, card_id, variant_id), so Flow retries are harmless.
 * Secret check mirrors the production inventory webhook (header or ?secret=).
 */
async function orderUsage(body, request, env, ctx) {
  const secret = env.WEBHOOK_SECRET;
  if (secret) {
    const header = request.headers.get('X-Webhook-Secret');
    const param = new URL(request.url).searchParams.get('secret');
    if (header !== secret && param !== secret) throw createError('UNAUTHORIZED', 'bad secret');
  } else {
    console.warn('[grove][orderUsage] WEBHOOK_SECRET unset — endpoint open');
  }
  let order;
  try { order = parseFlowOrder(body); } catch (e) { throw createError('VALIDATION_ERROR', e.message); }
  const recipes = await query(env.DB, 'SELECT variant_id, card_id, qty FROM kanban_recipes');
  const rows = usageRowsFor(order, recipes);
  if (rows.length === 0) return successResponse({ success: true, written: 0, unmapped: 0, touched: [] });
  await env.DB.batch(rows.map(r => env.DB.prepare(
    'INSERT OR IGNORE INTO kanban_usage (card_id, qty, source, ref, variant_id, at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(r.card_id, r.qty, r.source, r.ref, r.variant_id, r.at)));
  const touched = [...new Set(rows.filter(r => r.card_id > 0).map(r => r.card_id))];
  // The backstop: a lane the ledger has taken to its reorder point raises the
  // Damon request on its own, even if nobody pulls the red card.
  if (touched.length) {
    const job = checkLedgerTriggers(touched, env, ctx);
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(job); else await job;
  }
  return successResponse({ success: true, written: rows.length, unmapped: rows.filter(r => !r.card_id).length, touched });
}

/** Unmapped Shopify variants seen in the last 30 days (ISO bound, like every Grove `at`). */
function recentUnmapped(env) {
  return query(env.DB, `
    SELECT variant_id, SUM(qty) AS qty, MAX(at) AS lastSeen
      FROM kanban_usage WHERE source = 'shopify:unmapped' AND at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
     GROUP BY variant_id ORDER BY qty DESC`);
}

/** GET ?action=getRecipes → { recipes:[{variant_id, card_id, qty, item}], unmapped:[{variant_id, qty, lastSeen}] } */
async function getRecipes(env) {
  const [recipes, unmapped] = await Promise.all([query(env.DB, `
    SELECT r.variant_id, r.card_id, r.qty, k.item
      FROM kanban_recipes r LEFT JOIN kanban_cards k ON k.id = r.card_id
     ORDER BY k.item, r.variant_id`), recentUnmapped(env)]);
  return successResponse({ success: true, recipes, unmapped });
}

/** POST ?action=setRecipe {variant_id, card_id, qty}. qty 0 deletes. */
async function setRecipe(body, env) {
  const variantId = String(body.variant_id || '').trim();
  const cardId = Number(body.card_id), qty = Number(body.qty ?? 1);
  if (!variantId || !(cardId > 0) || !(qty >= 0)) throw createError('VALIDATION_ERROR', 'variant_id, card_id, qty required');
  if (qty === 0) await execute(env.DB, 'DELETE FROM kanban_recipes WHERE variant_id = ? AND card_id = ?', [variantId, cardId]);
  else await execute(env.DB, 'INSERT OR REPLACE INTO kanban_recipes (variant_id, card_id, qty) VALUES (?, ?, ?)', [variantId, cardId, qty]);
  return successResponse({ success: true });
}

// ── Grove bins: lane status (design §5) ─────────────────────────────────────

/** cardId as a positive integer, or VALIDATION_ERROR. */
function cardIdOf(v) {
  const n = typeof v === 'number' || (typeof v === 'string' && v.trim()) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n <= 0) throw createError('VALIDATION_ERROR', 'cardId must be a positive integer');
  return n;
}

/**
 * A bin/box count: a number or a digits-only string, else NaN (→ caller 400s).
 * null/undefined/'' give `dflt`. Booleans and arrays are NaN — Number(true) is 1.
 */
function countOf(v, dflt = NaN) {
  if (v == null || v === '') return dflt;
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^\s*\d+\s*$/.test(v)) return Number(v);
  return NaN;
}

/** Free-text field (lot, by): at most 100 chars, or null. */
const shortText = (v) => (v == null || v === '' ? null : String(v).slice(0, 100));

async function laneRows(env, cardId) {
  const where = cardId ? 'WHERE c.card_id = ?' : '';
  return query(env.DB, `
    SELECT c.*, k.item, k.crumbtrail, k.supplier,
      (SELECT id FROM kanban_bin_cards b WHERE b.card_id = c.card_id AND b.kind='red' AND b.retired=0 ORDER BY id DESC LIMIT 1) AS redCardId,
      (SELECT token FROM kanban_bin_cards b WHERE b.card_id = c.card_id AND b.kind='red' AND b.retired=0 ORDER BY id DESC LIMIT 1) AS redToken
    FROM kanban_bin_config c JOIN kanban_cards k ON k.id = c.card_id ${where} ORDER BY k.item`, cardId ? [cardId] : []);
}

/** One lane row (config + card) or NOT_FOUND. */
async function laneRow(env, cardId) {
  const row = (await laneRows(env, cardId))[0];
  if (!row) throw createError('NOT_FOUND', 'no bin lane for this card');
  return row;
}

/**
 * Bags consumed for a card in (after, until]. Card 99 (10 lb) reads production's
 * inventory_adjustments. Its timestamps are ISO in both sources (barn scans via
 * toISOString, Shopify Flow rows pass ISO through), so the string comparison is sound.
 */
async function usageSum(env, cardId, after, until = null) {
  if (cardId === TEN_LB_CARD) {
    // One row per barn bag scan: logBag (production/bag-tracking.js) always writes
    // sku MANUAL-10LB-BAG. The shopify_flow rows are echoes of the resulting
    // inventory change, not bags; counting both would double count.
    const r = await queryOne(env.DB, `SELECT COUNT(*) AS n FROM inventory_adjustments
      WHERE size = '10lb' AND sku = ? AND timestamp > ? ${until ? 'AND timestamp <= ?' : ''}`,
      until ? [TEN_LB_SCAN_SKU, after, until] : [TEN_LB_SCAN_SKU, after]);
    return Number(r?.n || 0);
  }
  const r = await queryOne(env.DB, `SELECT COALESCE(SUM(qty),0) AS n FROM kanban_usage
    WHERE card_id = ? AND source NOT LIKE '%unmapped' AND at > ? ${until ? 'AND at <= ?' : ''}`, until ? [cardId, after, until] : [cardId, after]);
  return Number(r?.n || 0);
}

/**
 * Lane status for one laneRows() row. `leftoverBins` (a physical count of sealed
 * bins at the row's current bin size) feeds laneStatus's recount check.
 */
async function computeLane(env, row, today = new Date(), leftoverBins = null) {
  const cardId = row.card_id;
  const since56 = new Date(today.getTime() - 56 * DAY).toISOString();
  const win = seasonWindow(today, row.lead_days, row.safety_days);
  // Ledger age counts live orders only (source 'shopify'), while usageSum also
  // counts seed rows ('shopify:seed') as usage: seeded history is real demand,
  // but it must not make a two-day-old ledger look like 14 days of data.
  const [firstSql, firstArgs] = cardId === TEN_LB_CARD
    ? [`SELECT MIN(timestamp) AS t FROM inventory_adjustments WHERE size = '10lb' AND sku = ?`, [TEN_LB_SCAN_SKU]]
    : [`SELECT MIN(at) AS t FROM kanban_usage WHERE card_id = ? AND source = 'shopify'`, [cardId]];
  const [baseline, first, seasonRaw, usage56, openReq] = await Promise.all([
    queryOne(env.DB, 'SELECT bags, at, reason FROM kanban_baselines WHERE card_id = ? ORDER BY at DESC, id DESC LIMIT 1', [cardId]),
    queryOne(env.DB, firstSql, firstArgs),
    usageSum(env, cardId, win.from, win.to),
    usageSum(env, cardId, since56),
    queryOne(env.DB, `SELECT id, requested_at AS requestedAt, notify_state AS notifyState FROM kanban_reorder_requests WHERE card_id = ? AND status='open'`, [cardId]),
  ]);
  const [red, usageSince] = baseline ? await Promise.all([
    queryOne(env.DB, `SELECT id FROM kanban_bin_events WHERE card_id = ? AND kind='red' AND at > ? LIMIT 1`, [cardId, baseline.at]),
    usageSum(env, cardId, baseline.at),
  ]) : [null, 0];
  const usageDays = first?.t ? Math.floor((today - new Date(first.t)) / DAY) : 0;
  const s = laneStatus({
    per: row.bags_per_bin, lead: row.lead_days, safety: row.safety_days, moq: row.moq, seedPerMonth: row.seed_per_month, planPerMonth: row.plan_per_month,
    baseline: baseline ? { bags: baseline.bags, at: baseline.at } : null,
    usageSince, usage56, usageDays,
    seasonUsage: seasonRaw > 0 ? seasonRaw : null,
    redScanned: !!red, leftoverBins, today,
  });
  return { cardId, item: row.item, crumbtrail: row.crumbtrail, colour: row.colour,
    config: { bagsPerBox: row.bags_per_box, bagsPerBin: row.bags_per_bin, leadDays: row.lead_days, safetyDays: row.safety_days, moq: row.moq, seedPerMonth: row.seed_per_month, planPerMonth: row.plan_per_month || 0 },
    baseline: baseline || null, redCard: row.redToken ? { id: row.redCardId, token: row.redToken } : null, openRequest: openReq || null, ...s };
}

/** GET ?action=getBinStatus[&cardId=] → { lanes:[…], unmapped:[{variant_id, qty, lastSeen}] } */
async function getBinStatus(request, env) {
  const { cardId } = getQueryParams(request);
  const rows = await laneRows(env, cardId ? cardIdOf(cardId) : null); // empty = all lanes
  const [lanes, unmapped] = await Promise.all([Promise.all(rows.map(r => computeLane(env, r))), recentUnmapped(env)]);
  return successResponse({ success: true, lanes, unmapped });
}

/**
 * POST ?action=receiveBins {cardId, leftoverBins, boxes, bagsPerBox?, bagsPerBin?, lot?, by?}
 *
 * New baseline = leftover sealed bins at the lane's CURRENT bin size + boxes × bagsPerBox.
 * A bagsPerBin override is how the incoming boxes are split; it is stored as the
 * lane's bin size for next time but does not re-value the leftovers.
 * needsRecount: the leftover count disagrees with the ledger estimate by more than a bin
 * (never on a lane with no baseline — there is no estimate yet).
 */
async function receiveBins(body, env) {
  const cardId = cardIdOf(body.cardId);
  const boxes = countOf(body.boxes, 0), leftover = countOf(body.leftoverBins, 0);
  if (!Number.isInteger(boxes) || boxes < 0 || !Number.isInteger(leftover) || leftover < 0) {
    throw createError('VALIDATION_ERROR', 'boxes/leftoverBins must be whole numbers ≥ 0');
  }
  // Overrides go through the same rules as setBinConfig (bags_per_bin is a divisor).
  const override = validateBinConfig({ bagsPerBox: body.bagsPerBox, bagsPerBin: body.bagsPerBin });
  if (override.error && override.error !== 'nothing to set') throw createError('VALIDATION_ERROR', override.error);
  const row = await laneRow(env, cardId);
  const oldPer = row.bags_per_bin;
  const perBox = override.data?.bags_per_box ?? row.bags_per_box, per = override.data?.bags_per_bin ?? oldPer;
  const before = await computeLane(env, row, new Date(), leftover);
  const needsRecount = before.recount;
  const bags = leftover * oldPer + boxes * perBox;
  const bins = leftover + Math.ceil((boxes * perBox) / per);
  const at = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO kanban_bin_events (card_id, kind, bins, bag_count, lot, by, note, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(cardId, 'receive', bins, per, shortText(body.lot), shortText(body.by), `leftover ${leftover} bins × ${oldPer} + ${boxes} boxes × ${perBox}`, at),
    env.DB.prepare('INSERT INTO kanban_baselines (card_id, bags, at, reason) VALUES (?, ?, ?, ?)').bind(cardId, bags, at, 'receive'),
    env.DB.prepare('UPDATE kanban_bin_config SET bags_per_box = ?, bags_per_bin = ?, updated_at = ? WHERE card_id = ?').bind(perBox, per, at, cardId),
    // An open request this delivery answers: log the order first (only if one is
    // open — the insert reads it before the UPDATE below closes it), so an order
    // Damon never confirmed by link still shows in history. qty = bags received.
    env.DB.prepare(`INSERT INTO kanban_orders (vendor, placed_by, items_json)
      SELECT ?, 'receive', ? WHERE ? > 0 AND EXISTS (SELECT 1 FROM kanban_reorder_requests WHERE card_id = ? AND status = 'open')`)
      .bind(row.supplier || 'Grove', JSON.stringify([{ cardId, item: row.item, qty: boxes * perBox }]), boxes * perBox, cardId),
    env.DB.prepare(`UPDATE kanban_reorder_requests SET status='ordered', closed_at=?, closed_by='receive' WHERE card_id = ? AND status='open'`).bind(at, cardId),
  ]);
  const lane = await computeLane(env, await laneRow(env, cardId));
  return successResponse({ success: true, lane, needsRecount, estimateBefore: before.onHand });
}

/** POST ?action=recount {cardId, sealedBins, by?} — physical count resets the baseline. */
async function recount(body, env) {
  const cardId = cardIdOf(body.cardId);
  const sealedBins = countOf(body.sealedBins);
  if (!Number.isInteger(sealedBins) || sealedBins < 0) throw createError('VALIDATION_ERROR', 'sealedBins must be a whole number ≥ 0');
  const row = await laneRow(env, cardId);
  const per = row.bags_per_bin, bags = sealedBins * per;
  const at = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO kanban_bin_events (card_id, kind, bins, bag_count, by, at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(cardId, 'recount', sealedBins, per, shortText(body.by), at),
    env.DB.prepare('INSERT INTO kanban_baselines (card_id, bags, at, reason) VALUES (?, ?, ?, ?)').bind(cardId, bags, at, 'recount'),
  ]);
  const lane = await computeLane(env, row);
  return successResponse({ success: true, lane });
}

/** POST ?action=setBinConfig {cardId, bagsPerBox?, bagsPerBin?, leadDays?, safetyDays?, moq?, seedPerMonth?, planPerMonth?, colour?} — atomic upsert. planPerMonth > 0 makes the lane plan on that use instead of the ledger (Koa 2026-10-20). */
async function setBinConfig(body, env) {
  const cardId = cardIdOf(body.cardId);
  const { data, error } = validateBinConfig(body);
  if (error) throw createError('VALIDATION_ERROR', error);
  const card = await queryOne(env.DB, 'SELECT id FROM kanban_cards WHERE id = ?', [cardId]);
  if (!card) throw createError('NOT_FOUND', 'card not found');
  const at = new Date().toISOString();
  // A new row needs seed_per_month (NOT NULL); an existing row keeps every column not given.
  // Column names come from validateBinConfig's fixed map, never from the body.
  const ins = { seed_per_month: 0, ...data, card_id: cardId, updated_at: at };
  const keys = Object.keys(ins);
  const sets = [...Object.keys(data), 'updated_at'].map(c => `${c} = excluded.${c}`).join(', ');
  await execute(env.DB, `INSERT INTO kanban_bin_config (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})
    ON CONFLICT(card_id) DO UPDATE SET ${sets}`, keys.map(k => ins[k]));
  const lane = await computeLane(env, await laneRow(env, cardId));
  return successResponse({ success: true, lane });
}

// ── Grove bins: red ORDER card (design §6, §7) ──────────────────────────────

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
/** 10 chars of base32 (50 bits) — what the red card's QR carries. */
function newToken() {
  const a = crypto.getRandomValues(new Uint8Array(10));
  return [...a].map(b => B32[b & 31]).join('');
}

/** POST ?action=makeLaneKit {cardId} — (re)creates the lane's red card; retires any previous one. */
async function makeLaneKit(body, env) {
  const cardId = cardIdOf(body.cardId);
  const card = await queryOne(env.DB, 'SELECT id, item, supplier, crumbtrail FROM kanban_cards WHERE id = ?', [cardId]);
  if (!card) throw createError('NOT_FOUND', 'card not found');
  const cfg = await queryOne(env.DB, 'SELECT card_id FROM kanban_bin_config WHERE card_id = ?', [cardId]);
  if (!cfg) throw createError('NOT_FOUND', 'no bin config for this card');
  const token = newToken(), at = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE kanban_bin_cards SET retired = 1 WHERE card_id = ? AND kind='red' AND retired = 0`).bind(cardId),
    env.DB.prepare('INSERT INTO kanban_bin_cards (card_id, kind, token, created_at) VALUES (?, ?, ?, ?)').bind(cardId, 'red', token, at),
  ]);
  const base = env.PUBLIC_API_BASE || 'https://rogue-origin-api.roguefamilyfarms.workers.dev';
  const lane = await computeLane(env, await laneRow(env, cardId));
  return successResponse({ success: true, redCard: { token, url: `${base}/k/${token}` }, card, lane });
}

/** POST ?action=scanCard {token, by?} — the red ORDER card. Logs a 'red' event and raises (or re-sends) the Damon request. */
async function scanCard(body, env, ctx) {
  const token = String(body.token || '').trim().toLowerCase();
  if (!/^[a-z2-7]{10}$/.test(token)) throw createError('NOT_FOUND', 'Card not recognised');
  const bc = await queryOne(env.DB, 'SELECT id, card_id, kind, retired FROM kanban_bin_cards WHERE token = ?', [token]);
  if (!bc) throw createError('NOT_FOUND', 'Card not recognised');
  if (bc.retired) throw createError('VALIDATION_ERROR', 'This card was replaced — use the new one');
  if (bc.kind !== 'red') throw createError('VALIDATION_ERROR', 'Per-bin cards are not in use yet');
  const card = await queryOne(env.DB, 'SELECT * FROM kanban_cards WHERE id = ?', [bc.card_id]);
  if (!card) throw createError('NOT_FOUND', 'card not found');
  // Request first, red event second: if raising the request throws, no 'red'
  // event is left behind to flip the lane to 'order' with nobody told. (Not a
  // transaction — a failure between the two leaves an open request without the
  // event, which the next scan repairs; the reverse would be a silent dead end.)
  // The email's lane is read before the red event exists (only status depends on it);
  // the response's lane is read after, so it shows 'order'.
  const emailLane = await computeLane(env, await laneRow(env, bc.card_id));
  const { request } = await raiseReorderRequest(card, env, ctx, emailLane);
  // Raw insert: kanban_bin_events is not in db.js VALID_TABLES, and `at` is set explicitly (ISO).
  await env.DB.prepare('INSERT INTO kanban_bin_events (card_id, kind, bin_card, by, at) VALUES (?, ?, ?, ?, ?)')
    .bind(bc.card_id, 'red', bc.id, shortText(body.by), new Date().toISOString()).run();
  const lane = await computeLane(env, await laneRow(env, bc.card_id));
  return successResponse({ success: true, lane, request });
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
    // Grove bins — design doc 2026-10-14
    orderUsage: () => orderUsage(body, request, env, ctx),
    getRecipes: () => getRecipes(env),
    setRecipe: () => setRecipe(body, env),
    getBinStatus: () => getBinStatus(request, env),
    receiveBins: () => receiveBins(body, env),
    recount: () => recount(body, env),
    setBinConfig: () => setBinConfig(body, env),
    makeLaneKit: () => makeLaneKit(body, env),
    scanCard: () => scanCard(body, env, ctx),
  };

  if (!action || !actions[action]) {
    throw createError('VALIDATION_ERROR', `Unknown action: ${action}`);
  }

  return actions[action]();
}
