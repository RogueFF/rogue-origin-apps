/**
 * Input validation utilities
 */

import { createError } from './errors.js';

/**
 * Sanitize string for Google Sheets (prevent formula injection)
 * @param {any} value
 * @returns {any}
 */
export function sanitizeForSheets(value) {
  if (typeof value !== 'string') {
    return value;
  }

  // Block formula injection
  const dangerousPrefixes = ['=', '+', '-', '@', '\t', '\r', '\n'];
  const trimmed = value.trim();

  if (dangerousPrefixes.some((p) => trimmed.startsWith(p))) {
    // Escape by prepending single quote
    return `'${trimmed}`;
  }

  // Block specific dangerous formulas
  const dangerousPatterns = [
    /^=IMPORTDATA/i,
    /^=IMPORTXML/i,
    /^=IMPORTHTML/i,
    /^=IMPORTFEED/i,
    /^=IMPORTRANGE/i,
    /^=IMAGE/i,
    /^=HYPERLINK/i,
    /^=WEBSERVICE/i,
  ];

  if (dangerousPatterns.some((p) => p.test(trimmed))) {
    return `'${trimmed}`;
  }

  return value;
}

/**
 * Validate date string (YYYY-MM-DD format)
 * @param {string} dateStr
 * @returns {boolean}
 */
export function validateDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') {
    return false;
  }

  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) {
    return false;
  }

  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

/**
 * Validate required fields
 * @param {object} data
 * @param {string[]} fields
 * @throws {ApiError}
 */
export function validateRequired(data, fields) {
  const missing = fields.filter((f) => data[f] === undefined || data[f] === null || data[f] === '');

  if (missing.length > 0) {
    throw createError('VALIDATION_ERROR', `Missing required fields: ${missing.join(', ')}`);
  }
}

/**
 * Validate numeric value
 * @param {any} value
 * @param {string} fieldName
 * @param {object} options - { min, max, allowZero }
 * @returns {number}
 */
export function validateNumber(value, fieldName, options = {}) {
  const num = Number(value);

  if (isNaN(num)) {
    throw createError('VALIDATION_ERROR', `${fieldName} must be a number`);
  }

  if (options.min !== undefined && num < options.min) {
    throw createError('VALIDATION_ERROR', `${fieldName} must be at least ${options.min}`);
  }

  if (options.max !== undefined && num > options.max) {
    throw createError('VALIDATION_ERROR', `${fieldName} must be at most ${options.max}`);
  }

  if (!options.allowZero && num === 0) {
    throw createError('VALIDATION_ERROR', `${fieldName} cannot be zero`);
  }

  return num;
}

/**
 * Validate string length
 * @param {string} value
 * @param {string} fieldName
 * @param {object} options - { min, max }
 * @returns {string}
 */
export function validateString(value, fieldName, options = {}) {
  if (typeof value !== 'string') {
    throw createError('VALIDATION_ERROR', `${fieldName} must be a string`);
  }

  if (options.min !== undefined && value.length < options.min) {
    throw createError('VALIDATION_ERROR', `${fieldName} must be at least ${options.min} characters`);
  }

  if (options.max !== undefined && value.length > options.max) {
    throw createError('VALIDATION_ERROR', `${fieldName} must be at most ${options.max} characters`);
  }

  return value;
}

/**
 * Validate enum value
 * @param {any} value
 * @param {string} fieldName
 * @param {any[]} allowedValues
 * @returns {any}
 */
export function validateEnum(value, fieldName, allowedValues) {
  if (!allowedValues.includes(value)) {
    throw createError(
      'VALIDATION_ERROR',
      `${fieldName} must be one of: ${allowedValues.join(', ')}`
    );
  }
  return value;
}
