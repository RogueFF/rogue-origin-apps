# Documentation Index

> Comprehensive documentation for the Rogue Origin Operations Hub project

**Last Updated**: February 2, 2026
**Version**: 2.1 (ES6 Modular Architecture)

---

## 📁 Directory Structure

### `/technical`
Technical documentation for developers:
- **APP_CATALOG.md** - Complete API reference and endpoint documentation
- **CODEBASE_INVENTORY.md** - File-by-file inventory of the codebase
- **PROJECT_STRUCTURE.md** - Architecture and system design documentation
- **API_REFERENCE.md** - Cloudflare Workers API documentation

### `/design`
Design system and visual specifications:
- **VISUAL_DESIGN_SYSTEM.md** - Colors, typography, spacing tokens
- **COMPONENT_SPECS.md** - UI component specifications
- **ANIMATION_SYSTEM.md** - Animation guidelines and easing functions
- **ICON_SET.md** - Icon library (Phosphor duotone icons)
- **MOBILE_DESIGN.md** - Mobile-first design patterns
- **THEME_SYSTEM.md** - Light/dark theme implementation

### `/plans`
Implementation plans and roadmaps:
- **2025-01-17-vercel-migration.md** - Backend migration plan (superseded by Cloudflare)
- **2026-01-19-cloudflare-migration.md** - Cloudflare Workers + D1 migration
- Feature implementation plans
- Technical design documents
- Architecture decision records

### `/sessions`
Development session notes and test reports:
- Session summaries and progress reports
- Test results (Playwright, visual regression)
- Bug fix documentation
- Quick start guides

### `/guides`
User and setup guides:
- **AUTHENTICATION_SETUP.md** - Authentication configuration guide
- **SHOPIFY_MANUAL_IMPORT_GUIDE.md** - Shopify import procedures
- **DEPLOYMENT.md** - Deployment instructions (GitHub Pages + Cloudflare)
- **LOCAL_DEVELOPMENT.md** - Local testing setup

---

## 🔗 Related Documentation

### Core Documentation
- [Main README](../README.md) - Project overview, quick start, and features
- [CLAUDE.md](../CLAUDE.md) - AI assistant instructions, architecture, and domain context
- [ROADMAP.md](../ROADMAP.md) - Product roadmap and development phases

### Reports & Phase Summaries
All completion reports, phase summaries, and audit documents are in [`/reports`](./reports/).
- [CRIT-1-COMPLETION-SUMMARY.md](./reports/CRIT-1-COMPLETION-SUMMARY.md) - Critical bug fixes
- [PHASE-3.1-COMPLETION-REPORT.md](./reports/PHASE-3.1-COMPLETION-REPORT.md) - Error handling implementation
- [ACCESSIBILITY_PHASE_5_1.md](./reports/ACCESSIBILITY_PHASE_5_1.md) - WCAG AA compliance
- [EVENT_CLEANUP_FIX.md](./EVENT_CLEANUP_FIX.md) - Memory leak fixes

### Lighthouse Reports
Performance benchmarks in [`/reports/lighthouse/`](./reports/lighthouse/).

---

## 📝 Documentation Standards

### When Adding New Documentation:

1. **Choose the right directory**:
   - API/architecture changes → `/technical`
   - UI/UX specifications → `/design`
   - Feature implementations → `/plans`
   - User instructions → `/guides`
   - Development logs → `/sessions`

2. **Use clear naming conventions**:
   - Dated docs: `YYYY-MM-DD-descriptive-name.md`
   - Permanent docs: `DESCRIPTIVE_NAME.md` (all caps)

3. **Include proper frontmatter**:
   ```markdown
   # Document Title

   > Brief one-line description

   **Status**: Draft | In Progress | Complete | Superseded
   **Last Updated**: YYYY-MM-DD
   **Version**: X.Y
   ```

4. **Cross-reference related docs**: Always link to related documentation

5. **Keep it current**: Update docs when code changes, mark outdated docs as "Superseded"

---

## 🔍 Quick Reference Guide

| Need to find... | Check here... |
|----------------|---------------|
| **API endpoints** | `/technical/APP_CATALOG.md` |
| **File structure** | `/technical/CODEBASE_INVENTORY.md` |
| **Architecture overview** | `/technical/PROJECT_STRUCTURE.md` or `../CLAUDE.md` |
| **Design tokens (colors, fonts)** | `/design/VISUAL_DESIGN_SYSTEM.md` or `src/css/shared-base.css` |
| **Component patterns** | `/design/COMPONENT_SPECS.md` |
| **Setup instructions** | `/guides/AUTHENTICATION_SETUP.md` |
| **Deployment guide** | `/guides/DEPLOYMENT.md` (if exists) or `../README.md` |
| **Current roadmap** | `../ROADMAP.md` |
| **Recent changes** | `/reports/PHASE-*.md` or `/sessions/` |
| **Bug fixes** | `/reports/CRIT-*.md` or `/sessions/` |

---

## 🏗️ Architecture Quick Links

### Frontend Architecture
- **Main Dashboard**: `src/pages/index.html` (Muuri drag-drop, dual themes, AI chat)
- **ES6 Modules**: `src/js/modules/` (11 modules, see below)
- **Shared Styles**: `src/css/shared-base.css` (CSS variables, theme system)

### Backend Architecture
- **Primary API**: Cloudflare Workers (`workers/src/`)
- **Database**: Cloudflare D1 (SQLite on edge) - 15 tables
- **Legacy Backend**: Google Apps Script (production data entry only)
- **Schema**: `workers/schema.sql`

### Key Modules (ES6)
1. **config.js** - KPI/widget definitions, API URLs
2. **state.js** - Centralized state manager (replaces 30+ globals)
3. **api.js** - Data fetching with AbortController
4. **grid.js** - Muuri drag-drop grids
5. **charts.js** - Chart.js initialization
6. **theme.js** - Dark/light mode switching
7. **panels.js** - Settings/AI chat panels
8. **widgets.js** - KPI/widget rendering
9. **navigation.js** - View switching, sidebar
10. **utils.js** - Safe helpers, formatters
11. **index.js** - Main entry point

---

## 🧪 Testing Documentation

### Test Suites
- **Playwright E2E**: `tests/` directory
- **Visual Regression**: Screenshots in `tests/`
- **Accessibility**: WCAG AA compliance tests
- **Performance**: Lighthouse reports (see `docs/reports/lighthouse/`)

### Test Reports
- See `/sessions/` for detailed test results
- See `reports/TESTING_REPORT.md` for latest test summary

---

## 🎨 Design System Overview

### Brand Colors
```css
--ro-green: #668971;    /* Primary brand color */
--ro-gold: #e4aa4f;     /* Accent/highlight */
--danger: #c45c4a;      /* Errors/warnings */
```

### Typography System
```css
--font-display: 'DM Serif Display', serif;    /* Headings, titles */
--font-mono: 'JetBrains Mono', monospace;     /* Numbers, data */
--font-ui: 'Outfit', sans-serif;              /* Body, labels */
```

### Theme System
- **Light Theme**: Clean professional cream (#faf8f5)
- **Dark Theme**: Organic industrial with hemp leaf pattern
- Toggle via header button, persists in localStorage
- Charts auto-update colors on theme change

For complete design tokens, see `/design/VISUAL_DESIGN_SYSTEM.md` or `src/css/shared-base.css`

---

## 🚀 Development Workflow

### Making Changes
1. **Edit HTML/CSS/JS** directly in `src/` (no build process)
2. **Test locally** - Open HTML files in browser or run local server
3. **Commit and push** to `main` branch
4. **Auto-deploy** - GitHub Pages deploys in 1-2 minutes

### Backend Changes
1. **Edit Workers code** in `workers/src/`
2. **Test locally**: `npx wrangler dev`
3. **Deploy**: `npx wrangler deploy`
4. **Verify**: Check API endpoints

### Documentation Updates
- Update relevant `.md` files when making changes
- Keep `CLAUDE.md` current with architecture changes
- Update `ROADMAP.md` when completing phases
- Create session notes in `/sessions/` for significant work

---

## 📚 Additional Resources

### External Dependencies
- **Muuri.js** - Drag-and-drop grid library
- **Chart.js** - Data visualization
- **Phosphor Icons** - UI icon system
- **Google Fonts** - DM Serif Display, JetBrains Mono, Outfit

### External Services
- **Cloudflare Workers** - Serverless API
- **Cloudflare D1** - Edge SQLite database
- **Anthropic Claude** - AI chat functionality
- **Shopify** - Inventory webhooks
- **TEC-IT** - Barcode generation

---

## ✅ Documentation Checklist

When completing a feature or phase:
- [ ] Update relevant `/technical` docs
- [ ] Update `CLAUDE.md` with new patterns
- [ ] Add session notes to `/sessions/`
- [ ] Update `ROADMAP.md` status
- [ ] Update main `README.md` if needed
- [ ] Cross-reference related docs
- [ ] Mark outdated docs as "Superseded"

---

## 📞 Need Help?

- **Technical questions**: See `CLAUDE.md` for architecture context
- **API questions**: See `/technical/APP_CATALOG.md`
- **Design questions**: See `/design/` directory
- **Setup issues**: See `/guides/` directory

---

**Maintained by**: Rogue Origin Development Team
**License**: Proprietary - Internal use only
