# Features Changelog

Detailed implementation history for major features in the Rogue Origin Operations Hub.

---

## Recent Features (February 2026)

### Command Center - Real-Time Production Dashboard (2026-02-06)

**Overview:** Industrial control room aesthetic page for production floor monitoring with real-time metrics, live polling, and performance visualization.

**Features:**
- Real-time API polling (30s intervals) for production metrics from scoreboard endpoint
- Circular SVG bag timer with auto-updating cycle time and overtime alerts
- Daily progress tracking with lbs produced, target achievement percentage, and predictive finish time
- Crew breakdown cards showing trimmers/buckers per line
- Hourly performance sparkline chart (last 8 hours)
- Color-coded performance indicators (green for on-target, gold for above-target, red for below-target)
- Connection status indicator with live pulse animation
- Dark mode optimized for production floor visibility (OLED-friendly)
- Responsive design for tablet and mobile devices
- Exponential backoff retry on API failures

**Technical:**
- ES6 module architecture with `main.js` entry point
- CSS Grid layout with glass morphism panels (semi-transparent + blur)
- SVG ring animations for bag timer countdown
- Automatic reconnect with exponential backoff (max 30s retry delay)
- Performance optimizations for continuous polling

**Files:**
- `src/pages/command-center.html` - Standalone HTML page
- `src/css/command-center.css` - Industrial styling with dark theme
- `src/js/command-center/main.js` - Real-time data polling and rendering

**API Integration:**
- Endpoint: `/api/production?action=scoreboard`
- Data structure: `scoreboard` object with daily targets, strain, hourly rates; `timer` object with bag metrics

---

### Scoreboard Declutter & No-Scroll Layout (2026-02-04)

**Goal:** Eliminate scrolling, reduce clutter, optimize for TV viewing

**Changes:**

**FAB Menu System:**
- Replaced 8 scattered buttons with single Floating Action Button
- Menu slides up from bottom-right with 6 items
- EN/ES toggle remains visible (most-used control)
- Auto-fade to 20% opacity on TV after 10s idle
- Keyboard navigation (Tab, Enter, Arrows, Escape)

**Responsive Breakpoints:**
- TV Mode (≥1920px): Huge text (120-140px), OLED pure blacks, distance-optimized
- Desktop Mode (768-1919px): Balanced sizing (64-80px), arm's length viewing
- Mobile Mode (<768px): Stacked layout, touch-friendly (48px targets), may scroll

**Vertical Space Optimization:**
- Compact header: Merged strain + time into 60px bar (saved 100px)
- Tightened hour cards: Reduced padding/margins (saved 40px)
- Chart hidden by default: Toggle via FAB menu (saved 300px)
- Order queue hidden by default: Toggle via FAB menu (saved 180px)
- Comparison pills compacted (saved 10px)
- **Total saved: 630px** (1,250px → 700px)

**Polish:**
- Smooth transitions with cubic-bezier easing
- Staggered menu item animations
- Gear icon rotates 90° on menu open
- Focus management for accessibility
- WCAG 2.1 AA compliant

**Impact:**

- **87.5% reduction** in visible chrome (8 buttons → 1 FAB + EN/ES toggle)
- No scrolling on any device (768px+ height)
- TV text readable from 10+ feet
- Touch targets ≥48px on mobile
- Maintains all existing functionality
- Cleaner, more professional appearance

**Files Modified:**

- `src/css/fab-menu.css` (new)
- `src/js/scoreboard/fab-menu.js` (new)
- `src/css/scoreboard.css` (responsive breakpoints, compact styles)
- `src/pages/scoreboard.html` (FAB menu HTML, compact header)
- `src/js/scoreboard/main.js` (compact header updates, order queue default)
- `src/js/scoreboard/render.js` (compact strain display)
- `src/js/scoreboard/i18n.js` (FAB menu translations)

---

### Hourly Entry Goal Fix & Mid-Hour Crew Changes (2026-02-03)

**Bugs Fixed**:
1. `getProduction` API was not returning `targetRate` — hourly entry always used hardcoded 0.9 instead of the 7-day rolling average
2. QC notes never persisted — frontend sent `qcNotes`, backend read `qc` (field name mismatch in both save and load directions)
3. `copyCrewFromPrevious()` called undefined `handleFieldChange()` — replaced with `scheduleAutoSave()`

**Feature**: Mid-hour crew changes now compute time-weighted effective trimmers for goal calculations.

Previously, changing crew mid-hour would overwrite the trimmer count for the entire hour. Now the system tracks when changes happen and calculates a weighted average:
- 5 trimmers for 30 min + 3 trimmers for 30 min = 4.0 effective trimmers
- Goal, predicted, and step guide all use the weighted count
- Effective trimmers are stored in D1 and used by the scoreboard/daily projections

**Schema Change**: `monthly_production` table gained two columns:
- `effective_trimmers_line1 REAL`
- `effective_trimmers_line2 REAL`

**API Changes**:
- `getProduction` response now includes `targetRate`, `effectiveTrimmers1`, `effectiveTrimmers2`
- `getProduction` response renamed `qc` to `qcNotes` for consistency with frontend
- `addProduction` accepts `qcNotes` (with `qc` fallback) and `effectiveTrimmers1/2`
- `getScoreboardData` uses effective trimmers when available for goal calculations

**Files Changed**: `src/js/hourly-entry/index.js`, `workers/src/handlers/production-d1.js`, `workers/schema.sql`

---

## Recent Features (January 2026)

### Shopify Webhook Migration to Cloudflare (2026-01-23)

**Feature**: Shopify Flow inventory webhook migrated from Google Apps Script to Cloudflare Workers

**Problem**: Google Apps Script webhook had rate limiting issues (429 errors) and slow cold starts (10-15 seconds)

**Solution**:
- Migrated webhook to Cloudflare Workers (0ms cold start, no rate limits)
- Dual-write pattern: webhook writes to both D1 (SQLite) and Google Sheets for backwards compatibility
- Bag timer data (`getBagTimerData`) now reads from D1 instead of Google Sheets
- Added secret token authentication for security

**Webhook URL**:
```
https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=webhook&secret=<token>
```

**D1 Table**: `inventory_adjustments`
- timestamp, sku, product_name, variant_title, strain_name, size
- quantity_adjusted, new_total_available, previous_available
- location, product_type, barcode, price, flow_run_id

**Blacklist System** (for test/accidental scans):
```javascript
const BLACKLISTED_BAGS = [
  { start: new Date('2026-01-19T20:34:14Z'), end: new Date('2026-01-19T20:38:05Z') }, // Range
  { exact: new Date('2026-01-23T19:45:35Z'), tolerance: 2000 }, // Single bag
];
```

**Environment Variables** (via `wrangler secret put`):
- `WEBHOOK_SECRET` - secret token for webhook authentication

**Status**: ✅ Deployed (Shopify Flow fires to both old and new endpoints during transition)

---

### Break-Adjusted Cycle Times (2026-01-20)

**Feature**: Bag cycle times now subtract break periods that fall within the cycle window, giving accurate working time instead of wall-clock time.

**Breaks Subtracted** (PST timezone):
| Break | Time | Duration |
|-------|------|----------|
| Morning | 9:00 AM | 10 min |
| Lunch | 12:00 PM | 30 min |
| Afternoon | 2:30 PM | 10 min |
| Cleanup | 4:20 PM | 10 min |

**Example**: Bag started at 11:39 AM, completed at 1:36 PM
- Wall-clock time: 117 min
- Lunch break (12:00-12:30): -30 min
- **Actual cycle time: 87 min** ✅

**Implementation** (`workers/src/handlers/production.js`):
- `BREAKS` constant defines break schedule
- `getBreakMinutesInWindow(startTime, endTime)` calculates overlap
- Timezone-aware: converts break times to PST before comparison
- Applied to both `avgSecondsToday` and `cycleHistory` calculations

---

### Smart Polling for Scoreboard (2026-01-20)

**Feature**: Scoreboard only fetches full data when backend data actually changes, reducing API calls by ~90%.

**How It Works**:
1. Frontend polls lightweight `?action=version` endpoint every 5 seconds (~50 bytes)
2. Compares version number with last known version
3. Only fetches full scoreboard data if version changed
4. Version auto-increments when data changes (webhook, bag logged, pause, shift start, etc.)

**Backend Changes** (`workers/src/handlers/production.js`):
- New D1 table: `data_version` (key, version, updated_at)
- New endpoint: `?action=version` returns `{ version: N, updatedAt: "..." }`
- `incrementDataVersion()` called by: inventoryWebhook, addProduction, logBag, logPause, logResume, setShiftStart

**Frontend Changes**:
- `api.js` - New `checkVersion()` function with local version tracking
- `main.js` - `checkForUpdates()` replaces direct `loadData()` polling

**Benefits**:
- ~90% fewer API calls when data is static
- Faster: version check is tiny vs full scoreboard payload
- Reduces Google Sheets API load
- Updates still arrive within 5 seconds of any change

**Future Upgrade Path**: $5/month Cloudflare paid tier enables Durable Objects for true WebSocket real-time updates (zero polling).

---

### Cloudflare Workers + D1 Migration (2026-01-19)

**Backend Migration**: All API endpoints migrated from Vercel Functions to Cloudflare Workers for better performance and higher free tier limits. Most handlers now use Cloudflare D1 (SQLite) instead of Google Sheets.

| App | API Endpoint | Data Source | Status |
|-----|--------------|-------------|--------|
| Barcode | `/api/barcode` | D1 | ✅ Complete |
| Kanban | `/api/kanban` | D1 | ✅ Complete |
| SOP Manager | `/api/sop` | D1 | ✅ Complete |
| Orders | `/api/orders` | D1 | ✅ Complete |
| Production + Scoreboard | `/api/production` | Google Sheets | ✅ Complete (D1 ready) |

**Why Cloudflare Workers**:
- 100,000 free requests/day (vs Vercel's lower limits causing 429 errors)
- No cold starts (~0ms vs 10-15s on Vercel/Apps Script)
- Edge deployment for faster global responses
- Lightweight: Direct REST API (~300 lines) vs googleapis package (15MB)

**Why D1 (SQLite)**:
- Faster queries than Google Sheets REST API
- No rate limiting issues
- SQL queries vs complex row parsing
- Data stays on Cloudflare edge (low latency)

**Key Changes**:
- Base URL: `https://rogue-origin-api.roguefamilyfarms.workers.dev/api`
- Workers code in `workers/` directory
- D1 database: `rogue-origin-db` (ID: `31397aa4-aa8c-47c4-965d-d51d36be8b13`)
- Feature flags in `index.js` control Sheets vs D1 per handler
- Response wrapper pattern: `{ success: true, data: {...} }`

**Worker Structure**:
```
workers/
├── wrangler.toml           # Cloudflare config (D1 binding)
├── schema.sql              # D1 database schema (15 tables)
├── package.json
└── src/
    ├── index.js            # Router + feature flags
    ├── handlers/           # API endpoints
    │   ├── production.js      # Google Sheets version
    │   ├── production-d1.js   # D1 version (ready, not enabled)
    │   ├── orders.js          # Google Sheets version
    │   ├── orders-d1.js       # D1 version ✅
    │   ├── barcode.js         # Google Sheets version
    │   ├── barcode-d1.js      # D1 version ✅
    │   ├── kanban.js          # Google Sheets version
    │   ├── kanban-d1.js       # D1 version ✅
    │   ├── sop.js             # Google Sheets version
    │   └── sop-d1.js          # D1 version ✅
    └── lib/                # Shared utilities
        ├── db.js           # D1 query helpers
        ├── sheets.js       # Google Sheets REST client
        ├── auth.js         # JWT authentication
        ├── cors.js         # CORS handling
        ├── errors.js       # Error handling
        ├── response.js     # Response formatting
        └── validate.js     # Input validation
```

**Feature Flags** (in `workers/src/index.js`):
```javascript
const USE_D1_BARCODE = true;     // ✅ Using D1
const USE_D1_KANBAN = true;      // ✅ Using D1
const USE_D1_SOP = true;         // ✅ Using D1
const USE_D1_ORDERS = true;      // ✅ Using D1
const USE_D1_PRODUCTION = false; // Using Sheets (manual data entry workflow)
```

**D1 Tables** (schema.sql):
- `barcode_inventory`, `barcode_bags`, `barcode_labels`, `barcode_blacklist`
- `kanban_cards`
- `sops`, `sop_requests`, `sop_settings`
- `orders_customers`, `orders_orders`, `orders_shipments`, `orders_shipment_lines`, `orders_payments`
- `production_tracking`, `monthly_production`, `pause_log`, `shift_adjustments`
- `data_version` - Smart polling version tracking for scoreboard

**Environment Variables** (via `wrangler secret put`):
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`
- `BARCODE_SHEET_ID`, `KANBAN_SHEET_ID`, `SOP_SHEET_ID`, `ORDERS_SHEET_ID`, `PRODUCTION_SHEET_ID`
- `ANTHROPIC_API_KEY`, `ORDERS_PASSWORD`

**Deployment**:
```bash
cd workers
npm install
npx wrangler login
npx wrangler deploy

# Apply schema to D1 (one-time)
npx wrangler d1 execute rogue-origin-db --remote --file=schema.sql

# Run migration for a handler (one-time)
curl "https://rogue-origin-api.roguefamilyfarms.workers.dev/api/barcode?action=migrate"
```

**Production Note**: Production handler stays on Google Sheets because hourly data is entered manually in the spreadsheet. D1 handler (`production-d1.js`) is ready with `addProduction`/`getProduction` endpoints when workflow changes.

**Fallback**: Vercel Functions still available at `https://rogue-origin-apps-master.vercel.app/api` (commented out in frontend configs)

---

### Vercel Functions Migration (2026-01-17) - Superseded

**Note**: Vercel Functions were replaced by Cloudflare Workers on 2026-01-19 due to rate limiting issues.

**Original Migration Plan**: See `docs/plans/2025-01-17-vercel-migration.md`

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

---

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

---

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

---

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

## Code Quality Overhaul (January 2026)

### Phase 2.1 & 2.2: Architecture Cleanup

Split 3323-line `dashboard.js` into 11 ES6 modules in `js/modules/`:
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

HTML updated: `<script type="module" src="js/modules/index.js">`

### Phase 1.1: Memory Leak Fixes

- Added interval registry to state.js (`setInterval_`, `clearInterval_`, `clearAllIntervals`)
- All event listeners tracked via `registerEventListener()` for cleanup
- `cleanup()` clears intervals, timers, charts, grids, listeners on unload

### Phase 1.2: Security Hardening

- API URL centralized in `config.js` only
- `api-cache.js` requires explicit `apiUrl` parameter
- Input validation added to all Apps Script backends:
  - `production-tracking/Code.gs` - date/string/numeric validation
  - `barcode-manager/Code.gs` - barcode format validation
  - `wholesale-orders/Code.gs` - full schema validation
- Formula injection prevention (blocks `=IMPORTDATA`, `=HYPERLINK`, etc.)

### Phase 6.1-6.2: Documentation & CSS Cleanup (2026-01-26)

- ✅ Updated all README files with current architecture
- ✅ Added comprehensive JSDoc comments to core modules (state.js, utils.js)
- ✅ Created CSS consolidation strategy document (`src/css/CSS_CONSOLIDATION.md`)
- ✅ Documented theming system and CSS variable architecture
- 📋 **Next**: Execute CSS consolidation (remove duplicate :root blocks, implement @import pattern)

---

## Dashboard Features (index.html)

### Dual Theme System
- **Light Theme**: Clean professional cream background (default)
- **Dark Theme**: Organic industrial with earth tones, hemp leaf pattern, dramatic 4-layer shadows
- Toggle via header button (🌙 / ☀️)
- Theme persists in localStorage
- Charts auto-update colors on theme change

### Muuri.js Drag-and-Drop
- Widgets are draggable, resizable, collapsible
- 5 size classes: small (25%), medium (33%), large (50%), xl (66%), full (100%)
- Spring easing animations (`cubic-bezier(0.34, 1.56, 0.64, 1)`)
- Layout persists in localStorage (position, size, collapsed state, visibility)

### Widget Action Buttons
Each widget has 4 action buttons:
- **⤢ Resize**: Cycles through 5 size classes
- **− Collapse**: Shows/hides widget content (becomes +)
- **⋮⋮ Drag Handle**: Grab to reorder widgets
- **× Hide**: Removes widget from view (restore via Settings panel)

### Floating Action Buttons (FABs)
- **⚙️ Settings FAB** (bottom-right, green): Opens settings panel
- **🌿 AI Chat FAB** (bottom-right, gold): Opens AI assistant

### Settings Panel
- Right-slide panel (400px, full-width on mobile)
- Widget visibility toggles for all 25+ widgets
- Theme switcher
- Reset layout button
- Mutually exclusive with AI Chat (only one open at a time)

### AI Chat Panel
- Right-slide panel (400px, full-width on mobile)
- Connects to backend `handleChatRequest()` function
- Typing indicators (3 bouncing dots)
- Message bubbles (user: green, assistant: glass)
- Enter key to send
- Auto-scrolls to bottom
- Mutually exclusive with Settings panel

### Typography System
- **Display** (Headings, Titles): `DM Serif Display` - Premium serif
- **Mono** (Numbers, Data): `JetBrains Mono` - Precision monospace
- **UI** (Body, Labels): `Outfit` - Modern, clean sans-serif

### Spring Animations
- Widget pop-in on load
- FAB bounce entrance (1.2s delay, staggered)
- Drag scale-up (1.05x)
- Hover effects with spring easing
- Timeline dot pulse

### Responsive Breakpoints
- **Desktop** (>1200px): 3-column grid
- **Tablet** (768-1200px): 2-column grid
- **Mobile** (<768px): 1-column grid, drag handles hidden, panels full-width

---

## CSS Architecture Details

### CSS Variable System (shared-base.css)

All CSS variables are centralized in `shared-base.css`:

```css
:root {
  /* ===== TYPOGRAPHY ===== */
  --font-display: 'DM Serif Display', serif;  /* Headings, titles */
  --font-mono: 'JetBrains Mono', monospace;   /* Numbers, data */
  --font-ui: 'Outfit', sans-serif;            /* Body, labels */

  /* Type Scale */
  --text-hero: 96px;
  --text-display: 48px;
  --text-h1: 28px;
  --text-body: 14px;
  --text-sm: 13px;
  --text-xs: 11px;

  /* ===== BRAND COLORS ===== */
  --ro-green: #668971;    /* Primary */
  --ro-gold: #e4aa4f;     /* Accent */

  /* Green Family (50-900 scale) */
  --green-50: #f4f7f5;
  --green-500: #668971;   /* Brand green */
  --green-900: #1a1a1a;

  /* Gold Family (50-900 scale) */
  --gold-50: #fef9f0;
  --gold-400: #e4aa4f;    /* Brand gold */
  --gold-800: #8c5f1f;

  /* ===== SEMANTIC COLORS ===== */
  --success: #668971;
  --warning: #e4aa4f;
  --danger: #c45c4a;
  --info: #62758d;

  /* ===== LIGHT THEME (DEFAULT) ===== */
  --bg: #faf8f5;          /* Cream background */
  --bg-card: #ffffff;     /* White cards */
  --bg-warm: #f3efe7;     /* Warm tint */
  --text: #2d3a2e;        /* Primary text */
  --text-muted: #8a9a8e;  /* Secondary text */
  --border: #e8e4de;      /* Subtle borders */

  /* ===== SPACING ===== */
  --space-xs: 8px;
  --space-sm: 16px;
  --space-md: 24px;
  --space-lg: 40px;
  --space-xl: 64px;

  /* ===== LAYOUT ===== */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;

  --shadow-sm: 0 2px 4px rgba(0,0,0,0.06);
  --shadow-md: 0 4px 8px rgba(0,0,0,0.08);
  --shadow-lg: 0 8px 16px rgba(0,0,0,0.1);

  /* ===== ANIMATIONS ===== */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-smooth: cubic-bezier(0.4, 0, 0.2, 1);
  --duration-fast: 150ms;
  --duration-normal: 300ms;
  --duration-slow: 600ms;
}

/* ===== DARK MODE ===== */
body.dark-mode,
[data-theme="dark"] {
  --bg: #1a1a1a;
  --bg-card: #2d2d2d;
  --bg-warm: #22291e;
  --text: #e0e0e0;
  --text-muted: #888888;
  --border: rgba(255,255,255,0.2);
  --shadow-sm: 0 2px 4px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 8px rgba(0,0,0,0.4);
  --shadow-lg: 0 8px 16px rgba(0,0,0,0.5);
  /* Theme variables override light theme values */
}
```

### Theme System Implementation

**Switching mechanism**:
1. User clicks theme toggle button in header
2. JavaScript adds/removes `dark-mode` class on `<body>`
3. CSS variables automatically update via `:root` overrides
4. Chart.js theme updates programmatically
5. Preference saved to `localStorage`

**Implementation** (`src/js/modules/theme.js`):
```javascript
export function toggleTheme() {
  const isDark = document.body.classList.toggle('dark-mode');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  updateChartThemes(); // Update Chart.js colors
}
```

**Theme persistence**:
- Stored in `localStorage` as `'theme': 'light' | 'dark'`
- Restored on page load before content renders (prevents flash)

### CSS File Structure

```
src/css/
├── shared-base.css       ⭐ MASTER CSS VARIABLES (328 lines)
├── dashboard.css         📊 Main dashboard (2702 lines)
├── scoreboard.css        📺 Floor TV display (2562 lines)
├── hourly-entry.css      ⏰ Production logging (1975 lines)
├── kanban.css            📋 Task board (585 lines)
├── sop-manager.css       📖 SOP system (1193 lines)
├── barcode.css           🏷️  Label printing (485 lines)
├── orders.css            📦 Order management (1264 lines)
├── order.css             👤 Customer portal (409 lines)
├── ops-hub.css           🔧 Alt dashboard (888 lines)
└── ai-chat.css           🤖 AI chat UI (421 lines)
```

### CSS Consolidation Strategy

**Problem**: Each CSS file had duplicate `:root` variable declarations (~4000+ lines of duplication)

**Solution** (documented in `src/css/CSS_CONSOLIDATION.md`):
1. ✅ Centralize ALL variables in `shared-base.css`
2. 📋 **TODO**: Add `@import './shared-base.css';` to each app CSS file
3. 📋 **TODO**: Remove duplicate `:root` blocks from app CSS files
4. 📋 **TODO**: Visual regression testing to ensure no styles break

**Expected reduction**: 8152 lines → ~4000 lines (-51% CSS code)

### Mobile-First Responsive Design

**Breakpoints**:
```css
/* Mobile first (default) */
/* Tablet: 768px and up */
@media (min-width: 768px) { ... }
/* Desktop: 1200px and up */
@media (min-width: 1200px) { ... }
```

**Touch optimization**:
- 44px minimum touch targets (WCAG AAA)
- Ripple effects on button presses (touch devices only)
- No hover states on touch (avoids "sticky" hovers)
- Safe area insets for iPhone X+ notches

**Mobile typography**:
- 14px body text (readable without zoom)
- 16px input fields (prevents iOS auto-zoom)
- 12px minimum for small text (WCAG AA compliance)

### Accessibility Features

**WCAG AA Compliance**:
- Color contrast ratios ≥ 4.5:1 for text
- Focus indicators on all interactive elements
- Semantic HTML structure
- ARIA labels for dynamic content
- Keyboard navigation support

**Safe area insets** (iPhone X+ notch support):
```css
@supports (padding-bottom: env(safe-area-inset-bottom)) {
  body {
    padding-top: env(safe-area-inset-top);
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
  }
}
```

### Animation System

**Spring physics** (`--ease-spring`):
- Widget pop-in animations
- FAB bounce entrance
- Hover lift effects
- Drag interactions

**Smooth easing** (`--ease-smooth`):
- Theme transitions
- Color changes
- Opacity fades

**Performance**:
- GPU-accelerated properties (`transform`, `opacity`)
- `will-change` for draggable elements
- `prefers-reduced-motion` support

### Z-Index Hierarchy

Standardized z-index layers (documented in dashboard.css):

| Layer | Value | Purpose |
|-------|-------|---------|
| Background texture | -1 | Hemp fiber pattern |
| Base content | 1-10 | Widgets, cards |
| Widget drag states | 50 | Dragging widgets |
| Sidebar | 50 | Navigation panel |
| Sticky header | 60 | Top app bar |
| Dropdowns | 100 | Menus, tooltips |
| Modals | 300-350 | Modal overlays |
| Settings panel | 400-410 | Right slide panel |
| FAB | 800 | Floating action button |
| Toast | 950 | Notifications |
| AI chat FAB | 1000 | AI button |
| AI chat panel | 1050 | AI conversation |
| Loading overlay | 1100 | Full-screen loader |
