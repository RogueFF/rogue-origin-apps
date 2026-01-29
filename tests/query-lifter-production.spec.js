const { test } = require('@playwright/test');

test('query Lifter production from D1 database', async ({ page }) => {
  console.log('=== LIFTER PRODUCTION QUERY ===\n');

  // Query the database directly through a fetch to see what cultivar data we have
  const lifterData = await page.evaluate(async () => {
    // First, let's see what the hourly endpoint returns
    const res = await fetch('https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=hourly&days=90');
    const raw = await res.json();
    return raw;
  });

  console.log('Response structure:', Object.keys(lifterData));

  // Check if we got an array of hourly data
  if (Array.isArray(lifterData)) {
    console.log(`\nReceived ${lifterData.length} hourly records\n`);

    // Show sample record
    if (lifterData.length > 0) {
      console.log('Sample record structure:', Object.keys(lifterData[0]));
      console.log('First record:', lifterData[0]);
    }

    // Filter for records with cultivar containing "Lifter"
    const lifterRecords = lifterData.filter(row => {
      const cultivar = row.cultivar1 || row.cultivar || '';
      return cultivar.toLowerCase().includes('lifter');
    });

    console.log(`\n=== FOUND ${lifterRecords.length} LIFTER RECORDS ===\n`);

    if (lifterRecords.length > 0) {
      // Calculate totals
      let totalTops = 0;
      let totalSmalls = 0;
      let totalTrimmerHours = 0;
      let totalBuckerHours = 0;
      const dates = new Set();

      lifterRecords.forEach(row => {
        totalTops += row.tops_lbs1 || 0;
        totalSmalls += row.smalls_lbs1 || 0;
        totalTrimmerHours += row.trimmers_line1 || 0;
        totalBuckerHours += row.buckers_line1 || 0;
        if (row.production_date) dates.add(row.production_date);
      });

      const totalLbs = totalTops + totalSmalls;
      const totalCrewHours = totalTrimmerHours + totalBuckerHours;
      const avgRate = totalCrewHours > 0 ? totalLbs / totalCrewHours : 0;

      console.log('=== LIFTER PRODUCTION SUMMARY ===');
      console.log(`Total Production: ${totalLbs.toFixed(1)} lbs`);
      console.log(`  - Tops: ${totalTops.toFixed(1)} lbs`);
      console.log(`  - Smalls: ${totalSmalls.toFixed(1)} lbs`);
      console.log(`\nLabor:`);
      console.log(`  - Trimmer Hours: ${totalTrimmerHours}`);
      console.log(`  - Bucker Hours: ${totalBuckerHours}`);
      console.log(`  - Total Crew Hours: ${totalCrewHours}`);
      console.log(`\nEfficiency:`);
      console.log(`  - Average Rate: ${avgRate.toFixed(2)} lbs/crew-hour`);
      console.log(`\nDays with Lifter: ${dates.size}`);

      // Show breakdown by date
      console.log('\n=== LIFTER BY DATE ===');
      const dateMap = {};
      lifterRecords.forEach(row => {
        const date = row.production_date;
        if (!dateMap[date]) {
          dateMap[date] = { tops: 0, smalls: 0, hours: 0 };
        }
        dateMap[date].tops += row.tops_lbs1 || 0;
        dateMap[date].smalls += row.smalls_lbs1 || 0;
        dateMap[date].hours += (row.trimmers_line1 || 0) + (row.buckers_line1 || 0);
      });

      Object.keys(dateMap).sort().forEach(date => {
        const data = dateMap[date];
        const total = data.tops + data.smalls;
        const rate = data.hours > 0 ? total / data.hours : 0;
        console.log(`${date}: ${total.toFixed(1)} lbs (${data.tops.toFixed(1)} tops, ${data.smalls.toFixed(1)} smalls) - ${rate.toFixed(2)} lbs/hr`);
      });

      // Show sample records
      console.log('\n=== SAMPLE LIFTER RECORDS ===');
      lifterRecords.slice(0, 5).forEach(row => {
        console.log(`${row.production_date} ${row.time_slot}: ${row.cultivar1 || row.cultivar}`);
        console.log(`  Production: ${row.tops_lbs1 || 0} tops, ${row.smalls_lbs1 || 0} smalls`);
        console.log(`  Crew: ${row.trimmers_line1 || 0} trimmers, ${row.buckers_line1 || 0} buckers`);
      });

      // Calculate labor cost for Lifter
      const HOURLY_RATE = 26.22; // $23 base + 14% taxes
      const topsRatio = totalTops / totalLbs;
      const smallsRatio = totalSmalls / totalLbs;

      const sharedHours = totalBuckerHours; // Buckers split by weight
      const topsSharedHours = sharedHours * topsRatio;
      const smallsSharedHours = sharedHours * smallsRatio;

      const topsLaborHours = totalTrimmerHours + topsSharedHours;
      const smallsLaborHours = smallsSharedHours;

      const topsLaborCost = topsLaborHours * HOURLY_RATE;
      const smallsLaborCost = smallsLaborHours * HOURLY_RATE;

      const topsCostPerLb = totalTops > 0 ? topsLaborCost / totalTops : 0;
      const smallsCostPerLb = totalSmalls > 0 ? smallsLaborCost / totalSmalls : 0;

      console.log('\n=== LIFTER LABOR COSTS ===');
      console.log(`Tops Labor: ${topsLaborHours.toFixed(1)} hrs × $${HOURLY_RATE} = $${topsLaborCost.toFixed(2)}`);
      console.log(`Tops Cost/Lb: $${topsCostPerLb.toFixed(2)}/lb`);
      console.log(`\nSmalls Labor: ${smallsLaborHours.toFixed(1)} hrs × $${HOURLY_RATE} = $${smallsLaborCost.toFixed(2)}`);
      console.log(`Smalls Cost/Lb: $${smallsCostPerLb.toFixed(2)}/lb`);

    } else {
      console.log('❌ No Lifter records found');
      console.log('\nShowing sample cultivar values:');
      const cultivars = [...new Set(lifterData.map(row => row.cultivar1 || row.cultivar).filter(Boolean))];
      console.log('Available cultivars:', cultivars.slice(0, 20));
    }

  } else if (lifterData.data && Array.isArray(lifterData.data)) {
    console.log('Data wrapped in response object');
    // Repeat above logic with lifterData.data
  } else {
    console.log('Unexpected response format:', lifterData);
  }

  console.log('\n=== QUERY COMPLETE ===');
});
