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

/**
 * The crewBoard reply → what the panel draws, or null to hide the panel
 * (failed call, success:false, no ranked day). Rows are capped at TOP and kept
 * in the API's order (rank 1 first).
 */
export function panelModel(resp) {
  if (!resp || resp.success === false || !Array.isArray(resp.top)) return null;
  const goalLb = num(resp.room?.goal?.lbHr);
  const goalG = num(resp.room?.goal?.gph);
  const goal = goalLb !== null && goalLb > 0 ? { lbHr: goalLb, lb: goalLb.toFixed(2), gph: goalG !== null ? Math.round(goalG) : null } : null;
  const rows = resp.top
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
  const day = typeof resp.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(resp.day) ? resp.day : null;
  return { day, goal, rows };
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

/** The crew board's last-workday TV view, in the scoreboard's language. */
export function crewBoardUrl(lang, api) {
  const q = new URLSearchParams({ tv: '1', view: 'day', lang: lang === 'en' ? 'en' : 'es' });
  const local = localApi(api);
  if (local) q.set('api', local);
  return `crew-board.html?${q.toString()}`;
}
