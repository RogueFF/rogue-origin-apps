/**
 * Set or clear a day's crew goal from the Cell hourly log (lib/cell-goal.js).
 *
 *   POST ?action=crewGoalSet  { date, lbHr }   farm password. lbHr empty/null clears
 *        the day's set goal (it falls back to the cultivar's break-even rate).
 *
 * A day whose sheets were loaded keeps the sheet's goal: setting one is refused.
 */
import { successResponse, errorResponse } from '../../lib/response.js';
import { requireAuth } from '../../lib/auth.js';
import { incrementDataVersion } from '../../lib/production-utils.js';
import { dayGoal, GOAL_SET_NOTE } from '../../lib/cell-goal.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function crewGoalSet(body, env, request) {
  requireAuth(request, body, env, 'production-crewGoalSet');
  const date = String(body.date || '');
  if (!DATE_RE.test(date)) return errorResponse('date must be YYYY-MM-DD', 'VALIDATION_ERROR', 400);
  const raw = body.lbHr;
  const clear = raw === null || raw === undefined || raw === '';
  const lbHr = clear ? null : Number(raw);
  if (!clear && !(Number.isFinite(lbHr) && lbHr > 0 && lbHr < 10)) {
    return errorResponse('goal must be lb per hour, above 0 and under 10', 'VALIDATION_ERROR', 400);
  }
  const meta = await env.DB.prepare('SELECT note FROM crew_day_meta WHERE work_date = ?').bind(date).first();
  if (meta && !String(meta.note || '').startsWith('typed')) {
    return errorResponse("This day's sheets are loaded: the sheet's goal stands", 'CONFLICT', 409);
  }
  if (clear) {
    await env.DB.prepare("UPDATE crew_day_meta SET target_lb_hr = NULL, note = 'typed: room rate of the typed hours' WHERE work_date = ?")
      .bind(date).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO crew_day_meta (work_date, target_lb_hr, room_lb_hr, note) VALUES (?, ?, NULL, ?)
       ON CONFLICT(work_date) DO UPDATE SET target_lb_hr = excluded.target_lb_hr, note = excluded.note`
    ).bind(date, Math.round(lbHr * 1000) / 1000, GOAL_SET_NOTE).run();
  }
  await incrementDataVersion(env);
  return successResponse({ success: true, date, goal: await dayGoal(env.DB, date) });
}
