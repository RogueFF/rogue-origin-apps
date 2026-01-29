# Codebase Structure

**Analysis Date:** 2026-01-29

## Directory Layout

```
rogue-origin-apps-master/
├── src/
│   ├── pages/              # HTML entry points (11 apps)
│   │   ├── index.html      # Dashboard/Ops Hub (main entry, Muuri grid, AI chat)
│   │   ├── scoreboard.html # Floor TV display with live timer
│   │   ├── orders.html     # Wholesale order management (CRUD)
│   │   ├── kanban.html     # Supply chain tracking (drag-drop cards)
│   │   ├── barcode.html    # Label printing and SKU management
│   │   ├── sop-manager.html # Standard operating procedures (searchable, bilingual)
│   │   ├── order.html      # Customer order view (public, embedded)
│   │   ├── hourly-entry.html # Manual production data entry form
│   │   └── design-assets.html # Brand asset showcase (internal)
│   ├── js/
│   │   ├── modules/        # Dashboard ES6 modules (19 files, 300+ KB)
│   │   │   ├── index.js    # Main orchestrator - imports & initializes all modules
│   │   │   ├── config.js   # KPI definitions, widget config, API URL, colors
│   │   │   ├── state.js    # Centralized state mgmt, getters/setters, cleanup registry
│   │   │   ├── api.js      # Fetch wrapper, AbortController, retry logic, version polling
│   │   │   ├── utils.js    # Date formatters, safe accessors, type coercion
│   │   │   ├── theme.js    # Dark/light mode toggle, CSS variable switching
│   │   │   ├── navigation.js # View switching (dashboard/kanban/scoreboard), sidebar
│   │   │   ├── settings.js # localStorage persistence, settings dialog
│   │   │   ├── grid.js     # Muuri drag-drop grid initialization (KPI + widgets)
│   │   │   ├── charts.js   # Chart.js initialization (hourly, daily, rate, etc.)
│   │   │   ├── panels.js   # Settings & AI chat panel rendering/events
│   │   │   ├── widgets.js  # KPI card + widget rendering logic
│   │   │   ├── date.js     # Date range picker, custom date selection
│   │   │   ├── memory.js   # Memory leak tracking (unused)
│   │   │   ├── status.js   # Connection status indicator
│   │   │   ├── lazy-loader.js # On-demand script loading (Chart.js, Muuri, Phosphor)
│   │   │   ├── event-cleanup.js # Event listener registry & cleanup (memory leak prevention)
│   │   │   ├── install-prompt.js # PWA install prompt handling
│   │   │   └── voice.js    # Speech recognition + synthesis (experimental)
│   │   ├── scoreboard/     # Scoreboard modules (10 files, specialized timer logic)
│   │   │   ├── main.js     # Entry point, initialization, event setup
│   │   │   ├── api.js      # Smart polling (2 sec interval), version checks
│   │   │   ├── config.js   # Scoreboard-specific constants
│   │   │   ├── state.js    # Scoreboard state (cycle data, break times, crew)
│   │   │   ├── timer.js    # Bag cycle timer with break time subtraction logic
│   │   │   ├── cycle-history.js # 5 visualization modes for cycle times
│   │   │   ├── shift-start.js # One-click shift initialization
│   │   │   ├── render.js   # UI rendering, DOM updates, formatting
│   │   │   ├── dom.js      # DOM element selectors (cached)
│   │   │   └── i18n.js     # EN/ES translations for scoreboard
│   │   ├── orders/         # Orders app modules (organized by feature)
│   │   │   ├── index.js    # Entry point, module wiring, window exports
│   │   │   ├── core/       # Core functionality
│   │   │   │   ├── api.js  # API calls, error handling
│   │   │   │   ├── config.js # API URL, constants
│   │   │   │   └── state.js # Orders state management
│   │   │   ├── features/   # Business logic modules
│   │   │   │   ├── auth.js # Authentication, login/logout
│   │   │   │   ├── customers.js # Customer CRUD
│   │   │   │   ├── orders.js # Order CRUD
│   │   │   │   ├── shipments.js # Shipment management, line items
│   │   │   │   └── payments.js # Payment tracking, invoicing
│   │   │   ├── ui/         # UI components
│   │   │   │   ├── modals.js # Modal dialogs for CRUD
│   │   │   │   ├── table.js # Orders table rendering
│   │   │   │   ├── stats.js # Stats cards
│   │   │   │   └── toast.js # Notifications (success, error, warning)
│   │   │   └── utils/      # Utilities
│   │   │       ├── format.js # Number formatting, date formatting
│   │   │       └── validate.js # Input validation rules
│   │   ├── hourly-entry/   # Hourly data entry modules
│   │   │   ├── index.js    # Entry point, form handling
│   │   │   └── (utilities)
│   │   ├── shared/         # Shared utilities across all apps
│   │   │   └── sw-register.js # Service worker registration
│   │   └── sw-register.js  # Service worker entry point
│   ├── css/                # Stylesheets (per-app + shared variables)
│   │   ├── shared-base.css # Master CSS variables (colors, spacing, animations, fonts)
│   │   ├── dashboard.css   # Dashboard-specific styles (95 KB, Muuri grid, panels)
│   │   ├── scoreboard.css  # Scoreboard styles (105 KB, timer display, cycle history)
│   │   ├── orders.css      # Orders table, modals, forms
│   │   ├── barcode.css     # Barcode printing layout
│   │   ├── kanban.css      # Kanban card layout, drag-drop
│   │   ├── sop-manager.css # SOP table, search, modal
│   │   ├── order.css       # Customer order view (public)
│   │   ├── hourly-entry.css # Hourly entry form
│   │   ├── ai-chat.css     # AI chat bubble styles
│   │   ├── ops-hub.css     # Alternate dashboard layout (legacy)
│   │   └── CSS_CONSOLIDATION.md # Future consolidation plan
│   └── assets/             # Brand assets
│       ├── icons/          # SVG icons (Phosphor duotone set)
│       ├── ro-logo-square.png
│       ├── ro-logo-horizontal.png
│       └── icon-apple-touch.png
├── workers/                # Cloudflare Workers backend (API server)
│   ├── src/
│   │   ├── index.js        # Main router - dispatches requests to handlers
│   │   ├── handlers/       # Feature-specific business logic
│   │   │   ├── production-d1.js   # Production tracking (D1, primary)
│   │   │   ├── production.js      # Production tracking (Sheets, legacy)
│   │   │   ├── orders-d1.js       # Orders management (D1, primary)
│   │   │   ├── orders.js          # Orders (Sheets, legacy)
│   │   │   ├── barcode-d1.js      # Barcode management (D1, primary)
│   │   │   ├── barcode.js         # Barcode (Sheets, legacy)
│   │   │   ├── kanban-d1.js       # Supply kanban (D1, primary)
│   │   │   ├── kanban.js          # Kanban (Sheets, legacy)
│   │   │   ├── sop-d1.js          # SOPs (D1, primary)
│   │   │   ├── sop.js             # SOP (Sheets, legacy)
│   │   │   └── pool.js            # Pool inventory proxy (external API)
│   │   └── lib/            # Shared utilities for handlers
│   │       ├── db.js       # D1 query helpers (SELECT, INSERT, UPDATE, DELETE, transaction)
│   │       ├── sheets.js   # Google Sheets API client (read/write)
│   │       ├── auth.js     # JWT verification
│   │       ├── cors.js     # CORS headers middleware
│   │       ├── response.js # Response wrapper (JSON, error formatting)
│   │       ├── errors.js   # ApiError class
│   │       └── validate.js # Input validation (action, date, etc.)
│   ├── schema.sql          # D1 database schema (15 tables)
│   ├── wrangler.toml       # Cloudflare Workers config (D1 binding, env vars)
│   └── package.json        # Dependencies (minimal)
├── apps-script/            # Google Apps Script backends (legacy, replaced by Workers)
│   ├── production-tracking/ # Production data entry + AI chat (1900+ lines)
│   │   └── Code.gs         # Google Sheets script
│   ├── wholesale-orders/    # Order management (1200+ lines, legacy)
│   │   └── Code.gs
│   └── barcode-manager/     # Barcode generation (500+ lines, legacy)
│       └── Code.gs
├── api/                    # Vercel serverless functions (legacy, pre-Workers)
│   ├── src/ (same structure as workers/)
│   └── wrangler.toml
├── tests/                  # Playwright test suite
│   ├── *.spec.js          # Test files (new, incomplete)
│   └── (test utilities)
├── docs/                   # Developer documentation
│   ├── README.md           # Docs index
│   ├── technical/          # Architecture, API reference, inventory
│   ├── design/             # Visual design system, components, animations
│   ├── plans/              # Implementation plans, migration docs
│   ├── sessions/           # Development session notes
│   └── guides/             # Setup, deployment, user guides
├── .planning/              # GSD planning documents (NEW)
│   └── codebase/           # Codebase analysis (STACK.md, ARCHITECTURE.md, etc.)
├── .claude/                # Claude AI context files (project instructions)
├── archive/                # Old designs, backups
├── scale-reader/           # Hardware integration (Node.js, serial comm)
└── root files
    ├── CLAUDE.md           # AI assistant instructions, domain context
    ├── CODEBASE_MAP.md     # Quick reference by task
    ├── ROADMAP.md          # Development phases and priorities
    ├── BUG_AUDIT_REPORT.md # Known issues
    ├── index.html          # Root redirect (legacy)
    └── package.json        # Root dependencies
```

## Directory Purposes

**`src/pages/`:**
- Purpose: HTML entry points for each application
- Contains: Self-contained HTML files with embedded CSS (critical) + deferred CSS + script imports
- Key files: `index.html` (main dashboard, 57 KB), `scoreboard.html`, `orders.html`
- Pattern: Each HTML file imports its module via `<script type="module">`

**`src/js/modules/`:**
- Purpose: Dashboard application logic (19 ES6 modules)
- Contains: Pure modules (no side effects on import, functions instantiated by index.js)
- Key files: `index.js` (orchestrator, 32 KB), `state.js` (state mgmt, 15 KB), `api.js` (fetch wrapper, 20 KB)
- Pattern: Each module exports functions/objects, `index.js` imports and calls initialization

**`src/js/scoreboard/`:**
- Purpose: Scoreboard app logic (floor TV display)
- Contains: Timer logic, polling, rendering
- Key files: `main.js` (entry), `timer.js` (cycle time calc), `api.js` (2-sec polling)
- Pattern: Specialized for real-time updates, minimal state complexity

**`src/js/orders/`:**
- Purpose: Orders management app (CRUD interface)
- Contains: Organized by feature (core, features, ui, utils)
- Key files: `index.js` (wiring), `core/state.js`, `features/orders.js`, `ui/table.js`
- Pattern: Layered structure, separation of concerns

**`src/css/`:**
- Purpose: Stylesheets (per-app + master variables)
- Contains: CSS variables in `shared-base.css`, per-app overrides in feature-specific files
- Key files: `shared-base.css` (9 KB, all variables), `dashboard.css` (95 KB), `scoreboard.css` (105 KB)
- Pattern: CSS-in-HTML for critical styles, deferred CSS for non-critical

**`workers/src/handlers/`:**
- Purpose: Backend business logic per feature
- Contains: Data validation, D1/Sheets queries, response formatting
- Key files: `production-d1.js` (82 KB, complex calculations), `orders-d1.js` (43 KB)
- Pattern: Each handler is a single file with `handle[Feature]D1()` export

**`workers/src/lib/`:**
- Purpose: Shared backend utilities
- Contains: Database abstraction, authentication, validation
- Key files: `db.js` (CRUD helpers), `sheets.js` (Sheets API), `response.js` (JSON wrapper)
- Pattern: Stateless utility functions, used by all handlers

**`apps-script/`:**
- Purpose: Legacy Google Apps Script backends (being replaced)
- Contains: Sheet manipulation, AI chat integration (for production)
- Key files: `production-tracking/Code.gs` (AI chat endpoint still active)
- Pattern: Event-driven, runs in Google Sheets context

**`tests/`:**
- Purpose: Playwright end-to-end tests (new, incomplete)
- Contains: Test specs for user workflows
- Key files: `*.spec.js` (test files)
- Pattern: Not fully integrated, basic test structure only

**`docs/`:**
- Purpose: Developer reference documentation
- Contains: API reference, design system, implementation plans
- Key files: `technical/APP_CATALOG.md` (API reference), `design/VISUAL_DESIGN_SYSTEM.md`
- Pattern: Organized by audience (technical, design, guides)

## Key File Locations

**Entry Points:**
- `src/pages/index.html` - Dashboard/Ops Hub (main entry, GitHub Pages deployed)
- `src/pages/scoreboard.html` - Floor TV scoreboard
- `src/pages/orders.html` - Order management
- `workers/src/index.js` - API router (Cloudflare Workers edge function)

**Configuration:**
- `src/js/modules/config.js` - Dashboard config (KPI defs, widget defs, API URL, colors, work schedule)
- `src/css/shared-base.css` - CSS variables (single source of truth for colors, spacing)
- `workers/wrangler.toml` - Workers config (D1 binding, env vars)

**Core Logic:**
- `src/js/modules/index.js` - Dashboard orchestrator, module initialization (32 KB)
- `src/js/modules/state.js` - State management, cleanup registry (15 KB)
- `src/js/modules/api.js` - API fetch wrapper, retry logic (20 KB)
- `workers/src/handlers/production-d1.js` - Production tracking logic (82 KB)

**Testing:**
- `tests/*.spec.js` - Playwright test suite

## Naming Conventions

**Files:**
- HTML: kebab-case (`index.html`, `scoreboard.html`, `sop-manager.html`)
- JS modules: kebab-case (`event-cleanup.js`, `lazy-loader.js`)
- CSS: kebab-case (`shared-base.css`, `dashboard.css`)
- Handlers: kebab-case with `-d1` suffix (`production-d1.js`, `orders-d1.js`)

**Directories:**
- Feature-based: `scoreboard/`, `orders/`, `hourly-entry/` (contain related modules)
- Layer-based: `handlers/`, `lib/`, `ui/`, `features/`, `core/` (contain role-specific code)

**Functions:**
- Initialization: `init[Name]()` (e.g., `initTheme()`, `initModals()`)
- Event handlers: `handle[Action]()` or `on[Event]()` (e.g., `handleLogin()`, `onThemeChange()`)
- Getters: `get[Name]()` or `[name]()` (e.g., `getState()`, `getCurrentView()`)
- Setters: `set[Name]()` (e.g., `setData()`, `setCurrentView()`)
- Queries: `load[Resource]()` or `fetch[Resource]()` (e.g., `loadOrders()`, `loadCustomers()`)
- API calls: `apiCall()` or `[action]()` (e.g., `apiCall('getScoreboardData')`)

**CSS Classes:**
- Block: BEM style with app prefix (e.g., `.dashboard-grid`, `.orders-table`, `.scoreboard-timer`)
- State: data attributes or suffix (e.g., `.is-active`, `.is-loading`, `data-state="dark"`)
- Utilities: single purpose (e.g., `.flex-center`, `.hidden`)

## Where to Add New Code

**New Feature:**
1. Create new handler: `workers/src/handlers/[feature]-d1.js`
2. Add routing in: `workers/src/index.js` (path match + feature flag)
3. Create frontend module: `src/js/modules/[feature].js` or `src/js/[feature]/` (if complex)
4. Add API wrapper in module: `apiCall('action=getFeatureData')`
5. Update config: `src/js/modules/config.js` (add constants if needed)

**New Component/Module:**
1. Implementation: `src/js/modules/[name].js` (if dashboard) or `src/js/[app]/[feature].js` (if app-specific)
2. Export functions from module (e.g., `export function initComponent()`)
3. Import in parent orchestrator (e.g., `index.js`)
4. Call initialization in orchestrator
5. Add CSS: `src/css/dashboard.css` or app-specific file

**Utilities:**
- Shared helpers: `src/js/modules/utils.js` (formatters, safe accessors)
- Backend helpers: `workers/src/lib/[function].js` (one per file)
- Validation: `workers/src/lib/validate.js` (all validators)

**Styles:**
- Global variables: `src/css/shared-base.css` (CSS custom properties)
- App-specific: `src/css/[app].css` (per-app overrides, layout)
- Component styles: inline in CSS file using BEM classes

## Special Directories

**`.planning/codebase/`:**
- Purpose: GSD codebase analysis documents
- Generated: By `/gsd:map-codebase` command
- Committed: Yes (for next phase planning)

**`archive/`:**
- Purpose: Old designs, backups, superseded code
- Generated: Manually when code is deprecated
- Committed: Yes (for reference)

**`.worktrees/`:**
- Purpose: Git worktrees for parallel branches (live-scale, strain-analysis-ai)
- Generated: By git worktree commands
- Committed: No (ignored in .gitignore, but checked in due to git config)

**`test-results/`, `playwright-report/`:**
- Purpose: Test artifacts and reports
- Generated: By Playwright during test runs
- Committed: No (in .gitignore)

**`.claude/`:**
- Purpose: Project context files for Claude AI
- Generated: Manually
- Committed: Yes (for AI context)

---

*Structure analysis: 2026-01-29*
