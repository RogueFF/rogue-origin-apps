const { test, expect } = require('@playwright/test');

test.describe('Scoreboard iframe in dashboard', () => {
  test('should not have black space when scrolling and should resize when sidebar collapses', async ({ page }) => {
    // Navigate to the dashboard
    await page.goto('https://rogueff.github.io/rogue-origin-apps/');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Click on Scoreboard navigation item
    await page.click('text=Scoreboard');

    // Wait for iframe to load
    await page.waitForSelector('#scoreboardFrame', { state: 'visible' });

    // Get initial measurements
    const initialMainWidth = await page.locator('.main').evaluate(el => el.offsetWidth);
    const initialIframeWidth = await page.locator('#scoreboardFrame').evaluate(el => el.offsetWidth);

    console.log('Initial main width:', initialMainWidth);
    console.log('Initial iframe width:', initialIframeWidth);

    // Check if sidebar is visible
    const sidebarVisible = await page.locator('.sidebar').isVisible();
    console.log('Sidebar visible:', sidebarVisible);

    // Collapse the sidebar
    await page.click('.sidebar-toggle');
    await page.waitForTimeout(500); // Wait for transition

    // Get measurements after collapse
    const collapsedMainWidth = await page.locator('.main').evaluate(el => el.offsetWidth);
    const collapsedIframeWidth = await page.locator('#scoreboardFrame').evaluate(el => el.offsetWidth);

    console.log('After collapse main width:', collapsedMainWidth);
    console.log('After collapse iframe width:', collapsedIframeWidth);

    // Check that main area got wider (sidebar collapsed)
    expect(collapsedMainWidth).toBeGreaterThan(initialMainWidth);

    // Check that iframe filled the new space
    expect(collapsedIframeWidth).toBeGreaterThan(initialIframeWidth);

    // Switch to iframe context to check scrolling
    const frame = page.frameLocator('#scoreboardFrame');

    // Check if body has overflow: auto (allows scrolling)
    const bodyOverflow = await page.evaluate(() => {
      const iframe = document.getElementById('scoreboardFrame');
      const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
      return window.getComputedStyle(iframeDoc.body).overflow;
    });

    console.log('Body overflow style:', bodyOverflow);
    expect(bodyOverflow).toBe('auto');

    // Take screenshots for visual verification
    await page.screenshot({ path: 'tests/screenshots/scoreboard-expanded-sidebar.png', fullPage: true });

    await page.click('.sidebar-toggle'); // Expand sidebar back
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'tests/screenshots/scoreboard-collapsed-sidebar.png', fullPage: true });
  });
});
