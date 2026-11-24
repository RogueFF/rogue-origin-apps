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
 *   bagger/tagger      cell hours only: tops (config labor.bagger_count per slot,
 *                      default 1). Koa 2026-11-18: "Bagging/Tagging is usually 1
 *                      person", cell days only. Charged to tops: the 5 kg bags,
 *                      their tags and the Shopify scans are the tops; smalls go
 *                      out through the T-Zero op, already on smalls.
 *   T-Zero             line hours: shared, split by weight.
 *                      cell hours: smalls only. In cell mode the T-Zero works only
 *                      on smalls (Koa, 2026-11-10), like the smalls inspector.
 *
 * Cell or line is decided per SLOT, not per day (Koa 2026-11-24: the room went
 * back to the line at 12:30 on 11/24, cells in the morning). A slot is a cell
 * hour when the day is on or after CELL_MODE_FROM (config labor.cell_mode_from
 * overrides it) AND it has no buckers; an hour with buckers entered is a line
 * hour and gets the line rules. 2026-11-09 was the first full one-touch day;
 * 11/3-11/6 ran the line beside the test cells, so those keep the line rules.
 */
import { getTimeSlotMultiplier } from './production-helpers.js';

export const CELL_MODE_FROM = '2026-11-09';

const n = v => Number(v) || 0;

/** One hour's rules: a cell hour from cellModeFrom on, unless buckers were entered (a line hour). */
export function isCellSlot(date, buckers, cellModeFrom = CELL_MODE_FROM) {
  return !!cellModeFrom && String(date) >= cellModeFrom && n(buckers) <= 0;
}

/**
 * @param {Array<{production_date,time_slot,trimmers_line1,buckers_line1,tzero_line1,tops_lbs1,smalls_lbs1}>} rows one day
 * @param {object} o
 * @param {number} o.loadedRate $ per person-hour
 * @param {number} [o.inspectors=1] smalls inspectors per slot
 * @param {object} [o.multipliers] schedule.time_slot_multipliers
 * @param {string} [o.cellModeFrom]
 * @param {number} [o.baggers=1] bagger/taggers per slot on cell days
 */
export function laborSplit(rows, { loadedRate, inspectors = 1, multipliers = null, cellModeFrom = CELL_MODE_FROM, baggers = 1 }) {
  const date = rows.length ? String(rows[0].production_date) : '';
  let tops = 0, smalls = 0;
  const h = { trimmer: 0, bucker: 0, tzero: 0, spider: 0, inspector: 0, bagger: 0 };
  // T-Zero hours by rule: line hours share theirs, cell hours charge smalls
  let tzeroLine = 0, tzeroCell = 0;
  const heads = { trimmers: 0, buckers: 0, tzero: 0, slots: 0, cellSlots: 0, lineSlots: 0 };
  for (const r of rows) {
    tops += n(r.tops_lbs1);
    smalls += n(r.smalls_lbs1);
    const t = n(r.trimmers_line1), b = n(r.buckers_line1), z = n(r.tzero_line1);
    if (t + b + z <= 0 || n(r.tops_lbs1) <= 0) continue;
    const m = getTimeSlotMultiplier(r.time_slot, multipliers);
    const cell = isCellSlot(r.production_date ?? date, b, cellModeFrom);
    h.trimmer += t * m;
    h.bucker += b * m;
    h.tzero += z * m;
    if (cell) tzeroCell += z * m; else tzeroLine += z * m;
    h.spider += m;
    h.inspector += inspectors * m;
    if (cell) h.bagger += n(baggers) * m;
    heads.trimmers += t; heads.buckers += b; heads.tzero += z; heads.slots += 1;
    if (cell) heads.cellSlots += 1; else heads.lineSlots += 1;
  }
  const total = tops + smalls;
  const topsRatio = total > 0 ? tops / total : 1;
  const shared = h.bucker + h.spider + tzeroLine;
  const topsHours = h.trimmer + h.bagger + shared * topsRatio;
  const smallsHours = shared * (1 - topsRatio) + h.inspector + tzeroCell;
  // true when any counted hour ran on cell rules (a split day is true too; see heads)
  const cellMode = heads.cellSlots > 0;
  const topsCost = topsHours * loadedRate;
  const smallsCost = smallsHours * loadedRate;
  return {
    cellMode,
    tops, smalls, totalLbs: total,
    hours: h,
    heads,
    operatorHours: h.trimmer + h.bucker + h.tzero + h.spider + h.inspector + h.bagger,
    topsHours, smallsHours,
    topsLaborCost: topsCost,
    smallsLaborCost: smallsCost,
    totalLaborCost: topsCost + smallsCost,
    topsCostPerLb: tops > 0 ? topsCost / tops : 0,
    smallsCostPerLb: smalls > 0 ? smallsCost / smalls : 0,
    costPerLb: total > 0 ? (topsCost + smallsCost) / total : 0,
  };
}
