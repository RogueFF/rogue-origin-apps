// Period helpers for the production cards: Pacific calendar dates, ISO weeks,
// and the API's hourly slot strings. Pure functions; all date arithmetic runs
// on UTC-noon Date values so no local timezone or DST shift can move a day.
//
// Missing values: parsers and helpers return null for something they cannot
// read (an unreadable slot string); only the display formatters in model.js
// turn a missing value into "—". A malformed date or week id passed in by the
// caller is a bug, not missing data, and throws.

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PACIFIC = 'America/Los_Angeles';

const pacificDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: PACIFIC,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const pacificClockFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const pad2 = (n) => String(n).padStart(2, '0');
const partsOf = (format, date) => Object.fromEntries(format.formatToParts(date).map((p) => [p.type, p.value]));

/** The Pacific calendar date (YYYY-MM-DD) of an instant. */
export function pacificDate(date = new Date()) {
  const parts = partsOf(pacificDateFormat, date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** The Pacific wall-clock time (24-hour HH:MM) of an instant. */
export function pacificClock(date = new Date()) {
  const parts = partsOf(pacificClockFormat, date);
  return `${pad2(Number(parts.hour) % 24)}:${parts.minute}`;
}

/** YYYY-MM-DD → Date at 12:00 UTC on that calendar day, or null. */
function toDate(ymd) {
  const m = typeof ymd === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d, 12));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
}

/** Like toDate, but a malformed date throws. */
function parseYmd(ymd) {
  const date = toDate(ymd);
  if (!date) throw new Error(`bad date "${ymd}", expected YYYY-MM-DD`);
  return date;
}

const toYmd = (date) => `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
const addDays = (date, n) => new Date(date.getTime() + n * DAY_MS);
const isoDay = (date) => date.getUTCDay() || 7; // Monday = 1 … Sunday = 7

/** True only for a real calendar date written YYYY-MM-DD. */
export function isYmd(s) {
  return toDate(s) !== null;
}

/** `ymd` moved by `n` calendar days (n may be negative). */
export function addDaysYmd(ymd, n) {
  return toYmd(addDays(parseYmd(ymd), n));
}

/** The Mon–Fri date before `ymd`: Monday → the Friday before; Saturday and Sunday → that Friday. */
export function priorWeekday(ymd) {
  let date = addDays(parseYmd(ymd), -1);
  while (isoDay(date) >= 6) date = addDays(date, -1);
  return toYmd(date);
}

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

/** "2026-W42" (or "2026-w42") → { start: Monday, end: Friday, week, year }. Throws when the week does not exist. */
export function weekRange(id) {
  const m = /^(\d{4})-[Ww](\d{2})$/.exec(String(id ?? ''));
  const year = m ? Number(m[1]) : NaN;
  const week = m ? Number(m[2]) : NaN;
  if (!m || week < 1 || week > 53) throw new Error(`bad week "${id}", expected YYYY-Www with 01 ≤ ww ≤ 53`);
  const monday = isoWeekMonday(year, week);
  const check = isoWeekOf(monday);
  if (check.year !== year || check.week !== week) throw new Error(`bad week "${id}": ${year} has no ISO week ${week}`);
  return { start: toYmd(monday), end: toYmd(addDays(monday, 4)), week, year };
}

/** The five Mon–Fri dates of an ISO week id. */
export function weekDates(id) {
  const monday = parseYmd(weekRange(id).start);
  return [0, 1, 2, 3, 4].map((n) => toYmd(addDays(monday, n)));
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

/** Short month and day of a calendar date: "2026-10-19" → "Oct 19". */
export function monthDay(ymd) {
  const date = parseYmd(ymd);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/** "Oct 12–16, 2026", "Sep 28–Oct 2, 2026", "Dec 29, 2025–Jan 2, 2026"; one day → "Oct 16, 2026". */
export function rangeLabel(start, end) {
  const a = parseYmd(start);
  const b = parseYmd(end);
  if (b < a) throw new Error(`bad range: end ${end} is before start ${start}`);
  const md = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  const year = b.getUTCFullYear();
  if (a.getUTCFullYear() !== year) return `${md(a)}, ${a.getUTCFullYear()}–${md(b)}, ${year}`;
  if (a.getTime() === b.getTime()) return `${md(b)}, ${year}`;
  if (a.getUTCMonth() === b.getUTCMonth()) return `${md(a)}–${b.getUTCDate()}, ${year}`;
  return `${md(a)}–${md(b)}, ${year}`;
}

const SLOT_TIME = /(\d+):(\d+)\s*([AP]M)/gi;

function slotTimes(slot) {
  return [...String(slot ?? '').matchAll(SLOT_TIME)].map(([, h, min, ap]) => ({
    hour: Number(h),
    minute: Number(min),
    pm: ap.toUpperCase() === 'PM',
  }));
}

const minutesOf = (t) => ((t.hour % 12) + (t.pm ? 12 : 0)) * 60 + t.minute;
const shortHour = (t) => `${t.hour}${t.minute === 30 ? '½' : ''}`;

/** "12:30 PM – 1:00 PM" → "12½"; "7:00 AM – 8:00 AM" → "7". null when unreadable. */
export function slotLabel(slot) {
  const [start] = slotTimes(slot);
  return start ? shortHour(start) : null;
}

/** "3:00 PM – 4:00 PM" → "3–4"; "12:30 PM – 1:00 PM" → "12½–1". null without both ends. */
export function slotSpan(slot) {
  const [start, end] = slotTimes(slot);
  return start && end ? `${shortHour(start)}–${shortHour(end)}` : null;
}

/** "2:00 PM – 3:00 PM" → "2 PM"; "12:30 PM – 1:00 PM" → "12:30 PM" (12-hour start). null when unreadable. */
export function slotClock(slot) {
  const [start] = slotTimes(slot);
  if (!start) return null;
  return `${start.hour}${start.minute ? `:${pad2(start.minute)}` : ''} ${start.pm ? 'PM' : 'AM'}`;
}

/** "3:00 PM – 4:00 PM" → { start: 900, end: 960 } in minutes since midnight; end null when the slot has none. null when unreadable. */
export function slotMinutes(slot) {
  const [start, end] = slotTimes(slot);
  return start ? { start: minutesOf(start), end: end ? minutesOf(end) : null } : null;
}

/** "12:30 PM – 1:00 PM" → "13:00" (24-hour end of the slot). null when unreadable. */
export function slotEnd(slot) {
  const end = slotTimes(slot)[1];
  if (!end) return null;
  const minutes = minutesOf(end);
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

/** Full English weekday of a calendar date: "2026-10-16" → "Friday". */
export function weekdayName(ymd) {
  return WEEKDAYS[parseYmd(ymd).getUTCDay()];
}

/** Three-letter English weekday: "2026-10-15" → "Thu". */
export function shortWeekday(ymd) {
  return weekdayName(ymd).slice(0, 3);
}
