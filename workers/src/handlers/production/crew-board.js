/**
 * Crew leaderboard for the barn TV and a QR page (Koa 2026-11-16).
 *
 *   GET ?action=crewBoard     public, no password
 *
 * Toyota-style: celebrate and teach from the best, never shame the bottom.
 * The response names only the top 5 and the most-improved person. It never
 * carries the full list, anyone else's rate, a rank below 5, or a card token.
 *
 * Rate = all of a person's full days to date: sum of tops g / sum of work
 * minutes over their full_day = 1 rows. Ranked once they have MIN_DAYS full days.
 * Most improved = the biggest rise from a person's first full day to their
 * latest (at least MIN_DAYS full days), not counting the top 5.
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
  const by = new Map();
  for (const r of rows) {
    if (!(r.work_min > 0)) continue;
    let p = by.get(r.person_id);
    if (!p) { p = { name: r.name, g: 0, min: 0, days: [] }; by.set(r.person_id, p); }
    p.g += r.tops_g;
    p.min += r.work_min;
    p.days.push({ date: r.work_date, rate: lbHr(r.tops_g, r.work_min) });
  }
  const people = [...by.values()].map((p) => {
    p.days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return { ...p, rate: lbHr(p.g, p.min), n: p.days.length };
  });
  const ranked = people.filter((p) => p.n >= MIN_DAYS)
    .sort((a, b) => b.rate - a.rate || b.n - a.n || a.name.localeCompare(b.name));
  const top = ranked.slice(0, TOP);
  const topSet = new Set(top);
  let improved = null;
  for (const p of ranked) {
    if (topSet.has(p)) continue;
    const first = p.days[0], last = p.days[p.days.length - 1];
    const rise = last.rate - first.rate;
    if (rise > 0 && (!improved || rise > improved.rise)) improved = { p, first, last, rise };
  }
  const allG = rows.reduce((a, r) => a + (r.work_min > 0 ? r.tops_g : 0), 0);
  const allMin = rows.reduce((a, r) => a + (r.work_min > 0 ? r.work_min : 0), 0);
  return {
    success: true,
    minDays: MIN_DAYS,
    rankedCount: ranked.length,
    top: top.map((p, i) => ({ rank: i + 1, name: p.name, days: p.n, ...pack(p.rate) })),
    mostImproved: improved ? {
      name: improved.p.name,
      days: improved.p.n,
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
    days: [...new Set(rows.map((r) => r.work_date))].sort(),
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
