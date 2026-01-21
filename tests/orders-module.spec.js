// @ts-check
const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:8080';

test.describe('Orders ES6 Module Tests', () => {
  test('page loads without JavaScript errors', async ({ page }) => {
    const errors = [];

    // Collect console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // Collect page errors
    page.on('pageerror', error => {
      errors.push(error.message);
    });

    // Navigate to the orders page
    await page.goto(`${BASE_URL}/src/pages/orders.html`);

    // Wait for module to initialize
    await page.waitForTimeout(2000);

    // Check for auth overlay (expected since we're not logged in)
    const authOverlay = page.locator('#auth-overlay');
    await expect(authOverlay).toBeVisible();

    // Filter out expected errors (like network requests that fail in file:// context)
    const unexpectedErrors = errors.filter(e =>
      !e.includes('Failed to fetch') &&
      !e.includes('NetworkError') &&
      !e.includes('CORS')
    );

    // Log all errors for debugging
    if (errors.length > 0) {
      console.log('Console errors:', errors);
    }

    // Check for module-specific errors (import/export issues)
    const moduleErrors = errors.filter(e =>
      e.includes('import') ||
      e.includes('export') ||
      e.includes('module') ||
      e.includes('is not defined') ||
      e.includes('Cannot read') ||
      e.includes('undefined')
    );

    expect(moduleErrors).toHaveLength(0);
  });

  test('modules export expected functions', async ({ page }) => {
    // Navigate to the orders page
    await page.goto(`${BASE_URL}/src/pages/orders.html`);

    // Wait for module to initialize
    await page.waitForTimeout(2000);

    // Check that window functions are exposed
    const windowFunctions = await page.evaluate(() => {
      return {
        hasOrderActions: typeof window.orderActions === 'object',
        hasShipmentActions: typeof window.shipmentActions === 'object',
        hasPaymentActions: typeof window.paymentActions === 'object',
        hasHandleLogin: typeof window.handleLogin === 'function',
        hasToggleTheme: typeof window.toggleTheme === 'function',
        hasShowToast: typeof window.showToast === 'function',
        hasSaveCustomer: typeof window.saveCustomer === 'function',
        hasSaveMasterOrder: typeof window.saveMasterOrder === 'function'
      };
    });

    console.log('Window functions:', windowFunctions);

    expect(windowFunctions.hasOrderActions).toBe(true);
    expect(windowFunctions.hasShipmentActions).toBe(true);
    expect(windowFunctions.hasPaymentActions).toBe(true);
    expect(windowFunctions.hasHandleLogin).toBe(true);
    expect(windowFunctions.hasToggleTheme).toBe(true);
    expect(windowFunctions.hasShowToast).toBe(true);
  });
});
