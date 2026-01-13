# Session: Scoreboard Bug Fixes
**Date**: January 13, 2026
**Focus**: Wholesale orders integration, bag counting, timer freeze, and API performance

---

## Issues Resolved

### 1. Bag Counting Accuracy ✅
**Problem**: Order progress showing 0/120kg instead of actual 35kg
**Root Cause**: Webhook adds bags to TOP of sheet, but code read from BOTTOM
**Fix**: Changed to read rows 2-2001 (newest 2000 bags from top)
**File**: `apps-script/wholesale-orders/Code.gs:1535-1546`
**Result**: Progress shows correctly (35/120kg = 7 bags × 5kg)

### 2. Timer Freeze During Breaks ✅
**Problem**: Timer counting backwards/incrementing during lunch breaks
**Root Cause**: Debug mode was skipping ALL scheduled break subtractions
**Fix**: Always subtract scheduled breaks, even in debug mode
**File**: `src/js/scoreboard/timer.js:79-100`
**Testing**: Added `testBreakMode(true/false)` helper function
**Result**: Timer freezes correctly during breaks (verified with diagnostic test)

### 3. API Timeout on Cold Starts ✅
**Problem**: Network errors on first page load (Apps Script cold starts)
**Root Cause**: 8-second timeout insufficient for cold starts (10-15s)
**Fix**: Increased service worker timeout to 20 seconds
**File**: `sw.js:191-192` (version bumped to v3.5)
**Result**: Page loads smoothly without errors

---

## Performance Improvements

### Bag Counting Optimization
- **Before**: Reading entire sheet (thousands of rows) → 15+ second response
- **After**: Reading only 2000 most recent rows → ~4 second response
- **Coverage**: 1-2 weeks of production data (sufficient for active orders)
- **Impact**: Prevents API timeouts, maintains acceptable response times

---

## Testing Tools Created

### `test-timer-diagnostic.js`
Comprehensive diagnostic tool for timer behavior:
- Checks if ScoreboardState and testBreakMode are available
- Enables debug break mode and monitors timer values
- Verifies break start timestamp doesn't change (correct caching)
- Confirms timer freezes during break (no increment)
- Logs detailed timing information for debugging

### `testBreakMode()` Console Function
```javascript
// Enable break mode (freezes timer, turns yellow)
testBreakMode(true);

// Disable break mode (timer resumes)
testBreakMode(false);
```
**Location**: `src/js/scoreboard/state.js:368-380`

---

## Technical Details

### Bag Counting Logic
**Key Insight**: Shopify webhook adds new bags to TOP of sheet (prepends), not bottom (appends)

**Old Code** (incorrect):
```javascript
var startRow = Math.max(2, lastRow - 499); // Read from bottom
```

**New Code** (correct):
```javascript
var startRow = 2; // Read from top (newest data)
var numRows = Math.min(2000, lastRow - 1);
```

### Timer Freeze Logic
**Key Insight**: Debug mode should only freeze `endTime`, not skip historical break calculations

**Problem Code** (removed):
```javascript
if (!State || State.debugOnBreak !== true) {
  // Subtract completed breaks...
}
```

**Fixed Code**:
```javascript
// Always subtract scheduled breaks, even in debug mode
var breaks = (Config && Config.workday && Config.workday.breaks) || [];
for (var j = 0; j < breaks.length; j++) {
  // Calculate overlap and subtract...
}
```

---

## Documentation Updates

### Main CLAUDE.md
Added "Scoreboard & Order Queue Fixes (2026-01-13)" section with:
- Detailed problem descriptions
- Root cause analysis
- Code changes with file references
- Testing commands
- Performance metrics

### Module CLAUDE.md Files
- `apps-script/wholesale-orders/CLAUDE.md` - Bag counting fix details
- `src/js/scoreboard/CLAUDE.md` - Timer freeze fix details

---

## Deployment Status

### Backend (Apps Script)
✅ **wholesale-orders/Code.gs** - Bag counting fix deployed
- Reads from top of sheet (rows 2-2001)
- Optimized performance (~4s response time)

### Frontend (GitHub Pages)
✅ **timer.js** - Timer freeze fix deployed
✅ **sw.js** - Service worker timeout increased to 20s
- Automatic deployment via GitHub Pages
- Verified with curl checks

---

## Verification Results

### Bag Counting
```
Test: curl -L "https://script.google.com/.../exec?action=getScoreboardOrderQueue"
Result: {"completedKg": 35, "quantityKg": 120, "percentComplete": 29.17}
Status: ✅ Correct (7 bags × 5kg = 35kg)
```

### Timer Freeze
```
Test: node test-timer-diagnostic.js
Result: Timer frozen at 39:50 for 6+ seconds during break
Status: ✅ Correct (no increment during break)
```

### API Performance
```
Test: curl with -w time_total
Result: 3.9 seconds average response time
Status: ✅ Acceptable (< 20s timeout)
```

---

## Git Commits

1. `1eebabb` - Fix timer freeze during debug break mode
2. `80b372e` - Increase service worker timeout to 20s for Apps Script cold starts
3. `a68dbf4` - Update documentation with recent bug fixes
4. `9bf9d2a` - Update test screenshot

---

## Next Steps (If Needed)

### Monitoring
- Watch for any API timeouts during production use
- Verify timer freeze behavior during scheduled breaks (2:30 PM, 4:20 PM)
- Monitor bag counting accuracy as orders progress

### Potential Improvements
- Consider caching order queue data for 30-60 seconds to reduce API calls
- Add loading indicators for order queue section
- Implement retry logic for failed API calls

### Future Features
- Real-time bag completion notifications
- Historical order completion tracking
- Strain-specific production rate analysis

---

## Lessons Learned

1. **Always verify data direction** - Webhooks can prepend (top) or append (bottom)
2. **Cold starts matter** - Apps Script cold starts need generous timeouts (15-20s)
3. **Debug modes need careful scoping** - Don't skip core calculations, only modify inputs
4. **Test with diagnostics** - Detailed logging reveals subtle timing bugs
5. **Document assumptions** - "Newest data at bottom" was wrong, caused hours of debugging

---

**Session Duration**: ~3 hours
**Status**: ✅ All issues resolved and verified
**Impact**: Production floor scoreboard now reliable and accurate
