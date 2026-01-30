/**
 * Production Tracking API Handler - D1 Version
 * Migrated from Google Sheets to Cloudflare D1
 */

import { query, queryOne, insert, execute } from '../lib/db.js';
import { readSheet, appendSheet, getSheetNames } from '../lib/sheets.js';
import { successResponse, errorResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { createError, formatError } from '../lib/errors.js';
import { sanitizeForSheets, validateDate } from '../lib/validate.js';

const AI_MODEL = 'claude-sonnet-4-20250514';
const TIMEZONE = 'America/Los_Angeles';

// Sheet tab names
const SHEETS = {
  tracking: 'Rogue Origin Production Tracking',
  pauseLog: 'Timer Pause Log',
  shiftAdjustments: 'Shift Adjustments',
  orders: 'Orders',
  data: 'Data',
};

// Blacklist for test/accidental bag scans
const BLACKLISTED_BAGS = [
  // Add entries here if needed for specific test scans
  // Example: { exact: new Date('2026-01-28T19:25:46Z'), tolerance: 2000 }
];

/**
 * Check if a bag timestamp should be blacklisted (test/accidental scans)
 * @param {Date} bagDate - Bag timestamp to check
 * @returns {boolean} True if blacklisted
 */
function isBlacklistedBag(bagDate) {
  for (const entry of BLACKLISTED_BAGS) {
    if (entry.exact) {
      const diff = Math.abs(bagDate - entry.exact);
      if (diff <= (entry.tolerance || 0)) {
        return true;
      }
    } else if (entry.start && entry.end) {
      if (bagDate >= entry.start && bagDate <= entry.end) {
        return true;
      }
    }
  }
  return false;
}

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

// ===== CONFIG HELPERS =====

// Cache config in memory for the request lifetime
let _configCache = null;

async function getConfig(env, key) {
  try {
    const row = await env.DB.prepare(
      'SELECT value, value_type FROM system_config WHERE key = ?'
    ).bind(key).first();
    if (!row) return null;
    return parseConfigValue(row.value, row.value_type);
  } catch {
    // Table may not exist yet — fall back to null (callers use ?? defaults)
    return null;
  }
}

async function getAllConfig(env, category = null) {
  let stmt;
  if (category) {
    stmt = env.DB.prepare('SELECT key, value, value_type, category, description, updated_at FROM system_config WHERE category = ?').bind(category);
  } else {
    stmt = env.DB.prepare('SELECT key, value, value_type, category, description, updated_at FROM system_config');
  }
  const { results } = await stmt.all();
  const config = {};
  for (const row of results) {
    config[row.key] = {
      value: parseConfigValue(row.value, row.value_type),
      category: row.category,
      description: row.description,
      updatedAt: row.updated_at,
    };
  }
  return config;
}

async function setConfig(env, key, value, updatedBy = 'system') {
  await env.DB.prepare(
    `UPDATE system_config SET value = ?, updated_at = datetime('now'), updated_by = ? WHERE key = ?`
  ).bind(String(value), updatedBy, key).run();
}

function parseConfigValue(value, type) {
  switch (type) {
    case 'number': return parseFloat(value);
    case 'boolean': return value === 'true';
    case 'json': try { return JSON.parse(value); } catch { return value; }
    default: return value;
  }
}

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

function getTimeSlotMultiplier(timeSlot, multipliers = null) {
  if (!timeSlot) return 1.0;
  const table = multipliers || TIME_SLOT_MULTIPLIERS;
  const slot = String(timeSlot).trim();
  if (table[slot]) {
    return table[slot];
  }
  const normalized = slot.replace(/[-–—]/g, '–');
  if (table[normalized]) {
    return table[normalized];
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

// ===== EFFECTIVE TARGET RATE =====

// Computes target rate using effective trimmer-hours (adjusted for break multipliers).
// This avoids double-penalizing breaks: the raw avgRate already reflects lower output
// during break slots, so applying multipliers again in the goal calculation would
// undercount the target. Using effective hours gives a true per-full-hour rate.
async function getEffectiveTargetRate(env, days = 7, timeSlotMultipliers = null) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = formatDatePT(cutoff, 'yyyy-MM-dd');

  const slots = await query(env.DB, `
    SELECT production_date, time_slot, tops_lbs1, trimmers_line1
    FROM monthly_production
    WHERE production_date >= ?
      AND tops_lbs1 > 0 AND trimmers_line1 > 0
    ORDER BY production_date
  `, [cutoffStr]);

  // Take the most recent N dates with production data
  const dates = [...new Set(slots.map(s => s.production_date))].sort().slice(-days);
  const dateSet = new Set(dates);

  let totalTops = 0;
  let totalEffectiveTrimmerHours = 0;

  for (const slot of slots) {
    if (dateSet.has(slot.production_date)) {
      totalTops += slot.tops_lbs1;
      totalEffectiveTrimmerHours += slot.trimmers_line1 * getTimeSlotMultiplier(slot.time_slot, timeSlotMultipliers);
    }
  }

  return totalEffectiveTrimmerHours > 0 ? totalTops / totalEffectiveTrimmerHours : 1.0;
}

// ===== SCOREBOARD DATA =====

async function getScoreboardData(env, date = null) {
  // Use provided date or default to today
  const today = date || formatDatePT(new Date(), 'yyyy-MM-dd');

  // Load config with fallbacks to hardcoded defaults
  const baseWageRate = (await getConfig(env, 'labor.base_wage_rate')) ?? BASE_WAGE_RATE;
  const employerTaxRate = (await getConfig(env, 'labor.employer_tax_rate')) ?? EMPLOYER_TAX_RATE;
  const totalLaborCostPerHour = baseWageRate * (1 + employerTaxRate);
  const timeSlotMultipliers = (await getConfig(env, 'schedule.time_slot_multipliers')) ?? TIME_SLOT_MULTIPLIERS;

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
      multiplier: getTimeSlotMultiplier(r.time_slot, timeSlotMultipliers),
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

  // Get historical rate for target (last 7 days) using effective trimmer-hours
  const targetRate = await getEffectiveTargetRate(env, 7, timeSlotMultipliers);
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
  const projection = calculateDailyProjection(rows, lastCompletedHourIndex, currentHourIndex, targetRate, totalLbs, timeSlotMultipliers);
  result.projectedTotal = projection.projectedTotal;
  result.dailyGoal = projection.dailyGoal;

  return result;
}

function calculateDailyProjection(todayRows, lastCompletedHourIndex, currentHourIndex, targetRate, totalLbsSoFar, timeSlotMultipliers = null) {
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
    const multiplier = getTimeSlotMultiplier(slot, timeSlotMultipliers);
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

async function getBagTimerData(env, date = null) {
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
    // Use provided date or default to today
    const today = date || formatDatePT(new Date(), 'yyyy-MM-dd');
    // For historical dates, use end of day; for live view, use current time
    const now = date ? new Date(date + 'T23:59:59') : new Date();

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

    const scoreboardData = await getScoreboardData(env, today);
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
    const seenFlowRunIds = new Set();
    const seenTimestamps = new Map(); // timestamp -> bag date
    let lastBag = null;

    for (const row of bags) {
      const rowDate = new Date(row.timestamp);
      if (isNaN(rowDate.getTime())) continue;

      // Skip blacklisted bags (test scans, accidental scans)
      if (isBlacklistedBag(rowDate)) continue;

      // Skip duplicate flow_run_id (Shopify Flow retries/double-fires webhooks)
      if (row.flow_run_id && seenFlowRunIds.has(row.flow_run_id)) {
        console.log(`Skipping duplicate flow_run_id: ${row.flow_run_id} at ${row.timestamp}`);
        continue;
      }
      if (row.flow_run_id) {
        seenFlowRunIds.add(row.flow_run_id);
      }

      // Extract timestamp from flow_run_id if it contains one
      // Format: LIFT-INTL-HT-5-KG-2025-2026-01-28T15:35:47Z
      let isDuplicate = false;
      if (row.flow_run_id && row.flow_run_id.includes('T') && row.flow_run_id.includes('Z')) {
        const match = row.flow_run_id.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/);
        if (match) {
          const embeddedTimestamp = match[1];
          const embeddedDate = new Date(embeddedTimestamp);

          // Check if this timestamp matches an existing bag (within 10 seconds)
          for (const [seenTs, seenDate] of seenTimestamps.entries()) {
            const timeDiffSec = Math.abs((embeddedDate - seenDate) / 1000);
            if (timeDiffSec < 10) {
              console.log(`Skipping duplicate: flow_run_id contains ${embeddedTimestamp}, matches existing bag at ${seenTs}`);
              isDuplicate = true;
              break;
            }
          }
        }
      }
      if (isDuplicate) continue;

      // Track this timestamp
      seenTimestamps.set(row.timestamp, rowDate);
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
           SUM(buckers_line1) as bucker_hours,
           SUM(tzero_line1) as tzero_hours,
           SUM(
             CASE
               WHEN (buckers_line1 + trimmers_line1 + tzero_line1) > 0 AND tops_lbs1 > 0
               THEN buckers_line1 + trimmers_line1 + tzero_line1
               ELSE 0
             END
           ) as operator_hours,
           COUNT(
             CASE
               WHEN (buckers_line1 + trimmers_line1 + tzero_line1) > 0 AND tops_lbs1 > 0
               THEN 1
               ELSE NULL
             END
           ) as hours_with_data
    FROM monthly_production
    WHERE production_date >= ?
    GROUP BY production_date
    ORDER BY production_date
  `, [cutoffStr]);

  return rows.map(r => {
    const totalTops = r.total_tops || 0;
    const totalSmalls = r.total_smalls || 0;
    const totalLbs = totalTops + totalSmalls;
    const trimmerHours = r.trimmer_hours || 0;
    const buckerHours = r.bucker_hours || 0;
    const tzeroHours = r.tzero_hours || 0;
    const waterspiderHours = r.hours_with_data || 0; // 1 waterspider per hour with data

    // Calculate weight ratio for cost splitting
    const topsRatio = totalLbs > 0 ? totalTops / totalLbs : 1;
    const smallsRatio = totalLbs > 0 ? totalSmalls / totalLbs : 0;

    // Split costs by processing role:
    // - Buckers + TZero + Waterspider: split by weight ratio (process both tops and smalls)
    // - Trimmers: 100% to tops only
    const sharedHours = buckerHours + tzeroHours + waterspiderHours;
    const topsSharedHours = sharedHours * topsRatio;
    const smallsSharedHours = sharedHours * smallsRatio;

    const topsLaborHours = trimmerHours + topsSharedHours;
    const smallsLaborHours = smallsSharedHours;

    const topsLaborCost = topsLaborHours * TOTAL_LABOR_COST_PER_HOUR;
    const smallsLaborCost = smallsLaborHours * TOTAL_LABOR_COST_PER_HOUR;
    const totalLaborCost = topsLaborCost + smallsLaborCost;

    const topsCostPerLb = totalTops > 0 ? topsLaborCost / totalTops : 0;
    const smallsCostPerLb = totalSmalls > 0 ? smallsLaborCost / totalSmalls : 0;
    const blendedCostPerLb = totalLbs > 0 ? totalLaborCost / totalLbs : 0;

    const totalOperatorHours = buckerHours + trimmerHours + tzeroHours + waterspiderHours;

    return {
      date: new Date(r.production_date),
      totalTops,
      totalSmalls,
      avgRate: trimmerHours > 0 ? totalTops / trimmerHours : 0,
      totalLbs,
      trimmerHours,
      operatorHours: totalOperatorHours,
      laborCost: totalLaborCost,
      costPerLb: blendedCostPerLb,
      topsCostPerLb,
      smallsCostPerLb,
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

    // Also try with Pacific time conversion - include flow_run_id to detect duplicates
    const todayBagsPT = await query(env.DB, `
      SELECT timestamp, size, sku, flow_run_id,
             datetime(timestamp, '-8 hours') as pst_time
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

async function scoreboard(params, env) {
  // Extract optional date parameter for historical view (format: YYYY-MM-DD)
  const date = params.date || null;

  // Validate date format if provided
  if (date && !validateDate(date)) {
    return errorResponse('Invalid date format. Use YYYY-MM-DD', 'VALIDATION_ERROR', 400);
  }

  const scoreboardData = await getScoreboardData(env, date);
  const timerData = await getBagTimerData(env, date);

  return successResponse({
    scoreboard: scoreboardData,
    timer: timerData,
    date: date || formatDatePT(new Date(), 'yyyy-MM-dd'), // Return the date being viewed
  });
}

// ===== STRAIN ANALYSIS =====

/**
 * Get strain summary for top N active strains
 * @param {Object} env - Environment with DB binding
 * @param {number} days - Number of days to analyze (default 7)
 * @param {number} limit - Max number of strains to return (default 5)
 * @returns {Array} Top strains with production stats
 */
async function getStrainSummary(env, days = 7, limit = 5) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffStr = formatDatePT(cutoffDate, 'yyyy-MM-dd');

    // Query production data grouped by strain
    const rows = await query(env.DB, `
      SELECT
        cultivar1 as strain,
        SUM(tops_lbs1) as total_tops,
        SUM(smalls_lbs1) as total_smalls,
        SUM(trimmers_line1) as trimmer_hours,
        SUM(buckers_line1) as bucker_hours,
        SUM(tzero_line1) as tzero_hours,
        COUNT(CASE WHEN tops_lbs1 > 0 OR smalls_lbs1 > 0 THEN 1 END) as active_hours,
        COUNT(DISTINCT production_date) as days_worked
      FROM monthly_production
      WHERE production_date >= ?
        AND cultivar1 IS NOT NULL
        AND cultivar1 != ''
      GROUP BY cultivar1
      ORDER BY (total_tops + total_smalls) DESC
      LIMIT ?
    `, [cutoffStr, limit]);

    // Calculate metrics for each strain
    return rows.map(r => {
      const totalLbs = (r.total_tops || 0) + (r.total_smalls || 0);
      const topsRatio = totalLbs > 0 ? r.total_tops / totalLbs : 0;
      const smallsRatio = totalLbs > 0 ? r.total_smalls / totalLbs : 0;

      // Labor hours breakdown
      const trimmerHours = r.trimmer_hours || 0;
      const buckerHours = r.bucker_hours || 0;
      const tzeroHours = r.tzero_hours || 0;
      const waterspiderHours = r.active_hours || 0; // 1 waterspider per active hour
      const sharedHours = buckerHours + tzeroHours + waterspiderHours;

      // Split costs: Trimmers 100% to tops, shared roles split by weight ratio
      const topsLaborHours = trimmerHours + (sharedHours * topsRatio);
      const smallsLaborHours = sharedHours * smallsRatio;

      // Calculate costs
      const topsLaborCost = topsLaborHours * TOTAL_LABOR_COST_PER_HOUR;
      const smallsLaborCost = smallsLaborHours * TOTAL_LABOR_COST_PER_HOUR;

      const topsCostPerLb = r.total_tops > 0 ? topsLaborCost / r.total_tops : 0;
      const smallsCostPerLb = r.total_smalls > 0 ? smallsLaborCost / r.total_smalls : 0;

      // Average rate
      const crewHours = trimmerHours + buckerHours + tzeroHours;
      const avgRate = crewHours > 0 ? totalLbs / crewHours : 0;

      return {
        strain: r.strain,
        totalLbs: Math.round(totalLbs * 10) / 10,
        tops: Math.round(r.total_tops * 10) / 10,
        smalls: Math.round(r.total_smalls * 10) / 10,
        avgRate: Math.round(avgRate * 100) / 100,
        topsCostPerLb: Math.round(topsCostPerLb * 100) / 100,
        smallsCostPerLb: Math.round(smallsCostPerLb * 100) / 100,
        daysWorked: r.days_worked
      };
    });
  } catch (error) {
    console.error('Error getting strain summary:', error);
    return [];
  }
}

/**
 * Analyze production data for a specific strain
 * @param {Object} params - Request parameters
 * @param {Object} env - Environment with DB binding
 * @returns {Object} Comprehensive strain analysis
 */
async function analyzeStrain(params, env) {
  const strain = params.strain;
  const days = parseInt(params.days) || 90;

  if (!strain) {
    return errorResponse('Strain name is required', 'VALIDATION_ERROR', 400);
  }

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffStr = formatDatePT(cutoffDate, 'yyyy-MM-dd');
    const today = formatDatePT(new Date(), 'yyyy-MM-dd');

    // Query all production data where cultivar matches strain (fuzzy matching)
    const rows = await query(env.DB, `
      SELECT
        production_date,
        time_slot,
        cultivar1,
        tops_lbs1,
        smalls_lbs1,
        trimmers_line1,
        buckers_line1,
        tzero_line1
      FROM monthly_production
      WHERE production_date >= ?
        AND production_date <= ?
        AND (cultivar1 LIKE '%' || ? || '%')
        AND (tops_lbs1 > 0 OR smalls_lbs1 > 0)
      ORDER BY production_date, time_slot
    `, [cutoffStr, today, strain]);

    if (rows.length === 0) {
      return successResponse({
        strain,
        found: false,
        message: `No production data found for strain matching "${strain}" in the last ${days} days`,
      });
    }

    // Get unique strain variants matched
    const matchedVariants = [...new Set(rows.map(r => r.cultivar1))];

    // Group by date for daily breakdown
    const dateMap = {};
    let totalTops = 0;
    let totalSmalls = 0;
    let totalTrimmerHours = 0;
    let totalBuckerHours = 0;
    let totalTZeroHours = 0;
    let totalActiveHours = 0;

    rows.forEach(row => {
      const date = row.production_date;
      if (!dateMap[date]) {
        dateMap[date] = {
          date,
          tops: 0,
          smalls: 0,
          trimmerHours: 0,
          buckerHours: 0,
          tzeroHours: 0,
          hours: 0,
        };
      }

      dateMap[date].tops += row.tops_lbs1 || 0;
      dateMap[date].smalls += row.smalls_lbs1 || 0;
      dateMap[date].trimmerHours += row.trimmers_line1 || 0;
      dateMap[date].buckerHours += row.buckers_line1 || 0;
      dateMap[date].tzeroHours += row.tzero_line1 || 0;
      dateMap[date].hours++;

      totalTops += row.tops_lbs1 || 0;
      totalSmalls += row.smalls_lbs1 || 0;
      totalTrimmerHours += row.trimmers_line1 || 0;
      totalBuckerHours += row.buckers_line1 || 0;
      totalTZeroHours += row.tzero_line1 || 0;
      totalActiveHours++;
    });

    const totalLbs = totalTops + totalSmalls;
    const daysWorked = Object.keys(dateMap).length;
    const waterspiderHours = totalActiveHours; // 1 waterspider per active hour
    const totalOperatorHours = totalTrimmerHours + totalBuckerHours + totalTZeroHours + waterspiderHours;

    // Calculate split costs
    const topsRatio = totalLbs > 0 ? totalTops / totalLbs : 0;
    const smallsRatio = totalLbs > 0 ? totalSmalls / totalLbs : 0;

    const sharedHours = totalBuckerHours + totalTZeroHours + waterspiderHours;
    const topsLaborHours = totalTrimmerHours + (sharedHours * topsRatio);
    const smallsLaborHours = sharedHours * smallsRatio;

    const topsLaborCost = topsLaborHours * TOTAL_LABOR_COST_PER_HOUR;
    const smallsLaborCost = smallsLaborHours * TOTAL_LABOR_COST_PER_HOUR;
    const totalLaborCost = topsLaborCost + smallsLaborCost;

    const topsCostPerLb = totalTops > 0 ? topsLaborCost / totalTops : 0;
    const smallsCostPerLb = totalSmalls > 0 ? smallsLaborCost / totalSmalls : 0;
    const blendedCostPerLb = totalLbs > 0 ? totalLaborCost / totalLbs : 0;

    const crewHours = totalTrimmerHours + totalBuckerHours + totalTZeroHours;
    const avgRate = crewHours > 0 ? totalLbs / crewHours : 0;

    // Calculate daily breakdown with rates
    const byDate = Object.keys(dateMap).sort().map(date => {
      const data = dateMap[date];
      const dayTotal = data.tops + data.smalls;
      const dayCrewHours = data.trimmerHours + data.buckerHours + data.tzeroHours;
      const dayRate = dayCrewHours > 0 ? dayTotal / dayCrewHours : 0;

      return {
        date,
        totalLbs: Math.round(dayTotal * 10) / 10,
        tops: Math.round(data.tops * 10) / 10,
        smalls: Math.round(data.smalls * 10) / 10,
        hours: data.hours,
        crewHours: dayCrewHours,
        rate: Math.round(dayRate * 100) / 100,
      };
    });

    // Find best and worst days
    const daysWithData = byDate.filter(d => d.rate > 0);
    let bestDay = null;
    let worstDay = null;

    if (daysWithData.length > 0) {
      bestDay = daysWithData.reduce((best, current) =>
        current.rate > best.rate ? current : best
      );
      worstDay = daysWithData.reduce((worst, current) =>
        current.rate < worst.rate ? current : worst
      );
    }

    return successResponse({
      strain,
      matchedVariants,
      found: true,
      dateRange: {
        start: cutoffStr,
        end: today,
        days,
      },
      summary: {
        totalLbs: Math.round(totalLbs * 10) / 10,
        tops: Math.round(totalTops * 10) / 10,
        smalls: Math.round(totalSmalls * 10) / 10,
        topsPercent: Math.round(topsRatio * 1000) / 10,
        smallsPercent: Math.round(smallsRatio * 1000) / 10,
        daysWorked,
        productionHours: totalActiveHours,
        avgRate: Math.round(avgRate * 100) / 100,
        topsCostPerLb: Math.round(topsCostPerLb * 100) / 100,
        smallsCostPerLb: Math.round(smallsCostPerLb * 100) / 100,
        blendedCostPerLb: Math.round(blendedCostPerLb * 100) / 100,
        totalLaborCost: Math.round(totalLaborCost * 100) / 100,
      },
      labor: {
        trimmerHours: totalTrimmerHours,
        buckerHours: totalBuckerHours,
        tzeroHours: totalTZeroHours,
        waterspiderHours,
        totalOperatorHours,
      },
      byDate,
      bestDay: bestDay ? {
        date: bestDay.date,
        rate: bestDay.rate,
        lbs: bestDay.totalLbs,
      } : null,
      worstDay: worstDay ? {
        date: worstDay.date,
        rate: worstDay.rate,
        lbs: worstDay.totalLbs,
      } : null,
    });
  } catch (error) {
    console.error('Error analyzing strain:', error);
    return errorResponse(`Failed to analyze strain: ${error.message}`, 'INTERNAL_ERROR', 500);
  }
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
  // Use requested end date if provided, otherwise use today
  const targetDate = end || start || today;
  const isViewingToday = targetDate === today;
  const scoreboardData = await getScoreboardData(env, isViewingToday ? null : targetDate);
  const timerData = await getBagTimerData(env, isViewingToday ? null : targetDate);

  // Calculate days to fetch based on requested date range
  let daysToFetch = 30; // default
  if (start) {
    const startDate = new Date(start + 'T00:00:00');
    const todayDate = new Date(today + 'T00:00:00');
    const diffMs = todayDate - startDate;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    daysToFetch = Math.max(30, diffDays + 1); // +1 to include today
  }

  const dailyData = await getExtendedDailyData(daysToFetch, env);

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

  const validDays = dailyData
    .filter((d) => d.totalTops > 0 && formatDatePT(d.date, 'yyyy-MM-dd') <= targetDate)
    .slice(-7);
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
  // Only count hours with full data (crew + production)
  // Split costs: Buckers+TZero+Waterspider by weight ratio, Trimmers 100% to tops
  const todayOperatorData = await queryOne(env.DB, `
    SELECT
      SUM(
        CASE
          WHEN (buckers_line1 + trimmers_line1 + tzero_line1) > 0 AND tops_lbs1 > 0
          THEN trimmers_line1
          ELSE 0
        END
      ) as trimmer_hours,
      SUM(
        CASE
          WHEN (buckers_line1 + trimmers_line1 + tzero_line1) > 0 AND tops_lbs1 > 0
          THEN buckers_line1
          ELSE 0
        END
      ) as bucker_hours,
      SUM(
        CASE
          WHEN (buckers_line1 + trimmers_line1 + tzero_line1) > 0 AND tops_lbs1 > 0
          THEN tzero_line1
          ELSE 0
        END
      ) as tzero_hours,
      COUNT(
        CASE
          WHEN (buckers_line1 + trimmers_line1 + tzero_line1) > 0 AND tops_lbs1 > 0
          THEN 1
          ELSE NULL
        END
      ) as hours_with_data,
      SUM(tops_lbs1) as total_tops,
      SUM(smalls_lbs1) as total_smalls
    FROM monthly_production
    WHERE production_date = ?
  `, [targetDate]);

  const todayTops = todayOperatorData?.total_tops || 0;
  const todaySmalls = todayOperatorData?.total_smalls || 0;
  const todayTotalLbs = todayTops + todaySmalls;
  const todayTrimmerHours = todayOperatorData?.trimmer_hours || 0;
  const todayBuckerHours = todayOperatorData?.bucker_hours || 0;
  const todayTZeroHours = todayOperatorData?.tzero_hours || 0;
  const todayWaterspiderHours = todayOperatorData?.hours_with_data || 0; // 1 waterspider per hour with data

  // Calculate weight ratio for cost splitting
  const todayTopsRatio = todayTotalLbs > 0 ? todayTops / todayTotalLbs : 1;
  const todaySmallsRatio = todayTotalLbs > 0 ? todaySmalls / todayTotalLbs : 0;

  // Split costs by processing role:
  // - Buckers + TZero + Waterspider: split by weight ratio (process both tops and smalls)
  // - Trimmers: 100% to tops only
  const todaySharedHours = todayBuckerHours + todayTZeroHours + todayWaterspiderHours;
  const todayTopsSharedHours = todaySharedHours * todayTopsRatio;
  const todaySmallsSharedHours = todaySharedHours * todaySmallsRatio;

  const todayTopsLaborHours = todayTrimmerHours + todayTopsSharedHours;
  const todaySmallsLaborHours = todaySmallsSharedHours;

  const todayTopsLaborCost = todayTopsLaborHours * TOTAL_LABOR_COST_PER_HOUR;
  const todaySmallsLaborCost = todaySmallsLaborHours * TOTAL_LABOR_COST_PER_HOUR;
  const todayTotalLaborCost = todayTopsLaborCost + todaySmallsLaborCost;

  const todayTopsCostPerLb = todayTops > 0 ? todayTopsLaborCost / todayTops : 0;
  const todaySmallsCostPerLb = todaySmalls > 0 ? todaySmallsLaborCost / todaySmalls : 0;
  const todayBlendedCostPerLb = todayTotalLbs > 0 ? todayTotalLaborCost / todayTotalLbs : 0;

  const todayTotalOperatorHours = todayBuckerHours + todayTrimmerHours + todayTZeroHours + todayWaterspiderHours;

  const hoursWithData = todayOperatorData?.hours_with_data || 0;
  const todayData = {
    totalTops: todayTops,
    totalSmalls: todaySmalls,
    totalLbs: todayTotalLbs,
    avgRate: totalTrimmerHours > 0 ? weightedRateSum / totalTrimmerHours : 0,
    trimmers: isViewingToday
      ? (scoreboardData.lastHourTrimmers || scoreboardData.currentHourTrimmers || 0)
      : (hoursWithData > 0 ? Math.round(todayTrimmerHours / hoursWithData) : 0),
    buckers: isViewingToday
      ? (scoreboardData.lastHourBuckers || 0)
      : (hoursWithData > 0 ? Math.round(todayBuckerHours / hoursWithData) : 0),
    tzero: hoursWithData > 0 ? Math.round(todayTZeroHours / hoursWithData) : 0,
    operatorHours: todayTotalOperatorHours,
    laborCost: todayTotalLaborCost,
    costPerLb: todayBlendedCostPerLb,
    topsCostPerLb: todayTopsCostPerLb,
    smallsCostPerLb: todaySmallsCostPerLb,
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
    tops: h.lbs,
    smalls: 0,
  }));

  // Get strain snapshot (top 5 strains from last 7 days)
  const strainSnapshot = await getStrainSummary(env, 7, 5);

  return successResponse({
    today: todayData,
    current,
    targets,
    bagTimer,
    hourly,
    rollingAverage,
    strainSnapshot,
    isHistorical: !isViewingToday,
    viewingDate: targetDate,
    daily: filteredData.map((d) => ({
      date: formatDatePT(d.date, 'yyyy-MM-dd'),
      label: formatDatePT(d.date, 'yyyy-MM-dd'),
      totalTops: Math.round(d.totalTops * 10) / 10,
      totalSmalls: Math.round(d.totalSmalls * 10) / 10,
      totalLbs: Math.round(d.totalLbs * 10) / 10,
      avgRate: Math.round(d.avgRate * 100) / 100,
      trimmerHours: Math.round(d.trimmerHours * 10) / 10,
      operatorHours: Math.round(d.operatorHours * 10) / 10,
      laborCost: Math.round(d.laborCost * 100) / 100,
      costPerLb: Math.round(d.costPerLb * 100) / 100,
      topsCostPerLb: Math.round(d.topsCostPerLb * 100) / 100,
      smallsCostPerLb: Math.round(d.smallsCostPerLb * 100) / 100,
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

async function inventoryWebhook(body, env, request) {
  // Verify webhook secret (check header or query param)
  const webhookSecret = env.WEBHOOK_SECRET;
  if (webhookSecret) {
    const headerSecret = request?.headers?.get('X-Webhook-Secret');
    const url = new URL(request?.url || 'http://localhost');
    const paramSecret = url.searchParams.get('secret');

    if (headerSecret !== webhookSecret && paramSecret !== webhookSecret) {
      console.warn('Webhook rejected: invalid or missing secret');
      return errorResponse('Unauthorized', 'UNAUTHORIZED', 401);
    }
  }

  // Extract fields from webhook payload
  // Shopify Flow may send as flat object or nested
  const data = body.data || body;

  // Support nested Shopify Flow format: { product: {}, variant: {}, inventory: {}, context: {} }
  const product = data.product || {};
  const variant = data.variant || {};
  const inventory = data.inventory || {};
  const context = data.context || {};

  // Extract with fallbacks for both flat and nested formats
  const timestamp = data.Timestamp || data.timestamp || inventory.updated_at || new Date().toISOString();
  const sku = data.SKU || data.sku || variant.sku || '';
  const productName = data['Product Name'] || data.product_name || product.title || '';
  const variantTitle = data['Variant Title'] || data.variant_title || variant.title || '';
  const strainName = data['Strain Name'] || data.strain_name || '';

  // Extract size - check explicit field, then infer from weight, then parse from title
  let size = data.Size || data.size || '';
  if (!size && variant.weight && variant.weight_unit) {
    const weight = parseFloat(variant.weight);
    const unit = String(variant.weight_unit).toLowerCase();
    if (unit.includes('kilogram') || unit === 'kg') {
      // Direct kg weight
      if (Math.abs(weight - 5) < 0.25) {
        size = '5kg';
      } else {
        size = `${weight}kg`;
      }
    } else if (unit.includes('pound') || unit === 'lb') {
      // Handle common bag sizes in pounds
      // 5kg ≈ 11.02 lbs, 10lb = 10 lbs
      if (Math.abs(weight - 11) < 0.5) {
        size = '5kg';  // 5kg bags (~11 lbs)
      } else if (Math.abs(weight - 10) < 0.5) {
        size = '10lb';  // 10lb bags
      } else {
        size = `${weight}lb`;  // Other sizes
      }
    }
  }
  // Fallback: check if variant title contains size
  if (!size && variantTitle) {
    const match = variantTitle.match(/(\d+)\s*kg/i);
    if (match) size = `${match[1]}kg`;
  }

  const quantityAdjusted = parseInt(data['Quantity Adjusted'] || data.quantity_adjusted || 0, 10);
  const newTotalAvailable = parseInt(data['New Total Available'] || data.new_total_available || inventory.available_quantity || 0, 10);
  const previousAvailable = parseInt(data['Previous Available'] || data.previous_available || 0, 10);
  const location = data.Location || data.location || inventory.location_name || '';
  const productType = data['Product Type'] || data.product_type || product.type || '';
  const barcode = data.Barcode || data.barcode || variant.barcode || '';
  const price = parseFloat(data.Price || data.price || variant.price || 0);
  const flowRunId = data['Flow Run ID'] || data.flow_run_id || context.flow_run_id || `manual-${Date.now()}`;
  const eventType = data['Event Type'] || data.event_type || 'inventory_adjustment';
  const adjustmentSource = data['Adjustment Source'] || data.adjustment_source || context.source || '';
  const normalizedStrain = data['Normalized Strain'] || data.normalized_strain || '';

  const errors = [];
  let d1Success = false;
  let sheetsSuccess = false;

  // 1. Write to D1
  try {
    await insert(env.DB, 'inventory_adjustments', {
      timestamp: sanitizeForSheets(timestamp),
      sku: sanitizeForSheets(sku),
      product_name: sanitizeForSheets(productName),
      variant_title: sanitizeForSheets(variantTitle),
      strain_name: sanitizeForSheets(strainName),
      size: sanitizeForSheets(size),
      quantity_adjusted: quantityAdjusted,
      new_total_available: newTotalAvailable,
      previous_available: previousAvailable,
      location: sanitizeForSheets(location),
      product_type: sanitizeForSheets(productType),
      barcode: sanitizeForSheets(barcode),
      price,
      flow_run_id: sanitizeForSheets(flowRunId),
      event_type: sanitizeForSheets(eventType),
      adjustment_source: sanitizeForSheets(adjustmentSource),
      normalized_strain: sanitizeForSheets(normalizedStrain),
    });
    d1Success = true;
  } catch (err) {
    // If duplicate flow_run_id, treat as success (idempotent)
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      d1Success = true;
    } else {
      errors.push(`D1 error: ${err.message}`);
    }
  }

  // 2. Write to Google Sheets (production sheet's tracking tab)
  try {
    const sheetId = env.PRODUCTION_SHEET_ID;

    // Format row to match "Rogue Origin Production Tracking" columns:
    // Timestamp, SKU, Product Name, Variant Title, Strain Name, Size,
    // Quantity Adjusted, New Total Available, Previous Available, Location,
    // Product Type, Barcode, Price, Flow Run ID, Event Type, Adjustment Source, Normalized Strain
    const row = [
      timestamp,
      sku,
      productName,
      variantTitle,
      strainName,
      size,
      quantityAdjusted > 0 ? `+${quantityAdjusted}` : String(quantityAdjusted),
      newTotalAvailable,
      previousAvailable,
      location,
      productType,
      barcode,
      price,
      flowRunId,
      eventType,
      adjustmentSource,
      normalizedStrain,
    ];

    await appendSheet(sheetId, `'${SHEETS.tracking}'!A:Q`, [row], env);
    sheetsSuccess = true;
  } catch (err) {
    errors.push(`Sheets error: ${err.message}`);
  }

  // Return status
  if (d1Success && sheetsSuccess) {
    // Increment version to notify clients of new data
    await incrementDataVersion(env);
    return successResponse({
      success: true,
      message: 'Inventory adjustment recorded (D1 + Sheets)',
      flowRunId,
      sku,
      quantityAdjusted,
    });
  } else if (d1Success || sheetsSuccess) {
    // Increment version even for partial success
    await incrementDataVersion(env);
    return successResponse({
      success: true,
      partial: true,
      message: `Recorded to ${d1Success ? 'D1' : ''}${d1Success && sheetsSuccess ? ' + ' : ''}${sheetsSuccess ? 'Sheets' : ''}`,
      errors,
      flowRunId,
    });
  } else {
    return errorResponse(`Failed to record: ${errors.join('; ')}`, 'INTERNAL_ERROR', 500);
  }
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

  // Load AI model from config with fallback
  const aiModel = (await getConfig(env, 'api.ai_model')) ?? AI_MODEL;

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
      model: aiModel,
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

/**
 * Get current scale weight from D1
 * Returns weight, target, percentage, and stale status
 */
async function getScaleWeight(params, env) {
  const stationId = params.stationId || 'line1';
  const STALE_THRESHOLD_MS = 3000; // 3 seconds

  try {
    const result = await env.DB.prepare(
      'SELECT weight, target_weight, updated_at FROM scale_readings WHERE station_id = ?'
    ).bind(stationId).first();

    if (!result) {
      return successResponse({
        weight: 0,
        targetWeight: 5.0,
        percentComplete: 0,
        stationId,
        updatedAt: null,
        isStale: true,
      });
    }

    const updatedAt = new Date(result.updated_at + 'Z');
    const now = new Date();
    const isStale = (now - updatedAt) > STALE_THRESHOLD_MS;
    const percentComplete = result.target_weight > 0
      ? Math.min(100, Math.round((result.weight / result.target_weight) * 100))
      : 0;

    return successResponse({
      weight: result.weight,
      targetWeight: result.target_weight,
      percentComplete,
      stationId,
      updatedAt: updatedAt.toISOString(),
      isStale,
    });
  } catch (error) {
    console.error('Error getting scale weight:', error);
    return errorResponse('Failed to get scale weight', 'INTERNAL_ERROR', 500);
  }
}

/**
 * Update scale weight from station PC
 * Called every 500ms by the scale reader app
 */
async function setScaleWeight(body, env) {
  const stationId = body.stationId || 'line1';
  const weight = parseFloat(body.weight);

  if (isNaN(weight) || weight < 0) {
    return errorResponse('Invalid weight value', 'VALIDATION_ERROR', 400);
  }

  // Cap at reasonable max (10kg for safety)
  const safeWeight = Math.min(weight, 10);

  try {
    await env.DB.prepare(
      `INSERT INTO scale_readings (station_id, weight, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(station_id) DO UPDATE SET
         weight = excluded.weight,
         updated_at = datetime('now')`
    ).bind(stationId, safeWeight).run();

    return successResponse({ success: true });
  } catch (error) {
    console.error('Error setting scale weight:', error);
    return errorResponse('Failed to update scale weight', 'INTERNAL_ERROR', 500);
  }
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
        return await scoreboard(params, env);
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
      case 'scaleWeight':
        if (request.method === 'POST') {
          return await setScaleWeight(body, env);
        }
        return await getScaleWeight(params, env);
      case 'inventoryWebhook':
      case 'webhook':
        return await inventoryWebhook(body, env, request);
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
      case 'analyzeStrain':
        return await analyzeStrain(params, env);
      case 'testConfig': {
        // Test if system_config table exists and has data
        try {
          const count = await env.DB.prepare('SELECT COUNT(*) as count FROM system_config').first();
          const sample = await env.DB.prepare('SELECT key, value, category FROM system_config LIMIT 3').all();
          return successResponse({
            test: 'config endpoints work',
            timestamp: new Date().toISOString(),
            tableExists: true,
            rowCount: count?.count || 0,
            sampleRows: sample?.results || []
          });
        } catch (e) {
          return successResponse({
            test: 'config endpoints work',
            timestamp: new Date().toISOString(),
            tableExists: false,
            error: e.message
          });
        }
      }
      case 'getConfig': {
        const category = params.category || null;
        const configData = await getAllConfig(env, category);
        return successResponse(configData);
      }
      case 'setConfig': {
        if (request.method !== 'POST') {
          return errorResponse('POST required', 'METHOD_ERROR', 405);
        }
        if (!body.key || body.value === undefined) {
          return errorResponse('key and value required', 'VALIDATION_ERROR', 400);
        }
        await setConfig(env, body.key, body.value, body.updatedBy || 'api');
        return successResponse({ success: true, key: body.key });
      }
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
