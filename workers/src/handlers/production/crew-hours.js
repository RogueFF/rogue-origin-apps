/**
 * Person-first hourly entry (Koa 2026-11-17, via the hub): one row per person
 * per hour, so a cover or a cell swap never mixes two people's numbers.
 *
 *   POST ?action=crewHourDay    password; the day's hours (typed over sheet), the people list
 *        { date }
 *   POST ?action=crewHourSave   password; one person's hour, typed
 *        { date, personId, slot, cell, lb, min }   or   { date, personId, slot, clear: true }
 *   POST ?action=crewPersonAdd  password; add a name that isn't in the list yet
 *        { name }
 *
 * One source of truth: crew_hours holds every hour, from the sheets (src 'sheet',
 * written by crewLoadDay) and from this page (src 'typed'). For a person and hour,
 * a typed row wins over a sheet row; a sheet load replaces only sheet rows and
 * never removes a typed one. crew_days (what Mis números and the crew board read)
 * is rebuilt from crew_hours for the whole date after every save and load.
 *
 * Full day vs part day: a person with no typed hour keeps the sheet's call. A
 * person with any typed hour is full when, in every slot from 7-8 to 3-4 that the
 * room worked that day, they worked at least as long as the longest anyone worked
 * in that slot (5 min slack). Leaving early, arriving late or covering = part day,
 * the same way the sheets were read. 4-4:30 counts toward the rate, not the test.
 *
 * Responses carry person ids (needed to save) but never a card token.
 */
import { successResponse, errorResponse } from '../../lib/response.js';
import { requireAuth } from '../../lib/auth.js';
import { newToken } from './crew-numbers.js';

const G_PER_LB = 453.59237;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const SLOTS = [
  ['7-8', 60], ['8-9', 60], ['9-10', 50], ['10-11', 60], ['11-12', 60],
  ['12-1', 30], ['1-2', 60], ['2-3', 50], ['3-4', 60], ['4-4:30', 30],
];
const SLOT_KEYS = SLOTS.map(([s]) => s);
const FULL_SLOTS = SLOT_KEYS.slice(0, 9);          // 7-8 .. 3-4
const SLACK_MIN = 5;
const order = (s) => { const i = SLOT_KEYS.indexOf(s); return i < 0 ? 99 : i; };

/** '7–8' -> '7-8', '3–4 SL' -> '3-4'. */
export function slotKey(s) {
  const k = String(s ?? '').replace(/[–—]/g, '-').trim();
  const sp = k.indexOf(' ');
  return (sp > 0 ? k.slice(0, sp) : k).slice(0, 20);
}

function cleanText(v, max) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().slice(0, max);
  return s === '' ? null : s;
}
const r1 = (x) => Math.round(x * 10) / 10;

/** Effective hours for a date: per person, per slot, typed over sheet. Rows with no minutes and no tops drop out. */
export function effectiveHours(rows) {
  const by = new Map();
  for (const r of rows) {
    let p = by.get(r.person_id);
    if (!p) { p = new Map(); by.set(r.person_id, p); }
    const cur = p.get(r.slot);
    if (!cur || (cur.src === 'sheet' && r.src === 'typed')) p.set(r.slot, r);
  }
  for (const [id, p] of by) {
    for (const [s, r] of p) if (!(Number(r.min) > 0) && !(Number(r.g) > 0)) p.delete(s);
    if (!p.size) by.delete(id);
  }
  return by;
}

/** Full day from effective hours (see the header). */
export function fullDayOf(personHours, slotLen) {
  return FULL_SLOTS.every((s) => !(slotLen[s] > 0) || (Number(personHours.get(s)?.min) || 0) >= slotLen[s] - SLACK_MIN);
}

/** Rebuild crew_days (and a typed day's meta) for one date from crew_hours. */
export async function recomputeDay(db, date) {
  const rows = (await db.prepare('SELECT person_id, slot, src, cell, g, min FROM crew_hours WHERE work_date = ?').bind(date).all()).results || [];
  const days = (await db.prepare('SELECT person_id, sheet_full_day FROM crew_days WHERE work_date = ?').bind(date).all()).results || [];
  const typedIds = new Set(rows.filter((r) => r.src === 'typed').map((r) => r.person_id));
  const eff = effectiveHours(rows);
  const slotLen = {};
  for (const p of eff.values()) for (const [s, r] of p) slotLen[s] = Math.max(slotLen[s] || 0, Number(r.min) || 0);

  const stmts = [];
  let allG = 0, allMin = 0;
  for (const [id, p] of eff) {
    const hours = [...p.values()].sort((a, b) => order(a.slot) - order(b.slot))
      .map((r) => ({ slot: r.slot, g: r1(Number(r.g) || 0), min: Math.round(Number(r.min) || 0), cell: r.cell || null }));
    const topsG = hours.reduce((a, h) => a + h.g, 0);
    const workMin = hours.reduce((a, h) => a + h.min, 0);
    allG += topsG; allMin += workMin;
    const byCell = new Map();
    for (const h of hours) if (h.cell) byCell.set(h.cell, (byCell.get(h.cell) || 0) + h.min);
    const cell = [...byCell].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const sheetFull = days.find((d) => d.person_id === id)?.sheet_full_day;
    const full = typedIds.has(id) ? (fullDayOf(p, slotLen) ? 1 : 0) : (sheetFull === 0 ? 0 : 1);
    stmts.push(db.prepare(
      `INSERT INTO crew_days (work_date, person_id, cell, hours_json, tops_g, work_min, full_day)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(work_date, person_id) DO UPDATE SET cell = excluded.cell, hours_json = excluded.hours_json,
         tops_g = excluded.tops_g, work_min = excluded.work_min, full_day = excluded.full_day`
    ).bind(date, id, cell, JSON.stringify(hours), topsG, workMin, full));
  }
  for (const d of days) {
    if (!eff.has(d.person_id)) stmts.push(db.prepare('DELETE FROM crew_days WHERE work_date = ? AND person_id = ?').bind(date, d.person_id));
  }

  // A sheet load sets the day's meta (goal and room rate from the hourly log) and
  // that stands. A typed-only day gets its room rate from the typed hours and the
  // last goal set before it.
  const meta = await db.prepare('SELECT note FROM crew_day_meta WHERE work_date = ?').bind(date).first();
  if (!meta || String(meta.note || '').startsWith('typed')) {
    const prev = await db.prepare('SELECT target_lb_hr FROM crew_day_meta WHERE work_date < ? AND target_lb_hr IS NOT NULL ORDER BY work_date DESC LIMIT 1').bind(date).first();
    const room = allMin > 0 ? Math.round(allG / G_PER_LB / (allMin / 60) * 1000) / 1000 : null;
    stmts.push(db.prepare(
      `INSERT INTO crew_day_meta (work_date, target_lb_hr, room_lb_hr, note) VALUES (?, ?, ?, 'typed: room rate of the typed hours')
       ON CONFLICT(work_date) DO UPDATE SET room_lb_hr = excluded.room_lb_hr,
         target_lb_hr = COALESCE(crew_day_meta.target_lb_hr, excluded.target_lb_hr)`
    ).bind(date, prev?.target_lb_hr ?? null, room));
  }
  if (stmts.length) await db.batch(stmts);
}

export async function crewHourDay(body, env, request) {
  requireAuth(request, body, env, 'production-crewHourDay');
  const date = String(body.date || '');
  if (!DATE_RE.test(date)) return errorResponse('date must be YYYY-MM-DD', 'VALIDATION_ERROR', 400);
  const people = (await env.DB.prepare('SELECT id, name FROM crew_people WHERE active = 1 ORDER BY name').all()).results || [];
  const rows = (await env.DB.prepare('SELECT person_id, slot, src, cell, g, min FROM crew_hours WHERE work_date = ?').bind(date).all()).results || [];
  const names = new Map(people.map((p) => [p.id, p.name]));
  const eff = effectiveHours(rows);
  const hours = [];
  for (const [id, p] of eff) {
    for (const r of p.values()) {
      hours.push({ personId: id, name: names.get(id) ?? null, slot: r.slot, cell: r.cell || null,
        g: r1(Number(r.g) || 0), lb: Math.round((Number(r.g) || 0) / G_PER_LB * 100) / 100, min: Number(r.min) || 0, src: r.src });
    }
  }
  const days = (await env.DB.prepare('SELECT person_id, full_day FROM crew_days WHERE work_date = ?').bind(date).all()).results || [];
  return successResponse({
    success: true, date,
    slots: SLOTS.map(([slot, min]) => ({ slot, min })),
    people: people.map((p) => ({ id: p.id, name: p.name })),
    hours,
    fullDay: Object.fromEntries(days.map((d) => [d.person_id, !!d.full_day])),
  });
}

export async function crewHourSave(body, env, request) {
  requireAuth(request, body, env, 'production-crewHourSave');
  const date = String(body.date || '');
  if (!DATE_RE.test(date)) return errorResponse('date must be YYYY-MM-DD', 'VALIDATION_ERROR', 400);
  const personId = Number(body.personId);
  const slot = slotKey(body.slot);
  if (!SLOT_KEYS.includes(slot)) return errorResponse('Unknown hour', 'VALIDATION_ERROR', 400);
  const person = Number.isInteger(personId) ? await env.DB.prepare('SELECT id FROM crew_people WHERE id = ? AND active = 1').bind(personId).first() : null;
  if (!person) return errorResponse('Unknown person', 'VALIDATION_ERROR', 400);

  if (body.clear === true) {
    await env.DB.prepare("DELETE FROM crew_hours WHERE work_date = ? AND person_id = ? AND slot = ? AND src = 'typed'").bind(date, personId, slot).run();
  } else {
    const lb = body.lb === null || body.lb === undefined || body.lb === '' ? 0 : Number(body.lb);
    const min = Number(body.min);
    if (!Number.isFinite(lb) || lb < 0 || lb > 11) return errorResponse('Tops must be 0 to 11 lb', 'VALIDATION_ERROR', 400);
    if (!Number.isFinite(min) || min < 0 || min > 120) return errorResponse('Minutes must be 0 to 120', 'VALIDATION_ERROR', 400);
    const cell = cleanText(body.cell, 10);
    await env.DB.prepare(
      `INSERT INTO crew_hours (work_date, person_id, slot, src, cell, g, min, updated_at) VALUES (?, ?, ?, 'typed', ?, ?, ?, datetime('now'))
       ON CONFLICT(work_date, person_id, slot, src) DO UPDATE SET cell = excluded.cell, g = excluded.g, min = excluded.min, updated_at = excluded.updated_at`
    ).bind(date, personId, slot, cell, r1(lb * G_PER_LB), Math.round(min)).run();
  }
  await recomputeDay(env.DB, date);
  return successResponse({ success: true, date, personId, slot });
}

export async function crewPersonAdd(body, env, request) {
  requireAuth(request, body, env, 'production-crewPersonAdd');
  const name = cleanText(body.name, 80);
  if (!name) return errorResponse('A name is required', 'VALIDATION_ERROR', 400);
  let p = await env.DB.prepare('SELECT id, name, active FROM crew_people WHERE name = ?').bind(name).first();
  if (p && !p.active) await env.DB.prepare('UPDATE crew_people SET active = 1 WHERE id = ?').bind(p.id).run();
  if (!p) {
    const res = await env.DB.prepare('INSERT INTO crew_people (name, token) VALUES (?, ?)').bind(name, newToken()).run();
    p = { id: res.meta.last_row_id, name };
  }
  return successResponse({ success: true, person: { id: p.id, name: p.name } });
}
