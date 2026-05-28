const { test, expect } = require('@playwright/test');

test.describe('Today\'s Cycles Improvements', () => {
  test('should verify all cycle card enhancements', async ({ page, browserName }) => {
    // Navigate to scoreboard
    await page.goto('https://rogueff.github.io/rogue-origin-apps/src/pages/scoreboard-v2.html');
    await page.waitForLoadState('networkidle');

    console.log('🔍 Testing cycle improvements...\n');
    await page.waitForTimeout(5000);

    // Check if cycles section exists
    const cycleSection = await page.locator('#cycleHistory').count();
    console.log('✓ Cycle history section exists:', cycleSection > 0);

    if (cycleSection > 0) {
      // 1. Check Quick Stats Bar
      const statsBar = await page.locator('.cycle-stats-bar').count();
      console.log('\n📊 Quick Stats Bar:', statsBar > 0 ? '✅ Present' : '❌ Missing');

      if (statsBar > 0) {
        const statsText = await page.locator('.cycle-stats-bar').textContent();
        console.log('   Stats content:', statsText);

        // Check for velocity trend arrow
        const hasTrendArrow = /[↓↑→]/.test(statsText);
        console.log('   Velocity trend arrow:', hasTrendArrow ? '✅ Found' : 'ℹ️  Not shown (needs 6+ bags)');
      }

      // 2. Check Navigation Button Sizes (Mobile Touch Targets)
      const navBtn = await page.locator('.cycle-nav-btn').first();
      if (await navBtn.count() > 0) {
        const btnSize = await navBtn.evaluate(el => ({
          width: el.offsetWidth,
          height: el.offsetHeight,
          minWidth: window.getComputedStyle(el).minWidth,
          minHeight: window.getComputedStyle(el).minHeight
        }));
        console.log('\n📱 Navigation Buttons:');
        console.log(`   Size: ${btnSize.width}x${btnSize.height}px`);
        console.log(`   Min size: ${btnSize.minWidth} x ${btnSize.minHeight}`);
        console.log('   Touch target:', btnSize.width >= 44 && btnSize.height >= 44 ? '✅ WCAG compliant' : '⚠️  Too small');
      }

      // 3. Switch to Cards mode to test enhancements
      const modeLabel = await page.locator('#cycleModeLabel').textContent();
      console.log('\n🎴 Current mode:', modeLabel);

      // Click next until we get to Cards mode
      let attempts = 0;
      while (attempts < 5) {
        const currentMode = await page.locator('#cycleModeLabel').textContent();
        if (currentMode === 'Cards') break;
        await page.locator('.cycle-nav-btn').last().click({ force: true });
        await page.waitForTimeout(500);
        attempts++;
      }

      const finalMode = await page.locator('#cycleModeLabel').textContent();
      console.log('   Switched to:', finalMode);

      // 4. Check Card Enhancements
      const cards = await page.locator('.cycle-card').count();
      console.log('\n🃏 Cycle Cards:', cards, 'found');

      if (cards > 0) {
        // Check card width
        const cardWidth = await page.locator('.cycle-card').first().evaluate(el => el.offsetWidth);
        console.log('   Card width:', cardWidth + 'px', cardWidth >= 90 ? '✅' : '❌');

        // Check for scroll behavior
        const scrollBehavior = await page.locator('.cycle-cards').evaluate(el =>
          window.getComputedStyle(el).scrollBehavior
        );
        console.log('   Scroll behavior:', scrollBehavior, scrollBehavior === 'smooth' ? '✅' : '⚠️');

        // Check for scroll snap
        const scrollSnap = await page.locator('.cycle-cards').evaluate(el =>
          window.getComputedStyle(el).scrollSnapType
        );
        console.log('   Scroll snap:', scrollSnap, scrollSnap.includes('mandatory') ? '✅' : '❌');

        // 5. Check for Trimmer Badges
        const trimmerBadges = await page.locator('.cycle-card-trimmers').count();
        console.log('\n👥 Trimmer Badges:', trimmerBadges > 0 ? `✅ ${trimmerBadges} found` : 'ℹ️  None (no trimmer data)');

        // 6. Check for Carryover Badges
        const carryoverBadges = await page.locator('.carryover-badge').count();
        console.log('⟲  Carryover Badges:', carryoverBadges > 0 ? `✅ ${carryoverBadges} found` : 'ℹ️  None (no carryover bags today)');

        if (carryoverBadges > 0) {
          const badgeStyle = await page.locator('.carryover-badge').first().evaluate(el => ({
            background: window.getComputedStyle(el).background,
            border: window.getComputedStyle(el).border
          }));
          console.log('   Carryover badge styled:', badgeStyle.border.includes('gold') ? '✅ Gold border' : '⚠️');
        }

        // 7. Check for Progress Bars
        const progressBars = await page.locator('.cycle-card-progress').count();
        console.log('📊 Progress Bars:', progressBars > 0 ? `✅ ${progressBars} found` : '❌ Missing');

        if (progressBars > 0) {
          const progressWidth = await page.locator('.cycle-card-progress-bar').first().evaluate(el =>
            el.style.width
          );
          console.log('   Progress bar width:', progressWidth || '0%');
        }

        // 8. Check Hover Effects
        const hoverTransform = await page.locator('.cycle-card').first().evaluate(el =>
          window.getComputedStyle(el).transition
        );
        console.log('✨ Hover Effects:', hoverTransform.includes('transform') ? '✅ Enabled' : '❌');
      }

      // 9. Test Auto-Collapse Behavior
      console.log('\n🔄 Auto-Collapse:');
      const isCollapsed = await page.evaluate(() => {
        const panel = document.getElementById('cycleHistoryPanel');
        return panel ? panel.classList.contains('collapsed') : false;
      });
      console.log('   Currently collapsed:', isCollapsed);

      const cycleCount = await page.evaluate(() => {
        return window.ScoreboardState?.cycleHistory?.length || 0;
      });
      console.log('   Cycle count:', cycleCount);
      console.log('   Auto-collapse logic:', cycleCount === 0 && !isCollapsed ? '⚠️  Should be collapsed' :
                                             cycleCount > 0 && isCollapsed ? '⚠️  Should be expanded' : '✅');

      // Take screenshots of all modes (skip fullPage in Firefox due to font loading bug)
      console.log('\n📸 Capturing screenshots...');
      if (browserName !== 'firefox') {
        await page.screenshot({ path: 'tests/screenshots/cycles-improved-cards.png', fullPage: true, timeout: 60000 });

        // Test each visualization mode
        const modes = ['Donut', 'Bars', 'Grid', 'Cards', 'List'];
        for (let i = 0; i < modes.length; i++) {
          await page.locator('.cycle-nav-btn').first().click();
          await page.waitForTimeout(300);
          const mode = await page.locator('#cycleModeLabel').textContent();
          await page.screenshot({
            path: `tests/screenshots/cycles-improved-${mode.toLowerCase()}.png`,
            fullPage: true,
            timeout: 60000
          });
          console.log(`   ✓ ${mode} mode`);
        }
      } else {
        console.log('   Skipped (Firefox font loading issue)');
      }
    }

    console.log('\n✅ Test complete!');
  });

  test('should verify scrollbar styling', async ({ page, browserName }) => {
    await page.goto('https://rogueff.github.io/rogue-origin-apps/src/pages/scoreboard-v2.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);

    // Switch to cards mode
    let attempts = 0;
    while (attempts < 5) {
      const currentMode = await page.locator('#cycleModeLabel').textContent();
      if (currentMode === 'Cards') break;
      await page.locator('.cycle-nav-btn').last().click({ force: true });
      await page.waitForTimeout(500);
      attempts++;
    }

    console.log('\n🎨 Scrollbar Styling Check:');

    // Check scrollbar height
    const scrollbarHeight = await page.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = '.cycle-cards::-webkit-scrollbar { background: red !important; }';
      document.head.appendChild(style);

      // Get computed styles
      const cards = document.querySelector('.cycle-cards');
      if (!cards) return null;

      return {
        exists: true,
        overflow: window.getComputedStyle(cards).overflow,
        overflowX: window.getComputedStyle(cards).overflowX
      };
    });

    console.log('   Scrollbar config:', scrollbarHeight);
    console.log('   Overflow-X:', scrollbarHeight?.overflowX === 'auto' ? '✅' : '❌');

    if (browserName !== 'firefox') {
      await page.screenshot({ path: 'tests/screenshots/cycles-scrollbar.png', timeout: 60000 });
    } else {
      console.log('   Screenshot skipped (Firefox font loading issue)');
    }
  });

  test('should verify mobile responsiveness', async ({ page, viewport, browserName }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE

    await page.goto('https://rogueff.github.io/rogue-origin-apps/src/pages/scoreboard-v2.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);

    console.log('\n📱 Mobile Responsiveness Test (375x667):');

    // Check touch targets
    const navBtns = await page.locator('.cycle-nav-btn').all();
    for (let i = 0; i < Math.min(navBtns.length, 2); i++) {
      const size = await navBtns[i].evaluate(el => ({
        width: el.offsetWidth,
        height: el.offsetHeight
      }));
      console.log(`   Button ${i + 1}: ${size.width}x${size.height}px`,
                  size.width >= 44 && size.height >= 44 ? '✅' : '❌ Too small');
    }

    // Check card sizing on mobile
    const cardWidth = await page.locator('.cycle-card').first().evaluate(el =>
      el.offsetWidth
    ).catch(() => 0);

    if (cardWidth > 0) {
      console.log('   Card width on mobile:', cardWidth + 'px');
      console.log('   Readable on mobile:', cardWidth >= 60 ? '✅' : '❌');
    }

    // Check stats bar on mobile
    const statsBarCount = await page.locator('.cycle-stats-bar').count();
    if (statsBarCount > 0) {
      const statsBar = await page.locator('.cycle-stats-bar').boundingBox();
      if (statsBar) {
        console.log('   Stats bar width:', statsBar.width + 'px');
        console.log('   Fits viewport:', statsBar.width <= 375 ? '✅' : '⚠️  Overflow');
      }
    } else {
      console.log('   Stats bar: Not rendered (no cycles - expected)');
    }

    if (browserName !== 'firefox') {
      await page.screenshot({ path: 'tests/screenshots/cycles-mobile.png', fullPage: true, timeout: 60000 });
    } else {
      console.log('   Screenshot skipped (Firefox font loading issue)');
    }
  });
});
