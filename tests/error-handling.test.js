/**
 * Error Handling Tests
 * Tests the connection status bar and error states
 */

const { chromium } = require('playwright');

async function testErrorHandling() {
  console.log('🧪 Starting error handling tests...\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Monitor console messages
    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      if (type === 'error' || text.includes('API') || text.includes('Error') || text.includes('error')) {
        console.log(`   [${type}] ${text}`);
      }
    });

    // Test 1: Normal Load - Status Bar Appears and Hides
    console.log('📍 Test 1: Normal load with status bar');
    const filePath = 'file://' + process.cwd().replace(/\\/g, '/') + '/src/pages/index.html';
    console.log(`   ℹ️  Loading: ${filePath}`);
    await page.goto(filePath);

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Wait for loading overlay to disappear (or force hide it after timeout)
    const loadingOverlay = page.locator('#loadingOverlay');
    const overlayHidden = await loadingOverlay.waitFor({ state: 'hidden', timeout: 10000 }).then(() => true).catch(() => false);

    if (!overlayHidden) {
      console.log('   ⚠️  Loading overlay timeout - forcing hide');
      await page.evaluate(() => {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
          overlay.style.display = 'none';
          overlay.classList.add('hidden');
        }
      });
    }
    await page.waitForTimeout(1000);

    // Check if status bar exists
    const statusBar = await page.locator('#connectionStatus');
    const statusBarExists = await statusBar.count() > 0;
    console.log(`   ✓ Status bar element exists: ${statusBarExists}`);

    // Check Muuri active class
    const bodyClasses = await page.locator('body').getAttribute('class');
    const hasMuuriActive = bodyClasses?.includes('muuri-active');
    console.log(`   ✓ Muuri active: ${hasMuuriActive}`);

    // Take screenshot of normal state
    await page.screenshot({ path: 'tests/screenshots/error-handling-normal.png', fullPage: true });
    console.log('   ✓ Screenshot saved: error-handling-normal.png\n');

    await page.waitForTimeout(2000);

    // Test 2: Widget Layout Check (No Stacking)
    console.log('📍 Test 2: Widget layout check');
    const widgets = await page.locator('.widget-item').all();
    console.log(`   ✓ Found ${widgets.length} widgets`);

    // Get positions of first 3 widgets
    for (let i = 0; i < Math.min(3, widgets.length); i++) {
      const box = await widgets[i].boundingBox();
      if (box) {
        console.log(`   ✓ Widget ${i + 1} position: x=${Math.round(box.x)}, y=${Math.round(box.y)}`);
      }
    }

    // Check if any widgets are stacked (same position)
    const positions = [];
    for (const widget of widgets) {
      const box = await widget.boundingBox();
      if (box) {
        positions.push({ x: Math.round(box.x), y: Math.round(box.y) });
      }
    }
    const uniquePositions = new Set(positions.map(p => `${p.x},${p.y}`));
    const hasStacking = uniquePositions.size < positions.length;
    console.log(`   ${hasStacking ? '✗' : '✓'} Widgets stacking: ${hasStacking ? 'YES (BAD)' : 'NO (GOOD)'}\n`);

    await page.waitForTimeout(1000);

    // Test 3: Simulate Network Error
    console.log('📍 Test 3: Simulate network error');

    // Intercept ALL network requests and abort them to simulate connection failure
    await page.route('**/*', route => {
      const url = route.request().url();
      // Only intercept Google Apps Script API calls
      if (url.includes('script.google.com') || url.includes('exec')) {
        console.log('   ℹ️  Intercepted API call:', url);
        route.abort('failed');
      } else {
        // Allow other resources (CSS, JS, fonts, etc.)
        route.continue();
      }
    });

    // Click refresh to trigger error
    await page.click('#refreshBtn');

    // Wait for error state to appear (give it 2 seconds)
    await page.waitForTimeout(2000);

    // Check status bar state
    const statusBarClasses = await statusBar.getAttribute('class');
    const statusText = await page.locator('#connectionStatusText').textContent();
    console.log(`   ✓ Status bar classes: ${statusBarClasses}`);
    console.log(`   ✓ Status text: "${statusText}"`);

    const hasErrorClass = statusBarClasses.includes('error');
    console.log(`   ${hasErrorClass ? '✓' : '✗'} Error state active: ${hasErrorClass}`);

    // Check if retry button is visible
    const retryBtn = await page.locator('#connectionRetryBtn');
    const retryVisible = await retryBtn.isVisible();
    console.log(`   ✓ Retry button visible: ${retryVisible}`);

    // Take screenshot of error state
    await page.screenshot({ path: 'tests/screenshots/error-handling-error.png', fullPage: true });
    console.log('   ✓ Screenshot saved: error-handling-error.png\n');

    await page.waitForTimeout(2000);

    // Test 4: Auto-Retry (wait 6 seconds)
    console.log('📍 Test 4: Auto-retry mechanism');
    console.log('   ⏳ Waiting 6 seconds for auto-retry...');

    // Wait and watch for retry
    await page.waitForTimeout(6000);

    const statusTextAfterRetry = await page.locator('#connectionStatusText').textContent();
    console.log(`   ✓ Status after auto-retry: "${statusTextAfterRetry}"`);

    const hasRetried = statusTextAfterRetry.includes('Retrying') || statusTextAfterRetry.includes('attempt');
    console.log(`   ${hasRetried ? '✓' : '✗'} Auto-retry triggered: ${hasRetried}\n`);

    await page.waitForTimeout(2000);

    // Test 5: Manual Retry
    console.log('📍 Test 5: Manual retry button');

    // Remove route to allow success
    await page.unroute('**/exec*');

    // Click retry button
    if (await retryBtn.isVisible()) {
      console.log('   ℹ️  Clicking retry button...');
      await retryBtn.click();
      await page.waitForTimeout(2000);

      const statusTextAfterManualRetry = await page.locator('#connectionStatusText').textContent();
      console.log(`   ✓ Status after manual retry: "${statusTextAfterManualRetry}"`);
    } else {
      console.log('   ⚠️  Retry button not visible');
    }

    // Take screenshot of final state
    await page.screenshot({ path: 'tests/screenshots/error-handling-final.png', fullPage: true });
    console.log('   ✓ Screenshot saved: error-handling-final.png\n');

    // Test 6: Muuri Fallback (Force Destroy)
    console.log('📍 Test 6: Muuri fallback test');

    await page.evaluate(() => {
      // Get grid from state
      const state = window.getState ? window.getState() : {};
      const grid = state.grids?.widgets;

      if (grid && !grid._isDestroyed) {
        grid.destroy();
        console.log('Grid destroyed');
      }
      document.body.classList.remove('muuri-active');
      console.log('muuri-active class removed');
    });

    await page.waitForTimeout(1000);

    // Check if widgets still display properly
    const widgetsAfterDestroy = await page.locator('.widget-item').all();
    console.log(`   ✓ Widgets still visible: ${widgetsAfterDestroy.length}`);

    // Take screenshot of fallback state
    await page.screenshot({ path: 'tests/screenshots/error-handling-fallback.png', fullPage: true });
    console.log('   ✓ Screenshot saved: error-handling-fallback.png\n');

    // Summary
    console.log('═══════════════════════════════════════');
    console.log('✅ All error handling tests completed!');
    console.log('═══════════════════════════════════════');
    console.log('\n📸 Screenshots saved to tests/screenshots/');
    console.log('   - error-handling-normal.png');
    console.log('   - error-handling-error.png');
    console.log('   - error-handling-final.png');
    console.log('   - error-handling-fallback.png\n');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    // Keep browser open for inspection
    console.log('Browser will remain open for 30 seconds for inspection...');
    await page.waitForTimeout(30000);
    await browser.close();
  }
}

// Run tests
testErrorHandling().catch(console.error);
