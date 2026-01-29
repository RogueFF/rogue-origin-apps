# Technology Stack

**Analysis Date:** 2026-01-29

## Languages

**Primary:**
- JavaScript (ES6 modules) - Frontend dashboard, UI modules
- JavaScript (ES6+ with import/export) - Backend API (Cloudflare Workers)

**Secondary:**
- HTML5 - Page structure and semantic markup
- CSS3 - Styling with CSS custom properties (variables)
- SQL - Cloudflare D1 database queries

## Runtime

**Environment:**
- Browser (modern: Chrome 90+, Firefox 88+, Safari 14+)
- Cloudflare Workers - Serverless compute edge platform
- Node.js 18+ (for local development and build tooling)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present in root, `workers/`, and `tests/`

## Frameworks

**Frontend:**
- Pure HTML/CSS/JS (no build system, no transpilation)
- Muuri.js (v3.x) - Drag-drop grid layout for dashboard widgets
- Chart.js (v4.x) - Interactive production charts
- Phosphor Icons (web font) - Icon system for UI

**Backend:**
- Cloudflare Workers (edge compute runtime)
- Cloudflare D1 (SQLite database at edge)

**Testing:**
- Playwright (v1.49.0+) - E2E browser testing across Chromium, Firefox, WebKit, and mobile
- ESLint (v9.39.2) - Static code analysis and linting
- Vitest or Jest - Unit testing framework (config available but not primary focus)

**Build/Dev:**
- Wrangler (v4.59.2+) - Cloudflare Workers CLI for local dev (`wrangler dev`) and deployment
- Playwright Test Runner - E2E test execution with multiple browser targets
- No build bundler - Uses native ES6 modules directly

## Key Dependencies

**Critical (Frontend):**
- Muuri.js - Grid layout with drag-drop (loaded lazy on dashboard)
- Chart.js - Data visualization for production metrics
- Phosphor Icons (SVG inline) - Icon library

**Backend (Cloudflare Workers):**
- Wrangler - Development and deployment tooling only (not a runtime dependency)
- crypto (built-in) - RSA signing for Google Sheets JWT auth
- fetch API (built-in) - HTTP requests to Google Sheets, Anthropic, Google Cloud APIs

**Infrastructure:**
- No npm packages in Cloudflare Workers runtime (pure fetch-based API calls)
- Google Sheets API - REST-based, no SDK
- Anthropic API - REST-based, no SDK
- Google Cloud Text-to-Speech API - REST-based, no SDK

## Configuration

**Environment:**
- `workers/wrangler.toml` - Primary config for Cloudflare Workers, D1 database binding, CORS
- Environment variables stored as secrets via `wrangler secret put`:
  - `ANTHROPIC_API_KEY` - Claude API access
  - `GOOGLE_SERVICE_ACCOUNT_EMAIL` - Google auth
  - `GOOGLE_PRIVATE_KEY` - JWT signing key
  - `GOOGLE_TTS_API_KEY` - Google Cloud text-to-speech
  - `WEBHOOK_SECRET` - Shopify webhook verification
  - `POOL_INVENTORY_API_KEY` - Pool Inventory Service proxy key
  - `PRODUCTION_SHEET_ID` - Google Sheets IDs (separate for each app)
  - `ORDERS_SHEET_ID`
  - `BARCODE_SHEET_ID`
  - `KANBAN_SHEET_ID`
  - `SOP_SHEET_ID`
  - `ORDERS_PASSWORD` - Orders app authentication

**Build:**
- No build config files (webpack, vite, etc.)
- ESLint config: Configured in `package.json` scripts
- Prettier: No explicit config (not in dependencies)
- TypeScript: Not used

## Platform Requirements

**Development:**
- Node.js 18+ (for wrangler and test runner)
- Git (deployed via GitHub Pages on push to main)
- npm or pnpm
- Python 3 - Local HTTP server for frontend testing (`python -m http.server`)

**Production:**
- Cloudflare Workers free tier (100K requests/day)
- Cloudflare D1 database (embedded SQLite)
- GitHub Pages (static HTML/CSS/JS hosting)
- Google Cloud Project (for Sheets and TTS APIs)
- Anthropic API (Claude for AI features)

**Deployment:**
- GitHub Actions - Automatic deployment on push to main (GitHub Pages)
- Wrangler CLI - Manual deployment to Cloudflare Workers (`wrangler deploy`)

## Frameworks & Services Summary

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Frontend | Pure JS/HTML/CSS | ES6 | Dashboard, widgets, charts |
| Backend Compute | Cloudflare Workers | Latest | API router, business logic |
| Database | Cloudflare D1 (SQLite) | SQLite 3.x | Production, orders, kanban, SOP data |
| Legacy Data | Google Sheets | REST API v4 | Production entry (hourly manual entry) |
| Testing | Playwright | 1.49.0+ | E2E testing, multi-browser |
| Code Quality | ESLint | 9.39.2 | Linting and code standards |
| Grid Layout | Muuri.js | 3.x | Draggable widget grid |
| Charts | Chart.js | 4.x | Data visualization |
| Icons | Phosphor Icons | Web font | SVG icon library |
| AI | Anthropic Claude | Sonnet 4 | Production analysis, chat |
| Speech | Google Cloud TTS | REST API | Text-to-speech for announcements |

---

*Stack analysis: 2026-01-29*
