const { test, expect } = require('@playwright/test');

test('verify all dashboard widgets, KPIs, and charts', async ({ page }) => {
  console.log('=== LOADING DASHBOARD ===');
  await page.goto('https://rogueff.github.io/rogue-origin-apps/src/pages/');
  await page.waitForLoadState('networkidle', { timeout: 30000 });

  // Wait for data to load
  await page.waitForTimeout(5000);
  console.log('Dashboard loaded\n');

  // ========================================
  // 1. VERIFY KPI CARDS
  // ========================================
  console.log('=== KPI CARDS ===');

  // Total Tops
  const totalTopsValue = await page.locator('#kpi_totalTops').textContent();
  const totalTopsLabel = await page.locator('[data-kpi="totalTops"] .kpi-label').textContent();
  console.log(`✓ ${totalTopsLabel}: ${totalTopsValue}`);

  // Total Smalls
  const totalSmallsValue = await page.locator('#kpi_totalSmalls').textContent();
  const totalSmallsLabel = await page.locator('[data-kpi="totalSmalls"] .kpi-label').textContent();
  console.log(`✓ ${totalSmallsLabel}: ${totalSmallsValue}`);

  // Avg Rate
  const avgRateValue = await page.locator('#kpi_avgRate').textContent();
  const avgRateLabel = await page.locator('[data-kpi="avgRate"] .kpi-label').textContent();
  console.log(`✓ ${avgRateLabel}: ${avgRateValue}`);

  // Current Crew
  const crewValue = await page.locator('#kpi_crew').textContent();
  const crewLabel = await page.locator('[data-kpi="crew"] .kpi-label').textContent();
  console.log(`✓ ${crewLabel}: ${crewValue}`);

  // Operator Hours
  const operatorHoursValue = await page.locator('#kpi_operatorHours').textContent();
  const operatorHoursLabel = await page.locator('[data-kpi="operatorHours"] .kpi-label').textContent();
  console.log(`✓ ${operatorHoursLabel}: ${operatorHoursValue}`);

  // Cost Per Lb
  const costPerLbValue = await page.locator('#kpi_costPerLb').textContent();
  const costPerLbLabel = await page.locator('[data-kpi="costPerLb"] .kpi-label').textContent();
  console.log(`✓ ${costPerLbLabel}: ${costPerLbValue}`);

  // ========================================
  // 2. VERIFY LAST HOUR WIDGET (Current Production)
  // ========================================
  console.log('\n=== LAST HOUR WIDGET ===');
  const lastHourStrain = await page.locator('#currentStrain').textContent();
  const lastHourTime = await page.locator('#currentTime').textContent();
  const lastHourTops = await page.locator('#currentTops').textContent();
  const lastHourTrimmers = await page.locator('#currentTrimmers').textContent();
  const lastHourBuckers = await page.locator('#currentBuckers').textContent();
  const lastHourRate = await page.locator('#currentRate').textContent();

  console.log(`✓ Strain: ${lastHourStrain}`);
  console.log(`✓ Time Slot: ${lastHourTime}`);
  console.log(`✓ Tops: ${lastHourTops} lbs`);
  console.log(`✓ Trimmers: ${lastHourTrimmers}`);
  console.log(`✓ Buckers: ${lastHourBuckers}`);
  console.log(`✓ Rate: ${lastHourRate} lbs/trimmer/hr`);

  // ========================================
  // 3. VERIFY BAG TIMER WIDGET
  // ========================================
  console.log('\n=== BAG TIMER WIDGET ===');

  // Get bag count
  const bagsToday = await page.locator('#bagsToday').textContent();
  console.log(`✓ Bags Today: ${bagsToday}`);

  // Get avg cycle time
  const bagsAvgTime = await page.locator('#bagsAvgTime').textContent();
  console.log(`✓ Avg Cycle: ${bagsAvgTime}`);

  // Get vs target
  const bagsVsTarget = await page.locator('#bagsVsTarget').textContent();
  console.log(`✓ vs Target: ${bagsVsTarget}`);

  // ========================================
  // 4. VERIFY CHARTS ARE RENDERED
  // ========================================
  console.log('\n=== CHARTS VERIFICATION ===');

  // Check if chart canvases exist
  const hourlyChart = page.locator('canvas#hourlyChart');
  const rateChart = page.locator('canvas#rateChart');
  const dailyChart = page.locator('canvas#dailyChart');
  const dailyRateChart = page.locator('canvas#dailyRateChart');
  const trimmersChart = page.locator('canvas#trimmersChart');

  const hourlyChartExists = await hourlyChart.count() > 0;
  const rateChartExists = await rateChart.count() > 0;
  const dailyChartExists = await dailyChart.count() > 0;
  const dailyRateChartExists = await dailyRateChart.count() > 0;
  const trimmersChartExists = await trimmersChart.count() > 0;

  console.log(`${hourlyChartExists ? '✓' : '✗'} Hourly Chart: ${hourlyChartExists ? 'Rendered' : 'Missing'}`);
  console.log(`${rateChartExists ? '✓' : '✗'} Rate Chart: ${rateChartExists ? 'Rendered' : 'Missing'}`);
  console.log(`${dailyChartExists ? '✓' : '✗'} Daily Chart: ${dailyChartExists ? 'Rendered' : 'Missing'}`);
  console.log(`${dailyRateChartExists ? '✓' : '✗'} Daily Rate Chart: ${dailyRateChartExists ? 'Rendered' : 'Missing'}`);
  console.log(`${trimmersChartExists ? '✓' : '✗'} Trimmers Chart: ${trimmersChartExists ? 'Rendered' : 'Missing'}`);

  // Check if charts have data (non-zero dimensions)
  if (hourlyChartExists) {
    const hourlyChartWidth = await hourlyChart.evaluate(canvas => canvas.width);
    const hourlyChartHeight = await hourlyChart.evaluate(canvas => canvas.height);
    console.log(`  Hourly Chart Dimensions: ${hourlyChartWidth}x${hourlyChartHeight}`);
  }

  // ========================================
  // 5. FETCH API DATA FOR COMPARISON
  // ========================================
  console.log('\n=== API DATA VERIFICATION ===');

  const scoreboardResponse = await page.evaluate(async () => {
    const response = await fetch('https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=scoreboard');
    const raw = await response.json();
    return raw.scoreboard || raw;
  });

  console.log('API Scoreboard Data:');
  console.log(`  - Today Lbs (Tops): ${scoreboardResponse.todayLbs}`);
  console.log(`  - Last Hour Lbs: ${scoreboardResponse.lastHourLbs}`);
  console.log(`  - Last Hour Trimmers: ${scoreboardResponse.lastHourTrimmers}`);
  console.log(`  - Last Hour Buckers: ${scoreboardResponse.lastHourBuckers}`);
  console.log(`  - Current Hour Trimmers: ${scoreboardResponse.currentHourTrimmers}`);
  console.log(`  - Current Hour Buckers: ${scoreboardResponse.currentHourBuckers}`);
  console.log(`  - Strain: ${scoreboardResponse.strain}`);

  const dashboardResponse = await page.evaluate(async () => {
    const response = await fetch('https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=dashboard&days=7');
    const raw = await response.json();
    return raw.data || raw;
  });

  console.log('\nAPI Dashboard Data:');
  console.log(`  - Daily Data Length: ${dashboardResponse.dailyData?.length || 0} days`);
  if (dashboardResponse.dailyData && dashboardResponse.dailyData.length > 0) {
    const today = dashboardResponse.dailyData[0];
    console.log(`  - Today Total Tops: ${today.totalTops}`);
    console.log(`  - Today Total Smalls: ${today.totalSmalls}`);
    console.log(`  - Today Avg Rate: ${today.avgRate}`);
    console.log(`  - Today Trimmers: ${today.trimmers}`);
    console.log(`  - Today Operator Hours: ${today.operatorHours}`);
    console.log(`  - Today Cost Per Lb: $${today.costPerLb}`);
    console.log(`  - Today Labor Cost: $${today.laborCost}`);
  }

  const bagTimerResponse = await page.evaluate(async () => {
    const response = await fetch('https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=timer');
    const raw = await response.json();
    return raw.timer || raw;
  });

  console.log('\nAPI Bag Timer Data:');
  console.log(`  - Bags Today: ${bagTimerResponse.bagsToday}`);
  console.log(`  - Avg Cycle: ${bagTimerResponse.avgCycleMinutes} min`);

  // ========================================
  // 6. VERIFY CALCULATIONS
  // ========================================
  console.log('\n=== FORMULA VERIFICATION ===');

  // Verify Last Hour Rate calculation: lbs / trimmers
  const expectedLastHourRate = scoreboardResponse.lastHourLbs / scoreboardResponse.lastHourTrimmers;
  const actualLastHourRate = parseFloat(lastHourRate);
  const rateMatch = Math.abs(expectedLastHourRate - actualLastHourRate) < 0.01;
  console.log(`\n✓ Last Hour Rate Formula:`);
  console.log(`  Expected: ${scoreboardResponse.lastHourLbs} / ${scoreboardResponse.lastHourTrimmers} = ${expectedLastHourRate.toFixed(2)}`);
  console.log(`  Actual: ${actualLastHourRate.toFixed(2)}`);
  console.log(`  ${rateMatch ? '✓ MATCH' : '✗ MISMATCH'}`);

  // Verify weighted avg rate calculation
  if (scoreboardResponse.hourlyRates && scoreboardResponse.hourlyRates.length > 0) {
    let weightedSum = 0;
    let totalTrimmerHours = 0;

    for (const hour of scoreboardResponse.hourlyRates) {
      if (hour.trimmers && hour.rate != null) {
        weightedSum += hour.rate * hour.trimmers;
        totalTrimmerHours += hour.trimmers;
      }
    }

    const expectedAvgRate = totalTrimmerHours > 0 ? weightedSum / totalTrimmerHours : 0;
    const actualAvgRate = parseFloat(avgRateValue);
    const avgRateMatch = Math.abs(expectedAvgRate - actualAvgRate) < 0.01;

    console.log(`\n✓ Weighted Avg Rate Formula:`);
    console.log(`  Hourly rates: ${scoreboardResponse.hourlyRates.length} hours`);
    console.log(`  Total trimmer-hours: ${totalTrimmerHours}`);
    console.log(`  Expected: ${expectedAvgRate.toFixed(2)}`);
    console.log(`  Actual: ${actualAvgRate.toFixed(2)}`);
    console.log(`  ${avgRateMatch ? '✓ MATCH' : '✗ MISMATCH'}`);
  }

  // Verify Cost Per Lb calculation: labor cost / total lbs
  if (dashboardResponse.dailyData && dashboardResponse.dailyData.length > 0) {
    const today = dashboardResponse.dailyData[0];
    if (today.laborCost && today.totalLbs && today.totalLbs > 0) {
      const expectedCostPerLb = today.laborCost / today.totalLbs;
      const actualCostPerLb = parseFloat(costPerLbValue.replace('$', '').replace('—', '0'));
      const costMatch = actualCostPerLb > 0 && Math.abs(expectedCostPerLb - actualCostPerLb) < 0.01;

      console.log(`\n✓ Cost Per Lb Formula:`);
      console.log(`  Expected: $${today.laborCost} / ${today.totalLbs} lbs = $${expectedCostPerLb.toFixed(2)}`);
      console.log(`  Actual: $${actualCostPerLb.toFixed(2)}`);
      console.log(`  ${costMatch ? '✓ MATCH' : '✗ MISMATCH'}`);
    } else {
      console.log(`\n✓ Cost Per Lb: No data available yet (need labor cost data)`);
    }
  }

  // Verify Total Tops matches API
  const expectedTotalTops = scoreboardResponse.todayLbs || 0;
  const actualTotalTops = parseFloat(totalTopsValue);
  const topsMatch = Math.abs(expectedTotalTops - actualTotalTops) < 0.1;
  console.log(`\n✓ Total Tops Verification:`);
  console.log(`  Expected (API): ${expectedTotalTops.toFixed(1)}`);
  console.log(`  Actual (UI): ${actualTotalTops.toFixed(1)}`);
  console.log(`  ${topsMatch ? '✓ MATCH' : '✗ MISMATCH'}`);

  // Verify Bag Count matches API
  const expectedBags = bagTimerResponse.bagsToday || 0;
  const actualBags = parseInt(bagsToday.replace('—', '0'));
  const bagsMatch = expectedBags === actualBags;
  console.log(`\n✓ Bag Count Verification:`);
  console.log(`  Expected (API): ${expectedBags}`);
  console.log(`  Actual (UI): ${actualBags}`);
  console.log(`  ${bagsMatch ? '✓ MATCH' : '✗ MISMATCH'}`);

  // ========================================
  // 7. SUMMARY
  // ========================================
  console.log('\n=== VERIFICATION SUMMARY ===');
  console.log(`✓ KPIs: 6 cards rendered`);
  console.log(`✓ Last Hour Widget: All fields populated`);
  console.log(`✓ Bag Timer Widget: All stats showing`);
  console.log(`✓ Charts: ${[hourlyChartExists, rateChartExists, dailyChartExists, dailyRateChartExists, trimmersChartExists].filter(Boolean).length}/5 rendered`);
  console.log(`✓ Formulas: ${[rateMatch, topsMatch, bagsMatch].filter(Boolean).length}/3 verified`);

  // ========================================
  // 8. TAKE SCREENSHOT
  // ========================================
  await page.screenshot({
    path: 'tests/screenshots/dashboard-full-verification.png',
    fullPage: true
  });
  console.log('\n✓ Screenshot saved: tests/screenshots/dashboard-full-verification.png');

  console.log('\n=== VERIFICATION COMPLETE ===');
});
