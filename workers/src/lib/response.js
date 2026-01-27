/**
 * Response utilities for Cloudflare Workers
 */

/**
 * Create a JSON response
 * @param {any} data - Data to return
 * @param {number} status - HTTP status code
 * @returns {Response}
 */
export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}

/**
 * Create a success response
 * @param {any} data - Data to return (should already include success: true if needed)
 * @param {number} status - HTTP status code
 * @returns {Response}
 */
export function successResponse(data, status = 200) {
  // Return data directly - handlers already structure their responses
  return jsonResponse(data, status);
}

/**
 * Create an error response
 * @param {string} message - Error message
 * @param {string} code - Error code
 * @param {number} status - HTTP status code
 * @param {any} details - Optional additional details
 * @returns {Response}
 */
export function errorResponse(message, code = 'INTERNAL_ERROR', status = 500, details = null) {
  const body = {
    success: false,
    error: message,
    code,
  };

  if (details) {
    body.details = details;
  }

  return jsonResponse(body, status);
}

/**
 * Parse request body (JSON or form data)
 * @param {Request} request
 * @returns {Promise<object>}
 */
export async function parseBody(request) {
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      return await request.json();
    } catch {
      return {};
    }
  }

  if (contentType.includes('text/plain')) {
    try {
      const text = await request.text();
      return JSON.parse(text);
    } catch {
      return {};
    }
  }

  if (contentType.includes('form')) {
    try {
      const formData = await request.formData();
      const obj = {};
      for (const [key, value] of formData.entries()) {
        obj[key] = value;
      }
      return obj;
    } catch {
      return {};
    }
  }

  return {};
}

/**
 * Get action from request (query param or body)
 * @param {Request} request
 * @param {object} body - Parsed body
 * @returns {string|null}
 */
export function getAction(request, body = {}) {
  const url = new URL(request.url);
  return url.searchParams.get('action') || body.action || null;
}

/**
 * Get query parameters as object
 * @param {Request} request
 * @returns {object}
 */
export function getQueryParams(request) {
  const url = new URL(request.url);
  const params = {};
  for (const [key, value] of url.searchParams.entries()) {
    params[key] = value;
  }
  return params;
}
