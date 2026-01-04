# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# Rogue Origin Operations Hub

> Hemp processing company in Southern Oregon. Data-driven operations, bilingual (EN/ES) workforce.
> **Architecture**: Static HTML frontend (GitHub Pages) + Google Apps Script backend + Google Sheets database

## Quick Reference

### URLs & IDs
| Resource | Value |
|----------|-------|
| **Live Apps** | https://rogueff.github.io/rogue-origin-apps/ |
| **Production API** | `https://script.google.com/macros/s/AKfycbxDAHSFl9cedGS49L3Lf5ztqy-SSToYigyA30ZtsdpmWNAR9H61X_Mm48JOOTGqqr-Z/exec` |
| **Production Sheet** | `1dARXrKU2u4KJY08ylA3GUKrT0zwmxCmtVh7IJxnn7is` |
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
rogue-origin-apps-main/
├── *.html                      Frontend apps (deployed to GitHub Pages)
├── apps-script/                Local copies of Google Apps Script backends
│   ├── production-tracking/    Main backend (~1,900 lines)
│   ├── sop-manager/
│   ├── kanban/
│   └── barcode-manager/
├── docs/                       Technical documentation
│   ├── APP_CATALOG.md          Complete API reference
│   ├── CODEBASE_INVENTORY.md   File-by-file inventory
│   └── PROJECT_STRUCTURE.md
└── ROADMAP.md                  Development phases and status
```

**Key Files**:
- `index.html` - **HYBRID DASHBOARD** (NEW: Muuri drag-drop, dual theme, AI chat, resizable widgets)
- `index-NEW.html` - Organic industrial design reference
- `index-backup-hybrid.html` - Backup before hybrid merge
- `ops-hub.html` - Operations hub (may be deprecated in favor of index.html)
- `scoreboard.html` - Floor TV display (~468KB with embedded charts)
- `apps-script/production-tracking/Code.gs` - Main backend logic

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

### Dual-Mode Detection (Required)
```javascript
const isAppsScript = typeof google !== 'undefined' && google.script;
const API_URL = 'https://script.google.com/macros/s/AKfycbx.../exec';

async function loadData(action) {
  if (isAppsScript) {
    return new Promise((resolve, reject) => {
      google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).getData(action);
    });
  }
  return fetch(`${API_URL}?action=${action}`).then(r => r.json());
}
```

### CORS-Safe POST (Critical)
```javascript
// MUST use text/plain to avoid CORS preflight
fetch(`${API_URL}?action=chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify(data)
});
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
