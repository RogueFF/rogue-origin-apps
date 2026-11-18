/**
 * Crew leaderboard for the barn TV and a QR page (Koa 2026-11-16).
 *
 *   GET ?action=crewBoard     public, no password
 *
 * Two views (Koa 2026-11-17: "show all names", "one for overall, and one that
 * goes day by day"):
 *   · byDay[date]: everyone with a full day that date, ranked by that day's tops
 *     g / work minutes, plus that day's part-day people (listed, not ranked: a
 *     part day isn't comparable). Each day carries its room rate and goal.
 *   · overall: everyone ranked by pooled full days (all g / all minutes), with
 *     how many full days it covers. People with only part days are listed.
 * top / day / room keep the last workday (the TV's default view).
 * Most improved = the biggest rise from a person's first full day to their
 * latest (at least MIN_DAYS full days), where the latest is the last workday,
 * not counting that day's top 5. The response never carries a card token.
 */
import { successResponse } from '../../lib/response.js';

const G_PER_LB = 453.59237;
export const MIN_DAYS = 2;
const TOP = 5;

const r2 = (x) => Math.round(x * 100) / 100;
const lbHr = (g, min) => (min > 0 ? g / G_PER_LB / (min / 60) : null);
const pack = (lb) => (lb === null || lb === undefined ? null : { gph: Math.round(lb * G_PER_LB), lbHr: r2(lb) });
const isFull = (r) => r.full_day === undefined || r.full_day === null || Number(r.full_day) === 1;
const byRate = (a, b) => b.rate - a.rate || a.name.localeCompare(b.name);
const ranks = (list) => list.map((p, i) => ({ rank: i + 1, name: p.name, ...pack(p.rate), ...(p.days ? { days: p.days } : {}) }));

/**
 * rows: { person_id, name, work_date, tops_g, work_min, full_day } for rows of active
 * people (full_day missing = a full day).
 * metas: crew_day_meta rows ({ work_date, target_lb_hr, room_lb_hr }); a single row or
 * null is accepted too (older callers).
 */
export function boardFrom(rows, metas) {
  const metaList = Array.isArray(metas) ? metas : metas ? [metas] : [];
  const metaBy = new Map(metaList.map((m) => [m.work_date, m]));
  const worked = rows.filter((r) => r.work_min > 0);
  const full = worked.filter(isFull);
  const dates = [...new Set(full.map((r) => r.work_date))].sort();
  const day = dates.length ? dates[dates.length - 1] : null;

  // day by day: everyone with a full day, ranked; part days listed
  const byDay = {};
  for (const d of dates) {
    const fullThat = full.filter((r) => r.work_date === d);
    const fullIds = new Set(fullThat.map((r) => r.person_id));
    const ranked = fullThat.map((r) => ({ id: r.person_id, name: r.name, rate: lbHr(r.tops_g, r.work_min) })).sort(byRate);
    const part = worked.filter((r) => r.work_date === d && !isFull(r) && !fullIds.has(r.person_id))
      .map((r) => ({ name: r.name, rate: lbHr(r.tops_g, r.work_min), min: r.work_min })).sort(byRate);
    const m = metaBy.get(d);
    byDay[d] = {
      ranked: ranks(ranked),
      part: part.map((p) => ({ name: p.name, hours: r2(p.min / 60), ...pack(p.rate) })),
      room: m ? { rate: pack(m.room_lb_hr), goal: pack(m.target_lb_hr) } : null,
    };
  }

  // overall: pooled full days per person
  const pool = new Map();
  for (const r of full) {
    let p = pool.get(r.person_id);
    if (!p) { p = { name: r.name, g: 0, min: 0, days: 0 }; pool.set(r.person_id, p); }
    p.g += r.tops_g; p.min += r.work_min; p.days += 1;
  }
  const overall = [...pool.values()].map((p) => ({ name: p.name, rate: lbHr(p.g, p.min), days: p.days })).sort(byRate);
  const partOnly = [...new Set(worked.filter((r) => !pool.has(r.person_id)).map((r) => r.name))].sort();

  // the last workday's top 5 and most improved
  const lastRanked = full.filter((r) => r.work_date === day)
    .map((r) => ({ id: r.person_id, name: r.name, rate: lbHr(r.tops_g, r.work_min) })).sort(byRate);
  const topIds = new Set(lastRanked.slice(0, TOP).map((p) => p.id));
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
  const lastMeta = day ? metaBy.get(day) : null;
  return {
    success: true,
    day,
    minDays: MIN_DAYS,
    rankedCount: lastRanked.length,
    top: day ? byDay[day].ranked.slice(0, TOP) : [],
    byDay,
    overall: { ranked: ranks(overall), partOnly },
    mostImproved: improved ? {
      name: improved.p.name,
      days: improved.p.days.length,
      from: { date: improved.first.date, ...pack(improved.first.rate) },
      to: { date: improved.last.date, ...pack(improved.last.rate) },
      rise: pack(improved.rise),
    } : null,
    room: lastMeta ? { date: lastMeta.work_date, rate: pack(lastMeta.room_lb_hr), goal: pack(lastMeta.target_lb_hr) } : null,
    roomAllDays: pack(lbHr(allG, allMin)),
    days: dates,
  };
}

export async function getCrewBoard(params, env) {
  const rows = (await env.DB.prepare(
    `SELECT d.person_id, p.name, d.work_date, d.tops_g, d.work_min, d.full_day
       FROM crew_days d JOIN crew_people p ON p.id = d.person_id
      WHERE p.active = 1 AND d.work_min > 0`
  ).all()).results || [];
  const metas = (await env.DB.prepare(
    'SELECT work_date, target_lb_hr, room_lb_hr FROM crew_day_meta ORDER BY work_date'
  ).all()).results || [];
  return successResponse(boardFrom(rows, metas));
}
