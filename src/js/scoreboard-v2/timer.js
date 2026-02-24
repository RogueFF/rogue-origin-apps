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

    var nowMins = now.getHours() * 60 + now.getMinutes();

    // Check if we're currently ON a break (can be overridden by debug)
    var currentlyOnBreak = false;
    var currentBreakStart = 0;

    // Check debug override first
    if (State && State.debugOnBreak === true && State.debugBreakStartTime) {
      currentlyOnBreak = true;
      // Use the CACHED break start time, not current time
      var breakStart = State.debugBreakStartTime;
      currentBreakStart = breakStart.getHours() * 60 + breakStart.getMinutes();
    } else {
      // Check actual scheduled breaks
      var breaks = (Config && Config.workday && Config.workday.breaks) || [];

      for (var i = 0; i < breaks.length; i++) {
        var brk = breaks[i];
        var bStart = brk[0] * 60 + brk[1];
        var bEnd = brk[2] * 60 + brk[3];

        if (nowMins >= bStart && nowMins < bEnd) {
          currentlyOnBreak = true;
          currentBreakStart = bStart;
          break;
        }
      }
    }

    // If after hours, cap at last break start (4:20 PM) to freeze timer
    var workdayEndMins = (Config && Config.workday && Config.workday.endMinutes) || (16 * 60 + 30);
    var lastBreakStartMins = workdayEndMins - 10; // 4:20 PM (cleanup break start)
    var isAfterHours = nowMins >= workdayEndMins || nowMins < ((Config && Config.workday && Config.workday.startMinutes) || (7 * 60));

    // If currently on break, calculate elapsed time up to break start
    var endTime;
    if (isAfterHours) {
      endTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
               Math.floor(lastBreakStartMins / 60), lastBreakStartMins % 60, 0);
    } else if (currentlyOnBreak) {
      endTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
               Math.floor(currentBreakStart / 60), currentBreakStart % 60, 0);
    } else {
      endTime = now;
    }

    var totalSecs = Math.floor((endTime - startTime) / 1000);
    var startMins = startTime.getHours() * 60 + startTime.getMinutes();
    var endMins = endTime.getHours() * 60 + endTime.getMinutes();

    // Subtract time spent on COMPLETED breaks (not current break)
    // Always subtract scheduled breaks, even in debug mode
    var breaks = (Config && Config.workday && Config.workday.breaks) || [];
    for (var j = 0; j < breaks.length; j++) {
      var brk2 = breaks[j];
      var bStart2 = brk2[0] * 60 + brk2[1];
      var bEnd2 = brk2[2] * 60 + brk2[3];

      // Skip the current break (already handled above)
      if (currentlyOnBreak && bStart2 === currentBreakStart) {
        continue;
      }

      // If timer span includes this break, subtract it
      if (startMins < bEnd2 && endMins > bStart2) {
        var overlapStart = Math.max(startMins, bStart2);
        var overlapEnd = Math.min(endMins, bEnd2);
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
   * Get today's shift start time as a Date object
   * Checks for manual override first, falls back to default 7:00 AM
   * @returns {Date} Today at shift start time
   */
  function getShiftStartTime() {
    // Check for manual start time override
    if (State.manualShiftStart) {
      var today = new Date().toDateString();
      var manualDate = State.manualShiftStart.toDateString();
      if (manualDate === today) {
        return new Date(State.manualShiftStart);
      }
    }

    // Default: 7:00 AM today
    var defaultStart = new Date();
    var startHour = (Config && Config.workday && Config.workday.startHour) || 7;
    var startMin = (Config && Config.workday && Config.workday.startMin) || 0;
    defaultStart.setHours(startHour, startMin, 0, 0);
    return defaultStart;
  }

  /**
   * Get shift end time for a given date
   * @param {Date} date - The date to get shift end for
   * @returns {Date} Shift end time (default 4:30 PM)
   */
  function getShiftEndTime(date) {
    var endHour = (Config && Config.workday && Config.workday.endHour) || 16;
    var endMin = (Config && Config.workday && Config.workday.endMin) || 30;

    var shiftEnd = new Date(date);
    shiftEnd.setHours(endHour, endMin, 0, 0);
    return shiftEnd;
  }

  /**
   * Calculate available productive hours from a given start time to shift end
   * Excludes scheduled breaks that fall within the window
   * @param {Date} shiftStart - The shift start time
   * @returns {number} Available hours (decimal)
   */
  function getAvailableProductiveHours(shiftStart) {
    var shiftEnd = new Date();
    var endHr = (Config && Config.workday && Config.workday.endHour) || 16;
    var endMn = (Config && Config.workday && Config.workday.endMin) || 30;
    shiftEnd.setHours(endHr, endMn, 0, 0);

    var totalMinutes = (shiftEnd - shiftStart) / 60000;

    // Subtract scheduled breaks that fall within shift window
    var breaks = (Config && Config.workday && Config.workday.breaks) || [
      [9, 0, 9, 10],      // 9:00-9:10 AM
      [12, 0, 12, 30],    // 12:00-12:30 PM
      [14, 30, 14, 40],   // 2:30-2:40 PM
      [16, 20, 16, 30]    // 4:20-4:30 PM cleanup
    ];

    var breakMinutes = 0;
    breaks.forEach(function(brk) {
      var breakStart = new Date();
      breakStart.setHours(brk[0], brk[1], 0, 0);
      var breakEnd = new Date();
      breakEnd.setHours(brk[2], brk[3], 0, 0);

      // Only count breaks that overlap with actual working time
      if (shiftStart < breakEnd && breakStart < shiftEnd) {
        var overlapStart = Math.max(shiftStart.getTime(), breakStart.getTime());
        var overlapEnd = Math.min(shiftEnd.getTime(), breakEnd.getTime());
        breakMinutes += (overlapEnd - overlapStart) / 60000;
      }
    });

    return (totalMinutes - breakMinutes) / 60;  // Convert to hours
  }

  /**
   * Calculate working seconds from a previous day's timestamp, carrying over to today
   * Used when a bag was not finished before shift ended yesterday
   * @param {Date} startTime - The timestamp from a previous day
   * @returns {number} Total working seconds (yesterday's remainder + today's elapsed)
   */
  function getWorkingSecondsCarryOver(startTime) {
    if (!startTime) return 0;

    var now = new Date();
    var startDate = new Date(startTime);

    // Get yesterday's shift end
    var yesterdayShiftEnd = getShiftEndTime(startDate);

    // Calculate working seconds from lastBag to end of that day's shift
    // (only if lastBag was before shift end)
    var yesterdayRemaining = 0;
    if (startTime < yesterdayShiftEnd) {
      // Time from lastBag to shift end, excluding any breaks in between
      var startMins = startDate.getHours() * 60 + startDate.getMinutes();
      var endMins = (Config && Config.workday && Config.workday.endMinutes) ||
        (16 * 60 + 30);

      yesterdayRemaining = (endMins - startMins) * 60;

      // Subtract breaks that occurred between lastBag and shift end
      var breaks = (Config && Config.workday && Config.workday.breaks) || [];
      for (var i = 0; i < breaks.length; i++) {
        var brk = breaks[i];
        var bStart = brk[0] * 60 + brk[1];
        var bEnd = brk[2] * 60 + brk[3];

        if (startMins < bEnd && endMins > bStart) {
          var overlapStart = Math.max(startMins, bStart);
          var overlapEnd = Math.min(endMins, bEnd);
          if (overlapEnd > overlapStart) {
            yesterdayRemaining -= (overlapEnd - overlapStart) * 60;
          }
        }
      }
    }

    // Add today's working seconds from shift start to now
    var todayElapsed = getWorkingSecondsSince(getShiftStartTime());

    return Math.max(0, yesterdayRemaining + todayElapsed);
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

    // Check if lastBagTimestamp is from today
    var lastBagIsToday = State.lastBagTimestamp &&
      State.lastBagTimestamp.toDateString() === new Date().toDateString();

    // Check if lastBagTimestamp is from a previous day (unfinished bag)
    var lastBagIsPreviousDay = State.lastBagTimestamp &&
      State.lastBagTimestamp.toDateString() !== new Date().toDateString();

    // Check if shift has been manually started
    var hasShiftStarted = State.manualShiftStart !== null && State.manualShiftStart !== undefined;

    if (lastBagIsToday && !isManuallyPaused) {
      elapsedSec = getWorkingSecondsSince(State.lastBagTimestamp);
    } else if (lastBagIsToday && isManuallyPaused && State.pauseStartTime) {
      // Show elapsed time up until pause started
      elapsedSec = getWorkingSecondsSince(State.lastBagTimestamp) -
        Math.floor((new Date() - State.pauseStartTime) / 1000);
      if (elapsedSec < 0) elapsedSec = 0;
    } else if (lastBagIsPreviousDay && !breakStatus.onBreak && !breakStatus.afterHours) {
      // Unfinished bag from previous day - carry over the remaining time
      // Calculates: (yesterday's lastBag → yesterday's shift end) + (today's 7AM → now)
      elapsedSec = getWorkingSecondsCarryOver(State.lastBagTimestamp);
    } else if (!hasShiftStarted && !breakStatus.onBreak && !breakStatus.afterHours) {
      // No bag in progress and shift hasn't been started - show waiting state
      // Don't count time until shift is manually started
      elapsedSec = 0;
      colorClass = 'neutral';
      var waitingLabel = Utils.translate('waiting');
      updateTimerDisplay('--:--', waitingLabel || 'Waiting to Start', colorClass, 0);
      return;
    } else if (!breakStatus.onBreak && !breakStatus.afterHours) {
      // No lastBagTimestamp but shift has started - use shift start time as reference
      elapsedSec = getWorkingSecondsSince(getShiftStartTime());
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
      } else if (effectiveTarget > 0 && isOvertime) {
        colorClass = 'red';
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
      if (breakStatus.afterHours) {
        // Show frozen timer value + total paused time
        var pausedStr = (State.totalPausedSeconds > 0) ? ' · ' + (currentLang === 'es' ? 'Pausado' : 'Paused') + ' ' + formatTime(State.totalPausedSeconds) : '';
        tv.textContent = formatTime(displaySec);
        tv.className = 'timer-value neutral';
        tl.textContent = (t[currentLang] && t[currentLang].shiftEnded || 'SHIFT ENDED') + pausedStr;
      } else {
        tv.textContent = formatTime(displaySec);
        tv.className = 'timer-value yellow';
        tl.textContent = (t[currentLang] && t[currentLang].onBreak);
      }
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
          vsTargetEl.textContent = (window.ScoreboardI18n ? window.ScoreboardI18n.t('onPace') : 'On pace');
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
   * Sanitizes pause reason input to prevent XSS attacks
   */
  function sanitizePauseReason(reason) {
    if (!reason) return '';
    // Remove HTML tags
    let sanitized = reason.replace(/<[^>]*>/g, '');
    // Remove potential script injections
    sanitized = sanitized.replace(/javascript:/gi, '');
    sanitized = sanitized.replace(/on\w+=/gi, '');
    // Limit length to 200 characters
    return sanitized.slice(0, 200).trim();
  }

  /**
   * Handles custom pause reason input
   */
  function onCustomReasonInput() {
    var customInput = DOM ? DOM.get('pauseCustomReason') : document.getElementById('pauseCustomReason');
    if (!customInput) return;

    var rawValue = customInput.value;
    var customReason = sanitizePauseReason(rawValue);

    // Always update input with sanitized value (clears malicious content visually)
    if (rawValue !== customReason) {
      customInput.value = customReason;
    }

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
    // Use State.registerInterval for proper cleanup on page unload
    State.pauseInterval = State.registerInterval ? State.registerInterval(updatePauseTimer, 1000) : setInterval(updatePauseTimer, 1000);

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

    State.totalPausedSeconds = (State.totalPausedSeconds || 0) + pauseDuration;

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
          console.debug('Pause logged:', result);
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
        console.debug('Resume logged:', result);
        State.pauseId = null;
      },
      function(err) {
        console.error('Failed to log resume:', err);
      }
    );
  }

  /**
   * Apply pause state from server (for cross-device sync)
   * @param {Object|null} pauseData - Pause state from server
   * @param {boolean} pauseData.isPaused - Whether currently paused
   * @param {string} pauseData.pauseId - Unique pause ID
   * @param {string} pauseData.pauseStartTime - ISO timestamp of pause start
   * @param {string} pauseData.pauseReason - Reason for pause
   */
  function applyPauseState(pauseData) {
    // If server says paused and we're not locally paused, apply pause
    if (pauseData && pauseData.isPaused) {
      // Check if this is a different pause than what we have locally
      var serverPauseId = String(pauseData.pauseId);
      var localPauseId = State.pauseId ? String(State.pauseId) : null;

      if (!State.isPaused || serverPauseId !== localPauseId) {
        console.debug('Syncing pause state from server:', pauseData);

        // Apply pause state without re-logging to server
        State.isPaused = true;
        State.pauseId = serverPauseId;
        State.pauseStartTime = new Date(pauseData.pauseStartTime);
        State.pauseReason = pauseData.pauseReason || 'Unknown';

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

        // Start counting pause time (if not already)
        if (!State.pauseInterval) {
          updatePauseTimer();
          // Use State.registerInterval for proper cleanup on page unload
          State.pauseInterval = State.registerInterval ? State.registerInterval(updatePauseTimer, 1000) : setInterval(updatePauseTimer, 1000);
        }
      }
    }
    // If server says not paused but we are locally paused, clear local pause
    else if (!pauseData && State.isPaused) {
      console.debug('Clearing local pause state (server says not paused)');

      State.isPaused = false;
      State.pauseId = null;
      State.pauseStartTime = null;
      State.pauseReason = '';

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
    }
  }

  /**
   * Toggle timer panel fullscreen mode
   */
  function toggleTimerFullscreen() {
    var panel = DOM ? DOM.get('timerPanel') : document.getElementById('timerPanel');
    if (panel) {
      panel.classList.toggle('fullscreen');
    }
  }

  /**
   * Log a manual bag entry (5kg bag complete button)
   */
  function logManualEntry() {
    if (!API || !API.logBag) {
      console.warn('API.logBag not available');
      return;
    }

    var btn = DOM ? DOM.get('manualBtn') : document.getElementById('manualBtn');
    if (!btn) return;

    // Disable button and show loading state
    btn.disabled = true;
    btn.classList.add('loading');
    var btnText = DOM ? DOM.get('manualBtnText') : document.getElementById('manualBtnText');
    var originalText = btnText ? btnText.textContent : '5KG Bag Complete';
    if (btnText) btnText.textContent = 'Logging...';

    API.logBag(
      {},
      function(result) {
        if (result && result.success) {
          console.debug('Manual bag logged:', result);

          // Show success state
          btn.classList.remove('loading');
          btn.classList.add('success');
          if (btnText) btnText.textContent = '✓ Logged';

          // Reset button after 2 seconds
          setTimeout(function() {
            btn.disabled = false;
            btn.classList.remove('success');
            if (btnText) btnText.textContent = originalText;
          }, 2000);

          // Force data refresh to update timer
          if (window.ScoreboardAPI && window.ScoreboardAPI.loadData && window.ScoreboardState) {
            window.ScoreboardAPI.loadData(
              function(response) {
                if (window.ScoreboardState) {
                  if (response.scoreboard) {
                    window.ScoreboardState.data = response.scoreboard;
                  }
                  if (response.timer) {
                    window.ScoreboardState.timerData = response.timer;

                    // Update last bag timestamp
                    if (response.timer.lastBagTime) {
                      window.ScoreboardState.lastBagTimestamp = new Date(response.timer.lastBagTime);
                    }

                    // Add to cycle history
                    if (response.timer.lastCycleTimeSec && window.ScoreboardCycle) {
                      var targetSec = response.timer.targetSeconds || 300;
                      window.ScoreboardCycle.addCycleToHistory(response.timer.lastCycleTimeSec, targetSec);
                    }
                  }
                }

                // Re-render scoreboard
                if (window.ScoreboardRender && window.ScoreboardRender.renderScoreboard) {
                  window.ScoreboardRender.renderScoreboard();
                }
              },
              function(error) {
                console.error('Failed to refresh data after manual entry:', error);
              }
            );
          }
        } else {
          throw new Error('Logging failed');
        }
      },
      function(error) {
        console.error('Failed to log manual bag:', error);

        // Show error state
        btn.classList.remove('loading');
        btn.classList.add('error');
        if (btnText) btnText.textContent = '✗ Failed';

        // Reset button after 3 seconds
        setTimeout(function() {
          btn.disabled = false;
          btn.classList.remove('error');
          if (btnText) btnText.textContent = originalText;
        }, 3000);
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
    resumeTimer: resumeTimer,
    applyPauseState: applyPauseState,
    toggleTimerFullscreen: toggleTimerFullscreen,
    logManualEntry: logManualEntry
  };

  // Expose global functions for inline handlers and event listeners
  window.toggleTimerFullscreen = toggleTimerFullscreen;
  window.logManualEntry = logManualEntry;

})(window);
