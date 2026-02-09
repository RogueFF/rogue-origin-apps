/**
 * Utilities Module
 * Safe helper functions for DOM manipulation, data access, and formatting
 * All functions include null/undefined guards to prevent runtime errors
 * 
 * @module utils
 */

import { workSchedule } from './config.js';

// ==================== DOM UTILITIES ====================

/**
 * Safely get a DOM element by ID with console warning if not found
 * @param {string} id - Element ID
 * @returns {HTMLElement|null} Element or null if not found
 * @example
 * const button = safeGetEl('submit-btn');
 * if (button) button.addEventListener('click', handler);
 */
export function safeGetEl(id) {
  const el = document.getElementById(id);
  if (!el) console.warn(`Element not found: ${id}`);
  return el;
}

/**
 * Safely get Chart.js 2D canvas context with error handling
 * @param {string} canvasId - Canvas element ID
 * @returns {CanvasRenderingContext2D|null} 2D context or null if not found
 * @example
 * const ctx = safeGetChartContext('myChart');
 * if (ctx) new Chart(ctx, config);
 */
export function safeGetChartContext(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) {
    console.warn(`Canvas element not found: ${canvasId}`);
    return null;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    console.warn(`Could not get 2d context for: ${canvasId}`);
    return null;
  }
  return ctx;
}

// ==================== DATA ACCESS ====================

/**
 * Safely access nested object properties using dot notation
 * @param {Object} obj - Source object
 * @param {string} path - Property path (e.g., 'user.profile.name')
 * @param {*} [defaultValue=undefined] - Value to return if path doesn't exist
 * @returns {*} Property value or defaultValue
 * @example
 * const name = safeGet(data, 'user.profile.name', 'Unknown');
 * const count = safeGet(data, 'metrics.daily.count', 0);
 */
export function safeGet(obj, path, defaultValue) {
  if (!obj || typeof path !== 'string') return defaultValue;
  const keys = path.split('.');
  let result = obj;
  for (let i = 0; i < keys.length; i++) {
    if (result == null || typeof result !== 'object') return defaultValue;
    result = result[keys[i]];
  }
  return result !== undefined ? result : defaultValue;
}

/**
 * Safely format a number with optional decimal places
 * @param {number} value - Number to format
 * @param {number} [decimals] - Number of decimal places (optional)
 * @param {string|number} [defaultValue='—'] - Value to return if number is invalid
 * @returns {string|number} Formatted number or default value
 * @example
 * safeNumber(123.456, 2) // "123.46"
 * safeNumber(NaN, 2, 0) // 0
 * safeNumber(null) // "—"
 */
export function safeNumber(value, decimals, defaultValue) {
  if (typeof value !== 'number' || isNaN(value) || !isFinite(value)) {
    return defaultValue !== undefined ? defaultValue : '—';
  }
  return decimals !== undefined ? value.toFixed(decimals) : value;
}

// ==================== TIME CALCULATIONS ====================

/**
 * Get effective shift start time in minutes from midnight.
 * Uses custom shift start from localStorage if set for today, otherwise default.
 * @returns {number} Start time in minutes from midnight
 */
function getEffectiveShiftStartMin() {
  const savedStart = localStorage.getItem('manualShiftStart');
  if (savedStart) {
    const savedTime = new Date(savedStart);
    if (savedTime.toDateString() === new Date().toDateString()) {
      return savedTime.getHours() * 60 + savedTime.getMinutes();
    }
  }
  return workSchedule.startHour * 60 + workSchedule.startMin;
}

/**
 * Calculate productive minutes elapsed since start of workday
 * Automatically subtracts break periods (morning, lunch, afternoon, cleanup)
 * @returns {number} Productive minutes elapsed (0 if before work starts)
 * @example
 * // At 11:00 AM (2hrs after 7:00 AM start, minus 10min morning break)
 * getProductiveMinutesElapsed() // 110 minutes
 */
export function getProductiveMinutesElapsed() {
  const now = new Date();
  const currentTimeInMin = now.getHours() * 60 + now.getMinutes();
  const startTimeInMin = getEffectiveShiftStartMin();
  const endTimeInMin = workSchedule.endHour * 60 + workSchedule.endMin;

  if (currentTimeInMin < startTimeInMin) return 0;

  const effectiveEnd = Math.min(currentTimeInMin, endTimeInMin);
  const rawMinutesElapsed = effectiveEnd - startTimeInMin;

  // Subtract only break portions that overlap [startTimeInMin, effectiveEnd]
  let breakMinutesPassed = 0;
  workSchedule.breaks.forEach(function(b) {
    const breakStart = b.hour * 60 + b.min;
    const breakEnd = breakStart + b.duration;
    const overlapStart = Math.max(breakStart, startTimeInMin);
    const overlapEnd = Math.min(breakEnd, effectiveEnd);
    if (overlapEnd > overlapStart) {
      breakMinutesPassed += (overlapEnd - overlapStart);
    }
  });

  return Math.max(0, rawMinutesElapsed - breakMinutesPassed);
}

/**
 * Get productive hours elapsed (convenience wrapper)
 * @returns {number} Productive hours elapsed as decimal
 */
export function getProductiveHoursElapsed() {
  return getProductiveMinutesElapsed() / 60;
}

/**
 * Get total productive hours in a workday
 * @returns {number} Total hours (typically 8.5 after subtracting all breaks)
 */
export function getTotalProductiveHours() {
  const startTimeInMin = getEffectiveShiftStartMin();
  const endTimeInMin = workSchedule.endHour * 60 + workSchedule.endMin;
  const totalMinutes = endTimeInMin - startTimeInMin;

  let breakMinutes = 0;
  workSchedule.breaks.forEach(function(b) {
    const breakStart = b.hour * 60 + b.min;
    const breakEnd = breakStart + b.duration;
    const overlapStart = Math.max(breakStart, startTimeInMin);
    const overlapEnd = Math.min(breakEnd, endTimeInMin);
    if (overlapEnd > overlapStart) {
      breakMinutes += (overlapEnd - overlapStart);
    }
  });

  return Math.max(0, (totalMinutes - breakMinutes) / 60);
}

// ==================== DATE FORMATTING ====================

/**
 * Format date for HTML input fields (YYYY-MM-DD)
 * @param {Date} d - Date object
 * @returns {string} Formatted date string
 * @example
 * formatDateInput(new Date()) // "2026-01-26"
 */
export function formatDateInput(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format date string for short display (e.g., "Jan 26")
 * @param {string} s - Date string in YYYY-MM-DD format
 * @returns {string} Short formatted date
 * @example
 * formatDateShort("2026-01-26") // "Jan 26"
 */
export function formatDateShort(s) {
  const parts = s.split('-');
  const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Format time for clock display (12-hour format with AM/PM)
 * @param {Date} date - Date object
 * @returns {string} Formatted time string
 * @example
 * formatTime(new Date()) // "3:45 PM"
 */
export function formatTime(date) {
  const hours = date.getHours() % 12 || 12;
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = date.getHours() >= 12 ? 'PM' : 'AM';
  return `${hours}:${minutes} ${ampm}`;
}

/**
 * Format date for display with weekday (e.g., "Mon, Jan 26")
 * @param {Date} date - Date object
 * @returns {string} Formatted date string
 */
export function formatFullDate(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

/**
 * Format date with full weekday, month, day, and year
 * @param {Date} date - Date object
 * @returns {string} Long formatted date
 * @example
 * formatLongDate(new Date()) // "Sunday, January 26, 2026"
 */
export function formatLongDate(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

// ==================== FUNCTION UTILITIES ====================

/**
 * Debounce function calls - delays execution until after wait period with no new calls
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 * @example
 * const debouncedSearch = debounce(searchFunction, 300);
 * input.addEventListener('input', debouncedSearch);
 */
export function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

/**
 * Throttle function calls - ensures function is called at most once per limit period
 * @param {Function} func - Function to throttle
 * @param {number} limit - Minimum time between calls in milliseconds
 * @returns {Function} Throttled function
 * @example
 * const throttledScroll = throttle(handleScroll, 100);
 * window.addEventListener('scroll', throttledScroll);
 */
export function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// ==================== UI UTILITIES ====================

/**
 * Animate a number from start to end value with smooth easing
 * @param {string} id - Element ID to update
 * @param {number} start - Starting value
 * @param {number} end - Ending value
 * @param {number} duration - Animation duration in milliseconds
 * @example
 * animateValue('counter', 0, 100, 1000); // Animate from 0 to 100 over 1 second
 */
export function animateValue(id, start, end, duration) {
  const el = document.getElementById(id);
  if (!el) return;

  el.classList.add('animate-value');
  let startTime = null;
  const isDecimal = String(end).includes('.') || end % 1 !== 0;

  function step(timestamp) {
    if (!startTime) startTime = timestamp;
    const progress = Math.min((timestamp - startTime) / duration, 1);
    const current = start + (end - start) * progress;
    el.textContent = isDecimal ? current.toFixed(2) : Math.floor(current);
    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

/**
 * Get time-appropriate greeting
 * @returns {string} "Good morning", "Good afternoon", or "Good evening"
 */
export function getTimeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ==================== OBJECT UTILITIES ====================

/**
 * Deep clone an object (simple JSON-based clone)
 * Note: Does not preserve functions, dates, or circular references
 * @param {Object} obj - Object to clone
 * @returns {Object} Cloned object
 * @example
 * const copy = deepClone(originalObject);
 */
export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Check if an object/array is empty
 * @param {*} obj - Value to check
 * @returns {boolean} True if null, undefined, or empty object/array
 * @example
 * isEmpty(null) // true
 * isEmpty({}) // true
 * isEmpty([]) // true
 * isEmpty({ name: 'John' }) // false
 */
export function isEmpty(obj) {
  return obj == null || (typeof obj === 'object' && Object.keys(obj).length === 0);
}

/**
 * Generate a unique ID with optional prefix
 * @param {string} [prefix='id'] - Prefix for the ID
 * @returns {string} Unique ID string
 * @example
 * generateId() // "id_7x2k9p1m4"
 * generateId('widget') // "widget_5n8q3r7l2"
 */
export function generateId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).substr(2, 9)}`;
}
