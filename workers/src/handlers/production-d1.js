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

// ===== SCOREBOARD DATA =====

async function getScoreboardData(env) {
  const today = formatDatePT(new Date(), 'yyyy-MM-dd');

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

  // Get today's hourly production data from D1
  const todayRows = await query(env.DB, `
    SELECT time_slot, cultivar1, tops_lbs1, trimmers_line1
    FROM monthly_production
    WHERE production_date = ?
    ORDER BY time_slot
  `, [today]);

  if (todayRows.length === 0) return result;

  // Transform to working format
  const rows = todayRows.map(r => ({
    timeSlot: r.time_slot || '',
    tops: r.tops_lbs1 || 0,
    trimmers: r.trimmers_line1 || 0,
    strain: r.cultivar1 || '',
    multiplier: getTimeSlotMultiplier(r.time_slot),
  }));

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
    result.lastHourMultiplier = lastRow.multiplier;
    result.lastHourTarget = lastRow.trimmers * targetRate * lastRow.multiplier;
    result.lastTimeSlot = lastRow.timeSlot;
  }

  // Current hour
  if (currentHourIndex >= 0) {
    const currentRow = rows[currentHourIndex];
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

    // Get today's bags from D1
    const bags = await query(env.DB, `
      SELECT timestamp, bag_type
      FROM production_tracking
      WHERE DATE(timestamp) = ?
      ORDER BY timestamp DESC
      LIMIT 2001
    `, [today]);

    const scoreboardData = await getScoreboardData(env);
    result.currentTrimmers = scoreboardData.currentHourTrimmers || scoreboardData.lastHourTrimmers || 0;
    result.targetRate = scoreboardData.targetRate || 1.0;

    const bagWeightLbs = 11.0231;
    const teamRateLbsPerHour = result.currentTrimmers * result.targetRate;
    if (teamRateLbsPerHour > 0) {
      result.targetSeconds = Math.round((bagWeightLbs / teamRateLbsPerHour) * 3600);
    }

    const todayBags = [];
    let lastBag = null;
    let bags5kg = 0;

    // Bad bags blacklist
    const badBagStart = new Date('2026-01-19T20:34:14Z');
    const badBagEnd = new Date('2026-01-19T20:38:05Z');

    for (const row of bags) {
      const timestamp = row.timestamp;
      if (!timestamp) continue;

      const rowDate = new Date(timestamp);
      if (isNaN(rowDate.getTime())) continue;

      // Skip accidentally scanned bags
      if (rowDate >= badBagStart && rowDate <= badBagEnd) continue;

      const size = String(row.bag_type || '').toLowerCase();
      if (is5kgBag(size)) {
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
  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = formatDatePT(cutoff, 'yyyy-MM-dd');

  const rows = await query(env.DB, `
    SELECT production_date,
           SUM(tops_lbs1) as total_tops,
           SUM(smalls_lbs1) as total_smalls,
           SUM(trimmers_line1) as trimmer_hours
    FROM monthly_production
    WHERE production_date >= ?
    GROUP BY production_date
    ORDER BY production_date
  `, [cutoffStr]);

  return rows.map(r => ({
    date: new Date(r.production_date),
    totalTops: r.total_tops || 0,
    totalSmalls: r.total_smalls || 0,
    avgRate: r.trimmer_hours > 0 ? r.total_tops / r.trimmer_hours : 0,
    totalLbs: (r.total_tops || 0) + (r.total_smalls || 0),
    trimmerHours: r.trimmer_hours || 0,
  }));
}

// ===== API HANDLERS =====

async function test(env) {
  return successResponse({
    ok: true,
    message: 'Production API is working (Cloudflare D1)',
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

// ===== MIGRATION =====

async function migrateFromSheets(env) {
  const sheetId = env.PRODUCTION_SHEET_ID;
  if (!sheetId) throw createError('INTERNAL_ERROR', 'PRODUCTION_SHEET_ID not configured');

  let trackingMigrated = 0;
  let productionMigrated = 0;
  let pausesMigrated = 0;
  let shiftsMigrated = 0;

  // Migrate production tracking (bag completions)
  try {
    const trackingSheet = 'Rogue Origin Production Tracking';
    const data = await readSheet(sheetId, `'${trackingSheet}'!A:J`, env);

    if (data.length > 1) {
      const headers = data[0];
      const timestampCol = headers.indexOf('Timestamp');
      const sizeCol = headers.indexOf('Size');
      const skuCol = headers.indexOf('SKU');

      // Only migrate last 2000 rows (most recent data)
      const startRow = Math.max(1, data.length - 2000);

      for (let i = startRow; i < data.length; i++) {
        const row = data[i];
        const timestamp = row[timestampCol];
        if (!timestamp) continue;

        // Check if already exists
        const existing = await queryOne(env.DB,
          'SELECT id FROM production_tracking WHERE timestamp = ?',
          [timestamp]
        );
        if (existing) continue;

        await insert(env.DB, 'production_tracking', {
          timestamp: timestamp,
          bag_type: row[sizeCol] || '',
          sku: row[skuCol] || '',
          source: 'sheets_migration',
        });
        trackingMigrated++;
      }
    }
  } catch (e) {
    console.error('Error migrating tracking:', e);
  }

  // Migrate monthly production data
  try {
    const sheetNames = await getSheetNames(sheetId, env);
    const monthSheets = sheetNames.filter(name => /^\d{4}-\d{2}$/.test(name));

    for (const monthSheet of monthSheets.slice(0, 3)) { // Last 3 months
      const vals = await readSheet(sheetId, `'${monthSheet}'!A:Z`, env);
      let currentDate = null;
      let cols = null;

      for (let i = 0; i < vals.length; i++) {
        const row = vals[i];

        if (row[0] === 'Date:') {
          const dateStr = row[1];
          if (dateStr) {
            const d = new Date(dateStr);
            if (!isNaN(d.getTime())) {
              currentDate = formatDatePT(d, 'yyyy-MM-dd');
            }
          }

          // Next row is headers
          const headerRow = vals[i + 1] || [];
          cols = {
            cultivar1: headerRow.indexOf('Cultivar 1'),
            tops1: headerRow.indexOf('Tops 1'),
            smalls1: headerRow.indexOf('Smalls 1'),
            buckers1: headerRow.indexOf('Buckers 1'),
            trimmers1: headerRow.indexOf('Trimmers 1'),
            cultivar2: headerRow.indexOf('Cultivar 2'),
            tops2: headerRow.indexOf('Tops 2'),
            smalls2: headerRow.indexOf('Smalls 2'),
            buckers2: headerRow.indexOf('Buckers 2'),
            trimmers2: headerRow.indexOf('Trimmers 2'),
          };
          continue;
        }

        if (!currentDate || !cols) continue;

        const timeSlot = row[0];
        if (!timeSlot || timeSlot === 'Date:' || String(timeSlot).includes('Performance')) continue;

        const tops1 = parseFloat(row[cols.tops1]) || 0;
        const smalls1 = parseFloat(row[cols.smalls1]) || 0;
        const trimmers1 = parseFloat(row[cols.trimmers1]) || 0;

        if (tops1 === 0 && smalls1 === 0 && trimmers1 === 0) continue;

        // Check if exists
        const existing = await queryOne(env.DB,
          'SELECT id FROM monthly_production WHERE production_date = ? AND time_slot = ?',
          [currentDate, timeSlot]
        );
        if (existing) continue;

        await insert(env.DB, 'monthly_production', {
          production_date: currentDate,
          time_slot: timeSlot,
          buckers_line1: parseFloat(row[cols.buckers1]) || 0,
          trimmers_line1: trimmers1,
          buckers_line2: parseFloat(row[cols.buckers2]) || 0,
          trimmers_line2: parseFloat(row[cols.trimmers2]) || 0,
          cultivar1: row[cols.cultivar1] || '',
          cultivar2: row[cols.cultivar2] || '',
          tops_lbs1: tops1,
          smalls_lbs1: smalls1,
          tops_lbs2: parseFloat(row[cols.tops2]) || 0,
          smalls_lbs2: parseFloat(row[cols.smalls2]) || 0,
        });
        productionMigrated++;
      }
    }
  } catch (e) {
    console.error('Error migrating monthly production:', e);
  }

  // Migrate pause log
  try {
    const pauseData = await readSheet(sheetId, `'Timer Pause Log'!A:G`, env);
    for (let i = 1; i < pauseData.length; i++) {
      const row = pauseData[i];
      if (!row[0]) continue;

      const existing = await queryOne(env.DB,
        'SELECT id FROM pause_log WHERE start_time LIKE ?',
        [`${row[1]}%`]
      );
      if (existing) continue;

      await insert(env.DB, 'pause_log', {
        start_time: `${row[1]}T${row[2]}`,
        end_time: row[3] ? `${row[1]}T${row[3]}` : null,
        duration_min: parseFloat(row[4]) || null,
        reason: row[5] || '',
        created_by: row[6] || '',
      });
      pausesMigrated++;
    }
  } catch (e) {
    console.error('Error migrating pauses:', e);
  }

  // Migrate shift adjustments
  try {
    const shiftData = await readSheet(sheetId, `'Shift Adjustments'!A:F`, env);
    for (let i = 1; i < shiftData.length; i++) {
      const row = shiftData[i];
      if (!row[0]) continue;

      const existing = await queryOne(env.DB,
        'SELECT id FROM shift_adjustments WHERE adjustment_date = ?',
        [row[0]]
      );
      if (existing) continue;

      await insert(env.DB, 'shift_adjustments', {
        adjustment_date: row[0],
        original_start: '07:00:00',
        new_start: row[1] || '',
        reason: `Available hours: ${row[3] || 0}, Scale: ${row[4] || 1}`,
      });
      shiftsMigrated++;
    }
  } catch (e) {
    console.error('Error migrating shifts:', e);
  }

  return successResponse({
    success: true,
    message: `Migration complete. Tracking: ${trackingMigrated}, Production: ${productionMigrated}, Pauses: ${pausesMigrated}, Shifts: ${shiftsMigrated}`,
    trackingMigrated,
    productionMigrated,
    pausesMigrated,
    shiftsMigrated,
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
      case 'migrate':
        return await migrateFromSheets(env);
      default:
        return errorResponse(`Unknown action: ${action}`, 'NOT_FOUND', 404);
    }
  } catch (error) {
    console.error('Production handler error:', error);
    const { message, code, status } = formatError(error);
    return errorResponse(message, code, status);
  }
}
