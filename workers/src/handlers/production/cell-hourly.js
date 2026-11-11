/**
 * Manual hour-by-hour cell log (migration 0050), used until every table has a
 * live scale. Rows are keyed (production_date, time_slot, station_id), the same
 * key the scale rollup will write later with source = 'scale'.
 *
 *   GET  ?action=cellHourly&date=YYYY-MM-DD   roster, the day's rows, room smalls, slots, quality batches
 *   POST ?action=setCellHourly   { date, slot, stationId, tops?, notes?, cultivar?, quality? }
 *   POST ?action=setCellQuality  { date, stationId, batch, qTrim?, qStems?, qMold?, qInsects?,
 *                                  checkedBy?, notes?, cultivar? }   (each check 1-4 or null; migration 0051)
 *   POST ?action=setRoomSmalls   { date, slot, smalls?, cultivar? }
 *   POST ?action=saveCellRoster  { stationId?, label, lane, active? }   (no stationId = add a cell)
 *   POST ?action=scaleMark       { stationId, kind: 'pickup'|'tare', kg, cultivar?, bag?, cycleS?, jobId? }   from the cell screen
 *                                (jobId: a queued order's basket; the pickup closes it, migration 0061)
 *                                (a pickup = a finished job; cultivar/bag/cycleS say what it was, migration 0052)
 *                                (the auto rule uses pickups; readings are net since the crew tare on the scale)
 *
 * Cells with a scale also get an `auto` value per hour, worked out from their
 * settled readings (scale_events) and the screen's marks (lib/cell-auto.js).
 * It is computed on read, never stored; a typed value still wins on the page.
 *
 * Saves are field by field: only the keys present in the body are written, so
 * two people on two tablets never overwrite each other's other fields.
 * Nothing here touches monthly_production.
 */

import { successResponse, errorResponse } from '../../lib/response.js';
import { ALL_TIME_SLOTS, TIME_SLOT_MULTIPLIERS, parseSlotTimeToMinutes } from '../../lib/production-helpers.js';
import { autoTops } from '../../lib/cell-auto.js';
import { pacificParts } from '../../lib/pacific.js';
import { completeJob } from './order-flow.js';

const MAX_TOPS_LBS = 50;      // a cell-hour is a few lb; this only stops nonsense
const MAX_SMALLS_LBS = 200;
const MAX_NOTE = 500;
const MAX_LABEL = 40;
const MAX_CULTIVAR = 80;
// Quality checks per cell by batch, not by hour (migration 0051; Koa 2026-11-09):
// each cell starts the day at batch 1 and the next check after a fully scored
// batch is the next number. Four checks, each scored 1-4: "3-4 is passing
// quality, 1-2 is needing to be redone". `quality` is the batch's overall
// result: 'fail' (redo) if any check is 1 or 2, 'pass' once all four are 3 or 4,
// NULL until then.
const MAX_BATCH = 500;
const CHECKS = { qTrim: 'q_trim', qStems: 'q_stems', qMold: 'q_mold', qInsects: 'q_insects' };
const MAX_INITIALS = 10;
const OVERALL_SQL = `CASE
  WHEN q_trim <= 2 OR q_stems <= 2 OR q_mold <= 2 OR q_insects <= 2 THEN 'fail'
  WHEN q_trim >= 3 AND q_stems >= 3 AND q_mold >= 3 AND q_insects >= 3 THEN 'pass'
  ELSE NULL END`;

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

const SLOT_MINUTES = ALL_TIME_SLOTS.map(slot => {
  const [a, b] = slot.split('–').map(x => x.trim());
  return { slot, startMin: parseSlotTimeToMinutes(a), endMin: parseSlotTimeToMinutes(b) };
});

// A missing table (migration not applied yet) means no scale data, not an error.
async function allOrEmpty(stmt) {
  try { return (await stmt.all()).results || []; } catch (e) {
    if (/no such table/i.test(String(e && e.message))) return [];
    throw e;
  }
}

// Hourly tops worked out from each station's scale, for the given Pacific day.
async function autoRows(env, date, stationIds, now = new Date()) {
  if (!stationIds.length) return [];
  // A UTC window wide enough for any Pacific day; autoTops keeps only that day.
  const d = new Date(`${date}T12:00:00Z`);
  const from = new Date(d.getTime() - 24 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  const to = new Date(d.getTime() + 24 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  const marks = stationIds.map(() => '?').join(', ');
  const [readings, screenMarks] = await Promise.all([
    allOrEmpty(env.DB.prepare(
      `SELECT station_id, ts, weight_kg AS kg FROM scale_events
       WHERE station_id IN (${marks}) AND ts >= ? AND ts < ? ORDER BY ts, id`
    ).bind(...stationIds, from, to)),
    allOrEmpty(env.DB.prepare(
      `SELECT station_id, ts, kind, kg FROM scale_marks
       WHERE station_id IN (${marks}) AND ts >= ? AND ts < ? ORDER BY ts, id`
    ).bind(...stationIds, from, to)),
  ]);
  const p = pacificParts(now);
  const nowMin = p.hour * 60 + p.minute;
  const out = [];
  for (const id of stationIds) {
    const rs = readings.filter(r => r.station_id === id);
    if (!rs.length) continue;
    const { bySlot, flags } = autoTops({ day: date, readings: rs, marks: screenMarks.filter(m => m.station_id === id), slots: SLOT_MINUTES });
    for (const s of SLOT_MINUTES) {
      if (!(s.slot in bySlot)) continue;
      // An hour locks at its end; until then it's "so far".
      const final = date < p.day || (date === p.day && nowMin >= s.endMin);
      // flag 'scaleTared': the scale's own TARE was pressed mid-job; a lead should check the hour.
      out.push({ stationId: id, slot: s.slot, tops: bySlot[s.slot], final, flag: (flags[s.slot] || [])[0] || null });
    }
  }
  return out;
}

// Retail bag sizes a cell job can be (fill-weight standards; the cell screen's keys).
const BAGS = ['qOz', 'hOz', 'oz1', 'qLb', 'hLb', 'lb1'];
const MAX_CYCLE_S = 12 * 3600;

async function scaleMark(body, env) {
  const kind = body.kind === 'tare' || body.kind === 'pickup' ? body.kind : null;
  if (!kind) return errorResponse('kind must be tare or pickup', 'VALIDATION_ERROR', 400);
  const kg = Number(body.kg);
  if (!Number.isFinite(kg) || kg < 0 || kg > 10) return errorResponse('kg must be 0-10', 'VALIDATION_ERROR', 400);
  // What the job was (pickups only). A bad value is dropped, never a reason to lose the mark:
  // the hourly tops depend on it.
  const bag = kind === 'pickup' && BAGS.includes(body.bag) ? body.bag : null;
  const cultivar = kind === 'pickup' ? cleanText(body.cultivar, MAX_CULTIVAR) : null;
  const j = Number(body.jobId);
  const jobId = kind === 'pickup' && Number.isInteger(j) && j > 0 ? j : null;
  const c = Number(body.cycleS);
  const cycleS = kind === 'pickup' && Number.isFinite(c) && c > 0 && c <= MAX_CYCLE_S ? Math.round(c) : null;
  const station = await env.DB.prepare(`SELECT station_id FROM scale_stations WHERE station_id = ? AND kind = 'table'`)
    .bind(String(body.stationId || '')).first();
  if (!station) return errorResponse('Not a scale station', 'VALIDATION_ERROR', 400);
  if (jobId) {
    try {
      await env.DB.prepare(
        `INSERT INTO scale_marks (station_id, ts, kind, kg, cultivar, bag, cycle_s, job_id) VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?)`
      ).bind(station.station_id, kind, kg, cultivar, bag, cycleS, jobId).run();
      // Order flow slice 2 (0061): the pickup closes the queue job, and the cell's NEXT moves up.
      const done = await completeJob(env, { jobId, stationId: station.station_id, by: 'scale', netG: Math.round(kg * 100000) / 100, cycleS });
      return successResponse({ success: true, job: { cultivar, bag, cycleS, jobId, closed: done.ok, orderReady: !!done.orderReady } });
    } catch (e) {
      // Migration 0060 not applied yet: keep the mark without its job.
      if (!/no (such )?column|has no column/i.test(String(e && e.message))) throw e;
    }
  }
  if (bag || cultivar || cycleS) {
    try {
      await env.DB.prepare(
        `INSERT INTO scale_marks (station_id, ts, kind, kg, cultivar, bag, cycle_s) VALUES (?, datetime('now'), ?, ?, ?, ?, ?)`
      ).bind(station.station_id, kind, kg, cultivar, bag, cycleS).run();
      return successResponse({ success: true, job: { cultivar, bag, cycleS } });
    } catch (e) {
      // Migration 0052 not applied yet: keep the plain mark.
      if (!/no (such )?column|has no column/i.test(String(e && e.message))) throw e;
    }
  }
  await env.DB.prepare(`INSERT INTO scale_marks (station_id, ts, kind, kg) VALUES (?, datetime('now'), ?, ?)`)
    .bind(station.station_id, kind, kg).run();
  return successResponse({ success: true });
}

async function getCellHourly(params, env) {
  const date = params.date;
  if (!validDate(date)) return errorResponse('date must be YYYY-MM-DD', 'VALIDATION_ERROR', 400);
  const [roster, rows, room, batches] = await Promise.all([
    env.DB.prepare(`SELECT station_id, label, lane, sort, active FROM cell_roster ORDER BY sort, station_id`).all(),
    env.DB.prepare(
      `SELECT station_id, time_slot, cultivar, tops_lbs, quality, notes, source, updated_at
       FROM cell_hourly WHERE production_date = ?`
    ).bind(date).all(),
    env.DB.prepare(
      `SELECT time_slot, smalls_lbs, cultivar, updated_at FROM cell_room_hourly WHERE production_date = ?`
    ).bind(date).all(),
    // Before 0051 is applied the day still loads, with no batches.
    allOrEmpty(env.DB.prepare(
      `SELECT station_id, batch_no, cultivar, q_trim, q_stems, q_mold, q_insects, quality, checked_by, notes, updated_at
       FROM cell_quality WHERE production_date = ? ORDER BY station_id, batch_no`
    ).bind(date)),
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
    batches: batches.map(b => ({
      stationId: b.station_id, batch: b.batch_no, cultivar: b.cultivar, quality: b.quality,
      checks: { qTrim: b.q_trim, qStems: b.q_stems, qMold: b.q_mold, qInsects: b.q_insects },
      checkedBy: b.checked_by, notes: b.notes, updatedAt: b.updated_at,
      // A 1 on mold or insects: stop, call the lead.
      alert: b.q_mold === 1 || b.q_insects === 1 ? 'stop' : null,
    })),
    room: (room.results || []).map(r => ({
      slot: r.time_slot, smalls: r.smalls_lbs, cultivar: r.cultivar, updatedAt: r.updated_at,
    })),
    auto: await autoRows(env, date, (roster.results || []).map(r => r.station_id)),
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

// One quality batch at one cell. Field by field like the hourly saves, so two
// checkers never wipe each other's scores. The page picks the batch number:
// the next one after a fully scored batch.
async function setCellQuality(body, env) {
  const { date } = body;
  if (!validDate(date)) return errorResponse('date must be YYYY-MM-DD', 'VALIDATION_ERROR', 400);
  const batch = Number(body.batch);
  if (!Number.isInteger(batch) || batch < 1 || batch > MAX_BATCH) {
    return errorResponse(`batch must be a whole number from 1 to ${MAX_BATCH}`, 'VALIDATION_ERROR', 400);
  }
  const cell = await env.DB.prepare(`SELECT station_id FROM cell_roster WHERE station_id = ?`)
    .bind(String(body.stationId || '')).first();
  if (!cell) return errorResponse('Unknown cell', 'VALIDATION_ERROR', 400);

  const cols = [];
  const vals = [];
  for (const [key, col] of Object.entries(CHECKS)) {
    if (!has(body, key)) continue;
    const q = body[key] === null || body[key] === '' ? null : Number(body[key]);
    if (q !== null && !(Number.isInteger(q) && q >= 1 && q <= 4)) {
      return errorResponse(`${key} must be a score from 1 to 4, or empty`, 'VALIDATION_ERROR', 400);
    }
    cols.push(col); vals.push(q);
  }
  if (has(body, 'checkedBy')) { cols.push('checked_by'); vals.push(cleanText(body.checkedBy, MAX_INITIALS)); }
  if (has(body, 'notes')) { cols.push('notes'); vals.push(cleanText(body.notes, MAX_NOTE)); }
  if (has(body, 'cultivar')) { cols.push('cultivar'); vals.push(cleanText(body.cultivar, MAX_CULTIVAR)); }
  if (!cols.length) return errorResponse('Nothing to save', 'VALIDATION_ERROR', 400);

  const key = [date, cell.station_id, batch];
  await env.DB.prepare(
    `INSERT INTO cell_quality (production_date, station_id, batch_no, ${cols.join(', ')}, updated_at)
     VALUES (?, ?, ?, ${cols.map(() => '?').join(', ')}, datetime('now'))
     ON CONFLICT (production_date, station_id, batch_no) DO UPDATE SET
       ${cols.map(c => `${c} = excluded.${c}`).join(', ')}, updated_at = datetime('now')`
  ).bind(...key, ...vals).run();
  // The overall result follows the four checks.
  await env.DB.prepare(
    `UPDATE cell_quality SET quality = ${OVERALL_SQL}
     WHERE production_date = ? AND station_id = ? AND batch_no = ?`
  ).bind(...key).run();
  const quality = (await env.DB.prepare(
    `SELECT quality FROM cell_quality WHERE production_date = ? AND station_id = ? AND batch_no = ?`
  ).bind(...key).first())?.quality ?? null;

  return successResponse({ success: true, date, stationId: cell.station_id, batch, saved: cols, quality });
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

export { getCellHourly, setCellHourly, setCellQuality, setRoomSmalls, saveCellRoster, scaleMark, canonicalSlot, autoRows };
