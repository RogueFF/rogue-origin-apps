/**
 * The switch and the hooks for the cell log -> Hourly entry fill (lib/cell-fill.js).
 *
 *   POST ?action=cellFillSet  { date, on }   farm password. On: fill every hour of
 *        that day now. Off: remove the rows the fill wrote for that day (hand rows stay).
 *
 * fillSlot() runs after every cell-log save that can change an hour (a person's
 * tops, the room's smalls or cultivar, a cell's cultivar). It never fails the save.
 * fillStatus() is what the Cell hourly log shows next to each hour.
 */
import { successResponse, errorResponse } from '../../lib/response.js';
import { requireAuth } from '../../lib/auth.js';
import { incrementDataVersion } from '../../lib/production-utils.js';
import { ALL_TIME_SLOTS } from '../../lib/production-helpers.js';
import { fillOn, fillHour, isHandRow, readCellHour, cellHourToProductionRow, FILL_SOURCE } from '../../lib/cell-fill.js';
import { SLOTS } from './crew-hours.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const norm = (s) => String(s || '').replace(/[-–—]/g, '-').replace(/\s+/g, ' ').trim();
// long slot ('7:00 AM – 8:00 AM') <-> crew_hours key ('7-8') and its working minutes
const HOURS = ALL_TIME_SLOTS.map((long, i) => ({ long, key: SLOTS[i][0], min: SLOTS[i][1] }));
const hourOf = (slot) => HOURS.find((h) => h.key === slot || norm(h.long) === norm(slot)) || null;

/** After a save: refill that hour if the day's switch is on. Never throws. */
export async function fillSlot(env, date, slot) {
  try {
    const h = hourOf(slot);
    if (!h || !DATE_RE.test(String(date || ''))) return { state: 'none' };
    const res = await fillHour(env.DB, date, h.long, h.key, h.min);
    if (res.state === 'filled' || res.state === 'cleared') await incrementDataVersion(env);
    return res;
  } catch (e) {
    console.error('cell fill:', e?.message || e);
    return { state: 'error' };
  }
}

export async function cellFillSet(body, env, request) {
  requireAuth(request, body, env, 'production-cellFillSet');
  const date = String(body.date || '');
  if (!DATE_RE.test(date)) return errorResponse('date must be YYYY-MM-DD', 'VALIDATION_ERROR', 400);
  const on = body.on === true;
  await env.DB.prepare(
    `INSERT INTO cell_fill_days (production_date, enabled, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(production_date) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`
  ).bind(date, on ? 1 : 0).run();
  const states = {};
  if (on) {
    for (const h of HOURS) states[h.long] = (await fillHour(env.DB, date, h.long, h.key, h.min)).state;
  } else {
    await env.DB.prepare('DELETE FROM monthly_production WHERE production_date = ? AND fill_source = ?').bind(date, FILL_SOURCE).run();
  }
  await incrementDataVersion(env);
  return successResponse({ success: true, date, on, states });
}

/** For the page: the switch, and each hour's Hourly entry row against what the cells say. */
export async function fillStatus(env, date) {
  try {
    const on = await fillOn(env.DB, date);
    const rows = (await env.DB.prepare(
      `SELECT time_slot, fill_source, trimmers_line1, buckers_line1, tzero_line1, trimmers_line2, buckers_line2, tzero_line2,
              tops_lbs1, smalls_lbs1, tops_lbs2, smalls_lbs2
       FROM monthly_production WHERE production_date = ?`
    ).bind(date).all()).results || [];
    const slots = [];
    for (const h of HOURS) {
      const r = rows.find((x) => x.time_slot === h.long);
      const cells = cellHourToProductionRow(await readCellHour(env.DB, date, h.long, h.key, h.min));
      if (!r && !cells) continue;
      slots.push({
        slot: h.long,
        state: !r ? 'none' : r.fill_source === FILL_SOURCE ? 'filled' : isHandRow(r) ? 'hand' : 'none',
        hourly: r ? { tops: (r.tops_lbs1 || 0) + (r.tops_lbs2 || 0), smalls: (r.smalls_lbs1 || 0) + (r.smalls_lbs2 || 0), trimmers: (r.trimmers_line1 || 0) + (r.trimmers_line2 || 0) } : null,
        cells: cells ? { tops: cells.tops_lbs1, smalls: cells.smalls_lbs1, trimmers: cells.trimmers_line1, cultivar: cells.cultivar1, mixed: cells.mixedCultivars } : null,
      });
    }
    return { on, slots };
  } catch (e) {
    if (/no such (table|column)/i.test(String(e?.message))) return { on: false, slots: [] };
    throw e;
  }
}

