/**
 * Scoreboard Scale Module
 * Polls live scale weight and updates circular ring display
 */
(function(window) {
  'use strict';

  var Config = window.ScoreboardConfig;
  var State = window.ScoreboardState;
  var DOM = window.ScoreboardDOM;

  // Scale-specific config
  var POLL_INTERVAL = 250; // 250ms polling for instant scale feel
  var API_URL = (Config && Config.apiUrl) || 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production';
  var RING_CIRCUMFERENCE = 2 * Math.PI * 95; // ~597, matches timer ring

  // Display unit is grams. API delivers kg, we render kg * 1000.
  function fmtGrams(kg) { return Math.round((kg || 0) * 1000) + ' g'; }

  // Bag-complete button gating.
  // 5kg: Target gross weight = 5000g product + 136.08g Grove Bag = 5136.08g
  // Acceptable window: -30g squish tolerance, +90.72g overage cap (= 0.2 lb)
  var BAG_GATE_MIN_GRAMS = 5196;
  var BAG_GATE_MAX_GRAMS = 5317;

  // 10lb: gross weight window for a 10lb bag (incl. Grove Bag tare).
  var BAG10LB_GATE_MIN_GRAMS = 4642;
  var BAG10LB_GATE_MAX_GRAMS = 4763;

  function applyGate(btn, inRange, grams, minG, maxG) {
    btn.dataset.gated = String(!inRange);
    // Don't toggle disabled mid-API-call — the click handler owns it then.
    if (!btn.dataset.busy) btn.disabled = !inRange;
    btn.setAttribute('aria-disabled', String(!inRange));
    btn.title = inRange
      ? ''
      : 'Scale reads ' + grams + ' g — bag must be ' + minG + '–' + maxG + ' g (with bag) to log.';
  }

  function clearGate(btn) {
    btn.dataset.gated = 'false';
    if (!btn.dataset.busy) btn.disabled = false;
    btn.removeAttribute('title');
    btn.removeAttribute('aria-disabled');
  }

  function gateBagButton(scaleData) {
    var btn5 = DOM && DOM.get ? DOM.get('manualBtn') : document.getElementById('manualBtn');
    if (!btn5) btn5 = document.getElementById('manualBtn');
    var btn10 = DOM && DOM.get ? DOM.get('manualBtn10lb') : document.getElementById('manualBtn10lb');
    if (!btn10) btn10 = document.getElementById('manualBtn10lb');
    if (!btn5 && !btn10) return;

    // Visibility is driven by the app-side bag_mode setting (toggle on v2 scoreboard).
    // scaleData.bagMode is the source of truth; fallback to '5kg' if absent.
    var mode = (scaleData && scaleData.bagMode) || '5kg';
    if (mode === '10lb') {
      if (btn5) btn5.style.display = 'none';
      if (btn10) btn10.style.display = '';
    } else {
      if (btn5) btn5.style.display = '';
      if (btn10) btn10.style.display = 'none';
    }

    // Scale offline → disable buttons (strict gate). Operator must have a
    // working scale to log bags so weights are always verified.
    var isStale = !scaleData || scaleData.isStale !== false;
    if (isStale) {
      var staleMsg = 'Scale offline — bag cannot be logged until scale reconnects.';
      if (btn5) {
        btn5.dataset.gated = 'true';
        if (!btn5.dataset.busy) btn5.disabled = true;
        btn5.setAttribute('aria-disabled', 'true');
        btn5.title = staleMsg;
      }
      if (btn10) {
        btn10.dataset.gated = 'true';
        if (!btn10.dataset.busy) btn10.disabled = true;
        btn10.setAttribute('aria-disabled', 'true');
        btn10.title = staleMsg;
      }
      return;
    }

    var grams = Math.round((scaleData.weight || 0) * 1000);

    if (btn5) {
      var in5kg = grams >= BAG_GATE_MIN_GRAMS && grams <= BAG_GATE_MAX_GRAMS;
      applyGate(btn5, in5kg, grams, BAG_GATE_MIN_GRAMS, BAG_GATE_MAX_GRAMS);
    }
    if (btn10) {
      var in10lb = grams >= BAG10LB_GATE_MIN_GRAMS && grams <= BAG10LB_GATE_MAX_GRAMS;
      applyGate(btn10, in10lb, grams, BAG10LB_GATE_MIN_GRAMS, BAG10LB_GATE_MAX_GRAMS);
    }
  }

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
    var scaleRing = DOM ? DOM.get('scaleRing') : document.getElementById('scaleRing'); // circle element directly
    var scaleHeader = DOM ? DOM.get('scaleHeader') : document.getElementById('scaleHeader');
    var scalePanel = document.getElementById('scale-panel');

    // Update header with i18n
    if (scaleHeader && typeof window.t === 'function') {
      scaleHeader.textContent = window.t('scaleWeight') || 'Live Scale';
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
        scaleLabel.textContent = 'of ' + fmtGrams(5.0);
      }
      if (scaleRing) {
        scaleRing.style.strokeDashoffset = RING_CIRCUMFERENCE; // Empty ring
      }
      if (scalePanel) {
        scalePanel.classList.remove('filling', 'near-target', 'at-target', 'stale');
        scalePanel.classList.add('stale');
      }
      gateBagButton(null);
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

    // Update weight value (always grams)
    if (weightEl) {
      weightEl.textContent = isStale ? '—' : fmtGrams(weight);
      weightEl.className = 'scale-value ' + colorClass;
    }

    // Update label (target in grams)
    if (scaleLabel) {
      scaleLabel.textContent = 'of ' + fmtGrams(targetWeight);
    }

    // Update circular ring progress
    if (scaleRing) {
      var progress = isStale ? 0 : Math.min(1, percent / 100);
      var offset = RING_CIRCUMFERENCE * (1 - progress);
      scaleRing.style.strokeDashoffset = offset;
      scaleRing.classList.remove('filling', 'near-target', 'at-target', 'stale');
      scaleRing.classList.add(colorClass);
    }

    // Update panel color class (CSS targets #scale-panel.filling, etc.)
    if (scalePanel) {
      scalePanel.classList.remove('filling', 'near-target', 'at-target', 'stale');
      scalePanel.classList.add(colorClass);
    }

    gateBagButton(scaleData);
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

    // Unit toggle is no longer needed (display is grams-only).
    // Hide the button if it exists in the DOM.
    var unitBtn = document.getElementById('unitToggle');
    if (unitBtn) {
      unitBtn.style.display = 'none';
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
  };

})(window);
