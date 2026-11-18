/**
 * Scoreboard & dashboard handlers.
 */

import { query } from '../../lib/db.js';
import { successResponse, errorResponse } from '../../lib/response.js';
import { validateDate } from '../../lib/validate.js';
import {
  TIME_SLOT_MULTIPLIERS,
  TIMEZONE,
  getTimeSlotMultiplier,
  getEndHour,
  buildSortedRows,
  findHourIndices,
  calculateDailyProjection,
} from '../../lib/production-helpers.js';
import {
  formatDatePT,
  getConfig,
  getLoadedLaborRate,
  getEffectiveTargetRate,
} from '../../lib/production-utils.js';
import { laborSplit, CELL_MODE_FROM } from '../../lib/labor-split.js';
import { MP_BY_CULTIVAR } from '../../lib/cultivar-parts.js';

// Inputs laborSplit needs, read once per request.
async function laborOptions(env) {
  return {
    loadedRate: await getLoadedLaborRate(env),
    inspectors: (await getConfig(env, 'labor.smalls_inspector_count')) ?? 1,
    multipliers: (await getConfig(env, 'schedule.time_slot_multipliers')) ?? TIME_SLOT_MULTIPLIERS,
    cellModeFrom: (await getConfig(env, 'labor.cell_mode_from')) ?? CELL_MODE_FROM,
  };
}
const LABOR_ROWS_SQL = `SELECT production_date, time_slot, trimmers_line1, buckers_line1, tzero_line1, tops_lbs1, smalls_lbs1
  FROM monthly_production`;

// ===== SCOREBOARD DATA =====

async function getScoreboardData(env, date = null) {
  const today = date || formatDatePT(new Date(), 'yyyy-MM-dd');

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
    usingStrainRate: false,
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
    // false = no hour today has a strain, so there is no target to grade
    // against: every target, percentage, delta, best and streak is 0, each
    // hourlyRates[].target included. Pounds, hours and projectedTotal (from the
    // actual pace) are still real. Also false on a day with no rows at all.
    graded: false,
  };

  const todayRows = await query(env.DB, `
    SELECT time_slot, cultivar1, tops_lbs1, smalls_lbs1, trimmers_line1, buckers_line1,
           effective_trimmers_line1, qc, change_cultivar
    FROM monthly_production
    WHERE production_date = ?
  `, [today]);

  if (todayRows.length === 0) return result;

  // Row-building (slot merge + chronological sort) is production-helpers.js's
  // own tested implementation (see tests/production-d1.test.mjs) — it
  // intentionally keeps every raw slot, duplicates included, since other
  // callers may want to see them all. The live scoreboard specifically wants
  // one row per real-world hour, so dedupe on top of its output (keep
  // whichever duplicate has more tops) rather than inside the shared builder.
  const { rows: rawRows } = buildSortedRows(todayRows, null, timeSlotMultipliers);

  const bestByEndHour = new Map();
  for (const row of rawRows) {
    const key = getEndHour(row.timeSlot);
    const existing = bestByEndHour.get(key);
    if (!existing || row.tops > existing.tops) {
      bestByEndHour.set(key, row);
    }
  }
  const rows = rawRows.filter(row => bestByEndHour.get(getEndHour(row.timeSlot)) === row);

  // One grading basis (review 2026-10-13, L2-01): an hour logged without a
  // strain is graded as the strain the crew was on, never a 0.85 guess. Blank
  // hours carry the previous hour's strain (the strain it changed to, if that
  // hour had a mid-hour change); leading blank hours take the day's first
  // strain. A day with no strain at all stays ungraded (graded: false) rather
  // than borrowing yesterday's strain, which may not be today's.
  const isBlank = (s) => !s || String(s).trim() === '';
  const changeToBySlot = new Map(todayRows.map(r => [r.time_slot || '', r.change_cultivar]));
  const firstStrain = rows.find(r => !isBlank(r.strain))?.strain || '';
  let carried = firstStrain;
  for (const row of rows) {
    if (isBlank(row.strain)) row.strain = carried;
    else carried = row.strain;
    const changeTo = changeToBySlot.get(row.timeSlot);
    if (!isBlank(changeTo)) carried = changeTo;
  }
  const graded = !isBlank(firstStrain);
  result.graded = graded;

  const { lastCompletedHourIndex, currentHourIndex } = findHourIndices(rows);

  let activeStrain = '';
  if (currentHourIndex >= 0 && rows[currentHourIndex].strain) {
    activeStrain = rows[currentHourIndex].strain;
  } else if (lastCompletedHourIndex >= 0 && rows[lastCompletedHourIndex].strain) {
    activeStrain = rows[lastCompletedHourIndex].strain;
  }
  result.strain = activeStrain;

  // Build strain-specific target rate map for all strains worked today
  const uniqueStrains = [...new Set(rows.map(r => r.strain).filter(s => s && s.trim() !== ''))];
  const strainTargetRates = new Map();
  
  for (const strain of uniqueStrains) {
    const rate = await getEffectiveTargetRate(env, 2, timeSlotMultipliers, strain);
    strainTargetRates.set(strain, rate);
  }

  // After the carry-forward every row has a strain unless the day is
  // ungraded, so a blank strain means "no target" (0), never a fallback.
  // (getEffectiveTargetRate itself still returns its 0.85 baseline for a
  // strain with no history at all.)
  const getTargetRateForStrain = (strain) => (isBlank(strain) ? 0 : (strainTargetRates.get(strain) ?? 0));

  // Each row carries its own target, so the hour badge, todayTarget, best,
  // streak and the day projection (calculateDailyProjection reads
  // row.targetRate) are all on one basis.
  for (const row of rows) row.targetRate = getTargetRateForStrain(row.strain);

  // Active strain's target rate (for display; also the rate for hours not
  // logged yet in the projection)
  const targetRate = getTargetRateForStrain(activeStrain);
  result.targetRate = targetRate;

  // Flag whether we're using strain-specific data (vs no basis)
  result.usingStrainRate = !!activeStrain && strainTargetRates.has(activeStrain);

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
    const lastRowTargetRate = lastRow.targetRate;
    result.lastHourLbs = lastRow.tops;
    result.lastHourSmalls = lastRow.smalls;
    result.lastHourTrimmers = lastRow.rawTrimmers;
    result.lastHourEffectiveTrimmers = lastRow.trimmers;
    result.lastHourBuckers = lastRow.buckers || 0;
    result.lastHourMultiplier = lastRow.multiplier;
    result.lastHourTarget = lastRow.trimmers * lastRowTargetRate * lastRow.multiplier;
    result.lastTimeSlot = lastRow.timeSlot;
  }

  if (currentHourIndex >= 0) {
    const currentRow = rows[currentHourIndex];
    const currentRowTargetRate = currentRow.targetRate;
    result.currentHourTrimmers = currentRow.rawTrimmers;
    result.currentHourEffectiveTrimmers = currentRow.trimmers;
    result.currentHourBuckers = currentRow.buckers || 0;
    result.currentHourMultiplier = currentRow.multiplier;
    result.currentHourTarget = currentRow.trimmers * currentRowTargetRate * currentRow.multiplier;
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
  let currentStreak = 0;

  for (let i = 0; i <= lastCompletedHourIndex && i < rows.length; i++) {
    const row = rows[i];
    if (row.trimmers > 0 && row.tops > 0) {
      // This hour's own strain target (the same one the projection uses)
      const rowTargetRate = row.targetRate;

      if (graded) {
        const hourTarget = row.trimmers * rowTargetRate * row.multiplier;
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
        } else {
          currentStreak = 0;
        }
      }

      const rate = (row.tops / row.trimmers) / row.multiplier;
      hourlyRates.push({
        timeSlot: row.timeSlot,
        rate,
        // row's own strain target; 0 when ungraded (a number, not null:
        // scoreboard-v2 chart.js calls h.target.toFixed)
        target: graded ? rowTargetRate : 0,
        strain: row.strain || '', // strain for the tooltip (carried forward when the hour was logged blank)
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
  // The current run of hours at 90%+ ending at the latest hour: a miss on the
  // latest hour resets it to 0 (it used to keep the day's longest run).
  result.streak = currentStreak;

  // rows carry row.targetRate, so logged hours in dailyGoal use the same
  // per-hour targets as todayTarget; hours not logged yet use targetRate.
  const projection = calculateDailyProjection(rows,lastCompletedHourIndex, currentHourIndex, targetRate, totalLbs, timeSlotMultipliers);
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
  const laborOpts = await laborOptions(env);

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
           ) as hours_with_data,
           (SELECT m2.cultivar1 FROM (${MP_BY_CULTIVAR}) m2
            WHERE m2.production_date = monthly_production.production_date
              AND m2.cultivar1 IS NOT NULL AND m2.cultivar1 != ''
            GROUP BY m2.cultivar1 ORDER BY SUM(m2.slot_share) DESC LIMIT 1
           ) as dominant_cultivar,
           MAX(
             CASE
               WHEN (buckers_line1 + trimmers_line1 + tzero_line1) > 0 AND tops_lbs1 > 0
               THEN trimmers_line1 + buckers_line1 + tzero_line1
               ELSE 0
             END
           ) as peak_crew,
           GROUP_CONCAT(DISTINCT NULLIF(qc, '')) as notes
    FROM monthly_production
    WHERE production_date >= ?
    GROUP BY production_date
    ORDER BY production_date
  `, [cutoffStr]);

  // Per-strain breakdown, so a day with more than one cultivar doesn't get
  // silently collapsed down to just the dominant one (see `cultivar` below).
  const cultivarRows = await query(env.DB, `
    SELECT production_date, cultivar1 as cultivar,
           SUM(tops_lbs1) as tops, SUM(smalls_lbs1) as smalls
    FROM (${MP_BY_CULTIVAR})
    WHERE production_date >= ? AND cultivar1 IS NOT NULL AND cultivar1 != ''
    GROUP BY production_date, cultivar1
  `, [cutoffStr]);

  // Labor per day, slot by slot (lib/labor-split.js).
  const laborRows = await query(env.DB, `${LABOR_ROWS_SQL} WHERE production_date >= ?`, [cutoffStr]);
  const laborRowsByDate = new Map();
  for (const lr of laborRows) {
    if (!laborRowsByDate.has(lr.production_date)) laborRowsByDate.set(lr.production_date, []);
    laborRowsByDate.get(lr.production_date).push(lr);
  }

  const cultivarsByDate = new Map();
  for (const cr of cultivarRows) {
    if (!cultivarsByDate.has(cr.production_date)) cultivarsByDate.set(cr.production_date, []);
    cultivarsByDate.get(cr.production_date).push({
      cultivar: cr.cultivar,
      tops: Math.round((cr.tops || 0) * 10) / 10,
      smalls: Math.round((cr.smalls || 0) * 10) / 10,
    });
  }
  for (const list of cultivarsByDate.values()) {
    list.sort((a, b) => (b.tops + b.smalls) - (a.tops + a.smalls));
  }

  return rows.map(r => {
    const totalTops = r.total_tops || 0;
    const totalSmalls = r.total_smalls || 0;
    const totalLbs = totalTops + totalSmalls;
    const trimmerHours = r.trimmer_hours || 0;
    const labor = laborSplit(laborRowsByDate.get(r.production_date) || [], laborOpts);

    return {
      date: new Date(r.production_date + 'T12:00:00'),
      totalTops,
      totalSmalls,
      avgRate: trimmerHours > 0 ? totalTops / trimmerHours : 0,
      totalLbs,
      trimmerHours,
      operatorHours: labor.operatorHours,
      laborCost: labor.totalLaborCost,
      costPerLb: labor.costPerLb,
      topsCostPerLb: labor.topsCostPerLb,
      smallsCostPerLb: labor.smallsCostPerLb,
      cultivar: r.dominant_cultivar || '',
      cultivars: cultivarsByDate.get(r.production_date) || [],
      totalCrew: r.peak_crew || 0,
      notes: r.notes || '',
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

  const todayLabor = laborSplit(
    await query(env.DB, `${LABOR_ROWS_SQL} WHERE production_date = ?`, [targetDate]),
    await laborOptions(env),
  );
  const todayTops = todayLabor.tops;
  const todaySmalls = todayLabor.smalls;
  const todayTotalLbs = todayLabor.totalLbs;
  // Headcount sums over the counted slots (for the average crew below).
  const todayTrimmerHours = todayLabor.heads.trimmers;
  const todayBuckerHours = todayLabor.heads.buckers;
  const todayTZeroHours = todayLabor.heads.tzero;
  const todayTotalOperatorHours = todayLabor.operatorHours;
  const todayTotalLaborCost = todayLabor.totalLaborCost;
  const todayBlendedCostPerLb = todayLabor.costPerLb;
  const todayTopsCostPerLb = todayLabor.topsCostPerLb;
  const todaySmallsCostPerLb = todayLabor.smallsCostPerLb;

  const hoursWithData = todayLabor.heads.slots;

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
    graded: !!scoreboardData.graded,
    todayPercentage: scoreboardData.todayPercentage || 0,
    todayTarget: scoreboardData.todayTarget || 0,
    projectedTotal: scoreboardData.projectedTotal || 0,
    effectiveHours: scoreboardData.effectiveHours || 0,
  } : {
    strain: '',
    graded: false,
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
    strain: h.strain || '',
    trimmers: h.trimmers,
    buckers: h.buckers || 0,
    lbs: h.lbs,
    tops: h.lbs,
    smalls: h.smalls || 0,
    notes: h.notes || '',
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
      cultivar: d.cultivar || '',
      cultivars: d.cultivars || [],
      totalCrew: d.totalCrew || 0,
      notes: d.notes || '',
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
