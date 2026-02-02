const { chromium } = require('playwright');

(async () => {
  console.log('Testing timer freeze behavior on scoreboard...\n');

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    // Navigate to scoreboard
    console.log('1. Navigating to scoreboard...');
    await page.goto('https://rogueff.github.io/rogue-origin-apps/src/pages/scoreboard.html');

    // Wait for page to load
    console.log('2. Waiting for data to load...');
    await page.waitForTimeout(10000);

    // Check if ScoreboardState is defined
    console.log('3. Checking if ScoreboardState is available...');
    const hasState = await page.evaluate(() => {
      return typeof ScoreboardState !== 'undefined';
    });
    console.log('   ScoreboardState defined:', hasState);

    // Check if testBreakMode is defined
    console.log('4. Checking if testBreakMode is available...');
    const hasTestMode = await page.evaluate(() => {
      return typeof testBreakMode !== 'undefined';
    });
    console.log('   testBreakMode defined:', hasTestMode);

    if (!hasState || !hasTestMode) {
      console.log('\n❌ Functions not available. Service worker may still be caching old code.');
      console.log('   Try: Hard refresh (Ctrl+Shift+R) in browser');
      await browser.close();
      return;
    }

    // Get current timer value
    console.log('\n5. Getting current timer value...');
    const timerBefore = await page.evaluate(() => {
      const timerEl = document.querySelector('.timer-value');
      return timerEl ? timerEl.textContent.trim() : 'NOT FOUND';
    });
    console.log('   Timer before break:', timerBefore);

    // Enable break mode
    console.log('\n6. Enabling break mode...');
    await page.evaluate(() => {
      testBreakMode(true);
    });
    console.log('   ✓ Break mode enabled');

    // Wait 5 seconds and check if timer froze
    console.log('7. Waiting 5 seconds to see if timer freezes...');
    await page.waitForTimeout(5000);

    const timerAfter = await page.evaluate(() => {
      const timerEl = document.querySelector('.timer-value');
      return timerEl ? timerEl.textContent.trim() : 'NOT FOUND';
    });
    console.log('   Timer after 5 seconds:', timerAfter);

    // Check timer color (should be yellow/gold for break)
    const timerColor = await page.evaluate(() => {
      const timerEl = document.querySelector('.timer-value');
      if (!timerEl) return 'NOT FOUND';
      const style = window.getComputedStyle(timerEl);
      return style.color;
    });
    console.log('   Timer color:', timerColor);

    // Compare timers
    if (timerBefore === timerAfter) {
      console.log('\n✅ SUCCESS: Timer is FROZEN during break!');
    } else {
      console.log('\n❌ ISSUE: Timer changed from', timerBefore, 'to', timerAfter);
      console.log('   Timer should freeze when break mode is enabled');
    }

    // Disable break mode
    console.log('\n8. Disabling break mode...');
    await page.evaluate(() => {
      testBreakMode(false);
    });
    console.log('   ✓ Break mode disabled');

    // Wait 3 seconds and verify timer is running again
    await page.waitForTimeout(3000);
    const timerFinal = await page.evaluate(() => {
      const timerEl = document.querySelector('.timer-value');
      return timerEl ? timerEl.textContent.trim() : 'NOT FOUND';
    });
    console.log('   Timer after disabling break:', timerFinal);

    if (timerFinal !== timerAfter) {
      console.log('   ✓ Timer is running again (changed from', timerAfter, 'to', timerFinal, ')');
    }

    // Scroll to bottom to check for order queue
    console.log('\n9. Scrolling to bottom to check for order queue...');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);

    // Take screenshot
    await page.screenshot({ path: 'test-timer-freeze.png', fullPage: true });
    console.log('📸 Screenshot saved to: test-timer-freeze.png');

    // Check for order queue section
    const hasOrderQueue = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('ORDER QUEUE') || text.includes('CURRENT ORDER') || text.includes('Sour Lifter');
    });
    console.log('\n10. Order queue section found:', hasOrderQueue);

    // Check console for errors
    const consoleMessages = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleMessages.push(msg.text());
      }
    });

    if (consoleMessages.length > 0) {
      console.log('\n11. Browser console errors:');
      consoleMessages.forEach(msg => console.log('   -', msg));
    }

  } catch (error) {
    console.error('Error during test:', error);
  } finally {
    console.log('\n✅ Test complete! You can manually verify the timer behavior in the browser window.');
    console.log('   The browser will stay open for inspection. Close it when done.');
    // Don't close browser - let user inspect
    // await browser.close();
  }
})();
