const { test, expect } = require('@playwright/test');

test.describe('Carryover bag tracking and one-click start button', () => {
  test('should verify carryover tracking is working', async ({ page }) => {
    // Navigate to scoreboard
    await page.goto('https://rogueff.github.io/rogue-origin-apps/src/pages/scoreboard.html');
    await page.waitForLoadState('networkidle');

    console.log('Page loaded, waiting for data...');

    // Wait for data to load (look for timer or cycle history)
    await page.waitForTimeout(5000);

    // Take initial screenshot
    await page.screenshot({ path: 'tests/screenshots/carryover-initial.png', fullPage: true });

    // Check if cycle history panel exists
    const cyclePanel = await page.locator('#cycleHistoryPanel').count();
    console.log('Cycle history panel exists:', cyclePanel > 0);

    if (cyclePanel > 0) {
      // Expand cycle history if collapsed
      const isCollapsed = await page.evaluate(() => {
        const panel = document.getElementById('cycleHistoryPanel');
        return panel ? panel.classList.contains('collapsed') : false;
      });

      if (isCollapsed) {
        console.log('Expanding cycle history...');
        await page.click('#cycleHistoryToggle');
        await page.waitForTimeout(500);
      }

      // Get cycle history data from the page
      const cycleData = await page.evaluate(() => {
        const cycles = window.ScoreboardState?.cycleHistory || [];
        return cycles.map(c => ({
          time: c.time,
          isCarryover: c.isCarryover,
          timestamp: c.timestamp
        }));
      });

      console.log('Cycle history data:', JSON.stringify(cycleData, null, 2));

      // Check for carryover cycles
      const carryoverCycles = cycleData.filter(c => c.isCarryover);
      console.log('Carryover cycles found:', carryoverCycles.length);

      if (carryoverCycles.length > 0) {
        console.log('Carryover cycles:', JSON.stringify(carryoverCycles, null, 2));
      }

      // Check for 0-minute cycles (should be none)
      const zeroCycles = cycleData.filter(c => c.time === 0);
      console.log('Zero-minute cycles found:', zeroCycles.length);
      expect(zeroCycles.length).toBe(0);

      // Look for carryover symbol ⟲ in the DOM
      const carryoverSymbols = await page.evaluate(() => {
        const content = document.getElementById('cycleContent');
        if (!content) return 0;
        const html = content.innerHTML;
        return (html.match(/⟲/g) || []).length;
      });

      console.log('Carryover symbols (⟲) found in DOM:', carryoverSymbols);

      // Take screenshot of cycle history
      await page.screenshot({ path: 'tests/screenshots/carryover-cycles.png', fullPage: true });
    }

    // Check API response directly
    const apiResponse = await page.evaluate(async () => {
      const apiUrl = 'https://script.google.com/macros/s/AKfycbxDAHSFl9cedGS49L3Lf5ztqy-SSToYigyA30ZtsdpmWNAR9H61X_Mm48JOOTGqqr-Z/exec';
      try {
        const response = await fetch(`${apiUrl}?action=timer`);
        const data = await response.json();
        return {
          success: true,
          cycleHistory: data.cycleHistory || [],
          bagsToday: data.bagsToday || 0
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    console.log('API Response:', JSON.stringify(apiResponse, null, 2));

    if (apiResponse.success && apiResponse.cycleHistory) {
      console.log('Total cycles from API:', apiResponse.cycleHistory.length);

      const carryoverFromAPI = apiResponse.cycleHistory.filter(c => c.isCarryover);
      console.log('Carryover cycles from API:', carryoverFromAPI.length);

      if (carryoverFromAPI.length > 0) {
        console.log('Carryover cycle details:', JSON.stringify(carryoverFromAPI, null, 2));
      }

      const zeroFromAPI = apiResponse.cycleHistory.filter(c => c.cycleTime === 0);
      console.log('Zero-minute cycles from API:', zeroFromAPI.length);
      expect(zeroFromAPI.length).toBe(0);
    }
  });

  test('should verify one-click start button', async ({ page }) => {
    // Navigate to scoreboard
    await page.goto('https://rogueff.github.io/rogue-origin-apps/src/pages/scoreboard.html');
    await page.waitForLoadState('networkidle');

    console.log('Checking start button behavior...');
    await page.waitForTimeout(3000);

    // Check if start button is visible
    const startBtnVisible = await page.locator('#startDayBtn').isVisible();
    console.log('Start Day button visible:', startBtnVisible);

    // Check if started badge is visible (shift already started)
    const badgeVisible = await page.locator('#startedBadge').isVisible();
    console.log('Started badge visible:', badgeVisible);

    if (badgeVisible) {
      // Get the displayed start time
      const startTimeText = await page.locator('#startTimeDisplay').textContent();
      console.log('Current shift start time:', startTimeText);

      // Check if it's locked
      const isLocked = await page.evaluate(() => {
        const badge = document.getElementById('startedBadge');
        return badge ? badge.classList.contains('locked') : false;
      });
      console.log('Shift start locked:', isLocked);
    }

    // Take screenshot
    await page.screenshot({ path: 'tests/screenshots/start-button-state.png', fullPage: true });

    // Check shift start data from localStorage
    const localStorageData = await page.evaluate(() => {
      return {
        manualShiftStart: localStorage.getItem('manualShiftStart'),
        shiftStartLocked: localStorage.getItem('shiftStartLocked'),
        shiftStartDate: localStorage.getItem('shiftStartDate')
      };
    });

    console.log('LocalStorage shift data:', localStorageData);

    // Verify API can handle shift start request
    const apiAvailable = await page.evaluate(async () => {
      return typeof window.ScoreboardAPI !== 'undefined'
        && typeof window.ScoreboardAPI.setShiftStart === 'function';
    });

    console.log('Shift start API available:', apiAvailable);
    expect(apiAvailable).toBe(true);
  });

  test('should check cycle time display formats', async ({ page }) => {
    await page.goto('https://rogueff.github.io/rogue-origin-apps/src/pages/scoreboard.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);

    // Cycle through all display modes
    const modes = ['Donut', 'Bars', 'Grid', 'Cards', 'List'];

    for (let i = 0; i < modes.length; i++) {
      console.log(`\nTesting mode: ${modes[i]}`);

      // Click next mode button
      if (i > 0) {
        const nextBtn = await page.locator('[onclick="ScoreboardCycle.nextCycleMode()"]');
        if (await nextBtn.count() > 0) {
          await nextBtn.click();
          await page.waitForTimeout(500);
        }
      }

      // Check for carryover symbols in current mode
      const carryoverCount = await page.evaluate(() => {
        const content = document.getElementById('cycleContent');
        if (!content) return 0;
        const text = content.textContent;
        return (text.match(/⟲/g) || []).length;
      });

      console.log(`Carryover symbols in ${modes[i]} mode:`, carryoverCount);

      // Take screenshot of each mode
      await page.screenshot({
        path: `tests/screenshots/cycle-mode-${modes[i].toLowerCase()}.png`,
        fullPage: true
      });
    }
  });
});
