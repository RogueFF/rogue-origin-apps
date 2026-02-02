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
  setSkeletonsShowing as _setSkeletonsShowing,
  incrementRetryCount,
  resetRetryCount,
  setFallback,
  clearFallback
} from './state.js';
import { formatDateInput } from './utils.js';
import {
  showConnecting,
  showConnected,
  showError,
  showRetrying,
  shouldAutoRetry
} from './status.js';

// Race condition fix: Track request counter to discard stale responses
let requestCounter = 0;

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
 * Get user-friendly error message from error object
 * @param {Error} error - The error object
 * @returns {string} User-friendly error message
 */
function getUserFriendlyErrorMessage(error) {
  try {
    const errorMessage = error.message || String(error);
    
    // Network errors
    if (errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError')) {
      return 'Network connection failed. Please check your internet connection.';
    }
    
    // Timeout errors
    if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
      return 'Request timed out. The server took too long to respond.';
    }
    
    // HTTP status errors
    if (errorMessage.includes('HTTP 429')) {
      return 'Too many requests. Using cached data.';
    }
    if (errorMessage.includes('HTTP 500') || errorMessage.includes('HTTP 502') || errorMessage.includes('HTTP 503')) {
      return 'Server error. Please try again in a moment.';
    }
    if (errorMessage.includes('HTTP 401') || errorMessage.includes('HTTP 403')) {
      return 'Authentication error. Please refresh the page.';
    }
    if (errorMessage.includes('HTTP 404')) {
      return 'Data not found. Please try a different date range.';
    }
    if (errorMessage.includes('HTTP')) {
      const statusMatch = errorMessage.match(/HTTP (\d+)/);
      if (statusMatch) {
        return `Server returned error (${statusMatch[1]}). Please try again.`;
      }
    }
    
    // Parse errors
    if (errorMessage.includes('JSON') || errorMessage.includes('parse')) {
      return 'Invalid data received from server. Please refresh the page.';
    }
    
    // Generic fallback - keep it user-friendly
    if (errorMessage.length > 100) {
      return 'An error occurred. Please try again or refresh the page.';
    }
    
    return errorMessage;
  } catch (e) {
    return 'An unexpected error occurred. Please refresh the page.';
  }
}

/**
 * Error handler for API requests
 * @param {Error} error - The error object
 * @param {boolean} skipAutoRetry - Skip auto-retry logic (default: false)
 */
export function onError(error, skipAutoRetry = false) {
  try {
    console.error('API Error:', error);

    // Hide loading overlay if present
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
      loadingOverlay.classList.add('hidden');
    }

    showSkeletons(false);

    // Detect rate limit errors (HTTP 429)
    const errorMessage = error.message || String(error);
    const isRateLimited = errorMessage.includes('429');
    
    // Get user-friendly error message
    const userMessage = getUserFriendlyErrorMessage(error);

    // Show appropriate error message
    if (isRateLimited) {
      showError('Rate limited - using cached data');
      // For rate limit errors, don't show toast - it's normal during high traffic
      // The cache layer should provide data
    } else {
      showError(userMessage);
      // Show toast only if not auto-retrying
      if (!shouldAutoRetry() || skipAutoRetry) {
        showToast(userMessage, 'error', 5000);
      }
    }

    // Auto-retry logic with different delays for different errors
    if (shouldAutoRetry() && !skipAutoRetry) {
      // Use longer delay for rate limit errors (30s), shorter for other errors (5s)
      const retryDelay = isRateLimited ? 30000 : 5000;
      const delayText = isRateLimited ? '30 seconds' : '5 seconds';

      if (isRateLimited) {
        console.log(`Rate limited - will retry in ${delayText}...`);
      } else {
        console.log(`Auto-retry in ${delayText}...`);
      }

      setTimeout(function() {
        console.log('Auto-retry after error...');
        showRetrying();
        incrementRetryCount();
        loadData();
      }, retryDelay);
    }
  } catch (handlerError) {
    // Error in error handler - log but don't crash
    console.error('Error in error handler:', handlerError);
  }
}

/**
 * Handler for successful data load
 * @param {object} result - The data result from API
 */
function onDataLoaded(result) {
  try {
    showSkeletons(false);

    // Validate result data
    if (!result || typeof result !== 'object') {
      throw new Error('Invalid data format received from API');
    }

    // Show connected state
    const isFirstLoad = !getData();
    showConnected(!isFirstLoad); // Auto-hide on subsequent loads

    // Reset retry count on success
    resetRetryCount();

    // Handle fallback data (showing previous working day when today has no data)
    if (result.fallback && result.fallback.active) {
      try {
        setFallback(result.fallback);
        // Format the fallback date nicely
        const fallbackDate = new Date(result.fallback.date + 'T12:00:00');
        const dateStr = fallbackDate.toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'short',
          day: 'numeric'
        });
        showToast(`Showing last working day: ${dateStr}`, 'info', 5000);
      } catch (dateError) {
        console.warn('Error formatting fallback date:', dateError);
        clearFallback();
      }
    } else {
      clearFallback();
    }

    // Only re-render if data actually changed
    const newDataStr = JSON.stringify(result);
    const oldData = getData();
    const oldDataStr = oldData ? JSON.stringify(oldData) : '';

    if (newDataStr !== oldDataStr) {
      setData(result);
      renderAll();

      // Show subtle update notification (only on auto-refresh, not initial load)
      if (oldDataStr && !result.fallback) {
        showToast('Data updated', 'success', 2000);
      }
    }

    return isFirstLoad;
  } catch (error) {
    console.error('Error in onDataLoaded:', error);
    // Don't call onError here to avoid retry loop - just show a toast
    showToast('Error processing data. Please refresh the page.', 'error', 5000);
    showSkeletons(false);
    return false;
  }
}

/**
 * Load data for the current date range
 * Main data loading function
 */
export function loadData() {
  const startEl = document.getElementById('startDate');
  const endEl = document.getElementById('endDate');
  const s = startEl ? startEl.value : formatDateInput(new Date());
  const e = endEl ? endEl.value : formatDateInput(new Date());

  // Race condition fix: Assign unique ID to this request
  const requestId = ++requestCounter;

  // Show connecting state
  showConnecting();

  // Cancel any in-flight fetch requests to prevent stale data from overwriting current data
  // This fixes race conditions when user rapidly changes date range
  const controller = getFetchController();
  if (controller) {
    controller.abort();
  }
  const newController = new AbortController();
  setFetchController(newController);
  const signal = newController.signal;

  // Wrapper to check if response is from latest request
  const onDataLoadedChecked = function(result) {
    if (requestId !== requestCounter) {
      console.debug('Discarding stale API response (request #' + requestId + ', current #' + requestCounter + ')');
      return;
    }
    onDataLoaded(result);
  };

  if (isAppsScript()) {
    // Apps Script mode - use google.script.run
    // Only show skeletons on initial load (no existing data)
    if (!getData()) {
      showSkeletons(true);
    }
    google.script.run
      .withSuccessHandler(onDataLoadedChecked)
      .withFailureHandler(onError)
      .getProductionDashboardData(s, e);
  } else {
    // GitHub Pages mode - use caching layer with optimistic UI
    let isFirstCallForThisRequest = true;
    const existingData = getData();

    // Check if fetchDashboardData helper is available (from api-cache.js)
    if (typeof window.fetchDashboardData === 'function') {
      window.fetchDashboardData(
        s,
        e,
        function(fetchedData, meta) {
          // Race condition check: discard stale responses
          if (requestId !== requestCounter) {
            console.debug('Discarding stale API response (request #' + requestId + ', current #' + requestCounter + ')');
            return;
          }

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
          console.debug('Fetch aborted - newer request in progress');

        }
        // Error already handled by onError callback in fetchDashboardData
      });

      // Only show skeletons on initial load (no existing data and no cache)
      if (!existingData) {
        // Check if we have cached data
        if (typeof window.APICache !== 'undefined') {
          const cacheKey = window.APICache.generateKey('dashboard', { start: s, end: e });
          const cached = window.APICache.get(cacheKey);
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

      const url = `${API_URL}?action=dashboard&start=${encodeURIComponent(s)}&end=${encodeURIComponent(e)}`;

      fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: signal
      })
      .then(function(response) {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then(function(result) {
        // Race condition check: discard stale responses
        if (requestId !== requestCounter) {
          console.debug('Discarding stale API response (request #' + requestId + ', current #' + requestCounter + ')');
          return;
        }

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
          console.debug('Fetch aborted - newer request in progress');
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
  let compareMode = null;
  const compareModeEl = document.querySelector('[data-compare-mode].active');
  if (compareModeEl) {
    compareMode = compareModeEl.dataset.compareMode;
  }

  if (!compareMode) {
    // No compare mode active
    setCompareData(null);
    return;
  }

  // Show connecting state
  showConnecting();

  // Only show skeletons on initial load (no existing data)
  if (!getData()) {
    showSkeletons(true);
  }

  const today = new Date();
  let cs, ce, ps, pe;

  if (compareMode === 'yesterday') {
    cs = ce = formatDateInput(today);
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    ps = pe = formatDateInput(y);
  } else if (compareMode === 'lastWeek') {
    const ws = new Date(today);
    ws.setDate(today.getDate() - today.getDay());
    cs = formatDateInput(ws);
    ce = formatDateInput(today);
    const pws = new Date(ws);
    pws.setDate(pws.getDate() - 7);
    const pwe = new Date(ws);
    pwe.setDate(pwe.getDate() - 1);
    ps = formatDateInput(pws);
    pe = formatDateInput(pwe);
  } else if (compareMode === 'lastMonth') {
    const ms = new Date(today.getFullYear(), today.getMonth(), 1);
    cs = formatDateInput(ms);
    ce = formatDateInput(today);
    const pms = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const pme = new Date(today.getFullYear(), today.getMonth(), 0);
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
        showConnected(true); // Auto-hide
        resetRetryCount();

        // Only re-render if data actually changed
        const newDataStr = JSON.stringify(r) + JSON.stringify(pr);
        const oldData = getData();
        const oldCompareData = getCompareData();
        const oldDataStr = (oldData ? JSON.stringify(oldData) : '') + (oldCompareData ? JSON.stringify(oldCompareData) : '');

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
  const controller = getFetchController();
  if (controller) {
    controller.abort();
  }
  const newController = new AbortController();
  setFetchController(newController);
  const signal = newController.signal;

  // Check if fetchDashboardData helper is available
  if (typeof window.fetchDashboardData === 'function') {
    // Use caching for both current and previous period
    const currentPromise = new Promise(function(resolve, reject) {
      window.fetchDashboardData(cs, ce, resolve, reject, { apiUrl: API_URL, signal: signal });
    });

    const prevPromise = new Promise(function(resolve, reject) {
      window.fetchDashboardData(ps, pe, resolve, reject, { apiUrl: API_URL, signal: signal });
    });

    Promise.all([currentPromise, prevPromise]).then(function(results) {
      showSkeletons(false);
      showConnected(true); // Auto-hide
      resetRetryCount();

      const currentResult = results[0];
      const prevResult = results[1];

      const newDataStr = JSON.stringify(currentResult) + JSON.stringify(prevResult);
      const oldData = getData();
      const oldCompareData = getCompareData();
      const oldDataStr = (oldData ? JSON.stringify(oldData) : '') + (oldCompareData ? JSON.stringify(oldCompareData) : '');

      if (newDataStr !== oldDataStr) {
        setData(currentResult);
        setCompareData(prevResult);
        renderAll();
      }
    }).catch(function(error) {
      // Ignore AbortError - this is expected when request is cancelled
      if (error.name === 'AbortError') {
        console.debug('Compare fetch aborted - newer request in progress');
        return;
      }
      onError(error);
    });
  } else {
    // Fallback: Direct fetch without caching
    const currentUrl = `${API_URL}?action=dashboard&start=${encodeURIComponent(cs)}&end=${encodeURIComponent(ce)}`;
    const prevUrl = `${API_URL}?action=dashboard&start=${encodeURIComponent(ps)}&end=${encodeURIComponent(pe)}`;

    const fetchOptions = {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: signal
    };

    Promise.all([
      fetch(currentUrl, fetchOptions).then(function(r) { return r.json(); }),
      fetch(prevUrl, fetchOptions).then(function(r) { return r.json(); })
    ]).then(function(results) {
      showSkeletons(false);
      showConnected(true); // Auto-hide
      resetRetryCount();

      const currentResult = results[0].data || results[0];
      const prevResult = results[1].data || results[1];

      const newDataStr = JSON.stringify(currentResult) + JSON.stringify(prevResult);
      const oldData = getData();
      const oldCompareData = getCompareData();
      const oldDataStr = (oldData ? JSON.stringify(oldData) : '') + (oldCompareData ? JSON.stringify(oldCompareData) : '');

      if (newDataStr !== oldDataStr) {
        setData(currentResult);
        setCompareData(prevResult);
        renderAll();
      }
    }).catch(function(error) {
      if (error.name === 'AbortError') {
        console.debug('Compare fetch aborted - newer request in progress');
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
  const heroNumber = document.getElementById('heroProductionNumber');
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
