/**
 * The farm's work calendar, as arithmetic.
 *
 * Ported from addWorkHours in apps-script/production-tracking/Code.gs:2230.
 *
 * WHY THIS IS NOT A DATE PORT:
 * The original walks a JS Date and reads getHours(). In Apps Script that is
 * Pacific, because the Sheet is configured that way. In a Cloudflare Worker it
 * is UTC, so every shift boundary would land seven or eight hours off and every
 * finish date would be quietly wrong — worse, wrong by a different amount
 * across a DST change. This version carries a civil date string plus
 * minutes-since-midnight and never constructs a local Date, so there is no
 * timezone behaviour to get wrong. Callers hand it Pacific wall-clock and get
 * Pacific wall-clock back.
 *
 * A moment is `{ date: 'YYYY-MM-DD', minutes: <since midnight> }`.
 *
 * Design: docs/plans/2026-08-19-order-blocks-design.md
 */

const H = (h) => Math.round(h * 60);

/**
 * Schedule from CLAUDE.md. Breaks are [startMinute, endMinute) pairs:
 * 09:00 +10m, 12:00 +30m (lunch), 14:30 +10m, 16:20 +10m (cleanup).
 *
 * SATURDAY. The floor used to run Saturday mornings to noon, and this file
 * carried a `saturdayEndMin` and a half-day branch for it. As of 2026-08-21 the
 * farm does not work Saturdays at all, so Saturday joins Sunday in `daysOff`
 * and the half-day machinery is gone rather than left unreachable behind a day
 * off. If Saturdays come back, this is one entry and one branch to restore —
 * see git history for the original.
 *
 * Every promise date on the board gets later as a result: a week now holds five
 * working days and 42.5 productive hours instead of six and roughly 47.
 */
export const WORK_DAY = {
  startMin: H(7),
  endMin: H(16.5),
  daysOff: [0, 6],                  // Sunday, Saturday
  breaks: [[H(9), H(9) + 10], [H(12), H(12) + 30], [H(14.5), H(14.5) + 10], [H(16) + 20, H(16) + 30]],
};

// ─── CIVIL DATE ────────────────────────────────────────
// Date.UTC is used purely as a calendar calculator. It is timezone-invariant,
// unlike the local-time Date constructor.

function parse(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fmt(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(dateStr) {
  return new Date(parse(dateStr)).getUTCDay();
}

export function addDays(dateStr, n) {
  return fmt(parse(dateStr) + n * 86400000);
}

// ─── SHIFT SHAPE ───────────────────────────────────────

function isDayOff(dateStr, cal) {
  return cal.daysOff.includes(dayOfWeek(dateStr));
}

/** Productive minutes on a given date, breaks removed. */
export function workMinutesOnDay(dateStr, cal = WORK_DAY) {
  if (isDayOff(dateStr, cal)) return 0;
  const close = cal.endMin;
  let total = close - cal.startMin;
  for (const [bStart, bEnd] of cal.breaks) {
    // Only the part of a break that falls inside the shift costs anything. Every
    // working day is now a full one, but a caller may still pass a calendar with
    // a short close, so the clamp stays.
    const overlap = Math.min(bEnd, close) - Math.max(bStart, cal.startMin);
    if (overlap > 0) total -= overlap;
  }
  return Math.max(0, total);
}

// ─── THE WALK ──────────────────────────────────────────

/**
 * Advance `hours` of actual work from `start`, stepping over breaks, closing
 * time and days off.
 */
export function addWorkHours(start, hours, cal = WORK_DAY) {
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0) {
    throw new Error(`Invalid hours: ${hours}`);
  }

  let { date, minutes } = start;
  let remaining = Math.round(hours * 60);
  if (remaining === 0) return { date, minutes };

  const nextMorning = () => { date = addDays(date, 1); minutes = cal.startMin; };

  // Bounded so a malformed calendar cannot spin forever; five years of
  // iterations is far beyond any real order.
  for (let guard = 0; guard < 4000 && remaining > 0; guard++) {
    if (isDayOff(date, cal)) { nextMorning(); continue; }

    const close = cal.endMin;
    if (minutes < cal.startMin) minutes = cal.startMin;
    if (minutes >= close) { nextMorning(); continue; }

    // Sitting inside a break: jump to its end (or to tomorrow if the break
    // runs to closing, as the cleanup break does).
    const inBreak = cal.breaks.find(([s, e]) => minutes >= s && minutes < e && s < close);
    if (inBreak) {
      if (inBreak[1] >= close) nextMorning();
      else minutes = inBreak[1];
      continue;
    }

    const nextBreak = cal.breaks.find(([s]) => s > minutes && s < close);
    const until = nextBreak ? Math.min(nextBreak[0], close) : close;
    const available = until - minutes;

    if (available <= 0) { nextMorning(); continue; }

    if (remaining <= available) {
      minutes += remaining;
      remaining = 0;
      break;
    }

    remaining -= available;
    minutes = until;

    if (nextBreak && minutes === nextBreak[0]) {
      if (nextBreak[1] >= close) nextMorning();
      else minutes = nextBreak[1];
    } else {
      nextMorning();
    }
  }

  return { date, minutes };
}

/**
 * Whole work days, for the board. Rounds up because a run that spills ten
 * minutes into a second day still occupies that day on the floor.
 */
export function hoursToWorkDays(hours, cal = WORK_DAY) {
  if (hours <= 0) return 0;
  const perDay = (cal.endMin - cal.startMin - cal.breaks.reduce((s, [a, b]) => s + (b - a), 0)) / 60;
  return Math.ceil(hours / perDay);
}
