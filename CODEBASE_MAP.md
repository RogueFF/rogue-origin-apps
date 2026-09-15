# Codebase Quick Reference

> Use this to find files without grep/glob. Organized by task.

## File Locations by Purpose

### Frontend pages (GitHub Pages)
| App | HTML | JS | CSS |
|-----|------|----|-----|
| Ops Hub | `src/pages/index.html` | `src/js/hub/main.js` | `src/css/hub.css` |
| Floor Manager | `src/pages/hourly-entry.html` | `src/js/hourly-entry/index.js` | `src/css/hourly-entry.css` |
| Scoreboard | `src/pages/scoreboard-v2.html` | `src/js/scoreboard-v2/main.js` | `src/css/scoreboard-v2.css` |
| Scoreboard v3 (pace layer) | `src/pages/scoreboard-v3.html` | v2 modules + `src/js/scoreboard-v3/pace.js` | `src/css/scoreboard-v3.css` |
| Scale Display | `src/pages/scale-display.html` | `src/js/scale-display/main.js` + v2 modules | `src/css/scale-display.css` |
| Wholesale | `src/pages/wholesale.html` | `src/js/wholesale/index.js` | `src/css/wholesale.css` |
| Consignment | `src/pages/consignment.html` | `src/js/consignment/main.js` | `src/css/consignment.css` |
| Supply Kanban | `src/pages/kanban.html` | inline | `src/css/kanban.css` |
| Tag Desk (beta) | `src/pages/tag-desk.html` | `src/js/tag-desk/main.js` | `src/css/tag-desk.css` |
| SOP Manager | `src/pages/sop-manager.html` | inline | `src/css/sop-manager.css` |
| Complaints | `src/pages/complaints.html` | inline | `src/css/complaints.css` |
| Supersack Tracker | `src/pages/supersack-entry.html` | inline | inline |
| Supersack Analytics | `src/pages/supersack-analytics.html` | inline | inline |

Every page loads `src/css/shared-base.css` first except the Floor Manager and the
two Supersack pages, which still define their own styles.

### Pages served by the Worker
| Page | File |
|------|------|
| Harvest scan routes (`/s/`, `/b/`, `/z/`, `/c/`, `/fin`) | `workers/src/handlers/harvest-d1.js` |
| Harvest board | `workers/src/handlers/harvest-board-page.js` |
| Harvest dash | `workers/src/handlers/harvest-dash-page.js` |

### Backend handlers (`workers/src/handlers/`)
| Route | Handler |
|-------|---------|
| `/api/production` | `production-d1.js` → `production/` (scoreboard, hourly-entry, bag-tracking, shift, strain, scale, chat, inventory, config) |
| `/api/wholesale` | `wholesale-d1.js` |
| `/api/orders` | `orders-auth.js` (password check only; the unlock check for the Hub, Wholesale and Consignment) |
| `/api/kanban` | `kanban-d1.js` |
| `/api/sop` | `sop-d1.js` |
| `/api/consignment` | `consignment-d1.js` |
| `/api/complaints` | `complaints-d1.js` |
| `/api/supersack`, `/api/supersack-qa` | `supersack-d1.js`, `supersack-qa.js` |
| `/api/irrigation` | `irrigation-d1.js` |
| `/api/harvest` | `harvest-d1.js`, `harvest-board-d1.js`, `harvest-hourly-d1.js` |
| `/sms/inbound` | `harvest-hourly-d1.js` |
| `/api/pool` | `pool.js` (Shopify inventory proxy) |
| `/api/media` | `media-r2.js` (R2 uploads for SOP Manager) |

### Apps Script
| Backend | File |
|---------|------|
| Production Tracking (legacy sheet) | `apps-script/production-tracking/Code.gs` |
| Mail relay | `apps-script/mail-relay/Code.gs` |

---

## Ops Hub Modules (`src/js/hub/`)

| Module | Purpose |
|--------|---------|
| `main.js` | Entry: state, fetch orchestration, range chips, timers, theme, collapse |
| `api.js` | Every endpoint the hub calls; `settle()` never-reject fan-out |
| `range.js` | Date ranges in Pacific time, with the comparison period |
| `format.js` | Number/date/cultivar/note formatters, `niceScale` |
| `svg.js` | Hand-drawn column and line charts with hover tooltips |
| `ledger.js` | The Shift Ledger (one column per hour or day) |
| `sections.js` | Renderers for Right now, shift, pipe, watchlist, trend, cultivars, cost, daily table, CSV |
| `chat.js` | "Ask the line" drawer: chat, speech-to-text, spoken replies |
| `auth.js` | Shared-password unlock dialog (`ro_api_password`) |

---

## Scoreboard Modules (`src/js/scoreboard-v2/`)

| Module | Purpose |
|--------|---------|
| `main.js` | Entry point, initialization, intervals |
| `api.js` | Data fetching, smart polling, version checks |
| `config.js` | Scoreboard-specific config |
| `state.js` | Scoreboard state management |
| `timer.js` | Bag cycle timer, break subtraction, pause |
| `render.js` | Main UI rendering |
| `cycle-history.js` | Visualization modes for cycle data |
| `shift-start.js` | One-click shift start adjustment |
| `chart.js` | Hourly rate chart rendering |
| `dom.js` | DOM element cache/selectors |
| `i18n-labels.js` | EN/ES labels, registered with `shared/i18n.js` |
| `events.js` | Event listener attachment |
| `fab-menu.js` | Floating action menu |
| `scale.js` | Live scale weight polling |
| `morning-report.js` | Morning report display |
| `debug.js` | Debug panel for testing |

`src/js/scoreboard-v3/` adds `pace.js` and `pace-math.js` on top of these.

---

## Other App Modules

| Folder | Files |
|--------|-------|
| `src/js/wholesale/` | `index.js`, `state.js`, `queue.js`, `editor.js`, `render.js`, `auth.js` |
| `src/js/consignment/` | `main.js`, `api.js`, `ui.js` |
| `src/js/tag-desk/` | `main.js`, `api.js`, `model.js`, `store.js`, `render.js`, `labels.js` |
| `src/js/scale-display/` | `main.js`, `layout.js` |

---

## Shared Modules (`src/js/shared/`)

| File | Purpose |
|------|---------|
| `api.js` | `API_ROOT` and the request helper (URL, content type, auth, unwrapping) |
| `i18n.js` | Language on `ro-lang`; walks `[data-i18n]` |
| `theme.js` | Theme on `ro-theme`; migrates legacy keys |
| `toast.js` | Self-contained toast notifications |
| `sanitize.js` | HTML escaping |

---

## Workers Lib (`workers/src/lib/`), most used

| File | Purpose |
|------|---------|
| `db.js` | D1 query helpers with table/column validation (`VALID_TABLES`) |
| `auth.js` | Password authentication with constant-time comparison |
| `cors.js` | CORS headers |
| `errors.js` | ApiError class and error codes |
| `response.js` | JSON responses, body parsing, action extraction |
| `validate.js` | Input validation |
| `pacific.js` | Pacific-time day boundaries |
| `sheets.js` | Google Sheets REST client |

---

## Config Locations

| Config | File |
|--------|------|
| API URL | `src/js/shared/api.js` (`API_ROOT`) |
| Brand colors | `src/css/shared-base.css`; chart series in `src/css/hub.css` |
| Break schedule | `workers/src/handlers/production/shift.js`, `bag-tracking.js` |
| D1 binding | `workers/wrangler.toml` |
| D1 schema | `workers/schema.sql`, `workers/config-schema.sql`, `workers/migrations/` |
| Service worker version | `sw.js` (`CACHE_VERSION`) |
| Valid D1 tables | `workers/src/lib/db.js` (`VALID_TABLES`) |
| Asset hashes | `tools/stamp-modules.mjs` (run by the pre-commit hook) |

---

## Find by Task

### "I need to change..."

| Task | File(s) |
|------|---------|
| API endpoint URL | `src/js/shared/api.js` |
| Hub section | `src/js/hub/sections.js` (+ `main.js` for its data) |
| Theme colors | `src/css/shared-base.css` + `src/css/hub.css` |
| Scoreboard timer | `src/js/scoreboard-v2/timer.js` |
| Cycle time display | `src/js/scoreboard-v2/cycle-history.js` |
| Break times | `workers/src/handlers/production/shift.js` |
| Wholesale order flow | `src/js/wholesale/` + `workers/src/handlers/wholesale-d1.js` |
| AI chat UI | `src/js/hub/chat.js` |
| AI chat backend | `workers/src/handlers/production/chat.js` |
| CORS settings | `workers/src/lib/cors.js` |

### "I need to add..."

| Task | File(s) |
|------|---------|
| New API action | `workers/src/handlers/[feature]-d1.js` |
| New D1 table | `workers/migrations/NNNN-name.sql` (applied by hand) → add to `VALID_TABLES` in `workers/src/lib/db.js` |
| New hub tile | `src/js/hub/sections.js` (`renderNow`) |
| New hub section | `src/pages/index.html` + `src/js/hub/sections.js` + `main.js` |
| New scoreboard section | `src/js/scoreboard-v2/render.js` |

### "I need to debug..."

| Issue | Start Here |
|-------|------------|
| Hub not loading | `src/js/hub/main.js` → `api.js`; check `npm run stamp:check` |
| Scoreboard stuck | `src/js/scoreboard-v2/main.js` → `api.js` |
| API 500 error | `workers/src/handlers/[feature]-d1.js` |
| D1 query failing | `workers/src/lib/db.js` |
| Timer wrong | `src/js/scoreboard-v2/timer.js` |
| Hub timers | `src/js/hub/main.js` (`initTimers`) |
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
Production: 'REDACTED-PRODUCTION-SHEET-ID'
```

---

## Directory Structure (Simplified)

```
├── src/
│   ├── pages/          HTML apps (13 pages)
│   ├── js/             One folder per app, plus shared/ and vendor/
│   └── css/            Per-page styles + shared-base.css
│
├── workers/
│   ├── src/
│   │   ├── index.js    Router and cron triggers
│   │   ├── handlers/   API handlers and Worker-served pages
│   │   └── lib/        Shared Worker utilities
│   ├── migrations/     D1 migrations, applied by hand
│   ├── schema.sql      D1 tables
│   └── wrangler.toml   Cloudflare config
│
├── apps-script/        Google Apps Script backends (production tracking, mail relay)
├── docs/               Documentation: design/, guides/, plans/, reports/, technical/
├── tests/              node:test unit tests and Playwright specs (see tests/README.md)
├── tools/              Repo tooling, including stamp-modules.mjs
├── scripts/            Import/migration scripts
├── assets/             PWA icons and README screenshots
├── scale-reader/       OHAUS Defender 5000 reader + install package
└── sw.js               Service worker
```

---

## When to Grep/Glob

Use this reference first. Only grep/glob for:
- Specific string literals (error messages, magic numbers)
- Finding all usages of a function
- Searching for patterns across files

For "where is X?", check this file first.
