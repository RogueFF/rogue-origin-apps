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
import { handleMediaR2 } from './handlers/media-r2.js';
import { corsHeaders, handleCors } from './lib/cors.js';
import { jsonResponse, errorResponse } from './lib/response.js';
import { ApiError } from './lib/errors.js';

export default {
  // Cron Trigger — runs daily at 6 AM PST (14:00 UTC)
  async scheduled(event, env, ctx) {
    const { handleComplaintsD1 } = await import('./handlers/complaints-d1.js');
    const db = env.DB;
    try {
      // Build a fake request for the sync handler
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
          endpoints: ['/api/production', '/api/orders', '/api/barcode', '/api/kanban', '/api/sop', '/api/consignment', '/api/complaints', '/api/pool', '/api/media']
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
