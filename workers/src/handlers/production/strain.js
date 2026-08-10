/**
 * Strain analysis handlers.
 */

import { query } from '../../lib/db.js';
import { successResponse, errorResponse } from '../../lib/response.js';
import { TOTAL_LABOR_COST_PER_HOUR, formatDatePT } from '../../lib/production-utils.js';

async function getStrainSummary(env, days = 7, limit = 5) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffStr = formatDatePT(cutoffDate, 'yyyy-MM-dd');

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

    return rows.map(r => {
      const totalLbs = (r.total_tops || 0) + (r.total_smalls || 0);
      const topsRatio = totalLbs > 0 ? r.total_tops / totalLbs : 0;
      const smallsRatio = totalLbs > 0 ? r.total_smalls / totalLbs : 0;

      const trimmerHours = r.trimmer_hours || 0;
      const buckerHours = r.bucker_hours || 0;
      const tzeroHours = r.tzero_hours || 0;
      const waterspiderHours = r.active_hours || 0;
      const sharedHours = buckerHours + tzeroHours + waterspiderHours;

      const topsLaborHours = trimmerHours + (sharedHours * topsRatio);
      const smallsLaborHours = sharedHours * smallsRatio;

      const topsLaborCost = topsLaborHours * TOTAL_LABOR_COST_PER_HOUR;
      const smallsLaborCost = smallsLaborHours * TOTAL_LABOR_COST_PER_HOUR;

      const topsCostPerLb = r.total_tops > 0 ? topsLaborCost / r.total_tops : 0;
      const smallsCostPerLb = r.total_smalls > 0 ? smallsLaborCost / r.total_smalls : 0;

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

    const matchedVariants = [...new Set(rows.map(r => r.cultivar1))];

    const dateMap = {};
    // Per-variant accumulation: the strain param fuzzy-matches (e.g. "Lifter"
    // also matches "Sour Lifter"), so the totals below are a blend across
    // every matchedVariant. This map lets us also report each variant's own
    // numbers, so a caller that wants pure "Lifter" isn't stuck guessing at
    // how much of the blend came from "Sour Lifter".
    const variantMap = {};
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

      const variant = row.cultivar1;
      if (!variantMap[variant]) {
        variantMap[variant] = {
          tops: 0,
          smalls: 0,
          trimmerHours: 0,
          buckerHours: 0,
          tzeroHours: 0,
          hours: 0,
          dates: new Set(),
        };
      }
      variantMap[variant].tops += row.tops_lbs1 || 0;
      variantMap[variant].smalls += row.smalls_lbs1 || 0;
      variantMap[variant].trimmerHours += row.trimmers_line1 || 0;
      variantMap[variant].buckerHours += row.buckers_line1 || 0;
      variantMap[variant].tzeroHours += row.tzero_line1 || 0;
      variantMap[variant].hours++;
      variantMap[variant].dates.add(date);

      totalTops += row.tops_lbs1 || 0;
      totalSmalls += row.smalls_lbs1 || 0;
      totalTrimmerHours += row.trimmers_line1 || 0;
      totalBuckerHours += row.buckers_line1 || 0;
      totalTZeroHours += row.tzero_line1 || 0;
      totalActiveHours++;
    });

    const totalLbs = totalTops + totalSmalls;
    const daysWorked = Object.keys(dateMap).length;
    const waterspiderHours = totalActiveHours;
    const totalOperatorHours = totalTrimmerHours + totalBuckerHours + totalTZeroHours + waterspiderHours;

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

    // Same cost/rate formulas as the blended summary above, applied per matched
    // variant — lets a caller pull "Lifter" alone back out of a "Lifter" search
    // that fuzzy-matched "Sour Lifter" too.
    const byVariant = Object.entries(variantMap)
      .map(([variant, v]) => {
        const vTotalLbs = v.tops + v.smalls;
        const vTopsRatio = vTotalLbs > 0 ? v.tops / vTotalLbs : 0;
        const vSmallsRatio = vTotalLbs > 0 ? v.smalls / vTotalLbs : 0;
        const vWaterspiderHours = v.hours;
        const vSharedHours = v.buckerHours + v.tzeroHours + vWaterspiderHours;
        const vTopsLaborHours = v.trimmerHours + (vSharedHours * vTopsRatio);
        const vSmallsLaborHours = vSharedHours * vSmallsRatio;
        const vTopsLaborCost = vTopsLaborHours * TOTAL_LABOR_COST_PER_HOUR;
        const vSmallsLaborCost = vSmallsLaborHours * TOTAL_LABOR_COST_PER_HOUR;
        const vTotalLaborCost = vTopsLaborCost + vSmallsLaborCost;
        const vCrewHours = v.trimmerHours + v.buckerHours + v.tzeroHours;
        const vAvgRate = vCrewHours > 0 ? vTotalLbs / vCrewHours : 0;

        return {
          cultivar: variant,
          totalLbs: Math.round(vTotalLbs * 10) / 10,
          tops: Math.round(v.tops * 10) / 10,
          smalls: Math.round(v.smalls * 10) / 10,
          topsPercent: Math.round(vTopsRatio * 1000) / 10,
          smallsPercent: Math.round(vSmallsRatio * 1000) / 10,
          daysWorked: v.dates.size,
          productionHours: v.hours,
          avgRate: Math.round(vAvgRate * 100) / 100,
          topsCostPerLb: Math.round((v.tops > 0 ? vTopsLaborCost / v.tops : 0) * 100) / 100,
          smallsCostPerLb: Math.round((v.smalls > 0 ? vSmallsLaborCost / v.smalls : 0) * 100) / 100,
          totalLaborCost: Math.round(vTotalLaborCost * 100) / 100,
        };
      })
      .sort((a, b) => b.totalLbs - a.totalLbs);

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
      byVariant,
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
    return errorResponse('Failed to analyze strain', 'INTERNAL_ERROR', 500);
  }
}

export { getStrainSummary, analyzeStrain };
