# Rogue Origin - Codebase Inventory

> **Last Updated**: January 2, 2026  
> **Version**: 2.0 (AI Agent Release)  
> **Purpose**: Complete file-by-file technical inventory with status tracking

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Frontend Files](#frontend-files)
3. [Backend Files (Apps Script)](#backend-files-apps-script)
4. [Production Code.gs - Complete Function Reference](#production-codegs---complete-function-reference)
5. [HTML Template Files](#html-template-files)
6. [Sheet Inventory](#sheet-inventory)
7. [External Dependencies](#external-dependencies)
8. [Removed/Deprecated Code](#removeddeprecated-code)
9. [Architecture Decisions](#architecture-decisions)
10. [Known Issues](#known-issues)
11. [Technical Debt](#technical-debt)
12. [Recommendations](#recommendations)

---

## Executive Summary

### Project Statistics

| Metric | Value |
|--------|-------|
| **Total Frontend Files** | 8 HTML files |
| **Total Backend Projects** | 4 Apps Script projects |
| **Total Lines of Code** | ~12,000+ |
| **Production Code.gs** | ~2,000 lines (with AI Agent + Dashboard) |
| **Functions (Production)** | 55+ active functions |
| **Sheet Tabs (Production)** | 8 tabs |
| **Documentation Files** | 5 (CLAUDE.md, APP_CATALOG.md, CODEBASE_INVENTORY.md, PROJECT_STRUCTURE.md, AI_DATA_OPPORTUNITIES.md) |

### Code Health Dashboard

| Category | Status | Notes |
|----------|--------|-------|
| Dead Code | ✅ Clean | Removed Jan 2026 |
| Documentation | ✅ Excellent | Comprehensive docs |
| Test Coverage | ⚠️ Manual only | Test functions exist |
| Error Handling | ✅ Good | Try/catch throughout |
| Consistency | ⚠️ Fair | Some legacy patterns |
| Security | ✅ Good | API key in Script Properties |

### Recent Major Changes (January 2026)

| Change | Impact | Lines Affected |
|--------|--------|----------------|
| Added AI Agent | New feature | +400 lines |
| Added 10lb bag support | Enhancement | +50 lines |
| Created AI_Chat_Log | New sheet tab | — |
| Created AI_Corrections | New sheet tab | — |
| Removed Order Tracking | Cleanup | -900 lines |
| Added documentation | Maintenance | +3,000 lines |
| **Kanban Tutorial** | New feature | +150 lines |
| **Orders System** | New feature | +1,500 lines |
| **Dashboard API fix** | Bug fix | +60 lines |
| **AI Chat hide on iframes** | UX fix | +15 lines |

---

## Frontend Files

### Repository: RogueFF/rogue-origin-apps

#### File Listing

| File | Size | Lines | Last Updated | Status |
|------|------|-------|--------------|--------|
| `index.html` | ~120 KB | ~2,500 | Jan 2026 | ✅ Active (Ops Hub) |
| `scoreboard.html` | ~468 KB | ~10,000+ | Dec 2025 | ✅ Active |
| `sop-manager.html` | ~50 KB | ~1,500 | Jan 2026 | ✅ Active |
| `kanban.html` | ~85 KB | ~2,100 | Jan 2026 | ✅ Active (with Tutorial) |
| `barcode.html` | ~30 KB | ~700 | 2024 | ✅ Active |
| `orders.html` | ~40 KB | ~900 | Jan 2026 | ✅ Active (Internal) |
| `order.html` | ~25 KB | ~600 | Jan 2026 | ✅ Active (Customer Portal) |

#### index.html (Ops Hub) - Detailed Analysis

**Total Size**: ~120 KB, ~2,500 lines

| Section | Line Range | Size | Purpose |
|---------|------------|------|---------|
| DOCTYPE/Head | 1-50 | ~2 KB | Meta, title, fonts |
| CSS Variables | 50-150 | ~4 KB | Brand colors, dark mode |
| Main Styles | 150-500 | ~15 KB | Layout, tiles, responsive |
| AI Chat Styles | 500-800 | ~12 KB | Chat widget styling |
| Body Structure | 800-1000 | ~8 KB | HTML structure |
| App Tiles | 1000-1200 | ~8 KB | Navigation tiles |
| AI Chat HTML | 1200-1400 | ~8 KB | Chat widget markup |
| Main JavaScript | 1400-1800 | ~15 KB | Dashboard logic |
| AI Chat JavaScript | 1800-2300 | ~20 KB | Chat functionality |

**Key JavaScript Functions in ops-hub.html**:

| Function | Purpose | Lines |
|----------|---------|-------|
| `loadDashboardData()` | Fetch scoreboard data | ~30 |
| `updateStats()` | Update dashboard UI | ~50 |
| `sendMessage()` | Send chat message | ~80 |
| `addMessage()` | Render chat message | ~40 |
| `handleFeedback()` | Process 👍/👎 | ~30 |
| `showTypingIndicator()` | Show dots | ~15 |
| `handleQuickAction()` | Quick buttons | ~20 |
| `toggleChat()` | Open/close chat | ~10 |

#### scoreboard.html - Detailed Analysis

**Total Size**: ~468 KB (large due to embedded Chart.js and data)

| Component | Purpose | Notes |
|-----------|---------|-------|
| Chart.js library | Hourly chart | Embedded |
| Production metrics | Today's numbers | Live data |
| Bag timer display | Bag counts, cycle | Live data |
| Crew display | Trimmer count | Live data |
| Auto-refresh | 30-second interval | JavaScript |

---

## Backend Files (Apps Script)

### Project 1: Production Tracking

**Location**: Bound to Production Sheet  
**Sheet ID**: `REDACTED-PRODUCTION-SHEET-ID`  
**Deployment ID**: `REDACTED-PRODUCTION-API-ID`

| File | Size | Lines | Purpose | Status |
|------|------|-------|---------|--------|
| `Code.gs` | ~78 KB | ~1,900 | Main backend | ✅ Active |
| `ProductionScoreboard.html` | ~60 KB | ~1,500 | Floor display | ✅ Active |
| `CrewChangeSidebar.html` | ~0 KB | Empty | Crew UI | ⚠️ Empty |
| `LeadTimeEstimatorSidebar.html` | ~14 KB | ~400 | Order estimation | ✅ Active |
| `ThroughputTimerSidebar.html` | ~8 KB | ~200 | Timer controls | ✅ Active |
| `ProductionDashboard.html` | ~63 KB | ~1,600 | Dashboard view | ✅ Active |

### Project 2: SOP Manager

**Location**: Standalone or bound  
**Sheet ID**: (Configured in Code.gs)

| File | Size | Lines | Purpose | Status |
|------|------|-------|---------|--------|
| `Code.gs` | ~15 KB | ~400 | SOP backend | ✅ Active |

### Project 3: Kanban

**Location**: Bound to Kanban Sheet  
**Sheet ID**: `19UW_tWY6c53lEydXqULAqC3Ffv1C20PDZMKnV6K-byQ`

| File | Size | Lines | Purpose | Status |
|------|------|-------|---------|--------|
| `Code.gs` | ~12 KB | ~350 | Kanban backend | ✅ Active |

### Project 4: Barcode Manager

**Location**: Bound to Barcode Sheet  
**Sheet ID**: `REDACTED-BARCODE-SHEET-ID`

| File | Size | Lines | Purpose | Status |
|------|------|-------|---------|--------|
| `Code.gs` | ~10 KB | ~300 | Barcode backend | ✅ Active |

---

## Production Code.gs - Complete Function Reference

### Web App Handlers

| Function | Line | Type | Purpose | Status |
|----------|------|------|---------|--------|
| `doGet(e)` | ~63 | Handler | Route GET requests | ✅ Active |
| `doPost(e)` | ~102 | Handler | Route POST requests | ✅ Active |
| `onOpen()` | ~134 | Trigger | Add menu items | ✅ Active |

**doGet Actions**:
```
?action=scoreboard → getScoreboardWithTimerData()
?action=timer → getBagTimerData()
?action=dashboard → buildDashboardData()
?action=test → { ok: true }
(default) → API info
```

**doPost Actions**:
```
?action=chat → handleChatRequest()
?action=logBag → logManualBagCompletion()
?action=logPause → logTimerPause()
?action=logResume → logTimerResume()
?action=setCrewCounts → setCrewCounts()
```

### Scoreboard Functions

| Function | Line | Parameters | Returns | Status |
|----------|------|------------|---------|--------|
| `getScoreboardData()` | ~151 | — | Production object | ✅ Active |
| `getScoreboardWithTimerData()` | ~609 | — | Combined object | ✅ Active |
| `buildDashboardData()` | ~1675 | — | Full dashboard | ✅ Active |
| `getDashboardDataLive()` | ~1809 | — | Alias for above | ✅ Active |

**getScoreboardData() Returns**:
```javascript
{
  todayLbs, strain, lastHourLbs, lastTimeSlot, hoursLogged,
  todayPercentage, todayTarget, projectedTotal,
  currentHourTrimmers, lastHourTrimmers,
  targetRate, strainTargetRate, usingStrainRate,
  vsYesterday, vs7Day
}
```

### Bag Timer Functions

| Function | Line | Parameters | Returns | Status |
|----------|------|------------|---------|--------|
| `getBagTimerData()` | ~325 | — | Timer object | ✅ Active |
| `logManualBagCompletion(size)` | ~619 | size: string | Confirmation | ✅ Active |
| `logTimerPause(reason, duration)` | ~654 | reason, duration | Pause ID | ✅ Active |
| `logTimerResume(pauseId, duration)` | ~694 | pauseId, duration | Confirmation | ✅ Active |
| `is5kgBag(size)` | ~729 | size: string | Boolean | ✅ Active |
| `is10lbTopsBag(size, sku)` | ~737 | size, sku | Boolean | ✅ Active |

**getBagTimerData() Returns**:
```javascript
{
  bags5kgToday, bags10lbToday, bagsToday,
  avgSecondsToday, avgSeconds7Day,
  lastBagTime, secondsSinceLastBag,
  isPaused, pauseReason
}
```

### Crew Management Functions

| Function | Line | Parameters | Returns | Status |
|----------|------|------------|---------|--------|
| `showCrewChangeSidebar()` | ~1496 | — | Opens sidebar | ✅ Active |
| `setCrewCounts(b1, b2, t1, t2)` | ~1555 | Counts | Confirmation | ✅ Active |
| `getCrewSnapshotForActiveRow()` | ~1600 | — | Crew object | ✅ Active |
| `getCrewChangeLog_()` | ~1606 | — | Log array | ✅ Active |
| `readCrewFromRow_(ctx)` | ~1545 | Context | Crew data | ✅ Active |

### Historical Data Functions

| Function | Line | Parameters | Returns | Status |
|----------|------|------------|---------|--------|
| `getExtendedDailyDataLine1_(ss, tz, days)` | ~828 | Spreadsheet, timezone, days | Daily array | ✅ Active |
| `getDailyStrainBreakdown_(ss, tz, days)` | NEW | Spreadsheet, timezone, days | Strain array | ✅ Active |
| `getStrainHistoricalRate_(ss, tz, strain, days)` | ~783 | Params | Rate number | ✅ Active |
| `getComparisonDataLine1_(ss, tz, vals, hoursWorked, todayPct, targetRate)` | ~947 | Params | Comparison | ✅ Active |
| `calculateDayPercentageAtHourLine1_(vals, dateRowIndex, maxHours, targetRate)` | ~978 | Params | Percentage | ✅ Active |

### Projection Functions

| Function | Line | Parameters | Returns | Status |
|----------|------|------------|---------|--------|
| `calculateDailyProjection_(todayRows, lastCompletedHourIndex, currentHourIndex, targetRate, totalLbsSoFar)` | ~893 | Params | Projection | ✅ Active |
| `calculateLeadTimeEstimator(formData)` | ~1345 | Form data | Estimate | ✅ Active |
| `addWorkHours(start, hoursToAdd, workStartHour, workEndHour, daysOff)` | ~1229 | Params | Date | ✅ Active |

### Generation Functions

| Function | Line | Parameters | Returns | Status |
|----------|------|------------|---------|--------|
| `generateHourlyProductionTable()` | ~1006 | — | Creates template | ✅ Active |
| `generateMasterSheet()` | ~1199 | — | Creates master | ✅ Active |
| `setupMonthlySheet(sheet)` | ~1194 | Sheet | Setup complete | ✅ Active |

### AI Agent Functions (NEW - January 2026)

| Function | Line | Parameters | Returns | Status |
|----------|------|------------|---------|--------|
| `handleChatRequest(data)` | NEW | `{ message, history, feedback }` | AI response | ✅ Active |
| `gatherProductionContext()` | NEW | — | Context object | ✅ Active |
| `gatherHistoricalData(ss, tz)` | NEW | Spreadsheet, timezone | Historical object | ✅ Active |
| `buildSystemPrompt(context, corrections)` | NEW | Context, corrections | Prompt string | ✅ Active |
| `callAnthropicForChat(system, history, msg)` | NEW | System, history, message | AI response | ✅ Active |
| `extractCorrections(history)` | NEW | History array | Corrections array | ✅ Active |
| `getRecentCorrections()` | NEW | — | Corrections array | ✅ Active |
| `saveCorrection(text, category)` | NEW | Text, category | Confirmation | ✅ Active |
| `logChatForTraining(msg, response, turn)` | NEW | Params | Confirmation | ✅ Active |
| `logChatFeedback(feedback)` | NEW | Feedback object | Confirmation | ✅ Active |

**handleChatRequest() Flow**:
```
1. Parse incoming data (message, history, feedback)
2. If feedback present → logChatFeedback() and return
3. gatherProductionContext() → Get all current data
4. extractCorrections(history) → Find session corrections
5. getRecentCorrections() → Load saved corrections
6. buildSystemPrompt(context, corrections) → Create ~4KB prompt
7. callAnthropicForChat(system, history, message) → API call
8. logChatForTraining(message, response, turn) → Log for review
9. Return { success, response, context }
```

### Utility Functions

| Function | Line | Parameters | Returns | Status |
|----------|------|------------|---------|--------|
| `jsonResponse(data)` | ~56 | Data object | TextOutput | ✅ Active |
| `getLatestMonthSheet_(ss)` | ~745 | Spreadsheet | Sheet | ✅ Active |
| `findDateRow_(vals, dateLabel)` | ~751 | Values, label | Row index | ✅ Active |
| `getColumnIndices_(headers)` | ~762 | Headers array | Indices object | ✅ Active |
| `isEndOfBlock_(row)` | ~774 | Row array | Boolean | ✅ Active |
| `getTimeSlotMultiplier(timeSlot)` | ~47 | Time string | Multiplier | ✅ Active |
| `getTodayHourlyTrimmers_(ss, tz)` | ~514 | Spreadsheet, tz | Trimmers map | ✅ Active |
| `getTrimmersForHour_(hourlyTrimmers, hour, fallback)` | ~574 | Map, hour, fallback | Count | ✅ Active |
| `getCultivarList()` | ~1455 | — | Cultivar array | ✅ Active |
| `getUiLocale()` | ~1618 | — | Locale string | ✅ Active |
| `isSameDay(d1, d2)` | ~1811 | Date, Date | Boolean | ✅ Active |

### Context Helper Functions

| Function | Line | Parameters | Returns | Status |
|----------|------|------------|---------|--------|
| `assertMonthSheet_(sheetName)` | ~1509 | Sheet name | Boolean | ✅ Active |
| `isValidHrxrDataRow_(sheet, row)` | ~1515 | Sheet, row | Boolean | ✅ Active |
| `getActiveHrxrContext_()` | ~1530 | — | Context object | ✅ Active |
| `jumpToNewestHrHr_()` | ~1632 | — | Navigates | ✅ Active |

### Timer Functions

| Function | Line | Parameters | Returns | Status |
|----------|------|------------|---------|--------|
| `showThroughputTimer()` | ~1625 | — | Opens sidebar | ✅ Active |

### Order Functions (Partial/Future)

| Function | Line | Parameters | Returns | Status |
|----------|------|------------|---------|--------|
| `updateOrderStatuses_(ss)` | ~1817 | Spreadsheet | Updates | ⚠️ Partial |
| `computeOrderProgress_(ss, tz, current)` | ~1851 | Params | Progress | ⚠️ Partial |
| `computeProductionForCultivarSince_(ss, tz, cultivar, startDate)` | ~1889 | Params | Production | ⚠️ Partial |
| `getOrCreateOrdersSheet_()` | ~1923 | — | Orders sheet | ⚠️ Partial |
| `saveOrdersFromEstimator(formData)` | ~1933 | Form data | Saved | ⚠️ Partial |

### Test Functions

| Function | Line | Parameters | Purpose | Status |
|----------|------|------------|---------|--------|
| `testAIAgent()` | NEW | — | Test basic chat | ✅ Active |
| `testAIAgentFollowUp()` | NEW | — | Test multi-turn | ✅ Active |
| `testAICorrection()` | NEW | — | Test correction | ✅ Active |
| `testGatherContext()` | NEW | — | Test data gathering | ✅ Active |
| `testSaveCorrection()` | NEW | — | Test correction save | ✅ Active |
| `viewChatLog()` | NEW | — | View chat history | ✅ Active |
| `viewCorrections()` | NEW | — | View corrections | ✅ Active |
| `testScoreboardAPI()` | ~1953 | — | Test scoreboard | ✅ Active |

---

## HTML Template Files

### ProductionScoreboard.html

**Size**: ~60 KB, ~1,500 lines  
**Purpose**: Floor TV display showing live production

| Section | Purpose |
|---------|---------|
| Header | Title, logo, current time |
| Main Metrics | Today's lbs, % target, rate |
| Crew Panel | Current trimmer count |
| Bag Timer | Bag counts, cycle time |
| Hourly Chart | Chart.js bar chart |
| Footer | Last update time |

### LeadTimeEstimatorSidebar.html

**Size**: ~14 KB, ~400 lines  
**Purpose**: Calculate order completion estimates

| Component | Purpose |
|-----------|---------|
| Order form | Customer, quantity, cultivar |
| Calculator | Time/date estimation |
| Results | ETA, work days needed |
| Save button | Store to Orders sheet |

### ThroughputTimerSidebar.html

**Size**: ~8 KB, ~200 lines  
**Purpose**: Control bag timer

| Component | Purpose |
|-----------|---------|
| Timer display | Time since last bag |
| Pause/Resume | Break handling |
| Manual log | Log bag without webhook |
| History | Recent bag completions |

### ProductionDashboard.html

**Size**: ~63 KB, ~1,600 lines  
**Purpose**: Comprehensive dashboard view

| Section | Purpose |
|---------|---------|
| Summary cards | Key metrics |
| Production table | Hour-by-hour |
| Charts | Trends |
| Comparison | vs yesterday/week |

---

## Sheet Inventory

### Production Sheet Tabs

| Tab Name | Purpose | Rows | Columns | Updated |
|----------|---------|------|---------|---------|
| 2026-01 | January 2026 production | ~300 | 11 | Continuously |
| 2025-12 | December 2025 production | ~300 | 11 | Archived |
| 2025-11 | November 2025 production | ~300 | 11 | Archived |
| ... | (Monthly archives) | ... | ... | ... |
| Rogue Origin Production Tracking | Webhook bag log | ~5,000 | 5 | Webhooks |
| Timer Pause Log | Break records | ~200 | 6 | On pause |
| CrewChangeLog | Crew changes | ~500 | 11 | On change |
| Data | Reference data | ~100 | 10 | Rarely |
| Master | Consolidated | ~3,000 | 15 | Daily |
| AI_Chat_Log | Chat history | Growing | 6 | On chat |
| AI_Corrections | Corrections | Growing | 4 | On correction |

### Sheet Column Mappings

**Monthly Sheet (YYYY-MM)**:
```
A: Time Slot     F: Cultivar
B: Buckers L1    G: Tops
C: Buckers L2    H: Smalls
D: Trimmers L1   I: Wage Rate
E: Trimmers L2   J: Trim Cost
```

**Rogue Origin Production Tracking**:
```
A: Timestamp    D: SKU
B: Bag Type     E: Source
C: Weight
```

**AI_Chat_Log**:
```
A: Timestamp    D: Turn
B: Question     E: Feedback
C: Response     F: Notes
```

**AI_Corrections**:
```
A: Timestamp    C: Status
B: Correction   D: Category
```

---

## External Dependencies

### Runtime Dependencies

| Dependency | Version | Source | Purpose |
|------------|---------|--------|---------|
| Google Apps Script | Current | Google | Backend runtime |
| GitHub Pages | — | GitHub | Frontend hosting |
| Chart.js | 3.x | CDN | Production charts |

### API Dependencies

| Service | Endpoint | Auth | Purpose |
|---------|----------|------|---------|
| Anthropic Claude | api.anthropic.com | API Key | AI chat |
| tec-it.com | barcode.tec-it.com | None | Barcode images |
| Shopify | Webhooks | Webhook secret | Bag logging |

### CDN Resources

```html
<!-- Chart.js -->
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>

<!-- Google Fonts -->
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
```

---

## Removed/Deprecated Code

### Order Tracking System (Removed January 2026)

**Reason**: Never completed, abandoned in favor of Phase 2 redesign

| Component | Lines | Date Removed |
|-----------|-------|--------------|
| OrdersSidebar.html | ~200 | Jan 2026 |
| OrdersPanel.html | ~150 | Jan 2026 |
| OrderDetailModal.html | ~100 | Jan 2026 |
| OrderEditModal.html | ~100 | Jan 2026 |
| Order functions in Code.gs | ~350 | Jan 2026 |
| **Total** | **~900** | |

### Duplicate Files

| File | Reason | Date Removed |
|------|--------|--------------|
| ProductionDashboard.html (copy) | Duplicate | Jan 2026 |

### Deprecated Functions

| Function | Replacement | Date |
|----------|-------------|------|
| `getOrderProgress_()` | Removed | Jan 2026 |
| `updateOrdersUI_()` | Removed | Jan 2026 |
| `renderOrderCard_()` | Removed | Jan 2026 |

---

## Architecture Decisions

### ADR-001: Dual-Mode Architecture

**Status**: Accepted  
**Date**: 2024  
**Context**: Need to support both Apps Script sidebar and GitHub Pages standalone

**Decision**: Detect environment and use appropriate API method
```javascript
const isAppsScript = typeof google !== 'undefined' && google.script;
```

**Consequences**: 
- All frontend code must check `isAppsScript`
- Both `google.script.run` and `fetch()` patterns needed
- Slight code complexity increase

### ADR-002: CORS Handling

**Status**: Accepted  
**Date**: 2024  
**Context**: Apps Script blocks CORS preflight for application/json

**Decision**: Use `text/plain` content-type for POST requests

**Consequences**:
- Bypasses CORS preflight
- Server must parse text as JSON
- Slight deviation from REST standards

### ADR-003: AI Context in System Prompt

**Status**: Accepted  
**Date**: January 2026  
**Context**: How to provide production data to AI

**Decision**: Include all data in system prompt rather than tools

**Consequences**:
- Simpler implementation
- Faster responses (no tool calls)
- Large prompt (~4KB) but within limits
- Can add tools later if needed

### ADR-004: Learning via Sheets

**Status**: Accepted  
**Date**: January 2026  
**Context**: How to store AI feedback and corrections

**Decision**: Use Google Sheets tabs (AI_Chat_Log, AI_Corrections)

**Consequences**:
- No additional infrastructure
- Easy to review/edit manually
- Persistent across deployments
- Human-curated corrections

### ADR-005: Bilingual Default

**Status**: Accepted  
**Date**: 2024  
**Context**: Hispanic workforce with varying English

**Decision**: All UI text must support EN/ES via translation function

**Consequences**:
- `t(key)` function required for all text
- `labels` object must be maintained
- Better floor adoption
- Reduced training burden

---

## Known Issues

### Active Issues

| ID | Severity | Component | Issue | Workaround |
|----|----------|-----------|-------|------------|
| KI-001 | Low | AI Agent | First response slow (~10-15s) | Expected - API latency |
| KI-002 | Low | GitHub Pages | Cache delays on deploy | Hard refresh (Ctrl+Shift+R) |
| KI-003 | Low | Apps Script | 6-minute execution limit | Paginate large operations |
| KI-004 | Medium | CrewChangeSidebar | File is empty (0 bytes) | Use other crew methods |

### Resolved Issues

| ID | Component | Issue | Resolution | Date |
|----|-----------|-------|------------|------|
| RI-001 | AI Chat | CORS preflight failing | Use text/plain | Jan 2026 |
| RI-002 | Bag Timer | 10lb bags not tracked | Added 10lb support | Dec 2025 |
| RI-003 | Scoreboard | Missing strain rates | Added strain rates | 2025 |
| RI-004 | Dashboard | Dead order code | Removed | Jan 2026 |

---

## Technical Debt

### High Priority

| Item | Effort | Impact | Notes |
|------|--------|--------|-------|
| Empty CrewChangeSidebar.html | 2 hrs | Medium | Needs content or removal |
| Inconsistent error messages | 4 hrs | Medium | Standardize format |

### Medium Priority

| Item | Effort | Impact | Notes |
|------|--------|--------|-------|
| Large Code.gs file (~1,900 lines) | 8 hrs | Medium | Consider splitting |
| Mixed const/var usage | 2 hrs | Low | Convert to const/let |
| Some hardcoded strings | 4 hrs | Low | Move to labels |
| Inconsistent naming | 4 hrs | Low | Standardize |

### Low Priority

| Item | Effort | Impact | Notes |
|------|--------|--------|-------|
| scoreboard.html size (468KB) | 8 hrs | Low | Externalize Chart.js |
| No automated tests | 16 hrs | Medium | Add test framework |
| No TypeScript | 40 hrs | Low | Consider for v3 |

### Technical Debt Score

| Category | Score (1-10) | Notes |
|----------|--------------|-------|
| Code Quality | 7 | Good overall, some legacy |
| Documentation | 9 | Comprehensive |
| Test Coverage | 3 | Manual tests only |
| Security | 8 | API key properly stored |
| Performance | 7 | Some large files |
| Maintainability | 8 | Good patterns, documented |
| **Average** | **7.0** | Good health |

---

## Recommendations

### Immediate (This Week)

| Priority | Task | Effort | Owner |
|----------|------|--------|-------|
| 🔴 High | Deploy AI Agent to production | 2 hrs | Koa |
| 🔴 High | Test with boss on real usage | 1 hr | Koa/Boss |
| 🟡 Medium | Fix or remove empty CrewChangeSidebar.html | 1 hr | Koa |
| 🟢 Low | Review AI_Chat_Log for patterns | 30 min | Koa |

### Short-term (This Month)

| Priority | Task | Effort | Owner |
|----------|------|--------|-------|
| 🔴 High | Add facility-specific knowledge to AI | 4 hrs | Koa |
| 🔴 High | Add example Q&A pairs to system prompt | 2 hrs | Koa |
| 🟡 Medium | Design Order Tracking v2 schema | 8 hrs | Koa |
| 🟡 Medium | Add voice input (Web Speech API) | 8 hrs | Koa |
| 🟢 Low | Standardize error messages | 4 hrs | Koa |

### Medium-term (Q1 2026)

| Priority | Task | Effort | Owner |
|----------|------|--------|-------|
| 🔴 High | Build Order Tracking v2 | 40 hrs | Koa |
| 🔴 High | Build Consignment System | 40 hrs | Koa |
| 🟡 Medium | Add proactive alerts | 16 hrs | Koa |
| 🟡 Medium | Mobile input optimization | 16 hrs | Koa |
| 🟢 Low | Split Code.gs into modules | 8 hrs | Koa |

### Long-term (2026)

| Priority | Task | Effort | Owner |
|----------|------|--------|-------|
| 🔴 High | Value Stream Mapping (Phase 5) | 80 hrs | Koa |
| 🟡 Medium | Multi-facility support | 40 hrs | Koa |
| 🟡 Medium | Advanced analytics | 40 hrs | Koa |
| 🟢 Low | White-label platform | 120 hrs | Koa |
| 🟢 Low | Native mobile app | 160 hrs | Koa |

---

## Appendix

### File Checksums

| File | MD5 | Date |
|------|-----|------|
| ops-hub.html | (generate) | Jan 2026 |
| Code.gs | (generate) | Jan 2026 |
| CLAUDE.md | (generate) | Jan 2026 |

### Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.0 | Jan 2026 | AI Agent, 10lb bags, docs |
| 1.5 | Dec 2025 | 10lb bag support |
| 1.0 | 2024 | Initial release |

### Contact

| Role | Name | Notes |
|------|------|-------|
| Operations/Builder | Koa | Primary maintainer |
| Owner | Boss | Business decisions |

---

*This inventory should be updated whenever significant changes are made to the codebase.*
