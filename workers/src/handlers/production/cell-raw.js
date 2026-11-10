/**
 * Raw hand-out and weigh-back per cell (Koa 2026-11-10: "Build the screen entry
 * now"; design doc §2d, SOP-028). The water spider weighs raw on the bench scale
 * and types the grams on rawout.html (migration 0057).
 *
 *   POST ?action=rawOut  { stationId, cultivar, bag, bags, grams, suggestedG? }
 *        Opens the cell's lot, or tops up its open lot of the same cultivar. A
 *        different cultivar while raw is still at the cell is refused
 *        (WEIGH_BACK_FIRST): one cell, one lot of raw at a time.
 *   POST ?action=rawBack { stationId, grams }   weigh-back; closes the lot (0 = none left)
 *   POST ?action=rawUndo { stationId }          takes back the cell's last entry, within UNDO_MIN
 *   GET  ?action=rawBoard&date=YYYY-MM-DD       cells, open lots, the day's lots with yield,
 *                                               and yield per cultivar over ROLLUP_DAYS
 *
 * No token, like setCellState and scaleMark: production weights, no buyer data,
 * no money. Every write checks the cell is on the roster and the grams are sane.
 * Yield is worked out on read (lib/raw-yield.js).
 */
import { successResponse, errorResponse } from '../../lib/response.js';
import { pacificDay } from '../../lib/pacific.js';
import { lotYields } from '../../lib/raw-yield.js';

const BAGS = ['qOz', 'hOz', 'oz1', 'qLb', 'hLb', 'lb1'];
const MAX_OUT_G = 20000;      // 20 kg: more than any one order's raw
const MAX_BAGS = 50;
const UNDO_MIN = 15;
const ROLLUP_DAYS = 30;

const clean = (v, max) => {
  const s = String(v ?? '').trim().slice(0, max);
  return s === '' ? null : s;
};
const grams = (v, min, max) => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 10) / 10 : undefined;
};
const bad = msg => errorResponse(msg, 'VALIDATION_ERROR', 400);
const notReady = e => /no such table/i.test(String(e && e.message));

async function allOrEmpty(stmt) {
  try { return (await stmt.all()).results || []; } catch (e) {
    if (/no such (table|column)/i.test(String(e && e.message))) return [];
    throw e;
  }
}

async function cellOf(env, stationId) {
  return env.DB.prepare(`SELECT station_id, label FROM cell_roster WHERE station_id = ? AND active = 1`)
    .bind(String(stationId || '')).first();
}

const LOT_SQL = `SELECT l.id, l.station_id, l.production_date, l.cultivar, l.bag, l.bags, l.opened_at, l.closed_at,
    COALESCE(SUM(CASE WHEN r.kind = 'out' THEN r.grams END), 0) AS out_g,
    COALESCE(SUM(CASE WHEN r.kind = 'back' THEN r.grams END), 0) AS back_g,
    SUM(CASE WHEN r.kind = 'out' THEN 1 ELSE 0 END) AS outs
  FROM cell_raw_lots l LEFT JOIN cell_raw r ON r.lot_id = l.id`;
const lotOf = r => ({
  id: r.id, stationId: r.station_id, date: r.production_date, cultivar: r.cultivar, bag: r.bag, bags: r.bags,
  openedAt: r.opened_at, closedAt: r.closed_at, outG: r.out_g, backG: r.back_g, outs: r.outs,
});

async function openLot(env, stationId) {
  const r = await env.DB.prepare(`${LOT_SQL} WHERE l.station_id = ? AND l.closed_at IS NULL GROUP BY l.id ORDER BY l.id DESC LIMIT 1`)
    .bind(stationId).first();
  return r ? lotOf(r) : null;
}

export async function rawOut(body, env, now = new Date()) {
  const cell = await cellOf(env, body.stationId);
  if (!cell) return bad('Unknown cell');
  const cultivar = clean(body.cultivar, 80);
  if (!cultivar) return bad('Pick the cultivar');
  const g = grams(body.grams, 1, MAX_OUT_G);
  if (g === undefined) return bad(`grams must be 1-${MAX_OUT_G}`);
  const suggested = body.suggestedG == null ? null : grams(body.suggestedG, 0, 100000) ?? null;
  let open;
  try { open = await openLot(env, cell.station_id); } catch (e) {
    if (notReady(e)) return errorResponse('Raw hand-out is not set up yet (migration 0057)', 'NOT_READY', 503);
    throw e;
  }
  if (open && open.cultivar !== cultivar) {
    return errorResponse(`${cell.label} still has ${open.cultivar} raw out: weigh it back first`, 'WEIGH_BACK_FIRST', 409);
  }
  let lotId = open && open.id;
  if (!lotId) {
    const bag = BAGS.includes(body.bag) ? body.bag : null;
    if (!bag) return bad('Pick the bag size');
    const n = Number(body.bags ?? 1);
    if (!Number.isInteger(n) || n < 1 || n > MAX_BAGS) return bad(`bags must be 1-${MAX_BAGS}`);
    const row = await env.DB.prepare(
      `INSERT INTO cell_raw_lots (station_id, production_date, cultivar, bag, bags, opened_at) VALUES (?, ?, ?, ?, ?, datetime('now')) RETURNING id`
    ).bind(cell.station_id, pacificDay(now), cultivar, bag, n).first();
    lotId = row.id;
  }
  await env.DB.prepare(`INSERT INTO cell_raw (lot_id, kind, grams, suggested_g, ts) VALUES (?, 'out', ?, ?, datetime('now'))`)
    .bind(lotId, g, suggested).run();
  return successResponse({ success: true, lot: await openLot(env, cell.station_id), topUp: !!open });
}

export async function rawBack(body, env) {
  const cell = await cellOf(env, body.stationId);
  if (!cell) return bad('Unknown cell');
  let open;
  try { open = await openLot(env, cell.station_id); } catch (e) {
    if (notReady(e)) return errorResponse('Raw hand-out is not set up yet (migration 0057)', 'NOT_READY', 503);
    throw e;
  }
  if (!open) return errorResponse(`${cell.label} has no raw out`, 'NO_OPEN_LOT', 409);
  const g = grams(body.grams, 0, open.outG);
  if (g === undefined) return bad(`Back must be 0-${open.outG} g: more than was handed out`);
  await env.DB.prepare(`INSERT INTO cell_raw (lot_id, kind, grams, ts) VALUES (?, 'back', ?, datetime('now'))`).bind(open.id, g).run();
  await env.DB.prepare(`UPDATE cell_raw_lots SET closed_at = datetime('now') WHERE id = ?`).bind(open.id).run();
  return successResponse({ success: true, lotId: open.id, usedG: Math.round((open.outG - g) * 10) / 10 });
}

export async function rawUndo(body, env) {
  const cell = await cellOf(env, body.stationId);
  if (!cell) return bad('Unknown cell');
  const last = await env.DB.prepare(
    `SELECT r.id, r.kind, r.grams, r.lot_id FROM cell_raw r JOIN cell_raw_lots l ON l.id = r.lot_id
     WHERE l.station_id = ? AND r.ts >= datetime('now', ?) ORDER BY r.id DESC LIMIT 1`
  ).bind(cell.station_id, `-${UNDO_MIN} minutes`).first();
  if (!last) return errorResponse(`Nothing to undo from the last ${UNDO_MIN} min`, 'NOTHING_TO_UNDO', 409);
  if (last.kind === 'back') {
    const open = await openLot(env, cell.station_id);
    if (open) return errorResponse('A newer lot is open on this cell: undo that first', 'NOTHING_TO_UNDO', 409);
    await env.DB.prepare(`DELETE FROM cell_raw WHERE id = ?`).bind(last.id).run();
    await env.DB.prepare(`UPDATE cell_raw_lots SET closed_at = NULL WHERE id = ?`).bind(last.lot_id).run();
  } else {
    await env.DB.prepare(`DELETE FROM cell_raw WHERE id = ?`).bind(last.id).run();
    const left = await env.DB.prepare(`SELECT COUNT(*) AS n FROM cell_raw WHERE lot_id = ?`).bind(last.lot_id).first();
    if (!left.n) await env.DB.prepare(`DELETE FROM cell_raw_lots WHERE id = ?`).bind(last.lot_id).run();
  }
  return successResponse({ success: true, undone: { kind: last.kind, grams: last.grams } });
}

const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

export async function getRawBoard(params, env, now = new Date()) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date || '') ? params.date : pacificDay(now);
  const from = addDays(date, -(ROLLUP_DAYS - 1));
  const [roster, stations, screens, lotRows] = await Promise.all([
    env.DB.prepare(`SELECT station_id, label, lane, sort FROM cell_roster WHERE active = 1 ORDER BY sort, station_id`).all(),
    allOrEmpty(env.DB.prepare(`SELECT station_id FROM scale_stations WHERE kind = 'table' AND active = 1`)),
    allOrEmpty(env.DB.prepare(`SELECT station_id, phase, cultivar, bag FROM cell_screen_state`)),
    allOrEmpty(env.DB.prepare(
      `${LOT_SQL} WHERE (l.production_date BETWEEN ? AND ?) OR l.closed_at IS NULL GROUP BY l.id ORDER BY l.id`
    ).bind(from, date)),
  ]);
  const lots = lotRows.map(lotOf);
  const scaleStations = new Set(stations.map(s => s.station_id));
  const scaleLots = lots.filter(l => scaleStations.has(l.stationId));
  const firstOpen = scaleLots.reduce((m, l) => (!m || l.openedAt < m ? l.openedAt : m), null);
  const [marks, hourly] = await Promise.all([
    scaleLots.length ? allOrEmpty(env.DB.prepare(
      `SELECT station_id, ts, kg FROM scale_marks WHERE kind = 'pickup' AND ts >= ? ORDER BY ts`
    ).bind(firstOpen)) : [],
    allOrEmpty(env.DB.prepare(
      `SELECT h.station_id, h.production_date, COALESCE(h.cultivar, r.cultivar) AS cultivar, h.tops_lbs
       FROM cell_hourly h LEFT JOIN cell_room_hourly r ON r.production_date = h.production_date AND r.time_slot = h.time_slot
       WHERE h.production_date BETWEEN ? AND ? AND h.tops_lbs IS NOT NULL`
    ).bind(from, date)),
  ]);
  const y = lotYields({ lots, scaleStations, marks, hourly });
  const screenBy = new Map(screens.map(s => [s.station_id, s]));
  const openBy = new Map(y.lots.filter(l => !l.closed).map(l => [l.stationId, l]));
  const cells = (roster.results || []).map(c => {
    const s = screenBy.get(c.station_id);
    return {
      stationId: c.station_id, label: c.label, lane: c.lane, hasScale: scaleStations.has(c.station_id),
      // The order on the cell's screen right now, if it has one (only scale cells do).
      screen: s && s.cultivar ? { cultivar: s.cultivar, bag: s.bag, phase: s.phase } : null,
      open: openBy.get(c.station_id) || null,
    };
  });
  return successResponse({
    date, rollupFrom: from, ready: lotRows.length > 0 || (await tablesReady(env)),
    cells,
    lots: y.lots.filter(l => l.date === date),
    groups: y.groups.filter(g => g.date === date),
    byCultivar: y.byCultivar,
  });
}

async function tablesReady(env) {
  try { await env.DB.prepare(`SELECT 1 FROM cell_raw_lots LIMIT 1`).all(); return true; } catch (e) {
    if (notReady(e)) return false;
    throw e;
  }
}
