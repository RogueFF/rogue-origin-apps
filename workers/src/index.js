/**
 * Rogue Origin API - Cloudflare Workers
 *
 * Routes:
 * - /api/production - Production tracking (D1)
 * - /api/orders - Wholesale orders (D1)
 * - /api/barcode - Barcode/label management (D1)
 * - /api/kanban - Kanban board (D1)
 * - /api/sop - Standard operating procedures (D1)
 * - /api/consignment - Consignment inventory tracking (D1)
 * - /api/complaints - Customer complaints tracking (D1)
 * - /api/pool-bins - Pool bin inventory (D1)
 * - /api/pool - Shopify pool inventory proxy
 * - /api/media - Media upload/serve (R2)
 */

import { handleProductionD1 } from './handlers/production-d1.js';
import { handleOrdersD1 } from './handlers/orders-d1.js';
import { handleBarcodeD1 } from './handlers/barcode-d1.js';
import { handleKanbanD1 } from './handlers/kanban-d1.js';
import { handleSopD1 } from './handlers/sop-d1.js';
import { handleConsignmentD1 } from './handlers/consignment-d1.js';
import { handleComplaintsD1 } from './handlers/complaints-d1.js';
import { handlePoolD1 } from './handlers/pool-d1.js';
import { handlePoolRequest } from './handlers/pool.js';
import { handleSupersackD1 } from './handlers/supersack-d1.js';
import { handleMediaR2 } from './handlers/media-r2.js';
import { handleTpmD1 } from './handlers/tpm-d1.js';
import { handleTrackingD1 } from './handlers/tracking/index.js';
import { corsHeaders, handleCors } from './lib/cors.js';
import { jsonResponse, errorResponse } from './lib/response.js';
import { ApiError } from './lib/errors.js';

export default {
  // Cron Triggers — multiple cron patterns dispatched by inspecting event.cron.
  // Match on day-of-week field (5th cron token) so we don't break if Cloudflare
  // ever normalizes whitespace differently than the wrangler.toml literal.
  async scheduled(event, env, ctx) {
    const cronPattern = (event.cron || '').trim();
    const tokens = cronPattern.split(/\s+/);
    const dow = tokens[4]; // day-of-week field, '*' for daily, '1' for Monday, '5' for Friday
    const isFridayCron = dow === '5';
    const isMondayCron = dow === '1';
    const isDailyCron = dow === '*';

    // Daily 6 AM PT: complaints sync + weather pull
    if (isDailyCron) {
      const { handleComplaintsD1 } = await import('./handlers/complaints-d1.js');
      try {
        const request = new Request('https://internal/api/complaints?action=sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const result = await handleComplaintsD1(request, env, ctx);
        const data = await result.json();
        console.log(`[Cron] Complaints sync: imported=${data.imported}, skipped=${data.skipped}`);
      } catch (e) {
        console.error(`[Cron] Complaints sync failed: ${e.message}`);
      }

      try {
        const { pullDailyWeather } = await import('./handlers/tracking/weather.js');
        await pullDailyWeather(env);
        console.log('[Cron] Weather data pulled');
      } catch (e) {
        console.error(`[Cron] Weather pull failed: ${e.message}`);
      }
    }

    // Friday 9 AM PT: Friday cart reminder via Telegram
    if (isFridayCron) {
      try {
        await sendFridayCartReminder(env);
      } catch (e) {
        console.error(`[Cron] Friday cart reminder failed: ${e.message}`);
      }
    }

    // Monday 6 AM PT: supersack data-quality check (TG ping only if anomalies)
    if (isMondayCron) {
      try {
        await sendSupersackQAAlert(env);
      } catch (e) {
        console.error(`[Cron] Supersack QA check failed: ${e.message}`);
      }
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCors(request, env);
    }

    try {
      // Route to appropriate handler
      let response;

      if (path.startsWith('/api/production')) {
        response = await handleProductionD1(request, env, ctx);
      } else if (path.startsWith('/api/orders')) {
        response = await handleOrdersD1(request, env, ctx);
      } else if (path.startsWith('/api/barcode')) {
        response = await handleBarcodeD1(request, env, ctx);
      } else if (path.startsWith('/api/kanban')) {
        response = await handleKanbanD1(request, env, ctx);
      } else if (path.startsWith('/api/sop')) {
        response = await handleSopD1(request, env, ctx);
      } else if (path.startsWith('/api/complaints')) {
        response = await handleComplaintsD1(request, env, ctx);
      } else if (path.startsWith('/api/consignment')) {
        response = await handleConsignmentD1(request, env, ctx);
      } else if (path.startsWith('/api/media')) {
        response = await handleMediaR2(request, env);
      } else if (path.startsWith('/api/supersack-qa')) {
        const { handleSupersackQA } = await import('./handlers/supersack-qa.js');
        response = await handleSupersackQA(request, env, ctx);
      } else if (path.startsWith('/api/supersack')) {
        response = await handleSupersackD1(request, env, ctx);
      } else if (path.startsWith('/api/tpm')) {
        response = await handleTpmD1(request, env, ctx);
      } else if (path.startsWith('/api/tracking')) {
        response = await handleTrackingD1(request, env, ctx);
      } else if (path.startsWith('/api/pool-bins')) {
        response = await handlePoolD1(request, env, ctx);
      } else if (path.startsWith('/api/pool')) {
        // Shopify pool inventory proxy
        response = await handlePoolRequest(request, env);
      } else if (path === '/' || path === '/api') {
        // Health check
        response = jsonResponse({
          success: true,
          message: 'Rogue Origin API - Cloudflare Workers',
          version: '1.0.0',
          endpoints: ['/api/production', '/api/orders', '/api/barcode', '/api/kanban', '/api/sop', '/api/consignment', '/api/complaints', '/api/supersack', '/api/pool', '/api/media', '/api/tpm', '/api/tracking']
        });
      } else {
        response = errorResponse('Not found', 'NOT_FOUND', 404);
      }

      // Add CORS headers to response
      const headers = new Headers(response.headers);
      Object.entries(corsHeaders(env, request)).forEach(([key, value]) => {
        headers.set(key, value);
      });

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });

    } catch (error) {
      console.error('Unhandled error:', error);

      // Handle ApiError instances
      let response;
      if (error instanceof ApiError) {
        response = errorResponse(error.message, error.code, error.statusCode, error.details);
      } else {
        response = errorResponse(
          error.message || 'Internal server error',
          'INTERNAL_ERROR',
          500
        );
      }

      // Add CORS headers
      const headers = new Headers(response.headers);
      Object.entries(corsHeaders(env, request)).forEach(([key, value]) => {
        headers.set(key, value);
      });

      return new Response(response.body, {
        status: response.status,
        headers
      });
    }
  }
};

/**
 * Friday cart reminder — queries the kanban_cart, formats a Markdown summary,
 * and posts to Telegram if TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID secrets are set.
 * If the secrets aren't configured yet, falls back to console.log so the cron
 * doesn't error and we still see what would have been sent.
 */
async function sendFridayCartReminder(env) {
  const rows = await env.DB.prepare(`
    SELECT c.qty, c.note, k.item, k.supplier
    FROM kanban_cart c JOIN kanban_cards k ON k.id = c.card_id
    ORDER BY k.supplier, k.item
  `).all().then(r => r.results || []);

  let body;
  if (rows.length === 0) {
    body = '*Friday Cart — empty* ✅\n\nNothing to reorder this week.';
  } else {
    const byVendor = {};
    for (const r of rows) {
      const v = r.supplier || '(Unspecified)';
      if (!byVendor[v]) byVendor[v] = [];
      byVendor[v].push(r);
    }
    const lines = [`*Friday Cart — ${rows.length} item${rows.length === 1 ? '' : 's'} pending*`, ''];
    for (const vendor of Object.keys(byVendor).sort()) {
      lines.push(`*${vendor}* (${byVendor[vendor].length})`);
      for (const r of byVendor[vendor]) {
        lines.push(`• ${r.qty}× ${r.item}`);
      }
      lines.push('');
    }
    lines.push('Open: https://rogueff.github.io/rogue-origin-apps/src/pages/kanban.html');
    body = lines.join('\n');
  }

  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log('[Cron][Friday cart] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set — message would be:\n' + body);
    return;
  }

  const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: body,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });
  if (!tgRes.ok) {
    const err = await tgRes.text();
    throw new Error(`Telegram API error ${tgRes.status}: ${err.slice(0, 200)}`);
  }
  console.log(`[Cron][Friday cart] Sent reminder (${rows.length} items)`);
}

/**
 * Supersack data-quality check — pings Telegram only when the last 7 days
 * contain rows that are silently excluded from analytics (missing one weight,
 * or over-attributed multi-strain rows above 1.3× raw). Silent when clean.
 */
async function sendSupersackQAAlert(env) {
  const { runSupersackQACheck } = await import('./handlers/supersack-qa.js');
  const report = await runSupersackQACheck(env);

  if (!report.hasAnomalies) {
    console.log('[Cron][Supersack QA] No anomalies in last 7 days — silent');
    return;
  }

  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log('[Cron][Supersack QA] TELEGRAM creds not set — message would be:\n' + report.markdown);
    return;
  }

  const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: report.markdown,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });
  if (!tgRes.ok) {
    const err = await tgRes.text();
    throw new Error(`Telegram API error ${tgRes.status}: ${err.slice(0, 200)}`);
  }
  console.log(`[Cron][Supersack QA] Alerted: ${report.counts.missingWeights} missing weights, ${report.counts.overAttributed} over-attributed`);
}
