const { test } = require('@playwright/test');

test('find best tops/lb cost in historical data', async ({ page }) => {
  console.log('=== FINDING BEST TOPS COST/LB ===\n');

  // Fetch a large historical range (90 days)
  const response = await page.evaluate(async () => {
    const res = await fetch('https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=dashboard&days=90');
    const raw = await res.json();
    return raw.data || raw;
  });

  const daily = response.daily || [];

  console.log(`Analyzing ${daily.length} days of historical data...\n`);

  // Filter days with actual tops production and valid cost data
  const validDays = daily.filter(d => d.totalTops > 0 && d.topsCostPerLb > 0);

  console.log(`Found ${validDays.length} days with tops production and cost data\n`);

  if (validDays.length === 0) {
    console.log('No valid days found with tops cost data');
    return;
  }

  // Find the day with the lowest tops cost per lb
  const bestDay = validDays.reduce((best, current) => {
    return current.topsCostPerLb < best.topsCostPerLb ? current : best;
  });

  console.log('=== BEST TOPS COST/LB FOUND ===');
  console.log(`Date: ${bestDay.date}`);
  console.log(`Tops Cost: $${bestDay.topsCostPerLb.toFixed(2)}/lb`);
  console.log(`\nProduction Details:`);
  console.log(`  Tops: ${bestDay.totalTops} lbs`);
  console.log(`  Smalls: ${bestDay.totalSmalls} lbs`);
  console.log(`  Total: ${bestDay.totalLbs} lbs`);
  console.log(`  Avg Rate: ${bestDay.avgRate} lbs/trimmer/hr`);
  console.log(`  Operator Hours: ${bestDay.operatorHours}`);
  console.log(`  Trimmer Hours: ${bestDay.trimmerHours || 'N/A'}`);
  console.log(`  Labor Cost: $${bestDay.laborCost.toFixed(2)}`);
  console.log(`\nCost Comparison:`);
  console.log(`  Tops Cost/Lb: $${bestDay.topsCostPerLb.toFixed(2)}`);
  console.log(`  Smalls Cost/Lb: $${bestDay.smallsCostPerLb.toFixed(2)}`);
  console.log(`  Blended Cost/Lb: $${bestDay.costPerLb.toFixed(2)}`);

  // Find top 5 best days
  console.log('\n=== TOP 5 BEST DAYS ===');
  const top5 = validDays
    .sort((a, b) => a.topsCostPerLb - b.topsCostPerLb)
    .slice(0, 5);

  top5.forEach((day, index) => {
    console.log(`\n${index + 1}. ${day.date}`);
    console.log(`   Cost: $${day.topsCostPerLb.toFixed(2)}/lb`);
    console.log(`   Production: ${day.totalTops} lbs tops, ${day.avgRate} lbs/trimmer/hr`);
    console.log(`   Labor: ${day.operatorHours} operator hours, $${day.laborCost.toFixed(2)} total`);
  });

  // Find worst day for comparison
  const worstDay = validDays.reduce((worst, current) => {
    return current.topsCostPerLb > worst.topsCostPerLb ? current : worst;
  });

  console.log('\n=== WORST TOPS COST/LB (FOR COMPARISON) ===');
  console.log(`Date: ${worstDay.date}`);
  console.log(`Cost: $${worstDay.topsCostPerLb.toFixed(2)}/lb`);
  console.log(`Production: ${worstDay.totalTops} lbs tops`);

  console.log('\n=== SUMMARY ===');
  console.log(`Best: $${bestDay.topsCostPerLb.toFixed(2)}/lb on ${bestDay.date}`);
  console.log(`Worst: $${worstDay.topsCostPerLb.toFixed(2)}/lb on ${worstDay.date}`);
  console.log(`Range: $${(worstDay.topsCostPerLb - bestDay.topsCostPerLb).toFixed(2)}/lb difference`);

  const avgCost = validDays.reduce((sum, d) => sum + d.topsCostPerLb, 0) / validDays.length;
  console.log(`Average: $${avgCost.toFixed(2)}/lb across ${validDays.length} days`);
});
