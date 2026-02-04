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
  const I18n = window.ScaleDisplayI18n;
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
      DOM.init();
      console.log('[Main] DOM initialized');

      // 2. Initialize State (load saved language)
      State.init();
      console.log('[Main] State initialized');

      // 3. Initialize I18n (apply translations)
      I18n.init();
      console.log('[Main] I18n initialized');

      // 4. Initialize Layout (make header clickable)
      Layout.init();
      console.log('[Main] Layout initialized');

      // 5. Initialize Scale (set up UI)
      Scale.init();
      console.log('[Main] Scale initialized');

      // 6. Initialize Timer (start clock)
      Timer.init();
      console.log('[Main] Timer initialized');

      // 7. Start API polling
      API.startPolling();
      console.log('[Main] API polling started');

      // Hide loading after brief delay
      setTimeout(() => {
        hideLoading();
        console.log('[Main] Initialization complete');
      }, 1000);

    } catch (error) {
      console.error('[Main] Initialization error:', error);
      hideLoading();
      // Show error state
      if (DOM.elements.scaleWeight) {
        DOM.elements.scaleWeight.textContent = 'ERROR';
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
