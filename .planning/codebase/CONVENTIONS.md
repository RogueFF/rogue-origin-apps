# Coding Conventions

**Analysis Date:** 2026-01-29

## Naming Patterns

**Files:**
- `camelCase.js` for ES6 modules (e.g., `utils.js`, `api.js`, `state.js`)
- `kebab-case.html` for HTML pages (e.g., `kanban.html`, `scoreboard.html`)
- `kebab-case.css` for stylesheets (e.g., `shared-base.css`, `kanban.css`)
- Handler files: `[name]-d1.js` for D1 (database) versions, `[name].js` for legacy versions

**Functions:**
- `camelCase` for all function names (e.g., `safeGetEl()`, `loadData()`, `formatDateInput()`)
- Prefix utilities with `safe` when they include null/undefined guards (e.g., `safeGet()`, `safeGetChartContext()`)
- Prefix setup/initialization functions with `setup` (e.g., `setupMocks()`, `setupAuth()`)
- Use verb + noun pattern: `loadData()`, `renderAll()`, `showSkeletons()`, `validateDate()`

**Variables:**
- `camelCase` for local variables and constants
- `UPPER_SNAKE_CASE` for configuration constants (e.g., `BASE_WAGE_RATE = 23.00`, `TIMEZONE = 'America/Los_Angeles'`)
- Prefix state getter/setters: `getData()`, `setData()`, `isAppsScript()`, `setShowSkeletonsCallback()`
- Use descriptive names for objects: `state`, `result`, `error`, `options`, `meta`

**Types:**
- Class names: `PascalCase` (e.g., `ApiError`)
- Error codes: `UPPER_SNAKE_CASE` (e.g., `UNAUTHORIZED`, `VALIDATION_ERROR`, `RATE_LIMITED`)
- Object property names: `camelCase` (e.g., `sessionToken`, `expiresIn`, `lastSuccessfulFetch`)

## Code Style

**Formatting:**
- No automated formatter configured (uses ESLint for checking only)
- 2-space indentation (observed in all source files)
- Single quotes for strings: `'example'` (unless escaping needed, then use template literals)
- Template literals with no spaces: `` `${variable}` `` (rule: `template-curly-spacing`)
- Semicolons: required (rule: `semi: ['warn', 'always']`)
- No trailing spaces
- Max line length: not strictly enforced but generally kept under 120 chars

**Linting:**
- ESLint with flat config (v9.39.2+)
- Config file: `eslint.config.mjs` (ES Module format)
- Ignored patterns: `node_modules`, `archive`, `docs`, `tests`, `*.min.js`, `apps-script/**`, `sw.js`, `src/js/legacy/**`

**Key ESLint Rules:**
- `no-unused-vars`: warn (ignores underscore-prefixed variables/parameters)
- `no-undef`: error (catches undefined globals)
- `eqeqeq: ['warn', 'always', { null: 'ignore' }]` (use `===` except for null checks)
- `no-const-assign`: error (prevent reassignment)
- `prefer-const`: warn (use `const` instead of `let` when value doesn't change)
- `no-var`: warn (discourage legacy `var`)
- `no-console`: off (console is allowed for debugging)

## Import Organization

**Order:**
1. External libraries (e.g., `import { test, expect } from '@playwright/test'`)
2. Local modules (e.g., `import { safeGet } from './utils.js'`)
3. Configuration imports (e.g., `import { API_URL } from './config.js'`)
4. No blank lines within import sections

**Example from `src/js/modules/api.js`:**
```javascript
import { API_URL } from './config.js';
import { setData, getData, setFetchController } from './state.js';
import { formatDateInput } from './utils.js';
import { showConnecting, showError } from './status.js';
```

**Path Aliases:**
- No path aliases configured - always use relative imports (e.g., `'./utils.js'`, `'../lib/db.js'`)
- Frontend modules import from same directory or parent directories
- Backend (workers) imports from relative paths: `'./handlers/[name].js'`, `'../lib/[module].js'`

## Error Handling

**Patterns:**
- Use custom `ApiError` class in backend: `new ApiError(message, code, statusCode, details)`
- Use `try/catch` for synchronous operations
- Use `.catch()` for Promise chains (observed pattern for backward compatibility with older JS)
- Log errors explicitly: `console.error('context:', error)`
- Always catch `AbortError` separately when using `AbortController` (race condition protection)
- Provide user-friendly error messages in frontend: `getUserFriendlyErrorMessage(error)`
- Don't leak internals in error responses (log full error internally, return generic message to client)

**Frontend Error Flow:**
```javascript
function onError(error, skipAutoRetry = false) {
  console.error('API Error:', error);
  showSkeletons(false);
  const userMessage = getUserFriendlyErrorMessage(error);
  showError(userMessage);
  if (shouldAutoRetry() && !skipAutoRetry) {
    setTimeout(loadData, isRateLimited ? 30000 : 5000);
  }
}
```

**Backend Error Response:**
```javascript
export function errorResponse(message, code, statusCode, details = null) {
  return {
    status: statusCode,
    body: JSON.stringify({ success: false, error: message, code, details })
  };
}
```

## Logging

**Framework:** `console` (no logger library)

**Patterns:**
- Development/debug: `console.log()` - enabled in production (no `no-console` rule)
- Warnings: `console.warn()` - for recoverable issues
- Errors: `console.error()` - for failures and exceptions
- Use prefixes for domain clarity: `console.log('[EventCleanup] message')`, `console.error('API Error:', error)`
- Log at function entry for long operations: `console.log('Auto-retry after error...')`
- Log timing info: `console.log('Discard stale response #42')`

**Specific Patterns Observed:**
- Discard stale responses: `console.log('Discarding stale API response (request #..., current #...)')`
- Event cleanup: `console.log('[EventCleanup] Registered listener #...:')`
- Chart failures: `console.error('Hourly chart error:', e)`
- Lazy loading: `console.log('✅ Chart.js loaded lazily')`

## Comments

**When to Comment:**
- Document function purpose with JSDoc/TSDoc blocks
- Explain non-obvious logic (e.g., break time calculations, race condition fixes)
- Add comments before complex sections (e.g., "Race condition fix:", "Check if...")
- Avoid commenting obvious code (`count++` doesn't need a comment)

**JSDoc/TSDoc:**
- Use for all exported functions in modules
- Include `@param`, `@returns`, and `@example` tags
- Use for public APIs in handlers
- Example from `src/js/modules/utils.js`:

```javascript
/**
 * Safely access nested object properties using dot notation
 * @param {Object} obj - Source object
 * @param {string} path - Property path (e.g., 'user.profile.name')
 * @param {*} [defaultValue=undefined] - Value to return if path doesn't exist
 * @returns {*} Property value or defaultValue
 * @example
 * const name = safeGet(data, 'user.profile.name', 'Unknown');
 */
export function safeGet(obj, path, defaultValue) { ... }
```

## Function Design

**Size:**
- Aim for functions under 50 lines
- Break long chains (like Promise chains) into separate handlers
- Use callback-style for compatibility with Apps Script pattern

**Parameters:**
- Use positional parameters for 1-2 parameters
- Use options object for 3+ parameters: `function handler(request, options)`
- Destructure options where used
- Default parameters: `skipAutoRetry = false`, `defaultValue = undefined`

**Return Values:**
- Return `null` or `undefined` for missing values (convention varies by context)
- Use sentinel values: `'—'` (em dash) for missing numbers in UI
- Return response objects: `{ success: true, data: [...], message: '...' }`
- Return structured objects for multiple values

**Example from `workers/src/lib/response.js`:**
```javascript
export function successResponse(data, message = 'Success') {
  return {
    status: 200,
    body: JSON.stringify({ success: true, data, message })
  };
}

export function errorResponse(message, code, statusCode, details = null) {
  return {
    status: statusCode,
    body: JSON.stringify({ success: false, error: message, code, details })
  };
}
```

## Module Design

**Exports:**
- Use named exports for all public functions: `export function functionName() { ... }`
- Use default export only when module has single primary export
- Export constants at top: `export const API_URL = '...'`
- Example from `src/js/modules/api.js`:

```javascript
export function setRenderCallback(fn) { ... }
export function setShowSkeletonsCallback(fn) { ... }
export function onError(error, skipAutoRetry = false) { ... }
export function loadData() { ... }
export function loadCompareData() { ... }
export function refreshData() { ... }
```

**Barrel Files:**
- Used in some module groups (e.g., `src/js/modules/index.js`)
- Re-export key functions for convenience

**Module Pattern - Centralized State:**
- State management through getter/setter functions: `getData()`, `setData()`, `getCompareData()`, `setCompareData()`
- State object defined in `src/js/modules/state.js` with 80+ properties
- All state access through exported functions (encapsulation)

**Callback Pattern (Apps Script compatibility):**
- Use callbacks instead of async/await where possible
- Pattern: `function(result) { ... }` for success, `function(error) { ... }` for failure
- Example: `.withSuccessHandler(callback).withFailureHandler(errorHandler).getProductionDashboardData(s, e)`

## Special Patterns

**Feature Flags:**
- Boolean constants in handler file (`USE_D1_BARCODE = true`)
- Used in routing logic to switch between implementations
- Example from `workers/src/index.js`:
```javascript
const USE_D1_PRODUCTION = true;
const USE_D1_ORDERS = true;
const USE_D1_BARCODE = true;

response = USE_D1_BARCODE
  ? await handleBarcodeD1(request, env, ctx)
  : await handleBarcode(request, env, ctx);
```

**Race Condition Protection:**
- Assign unique request IDs: `const requestId = ++requestCounter`
- Check before updating: `if (requestId !== requestCounter) return`
- Use `AbortController` for fetch cancellation
- Catch `AbortError` specifically:
```javascript
.catch(function(error) {
  if (error.name === 'AbortError') {
    console.log('Fetch aborted - newer request in progress');
    return;
  }
  onError(error);
});
```

**Bilingual Support:**
- Simple object maps: `{ en: { key: 'English' }, es: { key: 'Español' } }`
- Helper function: `const t = (key) => labels[lang][key] || key`
- Switch with buttons: data attributes track language
- No i18n library - manual implementation only

---

*Convention analysis: 2026-01-29*
