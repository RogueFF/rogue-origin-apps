/**
 * A cultivar change partway through an hour (migration 0059, Koa 2026-11-10).
 *
 * monthly_production keeps one row per slot, and tops_lbs1 stays the hour's total,
 * so every total reads the raw table as before. A per-cultivar rollup reads
 * MP_BY_CULTIVAR instead: the same columns, one row per cultivar part.
 *
 *   part 1  cultivar1         tops = tops_lbs1 - change_tops_lbs (never below 0)
 *   part 2  change_cultivar   tops = change_tops_lbs
 *
 * Crew (trimmers, buckers, T-Zero, effective trimmers) and smalls are one number
 * for the hour, so they split by time: change_share is the part of the slot's
 * working minutes after change_at (breaks out), worked out on write. slot_share
 * (1, 1 - s, s) is what a reader sums where it used to count slots, so a changed
 * hour never counts twice. Line 2 stays on part 1 only.
 *
 * Use it only for per-cultivar rollups. Totals and averages over crew (labor,
 * the latest day's crew) stay on monthly_production: a split row has fractional crew.
 */
import { getTimeSlotMultiplier, parseSlotTimeToMinutes } from './production-helpers.js';

const S = `CASE WHEN COALESCE(change_cultivar, '') != '' THEN COALESCE(change_share, 0.5) ELSE 0 END`;

export const MP_BY_CULTIVAR = `
  SELECT id, production_date, time_slot, wage_rate, qc, notes,
         cultivar1,
         MAX(0, COALESCE(tops_lbs1, 0) - CASE WHEN COALESCE(change_cultivar, '') != '' THEN COALESCE(change_tops_lbs, 0) ELSE 0 END) AS tops_lbs1,
         COALESCE(smalls_lbs1, 0) * (1 - ${S}) AS smalls_lbs1,
         COALESCE(trimmers_line1, 0) * (1 - ${S}) AS trimmers_line1,
         COALESCE(buckers_line1, 0) * (1 - ${S}) AS buckers_line1,
         COALESCE(tzero_line1, 0) * (1 - ${S}) AS tzero_line1,
         effective_trimmers_line1 * (1 - ${S}) AS effective_trimmers_line1,
         cultivar2, tops_lbs2, smalls_lbs2, trimmers_line2, buckers_line2, tzero_line2, effective_trimmers_line2,
         1 - ${S} AS slot_share
    FROM monthly_production
  UNION ALL
  SELECT id, production_date, time_slot, wage_rate, qc, notes,
         change_cultivar AS cultivar1,
         COALESCE(change_tops_lbs, 0) AS tops_lbs1,
         COALESCE(smalls_lbs1, 0) * ${S} AS smalls_lbs1,
         COALESCE(trimmers_line1, 0) * ${S} AS trimmers_line1,
         COALESCE(buckers_line1, 0) * ${S} AS buckers_line1,
         COALESCE(tzero_line1, 0) * ${S} AS tzero_line1,
         effective_trimmers_line1 * ${S} AS effective_trimmers_line1,
         '' AS cultivar2, 0 AS tops_lbs2, 0 AS smalls_lbs2, 0 AS trimmers_line2, 0 AS buckers_line2, 0 AS tzero_line2, NULL AS effective_trimmers_line2,
         ${S} AS slot_share
    FROM monthly_production
   WHERE COALESCE(change_cultivar, '') != ''`;

/** 'HH:MM' (24 h) -> 'h:mm AM'. */
function clock12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * Check a change and work out its share of the slot.
 * @returns {{ok:true, changeAt, share}|{ok:false, error}}
 */
export function changeShare(timeSlot, changeAt) {
  if (!/^\d{2}:\d{2}$/.test(String(changeAt || ''))) return { ok: false, error: 'Change time must be HH:MM' };
  const parts = String(timeSlot || '').replace(/[-–—]/g, '–').split('–').map(s => s.trim());
  const start = parseSlotTimeToMinutes(parts[0] || ''), end = parseSlotTimeToMinutes(parts[1] || '');
  const [h, m] = changeAt.split(':').map(Number);
  const at = h * 60 + m;
  if (start === null || end === null || !(at > start && at < end)) {
    return { ok: false, error: `The change time must be inside ${timeSlot}` };
  }
  // Working minutes (breaks out), the same rule the slot multipliers use.
  const whole = getTimeSlotMultiplier(`${parts[0]} – ${parts[1]}`, {});
  const after = getTimeSlotMultiplier(`${clock12(changeAt)} – ${parts[1]}`, {});
  const share = whole > 0 ? Math.round((after / whole) * 1000) / 1000 : 0.5;
  return { ok: true, changeAt, share: Math.min(1, Math.max(0, share)) };
}
