/**
 * XSS Prevention Utilities
 *
 * Provides functions to sanitize user input before inserting into HTML.
 * Prevents cross-site scripting (XSS) attacks by escaping dangerous characters.
 */

/**
 * Escapes HTML special characters to prevent XSS attacks
 *
 * @param {string} str - The string to escape
 * @returns {string} The escaped string safe for HTML insertion
 *
 * @example
 * escapeHtml('<script>alert("XSS")</script>')
 * // Returns: '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;'
 */
export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
