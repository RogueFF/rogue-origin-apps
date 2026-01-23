/**
 * Scoreboard Scale Module
 * Polls live scale weight and updates display
 */
(function(window) {
  'use strict';

  var Config = window.ScoreboardConfig;
  var State = window.ScoreboardState;
  var DOM = window.ScoreboardDOM;
  var I18n = window.ScoreboardI18n;

  // Scale-specific config
  var POLL_INTERVAL = 1000; // 1 second polling for scale
  var API_URL = (Config && Config.apiUrl) || 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production';

  /**
   * Fetch scale weight from API
   * @param {Function} onSuccess - Called with scale data
   * @param {Function} onError - Called on error
   */
  function loadScaleWeight(onSuccess, onError) {
    var url = API_URL + '?action=scaleWeight';

    fetch(url)
      .then(function(response) {
        if (!response.ok) {
          throw new Error('HTTP ' + response.status);
        }
        return response.json();
      })
      .then(function(data) {
        // Handle wrapped or direct response
        var scaleData = data.data || data;
        if (State) {
          State.scaleData = scaleData;
        }
        if (onSuccess) {
          onSuccess(scaleData);
        }
      })
      .catch(function(error) {
        console.error('Scale fetch error:', error);
        if (onError) {
          onError(error);
        }
      });
  }

  /**
   * Render scale weight display
   */
  function renderScale() {
    var scaleData = (State && State.scaleData) || null;

    // Get DOM elements
    var statusDot = DOM ? DOM.get('scaleStatusDot') : document.getElementById('scaleStatusDot');
    var weightEl = DOM ? DOM.get('scaleWeight') : document.getElementById('scaleWeight');
    var progressFill = DOM ? DOM.get('scaleProgressFill') : document.getElementById('scaleProgressFill');
    var scaleLabel = DOM ? DOM.get('scaleWeightLabel') : document.getElementById('scaleWeightLabel');

    // Update label with i18n
    if (scaleLabel && I18n && I18n.t) {
      scaleLabel.textContent = I18n.t('scaleWeight') || 'Scale';
    }

    if (!scaleData) {
      // No data yet
      if (statusDot) {
        statusDot.classList.remove('connected');
        statusDot.classList.add('stale');
      }
      if (weightEl) {
        weightEl.textContent = '—';
        weightEl.classList.remove('near-target', 'at-target');
      }
      if (progressFill) {
        progressFill.style.width = '0%';
        progressFill.classList.remove('near-target', 'at-target');
      }
      return;
    }

    var weight = scaleData.weight || 0;
    var percent = scaleData.percentComplete || 0;
    var isStale = scaleData.isStale !== false; // Default to stale if not explicitly false

    // Update status dot
    if (statusDot) {
      statusDot.classList.toggle('connected', !isStale);
      statusDot.classList.toggle('stale', isStale);
    }

    // Update weight value
    if (weightEl) {
      if (isStale) {
        weightEl.textContent = '—';
        weightEl.classList.remove('near-target', 'at-target');
      } else {
        weightEl.textContent = weight.toFixed(2) + ' kg';

        // Color states
        var isNearTarget = percent >= 90 && percent < 100;
        var isAtTarget = percent >= 100;

        weightEl.classList.toggle('near-target', isNearTarget);
        weightEl.classList.toggle('at-target', isAtTarget);
      }
    }

    // Update progress bar
    if (progressFill) {
      if (isStale) {
        progressFill.style.width = '0%';
        progressFill.classList.remove('near-target', 'at-target');
      } else {
        progressFill.style.width = Math.min(100, percent) + '%';

        var isNearTarget = percent >= 90 && percent < 100;
        var isAtTarget = percent >= 100;

        progressFill.classList.toggle('near-target', isNearTarget);
        progressFill.classList.toggle('at-target', isAtTarget);
      }
    }
  }

  /**
   * Poll scale weight and update display
   */
  function pollScale() {
    loadScaleWeight(
      function(data) {
        renderScale();
      },
      function(error) {
        // Still render (will show stale state)
        renderScale();
      }
    );
  }

  /**
   * Initialize scale polling
   */
  function init() {
    console.log('Scale module initializing...');

    // Initial poll
    pollScale();

    // Set up polling interval
    if (State && State.registerInterval) {
      State.registerInterval(pollScale, POLL_INTERVAL);
    } else {
      setInterval(pollScale, POLL_INTERVAL);
    }

    console.log('Scale module initialized');
  }

  // Expose module
  window.ScoreboardScale = {
    init: init,
    loadScaleWeight: loadScaleWeight,
    renderScale: renderScale,
    pollScale: pollScale,
  };

})(window);
