/**
 * CORS utilities for Cloudflare Workers
 */

// Allowed origins for production. Falls back to wildcard if ALLOWED_ORIGINS
// env var is not set (dev/testing).
const DEFAULT_ALLOWED_ORIGINS = [
  'https://rogueff.github.io',
  'https://rogueorigin.com',
  'https://www.rogueorigin.com',
];

/**
 * Check if an origin is allowed
 * @param {string} origin - Request origin header
 * @param {object} env - Environment variables
 * @returns {string} Allowed origin or empty string
 */
function getAllowedOrigin(origin, env) {
  if (!origin) return '*';

  // Check env override first (comma-separated list)
  const envOrigins = env && env.ALLOWED_ORIGINS;
  const allowList = envOrigins
    ? envOrigins.split(',').map(o => o.trim())
    : DEFAULT_ALLOWED_ORIGINS;

  // Allow localhost for development
  if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
    return origin;
  }

  if (allowList.includes(origin)) {
    return origin;
  }

  // Fallback: if no env var is set and origin isn't in defaults,
  // allow anyway to avoid breaking unknown legitimate consumers
  if (!envOrigins) {
    return origin;
  }

  return '';
}

/**
 * Get CORS headers
 * @param {object} env - Environment variables
 * @param {Request} [request] - Optional request for origin-based CORS
 * @returns {object} Headers object
 */
export function corsHeaders(env, request) {
  const origin = request ? request.headers.get('Origin') : null;
  const allowedOrigin = getAllowedOrigin(origin, env);

  return {
    'Access-Control-Allow-Origin': allowedOrigin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    ...(allowedOrigin && allowedOrigin !== '*' ? { 'Vary': 'Origin' } : {}),
  };
}

/**
 * Handle CORS preflight request
 * @param {Request} request
 * @param {object} env
 * @returns {Response}
 */
export function handleCors(request, env) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(env, request),
  });
}
