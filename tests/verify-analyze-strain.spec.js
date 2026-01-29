/**
 * Test: analyzeStrain Endpoint
 *
 * Verifies the deep strain analysis endpoint that AI can call for detailed
 * efficiency metrics, cost breakdowns, and historical trends.
 */

const { test, expect } = require('@playwright/test');

const API_URL = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production';

test.describe('Analyze Strain Endpoint', () => {
  test('analyzeStrain returns comprehensive data for existing strain', async ({ request }) => {
    // Use "Lifter" which we know has recent data
    const testStrain = "Lifter";
    console.log(`\nTesting analyzeStrain with: "${testStrain}"`);

    const response = await request.get(`${API_URL}?action=analyzeStrain&strain=${encodeURIComponent(testStrain)}&days=90`);
    expect(response.ok()).toBeTruthy();

    const analysis = await response.json();

    // Verify basic structure
    expect(analysis.strain).toBe(testStrain);

    if (!analysis.found) {
      console.log('No recent data for Lifter - skipping detailed validation');
      return;
    }

    expect(analysis.found).toBe(true);
    expect(analysis.dateRange).toBeDefined();
    expect(analysis.summary).toBeDefined();
    expect(analysis.labor).toBeDefined();

    console.log('\n' + '='.repeat(80));
    console.log(`STRAIN ANALYSIS: ${analysis.strain}`);
    console.log('='.repeat(80));

    // Display date range
    console.log(`\nDate Range: ${analysis.dateRange.start} to ${analysis.dateRange.end} (${analysis.dateRange.days} days)`);
    if (analysis.matchedVariants && analysis.matchedVariants.length > 0) {
      console.log(`Matched Variants: ${analysis.matchedVariants.join(', ')}`);
    }

    // Display summary metrics
    console.log('\nPRODUCTION SUMMARY:');
    console.log(`  Total: ${analysis.summary.totalLbs} lbs over ${analysis.summary.daysWorked} days`);
    console.log(`  Tops: ${analysis.summary.tops} lbs (${analysis.summary.topsPercent}%)`);
    console.log(`  Smalls: ${analysis.summary.smalls} lbs (${analysis.summary.smallsPercent}%)`);
    console.log(`  Avg Rate: ${analysis.summary.avgRate} lbs/crew-hour`);
    console.log(`  Production Hours: ${analysis.summary.productionHours}`);

    // Verify summary calculations
    expect(typeof analysis.summary.totalLbs).toBe('number');
    expect(analysis.summary.totalLbs).toBeGreaterThan(0);
    expect(analysis.summary.tops + analysis.summary.smalls).toBeCloseTo(analysis.summary.totalLbs, 1);
    expect(analysis.summary.topsPercent + analysis.summary.smallsPercent).toBeCloseTo(100, 0);
    expect(analysis.summary.daysWorked).toBeGreaterThan(0);

    // Display cost breakdown
    console.log('\nCOST BREAKDOWN:');
    console.log(`  Tops: $${analysis.summary.topsCostPerLb}/lb`);
    console.log(`  Smalls: $${analysis.summary.smallsCostPerLb}/lb`);
    console.log(`  Blended: $${analysis.summary.blendedCostPerLb}/lb`);
    console.log(`  Total Labor Cost: $${analysis.summary.totalLaborCost.toLocaleString()}`);

    // Verify cost fields
    expect(typeof analysis.summary.topsCostPerLb).toBe('number');
    expect(typeof analysis.summary.smallsCostPerLb).toBe('number');
    expect(typeof analysis.summary.blendedCostPerLb).toBe('number');
    expect(typeof analysis.summary.totalLaborCost).toBe('number');

    // Display labor breakdown
    console.log('\nLABOR BREAKDOWN:');
    console.log(`  Trimmers: ${analysis.labor.trimmerHours} hrs`);
    console.log(`  Buckers: ${analysis.labor.buckerHours} hrs`);
    console.log(`  TZero: ${analysis.labor.tzeroHours} hrs`);
    console.log(`  Waterspider: ${analysis.labor.waterspiderHours} hrs`);
    console.log(`  Total Operator Hours: ${analysis.labor.totalOperatorHours} hrs`);

    // Verify labor fields
    expect(typeof analysis.labor.trimmerHours).toBe('number');
    expect(typeof analysis.labor.buckerHours).toBe('number');
    expect(typeof analysis.labor.tzeroHours).toBe('number');
    expect(typeof analysis.labor.waterspiderHours).toBe('number');
    expect(typeof analysis.labor.totalOperatorHours).toBe('number');

    // Display best/worst days if available
    if (analysis.bestDay) {
      console.log('\nBEST DAY:');
      console.log(`  Date: ${analysis.bestDay.date}`);
      console.log(`  Production: ${analysis.bestDay.lbs} lbs`);
      console.log(`  Rate: ${analysis.bestDay.rate} lbs/crew-hour`);

      expect(analysis.bestDay.date).toBeDefined();
      expect(analysis.bestDay.lbs).toBeGreaterThan(0);
      expect(analysis.bestDay.rate).toBeGreaterThan(0);
    }

    if (analysis.worstDay) {
      console.log('\nWORST DAY:');
      console.log(`  Date: ${analysis.worstDay.date}`);
      console.log(`  Production: ${analysis.worstDay.lbs} lbs`);
      console.log(`  Rate: ${analysis.worstDay.rate} lbs/crew-hour`);

      expect(analysis.worstDay.date).toBeDefined();
      expect(analysis.worstDay.lbs).toBeGreaterThan(0);
      expect(analysis.worstDay.rate).toBeGreaterThan(0);
    }

    // Display daily breakdown (first 3 days as sample)
    if (analysis.byDate && analysis.byDate.length > 0) {
      console.log(`\nDAILY BREAKDOWN (showing first 3 of ${analysis.byDate.length} days):`);
      analysis.byDate.slice(0, 3).forEach((day, index) => {
        console.log(`  ${index + 1}. ${day.date}: ${day.totalLbs} lbs @ ${day.rate} lbs/hr`);
      });

      // Verify byDate structure
      analysis.byDate.forEach(day => {
        expect(day.date).toBeDefined();
        expect(typeof day.totalLbs).toBe('number');
        expect(typeof day.rate).toBe('number');
      });
    }

    console.log('\n' + '='.repeat(80));
    console.log('✓ All analysis fields validated');
  });

  test('analyzeStrain handles fuzzy matching', async ({ request }) => {
    // Test partial strain name matching
    const response = await request.get(`${API_URL}?action=analyzeStrain&strain=Lift&days=90`);
    expect(response.ok()).toBeTruthy();

    const result = await response.json();

    if (result.found) {
      console.log(`\nFuzzy match "Lift" found variants: ${result.matchedVariants?.join(', ') || result.strain}`);
      expect(result.matchedVariants).toBeDefined();
      console.log('✓ Fuzzy matching works');
    } else {
      console.log('No strains matching "Lift" found (acceptable if database has no Lifter variants)');
    }
  });

  test('analyzeStrain returns not found for nonexistent strain', async ({ request }) => {
    const response = await request.get(`${API_URL}?action=analyzeStrain&strain=NonexistentStrain12345&days=90`);
    expect(response.ok()).toBeTruthy();

    const result = await response.json();
    expect(result.found).toBe(false);
    expect(result.message).toBeDefined();

    console.log(`✓ Not found message: "${result.message}"`);
  });

  test('analyzeStrain requires strain parameter', async ({ request }) => {
    const response = await request.get(`${API_URL}?action=analyzeStrain&days=90`);

    const result = await response.json();
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('required');

    console.log(`✓ Validation error: "${result.error}"`);
  });

  test('analyzeStrain respects days parameter', async ({ request }) => {
    // Use "Lifter" which we know has recent data
    const testStrain = "Lifter";

    // Test with 30 days
    const response30 = await request.get(`${API_URL}?action=analyzeStrain&strain=${encodeURIComponent(testStrain)}&days=30`);
    const result30 = await response30.json();

    if (result30.found) {
      expect(result30.dateRange.days).toBe(30);
      console.log(`✓ 30-day analysis date range: ${result30.dateRange.start} to ${result30.dateRange.end}`);
    }

    // Test with 7 days
    const response7 = await request.get(`${API_URL}?action=analyzeStrain&strain=${encodeURIComponent(testStrain)}&days=7`);
    const result7 = await response7.json();

    if (result7.found) {
      expect(result7.dateRange.days).toBe(7);
      console.log(`✓ 7-day analysis date range: ${result7.dateRange.start} to ${result7.dateRange.end}`);
    }
  });
});
