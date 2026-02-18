/**
 * Bag tracking handlers — logBag, logPause, logResume, getBagTimerData, debugBags.
 */

import { query, queryOne, insert, execute } from '../../lib/db.js';
import { successResponse, errorResponse } from '../../lib/response.js';
import {
  BREAKS,
  TIME_SLOT_MULTIPLIERS,
  TIMEZONE,
  getTimeSlotMultiplier,
  parseSlotTimeToMinutes,
} from '../../lib/production-helpers.js';
import {
  formatDatePT,
  getConfig,
  incrementDataVersion,
} from '../../lib/production-utils.js';

// Blacklist for test/accidental bag scans
const BLACKLISTED_BAGS = [
  // Double-scan: 28 seconds after previous bag (2026-02-17)
  { exact: new Date('2026-02-17T16:49:53Z'), tolerance: 5000 },
];

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

function is5kgBag(size) {
  const s = String(size || '').toLowerCase().replace(/\s+/g, '');
  return s.includes('5kg') || s.includes('5 kg');
}

function parseHumanTimestamp(timestamp) {
  if (!timestamp) return null;
  const str = String(timestamp).trim();

  const direct = new Date(str);
  if (!isNaN(direct.getTime()) && !str.includes(' at ')) {
    return direct;
  }

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

    const date = new Date(Date.UTC(
      parseInt(year, 10),
      monthNum,
      parseInt(day, 10),
      hourNum + 8,
      parseInt(minute, 10)
    ));
    return date;
  }

  return null;
}

/**
 * Calculate total break minutes that fall within a time window.
 * Break times are in PST (America/Los_Angeles).
 */
function getBreakMinutesInWindow(startTime, endTime) {
  let breakMinutes = 0;
  const pstDateStr = endTime.toLocaleDateString('en-CA', { timeZone: TIMEZONE });

  for (const [breakHour, breakMin, duration] of BREAKS) {
    const breakTimeStr = `${pstDateStr}T${String(breakHour).padStart(2, '0')}:${String(breakMin).padStart(2, '0')}:00`;

    const pstFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });

    const testDate = new Date(pstDateStr + 'T12:00:00Z');
    const pstParts = pstFormatter.formatToParts(testDate);
    const pstHour = parseInt(pstParts.find(p => p.type === 'hour').value);
    const offsetHours = 12 - pstHour;

    const breakStartUTC = new Date(breakTimeStr + 'Z');
    breakStartUTC.setUTCHours(breakStartUTC.getUTCHours() + offsetHours);
    const breakEndUTC = new Date(breakStartUTC.getTime() + duration * 60000);

    if (breakEndUTC > startTime && breakStartUTC < endTime) {
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
    const today = date || formatDatePT(new Date(), 'yyyy-MM-dd');
    const now = date ? new Date(date + 'T23:59:59') : new Date();

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

    const { getScoreboardData } = await import('./scoreboard.js');
    const scoreboardData = await getScoreboardData(env, today);
    result.currentTrimmers = scoreboardData.currentHourTrimmers || scoreboardData.lastHourTrimmers || 0;
    const currentHourRates = (scoreboardData.hourlyRates || []);
    if (currentHourRates.length > 0) {
      const lastRate = currentHourRates[currentHourRates.length - 1];
      if (lastRate.effectiveTrimmers) {
        result.currentTrimmers = lastRate.effectiveTrimmers;
      }
    }
    result.targetRate = scoreboardData.targetRate || 1.0;

    const bagWeightLbs = 11.0231;
    const teamRateLbsPerHour = result.currentTrimmers * result.targetRate;
    if (teamRateLbsPerHour > 0) {
      const baseTargetSeconds = Math.round((bagWeightLbs / teamRateLbsPerHour) * 3600);

      const currentTimeSlot = scoreboardData.currentTimeSlot || '';
      const timeSlotMultipliers = (await getConfig(env, 'schedule.time_slot_multipliers')) ?? TIME_SLOT_MULTIPLIERS;
      const hourMultiplier = getTimeSlotMultiplier(currentTimeSlot, timeSlotMultipliers);

      if (hourMultiplier > 0 && hourMultiplier < 1.0) {
        result.targetSeconds = Math.round(baseTargetSeconds / hourMultiplier);
      } else {
        result.targetSeconds = baseTargetSeconds;
      }
    }

    if (!bags || bags.length === 0) {
      return result;
    }

    const todayBags = [];
    const seenFlowRunIds = new Set();
    const seenTimestamps = new Map();
    let lastBag = null;

    for (const row of bags) {
      const rowDate = new Date(row.timestamp);
      if (isNaN(rowDate.getTime())) continue;

      if (isBlacklistedBag(rowDate)) {
        console.log(`Blacklisted bag skipped: ${row.timestamp}`);
        continue;
      }

      if (row.flow_run_id && seenFlowRunIds.has(row.flow_run_id)) {
        console.log(`Skipping duplicate flow_run_id: ${row.flow_run_id} at ${row.timestamp}`);
        continue;
      }
      if (row.flow_run_id) {
        seenFlowRunIds.add(row.flow_run_id);
      }

      let isDuplicate = false;
      if (row.flow_run_id && row.flow_run_id.includes('T') && row.flow_run_id.includes('Z')) {
        const match = row.flow_run_id.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/);
        if (match) {
          const embeddedTimestamp = match[1];
          const embeddedDate = new Date(embeddedTimestamp);

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
        const rawDiffSec = Math.floor((todayBags[i] - todayBags[i - 1]) / 1000);
        const breakMins = getBreakMinutesInWindow(todayBags[i - 1], todayBags[i]);
        const diffSec = rawDiffSec - (breakMins * 60);
        if (diffSec >= 300 && diffSec <= 14400) {
          cycleTimes.push(diffSec);
        }
      }
      if (cycleTimes.length > 0) {
        result.avgSecondsToday = Math.round(cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length);
      }
    }

    // Build per-hour trimmer lookup
    const hourlyTrimmerMap = [];
    for (const h of (scoreboardData.hourlyRates || [])) {
      if (!h.timeSlot) continue;
      const parts = String(h.timeSlot).replace(/[-–—]/g, '–').split('–').map(s => s.trim());
      if (parts.length === 2) {
        const startMin = parseSlotTimeToMinutes(parts[0]);
        const endMin = parseSlotTimeToMinutes(parts[1]);
        if (startMin !== null && endMin !== null) {
          const trimmers = h.effectiveTrimmers || h.trimmers || 0;
          const timeSlotMultipliers = (await getConfig(env, 'schedule.time_slot_multipliers')) ?? TIME_SLOT_MULTIPLIERS;
          hourlyTrimmerMap.push({
            startMin, endMin,
            trimmers,
            multiplier: h.multiplier || getTimeSlotMultiplier(h.timeSlot, timeSlotMultipliers),
          });
        }
      }
    }

    function getTrimmersAtMinute(pstMinute) {
      for (const slot of hourlyTrimmerMap) {
        if (pstMinute >= slot.startMin && pstMinute < slot.endMin) {
          return { trimmers: slot.trimmers, multiplier: slot.multiplier };
        }
      }
      return { trimmers: result.currentTrimmers, multiplier: 1.0 };
    }

    function calcTargetSeconds(trimmers, multiplier) {
      const teamRate = trimmers * result.targetRate;
      if (teamRate <= 0) return result.targetSeconds;
      const base = Math.round((bagWeightLbs / teamRate) * 3600);
      return (multiplier > 0 && multiplier < 1.0) ? Math.round(base / multiplier) : base;
    }

    if (todayBags.length > 1) {
      todayBags.sort((a, b) => b - a);
      for (let i = 0; i < Math.min(todayBags.length - 1, 20); i++) {
        const rawCycleSec = Math.floor((todayBags[i] - todayBags[i + 1]) / 1000);
        const breakMins = getBreakMinutesInWindow(todayBags[i + 1], todayBags[i]);
        const cycleSec = rawCycleSec - (breakMins * 60);
        if (cycleSec >= 300 && cycleSec <= 14400) {
          const midpoint = new Date((todayBags[i].getTime() + todayBags[i + 1].getTime()) / 2);
          const midpointPST = formatDatePT(midpoint, 'HH:mm:ss');
          const [mH, mM] = midpointPST.split(':').map(Number);
          const midMin = mH * 60 + mM;
          const { trimmers: cycleTrimmers, multiplier: cycleMult } = getTrimmersAtMinute(midMin);
          const cycleTarget = calcTargetSeconds(cycleTrimmers, cycleMult);

          result.cycleHistory.push({
            timestamp: todayBags[i].toISOString(),
            time: cycleSec,
            target: cycleTarget,
            trimmers: cycleTrimmers,
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

// ===== ACTION HANDLERS =====

async function logBag(body, env) {
  const size = body.size || '5 kg.';
  const now = new Date();
  const sku = 'MANUAL-5KG-BAG';
  const flowRunId = `MANUAL-5KG-${now.toISOString()}`;

  // Write to inventory_adjustments (where bag timer reads from)
  await insert(env.DB, 'inventory_adjustments', {
    timestamp: now.toISOString(),
    size: '5kg',
    sku: sku,
    product_name: 'Manual 5KG Bag Scan',
    flow_run_id: flowRunId,
  });

  // Also write to production_tracking for legacy tracking
  await insert(env.DB, 'production_tracking', {
    timestamp: now.toISOString(),
    bag_type: size,
    weight: size.includes('5') ? 5 : 0,
    source: 'manual',
  });

  await incrementDataVersion(env);

  return successResponse({ timestamp: now.toISOString(), size });
}

async function logPause(body, env) {
  const reason = (body.reason || 'No reason provided');
  const now = new Date();
  const pauseId = now.getTime().toString();

  await insert(env.DB, 'pause_log', {
    start_time: now.toISOString(),
    reason,
    created_by: 'Scoreboard',
  });

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

    await incrementDataVersion(env);
  }

  return successResponse({ pauseId, resumeTime: now.toISOString(), durationMinutes: durationMin });
}

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

export {
  getBagTimerData,
  logBag,
  logPause,
  logResume,
  debugBags,
};
