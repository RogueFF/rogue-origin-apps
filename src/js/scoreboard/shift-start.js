/**
 * Shift Start Adjustment Module
 * Handles manual shift start time setting and target adjustments
 */
(function(window) {
  'use strict';

  const State = window.ScoreboardState;
  const Config = window.ScoreboardConfig;
  const DOM = window.ScoreboardDOM;

  /**
   * Initialize shift start UI on page load
   */
  function initShiftStartUI() {
    console.log('[ShiftStart] initShiftStartUI called');
    const today = new Date().toDateString();
    const savedDate = localStorage.getItem('shiftStartDate');

    // Check for existing manual start from localStorage
    let savedStart = localStorage.getItem('manualShiftStart');
    let savedLocked = localStorage.getItem('shiftStartLocked') === 'true';
    console.log('[ShiftStart] localStorage:', {savedStart, savedLocked, savedDate, today});

    // Check if saved timestamp is from today
    if (savedStart) {
      const savedTime = new Date(savedStart);
      // Only use saved time if it's from today
      if (savedTime.toDateString() === today) {
        State.manualShiftStart = savedTime;
        State.shiftStartLocked = savedLocked;
        showStartedBadge(State.manualShiftStart, savedLocked);
      } else {
        // Different day, clear old data
        localStorage.removeItem('manualShiftStart');
        localStorage.removeItem('shiftStartLocked');
        savedStart = null;
        savedLocked = false;
        showStartDayButton();
      }
    } else {
      showStartDayButton();
    }

    // Update saved date
    if (savedDate !== today) {
      localStorage.setItem('shiftStartDate', today);
    }

    // Sync with API
    if (window.ScoreboardAPI) {
      window.ScoreboardAPI.getShiftStart(
        function(response) {
          if (response.success && response.shiftAdjustment) {
            const apiStartTime = new Date(response.shiftAdjustment.manualStartTime);

            // Use API time if it's from today and different from localStorage
            if (apiStartTime.toDateString() === today &&
                (!savedStart || apiStartTime.getTime() !== new Date(savedStart).getTime())) {
              State.manualShiftStart = apiStartTime;
              State.shiftAdjustment = response.shiftAdjustment;
              localStorage.setItem('manualShiftStart', apiStartTime.toISOString());
              localStorage.setItem('shiftStartDate', today);
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
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const timeInput = document.getElementById('startTimeInput');
    if (timeInput) {
      timeInput.value = `${hours}:${minutes}`;
      timeInput.addEventListener('input', updateImpactPreview);
    }
  }

  /**
   * Show Start Day button (initial state)
   */
  function showStartDayButton() {
    console.log('[ShiftStart] showStartDayButton called');
    const btn = document.getElementById('startDayBtn');
    const badge = document.getElementById('startedBadge');
    if (btn) btn.style.display = 'flex';
    if (badge) badge.style.display = 'none';
    console.log('[ShiftStart] Start Day button shown');
  }

  /**
   * Show Started badge with time
   */
  function showStartedBadge(startTime, locked) {
    console.log('[ShiftStart] showStartedBadge called:', startTime, 'locked:', locked);
    const btn = document.getElementById('startDayBtn');
    const badge = document.getElementById('startedBadge');
    const timeDisplay = document.getElementById('startTimeDisplay');
    const badgeIcon = document.getElementById('badgeIcon');

    console.log('[ShiftStart] Elements found:', {btn: !!btn, badge: !!badge, timeDisplay: !!timeDisplay});

    if (btn) btn.style.display = 'none';
    if (badge) {
      badge.style.display = 'flex';
      badge.className = locked ? 'started-badge locked' : 'started-badge';
      console.log('[ShiftStart] Badge shown with display:', badge.style.display);
    }

    if (timeDisplay) {
      let hours = startTime.getHours();
      const minutes = String(startTime.getMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12 || 12;
      timeDisplay.textContent = `${hours}:${minutes} ${ampm}`;
    }

    if (badgeIcon) {
      badgeIcon.className = locked ? 'ph-duotone ph-lock' : 'ph-duotone ph-pencil-simple';
    }
  }

  /**
   * Start day now - uses current server time (one-click)
   */
  function startDayNow() {
    // Use current client time for immediate UI feedback
    const tempStartTime = new Date();

    // Save to state and localStorage temporarily
    State.manualShiftStart = tempStartTime;
    State.shiftStartLocked = false;
    localStorage.setItem('manualShiftStart', tempStartTime.toISOString());
    localStorage.setItem('shiftStartLocked', 'false');
    localStorage.setItem('shiftStartDate', new Date().toDateString());

    // Update UI immediately
    showStartedBadge(tempStartTime, false);

    // Save to API - passing null uses server time
    if (window.ScoreboardAPI) {
      window.ScoreboardAPI.setShiftStart(
        null,  // Use server time for accuracy
        function(response) {
          if (response.success && response.shiftAdjustment) {
            // Update with actual server time
            const serverTime = new Date(response.shiftAdjustment.manualStartTime);
            State.manualShiftStart = serverTime;
            State.shiftAdjustment = response.shiftAdjustment;
            localStorage.setItem('manualShiftStart', serverTime.toISOString());
            showStartedBadge(serverTime, false);
            console.debug('Shift start saved to API:', response.shiftAdjustment);
          }
        },
        function(error) {
          console.error('Failed to save shift start:', error);
        }
      );
    }
  }

  /**
   * Open time picker modal (for editing)
   */
  function openStartDayModal() {
    const modal = document.getElementById('startDayModal');
    if (modal) {
      modal.style.display = 'flex';
      updateImpactPreview();
    }
  }

  /**
   * Close time picker modal
   */
  function cancelStartTime() {
    const modal = document.getElementById('startDayModal');
    if (modal) modal.style.display = 'none';
  }

  /**
   * Update impact preview based on selected time
   */
  function updateImpactPreview() {
    const timeInput = document.getElementById('startTimeInput');
    if (!timeInput || !timeInput.value) return;

    const timeParts = timeInput.value.split(':');
    const hours = parseInt(timeParts[0], 10);
    const minutes = parseInt(timeParts[1], 10);

    const startTime = new Date();
    startTime.setHours(hours, minutes, 0, 0);

    // Calculate available hours
    const availableHours = getAvailableProductiveHours(startTime);
    const normalHours = 8.5;
    const scaleFactor = availableHours / normalHours;

    // Get baseline daily goal (from API or default)
    const baselineGoal = (State.data && State.data.dailyGoal) || 200;
    const adjustedGoal = Math.round(baselineGoal * scaleFactor);
    const goalDifference = adjustedGoal - baselineGoal;

    // Update preview UI
    const goalReduction = document.getElementById('goalReduction');
    const originalGoal = document.getElementById('originalGoal');
    const adjustedGoalPreview = document.getElementById('adjustedGoalPreview');

    if (goalReduction) {
      goalReduction.textContent = `${(goalDifference >= 0 ? '+' : '') + goalDifference} lbs`;
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
    const shiftEnd = new Date();
    shiftEnd.setHours(16, 30, 0, 0);

    const totalMinutes = (shiftEnd - shiftStart) / 60000;

    const breaks = (Config && Config.workday && Config.workday.breaks) || [
      [9, 0, 9, 10],
      [12, 0, 12, 30],
      [14, 30, 14, 40],
      [16, 20, 16, 30]
    ];

    let breakMinutes = 0;
    breaks.forEach(function(brk) {
      const breakStart = new Date();
      breakStart.setHours(brk[0], brk[1], 0, 0);
      const breakEnd = new Date();
      breakEnd.setHours(brk[2], brk[3], 0, 0);

      if (shiftStart < breakEnd && breakStart < shiftEnd) {
        const overlapStart = Math.max(shiftStart.getTime(), breakStart.getTime());
        const overlapEnd = Math.min(shiftEnd.getTime(), breakEnd.getTime());
        breakMinutes += (overlapEnd - overlapStart) / 60000;
      }
    });

    return (totalMinutes - breakMinutes) / 60;
  }

  /**
   * Confirm and save start time
   */
  function confirmStartTime() {
    const timeInput = document.getElementById('startTimeInput');
    if (!timeInput || !timeInput.value) return;

    const timeParts = timeInput.value.split(':');
    const hours = parseInt(timeParts[0], 10);
    const minutes = parseInt(timeParts[1], 10);

    const startTime = new Date();
    startTime.setHours(hours, minutes, 0, 0);

    // Validation
    const now = new Date();
    if (startTime > now) {
      alert('Cannot set future start time');
      return;
    }

    const fiveAM = new Date();
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
            console.debug('Shift start saved to API:', response.shiftAdjustment);
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
      const hours = String(State.manualShiftStart.getHours()).padStart(2, '0');
      const minutes = String(State.manualShiftStart.getMinutes()).padStart(2, '0');
      const timeInput = document.getElementById('startTimeInput');
      if (timeInput) timeInput.value = `${hours}:${minutes}`;
    }

    openStartDayModal();
  }

  /**
   * Show tooltip message
   */
  function showTooltip(message) {
    const badge = document.getElementById('startedBadge');
    if (!badge) return;

    const tooltip = document.createElement('div');
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

    const bagsToday = (State.timerData && State.timerData.bagsToday) || 0;

    if (bagsToday > 0 && State.manualShiftStart) {
      State.shiftStartLocked = true;
      localStorage.setItem('shiftStartLocked', 'true');
      showStartedBadge(State.manualShiftStart, true);
      console.debug('Shift start locked after first bag');
    }
  }

  /**
   * Sync shift start from API (called periodically)
   * Allows other devices to see when shift is started elsewhere
   */
  function syncShiftStart() {
    // Only sync if we don't have a local shift start yet
    // (avoids overwriting a click that's still saving)
    if (State.manualShiftStart) return;

    if (!window.ScoreboardAPI) return;

    window.ScoreboardAPI.getShiftStart(
      function(response) {
        if (response.success && response.shiftAdjustment) {
          const apiStartTime = new Date(response.shiftAdjustment.manualStartTime);

          // Check if this is for today
          const today = new Date().toDateString();
          if (apiStartTime.toDateString() !== today) return;

          // Another device set the shift start - update local state
          State.manualShiftStart = apiStartTime;
          State.shiftAdjustment = response.shiftAdjustment;
          localStorage.setItem('manualShiftStart', apiStartTime.toISOString());
          localStorage.setItem('shiftStartDate', today);
          showStartedBadge(apiStartTime, State.shiftStartLocked);
          console.debug('Shift start synced from another device:', apiStartTime);
        }
      },
      function(error) {
        // Silent fail - don't spam console on network issues
      }
    );
  }

  // Expose for external calls
  window.ScoreboardShiftStart = {
    checkLockStatus: checkLockStatus,
    initShiftStartUI: initShiftStartUI,
    syncShiftStart: syncShiftStart
  };

  // Expose global functions
  window.startDayNow = startDayNow;
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
