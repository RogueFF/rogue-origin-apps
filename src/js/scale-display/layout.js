/**
 * Scale Display Layout Module
 * Manages language toggle and layout initialization
 */
(function(window) {
  'use strict';

  const LANG_STORAGE_KEY = 'scaleDisplayLang';
  let currentLang = 'en';

  /**
   * Initialize language from localStorage
   */
  function initLanguage() {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    currentLang = (saved === 'es') ? 'es' : 'en';

    console.log('[ScaleDisplayLayout] Language initialized:', currentLang);

    // Update UI
    updateLangButton();

    // Apply translations via ScoreboardI18n
    if (window.ScoreboardI18n && window.ScoreboardI18n.setLanguage) {
      window.ScoreboardI18n.setLanguage(currentLang);
    }
  }

  /**
   * Toggle between English and Spanish
   */
  function toggleLanguage() {
    currentLang = (currentLang === 'en') ? 'es' : 'en';
    localStorage.setItem(LANG_STORAGE_KEY, currentLang);

    console.log('[ScaleDisplayLayout] Language toggled to:', currentLang);

    // Update UI
    updateLangButton();

    // Apply translations via ScoreboardI18n
    if (window.ScoreboardI18n && window.ScoreboardI18n.setLanguage) {
      window.ScoreboardI18n.setLanguage(currentLang);
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
