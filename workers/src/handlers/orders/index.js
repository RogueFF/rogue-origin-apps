/**
 * Orders — Router/Dispatcher
 *
 * The wholesale-orders UI was retired (see the app-cleanup commit); what remains
 * is the part two live apps still depend on:
 *   - validatePassword        — Consignment uses /api/orders as its auth endpoint
 *   - getScoreboardOrderQueue — the Scoreboard's order-queue panel
 *
 * Modules:
 *   shared.js           — Drive API helpers, date formatting, constants
 *   coa.js              — count5kgBagsForStrain (used by scoreboard-queue)
 *   scoreboard-queue.js — getScoreboardOrderQueue
 */

import { successResponse, parseBody, getAction, getQueryParams } from '../../lib/response.js';
import { createError } from '../../lib/errors.js';
import { validatePassword as authValidatePassword } from '../../lib/auth.js';

import { getScoreboardOrderQueue } from './scoreboard-queue.js';

// ===== AUTHENTICATION =====

async function validatePassword(params, body, env) {
  // Password comes from the POST body (text/plain) so it never rides in the URL,
  // logs, or browser history. params.password is a transitional fallback for
  // stale service-worker-cached clients still doing the old GET login.
  const password = body.password || params.password || '';

  // Use constant-time comparison from auth.js
  authValidatePassword(password, env, 'orders-validatePassword');

  // Generate cryptographically secure session token
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const sessionToken = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return successResponse({ success: true, sessionToken, expiresIn: 30 * 24 * 60 * 60 * 1000 });
}

// ===== TEST =====

async function test() {
  return successResponse({
    ok: true,
    message: 'Orders API is working (Cloudflare D1)',
    timestamp: new Date().toISOString(),
  });
}

// ===== MAIN HANDLER =====

export async function handleOrdersD1(request, env) {
  const action = getAction(request);
  const params = getQueryParams(request);
  const body = request.method === 'POST' ? await parseBody(request) : {};

  // No write actions remain, so there is nothing here to gate behind requireAuth.
  const actions = {
    validatePassword: () => validatePassword(params, body, env),
    getScoreboardOrderQueue: () => getScoreboardOrderQueue(env),
    test: () => test(),
  };

  if (!action || !actions[action]) {
    throw createError('VALIDATION_ERROR', `Unknown action: ${action}`);
  }

  return actions[action]();
}
