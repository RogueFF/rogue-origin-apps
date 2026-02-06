/**
 * Authentication utilities for Cloudflare Workers
 */

import { createError } from './errors.js';

/**
 * Constant-time string comparison (prevents timing attacks)
 */
function constantTimeEqual(a, b) {
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

  // Query param
  const url = new URL(request.url);
  if (url.searchParams.has('password')) {
    return url.searchParams.get('password');
  }

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
