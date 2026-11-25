/**
 * Line trimmer scales (Koa 2026-11-24, migration 0074). One scale and one screen
 * (cell.html) per trimmer seat on the buckers -> T-Zero -> trimmers line.
 *
 *   GET  ?action=lineCrew                       the crew list for the name tap: id + name, never a card token
 *   GET  ?action=lineState&stationId=           today's line cultivars by hour (Hourly entry, line 1) + who is on this seat
 *   POST ?action=lineSeat      { stationId, personId }      a name tap (personId 0 = nobody); moves the person off any other seat
 *   POST ?action=lineScaleSave { stationId, date, rows: [{ slot, personId, cultivar, g, min }] }
 *                                                absolute totals per hour, person and cultivar at this seat
 *   GET  ?action=lineScaleSeat&stationId=&date=[&detail=1]  this seat's totals (a tablet that lost its storage picks up
 *                                                from here); detail=1 adds the day's pickups and names (Cells board)
 *   GET  ?action=lineScaleHours&date=           every seat's hours, for Hourly entry
 *   POST ?action=lineScaleFillSet { date, on }  farm password: the per-day switch that lets the scales fill the tops
 *
 * No token on the seat calls, like scaleMark and setCellState: production
 * weights and crew first names only (the crew board already shows those), no
 * money, no buyer data. The seat must be a scale table station.
 *
 * Every save rebuilds that person's day for Mis números (crew-hours.js
 * recomputeDay, scale hours under typed and sheet hours) and, with the switch
 * on, the hour's tops on Hourly entry (lib/line-fill.js).
 */
import { successResponse, errorResponse } from '../../lib/response.js';
import { requireAuth } from '../../lib/auth.js';
import { pacificDay, parseSqliteUtc } from '../../lib/pacific.js';
import { incrementDataVersion } from '../../lib/production-utils.js';
import { ALL_TIME_SLOTS } from '../../lib/production-helpers.js';
import {
  LINE_SLOT_KEYS, SLOT_MIN, G_PER_LB, TOPS_SOURCE, slotKeyOfRow, lineFillOn, fillLineSlot, lineTopsFill, scaleHour, hourRow,
} from '../../lib/line-fill.js';
import { recomputeDay } from './crew-hours.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 60;
const MAX_G = 5000;          // 11 lb in an hour from one seat is a typo, same cap as typed hours
const MAX_CULTIVAR = 100;
const DAY_MS = 864e5;

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;

async function seatStation(env, stationId) {
  return env.DB.prepare(`SELECT station_id FROM scale_stations WHERE station_id = ? AND kind = 'table'`)
    .bind(String(stationId || '')).first();
}
const missingTable = (e) => /no such (table|column)/i.test(String(e?.message));
const notReady = () => errorResponse('Line scales are not set up yet (migration 0074)', 'NOT_READY', 503);

export async function lineCrew(env) {
  const people = (await env.DB.prepare('SELECT id, name FROM crew_people WHERE active = 1 ORDER BY name').all()).results || [];
  return successResponse({ success: true, people: people.map((p) => ({ id: p.id, name: p.name })) });
}

export async function lineState(params, env, now = new Date()) {
  const station = await seatStation(env, params.stationId);
  if (!station) return errorResponse('Not a scale seat', 'VALIDATION_ERROR', 400);
  const date = pacificDay(now);
  const rows = (await env.DB.prepare(
    `SELECT time_slot, cultivar1, change_at, change_cultivar FROM monthly_production
      WHERE production_date = ? AND cultivar1 IS NOT NULL AND cultivar1 != ''`
  ).bind(date).all()).results || [];
  const hours = rows.map((r) => ({ slot: slotKeyOfRow(r.time_slot), cultivar: r.cultivar1, changeAt: r.change_at || null, changeCultivar: r.change_cultivar || null }))
    .filter((h) => h.slot)
    .sort((a, b) => LINE_SLOT_KEYS.indexOf(a.slot) - LINE_SLOT_KEYS.indexOf(b.slot));
  let seat = null;
  try {
    const s = await env.DB.prepare('SELECT person_id, since FROM line_seats WHERE station_id = ?').bind(station.station_id).first();
    // A seat taken on an earlier day is empty today.
    if (s && pacificDay(parseSqliteUtc(s.since)) === date) seat = { personId: s.person_id, since: s.since };
  } catch (e) { if (!missingTable(e)) throw e; }
  return successResponse({ success: true, date, hours, seat });
}

export async function lineSeat(body, env) {
  const station = await seatStation(env, body.stationId);
  if (!station) return errorResponse('Not a scale seat', 'VALIDATION_ERROR', 400);
  const personId = Number(body.personId) || 0;
  try {
    if (!personId) {
      await env.DB.prepare('DELETE FROM line_seats WHERE station_id = ?').bind(station.station_id).run();
      return successResponse({ success: true, seat: null });
    }
    const p = Number.isInteger(personId) ? await env.DB.prepare('SELECT id FROM crew_people WHERE id = ? AND active = 1').bind(personId).first() : null;
    if (!p) return errorResponse('Unknown person', 'VALIDATION_ERROR', 400);
    // One seat per person: a tap here takes them off any other seat. Every tap restamps
    // since, so the same seat tapped again on a new day reads as today's.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM line_seats WHERE person_id = ? AND station_id != ?').bind(personId, station.station_id),
      env.DB.prepare(
        `INSERT INTO line_seats (station_id, person_id, since) VALUES (?, ?, datetime('now'))
         ON CONFLICT (station_id) DO UPDATE SET since = excluded.since, person_id = excluded.person_id`
      ).bind(station.station_id, personId),
    ]);
    const s = await env.DB.prepare('SELECT person_id, since FROM line_seats WHERE station_id = ?').bind(station.station_id).first();
    return successResponse({ success: true, seat: { personId: s.person_id, since: s.since } });
  } catch (e) {
    if (missingTable(e)) return notReady();
    throw e;
  }
}

/** Saves are for today or yesterday (a tablet flushing after midnight), never further back or ahead. */
function dateOk(date, now) {
  if (!DATE_RE.test(String(date || ''))) return false;
  const today = pacificDay(now);
  return date === today || date === pacificDay(new Date(now.getTime() - DAY_MS));
}

export async function lineScaleSave(body, env, now = new Date()) {
  const station = await seatStation(env, body.stationId);
  if (!station) return errorResponse('Not a scale seat', 'VALIDATION_ERROR', 400);
  const date = String(body.date || '');
  if (!dateOk(date, now)) return errorResponse('date must be today or yesterday (YYYY-MM-DD)', 'VALIDATION_ERROR', 400);
  const rows = Array.isArray(body.rows) ? body.rows : null;
  if (!rows || !rows.length) return errorResponse('rows is required', 'VALIDATION_ERROR', 400);
  if (rows.length > MAX_ROWS) return errorResponse(`At most ${MAX_ROWS} rows`, 'VALIDATION_ERROR', 400);

  const checked = [];
  for (const r of rows) {
    const slot = String(r?.slot || '');
    if (!LINE_SLOT_KEYS.includes(slot)) return errorResponse(`Unknown hour ${slot}`, 'VALIDATION_ERROR', 400);
    const personId = Number(r.personId) || 0;
    if (!Number.isInteger(personId) || personId < 0) return errorResponse('Bad personId', 'VALIDATION_ERROR', 400);
    const g = Number(r.g);
    const min = Number(r.min ?? 0);
    if (!Number.isFinite(g) || g > MAX_G) return errorResponse('g must be 0 to 5000', 'VALIDATION_ERROR', 400);
    if (!Number.isFinite(min) || min < 0) return errorResponse('min must be 0 or more', 'VALIDATION_ERROR', 400);
    // A shake after the hour mark can leave a bucket a little under 0: it counts as 0.
    checked.push({ slot, personId, cultivar: clean(r.cultivar, MAX_CULTIVAR), g: r1(Math.max(0, g)), min: r1(Math.min(min, SLOT_MIN[slot])) });
  }
  const people = [...new Set(checked.map((r) => r.personId).filter((id) => id > 0))];
  for (const id of people) {
    const p = await env.DB.prepare('SELECT id FROM crew_people WHERE id = ?').bind(id).first();
    if (!p) return errorResponse('Unknown person', 'VALIDATION_ERROR', 400);
  }
  try {
    // One statement per row (D1 caps a statement at 100 bound values).
    await env.DB.batch(checked.map((r) => env.DB.prepare(
      `INSERT INTO line_scale_hours (work_date, slot, station_id, person_id, cultivar, g, min, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (work_date, slot, station_id, person_id, cultivar) DO UPDATE SET g = excluded.g, min = excluded.min, updated_at = excluded.updated_at`
    ).bind(date, r.slot, station.station_id, r.personId, r.cultivar, r.g, r.min)));
  } catch (e) {
    if (missingTable(e)) return notReady();
    throw e;
  }
  // Mis números: that person's day, scale hours under any typed or sheet hour.
  for (const id of people) await recomputeDay(env.DB, date, { only: id });
  const fill = {};
  for (const slot of new Set(checked.map((r) => r.slot))) fill[slot] = await fillLineSlot(env, date, slot);
  return successResponse({ success: true, saved: checked.length, fill });
}

export async function lineScaleSeat(params, env) {
  const station = await seatStation(env, params.stationId);
  if (!station) return errorResponse('Not a scale seat', 'VALIDATION_ERROR', 400);
  const date = String(params.date || '');
  if (!DATE_RE.test(date)) return errorResponse('date must be YYYY-MM-DD', 'VALIDATION_ERROR', 400);
  try {
    const rows = (await env.DB.prepare(
      'SELECT slot, person_id, cultivar, g, min FROM line_scale_hours WHERE work_date = ? AND station_id = ?'
    ).bind(date, station.station_id).all()).results || [];
    const out = { success: true, date, rows: rows.map((r) => ({ slot: r.slot, personId: r.person_id, cultivar: r.cultivar, g: r.g, min: r.min })) };
    // detail=1 (the Cells board's seat panel, Koa 2026-11-25): the day's pickups and the names.
    if (params.detail === '1') Object.assign(out, await seatDetail(env, station.station_id, date, rows));
    return successResponse(out);
  } catch (e) {
    if (missingTable(e)) return successResponse({ success: true, date, rows: [] });
    throw e;
  }
}

/** A seat's pickups on a Pacific day (scale_marks) and the names behind its person ids. */
async function seatDetail(env, stationId, date, rows) {
  const marks = (await env.DB.prepare(
    `SELECT ts, kg, cultivar, cycle_s, person_id FROM scale_marks
      WHERE station_id = ? AND kind = 'pickup' AND ts >= date(?, '-1 day') AND ts < date(?, '+2 day') ORDER BY ts`
  ).bind(stationId, date, date).all()).results || [];
  const pickups = marks.filter((m) => pacificDay(parseSqliteUtc(m.ts)) === date)
    .map((m) => ({ ts: m.ts, g: r1((Number(m.kg) || 0) * 1000), cultivar: m.cultivar || '', cycleS: m.cycle_s ?? null, personId: m.person_id ?? 0 }));
  const ids = [...new Set([...rows.map((r) => r.person_id), ...pickups.map((p) => p.personId)].filter((id) => id > 0))];
  const names = {};
  for (const id of ids) {
    const p = await env.DB.prepare('SELECT name FROM crew_people WHERE id = ?').bind(id).first();
    if (p) names[id] = p.name;
  }
  return { pickups, names };
}

/** Every seat's hours for a day, for Hourly entry: per hour, a row per seat, person and cultivar. */
export async function lineScaleHours(params, env) {
  const date = String(params.date || '');
  if (!DATE_RE.test(date)) return errorResponse('date must be YYYY-MM-DD', 'VALIDATION_ERROR', 400);
  let rows;
  try {
    rows = (await env.DB.prepare(
      `SELECT h.slot, h.station_id, h.person_id, p.name, h.cultivar, h.g, h.min
         FROM line_scale_hours h LEFT JOIN crew_people p ON p.id = h.person_id
        WHERE h.work_date = ? ORDER BY h.station_id, p.name`
    ).bind(date).all()).results || [];
  } catch (e) {
    if (missingTable(e)) return successResponse({ success: true, date, fillOn: false, slots: [] });
    throw e;
  }
  const fillOn = await lineFillOn(env.DB, date);
  const slots = [];
  for (const [i, key] of LINE_SLOT_KEYS.entries()) {
    const mine = rows.filter((r) => r.slot === key);
    if (!mine.length) continue;
    const g = mine.reduce((a, r) => a + Math.max(0, Number(r.g) || 0), 0);
    const row = await hourRow(env.DB, date, key);
    // What the fill does with this hour: filled, typed tops win, or waiting for the lead's row.
    const would = lineTopsFill(row, await scaleHour(env.DB, date, key)).state;
    const fill = row && row.tops_source === TOPS_SOURCE ? 'filled' : would === 'fill' || would === 'same' ? 'ready' : would;
    slots.push({
      slot: key, long: ALL_TIME_SLOTS[i], g: r1(g), lb: r2(g / G_PER_LB), fill,
      rows: mine.map((r) => ({
        stationId: r.station_id, personId: r.person_id, name: r.person_id ? r.name || null : null,
        cultivar: r.cultivar || '', g: r1(Math.max(0, Number(r.g) || 0)), lb: r2(Math.max(0, Number(r.g) || 0) / G_PER_LB), min: Number(r.min) || 0,
      })),
    });
  }
  return successResponse({ success: true, date, fillOn, slots });
}

export async function lineScaleFillSet(body, env, request) {
  requireAuth(request, body, env, 'production-lineScaleFillSet');
  const date = String(body.date || '');
  if (!DATE_RE.test(date)) return errorResponse('date must be YYYY-MM-DD', 'VALIDATION_ERROR', 400);
  const on = body.on === true;
  try {
    await env.DB.prepare(
      `INSERT INTO line_scale_fill_days (production_date, enabled, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT (production_date) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`
    ).bind(date, on ? 1 : 0).run();
  } catch (e) {
    if (missingTable(e)) return notReady();
    throw e;
  }
  const states = {};
  if (on) {
    for (const key of LINE_SLOT_KEYS) states[key] = await fillLineSlot(env, date, key);
  } else {
    // Off: the filled tops go back to 0 for the lead to type. Typed tops stay.
    await env.DB.prepare(
      `UPDATE monthly_production SET tops_lbs1 = 0, change_tops_lbs = CASE WHEN change_cultivar IS NOT NULL AND change_cultivar != '' THEN 0 ELSE change_tops_lbs END,
              tops_source = NULL
        WHERE production_date = ? AND tops_source = ?`
    ).bind(date, TOPS_SOURCE).run();
    await incrementDataVersion(env);
  }
  return successResponse({ success: true, date, on, states });
}

