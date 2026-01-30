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
    addCycleToHistory: addCycleToHistory
  };

  // Expose global functions for inline handlers and event listeners
  window.toggleDebug = toggleDebug;
  window.setDebugState = setDebugState;
  window.simulateTime = simulateTime;
  window.simulateBreak = simulateBreak;
  window.resetDebug = resetDebug;
  window.playMariachi = playMariachi;
  window.addCycleToHistory = addCycleToHistory;

})(window);
