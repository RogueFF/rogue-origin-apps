/**
 * Check Orders App Status
 * Quick test to see what's deployed on the live site
 */

const { chromium } = require('playwright');

async function checkOrdersApp() {
  console.log('🔍 Checking live orders app...\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Load orders page
    console.log('📍 Loading orders page');
    const url = 'https://rogueff.github.io/rogue-origin-apps/src/pages/orders.html';
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Check for password protection
    const passwordInput = page.locator('input[type="password"]');
    const passwordExists = await passwordInput.count() > 0;

    if (passwordExists) {
      console.log('   ℹ️  Password protection detected');
      console.log('   ⚠️  Need password to proceed\n');
    } else {
      console.log('   ✓ Page loaded (no password required)\n');
    }

    // Check for main elements
    console.log('📍 Checking page elements');

    const ordersTable = page.locator('table, .orders-table, [data-orders]');
    const hasTable = await ordersTable.count() > 0;
    console.log(`   ${hasTable ? '✓' : '✗'} Orders table found: ${hasTable}`);

    const addButton = page.locator('button:has-text("Add"), button:has-text("New"), button:has-text("Create")');
    const hasAddButton = await addButton.count() > 0;
    console.log(`   ${hasAddButton ? '✓' : '✗'} Add/New order button: ${hasAddButton}`);

    // Check console for API calls
    const apiCalls = [];
    page.on('request', request => {
      const url = request.url();
      if (url.includes('script.google.com') || url.includes('exec')) {
        apiCalls.push(url);
        console.log(`   🔗 API call detected: ${url.substring(0, 80)}...`);
      }
    });

    // Wait a bit to see if any API calls are made
    await page.waitForTimeout(3000);

    if (apiCalls.length > 0) {
      console.log(`\n   ✓ Found ${apiCalls.length} API call(s) - Backend connected!`);
    } else {
      console.log('\n   ℹ️  No API calls detected - May be using static data');
    }

    // Take screenshot
    await page.screenshot({ path: 'tests/screenshots/orders-page.png', fullPage: true });
    console.log('\n   ✓ Screenshot saved: orders-page.png\n');

    console.log('═══════════════════════════════════════');
    console.log('Keep browser open for manual inspection...');
    console.log('═══════════════════════════════════════\n');

    // Keep open for 60 seconds
    await page.waitForTimeout(60000);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
  }
}

checkOrdersApp().catch(console.error);
