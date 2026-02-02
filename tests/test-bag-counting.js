const { chromium } = require('playwright');

(async () => {
  console.log('Starting Playwright test for bag counting...\n');

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    // Navigate to orders page
    console.log('1. Navigating to orders page...');
    await page.goto('https://rogueff.github.io/rogue-origin-apps/src/pages/orders.html');

    // Wait for page to load and API calls to complete
    console.log('2. Waiting for API calls to complete...');
    await page.waitForTimeout(8000);

    // Look for the Sour Lifter order
    console.log('3. Looking for Sour Lifter shipment...');

    // Try to find any text containing "Sour Lifter"
    const allText = await page.evaluate(() => document.body.innerText);
    console.log('\n--- Page contains "Sour Lifter":', allText.includes('Sour Lifter'));

    // Look for progress indicators (e.g., "30/120kg")
    const progressMatches = allText.match(/(\d+)\/(\d+)kg/g);
    console.log('--- Progress indicators found:', progressMatches);

    // Look specifically for Sour Lifter progress
    const sourLifterMatch = allText.match(/Sour Lifter[^\n]*?(\d+)\/(\d+)kg/);
    if (sourLifterMatch) {
      const completed = sourLifterMatch[1];
      const total = sourLifterMatch[2];
      console.log(`\n✓ Found Sour Lifter progress: ${completed}/${total}kg`);

      if (completed === '30') {
        console.log('✅ SUCCESS: Bag counting is working correctly (30kg)');
      } else if (completed === '20') {
        console.log('❌ ISSUE: Still showing 20kg (should be 30kg)');
      } else {
        console.log(`⚠️  Unexpected value: ${completed}kg`);
      }
    } else {
      console.log('❌ Could not find Sour Lifter progress indicator');

      // Try to find the order details
      if (allText.includes('MO-2026-002')) {
        console.log('--- Order MO-2026-002 found on page');
      }
    }

    // Take a screenshot
    await page.screenshot({ path: 'test-orders-page.png', fullPage: true });
    console.log('\n📸 Screenshot saved to: test-orders-page.png');

  } catch (error) {
    console.error('Error during test:', error);
  } finally {
    await browser.close();
    console.log('\nTest complete!');
  }
})();
