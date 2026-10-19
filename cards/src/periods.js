// Period helpers for the production cards: Pacific calendar dates, ISO weeks,
// and the API's hourly slot strings. Pure functions; all date arithmetic runs
// on UTC-noon Date values so no local timezone or DST shift can move a day.

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pacificFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const pad2 = (n) => String(n).padStart(2, '0');

/** The Pacific calendar date (YYYY-MM-DD) of an instant. */
export function pacificDate(date = new Date()) {
  const parts = Object.fromEntries(pacificFormat.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** YYYY-MM-DD → Date at 12:00 UTC on that calendar day. Throws on anything else. */
function parseYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? ''));
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(Date.UTC(y, mo - 1, d, 12));
    if (date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d) return date;
  }
  throw new Error(`bad date "${ymd}", expected YYYY-MM-DD`);
}

const toYmd = (date) => `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
const addDays = (date, n) => new Date(date.getTime() + n * DAY_MS);
const isoDay = (date) => date.getUTCDay() || 7; // Monday = 1 … Sunday = 7

/** ISO-8601 week of a UTC-noon date: { year, week }. */
function isoWeekOf(date) {
  const thursday = addDays(date, 4 - isoDay(date));
  const year = thursday.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1, 12));
  return { year, week: Math.floor(Math.round((thursday - jan1) / DAY_MS) / 7) + 1 };
}

/** Monday (UTC noon) of ISO week `week` of ISO year `year`. */
function isoWeekMonday(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4, 12));
  return addDays(jan4, (week - 1) * 7 - (isoDay(jan4) - 1));
}

const weekId = ({ year, week }) => `${year}-W${pad2(week)}`;

/** "2026-W42" → { start: Monday, end: Friday, week, year }. Throws when the week does not exist. */
export function weekRange(id) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(id ?? ''));
  const year = m ? Number(m[1]) : NaN;
  const week = m ? Number(m[2]) : NaN;
  if (!m || week < 1 || week > 53) throw new Error(`bad week "${id}", expected YYYY-Www with 01 ≤ ww ≤ 53`);
  const monday = isoWeekMonday(year, week);
  const check = isoWeekOf(monday);
  if (check.year !== year || check.week !== week) throw new Error(`bad week "${id}": ${year} has no ISO week ${week}`);
  return { start: toYmd(monday), end: toYmd(addDays(monday, 4)), week, year };
}

/**
 * The last finished Mon–Fri week as of `ymd`: on a weekday that is the week
 * before `ymd`'s own; on Saturday or Sunday it is `ymd`'s own week.
 */
export function lastCompleteWeek(ymd) {
  const date = parseYmd(ymd);
  const monday = addDays(date, 1 - isoDay(date));
  return weekId(isoWeekOf(isoDay(date) >= 6 ? monday : addDays(monday, -7)));
}

const SLOT_TIME = /(\d+):(\d+)\s*([AP]M)/gi;

function slotTimes(slot) {
  return [...String(slot ?? '').matchAll(SLOT_TIME)].map(([, h, min, ap]) => ({
    hour: Number(h),
    minute: Number(min),
    pm: ap.toUpperCase() === 'PM',
  }));
}

/** "12:30 PM – 1:00 PM" → "12½"; "7:00 AM – 8:00 AM" → "7". '' when unparseable. */
export function slotLabel(slot) {
  const [start] = slotTimes(slot);
  if (!start) return '';
  return `${start.hour}${start.minute === 30 ? '½' : ''}`;
}

/** "12:30 PM – 1:00 PM" → "13:00" (24-hour end of the slot). null when unparseable. */
export function slotEnd(slot) {
  const end = slotTimes(slot)[1];
  if (!end) return null;
  const hour24 = (end.hour % 12) + (end.pm ? 12 : 0);
  return `${pad2(hour24)}:${pad2(end.minute)}`;
}

/** Full English weekday of a calendar date: "2026-10-16" → "Friday". */
export function weekdayName(ymd) {
  return WEEKDAYS[parseYmd(ymd).getUTCDay()];
}
