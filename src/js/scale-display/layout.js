/**
 * Scale Display Layout Module
 * Manages language toggle and layout initialization
 */
(function(window) {
  'use strict';

  // Language state mirrors the shared i18n module (localStorage 'ro-lang').
  let currentLang = 'en';

  function readSharedLang() {
    if (typeof window.getLang === 'function') {
      return window.getLang() || 'en';
    }
    const fallback = localStorage.getItem('ro-lang');
    return fallback === 'es' ? 'es' : 'en';
  }

  /**
   * Initialize language from shared i18n
   */
  function initLanguage() {
    currentLang = readSharedLang();

    console.log('[ScaleDisplayLayout] Language initialized:', currentLang);

    // Update UI
    updateLangButton();

    // Apply translations via shared i18n
    if (typeof window.setLang === 'function') {
      window.setLang(currentLang);
    }
  }

  /**
   * Toggle between English and Spanish
   */
  function toggleLanguage() {
    currentLang = (currentLang === 'en') ? 'es' : 'en';

    console.log('[ScaleDisplayLayout] Language toggled to:', currentLang);

    // Update UI
    updateLangButton();

    // Apply translations via shared i18n (handles localStorage + DOM)
    if (typeof window.setLang === 'function') {
      window.setLang(currentLang);
    }
  }

  /**
   * Update language toggle button text and aria-label
   */
  function updateLangButton() {
    const btn = document.getElementById('langToggle');
    if (!btn) return;

    // Button shows the language to SWITCH TO (not current language)
    const nextLang = (currentLang === 'en') ? 'es' : 'en';
    btn.textContent = nextLang.toUpperCase();

    // Aria-label in current language
    const ariaLabels = {
      en: 'Switch to Spanish',
      es: 'Cambiar a inglés'
    };
    btn.setAttribute('aria-label', ariaLabels[currentLang]);
  }

  /**
   * Get current language
   */
  function getLanguage() {
    return currentLang;
  }

  /**
   * Initialize layout module
   */
  function init() {
    console.log('[ScaleDisplayLayout] Initializing...');

    // Set up language toggle
    const langToggle = document.getElementById('langToggle');
    if (langToggle) {
      langToggle.addEventListener('click', toggleLanguage);
    }

    // Initialize language
    initLanguage();

    console.log('[ScaleDisplayLayout] Initialization complete');
  }

  // Expose public API
  window.ScaleDisplayLayout = {
    init,
    toggleLanguage,
    getLanguage
  };

})(window);
