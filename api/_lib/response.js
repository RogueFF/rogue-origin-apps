/**
 * Standardized response utilities
 *
 * All API responses follow a consistent format:
 * Success: { success: true, data: ... }
 * Error: { success: false, error: "message", code: "ERROR_CODE" }
 */

/**
 * Send a success response
 *
 * @param {object} res - Vercel response object
 * @param {any} data - Data to return
 * @param {number} status - HTTP status code (default 200)
 */
function success(res, data, status = 200) {
  res.status(status).json({
    success: true,
    data,
  });
}

/**
 * Send an error response
 *
 * @param {object} res - Vercel response object
 * @param {string} message - Error message
 * @param {string} code - Error code
 * @param {number} status - HTTP status code
 * @param {any} details - Optional additional details
 */
function error(res, message, code = 'INTERNAL_ERROR', status = 500, details = null) {
  const response = {
    success: false,
    error: message,
    code,
  };

  if (details) {
    response.details = details;
  }

  res.status(status).json(response);
}

/**
 * Parse request body
 * Handles both JSON and text/plain content types (for CORS)
 *
 * @param {object} req - Vercel request object
 * @returns {object} Parsed body
 */
function parseBody(req) {
  if (!req.body) {
    return {};
  }

  // Already parsed by Vercel
  if (typeof req.body === 'object') {
    return req.body;
  }

  // Text/plain - parse as JSON
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (_e) {
      return {};
    }
  }

  return {};
}

/**
 * Get action from request (query or body)
 *
 * @param {object} req - Vercel request object
 * @returns {string | undefined} Action name
 */
function getAction(req) {
  return req.query?.action || parseBody(req).action;
}

/**
 * Set CORS headers for cross-origin requests
 *
 * @param {object} res - Vercel response object
 * @param {string[]} allowedOrigins - Allowed origins (default: your domains)
 */
function setCorsHeaders(res, allowedOrigins = null) {
  const origins = allowedOrigins || [
    'https://rogueff.github.io',
    'http://localhost:3000',
    'http://localhost:5500', // VS Code Live Server
  ];

  // Note: In production, check req.headers.origin against allowedOrigins
  // For simplicity, allowing all for now
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
}

/**
 * Handle OPTIONS preflight request
 *
 * @param {object} req - Vercel request object
 * @param {object} res - Vercel response object
 * @returns {boolean} True if request was handled (was OPTIONS)
 */
function handlePreflight(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.status(204).end();
    return true;
  }
  return false;
}

/**
 * Create a standard handler with CORS and error handling
 *
 * @param {object} actions - Map of action name to handler function
 * @returns {function} Vercel handler function
 */
function createHandler(actions) {
  return async (req, res) => {
    // CORS
    setCorsHeaders(res);
    if (handlePreflight(req, res)) {
      return;
    }

    try {
      const action = getAction(req);

      if (!action) {
        return error(res, 'Missing action parameter', 'VALIDATION_ERROR', 400);
      }

      const handler = actions[action];

      if (!handler) {
        return error(res, `Unknown action: ${action}`, 'NOT_FOUND', 404);
      }

      // Parse body for handlers
      const body = parseBody(req);

      await handler(req, res, body);
    } catch (err) {
      // Use error module for consistent error handling
      const { formatErrorResponse, getErrorStatus } = require('./errors');
      const status = getErrorStatus(err);
      const response = formatErrorResponse(err);
      res.status(status).json(response);
    }
  };
}

module.exports = {
  success,
  error,
  parseBody,
  getAction,
  setCorsHeaders,
  handlePreflight,
  createHandler,
};
