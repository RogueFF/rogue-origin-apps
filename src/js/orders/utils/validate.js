/**
 * Input validation functions - pure, no side effects
 * @module utils/validate
 */

/**
 * Validate that a value is not empty
 * @param {*} value - Value to check
 * @param {string} fieldName - Name of field for error message
 * @returns {string|null} Error message or null if valid
 */
export function validateRequired(value, fieldName) {
  if (value === null || value === undefined) {
    return `${fieldName} is required`;
  }
  if (typeof value === 'string' && !value.trim()) {
    return `${fieldName} is required`;
  }
  return null;
}

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {string|null} Error message or null if valid
 */
export function validateEmail(email) {
  if (!email) return null; // Optional field
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email) ? null : 'Invalid email format';
}

/**
 * Validate phone number format (basic)
 * @param {string} phone - Phone to validate
 * @returns {string|null} Error message or null if valid
 */
export function validatePhone(phone) {
  if (!phone) return null; // Optional field
  // Allow digits, spaces, dashes, parentheses, plus sign
  const regex = /^[\d\s\-()+ ]{7,20}$/;
  return regex.test(phone) ? null : 'Invalid phone format';
}

/**
 * Validate that a value is a positive number
 * @param {*} value - Value to check
 * @param {string} fieldName - Name of field for error message
 * @returns {string|null} Error message or null if valid
 */
export function validatePositiveNumber(value, fieldName) {
  const num = parseFloat(value);
  if (isNaN(num)) {
    return `${fieldName} must be a number`;
  }
  if (num < 0) {
    return `${fieldName} must be positive`;
  }
  return null;
}

/**
 * Validate that a value is a positive integer
 * @param {*} value - Value to check
 * @param {string} fieldName - Name of field for error message
 * @returns {string|null} Error message or null if valid
 */
export function validatePositiveInteger(value, fieldName) {
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    return `${fieldName} must be a number`;
  }
  if (num < 0) {
    return `${fieldName} must be positive`;
  }
  if (num !== parseFloat(value)) {
    return `${fieldName} must be a whole number`;
  }
  return null;
}

/**
 * Run multiple validations, return first error
 * @param {Array<function>} validators - Array of validation functions
 * @returns {string|null} First error message or null if all valid
 */
export function validateAll(...validators) {
  for (const validate of validators) {
    const error = validate();
    if (error) return error;
  }
  return null;
}
