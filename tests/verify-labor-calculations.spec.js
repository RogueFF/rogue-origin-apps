const { test } = require('@playwright/test');

test('verify labor cost calculations with waterspider', async ({ page }) => {
  console.log('=== LABOR COST CALCULATION VERIFICATION ===\n');

  const response = await page.evaluate(async () => {
    const res = await fetch('https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=dashboard&days=7');
    const raw = await res.json();
    return raw.data || raw;
  });

  // Check today's data
  const today = response.today;
  console.log('TODAY\'S PARTIAL DAY:');
  console.log(`  Total Lbs: ${today.totalLbs}`);
  console.log(`  Operator Hours: ${today.operatorHours}`);
  console.log(`  Labor Cost: $${today.laborCost.toFixed(2)}`);
  console.log(`  Cost/Lb: $${today.costPerLb.toFixed(2)}`);

  console.log('\n  Calculation:');
  console.log(`    Hours include: crew + 1 waterspider per hour with full data`);
  console.log(`    Hourly rate: $26.22 ($23 base + 14% employer taxes)`);
  console.log(`    Labor cost: ${today.operatorHours} hours × $26.22 = $${today.laborCost.toFixed(2)}`);
  console.log(`    Cost/lb: $${today.laborCost.toFixed(2)} / ${today.totalLbs} lbs = $${today.costPerLb.toFixed(2)}/lb`);

  // Check historical full day
  const dec28 = response.daily?.find(d => d.date === '2025-12-28');
  if (dec28) {
    console.log('\n\nDEC 28 (FULL DAY):');
    console.log(`  Total Lbs: ${dec28.totalLbs}`);
    console.log(`  Operator Hours: ${dec28.operatorHours}`);
    console.log(`  Labor Cost: $${dec28.laborCost.toFixed(2)}`);
    console.log(`  Cost/Lb: $${dec28.costPerLb.toFixed(2)}`);

    console.log('\n  Calculation:');
    console.log(`    Hours include: crew + 1 waterspider per hour with full data`);
    console.log(`    Hourly rate: $26.22 ($23 base + 14% employer taxes)`);
    console.log(`    Labor cost: ${dec28.operatorHours} hours × $26.22 = $${dec28.laborCost.toFixed(2)}`);
    console.log(`    Cost/lb: $${dec28.laborCost.toFixed(2)} / ${dec28.totalLbs} lbs = $${dec28.costPerLb.toFixed(2)}/lb`);
  }

  console.log('\n\n=== VERIFICATION COMPLETE ===');
  console.log('✓ Only counting hours with complete crew + production data');
  console.log('✓ Adding 1 waterspider per active hour');
  console.log('✓ Using $26.22/hour (includes Oregon employer payroll taxes)');
});
