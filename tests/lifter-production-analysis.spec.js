const { test } = require('@playwright/test');

test('comprehensive Lifter production analysis', async ({ page }) => {
  console.log('=== LIFTER PRODUCTION ANALYSIS ===\n');

  // Step 1: Get all available cultivars
  console.log('Step 1: Fetching available cultivars...');
  const cultivarsData = await page.evaluate(async () => {
    const res = await fetch('https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=getCultivars');
    const raw = await res.json();
    return raw.data || raw;
  });

  console.log('\nAvailable Cultivars:');
  cultivarsData.cultivars.forEach(c => console.log(`  - ${c}`));

  // Find Lifter variants
  const lifterVariants = cultivarsData.cultivars.filter(c =>
    c.toLowerCase().includes('lifter')
  );

  if (lifterVariants.length === 0) {
    console.log('\n❌ No Lifter cultivars found in database');
    return;
  }

  console.log(`\n✓ Found ${lifterVariants.length} Lifter variant(s):`);
  lifterVariants.forEach(v => console.log(`  - ${v}`));

  // Step 2: Get dashboard data to find date range
  console.log('\n\nStep 2: Fetching dashboard data for date range...');
  const dashboardData = await page.evaluate(async () => {
    const res = await fetch('https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=dashboard&days=90');
    const raw = await res.json();
    return raw.data || raw;
  });

  const availableDates = dashboardData.daily.map(d => d.date).sort();
  console.log(`\nDate range: ${availableDates[0]} to ${availableDates[availableDates.length - 1]}`);
  console.log(`Total days: ${availableDates.length}`);

  // Step 3: Query production data for each day and find Lifter
  console.log('\n\nStep 3: Querying hourly production data for Lifter...');

  const lifterData = [];

  for (const date of availableDates) {
    const dayData = await page.evaluate(async (dateParam) => {
      const res = await fetch(`https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production?action=getProduction&date=${dateParam}`);
      const raw = await res.json();
      return raw.data || raw;
    }, date);

    // Check each time slot for Lifter
    if (dayData.production) {
      dayData.production.forEach(slot => {
        // Check Line 1
        if (slot.cultivar1 && slot.cultivar1.toLowerCase().includes('lifter')) {
          lifterData.push({
            date,
            timeSlot: slot.timeSlot,
            line: 1,
            cultivar: slot.cultivar1,
            tops: slot.tops1,
            smalls: slot.smalls1,
            trimmers: slot.trimmers1,
            buckers: slot.buckers1,
            tzero: slot.tzero1,
          });
        }

        // Check Line 2
        if (slot.cultivar2 && slot.cultivar2.toLowerCase().includes('lifter')) {
          lifterData.push({
            date,
            timeSlot: slot.timeSlot,
            line: 2,
            cultivar: slot.cultivar2,
            tops: slot.tops2,
            smalls: slot.smalls2,
            trimmers: slot.trimmers2,
            buckers: slot.buckers2,
            tzero: slot.tzero2,
          });
        }
      });
    }
  }

  if (lifterData.length === 0) {
    console.log('\n❌ No Lifter production data found in hourly records');
    return;
  }

  console.log(`\n✓ Found ${lifterData.length} Lifter production hours\n`);

  // Calculate totals
  let totalTops = 0;
  let totalSmalls = 0;
  let totalTrimmerHours = 0;
  let totalBuckerHours = 0;
  let totalTzeroHours = 0;
  const datesWithLifter = new Set();

  lifterData.forEach(entry => {
    totalTops += entry.tops;
    totalSmalls += entry.smalls;
    totalTrimmerHours += entry.trimmers;
    totalBuckerHours += entry.buckers;
    totalTzeroHours += entry.tzero;
    datesWithLifter.add(entry.date);
  });

  const totalLbs = totalTops + totalSmalls;
  const totalCrewHours = totalTrimmerHours + totalBuckerHours + totalTzeroHours;
  const waterspiderHours = lifterData.length; // 1 waterspider per active hour
  const totalOperatorHours = totalCrewHours + waterspiderHours;

  console.log('=== LIFTER PRODUCTION SUMMARY ===\n');
  console.log('Production:');
  console.log(`  Total: ${totalLbs.toFixed(1)} lbs`);
  console.log(`  - Tops: ${totalTops.toFixed(1)} lbs (${(totalTops / totalLbs * 100).toFixed(1)}%)`);
  console.log(`  - Smalls: ${totalSmalls.toFixed(1)} lbs (${(totalSmalls / totalLbs * 100).toFixed(1)}%)`);

  console.log('\nLabor:');
  console.log(`  Trimmer Hours: ${totalTrimmerHours}`);
  console.log(`  Bucker Hours: ${totalBuckerHours}`);
  console.log(`  T-Zero Hours: ${totalTzeroHours}`);
  console.log(`  Waterspider Hours: ${waterspiderHours} (1 per active hour)`);
  console.log(`  Total Operator Hours: ${totalOperatorHours}`);

  const avgRate = totalCrewHours > 0 ? totalLbs / totalCrewHours : 0;
  console.log('\nEfficiency:');
  console.log(`  Average Rate: ${avgRate.toFixed(2)} lbs/crew-hour`);

  console.log(`\nProduction Days: ${datesWithLifter.size}`);

  // Calculate split labor costs
  const HOURLY_RATE = 26.22; // $23 base + 14% taxes
  const topsRatio = totalLbs > 0 ? totalTops / totalLbs : 0;
  const smallsRatio = totalLbs > 0 ? totalSmalls / totalLbs : 0;

  // Split costs: Trimmers 100% to tops, others split by weight
  const sharedHours = totalBuckerHours + totalTzeroHours + waterspiderHours;
  const topsSharedHours = sharedHours * topsRatio;
  const smallsSharedHours = sharedHours * smallsRatio;

  const topsLaborHours = totalTrimmerHours + topsSharedHours;
  const smallsLaborHours = smallsSharedHours;

  const topsLaborCost = topsLaborHours * HOURLY_RATE;
  const smallsLaborCost = smallsLaborHours * HOURLY_RATE;
  const totalLaborCost = topsLaborCost + smallsLaborCost;

  const topsCostPerLb = totalTops > 0 ? topsLaborCost / totalTops : 0;
  const smallsCostPerLb = totalSmalls > 0 ? smallsLaborCost / totalSmalls : 0;
  const blendedCostPerLb = totalLbs > 0 ? totalLaborCost / totalLbs : 0;

  console.log('\n=== LIFTER LABOR COSTS ===');
  console.log(`Total Labor Cost: $${totalLaborCost.toFixed(2)}`);
  console.log(`\nTops:`);
  console.log(`  Labor: ${topsLaborHours.toFixed(1)} hrs × $${HOURLY_RATE} = $${topsLaborCost.toFixed(2)}`);
  console.log(`  Cost/Lb: $${topsCostPerLb.toFixed(2)}/lb`);
  console.log(`\nSmalls:`);
  console.log(`  Labor: ${smallsLaborHours.toFixed(1)} hrs × $${HOURLY_RATE} = $${smallsLaborCost.toFixed(2)}`);
  console.log(`  Cost/Lb: $${smallsCostPerLb.toFixed(2)}/lb`);
  console.log(`\nBlended: $${blendedCostPerLb.toFixed(2)}/lb`);

  // Show breakdown by date
  console.log('\n=== LIFTER BY DATE ===');
  const dateMap = {};
  lifterData.forEach(entry => {
    if (!dateMap[entry.date]) {
      dateMap[entry.date] = {
        tops: 0,
        smalls: 0,
        trimmers: 0,
        buckers: 0,
        tzero: 0,
        hours: 0,
      };
    }
    dateMap[entry.date].tops += entry.tops;
    dateMap[entry.date].smalls += entry.smalls;
    dateMap[entry.date].trimmers += entry.trimmers;
    dateMap[entry.date].buckers += entry.buckers;
    dateMap[entry.date].tzero += entry.tzero;
    dateMap[entry.date].hours++;
  });

  Object.keys(dateMap).sort().forEach(date => {
    const data = dateMap[date];
    const total = data.tops + data.smalls;
    const crewHours = data.trimmers + data.buckers + data.tzero;
    const rate = crewHours > 0 ? total / crewHours : 0;
    console.log(`${date}: ${total.toFixed(1)} lbs (${data.tops.toFixed(1)} tops, ${data.smalls.toFixed(1)} smalls)`);
    console.log(`          ${data.hours} hours, ${crewHours} crew-hours, ${rate.toFixed(2)} lbs/crew-hr`);
  });

  // Show sample hours
  console.log('\n=== SAMPLE LIFTER HOURS (First 5) ===');
  lifterData.slice(0, 5).forEach(entry => {
    console.log(`${entry.date} ${entry.timeSlot} (Line ${entry.line}): ${entry.cultivar}`);
    console.log(`  Production: ${entry.tops} tops, ${entry.smalls} smalls`);
    console.log(`  Crew: ${entry.trimmers} trimmers, ${entry.buckers} buckers, ${entry.tzero} tzero`);
  });

  console.log('\n=== ANALYSIS COMPLETE ===');
});
