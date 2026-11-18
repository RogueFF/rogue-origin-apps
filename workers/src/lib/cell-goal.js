/**
 * The crew goal for a day (lb of tops per person-hour): one answer for the barn TV
 * (scoreboard), the crew board and Mis números (Koa 2026-11-18, via the cell hub:
 * "Yes, use cell goal").
 *
 * Which goal a day gets, first match wins:
 *   1. sheet    the day's sheets were loaded (crewLoadDay) with a goal: that stands
 *   2. set      someone set the day's goal on the Cell hourly log (farm password)
 *   3. default  the break-even rate for the day's main cultivar (CELL_TIE_RATES)
 *   4. carried  the last goal before the day (a cultivar with no tie rate)
 * or null when none of these exist.
 *
 * Stored in crew_day_meta (migration 0065), no new columns: a sheet row has a note
 * that does not start with 'typed'; a goal set on the page is a typed row whose
 * note starts with GOAL_SET_NOTE. A typed row's target is otherwise ignored, so the
 * goal older code copied forward onto typed days never beats the default.
 */

/**
 * Break-even ("tie") rates: the cells' lb of tops per person-hour at which a sack
 * nets the same as on the line, from the line baseline recomputed 2026-11-18
 * (cell-conversion fact base §4b, latest day per cultivar: Sour Lifter 11/17,
 * Lifter 11/13). Checked in order, so Sour Lifter comes before Lifter.
 * Change the numbers here and nowhere else.
 */
export const CELL_TIE_RATES = [
  { label: 'Sour Lifter', match: /sour\s*lifter/i, lbHr: 0.48 },
  { label: 'Lifter', match: /lifter/i, lbHr: 0.51 },
];

export const GOAL_SET_NOTE = 'typed: goal set on the cell log';

export const tieRateFor = (cultivar) => {
  const name = String(cultivar || '');
  return CELL_TIE_RATES.find((t) => t.match.test(name)) || null;
};

const isSheet = (m) => m && !String(m.note || '').startsWith('typed');
const isSet = (m) => m && String(m.note || '').startsWith(GOAL_SET_NOTE);

async function safeAll(stmt) {
  try { return (await stmt.all()).results || []; } catch (e) {
    if (/no such (table|column)/i.test(String(e?.message))) return [];
    throw e;
  }
}

/** The day's main cultivar: the one on the most hours (Hourly entry, then the room's
 *  cultivar on the cell log, then the cells'). Ties go to the earliest hour. */
export async function mainCultivar(db, date) {
  const rows = [
    ...await safeAll(db.prepare("SELECT time_slot AS slot, cultivar1 AS c FROM monthly_production WHERE production_date = ? AND COALESCE(cultivar1, '') <> ''").bind(date)),
    ...await safeAll(db.prepare("SELECT time_slot AS slot, cultivar AS c FROM cell_room_hourly WHERE production_date = ? AND COALESCE(cultivar, '') <> ''").bind(date)),
    ...await safeAll(db.prepare("SELECT time_slot AS slot, cultivar AS c FROM cell_hourly WHERE production_date = ? AND COALESCE(cultivar, '') <> ''").bind(date)),
  ];
  const bySlot = new Map();
  for (const r of rows) if (!bySlot.has(r.slot)) bySlot.set(r.slot, String(r.c).trim());
  const count = new Map();
  for (const c of bySlot.values()) count.set(c, (count.get(c) || 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

/**
 * The crew goal for one day: { lbHr, source: 'sheet'|'set'|'default'|'carried',
 * date (where it came from), cultivar? } or null.
 */
export async function dayGoal(db, date) {
  const metas = await safeAll(db.prepare(
    'SELECT work_date, target_lb_hr, note FROM crew_day_meta WHERE work_date <= ? AND target_lb_hr > 0 ORDER BY work_date DESC'
  ).bind(date));
  const today = metas.find((m) => m.work_date === date);
  if (today && isSheet(today)) return { lbHr: Number(today.target_lb_hr), source: 'sheet', date };
  if (today && isSet(today)) return { lbHr: Number(today.target_lb_hr), source: 'set', date };
  const cultivar = await mainCultivar(db, date);
  const tie = tieRateFor(cultivar);
  if (tie) return { lbHr: tie.lbHr, source: 'default', date, cultivar: tie.label };
  // carried: the last real goal (a sheet's or a set one) before the day
  const prev = metas.find((m) => m.work_date < date && (isSheet(m) || isSet(m)));
  return prev ? { lbHr: Number(prev.target_lb_hr), source: 'carried', date: prev.work_date } : null;
}
