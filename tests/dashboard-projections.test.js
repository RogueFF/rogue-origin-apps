/**
 * Dashboard Projections Test
 * Verifies that dashboard uses backend projections (same as scoreboard)
 */
const { test, expect } = require('@playwright/test');

const DASHBOARD_URL = 'https://rogueff.github.io/rogue-origin-apps/src/pages/index.html';
const API_URL = 'https://script.google.com/macros/s/AKfycbxDAHSFl9cedGS49L3Lf5ztqy-SSToYigyA30ZtsdpmWNAR9H61X_Mm48JOOTGqqr-Z/exec';

test.describe('Dashboard Projections', () => {

  test('API returns projection values', async ({ request }) => {
    // Fetch dashboard API directly
    const response = await request.get(`${API_URL}?action=dashboard`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.success).toBe(true);

    // Verify new projection fields exist in current object
    const current = data.data.current;
    console.log('API current object:', JSON.stringify(current, null, 2));

    expect(current).toHaveProperty('projectedTotal');
    expect(current).toHaveProperty('dailyGoal');
    expect(current).toHaveProperty('projectedDelta');
    expect(current).toHaveProperty('effectiveHours');

    // Verify they are numbers (not undefined/null)
    expect(typeof current.projectedTotal).toBe('number');
    expect(typeof current.dailyGoal).toBe('number');
    expect(typeof current.projectedDelta).toBe('number');
    expect(typeof current.effectiveHours).toBe('number');

    // Verify projection math: projectedDelta = projectedTotal - dailyGoal
    const calculatedDelta = current.projectedTotal - current.dailyGoal;
    expect(current.projectedDelta).toBeCloseTo(calculatedDelta, 1);

    console.log(`Projected: ${current.projectedTotal.toFixed(1)} lbs`);
    console.log(`Daily Goal: ${current.dailyGoal.toFixed(1)} lbs`);
    console.log(`Delta: ${current.projectedDelta.toFixed(1)} lbs`);
  });

  test('Dashboard displays projection from API', async ({ page }) => {
    // Intercept API call to capture response
    let apiResponse = null;
    await page.route('**/exec?action=dashboard**', async (route) => {
      const response = await route.fetch();
      apiResponse = await response.json();
      await route.fulfill({ response });
    });

    // Navigate to dashboard
    await page.goto(DASHBOARD_URL);

    // Wait for data to load (hero section should populate)
    await page.waitForFunction(() => {
      const el = document.getElementById('heroTargetValue');
      return el && el.textContent && el.textContent !== '--';
    }, { timeout: 30000 });

    // Get displayed projection value
    const displayedProjection = await page.locator('#heroTargetValue').textContent();
    console.log('Displayed projection:', displayedProjection);

    // Verify API was called and has projection data
    expect(apiResponse).not.toBeNull();
    expect(apiResponse.data.current.projectedTotal).toBeGreaterThan(0);

    // Parse displayed value (e.g., "56 lbs" -> 56)
    const displayedValue = parseFloat(displayedProjection.replace(/[^\d.]/g, ''));
    const apiProjection = apiResponse.data.current.projectedTotal;

    console.log(`API projection: ${apiProjection.toFixed(1)} lbs`);
    console.log(`Displayed value: ${displayedValue} lbs`);

    // They should match (within rounding)
    expect(displayedValue).toBeCloseTo(apiProjection, 0);

    // Take screenshot for verification
    await page.screenshot({
      path: 'tests/screenshots/dashboard-projections.png',
      fullPage: false
    });
  });

  test('Compare dashboard and scoreboard projections', async ({ request }) => {
    // Fetch both APIs
    const [dashboardRes, scoreboardRes] = await Promise.all([
      request.get(`${API_URL}?action=dashboard`),
      request.get(`${API_URL}?action=scoreboard`)
    ]);

    const dashboardData = await dashboardRes.json();
    const scoreboardData = await scoreboardRes.json();

    const dashboardProjection = dashboardData.data.current.projectedTotal;
    const scoreboardProjection = scoreboardData.scoreboard.projectedTotal;

    const dashboardGoal = dashboardData.data.current.dailyGoal;
    const scoreboardGoal = scoreboardData.scoreboard.dailyGoal;

    console.log('Dashboard projection:', dashboardProjection);
    console.log('Scoreboard projection:', scoreboardProjection);
    console.log('Dashboard dailyGoal:', dashboardGoal);
    console.log('Scoreboard dailyGoal:', scoreboardGoal);

    // They should be identical (both from same backend calculation)
    expect(dashboardProjection).toBeCloseTo(scoreboardProjection, 1);
    expect(dashboardGoal).toBeCloseTo(scoreboardGoal, 1);
  });
});
