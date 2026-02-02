const { chromium } = require('playwright');

(async () => {
  console.log('Testing order queue section on scoreboard...\n');

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    // Navigate to scoreboard
    console.log('1. Navigating to scoreboard...');
    await page.goto('https://rogueff.github.io/rogue-origin-apps/src/pages/scoreboard.html');

    // Wait for API calls
    console.log('2. Waiting for data to load...');
    await page.waitForTimeout(10000);

    // Scroll to bottom to see order queue
    console.log('3. Scrolling to bottom...');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    // Take full page screenshot
    await page.screenshot({ path: 'test-scoreboard-full.png', fullPage: true });
    console.log('📸 Full page screenshot saved to: test-scoreboard-full.png');

    // Get all text after scrolling
    const allText = await page.evaluate(() => document.body.innerText);

    // Look for order queue keywords
    console.log('\n4. Checking for order queue...');
    const hasOrderQueue = allText.includes('ORDER QUEUE') || allText.includes('CURRENT ORDER') || allText.includes('NEXT ORDER');
    console.log('   Order queue section found:', hasOrderQueue);

    // Look for progress indicators
    const progressMatches = allText.match(/(\d+)\/(\d+)\s*kg/gi);
    if (progressMatches && progressMatches.length > 0) {
      console.log('\n5. Progress indicators found:');
      progressMatches.forEach(match => {
        console.log('   -', match);
      });
    } else {
      console.log('\n5. No progress indicators (XX/XXkg) found');
    }

    // Check console for errors
    console.log('\n6. Checking browser console...');
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log('   Browser error:', msg.text());
      }
    });

    // Look for specific text patterns
    const lines = allText.split('\n');
    const relevantLines = lines.filter(line =>
      line.includes('Sour Lifter') ||
      line.includes('kg') ||
      line.includes('ORDER') ||
      line.includes('QUEUE') ||
      line.toLowerCase().includes('current')
    );

    if (relevantLines.length > 0) {
      console.log('\n7. Relevant lines found:');
      relevantLines.forEach(line => console.log('   ', line.trim()));
    }

  } catch (error) {
    console.error('Error during test:', error);
  } finally {
    await browser.close();
    console.log('\nTest complete!');
  }
})();
