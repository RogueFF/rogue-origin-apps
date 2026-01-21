// @ts-check
const { test, expect } = require('@playwright/test');

const BASE_URL = 'https://rogueff.github.io/rogue-origin-apps';
const PASSWORD = 'costco';

test('customer dropdown has customers', async ({ page }) => {
  // Log console messages
  page.on('console', msg => {
    console.log(`[${msg.type()}]`, msg.text());
  });

  // Set auth session in localStorage before loading page
  await page.goto(`${BASE_URL}/src/pages/orders.html`);
  await page.evaluate(() => {
    const session = {
      sessionToken: 'test-session-token',
      timestamp: Date.now(),
      expiresIn: 86400000 // 24 hours
    };
    localStorage.setItem('orders_auth_session', JSON.stringify(session));
  });

  // Reload page - now it should be authenticated
  await page.reload();

  // Wait for data to load (auth overlay should not appear)
  await page.waitForTimeout(5000);

  // Click New Order button
  await page.click('button:has-text("New Order")');

  // Wait for modal
  await page.waitForSelector('#order-modal', { state: 'visible', timeout: 5000 });

  // Check customer dropdown
  const customerSelect = page.locator('#order-customer');
  await expect(customerSelect).toBeVisible();

  // Get all options
  const options = await customerSelect.locator('option').allTextContents();
  console.log('Customer dropdown options:', options);

  // Should have more than just the placeholder
  expect(options.length).toBeGreaterThan(1);

  // Check if Cannaflora is in the list
  const hasCannaflora = options.some(opt => opt.includes('Cannaflora'));
  console.log('Has Cannaflora:', hasCannaflora);
  expect(hasCannaflora).toBe(true);
});
