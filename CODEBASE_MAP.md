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

### Backend Handlers
| Feature | D1 Handler | Sheets Handler | Status |
|---------|------------|----------------|--------|
| Production | `workers/src/handlers/production-d1.js` | `workers/src/handlers/production.js` | Sheets |
| Orders | `workers/src/handlers/orders-d1.js` | `workers/src/handlers/orders.js` | D1 |
| Barcode | `workers/src/handlers/barcode-d1.js` | `workers/src/handlers/barcode.js` | D1 |
| Kanban | `workers/src/handlers/kanban-d1.js` | `workers/src/handlers/kanban.js` | D1 |
| SOP | `workers/src/handlers/sop-d1.js` | `workers/src/handlers/sop.js` | D1 |

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
| `memory.js` | Memory leak tracking |

---

## Scoreboard Modules (`src/js/scoreboard/`)

| Module | Purpose |
|--------|---------|
| `main.js` | Entry point, initialization |
| `api.js` | Data fetching, smart polling, version checks |
| `config.js` | Scoreboard-specific config |
| `state.js` | Scoreboard state |
| `timer.js` | Bag cycle timer, break subtraction |
| `cycle-history.js` | 5 visualization modes for cycles |
| `shift-start.js` | One-click shift start |
| `render.js` | UI rendering |
| `dom.js` | DOM selectors |
| `i18n.js` | EN/ES translations |

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

## Workers Lib (`workers/src/lib/`)

| File | Purpose |
|------|---------|
| `db.js` | D1 query helpers (SELECT, INSERT, UPDATE) |
| `sheets.js` | Google Sheets REST API client |
| `auth.js` | JWT authentication |
| `cors.js` | CORS headers |
| `errors.js` | Custom ApiError class |
| `response.js` | JSON response wrapper |
| `validate.js` | Input validation |

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
| Feature flags | `workers/src/index.js` (top) |
| Service worker version | `sw.js` (line 1) |

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
| Break times | `src/js/modules/config.js` + `workers/src/handlers/production.js` |
| Order workflow | `src/js/orders/features/orders.js` |
| AI chat UI | `src/js/modules/panels.js` |
| AI chat backend | `apps-script/production-tracking/Code.gs` (handleChatRequest) |
| D1 database table | `workers/schema.sql` |
| CORS settings | `workers/src/lib/cors.js` |

### "I need to add..."

| Task | File(s) |
|------|---------|
| New API action | `workers/src/handlers/[feature].js` |
| New D1 table | `workers/schema.sql` → `wrangler d1 execute` |
| New dashboard KPI | `src/js/modules/config.js` (KPI_DEFINITIONS) |
| New widget | `src/js/modules/config.js` + `widgets.js` |
| New scoreboard section | `src/js/scoreboard/render.js` |
| New order feature | `src/js/orders/features/` (new file) |

### "I need to debug..."

| Issue | Start Here |
|-------|------------|
| Dashboard not loading | `src/js/modules/index.js` → `api.js` |
| Scoreboard stuck | `src/js/scoreboard/main.js` → `api.js` |
| API 500 error | `workers/src/handlers/[feature].js` |
| D1 query failing | `workers/src/lib/db.js` |
| Timer wrong | `src/js/scoreboard/timer.js` |
| Memory leaks | `src/js/modules/memory.js` + `state.js` |
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
'31397aa4-aa8c-47c4-965d-d51d36be8b13'

// Sheet IDs
Production: '1dARXrKU2u4KJY08ylA3GUKrT0zwmxCmtVh7IJxnn7is'
Orders:     '1QLQaR4RMniUmwbJFrtMVaydyVMyCCxqHXWDCVs5dejw'
Barcode:    '1JQRU1-kW5hLcAdNhRvOvvj91fhezBE_-StN5Ni6zE'
```

---

## Directory Structure (Simplified)

```
├── src/
│   ├── pages/          HTML apps (8 files)
│   ├── js/
│   │   ├── modules/    Dashboard ES6 (13 files)
│   │   ├── scoreboard/ Scoreboard (10 files)
│   │   ├── orders/     Orders system (12 files)
│   │   └── shared/     api-cache.js
│   └── css/            Per-page styles (11 files)
│
├── workers/
│   ├── src/
│   │   ├── index.js    Router + feature flags
│   │   ├── handlers/   API handlers (10 files)
│   │   └── lib/        Utilities (7 files)
│   ├── schema.sql      D1 tables
│   └── wrangler.toml   Cloudflare config
│
├── apps-script/        Google Apps Script backends (3 dirs)
├── docs/               Documentation (40+ files)
├── tests/              Playwright tests
└── sw.js               Service worker
```

---

## When to Grep/Glob

Use this reference first. Only grep/glob for:
- Specific string literals (error messages, magic numbers)
- Finding all usages of a function
- Searching for patterns across files

For "where is X?", check this file first.
