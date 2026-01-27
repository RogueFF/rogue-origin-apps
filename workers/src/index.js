/**
 * Rogue Origin API - Cloudflare Workers
 *
 * Routes:
 * - /api/production - Production tracking
 * - /api/orders - Wholesale orders
 * - /api/barcode - Barcode/label management
 * - /api/kanban - Kanban board
 * - /api/sop - Standard operating procedures
 * - /api/pool - Pool inventory proxy
 */

import { handleProduction } from './handlers/production.js';
import { handleProductionD1 } from './handlers/production-d1.js';
import { handleOrders } from './handlers/orders.js';
import { handleOrdersD1 } from './handlers/orders-d1.js';
import { handleBarcode } from './handlers/barcode.js';
import { handleBarcodeD1 } from './handlers/barcode-d1.js';
import { handleKanban } from './handlers/kanban.js';
import { handleKanbanD1 } from './handlers/kanban-d1.js';
import { handleSop } from './handlers/sop.js';
import { handleSopD1 } from './handlers/sop-d1.js';
import { handlePoolRequest } from './handlers/pool.js';
import { corsHeaders, handleCors } from './lib/cors.js';
import { jsonResponse, errorResponse } from './lib/response.js';
import { ApiError } from './lib/errors.js';

// Feature flags for D1 migration (set to true to use D1 instead of Google Sheets)
const USE_D1_BARCODE = true;
const USE_D1_KANBAN = true;
const USE_D1_SOP = true;
const USE_D1_ORDERS = true;
const USE_D1_PRODUCTION = false; // Disabled - use Google Sheets for hourly entry writes

export default {
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
        response = USE_D1_PRODUCTION
          ? await handleProductionD1(request, env, ctx)
          : await handleProduction(request, env, ctx);
      } else if (path.startsWith('/api/orders')) {
        response = USE_D1_ORDERS
          ? await handleOrdersD1(request, env, ctx)
          : await handleOrders(request, env, ctx);
      } else if (path.startsWith('/api/barcode')) {
        response = USE_D1_BARCODE
          ? await handleBarcodeD1(request, env, ctx)
          : await handleBarcode(request, env, ctx);
      } else if (path.startsWith('/api/kanban')) {
        response = USE_D1_KANBAN
          ? await handleKanbanD1(request, env, ctx)
          : await handleKanban(request, env, ctx);
      } else if (path.startsWith('/api/sop')) {
        response = USE_D1_SOP
          ? await handleSopD1(request, env, ctx)
          : await handleSop(request, env, ctx);
      } else if (path.startsWith('/api/pool')) {
        response = await handlePoolRequest(request, env, ctx);
      } else if (path === '/' || path === '/api') {
        // Health check
        response = jsonResponse({
          success: true,
          message: 'Rogue Origin API - Cloudflare Workers',
          version: '1.0.0',
          endpoints: ['/api/production', '/api/orders', '/api/barcode', '/api/kanban', '/api/sop', '/api/pool']
        });
      } else {
        response = errorResponse('Not found', 'NOT_FOUND', 404);
      }

      // Add CORS headers to response
      const headers = new Headers(response.headers);
      Object.entries(corsHeaders(env)).forEach(([key, value]) => {
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
      Object.entries(corsHeaders(env)).forEach(([key, value]) => {
        headers.set(key, value);
      });

      return new Response(response.body, {
        status: response.status,
        headers
      });
    }
  }
};
