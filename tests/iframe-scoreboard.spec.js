const { test, expect } = require('@playwright/test');

test.describe('Scoreboard iframe CSS verification', () => {
  test('should check if CSS changes are deployed', async ({ page }) => {
    // Go directly to scoreboard page to check CSS
    await page.goto('https://rogueff.github.io/rogue-origin-apps/src/pages/scoreboard.html');
    await page.waitForLoadState('networkidle');

    // Add iframe-embed class to body (simulating iframe mode)
    await page.evaluate(() => {
      document.body.classList.add('iframe-embed');
    });

    // Wait a moment for styles to apply
    await page.waitForTimeout(100);

    // Check body overflow style
    const bodyOverflow = await page.evaluate(() => {
      return window.getComputedStyle(document.body).overflow;
    });

    console.log('Body overflow (should be "auto"):', bodyOverflow);

    // Check main-panel height
    const mainPanelHeight = await page.evaluate(() => {
      const el = document.querySelector('.main-panel');
      if (!el) return null;
      return {
        height: window.getComputedStyle(el).height,
        flex: window.getComputedStyle(el).flex
      };
    });

    console.log('Main panel styles:', mainPanelHeight);

    // Check timer-panel width
    const timerPanelWidth = await page.evaluate(() => {
      const el = document.querySelector('.timer-panel');
      if (!el) return null;
      return {
        width: window.getComputedStyle(el).width,
        minWidth: window.getComputedStyle(el).minWidth,
        maxWidth: window.getComputedStyle(el).maxWidth
      };
    });

    console.log('Timer panel width styles:', timerPanelWidth);

    // Take screenshot
    await page.screenshot({ path: 'tests/screenshots/scoreboard-css-check.png', fullPage: true });

    // Verify the changes
    expect(bodyOverflow).toBe('auto');

    if (timerPanelWidth) {
      console.log('Timer panel min-width:', timerPanelWidth.minWidth);
      console.log('Timer panel max-width:', timerPanelWidth.maxWidth);
    }
  });

  test('should check dashboard iframe integration', async ({ page }) => {
    // Navigate to the dashboard
    await page.goto('https://rogueff.github.io/rogue-origin-apps/');
    await page.waitForLoadState('networkidle');

    // Wait for loading to finish
    await page.waitForTimeout(2000);

    // Click on Scoreboard in sidebar
    await page.click('[data-view="scoreboard"]');
    await page.waitForTimeout(1000);

    // Wait for iframe to load
    await page.waitForSelector('#scoreboardFrame', { state: 'visible', timeout: 10000 });

    // Get iframe element
    const iframeExists = await page.locator('#scoreboardFrame').count();
    console.log('Iframe exists:', iframeExists > 0);

    // Check if iframe loaded
    const iframeSrc = await page.locator('#scoreboardFrame').getAttribute('src');
    console.log('Iframe src:', iframeSrc);

    // Get initial sidebar state
    const sidebarCollapsed = await page.evaluate(() => {
      return document.body.classList.contains('sidebar-collapsed');
    });
    console.log('Initial sidebar collapsed:', sidebarCollapsed);

    // Get initial measurements
    const initialWidth = await page.locator('.main').evaluate(el => el.offsetWidth);
    console.log('Initial main width:', initialWidth);

    // Take screenshot before collapse
    await page.screenshot({ path: 'tests/screenshots/iframe-sidebar-expanded.png', fullPage: true });

    // Collapse the sidebar
    await page.click('.sidebar-toggle');
    await page.waitForTimeout(500);

    // Get measurements after collapse
    const collapsedWidth = await page.locator('.main').evaluate(el => el.offsetWidth);
    console.log('After collapse main width:', collapsedWidth);

    const sidebarCollapsedAfter = await page.evaluate(() => {
      return document.body.classList.contains('sidebar-collapsed');
    });
    console.log('Sidebar collapsed after click:', sidebarCollapsedAfter);

    // Take screenshot after collapse
    await page.screenshot({ path: 'tests/screenshots/iframe-sidebar-collapsed.png', fullPage: true });

    // Verify sidebar collapsed
    expect(sidebarCollapsedAfter).toBe(true);
    expect(collapsedWidth).toBeGreaterThan(initialWidth);
  });
});
