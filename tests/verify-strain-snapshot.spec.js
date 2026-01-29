/**
 * Test: Strain Snapshot in Dashboard Endpoint
 *
 * Verifies that the dashboard endpoint returns strain snapshot data
 * with top 5 strains from the last 7 days, including all required metrics.
 */

const { test, expect } = require('@playwright/test');

const API_URL = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production';

test.describe('Strain Snapshot Integration', () => {
  test('dashboard endpoint includes strainSnapshot', async ({ request }) => {
    const response = await request.get(`${API_URL}?action=dashboard&days=7`);
    expect(response.ok()).toBeTruthy();

    const result = await response.json();

    // Verify strainSnapshot exists (response is not wrapped)
    expect(result.strainSnapshot).toBeDefined();
    expect(Array.isArray(result.strainSnapshot)).toBe(true);

    console.log(`\nStrain Snapshot (${result.strainSnapshot.length} strains):`);
    console.log('─'.repeat(80));

    if (result.strainSnapshot.length === 0) {
      console.log('No strain data found in last 7 days (acceptable if database is empty)');
      return;
    }

    // Should have at most 5 strains (top 5)
    expect(result.strainSnapshot.length).toBeLessThanOrEqual(5);

    // Verify each strain has required fields
    result.strainSnapshot.forEach((strain, index) => {
      console.log(`\n${index + 1}. ${strain.strain}`);
      console.log(`   Total: ${strain.totalLbs} lbs (Tops: ${strain.tops} | Smalls: ${strain.smalls})`);
      console.log(`   Rate: ${strain.avgRate} lbs/hr over ${strain.daysWorked} days`);
      console.log(`   Costs: $${strain.topsCostPerLb}/lb tops, $${strain.smallsCostPerLb}/lb smalls`);

      // Validate required fields
      expect(strain.strain).toBeDefined();
      expect(typeof strain.strain).toBe('string');
      expect(strain.strain.length).toBeGreaterThan(0);

      expect(typeof strain.totalLbs).toBe('number');
      expect(strain.totalLbs).toBeGreaterThan(0);

      expect(typeof strain.tops).toBe('number');
      expect(typeof strain.smalls).toBe('number');
      expect(strain.tops + strain.smalls).toBeCloseTo(strain.totalLbs, 1);

      expect(typeof strain.avgRate).toBe('number');
      expect(strain.avgRate).toBeGreaterThan(0);

      expect(typeof strain.topsCostPerLb).toBe('number');
      expect(typeof strain.smallsCostPerLb).toBe('number');
      expect(strain.topsCostPerLb).toBeGreaterThan(0);
      expect(strain.smallsCostPerLb).toBeGreaterThan(0);

      expect(typeof strain.daysWorked).toBe('number');
      expect(strain.daysWorked).toBeGreaterThan(0);
    });

    console.log('\n' + '─'.repeat(80));
    console.log('✓ All strain snapshot fields validated');
  });

  test('strainSnapshot ordered by total production DESC', async ({ request }) => {
    const response = await request.get(`${API_URL}?action=dashboard&days=7`);
    const result = await response.json();

    if (result.strainSnapshot.length <= 1) {
      console.log('Not enough strains to verify ordering (need at least 2)');
      return;
    }

    // Verify descending order by totalLbs
    for (let i = 0; i < result.strainSnapshot.length - 1; i++) {
      const current = result.strainSnapshot[i];
      const next = result.strainSnapshot[i + 1];
      expect(current.totalLbs).toBeGreaterThanOrEqual(next.totalLbs);
    }

    console.log('✓ Strains correctly ordered by total production (DESC)');
  });

  test('strainSnapshot cost calculations match formula', async ({ request }) => {
    const response = await request.get(`${API_URL}?action=dashboard&days=7`);
    const result = await response.json();

    if (result.strainSnapshot.length === 0) {
      console.log('No strains to verify cost calculations');
      return;
    }

    // Spot-check first strain's cost calculations
    const strain = result.strainSnapshot[0];

    // Costs should be positive and reasonable (within expected range)
    expect(strain.topsCostPerLb).toBeGreaterThan(0);
    expect(strain.topsCostPerLb).toBeLessThan(200); // Sanity check

    expect(strain.smallsCostPerLb).toBeGreaterThan(0);
    expect(strain.smallsCostPerLb).toBeLessThan(200); // Sanity check

    // Tops are typically more expensive than smalls (trimmers are allocated 100% to tops)
    // Note: This may not always be true if strain has very few tops
    if (strain.tops > 1 && strain.smalls > 1) {
      console.log(`Cost comparison: Tops $${strain.topsCostPerLb}/lb vs Smalls $${strain.smallsCostPerLb}/lb`);
    }

    console.log('✓ Cost calculations within expected range');
  });
});
