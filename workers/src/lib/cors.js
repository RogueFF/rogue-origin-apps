/**
 * CORS utilities for Cloudflare Workers
 */

/**
 * Get CORS headers
 * @param {object} env - Environment variables
 * @returns {object} Headers object
 */
export function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
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
    headers: corsHeaders(env),
  });
}
