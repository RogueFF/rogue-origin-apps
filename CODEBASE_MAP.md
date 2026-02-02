# Codebase Quick Reference

> Use this to find files without grep/glob. Organized by task.

## File Locations by Purpose

### Frontend Entry Points
| App | HTML | JS Entry | CSS |
|-----|------|----------|-----|
| Dashboard | `src/pages/index.html` | `src/js/modules/index.js` | `src/css/dashboard.css` |
| Scoreboard | `src/pages/scoreboard.html` | `src/js/scoreboard/main.js` | `src/css/scoreboard.css` |
| Orders | `src/pages/orders.html` | `src/js/orders/index.js` | `src/css/orders.css` |
| SOP Manager | `src/pages/sop-manager.html` | inline | `src/css/sop-manager.css` |
| Kanban | `src/pages/kanban.html` | inline | `src/css/kanban.css` |
| Barcode | `src/pages/barcode.html` | inline | `src/css/barcode.css` |
| Hourly Entry | `src/pages/hourly-entry.html` | `src/js/hourly-entry/index.js` | `src/css/hourly-entry.css` |
| Ops Hub | `src/pages/ops-hub.html` | inline | `src/css/ops-hub.css` |

### Backend Handlers
| Feature | D1 Handler | Sheets Handler | Active Backend |
|---------|------------|----------------|----------------|
| Production | `workers/src/handlers/production-d1.js` | `workers/src/handlers/production.js` | D1 |
| Orders | `workers/src/handlers/orders-d1.js` | `workers/src/handlers/orders.js` | D1 |
| Barcode | `workers/src/handlers/barcode-d1.js` | `workers/src/handlers/barcode.js` | D1 |
| Kanban | `workers/src/handlers/kanban-d1.js` | `workers/src/handlers/kanban.js` | D1 |
| SOP | `workers/src/handlers/sop-d1.js` | `workers/src/handlers/sop.js` | D1 |
| Pool Proxy | `workers/src/handlers/pool.js` | — | Direct |

### Apps Script Backends
| Backend | File | Lines |
|---------|------|-------|
| Production Tracking | `apps-script/production-tracking/Code.gs` | ~1900 |
| Wholesale Orders | `apps-script/wholesale-orders/Code.gs` | ~1200 |
| Barcode Manager | `apps-script/barcode-manager/Code.gs` | ~500 |

---

## Dashboard Modules (`src/js/modules/`)

| Module | Purpose |
|--------|---------|
| `config.js` | API URL, KPI definitions, widget config, work schedule, colors |
| `state.js` | Centralized state, interval registry, cleanup |
| `api.js` | Data fetching, AbortController, version polling |
| `utils.js` | Formatters, date helpers, safe accessors |
| `theme.js` | Dark/light mode, Chart.js theme switching |
| `navigation.js` | View switching, sidebar |
| `settings.js` | localStorage persistence |
| `grid.js` | Muuri drag-drop grids |
| `charts.js` | Chart.js initialization |
| `panels.js` | Settings & AI chat panels |
| `widgets.js` | KPI & widget rendering |
| `date.js` | Date range selection |
| `memory.js` | AI chat conversation memory |
| `voice.js` | Voice input/output for AI chat |
| `status.js` | Connection status bar |
| `event-cleanup.js` | Event listener tracking & cleanup |
| `install-prompt.js` | PWA install prompt |
| `lazy-loader.js` | Lazy loading for Chart.js / Muuri |

---

## Scoreboard Modules (`src/js/scoreboard/`)

| Module | Purpose |
|--------|---------|
| `main.js` | Entry point, initialization, intervals |
| `api.js` | Data fetching, smart polling, version checks |
| `config.js` | Scoreboard-specific config |
| `state.js` | Scoreboard state management |
| `timer.js` | Bag cycle timer, break subtraction, pause |
| `render.js` | Main UI rendering, order queue display |
| `cycle-history.js` | 5 visualization modes for cycle data |
| `shift-start.js` | One-click shift start adjustment |
| `chart.js` | Hourly rate chart rendering |
| `dom.js` | DOM element cache/selectors |
| `i18n.js` | EN/ES translations |
| `events.js` | Event listener attachment |
| `scale.js` | Live scale weight polling |
| `morning-report.js` | Morning report display |
| `debug.js` | Debug panel for testing |

---

## Orders Modules (`src/js/orders/`)

```
orders/
├── core/           api.js, config.js, state.js
├── features/       auth.js, customers.js, orders.js, shipments.js, payments.js
├── ui/             modals.js, table.js, stats.js, toast.js
├── utils/          format.js, validate.js
└── index.js        Entry point
```

---

## Shared Modules (`src/js/shared/`)

| File | Purpose |
|------|---------|
| `api-cache.js` | In-memory API response cache with TTL |
| `sanitize.js` | HTML sanitization utilities |

---

## Workers Lib (`workers/src/lib/`)

| File | Purpose |
|------|---------|
| `db.js` | D1 query helpers (SELECT, INSERT, UPDATE) with table/column validation |
| `sheets.js` | Google Sheets REST API client |
| `auth.js` | Password authentication with constant-time comparison |
| `cors.js` | CORS headers |
| `errors.js` | Custom ApiError class, error codes |
| `response.js` | JSON response wrapper, body parsing, action extraction |
| `validate.js` | Input validation (dates, strings, numbers, enums, sheets sanitization) |

---

## Config Locations

| Config | File |
|--------|------|
| API URL | `src/js/modules/config.js` |
| Brand colors | `src/js/modules/config.js` |
| Widget definitions | `src/js/modules/config.js` |
| Break schedule | `src/js/modules/config.js` |
| D1 binding | `workers/wrangler.toml` |
| D1 schema | `workers/schema.sql` |
| D1 config schema | `workers/config-schema.sql` |
| Feature flags | `workers/src/index.js` (top) |
| Service worker version | `sw.js` (line 1) |
| Valid D1 tables | `workers/src/lib/db.js` (VALID_TABLES) |

---

## Find by Task

### "I need to change..."

| Task | File(s) |
|------|---------|
| API endpoint URL | `src/js/modules/config.js` |
| Dashboard widget | `src/js/modules/config.js` + `widgets.js` |
| Theme colors | `src/js/modules/theme.js` + `src/css/dashboard.css` |
| Scoreboard timer | `src/js/scoreboard/timer.js` |
| Cycle time display | `src/js/scoreboard/cycle-history.js` |
| Break times | `src/js/modules/config.js` + `workers/src/handlers/production-d1.js` |
| Order workflow | `src/js/orders/features/orders.js` |
| AI chat UI | `src/js/modules/panels.js` |
| AI chat backend | `workers/src/handlers/production-d1.js` (chat function) |
| D1 database table | `workers/schema.sql` |
| CORS settings | `workers/src/lib/cors.js` |
| Labor cost rates | `workers/src/handlers/production-d1.js` (or D1 system_config table) |

### "I need to add..."

| Task | File(s) |
|------|---------|
| New API action | `workers/src/handlers/[feature]-d1.js` |
| New D1 table | `workers/schema.sql` → `wrangler d1 execute` → add to `workers/src/lib/db.js` VALID_TABLES |
| New dashboard KPI | `src/js/modules/config.js` (kpiDefinitions) |
| New widget | `src/js/modules/config.js` + `widgets.js` |
| New scoreboard section | `src/js/scoreboard/render.js` |
| New order feature | `src/js/orders/features/` (new file) |

### "I need to debug..."

| Issue | Start Here |
|-------|------------|
| Dashboard not loading | `src/js/modules/index.js` → `api.js` |
| Scoreboard stuck | `src/js/scoreboard/main.js` → `api.js` |
| API 500 error | `workers/src/handlers/[feature]-d1.js` |
| D1 query failing | `workers/src/lib/db.js` |
| Timer wrong | `src/js/scoreboard/timer.js` |
| Memory leaks | `src/js/modules/event-cleanup.js` + `state.js` |
| CORS error | `workers/src/lib/cors.js` |

---

## Key Constants

```javascript
// API Base
'https://rogue-origin-api.roguefamilyfarms.workers.dev/api'

// Colors
'#668971'  // ro-green (primary)
'#4a6b54'  // ro-green-dark
'#e4aa4f'  // gold (accent)
'#c45c4a'  // danger

// D1 Database ID
'REDACTED-D1-OPS-ID'

// Sheet IDs
Production: 'REDACTED-PRODUCTION-SHEET-ID'
Orders:     'REDACTED-ORDERS-SHEET-ID'
Barcode:    'REDACTED-BARCODE-SHEET-ID'
```

---

## Directory Structure (Simplified)

```
├── src/
│   ├── pages/          HTML apps (11 files)
│   ├── js/
│   │   ├── modules/    Dashboard ES6 (19 files)
│   │   ├── scoreboard/ Scoreboard IIFE (16 files)
│   │   ├── orders/     Orders system (12 files)
│   │   ├── hourly-entry/ Hourly data entry
│   │   └── shared/     api-cache.js, sanitize.js
│   └── css/            Per-page styles (12 files)
│
├── workers/
│   ├── src/
│   │   ├── index.js    Router + feature flags
│   │   ├── handlers/   API handlers (11 files: 5 D1 + 5 Sheets + pool)
│   │   └── lib/        Utilities (7 files)
│   ├── schema.sql      D1 tables
│   ├── config-schema.sql  System config table
│   └── wrangler.toml   Cloudflare config
│
├── api/                Vercel Functions (legacy backup)
├── apps-script/        Google Apps Script backends (3 dirs)
├── docs/               Documentation
│   ├── design/         Visual design system specs
│   ├── guides/         How-to guides
│   ├── plans/          Implementation plans
│   ├── reports/        Audit & test reports, lighthouse/
│   ├── sessions/       Session summaries
│   └── technical/      Technical architecture docs
├── tests/              Playwright tests + screenshots
├── archive/            Legacy files (kanban, designs, old backups)
├── scripts/            Import/migration scripts
├── assets/             PWA icons
├── scale-reader/       USB scale reader app
├── scale-reader-deployment/  Scale reader deployment package
└── sw.js               Service worker
```

---

## When to Grep/Glob

Use this reference first. Only grep/glob for:
- Specific string literals (error messages, magic numbers)
- Finding all usages of a function
- Searching for patterns across files

For "where is X?", check this file first.
