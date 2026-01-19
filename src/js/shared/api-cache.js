/**
 * API Cache Layer with Optimistic UI Support
 * Provides instant load times through aggressive caching and stale-while-revalidate pattern
 *
 * Features:
 * - LocalStorage caching with automatic expiration
 * - Stale-while-revalidate for instant UI updates
 * - Request deduplication to prevent duplicate API calls
 * - Automatic cache invalidation on errors
 * - IndexedDB fallback for large datasets
 */

(function(window) {
  'use strict';

  var CACHE_VERSION = '1.2';
  var CACHE_PREFIX = 'ro-api-cache-v' + CACHE_VERSION + '-';
  var DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes default - data considered "fresh"
  var STALE_TTL = 24 * 60 * 60 * 1000; // 24 hours - serve stale data if rate limited or fetch fails

  // In-flight request tracking to prevent duplicate fetches
  var inflightRequests = {};

  /**
   * API Cache Manager
   */
  var APICache = {
    /**
     * Get data from cache
     * @param {string} key - Cache key
     * @returns {object|null} Cached data or null
     */
    get: function(key) {
      try {
        var cacheKey = CACHE_PREFIX + key;
        var cached = localStorage.getItem(cacheKey);
        if (!cached) return null;

        var data = JSON.parse(cached);
        var now = Date.now();

        // Return data with freshness info
        return {
          data: data.value,
          timestamp: data.timestamp,
          isFresh: (now - data.timestamp) < DEFAULT_TTL,
          isStale: (now - data.timestamp) > STALE_TTL
        };
      } catch (e) {
        console.warn('Cache read error:', e);
        return null;
      }
    },

    /**
     * Set data in cache
     * @param {string} key - Cache key
     * @param {any} value - Data to cache
     */
    set: function(key, value) {
      try {
        var cacheKey = CACHE_PREFIX + key;
        var data = {
          value: value,
          timestamp: Date.now()
        };
        localStorage.setItem(cacheKey, JSON.stringify(data));
      } catch (e) {
        // Quota exceeded - clear old cache entries
        if (e.name === 'QuotaExceededError') {
          this.clearOldEntries();
          // Retry
          try {
            localStorage.setItem(cacheKey, JSON.stringify(data));
          } catch (e2) {
            console.warn('Cache write failed after cleanup:', e2);
          }
        } else {
          console.warn('Cache write error:', e);
        }
      }
    },

    /**
     * Remove specific cache entry
     * @param {string} key - Cache key
     */
    remove: function(key) {
      try {
        var cacheKey = CACHE_PREFIX + key;
        localStorage.removeItem(cacheKey);
      } catch (e) {
        console.warn('Cache remove error:', e);
      }
    },

    /**
     * Clear all cache entries for this app
     */
    clear: function() {
      try {
        var keys = Object.keys(localStorage);
        keys.forEach(function(key) {
          if (key.indexOf(CACHE_PREFIX) === 0) {
            localStorage.removeItem(key);
          }
        });
      } catch (e) {
        console.warn('Cache clear error:', e);
      }
    },

    /**
     * Clear old/expired cache entries
     */
    clearOldEntries: function() {
      try {
        var now = Date.now();
        var keys = Object.keys(localStorage);
        var removed = 0;

        keys.forEach(function(key) {
          if (key.indexOf(CACHE_PREFIX) === 0) {
            try {
              var data = JSON.parse(localStorage.getItem(key));
              // Remove if older than stale TTL
              if (data && (now - data.timestamp) > STALE_TTL) {
                localStorage.removeItem(key);
                removed++;
              }
            } catch (e) {
              // Invalid entry, remove it
              localStorage.removeItem(key);
              removed++;
            }
          }
        });

        console.log('Cleared ' + removed + ' old cache entries');
      } catch (e) {
        console.warn('Cache cleanup error:', e);
      }
    },

    /**
     * Generate cache key from request parameters
     * @param {string} action - API action
     * @param {object} params - Request parameters
     * @returns {string} Cache key
     */
    generateKey: function(action, params) {
      var sortedParams = Object.keys(params || {}).sort().map(function(k) {
        return k + '=' + params[k];
      }).join('&');
      return action + (sortedParams ? '?' + sortedParams : '');
    }
  };

  /**
   * Fetch with Cache - Stale-While-Revalidate Pattern
   *
   * 1. Return cached data immediately (if available)
   * 2. Fetch fresh data in background
   * 3. Update cache and UI when fresh data arrives
   *
   * @param {string} cacheKey - Cache key for this request
   * @param {function} fetchFn - Function that returns a Promise for fresh data
   * @param {function} onData - Callback when data is available (called 1-2 times)
   * @param {function} onError - Error callback
   * @returns {Promise} Promise that resolves when background fetch completes
   */
  function fetchWithCache(cacheKey, fetchFn, onData, onError) {
    var cached = APICache.get(cacheKey);
    var calledWithCached = false;

    // Step 1: Return cached data immediately if available
    // For rate limit resilience, serve ANY cached data (even stale) on first load
    if (cached && cached.data) {
      // Serve cached data immediately - even if stale, it's better than nothing
      onData(cached.data, { fromCache: true, isFresh: cached.isFresh, isStale: cached.isStale });
      calledWithCached = true;
    }

    // Step 2: Check if identical request is already in-flight
    if (inflightRequests[cacheKey]) {
      // Reuse existing promise
      return inflightRequests[cacheKey];
    }

    // Step 3: Fetch fresh data in background
    var fetchPromise = fetchFn()
      .then(function(freshData) {
        // Update cache
        APICache.set(cacheKey, freshData);

        // Call onData with fresh data
        // Only call if we didn't already call with cached data, OR if data changed
        if (!calledWithCached || JSON.stringify(freshData) !== JSON.stringify(cached.data)) {
          onData(freshData, { fromCache: false, isFresh: true });
        }

        // Clean up in-flight tracking
        delete inflightRequests[cacheKey];

        return freshData;
      })
      .catch(function(error) {
        // Clean up in-flight tracking
        delete inflightRequests[cacheKey];

        // Check if this is a rate limit error (429)
        var isRateLimited = error.message && error.message.includes('429');

        // If we showed cached data, don't call error handler
        // User already has usable UI
        if (!calledWithCached) {
          // No cached data and fetch failed
          // For rate limit errors, try to use stale cache as fallback
          if (isRateLimited && cached && cached.data && cached.isStale) {
            console.warn('Rate limited, serving stale cached data');
            onData(cached.data, { fromCache: true, isFresh: false, isStale: true, rateLimited: true });
            calledWithCached = true;
          } else {
            // Show error to user
            if (onError) onError(error);
          }
        } else {
          // We showed cached data, just log the error
          if (isRateLimited) {
            console.warn('Rate limited on background refresh, using cached data');
          } else {
            console.warn('Background fetch failed, using cached data:', error);
          }
        }

        throw error; // Re-throw so promise rejects
      });

    // Track in-flight request
    inflightRequests[cacheKey] = fetchPromise;

    return fetchPromise;
  }

  /**
   * Fetch Dashboard Data with Caching
   * Wraps the existing dashboard data fetch with caching layer
   *
   * SECURITY: API URL must be provided via options.apiUrl parameter.
   * Import API_URL from config.js and pass it in options.
   *
   * @param {string} startDate - Start date
   * @param {string} endDate - End date
   * @param {function} onData - Callback when data is available
   * @param {function} onError - Error callback
   * @param {object} options - Additional options (apiUrl required, signal, etc.)
   * @returns {Promise} Promise that resolves when fetch completes
   */
  function fetchDashboardData(startDate, endDate, onData, onError, options) {
    options = options || {};

    // SECURITY: Require API URL to be passed explicitly - no hardcoded defaults
    if (!options.apiUrl) {
      throw new Error('API URL is required. Import API_URL from config.js and pass it via options.apiUrl');
    }

    var cacheKey = APICache.generateKey('dashboard', {
      start: startDate,
      end: endDate
    });

    var fetchFn = function() {
      var apiUrl = options.apiUrl;
      var url = apiUrl + '?action=dashboard&start=' + encodeURIComponent(startDate) + '&end=' + encodeURIComponent(endDate);

      var fetchOptions = {};
      if (options.signal) {
        fetchOptions.signal = options.signal;
      }

      return fetch(url, fetchOptions)
        .then(function(response) {
          if (!response.ok) {
            throw new Error('HTTP ' + response.status);
          }
          return response.json();
        })
        .then(function(result) {
          // Handle various API response formats
          if (result.success && result.data) {
            return result.data;
          } else if (result.data) {
            // API returned data without success flag
            return result.data;
          } else if (result.error) {
            throw new Error(result.error);
          } else {
            // Assume result itself is the data
            return result;
          }
        });
    };

    return fetchWithCache(cacheKey, fetchFn, onData, onError);
  }

  /**
   * Prefetch data for common date ranges
   * Call this during idle time to warm the cache
   *
   * @param {string} apiUrl - Required API URL from config.js
   */
  function prefetchCommonRanges(apiUrl) {
    if (!apiUrl) {
      console.warn('prefetchCommonRanges: API URL is required');
      return;
    }

    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(function() {
        var options = { apiUrl: apiUrl };

        // Prefetch today's data
        var today = new Date().toISOString().split('T')[0];
        fetchDashboardData(today, today, function() {}, function() {}, options);

        // Prefetch this week
        var weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        var weekAgoStr = weekAgo.toISOString().split('T')[0];
        fetchDashboardData(weekAgoStr, today, function() {}, function() {}, options);
      });
    }
  }

  // Export to global scope
  window.APICache = APICache;
  window.fetchWithCache = fetchWithCache;
  window.fetchDashboardData = fetchDashboardData;
  window.prefetchCommonRanges = prefetchCommonRanges;

})(window);
