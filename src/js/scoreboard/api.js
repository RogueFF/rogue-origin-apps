/**
 * Scoreboard API Communication Module
 * Handles dual-mode communication (Apps Script vs GitHub Pages)
 *
 * @module ScoreboardAPI
 */
(function(window) {
  'use strict';

  var ScoreboardAPI = {
    /**
     * Detect if running inside Google Apps Script container
     * @returns {boolean} True if Apps Script environment detected
     */
    isAppsScript: function() {
      return typeof google !== 'undefined' && google.script && google.script.run;
    },

    /**
     * Get API URL from config or fallback to production
     * @returns {string} API endpoint URL
     */
    getApiUrl: function() {
      var config = window.ScoreboardConfig;
      return (config && config.API_URL) ||
        'https://script.google.com/macros/s/AKfycbxDAHSFl9cedGS49L3Lf5ztqy-SSToYigyA30ZtsdpmWNAR9H61X_Mm48JOOTGqqr-Z/exec';
    },

    /**
     * Load scoreboard data (scoreboard + timer)
     * @param {Function} onSuccess - Callback with response data {scoreboard: ..., timer: ...}
     * @param {Function} onError - Error callback
     */
    loadData: function(onSuccess, onError) {
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
        var apiUrl = this.getApiUrl();

        // Try api-cache.js if available
        if (window.ScoreboardAPICache && window.ScoreboardAPICache.get) {
          var cached = window.ScoreboardAPICache.get('scoreboard');
          if (cached) {
            if (onSuccess) onSuccess(cached);
            return;
          }
        }

        fetch(apiUrl + '?action=scoreboard')
          .then(function(response) {
            if (!response.ok) {
              throw new Error('HTTP ' + response.status + ': ' + response.statusText);
            }
            return response.json();
          })
          .then(function(response) {
            // Cache response if api-cache.js available
            if (window.ScoreboardAPICache && window.ScoreboardAPICache.set) {
              window.ScoreboardAPICache.set('scoreboard', response);
            }
            if (onSuccess) onSuccess(response);
          })
          .catch(function(error) {
            console.error('Fetch loadData error:', error);
            if (onError) onError(error);
          });
      }
    },

    /**
     * Log bag completion
     * @param {Function} onSuccess - Success callback
     * @param {Function} onError - Error callback
     */
    logBag: function(onSuccess, onError) {
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
        // Running on GitHub Pages - use fetch API
        var apiUrl = this.getApiUrl();

        fetch(apiUrl + '?action=logBag', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        })
          .then(function(response) {
            if (!response.ok) {
              throw new Error('HTTP ' + response.status + ': ' + response.statusText);
            }
            return response.json();
          })
          .then(function(response) {
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
        // Running on GitHub Pages - use fetch API
        // CRITICAL: Use text/plain to avoid CORS preflight
        var apiUrl = this.getApiUrl();

        fetch(apiUrl + '?action=logPause', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ reason: data.reason })
        })
          .then(function(response) {
            if (!response.ok) {
              throw new Error('HTTP ' + response.status + ': ' + response.statusText);
            }
            return response.json();
          })
          .then(function(response) {
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
        // Running on GitHub Pages - use fetch API
        // CRITICAL: Use text/plain to avoid CORS preflight
        var apiUrl = this.getApiUrl();

        fetch(apiUrl + '?action=logResume', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            pauseId: data.pauseId,
            duration: data.duration
          })
        })
          .then(function(response) {
            if (!response.ok) {
              throw new Error('HTTP ' + response.status + ': ' + response.statusText);
            }
            return response.json();
          })
          .then(function(response) {
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
     */
    setShiftStart: function(startTime, onSuccess, onError) {
      if (this.isAppsScript()) {
        google.script.run
          .withSuccessHandler(onSuccess)
          .withFailureHandler(onError)
          .handleSetShiftStart({ time: startTime.toISOString() });
      } else {
        var apiUrl = this.getApiUrl();
        var url = apiUrl + '?action=setShiftStart&time=' + encodeURIComponent(startTime.toISOString());

        fetch(url)
          .then(function(response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
          })
          .then(onSuccess)
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
        var apiUrl = this.getApiUrl();
        // Let backend determine "today" in its timezone (PST)
        var url = apiUrl + '?action=getShiftStart';

        fetch(url)
          .then(function(response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
          })
          .then(onSuccess)
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
        // Running on GitHub Pages - use fetch API
        var apiUrl = this.getApiUrl();

        fetch(apiUrl + '?action=getScoreboardOrderQueue')
          .then(function(response) {
            if (!response.ok) {
              throw new Error('HTTP ' + response.status + ': ' + response.statusText);
            }
            return response.json();
          })
          .then(function(response) {
            // Store in state if available
            if (window.ScoreboardState) {
              window.ScoreboardState.orderQueue = response;
            }
            if (onSuccess) onSuccess(response);
          })
          .catch(function(error) {
            console.error('Fetch loadOrderQueue error:', error);
            if (onError) onError(error);
          });
      }
    }
  };

  // Export to global scope
  window.ScoreboardAPI = ScoreboardAPI;

})(window);
