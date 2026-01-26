/**
 * State Module
 * Centralized application state management
 * Replaces 30+ global variables with a single state object
 */

import { DEFAULT_DAILY_TARGET } from './config.js';

// Application state object
const state = {
  // Data
  data: null,
  compareData: null,
  fallback: null, // { active: true, date: 'YYYY-MM-DD', requestedRange: {...} }

  // Date range
  currentRange: 'today',
  customStartDate: null,
  customEndDate: null,
  compareMode: null,

  // UI State
  editMode: false,
  currentView: 'dashboard',
  sidebarCollapsed: false,
  skeletonsShowing: false,
  darkMode: false,
  dailyTarget: DEFAULT_DAILY_TARGET,

  // Chart instances (for cleanup)
  charts: {
    hourly: null,
    rate: null,
    daily: null,
    dailyRate: null,
    trimmers: null
  },

  // Muuri grid instances
  grids: {
    kpi: null,
    widgets: null
  },

  // Sortable instances (legacy)
  sortables: {
    kpi: null,
    widget: null
  },

  // Request management
  currentFetchController: null,

  // Connection status tracking
  connection: {
    lastSuccessfulFetch: null,  // Date timestamp of last successful data load
    isConnecting: false,        // Currently fetching data
    error: null,                // Error message if connection failed
    retryCount: 0               // Number of auto-retry attempts
  },

  // Debounce timers
  timers: {
    muuriLayout: null,
    muuriKPILayout: null,
    collapseLayout: null,
    resize: null
  },

  // Interval registry for cleanup (setInterval IDs)
  intervals: {
    autoRefresh: null,
    clock: null
  },

  // Event listener cleanup registry
  eventCleanupRegistry: [],

  // Initialization flags
  flags: {
    chartsInitialized: false,
    dataLoaded: false,
    muuriKPIReady: false,
    muuriGridReady: false
  }
};

// ==================== STATE GETTERS ====================

/**
 * Get the entire state object (use sparingly, prefer specific getters)
 * @returns {Object} Complete application state
 */
export function getState() {
  return state;
}

/**
 * Get current production data
 * @returns {Object|null} Production data object or null if not loaded
 */
export function getData() {
  return state.data;
}

/**
 * Get comparison period production data
 * @returns {Object|null} Comparison data object or null
 */
export function getCompareData() {
  return state.compareData;
}

/**
 * Get current active view
 * @returns {string} View name (e.g., 'dashboard', 'period')
 */
export function getCurrentView() {
  return state.currentView;
}

/**
 * Get current date range selection
 * @returns {string} Range name (e.g., 'today', 'week', 'month', 'custom')
 */
export function getCurrentRange() {
  return state.currentRange;
}

/**
 * Get comparison mode
 * @returns {string|null} Compare mode ('prior-period', 'prior-week', etc.) or null
 */
export function getCompareMode() {
  return state.compareMode;
}

/**
 * Get daily target value (lbs)
 * @returns {number} Target production in pounds
 */
export function getDailyTarget() {
  return state.dailyTarget;
}

/**
 * Get Chart.js instance by name
 * @param {string} name - Chart name ('hourly', 'rate', 'daily', 'dailyRate', 'trimmers')
 * @returns {Chart|null} Chart instance or null
 */
export function getChart(name) {
  return state.charts[name];
}

/**
 * Get Muuri grid instance by name
 * @param {string} name - Grid name ('kpi', 'widgets')
 * @returns {Muuri|null} Muuri instance or null
 */
export function getGrid(name) {
  return state.grids[name];
}

/**
 * Get timer ID by name
 * @param {string} name - Timer name
 * @returns {number|null} setTimeout ID or null
 */
export function getTimer(name) {
  return state.timers[name];
}

/**
 * Get interval ID by name
 * @param {string} name - Interval name ('autoRefresh', 'clock')
 * @returns {number|null} setInterval ID or null
 */
export function getInterval(name) {
  return state.intervals[name];
}

/**
 * Check if edit mode is active
 * @returns {boolean} True if in edit mode
 */
export function isEditMode() {
  return state.editMode;
}

/**
 * Check if sidebar is collapsed
 * @returns {boolean} True if sidebar is collapsed
 */
export function isSidebarCollapsed() {
  return state.sidebarCollapsed;
}

/**
 * Check if dark mode is active
 * @returns {boolean} True if dark mode is enabled
 */
export function isDarkMode() {
  return state.darkMode;
}

/**
 * Check if skeleton loading indicators are showing
 * @returns {boolean} True if skeletons are visible
 */
export function isSkeletonsShowing() {
  return state.skeletonsShowing;
}

/**
 * Get current fetch AbortController
 * @returns {AbortController|null} Active fetch controller or null
 */
export function getFetchController() {
  return state.currentFetchController;
}

/**
 * Get initialization flags object
 * @returns {Object} Flags object with boolean properties
 */
export function getFlags() {
  return state.flags;
}

/**
 * Get connection status object
 * @returns {Object} Connection state with lastSuccessfulFetch, isConnecting, error, retryCount
 */
export function getConnection() {
  return state.connection;
}

/**
 * Check if currently fetching data
 * @returns {boolean} True if fetch is in progress
 */
export function isConnecting() {
  return state.connection.isConnecting;
}

/**
 * Get connection error message
 * @returns {string|null} Error message or null
 */
export function getConnectionError() {
  return state.connection.error;
}

/**
 * Get timestamp of last successful data fetch
 * @returns {Date|null} Date object or null
 */
export function getLastSuccessfulFetch() {
  return state.connection.lastSuccessfulFetch;
}

// ==================== STATE SETTERS ====================

/**
 * Set production data and update dataLoaded flag
 * @param {Object|null} data - Production data object
 */
export function setData(data) {
  state.data = data;
  state.flags.dataLoaded = data !== null;
}

/**
 * Set comparison period data
 * @param {Object|null} data - Comparison data object
 */
export function setCompareData(data) {
  state.compareData = data;
}

/**
 * Set current active view
 * @param {string} view - View name ('dashboard', 'period', etc.)
 */
export function setCurrentView(view) {
  state.currentView = view;
}

/**
 * Set current date range selection
 * @param {string} range - Range name ('today', 'week', 'month', 'custom')
 */
export function setCurrentRange(range) {
  state.currentRange = range;
}

/**
 * Set custom date range
 * @param {string} start - Start date (YYYY-MM-DD)
 * @param {string} end - End date (YYYY-MM-DD)
 */
export function setCustomDates(start, end) {
  state.customStartDate = start;
  state.customEndDate = end;
}

/**
 * Set comparison mode
 * @param {string|null} mode - Compare mode ('prior-period', 'prior-week', etc.) or null
 */
export function setCompareMode(mode) {
  state.compareMode = mode;
}

/**
 * Set daily target value
 * @param {number} target - Target production in pounds
 */
export function setDailyTarget(target) {
  state.dailyTarget = target;
}

/**
 * Toggle edit mode
 * @param {boolean} mode - True to enable edit mode
 */
export function setEditMode(mode) {
  state.editMode = mode;
}

/**
 * Set sidebar collapsed state
 * @param {boolean} collapsed - True to collapse sidebar
 */
export function setSidebarCollapsed(collapsed) {
  state.sidebarCollapsed = collapsed;
}

/**
 * Set dark mode state
 * @param {boolean} mode - True to enable dark mode
 */
export function setDarkMode(mode) {
  state.darkMode = mode;
}

/**
 * Set skeleton loading state
 * @param {boolean} showing - True to show skeletons
 */
export function setSkeletonsShowing(showing) {
  state.skeletonsShowing = showing;
}

/**
 * Store Chart.js instance
 * @param {string} name - Chart name
 * @param {Chart} instance - Chart.js instance
 */
export function setChart(name, instance) {
  state.charts[name] = instance;
}

/**
 * Store Muuri grid instance
 * @param {string} name - Grid name
 * @param {Muuri} instance - Muuri instance
 */
export function setGrid(name, instance) {
  state.grids[name] = instance;
}

/**
 * Store timer ID for later cleanup
 * @param {string} name - Timer name
 * @param {number} timerId - setTimeout return value
 */
export function setTimer(name, timerId) {
  state.timers[name] = timerId;
}

/**
 * Clear a specific timer
 * @param {string} name - Timer name to clear
 */
export function clearTimer(name) {
  if (state.timers[name]) {
    clearTimeout(state.timers[name]);
    state.timers[name] = null;
  }
}

/**
 * Store interval ID (clears existing interval with same name first)
 * @param {string} name - Interval name
 * @param {number} intervalId - setInterval return value
 */
export function setInterval_(name, intervalId) {
  // Clear existing interval before setting new one
  if (state.intervals[name]) {
    clearInterval(state.intervals[name]);
  }
  state.intervals[name] = intervalId;
}

/**
 * Clear a specific interval
 * @param {string} name - Interval name to clear
 */
export function clearInterval_(name) {
  if (state.intervals[name]) {
    clearInterval(state.intervals[name]);
    state.intervals[name] = null;
  }
}

/**
 * Clear all registered intervals (called on cleanup)
 */
export function clearAllIntervals() {
  Object.keys(state.intervals).forEach(function(name) {
    if (state.intervals[name]) {
      clearInterval(state.intervals[name]);
      state.intervals[name] = null;
    }
  });
}

/**
 * Store fetch AbortController for cancellation
 * @param {AbortController|null} controller - Fetch controller or null
 */
export function setFetchController(controller) {
  state.currentFetchController = controller;
}

/**
 * Set an initialization flag
 * @param {string} name - Flag name
 * @param {boolean} value - Flag value
 */
export function setFlag(name, value) {
  state.flags[name] = value;
}

// ==================== CONNECTION STATE ====================

/**
 * Set connecting state
 * @param {boolean} isConnecting - True if fetch is in progress
 */
export function setConnecting(isConnecting) {
  state.connection.isConnecting = isConnecting;
}

/**
 * Set connection error message
 * @param {string|null} error - Error message or null
 */
export function setConnectionError(error) {
  state.connection.error = error;
}

/**
 * Set last successful fetch timestamp
 * @param {Date} timestamp - Date object
 */
export function setLastSuccessfulFetch(timestamp) {
  state.connection.lastSuccessfulFetch = timestamp;
}

/**
 * Increment retry counter
 * @returns {number} New retry count
 */
export function incrementRetryCount() {
  state.connection.retryCount++;
  return state.connection.retryCount;
}

/**
 * Reset retry counter to 0
 */
export function resetRetryCount() {
  state.connection.retryCount = 0;
}

/**
 * Get current retry count
 * @returns {number} Retry count
 */
export function getRetryCount() {
  return state.connection.retryCount;
}

// ==================== FALLBACK STATE ====================

/**
 * Set fallback data info (when showing prior day's data)
 * @param {Object} fallbackInfo - Object with { active, date, requestedRange }
 */
export function setFallback(fallbackInfo) {
  state.fallback = fallbackInfo;
}

/**
 * Get fallback data info
 * @returns {Object|null} Fallback info or null
 */
export function getFallback() {
  return state.fallback;
}

/**
 * Clear fallback state
 */
export function clearFallback() {
  state.fallback = null;
}

// ==================== EVENT LISTENER MANAGEMENT ====================

/**
 * Register an event listener for automatic cleanup on page unload
 * Prevents memory leaks from orphaned event listeners
 * @param {HTMLElement} element - DOM element
 * @param {string} event - Event name ('click', 'change', etc.)
 * @param {Function} handler - Event handler function
 * @param {Object} [options] - addEventListener options
 * @returns {Function|null} Handler function or null if element is null
 */
export function registerEventListener(element, event, handler, options) {
  if (!element) return null;
  element.addEventListener(event, handler, options);
  state.eventCleanupRegistry.push({ element, event, handler, options });
  return handler;
}

/**
 * Remove all registered event listeners
 * Called automatically during cleanup()
 */
export function cleanupEventListeners() {
  state.eventCleanupRegistry.forEach(function(entry) {
    if (entry.element) {
      entry.element.removeEventListener(entry.event, entry.handler, entry.options);
    }
  });
  state.eventCleanupRegistry = [];
}

// ==================== CHART CLEANUP ====================

/**
 * Destroy a specific Chart.js instance
 * @param {string} name - Chart name
 */
export function destroyChart(name) {
  const chart = state.charts[name];
  if (chart && typeof chart.destroy === 'function') {
    chart.destroy();
    state.charts[name] = null;
  }
}

/**
 * Destroy all Chart.js instances
 * Called during cleanup to prevent memory leaks
 */
export function destroyAllCharts() {
  Object.keys(state.charts).forEach(destroyChart);
}

// ==================== GRID CLEANUP ====================

/**
 * Destroy a specific Muuri grid instance
 * @param {string} name - Grid name
 */
export function destroyGrid(name) {
  const grid = state.grids[name];
  if (grid && !grid._isDestroyed) {
    try {
      grid.destroy();
    } catch (e) {
      console.warn('Error destroying grid:', name, e);
    }
    state.grids[name] = null;
  }
}

/**
 * Destroy all Muuri grid instances
 * Called during cleanup to prevent memory leaks
 */
export function destroyAllGrids() {
  Object.keys(state.grids).forEach(destroyGrid);
}

// ==================== FULL CLEANUP ====================

/**
 * Comprehensive cleanup function
 * Clears all timers, intervals, event listeners, charts, grids, and cancels in-flight requests
 * Call this before page navigation or when resetting the application
 */
export function cleanup() {
  cleanupEventListeners();
  destroyAllCharts();
  destroyAllGrids();

  // Clear all timers
  Object.keys(state.timers).forEach(clearTimer);

  // Clear all intervals (autoRefresh, clock, etc.)
  clearAllIntervals();

  // Cancel any in-flight fetch requests
  if (state.currentFetchController) {
    state.currentFetchController.abort();
    state.currentFetchController = null;
  }
}

// ==================== UTILITY FUNCTIONS ====================

/**
 * Detect if running in Google Apps Script container
 * @returns {boolean} True if running in Apps Script
 */
export function isAppsScript() {
  return typeof google !== 'undefined' && google.script && google.script.run;
}

/**
 * Get a deep copy of the state object for debugging
 * @returns {Object} State object clone (safe to log without side effects)
 */
export function debugState() {
  return JSON.parse(JSON.stringify(state));
}
