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

// State getters
export function getState() {
  return state;
}

export function getData() {
  return state.data;
}

export function getCompareData() {
  return state.compareData;
}

export function getCurrentView() {
  return state.currentView;
}

export function getCurrentRange() {
  return state.currentRange;
}

export function getCompareMode() {
  return state.compareMode;
}

export function getDailyTarget() {
  return state.dailyTarget;
}

export function getChart(name) {
  return state.charts[name];
}

export function getGrid(name) {
  return state.grids[name];
}

export function getTimer(name) {
  return state.timers[name];
}

export function getInterval(name) {
  return state.intervals[name];
}

export function isEditMode() {
  return state.editMode;
}

export function isSidebarCollapsed() {
  return state.sidebarCollapsed;
}

export function isDarkMode() {
  return state.darkMode;
}

export function isSkeletonsShowing() {
  return state.skeletonsShowing;
}

export function getFetchController() {
  return state.currentFetchController;
}

export function getFlags() {
  return state.flags;
}

export function getConnection() {
  return state.connection;
}

export function isConnecting() {
  return state.connection.isConnecting;
}

export function getConnectionError() {
  return state.connection.error;
}

export function getLastSuccessfulFetch() {
  return state.connection.lastSuccessfulFetch;
}

// State setters
export function setData(data) {
  state.data = data;
  state.flags.dataLoaded = data !== null;
}

export function setCompareData(data) {
  state.compareData = data;
}

export function setCurrentView(view) {
  state.currentView = view;
}

export function setCurrentRange(range) {
  state.currentRange = range;
}

export function setCustomDates(start, end) {
  state.customStartDate = start;
  state.customEndDate = end;
}

export function setCompareMode(mode) {
  state.compareMode = mode;
}

export function setDailyTarget(target) {
  state.dailyTarget = target;
}

export function setEditMode(mode) {
  state.editMode = mode;
}

export function setSidebarCollapsed(collapsed) {
  state.sidebarCollapsed = collapsed;
}

export function setDarkMode(mode) {
  state.darkMode = mode;
}

export function setSkeletonsShowing(showing) {
  state.skeletonsShowing = showing;
}

export function setChart(name, instance) {
  state.charts[name] = instance;
}

export function setGrid(name, instance) {
  state.grids[name] = instance;
}

export function setTimer(name, timerId) {
  state.timers[name] = timerId;
}

export function clearTimer(name) {
  if (state.timers[name]) {
    clearTimeout(state.timers[name]);
    state.timers[name] = null;
  }
}

export function setInterval_(name, intervalId) {
  // Clear existing interval before setting new one
  if (state.intervals[name]) {
    clearInterval(state.intervals[name]);
  }
  state.intervals[name] = intervalId;
}

export function clearInterval_(name) {
  if (state.intervals[name]) {
    clearInterval(state.intervals[name]);
    state.intervals[name] = null;
  }
}

export function clearAllIntervals() {
  Object.keys(state.intervals).forEach(function(name) {
    if (state.intervals[name]) {
      clearInterval(state.intervals[name]);
      state.intervals[name] = null;
    }
  });
}

export function setFetchController(controller) {
  state.currentFetchController = controller;
}

export function setFlag(name, value) {
  state.flags[name] = value;
}

// Connection state setters
export function setConnecting(isConnecting) {
  state.connection.isConnecting = isConnecting;
}

export function setConnectionError(error) {
  state.connection.error = error;
}

export function setLastSuccessfulFetch(timestamp) {
  state.connection.lastSuccessfulFetch = timestamp;
}

export function incrementRetryCount() {
  state.connection.retryCount++;
  return state.connection.retryCount;
}

export function resetRetryCount() {
  state.connection.retryCount = 0;
}

export function getRetryCount() {
  return state.connection.retryCount;
}

// Event listener registry management
export function registerEventListener(element, event, handler, options) {
  if (!element) return null;
  element.addEventListener(event, handler, options);
  state.eventCleanupRegistry.push({ element, event, handler, options });
  return handler;
}

export function cleanupEventListeners() {
  state.eventCleanupRegistry.forEach(function(entry) {
    if (entry.element) {
      entry.element.removeEventListener(entry.event, entry.handler, entry.options);
    }
  });
  state.eventCleanupRegistry = [];
}

// Chart cleanup
export function destroyChart(name) {
  const chart = state.charts[name];
  if (chart && typeof chart.destroy === 'function') {
    chart.destroy();
    state.charts[name] = null;
  }
}

export function destroyAllCharts() {
  Object.keys(state.charts).forEach(destroyChart);
}

// Grid cleanup
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

export function destroyAllGrids() {
  Object.keys(state.grids).forEach(destroyGrid);
}

// Full cleanup
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

// Detect environment: Apps Script or GitHub Pages
export function isAppsScript() {
  return typeof google !== 'undefined' && google.script && google.script.run;
}

// Export state for debugging (read-only access)
export function debugState() {
  return JSON.parse(JSON.stringify(state));
}
