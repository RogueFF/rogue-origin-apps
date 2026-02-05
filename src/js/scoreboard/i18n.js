/**
 * Scoreboard I18n Module
 * Bilingual (EN/ES) translations for the scoreboard display
 */
(function(window) {
  'use strict';

  var translations = {
    en: {
      // Strain/Line Info
      currentStrain: 'Line 1 • Current Strain',
      trimmersLabel: 'Line 1 Trimmers',

      // Time Periods
      lastHour: 'Last Hour (Completed)',
      currentHour: 'Current Hour',

      // Units
      lbs: 'lbs',
      trimmers: 'trimmers',
      hrs: 'hrs',

      // Targets & Comparisons
      ofTarget: 'vs target',
      lbsTarget: 'lbs target',
      targetRate: 'Target:',
      lbsGoal: 'lbs goal',
      vsYesterday: 'vs Yesterday',
      vs7Day: 'vs 7-Day Avg',
      vsTargetTimer: 'vs Target',

      // Statistics
      avgLbs: 'AVG',
      bestLbs: 'BEST',
      avgToday: 'Avg Today',

      // Progress Indicators
      upBy: 'Up',
      downBy: 'Down',
      onPace: 'On pace',
      hrStreak: 'hr streak',

      // Status Headers
      todaysProgress: 'LINE 1 TODAY',
      endOfDay: 'End of day:',
      chartHeader: 'HOURLY PERFORMANCE (LBS/TRIMMER)',

      // Performance Status
      aheadOfTarget: 'AHEAD OF TARGET',
      onTarget: 'ON TARGET',
      behindTarget: 'BEHIND TARGET',
      waiting: 'WAITING TO START',
      onBreak: 'ON BREAK',
      paused: 'PAUSED',
      shiftEnded: 'SHIFT ENDED',

      // Bag Timer
      bagTimer: '5KG BAG TIMER',
      remaining: 'remaining',
      overtime: 'OVERTIME',
      bagComplete: '5KG Bag Complete',
      logged: 'Logged!',
      bagsToday: 'Bags Today',
      todaysCycles: "Today's Cycles",
      noBags: 'No bags completed yet',

      // Rate Info
      strainRate: 'Strain-specific rate',
      fallbackRate: 'Using avg rate',

      // Help Text
      helpTitle: 'Understanding the Scoreboard',
      helpGreen: 'Green = Ahead (105%+)',
      helpYellow: 'Yellow = On Target (90-105%)',
      helpRed: 'Red = Behind (<90%)',

      // Order Queue
      workingOn: 'WORKING ON',
      upNext: 'UP NEXT',
      order: 'Order',
      shipment: 'Shipment',
      customer: 'Customer',
      dueDate: 'Due Date',
      estCompletion: 'Est. Completion',
      fullOrder: 'Full Order Context',

      // Scale
      scaleDisplay: 'Scale Display',
      scaleWeight: 'Scale',
      scaleConnected: 'Connected',
      scaleDisconnected: 'Disconnected'
    },

    es: {
      // Strain/Line Info
      currentStrain: 'Línea 1 • Variedad Actual',
      trimmersLabel: 'Triminadores L1',

      // Time Periods
      lastHour: 'Última Hora (Completa)',
      currentHour: 'Hora Actual',

      // Units
      lbs: 'lbs',
      trimmers: 'triminadores',
      hrs: 'hrs',

      // Targets & Comparisons
      ofTarget: 'vs meta',
      lbsTarget: 'lbs meta',
      targetRate: 'Meta:',
      lbsGoal: 'lbs meta',
      vsYesterday: 'vs Ayer',
      vs7Day: 'vs Prom 7 Días',
      vsTargetTimer: 'vs Meta',

      // Statistics
      avgLbs: 'PROM',
      bestLbs: 'MEJOR',
      avgToday: 'Prom Hoy',

      // Progress Indicators
      upBy: 'Arriba',
      downBy: 'Abajo',
      onPace: 'Al ritmo',
      hrStreak: 'hrs seguidas',

      // Status Headers
      todaysProgress: 'LÍNEA 1 HOY',
      endOfDay: 'Fin del día:',
      chartHeader: 'RENDIMIENTO POR HORA (LBS/TRIMINADOR)',

      // Performance Status
      aheadOfTarget: 'ARRIBA DE LA META',
      onTarget: 'EN LA META',
      behindTarget: 'DEBAJO DE LA META',
      waiting: 'ESPERANDO INICIO',
      onBreak: 'EN DESCANSO',
      paused: 'PAUSADO',
      shiftEnded: 'TURNO TERMINADO',

      // Bag Timer
      bagTimer: 'TEMPORIZADOR 5KG',
      remaining: 'restante',
      overtime: 'TIEMPO EXTRA',
      bagComplete: 'Bolsa 5KG Lista',
      logged: '¡Registrado!',
      bagsToday: 'Bolsas Hoy',
      todaysCycles: 'Ciclos de Hoy',
      noBags: 'Sin bolsas completadas',

      // Rate Info
      strainRate: 'Tasa específica',
      fallbackRate: 'Usando tasa prom',

      // Help Text
      helpTitle: 'Entendiendo el Marcador',
      helpGreen: 'Verde = Adelante (105%+)',
      helpYellow: 'Amarillo = En Meta (90-105%)',
      helpRed: 'Rojo = Atrás (<90%)',

      // Order Queue
      workingOn: 'TRABAJANDO EN',
      upNext: 'SIGUIENTE',
      order: 'Pedido',
      shipment: 'Envío',
      customer: 'Cliente',
      dueDate: 'Fecha de Vencimiento',
      estCompletion: 'Tiempo Estimado',
      fullOrder: 'Contexto Completo del Pedido',

      // Scale
      scaleDisplay: 'Pantalla de Báscula',
      scaleWeight: 'Peso',
      scaleConnected: 'Conectado',
      scaleDisconnected: 'Desconectado'
    }
  };

  var currentLang = 'en';

  var ScoreboardI18n = {
    /**
     * Raw translations object for direct access
     * Usage: ScoreboardI18n.translations[lang][key]
     */
    translations: translations,

    /**
     * Get translation for a key in the current language
     * @param {string} key - Translation key
     * @returns {string} Translated text or key if not found
     */
    t: function(key) {
      // Use ScoreboardState.currentLang if available
      if (window.ScoreboardState && window.ScoreboardState.currentLang) {
        currentLang = window.ScoreboardState.currentLang;
      }

      var lang = translations[currentLang] || translations.en;
      return lang[key] || key;
    },

    /**
     * Set the current language
     * @param {string} lang - Language code ('en' or 'es')
     */
    setLang: function(lang) {
      if (translations[lang]) {
        currentLang = lang;

        // Update ScoreboardState if available
        if (window.ScoreboardState) {
          window.ScoreboardState.currentLang = lang;
        }
      }
    },

    /**
     * Get all translations for the current language
     * @returns {Object} Complete translation object
     */
    getAll: function() {
      // Use ScoreboardState.currentLang if available
      if (window.ScoreboardState && window.ScoreboardState.currentLang) {
        currentLang = window.ScoreboardState.currentLang;
      }

      return translations[currentLang] || translations.en;
    },

    /**
     * Get current language code
     * @returns {string} Current language ('en' or 'es')
     */
    getLang: function() {
      if (window.ScoreboardState && window.ScoreboardState.currentLang) {
        return window.ScoreboardState.currentLang;
      }
      return currentLang;
    }
  };

  // Expose to global scope
  window.ScoreboardI18n = ScoreboardI18n;

})(window);
