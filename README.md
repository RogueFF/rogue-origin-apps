# Rogue Origin Operations Hub

> Hemp processing operations management system for Rogue Origin in Southern Oregon

**Architecture**: Static HTML frontend (GitHub Pages) + Google Apps Script backend + Google Sheets database
**Stack**: Vanilla JavaScript, Chart.js, Muuri.js, Google Apps Script
**Deployment**: [rogueff.github.io/rogue-origin-apps](https://rogueff.github.io/rogue-origin-apps/)

---

## Quick Start

### View the Dashboard
1. Open `index.html` in a browser
2. Or visit: https://rogueff.github.io/rogue-origin-apps/

### For Developers
```bash
# Clone and explore
git clone <repo-url>
cd rogue-origin-apps-main

# Make changes to HTML files
# No build process needed - pure HTML/CSS/JS

# Deploy to GitHub Pages
git add .
git commit -m "Your changes"
git push origin main
# Auto-deploys in 1-2 minutes
```

---

## Project Structure

```
rogue-origin-apps-main/
├── index.html                    ⭐ Main Operations Dashboard (hybrid design)
├── scoreboard.html               📺 Floor TV display
├── sop-manager.html              📋 Standard Operating Procedures
├── kanban.html                   📊 Task board
├── barcode.html                  🏷️  Label printing
├── orders.html                   📦 Internal order management
├── order.html                    👤 Customer portal
├── ops-hub.html                  🔧 Alternative dashboard
│
├── apps-script/                  🔌 Backend code
│   ├── production-tracking/      Main backend (~1,900 lines)
│   ├── barcode-manager/          Barcode backend
│   ├── kanban/                   Kanban backend
│   └── sop-manager/              SOP backend
│
├── docs/                         📚 Documentation
│   ├── APP_CATALOG.md            Complete API reference
│   ├── CODEBASE_INVENTORY.md     File & function inventory
│   ├── PROJECT_STRUCTURE.md      Architecture docs
│   └── sessions/                 Development session notes
│
├── archive/                      📦 Backups & design explorations
│   └── designs/                  Previous HTML versions
│
├── screenshots/                  📸 Visual documentation
├── Skills/                       🤖 Custom AI skills
│
├── CLAUDE.md                     🧠 AI context file (read this!)
├── ROADMAP.md                    🗺️  Development phases
└── README.md                     📖 This file
```

---

## Apps Overview

| App | File | Backend | Status | Purpose |
|-----|------|---------|--------|---------|
| **Operations Dashboard** | `index.html` | Production Code.gs | ✅ Live | Main hub with AI chat, Muuri drag-drop widgets |
| **Scoreboard** | `scoreboard.html` | Production Code.gs | ✅ Live | Floor TV display (468KB with embedded charts) |
| **SOP Manager** | `sop-manager.html` | SOP Code.gs | ✅ Live | Procedures management |
| **Kanban** | `kanban.html` | Kanban Code.gs | ✅ Live | Task tracking board |
| **Barcode Manager** | `barcode.html` | Barcode Code.gs | ✅ Live | Label printing system |
| **Orders (Internal)** | `orders.html` | *(pending)* | 🚧 80% | Internal order management |
| **Customer Portal** | `order.html` | *(pending)* | 🚧 80% | Customer order view |
| **Ops Hub (Alt)** | `ops-hub.html` | Production Code.gs | ✅ Live | Alternative dashboard design |

---

## Key Features

### 🎨 Hybrid Dashboard (index.html)
- **Dual Theme System**: Light (professional cream) + Dark (organic industrial with hemp leaf pattern)
- **Muuri.js Drag-and-Drop**: Resizable, collapsible widgets with persistent layout
- **AI Chat Assistant**: Claude-powered production insights (🌿 FAB button)
- **Real-time Data**: Auto-refresh production metrics
- **Bilingual**: Full EN/ES support
- **Mobile-First**: Responsive design, boss uses phone
- **Typography**: DM Serif Display + JetBrains Mono + Outfit
- **Animations**: Spring physics, staggered reveals, smooth transitions

### 🤖 AI Agent (~70% Complete)
- Answers production questions ("How are we doing today?")
- Historical analysis ("Compare this week to last week")
- Projections ("How long for 40kg with 5 trimmers?")
- Learns from corrections ("Actually..." detection)
- Data sources: Real-time production, crew counts, 30-day history

### 📊 Production Tracking
- Hour-by-hour production logging
- Line 1 & Line 2 tracking
- Cultivar management
- Tops/Smalls separation
- Bag timer with cycle times
- Crew change logging

---

## Tech Stack

### Frontend
- **Pure HTML/CSS/JavaScript** - No build process
- **Chart.js** - Production visualizations
- **Muuri.js** - Dashboard drag-and-drop
- **Google Fonts** - DM Serif Display, JetBrains Mono, Outfit

### Backend
- **Google Apps Script** - Serverless functions
- **Google Sheets** - Database (monthly tabs in YYYY-MM format)

### External Services
- **Anthropic Claude API** - AI chat (claude-sonnet-4-20250514)
- **Shopify Webhooks** - Bag completion events
- **TEC-IT Barcode Service** - Label generation

---

## Development

### Local Testing
```bash
# Open any HTML file directly in browser
# For API calls, you'll need Apps Script container or deployed backend
```

### Frontend Deployment
```bash
git add .
git commit -m "Description of changes"
git push origin main
# GitHub Pages auto-deploys in 1-2 minutes
```

### Backend Deployment (Apps Script)
1. Open Google Sheet → Extensions → Apps Script
2. Copy code from `apps-script/[app-name]/Code.gs`
3. Paste into Apps Script editor
4. Deploy → Manage deployments → Edit → New version → Deploy
5. Test: `?action=test`

### Code Patterns

#### Dual-Mode Detection (Required)
```javascript
const isAppsScript = typeof google !== 'undefined' && google.script;
const API_URL = 'https://script.google.com/macros/s/AKfycbx.../exec';

async function loadData(action) {
  if (isAppsScript) {
    return new Promise((resolve, reject) => {
      google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler(reject)
        .getData(action);
    });
  }
  return fetch(`${API_URL}?action=${action}`).then(r => r.json());
}
```

#### CORS-Safe POST (Critical)
```javascript
// MUST use text/plain to avoid CORS preflight
fetch(`${API_URL}?action=chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify(data)
});
```

#### Bilingual Support
```javascript
const labels = {
  en: { save: 'Save', loading: 'Loading...', trimmers: 'Trimmers' },
  es: { save: 'Guardar', loading: 'Cargando...', trimmers: 'Podadores' }
};
let lang = 'en';
const t = (key) => labels[lang][key] || key;
```

---

## Configuration

### Brand Colors
```css
--ro-green: #668971;      /* Primary */
--ro-green-dark: #4a6b54;
--gold: #e4aa4f;          /* Accent */
--danger: #c45c4a;
--bg-main: #1a1a1a;       /* Dark mode default */
--bg-card: #2d2d2d;
```

### API Endpoints
- **Production API**: `https://script.google.com/macros/s/AKfycbxDAHSFl9cedGS49L3Lf5ztqy-SSToYigyA30ZtsdpmWNAR9H61X_Mm48JOOTGqqr-Z/exec`
- **Production Sheet ID**: `1dARXrKU2u4KJY08ylA3GUKrT0zwmxCmtVh7IJxnn7is`
- **Barcode Sheet ID**: `1JQRU1-kW5hLcAdNhRvOvvj91fhezBE_-StN5X1Ni6zE`

### AI Configuration
- **Model**: `claude-sonnet-4-20250514`
- **API Key**: Stored in Apps Script Project Properties → `ANTHROPIC_API_KEY`

---

## Roadmap

See [ROADMAP.md](ROADMAP.md) for complete details.

### Current Phase: Phase 1 - AI Agent Foundation (~70% Complete)
- ✅ AI chat interface
- ✅ Production data tools
- ✅ Historical analysis & projections
- ✅ Correction learning
- 📋 Voice input/output (moved to Phase 4)

### Next: Phase 2 - Customer Order Dashboard (~80% Complete)
- ✅ Order entry UI
- ✅ Customer portal
- ✅ Pallet tracking
- 📋 Backend API integration
- 📋 COA workflow

---

## Documentation

### For Claude Code Users
**Read**: [`CLAUDE.md`](CLAUDE.md) - Comprehensive AI context file with:
- Quick reference (URLs, Sheet IDs, colors)
- Architecture patterns
- Code standards
- Domain terminology
- Development guidelines

### For Developers
- **[docs/APP_CATALOG.md](docs/APP_CATALOG.md)** - Complete API reference for all apps
- **[docs/CODEBASE_INVENTORY.md](docs/CODEBASE_INVENTORY.md)** - File/function inventory
- **[docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md)** - Architecture deep-dive
- **[docs/sessions/](docs/sessions/)** - Development session notes

---

## Troubleshooting

### "Failed to fetch"
- Use `text/plain` not `application/json` (CORS requirement)
- Check deployment URL is current
- Hard refresh browser (Ctrl+Shift+R)

### AI Not Responding
- Check `ANTHROPIC_API_KEY` in Script Properties
- Check Apps Script execution logs (View → Executions)

### Debug in Console
```javascript
fetch('API_URL?action=test').then(r=>r.json()).then(console.log)
```

---

## Domain Context

**Company**: Rogue Origin - Hemp processing in Southern Oregon
**Product**: Premium hemp flower (tops & smalls)
**Workforce**: Bilingual (EN/ES), mobile-first users
**Operations**: 7am-4:30pm, ~7.5 effective hours/day
**Packaging**: 5kg Grove Bags (11.02 lbs) for wholesale

**Key Terms**:
- **Tops**: Premium flower buds
- **Smalls**: Smaller buds, lower grade
- **Bucking**: Removing buds from stems
- **Line 1/2**: Production lines in trim room
- **COA**: Certificate of Analysis (lab test)

---

## Contributing

### Git Workflow
Work directly on `main` - no PRs required (single-person/small team workflow).

```bash
git add .
git commit -m "description"
git push origin main
```

### Code Standards
- **Mobile-first** - Boss primarily uses phone
- **Bilingual** - All UI text needs EN + ES
- **Dual-mode** - Support Apps Script + GitHub Pages (fetch)
- **No build tools** - Pure HTML/CSS/JS
- **CORS-aware** - Use `text/plain` for POST requests

---

## License

Proprietary - Rogue Origin internal use only.

---

## Contact

For questions or support, contact Rogue Origin operations team.

---

**Version**: 2.0 (Hybrid Dashboard with AI Agent)
**Last Updated**: January 4, 2026
**Status**: ✅ Production Ready
