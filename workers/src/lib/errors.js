/**
 * Error handling utilities for Cloudflare Workers
 */

/**
 * Custom API Error class
 */
export class ApiError extends Error {
  constructor(message, code, statusCode, details = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * Error codes mapping
 */
export const ErrorCodes = {
  UNAUTHORIZED: { code: 'UNAUTHORIZED', status: 401 },
  VALIDATION_ERROR: { code: 'VALIDATION_ERROR', status: 400 },
  NOT_FOUND: { code: 'NOT_FOUND', status: 404 },
  SHEETS_ERROR: { code: 'SHEETS_ERROR', status: 502 },
  RATE_LIMITED: { code: 'RATE_LIMITED', status: 429 },
  INTERNAL_ERROR: { code: 'INTERNAL_ERROR', status: 500 },
};

/**
 * Create a standardized error
 * @param {string} type - Error type from ErrorCodes
 * @param {string} message - Error message
 * @param {any} details - Optional details
 * @returns {ApiError}
 */
export function createError(type, message, details = null) {
  const errorType = ErrorCodes[type] || ErrorCodes.INTERNAL_ERROR;
  return new ApiError(message, errorType.code, errorType.status, details);
}

/**
 * Format error for response
 * @param {Error} error
 * @returns {{message: string, code: string, status: number, details?: any}}
 */
export function formatError(error) {
  if (error instanceof ApiError) {
    return {
      message: error.message,
      code: error.code,
      status: error.statusCode,
      details: error.details,
    };
  }

  // Unknown error - don't leak internals
  console.error('Unhandled error:', error);
  return {
    message: 'An unexpected error occurred',
    code: 'INTERNAL_ERROR',
    status: 500,
  };
}
