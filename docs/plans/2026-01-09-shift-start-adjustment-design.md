# Shift Start Adjustment Feature Design

**Date:** 2026-01-09
**Feature:** Manual shift start time with automatic target adjustment
**Scope:** Scoreboard (timer + targets)

## Problem Statement

Production shifts don't always start at the scheduled 7:00 AM due to morning meetings, equipment issues, or other delays. Currently, the system assumes a fixed 7:00 AM start, which means:
- Daily production goals remain unchanged even with less available time
- Projections become inaccurate
- Timer countdown may not reflect actual working time

This creates unrealistic expectations and makes performance tracking misleading.

## Solution Overview

Add a "Start Day" button on the scoreboard that allows the production team to record when they actually begin work. The system will:
1. Calculate reduced available working hours
2. Proportionally adjust daily production goals
3. Update projections to reflect realistic targets
4. Maintain accurate timer countdown from actual start time

## User Experience

### Visual Flow

**State 1: Pre-Start (Day Beginning)**
```
[Scoreboard Header]
  Time: 7:45 AM                    [Start Day] ← Pulsing green
  Date: Thursday, Jan 9
```

**State 2: Post-Start (Editable)**
```
[Scoreboard Header]
  Time: 7:45 AM                    [Started: 7:45 AM ✎]
  Date: Thursday, Jan 9            Click to adjust
```

**State 3: Locked (After First Bag)**
```
[Scoreboard Header]
  Time: 9:30 AM                    [Started: 7:45 AM 🔒]
  Date: Thursday, Jan 9            Locked after first bag
```

### Interaction Flow

1. **Setting Start Time:**
   - Click "Start Day" button (pulsing green)
   - Modal appears with time picker (defaults to current time)
   - Shows preview: "This will reduce daily goal by 18 lbs (200 → 182)"
   - Click "Confirm" to save, "Cancel" to dismiss

2. **Editing Start Time (Before First Bag):**
   - Click badge showing "Started: 7:45 AM ✎"
   - Same modal opens, can adjust time
   - Saves updated time and recalculates targets

3. **Locked State:**
   - After first bag scanned, badge shows lock icon
   - Clicking badge shows tooltip: "Cannot edit after first bag"
   - Remains visible for transparency

### Button States

| State | Visual | Behavior | When |
|-------|--------|----------|------|
| Waiting | Green pulsing "Start Day" button | Opens time picker | Before any start time set |
| Active | Badge "Started: 7:45 AM ✎" | Reopens time picker | After set, before first bag |
| Locked | Badge "Started: 7:45 AM 🔒" | Read-only, shows tooltip | After first bag scanned |

## Technical Architecture

### Data Model

**State Storage (localStorage + API):**
```javascript
{
  shiftStartTime: "2026-01-09T07:45:00",  // ISO timestamp
  shiftStartSetBy: "manual",               // "manual" or "default"
  isLocked: false,                         // locked after first bag
  lastSyncedAt: "2026-01-09T07:45:23"     // for sync conflict resolution
}
```

**Google Sheets - New "Shift Adjustments" Tab:**
| Date | Shift Start | Set At | Set By | Available Hours | Scale Factor | Notes |
|------|-------------|--------|--------|-----------------|--------------|-------|
| 2026-01-09 | 07:45:00 | 07:45:23 | Manual | 7.75 | 0.91 | Morning meeting |

### Storage Strategy

**Write Path:**
1. User sets start time → Validate (reasonable range, today's date)
2. Save to `State.manualShiftStart`
3. Write to localStorage (instant feedback)
4. API call: `?action=setShiftStart&time=<ISO>&reason=manual`
5. Backend validates + logs to Sheets + returns adjusted targets

**Read Path (On Page Load):**
1. Check API: `?action=getShiftStart&date=<today>`
2. If API returns start time → use it, save to localStorage
3. If API fails/offline → fallback to localStorage
4. If no data exists → use default 7:00 AM

**Sync Strategy:**
- Every data refresh (15 sec), check if API has different timestamp
- If different and not locked → show notification "Start time updated by another device"
- If locked → ignore updates (first bag takes precedence)

### Available Hours Calculation

```javascript
function getAvailableProductiveHours(shiftStart) {
  const shiftEnd = new Date();
  shiftEnd.setHours(16, 30, 0, 0);  // 4:30 PM fixed

  const totalMinutes = (shiftEnd - shiftStart) / 60000;

  // Subtract scheduled breaks that fall within shift window
  const breaks = [
    [9, 0, 9, 10],      // 9:00-9:10 AM
    [12, 0, 12, 30],    // 12:00-12:30 PM
    [14, 30, 14, 40],   // 2:30-2:40 PM
    [16, 20, 16, 30]    // 4:20-4:30 PM cleanup
  ];

  let breakMinutes = 0;
  breaks.forEach(([startH, startM, endH, endM]) => {
    const breakStart = new Date().setHours(startH, startM, 0, 0);
    const breakEnd = new Date().setHours(endH, endM, 0, 0);

    // Only count breaks that overlap with actual working time
    if (shiftStart < breakEnd && breakStart < shiftEnd) {
      const overlapStart = Math.max(shiftStart, breakStart);
      const overlapEnd = Math.min(shiftEnd, breakEnd);
      breakMinutes += (overlapEnd - overlapStart) / 60000;
    }
  });

  return (totalMinutes - breakMinutes) / 60;  // Convert to hours
}
```

**Example Calculations:**

| Start Time | End Time | Breaks Included | Total Mins | Break Mins | Available Hours |
|------------|----------|-----------------|------------|------------|-----------------|
| 7:00 AM | 4:30 PM | All 4 | 570 | 60 | 8.5 hrs |
| 7:45 AM | 4:30 PM | All 4 | 525 | 60 | 7.75 hrs |
| 9:30 AM | 4:30 PM | Last 3 | 420 | 50 | 6.17 hrs |
| 12:45 PM | 4:30 PM | Last 2 | 225 | 20 | 3.42 hrs |

### Target Adjustment Logic

**What Changes:**
```javascript
const normalHours = 8.5;  // Standard 7:00 AM → 4:30 PM shift
const actualHours = getAvailableProductiveHours(manualShiftStart);
const scaleFactor = actualHours / normalHours;

// Adjusted metrics
data.dailyGoal = baselineDailyGoal * scaleFactor;
data.todayTarget = baselineTodayTarget * scaleFactor;
data.projectedTotal = calculateProjection(actualHours);  // Uses actual hours
data.effectiveHours = actualHours;  // Display to user
```

**What Stays the Same:**
- `data.targetRate` - Lbs per trimmer per hour (unchanged)
- `timerData.targetSeconds` - Bag completion target (unchanged)
- `data.lastHourTarget` - Based on crew size and rate (unchanged)
- Break times - Fixed schedule (9:00, 12:00, 2:30, 4:20)

**Example (45 min late start):**

| Metric | Normal (7:00 AM) | Late (7:45 AM) | Calculation |
|--------|------------------|----------------|-------------|
| Available Hours | 8.5 hrs | 7.75 hrs | 7:45 → 4:30 minus breaks |
| Scale Factor | 1.0 | 0.91 | 7.75 / 8.5 |
| Daily Goal | 200 lbs | 182 lbs | 200 × 0.91 |
| Bag Target | 5:00 | 5:00 | **Unchanged** |
| Rate Target | 2.5 lbs/hr | 2.5 lbs/hr | **Unchanged** |

### Integration Points

**1. Timer Module (`timer.js`)**

Update `getShiftStartTime()`:
```javascript
function getShiftStartTime() {
  // Check for manual start time override
  const manualStart = State.manualShiftStart;
  if (manualStart && isToday(manualStart)) {
    return new Date(manualStart);
  }

  // Default: 7:00 AM today
  const defaultStart = new Date();
  defaultStart.setHours(7, 0, 0, 0);
  return defaultStart;
}
```

**2. State Module (`state.js`)**

Add new state properties:
```javascript
manualShiftStart: null,      // Date object or null
shiftStartLocked: false,     // locked after first bag
shiftAdjustment: null        // { availableHours, scaleFactor, adjustedGoals }
```

**3. API Module (`api.js`)**

New API endpoints:
```javascript
// Set shift start time
API.setShiftStart(timestamp, onSuccess, onError)
// GET: ?action=setShiftStart&time=<ISO>&reason=manual

// Get today's shift start
API.getShiftStart(date, onSuccess, onError)
// GET: ?action=getShiftStart&date=YYYY-MM-DD
```

**4. Render Module (`render.js`)**

Use adjusted targets from API response:
```javascript
// Check if adjustment exists
const adjustment = State.shiftAdjustment;
if (adjustment) {
  data.dailyGoal = adjustment.adjustedDailyGoal;
  data.todayTarget = adjustment.adjustedTodayTarget;
  data.effectiveHours = adjustment.availableHours;
}
```

**5. Backend (Apps Script)**

New handler in `Code.gs`:
```javascript
function handleSetShiftStart(params) {
  const timestamp = new Date(params.time);
  const today = new Date();

  // Validation
  if (!isSameDay(timestamp, today)) {
    return { success: false, error: 'Can only set start time for today' };
  }
  if (timestamp > today) {
    return { success: false, error: 'Cannot set future start time' };
  }

  // Calculate adjustments
  const availableHours = calculateAvailableHours(timestamp);
  const scaleFactor = availableHours / 8.5;
  const adjustedGoals = {
    dailyGoal: baselineDailyGoal * scaleFactor,
    todayTarget: baselineTodayTarget * scaleFactor
  };

  // Log to Shift Adjustments sheet
  logShiftAdjustment({
    date: formatDate(today),
    shiftStart: formatTime(timestamp),
    setAt: formatTime(today),
    availableHours: availableHours,
    scaleFactor: scaleFactor
  });

  return {
    success: true,
    shiftAdjustment: {
      manualStartTime: timestamp.toISOString(),
      availableHours: availableHours,
      scaleFactor: scaleFactor,
      adjustedDailyGoal: adjustedGoals.dailyGoal,
      adjustedTodayTarget: adjustedGoals.todayTarget
    }
  };
}
```

## UI Components

### Start Day Button Component

**HTML:**
```html
<button id="startDayBtn" class="start-day-btn pulse-green" onclick="openStartDayModal()">
  <i class="ph-duotone ph-play-circle"></i>
  Start Day
</button>
```

**CSS (Pulsing Animation):**
```css
.start-day-btn.pulse-green {
  animation: pulse-green 2s infinite;
}

@keyframes pulse-green {
  0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); }
  50% { box-shadow: 0 0 0 10px rgba(34, 197, 94, 0); }
}
```

### Started Badge Component

**HTML:**
```html
<div id="startedBadge" class="started-badge" onclick="editStartTime()">
  <i class="ph-duotone ph-clock"></i>
  Started: <span id="startTimeDisplay">7:45 AM</span>
  <i id="badgeIcon" class="ph-duotone ph-pencil-simple"></i>
</div>
```

**States:**
- Editable: Show pencil icon, cursor pointer, green border
- Locked: Show lock icon, cursor default, gray border

### Time Picker Modal

**HTML:**
```html
<div id="startDayModal" class="modal">
  <div class="modal-content">
    <h3>Set Shift Start Time</h3>
    <p class="modal-subtitle">What time did production begin?</p>

    <input type="time" id="startTimeInput" value="07:45" />

    <div class="impact-preview">
      <i class="ph-duotone ph-info"></i>
      This will reduce daily goal by <span id="goalReduction">18 lbs</span>
      <div class="impact-details">
        200 lbs → <span id="adjustedGoal">182 lbs</span>
      </div>
    </div>

    <div class="modal-actions">
      <button onclick="cancelStartTime()" class="btn-secondary">Cancel</button>
      <button onclick="confirmStartTime()" class="btn-primary">Confirm</button>
    </div>
  </div>
</div>
```

### Visual Hierarchy

**Placement:** Scoreboard header, right side near time/date display

```
┌─────────────────────────────────────────────────────┐
│ [Strain Display]           [Time/Date]   [Start Day]│
│                            7:45 AM        [Button]   │
│                         Thursday, Jan 9              │
└─────────────────────────────────────────────────────┘
```

After start:
```
┌─────────────────────────────────────────────────────┐
│ [Strain Display]           [Time/Date] [Started Badge]│
│                            9:30 AM      Started: 7:45│
│                         Thursday, Jan 9              │
└─────────────────────────────────────────────────────┘
```

## Edge Cases & Validation

### Time Validation

**Valid Range:** 5:00 AM - 11:00 AM
- Before 5:00 AM → Error: "Start time too early"
- After 11:00 AM → Allow but warn: "Starting mid-day will significantly reduce targets"

**Future Time:** Block
- Error: "Cannot set future start time"

**Past Day:** Block
- Error: "Can only set start time for today"

### Locking Logic

**When to Lock:**
```javascript
function checkLockStatus() {
  const bagsToday = (State.timerData && State.timerData.bagsToday) || 0;

  if (bagsToday > 0 && !State.shiftStartLocked) {
    State.shiftStartLocked = true;
    localStorage.setItem('shiftStartLocked', 'true');
    updateBadgeToLocked();
  }
}
```

**Run check:**
- On every data refresh (15 sec interval)
- After manual bag completion button clicked
- On page load/reload

### Multi-Device Sync

**Conflict Resolution:**

| Scenario | Device A | Device B | Resolution |
|----------|----------|----------|------------|
| Both set before lock | Sets 7:30 | Sets 7:45 | Last write wins, show notification |
| A locked, B tries to edit | Locked at 7:30 | Tries to set 7:45 | Reject B's edit, show "Locked" |
| A offline, B sets time | Offline | Sets 7:45 | A syncs on reconnect, adopts 7:45 |

**Sync Notification:**
```
⚠️ Start time updated to 7:45 AM by another device
```

### Midnight Reset

**Automatic Cleanup:**
```javascript
// Check on page load
const lastDate = localStorage.getItem('shiftStartDate');
const today = new Date().toDateString();

if (lastDate !== today) {
  // New day - clear previous shift data
  localStorage.removeItem('manualShiftStart');
  localStorage.removeItem('shiftStartLocked');
  localStorage.setItem('shiftStartDate', today);
  State.manualShiftStart = null;
  State.shiftStartLocked = false;
}
```

### Break Time Edge Cases

**Starting During Break:**
- If start time falls within break window (e.g., 12:15 PM during lunch)
- Round to break end time (12:15 → 12:30)
- Show message: "Start time adjusted to 12:30 PM (after lunch break)"

**Starting After All Breaks:**
- If start time is 4:00 PM (after 2:30 PM break)
- Only cleanup break (4:20-4:30) remains
- Available hours = 0.17 hrs (10 minutes)
- Show warning: "Very limited production time remaining today"

## Success Metrics

### Functionality
- ✅ Button pulsing is noticeable to operators
- ✅ Time picker modal is easy to use on touch screens
- ✅ Target adjustments are accurate (±1 lb)
- ✅ Locking prevents accidental changes
- ✅ Multi-device sync works within 30 seconds

### User Experience
- ✅ Production team can set start time in <10 seconds
- ✅ Adjusted goals feel realistic to supervisors
- ✅ No confusion about what metrics change vs stay same
- ✅ Badge visibility keeps team informed of adjustment

### Data Quality
- ✅ All shift adjustments logged in Google Sheets
- ✅ Historical data shows patterns (meeting frequency)
- ✅ Projections become more accurate on delayed days

## Future Enhancements (Out of Scope)

**Not implementing now, but worth noting:**

1. **Reason Dropdown** - "Morning Meeting", "Equipment Issue", "Other"
2. **Break Adjustments** - Allow skipping/moving breaks
3. **Early End** - "End Day" button for early shutdowns
4. **Historical View** - Dashboard showing all adjusted days
5. **Notifications** - Alert supervisors when start time set late
6. **Analytics** - Track correlation between delays and productivity

## Implementation Checklist

- [ ] Add state properties for manual shift start
- [ ] Create Start Day button component with pulse animation
- [ ] Build time picker modal with impact preview
- [ ] Implement available hours calculation function
- [ ] Update timer integration to use manual start
- [ ] Add locking logic (check bagsToday)
- [ ] Create badge component (editable/locked states)
- [ ] Add localStorage persistence
- [ ] Create API endpoint: setShiftStart
- [ ] Create API endpoint: getShiftStart
- [ ] Update backend to calculate adjustments
- [ ] Create "Shift Adjustments" sheet in Google Sheets
- [ ] Add sync logic (15 sec interval)
- [ ] Implement midnight reset cleanup
- [ ] Add validation (time range, date checks)
- [ ] Test multi-device sync scenarios
- [ ] Add tooltip and notification messages
- [ ] Update render module to use adjusted targets
- [ ] Test with production team

## Testing Scenarios

1. **Basic Flow:** Click button → set 7:45 → verify goal drops from 200 to 182
2. **Edit Before Lock:** Set 7:30 → edit to 7:45 → verify goal recalculates
3. **Lock After Bag:** Set 7:45 → scan bag → verify badge locked
4. **Multi-Device:** Set on device A → refresh device B → verify synced
5. **Late Start:** Set 10:00 AM → verify only 1-2 breaks counted
6. **Midnight Reset:** Set time → wait until next day → verify cleared
7. **Offline Mode:** Disconnect → set time → reconnect → verify saved to API
8. **Timer Accuracy:** Set 7:45 → verify timer uses 7:45 for countdown

---

**End of Design Document**
