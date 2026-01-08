/**
 * Shift Start Adjustment Module
 * Handles manual shift start time setting and target adjustments
 */
(function(window) {
  'use strict';

  var State = window.ScoreboardState;
  var Config = window.ScoreboardConfig;
  var DOM = window.ScoreboardDOM;

  /**
   * Initialize shift start UI on page load
   */
  function initShiftStartUI() {
    // Check for existing manual start from localStorage
    var savedStart = localStorage.getItem('manualShiftStart');
    var savedLocked = localStorage.getItem('shiftStartLocked') === 'true';
    var today = new Date().toDateString();
    var savedDate = localStorage.getItem('shiftStartDate');

    // Reset if different day
    if (savedDate !== today) {
      localStorage.removeItem('manualShiftStart');
      localStorage.removeItem('shiftStartLocked');
      localStorage.setItem('shiftStartDate', today);
      savedStart = null;
      savedLocked = false;
    }

    if (savedStart) {
      State.manualShiftStart = new Date(savedStart);
      State.shiftStartLocked = savedLocked;
      showStartedBadge(State.manualShiftStart, savedLocked);
    } else {
      showStartDayButton();
    }

    // Sync with API
    if (window.ScoreboardAPI) {
      window.ScoreboardAPI.getShiftStart(
        function(response) {
          if (response.success && response.shiftAdjustment) {
            var apiStartTime = new Date(response.shiftAdjustment.manualStartTime);

            // Use API time if different from localStorage
            if (!savedStart || apiStartTime.getTime() !== new Date(savedStart).getTime()) {
              State.manualShiftStart = apiStartTime;
              State.shiftAdjustment = response.shiftAdjustment;
              localStorage.setItem('manualShiftStart', apiStartTime.toISOString());
              showStartedBadge(apiStartTime, State.shiftStartLocked);
            }
          }
        },
        function(error) {
          console.error('Failed to load shift start from API:', error);
        }
      );
    }

    // Set up time input to current time by default
    var now = new Date();
    var hours = String(now.getHours()).padStart(2, '0');
    var minutes = String(now.getMinutes()).padStart(2, '0');
    var timeInput = document.getElementById('startTimeInput');
    if (timeInput) {
      timeInput.value = hours + ':' + minutes;
      timeInput.addEventListener('input', updateImpactPreview);
    }
  }

  /**
   * Show Start Day button (initial state)
   */
  function showStartDayButton() {
    var btn = document.getElementById('startDayBtn');
    var badge = document.getElementById('startedBadge');
    if (btn) btn.style.display = 'flex';
    if (badge) badge.style.display = 'none';
  }

  /**
   * Show Started badge with time
   */
  function showStartedBadge(startTime, locked) {
    var btn = document.getElementById('startDayBtn');
    var badge = document.getElementById('startedBadge');
    var timeDisplay = document.getElementById('startTimeDisplay');
    var badgeIcon = document.getElementById('badgeIcon');

    if (btn) btn.style.display = 'none';
    if (badge) {
      badge.style.display = 'flex';
      badge.className = locked ? 'started-badge locked' : 'started-badge';
    }

    if (timeDisplay) {
      var hours = startTime.getHours();
      var minutes = String(startTime.getMinutes()).padStart(2, '0');
      var ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12 || 12;
      timeDisplay.textContent = hours + ':' + minutes + ' ' + ampm;
    }

    if (badgeIcon) {
      badgeIcon.className = locked ? 'ph-duotone ph-lock' : 'ph-duotone ph-pencil-simple';
    }
  }

  /**
   * Open time picker modal
   */
  function openStartDayModal() {
    var modal = document.getElementById('startDayModal');
    if (modal) {
      modal.style.display = 'flex';
      updateImpactPreview();
    }
  }

  /**
   * Close time picker modal
   */
  function cancelStartTime() {
    var modal = document.getElementById('startDayModal');
    if (modal) modal.style.display = 'none';
  }

  /**
   * Update impact preview based on selected time
   */
  function updateImpactPreview() {
    var timeInput = document.getElementById('startTimeInput');
    if (!timeInput || !timeInput.value) return;

    var timeParts = timeInput.value.split(':');
    var hours = parseInt(timeParts[0], 10);
    var minutes = parseInt(timeParts[1], 10);

    var startTime = new Date();
    startTime.setHours(hours, minutes, 0, 0);

    // Calculate available hours
    var availableHours = getAvailableProductiveHours(startTime);
    var normalHours = 8.5;
    var scaleFactor = availableHours / normalHours;

    // Get baseline daily goal (from API or default)
    var baselineGoal = (State.data && State.data.dailyGoal) || 200;
    var adjustedGoal = Math.round(baselineGoal * scaleFactor);
    var goalDifference = adjustedGoal - baselineGoal;

    // Update preview UI
    var goalReduction = document.getElementById('goalReduction');
    var originalGoal = document.getElementById('originalGoal');
    var adjustedGoalPreview = document.getElementById('adjustedGoalPreview');

    if (goalReduction) {
      goalReduction.textContent = (goalDifference >= 0 ? '+' : '') + goalDifference + ' lbs';
      goalReduction.style.color = goalDifference >= 0 ? '#22c55e' : '#f87171';
    }
    if (originalGoal) originalGoal.textContent = baselineGoal;
    if (adjustedGoalPreview) adjustedGoalPreview.textContent = adjustedGoal;
  }

  /**
   * Calculate available hours (duplicate for shift-start module)
   * TODO: Consider moving to shared utils
   */
  function getAvailableProductiveHours(shiftStart) {
    var shiftEnd = new Date();
    shiftEnd.setHours(16, 30, 0, 0);

    var totalMinutes = (shiftEnd - shiftStart) / 60000;

    var breaks = (Config && Config.workday && Config.workday.breaks) || [
      [9, 0, 9, 10],
      [12, 0, 12, 30],
      [14, 30, 14, 40],
      [16, 20, 16, 30]
    ];

    var breakMinutes = 0;
    breaks.forEach(function(brk) {
      var breakStart = new Date();
      breakStart.setHours(brk[0], brk[1], 0, 0);
      var breakEnd = new Date();
      breakEnd.setHours(brk[2], brk[3], 0, 0);

      if (shiftStart < breakEnd && breakStart < shiftEnd) {
        var overlapStart = Math.max(shiftStart.getTime(), breakStart.getTime());
        var overlapEnd = Math.min(shiftEnd.getTime(), breakEnd.getTime());
        breakMinutes += (overlapEnd - overlapStart) / 60000;
      }
    });

    return (totalMinutes - breakMinutes) / 60;
  }

  /**
   * Confirm and save start time
   */
  function confirmStartTime() {
    var timeInput = document.getElementById('startTimeInput');
    if (!timeInput || !timeInput.value) return;

    var timeParts = timeInput.value.split(':');
    var hours = parseInt(timeParts[0], 10);
    var minutes = parseInt(timeParts[1], 10);

    var startTime = new Date();
    startTime.setHours(hours, minutes, 0, 0);

    // Validation
    var now = new Date();
    if (startTime > now) {
      alert('Cannot set future start time');
      return;
    }

    var fiveAM = new Date();
    fiveAM.setHours(5, 0, 0, 0);
    if (startTime < fiveAM) {
      alert('Start time too early (before 5:00 AM)');
      return;
    }

    // Save to state and localStorage
    State.manualShiftStart = startTime;
    State.shiftStartLocked = false;
    localStorage.setItem('manualShiftStart', startTime.toISOString());
    localStorage.setItem('shiftStartLocked', 'false');
    localStorage.setItem('shiftStartDate', new Date().toDateString());

    // Update UI
    showStartedBadge(startTime, false);
    cancelStartTime();

    // Save to API
    if (window.ScoreboardAPI) {
      window.ScoreboardAPI.setShiftStart(
        startTime,
        function(response) {
          if (response.success && response.shiftAdjustment) {
            State.shiftAdjustment = response.shiftAdjustment;
            console.log('Shift start saved to API:', response.shiftAdjustment);
          }
        },
        function(error) {
          console.error('Failed to save shift start:', error);
        }
      );
    }
  }

  /**
   * Edit start time (opens modal if not locked)
   */
  function editStartTime() {
    if (State.shiftStartLocked) {
      showTooltip('Cannot edit after first bag');
      return;
    }

    // Pre-fill current time
    if (State.manualShiftStart) {
      var hours = String(State.manualShiftStart.getHours()).padStart(2, '0');
      var minutes = String(State.manualShiftStart.getMinutes()).padStart(2, '0');
      var timeInput = document.getElementById('startTimeInput');
      if (timeInput) timeInput.value = hours + ':' + minutes;
    }

    openStartDayModal();
  }

  /**
   * Show tooltip message
   */
  function showTooltip(message) {
    var badge = document.getElementById('startedBadge');
    if (!badge) return;

    var tooltip = document.createElement('div');
    tooltip.className = 'lock-tooltip';
    tooltip.textContent = message;
    badge.appendChild(tooltip);

    setTimeout(function() {
      tooltip.remove();
    }, 2000);
  }

  /**
   * Check if shift start should be locked (after first bag)
   * Called on every data refresh
   */
  function checkLockStatus() {
    if (State.shiftStartLocked) return;  // Already locked

    var bagsToday = (State.timerData && State.timerData.bagsToday) || 0;

    if (bagsToday > 0 && State.manualShiftStart) {
      State.shiftStartLocked = true;
      localStorage.setItem('shiftStartLocked', 'true');
      showStartedBadge(State.manualShiftStart, true);
      console.log('Shift start locked after first bag');
    }
  }

  // Expose for external calls
  window.ScoreboardShiftStart = {
    checkLockStatus: checkLockStatus,
    initShiftStartUI: initShiftStartUI
  };

  // Expose global functions
  window.openStartDayModal = openStartDayModal;
  window.cancelStartTime = cancelStartTime;
  window.confirmStartTime = confirmStartTime;
  window.editStartTime = editStartTime;

  // Initialize on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initShiftStartUI);
  } else {
    initShiftStartUI();
  }

})(window);
