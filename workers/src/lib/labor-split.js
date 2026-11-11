/**
 * Labor hours and cost for one production day, split between tops and smalls.
 * Pure: the dashboard handler reads monthly_production rows, this works the numbers.
 *
 * A slot counts when it has crew and tops (as before). Each person in it counts
 * for the slot's real length, not a full hour: the same break-adjusted multiplier
 * the lb/hr side uses (getTimeSlotMultiplier: half-hour slots, the 7:03 start,
 * slots with a break in them). 2026-11-10 counted 193 hrs as full hours, 166.5 real.
 *
 * Who is charged to what:
 *   trimmers           tops
 *   smalls inspector   smalls (config labor.smalls_inspector_count per slot)
 *   buckers, water spider (one per slot)   shared, split by the day's tops/smalls weight
 *   T-Zero             line days: shared, split by weight.
 *                      cell days: smalls only. In cell mode the T-Zero works only
 *                      on smalls (Koa, 2026-11-10), like the smalls inspector.
 *
 * A day is a cell day from CELL_MODE_FROM on (config labor.cell_mode_from
 * overrides it). 2026-11-09 was the first full one-touch day, the whole room on
 * cells; 11/3-11/6 ran the line beside the test cells, so those keep the split.
 */
import { getTimeSlotMultiplier } from './production-helpers.js';

export const CELL_MODE_FROM = '2026-11-09';

const n = v => Number(v) || 0;

/**
 * @param {Array<{production_date,time_slot,trimmers_line1,buckers_line1,tzero_line1,tops_lbs1,smalls_lbs1}>} rows one day
 * @param {object} o
 * @param {number} o.loadedRate $ per person-hour
 * @param {number} [o.inspectors=1] smalls inspectors per slot
 * @param {object} [o.multipliers] schedule.time_slot_multipliers
 * @param {string} [o.cellModeFrom]
 */
export function laborSplit(rows, { loadedRate, inspectors = 1, multipliers = null, cellModeFrom = CELL_MODE_FROM }) {
  const date = rows.length ? String(rows[0].production_date) : '';
  const cellMode = !!cellModeFrom && date >= cellModeFrom;
  let tops = 0, smalls = 0;
  const h = { trimmer: 0, bucker: 0, tzero: 0, spider: 0, inspector: 0 };
  const heads = { trimmers: 0, buckers: 0, tzero: 0, slots: 0 };
  for (const r of rows) {
    tops += n(r.tops_lbs1);
    smalls += n(r.smalls_lbs1);
    const t = n(r.trimmers_line1), b = n(r.buckers_line1), z = n(r.tzero_line1);
    if (t + b + z <= 0 || n(r.tops_lbs1) <= 0) continue;
    const m = getTimeSlotMultiplier(r.time_slot, multipliers);
    h.trimmer += t * m;
    h.bucker += b * m;
    h.tzero += z * m;
    h.spider += m;
    h.inspector += inspectors * m;
    heads.trimmers += t; heads.buckers += b; heads.tzero += z; heads.slots += 1;
  }
  const total = tops + smalls;
  const topsRatio = total > 0 ? tops / total : 1;
  const shared = h.bucker + h.spider + (cellMode ? 0 : h.tzero);
  const topsHours = h.trimmer + shared * topsRatio;
  const smallsHours = shared * (1 - topsRatio) + h.inspector + (cellMode ? h.tzero : 0);
  const topsCost = topsHours * loadedRate;
  const smallsCost = smallsHours * loadedRate;
  return {
    cellMode,
    tops, smalls, totalLbs: total,
    hours: h,
    heads,
    operatorHours: h.trimmer + h.bucker + h.tzero + h.spider + h.inspector,
    topsHours, smallsHours,
    topsLaborCost: topsCost,
    smallsLaborCost: smallsCost,
    totalLaborCost: topsCost + smallsCost,
    topsCostPerLb: tops > 0 ? topsCost / tops : 0,
    smallsCostPerLb: smalls > 0 ? smallsCost / smalls : 0,
    costPerLb: total > 0 ? (topsCost + smallsCost) / total : 0,
  };
}
