/**
 * Scoreboard & dashboard handlers.
 */

import { query, queryOne } from '../../lib/db.js';
import { successResponse, errorResponse } from '../../lib/response.js';
import { validateDate } from '../../lib/validate.js';
import {
  ALL_TIME_SLOTS,
  TIME_SLOT_MULTIPLIERS,
  TIMEZONE,
  getTimeSlotMultiplier,
  calculateDailyProjection,
} from '../../lib/production-helpers.js';
import {
  TOTAL_LABOR_COST_PER_HOUR,
  BASE_WAGE_RATE,
  EMPLOYER_TAX_RATE,
  formatDatePT,
  getConfig,
  getEffectiveTargetRate,
} from '../../lib/production-utils.js';
import { parseSlotTimeToMinutes } from '../../lib/production-helpers.js';

// ===== SCOREBOARD DATA =====

async function getScoreboardData(env, date = null) {
  const today = date || formatDatePT(new Date(), 'yyyy-MM-dd');

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

  const todayRows = await query(env.DB, `
    SELECT time_slot, cultivar1, tops_lbs1, smalls_lbs1, trimmers_line1, buckers_line1,
           effective_trimmers_line1, qc
    FROM monthly_production
    WHERE production_date = ?
  `, [today]);

  if (todayRows.length === 0) return result;

  const rowsBySlot = {};
  // Dedup: if two rows share the same end-hour (e.g. "7:01 AM – 8:00 AM" and "7:02 AM – 8:00 AM"),
  // keep the one with more tops lbs (the more complete entry). Key by normalized end-hour.
  const getEndHour = (ts) => {
    const parts = (ts || '').replace(/[-–—]/g, '–').split('–');
    return parts.length > 1 ? parts[1].trim() : (ts || '').trim();
  };

  todayRows.forEach(r => {
    const slot = (r.time_slot || '').replace(/[-–—]/g, '–');
    const endKey = getEndHour(slot);
    const rawTrimmers = r.trimmers_line1 || 0;
    const effectiveTrimmers = r.effective_trimmers_line1 != null ? r.effective_trimmers_line1 : rawTrimmers;
    const entry = {
      timeSlot: r.time_slot || '',
      tops: r.tops_lbs1 || 0,
      smalls: r.smalls_lbs1 || 0,
      trimmers: effectiveTrimmers,
      rawTrimmers,
      buckers: r.buckers_line1 || 0,
      strain: r.cultivar1 || '',
      multiplier: getTimeSlotMultiplier(r.time_slot, timeSlotMultipliers),
      notes: r.qc || '',
    };
    // If we already have an entry for this end-hour, keep the one with more data
    const existing = rowsBySlot[endKey];
    if (!existing || entry.tops > existing.tops) {
      rowsBySlot[endKey] = entry;
    }
  });

  const allSlotsFromDB = todayRows.map(r => getEndHour((r.time_slot || '').replace(/[-–—]/g, '–')));
  const uniqueSlots = [...new Set([...ALL_TIME_SLOTS.map(s => getEndHour(s.replace(/[-–—]/g, '–'))), ...allSlotsFromDB])];

  const parseSlotStart = (ts) => {
    const m = (ts || '').match(/^(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return 9999;
    let h = parseInt(m[1]), min = parseInt(m[2]);
    if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
    if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
    return h * 60 + min;
  };
  uniqueSlots.sort((a, b) => parseSlotStart(a) - parseSlotStart(b));

  const rows = uniqueSlots
    .map(slot => rowsBySlot[slot])
    .filter(r => r !== undefined);

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

  let activeStrain = '';
  if (currentHourIndex >= 0 && rows[currentHourIndex].strain) {
    activeStrain = rows[currentHourIndex].strain;
  } else if (lastCompletedHourIndex >= 0 && rows[lastCompletedHourIndex].strain) {
    activeStrain = rows[lastCompletedHourIndex].strain;
  }
  result.strain = activeStrain;

  const targetRate = await getEffectiveTargetRate(env, 2, timeSlotMultipliers, activeStrain);
  result.targetRate = targetRate;

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

  if (lastCompletedHourIndex >= 0) {
    const lastRow = rows[lastCompletedHourIndex];
    result.lastHourLbs = lastRow.tops;
    result.lastHourSmalls = lastRow.smalls;
    result.lastHourTrimmers = lastRow.rawTrimmers;
    result.lastHourEffectiveTrimmers = lastRow.trimmers;
    result.lastHourBuckers = lastRow.buckers || 0;
    result.lastHourMultiplier = lastRow.multiplier;
    result.lastHourTarget = lastRow.trimmers * targetRate * lastRow.multiplier;
    result.lastTimeSlot = lastRow.timeSlot;
  }

  if (currentHourIndex >= 0) {
    const currentRow = rows[currentHourIndex];
    result.currentHourTrimmers = currentRow.rawTrimmers;
    result.currentHourEffectiveTrimmers = currentRow.trimmers;
    result.currentHourBuckers = currentRow.buckers || 0;
    result.currentHourMultiplier = currentRow.multiplier;
    result.currentHourTarget = currentRow.trimmers * targetRate * currentRow.multiplier;
    result.currentTimeSlot = currentRow.timeSlot;
  }

  result.todayLbs = totalLbs;
  result.hoursLogged = hoursWorked;
  result.effectiveHours = effectiveHours;

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
        trimmers: row.rawTrimmers,
        effectiveTrimmers: row.trimmers,
        buckers: row.buckers,
        lbs: row.tops,
        smalls: row.smalls,
        multiplier: row.multiplier,
        notes: row.notes || '',
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

  const projection = calculateDailyProjection(rows, lastCompletedHourIndex, currentHourIndex, targetRate, totalLbs, timeSlotMultipliers);
  result.projectedTotal = projection.projectedTotal;
  result.dailyGoal = projection.dailyGoal;

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
    const waterspiderHours = r.hours_with_data || 0;

    const topsRatio = totalLbs > 0 ? totalTops / totalLbs : 1;
    const smallsRatio = totalLbs > 0 ? totalSmalls / totalLbs : 0;

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

// ===== ACTION HANDLERS =====

async function scoreboard(params, env) {
  const date = params.date || null;

  if (date && !validateDate(date)) {
    return errorResponse('Invalid date format. Use YYYY-MM-DD', 'VALIDATION_ERROR', 400);
  }

  const { getBagTimerData } = await import('./bag-tracking.js');
  const scoreboardData = await getScoreboardData(env, date);
  const timerData = await getBagTimerData(env, date);

  return successResponse({
    scoreboard: scoreboardData,
    timer: timerData,
    date: date || formatDatePT(new Date(), 'yyyy-MM-dd'),
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

  const { getBagTimerData } = await import('./bag-tracking.js');
  const { getStrainSummary } = await import('./strain.js');

  const today = formatDatePT(new Date(), 'yyyy-MM-dd');
  const targetDate = end || start || today;
  const isViewingToday = targetDate === today;
  const scoreboardData = await getScoreboardData(env, isViewingToday ? null : targetDate);
  const timerData = await getBagTimerData(env, isViewingToday ? null : targetDate);

  let daysToFetch = 30;
  if (start) {
    const startDate = new Date(start + 'T00:00:00');
    const todayDate = new Date(today + 'T00:00:00');
    const diffMs = todayDate - startDate;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    daysToFetch = Math.max(30, diffDays + 1);
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

  let weightedRateSum = 0;
  let totalTrimmerHours = 0;
  for (const hour of (scoreboardData.hourlyRates || [])) {
    if (hour.trimmers && hour.rate != null) {
      weightedRateSum += hour.rate * hour.trimmers;
      totalTrimmerHours += hour.trimmers;
    }
  }

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
  const todayWaterspiderHours = todayOperatorData?.hours_with_data || 0;

  const todayTopsRatio = todayTotalLbs > 0 ? todayTops / todayTotalLbs : 1;
  const todaySmallsRatio = todayTotalLbs > 0 ? todaySmalls / todayTotalLbs : 0;

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

  const todayData = (!isViewingToday && filteredData.length > 0) ? {
    totalTops: filteredData[0].totalTops || 0,
    totalSmalls: filteredData[0].totalSmalls || 0,
    totalLbs: filteredData[0].totalLbs || 0,
    avgRate: filteredData[0].avgRate || 0,
    trimmers: filteredData[0].trimmerHours ? Math.round(filteredData[0].trimmerHours / 7.5) : 0,
    buckers: 0,
    tzero: 0,
    operatorHours: filteredData[0].operatorHours || 0,
    laborCost: filteredData[0].laborCost || 0,
    costPerLb: filteredData[0].costPerLb || 0,
    topsCostPerLb: filteredData[0].topsCostPerLb || 0,
    smallsCostPerLb: filteredData[0].smallsCostPerLb || 0,
  } : {
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

  const current = isViewingToday ? {
    strain: scoreboardData.strain || '',
    todayPercentage: scoreboardData.todayPercentage || 0,
    todayTarget: scoreboardData.todayTarget || 0,
    projectedTotal: scoreboardData.projectedTotal || 0,
    effectiveHours: scoreboardData.effectiveHours || 0,
  } : {
    strain: '',
    todayPercentage: 0,
    todayTarget: 0,
    projectedTotal: 0,
    effectiveHours: 0,
  };

  const targets = isViewingToday ? {
    totalTops: scoreboardData.dailyGoal || 66,
  } : {
    totalTops: 0,
  };

  const bagTimer = isViewingToday ? {
    bagsToday: timerData.bagsToday || 0,
    avgTime: timerData.avgSecondsToday > 0 ? `${Math.round(timerData.avgSecondsToday / 60)} min` : '--',
    vsTarget: timerData.targetSeconds > 0 && timerData.avgSecondsToday > 0
      ? `${timerData.avgSecondsToday < timerData.targetSeconds ? '-' : '+'}${Math.abs(Math.round((timerData.avgSecondsToday - timerData.targetSeconds) / 60))} min`
      : '--',
  } : {
    bagsToday: timerData.bagsToday || 0,
    avgTime: timerData.avgSecondsToday > 0 ? `${Math.round(timerData.avgSecondsToday / 60)} min` : '--',
    vsTarget: '--',
  };

  const hourly = isViewingToday ? (scoreboardData.hourlyRates || []).map((h) => ({
    label: h.timeSlot,
    rate: h.rate,
    target: h.target,
    trimmers: h.trimmers,
    buckers: h.buckers || 0,
    lbs: h.lbs,
    tops: h.lbs,
    smalls: h.smalls || 0,
  })) : [];

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

export {
  getScoreboardData,
  getExtendedDailyData,
  scoreboard,
  dashboard,
  morningReport,
};
