/**
 * Scoreboard Debug Module
 * Provides debug controls for testing timer states, celebrations, and audio
 */
(function(window) {
  'use strict';

  var State = window.ScoreboardState;
  var Cycle = window.ScoreboardCycle;
  var DOM = window.ScoreboardDOM;

  /**
   * Toggle debug panel visibility
   */
  function toggleDebug() {
    var panel = DOM ? DOM.get('debugPanel') : document.getElementById('debugPanel');
    var indicator = DOM ? DOM.get('debugIndicator') : document.getElementById('debugIndicator');

    if (!panel) {
      console.error('Debug panel not found');
      return;
    }

    var isActive = panel.classList.contains('active');

    if (isActive) {
      // Hide panel
      panel.classList.remove('active');
      if (indicator) {
        indicator.style.display = 'none';
      }
    } else {
      // Show panel
      panel.classList.add('active');
      if (indicator && State && State.debugMode) {
        indicator.style.display = 'block';
      }
    }
  }

  /**
   * Set debug timer state directly
   * @param {string} state - 'green', 'yellow', 'red', or 'neutral'
   */
  function setDebugState(state) {
    if (!State) return;

    State.debugMode = true;
    State.debugState = state;
    State.debugElapsedPercent = null;

    document.body.classList.add('debug-active');

    var indicator = DOM ? DOM.get('debugIndicator') : document.getElementById('debugIndicator');
    if (indicator) {
      indicator.style.display = 'block';
    }

    // Trigger timer re-render
    if (window.ScoreboardTimer && window.ScoreboardTimer.renderTimer) {
      window.ScoreboardTimer.renderTimer();
    }

    console.log('[Debug] Timer state set to:', state);
  }

  /**
   * Simulate timer elapsed time as percentage of target
   * @param {number} percent - 0-110+ percentage
   */
  function simulateTime(percent) {
    if (!State) return;

    State.debugMode = true;
    State.debugState = null;
    State.debugElapsedPercent = percent;

    document.body.classList.add('debug-active');

    var indicator = DOM ? DOM.get('debugIndicator') : document.getElementById('debugIndicator');
    if (indicator) {
      indicator.style.display = 'block';
    }

    // Trigger timer re-render
    if (window.ScoreboardTimer && window.ScoreboardTimer.renderTimer) {
      window.ScoreboardTimer.renderTimer();
    }

    console.log('[Debug] Simulating time at', percent + '%');
  }

  /**
   * Simulate break status
   * @param {boolean} onBreak - true = on break, false = working
   */
  function simulateBreak(onBreak) {
    if (!State) return;

    State.debugMode = true;
    State.debugOnBreak = onBreak;

    if (onBreak) {
      // Cache break start time to freeze timer at this moment
      State.debugBreakStartTime = new Date();
      console.log('[Debug] Break mode ENABLED - timer should freeze');
    } else {
      State.debugBreakStartTime = null;
      console.log('[Debug] Break mode DISABLED - timer should resume');
    }

    document.body.classList.add('debug-active');

    var indicator = DOM ? DOM.get('debugIndicator') : document.getElementById('debugIndicator');
    if (indicator) {
      indicator.style.display = 'block';
    }

    // Trigger timer re-render
    if (window.ScoreboardTimer && window.ScoreboardTimer.renderTimer) {
      window.ScoreboardTimer.renderTimer();
    }
  }

  /**
   * Reset all debug overrides and return to live state
   */
  function resetDebug() {
    if (!State) return;

    // Clear all debug state
    State.debugMode = false;
    State.debugState = null;
    State.debugElapsedPercent = null;
    State.debugOnBreak = null;
    State.debugBreakStartTime = null;
    State.debugBreakFrozenSeconds = null;

    // Clear cycle history (useful for clean testing)
    State.cycleHistory = [];
    try {
      localStorage.removeItem('cycleHistory');
      localStorage.removeItem('cycleHistoryDate');
    } catch(e) {
      console.warn('Could not clear localStorage:', e);
    }

    document.body.classList.remove('debug-active');

    var indicator = DOM ? DOM.get('debugIndicator') : document.getElementById('debugIndicator');
    if (indicator) {
      indicator.style.display = 'none';
    }

    // Re-render with live data
    if (window.ScoreboardTimer && window.ScoreboardTimer.renderTimer) {
      window.ScoreboardTimer.renderTimer();
    }
    if (Cycle && Cycle.renderCycleHistory) {
      Cycle.renderCycleHistory();
    }

    console.log('[Debug] Reset to live state');
  }

  /**
   * Test mariachi celebration audio
   */
  function playMariachi() {
    console.log('[Debug] Playing mariachi test sound');

    if (!State.audioContext) {
      State.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (State.mariachiAudio) {
      var source = State.audioContext.createBufferSource();
      source.buffer = State.mariachiAudio;
      source.connect(State.audioContext.destination);
      source.start(0);
    } else {
      // Load mariachi audio if not already loaded
      fetch('../assets/mariachi.mp3')
        .then(function(response) { return response.arrayBuffer(); })
        .then(function(arrayBuffer) { return State.audioContext.decodeAudioData(arrayBuffer); })
        .then(function(audioBuffer) {
          State.mariachiAudio = audioBuffer;
          var source = State.audioContext.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(State.audioContext.destination);
          source.start(0);
        })
        .catch(function(error) {
          console.warn('[Debug] Mariachi audio not available:', error);
          // Fallback: Play system beep
          if (State.audioContext) {
            var oscillator = State.audioContext.createOscillator();
            var gainNode = State.audioContext.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(State.audioContext.destination);
            oscillator.frequency.value = 440;
            gainNode.gain.value = 0.3;
            oscillator.start();
            setTimeout(function() { oscillator.stop(); }, 200);
          }
        });
    }
  }

  /**
   * Wrapper for addCycleToHistory (for debug panel)
   * @param {number} cycleTimeSec - Cycle time in seconds
   * @param {number} targetSec - Target time in seconds
   */
  function addCycleToHistory(cycleTimeSec, targetSec) {
    if (Cycle && Cycle.addCycleToHistory) {
      Cycle.addCycleToHistory(cycleTimeSec, targetSec);
    } else {
      console.warn('[Debug] Cycle module not available');
    }
  }

  /**
   * Inject mock cycle history for testing all cycle view modes
   * Generates realistic-looking production cycles
   */
  function injectMockCycles() {
    if (!State || !Cycle) {
      console.warn('[Debug] State or Cycle module not available');
      return;
    }

    // Clear existing
    State.cycleHistory = [];

    // Generate 9 mock cycles (typical full day)
    var targetSec = 300; // 5 min target
    var mockCycles = [
      { time: 280, target: targetSec, timestamp: Date.now() - 8 * 3600000 },  // 7a - fast (green)
      { time: 310, target: targetSec, timestamp: Date.now() - 7 * 3600000 },  // 8a - slightly slow (gold)
      { time: 260, target: targetSec, timestamp: Date.now() - 6 * 3600000 },  // 9a - fast (green)
      { time: 350, target: targetSec, timestamp: Date.now() - 4.5 * 3600000 }, // 10a - slow (red, post-break)
      { time: 270, target: targetSec, timestamp: Date.now() - 4 * 3600000 },  // 11a - fast (green)
      { time: 290, target: targetSec, timestamp: Date.now() - 3 * 3600000 },  // 12p - on pace (gold)
      { time: 380, target: targetSec, timestamp: Date.now() - 1.5 * 3600000 }, // 1p - slow (red, post-lunch)
      { time: 250, target: targetSec, timestamp: Date.now() - 1 * 3600000 },  // 2p - very fast (green)
      { time: 295, target: targetSec, timestamp: Date.now() - 0.5 * 3600000 }, // 3p - on pace (gold)
    ];

    mockCycles.forEach(function(mc) {
      State.cycleHistory.push({
        time: mc.time,
        target: mc.target,
        timestamp: mc.timestamp,
        isEarly: mc.time < mc.target
      });
    });

    // Re-render
    if (Cycle.renderCycleHistory) {
      Cycle.renderCycleHistory();
    }

    console.log('[Debug] Injected', mockCycles.length, 'mock cycles. Use ‹ › to cycle through views.');
  }

  /**
   * Inject mock scoreboard data for testing all UI states
   * @param {string} scenario - 'ahead', 'behind', 'on-pace', 'early-shift'
   */
  function injectMockScoreboard(scenario) {
    if (!State) return;
    scenario = scenario || 'ahead';

    var mockData = {
      'ahead': {
        todayLbs: 75.6, todayTarget: 65.0, todayPercentage: 116.3,
        lastHourLbs: 12.4, lastHourTarget: 9.7, lastHourTrimmers: 10,
        currentHourTrimmers: 10, currentHourTarget: 9.7,
        targetRate: 0.97, hoursLogged: 7, effectiveHours: 6.5,
        avgPercentage: 118.2, bestPercentage: 142.0, streak: 5,
        strain: '2025 - Lifter / Sungrown',
        hourlyRates: [
          {timeSlot:'7a-8a',rate:1.1,target:0.97,trimmers:10,lbs:11.0},
          {timeSlot:'8a-9a',rate:0.95,target:0.97,trimmers:10,lbs:9.5},
          {timeSlot:'9a-10a',rate:1.2,target:0.97,trimmers:10,lbs:12.0},
          {timeSlot:'10a-11a',rate:0.88,target:0.97,trimmers:10,lbs:8.8},
          {timeSlot:'11a-12p',rate:1.05,target:0.97,trimmers:10,lbs:10.5},
          {timeSlot:'12:30p-1p',rate:0.96,target:0.97,trimmers:10,lbs:4.8},
          {timeSlot:'1p-2p',rate:1.1,target:0.97,trimmers:10,lbs:11.0}
        ]
      },
      'behind': {
        todayLbs: 42.3, todayTarget: 55.0, todayPercentage: 76.9,
        lastHourLbs: 6.1, lastHourTarget: 9.7, lastHourTrimmers: 10,
        currentHourTrimmers: 10, currentHourTarget: 9.7,
        targetRate: 0.97, hoursLogged: 6, effectiveHours: 5.5,
        avgPercentage: 78.5, bestPercentage: 95.0, streak: 0,
        strain: '2025 - Lifter / Sungrown',
        hourlyRates: [
          {timeSlot:'7a-8a',rate:0.82,target:0.97,trimmers:10,lbs:8.2},
          {timeSlot:'8a-9a',rate:0.75,target:0.97,trimmers:10,lbs:7.5},
          {timeSlot:'9a-10a',rate:0.68,target:0.97,trimmers:10,lbs:6.8},
          {timeSlot:'10a-11a',rate:0.71,target:0.97,trimmers:10,lbs:7.1},
          {timeSlot:'11a-12p',rate:0.65,target:0.97,trimmers:10,lbs:6.5}
        ]
      },
      'on-pace': {
        todayLbs: 58.2, todayTarget: 60.0, todayPercentage: 97.0,
        lastHourLbs: 9.5, lastHourTarget: 9.7, lastHourTrimmers: 10,
        currentHourTrimmers: 10, currentHourTarget: 9.7,
        targetRate: 0.97, hoursLogged: 6, effectiveHours: 5.5,
        avgPercentage: 98.0, bestPercentage: 110.0, streak: 3,
        strain: '2025 - Lifter / Sungrown',
        hourlyRates: [
          {timeSlot:'7a-8a',rate:0.98,target:0.97,trimmers:10,lbs:9.8},
          {timeSlot:'8a-9a',rate:0.95,target:0.97,trimmers:10,lbs:9.5},
          {timeSlot:'9a-10a',rate:1.01,target:0.97,trimmers:10,lbs:10.1},
          {timeSlot:'10a-11a',rate:0.93,target:0.97,trimmers:10,lbs:9.3},
          {timeSlot:'11a-12p',rate:0.99,target:0.97,trimmers:10,lbs:9.9}
        ]
      }
    };

    var data = mockData[scenario] || mockData['ahead'];
    State.data = data;
    State.debugMode = true;
    document.body.classList.add('debug-active');

    // Render with mock data
    if (window.ScoreboardRender && window.ScoreboardRender.renderScoreboard) {
      window.ScoreboardRender.renderScoreboard();
    }
    if (window.ScoreboardChart && window.ScoreboardChart.renderHourlyChart) {
      window.ScoreboardChart.renderHourlyChart(data.hourlyRates || []);
    }

    console.log('[Debug] Injected mock scoreboard:', scenario);
    if (scenario === 'behind') {
      console.log('[Debug] Race mode should activate (pace < 90%)');
    }
  }

  // Note: Keyboard shortcut (D key) is handled by lazy-loader in scoreboard.html
  // This module is only loaded when the shortcut is first triggered

  // Expose public API
  window.ScoreboardDebug = {
    toggleDebug: toggleDebug,
    setDebugState: setDebugState,
    simulateTime: simulateTime,
    simulateBreak: simulateBreak,
    resetDebug: resetDebug,
    playMariachi: playMariachi,
    addCycleToHistory: addCycleToHistory,
    injectMockCycles: injectMockCycles,
    injectMockScoreboard: injectMockScoreboard
  };

  // Expose global functions for inline handlers and event listeners
  window.toggleDebug = toggleDebug;
  window.setDebugState = setDebugState;
  window.simulateTime = simulateTime;
  window.simulateBreak = simulateBreak;
  window.resetDebug = resetDebug;
  window.playMariachi = playMariachi;
  window.addCycleToHistory = addCycleToHistory;
  window.injectMockCycles = injectMockCycles;
  window.injectMockScoreboard = injectMockScoreboard;

})(window);
