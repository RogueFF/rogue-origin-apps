# Shift Start Adjustment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add manual shift start time button to scoreboard that proportionally adjusts daily production targets based on reduced available working hours.

**Architecture:** Frontend button/modal captures start time, stores in localStorage + API, calculations adjust targets client-side, timer countdown references manual start, locks after first bag scan.

**Tech Stack:** Vanilla JS (modular), Google Apps Script backend, localStorage, Chart.js, Phosphor icons

---

## Task 1: Add State Properties for Shift Start

**Files:**
- Modify: `js/scoreboard/state.js:19-54`

**Step 1: Add state properties after existing state**

After line 54 (`hourlyChart: null,`), add:

```javascript
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
```

**Step 2: Update reset() method**

Find the `reset()` method (around line 189) and add before `// Clear all registered intervals`:

```javascript
      // Shift start adjustment
      this.manualShiftStart = null;
      this.shiftStartLocked = false;
      this.shiftAdjustment = null;
```

**Step 3: Verify syntax**

Run: Open DevTools console, check for errors on page load
Expected: No syntax errors

**Step 4: Commit**

```bash
git add js/scoreboard/state.js
git commit -m "feat(scoreboard): add shift start adjustment state properties"
```

---

## Task 2: Create Available Hours Calculation Function

**Files:**
- Modify: `js/scoreboard/timer.js:113-176` (after getShiftStartTime)

**Step 1: Add getAvailableProductiveHours function**

After `getShiftStartTime()` function (around line 112), add:

```javascript
  /**
   * Calculate available productive hours from a given start time to shift end
   * Excludes scheduled breaks that fall within the window
   * @param {Date} shiftStart - The shift start time
   * @returns {number} Available hours (decimal)
   */
  function getAvailableProductiveHours(shiftStart) {
    var shiftEnd = new Date();
    shiftEnd.setHours(16, 30, 0, 0);  // 4:30 PM fixed

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
```

**Step 2: Test calculation manually**

Open DevTools console:
```javascript
// Test 7:45 AM start
var testStart = new Date();
testStart.setHours(7, 45, 0, 0);
// Should see ~7.75 hours logged
```

Expected: 7.75 (7:45 AM → 4:30 PM minus breaks)

**Step 3: Commit**

```bash
git add js/scoreboard/timer.js
git commit -m "feat(scoreboard): add available hours calculation function"
```

---

## Task 3: Create Start Day Button HTML/CSS

**Files:**
- Modify: `scoreboard.html:42-50` (in header section)
- Modify: `css/scoreboard.css` (end of file)

**Step 1: Add button HTML**

After the lang toggle buttons (around line 50), add:

```html
  <!-- Start Day Button (appears until shift start is set) -->
  <button id="startDayBtn" class="start-day-btn pulse-green" onclick="openStartDayModal()" style="display:none;">
    <i class="ph-duotone ph-play-circle"></i>
    Start Day
  </button>

  <!-- Started Badge (appears after shift start is set) -->
  <div id="startedBadge" class="started-badge" onclick="editStartTime()" style="display:none;">
    <i class="ph-duotone ph-clock"></i>
    Started: <span id="startTimeDisplay">—</span>
    <i id="badgeIcon" class="ph-duotone ph-pencil-simple"></i>
  </div>
```

**Step 2: Add CSS styles**

At end of `css/scoreboard.css`:

```css
/* Start Day Button & Badge */
.start-day-btn {
  position: fixed;
  top: 20px;
  right: 180px;
  background: rgba(34, 197, 94, 0.2);
  border: 2px solid #22c55e;
  color: #22c55e;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.3s ease;
  z-index: 100;
}

.start-day-btn:hover {
  background: rgba(34, 197, 94, 0.3);
  transform: translateY(-2px);
}

.start-day-btn.pulse-green {
  animation: pulse-green 2s infinite;
}

@keyframes pulse-green {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7);
  }
  50% {
    box-shadow: 0 0 0 10px rgba(34, 197, 94, 0);
  }
}

.started-badge {
  position: fixed;
  top: 20px;
  right: 180px;
  background: rgba(228, 170, 79, 0.15);
  border: 2px solid #e4aa4f;
  color: #e4aa4f;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  transition: all 0.3s ease;
  z-index: 100;
}

.started-badge:hover {
  background: rgba(228, 170, 79, 0.25);
}

.started-badge.locked {
  cursor: default;
  border-color: #94a3b8;
  color: #94a3b8;
  background: rgba(148, 163, 184, 0.1);
}

.started-badge.locked:hover {
  background: rgba(148, 163, 184, 0.1);
}

#badgeIcon {
  font-size: 16px;
  opacity: 0.8;
}
```

**Step 3: Verify visual appearance**

Run: Open scoreboard.html, inspect button/badge visibility
Expected: Both hidden (display:none), proper positioning when toggled via DevTools

**Step 4: Commit**

```bash
git add scoreboard.html css/scoreboard.css
git commit -m "feat(scoreboard): add Start Day button and Started badge UI"
```

---

## Task 4: Create Time Picker Modal HTML/CSS

**Files:**
- Modify: `scoreboard.html` (before closing body tag)
- Modify: `css/scoreboard.css` (end of file)

**Step 1: Add modal HTML**

Before `</body>` tag (around line 280), add:

```html
  <!-- Start Day Modal -->
  <div id="startDayModal" class="modal-overlay" style="display:none;">
    <div class="modal-content start-day-modal">
      <h3 class="modal-title">
        <i class="ph-duotone ph-play-circle"></i>
        Set Shift Start Time
      </h3>
      <p class="modal-subtitle">What time did production begin today?</p>

      <div class="time-input-wrapper">
        <label for="startTimeInput">Start Time:</label>
        <input type="time" id="startTimeInput" class="time-input" />
      </div>

      <div class="impact-preview" id="impactPreview">
        <i class="ph-duotone ph-info"></i>
        <div class="impact-text">
          This will adjust daily goal by <span id="goalReduction">—</span>
          <div class="impact-details">
            <span id="originalGoal">200</span> lbs → <span id="adjustedGoalPreview">—</span> lbs
          </div>
        </div>
      </div>

      <div class="modal-actions">
        <button onclick="cancelStartTime()" class="btn-secondary">Cancel</button>
        <button onclick="confirmStartTime()" class="btn-primary">Confirm</button>
      </div>
    </div>
  </div>
```

**Step 2: Add modal CSS**

At end of `css/scoreboard.css`:

```css
/* Start Day Modal */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.start-day-modal {
  background: var(--card-bg);
  border: 2px solid var(--border-color);
  border-radius: 12px;
  padding: 24px;
  width: 90%;
  max-width: 400px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}

.modal-title {
  font-size: 20px;
  font-weight: 700;
  margin: 0 0 8px 0;
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-primary);
}

.modal-subtitle {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0 0 24px 0;
}

.time-input-wrapper {
  margin-bottom: 20px;
}

.time-input-wrapper label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--text-primary);
}

.time-input {
  width: 100%;
  padding: 12px;
  border: 2px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 18px;
  font-family: 'JetBrains Mono', monospace;
  font-weight: 600;
}

.time-input:focus {
  outline: none;
  border-color: #22c55e;
}

.impact-preview {
  background: rgba(228, 170, 79, 0.1);
  border: 1px solid rgba(228, 170, 79, 0.3);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 24px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.impact-preview i {
  font-size: 20px;
  color: #e4aa4f;
  flex-shrink: 0;
  margin-top: 2px;
}

.impact-text {
  font-size: 14px;
  color: var(--text-primary);
  line-height: 1.5;
}

.impact-details {
  font-size: 16px;
  font-weight: 700;
  margin-top: 6px;
  font-family: 'JetBrains Mono', monospace;
}

#goalReduction {
  color: #e4aa4f;
  font-weight: 700;
}

#adjustedGoalPreview {
  color: #22c55e;
}

.modal-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.btn-secondary,
.btn-primary {
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.btn-secondary {
  background: transparent;
  border: 2px solid var(--border-color);
  color: var(--text-secondary);
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.05);
}

.btn-primary {
  background: #22c55e;
  color: #fff;
}

.btn-primary:hover {
  background: #16a34a;
  transform: translateY(-1px);
}
```

**Step 3: Verify modal appearance**

Run: Open DevTools, set `#startDayModal` to `display:flex`, check layout
Expected: Modal centered, inputs styled, responsive

**Step 4: Commit**

```bash
git add scoreboard.html css/scoreboard.css
git commit -m "feat(scoreboard): add time picker modal UI"
```

---

## Task 5: Implement Modal Open/Close/Preview Logic

**Files:**
- Create: `js/scoreboard/shift-start.js`
- Modify: `scoreboard.html:32` (add script tag)

**Step 1: Create shift-start.js module**

Create `js/scoreboard/shift-start.js`:

```javascript
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

    // TODO: Send to API (Task 9)
    console.log('Shift start set to:', startTime);

    // Trigger data refresh to recalculate targets
    if (window.ScoreboardAPI && window.ScoreboardAPI.loadData) {
      // Will be implemented in Task 9
    }
  }

  /**
   * Edit start time (opens modal if not locked)
   */
  function editStartTime() {
    if (State.shiftStartLocked) {
      // Show tooltip or alert
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
```

**Step 2: Add script tag to scoreboard.html**

After line 31 (`<script defer src="js/scoreboard/main.js?v=3"></script>`), add:

```html
  <script defer src="js/scoreboard/shift-start.js?v=1"></script>
```

**Step 3: Test modal flow**

Run: Open scoreboard, click "Start Day", select time, check preview updates
Expected: Modal opens, preview calculates correctly, badge appears on confirm

**Step 4: Commit**

```bash
git add js/scoreboard/shift-start.js scoreboard.html
git commit -m "feat(scoreboard): implement shift start modal logic and UI state"
```

---

## Task 6: Add Locking Logic After First Bag

**Files:**
- Modify: `js/scoreboard/shift-start.js` (add checkLockStatus function)
- Modify: `js/scoreboard/main.js:92-101` (add lock check)

**Step 1: Add checkLockStatus function to shift-start.js**

After `editStartTime()` function, add:

```javascript
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
```

**Step 2: Call checkLockStatus in main.js loadData**

Find the `loadData()` function in `main.js` (around line 92), after `Render.renderScoreboard()`, add:

```javascript
        // Check if shift start should be locked
        if (window.ScoreboardShiftStart) {
          window.ScoreboardShiftStart.checkLockStatus();
        }
```

**Step 3: Test lock behavior**

Run: Set start time, manually set `State.timerData.bagsToday = 1`, trigger loadData
Expected: Badge switches to locked state with lock icon

**Step 4: Commit**

```bash
git add js/scoreboard/shift-start.js js/scoreboard/main.js
git commit -m "feat(scoreboard): add locking after first bag scan"
```

---

## Task 7: Update Timer to Use Manual Start Time

**Files:**
- Modify: `js/scoreboard/timer.js:104-112` (update getShiftStartTime)

**Step 1: Modify getShiftStartTime to check for override**

Replace the existing `getShiftStartTime()` function:

```javascript
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
```

**Step 2: Test timer with manual start**

Run: Set manual start to 7:45 AM, verify timer countdown uses 7:45 as reference
Expected: Timer elapsed time starts from 7:45 AM, not 7:00 AM

**Step 3: Commit**

```bash
git add js/scoreboard/timer.js
git commit -m "feat(scoreboard): integrate manual shift start with timer countdown"
```

---

## Task 8: Bump Service Worker Cache Version

**Files:**
- Modify: `service-worker.js:1` (update version)

**Step 1: Update cache version**

Find line 1 in `service-worker.js`:

```javascript
const CACHE_VERSION = 'v3.6';
```

Change to:

```javascript
const CACHE_VERSION = 'v3.7';
```

**Step 2: Commit**

```bash
git add service-worker.js
git commit -m "chore: bump service worker cache to v3.7"
```

---

## Task 9: Create Backend API Endpoint (Apps Script)

**Files:**
- Modify: `apps-script/production-tracking/Code.gs` (add handlers)

**Step 1: Add setShiftStart handler**

After existing `doGet()` function, add:

```javascript
/**
 * Handle shift start time setting
 */
function handleSetShiftStart(params) {
  try {
    var timestamp = new Date(params.time);
    var today = new Date();

    // Validation
    if (!isSameDay(timestamp, today)) {
      return jsonResponse({ success: false, error: 'Can only set start time for today' });
    }

    if (timestamp > today) {
      return jsonResponse({ success: false, error: 'Cannot set future start time' });
    }

    // Calculate adjustments
    var availableHours = calculateAvailableHours(timestamp);
    var normalHours = 8.5;
    var scaleFactor = availableHours / normalHours;

    // Get baseline goals from config or calculate
    var baselineDailyGoal = 200;  // TODO: Make configurable
    var adjustedGoal = Math.round(baselineDailyGoal * scaleFactor);

    // Log to Shift Adjustments sheet
    logShiftAdjustment({
      date: Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      shiftStart: Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'HH:mm:ss'),
      setAt: Utilities.formatDate(today, Session.getScriptTimeZone(), 'HH:mm:ss'),
      availableHours: availableHours.toFixed(2),
      scaleFactor: scaleFactor.toFixed(3)
    });

    return jsonResponse({
      success: true,
      shiftAdjustment: {
        manualStartTime: timestamp.toISOString(),
        availableHours: availableHours,
        scaleFactor: scaleFactor,
        adjustedDailyGoal: adjustedGoal
      }
    });

  } catch (error) {
    return jsonResponse({ success: false, error: error.toString() });
  }
}

/**
 * Calculate available working hours from start to 4:30 PM
 */
function calculateAvailableHours(startTime) {
  var shiftEnd = new Date(startTime);
  shiftEnd.setHours(16, 30, 0, 0);

  var totalMinutes = (shiftEnd - startTime) / 60000;

  // Scheduled breaks [startHour, startMin, endHour, endMin]
  var breaks = [
    [9, 0, 9, 10],
    [12, 0, 12, 30],
    [14, 30, 14, 40],
    [16, 20, 16, 30]
  ];

  var breakMinutes = 0;
  breaks.forEach(function(brk) {
    var breakStart = new Date(startTime);
    breakStart.setHours(brk[0], brk[1], 0, 0);
    var breakEnd = new Date(startTime);
    breakEnd.setHours(brk[2], brk[3], 0, 0);

    if (startTime < breakEnd && breakStart < shiftEnd) {
      var overlapStart = Math.max(startTime.getTime(), breakStart.getTime());
      var overlapEnd = Math.min(shiftEnd.getTime(), breakEnd.getTime());
      breakMinutes += (overlapEnd - overlapStart) / 60000;
    }
  });

  return (totalMinutes - breakMinutes) / 60;
}

/**
 * Log shift adjustment to Google Sheets
 */
function logShiftAdjustment(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Shift Adjustments');

  // Create sheet if doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet('Shift Adjustments');
    sheet.appendRow(['Date', 'Shift Start', 'Set At', 'Available Hours', 'Scale Factor', 'Notes']);
  }

  sheet.appendRow([
    data.date,
    data.shiftStart,
    data.setAt,
    data.availableHours,
    data.scaleFactor,
    ''
  ]);
}

/**
 * Helper: Check if two dates are same day
 */
function isSameDay(date1, date2) {
  return date1.getFullYear() === date2.getFullYear() &&
         date1.getMonth() === date2.getMonth() &&
         date1.getDate() === date2.getDate();
}
```

**Step 2: Update doGet to route new action**

Find `doGet(e)` function, add case for new action:

```javascript
  var action = e.parameter.action || 'scoreboard';

  // ... existing cases ...

  if (action === 'setShiftStart') {
    return handleSetShiftStart(e.parameter);
  }

  if (action === 'getShiftStart') {
    return handleGetShiftStart(e.parameter);
  }
```

**Step 3: Add getShiftStart handler**

```javascript
/**
 * Get today's shift start adjustment
 */
function handleGetShiftStart(params) {
  try {
    var date = params.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Shift Adjustments');

    if (!sheet) {
      return jsonResponse({ success: true, shiftAdjustment: null });
    }

    var data = sheet.getDataRange().getValues();

    // Find today's entry (most recent)
    for (var i = data.length - 1; i >= 1; i--) {
      if (data[i][0] === date) {
        return jsonResponse({
          success: true,
          shiftAdjustment: {
            manualStartTime: date + 'T' + data[i][1],
            availableHours: parseFloat(data[i][3]),
            scaleFactor: parseFloat(data[i][4])
          }
        });
      }
    }

    return jsonResponse({ success: true, shiftAdjustment: null });

  } catch (error) {
    return jsonResponse({ success: false, error: error.toString() });
  }
}
```

**Step 4: Deploy and test**

Run: Deploy as web app, test with Postman/curl:
```
GET: ?action=setShiftStart&time=2026-01-09T07:45:00
```

Expected: Success response with adjustments

**Step 5: Commit**

```bash
git add apps-script/production-tracking/Code.gs
git commit -m "feat(backend): add shift start adjustment API endpoints"
```

---

## Task 10: Integrate API Calls in Frontend

**Files:**
- Modify: `js/scoreboard/shift-start.js` (update confirmStartTime)
- Modify: `js/scoreboard/api.js` (add new methods)

**Step 1: Add API methods to api.js**

After `logResume()` method, add:

```javascript
    /**
     * Set shift start time
     * @param {Date} startTime - Start time to set
     * @param {Function} onSuccess - Success callback
     * @param {Function} onError - Error callback
     */
    setShiftStart: function(startTime, onSuccess, onError) {
      if (this.isAppsScript()) {
        google.script.run
          .withSuccessHandler(onSuccess)
          .withFailureHandler(onError)
          .handleSetShiftStart({ time: startTime.toISOString() });
      } else {
        var apiUrl = this.getApiUrl();
        var url = apiUrl + '?action=setShiftStart&time=' + encodeURIComponent(startTime.toISOString());

        fetch(url)
          .then(function(response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
          })
          .then(onSuccess)
          .catch(function(error) {
            console.error('setShiftStart error:', error);
            if (onError) onError(error);
          });
      }
    },

    /**
     * Get today's shift start adjustment
     * @param {Function} onSuccess - Success callback
     * @param {Function} onError - Error callback
     */
    getShiftStart: function(onSuccess, onError) {
      if (this.isAppsScript()) {
        google.script.run
          .withSuccessHandler(onSuccess)
          .withFailureHandler(onError)
          .handleGetShiftStart({});
      } else {
        var apiUrl = this.getApiUrl();
        var today = new Date().toISOString().split('T')[0];
        var url = apiUrl + '?action=getShiftStart&date=' + today;

        fetch(url)
          .then(function(response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
          })
          .then(onSuccess)
          .catch(function(error) {
            console.error('getShiftStart error:', error);
            if (onError) onError(error);
          });
      }
    }
```

**Step 2: Update confirmStartTime to call API**

In `shift-start.js`, replace the TODO comment in `confirmStartTime()`:

```javascript
    // Save to API
    if (window.ScoreboardAPI) {
      window.ScoreboardAPI.setShiftStart(
        startTime,
        function(response) {
          if (response.success && response.shiftAdjustment) {
            State.shiftAdjustment = response.shiftAdjustment;
            console.log('Shift start saved to API:', response.shiftAdjustment);

            // Trigger data refresh
            if (window.ScoreboardAPI.loadData) {
              // Data will reload with adjusted targets
            }
          }
        },
        function(error) {
          console.error('Failed to save shift start:', error);
          // Continue anyway - localStorage is already saved
        }
      );
    }
```

**Step 3: Load shift start on init**

Add to `initShiftStartUI()` after localStorage check:

```javascript
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
```

**Step 4: Test API integration**

Run: Set start time, check Network tab for API call, verify response
Expected: API call succeeds, adjustment data returned

**Step 5: Commit**

```bash
git add js/scoreboard/api.js js/scoreboard/shift-start.js
git commit -m "feat(scoreboard): integrate shift start with backend API"
```

---

## Task 11: Update Render Module to Use Adjusted Targets

**Files:**
- Modify: `js/scoreboard/render.js:28-42` (adjust data extraction)

**Step 1: Check for adjustment and override targets**

After line 18 (`const t = ...`), add:

```javascript
      // Apply shift adjustment if exists
      if (State.shiftAdjustment) {
        var adjustment = State.shiftAdjustment;
        data.dailyGoal = adjustment.adjustedDailyGoal || data.dailyGoal;
        data.effectiveHours = adjustment.availableHours || data.effectiveHours || 8.5;

        // Recalculate todayTarget proportionally
        var scaleFactor = adjustment.scaleFactor || 1;
        data.todayTarget = (data.todayTarget || 0) * scaleFactor;
      }
```

**Step 2: Test target adjustment**

Run: Set start time to 7:45 AM, verify daily goal displays ~182 lbs instead of 200
Expected: All target displays use adjusted values

**Step 3: Commit**

```bash
git add js/scoreboard/render.js
git commit -m "feat(scoreboard): apply shift adjustment to rendered targets"
```

---

## Task 12: Add Tooltip for Locked Badge

**Files:**
- Modify: `js/scoreboard/shift-start.js` (add tooltip on click)
- Modify: `css/scoreboard.css` (add tooltip styles)

**Step 1: Update editStartTime to show tooltip when locked**

Replace `editStartTime()` function:

```javascript
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
```

**Step 2: Add tooltip CSS**

At end of `css/scoreboard.css`:

```css
.lock-tooltip {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 8px;
  background: rgba(0, 0, 0, 0.9);
  color: #fff;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  white-space: nowrap;
  z-index: 1000;
  animation: tooltip-fade-in 0.2s ease;
}

@keyframes tooltip-fade-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

**Step 3: Test tooltip**

Run: Lock badge, click it, verify tooltip appears for 2 seconds
Expected: Tooltip shows "Cannot edit after first bag"

**Step 4: Commit**

```bash
git add js/scoreboard/shift-start.js css/scoreboard.css
git commit -m "feat(scoreboard): add tooltip for locked shift start badge"
```

---

## Task 13: Final Integration Testing

**Files:**
- None (testing only)

**Step 1: Test full flow on fresh page load**

1. Open scoreboard.html in incognito
2. Verify "Start Day" button is pulsing green
3. Click button, modal opens
4. Set time to 7:45 AM
5. Verify preview shows goal reduction
6. Click Confirm
7. Verify badge shows "Started: 7:45 AM"
8. Verify timer countdown uses 7:45 AM
9. Manually set `State.timerData.bagsToday = 1`
10. Refresh data
11. Verify badge locks (lock icon, no edit on click)

Expected: All steps pass

**Step 2: Test localStorage persistence**

1. Set start time
2. Refresh page
3. Verify badge still shows start time
4. Verify timer still uses manual start

Expected: Persists across page reloads

**Step 3: Test midnight reset**

1. Set start time
2. Change system date to next day (or manually clear date in localStorage)
3. Refresh page
4. Verify "Start Day" button reappears
5. Verify localStorage cleared

Expected: Resets for new day

**Step 4: Test API sync**

1. Set start time on Device A
2. Open scoreboard on Device B
3. Verify Device B loads start time from API
4. Verify both show same badge

Expected: Multi-device sync works

**Step 5: Document any issues**

Create GitHub issue for any bugs found during testing

**Step 6: Commit test summary**

```bash
git add .
git commit -m "test(scoreboard): complete shift start adjustment integration testing"
```

---

## Implementation Complete

**Total Tasks:** 13
**Estimated Time:** 3-4 hours
**Files Modified:** 8
**Files Created:** 1
**Lines Added:** ~900

**Next Steps:**
1. Push to GitHub
2. Deploy backend changes to Google Apps Script
3. Monitor production usage tomorrow morning
4. Gather feedback from production team
5. Iterate based on real-world usage

---
