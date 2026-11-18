/**
 * Cell log -> Hourly entry (monthly_production) fill (Koa 2026-11-18, via the hub).
 *
 * The barn TV line board and End of day read only monthly_production. With the
 * switch on for a day (cell_fill_days, migration 0071), every save on the cell
 * hourly log rewrites that hour's Hourly entry row from the log:
 *
 *   tops      = the sum of the cells' tops that hour (the people's typed tops,
 *               i.e. the derived cell_hourly.tops_lbs)
 *   smalls    = the room's smalls that hour (cell_room_hourly)
 *   cultivar  = the room's cultivar that hour; with none set, the cell cultivar
 *               with the most tops
 *   trimmers  = cells in use that hour (one person per cell at a time)
 *   effective = person-minutes / the hour's working minutes (a cover counts once)
 *   buckers 0 (one-touch cells), T-Zero 0 unless passed in, line 2 empty
 *
 * Rules:
 *   · a hand row (fill_source NULL with any crew or pounds) is never overwritten:
 *     the fill skips it and the page shows both numbers
 *   · a hand save on a filled row (addProduction) makes it a hand row
 *   · idempotent: a save rewrites that hour's filled row; an empty hour clears it
 *   · switch off: nothing is written; turning a day off removes only its filled rows
 *
 * cellHourToProductionRow is pure (no DB) so a mock-up can run yesterday's numbers
 * through exactly this mapping.
 */
import { ALL_TIME_SLOTS } from './production-helpers.js';

export const FILL_SOURCE = 'cells';
const r1 = (x) => Math.round((Number(x) || 0) * 10) / 10;

/**
 * One hour of the cell log -> one monthly_production row (or null: nothing to fill).
 *
 * @param {object} hour
 * @param {number} hour.slotMinutes   the hour's working minutes (60, 50 or 30)
 * @param {Array<{personId:number, stationId:string, min:number}>} hour.people  typed people-hours
 * @param {Array<{stationId:string, tops:number|null, cultivar?:string|null}>} hour.cells  cell_hourly rows
 * @param {{smalls?:number|null, cultivar?:string|null}} [hour.room]  cell_room_hourly row
 * @param {number} [hour.tzero]  T-Zero people that hour (the log has no field for it; default 0)
 * @returns {null | object} the row's columns, plus `mixedCultivars` (not a column)
 */
export function cellHourToProductionRow({ slotMinutes, people = [], cells = [], room = {}, tzero = 0 }) {
  const worked = people.filter((p) => (Number(p.min) || 0) > 0);
  const tops = r1(cells.reduce((a, c) => a + (Number(c.tops) || 0), 0));
  const smalls = r1(room?.smalls);
  const inUse = new Set(worked.map((p) => p.stationId));
  // No cell in use = no crew: never fill pounds without crew (Hourly entry refuses
  // that too, and the board divides by trimmers). The hour fills once a cell is typed.
  if (!inUse.size) return null;

  const personMin = worked.reduce((a, p) => a + Number(p.min), 0);
  const effective = slotMinutes > 0 ? r1(personMin / slotMinutes) : inUse.size;

  // The cultivar: the room's for the hour; else the cell cultivar with the most tops.
  const byCultivar = new Map();
  for (const c of cells) {
    const name = String(c.cultivar || '').trim();
    if (name && (Number(c.tops) || 0) > 0) byCultivar.set(name, (byCultivar.get(name) || 0) + Number(c.tops));
  }
  const roomCultivar = String(room?.cultivar || '').trim();
  const top = [...byCultivar].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  const cultivar = roomCultivar || top;
  const mixed = [...new Set([...(roomCultivar ? [roomCultivar] : []), ...byCultivar.keys()])];

  return {
    trimmers_line1: inUse.size,
    buckers_line1: 0,
    tzero_line1: Math.max(0, Math.round(Number(tzero) || 0)),
    cultivar1: cultivar.slice(0, 100),
    tops_lbs1: tops,
    smalls_lbs1: smalls,
    effective_trimmers_line1: effective,
    trimmers_line2: 0, buckers_line2: 0, tzero_line2: 0,
    cultivar2: '', tops_lbs2: 0, smalls_lbs2: 0,
    mixedCultivars: mixed.length > 1 ? mixed : [],
  };
}

/** A row typed on Hourly entry that carries anything. */
const HAND_KEYS = ['trimmers_line1', 'buckers_line1', 'tzero_line1', 'trimmers_line2', 'buckers_line2', 'tzero_line2',
  'tops_lbs1', 'smalls_lbs1', 'tops_lbs2', 'smalls_lbs2'];
export function isHandRow(r) {
  if (!r || r.fill_source === FILL_SOURCE) return false;
  return HAND_KEYS.some((k) => (Number(r[k]) || 0) > 0);
}

// The tables may not exist yet (migration not applied): that reads as "off".
async function firstOrNull(stmt) {
  try { return await stmt.first(); } catch (e) {
    if (/no such (table|column)/i.test(String(e?.message))) return null;
    throw e;
  }
}
async function allOrEmpty(stmt) {
  try { return (await stmt.all()).results || []; } catch (e) {
    if (/no such (table|column)/i.test(String(e?.message))) return [];
    throw e;
  }
}

export async function fillOn(db, date) {
  const r = await firstOrNull(db.prepare('SELECT enabled FROM cell_fill_days WHERE production_date = ?').bind(date));
  return r?.enabled === 1;
}

/** The cell log's hour, read for the mapping. slotKeys: long slot -> crew_hours key ('7-8'). */
export async function readCellHour(db, date, longSlot, slotKey, slotMinutes) {
  const [people, cells, room] = await Promise.all([
    allOrEmpty(db.prepare(
      "SELECT person_id, station_id, min FROM crew_hours WHERE work_date = ? AND slot = ? AND src = 'typed' AND station_id IS NOT NULL"
    ).bind(date, slotKey)),
    allOrEmpty(db.prepare('SELECT station_id, tops_lbs, cultivar FROM cell_hourly WHERE production_date = ? AND time_slot = ?').bind(date, longSlot)),
    firstOrNull(db.prepare('SELECT smalls_lbs, cultivar FROM cell_room_hourly WHERE production_date = ? AND time_slot = ?').bind(date, longSlot)),
  ]);
  return {
    slotMinutes,
    people: people.map((p) => ({ personId: p.person_id, stationId: p.station_id, min: p.min })),
    cells: cells.map((c) => ({ stationId: c.station_id, tops: c.tops_lbs, cultivar: c.cultivar })),
    room: room ? { smalls: room.smalls_lbs, cultivar: room.cultivar } : {},
  };
}

const COLS = ['trimmers_line1', 'buckers_line1', 'tzero_line1', 'cultivar1', 'tops_lbs1', 'smalls_lbs1', 'effective_trimmers_line1',
  'trimmers_line2', 'buckers_line2', 'tzero_line2', 'cultivar2', 'tops_lbs2', 'smalls_lbs2'];

/**
 * Fill (or clear) one hour's Hourly entry row from the cell log. Returns
 * { state: 'off' | 'hand' | 'filled' | 'cleared' | 'none' }.
 */
export async function fillHour(db, date, longSlot, slotKey, slotMinutes, { force = false } = {}) {
  if (!force && !(await fillOn(db, date))) return { state: 'off' };
  if (!ALL_TIME_SLOTS.includes(longSlot)) return { state: 'none' };
  const existing = await firstOrNull(db.prepare(
    `SELECT id, fill_source, ${COLS.join(', ')} FROM monthly_production WHERE production_date = ? AND time_slot = ?`
  ).bind(date, longSlot));
  if (isHandRow(existing)) return { state: 'hand' };
  const row = cellHourToProductionRow(await readCellHour(db, date, longSlot, slotKey, slotMinutes));
  if (!row) {
    if (existing && existing.fill_source === FILL_SOURCE) {
      await db.prepare('DELETE FROM monthly_production WHERE id = ?').bind(existing.id).run();
      return { state: 'cleared' };
    }
    return { state: 'none' };
  }
  // One statement: two tablets saving the same hour never hit the unique key, and a
  // hand row that landed since the read above is still left alone (the WHERE).
  const vals = COLS.map((c) => row[c]);
  const r = await db.prepare(`INSERT INTO monthly_production (production_date, time_slot, ${COLS.join(', ')}, qc, fill_source)
    VALUES (?, ?, ${COLS.map(() => '?').join(', ')}, '', ?)
    ON CONFLICT(production_date, time_slot) DO UPDATE SET ${COLS.map((c) => `${c} = excluded.${c}`).join(', ')}, fill_source = excluded.fill_source
    WHERE monthly_production.fill_source = '${FILL_SOURCE}' OR (${HAND_KEYS.map((k) => `COALESCE(monthly_production.${k}, 0) <= 0`).join(' AND ')})`)
    .bind(date, longSlot, ...vals, FILL_SOURCE).run();
  if (!r?.meta?.changes) return { state: 'hand' };
  return { state: 'filled', row };
}

