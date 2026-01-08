/**
 * Scoreboard Timer Module
 * Handles all timer-related logic including time calculation, rendering, and pause functionality
 */

(function(window) {
  'use strict';

  // Access shared modules
  var Config = window.ScoreboardConfig;
  var State = window.ScoreboardState;
  var DOM = window.ScoreboardDOM;
  var API = window.ScoreboardAPI;
  var Utils = window.ScoreboardUtils;

  /**
   * Formats seconds as "M:SS"
   * @param {number} s - Seconds to format
   * @returns {string} Formatted time string
   */
  function formatTime(s) {
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  /**
   * Calculates working time elapsed since startTime, excluding breaks
   * @param {Date} startTime - The start time
   * @returns {number} Working seconds elapsed
   */
  function getWorkingSecondsSince(startTime) {
    if (!startTime) return 0;

    var now = new Date();

    // If different day, return 0 (timer resets daily)
    if (startTime.toDateString() !== now.toDateString()) {
      return 0;
    }

    var totalSecs = Math.floor((now - startTime) / 1000);
    var startMins = startTime.getHours() * 60 + startTime.getMinutes();
    var nowMins = now.getHours() * 60 + now.getMinutes();

    // Subtract time spent on breaks
    var breaks = (Config && Config.workday && Config.workday.breaks) || [];
    for (var i = 0; i < breaks.length; i++) {
      var brk = breaks[i];
      var bStart = brk[0] * 60 + brk[1];
      var bEnd = brk[2] * 60 + brk[3];

      // If timer started before break and now is after break end
      if (startMins < bEnd && nowMins > bStart) {
        var overlapStart = Math.max(startMins, bStart);
        var overlapEnd = Math.min(nowMins, bEnd);
        if (overlapEnd > overlapStart) {
          totalSecs -= (overlapEnd - overlapStart) * 60;
        }
      }
    }

    return Math.max(0, totalSecs);
  }

  /**
   * Checks if current time is on break or after hours
   * @returns {Object} { onBreak: boolean, afterHours: boolean }
   */
  function isOnBreakOrAfterHours() {
    var now = new Date();
    var nowMins = now.getHours() * 60 + now.getMinutes();

    var workdayStart = (Config && Config.workday && Config.workday.startMinutes) || (7 * 60);
    var workdayEnd = (Config && Config.workday && Config.workday.endMinutes) || (16 * 60 + 30);

    // Before workday
    if (nowMins < workdayStart) {
      return { onBreak: true, afterHours: true };
    }

    // After workday
    if (nowMins >= workdayEnd) {
      return { onBreak: true, afterHours: true };
    }

    // Check scheduled breaks
    var breaks = (Config && Config.workday && Config.workday.breaks) || [];
    for (var i = 0; i < breaks.length; i++) {
      var brk = breaks[i];
      var bStart = brk[0] * 60 + brk[1];
      var bEnd = brk[2] * 60 + brk[3];
      if (nowMins >= bStart && nowMins < bEnd) {
        return { onBreak: true, afterHours: false };
      }
    }

    return { onBreak: false, afterHours: false };
  }

  /**
   * Main timer render function - updates timer display, ring, and colors
   */
  function renderTimer() {
    var timerData = State.timerData;
    var targetSec = (timerData && timerData.targetSeconds) || 0;
    var trimmers = (timerData && timerData.currentTrimmers) || 0;
    var bagsToday = (timerData && timerData.bagsToday) || 0;
    var avgSecToday = (timerData && timerData.avgSecondsToday) || 0;

    // Get break/after hours status (can be overridden by debug)
    var breakStatus = State.debugOnBreak !== null ?
      { onBreak: State.debugOnBreak, afterHours: false } :
      isOnBreakOrAfterHours();

    // Check if manually paused
    var isManuallyPaused = State.isPaused;

    // Calculate working time (excludes breaks)
    var elapsedSec = 0;
    if (State.lastBagTimestamp && !isManuallyPaused) {
      elapsedSec = getWorkingSecondsSince(State.lastBagTimestamp);
    } else if (State.lastBagTimestamp && isManuallyPaused && State.pauseStartTime) {
      // Show elapsed time up until pause started
      elapsedSec = getWorkingSecondsSince(State.lastBagTimestamp) -
        Math.floor((new Date() - State.pauseStartTime) / 1000);
      if (elapsedSec < 0) elapsedSec = 0;
    }

    // Debug mode: simulate elapsed time as percentage of target
    var debugTargetSec = targetSec > 0 ? targetSec : 300; // Default 5 min for testing
    if (State.debugMode && State.debugElapsedPercent !== null) {
      elapsedSec = Math.round(debugTargetSec * (State.debugElapsedPercent / 100));
    }

    var effectiveTarget = State.debugMode ? debugTargetSec : targetSec;
    var remainingSec = effectiveTarget > 0 ? effectiveTarget - elapsedSec : elapsedSec;
    var isOvertime = effectiveTarget > 0 && remainingSec < 0 &&
      !breakStatus.onBreak && !isManuallyPaused;
    var displaySec = Math.abs(effectiveTarget > 0 ? remainingSec : elapsedSec);

    var colorClass = 'neutral';

    // Debug mode: direct state override
    if (State.debugMode && State.debugState) {
      colorClass = State.debugState;
    } else if (isManuallyPaused) {
      colorClass = 'yellow';
    } else if (effectiveTarget > 0 || elapsedSec > 0) {
      colorClass = 'green';
      if (breakStatus.onBreak) {
        colorClass = 'yellow';
      } else if (effectiveTarget > 0) {
        if (isOvertime) {
          colorClass = 'red';
        } else if (remainingSec < effectiveTarget * 0.2) {
          colorClass = 'yellow';
        }
      }
    }

    var tp = DOM ? DOM.get('timerPanel') : document.getElementById('timerPanel');
    var tv = DOM ? DOM.get('timerValue') : document.getElementById('timerValue');
    var tl = DOM ? DOM.get('timerLabel') : document.getElementById('timerLabel');
    var tr = DOM ? DOM.get('timerRing') : document.getElementById('timerRing');
    var td = DOM ? DOM.get('timerDisplay') : document.getElementById('timerDisplay');

    if (!tp || !tv || !tl || !tr || !td) return;

    // Update panel background color (preserve fullscreen and dragging classes)
    var isFs = tp.classList.contains('fullscreen');
    var isDr = tp.classList.contains('dragging');
    tp.className = 'timer-panel ' + colorClass +
      (isFs ? ' fullscreen' : '') +
      (isDr ? ' dragging' : '');

    // Update body background based on timer status
    document.body.classList.remove('timer-green', 'timer-yellow', 'timer-red', 'timer-neutral');
    document.body.classList.add('timer-' + colorClass);

    var currentLang = State ? State.currentLang : 'en';
    var I18n = window.ScoreboardI18n;
    var t = (I18n && I18n.translations) || {};

    // Show paused state during manual pause, breaks, or after hours
    if (isManuallyPaused) {
      tv.textContent = formatTime(displaySec);
      tv.className = 'timer-value yellow';
      tl.textContent = currentLang === 'es' ? 'PAUSADO' : 'PAUSED';
    } else if (breakStatus.onBreak && !State.debugMode) {
      tv.textContent = breakStatus.afterHours ? '--:--' : formatTime(displaySec);
      tv.className = 'timer-value yellow';
      tl.textContent = breakStatus.afterHours ?
        (t[currentLang] && t[currentLang].paused) :
        (t[currentLang] && t[currentLang].onBreak);
    } else {
      var showTime = State.debugMode || effectiveTarget > 0 || elapsedSec > 0;
      tv.textContent = showTime ? formatTime(displaySec) : '--:--';
      tv.className = 'timer-value ' + (colorClass === 'neutral' ? '' : colorClass);
      var isOT = State.debugState === 'red' || isOvertime;
      var elapsedLabel = currentLang === 'es' ? 'transcurrido' : 'elapsed';
      var overtimeLabel = t[currentLang] && t[currentLang].overtime;
      var remainingLabel = t[currentLang] && t[currentLang].remaining;
      tl.textContent = (effectiveTarget === 0 && elapsedSec > 0 && !State.debugMode) ?
        elapsedLabel :
        isOT ? overtimeLabel : remainingLabel;
    }

    // Update ring progress
    var circ = 2 * Math.PI * 95;
    var prog = 0;

    if (isManuallyPaused) {
      // Keep ring at current position during manual pause
      prog = effectiveTarget > 0 && elapsedSec > 0 ?
        Math.min(1, elapsedSec / effectiveTarget) : 0;
    } else if (breakStatus.onBreak && !State.debugMode) {
      // Keep ring at current position during breaks
      prog = effectiveTarget > 0 && elapsedSec > 0 ?
        Math.min(1, elapsedSec / effectiveTarget) : 0;
    } else if (effectiveTarget > 0) {
      var isOT = State.debugState === 'red' || isOvertime;
      prog = isOT ? 1 : elapsedSec / effectiveTarget;
    }

    // Debug mode progress override
    if (State.debugMode && State.debugElapsedPercent !== null) {
      prog = Math.min(1, State.debugElapsedPercent / 100);
    } else if (State.debugMode && State.debugState === 'red') {
      prog = 1;
    } else if (State.debugMode && State.debugState === 'yellow') {
      prog = 0.85;
    } else if (State.debugMode && State.debugState === 'green') {
      prog = 0.4;
    }

    tr.style.strokeDashoffset = circ * (1 - Math.min(1, prog));
    // SVG elements need setAttribute, not className property
    tr.setAttribute('class', 'timer-ring-progress ' + (colorClass === 'neutral' ? 'green' : colorClass));

    var showOvertime = State.debugState === 'red' ||
      (isOvertime && !breakStatus.onBreak && !isManuallyPaused);
    td.classList.toggle('overtime', showOvertime);

    // Update bag timer stats (was missing from modular refactor)
    var timerTargetTime = DOM ? DOM.get('timerTargetTime') : document.getElementById('timerTargetTime');
    var timerTrimmers = DOM ? DOM.get('timerTrimmers') : document.getElementById('timerTrimmers');
    var bagsTodayEl = DOM ? DOM.get('bagsToday') : document.getElementById('bagsToday');
    var avgTodayEl = DOM ? DOM.get('avgToday') : document.getElementById('avgToday');
    var vsTargetEl = DOM ? DOM.get('vsTarget') : document.getElementById('vsTarget');

    if (timerTargetTime) {
      timerTargetTime.textContent = effectiveTarget > 0 ? formatTime(effectiveTarget) : '--:--';
    }
    if (timerTrimmers) {
      timerTrimmers.textContent = trimmers || '—';
    }
    if (bagsTodayEl) {
      bagsTodayEl.textContent = bagsToday;
    }
    if (avgTodayEl) {
      avgTodayEl.textContent = avgSecToday > 0 ? formatTime(avgSecToday) : '--:--';
    }
    if (vsTargetEl) {
      if (avgSecToday > 0 && effectiveTarget > 0) {
        var diff = effectiveTarget - avgSecToday;
        var dm = Math.round(diff / 60);
        if (dm > 0) {
          vsTargetEl.textContent = '+' + dm + ' min';
          vsTargetEl.className = 'timer-stat-value positive';
        } else if (dm < 0) {
          vsTargetEl.textContent = dm + ' min';
          vsTargetEl.className = 'timer-stat-value negative';
        } else {
          vsTargetEl.textContent = 'On pace';
          vsTargetEl.className = 'timer-stat-value';
        }
      } else {
        vsTargetEl.textContent = '—';
        vsTargetEl.className = 'timer-stat-value';
      }
    }

    // Update button color to match timer state
    var btn = DOM ? DOM.get('manualBtn') : document.getElementById('manualBtn');
    if (btn) {
      btn.classList.remove('btn-green', 'btn-yellow', 'btn-red', 'btn-neutral');
      if (!btn.classList.contains('success')) {
        btn.classList.add('btn-' + colorClass);
      }
    }
  }

  /**
   * Handles pause button click - either opens pause modal or resumes timer
   */
  function handlePauseClick() {
    if (State.isPaused) {
      resumeTimer();
    } else {
      openPauseModal();
    }
  }

  /**
   * Opens the pause modal and resets its state
   */
  function openPauseModal() {
    var modal = DOM ? DOM.get('pauseModal') : document.getElementById('pauseModal');
    var customInput = DOM ? DOM.get('pauseCustomReason') : document.getElementById('pauseCustomReason');
    var confirmBtn = DOM ? DOM.get('pauseConfirmBtn') : document.getElementById('pauseConfirmBtn');

    if (!modal || !customInput || !confirmBtn) return;

    // Reset modal state
    var reasonBtns = document.querySelectorAll('.pause-reason-btn');
    reasonBtns.forEach(function(btn) {
      btn.classList.remove('selected');
    });
    customInput.value = '';
    confirmBtn.disabled = true;
    State.pauseReason = '';

    modal.classList.add('visible');
  }

  /**
   * Closes the pause modal
   */
  function closePauseModal() {
    var modal = DOM ? DOM.get('pauseModal') : document.getElementById('pauseModal');
    if (modal) {
      modal.classList.remove('visible');
    }
  }

  /**
   * Handles preset pause reason selection
   * @param {HTMLElement} btn - The button that was clicked
   * @param {string} reason - The pause reason
   */
  function selectPauseReason(btn, reason) {
    var reasonBtns = document.querySelectorAll('.pause-reason-btn');
    reasonBtns.forEach(function(b) {
      b.classList.remove('selected');
    });
    btn.classList.add('selected');

    var customInput = DOM ? DOM.get('pauseCustomReason') : document.getElementById('pauseCustomReason');
    if (customInput) {
      customInput.value = '';
    }

    State.pauseReason = reason;

    var confirmBtn = DOM ? DOM.get('pauseConfirmBtn') : document.getElementById('pauseConfirmBtn');
    if (confirmBtn) {
      confirmBtn.disabled = false;
    }
  }

  /**
   * Handles custom pause reason input
   */
  function onCustomReasonInput() {
    var customInput = DOM ? DOM.get('pauseCustomReason') : document.getElementById('pauseCustomReason');
    if (!customInput) return;

    var customReason = customInput.value.trim();

    if (customReason) {
      var reasonBtns = document.querySelectorAll('.pause-reason-btn');
      reasonBtns.forEach(function(b) {
        b.classList.remove('selected');
      });
      State.pauseReason = customReason;

      var confirmBtn = DOM ? DOM.get('pauseConfirmBtn') : document.getElementById('pauseConfirmBtn');
      if (confirmBtn) {
        confirmBtn.disabled = false;
      }
    } else if (!State.pauseReason) {
      var confirmBtn = DOM ? DOM.get('pauseConfirmBtn') : document.getElementById('pauseConfirmBtn');
      if (confirmBtn) {
        confirmBtn.disabled = true;
      }
    }
  }

  /**
   * Confirms pause from modal and starts the pause
   */
  function confirmPause() {
    closePauseModal();
    startPause();
  }

  /**
   * Starts a manual pause
   */
  function startPause() {
    State.isPaused = true;
    State.pauseStartTime = new Date();

    // Update UI
    var pauseBtn = DOM ? DOM.get('pauseBtn') : document.getElementById('pauseBtn');
    if (pauseBtn) {
      pauseBtn.classList.add('paused');
      pauseBtn.innerHTML = '<i class="ph-duotone ph-play"></i>';
    }

    var banner = DOM ? DOM.get('pauseBanner') : document.getElementById('pauseBanner');
    var reasonDisplay = DOM ? DOM.get('pauseReasonDisplay') : document.getElementById('pauseReasonDisplay');
    if (banner && reasonDisplay) {
      reasonDisplay.textContent = State.pauseReason;
      banner.classList.add('visible');
    }

    // Start counting pause time
    updatePauseTimer();
    State.pauseInterval = setInterval(updatePauseTimer, 1000);

    // Log to Google Sheets
    logPauseToSheet();
  }

  /**
   * Updates the pause timer display
   */
  function updatePauseTimer() {
    if (!State.pauseStartTime) return;

    var elapsed = Math.floor((new Date() - State.pauseStartTime) / 1000);
    var pauseTime = DOM ? DOM.get('pauseTime') : document.getElementById('pauseTime');
    if (pauseTime) {
      pauseTime.textContent = formatTime(elapsed);
    }
  }

  /**
   * Resumes the timer from pause
   */
  function resumeTimer() {
    var pauseDuration = State.pauseStartTime ?
      Math.floor((new Date() - State.pauseStartTime) / 1000) : 0;

    State.isPaused = false;

    // Clear interval
    if (State.pauseInterval) {
      clearInterval(State.pauseInterval);
      State.pauseInterval = null;
    }

    // Update UI
    var pauseBtn = DOM ? DOM.get('pauseBtn') : document.getElementById('pauseBtn');
    if (pauseBtn) {
      pauseBtn.classList.remove('paused');
      pauseBtn.innerHTML = '<i class="ph-duotone ph-pause"></i>';
    }

    var banner = DOM ? DOM.get('pauseBanner') : document.getElementById('pauseBanner');
    if (banner) {
      banner.classList.remove('visible');
    }

    // Adjust lastBagTimestamp to account for pause duration
    if (State.lastBagTimestamp && pauseDuration > 0) {
      State.lastBagTimestamp = new Date(State.lastBagTimestamp.getTime() + (pauseDuration * 1000));
    }

    // Log resume to Google Sheets
    logResumeToSheet(pauseDuration);

    // Reset pause state
    State.pauseStartTime = null;
    State.pauseReason = '';
  }

  /**
   * Logs pause to Google Sheets
   */
  function logPauseToSheet() {
    if (!API || !API.logPause) {
      console.warn('API.logPause not available');
      return;
    }

    API.logPause(
      { reason: State.pauseReason },
      function(result) {
        if (result && result.success) {
          State.pauseId = result.pauseId;
          console.log('Pause logged:', result);
        }
      },
      function(err) {
        console.error('Failed to log pause:', err);
      }
    );
  }

  /**
   * Logs resume to Google Sheets
   * @param {number} duration - Pause duration in seconds
   */
  function logResumeToSheet(duration) {
    if (!API || !API.logResume) {
      console.warn('API.logResume not available');
      return;
    }

    if (!State.pauseId) {
      console.warn('No pauseId to log resume');
      return;
    }

    API.logResume(
      { pauseId: State.pauseId, duration: duration },
      function(result) {
        console.log('Resume logged:', result);
        State.pauseId = null;
      },
      function(err) {
        console.error('Failed to log resume:', err);
      }
    );
  }

  // Export public API
  window.ScoreboardTimer = {
    formatTime: formatTime,
    getWorkingSecondsSince: getWorkingSecondsSince,
    isOnBreakOrAfterHours: isOnBreakOrAfterHours,
    renderTimer: renderTimer,
    handlePauseClick: handlePauseClick,
    openPauseModal: openPauseModal,
    closePauseModal: closePauseModal,
    selectPauseReason: selectPauseReason,
    onCustomReasonInput: onCustomReasonInput,
    confirmPause: confirmPause,
    startPause: startPause,
    updatePauseTimer: updatePauseTimer,
    resumeTimer: resumeTimer
  };

})(window);
