/**
 * End of day on a cell's own scale (Koa 2026-11-11, Phase 1 scorecard; migration
 * 0062, lib/cell-eod.js). From the cell screen's End of day panel (lead only):
 *
 *   GET  ?action=cellEod&stationId=&date=          the day's weighs, open window, sacks to tick
 *   POST ?action=eodWindow  { stationId, open }    panel opened (true) / left (false)
 *   POST ?action=eodWeigh   { stationId, kind: 'raw'|'tote', grams }
 *   POST ?action=eodUndo    { id }                 within 10 min
 *   POST ?action=cellSack   { stationId, sackId, on }   this sack (scanned out today) went to this cell
 *
 * The production date is always the Worker's Pacific today, never the tablet's.
 */
import { successResponse, errorResponse } from '../../lib/response.js';
import { pacificDay, parseSqliteUtc, sqliteUtc } from '../../lib/pacific.js';
import { sackLbs } from '../../lib/sack-weight.js';
import { UNDO_MS, WINDOW_MAX_MS } from '../../lib/cell-eod.js';

const KINDS = ['raw', 'tote'];
const MAX_G = 100000;            // 100 kg: anything over is a typo or a fault, not a leftover

const notReady = () => errorResponse('End of day is not set up yet (migration 0062)', 'NOT_READY', 503);
const missing = e => /no such table|no such column/i.test(String(e && e.message));
const validDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

async function tableStation(env, id) {
  if (typeof id !== 'string' || !id) return null;
  return env.DB.prepare(`SELECT station_id FROM scale_stations WHERE station_id = ? AND kind = 'table'`).bind(id).first();
}

/** Sacks scanned out on this Pacific day (real ones), with the cell each was ticked to. */
async function daySacks(env, date) {
  const d = Date.parse(`${date}T12:00:00Z`);
  const from = sqliteUtc(new Date(d - 24 * 3600e3)), to = sqliteUtc(new Date(d + 24 * 3600e3));
  const [sacks, ticks] = await Promise.all([
    // No sack table (a bare local DB): the weighs still work, the list is empty.
    env.DB.prepare(
      `SELECT sack_id, serial, season, cultivar, fill_lbs, opened_at FROM harvest_sacks
       WHERE is_test = 0 AND voided_at IS NULL AND opened_at >= ? AND opened_at < ? ORDER BY opened_at`
    ).bind(from, to).all().catch(e => { if (/no such table: harvest_sacks/i.test(String(e && e.message))) return { results: [] }; throw e; }),
    env.DB.prepare(`SELECT sack_id, station_id FROM cell_sacks WHERE production_date = ?`).bind(date).all(),
  ]);
  const tick = new Map((ticks.results || []).map(t => [t.sack_id, t.station_id]));
  return (sacks.results || [])
    .filter(s => pacificDay(parseSqliteUtc(String(s.opened_at))) === date)
    .map(s => ({
      sackId: s.sack_id, serial: s.serial, cultivar: s.cultivar, openedAt: parseSqliteUtc(String(s.opened_at)).getTime(),
      lbs: sackLbs(s), fillLbs: s.fill_lbs ?? null, stationId: tick.get(s.sack_id) || null,
    }));
}

export async function getCellEod(params, env, now = Date.now()) {
  const station = await tableStation(env, params.stationId);
  if (!station) return errorResponse('Unknown table station', 'VALIDATION_ERROR', 400);
  const date = validDate(params.date) ? params.date : pacificDay(new Date(now));
  let rows, sacks;
  try {
    [rows, sacks] = await Promise.all([
      env.DB.prepare(
        `SELECT id, kind, grams, batt_mv, ts, ended_at, undone_at FROM cell_eod
         WHERE station_id = ? AND production_date = ? ORDER BY ts, id`
      ).bind(station.station_id, date).all().then(r => r.results || []),
      daySacks(env, date),
    ]);
  } catch (e) {
    if (missing(e)) return notReady();
    throw e;
  }
  const at = ts => parseSqliteUtc(String(ts)).getTime();
  const weighs = rows.filter(r => r.kind !== 'window').map(r => ({
    id: r.id, kind: r.kind, g: r.grams, at: at(r.ts), battMv: r.batt_mv,
    undone: !!r.undone_at, canUndo: !r.undone_at && now - at(r.ts) <= UNDO_MS,
  }));
  const total = k => Math.round(weighs.filter(w => w.kind === k && !w.undone).reduce((s, w) => s + w.g, 0) * 100) / 100;
  const open = rows.filter(r => r.kind === 'window' && !r.ended_at && now - at(r.ts) < WINDOW_MAX_MS).pop();
  return successResponse({
    stationId: station.station_id, date, serverNow: now,
    weighs, rawG: total('raw'), toteG: total('tote'),
    windowOpen: open ? { id: open.id, at: at(open.ts) } : null,
    sacks: sacks.filter(s => !s.stationId || s.stationId === station.station_id),
  });
}

export async function eodWindow(body, env, now = Date.now()) {
  const station = await tableStation(env, body.stationId);
  if (!station) return errorResponse('Unknown table station', 'VALIDATION_ERROR', 400);
  const date = pacificDay(new Date(now));
  const since = sqliteUtc(new Date(now - WINDOW_MAX_MS));
  try {
    const open = await env.DB.prepare(
      `SELECT id FROM cell_eod WHERE station_id = ? AND kind = 'window' AND ended_at IS NULL AND ts >= ? ORDER BY ts DESC LIMIT 1`
    ).bind(station.station_id, since).first();
    if (body.open) {
      if (open) return successResponse({ success: true, id: open.id, open: true });
      const r = await env.DB.prepare(
        `INSERT INTO cell_eod (station_id, production_date, kind, ts) VALUES (?, ?, 'window', ?)`
      ).bind(station.station_id, date, sqliteUtc(new Date(now))).run();
      return successResponse({ success: true, id: r.meta && r.meta.last_row_id, open: true });
    }
    // Close every open window for the station (a re-opened tablet may have left one).
    await env.DB.prepare(
      `UPDATE cell_eod SET ended_at = ? WHERE station_id = ? AND kind = 'window' AND ended_at IS NULL`
    ).bind(sqliteUtc(new Date(now)), station.station_id).run();
    return successResponse({ success: true, open: false });
  } catch (e) {
    if (missing(e)) return notReady();
    throw e;
  }
}

export async function eodWeigh(body, env, now = Date.now()) {
  const station = await tableStation(env, body.stationId);
  if (!station) return errorResponse('Unknown table station', 'VALIDATION_ERROR', 400);
  if (!KINDS.includes(body.kind)) return errorResponse('kind must be raw or tote', 'VALIDATION_ERROR', 400);
  const g = Number(body.grams);
  if (!Number.isFinite(g) || g <= 0 || g > MAX_G) return errorResponse('grams must be more than 0', 'VALIDATION_ERROR', 400);
  // The node's battery as it reads now: scale_readings only keeps the latest.
  let battMv = null;
  try {
    const r = await env.DB.prepare(`SELECT batt_mv FROM scale_readings WHERE station_id = ?`).bind(station.station_id).first();
    battMv = r && Number.isFinite(r.batt_mv) ? r.batt_mv : null;
  } catch (e) { if (!missing(e)) throw e; }   // before 0055
  try {
    const r = await env.DB.prepare(
      `INSERT INTO cell_eod (station_id, production_date, kind, grams, batt_mv, ts) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(station.station_id, pacificDay(new Date(now)), body.kind, Math.round(g * 100) / 100, battMv, sqliteUtc(new Date(now))).run();
    return successResponse({ success: true, id: r.meta && r.meta.last_row_id, kind: body.kind, g: Math.round(g * 100) / 100 });
  } catch (e) {
    if (missing(e)) return notReady();
    throw e;
  }
}

export async function eodUndo(body, env, now = Date.now()) {
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return errorResponse('id required', 'VALIDATION_ERROR', 400);
  try {
    const r = await env.DB.prepare(
      `UPDATE cell_eod SET undone_at = ? WHERE id = ? AND kind IN ('raw', 'tote') AND undone_at IS NULL AND ts >= ?`
    ).bind(sqliteUtc(new Date(now)), id, sqliteUtc(new Date(now - UNDO_MS))).run();
    if (!r.meta || !r.meta.changes) return errorResponse('Too late to undo, or already undone', 'CONFLICT', 409);
    return successResponse({ success: true, id });
  } catch (e) {
    if (missing(e)) return notReady();
    throw e;
  }
}

export async function cellSack(body, env, now = Date.now()) {
  const station = await tableStation(env, body.stationId);
  if (!station) return errorResponse('Unknown table station', 'VALIDATION_ERROR', 400);
  const sackId = typeof body.sackId === 'string' ? body.sackId.trim().slice(0, 64) : '';
  if (!sackId) return errorResponse('sackId required', 'VALIDATION_ERROR', 400);
  const date = pacificDay(new Date(now));
  try {
    if (body.on) {
      const ok = (await daySacks(env, date)).some(s => s.sackId === sackId);
      if (!ok) return errorResponse('That sack was not scanned out today', 'VALIDATION_ERROR', 400);
      const r = await env.DB.prepare(
        `INSERT INTO cell_sacks (production_date, sack_id, station_id, ticked_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (production_date, sack_id) DO NOTHING`
      ).bind(date, sackId, station.station_id, sqliteUtc(new Date(now))).run();
      if (!r.meta || !r.meta.changes) {
        const other = await env.DB.prepare(`SELECT station_id FROM cell_sacks WHERE production_date = ? AND sack_id = ?`).bind(date, sackId).first();
        if (other && other.station_id !== station.station_id) return errorResponse('That sack is ticked to another cell', 'CONFLICT', 409);
      }
    } else {
      await env.DB.prepare(`DELETE FROM cell_sacks WHERE production_date = ? AND sack_id = ? AND station_id = ?`)
        .bind(date, sackId, station.station_id).run();
    }
    return successResponse({ success: true, sackId, on: !!body.on });
  } catch (e) {
    if (missing(e)) return notReady();
    throw e;
  }
}
