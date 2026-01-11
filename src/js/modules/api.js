/**
 * API Module
 * Handles all data fetching for the dashboard
 * Supports both Apps Script mode and GitHub Pages mode
 */

import { API_URL } from './config.js';
import {
  setData,
  setCompareData,
  getFetchController,
  setFetchController,
  isAppsScript,
  getData,
  getCompareData,
  isSkeletonsShowing as _isSkeletonsShowing,
  setSkeletonsShowing as _setSkeletonsShowing
} from './state.js';
import { formatDateInput } from './utils.js';

// Forward declarations for functions that will be set by the main module
let renderAllFn = null;
let showSkeletonsFn = null;
let showToastFn = null;

/**
 * Set the render callback function
 * Called by main module during initialization
 * @param {function} fn - The renderAll function
 */
export function setRenderCallback(fn) {
  renderAllFn = fn;
}

/**
 * Set the showSkeletons callback function
 * @param {function} fn - The showSkeletons function
 */
export function setShowSkeletonsCallback(fn) {
  showSkeletonsFn = fn;
}

/**
 * Set the showToast callback function
 * @param {function} fn - The showToast function
 */
export function setShowToastCallback(fn) {
  showToastFn = fn;
}

/**
 * Show skeletons wrapper
 * @param {boolean} show - Whether to show or hide skeletons
 */
function showSkeletons(show) {
  if (showSkeletonsFn) {
    showSkeletonsFn(show);
  }
}

/**
 * Render all components wrapper
 */
function renderAll() {
  if (renderAllFn) {
    renderAllFn();
  }
}

/**
 * Show toast notification wrapper
 * @param {string} message - Toast message
 * @param {string} type - Toast type (success, error, info)
 * @param {number} duration - Duration in ms
 */
function showToast(message, type, duration) {
  if (showToastFn) {
    showToastFn(message, type, duration);
  }
}

/**
 * Error handler for API requests
 * @param {Error} error - The error object
 */
export function onError(error) {
  console.error('API Error:', error);

  // Hide loading overlay if present
  var loadingOverlay = document.getElementById('loadingOverlay');
  if (loadingOverlay) {
    loadingOverlay.classList.add('hidden');
  }

  showSkeletons(false);
  showToast('Error loading data: ' + (error.message || error), 'error');
}

/**
 * Handler for successful data load
 * @param {object} result - The data result from API
 */
function onDataLoaded(result) {
  showSkeletons(false);

  // Only re-render if data actually changed
  var newDataStr = JSON.stringify(result);
  var oldData = getData();
  var oldDataStr = oldData ? JSON.stringify(oldData) : '';
  var isFirstLoad = !oldDataStr;

  if (newDataStr !== oldDataStr) {
    setData(result);
    renderAll();

    // Show subtle update notification (only on auto-refresh, not initial load)
    if (oldDataStr) {
      showToast('Data updated', 'success', 2000);
    }
  }

  return isFirstLoad;
}

/**
 * Load data for the current date range
 * Main data loading function
 */
export function loadData() {
  var startEl = document.getElementById('startDate');
  var endEl = document.getElementById('endDate');
  var s = startEl ? startEl.value : formatDateInput(new Date());
  var e = endEl ? endEl.value : formatDateInput(new Date());

  // Cancel any in-flight fetch requests to prevent stale data from overwriting current data
  // This fixes race conditions when user rapidly changes date range
  var controller = getFetchController();
  if (controller) {
    controller.abort();
  }
  var newController = new AbortController();
  setFetchController(newController);
  var signal = newController.signal;

  if (isAppsScript()) {
    // Apps Script mode - use google.script.run
    // Only show skeletons on initial load (no existing data)
    if (!getData()) {
      showSkeletons(true);
    }
    google.script.run
      .withSuccessHandler(onDataLoaded)
      .withFailureHandler(onError)
      .getProductionDashboardData(s, e);
  } else {
    // GitHub Pages mode - use caching layer with optimistic UI
    var isFirstCallForThisRequest = true;
    var existingData = getData();

    // Check if fetchDashboardData helper is available (from api-cache.js)
    if (typeof window.fetchDashboardData === 'function') {
      window.fetchDashboardData(
        s,
        e,
        function(fetchedData, meta) {
          // meta.fromCache = true if this is cached data
          // meta.isFresh = true if cached data is still within TTL

          if (isFirstCallForThisRequest) {
            // First call - either cached or fresh, update UI
            showSkeletons(false);
            onDataLoaded(fetchedData);
            isFirstCallForThisRequest = false;
          } else if (!meta.fromCache) {
            // Fresh data from server - update UI
            onDataLoaded(fetchedData);
          }
        },
        onError,
        { apiUrl: API_URL, signal: signal }
      ).catch(function(error) {
        // Ignore AbortError - this is expected when request is cancelled
        if (error.name === 'AbortError') {
          console.log('Fetch aborted - newer request in progress');
          return;
        }
        // Error already handled by onError callback in fetchDashboardData
      });

      // Only show skeletons on initial load (no existing data and no cache)
      if (!existingData) {
        // Check if we have cached data
        if (typeof window.APICache !== 'undefined') {
          var cacheKey = window.APICache.generateKey('dashboard', { start: s, end: e });
          var cached = window.APICache.get(cacheKey);
          if (!cached || !cached.data) {
            // No cached data - show skeletons while loading
            showSkeletons(true);
          }
        } else {
          showSkeletons(true);
        }
      }
    } else {
      // Fallback: Direct fetch without caching
      if (!existingData) {
        showSkeletons(true);
      }

      var url = API_URL + '?action=dashboard&start=' + encodeURIComponent(s) + '&end=' + encodeURIComponent(e);

      fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'text/plain'
        },
        signal: signal
      })
      .then(function(response) {
        if (!response.ok) {
          throw new Error('HTTP ' + response.status);
        }
        return response.json();
      })
      .then(function(result) {
        if (result.success && result.data) {
          onDataLoaded(result.data);
        } else if (result.data) {
          onDataLoaded(result.data);
        } else {
          onDataLoaded(result);
        }
      })
      .catch(function(error) {
        if (error.name === 'AbortError') {
          console.log('Fetch aborted - newer request in progress');
          return;
        }
        onError(error);
      });
    }
  }
}

/**
 * Load comparison period data
 * Loads data for both current and previous periods based on compare mode
 */
export function loadCompareData() {
  var compareMode = null;
  var compareModeEl = document.querySelector('[data-compare-mode].active');
  if (compareModeEl) {
    compareMode = compareModeEl.dataset.compareMode;
  }

  if (!compareMode) {
    // No compare mode active
    setCompareData(null);
    return;
  }

  // Only show skeletons on initial load (no existing data)
  if (!getData()) {
    showSkeletons(true);
  }

  var today = new Date();
  var cs, ce, ps, pe;

  if (compareMode === 'yesterday') {
    cs = ce = formatDateInput(today);
    var y = new Date(today);
    y.setDate(y.getDate() - 1);
    ps = pe = formatDateInput(y);
  } else if (compareMode === 'lastWeek') {
    var ws = new Date(today);
    ws.setDate(today.getDate() - today.getDay());
    cs = formatDateInput(ws);
    ce = formatDateInput(today);
    var pws = new Date(ws);
    pws.setDate(pws.getDate() - 7);
    var pwe = new Date(ws);
    pwe.setDate(pwe.getDate() - 1);
    ps = formatDateInput(pws);
    pe = formatDateInput(pwe);
  } else if (compareMode === 'lastMonth') {
    var ms = new Date(today.getFullYear(), today.getMonth(), 1);
    cs = formatDateInput(ms);
    ce = formatDateInput(today);
    var pms = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    var pme = new Date(today.getFullYear(), today.getMonth(), 0);
    ps = formatDateInput(pms);
    pe = formatDateInput(pme);
  } else {
    return;
  }

  if (isAppsScript()) {
    // Apps Script mode
    google.script.run.withSuccessHandler(function(r) {
      google.script.run.withSuccessHandler(function(pr) {
        showSkeletons(false);

        // Only re-render if data actually changed
        var newDataStr = JSON.stringify(r) + JSON.stringify(pr);
        var oldData = getData();
        var oldCompareData = getCompareData();
        var oldDataStr = (oldData ? JSON.stringify(oldData) : '') + (oldCompareData ? JSON.stringify(oldCompareData) : '');

        if (newDataStr !== oldDataStr) {
          setData(r);
          setCompareData(pr);
          renderAll();
        }
      }).withFailureHandler(onError).getProductionDashboardData(ps, pe);
    }).withFailureHandler(onError).getProductionDashboardData(cs, ce);
  } else {
    // GitHub Pages mode - use fetch helper
    loadCompareDataFetch(cs, ce, ps, pe);
  }
}

/**
 * Fetch implementation for compare data (GitHub Pages mode)
 * @param {string} cs - Current period start date
 * @param {string} ce - Current period end date
 * @param {string} ps - Previous period start date
 * @param {string} pe - Previous period end date
 */
export function loadCompareDataFetch(cs, ce, ps, pe) {
  // Cancel any in-flight fetch requests to prevent stale data from overwriting current data
  // This fixes race conditions when user rapidly changes compare mode
  var controller = getFetchController();
  if (controller) {
    controller.abort();
  }
  var newController = new AbortController();
  setFetchController(newController);
  var signal = newController.signal;

  // Check if fetchDashboardData helper is available
  if (typeof window.fetchDashboardData === 'function') {
    // Use caching for both current and previous period
    var currentPromise = new Promise(function(resolve, reject) {
      window.fetchDashboardData(cs, ce, resolve, reject, { apiUrl: API_URL, signal: signal });
    });

    var prevPromise = new Promise(function(resolve, reject) {
      window.fetchDashboardData(ps, pe, resolve, reject, { apiUrl: API_URL, signal: signal });
    });

    Promise.all([currentPromise, prevPromise]).then(function(results) {
      showSkeletons(false);

      var currentResult = results[0];
      var prevResult = results[1];

      var newDataStr = JSON.stringify(currentResult) + JSON.stringify(prevResult);
      var oldData = getData();
      var oldCompareData = getCompareData();
      var oldDataStr = (oldData ? JSON.stringify(oldData) : '') + (oldCompareData ? JSON.stringify(oldCompareData) : '');

      if (newDataStr !== oldDataStr) {
        setData(currentResult);
        setCompareData(prevResult);
        renderAll();
      }
    }).catch(function(error) {
      // Ignore AbortError - this is expected when request is cancelled
      if (error.name === 'AbortError') {
        console.log('Compare fetch aborted - newer request in progress');
        return;
      }
      onError(error);
    });
  } else {
    // Fallback: Direct fetch without caching
    var currentUrl = API_URL + '?action=dashboard&start=' + encodeURIComponent(cs) + '&end=' + encodeURIComponent(ce);
    var prevUrl = API_URL + '?action=dashboard&start=' + encodeURIComponent(ps) + '&end=' + encodeURIComponent(pe);

    var fetchOptions = {
      method: 'GET',
      headers: { 'Content-Type': 'text/plain' },
      signal: signal
    };

    Promise.all([
      fetch(currentUrl, fetchOptions).then(function(r) { return r.json(); }),
      fetch(prevUrl, fetchOptions).then(function(r) { return r.json(); })
    ]).then(function(results) {
      showSkeletons(false);

      var currentResult = results[0].data || results[0];
      var prevResult = results[1].data || results[1];

      var newDataStr = JSON.stringify(currentResult) + JSON.stringify(prevResult);
      var oldData = getData();
      var oldCompareData = getCompareData();
      var oldDataStr = (oldData ? JSON.stringify(oldData) : '') + (oldCompareData ? JSON.stringify(oldCompareData) : '');

      if (newDataStr !== oldDataStr) {
        setData(currentResult);
        setCompareData(prevResult);
        renderAll();
      }
    }).catch(function(error) {
      if (error.name === 'AbortError') {
        console.log('Compare fetch aborted - newer request in progress');
        return;
      }
      onError(error);
    });
  }
}

/**
 * Refresh current data
 * Adds visual feedback and reloads data
 */
export function refreshData() {
  // Add subtle visual feedback
  var heroNumber = document.getElementById('heroProductionNumber');
  if (heroNumber) {
    heroNumber.style.transition = 'transform 0.3s, text-shadow 0.3s';
    heroNumber.style.transform = 'scale(1.05)';
    heroNumber.style.textShadow = '0 0 60px rgba(228, 170, 79, 0.6), 0 0 100px rgba(228, 170, 79, 0.3)';

    setTimeout(function() {
      heroNumber.style.transform = 'scale(1)';
      heroNumber.style.textShadow = '0 0 40px rgba(228, 170, 79, 0.4), 0 0 80px rgba(228, 170, 79, 0.2)';
    }, 300);
  }

  loadData();
}
