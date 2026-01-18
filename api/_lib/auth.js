/**
 * Authentication utilities
 *
 * Simple password-based auth matching current Apps Script behavior.
 * Upgrade path: JWT tokens for stateless auth.
 */

const { createError } = require('./errors');

/**
 * Validate password from request
 *
 * @param {string} password - Password from request body or header
 * @param {string} endpoint - Which endpoint is being accessed (for logging)
 * @returns {boolean} true if valid
 * @throws {ApiError} if invalid
 */
function validatePassword(password, endpoint = 'unknown') {
  const expectedPassword = process.env.API_PASSWORD;

  // Critical: fail if password not configured
  if (!expectedPassword) {
    console.error(`[AUTH] API_PASSWORD not configured for ${endpoint}`);
    throw createError('INTERNAL_ERROR', 'Authentication not configured');
  }

  if (!password) {
    throw createError('UNAUTHORIZED', 'Password required');
  }

  // Constant-time comparison to prevent timing attacks
  if (!constantTimeEqual(password, expectedPassword)) {
    // Log failed attempt (but don't log the password!)
    console.warn(`[AUTH] Failed login attempt for ${endpoint}`);
    throw createError('UNAUTHORIZED', 'Invalid password');
  }

  return true;
}

/**
 * Constant-time string comparison
 * Prevents timing attacks by always taking same time regardless of where mismatch occurs
 */
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  // If lengths differ, still do comparison to maintain constant time
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
 * Checks body.password, query.password, and Authorization header
 */
function extractPassword(req) {
  // Body (preferred for POST)
  if (req.body?.password) {
    return req.body.password;
  }

  // Query param (for GET, less secure)
  if (req.query?.password) {
    return req.query.password;
  }

  // Authorization header: "Bearer <password>" or just "<password>"
  const authHeader = req.headers?.authorization;
  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return authHeader;
  }

  return null;
}

/**
 * Middleware to require authentication
 */
function requireAuth(handler) {
  return async (req, res) => {
    const password = extractPassword(req);
    validatePassword(password, req.url);
    return handler(req, res);
  };
}

/**
 * Check if request is authenticated (non-throwing)
 */
function isAuthenticated(req) {
  try {
    const password = extractPassword(req);
    return validatePassword(password);
  } catch (_e) {
    return false;
  }
}

module.exports = {
  validatePassword,
  extractPassword,
  requireAuth,
  isAuthenticated,
  constantTimeEqual,
};
