/**
 * Scoreboard Configuration
 * Centralized constants, thresholds, and settings
 * Extracted from inline code to improve maintainability
 */
(function(window) {
  'use strict';

  var ScoreboardConfig = {
    // API Configuration - Vercel Functions
    API_URL: 'https://rogue-origin-apps-master.vercel.app/api/production',

    // Timing intervals (milliseconds)
    intervals: {
      clockRefresh: 1000,      // Update clock every second
      dataRefresh: 30000,      // Fetch API data every 30 seconds (reduced to avoid rate limits)
      timerRefresh: 1000       // Update timer display every second
    },

    // Work schedule (24-hour format)
    workday: {
      startHour: 7,
      startMin: 0,
      endHour: 16,
      endMin: 30,
      // Breaks: [startHour, startMin, endHour, endMin]
      breaks: [
        [9, 0, 9, 10],       // 9:00-9:10 AM morning break
        [12, 0, 12, 30],     // 12:00-12:30 PM lunch
        [14, 30, 14, 40],    // 2:30-2:40 PM afternoon break
        [16, 20, 16, 30]     // 4:20-4:30 PM cleanup/EOD
      ]
    },

    // Performance thresholds (percentages)
    thresholds: {
      ahead: 105,           // >= 105% = green/ahead
      onTarget: 90,         // >= 90% = yellow/on-target
      behind: 90,           // < 90% = red/behind
      earlyBagDelta: 10,    // seconds early for "early" status
      lateBagDelta: -10,    // seconds late for "late" status
      comparisonPositive: 2, // > 2% = positive
      comparisonNegative: -2 // < -2% = negative
    },

    // Cycle history display modes
    cycleModes: ['Donut', 'Bars', 'Grid', 'Cards', 'List'],

    // LocalStorage keys
    storage: {
      cycleHistory: 'cycleHistory',
      cycleHistoryDate: 'cycleHistoryDate',
      cycleHistoryVersion: 'cycleHistoryVersion',
      cycleDisplayMode: 'cycleDisplayMode',
      timerFullscreen: 'timerFullscreen'
    },

    // Data format version (increment when localStorage format changes)
    cycleHistoryVersion: '2',

    // UI settings
    ui: {
      toastDuration: 4000,           // Toast notification duration (ms)
      buttonSuccessDelay: 1500,      // Bag button reset delay (ms)
      confettiCountEarly: 100,       // Confetti pieces for early finish
      confettiCountOnTime: 50,       // Confetti pieces for on-time finish
      celebrationTextDuration: 3000, // Celebration text display time (ms)
      dragThreshold: 100             // Pixels to drag before toggling fullscreen
    },

    // Audio disabled - no sound effects

    // Timer calculation
    timer: {
      maxCycleSeconds: 7200,  // 2 hours - treat longer cycles as errors
      defaultTargetSeconds: 300  // 5 minutes default target
    }
  };

  // Computed values
  ScoreboardConfig.workday.startMinutes =
    ScoreboardConfig.workday.startHour * 60 + ScoreboardConfig.workday.startMin;
  ScoreboardConfig.workday.endMinutes =
    ScoreboardConfig.workday.endHour * 60 + ScoreboardConfig.workday.endMin;

  // Freeze to prevent accidental modification
  if (Object.freeze) {
    Object.freeze(ScoreboardConfig.intervals);
    Object.freeze(ScoreboardConfig.thresholds);
    Object.freeze(ScoreboardConfig.storage);
    Object.freeze(ScoreboardConfig.ui);
    Object.freeze(ScoreboardConfig.timer);
  }

  // Export to global scope
  window.ScoreboardConfig = ScoreboardConfig;

})(window);
