/**
 * Scoreboard Scale Module
 * Polls live scale weight and updates circular ring display
 */
(function(window) {
  'use strict';

  var Config = window.ScoreboardConfig;
  var State = window.ScoreboardState;
  var DOM = window.ScoreboardDOM;
  var I18n = window.ScoreboardI18n;

  // Scale-specific config
  var POLL_INTERVAL = 250; // 250ms polling for instant scale feel
  var API_URL = (Config && Config.apiUrl) || 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production';
  var RING_CIRCUMFERENCE = 2 * Math.PI * 95; // ~597, matches timer ring

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
        console.log('Scale data:', scaleData);
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
   * Render scale weight display (circular ring)
   */
  function renderScale() {
    var scaleData = (State && State.scaleData) || null;

    // Get DOM elements
    var statusDot = DOM ? DOM.get('scaleStatusDot') : document.getElementById('scaleStatusDot');
    var weightEl = DOM ? DOM.get('scaleWeight') : document.getElementById('scaleWeight');
    var scaleLabel = DOM ? DOM.get('scaleWeightLabel') : document.getElementById('scaleWeightLabel');
    var scaleRing = DOM ? DOM.get('scaleRing') : document.getElementById('scaleRing');
    var scaleHeader = DOM ? DOM.get('scaleHeader') : document.getElementById('scaleHeader');
    var scalePanel = document.getElementById('scale-panel');

    // Update header with i18n
    if (scaleHeader && I18n && I18n.t) {
      scaleHeader.textContent = I18n.t('scaleWeight') || 'Live Scale';
    }

    if (!scaleData) {
      // No data yet - show stale state
      if (statusDot) {
        statusDot.classList.remove('connected');
        statusDot.classList.add('stale');
      }
      if (weightEl) {
        weightEl.textContent = '—';
        weightEl.className = 'scale-value stale';
      }
      if (scaleLabel) {
        scaleLabel.textContent = 'of 5.0 kg';
      }
      if (scaleRing) {
        scaleRing.style.strokeDashoffset = RING_CIRCUMFERENCE; // Empty ring
      }
      if (scalePanel) {
        scalePanel.classList.remove('filling', 'near-target', 'at-target', 'stale');
        scalePanel.classList.add('stale');
      }
      return;
    }

    var weight = scaleData.weight || 0;
    var targetWeight = scaleData.targetWeight || 5.0;
    var percent = scaleData.percentComplete || (targetWeight > 0 ? (weight / targetWeight) * 100 : 0);
    var isStale = scaleData.isStale !== false; // Default to stale if not explicitly false

    console.log('Scale render: weight=' + weight.toFixed(2) + ', pct=' + percent.toFixed(1) + '%, cls=' + (isStale ? 'stale' : (percent >= 100 ? 'at-target' : (percent >= 90 ? 'near-target' : 'filling'))) + ', stale=' + isStale);

    // Determine color state
    var colorClass = 'filling';
    if (isStale) {
      colorClass = 'stale';
    } else if (percent >= 100) {
      colorClass = 'at-target';
    } else if (percent >= 90) {
      colorClass = 'near-target';
    }

    // Update status dot
    if (statusDot) {
      statusDot.classList.toggle('connected', !isStale);
      statusDot.classList.toggle('stale', isStale);
    }

    // Update weight value
    if (weightEl) {
      if (isStale) {
        weightEl.textContent = '—';
      } else {
        weightEl.textContent = weight.toFixed(2) + ' kg';
      }
      weightEl.className = 'scale-value ' + colorClass;
    }

    // Update label
    if (scaleLabel) {
      scaleLabel.textContent = 'of ' + targetWeight.toFixed(1) + ' kg';
    }

    // Update circular ring progress
    if (scaleRing) {
      var progress = isStale ? 0 : Math.min(1, percent / 100);
      var offset = RING_CIRCUMFERENCE * (1 - progress);
      scaleRing.style.strokeDashoffset = offset;
    }

    // Update panel color class (CSS targets #scale-panel.filling, etc.)
    if (scalePanel) {
      scalePanel.classList.remove('filling', 'near-target', 'at-target', 'stale');
      scalePanel.classList.add(colorClass);
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
