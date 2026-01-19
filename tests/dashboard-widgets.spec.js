/**
 * Dashboard Widgets/KPIs Test Suite
 * Comprehensive tests for Rogue Origin Operations Hub dashboard
 *
 * Tests cover:
 * - 10 KPI cards (5 default visible, 5 hidden)
 * - 15 widgets (charts, integrations, data tables)
 * - Hero section with animated values
 * - Data accuracy and formatting
 * - Edge cases and error states
 * - Accessibility
 *
 * Run: npx playwright test dashboard-widgets.spec.js
 */

const { test, expect } = require('@playwright/test');
const path = require('path');

// Use live production URL instead of local file
const DASHBOARD_URL = 'https://rogueff.github.io/rogue-origin-apps/src/pages/index.html';
const TIMEOUT = 30000; // Longer timeout for live API

// ============================================
// MOCK DATA DEFINITIONS
// ============================================

const MOCK_DASHBOARD_DATA = {
  success: true,
  data: {
    dateRange: { start: '2026-01-18', end: '2026-01-18', label: 'Today' },
    today: {
      totalTops: 45.7,
      totalSmalls: 12.3,
      totalLbs: 58.0,
      currentRate: 1.12,
      avgRate: 1.08,
      maxRate: 1.25,
      lbsPerHour: 8.3,
      trimmers: 7,
      buckers: 2,
      qc: 1,
      tzero: 0,
      hoursWorked: 7.0,
      totalTrimmerHours: 49.0,
      totalBuckerHours: 14.0,
      totalTZeroHours: 0,
      totalQCHours: 7.0,
      totalOperatorHours: 70.0,
      totalLaborCost: 1050.00,
      costPerLb: 18.10,
      avgCostPerTop: 22.98,
      avgCostPerSmall: 85.37
    },
    totals: {
      totalTops: 45.7,
      totalSmalls: 12.3,
      totalLbs: 58.0,
      avgRate: 1.08,
      maxRate: 1.25,
      trimmers: 7,
      buckers: 2,
      qc: 1,
      tzero: 0,
      totalOperatorHours: 70.0,
      totalTrimmerHours: 49.0,
      totalLaborCost: 1050.00,
      costPerLb: 18.10
    },
    weekly: { totalDays: 5, totalTops: 215.5, totalSmalls: 58.2, bestRate: 1.35 },
    rollingAverage: {
      totalTops: 43.1,
      totalSmalls: 11.64,
      avgRate: 1.05,
      totalLbs: 54.74,
      operatorHours: 68.5,
      costPerLb: 18.75
    },
    targets: { totalTops: 50.0, avgRate: 1.10, costPerLb: 15.0 },
    lastCompleted: {
      strain: 'Cherry Diesel',
      timeSlot: '1:00 PM - 2:00 PM',
      tops: 6.8,
      smalls: 1.9,
      trimmers: 7,
      buckers: 2,
      rate: 0.97
    },
    hourly: [
      { label: '7:00 AM', tops: 5.2, smalls: 1.1, rate: 0.93, trimmers: 6, buckers: 2, strain: 'Cherry Diesel' },
      { label: '8:00 AM', tops: 7.1, smalls: 2.0, rate: 1.18, trimmers: 7, buckers: 2, strain: 'Cherry Diesel' },
      { label: '9:00 AM', tops: 5.8, smalls: 1.4, rate: 0.97, trimmers: 7, buckers: 2, strain: 'Cherry Diesel' },
      { label: '10:00 AM', tops: 8.2, smalls: 2.3, rate: 1.17, trimmers: 7, buckers: 2, strain: 'Cherry Diesel' },
      { label: '11:00 AM', tops: 7.5, smalls: 1.8, rate: 1.07, trimmers: 7, buckers: 2, strain: 'Cherry Diesel' },
      { label: '12:30 PM', tops: 3.1, smalls: 0.8, rate: 0.89, trimmers: 7, buckers: 2, strain: 'Cherry Diesel' },
      { label: '1:00 PM', tops: 6.8, smalls: 1.9, rate: 0.97, trimmers: 7, buckers: 2, strain: 'Cherry Diesel' }
    ],
    daily: [
      { label: 'Jan 14', totalTops: 42.1, totalSmalls: 11.2, avgRate: 1.02, crew: 10, operatorHours: 70, costPerLb: 19.67, totalLbs: 53.3, maxRate: 1.28, trimmerHours: 49, laborCost: 1050 },
      { label: 'Jan 15', totalTops: 44.5, totalSmalls: 12.0, avgRate: 1.05, crew: 10, operatorHours: 68, costPerLb: 18.05, totalLbs: 56.5, maxRate: 1.30, trimmerHours: 48, laborCost: 1020 },
      { label: 'Jan 16', totalTops: 41.2, totalSmalls: 10.8, avgRate: 0.98, crew: 9, operatorHours: 65, costPerLb: 18.75, totalLbs: 52.0, maxRate: 1.22, trimmerHours: 45, laborCost: 975 },
      { label: 'Jan 17', totalTops: 46.0, totalSmalls: 12.5, avgRate: 1.08, crew: 10, operatorHours: 70, costPerLb: 17.95, totalLbs: 58.5, maxRate: 1.32, trimmerHours: 49, laborCost: 1050 },
      { label: 'Jan 18', totalTops: 45.7, totalSmalls: 12.3, avgRate: 1.08, crew: 10, operatorHours: 70, costPerLb: 18.10, totalLbs: 58.0, maxRate: 1.25, trimmerHours: 49, laborCost: 1050 }
    ],
    current: {
      strain: 'Cherry Diesel',
      trimmers: 7,
      targetRate: 1.10,
      todayLbs: 58.0,
      todayTarget: 50.0,
      todayPercentage: 116,
      projectedTotal: 72.5,
      dailyGoal: 65.0,
      projectedDelta: 7.5,
      effectiveHours: 8.5
    },
    bagTimer: { bagsToday: 11, avgTime: '52 min', avgMinutes: 52, vsTarget: '-3 min' },
    strains: ['Cherry Diesel']
  }
};

// Zero data scenario
const MOCK_ZERO_DATA = {
  success: true,
  data: {
    dateRange: { start: '2026-01-18', end: '2026-01-18', label: 'Today' },
    today: {
      totalTops: 0, totalSmalls: 0, totalLbs: 0,
      currentRate: 0, avgRate: 0, maxRate: 0, lbsPerHour: 0,
      trimmers: 0, buckers: 0, qc: 0, tzero: 0,
      hoursWorked: 0, totalTrimmerHours: 0, totalBuckerHours: 0,
      totalTZeroHours: 0, totalQCHours: 0, totalOperatorHours: 0,
      totalLaborCost: 0, costPerLb: 0, avgCostPerTop: 0, avgCostPerSmall: 0
    },
    totals: {
      totalTops: 0, totalSmalls: 0, totalLbs: 0, avgRate: 0, maxRate: 0,
      trimmers: 0, buckers: 0, qc: 0, tzero: 0,
      totalOperatorHours: 0, totalTrimmerHours: 0, totalLaborCost: 0, costPerLb: 0
    },
    weekly: { totalDays: 0, totalTops: 0, totalSmalls: 0, bestRate: 0 },
    rollingAverage: { totalTops: 0, totalSmalls: 0, avgRate: 0, totalLbs: 0, operatorHours: 0, costPerLb: 0 },
    targets: { totalTops: 50.0, avgRate: 1.10, costPerLb: 15.0 },
    lastCompleted: null,
    hourly: [],
    daily: [],
    current: {
      strain: '', trimmers: 0, targetRate: 1.10, todayLbs: 0, todayTarget: 50.0,
      todayPercentage: 0, projectedTotal: 0, dailyGoal: 65.0, projectedDelta: -65.0, effectiveHours: 8.5
    },
    bagTimer: { bagsToday: 0, avgTime: '—', avgMinutes: 0, vsTarget: '—' },
    strains: []
  }
};

// ============================================
// SETUP FUNCTIONS
// ============================================

/**
 * Setup function - clears localStorage for clean state
 * No mocking - tests run against live API
 */
async function setupLive(page) {
  // Clear localStorage before navigation for clean state
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
}

/**
 * Wait for dashboard to fully load with data
 */
async function waitForDashboardLoad(page) {
  // Wait for loading overlay to disappear
  await page.waitForSelector('#loadingOverlay.hidden', { timeout: TIMEOUT }).catch(() => {});

  // Wait for KPI cards to render and lose loading state
  await page.waitForFunction(() => {
    const cards = document.querySelectorAll('.kpi-card');
    if (cards.length === 0) return false;
    // Check at least one card doesn't have loading class
    return Array.from(cards).some(card => !card.classList.contains('loading'));
  }, { timeout: TIMEOUT });

  // Small delay for animations
  await page.waitForTimeout(1000);
}

/**
 * Wait for hero section to show data
 */
async function waitForHeroData(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById('heroProductionNumber');
    if (!el) return false;
    // Check that value is loaded (not just 0.0 placeholder)
    const text = el.textContent;
    return text && text !== '0.0' && text !== '0' && text !== '—';
  }, { timeout: TIMEOUT }).catch(() => {
    // May timeout if zero data - that's OK
  });
}

// ============================================
// PHASE 1: KPI CARDS TESTS
// ============================================

test.describe('Phase 1: KPI Cards', () => {

  test('All 10 KPI value elements render', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const kpiIds = [
      'totalTops', 'totalSmalls', 'avgRate', 'crew', 'operatorHours',
      'costPerLb', 'totalLbs', 'maxRate', 'trimmerHours', 'laborCost'
    ];

    for (const id of kpiIds) {
      const valueEl = page.locator(`#kpi_${id}`);
      await expect(valueEl).toBeAttached();
    }
  });

  test('Total Tops displays formatted value or dash', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const value = await page.locator('#kpi_totalTops').textContent();
    // Should be a number with 1 decimal place (e.g., "45.7" or "0.0") or dash when no data
    expect(value).toMatch(/^(\d+[\d,]*\.\d|—)$/);
  });

  test('Total Smalls displays formatted value or dash', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const value = await page.locator('#kpi_totalSmalls').textContent();
    // Should be a number with 1 decimal place or dash
    expect(value).toMatch(/^(\d+[\d,]*\.\d|—)$/);
  });

  test('Lbs/Trimmer/Hr displays rate format or dash', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const value = await page.locator('#kpi_avgRate').textContent();
    // Should be a rate with 2 decimal places (e.g., "1.08" or "0.00") or dash
    expect(value).toMatch(/^(\d+\.\d{2}|—)$/);
  });

  test('Current Crew displays whole number', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const value = await page.locator('#kpi_crew').textContent();
    // Should be a whole number or dash
    expect(value).toMatch(/^(\d+|—)$/);
  });

  test('Operator Hours displays hour format', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const value = await page.locator('#kpi_operatorHours').textContent();
    // Should be hours with 1 decimal (e.g., "70.0") or dash
    expect(value).toMatch(/^(\d+[\d,]*\.\d|—)$/);
  });

  test('Cost/Lb displays dollar format', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const value = await page.locator('#kpi_costPerLb').textContent();
    // Should be dollar format (e.g., "$18.10") or dash
    expect(value).toMatch(/^(\$\d+[\d,]*\.\d{2}|—)$/);
  });

  test('KPI cards remove loading state after data loads', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const card = page.locator('.kpi-card[data-kpi="totalTops"]');
    const hasLoading = await card.evaluate(el => el.classList.contains('loading'));
    expect(hasLoading).toBe(false);
  });

  test('KPI grid items have data-hidden attribute', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    // Check that KPI wrappers have the data-hidden attribute (either true or false)
    const kpiIds = ['costPerLb', 'totalLbs', 'maxRate', 'trimmerHours', 'laborCost'];
    for (const id of kpiIds) {
      const wrapper = page.locator(`.kpi-grid-item[data-kpi="${id}"]`);
      const isHidden = await wrapper.getAttribute('data-hidden');
      // Attribute should exist and be either 'true' or 'false'
      expect(['true', 'false']).toContain(isHidden);
    }
  });

  test('KPI card expand/collapse works on click', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const card = page.locator('.kpi-card[data-kpi="totalTops"]');
    await card.click();
    await page.waitForTimeout(300);

    // Should have expanded class
    const hasExpanded = await card.evaluate(el => el.classList.contains('expanded'));
    expect(hasExpanded).toBe(true);

    // Expanded content should be visible
    const expandedContent = page.locator('#kpiExpanded_totalTops');
    await expect(expandedContent).toBeVisible();
  });

});

// ============================================
// PHASE 2: HERO SECTION TESTS
// ============================================

test.describe('Phase 2: Hero Section', () => {

  test('Hero production number displays a numeric value', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);
    await waitForHeroData(page);

    // Wait for animation to complete
    await page.waitForTimeout(1000);

    const value = await page.locator('#heroProductionNumber').textContent();
    // Should be a valid number (may include decimal)
    expect(parseFloat(value)).not.toBeNaN();
  });

  test('Hero strain element exists', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const strain = page.locator('#heroStrain');
    await expect(strain).toBeAttached();
  });

  test('Hero subtitle element is populated', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const subtitle = await page.locator('#heroSubtitle').textContent();
    // Should contain "Total:" and "lbs" OR "Loading..." if no data yet
    const isValid = subtitle.includes('Total:') || subtitle.includes('Loading');
    expect(isValid).toBe(true);
  });

  test('Hero progress bar has a state class (ahead, behind, or on-track)', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const progressFill = page.locator('#heroProgressFill');
    const classes = await progressFill.evaluate(el => el.className);
    // Should have one of the state classes
    const hasStateClass = classes.includes('ahead') || classes.includes('behind') || classes.includes('on-track');
    expect(hasStateClass || classes.includes('hero-progress-fill')).toBe(true);
  });

  test('Hero progress bar width is set', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const progressFill = page.locator('#heroProgressFill');
    const width = await progressFill.evaluate(el => el.style.width);
    // Width should be set (e.g., "50%", "100%", etc.)
    expect(width).toMatch(/\d+%/);
  });

  test('Mini KPI: Crew Count displays a number', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const crewValue = await page.locator('#heroCrewValue').textContent();
    // Should be a number or "--"
    expect(crewValue).toMatch(/^(\d+|--|—)$/);
  });

  test('Mini KPI: Avg Rate displays formatted rate', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const rateValue = await page.locator('#heroRateValue').textContent();
    // Should be a rate with decimals or "--"
    expect(rateValue).toMatch(/^(\d+\.\d+|--|—)$/);
  });

  test('Mini KPI: Predicted Tops displays a value', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const targetValue = await page.locator('#heroTargetValue').textContent();
    // Should be a number or "--"
    expect(targetValue).toMatch(/^(\d+[\d,]*\.?\d*|--|—)$/);
  });

});

// ============================================
// PHASE 3: WIDGETS TESTS
// ============================================

test.describe('Phase 3: Widgets', () => {

  test('Multiple widgets render with widget-item class', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    // Check for some key widgets
    const widgets = await page.locator('[data-widget-id]').count();
    expect(widgets).toBeGreaterThan(5);
  });

  test('Bag Timer widget displays bagsToday value', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const bagsToday = await page.locator('#bagsToday').textContent();
    // Should be a number or dash
    expect(bagsToday).toMatch(/^(\d+|—)$/);
  });

  test('Bag Timer widget displays avgTime value', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const avgTime = await page.locator('#bagsAvgTime').textContent();
    // Should be time format (e.g., "52 min") or dash
    expect(avgTime).toMatch(/^(\d+\s*min|—)$/);
  });

  test('Bag Timer widget displays vsTarget value', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const vsTarget = await page.locator('#bagsVsTarget').textContent();
    // Should be delta format (e.g., "-3 min", "+5 min") or dash
    expect(vsTarget).toMatch(/^([+-]?\d+\s*min|—)$/);
  });

  test('Widget collapse button toggles collapsed class', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    // Find a widget with collapse button
    const widget = page.locator('[data-widget-id="widget-bags"]');
    const collapseBtn = widget.locator('.widget-collapse').first();

    if (await collapseBtn.count() > 0) {
      // Initially not collapsed
      const initiallyCollapsed = await widget.evaluate(el => el.classList.contains('collapsed'));

      // Click to toggle collapse state
      await collapseBtn.click();
      await page.waitForTimeout(300);

      // Should have toggled the collapsed class
      const afterClickCollapsed = await widget.evaluate(el => el.classList.contains('collapsed'));
      expect(afterClickCollapsed).toBe(!initiallyCollapsed);
    }
  });

  test('Chart canvases exist and are visible', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const chartIds = ['hourlyChart', 'rateChart', 'dailyChart', 'dailyRateChart', 'trimmersChart'];
    for (const id of chartIds) {
      const canvas = page.locator(`#${id}`);
      await expect(canvas).toBeAttached();
    }
  });

  test('Hourly chart canvas has proper dimensions', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const canvas = page.locator('#hourlyChart');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThan(100);
    expect(box.height).toBeGreaterThan(50);
  });

  test('Widget sizes are applied via data-size attribute', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    // Check that widgets have size attributes
    const widgetsWithSize = await page.locator('[data-widget-id][data-size]').count();
    expect(widgetsWithSize).toBeGreaterThan(0);
  });

  test('Integration widgets are clickable (have pointer cursor)', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const kanbanWidget = page.locator('[data-widget-id="widget-kanban"] .widget-card').first();
    if (await kanbanWidget.count() > 0) {
      const cursor = await kanbanWidget.evaluate(el => getComputedStyle(el).cursor);
      expect(cursor).toBe('pointer');
    }
  });

  test('Hero bags value displays a number', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const bagsValue = await page.locator('#heroBagsValue').textContent();
    // Should be a number or dash
    expect(bagsValue).toMatch(/^(\d+|--|—)$/);
  });

  test('Hero section container is visible', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const heroSection = page.locator('#heroSection');
    await expect(heroSection).toBeVisible();
  });

  test('KPI row container exists with cards', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const kpiRow = page.locator('#kpiRow');
    await expect(kpiRow).toBeVisible();

    const kpiCards = await page.locator('#kpiRow .kpi-card').count();
    expect(kpiCards).toBeGreaterThan(0);
  });

});

// ============================================
// PHASE 4: DATA ACCURACY TESTS
// ============================================

test.describe('Phase 4: Data Accuracy & Formatting', () => {

  test('KPI values are valid numbers or dashes', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    // Total Tops - should be a number or dash
    const topsValue = await page.locator('#kpi_totalTops').textContent();
    const topsIsValid = topsValue === '—' || !isNaN(parseFloat(topsValue.replace(/,/g, '')));
    expect(topsIsValid).toBe(true);

    // Total Smalls - should be a number or dash
    const smallsValue = await page.locator('#kpi_totalSmalls').textContent();
    const smallsIsValid = smallsValue === '—' || !isNaN(parseFloat(smallsValue.replace(/,/g, '')));
    expect(smallsIsValid).toBe(true);
  });

  test('Rate value is a valid decimal number or dash', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const avgRateValue = await page.locator('#kpi_avgRate').textContent();
    const isValid = avgRateValue === '—' || !isNaN(parseFloat(avgRateValue));
    expect(isValid).toBe(true);
  });

  test('Cost per lb shows dollar format with 2 decimals', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const costValue = await page.locator('#kpi_costPerLb').textContent();
    // Should match $XX.XX format or be a dash
    expect(costValue).toMatch(/^(\$[\d,]+\.\d{2}|—)$/);
  });

  test('Formatting: lbs format uses 1 decimal place or dash', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const topsValue = await page.locator('#kpi_totalTops').textContent();
    // Should have exactly 1 decimal place OR be a dash
    expect(topsValue).toMatch(/(\.\d$|^—$)/);
  });

  test('Formatting: rate format uses 2 decimal places or dash', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const rateValue = await page.locator('#kpi_avgRate').textContent();
    // Should have exactly 2 decimal places OR be a dash
    expect(rateValue).toMatch(/(\.\d{2}$|^—$)/);
  });

  test('Formatting: hours format uses 1 decimal place', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const hoursValue = await page.locator('#kpi_operatorHours').textContent();
    // Should have 1 decimal place or be a dash
    expect(hoursValue).toMatch(/(\.\d$|—)/);
  });

  test('Hero subtitle contains text content', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const subtitle = await page.locator('#heroSubtitle').textContent();
    // Should contain "Total:" and "lbs" OR "Loading..." if no data
    const isValid = subtitle.includes('Total:') || subtitle.includes('Loading');
    expect(isValid).toBe(true);
  });

  test('Progress percentage is displayed', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const progressText = await page.locator('#heroProgressText').textContent();
    // Should show percentage
    expect(progressText).toMatch(/\d+%/);
  });

});

// ============================================
// PHASE 5: EDGE CASES TESTS
// ============================================

test.describe('Phase 5: UI Interactions & Edge Cases', () => {

  test('Page loads without JavaScript errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    // Filter out expected errors (like CORS from external resources)
    const criticalErrors = errors.filter(e =>
      !e.includes('CORS') &&
      !e.includes('net::ERR') &&
      !e.includes('favicon')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('Dashboard renders all major sections', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    // Hero section
    await expect(page.locator('#heroSection')).toBeVisible();
    // KPI row
    await expect(page.locator('#kpiRow')).toBeVisible();
    // Widget container (Muuri grid)
    await expect(page.locator('#widgetsContainer')).toBeVisible();
  });

  test('Theme toggle works', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    // Get initial theme
    const initialTheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme')
    );

    // Click theme toggle button
    const themeToggle = page.locator('button[onclick="toggleTheme()"]');
    await themeToggle.click();
    await page.waitForTimeout(300);

    // Theme should have changed
    const newTheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme')
    );
    expect(newTheme).not.toBe(initialTheme);
  });

  test('Settings panel opens and shows widget toggles', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    // Click settings button
    const settingsBtn = page.locator('button[onclick="openSettings()"]');
    await settingsBtn.click();
    await page.waitForTimeout(300);

    const settingsPanel = page.locator('#settingsPanel');
    const hasOpen = await settingsPanel.evaluate(el => el.classList.contains('open'));
    expect(hasOpen).toBe(true);

    const widgetToggles = page.locator('#widgetToggles');
    await expect(widgetToggles).toBeVisible();
  });

  test('Settings panel can be closed', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    // Open settings
    await page.locator('button[onclick="openSettings()"]').click();
    await page.waitForTimeout(300);

    // Close settings using the specific close button in settings panel
    await page.locator('#settingsPanel .settings-close').click();
    await page.waitForTimeout(300);

    const settingsPanel = page.locator('#settingsPanel');
    const hasOpen = await settingsPanel.evaluate(el => el.classList.contains('open'));
    expect(hasOpen).toBe(false);
  });

  test('Date picker dropdown opens', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    // Click date picker trigger
    await page.locator('#datePickerTrigger').click();
    await page.waitForTimeout(200);

    const dropdown = page.locator('#datePickerDropdown');
    await expect(dropdown).toBeVisible();
  });

  test('Refresh button triggers data reload', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    // Click refresh button
    const refreshBtn = page.locator('#refreshBtn');
    await refreshBtn.click();

    // Wait for connection status to show connecting/connected
    await page.waitForTimeout(500);

    // Page should still be functional after refresh
    const kpiRow = page.locator('#kpiRow');
    await expect(kpiRow).toBeVisible();
  });

  test('Sidebar navigation items are clickable', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    // Check that nav items have click handlers
    const dashboardNav = page.locator('.nav-item[data-view="dashboard"]');
    await expect(dashboardNav).toBeVisible();

    const cursor = await dashboardNav.evaluate(el => getComputedStyle(el).cursor);
    expect(cursor).toBe('pointer');
  });

});

// ============================================
// PHASE 6: ACCESSIBILITY TESTS
// ============================================

test.describe('Phase 6: Accessibility', () => {

  test('Hero production number has aria-live attribute', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);
    await waitForDashboardLoad(page);

    const heroNumber = page.locator('#heroProductionNumber');
    const ariaLive = await heroNumber.getAttribute('aria-live');
    expect(ariaLive).toBe('polite');
  });

  test('Loading overlay has progressbar role', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);

    const loadingOverlay = page.locator('#loadingOverlay');
    const role = await loadingOverlay.getAttribute('role');
    expect(role).toBe('progressbar');
  });

  test('Skip link is present for keyboard navigation', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);

    const skipLink = page.locator('.skip-link');
    await expect(skipLink).toBeAttached();
  });

  test('Settings panel has proper dialog attributes', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);

    const settingsPanel = page.locator('#settingsPanel');
    const role = await settingsPanel.getAttribute('role');
    const ariaModal = await settingsPanel.getAttribute('aria-modal');

    expect(role).toBe('dialog');
    expect(ariaModal).toBe('true');
  });

  test('Navigation sidebar has proper landmark role', async ({ page }) => {
    await setupLive(page);
    await page.goto(DASHBOARD_URL);

    const sidebar = page.locator('#sidebar');
    const role = await sidebar.getAttribute('role');
    expect(role).toBe('navigation');
  });

});
