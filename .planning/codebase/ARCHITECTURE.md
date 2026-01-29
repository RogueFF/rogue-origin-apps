# Architecture

**Analysis Date:** 2026-01-29

## Pattern Overview

**Overall:** Decoupled multi-app hub pattern with layered architecture (presentation → state → data access → external services)

**Key Characteristics:**
- Static HTML/ES6 modular frontend (no build system, pure modules)
- Cloudflare Workers + D1 backend (edge-first design)
- Feature-driven handler pattern (production, orders, barcode, kanban, SOP)
- Dual data source support: D1 (primary) + Google Sheets (legacy)
- Iframe-based app composition (each app is independent HTML + modules)
- Centralized state management (single source of truth per app)

## Layers

**Presentation Layer:**
- Purpose: User interface, event handling, rendering
- Location: `src/pages/` (HTML entry points) + `src/js/modules/`, `src/js/scoreboard/`, `src/js/orders/`
- Contains: HTML, CSS, DOM manipulation, user input handling
- Depends on: State layer (for data), API layer (for fetching)
- Used by: Users, browsers, desktop/mobile clients

**State Management Layer:**
- Purpose: Centralized application state, lifecycle management, cleanup
- Location: `src/js/modules/state.js`, `src/js/scoreboard/state.js`, `src/js/orders/core/state.js`
- Contains: State objects, getters/setters, memory management (interval registry, event cleanup)
- Depends on: Configuration layer
- Used by: Presentation layer, event handlers, lifecycle hooks

**API/Data Access Layer:**
- Purpose: Communication with backend, data fetching, request management
- Location: `src/js/modules/api.js`, `src/js/scoreboard/api.js`, `src/js/orders/core/api.js`
- Contains: fetch() wrappers, AbortController, retry logic, version polling
- Depends on: Configuration layer (API URL), utilities
- Used by: Presentation layer, smart data loading

**Backend Router Layer:**
- Purpose: HTTP routing, middleware, feature flag switching
- Location: `workers/src/index.js`
- Contains: Route matching (path → handler), CORS handling, error wrapping
- Depends on: Handler layer, middleware utilities
- Used by: Frontend API layer, external integrations

**Handler Layer:**
- Purpose: Business logic per feature (production, orders, barcode, kanban, SOP)
- Location: `workers/src/handlers/[feature]-d1.js` (primary), `workers/src/handlers/[feature].js` (legacy Sheets)
- Contains: Data validation, transformation, queries
- Depends on: Database/Sheets abstraction layer, validation utilities
- Used by: Router layer, external services

**Database Abstraction Layer:**
- Purpose: Unified interface for D1 queries and Google Sheets API
- Location: `workers/src/lib/db.js` (D1), `workers/src/lib/sheets.js` (Sheets), `workers/src/lib/auth.js`, `workers/src/lib/cors.js`, `workers/src/lib/response.js`, `workers/src/lib/errors.js`, `workers/src/lib/validate.js`
- Contains: CRUD helpers, transaction support, response formatting
- Depends on: External APIs (D1, Sheets)
- Used by: Handler layer

**Configuration Layer:**
- Purpose: Static configuration, constants, definitions
- Location: `src/js/modules/config.js`, `src/js/scoreboard/config.js`, `src/js/orders/core/config.js`, `src/css/shared-base.css`
- Contains: API URLs, KPI definitions, widget config, brand colors, work schedules
- Depends on: Nothing
- Used by: All other layers

## Data Flow

**Production Dashboard Data Flow:**

1. User loads `src/pages/index.html`
2. `src/js/modules/index.js` initializes modules in order:
   - config (loads constants)
   - state (creates state object)
   - api (sets up fetch wrapper)
   - utilities (loads formatters)
   - theme (applies dark/light mode)
   - navigation (sets up view switching)
   - charts (initializes Chart.js)
   - widgets (renders KPI cards)
   - panels (sets up settings/AI chat)
   - grid (initializes Muuri drag-drop)
3. `api.js` calls `loadProductionData()`:
   - Cancels previous fetch (AbortController)
   - Calls `fetch(API_URL + '?action=getScoreboardData')`
   - Hits `workers/src/index.js` router (path: `/api/production`)
   - Routes to `workers/src/handlers/production-d1.js` (via feature flag `USE_D1_PRODUCTION`)
   - Handler queries D1 or Sheets based on config
   - Returns `{ success: true, data: { ... } }`
   - API layer unwraps response: `raw.data || raw`
   - State updated via `setData()`
   - Presentation layer re-renders via `updateDashboard()`
4. Charts update, widgets refresh, timers start

**State Management Flow:**

1. Single state object in `state.js` holds all app state
2. Getters (e.g., `getData()`, `getCurrentView()`) retrieve current values
3. Setters (e.g., `setData()`, `setCurrentView()`) update state
4. Cleanup functions registered: `registerEventListener()`, `setInterval_()`, `setChart()`, `destroyChart()`
5. On unload, `cleanup()` called:
   - Clears all intervals
   - Clears all event listeners
   - Destroys all Chart.js instances
   - Destroys all Muuri grid instances
   - Cancels fetch requests

**Event Flow:**

1. HTML element with onclick handler (e.g., `onclick="switchView('dashboard')"`)
2. Handler calls module function (e.g., `switchView()`)
3. Function updates state (e.g., `setCurrentView('dashboard')`)
4. Function calls re-render (e.g., `updateDashboard()`)
5. Event listener registered via `registerEventListener()` for cleanup
6. On page unload: `beforeunload` → `cleanup()` → removes listener

## Key Abstractions

**API Wrapper:**
- Purpose: Unified fetch interface with retry, version polling, AbortController
- Examples: `src/js/modules/api.js`, `src/js/scoreboard/api.js`
- Pattern: `apiCall(action, data?, abort?) → Promise<response>`

**State Container:**
- Purpose: Single source of truth per app, centralized getters/setters
- Examples: `src/js/modules/state.js`, `src/js/orders/core/state.js`
- Pattern: Object with functions like `getState()`, `getData()`, `setData()`, `cleanup()`

**Handler Pattern:**
- Purpose: Feature-specific business logic, data transformation
- Examples: `workers/src/handlers/production-d1.js`, `workers/src/handlers/orders-d1.js`
- Pattern: Export `async function handle[Feature]D1(request, env, ctx)` → validates query params → runs logic → returns JSON response

**Module System:**
- Purpose: Code organization, import/export dependencies, lazy loading
- Examples: 19 modules in `src/js/modules/`, 8 modules in `src/js/scoreboard/`
- Pattern: ES6 modules, named exports, functions instantiated on import

**Configuration Injection:**
- Purpose: Externalize constants for reuse across modules
- Examples: `config.js` in each app
- Pattern: Centralized constants (API_URL, colors, widget definitions), imported by all modules

## Entry Points

**Dashboard (Ops Hub):**
- Location: `src/pages/index.html`
- Triggers: Direct URL access, menu click
- Responsibilities: Load 19 ES6 modules, initialize state, fetch data, render Muuri grid, set up timers/intervals, handle view switching

**Scoreboard (Floor TV):**
- Location: `src/pages/scoreboard.html`
- Triggers: Direct URL access or embedded in dashboard
- Responsibilities: Load scoreboard modules, initialize timer with break adjustment, fetch live production data every 2 sec, display metrics

**Orders (Wholesale Management):**
- Location: `src/pages/orders.html`
- Triggers: Direct URL access or embedded in dashboard
- Responsibilities: Load orders modules (core + features + UI), initialize auth, load customers/orders from D1, manage CRUD operations

**Barcode (Label Printing):**
- Location: `src/pages/barcode.html`
- Triggers: Direct URL access or embedded in dashboard
- Responsibilities: Inline logic, fetch SKU data from D1, generate barcodes, print labels

**SOP Manager (Procedures):**
- Location: `src/pages/sop-manager.html`
- Triggers: Direct URL access or embedded in dashboard
- Responsibilities: Inline logic, fetch SOP records from D1, search/filter, bilingual display

**Kanban (Supply Tracking):**
- Location: `src/pages/kanban.html`
- Triggers: Direct URL access or embedded in dashboard
- Responsibilities: Inline logic, fetch kanban cards from D1, drag-drop reordering, photo attachments

**Hourly Entry (Manual Data Entry):**
- Location: `src/pages/hourly-entry.html`
- Triggers: Direct URL access
- Responsibilities: Load hourly-entry modules, form validation, POST production data to D1/Sheets, UI feedback

**Backend API Router:**
- Location: `workers/src/index.js`
- Triggers: Any fetch request to `/api/*`
- Responsibilities: Route request to handler, handle CORS, wrap responses, error handling

## Error Handling

**Strategy:** Layered error handling with graceful degradation

**Patterns:**

**Frontend Error Handling:**
- Try-catch in API layer (`api.js`): catches fetch errors, network errors
- Fallback mode: if API fails, display last cached data (stored in state.fallback)
- Error toasts: `showError()` displays user-friendly messages
- Silent failures: non-critical data (e.g., widget) fails without blocking dashboard
- Retry logic: `api.js` implements exponential backoff for transient errors

**Backend Error Handling:**
- Custom `ApiError` class in `workers/src/lib/errors.js`: wraps errors with code + status
- Handler validation: each handler validates input (action, params) before processing
- Database error wrapping: `query()` in `db.js` throws on SQL errors, handler catches and returns `{ success: false, error: "message" }`
- Response wrapper: all responses wrapped in `{ success: bool, data/error: value }` format
- CORS error handling: preflight OPTIONS request returns 200 with CORS headers

**Example Error Path:**
```
User action → API layer fetch() → handler processes → SQL error
→ catch in handler → ApiError created → errorResponse() wraps it
→ sent to client → client sees { success: false, error: "..." }
→ showError() displays toast → state.connection.error set
```

## Cross-Cutting Concerns

**Logging:** Console-based (no centralized logging)
- Frontend: `console.log()` in modules, only in development
- Backend: `console.error()` in handlers, shown in Cloudflare logs
- Pattern: No structured logging, minimal noise

**Validation:** Input validation at boundaries
- Frontend: Form validation before POST (HTML5 + custom checks)
- Backend: Each handler validates action + params in `workers/src/lib/validate.js`
- Pattern: Centralized `validateAction()`, `validateDate()` functions

**Authentication:** JWT + Google Sheets API key
- Frontend: Checked at app startup (Orders app: `checkAuth()`)
- Backend: JWT verified in `workers/src/lib/auth.js` for protected routes
- Pattern: Optional authentication (most endpoints public for production dashboard)

**CORS:** Cloudflare Workers middleware
- Configured in `workers/src/lib/cors.js`
- Handles preflight OPTIONS requests
- Allows requests from `https://rogueff.github.io` + `http://localhost`
- Pattern: Centralized `corsHeaders()` function, headers added to all responses

**Theme Management:** CSS variables + localStorage
- Light/dark toggle: `toggleTheme()` in theme.js
- Persistence: stored in localStorage under key `ro_theme`
- CSS variables: all colors in `src/css/shared-base.css` (--ro-green, --ro-gold, etc.)
- Chart.js themes: switched dynamically in `charts.js` when theme changes
- Pattern: Single source of truth in CSS variables, synced to Chart.js

**Memory Leak Prevention:** Cleanup registry
- All event listeners registered via `registerEventListener()` → tracked in array → cleared on unload
- All setInterval() calls wrapped: `setInterval_()` → stored in state.intervals → cleared via `clearAllIntervals()`
- All Chart.js instances tracked: `setChart()` → stored in state.charts → destroyed via `destroyAllCharts()`
- Pattern: Central `cleanup()` function called on `beforeunload` event
- File: `src/js/modules/event-cleanup.js` manages listener registry

**Bilingual Support:** i18n object + data-i18n attributes
- Frontend: Translations in `labels` object (English + Spanish keys)
- Backend: Translations stored in D1 as separate columns (`title_es`, `desc_es`)
- Pattern: `t(key)` function returns translated string based on `lang` variable
- Scope: Production app (not all apps yet; Orders/Scoreboard have basic i18n)

---

*Architecture analysis: 2026-01-29*
