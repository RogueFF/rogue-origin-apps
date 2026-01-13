# Kanban Tutorial Testing Guide

Comprehensive Playwright test suite for the 23-step Kanban tutorial system.

## Quick Start

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install

# Run all tutorial tests
npx playwright test kanban-tutorial.spec.js

# Run specific browser
npx playwright test kanban-tutorial.spec.js --project=chromium

# Run with UI mode (interactive)
npx playwright test kanban-tutorial.spec.js --ui

# Debug mode
npx playwright test kanban-tutorial.spec.js --debug
```

## Test Coverage

**44 test cases** across **8 phases**:

### Phase 1: Pre-Tutorial State (3 tests)
- ✅ Tutorial button visible on first visit
- ✅ Tutorial button has pulse animation
- ✅ Tutorial button hidden after completion

### Phase 2: Tutorial Navigation (8 tests)
- ✅ Forward navigation through all 19 steps
- ✅ Back navigation works correctly
- ✅ Progress dots update properly
- ✅ Step counter displays correctly (1/19, 2/19, etc.)
- ✅ Modal transitions work (steps 8→9, 17→18)
- ✅ Tutorial can be restarted
- ✅ Backdrop shows/hides appropriately
- ✅ Tutorial state persists in localStorage

### Phase 3: Spotlight Positioning (7 tests)
- ✅ Centered position for welcome/finish screens
- ✅ Header spotlight accuracy
- ✅ Button spotlights (tutorial, add, edit)
- ✅ Toolbar filters spotlight
- ✅ Card spotlight with empty state handling
- ✅ Form field spotlights
- ✅ Tooltip positioning (above/below)

### Phase 4: Interactive Elements (6 tests)
- ✅ Form fields remain editable during tutorial
- ✅ Input validation on blur events
- ✅ Users can skip ahead without filling fields
- ✅ Save button works during tutorial
- ✅ Checkbox interactions in print modal
- ✅ Modal overlay doesn't block spotlight targets

### Phase 5: Special Actions (5 tests)
- ✅ `openModal` action opens edit modal
- ✅ `showPrintModal` action opens print modal
- ✅ `waitForSave` blocks progression until save
- ✅ Save triggers load() and tutorial resumes
- ✅ Tutorial ends with confetti animation

### Phase 6: Empty State Handling (4 tests)
- ✅ Warning shown when no cards exist
- ✅ Tutorial offers to create sample card
- ✅ Steps 6-7 skipped if no cards present
- ✅ Tutorial exits gracefully on warning

### Phase 7: Edge Cases (6 tests)
- ✅ Missing DOM elements don't crash tutorial
- ✅ Off-screen elements scroll into view
- ✅ Mobile viewport behavior
- ✅ Rapid button clicking doesn't break state
- ✅ Browser back button during tutorial
- ✅ Page refresh during tutorial

### Phase 8: Accessibility (5 tests)
- ✅ Keyboard navigation (Tab, Enter, Escape)
- ✅ Focus management through steps
- ✅ Screen reader announcements
- ✅ ARIA labels on interactive elements
- ✅ High contrast mode support

## Test Strategy

### Mock Setup

All tests use isolated mocks to avoid external dependencies:

```javascript
const MOCK_CARDS = [{
  id: 1,
  item: 'Sample Item',
  supplier: 'Amazon',
  orderQty: 'x2',
  price: '$10.99/Pc',
  deliveryTime: '2 Days',
  crumbtrail: 'Test Rack > A-1',
  url: 'https://example.com/product',
  picture: 'https://via.placeholder.com/150'
}];
```

**Mocked APIs**:
- `localStorage` - Cleared before each test
- `fetch()` - Returns mock card data
- `window.isAppsScript` - Set to false (GitHub Pages mode)

### Test Isolation

Each test:
1. Clears localStorage
2. Sets up fresh mocks
3. Loads kanban.html from file:// protocol
4. Runs independently (no shared state)

### Browser Coverage

Tests run on 5 browser configurations:
- **chromium** - Desktop Chrome (1280×720)
- **firefox** - Desktop Firefox (1280×720)
- **webkit** - Desktop Safari (1280×720)
- **mobile-chrome** - Pixel 5 emulation
- **mobile-safari** - iPhone 12 emulation

## Configuration

### playwright.config.js

Key settings:
- **Sequential execution**: `fullyParallel: false` (tutorial tests must not run in parallel)
- **Single worker**: `workers: 1` (prevents race conditions)
- **File protocol**: `baseURL: 'file://' + __dirname + '/src/pages'`
- **Timeout**: 60 seconds per test
- **Artifacts**: Screenshots/videos on failure only

### Test Execution Time

Expected runtime: **5-10 minutes** for full suite (all browsers)

## Debugging Tests

### View Test Report

```bash
# After running tests
npx playwright show-report
```

### Interactive UI Mode

```bash
# Step through tests visually
npx playwright test kanban-tutorial.spec.js --ui
```

### Debug Specific Test

```bash
# Run single test with debugger
npx playwright test kanban-tutorial.spec.js -g "should show tutorial button" --debug
```

### Screenshots

Failed tests automatically capture:
- Screenshot at failure point
- Video recording (if enabled)
- Trace file (on retry)

Location: `test-results/` folder

## Common Issues

### Issue: Tests hang at "Starting tutorial"

**Cause**: Tutorial overlay not detected
**Fix**: Check that `#tutorialOverlay` exists in kanban.html
**Debug**: Add `await page.pause()` before assertion

### Issue: "Element not found" errors

**Cause**: Selectors changed in kanban.html
**Fix**: Update selectors in test file to match current DOM
**Debug**: Use `await page.locator('selector').highlight()` to verify

### Issue: Empty state tests fail

**Cause**: Mock setup includes cards when it shouldn't
**Fix**: Use `setupMocks(page, [])` to test empty state
**Debug**: Check `window.allCards` array in browser console

### Issue: Mobile tests fail but desktop passes

**Cause**: Viewport-specific behavior differences
**Fix**: Check media queries and mobile-specific CSS
**Debug**: Run with `--project=mobile-chrome --headed` to see browser

## Adding New Tests

### 1. Add test to appropriate phase

```javascript
test('should do something new', async ({ page }) => {
  await setupMocks(page);
  await page.goto('/kanban.html');

  // Your test code here
  await expect(page.locator('.something')).toBeVisible();
});
```

### 2. Use helper functions

```javascript
// Wait for tutorial UI
await waitForTutorialOverlay(page);

// Navigate forward
await clickNext(page);

// Navigate backward
await clickBack(page);
```

### 3. Follow naming convention

- Start with "should"
- Be specific about what's tested
- Example: "should scroll off-screen elements into view"

### 4. Test in isolation

```javascript
test.beforeEach(async ({ page }) => {
  await setupMocks(page);
  await page.goto('/kanban.html');
});
```

## Bug Fixes Validated by Tests

These tests verify fixes for 9 critical bugs:

| Bug ID | Description | Test Coverage |
|--------|-------------|---------------|
| BUG-01 | Missing cards crash | Phase 6 (empty state tests) |
| BUG-02 | `waitForSave` not implemented | Phase 5 (special actions) |
| BUG-03 | Dead code removed | Code review (no test needed) |
| BUG-04 | Back button modal handling | Phase 2 (navigation) |
| BUG-05 | No scroll for off-screen elements | Phase 7 (edge cases) |
| BUG-06 | Modal state conflicts | Phase 4 (interactive elements) |
| BUG-07 | Save race condition | Phase 5 (save flow) |
| BUG-08 | No progress persistence | Phase 2 (localStorage) |
| BUG-09 | Missing null checks | Phase 7 (missing DOM) |

## CI/CD Integration

### GitHub Actions (Future)

```yaml
name: Tutorial Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npx playwright install --with-deps
      - run: npx playwright test kanban-tutorial.spec.js
      - uses: actions/upload-artifact@v3
        if: failure()
        with:
          name: test-results
          path: test-results/
```

## Maintenance

### When to Update Tests

- **Kanban HTML changes**: Update selectors
- **Tutorial steps added/removed**: Update step count assertions
- **New tutorial features**: Add tests to appropriate phase
- **Bug fixes**: Add regression test

### Test Smell Checklist

- ❌ Tests depend on execution order
- ❌ Tests share state via global variables
- ❌ Tests make real API calls
- ❌ Hardcoded wait times (`page.waitForTimeout()`)
- ✅ Tests use `waitForSelector()` and assertions
- ✅ Each test can run independently
- ✅ Mocks isolate external dependencies

## Resources

- [Playwright Documentation](https://playwright.dev)
- [Playwright Test API](https://playwright.dev/docs/api/class-test)
- [Debugging Guide](https://playwright.dev/docs/debug)
- [Best Practices](https://playwright.dev/docs/best-practices)

## Support

Questions? Check:
1. This documentation first
2. Playwright docs (link above)
3. `kanban.html` tutorial implementation (lines 1477-1970)
4. Test file comments in `kanban-tutorial.spec.js`
