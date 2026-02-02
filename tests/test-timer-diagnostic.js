const { chromium } = require('playwright');

(async () => {
  console.log('Diagnostic test for timer freeze behavior...\n');

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // Capture console logs
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[DIAG]') || text.includes('[TEST]')) {
      console.log('  Browser:', text);
    }
  });

  try {
    console.log('1. Loading scoreboard...');
    await page.goto('https://rogueff.github.io/rogue-origin-apps/src/pages/scoreboard.html');
    await page.waitForTimeout(10000);

    // Get timer value before break
    const before = await page.evaluate(() => {
      const timerEl = document.querySelector('.timer-value');
      return timerEl ? timerEl.textContent.trim() : 'NOT FOUND';
    });
    console.log('2. Timer before break:', before);

    // Enable break mode and log diagnostic info
    console.log('\n3. Enabling break mode with diagnostics...');
    await page.evaluate(() => {
      // Enable break mode
      testBreakMode(true);

      // Log diagnostic info
      console.log('[DIAG] debugOnBreak:', ScoreboardState.debugOnBreak);
      console.log('[DIAG] debugBreakStartTime:', ScoreboardState.debugBreakStartTime);
      console.log('[DIAG] lastBagTimestamp:', ScoreboardState.lastBagTimestamp);
    });

    // Wait 3 seconds and check timer values
    await page.waitForTimeout(3000);

    const diagnostic1 = await page.evaluate(() => {
      // Get internal calculation values
      const now = new Date();
      const breakStart = ScoreboardState.debugBreakStartTime;
      const lastBag = ScoreboardState.lastBagTimestamp;

      return {
        now: now.toTimeString().substring(0, 8),
        breakStart: breakStart ? breakStart.toTimeString().substring(0, 8) : 'null',
        lastBag: lastBag ? lastBag.toTimeString().substring(0, 8) : 'null',
        timerValue: document.querySelector('.timer-value')?.textContent.trim()
      };
    });

    console.log('4. After 3 seconds:');
    console.log('   Current time:', diagnostic1.now);
    console.log('   Break start (cached):', diagnostic1.breakStart);
    console.log('   Last bag time:', diagnostic1.lastBag);
    console.log('   Timer display:', diagnostic1.timerValue);

    // Wait another 3 seconds
    await page.waitForTimeout(3000);

    const diagnostic2 = await page.evaluate(() => {
      const now = new Date();
      const breakStart = ScoreboardState.debugBreakStartTime;

      return {
        now: now.toTimeString().substring(0, 8),
        breakStart: breakStart ? breakStart.toTimeString().substring(0, 8) : 'null',
        timerValue: document.querySelector('.timer-value')?.textContent.trim(),
        breakStartChanged: ScoreboardState.debugBreakStartTime?.getTime()
      };
    });

    console.log('\n5. After 6 seconds total:');
    console.log('   Current time:', diagnostic2.now);
    console.log('   Break start (cached):', diagnostic2.breakStart);
    console.log('   Timer display:', diagnostic2.timerValue);

    // Check if break start time changed
    const breakTimestamp1 = await page.evaluate(() => ScoreboardState.debugBreakStartTime?.getTime());
    await page.waitForTimeout(2000);
    const breakTimestamp2 = await page.evaluate(() => ScoreboardState.debugBreakStartTime?.getTime());

    console.log('\n6. Break start timestamp check:');
    console.log('   First check:', breakTimestamp1);
    console.log('   Second check (2s later):', breakTimestamp2);
    console.log('   Changed?:', breakTimestamp1 !== breakTimestamp2 ? '❌ YES (BUG!)' : '✓ NO (correct)');

    if (diagnostic1.timerValue === diagnostic2.timerValue) {
      console.log('\n✅ Timer FROZEN correctly!');
    } else {
      console.log('\n❌ Timer changed from', diagnostic1.timerValue, 'to', diagnostic2.timerValue);
      console.log('   Timer should be frozen during break mode');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    console.log('\n✅ Diagnostic complete! Browser will stay open for inspection.');
    // Keep browser open
  }
})();
