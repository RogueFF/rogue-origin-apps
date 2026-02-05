/**
 * Scale Display Main Module
 * Main orchestration - initializes all modules in sequence and starts polling
 */

(function() {
  'use strict';

  // Module references - reuse scoreboard modules
  var Config = window.ScoreboardConfig;
  var State = window.ScoreboardState;
  var DOM = window.ScoreboardDOM;
  var I18n = window.ScoreboardI18n;
  var API = window.ScoreboardAPI;
  var Scale = window.ScoreboardScale;
  var Timer = window.ScoreboardTimer;
  var Layout = window.ScaleDisplayLayout;

  var isInitialized = false;
  var versionCheckInterval = null;
  var timerRenderInterval = null;

  /**
   * Show loading overlay
   */
  function showLoading() {
    var overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.style.display = '';
    }
  }

  /**
   * Hide loading overlay
   */
  function hideLoading() {
    var overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  /**
   * Handle scoreboard data loaded from API
   */
  function onDataLoaded(response) {
    if (!response) return;

    // Store data in shared state
    if (response.scoreboard) {
      State.data = response.scoreboard;
    }
    if (response.timer) {
      State.timerData = response.timer;

      // Update last bag timestamp
      if (response.timer.lastBagTime) {
        State.lastBagTimestamp = new Date(response.timer.lastBagTime);
      }

      // Apply manual shift start if present
      if (response.timer.manualShiftStart) {
        State.manualShiftStart = new Date(response.timer.manualShiftStart);
      }
    }

    // Apply pause state if present
    if (Timer.applyPauseState) {
      Timer.applyPauseState(response.pause || null);
    }

    // Render timer with new data
    Timer.renderTimer();
  }

  /**
   * Check for data updates via smart polling
   */
  function checkForUpdates() {
    API.checkVersion(
      function(changed) {
        if (changed) {
          API.loadData(onDataLoaded, function(err) {
            console.error('[Main] Data load error:', err);
          });
        }
      },
      function(err) {
        console.error('[Main] Version check error:', err);
      }
    );
  }

  /**
   * Initialize all modules in sequence
   */
  function initializeModules() {
    console.log('[Main] Initializing modules...');

    try {
      // Verify required modules are loaded
      if (!Config) throw new Error('Config module not loaded');
      if (!State) throw new Error('State module not loaded');
      if (!DOM) throw new Error('DOM module not loaded');
      if (!API) throw new Error('API module not loaded');
      if (!Scale) throw new Error('Scale module not loaded');
      if (!Timer) throw new Error('Timer module not loaded');

      // 1. Initialize Layout (language toggle)
      if (Layout && Layout.init) {
        Layout.init();
        console.log('[Main] Layout initialized');
      }

      // 2. Initialize Scale (starts 1s polling for scale weight)
      Scale.init();
      console.log('[Main] Scale initialized');

      // 3. Load initial data from API
      API.loadData(
        function(response) {
          onDataLoaded(response);
          console.log('[Main] Initial data loaded');
        },
        function(err) {
          console.error('[Main] Initial data load failed:', err);
        }
      );

      // 4. Start smart polling for data updates
      var versionInterval = (Config.intervals && Config.intervals.versionCheck) || 3000;
      versionCheckInterval = State.registerInterval(checkForUpdates, versionInterval);
      console.log('[Main] Smart polling started (' + versionInterval + 'ms)');

      // 5. Start timer render loop (updates countdown every second)
      var timerInterval = (Config.intervals && Config.intervals.timerRefresh) || 1000;
      timerRenderInterval = State.registerInterval(function() {
        Timer.renderTimer();
      }, timerInterval);
      console.log('[Main] Timer render loop started');

      // Hide loading after brief delay
      setTimeout(function() {
        hideLoading();
        console.log('[Main] Initialization complete');
      }, 1000);

    } catch (error) {
      console.error('[Main] Initialization failed:', error.message, error);
      hideLoading();

      // Show error in UI if possible
      var scaleWeight = document.getElementById('scaleWeight');
      if (scaleWeight) {
        scaleWeight.textContent = 'ERROR';
        scaleWeight.className = 'scale-value stale';
      }
    }
  }

  /**
   * Handle page visibility change
   * Force refresh when page becomes visible
   */
  function handleVisibilityChange() {
    if (!document.hidden) {
      console.log('[Main] Page visible - forcing refresh');

      // Immediately poll scale
      if (Scale && Scale.pollScale) {
        Scale.pollScale();
      }

      // Check for data updates
      checkForUpdates();
    }
  }

  /**
   * Main initialization
   */
  function init() {
    if (isInitialized) {
      console.warn('[Main] Already initialized');
      return;
    }

    console.log('[Main] Starting Scale Display...');
    isInitialized = true;

    // Show loading overlay
    showLoading();

    // Initialize all modules
    initializeModules();

    // Add visibility change listener
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOM already loaded
    init();
  }

  // Expose public API
  window.ScaleDisplayMain = {
    init: init,
    showLoading: showLoading,
    hideLoading: hideLoading
  };

})();
