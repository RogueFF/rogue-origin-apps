/**
 * Crew Top 5 on the barn scoreboard (Koa 2026-11-17: "both"):
 *   · an always-on panel with the top 5 by tops lb per hour (lb big, grams
 *     small, as on the crew board) and the goal
 *   · on the TV only, the full crew board covers the scoreboard:
 *       - before anyone types today's first hour: the whole time, showing the
 *         last workday ("hold")
 *       - once today's hours are coming in: every ROTATE_EVERY_MS (start to
 *         start) for ROTATE_SHOW_MS, showing today ("rotate")
 *       - from EOD_HOLD_FROM (4:20 cleanup) on: today's full ranking, the whole
 *         time, until the next day's first hour ("hold")
 * Koa 2026-11-18: "before numbers are entered tomorrow, the scoreboard shows
 * rankings from today. As soon as they start entering numbers, it revolves every
 * 10 minutes for 2 minutes holding. Once they start entering numbers into the
 * cells hourly-entry, the rankings start going off of those new ones."
 * Then: "at EOD it should show the full rankings for the day (4:20 cleanup)… left
 * until tomorrow's numbers start getting entered."
 * Toyota rule: celebrate the best, never show the bottom. Only the top 5 is
 * drawn here, and nobody is ever marked red.
 *
 * Pure logic, no DOM: the controller is leaders.js; tests import this file.
 */

export const TOP = 5;
export const REFRESH_MS = 5 * 60 * 1000;          // re-read the crew board every 5 min…
export const HOLD_REFRESH_MS = 60 * 1000;         // …every minute while waiting for today's first hour
export const FETCH_TIMEOUT_MS = 10 * 1000;
// Koa 2026-11-18: "every 10 minutes for 2 minutes at a time" (was 30 s)
export const ROTATE_EVERY_MS = 10 * 60 * 1000;    // the crew board comes up every 10 min, start to start…
export const ROTATE_SHOW_MS = 2 * 60 * 1000;      // …for 2 min, then the scoreboard is back
export const ROTATE_RETRY_MS = 60 * 1000;         // a skipped turn tries again a minute later
export const PRELOAD_MS = 15 * 1000;              // the board loads hidden this long before it shows
export const READY_TIMEOUT_MS = 12 * 1000;        // not ready by then: skip this turn, never show an error
export const IDLE_AFTER_INPUT_MS = 60 * 1000;     // someone touched the board: leave it alone a minute
export const MIN_ROTATE_WIDTH = 1025;             // phones and tablets never rotate
export const EOD_HOLD_FROM = 16 * 60 + 20;        // 4:20 PM Pacific (cleanup): the day's board holds from here

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

/** Minutes since midnight on the farm (Pacific). */
export function pacificMinutes(ms = Date.now()) {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(ms)).split(':').map(Number);
  return h * 60 + m;
}

/**
 * Which day the panel shows: today, as soon as today has a ranking (someone
 * typed an hour on the Cell hourly log); before that, the latest workday before
 * today (Koa 2026-11-18, see the header). Returns { day, ranked, room } or null.
 */
export function pickDay(resp, today) {
  if (!resp || resp.success === false) return null;
  const by = resp.byDay && typeof resp.byDay === 'object' ? resp.byDay : null;
  if (by) {
    const days = Object.keys(by).filter((d) => ISO_DAY.test(d) && d <= today && Array.isArray(by[d]?.ranked) && by[d].ranked.length).sort();
    const d = days[days.length - 1];
    return d ? { day: d, ranked: by[d].ranked, room: by[d].room || null } : null;
  }
  // an older reply without byDay: its own last workday (never a future date)
  if (Array.isArray(resp.top) && ISO_DAY.test(resp.day || '') && resp.day <= today) return { day: resp.day, ranked: resp.top, room: resp.room || null };
  return null;
}

/**
 * The crewBoard reply → what the panel draws, or null to hide the panel
 * (failed call, success:false, no ranked workday). Rows are
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
  return { day: pick.day, live: pick.day === today, goal, rows };
}

/**
 * How the TV uses the crew board: 'hold' (the board stays up: before today's
 * first typed hour it shows the last workday; from 4:20 PM it shows today),
 * 'rotate' (today's hours are coming in: 10 min / 2 min), or null (nothing to show).
 */
export function rotationMode(model, ms = Date.now()) {
  if (!model) return null;
  if (!model.live) return 'hold';
  return pacificMinutes(ms) >= EOD_HOLD_FROM ? 'hold' : 'rotate';
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

/**
 * When the next show starts after one that started at `showStartedAt`: 10 min
 * start to start, so the crew board comes up on the same beat however long it
 * shows (counting from the end would drift to every 12 min with a 2 min show).
 */
export function nextRotationAt(showStartedAt) {
  return showStartedAt + ROTATE_EVERY_MS;
}

/** A local API root for previews (?api=http://localhost:PORT/api), else null. */
export function localApi(param) {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api$/.test(param || '') ? param : null;
}

/**
 * The crew board's TV view of one workday, in the scoreboard's language. With
 * `day` it shows the same day as the Top 5 panel.
 */
export function crewBoardUrl(lang, api, day) {
  const q = new URLSearchParams({ tv: '1', view: 'day', lang: lang === 'en' ? 'en' : 'es' });
  if (ISO_DAY.test(day || '')) q.set('day', day);
  const local = localApi(api);
  if (local) q.set('api', local);
  return `crew-board.html?${q.toString()}`;
}
