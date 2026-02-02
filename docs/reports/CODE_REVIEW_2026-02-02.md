# Code Review Report — 2026-02-02

**Reviewer:** Atlas (automated deep review)  
**Scope:** src/js/modules/, src/js/scoreboard/, workers/src/, src/css/

---

## Summary

Overall code quality is **solid** for a production ops hub. The modular architecture is well-organized, error handling is thorough in most places, and D1 queries use parameterized bindings consistently. The issues below are ranked by severity.

---

## CRITICAL — Fix Soon

### 1. db.js — SQL Injection via Table/Column Name Interpolation
**File:** `workers/src/lib/db.js` lines 63-96  
**Issue:** `insert()`, `update()`, and `deleteRows()` interpolate `table` and column names directly into SQL strings via template literals. While callers always pass static strings today, this is a ticking time bomb if any future code passes user input.
```js
const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;
```
**Risk:** If a caller ever passes user-controlled data as `table` or `data` keys, it's instant SQL injection.  
**Recommendation:** Add a whitelist of valid table names and validate column names against `/^[a-z_]+$/i`. No code change needed today (all callers use static strings), but add the guard now.

### 2. Scoreboard render.js — No null-checks on DOM elements
**File:** `src/js/scoreboard/render.js`  
**Issue:** `renderScoreboard()` calls `document.getElementById(...)` many times and immediately accesses `.textContent`, `.style`, `.className` etc. without null checks. If any element is missing (embed mode, mobile layout, future HTML change), this throws and halts the entire render.
```js
document.getElementById('statusIcon').textContent = statusIcon;  // crashes if missing
```
**Recommendation:** Use a safe getter pattern like the dashboard's `safeGetEl()`. Document in review — don't change working code.

### 3. orders-d1.js — `validatePassword` returns success:false in body instead of throwing
**File:** `workers/src/handlers/orders-d1.js` → `validatePassword()`  
**Issue:** On wrong password, returns `successResponse({ success: false, error: 'Invalid password' })` — an HTTP 200 with error in the body. This means all downstream password checks must inspect the body, and proxy/CDN caching could serve the "success" response.
**Recommendation:** Should `throw createError('UNAUTHORIZED', 'Invalid password')` to return HTTP 401.

---

## HIGH — Should Fix

### 4. Scoreboard API logBag has wrong function signature
**File:** `src/js/scoreboard/api.js` → `logBag()`  
**Issue:** The API exports `logBag(onSuccess, onError)` but `timer.js` calls `API.logBag({}, successCb, errorCb)` — passing 3 args where the first is a data object. The function ignores the first arg (`onSuccess` receives the data object) and passes the success callback as the second arg to fetch.
```js
// api.js signature:
logBag: function(onSuccess, onError) { ... }

// timer.js call:
API.logBag({}, function(result) { ... }, function(error) { ... });
```
This works by accident because the `{}` is passed as `onSuccess` and the real callback is `onError`, but the code path through fetch only calls `onSuccess(response)` on success. Needs verification — may silently discard the success callback.
**Recommendation:** Fix `logBag` to accept `(data, onSuccess, onError)` to match how it's called.

### 5. Timer module uses mixed `let`/`var` and IIFE pattern
**File:** `src/js/scoreboard/timer.js` lines 274, 430  
**Issue:** The `sanitizePauseReason()` function uses `let` inside an IIFE that otherwise uses `var` throughout. This is inconsistent and could cause issues in older browser contexts.
**Recommendation:** Standardize to `var` within the IIFE for consistency (scoreboard targets older devices).

### 6. production-d1.js — Hardcoded labor constants should use config system
**File:** `workers/src/handlers/production-d1.js`  
**Issue:** `BASE_WAGE_RATE`, `EMPLOYER_TAX_RATE`, `TOTAL_LABOR_COST_PER_HOUR` are hardcoded at module scope. The code already has `getConfig()` and `system_config` table support, and uses it for `labor.base_wage_rate` inside `getScoreboardData()`, but the module-level constants are still used in `getExtendedDailyData()` and `getStrainSummary()`.
**Recommendation:** Pass loaded config values into those functions rather than relying on module-level constants.

### 7. CORS wildcard in production
**File:** `workers/src/lib/cors.js`  
**Issue:** `Access-Control-Allow-Origin: *` allows any origin. Since this API handles inventory webhooks and has password auth, tightening to known origins (`rogueff.github.io`, `rogueorigin.com`) would be more secure.
**Recommendation:** Accept env var `ALLOWED_ORIGINS` and check request origin. Fall back to `*` for dev.

---

## MEDIUM — Improvement Opportunities

### 8. Dashboard index.js is a massive re-export barrel (550+ lines)
**File:** `src/js/modules/index.js`  
**Issue:** Imports and re-exports everything from every module. This prevents tree-shaking if a bundler is ever added, and makes the file hard to navigate.
**Recommendation:** Consider removing the barrel re-exports — HTML only needs `window.*` globals. Low priority since no bundler is in use.

### 9. Dashboard api.js — console.log calls remain in retry logic
**File:** `src/js/modules/api.js` lines 147, 151, 155  
**Issue:** Three `console.log()` calls in the auto-retry path weren't caught in the console.debug cleanup:
```js
console.log(`Rate limited - will retry in ${delayText}...`);
console.log(`Auto-retry in ${delayText}...`);
console.log('Auto-retry after error...');
```
**Recommendation:** Downgrade to `console.debug()`.

### 10. Duplicate data comparison via JSON.stringify
**Files:** `src/js/modules/api.js` lines 185-186, 266-270, 312-316  
**Issue:** Comparing data via `JSON.stringify(result) !== JSON.stringify(oldData)` is O(n) on every poll cycle. For the data sizes involved (~5-20KB) this is fine, but it creates garbage collection pressure on mobile.
**Recommendation:** Consider a lightweight hash or version number from the API (the backend already has version tracking).

### 11. Scoreboard render.js uses innerHTML with user-controlled data
**File:** `src/js/scoreboard/render.js` → `renderCurrentItems()`  
**Issue:** Builds HTML strings with order data (strain names, customer names) interpolated directly into `innerHTML`:
```js
breakdownHTML += '<span ...>' + item.strain + '</span>';
```
While this data comes from the backend D1 database (not direct user input), a stored XSS in customer/strain data would propagate here.
**Recommendation:** Use `textContent` for data values or sanitize. Low risk since data is admin-entered.

### 12. Timer uses `getShiftEndTime()` with hardcoded 4:30 PM
**File:** `src/js/scoreboard/timer.js` → `getAvailableProductiveHours()`  
```js
shiftEnd.setHours(16, 30, 0, 0);  // 4:30 PM fixed
```
**Issue:** This ignores the Config workday.endHour/endMin values. `getShiftEndTime()` correctly uses Config, but `getAvailableProductiveHours()` hardcodes it.
**Recommendation:** Use `getShiftEndTime(new Date())` instead.

### 13. production-d1.js `chat()` doesn't sanitize user message
**File:** `workers/src/handlers/production-d1.js` → `chat()`  
**Issue:** User message is passed directly to Anthropic API. While Claude handles this safely, logging `userMessage` without sanitization could cause log injection.
**Recommendation:** Truncate and sanitize `userMessage` (length cap at minimum).

### 14. panels.js `sendAIMessage()` leaks typing indicator on error
**File:** `src/js/modules/panels.js`  
**Issue:** If `handleSuccess` is called with a backend error (`success: false`), it calls `handleError()` which removes `typingDiv`, but `handleSuccess` already removed it on line 1 of the function. Double removal is harmless but if the flow changes, the indicator could get stuck.
**Recommendation:** Move `typingDiv.remove()` to a `finally` block or guard with `typingDiv.parentNode`.

---

## LOW — Cleanup / Style

### 15. Inconsistent step numbering in index.js init()
Steps 8 appears twice (renderKPICards and renderKPIToggles). Cosmetic only.

### 16. Dead import in api.js
`_isSkeletonsShowing` and `_setSkeletonsShowing` are imported from state.js with underscore aliases but never used directly (the module uses callback wrappers instead).

### 17. Empty catch blocks in multiple handlers
- `orders-d1.js` `count5kgBagsForStrain()` — catches all errors silently, returns 0
- `production-d1.js` migration functions — some catches swallow errors

### 18. `CSS_CONSOLIDATION.md` exists in src/css/ but isn't referenced
Stale planning doc.

---

## CSS Audit Summary

### Hardcoded Colors vs Variables
- `shared-base.css`: Excellent — defines 40+ CSS variables for colors, spacing, shadows
- `dashboard.css`: ~20 hardcoded hex colors in sidebar/nav area (lines 646-669) that should use `--text-muted`, `--text-secondary`, `--bg-dark`
- `scoreboard.css`: ~15 hardcoded colors in debug panel and timer value styling — acceptable since these are intentional fixed colors for status states

### Responsive Breakpoints
- `dashboard.css`: 25 media queries, consistent at 1400/1200/900/768/600/480/400px
- `scoreboard.css`: 22 media queries, consistent at 1400/1200/1024/768/640/480/400/360px
- `orders.css`: Only 2 media queries (768px) — needs more responsive work
- `hourly-entry.css`: No media queries — may need responsive treatment

### Duplicate Rules
No exact duplicate selectors found. Some near-duplicates in scoreboard.css for different breakpoints (expected).

### Missing
- `orders.css` has no `prefers-reduced-motion` support (dashboard and scoreboard do)
- `hourly-entry.css` at 3171 lines is suspiciously large for a data entry form — likely contains unused styles from a template

---

## Recommendations Priority

| Priority | Item | Effort |
|----------|------|--------|
| 🔴 Critical | #1 db.js table name validation | 30 min |
| 🔴 Critical | #3 orders password response code | 15 min |
| 🟡 High | #4 logBag signature mismatch | 15 min |
| 🟡 High | #6 Use config for labor constants | 30 min |
| 🟡 High | #7 CORS tightening | 20 min |
| 🟢 Medium | #9 Console.log cleanup | 5 min |
| 🟢 Medium | #12 Timer hardcoded shift end | 5 min |
| 🟢 Medium | #13 Chat message sanitization | 10 min |

---

*Generated by Atlas automated code review, 2026-02-02*
