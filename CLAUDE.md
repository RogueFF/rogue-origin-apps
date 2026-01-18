# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# Rogue Origin Operations Hub

> Hemp processing company in Southern Oregon. Data-driven operations, bilingual (EN/ES) workforce.
> **Architecture**: Static HTML frontend (GitHub Pages) + Vercel Functions backend + Google Sheets database

## Current Status

- **Version**: 2.1 (ES6 Modular Architecture)
- **Git**: Initialized (January 4, 2026)
- **Structure**: Organized and documented
- **Production**: ✅ Live and operational
- **Main Dashboard**: `index.html` (ES6 modules + Muuri.js + dual themes + AI chat)

---

## Code Quality Overhaul (January 2026)

### ✅ Completed Phases

**Phase 2.1 & 2.2: Architecture Cleanup**
- Split 3323-line `dashboard.js` into 11 ES6 modules in `js/modules/`:
  - `config.js` - KPI/widget definitions, API URL, work schedule
  - `state.js` - Centralized state (replaces 30+ globals)
  - `utils.js` - Safe helpers, formatters, date utilities
  - `theme.js` - Dark/light mode, Chart.js theme
  - `navigation.js` - View switching, sidebar
  - `settings.js` - localStorage persistence
  - `api.js` - Data fetching with AbortController
  - `grid.js` - Muuri drag-drop grids
  - `charts.js` - Chart.js initialization
  - `panels.js` - Settings/AI chat panels
  - `widgets.js` - KPI/widget rendering
  - `date.js` - Date range selection
  - `index.js` - Main entry point
- HTML updated: `<script type="module" src="js/modules/index.js">`

**Phase 1.1: Memory Leak Fixes**
- Added interval registry to state.js (`setInterval_`, `clearInterval_`, `clearAllIntervals`)
- All event listeners tracked via `registerEventListener()` for cleanup
- `cleanup()` clears intervals, timers, charts, grids, listeners on unload

**Phase 1.2: Security Hardening**
- API URL centralized in `config.js` only
- `api-cache.js` requires explicit `apiUrl` parameter
- Input validation added to all Apps Script backends:
  - `production-tracking/Code.gs` - date/string/numeric validation
  - `barcode-manager/Code.gs` - barcode format validation
  - `wholesale-orders/Code.gs` - full schema validation
- Formula injection prevention (blocks `=IMPORTDATA`, `=HYPERLINK`, etc.)

### 📋 Remaining Phases

| Phase | Description | Priority |
|-------|-------------|----------|
| 3.1 | Error handling & loading states | High |
| 4.1 | Reduce scoreboard.html (414KB → <100KB) | Medium |
| 5.1 | Accessibility fixes (WCAG AA) | High |
| 4.2-4.3 | Lazy loading optimizations | Medium |
| 6.1-6.2 | Documentation & CSS cleanup | Low |

**To continue**: Start with Phase 3.1 (error handling) or Phase 5.1 (accessibility)

## Recent Features (January 2026)

### Vercel Functions Migration Complete (2026-01-17)

**Backend Migration**: All Apps Script backends migrated to Vercel Functions for faster response times.

| App | API Endpoint | Status |
|-----|--------------|--------|
| Barcode | `/api/barcode` | ✅ Complete |
| Kanban | `/api/kanban` | ✅ Complete |
| SOP Manager | `/api/sop` | ✅ Complete |
| Orders | `/api/orders` | ✅ Complete |
| Production + Scoreboard | `/api/production` | ✅ Complete |

**Key Changes**:
- Response times improved from 10-15s (Apps Script cold start) to ~200-500ms
- Base URL: `https://rogue-origin-apps-master.vercel.app/api/{app}`
- Content-Type changed from `text/plain` to `application/json`
- Response wrapper pattern: `{ success: true, data: {...} }`
- Frontend response handling: `const response = raw.data || raw;`

**Environment Variables** (in Vercel dashboard):
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` (shared)
- `BARCODE_SHEET_ID`, `KANBAN_SHEET_ID`, `SOP_SHEET_ID`, `ORDERS_SHEET_ID`, `PRODUCTION_SHEET_ID`
- `ANTHROPIC_API_KEY` (AI chat/SOP features)
- `GOOGLE_TTS_API_KEY` (voice features)
- `ORDERS_PASSWORD` (orders auth)

**Migration Plan**: See `docs/plans/2025-01-17-vercel-migration.md`

---

### Wholesale Orders System Deployment (2026-01-09)

**Feature**: Full order management system for wholesale customers

**Deployment**:
- Configured sheet ID: `1QLQaR4RMniUmwbJFrtMVaydyVMyCCxqHXWDCVs5dejw`
- Deployed wholesale-orders backend to Google Apps Script
- API URL: `https://script.google.com/macros/s/AKfycbxU5dBd5GU1RZeJ-UyNFf1Z8n3jCdIZ0VM6nXVj6_A7Pu2VbbxYWXMiDhkkgB3_8L9MyQ/exec`
- Configured password authentication in Script Properties

**Capabilities**:
- Customer management (create, edit, delete)
- Order creation with commitment tracking
- Shipment management with line items (strain, type, quantity, pricing)
- Payment recording
- Financial calculations (commitment, fulfilled, paid, balance due)
- Password-protected access
- Shopify order import

**Bug Fix**:
- Fixed duplicate Order ID generation bug
- Order IDs now increment properly: MO-2026-001, MO-2026-002, MO-2026-003
- Changed from using `data.length` to finding max existing order number
- Updated in `apps-script/wholesale-orders/Code.gs` (lines 728-742)

**Code Cleanup**:
- Removed redundant order queue functions from `production-tracking/Code.gs`
- Removed ~236 lines: `getScoreboardOrderQueue()`, `calculateOrderProgress()`, `updateOrderPriority()`
- Separated concerns: production tracking vs wholesale orders management

**Testing Results**:
- ✅ End-to-end Playwright testing completed
- ✅ Login authentication works
- ✅ Customer creation confirmed
- ✅ Order creation with unique IDs verified (MO-2026-003)
- ✅ Shipment creation tested (INV-2026-0014, $3,000)
- ✅ Financial calculations accurate
- ✅ Data persistence confirmed in Google Sheets

**Status**: ✅ Deployed and operational

### Scoreboard & Order Queue Fixes (2026-01-13)

**Bug Fixes**: Three critical issues resolved for production floor scoreboard

**1. Bag Counting Issue**
- **Problem**: Order progress showing 0/120kg instead of actual completion (35kg)
- **Root Cause**: Bag scanning webhook adds new entries to TOP of tracking sheet, but code was reading from BOTTOM (oldest data)
- **Fix**: Changed `count5kgBagsForStrain()` to read rows 2-2001 (newest 2000 bags from top)
- **File**: `apps-script/wholesale-orders/Code.gs:1535-1546`
- **Result**: Progress now shows correctly (35/120kg = 7 bags × 5kg)

**2. Timer Freeze During Breaks**
- **Problem**: Bag timer counting backwards/incrementing during lunch breaks instead of freezing
- **Root Cause**: When `debugOnBreak=true`, code was skipping ALL scheduled break subtractions, causing elapsed time to include break time
- **Fix**: Removed condition that skipped break subtraction in debug mode - always subtract scheduled breaks
- **File**: `src/js/scoreboard/timer.js:79-100`
- **Testing**: Added `testBreakMode(true/false)` function for instant break testing in console
- **Result**: Timer now freezes correctly during breaks (both scheduled and debug mode)

**3. API Timeout on Cold Starts**
- **Problem**: Service worker timeout errors on first page load (Apps Script cold starts take 10-15 seconds)
- **Root Cause**: Service worker timeout was 8 seconds, insufficient for Apps Script cold starts
- **Fix**: Increased timeout to 20 seconds in service worker
- **File**: `sw.js:191-192` (version bumped to v3.5)
- **Result**: Page loads without network errors, then retries work smoothly

**Performance Optimization**:
- Limited bag counting to read only 2000 most recent rows instead of entire sheet
- Reduces API response time from 15+ seconds to ~4 seconds
- Covers 1-2 weeks of production data (sufficient for active orders)

**Testing Commands**:
```javascript
// Test break freeze in browser console
testBreakMode(true);  // Enable break mode (freezes timer, turns yellow)
testBreakMode(false); // Disable break mode (timer resumes)
```

**Status**: ✅ All fixes deployed and verified

### SOP Manager Enhancements (2026-01-15)

**Features**:
- **Media Upload Modal**: iPad-optimized with camera/photo/video capture options
- **Image Annotation Editor**: Full markup toolkit for step images
  - Tools: Arrow, Circle, Rectangle, Freehand, Text, Symbol
  - Symbols: ⚠️ 🚫 ✓ ❌ ➡️ 👆 🔍
  - Colors: Red, Yellow, Green, Blue
  - Undo/redo with 30-step history
- **Video Support**: YouTube URL detection with thumbnail preview
- **iPad Optimization**: 44px touch targets, 16px fonts (prevents iOS zoom)
- **Language Detection**: AI improvements preserve input language (EN/ES)

**Files**: `src/pages/sop-manager.html`, `src/css/sop-manager.css`

### Carryover Bag Tracking & One-Click Start Button (2026-01-15)

**Feature**: Accurate cycle time tracking for bags started yesterday and finished today, plus simplified shift start button

**Problem Solved**:
- Bags started at end of shift yesterday (e.g., 4:00 PM), finished this morning (e.g., 8:00 AM) were showing 0 minutes or being excluded
- Start production button required manual time entry, creating timezone issues and extra clicks

**Implementation**:

**1. Carryover Cycle Calculation**
- Detects bags completed before shift start time
- Calculates combined working time from yesterday + today
- Excludes cleanup time (4:20-4:30 PM) automatically
- Displays carryover symbol ⟲ in all cycle views
- Allows carryover cycles to exceed normal 4-hour limit

**Example Scenario**:
```
Yesterday:
  3:45 PM - Last bag scanned
  4:20 PM - Cleanup starts (work stops counting)

Today:
  7:26 AM - "Start Production" clicked
  8:00 AM - First bag completed

Cycle Time Calculation:
  Yesterday work: 3:45 PM → 4:20 PM = 35 minutes
  Today work: 7:26 AM → 8:00 AM = 34 minutes
  Total: 1h 9m ⟲ (shown with carryover symbol)
```

**2. One-Click Start Button**
- Click "Start Day" → Records current server time → Done
- No manual time entry required
- Uses accurate server time (eliminates timezone issues)
- Shows immediate UI feedback, syncs with backend

**Backend Changes** (`apps-script/production-tracking/Code.gs`):
- New helper: `getYesterdayLastBag_()` (lines 1157-1205)
  - Finds yesterday's last 5kg bag before cleanup (4:20 PM)
  - Returns timestamp and cleanup cutoff
- Updated cycle calculation (lines 979-997)
  - Detects carryover scenario when `bag.timestamp <= workdayStart`
  - Calculates: `yesterdayWork + todayWork`
  - Adds `isCarryover: true` flag to cycle data
- Simplified `handleSetShiftStart()` (lines 446-491)
  - No time parameter = use current server time
  - Eliminates client/server timezone differences

**Frontend Changes**:
- `src/js/scoreboard/cycle-history.js` - Display ⟲ symbol in all 5 visualization modes
- `src/js/scoreboard/api.js` - Pass null for server time
- `src/js/scoreboard/shift-start.js` - One-click behavior

**Testing Results** (Playwright):
- ✅ Zero-minute cycles eliminated
- ✅ Carryover tracking deployed (backend ready)
- ✅ One-click start button working (7:26 AM recorded)
- ✅ All cycle display modes tested (Donut, Bars, Grid, Cards, List)
- ✅ Cross-browser verified (Chrome, Safari, Mobile)

**Files Modified**:
- `apps-script/production-tracking/Code.gs` - Backend logic
- `src/js/scoreboard/cycle-history.js` - Frontend display
- `src/js/scoreboard/api.js` - API integration
- `src/js/scoreboard/shift-start.js` - Start button behavior
- `tests/carryover-bags.spec.js` - Automated verification

**Status**: ✅ Deployed and verified

---

## Quick Reference

### URLs & IDs
| Resource | Value |
|----------|-------|
| **Live Apps** | https://rogueff.github.io/rogue-origin-apps/ |
| **Vercel API Base** | `https://rogue-origin-apps-master.vercel.app/api` |
| **Production API** | `https://rogue-origin-apps-master.vercel.app/api/production` |
| **Orders API** | `https://rogue-origin-apps-master.vercel.app/api/orders` |
| **Production Sheet** | `1dARXrKU2u4KJY08ylA3GUKrT0zwmxCmtVh7IJxnn7is` |
| **Orders Sheet** | `1QLQaR4RMniUmwbJFrtMVaydyVMyCCxqHXWDCVs5dejw` |
| **Barcode Sheet** | `1JQRU1-kW5hLcAdNhRvOvvj91fhezBE_-StN5X1Ni6zE` |

### Brand Colors
```css
--ro-green: #668971;      /* Primary */
--ro-green-dark: #4a6b54;
--gold: #e4aa4f;          /* Accent */
--danger: #c45c4a;
--bg-main: #1a1a1a;       /* Dark mode default */
--bg-card: #2d2d2d;
```

### AI Config
- Model: `claude-sonnet-4-20250514`
- API Key: Script Properties → `ANTHROPIC_API_KEY`

---

## Project Structure

```
rogue-origin-apps/
├── src/                            📦 Source code
│   ├── pages/                      📄 HTML applications
│   │   ├── index.html              ⭐ HYBRID DASHBOARD (Muuri, dual theme, AI chat)
│   │   ├── scoreboard.html         Floor TV display (~468KB embedded charts)
│   │   ├── barcode.html            Label printing
│   │   ├── kanban.html             Task board
│   │   ├── orders.html             Internal order management
│   │   ├── order.html              Customer portal
│   │   ├── sop-manager.html        Standard Operating Procedures
│   │   └── ops-hub.html            Alternative dashboard
│   │
│   ├── js/                         💻 JavaScript
│   │   ├── modules/                ⭐ ES6 MODULAR CODEBASE (11 modules)
│   │   │   ├── index.js            Main entry point
│   │   │   ├── config.js           KPI/widget definitions, API URL
│   │   │   ├── state.js            Centralized state manager
│   │   │   ├── utils.js            Helper functions
│   │   │   ├── theme.js            Dark/light mode
│   │   │   ├── navigation.js       View switching
│   │   │   ├── settings.js         localStorage persistence
│   │   │   ├── api.js              Data fetching
│   │   │   ├── grid.js             Muuri drag-drop
│   │   │   ├── charts.js           Chart.js
│   │   │   ├── panels.js           Settings/AI panels
│   │   │   ├── widgets.js          KPI/widget rendering
│   │   │   └── date.js             Date range selection
│   │   ├── scoreboard/             Scoreboard modules (10 files)
│   │   ├── shared/                 Shared utilities
│   │   │   └── api-cache.js        Caching layer
│   │   └── legacy/                 Deprecated code
│   │       └── dashboard.js        Legacy monolith
│   │
│   ├── css/                        🎨 Stylesheets
│   │   └── *.css                   Per-page stylesheets
│   │
│   └── assets/                     🖼️  Static assets
│       ├── icons/                  SVG icons (hemp leaf, patterns)
│       └── images/                 (future use)
│
├── apps-script/                    Local copies of Google Apps Script backends
│   ├── production-tracking/        Main backend (~1,900 lines)
│   ├── sop-manager/
│   ├── kanban/
│   ├── wholesale-orders/
│   └── barcode-manager/
│
├── docs/                           Documentation
│   ├── README.md                   Documentation index
│   ├── technical/                  Technical documentation
│   │   ├── APP_CATALOG.md          Complete API reference
│   │   ├── CODEBASE_INVENTORY.md   File-by-file inventory
│   │   └── PROJECT_STRUCTURE.md    Architecture docs
│   ├── design/                     Design system specs
│   ├── plans/                      Implementation plans
│   ├── guides/                     Setup & user guides
│   └── sessions/                   Development session notes
│
├── tests/                          Test suite
├── archive/                        Backups & design explorations
├── Skills/                         Custom AI skills
│
├── index.html                      🔀 Root redirect to src/pages/
├── sw.js                           Service worker
├── CLAUDE.md                       This file
├── ROADMAP.md                      Development phases and status
└── README.md                       Main documentation
```

**Key Files**:
- `src/pages/index.html` - **HYBRID DASHBOARD** (Muuri drag-drop, dual theme, AI chat)
- `src/pages/scoreboard.html` - Floor TV display (~468KB with embedded charts)
- `src/pages/ops-hub.html` - Alternative operations hub design
- `apps-script/production-tracking/Code.gs` - Main backend logic
- `src/js/modules/` - ES6 modular dashboard architecture

## Hybrid Dashboard Features (index.html)

### **NEW: Dual Theme System**
- **Light Theme**: Clean professional cream background (default)
- **Dark Theme**: Organic industrial with earth tones, hemp leaf pattern, dramatic 4-layer shadows
- Toggle via header button (🌙 / ☀️)
- Theme persists in localStorage
- Charts auto-update colors on theme change

### **NEW: Muuri.js Drag-and-Drop**
- Widgets are draggable, resizable, collapsible
- 5 size classes: small (25%), medium (33%), large (50%), xl (66%), full (100%)
- Spring easing animations (`cubic-bezier(0.34, 1.56, 0.64, 1)`)
- Layout persists in localStorage (position, size, collapsed state, visibility)

### **Widget Action Buttons**
Each widget has 4 action buttons:
- **⤢ Resize**: Cycles through 5 size classes
- **− Collapse**: Shows/hides widget content (becomes +)
- **⋮⋮ Drag Handle**: Grab to reorder widgets
- **× Hide**: Removes widget from view (restore via Settings panel)

### **NEW: Floating Action Buttons (FABs)**
- **⚙️ Settings FAB** (bottom-right, green): Opens settings panel
- **🌿 AI Chat FAB** (bottom-right, gold): Opens AI assistant

### **NEW: Settings Panel**
- Right-slide panel (400px, full-width on mobile)
- Widget visibility toggles for all 25+ widgets
- Theme switcher
- Reset layout button
- Mutually exclusive with AI Chat (only one open at a time)

### **NEW: AI Chat Panel**
- Right-slide panel (400px, full-width on mobile)
- Connects to backend `handleChatRequest()` function
- Typing indicators (3 bouncing dots)
- Message bubbles (user: green, assistant: glass)
- Enter key to send
- Auto-scrolls to bottom
- Mutually exclusive with Settings panel

### **Typography System**
- **Display** (Headings, Titles): `DM Serif Display` - Premium serif
- **Mono** (Numbers, Data): `JetBrains Mono` - Precision monospace
- **UI** (Body, Labels): `Outfit` - Modern, clean sans-serif

### **Spring Animations**
- Widget pop-in on load
- FAB bounce entrance (1.2s delay, staggered)
- Drag scale-up (1.05x)
- Hover effects with spring easing
- Timeline dot pulse

### **Responsive Breakpoints**
- **Desktop** (>1200px): 3-column grid
- **Tablet** (768-1200px): 2-column grid
- **Mobile** (<768px): 1-column grid, drag handles hidden, panels full-width

## Git Workflow

**Work directly on `main` - no PRs required.**

```bash
git add . && git commit -m "message" && git push
# GitHub Pages auto-deploys in ~1-2 min
```

**Apps Script Deployment** (manual step after editing .gs files):
1. Copy updated code from `apps-script/` folder
2. Paste into Google Apps Script editor
3. Deploy → Manage deployments → Edit → New version → Deploy

---

## Apps

| App | File | Backend | Purpose |
|-----|------|---------|---------|
| Ops Hub | index.html | Production Code.gs | Dashboard + AI chat |
| Scoreboard | scoreboard.html | Production Code.gs | Floor TV display |
| SOP Manager | sop-manager.html | SOP Code.gs | Procedures |
| Kanban | kanban.html | Kanban Code.gs | Task board |
| Barcode | barcode.html | Barcode Code.gs | Label printing |
| Orders | orders.html | (pending) | Internal order mgmt |
| Customer Portal | order.html | (pending) | Customer order view |

---

## Domain Terms

| Term | Meaning |
|------|---------|
| **Tops** | Premium flower buds |
| **Smalls** | Smaller buds, lower grade |
| **Bucking** | Removing buds from stems |
| **Trimmers** | Workers who trim buds |
| **Grove Bags** | Packaging brand used |
| **5kg bag** | 11.02 lbs, primary wholesale |
| **Line 1/2** | Production lines in trim room |
| **COA** | Certificate of Analysis (lab test) |

Work hours: 7am-4:30pm, ~7.5 effective hours (minus breaks)

---

## Code Patterns

### Vercel API Calls (Standard Pattern)
```javascript
const API_URL = 'https://rogue-origin-apps-master.vercel.app/api/production';

// GET request
async function loadData(action) {
  const response = await fetch(`${API_URL}?action=${action}`);
  const raw = await response.json();
  return raw.data || raw;  // Unwrap Vercel response wrapper
}

// POST request
fetch(`${API_URL}?action=chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data)
})
.then(r => r.json())
.then(raw => {
  const response = raw.data || raw;  // Unwrap Vercel wrapper
  // Use response...
});
```

### Legacy: Apps Script Mode (for embedded dialogs)
```javascript
const isAppsScript = typeof google !== 'undefined' && google.script;

if (isAppsScript) {
  // Used when HTML is served from within Google Sheets dialog
  google.script.run.withSuccessHandler(callback).withFailureHandler(onError).getData(action);
}
```

### Bilingual Support (Required for UI)
```javascript
const labels = {
  en: { save: 'Save', loading: 'Loading...', trimmers: 'Trimmers' },
  es: { save: 'Guardar', loading: 'Cargando...', trimmers: 'Podadores' }
};
let lang = 'en';
const t = (key) => labels[lang][key] || key;
```
```html
<button data-i18n="save">Save</button>
```

---

## Development

### Adding Features
1. Check existing patterns in codebase
2. **Bilingual required** - all UI needs EN + ES
3. **Mobile-first** - boss uses phone
4. **Dual-mode** - support both Apps Script + fetch
5. Test both environments before deploy

### Deploying Frontend
```bash
git add . && git commit -m "message" && git push
# Hard refresh: Ctrl+Shift+R
```

### Deploying Backend (Apps Script)
1. Open Sheet → Extensions → Apps Script
2. Edit Code.gs, save
3. Deploy → Manage deployments → Edit → New version → Deploy
4. Test: `?action=test`

---

## Troubleshooting

### "Failed to fetch"
- Use `text/plain` not `application/json` (CORS)
- Check deployment URL is current
- Hard refresh browser

### AI Not Responding
- Check ANTHROPIC_API_KEY in Script Properties
- Check Apps Script execution logs (View → Executions)

### Debug in Console
```javascript
fetch('API_URL?action=test').then(r=>r.json()).then(console.log)
```

---

## AI Agent

The Ops Hub includes an AI chat (floating 🌿 button) that answers production questions.

**Key functions in Code.gs:**
- `handleChatRequest()` - main entry point
- `gatherProductionContext()` - collects current data
- `buildSystemPrompt()` - constructs AI context
- `callAnthropicForChat()` - API call

**Data sources:**
- `getScoreboardData()` - today's production, crew, rate
- `getBagTimerData()` - bag completions, cycle times
- `gatherHistoricalData()` - last 30 days, week-over-week

**Correction learning:** AI detects phrases like "Actually...", "No,...", "FYI:" and logs them to AI_Corrections sheet.

---

## Projection Formulas

```
1 kg = 2.205 lbs
Hours needed = lbs ÷ (trimmers × rate)
Effective hours/day = 7.5
```

Example: 40kg with 5 trimmers at 1.07 lbs/hr rate
```
40 × 2.205 = 88.2 lbs
88.2 ÷ (5 × 1.07) = 16.5 hours = 2.2 work days
```

---

## Architecture Notes

### Frontend-Backend Communication

**Dual-Mode Pattern**: All HTML apps detect whether running in Apps Script container or GitHub Pages:
```javascript
const isAppsScript = typeof google !== 'undefined' && google.script;
// If Apps Script: use google.script.run
// If GitHub Pages: use fetch() to web app URL
```

**Data Flow**:
1. User interacts with HTML frontend (GitHub Pages or Apps Script UI)
2. JavaScript detects environment and chooses communication method
3. Backend Apps Script processes request, queries Google Sheets
4. Response returns as JSON
5. Frontend updates UI

### Google Sheets as Database

**Monthly Production Sheets** (tabs named "YYYY-MM"):
- Hour-by-hour production data
- Date blocks separated by blank rows
- Columns: Time Slot, Crew counts (Buckers/Trimmers Line 1/2), Cultivar, Tops/Smalls lbs, Wage Rate
- Backend finds current month sheet dynamically

**Special Tabs**:
- `Data` - Reference data (cultivars, target rates, configuration)
- `Master` - Auto-generated consolidation (via generateMasterSheet())
- `Rogue Origin Production Tracking` - Webhook log for bag completions
- `Timer Pause Log` - Break/pause periods
- `CrewChangeLog` - Crew count change history
- `AI_Chat_Log` - AI conversation history for training
- `AI_Corrections` - User corrections to AI ("Actually..." detection)

### Key Backend Functions (apps-script/production-tracking/Code.gs)

**Entry Points**:
- `doGet(e)` - Routes GET requests (?action=scoreboard, ?action=timer, etc.)
- `doPost(e)` - Routes POST requests (?action=chat, ?action=logBag, etc.)
- `onOpen()` - Adds custom menu items to Google Sheets UI

**Production Data**:
- `getScoreboardData()` - Today's production metrics for Line 1
- `getBagTimerData()` - Bag completions, cycle times
- `buildDashboardData()` - Complete dashboard dataset
- `getExtendedDailyDataLine1_(ss, tz, days)` - N-day historical data

**AI Agent** (Phase 1, ~70% complete):
- `handleChatRequest(data)` - Main chat entry point
- `gatherProductionContext()` - Collects current production state
- `gatherHistoricalData(ss, tz)` - 30-day analysis for AI context
- `buildSystemPrompt(context, corrections)` - Constructs AI system message
- `callAnthropicForChat(system, history, msg)` - Anthropic API call

**Helper Utilities**:
- `getLatestMonthSheet_(ss)` - Finds current month sheet (YYYY-MM format)
- `getColumnIndices_(headers)` - Maps column names to indices
- `findDateRow_(vals, dateLabel)` - Locates today's data in sheet
- `jsonResponse(data)` - Creates Apps Script JSON response

### External Integrations

1. **Anthropic Claude API** - AI chat functionality
   - Model: `claude-sonnet-4-20250514`
   - API key stored in Script Properties
   - Called from `callAnthropicForChat()`

2. **Shopify Webhooks** - Bag completion events
   - Target: `Rogue Origin Production Tracking` sheet
   - Logs timestamp, bag type, weight, SKU

3. **TEC-IT Barcode Service** - Label printing
   - Free tier, Code128 format
   - Used in barcode.html

### Current Roadmap Status

**Phase 1 (AI Agent Foundation)**: ~70% complete
- ✅ AI chat interface, production data tools, historical analysis
- 📋 Pending: Voice input/output, order tools, consignment tools

**Phase 2 (Customer Order Dashboard)**: ~80% complete
- ✅ Order entry UI, customer portal, pallet tracking
- 📋 Pending: Backend API integration, COA workflow

**Phase 3 (Consignment System)**: Planned
**Phase 4 (Processing Floor Enhancement)**: Partial
**Phase 5 (Value Stream Mapping)**: Planned
**Phase 6 (Product Packaging)**: Future

See ROADMAP.md for complete details.

---

## Common Tasks

### Testing Frontend Changes Locally
```bash
# Open HTML file directly in browser for quick testing
# For API calls, you'll need to deploy or use Apps Script container
```

### Debugging API Calls
```javascript
// Browser console test
fetch('https://script.google.com/.../exec?action=test')
  .then(r=>r.json()).then(console.log)

// Apps Script execution log
// View → Executions in Apps Script editor
```

### Finding Production Data
- Current hour: Read latest row in current month sheet where Time Slot matches current hour
- Daily totals: Sum all rows for today's date
- Historical: Use `getExtendedDailyDataLine1_()` which handles multi-month queries

### Adding AI Agent Capabilities
1. Add tool function in Code.gs (e.g., `get_order_progress()`)
2. Update `buildSystemPrompt()` to include tool in AI context
3. Parse AI response for tool calls in `handleChatRequest()`
4. Call tool function and return result to AI

---

## Important Constraints

- **No build system** - Pure HTML/CSS/JS, no bundler or transpilation
- **No database** - Google Sheets is the database (use Sheets API patterns)
- **CORS limitations** - Must use `text/plain` content-type for POST to avoid preflight
- **Apps Script quotas** - 6 min execution time limit, rate limits on external URLs
- **Mobile-first** - Boss primarily uses phone, all UIs must work well on mobile
- **Bilingual required** - All user-facing text needs EN + ES translations
