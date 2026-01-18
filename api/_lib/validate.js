/**
 * Input validation utilities
 *
 * All user input MUST be validated before processing.
 * Never trust data from requests.
 */

const { createError } = require('./errors');

/**
 * Validate a value against a schema
 *
 * Schema format:
 * {
 *   type: 'string' | 'number' | 'boolean' | 'array' | 'object',
 *   required: boolean (default: false),
 *   minLength: number (strings/arrays),
 *   maxLength: number (strings/arrays),
 *   min: number (numbers),
 *   max: number (numbers),
 *   pattern: RegExp (strings),
 *   enum: array (allowed values),
 *   custom: (value) => true | 'error message'
 * }
 */
function validateField(value, schema, fieldName) {
  const errors = [];

  // Check required
  if (schema.required && (value === undefined || value === null || value === '')) {
    errors.push(`${fieldName} is required`);
    return errors; // No point checking further
  }

  // Skip other validations if value is empty and not required
  if (value === undefined || value === null || value === '') {
    return errors;
  }

  // Type checking
  const actualType = Array.isArray(value) ? 'array' : typeof value;
  if (schema.type && actualType !== schema.type) {
    errors.push(`${fieldName} must be a ${schema.type}, got ${actualType}`);
    return errors;
  }

  // String validations
  if (schema.type === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${fieldName} must be at least ${schema.minLength} characters`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${fieldName} must be at most ${schema.maxLength} characters`);
    }
    if (schema.pattern && !schema.pattern.test(value)) {
      errors.push(`${fieldName} has invalid format`);
    }
  }

  // Number validations
  if (schema.type === 'number') {
    if (schema.min !== undefined && value < schema.min) {
      errors.push(`${fieldName} must be at least ${schema.min}`);
    }
    if (schema.max !== undefined && value > schema.max) {
      errors.push(`${fieldName} must be at most ${schema.max}`);
    }
    if (schema.integer && !Number.isInteger(value)) {
      errors.push(`${fieldName} must be an integer`);
    }
  }

  // Array validations
  if (schema.type === 'array') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${fieldName} must have at least ${schema.minLength} items`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${fieldName} must have at most ${schema.maxLength} items`);
    }
  }

  // Enum validation
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${fieldName} must be one of: ${schema.enum.join(', ')}`);
  }

  // Custom validation
  if (schema.custom) {
    const result = schema.custom(value);
    if (result !== true) {
      errors.push(typeof result === 'string' ? result : `${fieldName} is invalid`);
    }
  }

  return errors;
}

/**
 * Validate an object against a schema
 *
 * @param {object} data - The data to validate
 * @param {object} schema - Field schemas keyed by field name
 * @returns {{ valid: boolean, errors: string[], sanitized: object }}
 */
function validate(data, schema) {
  const errors = [];
  const sanitized = {};

  // Check for unexpected fields (helps catch typos)
  const allowedFields = new Set(Object.keys(schema));
  const providedFields = Object.keys(data || {});
  const unexpectedFields = providedFields.filter(f => !allowedFields.has(f));

  if (unexpectedFields.length > 0) {
    errors.push(`Unexpected fields: ${unexpectedFields.join(', ')}`);
  }

  // Validate each field
  for (const [fieldName, fieldSchema] of Object.entries(schema)) {
    const value = data?.[fieldName];
    const fieldErrors = validateField(value, fieldSchema, fieldName);
    errors.push(...fieldErrors);

    // Only include valid, non-empty values in sanitized output
    if (fieldErrors.length === 0 && value !== undefined && value !== null) {
      sanitized[fieldName] = value;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized,
  };
}

/**
 * Validate and throw on error
 */
function validateOrThrow(data, schema) {
  const result = validate(data, schema);
  if (!result.valid) {
    throw createError('VALIDATION_ERROR', result.errors[0], result.errors);
  }
  return result.sanitized;
}

/**
 * Common field schemas for reuse
 */
const CommonSchemas = {
  // IDs
  orderId: {
    type: 'string',
    required: true,
    pattern: /^MO-\d{4}-\d{3}$/,
  },

  invoiceNumber: {
    type: 'string',
    pattern: /^INV-\d{4}-\d{4}$/,
  },

  // Strings
  name: {
    type: 'string',
    required: true,
    minLength: 1,
    maxLength: 100,
  },

  email: {
    type: 'string',
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    maxLength: 255,
  },

  phone: {
    type: 'string',
    pattern: /^[\d\s\-\+\(\)]+$/,
    maxLength: 20,
  },

  // Numbers
  positiveNumber: {
    type: 'number',
    min: 0,
  },

  positiveInteger: {
    type: 'number',
    min: 0,
    integer: true,
  },

  money: {
    type: 'number',
    min: 0,
    custom: (v) => {
      // Max 2 decimal places
      const decimals = (v.toString().split('.')[1] || '').length;
      return decimals <= 2 || 'Money values can have at most 2 decimal places';
    },
  },

  // Dates
  dateString: {
    type: 'string',
    pattern: /^\d{4}-\d{2}-\d{2}$/,
  },

  // Actions
  action: {
    type: 'string',
    required: true,
    minLength: 1,
    maxLength: 50,
  },
};

/**
 * Sanitize string to prevent formula injection in Sheets
 * Blocks: = + - @ and tab/newline
 */
function sanitizeForSheets(value) {
  if (typeof value !== 'string') {
    return value;
  }
  // Remove leading characters that could be interpreted as formulas
  let sanitized = value.replace(/^[=+\-@\t\r\n]+/, '');
  // Also block IMPORTDATA, HYPERLINK, etc.
  const dangerousPatterns = /^(IMPORTDATA|IMPORTHTML|IMPORTXML|IMPORTRANGE|HYPERLINK|IMAGE)\s*\(/i;
  if (dangerousPatterns.test(sanitized)) {
    sanitized = "'" + sanitized; // Prefix with quote to force text
  }
  return sanitized;
}

/**
 * Sanitize all string fields in an object
 */
function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = sanitizeForSheets(value);
    } else if (Array.isArray(value)) {
      result[key] = value.map(sanitizeObject);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeObject(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

module.exports = {
  validate,
  validateField,
  validateOrThrow,
  sanitizeForSheets,
  sanitizeObject,
  CommonSchemas,
};
