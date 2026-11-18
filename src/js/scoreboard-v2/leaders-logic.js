/**
 * Crew Top 5 on the barn scoreboard (Koa 2026-11-17: "both"):
 *   · an always-on panel with the last workday's top 5 by tops lb per hour
 *     (lb big, grams small, as on the crew board) and the goal
 *   · on the TV only, every ROTATE_EVERY_MS the full crew board covers the
 *     scoreboard for ROTATE_SHOW_MS, then the scoreboard comes back
 * Toyota rule: celebrate the best, never show the bottom. Only the top 5 is
 * drawn here, and nobody is ever marked red.
 *
 * Pure logic, no DOM: the controller is leaders.js; tests import this file.
 */

export const TOP = 5;
export const REFRESH_MS = 5 * 60 * 1000;          // re-read the crew board every 5 min
export const FETCH_TIMEOUT_MS = 10 * 1000;
export const ROTATE_EVERY_MS = 10 * 60 * 1000;    // the TV swaps to the crew board every 10 min…
export const ROTATE_SHOW_MS = 30 * 1000;          // …for 30 s, then back
export const ROTATE_RETRY_MS = 60 * 1000;         // a skipped turn tries again a minute later
export const PRELOAD_MS = 15 * 1000;              // the board loads hidden this long before it shows
export const READY_TIMEOUT_MS = 12 * 1000;        // not ready by then: skip this turn, never show an error
export const IDLE_AFTER_INPUT_MS = 60 * 1000;     // someone touched the board: leave it alone a minute
export const MIN_ROTATE_WIDTH = 1025;             // phones and tablets never rotate

export const LABELS = {
  en: {
    ldrTitle: 'Top 5 · lb/h',
    ldrGoal: 'Goal {lb} lb/h',
    ldrGrams: '{g} g/h',
    ldrOverGoal: 'Over the goal',
    ldrBoard: 'Crew board',
  },
  es: {
    ldrTitle: 'Los 5 mejores · lb/h',
    ldrGoal: 'Meta {lb} lb/h',
    ldrGrams: '{g} g/h',
    ldrOverGoal: 'Arriba de la meta',
    ldrBoard: 'Tablero del equipo',
  },
};

export const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (_, k) => (k in v ? v[k] : `{${k}}`));
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date on the farm (Pacific), YYYY-MM-DD. */
export function pacificToday(ms = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

/**
 * Which day the panel shows (Koa 2026-11-18: "show top 5 leaderboard on bottom
 * (based off of yesterdays numbers)"): the latest workday BEFORE today with a
 * ranking. Typed hours land in crew_hours during the shift, so the API's own
 * `day` can flip to today mid-shift; the board never shows a half day.
 * Returns { day, ranked, room } or null.
 */
export function pickDay(resp, today) {
  if (!resp || resp.success === false) return null;
  const by = resp.byDay && typeof resp.byDay === 'object' ? resp.byDay : null;
  if (by) {
    const days = Object.keys(by).filter((d) => ISO_DAY.test(d) && d < today && Array.isArray(by[d]?.ranked) && by[d].ranked.length).sort();
    const d = days[days.length - 1];
    return d ? { day: d, ranked: by[d].ranked, room: by[d].room || null } : null;
  }
  // an older reply without byDay: only its own last workday, and only if it isn't today
  if (Array.isArray(resp.top) && ISO_DAY.test(resp.day || '') && resp.day < today) return { day: resp.day, ranked: resp.top, room: resp.room || null };
  return null;
}

/**
 * The crewBoard reply → what the panel draws, or null to hide the panel
 * (failed call, success:false, no ranked workday before today). Rows are
 * capped at TOP and kept in the API's order (rank 1 first).
 */
export function panelModel(resp, today = pacificToday()) {
  const pick = pickDay(resp, today);
  if (!pick) return null;
  const goalLb = num(pick.room?.goal?.lbHr);
  const goalG = num(pick.room?.goal?.gph);
  const goal = goalLb !== null && goalLb > 0 ? { lbHr: goalLb, lb: goalLb.toFixed(2), gph: goalG !== null ? Math.round(goalG) : null } : null;
  const rows = pick.ranked
    .filter((p) => p && typeof p.name === 'string' && p.name.trim() && num(p.lbHr) !== null)
    .slice(0, TOP)
    .map((p, i) => ({
      rank: num(p.rank) ?? i + 1,
      name: p.name.trim(),
      lb: p.lbHr.toFixed(2),
      gph: num(p.gph) !== null ? Math.round(p.gph) : null,
      overGoal: goal ? p.lbHr >= goal.lbHr : false,
    }));
  if (!rows.length) return null;
  return { day: pick.day, goal, rows };
}

/** "Mon, Nov 17" / "lun, 17 nov" for the panel title (the data's own day, never "yesterday"). */
export function fmtDay(iso, lang) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * Only a TV rotates: TV Mode on (or ?rotate=1 on the bookmark), a wide screen,
 * not embedded in the hub, visible, nothing open on it, nobody touching it,
 * and a crew board worth showing. ?rotate=0 turns it off.
 */
export function shouldRotate(f) {
  if (!f) return false;
  if (f.rotateParam === '0') return false;
  if (!(f.tvMode || f.rotateParam === '1')) return false;
  if (f.embedded || f.hidden || f.busy) return false;
  if (!(f.width >= MIN_ROTATE_WIDTH)) return false;
  if (!f.hasLeaders) return false;
  if (typeof f.sinceInputMs === 'number' && f.sinceInputMs < IDLE_AFTER_INPUT_MS) return false;
  return true;
}

/** A local API root for previews (?api=http://localhost:PORT/api), else null. */
export function localApi(param) {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api$/.test(param || '') ? param : null;
}

/**
 * The crew board's TV view of one workday, in the scoreboard's language. With
 * `day` it shows the same day as the Top 5 panel (never today's half day).
 */
export function crewBoardUrl(lang, api, day) {
  const q = new URLSearchParams({ tv: '1', view: 'day', lang: lang === 'en' ? 'en' : 'es' });
  if (ISO_DAY.test(day || '')) q.set('day', day);
  const local = localApi(api);
  if (local) q.set('api', local);
  return `crew-board.html?${q.toString()}`;
}
