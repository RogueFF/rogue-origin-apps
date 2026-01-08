/**
 * Quick visual test - Open dashboard and take screenshots
 */

const puppeteer = require('puppeteer');
const path = require('path');

async function visualTest() {
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 50
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // Navigate to dashboard
  const htmlPath = 'file://' + path.join(__dirname, 'index.html');
  console.log('Opening:', htmlPath);
  await page.goto(htmlPath, { waitUntil: 'networkidle0' });

  // Wait for page to load
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Take initial screenshot
  await page.screenshot({ path: 'screenshots/01-initial-state.png', fullPage: false });
  console.log('✅ Screenshot 1: Initial state');

  // Click AI chat FAB
  console.log('Opening AI chat panel...');
  await page.click('.ai-chat-fab');
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Take AI chat screenshot
  await page.screenshot({ path: 'screenshots/02-ai-chat-open.png', fullPage: false });
  console.log('✅ Screenshot 2: AI chat open');

  // Get detailed measurements
  const measurements = await page.evaluate(() => {
    const panel = document.getElementById('aiChatPanel');
    const header = panel.querySelector('.ai-chat-header');
    const messages = panel.querySelector('.ai-chat-messages');
    const input = panel.querySelector('.ai-chat-input-area');

    const panelRect = panel.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const messagesRect = messages.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();

    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      panel: {
        top: panelRect.top,
        bottom: panelRect.bottom,
        height: panelRect.height,
        isOpen: panel.classList.contains('open')
      },
      header: {
        top: headerRect.top,
        bottom: headerRect.bottom,
        height: headerRect.height
      },
      messages: {
        top: messagesRect.top,
        bottom: messagesRect.bottom,
        height: messagesRect.height
      },
      input: {
        top: inputRect.top,
        bottom: inputRect.bottom,
        height: inputRect.height,
        visibleInViewport: inputRect.bottom <= window.innerHeight
      }
    };
  });

  console.log('\n📊 AI Chat Panel Measurements:');
  console.log('Viewport:', measurements.viewport);
  console.log('Panel:', measurements.panel);
  console.log('Header:', measurements.header);
  console.log('Messages:', measurements.messages);
  console.log('Input:', measurements.input);

  if (!measurements.input.visibleInViewport) {
    console.log('\n❌ PROBLEM: Input area is NOT visible in viewport!');
    console.log(`   Input bottom: ${measurements.input.bottom}`);
    console.log(`   Viewport height: ${measurements.viewport.height}`);
    console.log(`   Overflow: ${measurements.input.bottom - measurements.viewport.height}px`);
  } else {
    console.log('\n✅ Input area IS visible in viewport');
  }

  // Close AI chat
  await page.click('.ai-chat-fab');
  await new Promise(resolve => setTimeout(resolve, 500));

  // Open settings panel
  console.log('Opening settings panel...');
  await page.click('.settings-fab');
  await new Promise(resolve => setTimeout(resolve, 1000));

  await page.screenshot({ path: 'screenshots/03-settings-open.png', fullPage: false });
  console.log('✅ Screenshot 3: Settings panel open');

  console.log('\n🎯 Check screenshots/ folder for visual results');
  console.log('Press Ctrl+C when done inspecting the browser window');

  // Keep browser open for manual inspection
  await new Promise(resolve => setTimeout(resolve, 300000)); // 5 min timeout
}

visualTest().catch(console.error);
