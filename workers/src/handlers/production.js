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
 */

import { readSheet, appendSheet, writeSheet, getSheetNames } from '../lib/sheets.js';
import { successResponse, errorResponse, parseBody, getAction, getQueryParams } from '../lib/response.js';
import { createError, formatError } from '../lib/errors.js';
import { sanitizeForSheets, validateDate } from '../lib/validate.js';
import { insert } from '../lib/db.js';

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
      hourlyRates.push({ timeSlot: row.timeSlot, rate, target: targetRate });
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

// ===== BAG TIMER DATA =====

async function getBagTimerData(env) {
  const sheetId = env.PRODUCTION_SHEET_ID;
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
    const headerRow = await readSheet(sheetId, `'${SHEETS.tracking}'!1:1`, env);
    if (!headerRow || !headerRow[0]) return result;

    const headers = headerRow[0];
    const timestampCol = headers.indexOf('Timestamp');
    const sizeCol = headers.indexOf('Size');

    if (timestampCol === -1 || sizeCol === -1) return result;

    const vals = await readSheet(sheetId, `'${SHEETS.tracking}'!A2:J2001`, env);
    if (!vals || vals.length === 0) return result;

    const scoreboardData = await getScoreboardData(env);
    result.currentTrimmers = scoreboardData.currentHourTrimmers || scoreboardData.lastHourTrimmers || 0;
    result.targetRate = scoreboardData.targetRate || 1.0;

    const bagWeightLbs = 11.0231;
    const teamRateLbsPerHour = result.currentTrimmers * result.targetRate;
    if (teamRateLbsPerHour > 0) {
      result.targetSeconds = Math.round((bagWeightLbs / teamRateLbsPerHour) * 3600);
    }

    const today = formatDatePT(new Date(), 'yyyy-MM-dd');
    const now = new Date();

    const todayBags = [];
    let lastBag = null;
    let bags5kg = 0;

    for (const row of vals) {
      const timestamp = row[timestampCol];
      if (!timestamp) continue;

      let rowDate;
      if (typeof timestamp === 'string') {
        let cleanTimestamp = timestamp.trim();

        // Check for US date format: "M/D/YYYY H:M:S" or "M/D/YYYY H:M:S AM/PM"
        const usDatePattern = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i;
        const usDateMatch = cleanTimestamp.match(usDatePattern);
        if (usDateMatch) {
          const [, month, day, year, hourStr, min, sec, ampm] = usDateMatch;
          let hours = parseInt(hourStr, 10);

          if (ampm) {
            if (ampm.toUpperCase() === 'PM' && hours !== 12) hours += 12;
            if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;
          }

          // Build ISO format with Pacific timezone
          const isoDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${String(hours).padStart(2, '0')}:${min}:${sec || '00'}-08:00`;
          cleanTimestamp = isoDate;
        }

        rowDate = new Date(cleanTimestamp);
      } else if (typeof timestamp === 'number') {
        if (timestamp < 1) {
          // Time-only serial (fraction of day)
          const hours = Math.floor(timestamp * 24);
          const minutes = Math.floor((timestamp * 24 - hours) * 60);
          const timeStr = `${today}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00-08:00`;
          rowDate = new Date(timeStr);
        } else {
          // Full date serial (days since 1900)
          rowDate = new Date((timestamp - 25569) * 86400 * 1000);
        }
      } else {
        rowDate = new Date(timestamp);
      }

      if (isNaN(rowDate.getTime())) continue;

      // Skip accidentally scanned bags (1/19/2026 12:34:14 - 12:38:04 Pacific)
      // These 8 bags were scanned in error
      const badBagStart = new Date('2026-01-19T20:34:14Z'); // 12:34:14 Pacific
      const badBagEnd = new Date('2026-01-19T20:38:05Z');   // 12:38:04 Pacific + 1 sec
      if (rowDate >= badBagStart && rowDate <= badBagEnd) continue;

      const rowDateStr = formatDatePT(rowDate, 'yyyy-MM-dd');
      const size = String(row[sizeCol] || '').toLowerCase();

      if (rowDateStr === today && is5kgBag(size)) {
        bags5kg++;
        todayBags.push(rowDate);
      }

      if (!lastBag || rowDate > lastBag.time) {
        lastBag = { time: rowDate, size };
      }
    }

    result.bagsToday = bags5kg;
    result.bags5kgToday = bags5kg;

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
    let dayData = { totalTops: 0, totalSmalls: 0, totalTrimmerHours: 0 };

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
            };
          }
        }

        const dateStr = row[1];
        if (dateStr) {
          const d = new Date(dateStr);
          if (!isNaN(d.getTime())) {
            currentDate = d;
            dayData = { totalTops: 0, totalSmalls: 0, totalTrimmerHours: 0 };
          }
        }

        const headerRow = vals[i + 1] || [];
        cols = getColumnIndices(headerRow);
        continue;
      }

      if (!currentDate || !cols || currentDate < cutoff) continue;
      if (isEndOfBlock(row)) continue;

      const tops1 = parseFloat(row[cols.tops1]) || 0;
      const smalls1 = parseFloat(row[cols.smalls1]) || 0;
      const tr1 = parseFloat(row[cols.trimmers1]) || 0;

      if (tops1 > 0 || smalls1 > 0 || tr1 > 0) {
        dayData.totalTops += tops1;
        dayData.totalSmalls += smalls1;
        dayData.totalTrimmerHours += tr1;
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
        };
      }
    }
  }

  return Object.values(dailyMap).sort((a, b) => a.date - b.date);
}

// ===== API HANDLERS =====

async function test(env) {
  return successResponse({
    ok: true,
    message: 'Production API is working (Cloudflare Workers)',
    timestamp: new Date().toISOString(),
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

  const todayData = {
    totalTops: scoreboardData.todayLbs || 0,
    totalSmalls: 0,
    totalLbs: scoreboardData.todayLbs || 0,
    avgRate: scoreboardData.hourlyRates?.length > 0
      ? scoreboardData.hourlyRates.reduce((s, h) => s + h.rate, 0) / scoreboardData.hourlyRates.length
      : 0,
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
        return successResponse({
          shiftAdjustment: {
            manualStartTime: `${date}T${vals[i][1]}`,
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

/**
 * Shopify Inventory Webhook Handler (Dual-Write)
 * Receives inventory adjustment webhooks from Shopify Flow
 * Writes to both D1 and Google Sheets for backwards compatibility
 */
async function inventoryWebhook(body, env) {
  // Extract fields from webhook payload
  // Shopify Flow may send as flat object or nested
  const data = body.data || body;

  const timestamp = data.Timestamp || data.timestamp || new Date().toISOString();
  const sku = data.SKU || data.sku || '';
  const productName = data['Product Name'] || data.product_name || '';
  const variantTitle = data['Variant Title'] || data.variant_title || '';
  const strainName = data['Strain Name'] || data.strain_name || '';
  const size = data.Size || data.size || '';
  const quantityAdjusted = parseInt(data['Quantity Adjusted'] || data.quantity_adjusted || 0, 10);
  const newTotalAvailable = parseInt(data['New Total Available'] || data.new_total_available || 0, 10);
  const previousAvailable = parseInt(data['Previous Available'] || data.previous_available || 0, 10);
  const location = data.Location || data.location || '';
  const productType = data['Product Type'] || data.product_type || '';
  const barcode = data.Barcode || data.barcode || '';
  const price = parseFloat(data.Price || data.price || 0);
  const flowRunId = data['Flow Run ID'] || data.flow_run_id || `manual-${Date.now()}`;
  const eventType = data['Event Type'] || data.event_type || 'inventory_adjustment';
  const adjustmentSource = data['Adjustment Source'] || data.adjustment_source || '';
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
    return successResponse({
      success: true,
      message: 'Inventory adjustment recorded (D1 + Sheets)',
      flowRunId,
      sku,
      quantityAdjusted,
    });
  } else if (d1Success || sheetsSuccess) {
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
async function getProduction(params, env) {
  const sheetId = env.PRODUCTION_SHEET_ID;
  const date = params.date || formatDatePT(new Date(), 'yyyy-MM-dd');

  if (!validateDate(date)) {
    return errorResponse('Invalid date format', 'VALIDATION_ERROR', 400);
  }

  try {
    // Determine which month sheet to use
    const sheetMonth = date.substring(0, 7); // YYYY-MM
    const sheetNames = await getSheetNames(sheetId, env);

    // Check if the month sheet exists
    const monthSheetExists = sheetNames.includes(sheetMonth);
    if (!monthSheetExists) {
      // Return empty data if no sheet for this month
      return successResponse({
        date,
        slots: {},
        targetRate: 0.9
      });
    }

    // Read the sheet data
    const vals = await readSheet(sheetId, `'${sheetMonth}'!A:Z`, env);
    if (!vals || vals.length === 0) {
      return successResponse({ date, slots: {}, targetRate: 0.9 });
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
      return successResponse({ date, slots: {}, targetRate: 0.9 });
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
        qcperson: parseFloat(row[cols.qcperson]) || 0,  // Shared QC person count
        qcNotes: row[cols.qcNotes] || '',
      };
    }

    return successResponse({ date, slots, targetRate });
  } catch (error) {
    console.error('Error getting production:', error);
    return errorResponse('Failed to get production data', 'INTERNAL_ERROR', 500);
  }
}

/**
 * Add/update hourly production data
 * Accepts flat fields: date, timeSlot, buckers1, trimmers1, etc.
 */
async function addProduction(body, env) {
  const sheetId = env.PRODUCTION_SHEET_ID;

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
    qcperson: qcperson ?? 0,  // Shared QC person count
    qcNotes: qcNotes ?? '',
  };

  try {
    // Determine which month sheet to use
    const sheetMonth = date.substring(0, 7); // YYYY-MM
    const sheetNames = await getSheetNames(sheetId, env);

    if (!sheetNames.includes(sheetMonth)) {
      return errorResponse(`Sheet for ${sheetMonth} does not exist`, 'NOT_FOUND', 404);
    }

    // Read the sheet data
    const vals = await readSheet(sheetId, `'${sheetMonth}'!A:Z`, env);
    if (!vals || vals.length === 0) {
      return errorResponse('Sheet is empty', 'INTERNAL_ERROR', 500);
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
      return errorResponse(`No data block found for ${dateLabel}`, 'NOT_FOUND', 404);
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
      return errorResponse(`Time slot ${timeSlot} not found in date block`, 'NOT_FOUND', 404);
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

    return successResponse({
      success: true,
      message: 'Production data saved',
      date,
      timeSlot
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
      case 'scoreboard':
        return await scoreboard(env);
      case 'dashboard':
        return await dashboard(params, env);
      case 'setShiftStart':
        return await setShiftStart(params, env);
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
      case 'inventoryWebhook':
      case 'webhook':
        return await inventoryWebhook(body, env);
      default:
        return errorResponse(`Unknown action: ${action}`, 'NOT_FOUND', 404);
    }
  } catch (error) {
    console.error('Production handler error:', error);
    const { message, code, status } = formatError(error);
    return errorResponse(message, code, status);
  }
}
