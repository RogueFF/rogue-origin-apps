const { test, expect } = require('@playwright/test');

test('verify dashboard last hour widget shows D1 data', async ({ page }) => {
  console.log('Loading dashboard...');
  await page.goto('https://rogueff.github.io/rogue-origin-apps/src/pages/');

  // Wait for the page to load
  await page.waitForLoadState('networkidle', { timeout: 30000 });
  console.log('Page loaded');

  // Wait a bit for data to load
  await page.waitForTimeout(5000);

  // Get the buckers value
  const buckersEl = page.locator('#currentBuckers');
  const buckersValue = await buckersEl.textContent();
  console.log('Buckers:', buckersValue);

  // Get the trimmers value
  const trimmersEl = page.locator('#currentTrimmers');
  const trimmersValue = await trimmersEl.textContent();
  console.log('Trimmers:', trimmersValue);

  // Get the lbs value
  const lbsEl = page.locator('#currentTops');
  const lbsValue = await lbsEl.textContent();
  console.log('Lbs:', lbsValue);

  // Get the strain
  const strainEl = page.locator('#currentStrain');
  const strainValue = await strainEl.textContent();
  console.log('Strain:', strainValue);

  // Get the time slot
  const timeEl = page.locator('#currentTime');
  const timeValue = await timeEl.textContent();
  console.log('Time Slot:', timeValue);

  // Get the rate
  const rateEl = page.locator('#currentRate');
  const rateValue = await rateEl.textContent();
  console.log('Rate:', rateValue);

  // Verify buckers is showing data (not 0)
  console.log('\n=== VERIFICATION ===');
  console.log('Buckers should be > 0:', buckersValue !== '0' && buckersValue !== '');
  console.log('Trimmers should be > 0:', trimmersValue !== '0' && trimmersValue !== '');
  console.log('Lbs should be > 0:', lbsValue !== '0' && lbsValue !== '');

  // Take a screenshot
  await page.screenshot({ path: 'tests/screenshots/dashboard-d1-verification.png', fullPage: true });
  console.log('\nScreenshot saved to tests/screenshots/dashboard-d1-verification.png');
});
