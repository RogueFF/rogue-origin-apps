const { test } = require('@playwright/test');

test('analyze Lifter strain production data', async ({ page }) => {
  console.log('=== LIFTER STRAIN ANALYSIS ===\n');

  // Fetch 90 days of production data
  const response = await page.evaluate(async () => {
    const res = await fetch('https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=dashboard&days=90');
    const raw = await res.json();
    return raw.data || raw;
  });

  console.log(`Analyzing ${response.daily?.length || 0} days of data...\n`);

  // Check if the API returns strain-level data
  console.log('=== CHECKING DATA STRUCTURE ===');

  if (response.today) {
    console.log('Today\'s data keys:', Object.keys(response.today));
  }

  if (response.daily && response.daily.length > 0) {
    console.log('Daily data sample (first day):', Object.keys(response.daily[0]));
  }

  // Check if there's hourly data with strain information
  if (response.hourly && response.hourly.length > 0) {
    console.log('\nHourly data sample (first entry):', response.hourly[0]);

    // Filter for Lifter entries
    const lifterHours = response.hourly.filter(h =>
      h.strain && h.strain.toLowerCase().includes('lifter')
    );

    if (lifterHours.length > 0) {
      console.log(`\n=== FOUND ${lifterHours.length} LIFTER HOURLY ENTRIES ===\n`);

      let totalLifterTops = 0;
      let totalLifterSmalls = 0;
      const dates = new Set();

      lifterHours.forEach(h => {
        totalLifterTops += h.tops || 0;
        totalLifterSmalls += h.smalls || 0;
        if (h.date) dates.add(h.date);
      });

      console.log('Lifter Production Summary:');
      console.log(`  Total Tops: ${totalLifterTops.toFixed(1)} lbs`);
      console.log(`  Total Smalls: ${totalLifterSmalls.toFixed(1)} lbs`);
      console.log(`  Total Production: ${(totalLifterTops + totalLifterSmalls).toFixed(1)} lbs`);
      console.log(`  Days with Lifter: ${dates.size}`);

      // Show sample entries
      console.log('\n=== SAMPLE LIFTER ENTRIES ===');
      lifterHours.slice(0, 5).forEach(h => {
        console.log(`${h.date || 'N/A'} ${h.timeSlot || 'N/A'}: ${h.strain}`);
        console.log(`  Tops: ${h.tops || 0} lbs, Smalls: ${h.smalls || 0} lbs`);
        console.log(`  Crew: ${h.trimmers || 0} trimmers, ${h.buckers || 0} buckers`);
      });

      // Calculate average rate for Lifter
      const lifterWithRate = lifterHours.filter(h => h.lbs && h.trimmers > 0);
      if (lifterWithRate.length > 0) {
        const avgLifterRate = lifterWithRate.reduce((sum, h) => {
          const rate = h.lbs / h.trimmers;
          return sum + rate;
        }, 0) / lifterWithRate.length;

        console.log(`\n  Average Lifter Rate: ${avgLifterRate.toFixed(2)} lbs/trimmer/hr`);
      }
    } else {
      console.log('\n❌ No Lifter entries found in hourly data');
      console.log('\nShowing sample strain values:');
      const strains = [...new Set(response.hourly.map(h => h.strain).filter(Boolean))];
      console.log('Available strains:', strains.slice(0, 10));
    }
  } else {
    console.log('\n❌ No hourly data available in API response');
  }

  // Alternative: Query the database directly for cultivar column
  console.log('\n=== CHECKING CULTIVAR FIELD ===');

  const dbQuery = await page.evaluate(async () => {
    try {
      // Try to get hourly data with cultivar field
      const res = await fetch('https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=hourly&days=30');
      const raw = await res.json();
      return raw.data || raw;
    } catch (err) {
      return { error: err.message };
    }
  });

  if (dbQuery && dbQuery.length > 0) {
    console.log('Hourly endpoint sample:', dbQuery[0]);

    // Look for Lifter in cultivar field
    const lifterEntries = dbQuery.filter(row =>
      row.cultivar && row.cultivar.toLowerCase().includes('lifter')
    );

    if (lifterEntries.length > 0) {
      console.log(`\n✓ Found ${lifterEntries.length} Lifter entries in cultivar field`);

      let totalTops = 0;
      let totalSmalls = 0;

      lifterEntries.forEach(row => {
        totalTops += row.tops_lbs1 || 0;
        totalSmalls += row.smalls_lbs1 || 0;
      });

      console.log('\nLifter Production (from cultivar field):');
      console.log(`  Tops: ${totalTops.toFixed(1)} lbs`);
      console.log(`  Smalls: ${totalSmalls.toFixed(1)} lbs`);
      console.log(`  Total: ${(totalTops + totalSmalls).toFixed(1)} lbs`);
    }
  }

  console.log('\n=== ANALYSIS COMPLETE ===');
});
