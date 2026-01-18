/**
 * Standardized error handling for all API endpoints
 *
 * Error Codes:
 * - UNAUTHORIZED: 401 - Missing or invalid authentication
 * - VALIDATION_ERROR: 400 - Invalid input data
 * - NOT_FOUND: 404 - Resource doesn't exist
 * - SHEETS_ERROR: 502 - Google Sheets API failure
 * - RATE_LIMITED: 429 - Too many requests
 * - INTERNAL_ERROR: 500 - Unexpected server error
 */

class ApiError extends Error {
  constructor(message, code, statusCode, details = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

const ErrorCodes = {
  UNAUTHORIZED: { code: 'UNAUTHORIZED', status: 401 },
  VALIDATION_ERROR: { code: 'VALIDATION_ERROR', status: 400 },
  NOT_FOUND: { code: 'NOT_FOUND', status: 404 },
  SHEETS_ERROR: { code: 'SHEETS_ERROR', status: 502 },
  RATE_LIMITED: { code: 'RATE_LIMITED', status: 429 },
  INTERNAL_ERROR: { code: 'INTERNAL_ERROR', status: 500 },
};

/**
 * Create a standardized error
 */
function createError(type, message, details = null) {
  const errorType = ErrorCodes[type] || ErrorCodes.INTERNAL_ERROR;
  return new ApiError(message, errorType.code, errorType.status, details);
}

/**
 * Format error response
 */
function formatErrorResponse(error) {
  if (error instanceof ApiError) {
    return {
      success: false,
      error: error.message,
      code: error.code,
      ...(error.details && { details: error.details }),
    };
  }

  // Unknown error - don't leak internal details
  console.error('Unhandled error:', error);
  return {
    success: false,
    error: 'An unexpected error occurred',
    code: 'INTERNAL_ERROR',
  };
}

/**
 * Get HTTP status code from error
 */
function getErrorStatus(error) {
  if (error instanceof ApiError) {
    return error.statusCode;
  }
  return 500;
}

/**
 * Wrap async handler with error handling
 */
function withErrorHandling(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const status = getErrorStatus(error);
      const response = formatErrorResponse(error);
      res.status(status).json(response);
    }
  };
}

module.exports = {
  ApiError,
  ErrorCodes,
  createError,
  formatErrorResponse,
  getErrorStatus,
  withErrorHandling,
};
