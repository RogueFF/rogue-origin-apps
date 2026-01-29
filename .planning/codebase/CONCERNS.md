# Codebase Concerns

**Analysis Date:** 2026-01-29

## Tech Debt

**Large Monolithic HTML Files:**
- Issue: Scoreboard.html is 414KB (bloated), kanban.html has inline CSS/JS, barcode.html mixing concerns
- Files: `src/pages/scoreboard.html` (414KB), `src/pages/kanban.html` (2500+ lines), `src/pages/barcode.html`
- Impact: Slow page load, large network payloads, hard to maintain, browser rendering delays
- Fix approach: Phase 4.1/4.2 - Extract styles to dedicated CSS files, move JavaScript to modules, use lazy loading for heavy libraries. Target: scoreboard under 100KB

**Hardcoded Configuration Values:**
- Issue: Baseline daily goal hardcoded as 200, time slot multipliers hardcoded in code, labor rates hardcoded
- Files: `apps-script/production-tracking/Code.gs` (line 502), `workers/src/handlers/production-d1.js` (lines 52-70)
- Impact: Config changes require code edits and redeployment, no runtime flexibility
- Fix approach: Move to environment variables or D1 config table; create admin UI to update without redeploying

**Missing Input Validation on Frontend:**
- Issue: HTML inputs accept user data without validation before sending to API
- Files: `src/pages/barcode.html`, `src/pages/kanban.html`, `src/pages/orders.html`
- Impact: Malformed data sent to API, potential injection attacks if not sanitized backend
- Fix approach: Add client-side validation for all form inputs; ensure backend also validates (defense in depth)

**localStorage Used Without Quota Checks:**
- Issue: Multiple files write to localStorage without handling QuotaExceededError consistently
- Files: `src/js/modules/install-prompt.js`, `src/pages/kanban.html`, `src/pages/orders.html`, `src/js/shared/api-cache.js`
- Impact: App can crash silently if user has limited storage space, graceful degradation not guaranteed
- Fix approach: Implement centralized localStorage wrapper with quota management (api-cache.js has partial implementation); test on low-storage devices

**Race Condition Mitigations Need Testing:**
- Issue: Multiple race condition fixes were applied (requestCounter in api.js, AbortController in fetch), but edge cases may still exist
- Files: `src/js/modules/api.js` (lines 32-33, 288-310, 335-338), `src/js/shared/api-cache.js` (lines 22, 184-188)
- Impact: Stale data might overwrite fresh data if requests arrive out of order or in rapid succession
- Fix approach: Add integration tests for rapid date range changes; test with network throttling

---

## Known Bugs

**Kanban Tutorial State Management (BUG-02, BUG-07):**
- Symptoms: Tutorial may get stuck waiting for save action if user cancels modal; doesn't resume properly
- Files: `src/pages/kanban.html` (lines 683-691, 1706, 1972-2007, 2119)
- Trigger: Create card in tutorial → open modal → close/cancel without saving
- Workaround: Refresh page and restart tutorial
- Status: Marked as fixed with `tutorialWaitingForSave` flag, but integration tests needed

**Kanban Empty State Tutorial (BUG-01):**
- Symptoms: Tutorial tries to proceed even if board has no cards, causing script errors
- Files: `src/pages/kanban.html` (lines 1752, 1759, 1979, skipIfEmpty flag)
- Trigger: Tutorial starts when board is empty
- Workaround: Add cards manually before starting tutorial
- Status: Partially fixed with skipIfEmpty checks; full coverage verification needed

**Bag Count Blacklisting (Production Tracking):**
- Symptoms: Duplicate or test bag scans counted in production (fixed in recent commit)
- Files: `workers/src/handlers/production-d1.js` (lines 24-49)
- Trigger: Test scans during specific time windows (blacklist mechanism in place)
- Workaround: Manually edit production data or blacklist timestamps
- Status: Blacklist mechanism implemented; maintainability concern as it requires manual entries

---

## Security Considerations

**innerHTML Assignment with Unsanitized Data:**
- Risk: Cross-site scripting (XSS) if user-controlled data reaches innerHTML assignments
- Files: `src/pages/barcode.html` (lines 411, 431, 442, 443, 522, 538), `src/pages/sop-manager.html` (multiple locations), `src/pages/kanban.html`
- Current mitigation: Barcode.html has escapeHtml() function (line 544), but not consistently used; SOP manager has some inline sanitization
- Recommendations:
  1. Create shared sanitization utility and use it everywhere
  2. Prefer textContent over innerHTML where possible
  3. Use template literals with defensive coding
  4. Add Content Security Policy (CSP) header from API

**Sensitive Data in localStorage:**
- Risk: Authentication tokens and sensitive settings stored in localStorage (accessible to XSS)
- Files: `src/pages/orders.html` (AUTH_STORAGE_KEY stores session), `src/js/modules/install-prompt.js`, `src/pages/sop-manager.html`
- Current mitigation: No specific encryption or expiration on stored tokens
- Recommendations:
  1. Store auth tokens in memory only or httpOnly cookies (backend must support)
  2. Add token expiration check on app load
  3. Clear sensitive data when user logs out
  4. Use sessionStorage instead of localStorage for temporary auth

**Blacklist Configuration (Manual Updates):**
- Risk: Blacklisted bags array in production-d1.js requires code change; no access control for who can update
- Files: `workers/src/handlers/production-d1.js` (lines 25-28)
- Current mitigation: Code is in git, changeable only by developers
- Recommendations:
  1. Move blacklist to D1 table with admin UI
  2. Add audit logging for who modified blacklist and when
  3. Implement approval workflow for blacklist changes

**API Key Exposure (Apps Script):**
- Risk: ANTHROPIC_API_KEY stored in Script Properties; if spreadsheet is compromised, key could leak
- Files: `apps-script/production-tracking/Code.gs` (accessed via Script Properties)
- Current mitigation: Google Apps Script has built-in encryption at rest
- Recommendations:
  1. Consider migrating to Anthropic API via backend service (Cloudflare Worker) instead of Apps Script
  2. Implement API key rotation policy
  3. Add monitoring for unusual API usage patterns

---

## Performance Bottlenecks

**Lazy Loading Libraries But Late:**
- Problem: Chart.js, Muuri.js, Phosphor Icons loaded lazily, but IntersectionObserver fires after user might interact
- Files: `src/js/modules/lazy-loader.js`, `src/js/modules/grid.js`
- Cause: Observer set up on page load but fires when elements scroll into view (user already waiting)
- Improvement path:
  1. Prefetch heavy libraries during requestIdleCallback (already partially done in api-cache.js line 319)
  2. Use `<link rel="prefetch">` for CDN resources
  3. Move Muuri initialization to page load (it's UI-blocking), prefetch Chart.js

**Dashboard Data Refresh (5-minute TTL):**
- Problem: Cache set to 5 minutes; production floor changes frequently (bags complete every 5-10 mins)
- Files: `src/js/shared/api-cache.js` (line 18, DEFAULT_TTL = 5 minutes)
- Cause: TTL is conservative to avoid stale data, but floor crew sees delayed updates
- Improvement path:
  1. Implement real-time updates via WebSocket or polling interval (current: manual refresh only)
  2. Use 2-minute TTL for production data, 5 minutes for other data
  3. Add background refresh via setInterval (currently requires manual refresh)

**Synchronous Rendering in Loops:**
- Problem: Grid/list re-rendering in kanban.html loops through all cards and rebuilds innerHTML
- Files: `src/pages/kanban.html` (lines 727-750, render() function)
- Cause: No virtualization or DOM diffing; every render reflows entire page
- Improvement path:
  1. Use requestAnimationFrame for batched DOM updates
  2. Implement virtual scrolling for large datasets
  3. Consider lightweight framework (Preact) if data sets grow

**API Cache Double Fetch Pattern:**
- Problem: Cache returns data immediately, then fetches fresh in background; two callbacks fire
- Files: `src/js/shared/api-cache.js` (lines 172-305, fetchWithCache function)
- Cause: Stale-while-revalidate pattern; intentional but re-rendering twice
- Improvement path:
  1. Skip background fetch if data is fresh (< 5 min old)
  2. Only fetch on background if stale (5-24 min old)
  3. Implement smart TTL (shorter for production data, longer for config)

---

## Fragile Areas

**Kanban Drag-Drop with Tutorial:**
- Files: `src/pages/kanban.html` (entire file)
- Why fragile: Tutorial state machine is tightly coupled to DOM changes, modal interactions, and async saves; 9 separate BUG-* fixes indicate fragility
- Safe modification:
  1. Add comprehensive unit tests for each tutorial state transition
  2. Extract tutorial state machine to separate module
  3. Mock API calls in tests
- Test coverage: Tutorial sections have comments about fixes but no automated tests

**Scoreboard Timer State (419 lines):**
- Files: `src/js/scoreboard/timer.js`
- Why fragile: Complex timer logic with multiple intervals, pause log syncing, and UI updates; single typo breaks production tracking
- Safe modification:
  1. Add timer state visualization (debug mode)
  2. Write tests for pause/resume cycle
  3. Add defensive checks for missing DOM elements
- Test coverage: No test file exists for timer.js

**API Retry Logic with Auto-Hide:**
- Files: `src/js/modules/status.js`, `src/js/modules/api.js` (lines 156-211)
- Why fragile: Error handler manages multiple timeouts for auto-retry and auto-hide; timing issues can cause stale UI state
- Safe modification:
  1. Use state machine instead of boolean flags
  2. Centralize all timeout management in status.js
  3. Add retry backoff (5s → 10s → 30s) instead of fixed delays
- Test coverage: No integration tests for error scenarios

**HTML File CSS Variable Usage:**
- Files: All `src/pages/*.html` files reference CSS variables from `shared-base.css`
- Why fragile: CSS variable names are not validated; typo in HTML references unknown variable, silently uses fallback
- Safe modification:
  1. Add CSS variable validation script
  2. Extract inline styles to CSS files with variable references
  3. Add linting rule to prevent inline `style=` attributes
- Test coverage: No CSS variable validation tests

---

## Scaling Limits

**localStorage Capacity (5-10MB Limit):**
- Current capacity: Unknown how much is used; no quota monitoring
- Limit: Browser typically allows 5-10MB per domain; multiple apps share same space
- Impact at scale: If API cache grows, installation notes grow, theme preferences accumulate → quota exceeded
- Scaling path:
  1. Implement IndexedDB for large datasets (api-cache.js has comment about fallback on line 10, not implemented)
  2. Add cleanup task to remove entries older than 30 days
  3. Monitor quota usage in dev console

**Single Google Sheet Row Limit:**
- Current capacity: Google Sheets allows 10 million cells per sheet; production data appended hourly
- Limit: Hourly data for 1 year = 8,760 rows; manageable now, but no archiving strategy
- Impact at scale: Sheet will eventually slow down with 100k+ rows; API calls become slower
- Scaling path:
  1. Archive old sheets monthly (rename to "Production 2025-12", "Production 2026-01", etc.)
  2. Migrate to D1 entirely (currently manual entry still uses Sheets)
  3. Implement data cleanup/summarization at month boundaries

**D1 Database Query Performance (No Indexing):**
- Current capacity: D1 supports SQLite; no database indexes defined
- Limit: Unknown; likely fast for current workload (<1000 records per table)
- Impact at scale: If kanban orders or barcode inventory grows to 10k+ records, queries become slow
- Scaling path:
  1. Add indexes to frequently queried columns (item_name, supplier, status)
  2. Monitor slow queries in Cloudflare Workers logs
  3. Migrate to proper PostgreSQL if data grows beyond SQLite capacity

**Event Listener Accumulation:**
- Current capacity: Event cleanup module exists but not integrated everywhere
- Limit: If navigation happens 100+ times without cleanup, memory leak accumulates
- Impact at scale: On long-lived sessions (floor TV running 24/7), memory grows unbounded
- Scaling path:
  1. Audit all event listeners and ensure cleanup on page unload
  2. Use event delegation where possible (single listener on parent instead of 100 on children)
  3. Implement memory monitoring in production

---

## Fragile Data Pipelines

**Manual Hourly Production Entry (No Validation):**
- Problem: Production data manually entered into Google Sheet hourly; no real-time sync, no validation
- Files: Google Sheet `1dARXrKU2u4KJY08ylA3GUKrT0zwmxCmtVh7IJxnn7is`, `apps-script/production-tracking/Code.gs`
- Risk: Data entry errors (typos, wrong cell), skipped entries, accidental deletions
- Current workaround: Blacklist mechanism for test scans (bagDate checking in production-d1.js)
- Fix approach: Implement real-time barcode scanning → API → D1 instead of manual entry

**Duplicate Bag Detection (Time-Window Blacklist):**
- Problem: Recent fix (commit 1f0ad36) extracts timestamps from flow_run_id, but blacklist is manual
- Files: `workers/src/handlers/production-d1.js` (lines 35-49, BLACKLISTED_BAGS array)
- Risk: Time window blacklist is fragile; if times shift or new test patterns emerge, must edit code
- Current approach: Requires developer intervention to update BLACKLISTED_BAGS
- Fix approach: Implement smart duplicate detection algorithm (if within 5 min AND same cultivar/weight → duplicate)

---

## Test Coverage Gaps

**No Tests for Kanban Tutorial State Machine:**
- What's not tested: Tutorial flow (start → step progression → save → resume), modal interactions, undo/redo in tutorial
- Files: `src/pages/kanban.html` (1-2500 lines, all logic in single file)
- Risk: Regressions on tutorial flow go unnoticed; users get stuck (happened before, multiple BUG-* fixes)
- Priority: High (blocks new users from using kanban)
- Recommendation: Write 10-15 test cases covering each tutorial state and transition

**No Tests for Timer Pause/Resume Cycle:**
- What's not tested: Timer state transitions (running → paused → running), pause log syncing, edge cases (pause at end of shift, pause overnight)
- Files: `src/js/scoreboard/timer.js` (819 lines), `workers/src/handlers/production-d1.js`
- Risk: Timer bugs cause incorrect production counts; critical to operations
- Priority: High (directly impacts business metrics)
- Recommendation: Write tests covering all timer states and transitions; mock Google Sheets/D1

**No Tests for Error Recovery (API Failures):**
- What's not tested: Auto-retry logic, fallback to cached data, 429 rate limit handling, connection recovery
- Files: `src/js/modules/api.js` (lines 156-211), `src/js/shared/api-cache.js` (lines 207-237)
- Risk: If API fails, users see confusing error messages; auto-retry behavior uncertain
- Priority: High (affects user experience during outages)
- Recommendation: Mock fetch with different error codes (429, 500, 503); verify UI state and retry behavior

**No Tests for CSS Variable Responsiveness:**
- What's not tested: Light/dark theme switching, mobile breakpoint changes, CSS variable cascading
- Files: `src/css/shared-base.css` (master variables), all pages reference these
- Risk: Theme change might partially apply; mobile layout might break on certain screen sizes
- Priority: Medium (affects boss's phone usage)
- Recommendation: Add visual regression tests with light/dark theme + mobile/desktop viewports

**No Tests for localStorage Quota Exceeded:**
- What's not tested: Behavior when QuotaExceededError is thrown; graceful degradation
- Files: `src/js/shared/api-cache.js` (lines 60-82), multiple pages with localStorage writes
- Risk: App might crash silently if storage quota exceeded
- Priority: Medium (edge case but critical when it happens)
- Recommendation: Mock localStorage.setItem to throw QuotaExceededError; verify app continues working

---

## Dependencies at Risk

**Chart.js via CDN (jsDelivr):**
- Risk: CDN could be blocked, version could be yanked, library could have security vulnerabilities
- Current: Lazy loaded from `https://cdn.jsdelivr.net/npm/chart.js@4.4.1`
- Impact: Scoreboard charts won't render if CDN is down
- Migration path:
  1. Bundle Chart.js with app (adds 50KB to initial bundle)
  2. Pin to specific version in package-lock.json equivalent
  3. Monitor security advisories for Chart.js
  4. Implement fallback (static image) if load fails

**Google Apps Script Execution (6-minute limit):**
- Risk: Long-running operations timeout; no simple way to resume
- Impact: If production report generation takes >6 min, it fails silently
- Current status: Being gradually replaced by Cloudflare Workers (D1 migration in progress)
- Migration path: Complete D1 migration for all production operations; deprecate Apps Script entirely

---

## Missing Critical Features / Known Gaps

**Real-Time Updates (Not Streaming):**
- Problem: Dashboard updates require manual refresh or 5-min cache expiration; no WebSocket streaming
- Blocks: Floor crew can't see live production updates without F5
- Workaround: Refresh button exists but requires manual action
- Fix approach: Implement polling (setInterval every 30-60 sec) or WebSocket via Cloudflare; requires backend changes

**Accessibility - WCAG AA Compliance (Phase 5.1):**
- Problem: Focus indicators missing on some elements, color contrast may not meet 4.5:1 ratio in dark mode, keyboard navigation incomplete
- Blocks: Compliant with regulations if used by government/organizations; affects usability for users with vision impairments
- Workaround: None; accessibility issues require code fixes
- Fix approach: Audit with aXe DevTools; add focus styles, increase contrast, ensure all interactive elements keyboard-accessible

**Admin Panel for Configuration:**
- Problem: Config values hardcoded (baseline goal, labor rates, time slots); requires code change to adjust
- Blocks: Non-technical users can't adjust business rules
- Workaround: Developer edits config and redeploys
- Fix approach: Create admin page in ops-hub with forms to update D1 config table; requires new API endpoints

---

## Documentation Gaps

**No API Response Format Documentation (Partial):**
- Status: `docs/technical/APP_CATALOG.md` exists but may be incomplete for new D1 handlers
- Risk: Developers don't know expected response format for new endpoints
- Fix: Keep APP_CATALOG.md updated as handlers change

**No Runbook for Production Incidents:**
- Status: None exists; only CLAUDE.md and ROADMAP.md
- Risk: If API goes down or data is corrupted, no clear recovery steps
- Fix: Create `docs/RUNBOOK.md` with troubleshooting steps for common failures

**No Architecture Diagram:**
- Status: Text descriptions exist but no visual diagram
- Risk: New developers struggle to understand system topology
- Fix: Create architecture diagram (frontend → Cloudflare Workers → D1 + Google Sheets)

---

*Concerns audit: 2026-01-29*
