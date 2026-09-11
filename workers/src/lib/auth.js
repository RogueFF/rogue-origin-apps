/**
 * Authentication utilities for Cloudflare Workers
 */

import { createError } from './errors.js';

/**
 * Constant-time string comparison (prevents timing attacks)
 */
export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  const maxLen = Math.max(a.length, b.length);
  let result = a.length === b.length ? 0 : 1;

  for (let i = 0; i < maxLen; i++) {
    const charA = a.charCodeAt(i) || 0;
    const charB = b.charCodeAt(i) || 0;
    result |= charA ^ charB;
  }

  return result === 0;
}

/**
 * Extract password from request
 * @param {Request} request
 * @param {object} body - Parsed body
 * @returns {string|null}
 */
export function extractPassword(request, body = {}) {
  // Body (preferred for POST)
  if (body?.password) {
    return body.password;
  }

  // NOTE: query-param passwords (?password=) are intentionally NOT accepted —
  // they leak into access logs, browser history, and Referer headers. Send the
  // password in the POST body or the Authorization header instead.

  // Authorization header
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return authHeader;
  }

  return null;
}

/**
 * Validate password
 * @param {string} password
 * @param {object} env
 * @param {string} endpoint - For logging
 * @returns {boolean}
 */
export function validatePassword(password, env, endpoint = 'unknown') {
  const expectedPassword = env.ORDERS_PASSWORD || env.API_PASSWORD;

  if (!expectedPassword) {
    console.error(`[AUTH] Password not configured for ${endpoint}`);
    throw createError('INTERNAL_ERROR', 'Authentication not configured');
  }

  if (!password) {
    throw createError('UNAUTHORIZED', 'Password required');
  }

  if (!constantTimeEqual(password, expectedPassword)) {
    console.warn(`[AUTH] Failed login attempt for ${endpoint}`);
    throw createError('UNAUTHORIZED', 'Invalid password');
  }

  return true;
}

/**
 * Check if request is authenticated (non-throwing)
 * @param {Request} request
 * @param {object} body
 * @param {object} env
 * @returns {boolean}
 */
export function isAuthenticated(request, body, env) {
  try {
    const password = extractPassword(request, body);
    return validatePassword(password, env);
  } catch {
    return false;
  }
}

/**
 * Require authentication (throws on failure)
 * @param {Request} request
 * @param {object} body
 * @param {object} env
 * @param {string} label - For logging
 */
export function requireAuth(request, body, env, label = 'unknown') {
  const password = extractPassword(request, body);
  validatePassword(password, env, label);
}

/**
 * Require a named shared secret instead of the farm password (throws on
 * failure). For machine callers — the Capataz relay on FERN and the farm-bridge
 * MCP worker hold `HARVEST_SMS_KEY`, which is not the password a human types
 * into the dashboard: a key that leaks off a bot host must not also unlock
 * orders.
 *
 * Same extraction as requireAuth (Authorization: Bearer, or body.password) and
 * the same constant-time compare. An unset secret is a deploy that is not
 * finished, not a caller error — it throws INTERNAL_ERROR, never a silent pass.
 *
 * @param {string} envKey - name of the env var holding the expected secret
 * @param {string} label - For logging
 */
export function requireBearer(request, body, env, envKey, label = 'unknown') {
  const expected = env[envKey];
  if (!expected) {
    console.error(`[AUTH] ${envKey} not configured for ${label}`);
    throw createError('INTERNAL_ERROR', `${envKey} not configured`);
  }
  const given = extractPassword(request, body);
  if (!given) {
    throw createError('UNAUTHORIZED', 'Bearer token required');
  }
  if (!constantTimeEqual(given, expected)) {
    console.warn(`[AUTH] Failed ${envKey} attempt for ${label}`);
    throw createError('UNAUTHORIZED', 'Invalid bearer token');
  }
  return true;
}
