# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Learned Behaviors

These are patterns and preferences observed over time. Follow them unless explicitly told otherwise.

### Model Selection
| Task Type | Model | Notes |
|-----------|-------|-------|
| **Thinking/Planning** | Opus | Design, architecture, brainstorming, analysis |
| **Code Execution** | Sonnet | Writing code, implementation, file edits |

Unless otherwise specified, use Opus for planning/thinking tasks and Sonnet for code writing.

### Workflow Instincts

| Trigger | Action | Source |
|---------|--------|--------|
| Making UI/frontend changes | Start local server (`python -m http.server`) and let user verify before committing | Explicit |
| About to push to git | Confirm with user first - they say "push it" when ready | Observed |
| Multiple related tasks | Use TodoWrite to track progress and show the user what's happening | Explicit |
| Searching for code/files | Use Task tool with Explore agent instead of running Glob/Grep directly | Best practice |
| Modifying existing files | Read the file first to understand context before editing | Best practice |

### Communication Style

| Preference | Description |
|------------|-------------|
| **Concise** | Short, direct responses. No fluff or excessive explanation |
| **Technical** | User is technical - skip hand-holding, get to the point |
| **Chaotic-friendly** | User flows between ideas - adapt and follow the energy |

---

## How to Add New Instincts

When you notice a pattern or the user explicitly states a preference:
1. Add it to the appropriate table above
2. Include the trigger, action, and whether it was explicit or observed
3. These persist across all future sessions

---

# Rogue Origin Operations Hub

> Hemp processing company in Southern Oregon. Data-driven operations, bilingual (EN/ES) workforce.
> **Architecture**: Static HTML frontend (GitHub Pages) + Cloudflare Workers backend + Cloudflare D1 database (SQLite) + Google Sheets (production data entry)

## Current Status

- **Version**: 2.1 (ES6 Modular Architecture)
- **Git**: Initialized (January 4, 2026)
- **Structure**: Organized and documented
- **Production**: ✅ Live and operational
- **Main Dashboard**: `index.html` (ES6 modules + Muuri.js + dual themes + AI chat)

---

## Architecture Overview

### Tech Stack
- **Frontend**: Pure HTML/CSS/JS (no build system), ES6 modules
- **Backend**: Cloudflare Workers + D1 (SQLite) for most apps, Google Sheets for production tracking
- **Deployment**: GitHub Pages (auto-deploys on push to main)
- **APIs**: Cloudflare Workers at `https://rogue-origin-api.roguefamilyfarms.workers.dev/api`

### Key Applications

| App | File | Backend | Purpose |
|-----|------|---------|---------|
| Ops Hub | index.html | Cloudflare Workers + Sheets | Dashboard + AI chat |
| Scoreboard | scoreboard.html | Cloudflare Workers + Sheets | Floor TV display |
| SOP Manager | sop-manager.html | D1 | Procedures |
| Kanban | kanban.html | D1 | Task board |
| Barcode | barcode.html | D1 | Label printing |
| Orders | orders.html | D1 | Order management |
| Customer Portal | order.html | D1 | Customer order view |

### Current Development Focus

**✅ Completed:**
- ES6 modular architecture (11 modules)
- Memory leak fixes, security hardening
- Cloudflare Workers migration (D1 database)
- Shopify webhook integration, smart polling
- CSS variable system, dual themes

**📋 Next Priorities:**
- Phase 3.1: Error handling & loading states (High)
- Phase 5.1: Accessibility fixes - WCAG AA (High)
- Phase 6.3: CSS consolidation execution (Medium)
- Phase 4.1: Scoreboard optimization (Medium)

See `ROADMAP.md` for complete development plan.

---

## Project Structure

```
rogue-origin-apps/
├── src/
│   ├── pages/              HTML applications
│   ├── js/
│   │   ├── modules/        ES6 modules (index.html)
│   │   ├── scoreboard/     Scoreboard modules
│   │   └── shared/         Shared utilities
│   ├── css/                Per-page stylesheets
│   │   └── shared-base.css ⭐ Master CSS variables
│   └── assets/             Icons, images
├── workers/                Cloudflare Workers backend
│   ├── src/handlers/       API endpoints
│   ├── src/lib/            Shared utilities
│   └── schema.sql          D1 database schema
├── apps-script/            Local copies of Apps Script backends
├── docs/                   Documentation
│   ├── README.md           Documentation index
│   └── FEATURES_CHANGELOG.md Feature implementation history
└── tests/                  Playwright test suite
```

**Key Files:**
- `src/pages/index.html` - Main dashboard (Muuri drag-drop, dual theme, AI chat)
- `src/js/modules/` - ES6 modular architecture (11 modules)
- `src/css/shared-base.css` - Master CSS variables (all colors, spacing, animations)
- `workers/src/index.js` - API router with feature flags
- `workers/schema.sql` - D1 database schema (15 tables)

---

## Quick Reference

### URLs & IDs
| Resource | Value |
|----------|-------|
| **Live Apps** | https://rogueff.github.io/rogue-origin-apps/ |
| **API Base** | `https://rogue-origin-api.roguefamilyfarms.workers.dev/api` |
| **Production Sheet** | `1dARXrKU2u4KJY08ylA3GUKrT0zwmxCmtVh7IJxnn7is` |
| **Orders Sheet** | `1QLQaR4RMniUmwbJFrtMVaydyVMyCCxqHXWDCVs5dejw` |
| **Barcode Sheet** | `1JQRU1-kW5hLcAdNhRvOvvj91fhezBE_-StN5X1Ni6zE` |
| **D1 Database** | `rogue-origin-db` (ID: `31397aa4-aa8c-47c4-965d-d51d36be8b13`) |

### Brand Colors
```css
--ro-green: #668971;      /* Primary */
--ro-gold: #e4aa4f;       /* Accent */
--danger: #c45c4a;
--info: #62758d;
```

### Break Schedule (PST)
| Break | Time | Duration |
|-------|------|----------|
| Morning | 9:00 AM | 10 min |
| Lunch | 12:00 PM | 30 min |
| Afternoon | 2:30 PM | 10 min |
| Cleanup | 4:20 PM | 10 min |

Work hours: 7:00 AM - 4:30 PM (~7.5 effective hours)

---

## Domain Terms

| Term | Meaning |
|------|---------|
| **Tops** | Premium flower buds |
| **Smalls** | Smaller buds, lower grade |
| **Bucking** | Removing buds from stems |
| **Trimmers** | Workers who trim buds |
| **Grove Bags** | Packaging brand used |
| **5kg bag** | 11.02 lbs, primary wholesale unit |
| **Line 1/2** | Production lines in trim room |
| **COA** | Certificate of Analysis (lab test) |

---

## Code Patterns

### Cloudflare Workers API Calls
```javascript
const API_URL = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production';

// GET request
async function loadData(action) {
  const response = await fetch(`${API_URL}?action=${action}`);
  const raw = await response.json();
  return raw.data || raw;  // Unwrap response wrapper
}

// POST request
fetch(`${API_URL}?action=chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data)
})
.then(r => r.json())
.then(raw => {
  const response = raw.data || raw;
  // Use response...
});
```

### Bilingual Support (Required)
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

## CSS System

### Design System
- **Single source of truth**: `src/css/shared-base.css` contains all CSS variables
- **Dual themes**: Light (cream, default) and Dark (organic industrial)
- **Typography**: DM Serif Display (headings), JetBrains Mono (data), Outfit (UI)
- **Mobile-first**: 768px (tablet), 1200px (desktop) breakpoints
- **Animations**: Spring physics (`--ease-spring`), smooth easing (`--ease-smooth`)

### Best Practices
1. Check `shared-base.css` for existing variables before adding styles
2. Use CSS variables instead of hard-coding values
3. Test both light and dark themes
4. Verify mobile responsive behavior (44px minimum touch targets)
5. Check accessibility (4.5:1 contrast ratio, focus indicators)

**Reference**: `src/css/shared-base.css` for all variables, `docs/design/VISUAL_DESIGN_SYSTEM.md` for design tokens

---

## Development Workflow

### Git Workflow
Work directly on `main` - no PRs required.

```bash
git add . && git commit -m "message" && git push
# GitHub Pages auto-deploys in ~1-2 min
```

### Frontend Development
```bash
# Start local server for testing
python -m http.server

# Hard refresh browser after changes
# Ctrl+Shift+R (Windows/Linux)
# Cmd+Shift+R (Mac)
```

### Backend Deployment

**Cloudflare Workers:**
```bash
cd workers
npx wrangler deploy

# Apply D1 schema (one-time)
npx wrangler d1 execute rogue-origin-db --remote --file=schema.sql

# Set environment variables
npx wrangler secret put WEBHOOK_SECRET
```

**Google Apps Script:**
1. Open Sheet → Extensions → Apps Script
2. Edit Code.gs, save
3. Deploy → Manage deployments → Edit → New version → Deploy
4. Test: `?action=test`

---

## Feature Implementation Guidelines

### Requirements
1. **Bilingual** - All UI text needs EN + ES translations
2. **Mobile-first** - Boss uses phone, all UIs must work on mobile
3. **Dual-mode** - Support both Apps Script + fetch (for embedded dialogs)
4. **Accessibility** - 44px touch targets, 4.5:1 contrast, keyboard nav
5. **Theme support** - Test both light and dark themes

### Adding Features
1. Check existing patterns in codebase first
2. Read files before modifying (understand context)
3. Use TodoWrite for multi-step tasks
4. Test both environments before deploy
5. Update documentation if architecture changes

---

## Database Architecture

### Cloudflare D1 (Primary)
- SQLite database on Cloudflare edge
- 15 tables in `workers/schema.sql`
- Used by: Barcode, Kanban, SOP, Orders, Production (hourly entry)
- Query helpers: `workers/src/lib/db.js`
- `monthly_production` table includes `effective_trimmers_line1/line2` (REAL) for time-weighted crew counts during mid-hour changes

### Google Sheets (Production Only)
- Manual hourly data entry workflow
- Monthly sheets named "YYYY-MM"
- Special tabs: Data, Master, Rogue Origin Production Tracking, Timer Pause Log, AI_Chat_Log
- Backend: `apps-script/production-tracking/Code.gs`

### Feature Flags
Set in `workers/src/index.js`:
```javascript
const USE_D1_BARCODE = true;     // ✅ D1
const USE_D1_KANBAN = true;      // ✅ D1
const USE_D1_SOP = true;         // ✅ D1
const USE_D1_ORDERS = true;      // ✅ D1
const USE_D1_PRODUCTION = false; // Sheets (manual entry)
```

---

## AI Agent

### Overview
- Floating 🌿 button in Ops Hub
- Answers production questions using real-time data
- Model: `claude-sonnet-4-20250514`
- API key: Script Properties → `ANTHROPIC_API_KEY`

### Key Functions (Code.gs)
- `handleChatRequest()` - Main entry point
- `gatherProductionContext()` - Collects current data
- `buildSystemPrompt()` - Constructs AI context
- `callAnthropicForChat()` - API call

### Data Sources
- `getScoreboardData()` - Today's production, crew, rate
- `getBagTimerData()` - Bag completions, cycle times
- `gatherHistoricalData()` - Last 30 days, week-over-week trends

---

## Troubleshooting

### "Failed to fetch"
- Use `text/plain` not `application/json` (CORS workaround)
- Check deployment URL is current
- Hard refresh browser (Ctrl+Shift+R)

### AI Not Responding
- Verify `ANTHROPIC_API_KEY` in Script Properties
- Check Apps Script execution logs: View → Executions

### Debug API Calls
```javascript
// Browser console test
fetch('API_URL?action=test').then(r=>r.json()).then(console.log)
```

### Service Worker Issues
- Clear cache and hard reload
- Check console for version mismatch errors
- Current version: Check `sw.js` header

---

## Important Constraints

- **No build system** - Pure HTML/CSS/JS, no bundler or transpilation
- **Database**: Cloudflare D1 (SQLite) for most apps, Google Sheets for production only
- **CORS limitations** - Must use `text/plain` content-type for POST to avoid preflight
- **Apps Script quotas** - 6 min execution limit (mostly replaced by Workers)
- **Mobile-first** - Boss uses phone, all UIs must work well on mobile
- **Bilingual required** - All user-facing text needs EN + ES translations

---

## Additional Documentation

- `ROADMAP.md` - Development phases and priorities
- `docs/README.md` - Documentation index
- `docs/FEATURES_CHANGELOG.md` - Detailed feature implementation history
- `docs/technical/APP_CATALOG.md` - Complete API reference
- `src/css/CSS_CONSOLIDATION.md` - CSS cleanup strategy
- `docs/design/VISUAL_DESIGN_SYSTEM.md` - Design tokens reference
