/**
 * Scoreboard API Communication Module
 * Handles dual-mode communication (Apps Script vs GitHub Pages)
 *
 * @module ScoreboardAPI
 */
(function(window) {
  'use strict';

  // Track last known version for smart polling
  let lastKnownVersion = null;

  const ScoreboardAPI = {
    /**
     * Detect if running inside Google Apps Script container
     * @returns {boolean} True if Apps Script environment detected
     */
    isAppsScript: function() {
      return typeof google !== 'undefined' && google.script && google.script.run;
    },

    /**
     * Check if data has changed (lightweight version check)
     * @param {Function} onChanged - Called with true if data changed, false if same
     * @param {Function} onError - Error callback
     */
    checkVersion: function(onChanged, onError) {
      if (this.isAppsScript()) {
        // Apps Script doesn't support version checking, always report changed
        if (onChanged) onChanged(true);
        return;
      }

      const apiUrl = this.getApiUrl();

      fetch(`${apiUrl}?action=version`)
        .then(function(response) {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          return response.json();
        })
        .then(function(raw) {
          const response = raw.data || raw;
          const currentVersion = response.version;

          // First check - always report changed to load initial data
          if (lastKnownVersion === null) {
            lastKnownVersion = currentVersion;
            if (onChanged) onChanged(true);
            return;
          }

          // Compare versions
          if (currentVersion !== lastKnownVersion) {
            lastKnownVersion = currentVersion;
            if (onChanged) onChanged(true);
          } else {
            if (onChanged) onChanged(false);
          }
        })
        .catch(function(error) {
          console.error('checkVersion error:', error);
          // On error, report changed to trigger data fetch as fallback
          if (onChanged) onChanged(true);
        });
    },

    /**
     * Get last known version (for debugging)
     */
    getLastKnownVersion: function() {
      return lastKnownVersion;
    },

    /**
     * Get API URL from config or fallback to production
     * @returns {string} API endpoint URL
     */
    getApiUrl: function() {
      const config = window.ScoreboardConfig;
      return (config && config.API_URL) ||
        'https://rogue-origin-apps-master.vercel.app/api/production';
    },

    /**
     * Get Wholesale Orders API URL (separate backend for order management)
     * @returns {string} Wholesale orders API endpoint URL
     */
    getWholesaleApiUrl: function() {
      const config = window.ScoreboardConfig;
      return (config && config.WHOLESALE_API_URL) ||
        'https://rogue-origin-apps-master.vercel.app/api/orders';
    },

    /**
     * Load scoreboard data (scoreboard + timer)
     * @param {Function} onSuccess - Callback with response data {scoreboard: ..., timer: ...}
     * @param {Function} onError - Error callback
     * @param {string} date - Optional date for historical data (YYYY-MM-DD format)
     */
    loadData: function(onSuccess, onError, date) {
      if (this.isAppsScript()) {
        // Running inside Google Apps Script web app
        google.script.run
          .withSuccessHandler(function(response) {
            if (onSuccess) onSuccess(response);
          })
          .withFailureHandler(function(error) {
            console.error('Apps Script loadData error:', error);
            if (onError) onError(error);
          })
          .getScoreboardWithTimerData();
      } else {
        // Running on GitHub Pages - use fetch API
        const apiUrl = this.getApiUrl();

        // Build URL with optional date parameter
        let url = `${apiUrl}?action=scoreboard`;
        if (date) {
          url += `&date=${encodeURIComponent(date)}`;
        }

        // Try api-cache.js if available - serve cached data immediately (only for live view)
        let cachedData = null;
        if (!date && window.ScoreboardAPICache && window.ScoreboardAPICache.get) {
          cachedData = window.ScoreboardAPICache.get('scoreboard');
          if (cachedData) {
            // Serve cached data immediately for instant UI
            if (onSuccess) onSuccess(cachedData);
          }
        }

        fetch(url)
          .then(function(response) {
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response.json();
          })
          .then(function(raw) {
            // Handle Vercel response wrapper
            const response = raw.data || raw;
            // Cache response if api-cache.js available (only for live view)
            if (!date && window.ScoreboardAPICache && window.ScoreboardAPICache.set) {
              window.ScoreboardAPICache.set('scoreboard', response);
            }
            // Only call onSuccess if this is fresh data (not already served from cache)
            // or if data has changed (or if viewing historical data)
            if (date || !cachedData || JSON.stringify(response) !== JSON.stringify(cachedData)) {
              if (onSuccess) onSuccess(response);
            }
          })
          .catch(function(error) {
            // Check if this is a rate limit error (429)
            const isRateLimited = error.message && error.message.includes('429');

            if (isRateLimited) {
              console.warn('Rate limited, using cached data if available');
              // If we already served cached data, don't show error
              if (!cachedData && window.ScoreboardAPICache && window.ScoreboardAPICache.get) {
                // Try to get any cached data as fallback
                const staleCache = window.ScoreboardAPICache.get('scoreboard');
                if (staleCache) {
                  console.warn('Serving stale cached data due to rate limit');
                  if (onSuccess) onSuccess(staleCache);
                  return;
                }
              }
              // Only show error if we have no cached data at all
              if (!cachedData) {
                console.error('Rate limited with no cached data:', error);
                if (onError) onError(error);
              }
            } else {
              console.error('Fetch loadData error:', error);
              // If we already served cached data, don't show error to user
              if (!cachedData) {
                if (onError) onError(error);
              }
            }
          });
      }
    },

    /**
     * Log bag completion
     * @param {Object} data - Bag data (e.g., { size: '5 kg.' })
     * @param {Function} onSuccess - Success callback
     * @param {Function} onError - Error callback
     */
    logBag: function(data, onSuccess, onError) {
      if (this.isAppsScript()) {
        // Running inside Google Apps Script web app
        google.script.run
          .withSuccessHandler(function(response) {
            if (onSuccess) onSuccess(response);
          })
          .withFailureHandler(function(error) {
            console.error('Apps Script logBag error:', error);
            if (onError) onError(error);
          })
          .logManualBagCompletion();
      } else {
        // Running on GitHub Pages - use fetch API (Vercel Functions)
        const apiUrl = this.getApiUrl();

        fetch(`${apiUrl}?action=logBag`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data || { size: '5 kg.' })
        })
          .then(function(response) {
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response.json();
          })
          .then(function(raw) {
            // Handle Vercel response wrapper
            const response = raw.data || raw;
            if (onSuccess) onSuccess(response);
          })
          .catch(function(error) {
            console.error('Fetch logBag error:', error);
            if (onError) onError(error);
          });
      }
    },

    /**
     * Log timer pause
     * @param {Object} data - Pause data {reason: string}
     * @param {Function} onSuccess - Success callback
     * @param {Function} onError - Error callback
     */
    logPause: function(data, onSuccess, onError) {
      if (!data || !data.reason) {
        console.error('logPause requires data.reason');
        if (onError) onError(new Error('Missing pause reason'));
        return;
      }

      if (this.isAppsScript()) {
        // Running inside Google Apps Script web app
        google.script.run
          .withSuccessHandler(function(response) {
            if (onSuccess) onSuccess(response);
          })
          .withFailureHandler(function(error) {
            console.error('Apps Script logPause error:', error);
            if (onError) onError(error);
          })
          .logTimerPause(data.reason);
      } else {
        // Running on GitHub Pages - use fetch API (Vercel Functions)
        const apiUrl = this.getApiUrl();

        fetch(`${apiUrl}?action=logPause`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: data.reason })
        })
          .then(function(response) {
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response.json();
          })
          .then(function(raw) {
            // Handle Vercel response wrapper
            const response = raw.data || raw;
            if (onSuccess) onSuccess(response);
          })
          .catch(function(error) {
            console.error('Fetch logPause error:', error);
            if (onError) onError(error);
          });
      }
    },

    /**
     * Log timer resume
     * @param {Object} data - Resume data {pauseId: string, duration: number}
     * @param {Function} onSuccess - Success callback
     * @param {Function} onError - Error callback
     */
    logResume: function(data, onSuccess, onError) {
      if (!data || !data.pauseId || typeof data.duration !== 'number') {
        console.error('logResume requires data.pauseId and data.duration');
        if (onError) onError(new Error('Missing pauseId or duration'));
        return;
      }

      if (this.isAppsScript()) {
        // Running inside Google Apps Script web app
        google.script.run
          .withSuccessHandler(function(response) {
            if (onSuccess) onSuccess(response);
          })
          .withFailureHandler(function(error) {
            console.error('Apps Script logResume error:', error);
            if (onError) onError(error);
          })
          .logTimerResume(data.pauseId, data.duration);
      } else {
        // Running on GitHub Pages - use fetch API (Vercel Functions)
        const apiUrl = this.getApiUrl();

        fetch(`${apiUrl}?action=logResume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pauseId: data.pauseId,
            duration: data.duration
          })
        })
          .then(function(response) {
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response.json();
          })
          .then(function(raw) {
            // Handle Vercel response wrapper
            const response = raw.data || raw;
            if (onSuccess) onSuccess(response);
          })
          .catch(function(error) {
            console.error('Fetch logResume error:', error);
            if (onError) onError(error);
          });
      }
    },

    /**
     * Set shift start time
     * @param {Date|null} startTime - Optional start time (null = use current server time)
     */
    setShiftStart: function(startTime, onSuccess, onError) {
      if (this.isAppsScript()) {
        const params = startTime ? { time: startTime.toISOString() } : {};
        google.script.run
          .withSuccessHandler(onSuccess)
          .withFailureHandler(onError)
          .handleSetShiftStart(params);
      } else {
        const apiUrl = this.getApiUrl();
        const url = startTime
          ? `${apiUrl}?action=setShiftStart&time=${encodeURIComponent(startTime.toISOString())}`
          : `${apiUrl}?action=setShiftStart`;

        fetch(url)
          .then(function(response) {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .then(function(raw) {
            // Handle Vercel response wrapper
            const response = raw.data || raw;
            if (onSuccess) onSuccess(response);
          })
          .catch(function(error) {
            console.error('setShiftStart error:', error);
            if (onError) onError(error);
          });
      }
    },

    /**
     * Get today's shift start adjustment
     */
    getShiftStart: function(onSuccess, onError) {
      if (this.isAppsScript()) {
        google.script.run
          .withSuccessHandler(onSuccess)
          .withFailureHandler(onError)
          .handleGetShiftStart({});
      } else {
        const apiUrl = this.getApiUrl();
        // Let backend determine "today" in its timezone (PST)
        const url = `${apiUrl}?action=getShiftStart`;

        fetch(url)
          .then(function(response) {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .then(function(raw) {
            // Handle Vercel response wrapper
            const response = raw.data || raw;
            if (onSuccess) onSuccess(response);
          })
          .catch(function(error) {
            console.error('getShiftStart error:', error);
            if (onError) onError(error);
          });
      }
    },

    /**
     * Load order queue for scoreboard display
     * @param {Function} onSuccess - Callback with response data {current: ..., next: ..., queue: ...}
     * @param {Function} onError - Error callback
     */
    loadOrderQueue: function(onSuccess, onError) {
      if (this.isAppsScript()) {
        // Running inside Google Apps Script web app
        google.script.run
          .withSuccessHandler(function(response) {
            // Store in state if available
            if (window.ScoreboardState) {
              window.ScoreboardState.orderQueue = response;
            }
            if (onSuccess) onSuccess(response);
          })
          .withFailureHandler(function(error) {
            console.error('Apps Script loadOrderQueue error:', error);
            if (onError) onError(error);
          })
          .getScoreboardOrderQueue();
      } else {
        // Running on GitHub Pages - use fetch API to wholesale orders backend (Vercel)
        const apiUrl = this.getWholesaleApiUrl();

        // Check for cached order queue data
        let cachedOrders = null;
        if (window.ScoreboardState && window.ScoreboardState.orderQueue) {
          cachedOrders = window.ScoreboardState.orderQueue;
        }

        fetch(`${apiUrl}?action=getScoreboardOrderQueue`)
          .then(function(response) {
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response.json();
          })
          .then(function(raw) {
            // Handle Vercel response wrapper
            const response = raw.data || raw;
            // Store in state if available
            if (window.ScoreboardState) {
              window.ScoreboardState.orderQueue = response;
            }
            if (onSuccess) onSuccess(response);
          })
          .catch(function(error) {
            // Check if this is a rate limit error (429)
            const isRateLimited = error.message && error.message.includes('429');

            if (isRateLimited) {
              console.warn('Order queue rate limited, using cached data if available');
              if (cachedOrders) {
                // Use existing cached order queue data
                if (onSuccess) onSuccess(cachedOrders);
                return;
              }
            }

            console.error('Fetch loadOrderQueue error:', error);
            if (onError) onError(error);
          });
      }
    }
  };

  // Export to global scope
  window.ScoreboardAPI = ScoreboardAPI;

})(window);
