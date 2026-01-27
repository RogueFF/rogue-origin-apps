/**
 * Production Tracking API - Cloudflare Workers
 *
 * Endpoints:
 * - GET  ?action=test              - Test API
 * - GET  ?action=scoreboard        - Scoreboard + timer data
 * - GET  ?action=dashboard         - Dashboard data (with date range)
 * - GET  ?action=setShiftStart     - Set shift start time
 * - GET  ?action=getShiftStart     - Get shift start time
 * - GET  ?action=morningReport     - Morning report data
 * - GET  ?action=getCultivars      - Get cultivar list (for hourly entry)
 * - GET  ?action=getProduction     - Get hourly production data for date
 * - POST ?action=addProduction     - Add/update hourly production data
 * - POST ?action=logBag            - Log bag completion
 * - POST ?action=logPause          - Log timer pause
 * - POST ?action=logResume         - Log timer resume
 * - POST ?action=chat              - AI agent chat
 * - POST ?action=tts               - Text-to-speech
 * - POST ?action=webhook           - Shopify inventory webhook (dual-write D1 + Sheets)
 * - GET  ?action=scaleWeight       - Get live scale weight
 * - POST ?action=scaleWeight       - Update scale weight (from station PC)
 */

import { readSheet, appendSheet, writeSheet, getSheetNames } from '../lib/sheets.js';
import { successResponse, errorResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { createError, formatError } from '../lib/errors.js';
import { sanitizeForSheets, validateDate } from '../lib/validate.js';
import { insert } from '../lib/db.js';

const AI_MODEL = 'claude-sonnet-4-20250514';
const TIMEZONE = 'America/Los_Angeles';

// ===== FEATURE FLAGS =====
// When true, D1 is the source of truth for production data
// When false, Google Sheets is the source of truth (legacy)
const USE_D1_PRODUCTION = true;

// Short in-memory cache to reduce Google Sheets API calls
// Note: Each edge node has its own cache, but 5s TTL is short enough
// that stale data is acceptable (smart polling checks version every 5s anyway)
const scoreboardCache = {
  data: null,
  timestamp: 0,
  TTL: 5000, // 5 seconds - matches smart polling interval
};

// ===== VERSION TRACKING FOR SMART POLLING =====

/**
 * Get current data version from D1
 * @returns {number} Current version number
 */
async function getDataVersion(env) {
  try {
    const result = await env.DB.prepare(
      'SELECT version, updated_at FROM data_version WHERE key = ?'
    ).bind('scoreboard').first();
    return result ? { version: result.version, updatedAt: result.updated_at } : { version: 0, updatedAt: null };
  } catch (error) {
    console.error('Error getting data version:', error);
    return { version: 0, updatedAt: null };
  }
}

/**
 * Increment data version in D1 (call when data changes)
 * Also invalidates scoreboard cache so next request gets fresh data
 */
async function incrementDataVersion(env) {
  try {
    await env.DB.prepare(
      `INSERT INTO data_version (key, version, updated_at) VALUES ('scoreboard', 1, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET version = version + 1, updated_at = datetime('now')`
    ).run();

    // Invalidate scoreboard cache so next request fetches fresh data
    scoreboardCache.data = null;
    scoreboardCache.timestamp = 0;
  } catch (error) {
    console.error('Error incrementing data version:', error);
  }
}

// Sheet tab names
const SHEETS = {
  tracking: 'Rogue Origin Production Tracking',
  pauseLog: 'Timer Pause Log',
  shiftAdjustments: 'Shift Adjustments',
  orders: 'Orders',
  data: 'Data',
};

/**
 * Get the currently active pause (if any) from the pause log.
 * An active pause has no resume time (column D is empty).
 * Only returns pauses from today to avoid stale data.
 */
async function getActivePause(env) {
  try {
    const sheetId = env.PRODUCTION_SHEET_ID;
    const vals = await readSheet(sheetId, `'${SHEETS.pauseLog}'!A:G`, env);

    if (!vals || vals.length < 2) return null;

    const today = formatDatePT(new Date(), 'yyyy-MM-dd');

    // Find the most recent pause from today that has no resume time
    for (let i = vals.length - 1; i >= 1; i--) {
      const row = vals[i];
      const pauseId = row[0];
      const pauseDate = row[1];
      const startTime = row[2];
      const resumeTime = row[3];
      const reason = row[5];

      // Only consider today's pauses
      if (pauseDate !== today) continue;

      // If resume time is empty, this pause is still active
      if (!resumeTime || resumeTime === '') {
        // Parse start time to ISO
        const startDateTime = new Date(`${pauseDate}T${startTime}`);
        return {
          isPaused: true,
          pauseId: String(pauseId),
          pauseStartTime: startDateTime.toISOString(),
          pauseReason: reason || 'Unknown',
        };
      }
    }

    return null;
  } catch (error) {
    console.error('Error getting active pause:', error);
    return null;
  }
}

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

// Break schedule: [startHour, startMin, durationMinutes]
const BREAKS = [
  [9, 0, 10],    // 9:00 AM - 10 min break
  [12, 0, 30],   // 12:00 PM - 30 min lunch
  [14, 30, 10],  // 2:30 PM - 10 min break
  [16, 20, 10],  // 4:20 PM - 10 min cleanup
];

/**
 * Calculate total break minutes that fall within a time window
 * Break times are in PST (America/Los_Angeles)
 * @param {Date} startTime - Start of the cycle (previous bag completion)
 * @param {Date} endTime - End of the cycle (current bag completion)
 * @returns {number} Total break minutes within the window
 */
function getBreakMinutesInWindow(startTime, endTime) {
  let breakMinutes = 0;

  // Get the date in PST for creating break times
  const pstDateStr = endTime.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
  // pstDateStr is like "2026-01-20"

  for (const [breakHour, breakMin, duration] of BREAKS) {
    // Create break time string in PST, then parse as PST
    // Format: "2026-01-20T12:00:00" interpreted as PST
    const breakTimeStr = `${pstDateStr}T${String(breakHour).padStart(2, '0')}:${String(breakMin).padStart(2, '0')}:00`;

    // Parse as PST by using the Intl API to get UTC offset
    const pstFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });

    // Get current PST offset by comparing a known time
    const testDate = new Date(pstDateStr + 'T12:00:00Z');
    const pstParts = pstFormatter.formatToParts(testDate);
    const pstHour = parseInt(pstParts.find(p => p.type === 'hour').value);
    // If UTC 12:00 shows as 04:00 PST, offset is -8 hours (PST)
    // If UTC 12:00 shows as 05:00 PDT, offset is -7 hours (PDT)
    const offsetHours = 12 - pstHour;

    // Create break start in UTC by adding offset
    const breakStartUTC = new Date(breakTimeStr + 'Z');
    breakStartUTC.setUTCHours(breakStartUTC.getUTCHours() + offsetHours);
    const breakEndUTC = new Date(breakStartUTC.getTime() + duration * 60000);

    // Check if break overlaps with our cycle window
    if (breakEndUTC > startTime && breakStartUTC < endTime) {
      // Calculate overlap
      const overlapStart = Math.max(startTime.getTime(), breakStartUTC.getTime());
      const overlapEnd = Math.min(endTime.getTime(), breakEndUTC.getTime());
      const overlapMinutes = (overlapEnd - overlapStart) / 60000;
      if (overlapMinutes > 0) {
        breakMinutes += overlapMinutes;
      }
    }
  }

  return Math.round(breakMinutes);
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
  if (format === 'EEE') {
    return d.toLocaleDateString('en-US', {
      ...options,
      weekday: 'short',
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

async function getLatestMonthSheet(env) {
  const names = await getSheetNames(env.PRODUCTION_SHEET_ID, env);
  const monthSheets = names
    .filter((name) => /^\d{4}-\d{2}$/.test(name))
    .sort((a, b) => b.localeCompare(a));
  return monthSheets[0] || null;
}

function getColumnIndices(headers) {
  return {
    cultivar1: headers.indexOf('Cultivar 1'),
    tops1: headers.indexOf('Tops 1'),
    smalls1: headers.indexOf('Smalls 1'),
    buckers1: headers.indexOf('Buckers 1'),
    trimmers1: headers.indexOf('Trimmers 1'),
    tzero1: headers.indexOf('T-Zero 1'),
    cultivar2: headers.indexOf('Cultivar 2'),
    tops2: headers.indexOf('Tops 2'),
    smalls2: headers.indexOf('Smalls 2'),
    buckers2: headers.indexOf('Buckers 2'),
    trimmers2: headers.indexOf('Trimmers 2'),
    tzero2: headers.indexOf('T-Zero 2'),
    qcperson: headers.indexOf('QC'),  // Shared QC person count (column N)
    qcNotes: headers.indexOf('QC Notes'),  // QC notes text (if exists)
  };
}

function findDateRow(vals, dateLabel) {
  let lastAnyDateRow = -1;
  let todayDateRow = -1;

  for (let i = 0; i < vals.length; i++) {
    if (vals[i][0] === 'Date:') {
      lastAnyDateRow = i;
      if (vals[i][1] === dateLabel) {
        todayDateRow = i;
      }
    }
  }
  return todayDateRow !== -1 ? todayDateRow : lastAnyDateRow;
}

function isEndOfBlock(row) {
  if (!row[0]) return true;
  if (row[0] === 'Date:') return true;
  const str = String(row[0]);
  if (str.includes('Performance Averages')) return true;
  if (str.includes('Avg Tops:Smalls')) return true;
  return false;
}

function is5kgBag(size) {
  const s = String(size || '').toLowerCase().replace(/\s+/g, '');
  return s.includes('5kg') || s.includes('5 kg');
}

// ===== SCOREBOARD DATA =====

async function getScoreboardData(env) {
  const sheetId = env.PRODUCTION_SHEET_ID;
  const todayLabel = formatDatePT(new Date(), 'MMMM dd, yyyy');
  const monthSheetName = await getLatestMonthSheet(env);

  const result = {
    lastHourLbs: 0,
    lastHourTarget: 0,
    lastHourTrimmers: 0,
    lastTimeSlot: '',
    lastHourMultiplier: 1.0,
    currentHourTrimmers: 0,
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

  if (!monthSheetName) return result;

  const vals = await readSheet(sheetId, `'${monthSheetName}'!A:Z`, env);
  const dateRowIndex = findDateRow(vals, todayLabel);
  if (dateRowIndex === -1) return result;

  const headerRowIndex = dateRowIndex + 1;
  const headers = vals[headerRowIndex] || [];
  const cols = getColumnIndices(headers);

  // Collect LINE 1 rows for today
  const todayRows = [];
  for (let r = headerRowIndex + 1; r < vals.length; r++) {
    const row = vals[r];
    if (isEndOfBlock(row)) break;

    const timeSlot = row[0] || '';
    const tops1 = parseFloat(row[cols.tops1]) || 0;
    const tr1 = parseFloat(row[cols.trimmers1]) || 0;
    const cv1 = row[cols.cultivar1] || '';
    const multiplier = getTimeSlotMultiplier(timeSlot);

    todayRows.push({
      timeSlot,
      tops: tops1,
      trimmers: tr1,
      strain: cv1,
      multiplier,
    });
  }

  // Find last completed and current hour
  let lastCompletedHourIndex = -1;
  let currentHourIndex = -1;

  for (let i = 0; i < todayRows.length; i++) {
    const row = todayRows[i];
    if (row.tops > 0) {
      lastCompletedHourIndex = i;
    } else if (row.trimmers > 0 && row.tops === 0) {
      currentHourIndex = i;
    }
  }

  // Determine active strain
  let activeStrain = '';
  if (currentHourIndex >= 0 && todayRows[currentHourIndex].strain) {
    activeStrain = todayRows[currentHourIndex].strain;
  } else if (lastCompletedHourIndex >= 0 && todayRows[lastCompletedHourIndex].strain) {
    activeStrain = todayRows[lastCompletedHourIndex].strain;
  }
  result.strain = activeStrain;

  // Get historical rate for target
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

  for (let i = 0; i <= lastCompletedHourIndex && i < todayRows.length; i++) {
    const row = todayRows[i];
    if (row.tops > 0 && row.trimmers > 0) {
      totalLbs += row.tops;
      hoursWorked++;
      effectiveHours += row.multiplier;
    }
  }

  // Last completed hour
  if (lastCompletedHourIndex >= 0) {
    const lastRow = todayRows[lastCompletedHourIndex];
    result.lastHourLbs = lastRow.tops;
    result.lastHourTrimmers = lastRow.trimmers;
    result.lastHourMultiplier = lastRow.multiplier;
    result.lastHourTarget = lastRow.trimmers * targetRate * lastRow.multiplier;
    result.lastTimeSlot = lastRow.timeSlot;
  }

  // Current hour
  if (currentHourIndex >= 0) {
    const currentRow = todayRows[currentHourIndex];
    result.currentHourTrimmers = currentRow.trimmers;
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

  for (let i = 0; i <= lastCompletedHourIndex && i < todayRows.length; i++) {
    const row = todayRows[i];
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
  const projection = calculateDailyProjection(todayRows, lastCompletedHourIndex, currentHourIndex, targetRate, totalLbs);
  result.projectedTotal = projection.projectedTotal;
  result.dailyGoal = projection.dailyGoal;

  return result;
}

function calculateDailyProjection(todayRows, lastCompletedHourIndex, currentHourIndex, targetRate, totalLbsSoFar) {
  const allTimeSlots = [
    '7:00 AM – 8:00 AM', '8:00 AM – 9:00 AM', '9:00 AM – 10:00 AM',
    '10:00 AM – 11:00 AM', '11:00 AM – 12:00 PM', '12:30 PM – 1:00 PM',
    '1:00 PM – 2:00 PM', '2:00 PM – 3:00 PM', '3:00 PM – 4:00 PM', '4:00 PM – 4:30 PM',
  ];

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

  for (const slot of allTimeSlots) {
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

// ===== D1 SCOREBOARD DATA (Primary Source) =====

/**
 * Get scoreboard data from D1 database (primary source of truth)
 * Queries monthly_production table for today's hourly data
 */
async function getScoreboardDataFromD1(env) {
  const result = {
    lastHourLbs: 0,
    lastHourTarget: 0,
    lastHourTrimmers: 0,
    lastTimeSlot: '',
    lastHourMultiplier: 1.0,
    currentHourTrimmers: 0,
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

  try {
    // Get today's date in PT timezone
    const today = formatDatePT(new Date(), 'yyyy-MM-dd');

    // Query today's production data from D1
    const rows = await env.DB.prepare(`
      SELECT time_slot,
             trimmers_line1, trimmers_line2,
             tops_lbs1, tops_lbs2, smalls_lbs1, smalls_lbs2,
             cultivar1, cultivar2
      FROM monthly_production
      WHERE production_date = ?
      ORDER BY time_slot
    `).bind(today).all();

    if (!rows.results || rows.results.length === 0) {
      // No data today - try to get target rate from historical data
      const targetRate = await getHistoricalTargetRateFromD1(env, 7);
      result.targetRate = targetRate || 1.0;
      return result;
    }

    // Build todayRows array (same structure as Sheets version)
    const todayRows = rows.results.map(row => {
      const trimmers = (row.trimmers_line1 || 0) + (row.trimmers_line2 || 0);
      const tops = (row.tops_lbs1 || 0) + (row.tops_lbs2 || 0);
      const strain = row.cultivar1 || row.cultivar2 || '';
      const multiplier = getTimeSlotMultiplier(row.time_slot);

      return {
        timeSlot: row.time_slot,
        tops,
        trimmers,
        strain,
        multiplier,
      };
    });

    // Find last completed and current hour
    let lastCompletedHourIndex = -1;
    let currentHourIndex = -1;

    for (let i = 0; i < todayRows.length; i++) {
      const row = todayRows[i];
      if (row.tops > 0) {
        lastCompletedHourIndex = i;
      } else if (row.trimmers > 0 && row.tops === 0) {
        currentHourIndex = i;
      }
    }

    // Determine active strain
    let activeStrain = '';
    if (currentHourIndex >= 0 && todayRows[currentHourIndex].strain) {
      activeStrain = todayRows[currentHourIndex].strain;
    } else if (lastCompletedHourIndex >= 0 && todayRows[lastCompletedHourIndex].strain) {
      activeStrain = todayRows[lastCompletedHourIndex].strain;
    }
    result.strain = activeStrain;

    // Get target rate from historical D1 data (7-day average)
    const targetRate = await getHistoricalTargetRateFromD1(env, 7) || 1.0;
    result.targetRate = targetRate;

    // Calculate totals
    let totalLbs = 0;
    let hoursWorked = 0;
    let effectiveHours = 0;

    for (let i = 0; i <= lastCompletedHourIndex && i < todayRows.length; i++) {
      const row = todayRows[i];
      if (row.tops > 0 && row.trimmers > 0) {
        totalLbs += row.tops;
        hoursWorked++;
        effectiveHours += row.multiplier;
      }
    }

    // Last completed hour
    if (lastCompletedHourIndex >= 0) {
      const lastRow = todayRows[lastCompletedHourIndex];
      result.lastHourLbs = lastRow.tops;
      result.lastHourTrimmers = lastRow.trimmers;
      result.lastHourMultiplier = lastRow.multiplier;
      result.lastHourTarget = lastRow.trimmers * targetRate * lastRow.multiplier;
      result.lastTimeSlot = lastRow.timeSlot;
    }

    // Current hour
    if (currentHourIndex >= 0) {
      const currentRow = todayRows[currentHourIndex];
      result.currentHourTrimmers = currentRow.trimmers;
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

    for (let i = 0; i <= lastCompletedHourIndex && i < todayRows.length; i++) {
      const row = todayRows[i];
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

    // Daily projection (reuse same calculation)
    const projection = calculateDailyProjection(todayRows, lastCompletedHourIndex, currentHourIndex, targetRate, totalLbs);
    result.projectedTotal = projection.projectedTotal;
    result.dailyGoal = projection.dailyGoal;

    return result;
  } catch (error) {
    console.error('Error fetching scoreboard data from D1:', error);
    return result;
  }
}

/**
 * Calculate historical target rate from D1 (average lbs per trimmer per hour)
 * @param {number} days - Number of days to look back
 */
async function getHistoricalTargetRateFromD1(env, days = 7) {
  try {
    const result = await env.DB.prepare(`
      SELECT
        SUM(tops_lbs1 + tops_lbs2) as total_lbs,
        SUM(
          (trimmers_line1 *
            CASE
              WHEN time_slot LIKE '%12:30%' THEN 0.5
              WHEN time_slot LIKE '%4:00 PM%' THEN 0.5
              ELSE 1.0
            END
          ) +
          (trimmers_line2 *
            CASE
              WHEN time_slot LIKE '%12:30%' THEN 0.5
              WHEN time_slot LIKE '%4:00 PM%' THEN 0.5
              ELSE 1.0
            END
          )
        ) as total_trimmer_hours
      FROM monthly_production
      WHERE production_date >= date('now', '-' || ? || ' days')
        AND (tops_lbs1 > 0 OR tops_lbs2 > 0)
        AND (trimmers_line1 > 0 OR trimmers_line2 > 0)
    `).bind(days).first();

    if (result && result.total_lbs > 0 && result.total_trimmer_hours > 0) {
      return result.total_lbs / result.total_trimmer_hours;
    }
    return 1.0; // Default fallback
  } catch (error) {
    console.error('Error calculating historical rate from D1:', error);
    return 1.0;
  }
}

// ===== BAG TIMER DATA =====

// Blacklisted bag timestamps (test bags, accidentally scanned bags)
// Format: { start: Date, end: Date } for ranges, or { exact: Date, tolerance: number } for single bags
const BLACKLISTED_BAGS = [
  // 8 accidentally scanned bags on 1/19/2026 12:34:14 - 12:38:04 Pacific
  { start: new Date('2026-01-19T20:34:14Z'), end: new Date('2026-01-19T20:38:05Z') },
  // Test bags from webhook testing on 1/23/2026 (keep 11:45 AM and 1:10 PM)
  { exact: new Date('2026-01-23T21:01:22Z'), tolerance: 2000 }, // 1:01 PM - test
  { exact: new Date('2026-01-23T21:28:36Z'), tolerance: 2000 }, // 1:28 PM - test
  { exact: new Date('2026-01-23T21:31:40Z'), tolerance: 2000 }, // 1:31 PM - test
  { exact: new Date('2026-01-23T21:35:11Z'), tolerance: 2000 }, // 1:35 PM - test
];

/**
 * Check if a timestamp should be excluded (blacklisted test bag)
 */
function isBlacklistedBag(timestamp) {
  for (const entry of BLACKLISTED_BAGS) {
    if (entry.start && entry.end) {
      // Range check
      if (timestamp >= entry.start && timestamp <= entry.end) return true;
    } else if (entry.exact) {
      // Exact match with tolerance
      if (Math.abs(timestamp.getTime() - entry.exact.getTime()) < entry.tolerance) return true;
    }
  }
  return false;
}

/**
 * Get bag timer data from D1 (inventory_adjustments table)
 * The webhook writes to D1, so we read directly from there for speed and reliability
 */
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
    // Get scoreboard data for trimmers and target rate (use D1 or Sheets based on flag)
    const scoreboardData = USE_D1_PRODUCTION
      ? await getScoreboardDataFromD1(env)
      : await getScoreboardData(env);
    result.currentTrimmers = scoreboardData.currentHourTrimmers || scoreboardData.lastHourTrimmers || 0;
    result.targetRate = scoreboardData.targetRate || 1.0;

    // Calculate target seconds based on team rate
    const bagWeightLbs = 11.0231;
    const teamRateLbsPerHour = result.currentTrimmers * result.targetRate;
    if (teamRateLbsPerHour > 0) {
      result.targetSeconds = Math.round((bagWeightLbs / teamRateLbsPerHour) * 3600);
    }

    const today = formatDatePT(new Date(), 'yyyy-MM-dd');
    const now = new Date();

    // Query D1 for today's 5kg bag adjustments
    // Check both size field and SKU pattern (size is often empty, so we infer from SKU)
    const rows = await env.DB.prepare(`
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
    `).bind(today).all();

    if (!rows.results || rows.results.length === 0) {
      return result;
    }

    const todayBags = [];
    let lastBag = null;

    for (const row of rows.results) {
      const rowDate = new Date(row.timestamp);
      if (isNaN(rowDate.getTime())) continue;

      // Skip blacklisted bags (test scans, accidental scans)
      if (isBlacklistedBag(rowDate)) continue;

      todayBags.push(rowDate);

      if (!lastBag || rowDate > lastBag) {
        lastBag = rowDate;
      }
    }

    result.bagsToday = todayBags.length;
    result.bags5kgToday = todayBags.length;

    if (lastBag) {
      result.lastBagTime = lastBag.toISOString();
      result.secondsSinceLastBag = Math.floor((now - lastBag) / 1000);
    }

    // Calculate average cycle time
    if (todayBags.length > 1) {
      todayBags.sort((a, b) => a - b);
      const cycleTimes = [];
      for (let i = 1; i < todayBags.length; i++) {
        const rawDiffSec = Math.floor((todayBags[i] - todayBags[i - 1]) / 1000);
        // Subtract any break time that falls within this cycle
        const breakMinutes = getBreakMinutesInWindow(todayBags[i - 1], todayBags[i]);
        const diffSec = rawDiffSec - (breakMinutes * 60);
        // Valid cycle: 5 min to 4 hours
        if (diffSec >= 300 && diffSec <= 14400) {
          cycleTimes.push(diffSec);
        }
      }
      if (cycleTimes.length > 0) {
        result.avgSecondsToday = Math.round(cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length);
      }
    }

    // Build cycle history (most recent first, up to 20 cycles)
    if (todayBags.length > 1) {
      todayBags.sort((a, b) => b - a); // Sort descending (newest first)
      for (let i = 0; i < Math.min(todayBags.length - 1, 20); i++) {
        const rawCycleSec = Math.floor((todayBags[i] - todayBags[i + 1]) / 1000);
        // Subtract any break time that falls within this cycle
        const breakMinutes = getBreakMinutesInWindow(todayBags[i + 1], todayBags[i]);
        const cycleSec = rawCycleSec - (breakMinutes * 60);
        // Valid cycle: 5 min to 4 hours
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
    console.error('Error getting bag timer data from D1:', error.message);
  }

  return result;
}

// ===== EXTENDED DAILY DATA =====

async function getExtendedDailyData(days, env) {
  const sheetId = env.PRODUCTION_SHEET_ID;
  const sheetNames = await getSheetNames(sheetId, env);
  const monthSheets = sheetNames
    .filter((name) => /^\d{4}-\d{2}$/.test(name))
    .sort((a, b) => b.localeCompare(a));

  if (monthSheets.length === 0) return [];

  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - days);

  const dailyMap = {};

  for (const sheetName of monthSheets.slice(0, 2)) {
    const vals = await readSheet(sheetId, `'${sheetName}'!A:Z`, env);
    let currentDate = null;
    let cols = null;
    let dayData = { totalTops: 0, totalSmalls: 0, totalTrimmerHours: 0, bestHour: null };

    for (let i = 0; i < vals.length; i++) {
      const row = vals[i];
      if (row[0] === 'Date:') {
        if (currentDate && dayData.totalTops > 0 && currentDate >= cutoff) {
          const dateKey = formatDatePT(currentDate, 'yyyy-MM-dd');
          if (!dailyMap[dateKey]) {
            dailyMap[dateKey] = {
              date: currentDate,
              totalTops: dayData.totalTops,
              totalSmalls: dayData.totalSmalls,
              avgRate: dayData.totalTrimmerHours > 0 ? dayData.totalTops / dayData.totalTrimmerHours : 0,
              totalLbs: dayData.totalTops + dayData.totalSmalls,
              trimmerHours: dayData.totalTrimmerHours,
              bestHour: dayData.bestHour,
            };
          }
        }

        const dateStr = row[1];
        if (dateStr) {
          const d = new Date(dateStr);
          if (!isNaN(d.getTime())) {
            currentDate = d;
            dayData = { totalTops: 0, totalSmalls: 0, totalTrimmerHours: 0, bestHour: null };
          }
        }

        const headerRow = vals[i + 1] || [];
        cols = getColumnIndices(headerRow);
        continue;
      }

      if (!currentDate || !cols || currentDate < cutoff) continue;
      if (isEndOfBlock(row)) continue;

      const timeSlot = (row[0] || '').toString().trim();
      const tops1 = parseFloat(row[cols.tops1]) || 0;
      const smalls1 = parseFloat(row[cols.smalls1]) || 0;
      const tr1 = parseFloat(row[cols.trimmers1]) || 0;

      if (tops1 > 0 || smalls1 > 0 || tr1 > 0) {
        dayData.totalTops += tops1;
        dayData.totalSmalls += smalls1;
        dayData.totalTrimmerHours += tr1;

        // Track best hour (highest lbs/trimmer rate)
        if (tr1 > 0) {
          const hourRate = tops1 / tr1;
          if (!dayData.bestHour || hourRate > dayData.bestHour.rate) {
            dayData.bestHour = {
              time: timeSlot.split('–')[0].trim(), // e.g., "10:00 AM"
              lbs: Math.round(tops1 * 10) / 10,
              rate: Math.round(hourRate * 100) / 100,
            };
          }
        }
      }
    }

    if (currentDate && dayData.totalTops > 0 && currentDate >= cutoff) {
      const dateKey = formatDatePT(currentDate, 'yyyy-MM-dd');
      if (!dailyMap[dateKey]) {
        dailyMap[dateKey] = {
          date: currentDate,
          totalTops: dayData.totalTops,
          totalSmalls: dayData.totalSmalls,
          avgRate: dayData.totalTrimmerHours > 0 ? dayData.totalTops / dayData.totalTrimmerHours : 0,
          totalLbs: dayData.totalTops + dayData.totalSmalls,
          trimmerHours: dayData.totalTrimmerHours,
          bestHour: dayData.bestHour,
        };
      }
    }
  }

  return Object.values(dailyMap).sort((a, b) => a.date - b.date);
}

/**
 * Get extended daily production data from D1
 * @param {number} days - Number of days to retrieve
 * @param {object} env - Environment with DB binding
 * @returns {Array} Daily production data
 */
async function getExtendedDailyDataFromD1(days, env) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffStr = formatDatePT(cutoffDate, 'yyyy-MM-dd');

    // Query all hourly slots for the last N days
    const rows = await env.DB.prepare(`
      SELECT
        production_date,
        time_slot,
        trimmers_line1,
        trimmers_line2,
        tops_lbs1,
        smalls_lbs1,
        tops_lbs2,
        smalls_lbs2
      FROM monthly_production
      WHERE production_date >= ?
      ORDER BY production_date, time_slot
    `).bind(cutoffStr).all();

    if (!rows.results || rows.results.length === 0) {
      return [];
    }

    // Aggregate by day
    const dailyMap = {};

    for (const row of rows.results) {
      const dateKey = row.production_date;

      if (!dailyMap[dateKey]) {
        dailyMap[dateKey] = {
          date: new Date(dateKey + 'T12:00:00'),
          totalTops: 0,
          totalSmalls: 0,
          totalTrimmerHours: 0,
          bestHour: null,
        };
      }

      const dayData = dailyMap[dateKey];
      const tops = (row.tops_lbs1 || 0) + (row.tops_lbs2 || 0);
      const smalls = (row.smalls_lbs1 || 0) + (row.smalls_lbs2 || 0);
      const trimmers = (row.trimmers_line1 || 0) + (row.trimmers_line2 || 0);

      dayData.totalTops += tops;
      dayData.totalSmalls += smalls;
      dayData.totalTrimmerHours += trimmers;

      // Track best hour (highest lbs/trimmer rate)
      if (trimmers > 0 && tops > 0) {
        const hourRate = tops / trimmers;
        if (!dayData.bestHour || hourRate > dayData.bestHour.rate) {
          dayData.bestHour = {
            time: row.time_slot.split('–')[0].trim() || row.time_slot.split('-')[0].trim(),
            lbs: Math.round(tops * 10) / 10,
            rate: Math.round(hourRate * 100) / 100,
          };
        }
      }
    }

    // Calculate final metrics and return sorted array
    return Object.values(dailyMap)
      .map(day => ({
        date: day.date,
        totalTops: day.totalTops,
        totalSmalls: day.totalSmalls,
        avgRate: day.totalTrimmerHours > 0 ? day.totalTops / day.totalTrimmerHours : 0,
        totalLbs: day.totalTops + day.totalSmalls,
        trimmerHours: day.totalTrimmerHours,
        bestHour: day.bestHour,
      }))
      .sort((a, b) => a.date - b.date);
  } catch (error) {
    console.error('Error getting extended daily data from D1:', error);
    return [];
  }
}

// ===== API HANDLERS =====

async function test(env) {
  return successResponse({
    ok: true,
    message: 'Production API is working (Cloudflare Workers)',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Debug endpoint to check D1 inventory_adjustments data
 */
async function debugBags(env) {
  try {
    const allBags = await env.DB.prepare(`
      SELECT timestamp, size, sku, product_name
      FROM inventory_adjustments
      ORDER BY timestamp DESC
      LIMIT 20
    `).all();

    const today = formatDatePT(new Date(), 'yyyy-MM-dd');
    const todayBagsUTC = await env.DB.prepare(`
      SELECT timestamp, size, sku
      FROM inventory_adjustments
      WHERE date(timestamp) = ?
    `).bind(today).all();

    // Also try with Pacific time conversion
    const todayBagsPT = await env.DB.prepare(`
      SELECT timestamp, size, sku
      FROM inventory_adjustments
      WHERE date(datetime(timestamp, '-8 hours')) = ?
    `).bind(today).all();

    return successResponse({
      totalBags: allBags.results.length,
      todayPacific: today,
      recentBags: allBags.results,
      todayBagsUTC: todayBagsUTC.results.length,
      todayBagsPT: todayBagsPT.results.length,
      utcResults: todayBagsUTC.results,
      ptResults: todayBagsPT.results,
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
  // Check cache first to reduce API calls
  const now = Date.now();
  if (scoreboardCache.data && (now - scoreboardCache.timestamp) < scoreboardCache.TTL) {
    return successResponse(scoreboardCache.data);
  }

  // Fetch fresh data - use D1 or Sheets based on feature flag
  const scoreboardData = USE_D1_PRODUCTION
    ? await getScoreboardDataFromD1(env)
    : await getScoreboardData(env);
  const timerData = await getBagTimerData(env);
  const pauseState = await getActivePause(env);

  const responseData = {
    scoreboard: scoreboardData,
    timer: timerData,
    pause: pauseState,
    source: USE_D1_PRODUCTION ? 'D1' : 'Sheets',
  };

  // Update cache (includes pause state - refreshed when data version changes)
  scoreboardCache.data = responseData;
  scoreboardCache.timestamp = now;

  return successResponse(responseData);
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
  const scoreboardData = USE_D1_PRODUCTION
    ? await getScoreboardDataFromD1(env)
    : await getScoreboardData(env);
  const timerData = await getBagTimerData(env);
  const dailyData = USE_D1_PRODUCTION
    ? await getExtendedDailyDataFromD1(30, env)
    : await getExtendedDailyData(30, env);

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

  // Find today's data from dailyData for smalls
  const todayDateStr = formatDatePT(new Date(), 'yyyy-MM-dd');
  const todayDailyData = dailyData.find(d => formatDatePT(d.date, 'yyyy-MM-dd') === todayDateStr);

  // Calculate weighted average rate (each hourly rate weighted by trimmer count)
  const hourlyRates = scoreboardData.hourlyRates || [];
  let weightedRateSum = 0;
  let totalTrimmerHours = 0;

  for (const hour of hourlyRates) {
    if (hour.trimmers && hour.rate != null) {
      weightedRateSum += hour.rate * hour.trimmers;
      totalTrimmerHours += hour.trimmers;
    }
  }

  const avgRate = totalTrimmerHours > 0 ? weightedRateSum / totalTrimmerHours : 0;

  const todayData = {
    totalTops: scoreboardData.todayLbs || 0,
    totalSmalls: todayDailyData?.totalSmalls || 0,
    totalLbs: (scoreboardData.todayLbs || 0) + (todayDailyData?.totalSmalls || 0),
    // Weighted average: each hourly rate weighted by trimmer count
    avgRate: Math.round(avgRate * 100) / 100,
    trimmers: scoreboardData.lastHourTrimmers || scoreboardData.currentHourTrimmers || 0,
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
      avgRate: Math.round(d.avgRate * 100) / 100,
    })),
    fallback: showingFallback ? {
      active: true,
      date: fallbackDate,
      requestedRange: { start, end },
    } : null,
  });
}

async function setShiftStart(params, env) {
  const sheetId = env.PRODUCTION_SHEET_ID;
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
  const setAtStr = formatDatePT(today, 'HH:mm:ss');

  await appendSheet(sheetId, `'${SHEETS.shiftAdjustments}'!A:F`, [
    [dateStr, shiftStartStr, setAtStr, availableHours.toFixed(2), scaleFactor.toFixed(3), ''],
  ], env);

  // Increment version to notify clients of new data
  await incrementDataVersion(env);

  return successResponse({
    success: true,
    shiftAdjustment: {
      manualStartTime: timestamp.toISOString(),
      availableHours,
      scaleFactor,
      adjustedDailyGoal: adjustedGoal,
    },
  });
}

async function getShiftStart(params, env) {
  const sheetId = env.PRODUCTION_SHEET_ID;
  const date = params.date || formatDatePT(new Date(), 'yyyy-MM-dd');

  try {
    const vals = await readSheet(sheetId, `'${SHEETS.shiftAdjustments}'!A:F`, env);
    if (!vals || vals.length <= 1) {
      return successResponse({ shiftAdjustment: null });
    }

    for (let i = vals.length - 1; i >= 1; i--) {
      // Use string directly - don't convert to Date (causes timezone shift)
      const cellDate = String(vals[i][0]).trim();
      if (cellDate === date) {
        // Ensure time has leading zeros (e.g., "8:15:00" -> "08:15:00")
        const timeStr = String(vals[i][1]).trim();
        const timeParts = timeStr.split(':');
        const paddedTime = timeParts.map(p => p.padStart(2, '0')).join(':');
        return successResponse({
          success: true,
          shiftAdjustment: {
            manualStartTime: `${date}T${paddedTime}`,
            availableHours: parseFloat(vals[i][3]) || 0,
            scaleFactor: parseFloat(vals[i][4]) || 1,
          },
        });
      }
    }

    return successResponse({ shiftAdjustment: null });
  } catch {
    return successResponse({ shiftAdjustment: null });
  }
}

async function morningReport(env) {
  const now = new Date();
  const dailyData = await getExtendedDailyData(14, env);
  dailyData.sort((a, b) => b.date - a.date);

  const today = formatDatePT(now, 'yyyy-MM-dd');

  // Filter out today and weekends (only Mon-Fri work days)
  const filteredDays = dailyData.filter((d) => {
    const dateStr = formatDatePT(d.date, 'yyyy-MM-dd');
    if (dateStr === today) return false;
    return isWeekday(new Date(d.date));
  });

  const yesterday = filteredDays[0] || null;
  const dayBefore = filteredDays[1] || null;

  // Get bag data for yesterday and day before
  const bagData = await getBagDataForDays(env, 2);

  // Calculate weekly data
  const thisWeekData = getWeekData(filteredDays, 0); // Current week (Mon-Sun containing yesterday)
  const lastWeekData = getWeekData(filteredDays, 1); // Previous week

  // Get current order from orders API
  const currentOrder = await getCurrentOrderProgress(env);

  // Format yesterday's data
  const yesterdayFormatted = yesterday ? {
    date: formatDatePT(yesterday.date, 'yyyy-MM-dd'),
    dateDisplay: formatDatePT(yesterday.date, 'EEEE, MMM d'),
    tops: Math.round(yesterday.totalTops * 10) / 10,
    smalls: Math.round(yesterday.totalSmalls * 10) / 10,
    rate: Math.round(yesterday.avgRate * 100) / 100,
    crew: yesterday.trimmerHours > 0 ? Math.round(yesterday.trimmerHours / 7.5) : 0, // Estimate crew from hours
    bags: bagData.yesterday?.bags || 0,
    avgCycleTime: bagData.yesterday?.avgCycleTime || null,
    bestHour: yesterday.bestHour || null,
  } : null;

  // Format day before's data
  const dayBeforeFormatted = dayBefore ? {
    date: formatDatePT(dayBefore.date, 'yyyy-MM-dd'),
    dateDisplay: formatDatePT(dayBefore.date, 'EEEE, MMM d'),
    tops: Math.round(dayBefore.totalTops * 10) / 10,
    smalls: Math.round(dayBefore.totalSmalls * 10) / 10,
    rate: Math.round(dayBefore.avgRate * 100) / 100,
    crew: dayBefore.trimmerHours > 0 ? Math.round(dayBefore.trimmerHours / 7.5) : 0,
    bags: bagData.dayBefore?.bags || 0,
    avgCycleTime: bagData.dayBefore?.avgCycleTime || null,
  } : null;

  return successResponse({
    generatedAt: now.toISOString(),
    yesterday: yesterdayFormatted,
    dayBefore: dayBeforeFormatted,
    thisWeek: thisWeekData,
    lastWeek: lastWeekData,
    currentOrder: currentOrder,
  });
}

/**
 * Get bag counts and cycle times for recent weekdays from D1
 */
async function getBagDataForDays(env, numDays) {
  const result = { yesterday: null, dayBefore: null };

  try {
    // Find the last two weekdays (skip weekends)
    const now = new Date();
    const lastWeekday = new Date(now);
    lastWeekday.setDate(lastWeekday.getDate() - 1);

    // Find last weekday (yesterday, but skip to Friday if yesterday was a weekend)
    while (!isWeekday(lastWeekday)) {
      lastWeekday.setDate(lastWeekday.getDate() - 1);
    }

    // Find day before last weekday
    const dayBeforeLastWeekday = new Date(lastWeekday);
    dayBeforeLastWeekday.setDate(dayBeforeLastWeekday.getDate() - 1);
    while (!isWeekday(dayBeforeLastWeekday)) {
      dayBeforeLastWeekday.setDate(dayBeforeLastWeekday.getDate() - 1);
    }

    const yesterdayStr = formatDatePT(lastWeekday, 'yyyy-MM-dd');
    const dayBeforeStr = formatDatePT(dayBeforeLastWeekday, 'yyyy-MM-dd');

    // Query D1 for 5kg bags from both days
    const rows = await env.DB.prepare(`
      SELECT timestamp, size
      FROM inventory_adjustments
      WHERE date(timestamp) IN (?, ?)
        AND (lower(size) LIKE '%5kg%' OR lower(size) LIKE '%5 kg%')
      ORDER BY timestamp ASC
    `).bind(yesterdayStr, dayBeforeStr).all();

    const yesterdayBags = [];
    const dayBeforeBags = [];

    for (const row of (rows.results || [])) {
      const timestamp = new Date(row.timestamp);
      if (isNaN(timestamp.getTime())) continue;

      // Skip blacklisted bags
      if (isBlacklistedBag(timestamp)) continue;

      const dateStr = formatDatePT(timestamp, 'yyyy-MM-dd');
      if (dateStr === yesterdayStr) {
        yesterdayBags.push(timestamp);
      } else if (dateStr === dayBeforeStr) {
        dayBeforeBags.push(timestamp);
      }
    }

    // Calculate cycle times for yesterday
    if (yesterdayBags.length > 0) {
      yesterdayBags.sort((a, b) => a - b);
      const cycleTimes = [];
      for (let i = 1; i < yesterdayBags.length; i++) {
        const rawDiff = (yesterdayBags[i] - yesterdayBags[i - 1]) / 60000; // minutes
        const breakMinutes = getBreakMinutesInWindow(yesterdayBags[i - 1], yesterdayBags[i]);
        const diff = rawDiff - breakMinutes;
        if (diff >= 5 && diff <= 240) cycleTimes.push(diff);
      }
      result.yesterday = {
        bags: yesterdayBags.length,
        avgCycleTime: cycleTimes.length > 0 ? Math.round(cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length) : null,
      };
    }

    // Calculate cycle times for day before
    if (dayBeforeBags.length > 0) {
      dayBeforeBags.sort((a, b) => a - b);
      const cycleTimes = [];
      for (let i = 1; i < dayBeforeBags.length; i++) {
        const rawDiff = (dayBeforeBags[i] - dayBeforeBags[i - 1]) / 60000;
        const breakMinutes = getBreakMinutesInWindow(dayBeforeBags[i - 1], dayBeforeBags[i]);
        const diff = rawDiff - breakMinutes;
        if (diff >= 5 && diff <= 240) cycleTimes.push(diff);
      }
      result.dayBefore = {
        bags: dayBeforeBags.length,
        avgCycleTime: cycleTimes.length > 0 ? Math.round(cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length) : null,
      };
    }
  } catch (error) {
    console.error('Error getting bag data from D1:', error);
  }

  return result;
}

/**
 * Check if a date is a weekday (Mon-Fri) in Pacific Time
 * @param {Date} date - Date to check
 * @returns {boolean} True if weekday
 */
function isWeekday(date) {
  // Get day of week in Pacific timezone
  const pstDayName = date.toLocaleDateString('en-US', {
    timeZone: TIMEZONE,
    weekday: 'short',
  });
  // Mon, Tue, Wed, Thu, Fri are weekdays
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(pstDayName);
}

/**
 * Get weekly aggregated data (Mon-Fri only)
 * @param {Array} dailyData - Array of daily data objects sorted by date desc
 * @param {number} weeksAgo - 0 for current week, 1 for last week
 */
function getWeekData(dailyData, weeksAgo) {
  if (!dailyData || dailyData.length === 0) return null;

  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, etc.
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  // Get Monday of target week
  const targetMonday = new Date(now);
  targetMonday.setDate(targetMonday.getDate() + mondayOffset - (weeksAgo * 7));
  targetMonday.setHours(0, 0, 0, 0);

  // Use Friday as the end of work week instead of Sunday
  const targetFriday = new Date(targetMonday);
  targetFriday.setDate(targetFriday.getDate() + 4); // Mon + 4 = Fri
  targetFriday.setHours(23, 59, 59, 999);

  // Filter to only Mon-Fri days
  const weekDays = dailyData.filter((d) => {
    const date = new Date(d.date);
    return date >= targetMonday && date <= targetFriday && isWeekday(date);
  });

  if (weekDays.length === 0) return null;

  const totalTops = weekDays.reduce((sum, d) => sum + (d.totalTops || 0), 0);
  const totalSmalls = weekDays.reduce((sum, d) => sum + (d.totalSmalls || 0), 0);
  const totalTrimmerHours = weekDays.reduce((sum, d) => sum + (d.trimmerHours || 0), 0);
  const avgRate = totalTrimmerHours > 0 ? totalTops / totalTrimmerHours : 0;
  const avgCrew = weekDays.length > 0 ? totalTrimmerHours / weekDays.length / 7.5 : 0;

  const dayNames = weekDays.map((d) => formatDatePT(d.date, 'EEE'));

  return {
    tops: Math.round(totalTops * 10) / 10,
    smalls: Math.round(totalSmalls * 10) / 10,
    avgRate: Math.round(avgRate * 100) / 100,
    avgCrew: Math.round(avgCrew),
    days: dayNames,
    daysCount: weekDays.length,
  };
}

/**
 * Get current order progress from orders API
 */
async function getCurrentOrderProgress(env) {
  try {
    // Try to get order queue data
    const ordersSheetId = env.ORDERS_SHEET_ID;
    if (!ordersSheetId) return null;

    const vals = await readSheet(ordersSheetId, "'Orders'!A:M", env);
    if (!vals || vals.length <= 1) return null;

    // Find first in-progress order
    const headers = vals[0];
    const statusCol = headers.indexOf('Status');
    const idCol = headers.indexOf('Order ID');
    const customerCol = headers.indexOf('Customer');

    for (let i = 1; i < vals.length; i++) {
      const row = vals[i];
      const status = String(row[statusCol] || '').toLowerCase();
      if (status === 'in progress' || status === 'active') {
        return {
          id: row[idCol] || 'Unknown',
          customer: row[customerCol] || 'Unknown',
          strain: 'Current Strain',
          targetKg: 100,
          completedKg: 0,
          estimatedDaysRemaining: 0,
        };
      }
    }
  } catch (error) {
    console.error('Error getting current order:', error);
  }

  return null;
}

// POST handlers

async function logBag(body, env) {
  const sheetId = env.PRODUCTION_SHEET_ID;
  const size = body.size || '5 kg.';
  const now = new Date();

  const headerRow = await readSheet(sheetId, `'${SHEETS.tracking}'!1:1`, env);
  if (!headerRow || !headerRow[0]) {
    return errorResponse('Tracking sheet not found', 'INTERNAL_ERROR', 500);
  }

  const headers = headerRow[0];
  const timestampCol = headers.indexOf('Timestamp');
  const sizeCol = headers.indexOf('Size');

  if (timestampCol === -1 || sizeCol === -1) {
    return errorResponse('Required columns not found', 'INTERNAL_ERROR', 500);
  }

  const newRow = new Array(headers.length).fill('');
  newRow[timestampCol] = now.toISOString();
  newRow[sizeCol] = size;

  await appendSheet(sheetId, `'${SHEETS.tracking}'!A:Z`, [newRow], env);

  // Increment version to notify clients of new data
  await incrementDataVersion(env);

  return successResponse({ timestamp: now.toISOString(), size });
}

async function logPause(body, env) {
  const sheetId = env.PRODUCTION_SHEET_ID;
  const reason = sanitizeForSheets(body.reason || 'No reason provided');
  const now = new Date();
  const pauseId = now.getTime().toString();

  const dateStr = formatDatePT(now, 'yyyy-MM-dd');
  const timeStr = formatDatePT(now, 'HH:mm:ss');

  await appendSheet(sheetId, `'${SHEETS.pauseLog}'!A:G`, [
    [pauseId, dateStr, timeStr, '', '', reason, 'Scoreboard'],
  ], env);

  // Increment version to notify clients of new data
  await incrementDataVersion(env);

  return successResponse({ pauseId, timestamp: now.toISOString(), reason });
}

async function logResume(body, env) {
  const sheetId = env.PRODUCTION_SHEET_ID;
  const pauseId = body.pauseId;
  const actualDurationSeconds = body.duration || 0;

  if (!pauseId) {
    return errorResponse('Missing pauseId', 'VALIDATION_ERROR', 400);
  }

  const now = new Date();
  const timeStr = formatDatePT(now, 'HH:mm:ss');
  const durationMin = Math.round(actualDurationSeconds / 60 * 10) / 10;

  const vals = await readSheet(sheetId, `'${SHEETS.pauseLog}'!A:G`, env);
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0]) === pauseId) {
      await writeSheet(sheetId, `'${SHEETS.pauseLog}'!D${i + 1}:E${i + 1}`, [[timeStr, durationMin]], env);
      // Increment version to notify clients of new data
      await incrementDataVersion(env);
      return successResponse({ pauseId, resumeTime: now.toISOString(), durationMinutes: durationMin });
    }
  }

  return errorResponse(`Pause record not found: ${pauseId}`, 'NOT_FOUND', 404);
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

// ===== LIVE SCALE WEIGHT =====

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

/**
 * Shopify Inventory Webhook Handler (Dual-Write)
 * Receives inventory adjustment webhooks from Shopify Flow
 * Writes to both D1 and Google Sheets for backwards compatibility
 * Supports both flat format and nested Shopify Flow format
 */
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

// ===== HOURLY ENTRY ENDPOINTS =====

/**
 * Get list of cultivars from Data sheet
 */
async function getCultivars(env) {
  const sheetId = env.PRODUCTION_SHEET_ID;

  try {
    const vals = await readSheet(sheetId, `'${SHEETS.data}'!A:A`, env);
    if (!vals || vals.length === 0) {
      return successResponse({ cultivars: [] });
    }

    // Extract non-empty cultivar names, skip header if present
    const cultivars = [];
    for (let i = 0; i < vals.length; i++) {
      const name = (vals[i][0] || '').toString().trim();
      if (name && name.toLowerCase() !== 'cultivar' && name.toLowerCase() !== 'cultivars') {
        cultivars.push(name);
      }
    }

    return successResponse({ cultivars });
  } catch (error) {
    console.error('Error getting cultivars:', error);
    return successResponse({ cultivars: [] });
  }
}

/**
 * Get hourly production data for a specific date
 */
/**
 * Get production data from D1 for a specific date
 */
async function getProductionFromD1(date, env) {
  try {
    // Get historical target rate from D1
    const targetRate = await getHistoricalTargetRateFromD1(env, 7) || 0.9;

    // Query D1 for all time slots for this date
    const rows = await env.DB.prepare(`
      SELECT time_slot,
             buckers_line1, trimmers_line1, tzero_line1,
             buckers_line2, trimmers_line2, tzero_line2,
             cultivar1, cultivar2,
             tops_lbs1, smalls_lbs1, tops_lbs2, smalls_lbs2,
             qc, notes
      FROM monthly_production
      WHERE production_date = ?
      ORDER BY time_slot
    `).bind(date).all();

    const slots = {};
    if (rows.results) {
      for (const row of rows.results) {
        slots[row.time_slot] = {
          buckers1: row.buckers_line1 || 0,
          trimmers1: row.trimmers_line1 || 0,
          tzero1: row.tzero_line1 || 0,
          cultivar1: row.cultivar1 || '',
          tops1: row.tops_lbs1 || 0,
          smalls1: row.smalls_lbs1 || 0,
          buckers2: row.buckers_line2 || 0,
          trimmers2: row.trimmers_line2 || 0,
          tzero2: row.tzero_line2 || 0,
          cultivar2: row.cultivar2 || '',
          tops2: row.tops_lbs2 || 0,
          smalls2: row.smalls_lbs2 || 0,
          qcperson: row.qc || 0,
          qcNotes: row.notes || '',
        };
      }
    }

    return { date, slots, targetRate, source: 'D1' };
  } catch (error) {
    console.error('Error getting production from D1:', error);
    throw error;
  }
}

/**
 * Get production data from Google Sheets for a specific date (legacy)
 */
async function getProductionFromSheets(date, env) {
  const sheetId = env.PRODUCTION_SHEET_ID;

  // Determine which month sheet to use
  const sheetMonth = date.substring(0, 7); // YYYY-MM
  const sheetNames = await getSheetNames(sheetId, env);

  // Check if the month sheet exists
  const monthSheetExists = sheetNames.includes(sheetMonth);
  if (!monthSheetExists) {
    return { date, slots: {}, targetRate: 0.9 };
  }

  // Read the sheet data
  const vals = await readSheet(sheetId, `'${sheetMonth}'!A:Z`, env);
  if (!vals || vals.length === 0) {
    return { date, slots: {}, targetRate: 0.9 };
  }

  // Parse date to match sheet format (MMMM dd, yyyy)
  const dateObj = new Date(date + 'T12:00:00');
  const dateLabel = dateObj.toLocaleDateString('en-US', {
    timeZone: TIMEZONE,
    month: 'long',
    day: '2-digit',
    year: 'numeric',
  });

  // Find the date row
  const dateRowIndex = findDateRow(vals, dateLabel);
  if (dateRowIndex === -1) {
    return { date, slots: {}, targetRate: 0.9 };
  }

  // Get column indices from header row
  const headerRowIndex = dateRowIndex + 1;
  const headers = vals[headerRowIndex] || [];
  const cols = getColumnIndices(headers);

  // Get historical rate for target
  const dailyData = await getExtendedDailyData(7, env);
  const targetRate = dailyData.length > 0
    ? dailyData.reduce((sum, d) => sum + (d.avgRate || 0), 0) / dailyData.length
    : 0.9;

  // Collect slot data
  const slots = {};
  for (let r = headerRowIndex + 1; r < vals.length; r++) {
    const row = vals[r];
    if (isEndOfBlock(row)) break;

    const timeSlot = (row[0] || '').toString().trim();
    if (!timeSlot) continue;

    slots[timeSlot] = {
      buckers1: parseFloat(row[cols.buckers1]) || 0,
      trimmers1: parseFloat(row[cols.trimmers1]) || 0,
      tzero1: parseFloat(row[cols.tzero1]) || 0,
      cultivar1: row[cols.cultivar1] || '',
      tops1: parseFloat(row[cols.tops1]) || 0,
      smalls1: parseFloat(row[cols.smalls1]) || 0,
      buckers2: parseFloat(row[cols.buckers2]) || 0,
      trimmers2: parseFloat(row[cols.trimmers2]) || 0,
      tzero2: parseFloat(row[cols.tzero2]) || 0,
      cultivar2: row[cols.cultivar2] || '',
      tops2: parseFloat(row[cols.tops2]) || 0,
      smalls2: parseFloat(row[cols.smalls2]) || 0,
      qcperson: parseFloat(row[cols.qcperson]) || 0,
      qcNotes: row[cols.qcNotes] || '',
    };
  }

  return { date, slots, targetRate };
}

async function getProduction(params, env) {
  const date = params.date || formatDatePT(new Date(), 'yyyy-MM-dd');

  if (!validateDate(date)) {
    return errorResponse('Invalid date format', 'VALIDATION_ERROR', 400);
  }

  try {
    // Use D1 or Sheets based on feature flag
    const result = USE_D1_PRODUCTION
      ? await getProductionFromD1(date, env)
      : await getProductionFromSheets(date, env);

    return successResponse(result);
  } catch (error) {
    console.error('Error getting production:', error);
    return errorResponse('Failed to get production data', 'INTERNAL_ERROR', 500);
  }
}

/**
 * Add/update hourly production data to D1 (primary)
 * Uses UPSERT pattern - inserts or updates based on date + time_slot unique constraint
 */
async function addProductionToD1(date, timeSlot, data, env) {
  try {
    await env.DB.prepare(`
      INSERT INTO monthly_production (
        production_date, time_slot,
        buckers_line1, trimmers_line1, tzero_line1,
        buckers_line2, trimmers_line2, tzero_line2,
        cultivar1, cultivar2,
        tops_lbs1, smalls_lbs1, tops_lbs2, smalls_lbs2,
        qc, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(production_date, time_slot) DO UPDATE SET
        buckers_line1 = excluded.buckers_line1,
        trimmers_line1 = excluded.trimmers_line1,
        tzero_line1 = excluded.tzero_line1,
        buckers_line2 = excluded.buckers_line2,
        trimmers_line2 = excluded.trimmers_line2,
        tzero_line2 = excluded.tzero_line2,
        cultivar1 = excluded.cultivar1,
        cultivar2 = excluded.cultivar2,
        tops_lbs1 = excluded.tops_lbs1,
        smalls_lbs1 = excluded.smalls_lbs1,
        tops_lbs2 = excluded.tops_lbs2,
        smalls_lbs2 = excluded.smalls_lbs2,
        qc = excluded.qc,
        notes = excluded.notes
    `).bind(
      date, timeSlot,
      data.buckers1, data.trimmers1, data.tzero1,
      data.buckers2, data.trimmers2, data.tzero2,
      data.cultivar1, data.cultivar2,
      data.tops1, data.smalls1, data.tops2, data.smalls2,
      data.qcperson, data.qcNotes
    ).run();
    return { success: true };
  } catch (error) {
    console.error('Error writing to D1:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Add/update hourly production data to Google Sheets (backup)
 */
async function addProductionToSheets(date, timeSlot, data, env) {
  const sheetId = env.PRODUCTION_SHEET_ID;

  try {
    // Determine which month sheet to use
    const sheetMonth = date.substring(0, 7); // YYYY-MM
    const sheetNames = await getSheetNames(sheetId, env);

    if (!sheetNames.includes(sheetMonth)) {
      console.warn(`Sheet for ${sheetMonth} does not exist - skipping Sheets backup`);
      return { success: false, error: 'Sheet not found' };
    }

    // Read the sheet data
    const vals = await readSheet(sheetId, `'${sheetMonth}'!A:Z`, env);
    if (!vals || vals.length === 0) {
      return { success: false, error: 'Sheet is empty' };
    }

    // Parse date to match sheet format
    const dateObj = new Date(date + 'T12:00:00');
    const dateLabel = dateObj.toLocaleDateString('en-US', {
      timeZone: TIMEZONE,
      month: 'long',
      day: '2-digit',
      year: 'numeric',
    });

    // Find the date row
    const dateRowIndex = findDateRow(vals, dateLabel);
    if (dateRowIndex === -1) {
      return { success: false, error: `No data block found for ${dateLabel}` };
    }

    // Get header row and column indices
    const headerRowIndex = dateRowIndex + 1;
    const headers = vals[headerRowIndex] || [];
    const cols = getColumnIndices(headers);

    // Find the row with matching time slot
    let targetRowIndex = -1;
    for (let r = headerRowIndex + 1; r < vals.length; r++) {
      if (isEndOfBlock(vals[r])) break;

      const rowSlot = (vals[r][0] || '').toString().trim();
      // Normalize dashes for comparison
      const normalizedRowSlot = rowSlot.replace(/[-–—]/g, '–');
      const normalizedTimeSlot = timeSlot.replace(/[-–—]/g, '–');

      if (normalizedRowSlot === normalizedTimeSlot) {
        targetRowIndex = r;
        break;
      }
    }

    if (targetRowIndex === -1) {
      return { success: false, error: `Time slot ${timeSlot} not found` };
    }

    // Build updated row data
    const existingRow = vals[targetRowIndex];
    const newRow = [...existingRow];

    // Update Line 1 fields
    if (cols.buckers1 >= 0 && data.buckers1 !== undefined) newRow[cols.buckers1] = data.buckers1;
    if (cols.trimmers1 >= 0 && data.trimmers1 !== undefined) newRow[cols.trimmers1] = data.trimmers1;
    if (cols.tzero1 >= 0 && data.tzero1 !== undefined) newRow[cols.tzero1] = data.tzero1;
    if (cols.cultivar1 >= 0 && data.cultivar1 !== undefined) newRow[cols.cultivar1] = sanitizeForSheets(data.cultivar1);
    if (cols.tops1 >= 0 && data.tops1 !== undefined) newRow[cols.tops1] = data.tops1;
    if (cols.smalls1 >= 0 && data.smalls1 !== undefined) newRow[cols.smalls1] = data.smalls1;

    // Update Line 2 fields
    if (cols.buckers2 >= 0 && data.buckers2 !== undefined) newRow[cols.buckers2] = data.buckers2;
    if (cols.trimmers2 >= 0 && data.trimmers2 !== undefined) newRow[cols.trimmers2] = data.trimmers2;
    if (cols.tzero2 >= 0 && data.tzero2 !== undefined) newRow[cols.tzero2] = data.tzero2;
    if (cols.cultivar2 >= 0 && data.cultivar2 !== undefined) newRow[cols.cultivar2] = sanitizeForSheets(data.cultivar2);
    if (cols.tops2 >= 0 && data.tops2 !== undefined) newRow[cols.tops2] = data.tops2;
    if (cols.smalls2 >= 0 && data.smalls2 !== undefined) newRow[cols.smalls2] = data.smalls2;

    // Update shared QC fields
    if (cols.qcperson >= 0 && data.qcperson !== undefined) newRow[cols.qcperson] = data.qcperson;
    if (cols.qcNotes >= 0 && data.qcNotes !== undefined) newRow[cols.qcNotes] = sanitizeForSheets(data.qcNotes);

    // Write the updated row back to sheet (row index is 1-based in Sheets API)
    const range = `'${sheetMonth}'!A${targetRowIndex + 1}`;
    await writeSheet(sheetId, range, [newRow], env);

    return { success: true };
  } catch (error) {
    console.error('Error writing to Sheets:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Add/update hourly production data
 * Dual-write: D1 (primary) + Google Sheets (backup)
 * Accepts flat fields: date, timeSlot, buckers1, trimmers1, etc.
 */
async function addProduction(body, env) {
  const { date, timeSlot, buckers1, trimmers1, tzero1, cultivar1, tops1, smalls1,
          buckers2, trimmers2, tzero2, cultivar2, tops2, smalls2, qcperson, qcNotes } = body;

  if (!date || !timeSlot) {
    return errorResponse('Missing required fields: date, timeSlot', 'VALIDATION_ERROR', 400);
  }

  if (!validateDate(date)) {
    return errorResponse('Invalid date format', 'VALIDATION_ERROR', 400);
  }

  // Build data object from flat fields
  const data = {
    buckers1: buckers1 ?? 0,
    trimmers1: trimmers1 ?? 0,
    tzero1: tzero1 ?? 0,
    cultivar1: cultivar1 ?? '',
    tops1: tops1 ?? 0,
    smalls1: smalls1 ?? 0,
    buckers2: buckers2 ?? 0,
    trimmers2: trimmers2 ?? 0,
    tzero2: tzero2 ?? 0,
    cultivar2: cultivar2 ?? '',
    tops2: tops2 ?? 0,
    smalls2: smalls2 ?? 0,
    qcperson: qcperson ?? 0,
    qcNotes: qcNotes ?? '',
  };

  try {
    // Write to D1 first (primary source of truth)
    const d1Result = await addProductionToD1(date, timeSlot, data, env);
    if (!d1Result.success) {
      console.error('D1 write failed:', d1Result.error);
      return errorResponse('Failed to save production data to D1', 'INTERNAL_ERROR', 500);
    }

    // Write to Google Sheets as backup (fire and forget - don't fail if Sheets fails)
    addProductionToSheets(date, timeSlot, data, env).catch(error => {
      console.warn('Sheets backup write failed (non-blocking):', error);
    });

    // Increment version to notify clients of new data
    await incrementDataVersion(env);

    return successResponse({
      success: true,
      message: 'Production data saved',
      date,
      timeSlot,
      source: 'D1'
    });
  } catch (error) {
    console.error('Error adding production:', error);
    return errorResponse('Failed to save production data', 'INTERNAL_ERROR', 500);
  }
}

// ===== MAIN HANDLER =====

export async function handleProduction(request, env, ctx) {
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
      case 'getCultivars':
        return await getCultivars(env);
      case 'getProduction':
        return await getProduction(params, env);
      case 'addProduction':
        return await addProduction(body, env);
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
      case 'scaleWeight':
        if (request.method === 'POST') {
          return await setScaleWeight(body, env);
        }
        return await getScaleWeight(params, env);
      case 'inventoryWebhook':
      case 'webhook':
        return await inventoryWebhook(body, env, request);
      default:
        return errorResponse(`Unknown action: ${action}`, 'NOT_FOUND', 404);
    }
  } catch (error) {
    console.error('Production handler error:', error);
    const { message, code, status } = formatError(error);
    return errorResponse(message, code, status);
  }
}
