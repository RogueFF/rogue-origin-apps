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
 * Continuous (wholesale) rounds (Koa 2026-11-11): bag 'cont' has no target; each
 * pickup ends a round. The board gives each cell the rounds it closed today
 * (Pacific day, from its 'cont' pickup marks), so the tile reads
 * "Continuous · cultivar · round N".
 *
 * No token, like scaleMark: it only describes the screen, it moves no stock
 * and holds no buyer data. Times are this Worker's clock, never the tablet's.
 */
import { successResponse, errorResponse } from '../../lib/response.js';
import { batteryOf } from '../../lib/battery.js';
import { recentEvents, notRecording, WINDOW_MS } from '../../lib/untracked.js';
import { eodActive } from '../../lib/cell-eod.js';
import { startJob, markCollected } from './order-flow.js';
import { pacificParts } from '../../lib/pacific.js';

const PHASES = ['idle', 'armed', 'running', 'finished'];
const BAGS = ['qOz', 'hOz', 'oz1', 'qLb', 'hLb', 'lb1', 'cont'];   // cont: continuous rounds, no target
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

/** The instant of Pacific midnight starting the day that contains now. */
export function pacificMidnight(now) {
  const p = pacificParts(new Date(now));
  return now - (p.hour * 60 + p.minute) * 60e3 - (now % 60e3);
}

async function allOrEmpty(stmt) {
  try { return (await stmt.all()).results || []; } catch (e) {
    if (/no such (table|column)/i.test(String(e && e.message))) return [];
    throw e;
  }
}

/**
 * History of the screen (cell_screen_log, migration 0062): a row only when the
 * phase, order or pause changed since the stored state, never on a heartbeat.
 * Before 0062, or on any error, it is skipped: the live state still saves.
 */
async function logScreenChange(env, stationId, s, now) {
  try {
    const prev = await env.DB.prepare(
      `SELECT phase, cultivar, bag, paused, pause_note FROM cell_screen_state WHERE station_id = ?`
    ).bind(stationId).first();
    if (prev && prev.phase === s.phase && (prev.cultivar ?? null) === s.cultivar && (prev.bag ?? null) === s.bag
      && (prev.paused || 0) === s.paused && (prev.pause_note ?? null) === s.note) return;
    await env.DB.prepare(
      `INSERT INTO cell_screen_log (station_id, ts, phase, cultivar, bag, paused, pause_note, job_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(stationId, new Date(now).toISOString().slice(0, 19).replace('T', ' '), s.phase, s.cultivar, s.bag, s.paused, s.note, s.jobId).run();
  } catch (e) {
    if (!/no such table/i.test(String(e && e.message))) console.error('[cell-screen-log]', e);
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
  const cultivar = clean(body.cultivar, 80), bag = BAGS.includes(body.bag) ? body.bag : null;
  const note = paused ? clean(body.pauseNote, 120) : null;
  await logScreenChange(env, cell.station_id, { phase, cultivar, bag, paused, note, jobId: Number(body.jobId) > 0 ? Number(body.jobId) : null }, now);
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
    cell.station_id, phase, cultivar, bag, targetG,
    clockStart, clockMs, paused, note,
    phase === 'finished' ? finishedNetG : null, phase === 'finished' ? now : null, now,
  ).run();
  // A queued order's basket started trimming (migration 0061): the order shows as trimming.
  if (phase === 'running' && Number(body.jobId) > 0) await startJob(env, cell.station_id, Number(body.jobId));
  return successResponse({ success: true, stationId: cell.station_id, phase });
}

export async function getCellBoard(params, env, now = Date.now()) {
  const [roster, states, readings, stations, events, waitingRows, eod, rounds] = await Promise.all([
    env.DB.prepare(`SELECT station_id, label, lane, sort FROM cell_roster WHERE active = 1 ORDER BY sort, station_id`).all(),
    allOrEmpty(env.DB.prepare(`SELECT * FROM cell_screen_state`)),
    allOrEmpty(env.DB.prepare(`SELECT * FROM scale_readings`)),   // * : batt_* exist only after 0055
    allOrEmpty(env.DB.prepare(`SELECT station_id, stale_after_s FROM scale_stations WHERE kind = 'table' AND active = 1`)),
    recentEvents(env, now),
    // Before 0060 there is no collected_at: nothing shows as waiting.
    allOrEmpty(env.DB.prepare(
      `SELECT id, station_id, ts, kg, cultivar, bag, cycle_s, job_id FROM scale_marks
       WHERE kind = 'pickup' AND collected_at IS NULL AND kg > 0 AND ts >= ? ORDER BY ts, id`
    ).bind(sqlTime(now - WAITING_HOURS * 3600e3))),
    eodActive(env, now, WINDOW_MS),
    // Continuous rounds closed today, per cell (Pacific midnight; offsets are whole minutes).
    allOrEmpty(env.DB.prepare(
      `SELECT station_id, COUNT(*) AS n FROM scale_marks
       WHERE kind = 'pickup' AND bag = 'cont' AND kg > 0 AND ts >= ? GROUP BY station_id`
    ).bind(sqlTime(pacificMidnight(now)))),
  ]);
  const roundsBy = new Map(rounds.map(r => [r.station_id, r.n]));
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
      // The lead is weighing the End of day leftovers on this scale (0062).
      eod: eod.has(c.station_id),
      // Trimming with no job on the screen (lib/untracked.js): { riseG, why } or null.
      notRecording: station ? notRecording({ scaleLive: live, events: events.get(c.station_id) || [], job: s || null, now, eod: eod.has(c.station_id) }) : null,
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
        // Continuous: rounds closed today; the one on the scale is round rounds + 1.
        rounds: s.bag === 'cont' ? roundsBy.get(c.station_id) || 0 : null,
      } : null,
    };
  });
  const label = new Map((roster.results || []).map(c => [c.station_id, c.label]));
  const waiting = waitingRows.map(w => ({
    id: w.id, stationId: w.station_id, label: label.get(w.station_id) || w.station_id,
    at: parseUtc(w.ts), g: Math.round(w.kg * 100000) / 100, cultivar: w.cultivar, bag: w.bag, cycleS: w.cycle_s, jobId: w.job_id,
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
  // A basket of a queued order (order flow slice 2): the job and its order follow.
  await markCollected(env, id, !body.undo);
  return successResponse({ success: true, id, collected: !body.undo });
}
