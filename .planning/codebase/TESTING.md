# Testing Patterns

**Analysis Date:** 2026-01-29

## Test Framework

**Runner:**
- Playwright v1.49.0 (primary test framework)
- Config: `playwright.config.js`
- Tests run sequentially (not in parallel): `fullyParallel: false`, `workers: 1`

**Assertion Library:**
- Playwright's built-in expect: `const { test, expect } = require('@playwright/test')`

**Run Commands:**
```bash
npm test                          # Run all Playwright tests
npm run test:tutorial             # Run kanban-tutorial.spec.js
npm run test:tutorial:ui          # Run with UI mode for debugging
npm run test:tutorial:debug       # Run with debugger
npm run test:dashboard            # Run dashboard-widgets.spec.js
npm run test:dashboard:ui         # Dashboard tests with UI
npm run test:headed               # Run with visible browser
npm run test:chromium             # Run on specific browser
npm run test:firefox              # Run on Firefox
npm run test:webkit               # Run on WebKit/Safari
npm run test:mobile               # Run on mobile viewports
npm run playwright:install        # Install browser binaries
```

**Configuration Details from `playwright.config.js`:**
- Sequential execution (no parallel workers)
- Action timeout: 10 seconds (`actionTimeout: 10000`)
- Navigation timeout: 30 seconds (`navigationTimeout: 30000`)
- Global test timeout: 60 seconds (`timeout: 60000`)
- Base URL: `file://[path]/src/pages` (local file protocol for testing)
- Retries: 2 on CI, 0 locally
- Report formats: HTML, List, JSON
- Artifacts: Screenshots and videos on failure, trace on first retry

## Test File Organization

**Location:**
- Tests co-located in `tests/` directory (separate from source)
- Pattern: source in `src/`, tests in `tests/`

**Naming:**
- Test files: `[feature].spec.js` (e.g., `kanban-tutorial.spec.js`, `orders-crud.spec.js`)
- Playwright test files: `[page].test.js` (e.g., `page-loading.test.js`)
- File paths: `tests/[name].spec.js` or `tests/[name].test.js`

**Test Files Present:**
- `page-loading.test.js` - Basic page loading and cross-page consistency
- `kanban-tutorial.spec.js` - 44 test cases for kanban tutorial system
- `dashboard-widgets.spec.js` - Dashboard functionality tests
- `orders-crud.spec.js` - Order management CRUD operations
- `customer-dropdown.spec.js` - Customer selection UI
- `hourly-entry.spec.js` - Hourly production entry
- `carryover-bags.spec.js` - Bag carryover logic
- `error-handling.test.js`, `error-handling-live.test.js` - Error scenarios
- `iframe-*.spec.js` - Iframe navigation and scoreboard tests
- Plus 20+ more test files in `tests/` directory

## Test Structure

**Suite Organization:**
```javascript
const { test, expect } = require('@playwright/test');

test.describe('Orders CRUD Operations', () => {

  test('API: test endpoint works', async ({ request }) => {
    const response = await request.get(`${API_URL}?action=test`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.success !== false).toBeTruthy();
  });

  test('page loads and shows orders table', async ({ page }) => {
    await setupAuth(page);
    const table = page.locator('#orders-table-body');
    await expect(table).toBeVisible({ timeout: 10000 });
    const rows = await table.locator('tr').count();
    expect(rows).toBeGreaterThanOrEqual(1);
  });

});
```

**Patterns:**
- `test.describe()` for test suites/groups
- `test()` for individual test cases
- Async/await pattern: `async ({ page, request }) => { ... }`
- Setup/teardown functions: `beforeEach()`, `afterEach()`, `beforeAll()`, `afterAll()`
- Use `@ts-check` comment at top for TypeScript checking

## Setup and Fixtures

**Common Setup Pattern:**
```javascript
async function setupAuth(page) {
  await page.goto(`${BASE_URL}/src/pages/orders.html`);
  await page.evaluate(() => {
    const session = {
      sessionToken: 'test-session-token',
      timestamp: Date.now(),
      expiresIn: 86400000
    };
    localStorage.setItem('orders_auth_session', JSON.stringify(session));
  });
  await page.reload();
  await page.waitForTimeout(3000);
}
```

**Mock Data Injection:**
```javascript
const MOCK_CARDS = [
  {
    id: 1,
    item: 'Sample Item',
    supplier: 'Amazon',
    orderQty: 'x2',
    price: '$10.99/Pc',
    // ... more properties
  }
];

async function setupMocks(page, cards = MOCK_CARDS) {
  await page.addInitScript((mockCards) => {
    window.localStorage.clear();
    window.isAppsScript = false;

    window.fetch = async (url) => {
      if (url.includes('action=cards')) {
        return {
          ok: true,
          json: async () => ({ success: true, cards: mockCards })
        };
      }
      return originalFetch(url);
    };
  }, cards);
}
```

**Helper Functions:**
```javascript
async function waitForTutorialOverlay(page) {
  await page.waitForSelector('#tutorialOverlay', {
    state: 'visible',
    timeout: TIMEOUT
  });
}

async function clickNext(page) {
  // Custom test helper for UI interaction
}
```

## Mocking

**Framework:** Native Playwright mocking via `page.addInitScript()`

**Mocking Pattern - Fetch API:**
```javascript
const originalFetch = window.fetch;
window.fetch = async (url) => {
  if (url.includes('action=cards')) {
    return {
      ok: true,
      json: async () => ({ success: true, cards: mockCards })
    };
  }
  if (url.includes('action=add')) {
    return {
      ok: true,
      json: async () => ({ success: true, message: 'Card saved' })
    };
  }
  return originalFetch(url);
};
```

**Mocking Pattern - localStorage:**
```javascript
window.localStorage.clear();
localStorage.setItem('orders_auth_session', JSON.stringify(session));
```

**Mocking Pattern - Environment:**
```javascript
window.isAppsScript = false;  // Force GitHub Pages mode
```

**What to Mock:**
- External API calls (Fetch/Apps Script)
- localStorage operations
- Environment flags
- Third-party libraries (only if needed)

**What NOT to Mock:**
- DOM manipulation (test against real DOM)
- Event listeners
- Browser APIs (Playwright handles these)
- Timer functions (unless testing timer logic)

## Test Types

**Unit Tests:**
- Not found in Playwright suites (focus is on E2E/integration)
- Backend handlers might have inline tests (not observed in codebase)
- Tests verify complete user workflows, not individual functions

**Integration Tests:**
- Primary test type in this codebase
- Test full feature workflows (e.g., create order → save → verify in table)
- Example from `orders-crud.spec.js`:
  1. Setup authentication
  2. Load orders page
  3. Click "New Order" button
  4. Verify modal appears
  5. Fill form with test data
  6. Submit form
  7. Verify data appears in table

**E2E Tests:**
- Playwright tests against live URLs or local files
- Example from `page-loading.test.js`:
  - Load each page individually
  - Check for required DOM elements
  - Monitor console errors
  - Verify page load times < 3 seconds
  - Check CSS file loading

**API Tests:**
```javascript
test('API: test endpoint works', async ({ request }) => {
  const response = await request.get(`${API_URL}?action=test`);
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  expect(data.success !== false).toBeTruthy();
});

test('API: get customers', async ({ request }) => {
  const response = await request.get(`${API_URL}?action=getCustomers`);
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  expect(data.customers).toBeDefined();
});
```

## Common Test Patterns

**Page Navigation and Loading:**
```javascript
test('page loads successfully', async ({ page }) => {
  await page.goto(`${BASE_URL}/kanban.html`, { waitUntil: 'networkidle2' });
  const title = await page.title();
  expect(title).toBeTruthy();
});
```

**DOM Element Verification:**
```javascript
test('required DOM elements exist', async ({ page }) => {
  const clock = await page.$('#clock');
  expect(clock).toBeTruthy();

  const date = await page.$('#date');
  expect(date).toBeTruthy();
});
```

**Locator Pattern (preferred):**
```javascript
const table = page.locator('#orders-table-body');
await expect(table).toBeVisible({ timeout: 10000 });
const rows = await table.locator('tr').count();
expect(rows).toBeGreaterThanOrEqual(1);
```

**Console Error Filtering:**
```javascript
page.consoleErrors = [];
page.on('console', msg => {
  if (msg.type() === 'error') {
    page.consoleErrors.push(msg.text());
  }
});

// Filter for critical errors only
const criticalErrors = page.consoleErrors.filter(err =>
  !err.includes('Failed to fetch') &&
  !err.includes('NetworkError') &&
  !err.includes('404')
);
expect(criticalErrors.length).toBe(0);
```

**User Interaction:**
```javascript
// Click by text
await page.click('button:has-text("New Order")');

// Fill form
await page.fill('#order-customer', 'Acme Corp');
await page.fill('#order-commitment', '500lbs');

// Select dropdown
await page.selectOption('#order-type', 'wholesale');

// Wait for modal
await expect(page.locator('#order-modal')).toBeVisible({ timeout: 5000 });
```

**Async Operations:**
```javascript
test('async operation completes', async ({ page }) => {
  await page.click('#save-btn');

  // Wait for response (implicit with Playwright)
  await page.waitForLoadState('networkidle');

  // Verify result
  const toast = page.locator('.success-toast');
  await expect(toast).toBeVisible({ timeout: 5000 });
});
```

**Error Testing:**
```javascript
test('handles API error gracefully', async ({ page }) => {
  // Mock failed API
  await page.addInitScript(() => {
    window.fetch = async () => {
      throw new Error('API error');
    };
  });

  await page.goto(`${BASE_URL}/kanban.html`);

  // Verify error UI
  const errorMsg = page.locator('.error-message');
  await expect(errorMsg).toBeVisible();
});
```

## Coverage

**Requirements:**
- No coverage threshold enforced in config
- Coverage not measured (Playwright doesn't include coverage by default)
- Focus is on critical user workflows, not code coverage percentage

**View Coverage:**
- Not configured - would require additional Playwright plugins
- Coverage metrics: Not available in current setup

## Test Execution Flow

**Local Workflow:**
1. Run: `npm test kanban-tutorial.spec.js`
2. Playwright launches browser(s) specified in config
3. Navigates to test file via `file://` protocol
4. Injects mocks via `page.addInitScript()`
5. Executes test steps
6. On failure: captures screenshot, video, trace
7. Reports results in HTML format (`playwright-report/`)

**CI Workflow:**
- Runs with retries (2 max)
- Uses `forbidOnly: true` to prevent accidental `.only()` in production
- Reports generated in `test-results/` directory

**Debugging:**
```bash
npm run test:tutorial:ui       # Interactive Playwright test runner
npm run test:tutorial:debug    # Debugger with browser console
```

## Performance Testing

**Observed Patterns:**
- File size checks: `expect(fileSizeInKB).toBeLessThan(150)`
- Load time checks: `expect(loadTime).toBeLessThan(3000)`
- No dedicated performance test file (performance measured ad-hoc)

**Example from `page-loading.test.js`:**
```javascript
test('Page responds within 3 seconds', async ({ page }) => {
  const startTime = Date.now();
  await page.goto(`${BASE_URL}/kanban.html`, { waitUntil: 'domcontentloaded' });
  const loadTime = Date.now() - startTime;
  expect(loadTime).toBeLessThan(3000);
});

test('Page file size is optimized (< 150KB)', async () => {
  const fs = require('fs');
  const filePath = path.resolve(__dirname, '../src/pages/scoreboard.html');
  const stats = fs.statSync(filePath);
  const fileSizeInKB = stats.size / 1024;
  expect(fileSizeInKB).toBeLessThan(150);
});
```

## Best Practices Observed

1. **Use locators over query selectors** - `page.locator()` more reliable than `page.$()` or `page.evaluate()`
2. **Wait explicitly** - Use `waitForSelector()`, `waitForLoadState()`, or explicit waits
3. **Set appropriate timeouts** - 10s for actions, 30s for navigation, 60s for full test
4. **Filter console errors** - Ignore expected errors (404s, network errors for test scenarios)
5. **Test real workflows** - Don't test implementation details, test what users do
6. **Provide context in assertions** - Use `console.log()` to debug test data
7. **Inject mocks early** - Use `addInitScript()` before navigation
8. **Clean up state** - `page.close()`, `localStorage.clear()` between tests
9. **Use setup functions** - Extract common setup into reusable functions
10. **Catch abort/timing errors** - Handle race conditions gracefully

---

*Testing analysis: 2026-01-29*
