/**
 * Manual hour-by-hour cell log (migration 0050), used until every table has a
 * live scale. Rows are keyed (production_date, time_slot, station_id), the same
 * key the scale rollup will write later with source = 'scale'.
 *
 *   GET  ?action=cellHourly&date=YYYY-MM-DD   roster, the day's rows, room smalls, slots
 *   POST ?action=setCellHourly   { date, slot, stationId, tops?, quality?, notes?, cultivar? }
 *   POST ?action=setRoomSmalls   { date, slot, smalls?, cultivar? }
 *   POST ?action=saveCellRoster  { stationId?, label, lane, active? }   (no stationId = add a cell)
 *
 * Saves are field by field: only the keys present in the body are written, so
 * two people on two tablets never overwrite each other's other fields.
 * Nothing here touches monthly_production.
 */

import { successResponse, errorResponse } from '../../lib/response.js';
import { ALL_TIME_SLOTS, TIME_SLOT_MULTIPLIERS } from '../../lib/production-helpers.js';

const MAX_TOPS_LBS = 50;      // a cell-hour is a few lb; this only stops nonsense
const MAX_SMALLS_LBS = 200;
const MAX_NOTE = 500;
const MAX_LABEL = 40;
const MAX_CULTIVAR = 80;

const norm = s => String(s || '').replace(/[-–—]/g, '-').replace(/\s+/g, ' ').trim();
const SLOT_BY_NORM = new Map(ALL_TIME_SLOTS.map(s => [norm(s), s]));

// Fixed canonical slots only: the scale rollup joins on these keys.
function canonicalSlot(slot) {
  return SLOT_BY_NORM.get(norm(slot)) || null;
}

function validDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))) return false;
  const t = new Date(`${d}T12:00:00Z`);
  return !isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

function has(body, key) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function cleanText(v, max) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().slice(0, max);
  return s === '' ? null : s;
}

// null clears the value; anything else must be a weight in range.
function cleanLbs(v, max) {
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) return { ok: false };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

async function getCellHourly(params, env) {
  const date = params.date;
  if (!validDate(date)) return errorResponse('date must be YYYY-MM-DD', 'VALIDATION_ERROR', 400);
  const [roster, rows, room] = await Promise.all([
    env.DB.prepare(`SELECT station_id, label, lane, sort, active FROM cell_roster ORDER BY sort, station_id`).all(),
    env.DB.prepare(
      `SELECT station_id, time_slot, cultivar, tops_lbs, quality, notes, source, updated_at
       FROM cell_hourly WHERE production_date = ?`
    ).bind(date).all(),
    env.DB.prepare(
      `SELECT time_slot, smalls_lbs, cultivar, updated_at FROM cell_room_hourly WHERE production_date = ?`
    ).bind(date).all(),
  ]);
  return successResponse({
    date,
    slots: ALL_TIME_SLOTS.map(slot => ({ slot, hours: TIME_SLOT_MULTIPLIERS[slot] ?? 1 })),
    roster: (roster.results || []).map(r => ({
      stationId: r.station_id, label: r.label, lane: r.lane, sort: r.sort, active: r.active === 1,
    })),
    rows: (rows.results || []).map(r => ({
      stationId: r.station_id, slot: r.time_slot, cultivar: r.cultivar, tops: r.tops_lbs,
      quality: r.quality, notes: r.notes, source: r.source, updatedAt: r.updated_at,
    })),
    room: (room.results || []).map(r => ({
      slot: r.time_slot, smalls: r.smalls_lbs, cultivar: r.cultivar, updatedAt: r.updated_at,
    })),
  });
}

async function setCellHourly(body, env) {
  const { date, stationId } = body;
  const slot = canonicalSlot(body.slot);
  if (!validDate(date)) return errorResponse('date must be YYYY-MM-DD', 'VALIDATION_ERROR', 400);
  if (!slot) return errorResponse('Unknown time slot', 'VALIDATION_ERROR', 400);
  const cell = await env.DB.prepare(`SELECT station_id FROM cell_roster WHERE station_id = ?`)
    .bind(String(stationId || '')).first();
  if (!cell) return errorResponse('Unknown cell', 'VALIDATION_ERROR', 400);

  const cols = [];
  const vals = [];
  if (has(body, 'tops')) {
    const t = cleanLbs(body.tops, MAX_TOPS_LBS);
    if (!t.ok) return errorResponse(`tops must be 0-${MAX_TOPS_LBS} lb`, 'VALIDATION_ERROR', 400);
    cols.push('tops_lbs'); vals.push(t.value);
  }
  if (has(body, 'quality')) {
    const q = body.quality === null || body.quality === '' ? null : String(body.quality);
    if (q !== null && q !== 'pass' && q !== 'fail') {
      return errorResponse('quality must be pass, fail or empty', 'VALIDATION_ERROR', 400);
    }
    cols.push('quality'); vals.push(q);
  }
  if (has(body, 'notes')) { cols.push('notes'); vals.push(cleanText(body.notes, MAX_NOTE)); }
  if (has(body, 'cultivar')) { cols.push('cultivar'); vals.push(cleanText(body.cultivar, MAX_CULTIVAR)); }
  if (!cols.length) return errorResponse('Nothing to save', 'VALIDATION_ERROR', 400);

  await env.DB.prepare(
    `INSERT INTO cell_hourly (production_date, time_slot, station_id, ${cols.join(', ')}, source, updated_at)
     VALUES (?, ?, ?, ${cols.map(() => '?').join(', ')}, 'manual', datetime('now'))
     ON CONFLICT (production_date, time_slot, station_id) DO UPDATE SET
       ${cols.map(c => `${c} = excluded.${c}`).join(', ')}, updated_at = datetime('now')`
  ).bind(date, slot, cell.station_id, ...vals).run();

  return successResponse({ success: true, date, slot, stationId: cell.station_id, saved: cols });
}

async function setRoomSmalls(body, env) {
  const { date } = body;
  const slot = canonicalSlot(body.slot);
  if (!validDate(date)) return errorResponse('date must be YYYY-MM-DD', 'VALIDATION_ERROR', 400);
  if (!slot) return errorResponse('Unknown time slot', 'VALIDATION_ERROR', 400);

  const cols = [];
  const vals = [];
  if (has(body, 'smalls')) {
    const s = cleanLbs(body.smalls, MAX_SMALLS_LBS);
    if (!s.ok) return errorResponse(`smalls must be 0-${MAX_SMALLS_LBS} lb`, 'VALIDATION_ERROR', 400);
    cols.push('smalls_lbs'); vals.push(s.value);
  }
  if (has(body, 'cultivar')) { cols.push('cultivar'); vals.push(cleanText(body.cultivar, MAX_CULTIVAR)); }
  if (!cols.length) return errorResponse('Nothing to save', 'VALIDATION_ERROR', 400);

  await env.DB.prepare(
    `INSERT INTO cell_room_hourly (production_date, time_slot, ${cols.join(', ')}, updated_at)
     VALUES (?, ?, ${cols.map(() => '?').join(', ')}, datetime('now'))
     ON CONFLICT (production_date, time_slot) DO UPDATE SET
       ${cols.map(c => `${c} = excluded.${c}`).join(', ')}, updated_at = datetime('now')`
  ).bind(date, slot, ...vals).run();

  return successResponse({ success: true, date, slot, saved: cols });
}

async function saveCellRoster(body, env) {
  const lane = body.lane === 'retail' ? 'retail' : body.lane === 'wholesale' || body.lane === undefined ? 'wholesale' : null;
  if (!lane) return errorResponse('lane must be wholesale or retail', 'VALIDATION_ERROR', 400);

  if (!body.stationId) {
    // Add a cell: the next tableN after the highest ever used (ids are never reused).
    const rows = (await env.DB.prepare(`SELECT station_id, sort FROM cell_roster`).all()).results || [];
    const maxN = rows.reduce((m, r) => Math.max(m, Number(String(r.station_id).replace(/^table/, '')) || 0), 0);
    const maxSort = rows.reduce((m, r) => Math.max(m, r.sort || 0), 0);
    const stationId = `table${maxN + 1}`;
    const label = cleanText(body.label, MAX_LABEL) || `Cell ${maxN + 1}`;
    await env.DB.prepare(
      `INSERT INTO cell_roster (station_id, label, lane, sort, active, updated_at) VALUES (?, ?, ?, ?, 1, datetime('now'))`
    ).bind(stationId, label, lane, maxSort + 1).run();
    return successResponse({ success: true, added: true, stationId, label, lane });
  }

  const cell = await env.DB.prepare(`SELECT station_id, label FROM cell_roster WHERE station_id = ?`)
    .bind(String(body.stationId)).first();
  if (!cell) return errorResponse('Unknown cell', 'VALIDATION_ERROR', 400);
  const label = cleanText(body.label, MAX_LABEL) || cell.label;
  const active = body.active === false || body.active === 0 ? 0 : 1;
  await env.DB.prepare(
    `UPDATE cell_roster SET label = ?, lane = ?, active = ?, updated_at = datetime('now') WHERE station_id = ?`
  ).bind(label, lane, active, cell.station_id).run();
  return successResponse({ success: true, stationId: cell.station_id, label, lane, active: active === 1 });
}

export { getCellHourly, setCellHourly, setRoomSmalls, saveCellRoster, canonicalSlot };
