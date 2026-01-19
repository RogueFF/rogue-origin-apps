/**
 * Production Tracking API
 * Migrated from Apps Script to Vercel Functions
 *
 * Sheet Tabs:
 * - YYYY-MM: Monthly production data sheets
 * - Data: Reference data (cultivars, rates, config)
 * - Rogue Origin Production Tracking: Bag completion webhooks
 * - Timer Pause Log: Break/pause records
 * - Shift Adjustments: Start time adjustments
 * - Orders: Internal production orders
 *
 * Endpoints:
 * - GET  ?action=test              - Test API
 * - GET  ?action=scoreboard        - Scoreboard + timer data
 * - GET  ?action=dashboard         - Dashboard data (with date range)
 * - GET  ?action=getOrders         - Get internal orders
 * - GET  ?action=getOrder          - Get single order
 * - GET  ?action=getScoreboardOrderQueue - Get order queue (from Orders API)
 * - GET  ?action=setShiftStart     - Set shift start time
 * - GET  ?action=getShiftStart     - Get shift start time
 * - GET  ?action=morningReport     - Morning report data
 * - POST ?action=logBag            - Log bag completion
 * - POST ?action=logPause          - Log timer pause
 * - POST ?action=logResume         - Log timer resume
 * - POST ?action=chat              - AI agent chat
 * - POST ?action=feedback          - Log chat feedback
 * - POST ?action=tts               - Text-to-speech
 * - POST ?action=saveOrder         - Save order
 * - POST ?action=deleteOrder       - Delete order
 */

const { createHandler, success } = require('../_lib/response');
const { readSheet, appendSheet, writeSheet, getSheetNames } = require('../_lib/sheets');
const { sanitizeForSheets, validateDate } = require('../_lib/validate');
const { createError } = require('../_lib/errors');

const SHEET_ID = process.env.PRODUCTION_SHEET_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY;
const ORDERS_API_URL = 'https://rogue-origin-apps-master.vercel.app/api/orders';
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

/**
 * Format date to Pacific timezone
 */
function formatDatePT(date, format = 'yyyy-MM-dd') {
  const d = new Date(date);
  const options = { timeZone: TIMEZONE };

  if (format === 'yyyy-MM-dd') {
    return d.toLocaleDateString('sv-SE', options); // ISO format
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

/**
 * Get time slot multiplier
 */
function getTimeSlotMultiplier(timeSlot) {
  if (!timeSlot) return 1.0;
  const slot = String(timeSlot).trim();
  if (TIME_SLOT_MULTIPLIERS[slot]) {
    return TIME_SLOT_MULTIPLIERS[slot];
  }
  // Normalize dashes
  const normalized = slot.replace(/[-–—]/g, '–');
  if (TIME_SLOT_MULTIPLIERS[normalized]) {
    return TIME_SLOT_MULTIPLIERS[normalized];
  }
  return 1.0;
}

/**
 * Get latest month sheet name (YYYY-MM format)
 */
async function getLatestMonthSheet() {
  const names = await getSheetNames(SHEET_ID);
  const monthSheets = names
    .filter((name) => /^\d{4}-\d{2}$/.test(name))
    .sort((a, b) => b.localeCompare(a));
  return monthSheets[0] || null;
}

/**
 * Get column indices from headers
 */
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
    qc: headers.indexOf('QC'),
  };
}

/**
 * Find date row in sheet data
 */
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

/**
 * Check if row is end of data block
 */
function isEndOfBlock(row) {
  if (!row[0]) return true;
  if (row[0] === 'Date:') return true;
  const str = String(row[0]);
  if (str.includes('Performance Averages')) return true;
  if (str.includes('Avg Tops:Smalls')) return true;
  return false;
}

/**
 * Check if size is 5kg bag
 */
function is5kgBag(size) {
  const s = String(size || '').toLowerCase().replace(/\s+/g, '');
  return s.includes('5kg') || s.includes('5 kg');
}

// ===== SCOREBOARD DATA =====

/**
 * Get scoreboard data (Line 1 only)
 */
async function getScoreboardData() {
  const todayLabel = formatDatePT(new Date(), 'MMMM dd, yyyy');
  const monthSheetName = await getLatestMonthSheet();

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
    streak: 0,
    vsYesterday: null,
    vs7Day: null,
    strainTargetRate: 0,
    usingStrainRate: false,
    hourlyRates: [],
  };

  if (!monthSheetName) return result;

  const vals = await readSheet(SHEET_ID, `'${monthSheetName}'!A:Z`);
  const dateRowIndex = findDateRow(vals, todayLabel);
  if (dateRowIndex === -1) return result;

  const headerRowIndex = dateRowIndex + 1;
  const headers = vals[headerRowIndex] || [];
  const cols = getColumnIndices(headers);

  // Collect all LINE 1 rows for today
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
  const dailyData = await getExtendedDailyData(30);
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
    result.lastHourDelta = lastRow.tops - result.lastHourTarget;
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
  const hourlyRates = [];
  let bestPct = 0;
  let streak = 0;
  let currentStreak = 0;

  for (let i = 0; i <= lastCompletedHourIndex && i < todayRows.length; i++) {
    const row = todayRows[i];
    if (row.trimmers > 0 && row.tops > 0) {
      const hourTarget = row.trimmers * targetRate * row.multiplier;
      totalTarget += hourTarget;

      const pct = hourTarget > 0 ? (row.tops / hourTarget) * 100 : 0;
      hourlyPercentages.push(pct);
      if (pct > bestPct) bestPct = pct;

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
  result.todayDelta = totalLbs - totalTarget;
  result.avgPercentage = hourlyPercentages.length > 0
    ? hourlyPercentages.reduce((a, b) => a + b, 0) / hourlyPercentages.length
    : 0;
  result.bestPercentage = bestPct;
  result.streak = streak;

  // Daily projection
  const projection = calculateDailyProjection(todayRows, lastCompletedHourIndex, currentHourIndex, targetRate, totalLbs);
  result.projectedTotal = projection.projectedTotal;
  result.dailyGoal = projection.dailyGoal;
  result.projectedDelta = projection.projectedTotal - projection.dailyGoal;

  return result;
}

/**
 * Calculate daily projection
 */
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

/**
 * Get bag timer data
 */
async function getBagTimerData() {
  const result = {
    lastBagTime: null,
    secondsSinceLastBag: 0,
    targetSeconds: 0,
    avgSecondsToday: 0,
    avgSeconds7Day: 0,
    bagsToday: 0,
    bags5kgToday: 0,
    bags10lbToday: 0,
    currentTrimmers: 0,
    targetRate: 0,
    lastBagSize: null,
    cycleHistory: [],
  };

  try {
    // Get header row to find correct column indices
    const headerRow = await readSheet(SHEET_ID, `'${SHEETS.tracking}'!1:1`);
    if (!headerRow || !headerRow[0]) return result;

    const headers = headerRow[0];
    const timestampCol = headers.indexOf('Timestamp');
    const sizeCol = headers.indexOf('Size');
    const skuCol = headers.indexOf('SKU');

    if (timestampCol === -1 || sizeCol === -1) return result;

    // Get tracking data (read most recent 2000 rows from top)
    const vals = await readSheet(SHEET_ID, `'${SHEETS.tracking}'!A2:J2001`);
    if (!vals || vals.length === 0) return result;

    // Get scoreboard data for trimmers count
    const scoreboardData = await getScoreboardData();
    result.currentTrimmers = scoreboardData.currentHourTrimmers || scoreboardData.lastHourTrimmers || 0;
    result.targetRate = scoreboardData.targetRate || 1.0;

    // Calculate target seconds
    const bagWeightLbs = 11.0231; // 5kg
    const teamRateLbsPerHour = result.currentTrimmers * result.targetRate;
    if (teamRateLbsPerHour > 0) {
      result.targetSeconds = Math.round((bagWeightLbs / teamRateLbsPerHour) * 3600);
    }

    // Get today's date in PT
    const today = formatDatePT(new Date(), 'yyyy-MM-dd');
    const now = new Date();

    // Find today's bags
    const todayBags = [];
    let lastBag = null;
    let bags5kg = 0;
    let bags10lb = 0;

    for (const row of vals) {
      const timestamp = row[timestampCol];
      if (!timestamp) continue;

      // Parse timestamp - handle various formats
      // All timestamps from the tracking sheet are in Pacific Time
      let rowDate;
      if (typeof timestamp === 'string') {
        // Clean up timestamp string (remove extra colons, normalize format)
        let cleanTimestamp = timestamp.trim()
          .replace(/at\s+/gi, '') // Remove "at "
          .replace(/:\s*(AM|PM)/gi, ' $1') // Fix ": AM" -> " AM"
          .replace(/,/g, ''); // Remove commas

        // Check if it's time-only (no date) - common formats: "10:39 AM", "10:39:00"
        const timeOnlyPattern = /^(\d{1,2}):(\d{2})(:\d{2})?\s*(AM|PM)?$/i;
        const timeMatch = cleanTimestamp.match(timeOnlyPattern);
        if (timeMatch) {
          // Convert to 24-hour format and create proper date string with Pacific timezone
          let hours = parseInt(timeMatch[1], 10);
          const minutes = timeMatch[2];
          const ampm = timeMatch[4] ? timeMatch[4].toUpperCase() : null;

          if (ampm === 'PM' && hours !== 12) hours += 12;
          if (ampm === 'AM' && hours === 12) hours = 0;

          // Use Pacific timezone offset (PST = -08:00)
          cleanTimestamp = `${today}T${String(hours).padStart(2, '0')}:${minutes}:00-08:00`;
        }

        // Check for US date format without timezone: "M/D/YYYY H:M:S" or "M/D/YYYY H:M:S AM/PM"
        // These are Pacific times that need timezone added
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
        // Excel/Sheets serial date number
        if (timestamp < 1) {
          // Time-only serial (fraction of day, e.g., 0.444 = 10:40 AM)
          // Convert to ISO string with Pacific timezone
          const hours = Math.floor(timestamp * 24);
          const minutes = Math.floor((timestamp * 24 - hours) * 60);
          const tzOffset = '-08:00'; // PST
          const timeStr = `${today}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00${tzOffset}`;
          rowDate = new Date(timeStr);
        } else {
          // Full date serial (days since 1900)
          rowDate = new Date((timestamp - 25569) * 86400 * 1000);
        }
      } else {
        rowDate = new Date(timestamp);
      }

      // Skip invalid dates
      if (isNaN(rowDate.getTime())) continue;

      // Skip accidentally scanned bags (1/19/2026 12:34:14 - 12:38:04 Pacific)
      // These 8 bags were scanned in error
      const badBagStart = new Date('2026-01-19T20:34:14Z'); // 12:34:14 Pacific
      const badBagEnd = new Date('2026-01-19T20:38:05Z');   // 12:38:04 Pacific + 1 sec
      if (rowDate >= badBagStart && rowDate <= badBagEnd) continue;

      const rowDateStr = formatDatePT(rowDate, 'yyyy-MM-dd');
      const size = String(row[sizeCol] || '').toLowerCase();
      const sku = skuCol >= 0 ? String(row[skuCol] || '').toUpperCase() : '';

      if (rowDateStr === today) {
        if (is5kgBag(size)) {
          bags5kg++;
          todayBags.push(rowDate);
        } else if (sku.includes('TOP-10-LB') || size.includes('10lb') || size.includes('10 lb')) {
          bags10lb++;
        }
      }

      // Track most recent bag
      if (!lastBag || rowDate > lastBag.time) {
        lastBag = { time: rowDate, size };
      }
    }

    result.bagsToday = bags5kg;  // Only count 5kg bags for main display
    result.bags5kgToday = bags5kg;
    result.bags10lbToday = bags10lb;

    if (lastBag) {
      result.lastBagTime = lastBag.time.toISOString();
      result.lastBagSize = lastBag.size;
      result.secondsSinceLastBag = Math.floor((now - lastBag.time) / 1000);
    }

    // Calculate cycle times
    if (todayBags.length > 1) {
      todayBags.sort((a, b) => a - b);
      const cycleTimes = [];
      for (let i = 1; i < todayBags.length; i++) {
        const diffMs = todayBags[i] - todayBags[i - 1];
        const diffSec = Math.floor(diffMs / 1000);
        // Only count reasonable cycles (5 min to 4 hours)
        if (diffSec >= 300 && diffSec <= 14400) {
          cycleTimes.push(diffSec);
        }
      }
      if (cycleTimes.length > 0) {
        result.avgSecondsToday = Math.round(cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length);
      }
    }

    // Build cycle history for display
    if (todayBags.length > 1) {
      todayBags.sort((a, b) => b - a); // Most recent first
      for (let i = 0; i < Math.min(todayBags.length - 1, 20); i++) {
        const cycleSec = Math.floor((todayBags[i] - todayBags[i + 1]) / 1000);
        if (cycleSec >= 300 && cycleSec <= 14400) {
          result.cycleHistory.push({
            timestamp: todayBags[i].toISOString(),
            time: cycleSec,  // Frontend expects 'time' field
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

/**
 * Get extended daily data for past N days
 */
async function getExtendedDailyData(days = 30) {
  const sheetNames = await getSheetNames(SHEET_ID);
  const monthSheets = sheetNames
    .filter((name) => /^\d{4}-\d{2}$/.test(name))
    .sort((a, b) => b.localeCompare(a));

  if (monthSheets.length === 0) return [];

  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - days);

  const dailyMap = {};

  for (const sheetName of monthSheets.slice(0, 2)) { // Check last 2 months max
    const vals = await readSheet(SHEET_ID, `'${sheetName}'!A:Z`);
    let currentDate = null;
    let cols = null;
    let dayData = {
      totalTops: 0,
      totalSmalls: 0,
      totalTrimmerHours: 0,
      hoursWorked: 0,
    };

    for (let i = 0; i < vals.length; i++) {
      const row = vals[i];
      if (row[0] === 'Date:') {
        // Save previous day
        if (currentDate && (dayData.totalTops > 0 || dayData.totalSmalls > 0) && currentDate >= cutoff) {
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

        // Start new day
        const dateStr = row[1];
        if (dateStr) {
          const d = new Date(dateStr);
          if (!isNaN(d.getTime())) {
            currentDate = d;
            dayData = {
              totalTops: 0,
              totalSmalls: 0,
              totalTrimmerHours: 0,
              hoursWorked: 0,
            };
          }
        }

        const headerRow = vals[i + 1] || [];
        cols = getColumnIndices(headerRow);
        continue;
      }

      if (!currentDate || !cols || currentDate < cutoff) continue;
      if (isEndOfBlock(row)) continue;

      // Line 1 + 2 data
      const tops1 = parseFloat(row[cols.tops1]) || 0;
      const smalls1 = parseFloat(row[cols.smalls1]) || 0;
      const tr1 = parseFloat(row[cols.trimmers1]) || 0;
      const tops2 = parseFloat(row[cols.tops2]) || 0;
      const smalls2 = parseFloat(row[cols.smalls2]) || 0;
      const tr2 = parseFloat(row[cols.trimmers2]) || 0;

      const totalTopsHour = tops1 + tops2;
      const totalSmallsHour = smalls1 + smalls2;
      const totalTrimmersHour = tr1 + tr2;

      if (totalTopsHour > 0 || totalSmallsHour > 0 || totalTrimmersHour > 0) {
        dayData.totalTops += totalTopsHour;
        dayData.totalSmalls += totalSmallsHour;
        dayData.totalTrimmerHours += totalTrimmersHour;
        dayData.hoursWorked++;
      }
    }

    // Process last date in sheet
    if (currentDate && (dayData.totalTops > 0 || dayData.totalSmalls > 0) && currentDate >= cutoff) {
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

/**
 * Test endpoint
 */
async function test(req, res) {
  return success(res, {
    ok: true,
    message: 'Production API is working',
    timestamp: new Date().toISOString(),
  });
}

/**
 * Get scoreboard with timer data
 */
async function scoreboard(req, res) {
  const scoreboardData = await getScoreboardData();
  const timerData = await getBagTimerData();

  return success(res, {
    scoreboard: scoreboardData,
    timer: timerData,
  });
}

/**
 * Get dashboard data with date range
 * Returns full dashboard data including today's metrics, bag timer, and historical data
 * If requested date range has no data, falls back to most recent working day
 */
async function dashboard(req, res) {
  const start = req.query.start || '';
  const end = req.query.end || '';

  // Validate dates
  if (start && !validateDate(start).valid) {
    throw createError('VALIDATION_ERROR', 'Invalid start date');
  }
  if (end && !validateDate(end).valid) {
    throw createError('VALIDATION_ERROR', 'Invalid end date');
  }

  // Get today's date in Pacific timezone
  const today = formatDatePT(new Date(), 'yyyy-MM-dd');
  const isRequestingToday = (!start && !end) || (start === today || end === today);

  // Get scoreboard and timer data for "today" metrics
  const scoreboardData = await getScoreboardData();
  const timerData = await getBagTimerData();

  // Get extended daily data for historical/rolling averages
  const days = 30;
  const dailyData = await getExtendedDailyData(days);

  // Filter by date range if provided
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

    // If no data for requested range and not requesting today with live data
    if (filteredData.length === 0) {
      if (isRequestingToday && scoreboardData.todayLbs > 0) {
        // We have live data for today from scoreboard - use it
        showingFallback = false;
      } else if (dailyData.length > 0) {
        // Fall back to most recent working day
        const mostRecent = dailyData[dailyData.length - 1];
        filteredData = [mostRecent];
        showingFallback = true;
        fallbackDate = formatDatePT(mostRecent.date, 'yyyy-MM-dd');
      }
    }
  }

  // Calculate rolling averages from last 7 days with data
  const validDays = dailyData.filter((d) => d.totalTops > 0).slice(-7);
  const rollingAverage = {
    totalTops: validDays.length > 0 ? validDays.reduce((s, d) => s + d.totalTops, 0) / validDays.length : 0,
    totalSmalls: validDays.length > 0 ? validDays.reduce((s, d) => s + d.totalSmalls, 0) / validDays.length : 0,
    avgRate: validDays.length > 0 ? validDays.reduce((s, d) => s + d.avgRate, 0) / validDays.length : 0,
    totalLbs: validDays.length > 0 ? validDays.reduce((s, d) => s + (d.totalTops + d.totalSmalls), 0) / validDays.length : 0,
  };

  // Build "today" object from scoreboard data (live production metrics)
  const todayData = {
    totalTops: scoreboardData.todayLbs || 0,
    totalSmalls: 0, // Scoreboard doesn't track smalls separately for today
    totalLbs: scoreboardData.todayLbs || 0,
    avgRate: scoreboardData.hourlyRates && scoreboardData.hourlyRates.length > 0
      ? scoreboardData.hourlyRates.reduce((s, h) => s + h.rate, 0) / scoreboardData.hourlyRates.length
      : 0,
    maxRate: scoreboardData.hourlyRates && scoreboardData.hourlyRates.length > 0
      ? Math.max(...scoreboardData.hourlyRates.map((h) => h.rate))
      : 0,
    trimmers: scoreboardData.lastHourTrimmers || scoreboardData.currentHourTrimmers || 0,
    buckers: 0,
    qc: 0,
    tzero: 0,
    totalOperatorHours: (scoreboardData.effectiveHours || 0) * (scoreboardData.lastHourTrimmers || 0),
    totalTrimmerHours: (scoreboardData.effectiveHours || 0) * (scoreboardData.lastHourTrimmers || 0),
    totalLaborCost: 0,
    costPerLb: 0,
  };

  // If showing fallback, override todayData with fallback day's data
  if (showingFallback && filteredData.length > 0) {
    const fb = filteredData[0];
    todayData.totalTops = fb.totalTops || 0;
    todayData.totalSmalls = fb.totalSmalls || 0;
    todayData.totalLbs = (fb.totalTops || 0) + (fb.totalSmalls || 0);
    todayData.avgRate = fb.avgRate || 0;
    todayData.trimmers = fb.trimmers || 0;
    todayData.totalTrimmerHours = fb.trimmerHours || 0;
  }

  // Build "current" object (strain, projections)
  const current = {
    strain: scoreboardData.strain || '',
    todayPercentage: scoreboardData.todayPercentage || 0,
    todayTarget: scoreboardData.todayTarget || 0,
    projectedTotal: scoreboardData.projectedTotal || 0,
    effectiveHours: scoreboardData.effectiveHours || 0,
  };

  // Build targets
  const targets = {
    totalTops: scoreboardData.dailyGoal || 66,
  };

  // Build bag timer data
  const bagTimer = {
    bagsToday: timerData.bagsToday || 0,
    avgTime: timerData.avgSecondsToday > 0 ? `${Math.round(timerData.avgSecondsToday / 60)} min` : '--',
    vsTarget: timerData.targetSeconds > 0 && timerData.avgSecondsToday > 0
      ? `${timerData.avgSecondsToday < timerData.targetSeconds ? '-' : '+'}${Math.abs(Math.round((timerData.avgSecondsToday - timerData.targetSeconds) / 60))} min`
      : '--',
  };

  // Build hourly data from scoreboard
  const hourly = (scoreboardData.hourlyRates || []).map((h) => ({
    label: h.timeSlot,
    tops: h.rate * (scoreboardData.lastHourTrimmers || 1), // Approximate
    rate: h.rate,
    target: h.target,
  }));

  return success(res, {
    // Main data structure expected by frontend
    today: todayData,
    current,
    targets,
    bagTimer,
    hourly,
    rollingAverage,
    // Historical daily data
    daily: filteredData.map((d) => ({
      date: formatDatePT(d.date, 'yyyy-MM-dd'),
      totalTops: Math.round(d.totalTops * 10) / 10,
      totalSmalls: Math.round(d.totalSmalls * 10) / 10,
      avgRate: Math.round(d.avgRate * 100) / 100,
    })),
    // Include fallback info so frontend can show appropriate message
    fallback: showingFallback ? {
      active: true,
      date: fallbackDate,
      requestedRange: { start, end },
    } : null,
  });
}

/**
 * Get scoreboard order queue from Orders API
 */
async function getScoreboardOrderQueue(req, res) {
  try {
    const response = await fetch(`${ORDERS_API_URL}?action=getScoreboardOrderQueue`);
    const data = await response.json();

    return success(res, data.data || data);
  } catch (error) {
    console.error('Error getting order queue:', error.message);
    return success(res, {
      success: false,
      error: error.message,
      current: null,
      next: null,
      queue: { totalShipments: 0, totalKg: 0 },
    });
  }
}

/**
 * Set shift start time
 */
async function setShiftStart(req, res) {
  const timeParam = req.query.time;

  // If no time provided, use current server time (one-click button)
  const timestamp = timeParam ? new Date(timeParam) : new Date();
  const today = new Date();

  // Validation - must be same day
  if (formatDatePT(timestamp, 'yyyy-MM-dd') !== formatDatePT(today, 'yyyy-MM-dd')) {
    throw createError('VALIDATION_ERROR', 'Can only set start time for today');
  }

  if (timestamp > today) {
    throw createError('VALIDATION_ERROR', 'Cannot set future start time');
  }

  // Calculate available hours
  const shiftEnd = new Date(timestamp);
  shiftEnd.setHours(16, 30, 0, 0);
  const totalMinutes = (shiftEnd - timestamp) / 60000;

  // Subtract scheduled breaks
  const breaks = [
    [9, 0, 9, 10],
    [12, 0, 12, 30],
    [14, 30, 14, 40],
    [16, 20, 16, 30],
  ];

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
  const normalHours = 8.5;
  const scaleFactor = availableHours / normalHours;
  const baselineDailyGoal = 200;
  const adjustedGoal = Math.round(baselineDailyGoal * scaleFactor);

  // Log to Shift Adjustments sheet
  const dateStr = formatDatePT(today, 'yyyy-MM-dd');
  const shiftStartStr = formatDatePT(timestamp, 'HH:mm:ss');
  const setAtStr = formatDatePT(today, 'HH:mm:ss');

  await appendSheet(SHEET_ID, `'${SHEETS.shiftAdjustments}'!A:F`, [
    [dateStr, shiftStartStr, setAtStr, availableHours.toFixed(2), scaleFactor.toFixed(3), ''],
  ]);

  return success(res, {
    shiftAdjustment: {
      manualStartTime: timestamp.toISOString(),
      availableHours,
      scaleFactor,
      adjustedDailyGoal: adjustedGoal,
    },
  });
}

/**
 * Get shift start time
 */
async function getShiftStart(req, res) {
  const date = req.query.date || formatDatePT(new Date(), 'yyyy-MM-dd');

  try {
    const vals = await readSheet(SHEET_ID, `'${SHEETS.shiftAdjustments}'!A:F`);
    if (!vals || vals.length <= 1) {
      return success(res, { shiftAdjustment: null });
    }

    // Find today's entry (most recent)
    for (let i = vals.length - 1; i >= 1; i--) {
      const cellDate = formatDatePT(new Date(vals[i][0]), 'yyyy-MM-dd');
      if (cellDate === date) {
        return success(res, {
          shiftAdjustment: {
            manualStartTime: `${date}T${vals[i][1]}`,
            availableHours: parseFloat(vals[i][3]) || 0,
            scaleFactor: parseFloat(vals[i][4]) || 1,
          },
        });
      }
    }

    return success(res, { shiftAdjustment: null });
  } catch (_error) {
    return success(res, { shiftAdjustment: null });
  }
}

/**
 * Get morning report data
 */
async function morningReport(req, res) {
  const now = new Date();
  const dailyData = await getExtendedDailyData(14);

  // Sort by date descending
  dailyData.sort((a, b) => b.date - a.date);

  // Find yesterday (skip today)
  const today = formatDatePT(now, 'yyyy-MM-dd');
  const filteredDays = dailyData.filter((d) => {
    const dateStr = formatDatePT(d.date, 'yyyy-MM-dd');
    return dateStr !== today;
  });

  const yesterday = filteredDays[0] || null;
  const dayBefore = filteredDays[1] || null;

  return success(res, {
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

// ===== POST HANDLERS =====

/**
 * Log manual bag completion
 */
async function logBag(req, res, body) {
  const size = body.size || '5 kg.';
  const now = new Date();

  // Get headers to find column indices
  const headerRow = await readSheet(SHEET_ID, `'${SHEETS.tracking}'!1:1`);
  if (!headerRow || !headerRow[0]) {
    throw createError('INTERNAL_ERROR', 'Tracking sheet not found');
  }

  const headers = headerRow[0];
  const timestampCol = headers.indexOf('Timestamp');
  const sizeCol = headers.indexOf('Size');

  if (timestampCol === -1 || sizeCol === -1) {
    throw createError('INTERNAL_ERROR', 'Required columns not found');
  }

  // Build row
  const newRow = new Array(headers.length).fill('');
  newRow[timestampCol] = now.toISOString();
  newRow[sizeCol] = size;

  await appendSheet(SHEET_ID, `'${SHEETS.tracking}'!A:Z`, [newRow]);

  return success(res, {
    timestamp: now.toISOString(),
    size,
  });
}

/**
 * Log timer pause
 */
async function logPause(req, res, body) {
  const reason = sanitizeForSheets(body.reason || 'No reason provided');
  const now = new Date();
  const pauseId = now.getTime().toString();

  const dateStr = formatDatePT(now, 'yyyy-MM-dd');
  const timeStr = formatDatePT(now, 'HH:mm:ss');

  await appendSheet(SHEET_ID, `'${SHEETS.pauseLog}'!A:G`, [
    [pauseId, dateStr, timeStr, '', '', reason, 'Scoreboard'],
  ]);

  return success(res, {
    pauseId,
    timestamp: now.toISOString(),
    reason,
  });
}

/**
 * Log timer resume
 */
async function logResume(req, res, body) {
  const pauseId = body.pauseId;
  const actualDurationSeconds = body.duration || 0;

  if (!pauseId) {
    throw createError('VALIDATION_ERROR', 'Missing pauseId');
  }

  const now = new Date();
  const timeStr = formatDatePT(now, 'HH:mm:ss');
  const durationMin = Math.round(actualDurationSeconds / 60 * 10) / 10;

  // Find and update the pause record
  const vals = await readSheet(SHEET_ID, `'${SHEETS.pauseLog}'!A:G`);
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0]) === pauseId) {
      // Update resume time and duration
      await writeSheet(SHEET_ID, `'${SHEETS.pauseLog}'!D${i + 1}:E${i + 1}`, [[timeStr, durationMin]]);
      return success(res, {
        pauseId,
        resumeTime: now.toISOString(),
        durationMinutes: durationMin,
      });
    }
  }

  throw createError('NOT_FOUND', `Pause record not found: ${pauseId}`);
}

// ===== INTERNAL ORDERS =====

/**
 * Get internal orders
 */
async function getOrders(req, res) {
  const vals = await readSheet(SHEET_ID, `'${SHEETS.orders}'!A:I`);
  if (!vals || vals.length <= 1) {
    return success(res, { orders: [] });
  }

  const orders = [];
  for (let i = 1; i < vals.length; i++) {
    const row = vals[i];
    if (!row[0]) continue;

    let pallets = [];
    try {
      pallets = JSON.parse(row[8] || '[]');
    } catch (_e) {
      pallets = [];
    }

    orders.push({
      id: row[0],
      customer: row[1],
      totalKg: parseFloat(row[2]) || 0,
      completedKg: parseFloat(row[3]) || 0,
      status: row[4] || 'pending',
      createdDate: row[5] || null,
      dueDate: row[6] || null,
      notes: row[7] || '',
      pallets,
    });
  }

  return success(res, { orders });
}

/**
 * Get single order
 */
async function getOrder(req, res) {
  const orderId = req.query.id;
  if (!orderId) {
    throw createError('VALIDATION_ERROR', 'Missing order ID');
  }

  const vals = await readSheet(SHEET_ID, `'${SHEETS.orders}'!A:I`);
  for (let i = 1; i < vals.length; i++) {
    const row = vals[i];
    if (row[0] === orderId) {
      let pallets = [];
      try {
        pallets = JSON.parse(row[8] || '[]');
      } catch (_e) {
        pallets = [];
      }

      return success(res, {
        order: {
          id: row[0],
          customer: row[1],
          totalKg: parseFloat(row[2]) || 0,
          completedKg: parseFloat(row[3]) || 0,
          status: row[4] || 'pending',
          createdDate: row[5] || null,
          dueDate: row[6] || null,
          notes: row[7] || '',
          pallets,
        },
      });
    }
  }

  throw createError('NOT_FOUND', 'Order not found');
}

/**
 * Save order
 */
async function saveOrder(req, res, body) {
  const orderData = body;

  if (!orderData.id) {
    throw createError('VALIDATION_ERROR', 'Missing order ID');
  }

  const vals = await readSheet(SHEET_ID, `'${SHEETS.orders}'!A:I`);
  let rowIndex = -1;

  for (let i = 1; i < vals.length; i++) {
    if (vals[i][0] === orderData.id) {
      rowIndex = i + 1;
      break;
    }
  }

  const rowData = [
    orderData.id,
    sanitizeForSheets(orderData.customer),
    orderData.totalKg || 0,
    orderData.completedKg || 0,
    orderData.status || 'pending',
    orderData.createdDate || formatDatePT(new Date(), 'yyyy-MM-dd'),
    orderData.dueDate || '',
    sanitizeForSheets(orderData.notes || ''),
    JSON.stringify(orderData.pallets || []),
  ];

  if (rowIndex > 0) {
    await writeSheet(SHEET_ID, `'${SHEETS.orders}'!A${rowIndex}:I${rowIndex}`, [rowData]);
  } else {
    await appendSheet(SHEET_ID, `'${SHEETS.orders}'!A:I`, [rowData]);
  }

  return success(res, { order: orderData });
}

/**
 * Delete order
 */
async function deleteOrder(req, res, body) {
  const orderId = body.id;
  if (!orderId) {
    throw createError('VALIDATION_ERROR', 'Missing order ID');
  }

  const vals = await readSheet(SHEET_ID, `'${SHEETS.orders}'!A:I`);
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][0] === orderId) {
      // Clear the row
      await writeSheet(SHEET_ID, `'${SHEETS.orders}'!A${i + 1}:I${i + 1}`,
        [['', '', '', '', '', '', '', '', '']]);
      return success(res, { deleted: orderId });
    }
  }

  throw createError('NOT_FOUND', 'Order not found');
}

// ===== AI CHAT =====

/**
 * Handle chat request
 */
async function chat(req, res, body) {
  if (!ANTHROPIC_API_KEY) {
    throw createError('INTERNAL_ERROR', 'AI chat not configured');
  }

  const userMessage = body.userMessage || '';
  const history = body.history || [];

  if (!userMessage) {
    throw createError('VALIDATION_ERROR', 'No message provided');
  }

  // Gather production context
  const scoreboardData = await getScoreboardData();
  const timerData = await getBagTimerData();

  const context = {
    production: {
      topsToday: scoreboardData.todayLbs || 0,
      strain: scoreboardData.strain || 'Unknown',
      lastHourLbs: scoreboardData.lastHourLbs || 0,
      hoursLogged: scoreboardData.hoursLogged || 0,
      todayPercentage: scoreboardData.todayPercentage || 0,
      todayTarget: scoreboardData.todayTarget || 0,
    },
    crew: {
      currentTrimmers: scoreboardData.currentHourTrimmers || 0,
      lastHourTrimmers: scoreboardData.lastHourTrimmers || 0,
    },
    bags: {
      fiveKgToday: timerData.bags5kgToday || 0,
      totalToday: timerData.bagsToday || 0,
      avgCycleSeconds: timerData.avgSecondsToday || 0,
    },
    rates: {
      targetRate: scoreboardData.targetRate || 1.0,
    },
  };

  // Build system prompt
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

  const systemPrompt = `You are the Rogue Origin AI Assistant, helping manage a hemp processing facility in Southern Oregon.

CURRENT TIME: ${currentTime}

TODAY'S PRODUCTION:
- Tops produced: ${context.production.topsToday.toFixed(1)} lbs
- Target: ${context.production.todayTarget.toFixed(1)} lbs
- Performance: ${Math.round(context.production.todayPercentage)}%
- Hours logged: ${context.production.hoursLogged}
- Current strain: ${context.production.strain}
- Last hour: ${context.production.lastHourLbs.toFixed(1)} lbs

CREW STATUS:
- Current trimmers: ${context.crew.currentTrimmers}
- Target rate: ${context.rates.targetRate.toFixed(2)} lbs/trimmer/hour

BAG COMPLETION:
- 5kg bags today: ${context.bags.fiveKgToday}
- Avg cycle time: ${Math.round(context.bags.avgCycleSeconds / 60)} minutes

GUIDELINES:
- Be concise and helpful
- Use available data to answer questions
- If asked about something you don't have data for, say so
- Support both English and Spanish`;

  // Build messages for API
  const messages = [];
  for (const msg of history.slice(-10)) { // Last 10 messages
    messages.push({
      role: msg.role,
      content: msg.content,
    });
  }
  messages.push({ role: 'user', content: userMessage });

  // Call Anthropic API
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
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
    const errorText = await response.text();
    console.error('Anthropic API error:', errorText);
    throw createError('INTERNAL_ERROR', 'AI service error');
  }

  const aiResult = await response.json();
  const aiResponse = aiResult.content?.[0]?.text || 'Sorry, I could not generate a response.';

  return success(res, {
    response: aiResponse,
    context,
  });
}

/**
 * Log chat feedback
 */
async function feedback(req, res, body) {
  // Simple logging for now
  console.log('Chat feedback:', JSON.stringify(body));
  return success(res, { logged: true });
}

/**
 * Text-to-speech
 */
async function tts(req, res, body) {
  if (!GOOGLE_TTS_API_KEY) {
    throw createError('INTERNAL_ERROR', 'TTS not configured');
  }

  const text = body.text;
  if (!text) {
    throw createError('VALIDATION_ERROR', 'No text provided');
  }

  // Truncate long text
  const truncatedText = text.length > 5000 ? `${text.substring(0, 5000)}...` : text;

  const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text: truncatedText },
      voice: {
        languageCode: 'en-US',
        name: 'en-US-Neural2-A',
        ssmlGender: 'MALE',
      },
      audioConfig: {
        audioEncoding: 'MP3',
        pitch: 0.0,
        speakingRate: 1.1,
      },
    }),
  });

  if (!response.ok) {
    throw createError('INTERNAL_ERROR', 'TTS API error');
  }

  const result = await response.json();
  if (result.audioContent) {
    return success(res, { audioBase64: result.audioContent });
  }

  throw createError('INTERNAL_ERROR', 'TTS failed to generate audio');
}

// ===== EXPORT HANDLER =====

module.exports = createHandler({
  // GET endpoints
  test,
  scoreboard,
  dashboard,
  getOrders,
  getOrder,
  getScoreboardOrderQueue,
  setShiftStart,
  getShiftStart,
  morningReport,

  // POST endpoints
  logBag,
  logPause,
  logResume,
  chat,
  feedback,
  tts,
  saveOrder,
  deleteOrder,
});
