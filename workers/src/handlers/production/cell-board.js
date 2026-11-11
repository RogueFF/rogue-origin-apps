/**
 * The Cells board: every cell's screen, seen from other computers (Koa
 * 2026-11-09). The cell tablet reports its job; the board page reads them all
 * with each scale's live weight, and pops up "ready for pickup" when a bag is
 * finished (migration 0054).
 *
 *   POST ?action=setCellState { stationId, phase, cultivar?, bag?, targetG?, elapsedMs?,
 *                               paused?, pauseNote?, finishedNetG? }   from cell.html
 *   GET  ?action=cellBoard                                             for cells.html
 *   POST ?action=collectPickup { id, undo? }                           bag/tag took it off the spot
 *
 * Waiting at the pickup spot (Koa 2026-11-11, migration 0060): two weight-matched
 * baskets per cell. At the chime the full basket goes to a marked spot beside the
 * cell and the matched empty one goes on the scale, which closes the job (a pickup
 * mark). Every pickup mark not yet collected is "waiting at pickup spot" on the
 * board until bag/tag taps it collected. Only the last WAITING_HOURS count, so a
 * forgotten tap can't fill the board for good.
 *
 * No token, like scaleMark: it only describes the screen, it moves no stock
 * and holds no buyer data. Times are this Worker's clock, never the tablet's.
 */
import { successResponse, errorResponse } from '../../lib/response.js';
import { batteryOf } from '../../lib/battery.js';
import { recentEvents, notRecording } from '../../lib/untracked.js';

const PHASES = ['idle', 'armed', 'running', 'finished'];
const BAGS = ['qOz', 'hOz', 'oz1', 'qLb', 'hLb', 'lb1'];
const MAX_MS = 12 * 3600e3;
const TABLET_STALE_MS = 90e3;   // the tablet reports every 30 s while it's open
const LEGACY_STALE_S = 3;
const WAITING_HOURS = 24;
const UNDO_MIN = 10;          // a collected tap can be taken back this long
const sqlTime = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const parseUtc = s => Date.parse(String(s).replace(' ', 'T') + 'Z');

const clean = (v, max) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().slice(0, max);
  return s === '' ? null : s;
};
const num = (v, min, max) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

async function allOrEmpty(stmt) {
  try { return (await stmt.all()).results || []; } catch (e) {
    if (/no such (table|column)/i.test(String(e && e.message))) return [];
    throw e;
  }
}

export async function setCellState(body, env, now = Date.now()) {
  const phase = PHASES.includes(body.phase) ? body.phase : null;
  if (!phase) return errorResponse(`phase must be one of ${PHASES.join(', ')}`, 'VALIDATION_ERROR', 400);
  const cell = await env.DB.prepare(`SELECT station_id FROM cell_roster WHERE station_id = ?`)
    .bind(String(body.stationId || '')).first();
  if (!cell) return errorResponse('Unknown cell', 'VALIDATION_ERROR', 400);
  const targetG = num(body.targetG, 0, 10000);
  const elapsedMs = num(body.elapsedMs, 0, MAX_MS);
  const finishedNetG = num(body.finishedNetG, 0, 10000);
  if (targetG === undefined || elapsedMs === undefined || finishedNetG === undefined) {
    return errorResponse('targetG, elapsedMs or finishedNetG out of range', 'VALIDATION_ERROR', 400);
  }
  const paused = body.paused === true || body.paused === 1 ? 1 : 0;
  // A running clock is stored as its start on this Worker's clock, so the board
  // can tick it without trusting the tablet's time; a stopped one is frozen.
  const ticking = phase === 'running' && !paused && elapsedMs !== null;
  const clockStart = ticking ? Math.round(now - elapsedMs) : null;
  const clockMs = !ticking && elapsedMs !== null && (phase === 'running' || phase === 'finished') ? Math.round(elapsedMs) : null;
  await env.DB.prepare(
    `INSERT INTO cell_screen_state (station_id, phase, cultivar, bag, target_g, clock_start, clock_ms, paused, pause_note,
                                    finished_net_g, finished_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (station_id) DO UPDATE SET
       phase = excluded.phase, cultivar = excluded.cultivar, bag = excluded.bag, target_g = excluded.target_g,
       clock_start = excluded.clock_start, clock_ms = excluded.clock_ms, paused = excluded.paused,
       pause_note = excluded.pause_note, finished_net_g = excluded.finished_net_g,
       finished_at = CASE WHEN excluded.phase != 'finished' THEN NULL
                          WHEN cell_screen_state.phase = 'finished' THEN cell_screen_state.finished_at
                          ELSE excluded.finished_at END,
       updated_at = excluded.updated_at`
  ).bind(
    cell.station_id, phase, clean(body.cultivar, 80), BAGS.includes(body.bag) ? body.bag : null, targetG,
    clockStart, clockMs, paused, paused ? clean(body.pauseNote, 120) : null,
    phase === 'finished' ? finishedNetG : null, phase === 'finished' ? now : null, now,
  ).run();
  return successResponse({ success: true, stationId: cell.station_id, phase });
}

export async function getCellBoard(params, env, now = Date.now()) {
  const [roster, states, readings, stations, events, waitingRows] = await Promise.all([
    env.DB.prepare(`SELECT station_id, label, lane, sort FROM cell_roster WHERE active = 1 ORDER BY sort, station_id`).all(),
    allOrEmpty(env.DB.prepare(`SELECT * FROM cell_screen_state`)),
    allOrEmpty(env.DB.prepare(`SELECT * FROM scale_readings`)),   // * : batt_* exist only after 0055
    allOrEmpty(env.DB.prepare(`SELECT station_id, stale_after_s FROM scale_stations WHERE kind = 'table' AND active = 1`)),
    recentEvents(env, now),
    // Before 0060 there is no collected_at: nothing shows as waiting.
    allOrEmpty(env.DB.prepare(
      `SELECT id, station_id, ts, kg, cultivar, bag, cycle_s FROM scale_marks
       WHERE kind = 'pickup' AND collected_at IS NULL AND kg > 0 AND ts >= ? ORDER BY ts, id`
    ).bind(sqlTime(now - WAITING_HOURS * 3600e3))),
  ]);
  const byId = (rows) => new Map(rows.map(r => [r.station_id, r]));
  const st = byId(states), rd = byId(readings), sc = byId(stations);
  const cells = (roster.results || []).map(c => {
    const s = st.get(c.station_id);
    const station = sc.get(c.station_id);
    const r = station ? rd.get(c.station_id) : null;
    const at = r ? Date.parse(String(r.updated_at).replace(' ', 'T') + 'Z') : null;
    const staleS = station && station.stale_after_s > 0 ? station.stale_after_s : LEGACY_STALE_S;
    const live = at !== null && now - at <= staleS * 1000;
    return {
      stationId: c.station_id, label: c.label, lane: c.lane,
      // Trimming with no job on the screen (lib/untracked.js): { riseG, why } or null.
      notRecording: station ? notRecording({ scaleLive: live, events: events.get(c.station_id) || [], job: s || null, now }) : null,
      scale: station ? {
        weightG: r ? Math.round(r.weight * 100000) / 100 : null,
        stable: r ? r.stable === 1 : null,
        live,
        updatedAt: at,
        battery: batteryOf(r, now),
      } : null,
      job: s ? {
        phase: s.phase, cultivar: s.cultivar, bag: s.bag, targetG: s.target_g,
        clockStart: s.clock_start, clockMs: s.clock_ms, paused: s.paused === 1, pauseNote: s.pause_note,
        finishedNetG: s.finished_net_g, finishedAt: s.finished_at, updatedAt: s.updated_at,
        tabletOnline: now - s.updated_at <= TABLET_STALE_MS,
      } : null,
    };
  });
  const label = new Map((roster.results || []).map(c => [c.station_id, c.label]));
  const waiting = waitingRows.map(w => ({
    id: w.id, stationId: w.station_id, label: label.get(w.station_id) || w.station_id,
    at: parseUtc(w.ts), g: Math.round(w.kg * 100000) / 100, cultivar: w.cultivar, bag: w.bag, cycleS: w.cycle_s,
  }));
  return successResponse({ serverNow: now, cells, waiting });
}

/** Bag/tag took a basket off the pickup spot; undo: true puts it back (within UNDO_MIN). */
export async function collectPickup(body, env, now = Date.now()) {
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return errorResponse('id required', 'VALIDATION_ERROR', 400);
  let r;
  try {
    r = body.undo
      ? await env.DB.prepare(`UPDATE scale_marks SET collected_at = NULL WHERE id = ? AND kind = 'pickup' AND collected_at >= ?`)
        .bind(id, sqlTime(now - UNDO_MIN * 60e3)).run()
      : await env.DB.prepare(`UPDATE scale_marks SET collected_at = ? WHERE id = ? AND kind = 'pickup' AND collected_at IS NULL`)
        .bind(sqlTime(now), id).run();
  } catch (e) {
    if (/no such column/i.test(String(e && e.message))) return errorResponse('Pickup spot is not set up yet (migration 0060)', 'NOT_READY', 503);
    throw e;
  }
  if (!r.meta || !r.meta.changes) {
    return errorResponse(body.undo ? 'Too late to undo' : 'Already collected, or not a pickup', 'CONFLICT', 409);
  }
  return successResponse({ success: true, id, collected: !body.undo });
}
