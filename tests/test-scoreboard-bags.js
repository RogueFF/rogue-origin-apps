const { chromium } = require('playwright');

(async () => {
  console.log('Testing scoreboard bag counting...\n');

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    // Navigate to scoreboard
    console.log('1. Navigating to scoreboard...');
    await page.goto('https://rogueff.github.io/rogue-origin-apps/src/pages/scoreboard.html');

    // Wait for order queue API call
    console.log('2. Waiting for order queue to load...');
    await page.waitForTimeout(10000);

    // Get all text content
    const allText = await page.evaluate(() => document.body.innerText);

    // Look for order queue section
    console.log('3. Checking order queue...\n');

    // Look for any progress indicators
    const progressMatches = allText.match(/(\d+)\/(\d+)\s*kg/gi);
    if (progressMatches && progressMatches.length > 0) {
      console.log('Found progress indicators:', progressMatches);

      // Extract the numbers
      progressMatches.forEach(match => {
        const numbers = match.match(/(\d+)\/(\d+)/);
        if (numbers) {
          const completed = numbers[1];
          const total = numbers[2];
          console.log(`  → ${completed}/${total}kg`);

          if (completed === '30' && total === '120') {
            console.log('    ✅ SUCCESS: Sour Lifter showing 30/120kg - Bag counting works!');
          } else if (completed === '20' && total === '120') {
            console.log('    ❌ ISSUE: Still showing 20/120kg - Bag counting not working');
          }
        }
      });
    } else {
      console.log('No progress indicators found');
    }

    // Look for "Sour Lifter" specifically
    if (allText.includes('Sour Lifter')) {
      console.log('\n✓ Found "Sour Lifter" on scoreboard');

      // Get context around Sour Lifter
      const lines = allText.split('\n');
      lines.forEach((line, index) => {
        if (line.includes('Sour Lifter')) {
          console.log(`\nContext around "Sour Lifter":`);
          console.log(lines.slice(Math.max(0, index - 2), index + 3).join('\n'));
        }
      });
    } else {
      console.log('\n❌ "Sour Lifter" not found on scoreboard');
    }

    // Take screenshot
    await page.screenshot({ path: 'test-scoreboard.png', fullPage: true });
    console.log('\n📸 Screenshot saved to: test-scoreboard.png');

  } catch (error) {
    console.error('Error during test:', error);
  } finally {
    await browser.close();
    console.log('\nTest complete!');
  }
})();
