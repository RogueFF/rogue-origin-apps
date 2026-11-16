/**
 * Crew leaderboard for the barn TV and a QR page (Koa 2026-11-16).
 *
 *   GET ?action=crewBoard     public, no password
 *
 * Toyota-style: celebrate and teach from the best, never shame the bottom.
 * The response names only the top 5 and the most-improved person. It never
 * carries the full list, anyone else's rate, a rank below 5, or a card token.
 *
 * Top 5 = the previous workday only (Koa 2026-11-16: "top 5 from the previous
 * workday"): the latest work_date with full-day rows, ranked by that day's tops
 * g / work minutes. Anyone with a full day that day is ranked.
 * Most improved = the biggest rise from a person's first full day to their
 * latest (at least MIN_DAYS full days), where the latest is that same workday,
 * not counting the top 5.
 */
import { successResponse } from '../../lib/response.js';

const G_PER_LB = 453.59237;
export const MIN_DAYS = 2;
const TOP = 5;

const r2 = (x) => Math.round(x * 100) / 100;
const lbHr = (g, min) => (min > 0 ? g / G_PER_LB / (min / 60) : null);
const pack = (lb) => (lb === null || lb === undefined ? null : { gph: Math.round(lb * G_PER_LB), lbHr: r2(lb) });

/**
 * rows: { person_id, name, work_date, tops_g, work_min } for full-day rows of active people.
 * meta: the latest crew_day_meta row ({ work_date, target_lb_hr, room_lb_hr }) or null.
 */
export function boardFrom(rows, meta) {
  const full = rows.filter((r) => r.work_min > 0);
  const day = full.reduce((d, r) => (!d || r.work_date > d ? r.work_date : d), null);

  // the previous workday: one row per person, ranked by that day's rate
  const ranked = full.filter((r) => r.work_date === day)
    .map((r) => ({ id: r.person_id, name: r.name, rate: lbHr(r.tops_g, r.work_min) }))
    .sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name));
  const top = ranked.slice(0, TOP);
  const topIds = new Set(top.map((p) => p.id));

  // most improved: first full day -> that workday, outside the top 5
  const by = new Map();
  for (const r of full) {
    let p = by.get(r.person_id);
    if (!p) { p = { name: r.name, days: [] }; by.set(r.person_id, p); }
    p.days.push({ date: r.work_date, rate: lbHr(r.tops_g, r.work_min) });
  }
  let improved = null;
  for (const [id, p] of by) {
    if (topIds.has(id) || p.days.length < MIN_DAYS) continue;
    p.days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const first = p.days[0], last = p.days[p.days.length - 1];
    if (last.date !== day) continue;
    const rise = last.rate - first.rate;
    if (rise > 0 && (!improved || rise > improved.rise)) improved = { p, first, last, rise };
  }
  const allG = full.reduce((a, r) => a + r.tops_g, 0);
  const allMin = full.reduce((a, r) => a + r.work_min, 0);
  return {
    success: true,
    day,
    minDays: MIN_DAYS,
    rankedCount: ranked.length,
    top: top.map((p, i) => ({ rank: i + 1, name: p.name, ...pack(p.rate) })),
    mostImproved: improved ? {
      name: improved.p.name,
      days: improved.p.days.length,
      from: { date: improved.first.date, ...pack(improved.first.rate) },
      to: { date: improved.last.date, ...pack(improved.last.rate) },
      rise: pack(improved.rise),
    } : null,
    room: meta ? {
      date: meta.work_date,
      rate: pack(meta.room_lb_hr),
      goal: pack(meta.target_lb_hr),
    } : null,
    roomAllDays: pack(lbHr(allG, allMin)),
    days: [...new Set(full.map((r) => r.work_date))].sort(),
  };
}

export async function getCrewBoard(params, env) {
  const rows = (await env.DB.prepare(
    `SELECT d.person_id, p.name, d.work_date, d.tops_g, d.work_min
       FROM crew_days d JOIN crew_people p ON p.id = d.person_id
      WHERE d.full_day = 1 AND p.active = 1 AND d.work_min > 0`
  ).all()).results || [];
  const meta = await env.DB.prepare(
    'SELECT work_date, target_lb_hr, room_lb_hr FROM crew_day_meta ORDER BY work_date DESC LIMIT 1'
  ).first();
  return successResponse(boardFrom(rows, meta));
}
