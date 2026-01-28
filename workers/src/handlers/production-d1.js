/**
 * Production Tracking API Handler - D1 Version
 * Migrated from Google Sheets to Cloudflare D1
 */

import { query, queryOne, insert, execute } from '../lib/db.js';
import { readSheet, getSheetNames } from '../lib/sheets.js';
import { successResponse, errorResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { createError, formatError } from '../lib/errors.js';
import { sanitizeForSheets, validateDate } from '../lib/validate.js';

const AI_MODEL = 'claude-sonnet-4-20250514';
const TIMEZONE = 'America/Los_Angeles';

// Labor cost configuration
const BASE_WAGE_RATE = 23.00; // $/hour before taxes
const EMPLOYER_TAX_RATE = 0.14; // Oregon employer taxes: FICA 7.65%, FUTA 0.6%, SUI 2.4%, Workers' Comp 3%
const TOTAL_LABOR_COST_PER_HOUR = BASE_WAGE_RATE * (1 + EMPLOYER_TAX_RATE); // $26.22/hour

// Time slot multipliers for break adjustments
const TIME_SLOT_MULTIPLIERS = {
  '7:00 AM – 8:00 AM': 1.0,
  '8:00 AM – 9:00 AM': 1.0,
  '9:00 AM – 10:00 AM': 0.83,
  '10:00 AM – 11:00 AM': 1.0,
  '11:00 AM – 12:00 PM': 1.0,
  '12:30 PM – 1:00 PM': 0.5,
  '1:00 PM – 2:00 PM': 1.0,
  '2:00 PM – 3:00 PM': 1.0,
  '2:30 PM – 3:00 PM': 0.5,
  '3:00 PM – 4:00 PM': 0.83,
  '4:00 PM – 4:30 PM': 0.33,
  '3:00 PM – 3:30 PM': 0.5,
};

const ALL_TIME_SLOTS = [
  '7:00 AM – 8:00 AM', '8:00 AM – 9:00 AM', '9:00 AM – 10:00 AM',
  '10:00 AM – 11:00 AM', '11:00 AM – 12:00 PM', '12:30 PM – 1:00 PM',
  '1:00 PM – 2:00 PM', '2:00 PM – 3:00 PM', '3:00 PM – 4:00 PM', '4:00 PM – 4:30 PM',
];

// ===== HELPER FUNCTIONS =====

function formatDatePT(date, format = 'yyyy-MM-dd') {
  const d = new Date(date);
  const options = { timeZone: TIMEZONE };

  if (format === 'yyyy-MM-dd') {
    return d.toLocaleDateString('sv-SE', options);
  }
  if (format === 'yyyy-MM') {
    const parts = d.toLocaleDateString('sv-SE', options).split('-');
    return `${parts[0]}-${parts[1]}`;
  }
  if (format === 'MMMM dd, yyyy') {
    return d.toLocaleDateString('en-US', {
      ...options,
      month: 'long',
      day: '2-digit',
      year: 'numeric',
    });
  }
  if (format === 'HH:mm:ss') {
    return d.toLocaleTimeString('en-GB', { ...options, hour12: false });
  }
  if (format === 'EEEE, MMM d') {
    return d.toLocaleDateString('en-US', {
      ...options,
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
  }
  return d.toISOString();
}

function getTimeSlotMultiplier(timeSlot) {
  if (!timeSlot) return 1.0;
  const slot = String(timeSlot).trim();
  if (TIME_SLOT_MULTIPLIERS[slot]) {
    return TIME_SLOT_MULTIPLIERS[slot];
  }
  const normalized = slot.replace(/[-–—]/g, '–');
  if (TIME_SLOT_MULTIPLIERS[normalized]) {
    return TIME_SLOT_MULTIPLIERS[normalized];
  }
  return 1.0;
}

function is5kgBag(size) {
  const s = String(size || '').toLowerCase().replace(/\s+/g, '');
  return s.includes('5kg') || s.includes('5 kg');
}

// Parse human-readable timestamp from webhook logs
// Format: "Wednesday, January 14, 2026 at 9:46: AM" or similar
function parseHumanTimestamp(timestamp) {
  if (!timestamp) return null;
  const str = String(timestamp).trim();

  // If already ISO format or parseable by Date constructor
  const direct = new Date(str);
  if (!isNaN(direct.getTime()) && !str.includes(' at ')) {
    return direct;
  }

  // Parse "Wednesday, January 14, 2026 at 9:46: AM" format
  // Note: there's an extra colon before AM/PM in some entries
  const match = str.match(/(\w+),?\s+(\w+)\s+(\d+),?\s+(\d{4})\s+at\s+(\d+):(\d+):?\s*(AM|PM)/i);
  if (match) {
    const [, , month, day, year, hour, minute, ampm] = match;
    const monthNames = {
      'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
      'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11
    };
    const monthNum = monthNames[month.toLowerCase()];
    if (monthNum === undefined) return null;

    let hourNum = parseInt(hour, 10);
    if (ampm.toUpperCase() === 'PM' && hourNum !== 12) hourNum += 12;
    if (ampm.toUpperCase() === 'AM' && hourNum === 12) hourNum = 0;

    // Create date in Pacific timezone
    const date = new Date(Date.UTC(
      parseInt(year, 10),
      monthNum,
      parseInt(day, 10),
      hourNum + 8, // Pacific is UTC-8 (rough, ignoring DST)
      parseInt(minute, 10)
    ));
    return date;
  }

  return null;
}

// ===== SCOREBOARD DATA =====

async function getScoreboardData(env) {
  const today = formatDatePT(new Date(), 'yyyy-MM-dd');

  const result = {
    lastHourLbs: 0,
    lastHourTarget: 0,
    lastHourTrimmers: 0,
    lastHourBuckers: 0,
    lastTimeSlot: '',
    lastHourMultiplier: 1.0,
    currentHourTrimmers: 0,
    currentHourBuckers: 0,
    currentHourTarget: 0,
    currentTimeSlot: '',
    currentHourMultiplier: 1.0,
    targetRate: 0,
    strain: '',
    todayLbs: 0,
    todayTarget: 0,
    todayPercentage: 0,
    hoursLogged: 0,
    effectiveHours: 0,
    avgPercentage: 0,
    bestPercentage: 0,
    avgDelta: 0,
    bestDelta: 0,
    streak: 0,
    hourlyRates: [],
  };

  // Get today's hourly production data from D1
  const todayRows = await query(env.DB, `
    SELECT time_slot, cultivar1, tops_lbs1, trimmers_line1, buckers_line1
    FROM monthly_production
    WHERE production_date = ?
  `, [today]);

  if (todayRows.length === 0) return result;

  // Transform to working format and sort by TIME_SLOTS order (not alphabetically)
  const rowsBySlot = {};
  todayRows.forEach(r => {
    const slot = (r.time_slot || '').replace(/[-–—]/g, '–');
    rowsBySlot[slot] = {
      timeSlot: r.time_slot || '',
      tops: r.tops_lbs1 || 0,
      trimmers: r.trimmers_line1 || 0,
      buckers: r.buckers_line1 || 0,
      strain: r.cultivar1 || '',
      multiplier: getTimeSlotMultiplier(r.time_slot),
    };
  });

  // Build rows array in chronological order
  const rows = ALL_TIME_SLOTS
    .map(slot => rowsBySlot[slot])
    .filter(r => r !== undefined);

  // Find last completed and current hour
  let lastCompletedHourIndex = -1;
  let currentHourIndex = -1;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.tops > 0) {
      lastCompletedHourIndex = i;
    } else if (row.trimmers > 0 && row.tops === 0) {
      currentHourIndex = i;
    }
  }

  // Determine active strain
  let activeStrain = '';
  if (currentHourIndex >= 0 && rows[currentHourIndex].strain) {
    activeStrain = rows[currentHourIndex].strain;
  } else if (lastCompletedHourIndex >= 0 && rows[lastCompletedHourIndex].strain) {
    activeStrain = rows[lastCompletedHourIndex].strain;
  }
  result.strain = activeStrain;

  // Get historical rate for target (last 7 days)
  const dailyData = await getExtendedDailyData(30, env);
  const last7 = dailyData.slice(-7);
  const fallbackTargetRate = last7.length > 0
    ? last7.reduce((sum, d) => sum + (d.avgRate || 0), 0) / last7.length
    : 1.0;

  const targetRate = fallbackTargetRate || 1.0;
  result.targetRate = targetRate;

  // Calculate totals
  let totalLbs = 0;
  let hoursWorked = 0;
  let effectiveHours = 0;

  for (let i = 0; i <= lastCompletedHourIndex && i < rows.length; i++) {
    const row = rows[i];
    if (row.tops > 0 && row.trimmers > 0) {
      totalLbs += row.tops;
      hoursWorked++;
      effectiveHours += row.multiplier;
    }
  }

  // Last completed hour
  if (lastCompletedHourIndex >= 0) {
    const lastRow = rows[lastCompletedHourIndex];
    result.lastHourLbs = lastRow.tops;
    result.lastHourTrimmers = lastRow.trimmers;
    result.lastHourBuckers = lastRow.buckers || 0;
    result.lastHourMultiplier = lastRow.multiplier;
    result.lastHourTarget = lastRow.trimmers * targetRate * lastRow.multiplier;
    result.lastTimeSlot = lastRow.timeSlot;
  }

  // Current hour
  if (currentHourIndex >= 0) {
    const currentRow = rows[currentHourIndex];
    result.currentHourTrimmers = currentRow.trimmers;
    result.currentHourBuckers = currentRow.buckers || 0;
    result.currentHourMultiplier = currentRow.multiplier;
    result.currentHourTarget = currentRow.trimmers * targetRate * currentRow.multiplier;
    result.currentTimeSlot = currentRow.timeSlot;
  }

  result.todayLbs = totalLbs;
  result.hoursLogged = hoursWorked;
  result.effectiveHours = effectiveHours;

  // Calculate metrics
  let totalTarget = 0;
  const hourlyPercentages = [];
  const hourlyDeltas = [];
  const hourlyRates = [];
  let bestPct = 0;
  let bestDelta = null;
  let streak = 0;
  let currentStreak = 0;

  for (let i = 0; i <= lastCompletedHourIndex && i < rows.length; i++) {
    const row = rows[i];
    if (row.trimmers > 0 && row.tops > 0) {
      const hourTarget = row.trimmers * targetRate * row.multiplier;
      totalTarget += hourTarget;

      const pct = hourTarget > 0 ? (row.tops / hourTarget) * 100 : 0;
      const delta = row.tops - hourTarget;
      hourlyPercentages.push(pct);
      hourlyDeltas.push(delta);
      if (pct > bestPct) {
        bestPct = pct;
        bestDelta = delta;
      }

      if (pct >= 90) {
        currentStreak++;
        streak = currentStreak;
      } else {
        currentStreak = 0;
      }

      const rate = (row.tops / row.trimmers) / row.multiplier;
      hourlyRates.push({
        timeSlot: row.timeSlot,
        rate,
        target: targetRate,
        trimmers: row.trimmers,
        lbs: row.tops
      });
    }
  }

  result.hourlyRates = hourlyRates;
  result.todayTarget = totalTarget;
  result.todayPercentage = totalTarget > 0 ? (totalLbs / totalTarget) * 100 : 0;
  result.avgPercentage = hourlyPercentages.length > 0
    ? hourlyPercentages.reduce((a, b) => a + b, 0) / hourlyPercentages.length
    : 0;
  result.avgDelta = hourlyDeltas.length > 0
    ? hourlyDeltas.reduce((a, b) => a + b, 0) / hourlyDeltas.length
    : 0;
  result.bestPercentage = bestPct;
  result.bestDelta = bestDelta !== null ? bestDelta : 0;
  result.streak = streak;

  // Daily projection
  const projection = calculateDailyProjection(rows, lastCompletedHourIndex, currentHourIndex, targetRate, totalLbs);
  result.projectedTotal = projection.projectedTotal;
  result.dailyGoal = projection.dailyGoal;

  return result;
}

function calculateDailyProjection(todayRows, lastCompletedHourIndex, currentHourIndex, targetRate, totalLbsSoFar) {
  let totalLbs = 0;
  let totalTrimmerEffectiveHours = 0;
  let lastKnownTrimmers = 0;

  for (let i = 0; i <= lastCompletedHourIndex && i < todayRows.length; i++) {
    const row = todayRows[i];
    if (row.tops > 0 && row.trimmers > 0) {
      totalLbs += row.tops;
      totalTrimmerEffectiveHours += row.trimmers * row.multiplier;
      lastKnownTrimmers = row.trimmers;
    }
  }

  if (currentHourIndex >= 0 && todayRows[currentHourIndex].trimmers > 0) {
    lastKnownTrimmers = todayRows[currentHourIndex].trimmers;
  }

  const currentRate = totalTrimmerEffectiveHours > 0
    ? totalLbs / totalTrimmerEffectiveHours
    : targetRate;

  const workedSlots = {};
  for (let i = 0; i < todayRows.length; i++) {
    if (todayRows[i].timeSlot) {
      const normalizedSlot = String(todayRows[i].timeSlot).trim().replace(/[-–—]/g, '–');
      workedSlots[normalizedSlot] = todayRows[i];
    }
  }

  let dailyGoal = 0;
  let projectedFromRemaining = 0;

  for (const slot of ALL_TIME_SLOTS) {
    const normalizedSlot = slot.replace(/[-–—]/g, '–');
    const multiplier = getTimeSlotMultiplier(slot);
    const workedRow = workedSlots[normalizedSlot];

    if (workedRow && workedRow.tops > 0 && workedRow.trimmers > 0) {
      dailyGoal += workedRow.trimmers * targetRate * multiplier;
    } else if (workedRow && workedRow.trimmers > 0 && workedRow.tops === 0) {
      dailyGoal += workedRow.trimmers * targetRate * multiplier;
      projectedFromRemaining += workedRow.trimmers * currentRate * multiplier;
    } else {
      dailyGoal += lastKnownTrimmers * targetRate * multiplier;
      projectedFromRemaining += lastKnownTrimmers * currentRate * multiplier;
    }
  }

  return {
    projectedTotal: totalLbsSoFar + projectedFromRemaining,
    dailyGoal,
  };
}

// ===== VERSION TRACKING FOR SMART POLLING =====

/**
 * Get current data version from D1
 * @returns {number} Current version number
 */
async function getDataVersion(env) {
  try {
    const result = await queryOne(env.DB, `
      SELECT version, updated_at FROM data_version WHERE key = ?
    `, ['scoreboard']);
    return result ? { version: result.version, updatedAt: result.updated_at } : { version: 0, updatedAt: null };
  } catch (error) {
    console.error('Error getting data version:', error);
    return { version: 0, updatedAt: null };
  }
}

/**
 * Increment data version in D1 (call when data changes)
 */
async function incrementDataVersion(env) {
  try {
    await execute(env.DB, `
      UPDATE data_version
      SET version = version + 1, updated_at = datetime('now')
      WHERE key = ?
    `, ['scoreboard']);
  } catch (error) {
    console.error('Error incrementing data version:', error);
  }
}

// ===== BAG TIMER DATA =====

async function getBagTimerData(env) {
  const result = {
    lastBagTime: null,
    secondsSinceLastBag: 0,
    targetSeconds: 0,
    avgSecondsToday: 0,
    bagsToday: 0,
    bags5kgToday: 0,
    currentTrimmers: 0,
    targetRate: 0,
    cycleHistory: [],
  };

  try {
    const today = formatDatePT(new Date(), 'yyyy-MM-dd');
    const now = new Date();

    // Query D1 for today's 5kg bag adjustments
    // Check both size field and SKU pattern (size is often empty, so we infer from SKU)
    const bags = await query(env.DB, `
      SELECT timestamp, size, sku, flow_run_id
      FROM inventory_adjustments
      WHERE date(datetime(timestamp, '-8 hours')) = ?
        AND (
          lower(size) LIKE '%5kg%'
          OR lower(size) LIKE '%5 kg%'
          OR lower(sku) LIKE '%5-KG%'
          OR lower(sku) LIKE '%-5KG-%'
        )
      ORDER BY timestamp ASC
    `, [today]);

    const scoreboardData = await getScoreboardData(env);
    result.currentTrimmers = scoreboardData.currentHourTrimmers || scoreboardData.lastHourTrimmers || 0;
    result.targetRate = scoreboardData.targetRate || 1.0;

    const bagWeightLbs = 11.0231;
    const teamRateLbsPerHour = result.currentTrimmers * result.targetRate;
    if (teamRateLbsPerHour > 0) {
      result.targetSeconds = Math.round((bagWeightLbs / teamRateLbsPerHour) * 3600);
    }

    if (!bags || bags.length === 0) {
      return result;
    }

    const todayBags = [];
    let lastBag = null;

    for (const row of bags) {
      const rowDate = new Date(row.timestamp);
      if (isNaN(rowDate.getTime())) continue;

      todayBags.push(rowDate);

      if (!lastBag || rowDate > lastBag.time) {
        lastBag = { time: rowDate, size: row.size };
      }
    }

    result.bagsToday = todayBags.length;
    result.bags5kgToday = todayBags.length;

    if (lastBag) {
      result.lastBagTime = lastBag.time.toISOString();
      result.secondsSinceLastBag = Math.floor((now - lastBag.time) / 1000);
    }

    if (todayBags.length > 1) {
      todayBags.sort((a, b) => a - b);
      const cycleTimes = [];
      for (let i = 1; i < todayBags.length; i++) {
        const diffSec = Math.floor((todayBags[i] - todayBags[i - 1]) / 1000);
        if (diffSec >= 300 && diffSec <= 14400) {
          cycleTimes.push(diffSec);
        }
      }
      if (cycleTimes.length > 0) {
        result.avgSecondsToday = Math.round(cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length);
      }
    }

    if (todayBags.length > 1) {
      todayBags.sort((a, b) => b - a);
      for (let i = 0; i < Math.min(todayBags.length - 1, 20); i++) {
        const cycleSec = Math.floor((todayBags[i] - todayBags[i + 1]) / 1000);
        if (cycleSec >= 300 && cycleSec <= 14400) {
          result.cycleHistory.push({
            timestamp: todayBags[i].toISOString(),
            time: cycleSec,
            cycleSeconds: cycleSec,
            cycleMinutes: Math.round(cycleSec / 60),
          });
        }
      }
    }

  } catch (error) {
    console.error('Error getting bag timer data:', error.message);
  }

  return result;
}

// ===== EXTENDED DAILY DATA =====

async function getExtendedDailyData(days, env) {
  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = formatDatePT(cutoff, 'yyyy-MM-dd');

  const rows = await query(env.DB, `
    SELECT production_date,
           SUM(tops_lbs1) as total_tops,
           SUM(smalls_lbs1) as total_smalls,
           SUM(trimmers_line1) as trimmer_hours,
           SUM(buckers_line1 + trimmers_line1 + tzero_line1) as operator_hours
    FROM monthly_production
    WHERE production_date >= ?
    GROUP BY production_date
    ORDER BY production_date
  `, [cutoffStr]);

  return rows.map(r => {
    const operatorHours = r.operator_hours || 0;
    const laborCost = operatorHours * TOTAL_LABOR_COST_PER_HOUR; // $26.22/hour (includes payroll taxes)
    const totalLbs = (r.total_tops || 0) + (r.total_smalls || 0);
    const costPerLb = totalLbs > 0 ? laborCost / totalLbs : 0;

    return {
      date: new Date(r.production_date),
      totalTops: r.total_tops || 0,
      totalSmalls: r.total_smalls || 0,
      avgRate: r.trimmer_hours > 0 ? r.total_tops / r.trimmer_hours : 0,
      totalLbs,
      trimmerHours: r.trimmer_hours || 0,
      operatorHours,
      laborCost,
      costPerLb,
    };
  });
}

// ===== API HANDLERS =====

async function test(env) {
  return successResponse({
    ok: true,
    message: 'Production API is working (Cloudflare D1)',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Debug endpoint to check D1 inventory_adjustments data
 */
async function debugBags(env) {
  try {
    const today = formatDatePT(new Date(), 'yyyy-MM-dd');

    const allBags = await query(env.DB, `
      SELECT timestamp, size, sku, product_name
      FROM inventory_adjustments
      ORDER BY timestamp DESC
      LIMIT 20
    `);

    const todayBagsUTC = await query(env.DB, `
      SELECT timestamp, size, sku
      FROM inventory_adjustments
      WHERE date(timestamp) = ?
    `, [today]);

    // Also try with Pacific time conversion
    const todayBagsPT = await query(env.DB, `
      SELECT timestamp, size, sku
      FROM inventory_adjustments
      WHERE date(datetime(timestamp, '-8 hours')) = ?
        AND (
          lower(size) LIKE '%5kg%'
          OR lower(size) LIKE '%5 kg%'
          OR lower(sku) LIKE '%5-KG%'
          OR lower(sku) LIKE '%-5KG-%'
        )
    `, [today]);

    return successResponse({
      totalBags: allBags.length,
      todayPacific: today,
      recentBags: allBags,
      todayBagsUTC: todayBagsUTC.length,
      todayBagsPT: todayBagsPT.length,
      utcResults: todayBagsUTC,
      ptResults: todayBagsPT,
    });
  } catch (error) {
    return errorResponse('Debug failed: ' + error.message);
  }
}

/**
 * Get current data version (lightweight endpoint for smart polling)
 * Clients poll this frequently and only fetch full data when version changes
 */
async function version(env) {
  const versionData = await getDataVersion(env);
  return successResponse({
    version: versionData.version,
    updatedAt: versionData.updatedAt,
  });
}

async function scoreboard(env) {
  const scoreboardData = await getScoreboardData(env);
  const timerData = await getBagTimerData(env);

  return successResponse({
    scoreboard: scoreboardData,
    timer: timerData,
  });
}

async function dashboard(params, env) {
  const start = params.start || '';
  const end = params.end || '';

  if (start && !validateDate(start)) {
    return errorResponse('Invalid start date', 'VALIDATION_ERROR', 400);
  }
  if (end && !validateDate(end)) {
    return errorResponse('Invalid end date', 'VALIDATION_ERROR', 400);
  }

  const today = formatDatePT(new Date(), 'yyyy-MM-dd');
  const scoreboardData = await getScoreboardData(env);
  const timerData = await getBagTimerData(env);
  const dailyData = await getExtendedDailyData(30, env);

  let filteredData = dailyData;
  let showingFallback = false;
  let fallbackDate = null;

  if (start || end) {
    filteredData = dailyData.filter((d) => {
      const dateStr = formatDatePT(d.date, 'yyyy-MM-dd');
      if (start && dateStr < start) return false;
      if (end && dateStr > end) return false;
      return true;
    });

    if (filteredData.length === 0 && dailyData.length > 0) {
      const mostRecent = dailyData[dailyData.length - 1];
      filteredData = [mostRecent];
      showingFallback = true;
      fallbackDate = formatDatePT(mostRecent.date, 'yyyy-MM-dd');
    }
  }

  const validDays = dailyData.filter((d) => d.totalTops > 0).slice(-7);
  const rollingAverage = {
    totalTops: validDays.length > 0 ? validDays.reduce((s, d) => s + d.totalTops, 0) / validDays.length : 0,
    totalSmalls: validDays.length > 0 ? validDays.reduce((s, d) => s + d.totalSmalls, 0) / validDays.length : 0,
    avgRate: validDays.length > 0 ? validDays.reduce((s, d) => s + d.avgRate, 0) / validDays.length : 0,
  };

  // Calculate weighted average rate (each hourly rate weighted by trimmer count)
  let weightedRateSum = 0;
  let totalTrimmerHours = 0;
  for (const hour of (scoreboardData.hourlyRates || [])) {
    if (hour.trimmers && hour.rate != null) {
      weightedRateSum += hour.rate * hour.trimmers;
      totalTrimmerHours += hour.trimmers;
    }
  }

  // Calculate today's operator hours and labor costs
  const todayOperatorData = await queryOne(env.DB, `
    SELECT SUM(buckers_line1 + trimmers_line1 + tzero_line1) as operator_hours
    FROM monthly_production
    WHERE production_date = ?
  `, [today]);

  const todayOperatorHours = todayOperatorData?.operator_hours || 0;
  const todayLaborCost = todayOperatorHours * TOTAL_LABOR_COST_PER_HOUR;
  const todayTotalLbs = scoreboardData.todayLbs || 0;
  const todayCostPerLb = todayTotalLbs > 0 ? todayLaborCost / todayTotalLbs : 0;

  const todayData = {
    totalTops: scoreboardData.todayLbs || 0,
    totalSmalls: 0,
    totalLbs: todayTotalLbs,
    avgRate: totalTrimmerHours > 0 ? weightedRateSum / totalTrimmerHours : 0,
    trimmers: scoreboardData.lastHourTrimmers || scoreboardData.currentHourTrimmers || 0,
    operatorHours: todayOperatorHours,
    laborCost: todayLaborCost,
    costPerLb: todayCostPerLb,
  };

  const current = {
    strain: scoreboardData.strain || '',
    todayPercentage: scoreboardData.todayPercentage || 0,
    todayTarget: scoreboardData.todayTarget || 0,
    projectedTotal: scoreboardData.projectedTotal || 0,
    effectiveHours: scoreboardData.effectiveHours || 0,
  };

  const targets = {
    totalTops: scoreboardData.dailyGoal || 66,
  };

  const bagTimer = {
    bagsToday: timerData.bagsToday || 0,
    avgTime: timerData.avgSecondsToday > 0 ? `${Math.round(timerData.avgSecondsToday / 60)} min` : '--',
    vsTarget: timerData.targetSeconds > 0 && timerData.avgSecondsToday > 0
      ? `${timerData.avgSecondsToday < timerData.targetSeconds ? '-' : '+'}${Math.abs(Math.round((timerData.avgSecondsToday - timerData.targetSeconds) / 60))} min`
      : '--',
  };

  const hourly = (scoreboardData.hourlyRates || []).map((h) => ({
    label: h.timeSlot,
    rate: h.rate,
    target: h.target,
    trimmers: h.trimmers,
    lbs: h.lbs,
  }));

  return successResponse({
    today: todayData,
    current,
    targets,
    bagTimer,
    hourly,
    rollingAverage,
    daily: filteredData.map((d) => ({
      date: formatDatePT(d.date, 'yyyy-MM-dd'),
      totalTops: Math.round(d.totalTops * 10) / 10,
      totalSmalls: Math.round(d.totalSmalls * 10) / 10,
      totalLbs: Math.round(d.totalLbs * 10) / 10,
      avgRate: Math.round(d.avgRate * 100) / 100,
      trimmerHours: Math.round(d.trimmerHours * 10) / 10,
      operatorHours: Math.round(d.operatorHours * 10) / 10,
      laborCost: Math.round(d.laborCost * 100) / 100,
      costPerLb: Math.round(d.costPerLb * 100) / 100,
    })),
    fallback: showingFallback ? {
      active: true,
      date: fallbackDate,
      requestedRange: { start, end },
    } : null,
  });
}

async function setShiftStart(params, env) {
  const timeParam = params.time;
  const timestamp = timeParam ? new Date(timeParam) : new Date();
  const today = new Date();

  if (formatDatePT(timestamp, 'yyyy-MM-dd') !== formatDatePT(today, 'yyyy-MM-dd')) {
    return errorResponse('Can only set start time for today', 'VALIDATION_ERROR', 400);
  }

  const shiftEnd = new Date(timestamp);
  shiftEnd.setHours(16, 30, 0, 0);
  const totalMinutes = (shiftEnd - timestamp) / 60000;

  const breaks = [[9, 0, 9, 10], [12, 0, 12, 30], [14, 30, 14, 40], [16, 20, 16, 30]];
  let breakMinutes = 0;
  for (const brk of breaks) {
    const breakStart = new Date(timestamp);
    breakStart.setHours(brk[0], brk[1], 0, 0);
    const breakEnd = new Date(timestamp);
    breakEnd.setHours(brk[2], brk[3], 0, 0);

    if (timestamp < breakEnd && breakStart < shiftEnd) {
      const overlapStart = Math.max(timestamp.getTime(), breakStart.getTime());
      const overlapEnd = Math.min(shiftEnd.getTime(), breakEnd.getTime());
      breakMinutes += (overlapEnd - overlapStart) / 60000;
    }
  }

  const availableHours = (totalMinutes - breakMinutes) / 60;
  const scaleFactor = availableHours / 8.5;
  const adjustedGoal = Math.round(200 * scaleFactor);

  const dateStr = formatDatePT(today, 'yyyy-MM-dd');
  const shiftStartStr = formatDatePT(timestamp, 'HH:mm:ss');

  await insert(env.DB, 'shift_adjustments', {
    adjustment_date: dateStr,
    original_start: '07:00:00',
    new_start: shiftStartStr,
    reason: `Available hours: ${availableHours.toFixed(2)}, Scale: ${scaleFactor.toFixed(3)}`,
  });

  // Increment version to notify clients of new data
  await incrementDataVersion(env);

  return successResponse({
    shiftAdjustment: {
      manualStartTime: timestamp.toISOString(),
      availableHours,
      scaleFactor,
      adjustedDailyGoal: adjustedGoal,
    },
  });
}

async function getShiftStart(params, env) {
  const date = params.date || formatDatePT(new Date(), 'yyyy-MM-dd');

  const row = await queryOne(env.DB, `
    SELECT adjustment_date, new_start, reason
    FROM shift_adjustments
    WHERE adjustment_date = ?
    ORDER BY id DESC
    LIMIT 1
  `, [date]);

  if (!row) {
    return successResponse({ shiftAdjustment: null });
  }

  // Parse hours/scale from reason
  const hoursMatch = row.reason?.match(/Available hours: ([\d.]+)/);
  const scaleMatch = row.reason?.match(/Scale: ([\d.]+)/);

  return successResponse({
    shiftAdjustment: {
      manualStartTime: `${date}T${row.new_start}`,
      availableHours: hoursMatch ? parseFloat(hoursMatch[1]) : 0,
      scaleFactor: scaleMatch ? parseFloat(scaleMatch[1]) : 1,
    },
  });
}

async function morningReport(env) {
  const now = new Date();
  const dailyData = await getExtendedDailyData(14, env);
  dailyData.sort((a, b) => b.date - a.date);

  const today = formatDatePT(now, 'yyyy-MM-dd');
  const filteredDays = dailyData.filter((d) => formatDatePT(d.date, 'yyyy-MM-dd') !== today);

  const yesterday = filteredDays[0] || null;
  const dayBefore = filteredDays[1] || null;

  return successResponse({
    generatedAt: now.toISOString(),
    yesterday: yesterday ? {
      date: formatDatePT(yesterday.date, 'yyyy-MM-dd'),
      dateDisplay: formatDatePT(yesterday.date, 'EEEE, MMM d'),
      tops: Math.round(yesterday.totalTops * 10) / 10,
      smalls: Math.round(yesterday.totalSmalls * 10) / 10,
      rate: Math.round(yesterday.avgRate * 100) / 100,
    } : null,
    dayBefore: dayBefore ? {
      date: formatDatePT(dayBefore.date, 'yyyy-MM-dd'),
      dateDisplay: formatDatePT(dayBefore.date, 'EEEE, MMM d'),
      tops: Math.round(dayBefore.totalTops * 10) / 10,
      smalls: Math.round(dayBefore.totalSmalls * 10) / 10,
      rate: Math.round(dayBefore.avgRate * 100) / 100,
    } : null,
  });
}

// POST handlers

async function logBag(body, env) {
  const size = body.size || '5 kg.';
  const now = new Date();

  await insert(env.DB, 'production_tracking', {
    timestamp: now.toISOString(),
    bag_type: size,
    weight: size.includes('5') ? 5 : 0,
    source: 'manual',
  });

  // Increment version to notify clients of new data
  await incrementDataVersion(env);

  return successResponse({ timestamp: now.toISOString(), size });
}

async function logPause(body, env) {
  const reason = sanitizeForSheets(body.reason || 'No reason provided');
  const now = new Date();
  const pauseId = now.getTime().toString();

  await insert(env.DB, 'pause_log', {
    start_time: now.toISOString(),
    reason,
    created_by: 'Scoreboard',
  });

  // Increment version to notify clients of new data
  await incrementDataVersion(env);

  return successResponse({ pauseId, timestamp: now.toISOString(), reason });
}

async function logResume(body, env) {
  const pauseId = body.pauseId;
  const actualDurationSeconds = body.duration || 0;

  if (!pauseId) {
    return errorResponse('Missing pauseId', 'VALIDATION_ERROR', 400);
  }

  const now = new Date();
  const durationMin = Math.round(actualDurationSeconds / 60 * 10) / 10;

  // Find most recent pause without end_time
  const row = await queryOne(env.DB, `
    SELECT id FROM pause_log
    WHERE end_time IS NULL
    ORDER BY start_time DESC
    LIMIT 1
  `);

  if (row) {
    await execute(env.DB, `
      UPDATE pause_log SET end_time = ?, duration_min = ? WHERE id = ?
    `, [now.toISOString(), durationMin, row.id]);

    // Increment version to notify clients of new data
    await incrementDataVersion(env);
  }

  return successResponse({ pauseId, resumeTime: now.toISOString(), durationMinutes: durationMin });
}

async function chat(body, env) {
  if (!env.ANTHROPIC_API_KEY) {
    return errorResponse('AI chat not configured', 'INTERNAL_ERROR', 500);
  }

  const userMessage = body.userMessage || '';
  const history = body.history || [];

  if (!userMessage) {
    return errorResponse('No message provided', 'VALIDATION_ERROR', 400);
  }

  const scoreboardData = await getScoreboardData(env);
  const timerData = await getBagTimerData(env);

  const now = new Date();
  const currentTime = now.toLocaleString('en-US', {
    timeZone: TIMEZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const systemPrompt = `You are the Rogue Origin AI Assistant for a hemp processing facility.

CURRENT TIME: ${currentTime}

TODAY'S PRODUCTION:
- Tops: ${(scoreboardData.todayLbs || 0).toFixed(1)} lbs
- Target: ${(scoreboardData.todayTarget || 0).toFixed(1)} lbs
- Performance: ${Math.round(scoreboardData.todayPercentage || 0)}%
- Strain: ${scoreboardData.strain || 'Unknown'}

CREW: ${scoreboardData.currentHourTrimmers || 0} trimmers
BAGS: ${timerData.bags5kgToday || 0} (5kg) today

Be concise and helpful. Support English and Spanish.`;

  const messages = [];
  for (const msg of history.slice(-10)) {
    messages.push({ role: msg.role, content: msg.content });
  }
  messages.push({ role: 'user', content: userMessage });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    return errorResponse('AI service error', 'INTERNAL_ERROR', 500);
  }

  const aiResult = await response.json();
  const aiResponse = aiResult.content?.[0]?.text || 'Sorry, I could not generate a response.';

  return successResponse({ response: aiResponse });
}

async function tts(body, env) {
  if (!env.GOOGLE_TTS_API_KEY) {
    return errorResponse('TTS not configured', 'INTERNAL_ERROR', 500);
  }

  const text = body.text;
  if (!text) {
    return errorResponse('No text provided', 'VALIDATION_ERROR', 400);
  }

  const truncatedText = text.length > 5000 ? `${text.substring(0, 5000)}...` : text;

  const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${env.GOOGLE_TTS_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text: truncatedText },
      voice: { languageCode: 'en-US', name: 'en-US-Neural2-A', ssmlGender: 'MALE' },
      audioConfig: { audioEncoding: 'MP3', pitch: 0.0, speakingRate: 1.1 },
    }),
  });

  if (!response.ok) {
    return errorResponse('TTS API error', 'INTERNAL_ERROR', 500);
  }

  const result = await response.json();
  if (result.audioContent) {
    return successResponse({ audioBase64: result.audioContent });
  }

  return errorResponse('TTS failed', 'INTERNAL_ERROR', 500);
}

// ===== DATA ENTRY =====

// Validation helpers
function validateCrewCount(value, fieldName) {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 0 || num > 50) {
    return { valid: false, error: `${fieldName} must be between 0 and 50` };
  }
  return { valid: true, value: num };
}

function validateLbs(value, fieldName) {
  const num = parseFloat(value);
  if (isNaN(num) || num < 0 || num > 200) {
    return { valid: false, error: `${fieldName} must be between 0 and 200 lbs` };
  }
  return { valid: true, value: Math.round(num * 10) / 10 }; // Round to 1 decimal
}

function validateTimeSlot(slot) {
  const input = String(slot || '').trim();

  // Normalize all dash types (hyphen, en-dash, em-dash) to a standard dash for comparison
  // This handles UTF-8 encoding variations and copy-paste issues
  const normalizedInput = input
    .replace(/[\u002D\u2013\u2014\uFE58\uFE63\uFF0D]/g, '-')  // Normalize to hyphen
    .replace(/\s+/g, ' ');  // Normalize whitespace

  // First check against known valid slots
  for (const validSlot of ALL_TIME_SLOTS) {
    const normalizedValid = validSlot
      .replace(/[\u002D\u2013\u2014\uFE58\uFE63\uFF0D]/g, '-')  // Normalize to hyphen
      .replace(/\s+/g, ' ');  // Normalize whitespace

    if (normalizedInput === normalizedValid) {
      return { valid: true, value: validSlot };
    }
  }

  // If not in list, check if it's a valid dynamic first slot (X:XX AM - 8:00 AM)
  // This handles cases where shift starts before 8:00 AM
  const dynamicSlotPattern = /^(\d{1,2}):(\d{2}) (AM|PM) - 8:00 (AM|PM)$/;
  const match = normalizedInput.match(dynamicSlotPattern);

  if (match) {
    const [, hours, minutes, period1, period2] = match;
    const hour = parseInt(hours, 10);
    const min = parseInt(minutes, 10);

    // Validate time values
    if (hour >= 1 && hour <= 12 && min >= 0 && min <= 59 && period1 === 'AM' && period2 === 'AM') {
      // Accept dynamic first slot (e.g., "7:30 AM - 8:00 AM")
      return { valid: true, value: input };  // Return original with proper formatting
    }
  }

  return { valid: false, error: `Invalid time slot: ${slot}` };
}

function validateProductionDate(dateStr) {
  if (!dateStr) return { valid: false, error: 'Date is required' };

  // Must be YYYY-MM-DD format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { valid: false, error: 'Date must be in YYYY-MM-DD format' };
  }

  const d = new Date(dateStr + 'T12:00:00');
  if (isNaN(d.getTime())) {
    return { valid: false, error: 'Invalid date' };
  }

  // Not in the future
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (d > today) {
    return { valid: false, error: 'Date cannot be in the future' };
  }

  // Not more than 2 years old
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  if (d < twoYearsAgo) {
    return { valid: false, error: 'Date cannot be more than 2 years in the past' };
  }

  return { valid: true, value: dateStr };
}

async function addProduction(body, env) {
  try {
    const { date, timeSlot, trimmers1, buckers1, tzero1, cultivar1, tops1, smalls1,
            trimmers2, buckers2, tzero2, cultivar2, tops2, smalls2, qc } = body;

    // Validate required fields
    const dateValidation = validateProductionDate(date);
    if (!dateValidation.valid) {
      return errorResponse(dateValidation.error, 'VALIDATION_ERROR', 400);
    }

    const slotValidation = validateTimeSlot(timeSlot);
    if (!slotValidation.valid) {
      return errorResponse(slotValidation.error, 'VALIDATION_ERROR', 400);
    }

  // Validate crew counts (0-50)
  const validations = [];
  const crew1 = { trimmers: 0, buckers: 0, tzero: 0 };
  const crew2 = { trimmers: 0, buckers: 0, tzero: 0 };

  if (trimmers1 !== undefined && trimmers1 !== '') {
    const v = validateCrewCount(trimmers1, 'Trimmers Line 1');
    if (!v.valid) validations.push(v.error);
    else crew1.trimmers = v.value;
  }
  if (buckers1 !== undefined && buckers1 !== '') {
    const v = validateCrewCount(buckers1, 'Buckers Line 1');
    if (!v.valid) validations.push(v.error);
    else crew1.buckers = v.value;
  }
  if (tzero1 !== undefined && tzero1 !== '') {
    const v = validateCrewCount(tzero1, 'T-Zero Line 1');
    if (!v.valid) validations.push(v.error);
    else crew1.tzero = v.value;
  }
  if (trimmers2 !== undefined && trimmers2 !== '') {
    const v = validateCrewCount(trimmers2, 'Trimmers Line 2');
    if (!v.valid) validations.push(v.error);
    else crew2.trimmers = v.value;
  }
  if (buckers2 !== undefined && buckers2 !== '') {
    const v = validateCrewCount(buckers2, 'Buckers Line 2');
    if (!v.valid) validations.push(v.error);
    else crew2.buckers = v.value;
  }
  if (tzero2 !== undefined && tzero2 !== '') {
    const v = validateCrewCount(tzero2, 'T-Zero Line 2');
    if (!v.valid) validations.push(v.error);
    else crew2.tzero = v.value;
  }

  // Validate lbs (0-200)
  const lbs1 = { tops: 0, smalls: 0 };
  const lbs2 = { tops: 0, smalls: 0 };

  if (tops1 !== undefined && tops1 !== '') {
    const v = validateLbs(tops1, 'Tops Line 1');
    if (!v.valid) validations.push(v.error);
    else lbs1.tops = v.value;
  }
  if (smalls1 !== undefined && smalls1 !== '') {
    const v = validateLbs(smalls1, 'Smalls Line 1');
    if (!v.valid) validations.push(v.error);
    else lbs1.smalls = v.value;
  }
  if (tops2 !== undefined && tops2 !== '') {
    const v = validateLbs(tops2, 'Tops Line 2');
    if (!v.valid) validations.push(v.error);
    else lbs2.tops = v.value;
  }
  if (smalls2 !== undefined && smalls2 !== '') {
    const v = validateLbs(smalls2, 'Smalls Line 2');
    if (!v.valid) validations.push(v.error);
    else lbs2.smalls = v.value;
  }

  if (validations.length > 0) {
    return errorResponse(validations.join('; '), 'VALIDATION_ERROR', 400);
  }

  // Sanitize text fields
  const safeCultivar1 = sanitizeForSheets(cultivar1 || '').substring(0, 100);
  const safeCultivar2 = sanitizeForSheets(cultivar2 || '').substring(0, 100);
  const safeQc = sanitizeForSheets(qc || '').substring(0, 500);

  // Upsert - update if exists, insert if not
  const existing = await queryOne(env.DB,
    'SELECT id FROM monthly_production WHERE production_date = ? AND time_slot = ?',
    [dateValidation.value, slotValidation.value]
  );

  if (existing) {
    await execute(env.DB, `
      UPDATE monthly_production SET
        trimmers_line1 = ?, buckers_line1 = ?, tzero_line1 = ?, cultivar1 = ?, tops_lbs1 = ?, smalls_lbs1 = ?,
        trimmers_line2 = ?, buckers_line2 = ?, tzero_line2 = ?, cultivar2 = ?, tops_lbs2 = ?, smalls_lbs2 = ?,
        qc = ?
      WHERE id = ?
    `, [
      crew1.trimmers, crew1.buckers, crew1.tzero, safeCultivar1, lbs1.tops, lbs1.smalls,
      crew2.trimmers, crew2.buckers, crew2.tzero, safeCultivar2, lbs2.tops, lbs2.smalls,
      safeQc, existing.id
    ]);

    // Increment version to notify clients of new data
    await incrementDataVersion(env);

    return successResponse({ success: true, message: 'Production data updated', id: existing.id });
  } else {
    const id = await insert(env.DB, 'monthly_production', {
      production_date: dateValidation.value,
      time_slot: slotValidation.value,
      trimmers_line1: crew1.trimmers,
      buckers_line1: crew1.buckers,
      tzero_line1: crew1.tzero,
      cultivar1: safeCultivar1,
      tops_lbs1: lbs1.tops,
      smalls_lbs1: lbs1.smalls,
      trimmers_line2: crew2.trimmers,
      buckers_line2: crew2.buckers,
      tzero_line2: crew2.tzero,
      cultivar2: safeCultivar2,
      tops_lbs2: lbs2.tops,
      smalls_lbs2: lbs2.smalls,
      qc: safeQc,
    });

    // Increment version to notify clients of new data
    await incrementDataVersion(env);

    return successResponse({ success: true, message: 'Production data added', id });
  }
  } catch (error) {
    console.error('addProduction error:', error);
    return errorResponse(`Failed to add production: ${error.message}`, 'INTERNAL_ERROR', 500);
  }
}

async function getProduction(params, env) {
  const date = params.date || formatDatePT(new Date(), 'yyyy-MM-dd');

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return errorResponse('Invalid date format. Use YYYY-MM-DD', 'VALIDATION_ERROR', 400);
  }

  const rows = await query(env.DB, `
    SELECT * FROM monthly_production
    WHERE production_date = ?
    ORDER BY time_slot
  `, [date]);

  return successResponse({
    success: true,
    date,
    timeSlots: ALL_TIME_SLOTS,
    production: rows.map(r => ({
      timeSlot: r.time_slot,
      trimmers1: r.trimmers_line1 || 0,
      buckers1: r.buckers_line1 || 0,
      tzero1: r.tzero_line1 || 0,
      cultivar1: r.cultivar1 || '',
      tops1: r.tops_lbs1 || 0,
      smalls1: r.smalls_lbs1 || 0,
      trimmers2: r.trimmers_line2 || 0,
      buckers2: r.buckers_line2 || 0,
      tzero2: r.tzero_line2 || 0,
      cultivar2: r.cultivar2 || '',
      tops2: r.tops_lbs2 || 0,
      smalls2: r.smalls_lbs2 || 0,
      qc: r.qc || '',
    })),
  });
}

async function getCultivars(env) {
  // Get distinct cultivars from both lines
  const rows = await query(env.DB, `
    SELECT DISTINCT cultivar FROM (
      SELECT cultivar1 as cultivar FROM monthly_production WHERE cultivar1 IS NOT NULL AND cultivar1 != ''
      UNION
      SELECT cultivar2 FROM monthly_production WHERE cultivar2 IS NOT NULL AND cultivar2 != ''
    )
    ORDER BY cultivar
  `);

  return successResponse({
    success: true,
    cultivars: rows.map(r => r.cultivar),
  });
}

// ===== MIGRATION =====

// Migration validation helpers
function validateMigrationCrewCount(value) {
  if (value === undefined || value === null || value === '') return 0;
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 0) return 0;
  if (num > 50) return 50; // Cap at max
  return num;
}

function validateMigrationLbs(value) {
  if (value === undefined || value === null || value === '') return 0;
  const num = parseFloat(value);
  if (isNaN(num) || num < 0) return 0;
  if (num > 200) return 200; // Cap at max
  return Math.round(num * 10) / 10;
}

function validateMigrationTimeSlot(slot) {
  if (!slot) return null;
  const normalizedSlot = String(slot).trim().replace(/[-–—]/g, '–');
  const validSlots = ALL_TIME_SLOTS.map(s => s.replace(/[-–—]/g, '–'));
  if (!validSlots.includes(normalizedSlot)) return null;
  return normalizedSlot;
}

function validateMigrationDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;

  // Not in the future (with 1-day buffer for timezone issues)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d > tomorrow) return null;

  // Not more than 3 years old
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
  if (d < threeYearsAgo) return null;

  return formatDatePT(d, 'yyyy-MM-dd');
}

async function migrateFromSheets(env) {
  const sheetId = env.PRODUCTION_SHEET_ID;
  if (!sheetId) throw createError('INTERNAL_ERROR', 'PRODUCTION_SHEET_ID not configured');

  let trackingMigrated = 0;
  let trackingSkipped = 0;
  let productionMigrated = 0;
  let productionSkipped = 0;
  let pausesMigrated = 0;
  let shiftsMigrated = 0;
  const errors = [];
  const monthsProcessed = [];

  // Migrate production tracking (bag completions)
  try {
    const trackingSheet = 'Rogue Origin Production Tracking';
    const data = await readSheet(sheetId, `'${trackingSheet}'!A:J`, env);

    if (data.length > 1) {
      const headers = data[0];
      const timestampCol = headers.indexOf('Timestamp');
      const sizeCol = headers.indexOf('Size');
      const skuCol = headers.indexOf('SKU');

      // Migrate all rows (dedupe handled by existing check)
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const timestamp = row[timestampCol];
        if (!timestamp) {
          trackingSkipped++;
          continue;
        }

        // Validate timestamp is a valid date
        const d = new Date(timestamp);
        if (isNaN(d.getTime())) {
          trackingSkipped++;
          continue;
        }

        // Check if already exists
        const existing = await queryOne(env.DB,
          'SELECT id FROM production_tracking WHERE timestamp = ?',
          [timestamp]
        );
        if (existing) continue;

        await insert(env.DB, 'production_tracking', {
          timestamp: timestamp,
          bag_type: String(row[sizeCol] || '').substring(0, 50),
          sku: String(row[skuCol] || '').substring(0, 50),
          source: 'sheets_migration',
        });
        trackingMigrated++;
      }
    }
  } catch (e) {
    console.error('Error migrating tracking:', e);
    errors.push(`Tracking: ${e.message || e}`);
  }

  // Migrate monthly production data - ALL months
  try {
    const sheetNames = await getSheetNames(sheetId, env);
    const monthSheets = sheetNames.filter(name => /^\d{4}-\d{2}$/.test(name)).sort();

    for (const monthSheet of monthSheets) {
      try {
        const vals = await readSheet(sheetId, `'${monthSheet}'!A:Z`, env);
        let currentDate = null;
        let cols = null;
        let monthCount = 0;

        for (let i = 0; i < vals.length; i++) {
          const row = vals[i];

          if (row[0] === 'Date:') {
            const dateStr = row[1];
            currentDate = validateMigrationDate(dateStr);

            // Next row is headers
            const headerRow = vals[i + 1] || [];
            cols = {
              cultivar1: headerRow.indexOf('Cultivar 1'),
              tops1: headerRow.indexOf('Tops 1'),
              smalls1: headerRow.indexOf('Smalls 1'),
              buckers1: headerRow.indexOf('Buckers 1'),
              trimmers1: headerRow.indexOf('Trimmers 1'),
              tzero1: headerRow.indexOf('T-Zero 1'),
              cultivar2: headerRow.indexOf('Cultivar 2'),
              tops2: headerRow.indexOf('Tops 2'),
              smalls2: headerRow.indexOf('Smalls 2'),
              buckers2: headerRow.indexOf('Buckers 2'),
              trimmers2: headerRow.indexOf('Trimmers 2'),
              tzero2: headerRow.indexOf('T-Zero 2'),
              qc: headerRow.indexOf('QC'),
            };
            continue;
          }

          if (!currentDate || !cols) continue;

          const rawTimeSlot = row[0];
          if (!rawTimeSlot || rawTimeSlot === 'Date:' || String(rawTimeSlot).includes('Performance')) continue;

          // Validate time slot
          const timeSlot = validateMigrationTimeSlot(rawTimeSlot);
          if (!timeSlot) {
            productionSkipped++;
            continue;
          }

          // Validate and sanitize numeric values
          const tops1 = validateMigrationLbs(row[cols.tops1]);
          const smalls1 = validateMigrationLbs(row[cols.smalls1]);
          const trimmers1 = validateMigrationCrewCount(row[cols.trimmers1]);
          const buckers1 = validateMigrationCrewCount(row[cols.buckers1]);
          const tzero1 = cols.tzero1 >= 0 ? validateMigrationCrewCount(row[cols.tzero1]) : 0;
          const tops2 = validateMigrationLbs(row[cols.tops2]);
          const smalls2 = validateMigrationLbs(row[cols.smalls2]);
          const trimmers2 = validateMigrationCrewCount(row[cols.trimmers2]);
          const buckers2 = validateMigrationCrewCount(row[cols.buckers2]);
          const tzero2 = cols.tzero2 >= 0 ? validateMigrationCrewCount(row[cols.tzero2]) : 0;

          // Skip rows with no meaningful data
          if (tops1 === 0 && smalls1 === 0 && trimmers1 === 0 && tops2 === 0 && smalls2 === 0 && trimmers2 === 0) {
            continue;
          }

          // Check if exists
          const existing = await queryOne(env.DB,
            'SELECT id FROM monthly_production WHERE production_date = ? AND time_slot = ?',
            [currentDate, timeSlot]
          );
          if (existing) continue;

          // Sanitize text fields
          const cultivar1 = String(row[cols.cultivar1] || '').substring(0, 100);
          const cultivar2 = String(row[cols.cultivar2] || '').substring(0, 100);
          const qc = cols.qc >= 0 ? String(row[cols.qc] || '').substring(0, 500) : '';

          await insert(env.DB, 'monthly_production', {
            production_date: currentDate,
            time_slot: timeSlot,
            buckers_line1: buckers1,
            trimmers_line1: trimmers1,
            tzero_line1: tzero1,
            buckers_line2: buckers2,
            trimmers_line2: trimmers2,
            tzero_line2: tzero2,
            cultivar1,
            cultivar2,
            tops_lbs1: tops1,
            smalls_lbs1: smalls1,
            tops_lbs2: tops2,
            smalls_lbs2: smalls2,
            qc,
          });
          productionMigrated++;
          monthCount++;
        }

        monthsProcessed.push(`${monthSheet}: ${monthCount} rows`);
      } catch (monthError) {
        errors.push(`${monthSheet}: ${monthError.message || monthError}`);
      }
    }
  } catch (e) {
    console.error('Error migrating monthly production:', e);
    errors.push(`Monthly: ${e.message || e}`);
  }

  // Migrate pause log
  try {
    const pauseData = await readSheet(sheetId, `'Timer Pause Log'!A:G`, env);
    for (let i = 1; i < pauseData.length; i++) {
      const row = pauseData[i];
      if (!row[0] || !row[1]) continue;

      const existing = await queryOne(env.DB,
        'SELECT id FROM pause_log WHERE start_time LIKE ?',
        [`${row[1]}%`]
      );
      if (existing) continue;

      await insert(env.DB, 'pause_log', {
        start_time: `${row[1]}T${row[2] || '00:00:00'}`,
        end_time: row[3] ? `${row[1]}T${row[3]}` : null,
        duration_min: parseFloat(row[4]) || null,
        reason: sanitizeForSheets(row[5] || '').substring(0, 200),
        created_by: sanitizeForSheets(row[6] || '').substring(0, 50),
      });
      pausesMigrated++;
    }
  } catch (e) {
    console.error('Error migrating pauses:', e);
    errors.push(`Pauses: ${e.message || e}`);
  }

  // Migrate shift adjustments
  try {
    const shiftData = await readSheet(sheetId, `'Shift Adjustments'!A:F`, env);
    for (let i = 1; i < shiftData.length; i++) {
      const row = shiftData[i];
      if (!row[0]) continue;

      // Validate date
      const adjDate = validateMigrationDate(row[0]);
      if (!adjDate) continue;

      const existing = await queryOne(env.DB,
        'SELECT id FROM shift_adjustments WHERE adjustment_date = ?',
        [adjDate]
      );
      if (existing) continue;

      await insert(env.DB, 'shift_adjustments', {
        adjustment_date: adjDate,
        original_start: '07:00:00',
        new_start: String(row[1] || '').substring(0, 20),
        reason: `Available hours: ${parseFloat(row[3]) || 0}, Scale: ${parseFloat(row[4]) || 1}`,
      });
      shiftsMigrated++;
    }
  } catch (e) {
    console.error('Error migrating shifts:', e);
    errors.push(`Shifts: ${e.message || e}`);
  }

  return successResponse({
    success: errors.length === 0,
    message: `Migration complete. Tracking: ${trackingMigrated} (${trackingSkipped} skipped), Production: ${productionMigrated} (${productionSkipped} skipped), Pauses: ${pausesMigrated}, Shifts: ${shiftsMigrated}`,
    trackingMigrated,
    trackingSkipped,
    productionMigrated,
    productionSkipped,
    pausesMigrated,
    shiftsMigrated,
    monthsProcessed,
    errors: errors.length > 0 ? errors : undefined,
  });
}

// ===== MAIN HANDLER =====

export async function handleProductionD1(request, env, ctx) {
  try {
    const body = request.method === 'POST' ? await parseBody(request) : {};
    const action = getAction(request, body);
    const params = getQueryParams(request);

    if (!action) {
      return errorResponse('Missing action parameter', 'VALIDATION_ERROR', 400);
    }

    switch (action) {
      case 'test':
        return await test(env);
      case 'debugBags':
        return await debugBags(env);
      case 'version':
        return await version(env);
      case 'scoreboard':
        return await scoreboard(env);
      case 'dashboard':
        return await dashboard(params, env);
      case 'setShiftStart':
        return await setShiftStart({ ...params, ...body }, env);
      case 'getShiftStart':
        return await getShiftStart(params, env);
      case 'morningReport':
        return await morningReport(env);
      case 'logBag':
        return await logBag(body, env);
      case 'logPause':
        return await logPause(body, env);
      case 'logResume':
        return await logResume(body, env);
      case 'chat':
        return await chat(body, env);
      case 'tts':
        return await tts(body, env);
      case 'addProduction':
        return await addProduction(body, env);
      case 'getProduction':
        return await getProduction(params, env);
      case 'getCultivars':
        return await getCultivars(env);
      case 'migrate':
        return await migrateFromSheets(env);
      case 'checkSheet': {
        // Debug: Check what's in Google Sheets for a specific date
        const date = params.date || formatDatePT(new Date(), 'yyyy-MM-dd');
        const sheetId = env.PRODUCTION_SHEET_ID;
        const monthSheet = date.substring(0, 7); // YYYY-MM
        try {
          const data = await readSheet(sheetId, `'${monthSheet}'!A:Z`, env);
          const rows = [];
          let currentDate = null;
          for (const row of data) {
            if (row[0] === 'Date:') {
              currentDate = row[1];
              continue;
            }
            if (currentDate && String(currentDate).includes(date.split('-')[2])) {
              rows.push({ date: currentDate, slot: row[0], data: row.slice(1, 15) });
            }
          }
          return successResponse({ date, monthSheet, rowCount: rows.length, rows: rows.slice(0, 20) });
        } catch (e) {
          return successResponse({ date, monthSheet, error: e.message });
        }
      }
      default:
        return errorResponse(`Unknown action: ${action}`, 'NOT_FOUND', 404);
    }
  } catch (error) {
    console.error('Production handler error:', error);
    const { message, code, status } = formatError(error);
    return errorResponse(message, code, status);
  }
}
