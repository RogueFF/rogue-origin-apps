const { test, expect } = require('@playwright/test');

test('debug dashboard loading', async ({ page }) => {
  console.log('Loading dashboard...');
  await page.goto('https://rogueff.github.io/rogue-origin-apps/src/pages/');

  // Wait a bit
  await page.waitForTimeout(5000);

  // Take a screenshot
  await page.screenshot({ path: 'tests/screenshots/dashboard-debug.png', fullPage: true });
  console.log('Screenshot saved');

  // Get console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('Console error:', msg.text());
    }
  });

  // Check if the page loaded
  const title = await page.title();
  console.log('Page title:', title);

  // Check what's on the page
  const bodyText = await page.locator('body').textContent();
  console.log('Body text (first 500 chars):', bodyText.substring(0, 500));
});
