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
  var KG_TO_LBS = 2.20462;

  // Unit preference (stored in localStorage)
  var currentUnit = localStorage.getItem('scaleUnit') || 'kg';

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
   * Toggle between kg and lbs
   */
  function toggleUnit() {
    currentUnit = currentUnit === 'kg' ? 'lbs' : 'kg';
    localStorage.setItem('scaleUnit', currentUnit);

    var unitBtn = document.getElementById('unitToggle');
    if (unitBtn) {
      unitBtn.textContent = currentUnit;
    }

    renderScale(); // Re-render with new unit
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
    var scaleRingSvg = DOM ? DOM.get('scaleRing') : document.getElementById('scaleRing');
    var scaleRing = scaleRingSvg ? scaleRingSvg.querySelector('circle:last-child') : null; // Get progress circle
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
        var displayTarget = currentUnit === 'lbs' ? 5.0 * KG_TO_LBS : 5.0;
        scaleLabel.textContent = 'of ' + displayTarget.toFixed(1) + ' ' + currentUnit;
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

    // Update weight value (convert if needed)
    if (weightEl) {
      if (isStale) {
        weightEl.textContent = '—';
      } else {
        var displayWeight = currentUnit === 'lbs' ? weight * KG_TO_LBS : weight;
        var displayTarget = currentUnit === 'lbs' ? targetWeight * KG_TO_LBS : targetWeight;
        weightEl.textContent = displayWeight.toFixed(2) + ' ' + currentUnit;
      }
      weightEl.className = 'scale-value ' + colorClass;
    }

    // Update label
    if (scaleLabel) {
      var displayTarget = currentUnit === 'lbs' ? targetWeight * KG_TO_LBS : targetWeight;
      scaleLabel.textContent = 'of ' + displayTarget.toFixed(1) + ' ' + currentUnit;
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

    // Set up unit toggle button
    var unitBtn = document.getElementById('unitToggle');
    if (unitBtn) {
      unitBtn.textContent = currentUnit;
      unitBtn.addEventListener('click', toggleUnit);
    }

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
    toggleUnit: toggleUnit,
  };

})(window);
