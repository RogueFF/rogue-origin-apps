/**
 * Line trimmer scales -> Hourly entry tops (Koa 2026-11-24, migration 0074).
 *
 * On the line every Hourly entry row is typed by hand: the lead types the crew
 * and the cultivar. So unlike the cell fill (lib/cell-fill.js), which writes
 * whole rows and never touches a hand row, this fill writes only the TOPS into
 * the lead's row:
 *
 *   tops_lbs1        = every seat's scale grams that hour, in lb
 *   change_tops_lbs  = the part on the hour's change cultivar, when the row has one
 *   tops_source      = 'scales'
 *
 * Rules:
 *   · the per-day switch (line_scale_fill_days) is OFF unless turned on
 *   · no row, or a row with no line 1 crew: nothing is written (pounds never go
 *     in without crew; the row fills once the lead types it)
 *   · typed tops win: a row whose tops were typed (tops_source NULL, tops > 0)
 *     is left alone, and Hourly entry shows both numbers
 *   · a hand save that changes the tops makes them typed again; a save that
 *     leaves the tops box alone (topsTouched false) keeps the scales
 *   · line 2, crew, cultivar, smalls and notes are never written
 *   · turning a day off puts its filled tops back to 0 for the lead to type
 *
 * lineTopsFill is pure, so the rules are unit-tested without a database.
 */
import { ALL_TIME_SLOTS } from './production-helpers.js';
import { incrementDataVersion } from './production-utils.js';

export const TOPS_SOURCE = 'scales';
export const G_PER_LB = 453.59237;
// The crew_hours slot keys, in the same order as ALL_TIME_SLOTS.
export const LINE_SLOT_KEYS = ['7-8', '8-9', '9-10', '10-11', '11-12', '12-1', '1-2', '2-3', '3-4', '4-4:30'];
export const SLOT_MIN = { '7-8': 60, '8-9': 60, '9-10': 50, '10-11': 60, '11-12': 60, '12-1': 30, '1-2': 60, '2-3': 50, '3-4': 60, '4-4:30': 30 };

const norm = (s) => String(s || '').replace(/[-–—]/g, '-').replace(/\s+/g, ' ').trim();
const r1 = (x) => Math.round((Number(x) || 0) * 10) / 10;

/** An Hourly entry time_slot -> its slot key. A custom first slot ('7:30 AM – 8:00 AM') is still '7-8'. */
export function slotKeyOfRow(timeSlot) {
  const n = norm(timeSlot);
  const i = ALL_TIME_SLOTS.findIndex((s) => norm(s) === n);
  if (i >= 0) return LINE_SLOT_KEYS[i];
  if (/^\d{1,2}:\d{2} AM - 8:00 AM$/i.test(n)) return '7-8';
  return null;
}

/**
 * What the scales would do to one Hourly entry row.
 * @param {object|null} row  the monthly_production row
 * @param {{g:number, byCultivar:Object<string,number>}} scale  the hour's scale grams
 * @returns {{state:'noRow'|'noCrew'|'hand'|'same'|'fill', tops?:number, changeTops?:number|null}}
 */
export function lineTopsFill(row, scale) {
  if (!row) return { state: 'noRow' };
  const crew = (Number(row.trimmers_line1) || 0) + (Number(row.buckers_line1) || 0) + (Number(row.tzero_line1) || 0);
  if (crew === 0) return { state: 'noCrew' };
  if (row.tops_source !== TOPS_SOURCE && (Number(row.tops_lbs1) || 0) > 0) return { state: 'hand' };
  const tops = r1((Number(scale?.g) || 0) / G_PER_LB);
  const changeCv = String(row.change_cultivar || '').trim();
  const changeTops = changeCv ? Math.min(tops, r1((Number(scale?.byCultivar?.[changeCv]) || 0) / G_PER_LB)) : null;
  const same = row.tops_source === TOPS_SOURCE && r1(row.tops_lbs1) === tops
    && (changeTops === null || r1(row.change_tops_lbs) === changeTops);
  return { state: same ? 'same' : 'fill', tops, changeTops };
}

/** Is the day's switch on? Before migration 0074 there is no table: off. */
export async function lineFillOn(db, date) {
  try {
    const r = await db.prepare('SELECT enabled FROM line_scale_fill_days WHERE production_date = ?').bind(date).first();
    return !!r && Number(r.enabled) === 1;
  } catch { return false; }
}

/** One hour's scale grams, all seats: { g, byCultivar }. A negative bucket (a shake after the hour mark) counts as 0. */
export async function scaleHour(db, date, key) {
  const rows = (await db.prepare(
    'SELECT cultivar, SUM(MAX(g, 0)) AS g FROM line_scale_hours WHERE work_date = ? AND slot = ? GROUP BY cultivar'
  ).bind(date, key).all()).results || [];
  const byCultivar = {};
  let g = 0;
  for (const r of rows) { byCultivar[r.cultivar || ''] = Number(r.g) || 0; g += Number(r.g) || 0; }
  return { g, byCultivar };
}

/** The Hourly entry row for a slot key, or null. */
export async function hourRow(db, date, key) {
  const rows = (await db.prepare('SELECT * FROM monthly_production WHERE production_date = ?').bind(date).all()).results || [];
  return rows.find((r) => slotKeyOfRow(r.time_slot) === key) || null;
}

/** Fill one hour's tops from the scales if the day's switch is on. Never throws. */
export async function fillLineSlot(env, date, key) {
  try {
    if (!LINE_SLOT_KEYS.includes(key) || !(await lineFillOn(env.DB, date))) return 'off';
    const row = await hourRow(env.DB, date, key);
    const res = lineTopsFill(row, await scaleHour(env.DB, date, key));
    if (res.state !== 'fill') return res.state;
    await env.DB.prepare(
      'UPDATE monthly_production SET tops_lbs1 = ?, change_tops_lbs = COALESCE(?, change_tops_lbs), tops_source = ? WHERE id = ?'
    ).bind(res.tops, res.changeTops, TOPS_SOURCE, row.id).run();
    // Only a real change wakes the boards (they refetch on every version bump).
    await incrementDataVersion(env);
    return 'filled';
  } catch (e) {
    console.error('line fill:', e?.message || e);
    return 'error';
  }
}

/**
 * Before a hand save on Hourly entry (addProduction): do this row's tops stay
 * the scales'? Yes when the lead left the tops box alone, or sent the same
 * number back. Before migration 0074 there is no column: no.
 */
export async function keepsScaleTops(db, id, body, incomingTops) {
  if (!id) return false;
  let r = null;
  try { r = await db.prepare('SELECT tops_lbs1, tops_source FROM monthly_production WHERE id = ?').bind(id).first(); } catch { return false; }
  if (!r || r.tops_source !== TOPS_SOURCE) return false;
  if (body && body.topsTouched === false) return true;
  return Math.abs((Number(r.tops_lbs1) || 0) - (Number(incomingTops) || 0)) < 0.05;
}

/** After a hand save: typed tops lose the scales mark, then the hour fills if it may. Never throws. */
export async function afterHandSave(env, date, timeSlot, keep) {
  try {
    if (!keep) {
      await env.DB.prepare('UPDATE monthly_production SET tops_source = NULL WHERE production_date = ? AND time_slot = ? AND tops_source IS NOT NULL')
        .bind(date, timeSlot).run();
    }
  } catch { return; }   // before migration 0074
  const key = slotKeyOfRow(timeSlot);
  if (key) await fillLineSlot(env, date, key);
}
