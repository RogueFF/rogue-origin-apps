/**
 * Scale Display Main Module
 * Main orchestration - initializes all modules in sequence and starts polling
 */

(function() {
  'use strict';

  // Module references
  const Config = window.ScaleDisplayConfig;
  const State = window.ScaleDisplayState;
  const DOM = window.ScaleDisplayDOM;
  const I18n = window.ScoreboardI18n;
  const API = window.ScaleDisplayAPI;
  const Scale = window.ScaleDisplayScale;
  const Timer = window.ScaleDisplayTimer;
  const Layout = window.ScaleDisplayLayout;

  let isInitialized = false;

  /**
   * Initialize all modules in sequence
   */
  async function initializeModules() {
    console.log('[Main] Initializing modules...');

    try {
      // 1. Initialize DOM (cache elements)
      if (DOM && DOM.init) {
        DOM.init();
        console.log('[Main] DOM initialized');
      } else {
        console.error('[Main] DOM module not available');
        throw new Error('DOM module failed to load');
      }

      // 2. Initialize State (load saved language)
      if (State && State.init) {
        State.init();
        console.log('[Main] State initialized');
      } else {
        console.error('[Main] State module not available');
        throw new Error('State module failed to load');
      }

      // 3. Initialize I18n (apply translations)
      if (I18n && I18n.init) {
        I18n.init();
        console.log('[Main] I18n initialized');
      } else {
        console.error('[Main] I18n module not available');
        throw new Error('I18n module failed to load');
      }

      // 4. Initialize Layout (make header clickable)
      if (Layout && Layout.init) {
        Layout.init();
        console.log('[Main] Layout initialized');
      } else {
        console.error('[Main] Layout module not available');
        throw new Error('Layout module failed to load');
      }

      // 5. Initialize Scale (set up UI)
      if (Scale && Scale.init) {
        Scale.init();
        console.log('[Main] Scale initialized');
      } else {
        console.error('[Main] Scale module not available');
        throw new Error('Scale module failed to load');
      }

      // 6. Initialize Timer (start clock)
      if (Timer && Timer.init) {
        Timer.init();
        console.log('[Main] Timer initialized');
      } else {
        console.error('[Main] Timer module not available');
        throw new Error('Timer module failed to load');
      }

      // 7. Start API polling
      if (API && API.startPolling) {
        API.startPolling();
        console.log('[Main] API polling started');
      } else {
        console.error('[Main] API module not available');
        throw new Error('API module failed to load');
      }

      // Hide loading after brief delay
      setTimeout(() => {
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
   * Show loading overlay
   */
  function showLoading() {
    if (DOM.elements.loadingOverlay) {
      DOM.elements.loadingOverlay.classList.remove('hidden');
    }
  }

  /**
   * Hide loading overlay
   */
  function hideLoading() {
    if (DOM.elements.loadingOverlay) {
      DOM.elements.loadingOverlay.classList.add('hidden');
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

      // Check for version updates
      if (API && API.checkVersion) {
        API.checkVersion();
      }
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

    console.log('[Main] Starting Scale Display PWA...');
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
    init,
    showLoading,
    hideLoading
  };

})();
