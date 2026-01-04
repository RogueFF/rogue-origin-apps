/**
 * Automated Hybrid Dashboard Test Suite
 * Tests layout, positioning, interactions, and visual issues
 * Run with: node automated-dashboard-tests.js
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// Test configuration
const config = {
  headless: false, // Show browser for debugging
  slowMo: 100,     // Slow down actions for visibility
  viewport: {
    width: 1920,
    height: 1080
  }
};

// Test results storage
const results = {
  passed: [],
  failed: [],
  warnings: []
};

function log(type, test, message, details = null) {
  const entry = { test, message, details, timestamp: new Date().toISOString() };

  if (type === 'pass') {
    results.passed.push(entry);
    console.log(`✅ ${test}: ${message}`);
  } else if (type === 'fail') {
    results.failed.push(entry);
    console.log(`❌ ${test}: ${message}`);
    if (details) console.log(`   Details: ${JSON.stringify(details)}`);
  } else if (type === 'warn') {
    results.warnings.push(entry);
    console.log(`⚠️  ${test}: ${message}`);
  }
}

async function takeScreenshot(page, name) {
  const screenshotPath = path.join(__dirname, `screenshots/${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`📸 Screenshot saved: ${screenshotPath}`);
}

// Helper function for waiting (compatible with newer Puppeteer)
async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  const browser = await puppeteer.launch(config);
  const page = await browser.newPage();
  await page.setViewport(config.viewport);

  // Create screenshots directory
  const screenshotsDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir);
  }

  try {
    // Navigate to dashboard
    const htmlPath = 'file://' + path.join(__dirname, 'index.html');
    console.log(`\n🚀 Loading dashboard: ${htmlPath}\n`);
    await page.goto(htmlPath, { waitUntil: 'networkidle0' });
    await wait(2000); // Wait for initial layout

    // ============================================
    // TEST 1: Check for overlapping widgets on load
    // ============================================
    console.log('\n📋 TEST 1: Initial Layout - No Overlapping Widgets');
    const overlaps = await page.evaluate(() => {
      const widgets = Array.from(document.querySelectorAll('.widget-item:not(.muuri-item-hidden)'));
      const overlapping = [];

      for (let i = 0; i < widgets.length; i++) {
        const rect1 = widgets[i].getBoundingClientRect();
        for (let j = i + 1; j < widgets.length; j++) {
          const rect2 = widgets[j].getBoundingClientRect();

          // Check if rectangles overlap
          const overlap = !(
            rect1.right < rect2.left ||
            rect1.left > rect2.right ||
            rect1.bottom < rect2.top ||
            rect1.top > rect2.bottom
          );

          if (overlap) {
            overlapping.push({
              widget1: widgets[i].dataset.widgetId,
              widget2: widgets[j].dataset.widgetId,
              rect1: { top: rect1.top, left: rect1.left, width: rect1.width, height: rect1.height },
              rect2: { top: rect2.top, left: rect2.left, width: rect2.width, height: rect2.height }
            });
          }
        }
      }

      return overlapping;
    });

    if (overlaps.length === 0) {
      log('pass', 'Initial Layout', 'No overlapping widgets detected');
    } else {
      log('fail', 'Initial Layout', `Found ${overlaps.length} overlapping widget pairs`, overlaps);
      await takeScreenshot(page, 'overlapping-widgets-initial');
    }

    // ============================================
    // TEST 2: Settings Panel Positioning
    // ============================================
    console.log('\n📋 TEST 2: Settings Panel Positioning');

    // Open settings panel
    await page.click('.settings-fab');
    await wait(500);

    const settingsPosition = await page.evaluate(() => {
      const panel = document.getElementById('settingsPanel');
      if (!panel) return { error: 'Settings panel not found' };

      const rect = panel.getBoundingClientRect();
      const isVisible = panel.classList.contains('open');
      const isOnScreen = rect.right <= window.innerWidth && rect.left >= 0;

      return {
        isVisible,
        isOnScreen,
        position: { top: rect.top, right: rect.right, width: rect.width, height: rect.height },
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      };
    });

    if (settingsPosition.isVisible && settingsPosition.isOnScreen) {
      log('pass', 'Settings Panel', 'Opens correctly and is fully visible on screen');
    } else {
      log('fail', 'Settings Panel', 'Panel is not properly positioned', settingsPosition);
      await takeScreenshot(page, 'settings-panel-issue');
    }

    // Close settings
    await page.click('.settings-fab');
    await wait(500);

    // ============================================
    // TEST 3: AI Chat Panel Positioning
    // ============================================
    console.log('\n📋 TEST 3: AI Chat Panel Positioning');

    // Open AI chat panel
    await page.click('.ai-chat-fab');
    await wait(500);

    const aiChatPosition = await page.evaluate(() => {
      const panel = document.getElementById('aiChatPanel');
      if (!panel) return { error: 'AI Chat panel not found' };

      const rect = panel.getBoundingClientRect();
      const isVisible = panel.classList.contains('open');
      const isOnScreen = rect.right <= window.innerWidth && rect.left >= 0;

      const messagesArea = panel.querySelector('.ai-chat-messages');
      const inputArea = panel.querySelector('.ai-chat-input-area');
      const header = panel.querySelector('.ai-chat-header');

      return {
        isVisible,
        isOnScreen,
        panelPosition: { top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
        headerHeight: header ? header.getBoundingClientRect().height : 0,
        messagesHeight: messagesArea ? messagesArea.getBoundingClientRect().height : 0,
        inputHeight: inputArea ? inputArea.getBoundingClientRect().height : 0,
        viewportHeight: window.innerHeight,
        headerTop: header ? header.getBoundingClientRect().top : 0,
        inputBottom: inputArea ? inputArea.getBoundingClientRect().bottom : 0
      };
    });

    if (aiChatPosition.isVisible && aiChatPosition.isOnScreen) {
      log('pass', 'AI Chat Panel', 'Opens correctly and is fully visible');

      // Check if input is visible on screen
      if (aiChatPosition.inputBottom > aiChatPosition.viewportHeight) {
        log('warn', 'AI Chat Panel', 'Input area may be cut off at bottom of screen', {
          inputBottom: aiChatPosition.inputBottom,
          viewportHeight: aiChatPosition.viewportHeight,
          overflow: aiChatPosition.inputBottom - aiChatPosition.viewportHeight
        });
        await takeScreenshot(page, 'ai-chat-input-cutoff');
      }

      // Check if panel starts at very top (might overlap with header)
      if (aiChatPosition.headerTop < 10) {
        log('warn', 'AI Chat Panel', 'Panel may be overlapping with main header', {
          panelTop: aiChatPosition.headerTop
        });
      }
    } else {
      log('fail', 'AI Chat Panel', 'Panel is not properly positioned', aiChatPosition);
      await takeScreenshot(page, 'ai-chat-panel-issue');
    }

    // Close AI chat
    await page.click('.ai-chat-fab');
    await wait(500);

    // ============================================
    // TEST 4: Widget Resize - No Clipping
    // ============================================
    console.log('\n📋 TEST 4: Widget Resize - No Clipping');

    // Find first visible widget with resize button
    const resizeResult = await page.evaluate(() => {
      const widgets = Array.from(document.querySelectorAll('.widget-item:not(.muuri-item-hidden)'));
      if (widgets.length === 0) return { error: 'No visible widgets' };

      const firstWidget = widgets[0];
      const resizeBtn = firstWidget.querySelector('.widget-resize');
      if (!resizeBtn) return { error: 'No resize button found' };

      const initialSize = firstWidget.dataset.size || 'medium';
      resizeBtn.click();

      // Wait a bit for layout
      return new Promise(resolve => {
        setTimeout(() => {
          const newSize = firstWidget.dataset.size;
          const allWidgets = Array.from(document.querySelectorAll('.widget-item:not(.muuri-item-hidden)'));

          // Check for overlaps after resize
          const overlapping = [];
          for (let i = 0; i < allWidgets.length; i++) {
            const rect1 = allWidgets[i].getBoundingClientRect();
            for (let j = i + 1; j < allWidgets.length; j++) {
              const rect2 = allWidgets[j].getBoundingClientRect();

              const overlap = !(
                rect1.right < rect2.left ||
                rect1.left > rect2.right ||
                rect1.bottom < rect2.top ||
                rect1.top > rect2.bottom
              );

              if (overlap) {
                overlapping.push({
                  widget1: allWidgets[i].dataset.widgetId,
                  widget2: allWidgets[j].dataset.widgetId
                });
              }
            }
          }

          resolve({ initialSize, newSize, overlapping });
        }, 600);
      });
    });

    await wait(600);

    if (resizeResult.error) {
      log('warn', 'Widget Resize', resizeResult.error);
    } else if (resizeResult.overlapping.length === 0) {
      log('pass', 'Widget Resize', `Resized from ${resizeResult.initialSize} to ${resizeResult.newSize} with no overlaps`);
    } else {
      log('fail', 'Widget Resize', `Widgets overlapping after resize`, resizeResult.overlapping);
      await takeScreenshot(page, 'widget-resize-overlap');
    }

    // ============================================
    // TEST 5: Widget Collapse - Grid Reflow
    // ============================================
    console.log('\n📋 TEST 5: Widget Collapse - Grid Reflow');

    const collapseResult = await page.evaluate(() => {
      const widgets = Array.from(document.querySelectorAll('.widget-item:not(.muuri-item-hidden)'));
      if (widgets.length === 0) return { error: 'No visible widgets' };

      const firstWidget = widgets[0];
      const collapseBtn = firstWidget.querySelector('.widget-collapse');
      if (!collapseBtn) return { error: 'No collapse button found' };

      const initialHeight = firstWidget.getBoundingClientRect().height;
      collapseBtn.click();

      return new Promise(resolve => {
        setTimeout(() => {
          const newHeight = firstWidget.getBoundingClientRect().height;
          const isCollapsed = firstWidget.querySelector('.widget-card').classList.contains('collapsed');

          // Check for overlaps after collapse
          const allWidgets = Array.from(document.querySelectorAll('.widget-item:not(.muuri-item-hidden)'));
          const overlapping = [];

          for (let i = 0; i < allWidgets.length; i++) {
            const rect1 = allWidgets[i].getBoundingClientRect();
            for (let j = i + 1; j < allWidgets.length; j++) {
              const rect2 = allWidgets[j].getBoundingClientRect();

              const overlap = !(
                rect1.right < rect2.left ||
                rect1.left > rect2.right ||
                rect1.bottom < rect2.top ||
                rect1.top > rect2.bottom
              );

              if (overlap) {
                overlapping.push({
                  widget1: allWidgets[i].dataset.widgetId,
                  widget2: allWidgets[j].dataset.widgetId
                });
              }
            }
          }

          resolve({
            isCollapsed,
            heightReduced: newHeight < initialHeight,
            initialHeight,
            newHeight,
            overlapping
          });
        }, 600);
      });
    });

    await wait(600);

    if (collapseResult.error) {
      log('warn', 'Widget Collapse', collapseResult.error);
    } else if (collapseResult.isCollapsed && collapseResult.heightReduced && collapseResult.overlapping.length === 0) {
      log('pass', 'Widget Collapse', `Widget collapsed successfully, height reduced from ${collapseResult.initialHeight}px to ${collapseResult.newHeight}px, no overlaps`);
    } else {
      log('fail', 'Widget Collapse', 'Collapse did not work properly', collapseResult);
      await takeScreenshot(page, 'widget-collapse-issue');
    }

    // ============================================
    // TEST 6: Settings Panel - Toggle State Accuracy
    // ============================================
    console.log('\n📋 TEST 6: Settings Panel - Toggle State Accuracy');

    // Open settings
    await page.click('.settings-fab');
    await wait(500);

    const toggleAccuracy = await page.evaluate(() => {
      const toggles = Array.from(document.querySelectorAll('.widget-toggle input[type="checkbox"]'));
      const mismatches = [];

      toggles.forEach(toggle => {
        const widgetId = toggle.getAttribute('onchange').match(/'([^']+)'/)[1];
        const fullWidgetId = 'widget-' + widgetId;
        const widgetElement = document.querySelector(`[data-widget-id="${fullWidgetId}"]`);

        if (widgetElement) {
          const isActuallyVisible = !widgetElement.classList.contains('muuri-item-hidden');
          const toggleChecked = toggle.checked;

          if (isActuallyVisible !== toggleChecked) {
            mismatches.push({
              widgetId: fullWidgetId,
              actuallyVisible: isActuallyVisible,
              toggleChecked: toggleChecked
            });
          }
        }
      });

      return { totalToggles: toggles.length, mismatches };
    });

    if (toggleAccuracy.mismatches.length === 0) {
      log('pass', 'Toggle State', `All ${toggleAccuracy.totalToggles} toggles accurately reflect widget visibility`);
    } else {
      log('fail', 'Toggle State', `${toggleAccuracy.mismatches.length} toggles don't match actual visibility`, toggleAccuracy.mismatches);
    }

    // Close settings
    await page.click('.settings-fab');
    await wait(500);

    // ============================================
    // TEST 7: Toggle Widget On - Adds to Grid Properly
    // ============================================
    console.log('\n📋 TEST 7: Toggle Widget On - Adds to Grid Properly');

    // Open settings, find a hidden widget, toggle it on
    await page.click('.settings-fab');
    await wait(500);

    const toggleOnResult = await page.evaluate(() => {
      const toggles = Array.from(document.querySelectorAll('.widget-toggle input[type="checkbox"]'));
      const uncheckedToggle = toggles.find(t => !t.checked);

      if (!uncheckedToggle) return { error: 'No hidden widgets to test' };

      const widgetId = uncheckedToggle.getAttribute('onchange').match(/'([^']+)'/)[1];
      const fullWidgetId = 'widget-' + widgetId;

      uncheckedToggle.click();

      return new Promise(resolve => {
        setTimeout(() => {
          const widgetElement = document.querySelector(`[data-widget-id="${fullWidgetId}"]`);
          const isVisible = widgetElement && !widgetElement.classList.contains('muuri-item-hidden');

          // Check for overlaps
          const allWidgets = Array.from(document.querySelectorAll('.widget-item:not(.muuri-item-hidden)'));
          const overlapping = [];

          for (let i = 0; i < allWidgets.length; i++) {
            const rect1 = allWidgets[i].getBoundingClientRect();
            for (let j = i + 1; j < allWidgets.length; j++) {
              const rect2 = allWidgets[j].getBoundingClientRect();

              const overlap = !(
                rect1.right < rect2.left ||
                rect1.left > rect2.right ||
                rect1.bottom < rect2.top ||
                rect1.top > rect2.bottom
              );

              if (overlap) {
                overlapping.push({
                  widget1: allWidgets[i].dataset.widgetId,
                  widget2: allWidgets[j].dataset.widgetId
                });
              }
            }
          }

          resolve({ widgetId: fullWidgetId, isVisible, overlapping });
        }, 800);
      });
    });

    await wait(800);

    if (toggleOnResult.error) {
      log('warn', 'Toggle Widget On', toggleOnResult.error);
    } else if (toggleOnResult.isVisible && toggleOnResult.overlapping.length === 0) {
      log('pass', 'Toggle Widget On', `Widget ${toggleOnResult.widgetId} appeared in grid with no overlaps`);
    } else {
      log('fail', 'Toggle Widget On', 'Widget did not appear properly or caused overlaps', toggleOnResult);
      await takeScreenshot(page, 'toggle-widget-on-issue');
    }

    // Close settings
    await page.click('.settings-fab');
    await wait(500);

    // ============================================
    // TEST 8: FAB Buttons Visibility and Positioning
    // ============================================
    console.log('\n📋 TEST 8: FAB Buttons Visibility and Positioning');

    const fabPositions = await page.evaluate(() => {
      const settingsFab = document.querySelector('.settings-fab');
      const aiChatFab = document.querySelector('.ai-chat-fab');

      const viewport = {
        width: window.innerWidth,
        height: window.innerHeight
      };

      const getFabInfo = (fab, name) => {
        if (!fab) return { error: `${name} FAB not found` };

        const rect = fab.getBoundingClientRect();
        const computedStyle = window.getComputedStyle(fab);

        return {
          visible: rect.width > 0 && rect.height > 0,
          position: { top: rect.top, right: viewport.width - rect.right, bottom: viewport.height - rect.bottom, left: rect.left },
          size: { width: rect.width, height: rect.height },
          zIndex: computedStyle.zIndex,
          isOnScreen: rect.right <= viewport.width && rect.bottom <= viewport.height && rect.left >= 0 && rect.top >= 0
        };
      };

      return {
        viewport,
        settings: getFabInfo(settingsFab, 'Settings'),
        aiChat: getFabInfo(aiChatFab, 'AI Chat')
      };
    });

    let fabsOk = true;

    if (fabPositions.settings.error || !fabPositions.settings.isOnScreen) {
      log('fail', 'FAB Positioning', 'Settings FAB not properly positioned', fabPositions.settings);
      fabsOk = false;
    }

    if (fabPositions.aiChat.error || !fabPositions.aiChat.isOnScreen) {
      log('fail', 'FAB Positioning', 'AI Chat FAB not properly positioned', fabPositions.aiChat);
      fabsOk = false;
    }

    if (fabsOk) {
      log('pass', 'FAB Positioning', 'Both FABs are visible and properly positioned');
    }

    // ============================================
    // TEST 9: Theme Toggle Works
    // ============================================
    console.log('\n📋 TEST 9: Theme Toggle');

    const themeResult = await page.evaluate(() => {
      const root = document.documentElement;
      const initialTheme = root.getAttribute('data-theme') || 'light';

      const themeToggle = document.querySelector('.theme-toggle');
      if (!themeToggle) return { error: 'Theme toggle button not found' };

      themeToggle.click();

      const newTheme = root.getAttribute('data-theme');
      const themeChanged = newTheme !== initialTheme;

      return { initialTheme, newTheme, themeChanged };
    });

    if (themeResult.error) {
      log('warn', 'Theme Toggle', themeResult.error);
    } else if (themeResult.themeChanged) {
      log('pass', 'Theme Toggle', `Theme switched from ${themeResult.initialTheme} to ${themeResult.newTheme}`);
    } else {
      log('fail', 'Theme Toggle', 'Theme did not change', themeResult);
    }

    await wait(500);
    await takeScreenshot(page, 'final-state');

  } catch (error) {
    console.error('\n❌ Test suite error:', error);
    log('fail', 'Test Suite', 'Unexpected error occurred', { error: error.message, stack: error.stack });
    await takeScreenshot(page, 'error-state');
  } finally {
    await browser.close();
  }

  // ============================================
  // GENERATE REPORT
  // ============================================
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Passed: ${results.passed.length}`);
  console.log(`❌ Failed: ${results.failed.length}`);
  console.log(`⚠️  Warnings: ${results.warnings.length}`);
  console.log('='.repeat(60));

  // Generate detailed report
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      passed: results.passed.length,
      failed: results.failed.length,
      warnings: results.warnings.length,
      total: results.passed.length + results.failed.length + results.warnings.length
    },
    results
  };

  const reportPath = path.join(__dirname, 'test-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 Detailed report saved: ${reportPath}`);

  // Generate markdown report
  let markdown = `# Automated Dashboard Test Report\n\n`;
  markdown += `**Date:** ${new Date().toISOString()}\n\n`;
  markdown += `## Summary\n\n`;
  markdown += `- ✅ Passed: ${results.passed.length}\n`;
  markdown += `- ❌ Failed: ${results.failed.length}\n`;
  markdown += `- ⚠️ Warnings: ${results.warnings.length}\n\n`;

  if (results.failed.length > 0) {
    markdown += `## ❌ Failed Tests\n\n`;
    results.failed.forEach(f => {
      markdown += `### ${f.test}\n`;
      markdown += `**Message:** ${f.message}\n\n`;
      if (f.details) {
        markdown += `**Details:**\n\`\`\`json\n${JSON.stringify(f.details, null, 2)}\n\`\`\`\n\n`;
      }
    });
  }

  if (results.warnings.length > 0) {
    markdown += `## ⚠️ Warnings\n\n`;
    results.warnings.forEach(w => {
      markdown += `### ${w.test}\n`;
      markdown += `**Message:** ${w.message}\n\n`;
      if (w.details) {
        markdown += `**Details:**\n\`\`\`json\n${JSON.stringify(w.details, null, 2)}\n\`\`\`\n\n`;
      }
    });
  }

  if (results.passed.length > 0) {
    markdown += `## ✅ Passed Tests\n\n`;
    results.passed.forEach(p => {
      markdown += `- **${p.test}:** ${p.message}\n`;
    });
  }

  const markdownPath = path.join(__dirname, 'AUTOMATED_TEST_REPORT.md');
  fs.writeFileSync(markdownPath, markdown);
  console.log(`📄 Markdown report saved: ${markdownPath}\n`);

  process.exit(results.failed.length > 0 ? 1 : 0);
}

// Run the tests
runTests().catch(console.error);
