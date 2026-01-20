/**
 * Pure formatting functions - no side effects
 * @module utils/format
 */

/**
 * Format a number as currency
 * @param {number} amount - The amount to format
 * @param {string} currency - Currency code (default: USD)
 * @returns {string} Formatted currency string
 */
export function formatCurrency(amount, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount || 0);
}

/**
 * Format a number with 2 decimal places
 * @param {number} num - The number to format
 * @returns {string} Formatted number string
 */
export function formatNumber(num) {
  return parseFloat(num || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Format a date string for display
 * @param {string} dateStr - ISO date string
 * @returns {string} Formatted date (e.g., "Jan 15, 2026")
 */
export function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Format a percentage
 * @param {number} value - Decimal value (0-1) or percentage (0-100)
 * @param {boolean} isDecimal - Whether value is decimal (default: false)
 * @param {number} decimals - Number of decimal places (default: 0)
 * @returns {string} Formatted percentage string
 */
export function formatPercent(value, isDecimal = false, decimals = 0) {
  const pct = isDecimal ? value * 100 : value;
  return `${pct.toFixed(decimals)}%`;
}

/**
 * Convert kg to lbs
 * @param {number} kg - Weight in kilograms
 * @returns {number} Weight in pounds
 */
export function kgToLbs(kg) {
  return kg * 2.205;
}

/**
 * Format weight with unit
 * @param {number} kg - Weight in kilograms
 * @param {string} unit - Display unit ('kg' or 'lb')
 * @returns {string} Formatted weight string
 */
export function formatWeight(kg, unit = 'kg') {
  if (unit === 'lb') {
    return `${kgToLbs(kg).toFixed(0)} lb`;
  }
  return `${parseFloat(kg).toFixed(1)} kg`;
}
