/**
 * /api/orders — auth endpoint only.
 *
 * The wholesale-orders app and the Scoreboard's order-queue panel were both
 * retired. What survives is the password check, because Consignment posts to
 * /api/orders?action=validatePassword to unlock its page. The route name is
 * kept for that reason alone — it is not an orders API any more.
 *
 * The `orders` and `shipments` tables are intentionally left in place; a
 * replacement order queue is being built and may want the existing data.
 */

import { successResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { createError } from '../lib/errors.js';
import { validatePassword as authValidatePassword } from '../lib/auth.js';

async function validatePassword(params, body, env) {
  // Password comes from the POST body (text/plain) so it never rides in the URL,
  // logs, or browser history. params.password is a transitional fallback for
  // stale service-worker-cached clients still doing the old GET login.
  const password = body.password || params.password || '';

  // Constant-time comparison lives in lib/auth.js
  authValidatePassword(password, env, 'orders-validatePassword');

  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const sessionToken = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return successResponse({ success: true, sessionToken, expiresIn: 30 * 24 * 60 * 60 * 1000 });
}

export async function handleOrdersD1(request, env) {
  const action = getAction(request);
  const params = getQueryParams(request);
  const body = request.method === 'POST' ? await parseBody(request) : {};

  const actions = {
    validatePassword: () => validatePassword(params, body, env),
    test: () => successResponse({ ok: true, message: 'Orders auth endpoint is working' }),
  };

  if (!action || !actions[action]) {
    throw createError('VALIDATION_ERROR', `Unknown action: ${action}`);
  }

  return actions[action]();
}
