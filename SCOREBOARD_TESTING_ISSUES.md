# Scoreboard Declutter Testing - Issue Report

**Date:** 2026-02-04 22:54 PST  
**Tester:** Atlas  
**Status:** ⚠️ BLOCKING ISSUE FOUND

---

## Critical Issue: Old Buttons Still Visible

### Problem
The old buttons (Morning Report, Order Queue OFF, Hourly Chart OFF, Help) are rendering at the top of the page when they should be hidden and only accessible through the FAB menu.

### Location
Visible at the very top of the page in a horizontal row.

### Expected Behavior
- All old buttons should be hidden
- Only FAB button and EN/ES toggle should be visible
- Menu items accessible only through FAB menu click

### Current Behavior
- Buttons visible at top: "Morning Report | Order Queue OFF | Hourly Chart OFF | Help"
- This violates the declutter design (87.5% chrome reduction goal)

### Attempted Fixes (All Failed)
1. ✅ Added CSS rules in `scoreboard.css`:
   ```css
   #morningReportBtn,
   #historicalViewBtn,
   #orderQueueToggleBtn,
   .help-btn {
     display: none !important;
   }
   ```

2. ✅ Added inline styles on HTML elements:
   ```html
   <button id="morningReportBtn" style="display:none !important;">
   ```

3. ✅ Added critical inline style block in `<head>`:
   ```html
   <style>
     #morningReportBtn,
     #historicalViewBtn,
     #orderQueueToggleBtn,
     .help-btn {
       display: none !important;
     }
   </style>
   ```

4. ✅ Added FAB menu `display: none` by default with `display: block` on `.visible`

### Investigation Needed

**Hypothesis 1: Browser Extension/Bookmarks**
- The horizontal layout at absolute top suggests this might be browser chrome, not page content
- Need confirmation: Are these actually ON the page or browser UI?

**Hypothesis 2: Dynamic JS Creation**
- JavaScript might be creating duplicate elements after page load
- Console shows no errors, but FAB menu initializes successfully

**Hypothesis 3: CSS Specificity Issue**
- Some other CSS rule might be overriding with higher specificity
- Unlikely given `!important` + inline styles

**Hypothesis 4: Cached CSS**
- Browser might be caching old CSS despite version bumps
- Tested with `?v=5`, `?v=6`, `?v=7` params

### Next Steps

1. **URGENT:** Have Koa right-click one of the visible buttons and "Inspect Element"
   - This will reveal the actual HTML tag, class, and CSS rules applying
   - Will confirm if it's page content or browser UI

2. **If page content:** Check computed styles to see what's overriding
   - Use browser DevTools to inspect applied styles
   - Look for any JavaScript creating elements

3. **If browser UI:** Investigate if it's a bookmark bar or extension
   - Test in incognito mode
   - Disable extensions

### Working Features ✅

- FAB button visible bottom-right
- EN/ES toggle visible
- Compact header visible
- Start Day button showing in top-right
- All production data rendering correctly
- FAB menu structure exists (just hidden by default as intended)

### Files Modified

- `src/pages/scoreboard.html` - Added inline styles + critical CSS block
- `src/css/fab-menu.css` - Added `display: none` default state
- `src/css/scoreboard.css` - Hide rules already present

### Commit

```
fix: add multiple layers to hide old buttons (WIP - still investigating visibility issue)
```

---

## Recommendation

**BLOCK deployment until buttons are confirmed hidden.**

The visibility of these buttons defeats the entire purpose of the FAB menu redesign. Need to confirm root cause before proceeding with other checklist items.

Once the button visibility issue is resolved, can proceed with:
- FAB menu interaction testing
- Mobile/desktop/TV responsive checks
- Keyboard navigation
- Bilingual support
- Accessibility audit
