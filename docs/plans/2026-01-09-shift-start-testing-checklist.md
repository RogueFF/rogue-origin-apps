# Shift Start Adjustment - Final Integration Testing Checklist

## Overview
This checklist covers all testing scenarios for the shift start adjustment feature implementation.

**Implementation Status:** ✅ Complete (Tasks 1-12)
**Testing Required:** Manual verification of all flows

---

## Test Environment Setup

Before testing, ensure:
- [ ] All local commits are pushed to GitHub (user will do this after repo reorganization)
- [ ] Backend changes deployed to Google Apps Script
- [ ] Service worker cache cleared (v3.7)
- [ ] Browser cache cleared
- [ ] Testing in incognito window for fresh state

---

## Test 1: Fresh Page Load Flow

**Scenario:** First time loading scoreboard on a new day

**Steps:**
1. Open scoreboard.html in incognito window
2. Verify "Start Day" button appears (top-right, pulsing green)
3. Click "Start Day" button
4. Modal should open with:
   - Title: "Set Shift Start Time"
   - Time input pre-filled with current time
   - Impact preview showing "—" placeholders
5. Change time to 7:45 AM
6. Verify impact preview updates:
   - Shows goal reduction (e.g., "-18 lbs")
   - Shows original goal → adjusted goal (e.g., "200 lbs → 182 lbs")
7. Click "Confirm"
8. Verify badge appears showing "Started: 7:45 AM" with pencil icon
9. Verify button is hidden
10. Check console for: "Shift start set to: [timestamp]"

**Expected Result:** ✅ Button → Modal → Badge flow works smoothly

---

## Test 2: Timer Integration

**Scenario:** Verify timer countdown uses manual start time

**Steps:**
1. After setting start time to 7:45 AM (from Test 1)
2. Observe timer countdown display
3. Verify elapsed time starts from 7:45 AM (not default 7:00 AM)
4. Calculate expected elapsed time manually
5. Compare with displayed elapsed time

**Expected Result:** ✅ Timer uses 7:45 AM as reference point, showing accurate elapsed time

---

## Test 3: localStorage Persistence

**Scenario:** Data persists across page reloads

**Steps:**
1. After completing Test 1 (badge visible at 7:45 AM)
2. Refresh page (F5)
3. Verify badge still shows "Started: 7:45 AM"
4. Verify "Start Day" button does NOT appear
5. Open DevTools → Application → Local Storage
6. Verify keys exist:
   - `manualShiftStart`: ISO timestamp
   - `shiftStartLocked`: "false"
   - `shiftStartDate`: Today's date string

**Expected Result:** ✅ State persists across page reloads

---

## Test 4: Edit Before First Bag

**Scenario:** Editing start time before production begins

**Steps:**
1. With badge showing (from Test 3)
2. Ensure no bags have been scanned yet (`bagsToday = 0`)
3. Click the badge
4. Verify modal opens with time pre-filled to current start time
5. Change time to 8:00 AM
6. Verify impact preview recalculates
7. Click "Confirm"
8. Verify badge updates to "Started: 8:00 AM"

**Expected Result:** ✅ Can edit start time before first bag is scanned

---

## Test 5: Lock After First Bag

**Scenario:** Start time locks after first bag completion

**Steps:**
1. After setting start time (from Test 4)
2. Simulate first bag completion:
   - Option A: Actually scan a bag if testing in production
   - Option B: Use DevTools: `ScoreboardState.timerData = {bagsToday: 1}; ScoreboardShiftStart.checkLockStatus();`
3. Verify badge icon changes from pencil to lock
4. Verify badge styling changes to gray
5. Click the badge
6. Verify tooltip appears: "Cannot edit after first bag"
7. Verify modal does NOT open

**Expected Result:** ✅ Start time locks and cannot be edited after first bag

---

## Test 6: Target Adjustment Display

**Scenario:** Daily goals are adjusted and displayed correctly

**Steps:**
1. Set start time to 7:45 AM
2. Note baseline daily goal (e.g., 200 lbs)
3. Calculate expected adjusted goal:
   - 7:45 AM → 4:30 PM = 8.75 hours
   - Minus breaks (1 hour) = 7.75 hours
   - Scale factor: 7.75 / 8.5 = 0.9118
   - Adjusted goal: 200 * 0.9118 = 182 lbs
4. Verify scoreboard displays adjusted goal (182 lbs)
5. Verify all target metrics are proportionally adjusted

**Expected Result:** ✅ Daily goals display adjusted values based on available hours

---

## Test 7: Midnight Reset

**Scenario:** State resets at midnight for new day

**Steps:**
1. Set start time on Day 1
2. Change system date to Day 2 (or test next day in production)
3. Refresh page
4. Verify "Start Day" button appears again
5. Verify badge is hidden
6. Verify localStorage keys are cleared
7. Set new start time for Day 2
8. Verify independent from Day 1

**Expected Result:** ✅ State resets daily, allowing new start time each day

---

## Test 8: API Sync (Multi-Device)

**Scenario:** Start time syncs across multiple devices

**Prerequisites:** Access to Google Sheets backend and Apps Script deployment

**Steps:**
1. On Device A (or Browser A):
   - Set start time to 7:45 AM
   - Verify API call in Network tab: `?action=setShiftStart&time=...`
   - Check console for: "Shift start saved to API"
2. Check Google Sheet "Shift Adjustments":
   - Verify new row added with today's date
   - Columns: Date, Shift Start, Set At, Available Hours, Scale Factor
3. On Device B (or Browser B):
   - Open scoreboard.html
   - Verify API call in Network tab: `?action=getShiftStart&date=...`
   - Verify badge appears with "Started: 7:45 AM"
   - Verify no "Start Day" button

**Expected Result:** ✅ Shift start time syncs across devices via API

---

## Test 9: API Error Handling

**Scenario:** Graceful degradation when API unavailable

**Steps:**
1. Disconnect from network or block API URL
2. Set start time in modal
3. Click "Confirm"
4. Check console for error: "Failed to save shift start: [error]"
5. Verify localStorage still saves the data
6. Verify badge still appears (local-first approach)
7. Refresh page
8. Verify badge persists from localStorage

**Expected Result:** ✅ Feature works offline using localStorage, syncs when API available

---

## Test 10: Edge Cases

### 10a: Future Time Validation
1. Open modal
2. Set time to future (e.g., 2 hours from now)
3. Click "Confirm"
4. Verify alert: "Cannot set future start time"
5. Modal stays open

### 10b: Too Early Time Validation
1. Open modal
2. Set time to 4:30 AM
3. Click "Confirm"
4. Verify alert: "Start time too early (before 5:00 AM)"
5. Modal stays open

### 10c: Late Start Time
1. Open modal
2. Set time to 2:00 PM (afternoon start)
3. Verify impact preview shows significant reduction
4. Example: 2:00 PM → 4:30 PM = 2.5 hours → 2.0 hours productive → Scale 0.235 → Goal 47 lbs
5. Click "Confirm"
6. Verify all targets update proportionally

### 10d: Cancel Modal
1. Open modal
2. Change time
3. Click "Cancel"
4. Verify modal closes
5. Verify no state changes

**Expected Result:** ✅ All edge cases handled correctly

---

## Test 11: Responsive Design

**Scenario:** UI adapts to different screen sizes

**Steps:**
1. Set start time on desktop (>1400px)
2. Verify button/badge at `right: 180px`
3. Resize to tablet (900px)
4. Verify button/badge moves to `top: 70px; right: 20px`
5. Resize to mobile (640px)
6. Verify modal is still usable
7. Verify time input works on mobile

**Expected Result:** ✅ UI remains functional across all screen sizes

---

## Test 12: Fullscreen Timer Mode

**Scenario:** Elements position correctly in fullscreen

**Steps:**
1. Set start time
2. Click fullscreen timer button
3. Verify badge repositions to `right: 20px; z-index: 101`
4. Verify badge is visible and clickable
5. Exit fullscreen
6. Verify badge returns to normal position

**Expected Result:** ✅ Badge adapts to fullscreen mode

---

## Known Issues / Limitations

Document any issues found during testing:

- [ ] Issue 1: [Description]
- [ ] Issue 2: [Description]
- [ ] Issue 3: [Description]

---

## Post-Testing Actions

After all tests pass:

- [ ] Document test results
- [ ] Create GitHub issues for any bugs found
- [ ] Get production team feedback
- [ ] Monitor first day of production usage
- [ ] Iterate based on real-world feedback

---

## Sign-Off

**Developer:** Claude AI Assistant
**Date:** 2026-01-09
**Status:** Implementation Complete - Ready for Testing

**Tester:** _________________
**Test Date:** _________________
**Test Result:** ☐ Pass ☐ Fail ☐ Pass with Issues

**Notes:**
_______________________________________________________________________
_______________________________________________________________________
_______________________________________________________________________
