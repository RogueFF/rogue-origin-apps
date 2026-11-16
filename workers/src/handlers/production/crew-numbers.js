/**
 * "Mis números": each trimmer sees their own tops per hour (Koa 2026-11-16).
 *
 *   GET  ?action=myNumbers&t=<token>    public; the personal QR card's token
 *                                        unlocks that one person's days only
 *   POST ?action=crewLoadDay             password; replaces one day's rows
 *        { date, target, roomRate, note, people: [{ name, cell, cultivar,
 *          fullDay, note, hours: [{ slot, g, min }] }] }
 *   POST ?action=crewPeople              password; names + tokens (for cards)
 *
 * What a card holder can see: their own days, the day's target and room rate,
 * and their rank among that day's full-day cells ("#4 of 18"). Never another
 * person's name or numbers. No money anywhere.
 */
import { successResponse, errorResponse } from '../../lib/response.js';
import { requireAuth } from '../../lib/auth.js';

const G_PER_LB = 453.59237;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 30;

const r2 = (x) => Math.round(x * 100) / 100;
export const rateOf = (topsG, workMin) => (workMin > 0 ? topsG / G_PER_LB / (workMin / 60) : null);

export function newToken() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Rank full-day rows by rate, best first. Returns Map(person_id -> rank) and the field size. */
export function rankDay(rows) {
  const full = rows.filter((r) => r.full_day && r.work_min > 0)
    .map((r) => ({ id: r.person_id, rate: rateOf(r.tops_g, r.work_min) }))
    .sort((a, b) => b.rate - a.rate);
  const ranks = new Map();
  full.forEach((r, i) => {
    // equal rates share a rank
    const prev = full[i - 1];
    ranks.set(r.id, prev && Math.abs(prev.rate - r.rate) < 1e-9 ? ranks.get(prev.id) : i + 1);
  });
  return { ranks, of: full.length };
}

function parseHours(json) {
  try {
    const h = JSON.parse(json);
    return Array.isArray(h) ? h : [];
  } catch {
    return [];
  }
}

export async function getMyNumbers(params, env) {
  const token = String(params.t || '');
  if (!TOKEN_RE.test(token)) return errorResponse('Unknown card', 'NOT_FOUND', 404);
  const person = await env.DB.prepare('SELECT id, name FROM crew_people WHERE token = ? AND active = 1').bind(token).first();
  if (!person) return errorResponse('Unknown card', 'NOT_FOUND', 404);

  const mine = (await env.DB.prepare(
    `SELECT work_date, cell, cultivar, hours_json, tops_g, work_min, full_day FROM crew_days
     WHERE person_id = ? ORDER BY work_date DESC LIMIT ?`
  ).bind(person.id, MAX_DAYS).all()).results || [];

  const days = [];
  for (const d of mine) {
    const field = (await env.DB.prepare(
      'SELECT person_id, tops_g, work_min, full_day FROM crew_days WHERE work_date = ?'
    ).bind(d.work_date).all()).results || [];
    const meta = await env.DB.prepare('SELECT target_lb_hr, room_lb_hr FROM crew_day_meta WHERE work_date = ?').bind(d.work_date).first();
    const { ranks, of } = rankDay(field);
    const rate = rateOf(d.tops_g, d.work_min);
    days.push({
      date: d.work_date,
      cell: d.cell,
      cultivar: d.cultivar,
      topsG: Math.round(d.tops_g),
      topsLb: r2(d.tops_g / G_PER_LB),
      hours: r2(d.work_min / 60),
      rate: rate === null ? null : r2(rate),
      fullDay: !!d.full_day,
      rank: d.full_day ? (ranks.get(person.id) ?? null) : null,
      of,
      target: meta?.target_lb_hr ?? null,
      roomRate: meta?.room_lb_hr ?? null,
      hourly: parseHours(d.hours_json).map((h) => ({
        slot: String(h.slot ?? ''),
        g: Math.round(Number(h.g) || 0),
        min: Math.round(Number(h.min) || 0),
        rate: Number(h.min) > 0 ? r2(rateOf(Number(h.g) || 0, Number(h.min))) : null,
      })),
    });
  }
  const rated = days.filter((d) => d.rate !== null && d.fullDay);
  const best = rated.reduce((b, d) => (!b || d.rate > b.rate ? d : b), null);
  return successResponse({
    success: true,
    name: person.name,
    days,
    best: best ? { date: best.date, rate: best.rate } : null,
  });
}

function cleanText(v, max) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().slice(0, max);
  return s === '' ? null : s;
}

export async function crewLoadDay(body, env, request) {
  requireAuth(request, body, env, 'production-crewLoadDay');
  const date = String(body.date || '');
  if (!DATE_RE.test(date)) return errorResponse('date must be YYYY-MM-DD', 'VALIDATION_ERROR', 400);
  const people = Array.isArray(body.people) ? body.people : null;
  if (!people || !people.length) return errorResponse('people[] is required', 'VALIDATION_ERROR', 400);

  const rows = [];
  const seen = new Set();
  for (const p of people) {
    const name = cleanText(p.name, 80);
    if (!name) return errorResponse('Every person needs a name', 'VALIDATION_ERROR', 400);
    if (seen.has(name.toLowerCase())) return errorResponse(`Duplicate name: ${name}`, 'VALIDATION_ERROR', 400);
    seen.add(name.toLowerCase());
    const hours = (Array.isArray(p.hours) ? p.hours : []).map((h) => ({
      slot: cleanText(h.slot, 20) || '',
      g: Math.max(0, Number(h.g) || 0),
      min: Math.max(0, Math.round(Number(h.min) || 0)),
    }));
    if (hours.some((h) => h.g > 5000 || h.min > 120)) {
      return errorResponse(`Out-of-range hour for ${name}`, 'VALIDATION_ERROR', 400);
    }
    const topsG = hours.reduce((a, h) => a + h.g, 0);
    const workMin = hours.reduce((a, h) => a + h.min, 0);
    rows.push({ name, cell: cleanText(p.cell, 10), cultivar: cleanText(p.cultivar, 60), hours, topsG, workMin,
      fullDay: p.fullDay === false ? 0 : 1, note: cleanText(p.note, 200) });
  }

  // People are matched by name (case-insensitive); a new name gets a new card token.
  const out = [];
  for (const r of rows) {
    let person = await env.DB.prepare('SELECT id, token FROM crew_people WHERE name = ?').bind(r.name).first();
    if (!person) {
      const token = newToken();
      const res = await env.DB.prepare('INSERT INTO crew_people (name, token) VALUES (?, ?)').bind(r.name, token).run();
      person = { id: res.meta.last_row_id, token };
    }
    r.personId = person.id;
    out.push({ name: r.name, token: person.token });
  }

  const stmts = [env.DB.prepare('DELETE FROM crew_days WHERE work_date = ?').bind(date)];
  for (const r of rows) {
    stmts.push(env.DB.prepare(
      `INSERT INTO crew_days (work_date, person_id, cell, cultivar, hours_json, tops_g, work_min, full_day, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(date, r.personId, r.cell, r.cultivar, JSON.stringify(r.hours), r.topsG, r.workMin, r.fullDay, r.note));
  }
  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  stmts.push(env.DB.prepare(
    `INSERT INTO crew_day_meta (work_date, target_lb_hr, room_lb_hr, note) VALUES (?, ?, ?, ?)
     ON CONFLICT(work_date) DO UPDATE SET target_lb_hr = excluded.target_lb_hr, room_lb_hr = excluded.room_lb_hr, note = excluded.note`
  ).bind(date, num(body.target), num(body.roomRate), cleanText(body.note, 300)));
  await env.DB.batch(stmts);
  return successResponse({ success: true, date, loaded: rows.length, people: out });
}

export async function crewPeople(body, env, request) {
  requireAuth(request, body, env, 'production-crewPeople');
  const rows = (await env.DB.prepare('SELECT name, token, active FROM crew_people ORDER BY name').all()).results || [];
  return successResponse({ success: true, people: rows.map((r) => ({ name: r.name, token: r.token, active: !!r.active })) });
}
