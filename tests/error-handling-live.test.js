/**
 * Live Error Handling Tests
 * Tests the connection status bar and error states on the deployed GitHub Pages site
 */

const { chromium } = require('playwright');

async function testLiveErrorHandling() {
  console.log('🧪 Starting live error handling tests...\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Test 1: Load Live Site
    console.log('📍 Test 1: Loading live site');
    const liveUrl = 'https://rogueff.github.io/rogue-origin-apps/src/pages/index.html';
    console.log(`   ℹ️  URL: ${liveUrl}`);
    await page.goto(liveUrl);

    // Wait for page to load
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Check if status bar exists
    const statusBar = page.locator('#connectionStatus');
    const statusBarExists = await statusBar.count() > 0;
    console.log(`   ✓ Status bar element exists: ${statusBarExists}`);

    // Take screenshot of initial state
    await page.screenshot({ path: 'tests/screenshots/live-initial.png', fullPage: true });
    console.log('   ✓ Screenshot saved: live-initial.png\n');

    // Test 2: Check Current Status
    console.log('📍 Test 2: Check connection status');
    const statusBarClasses = await statusBar.getAttribute('class');
    const statusText = await page.locator('#connectionStatusText').textContent();
    const isVisible = statusBarClasses?.includes('visible');

    console.log(`   ℹ️  Status bar classes: ${statusBarClasses}`);
    console.log(`   ℹ️  Status text: "${statusText}"`);
    console.log(`   ℹ️  Visible: ${isVisible}`);

    // Check for error state (API might be down)
    const hasError = statusBarClasses?.includes('error');
    const hasConnecting = statusBarClasses?.includes('connecting');
    const hasConnected = statusBarClasses?.includes('connected');

    if (hasError) {
      console.log('   ⚠️  Error state detected!');
      const retryBtn = page.locator('#connectionRetryBtn');
      const retryVisible = await retryBtn.isVisible();
      console.log(`   ✓ Retry button visible: ${retryVisible}\n`);

      // Test 3: Test Manual Retry
      console.log('📍 Test 3: Testing manual retry');
      if (retryVisible) {
        console.log('   ℹ️  Clicking retry button...');
        await retryBtn.click();
        await page.waitForTimeout(3000);

        const newStatusText = await page.locator('#connectionStatusText').textContent();
        console.log(`   ✓ Status after retry: "${newStatusText}"`);
      }
    } else if (hasConnecting) {
      console.log('   ℹ️  Connecting state detected');
      console.log('   ⏳  Waiting to see if it resolves...');
      await page.waitForTimeout(8000);

      const newStatusClasses = await statusBar.getAttribute('class');
      const newStatusText = await page.locator('#connectionStatusText').textContent();
      console.log(`   ✓ Final state: ${newStatusClasses}`);
      console.log(`   ✓ Final text: "${newStatusText}"\n`);
    } else if (hasConnected) {
      console.log('   ✓ Connected state detected (data loaded successfully)\n');
    } else {
      console.log('   ℹ️  Status bar hidden (likely auto-hide after success)\n');
    }

    // Test 4: Force Network Error
    console.log('📍 Test 4: Simulating network error');

    // Intercept API requests and abort them
    await page.route('**/*script.google.com/**', route => {
      console.log('   ℹ️  Intercepted API call - aborting');
      route.abort('failed');
    });

    // Click refresh to trigger error
    const refreshBtn = page.locator('#refreshBtn');
    const refreshExists = await refreshBtn.count() > 0;

    if (refreshExists) {
      console.log('   ℹ️  Clicking refresh button...');
      await refreshBtn.click();
      await page.waitForTimeout(3000);

      const errorStatusClasses = await statusBar.getAttribute('class');
      const errorStatusText = await page.locator('#connectionStatusText').textContent();
      const errorRetryBtn = page.locator('#connectionRetryBtn');
      const errorRetryVisible = await errorRetryBtn.isVisible();

      console.log(`   ✓ Status bar classes: ${errorStatusClasses}`);
      console.log(`   ✓ Status text: "${errorStatusText}"`);
      console.log(`   ✓ Retry button visible: ${errorRetryVisible}`);

      const hasErrorClass = errorStatusClasses.includes('error');
      console.log(`   ${hasErrorClass ? '✓' : '✗'} Error state triggered: ${hasErrorClass}`);

      // Take screenshot of error state
      await page.screenshot({ path: 'tests/screenshots/live-error-state.png', fullPage: true });
      console.log('   ✓ Screenshot saved: live-error-state.png\n');

      // Test 5: Wait for Auto-Retry
      console.log('📍 Test 5: Testing auto-retry');
      console.log('   ⏳ Waiting 6 seconds for auto-retry...');
      await page.waitForTimeout(6000);

      const retryStatusText = await page.locator('#connectionStatusText').textContent();
      console.log(`   ✓ Status after wait: "${retryStatusText}"`);

      const hasRetried = retryStatusText.includes('Retrying') || retryStatusText.includes('attempt');
      console.log(`   ${hasRetried ? '✓' : '✗'} Auto-retry triggered: ${hasRetried}\n`);
    } else {
      console.log('   ⚠️  Refresh button not found\n');
    }

    // Summary
    console.log('═══════════════════════════════════════');
    console.log('✅ Live error handling tests completed!');
    console.log('═══════════════════════════════════════');
    console.log('\n📸 Screenshots saved to tests/screenshots/');
    console.log('   - live-initial.png');
    console.log('   - live-error-state.png\n');

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
testLiveErrorHandling().catch(console.error);
