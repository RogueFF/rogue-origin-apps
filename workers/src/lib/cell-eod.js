/**
 * End-of-day weighs on a cell's own scale (Koa 2026-11-11, Phase 1 scorecard;
 * migration 0062, handlers/production/cell-eod.js).
 *
 * At the end of the shift the lead opens the cell screen's End of day panel and
 * weighs the leftover raw and the fall-through tote on the cell scale. Those
 * readings land in scale_events like any other, so the panel's open time is an
 * EOD window: readings inside it are never tops (cell-auto.js) and never NOT
 * RECORDING (untracked.js, the board, the cron).
 */
import { parseSqliteUtc } from './pacific.js';

/** A window the tablet never closed (it slept, lost signal) ends this long after it opened. */
export const WINDOW_MAX_MS = 30 * 60 * 1000;
/** A raw or tote weigh can be taken back this long. */
export const UNDO_MS = 10 * 60 * 1000;

const ms = ts => {
  if (!ts) return null;
  const t = parseSqliteUtc(String(ts)).getTime();
  return Number.isFinite(t) ? t : null;
};

/** cell_eod window rows -> [{ fromMs, toMs }], an unclosed one capped at WINDOW_MAX_MS. */
export function windowsOf(rows) {
  const out = [];
  for (const r of rows || []) {
    if (r.kind && r.kind !== 'window') continue;
    const from = ms(r.ts);
    if (from === null) continue;
    const end = ms(r.ended_at);
    out.push({ fromMs: from, toMs: end !== null && end >= from ? Math.min(end, from + WINDOW_MAX_MS) : from + WINDOW_MAX_MS });
  }
  return out;
}

/** Inside any window, or within quietMs after one ended (recent rises still came from it). */
export function inWindow(windows, atMs, quietMs = 0) {
  return windows.some(w => atMs >= w.fromMs && atMs < w.toMs + quietMs);
}

async function allOrEmpty(stmt) {
  try { return (await stmt.all()).results || []; } catch (e) {
    if (/no such table/i.test(String(e && e.message))) return [];   // before 0062
    throw e;
  }
}

/** Every window that overlaps [fromSql, toSql) for these stations, as Map(station -> windows). */
export async function eodWindows(env, stationIds, fromSql, toSql) {
  const by = new Map();
  if (!stationIds.length) return by;
  // A window that opened up to WINDOW_MAX_MS before `from` can still reach into it.
  const before = new Date(ms(fromSql) - WINDOW_MAX_MS).toISOString().slice(0, 19).replace('T', ' ');
  const rows = await allOrEmpty(env.DB.prepare(
    `SELECT station_id, kind, ts, ended_at FROM cell_eod
     WHERE kind = 'window' AND station_id IN (${stationIds.map(() => '?').join(', ')}) AND ts >= ? AND ts < ?
     ORDER BY ts, id`
  ).bind(...stationIds, before, toSql));
  for (const r of rows) {
    if (!by.has(r.station_id)) by.set(r.station_id, []);
    by.get(r.station_id).push(...windowsOf([r]));
  }
  return by;
}

/** Stations whose End of day panel is open now, or closed within quietMs. */
export async function eodActive(env, nowMs, quietMs = 0) {
  const from = new Date(nowMs - WINDOW_MAX_MS - quietMs).toISOString().slice(0, 19).replace('T', ' ');
  const rows = await allOrEmpty(env.DB.prepare(
    `SELECT station_id, kind, ts, ended_at FROM cell_eod WHERE kind = 'window' AND ts >= ?`
  ).bind(from));
  const active = new Set();
  for (const r of rows) if (inWindow(windowsOf([r]), nowMs, quietMs)) active.add(r.station_id);
  return active;
}
