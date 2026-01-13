/**
 * Scoreboard State Management Module
 *
 * Centralized state management for scoreboard.html
 * Extracted from inline globals for better maintainability
 *
 * @module ScoreboardState
 * @version 2.0
 * @date 2026-01-07
 */

(function(window) {
  'use strict';

  /**
   * ScoreboardState - Centralized state container
   * All scoreboard global state managed here
   */
  var ScoreboardState = {

    // ========================================
    // CORE DATA STATE
    // ========================================

    /**
     * Main production data from backend
     * @type {Object|null}
     */
    data: null,

    /**
     * Bag timer data (cycle times, completions)
     * @type {Object|null}
     */
    timerData: null,

    /**
     * Current language ('en' or 'es')
     * @type {string}
     */
    currentLang: 'en',

    /**
     * Timestamp of last bag completion
     * Used to detect new bag events
     * @type {number|null}
     */
    lastBagTimestamp: null,

    /**
     * Order queue data for scoreboard display
     * Format: { current: {...}, next: {...}, queue: {...} }
     * @type {Object|null}
     */
    orderQueue: null,

    /**
     * Which order pill is currently expanded ('current', 'next', or null)
     * @type {string|null}
     */
    expandedOrder: null,

    /**
     * Chart.js instance for hourly production chart
     * @type {Object|null}
     */
    hourlyChart: null,

    // ========================================
    // SHIFT START ADJUSTMENT STATE
    // ========================================

    /**
     * Manual shift start time (null = use default 7 AM)
     * @type {Date|null}
     */
    manualShiftStart: null,

    /**
     * Whether shift start time is locked (after first bag)
     * @type {boolean}
     */
    shiftStartLocked: false,

    /**
     * Shift adjustment data from API
     * @type {Object|null}
     */
    shiftAdjustment: null,


    // ========================================
    // PAUSE STATE
    // ========================================

    /**
     * Whether production is currently paused
     * @type {boolean}
     */
    isPaused: false,

    /**
     * Timestamp when pause started (ISO string)
     * @type {string|null}
     */
    pauseStartTime: null,

    /**
     * Reason for pause (e.g., "Break", "Lunch")
     * @type {string|null}
     */
    pauseReason: null,

    /**
     * Unique ID for current pause session
     * @type {string|null}
     */
    pauseId: null,

    /**
     * Interval handle for pause duration counter
     * @type {number|null}
     */
    pauseInterval: null,


    // ========================================
    // DEBUG STATE
    // ========================================

    /**
     * Debug mode enabled flag
     * @type {boolean}
     */
    debugMode: false,

    /**
     * Debug state ('idle', 'working', 'break', 'critical')
     * @type {string}
     */
    debugState: 'idle',

    /**
     * Debug elapsed percentage (0-100)
     * Simulates progress through bag cycle
     * @type {number}
     */
    debugElapsedPercent: 0,

    /**
     * Debug break state override (null = use real detection)
     * @type {boolean|null}
     */
    debugOnBreak: null,


    // ========================================
    // CYCLE HISTORY STATE
    // ========================================

    /**
     * Array of recent bag cycle times
     * Format: [{ time: number, timestamp: string }, ...]
     * @type {Array}
     */
    cycleHistory: [],

    /**
     * Whether cycle history panel is collapsed
     * @type {boolean}
     */
    cycleHistoryCollapsed: false,

    /**
     * Display mode for cycle history (0=Donut, 1=Bars, 2=Grid, 3=Cards, 4=List)
     * @type {number}
     */
    cycleDisplayMode: 0,


    // ========================================
    // AUDIO STATE
    // ========================================

    /**
     * Web Audio API context
     * @type {AudioContext|null}
     */
    audioContext: null,

    /**
     * Mariachi audio buffer (bag completion sound)
     * @type {AudioBuffer|null}
     */
    mariachiAudio: null,

    /**
     * On-time audio buffer (target met sound)
     * @type {AudioBuffer|null}
     */
    onTimeAudio: null,


    // ========================================
    // INTERVAL REGISTRY (Phase 1)
    // ========================================

    /**
     * Registry of active intervals for cleanup
     * Each entry: { id: number, fn: function, delay: number }
     * @type {Array}
     */
    intervalRegistry: [],


    // ========================================
    // STATE MANAGEMENT METHODS
    // ========================================

    /**
     * Reset all state to initial values
     * Called on page unload or refresh
     */
    reset: function() {
      // Core data
      this.data = null;
      this.timerData = null;
      this.lastBagTimestamp = null;
      this.orderQueue = null;
      this.expandedOrder = null;

      // Pause state
      this.isPaused = false;
      this.pauseStartTime = null;
      this.pauseReason = null;
      this.pauseId = null;
      if (this.pauseInterval) {
        clearInterval(this.pauseInterval);
        this.pauseInterval = null;
      }

      // Debug state
      this.debugMode = false;
      this.debugState = 'idle';
      this.debugElapsedPercent = 0;
      this.debugOnBreak = null;

      // Cycle history
      this.cycleHistory = [];
      this.cycleHistoryCollapsed = false;
      this.cycleDisplayMode = 0;

      // Audio (don't reset context/buffers, just null references)
      // AudioContext can be reused across resets

      // Chart
      if (this.hourlyChart) {
        this.hourlyChart.destroy();
        this.hourlyChart = null;
      }

      // Shift start adjustment
      this.manualShiftStart = null;
      this.shiftStartLocked = false;
      this.shiftAdjustment = null;

      // Clear all registered intervals
      this.clearAllIntervals();
    },

    /**
     * Register an interval for automatic cleanup
     * @param {function} fn - Function to call on interval
     * @param {number} delay - Interval delay in milliseconds
     * @returns {number} Interval ID
     */
    registerInterval: function(fn, delay) {
      var id = setInterval(fn, delay);
      this.intervalRegistry.push({
        id: id,
        fn: fn,
        delay: delay
      });
      return id;
    },

    /**
     * Clear all registered intervals
     * Called on reset or page unload
     */
    clearAllIntervals: function() {
      for (var i = 0; i < this.intervalRegistry.length; i++) {
        clearInterval(this.intervalRegistry[i].id);
      }
      this.intervalRegistry = [];
    },


    // ========================================
    // UTILITY GETTERS
    // ========================================

    /**
     * Check if state is initialized with data
     * @returns {boolean}
     */
    isInitialized: function() {
      return this.data !== null;
    },

    /**
     * Get current pause duration in seconds
     * @returns {number} Seconds elapsed since pause started
     */
    getPauseDuration: function() {
      if (!this.isPaused || !this.pauseStartTime) {
        return 0;
      }
      var start = new Date(this.pauseStartTime);
      var now = new Date();
      return Math.floor((now - start) / 1000);
    },

    /**
     * Get total number of bags in cycle history
     * @returns {number}
     */
    getCycleHistoryCount: function() {
      return this.cycleHistory.length;
    },

    /**
     * Get average cycle time from history
     * @returns {number} Average in seconds, or 0 if no history
     */
    getAverageCycleTime: function() {
      if (this.cycleHistory.length === 0) {
        return 0;
      }
      var total = 0;
      for (var i = 0; i < this.cycleHistory.length; i++) {
        total += this.cycleHistory[i].time;
      }
      return Math.round(total / this.cycleHistory.length);
    }

  };


  // ========================================
  // EXPOSE TO WINDOW
  // ========================================

  window.ScoreboardState = ScoreboardState;

  // TEST HELPER: Simulate break mode for testing
  window.testBreakMode = function(enable) {
    if (enable === undefined) enable = true;
    ScoreboardState.debugOnBreak = enable ? true : null;
    console.log('[TEST] Break mode:', enable ? 'ENABLED' : 'DISABLED');
    console.log('[TEST] Timer should now be:', enable ? 'FROZEN (yellow)' : 'RUNNING (green/red)');
  };


  // ========================================
  // CLEANUP ON PAGE UNLOAD
  // ========================================

  window.addEventListener('beforeunload', function() {
    ScoreboardState.clearAllIntervals();
  });

})(window);
