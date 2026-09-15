/**
 * Formatting helpers for the Floor Manager — pure functions, no DOM.
 *
 * The floor page reads these dozens of times a minute (every tick render,
 * every field blur), so each one takes a raw value and never throws: a
 * missing weight or a malformed slot label prints as '—' or falls back to
 * its own input rather than crashing the render loop the manager is staring
 * at mid-shift.
 */

/**
 * '17.1'; '—' for anything that is not a finite number. Checked on the raw
 * value rather than `Number(v)` on purpose — `Number(null)` is 0, and a
 * missing reading rendering as "0.0" is a worse lie than a dash (matches
 * hub/format.js's isNum() guard).
 */
export function num(v, d = 1) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return v.toFixed(d);
}

/**
 * One decimal, but never a dangling `.0` — 10.0 reads as 10, 10.5 stays 10.5.
 * Port of index.js:1762 (lbsText). Kept separate from num() because the two
 * disagree on purpose: num() always shows its decimal place (a table column
 * that jumps between 1 and 2 digits is harder to scan), lbsText() is for
 * prose ("17 lb left") where the trailing zero just adds noise.
 */
export function lbsText(n) {
  const v = Math.round((Number(n) || 0) * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** '9:58 AM' in the browser's local time. */
export function clockTime(date) {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * 'M:SS', no hour rollover — port of formatTimeMMSS index.js:4707. The bag
 * timer and the target/average readouts never run past 99 minutes, so unlike
 * a clock display there is deliberately no hour digit to roll into.
 */
export function mmss(totalSeconds) {
  const total = Number(totalSeconds) || 0;
  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Parse '7:00 AM' / '12:30 PM' into its parts. Returns null on anything else. */
function parseClockPart(str) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/.exec(String(str || '').trim());
  if (!m) return null;
  return { h: Number(m[1]), m: Number(m[2]), meridiem: m[3] };
}

/** '7:00' -> '7', '12:30' stays '12:30' — drop a bare :00, keep anything else. */
function shortClockPart({ h, m }) {
  return m === 0 ? String(h) : `${h}:${String(m).padStart(2, '0')}`;
}

/**
 * '7:00 AM – 8:00 AM' -> '7–8 AM'; cross-meridian slots keep both periods
 * ('11:00 AM – 12:00 PM' -> '11 AM–12 PM') so the boundary is never
 * ambiguous. En dash (U+2013), matching the slot strings themselves.
 */
export function hourTitle(slot) {
  const [startStr, endStr] = String(slot).split(' – ');
  const start = parseClockPart(startStr);
  const end = parseClockPart(endStr);
  if (!start || !end) return String(slot);
  const startShort = shortClockPart(start);
  const endShort = shortClockPart(end);
  if (start.meridiem === end.meridiem) {
    return `${startShort}–${endShort} ${end.meridiem}`;
  }
  return `${startShort} ${start.meridiem}–${endShort} ${end.meridiem}`;
}

/**
 * Ribbon tick label: '7a', '12:30p', '4p'. Every tick carries its own
 * meridiem, so a stand-in reading the ribbon cold never has to work out
 * which side of noon '2' is on, and the form is compact enough that the
 * half-hour ticks still fit at 1280 wide. Same shape as the Ops Hub ledger's
 * hourShort(). `index` and `slots` are accepted for call-site compatibility
 * and unused.
 */
export function tickLabel(slot, _index, _slots) {
  const start = parseClockPart(String(slot).split(' – ')[0]);
  if (!start) return String(slot);
  return `${shortClockPart(start)}${start.meridiem === 'PM' ? 'p' : 'a'}`;
}

/**
 * "2025 - Lifter / Sungrown" -> { name: "Lifter", grow: "Sungrown", year: "2025" }.
 * Port of hub/format.js cultivarParts. Anything that is not in that shape
 * comes back whole as `name` (the string the API will accept on save).
 */
export function cultivarParts(s) {
  const str = String(s || '').trim();
  const m = /^(\d{4})\s*-\s*(.+?)(?:\s*\/\s*(.+))?$/.exec(str);
  if (!m) return { name: str || '—', grow: '', year: '' };
  return { year: m[1], name: m[2].trim(), grow: (m[3] || '').trim() };
}

/** "Lifter · Sungrown · 2025" — the option label; the option VALUE stays raw. */
export function cultivarLabel(s) {
  const p = cultivarParts(s);
  return [p.name, p.grow, p.year].filter(Boolean).join(' · ');
}

/**
 * What a pounds field shows for a stored weight: one decimal for anything
 * recorded (5.3, 10.0), empty for nothing — the field's placeholder is the
 * em dash the ribbon uses for the same absence. A value that already carries
 * more precision is left exactly as stored, so re-saving an untouched hour
 * can never round it.
 */
export function fieldText(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  return Math.round(n * 10) === n * 10 ? n.toFixed(1) : String(n);
}

const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * { weekday, date } for the header. Built from the yyyy-mm-dd parts via
 * `new Date(y, m-1, d)`, never `new Date('yyyy-mm-dd')` — the string form
 * parses as UTC midnight, which west of Greenwich renders as the previous
 * day (see etaText below for the same rule on queue dates).
 */
export function dateHeading(yyyyMmDd, lang) {
  const [y, m, d] = String(yyyyMmDd).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const isEs = lang === 'es';
  const weekday = isEs ? WEEKDAYS_ES[date.getDay()] : WEEKDAYS_EN[date.getDay()];
  const dateText = isEs
    ? `${d} ${MONTHS_ES[m - 1]} ${y}`
    : `${MONTHS_EN[m - 1]} ${d}, ${y}`;
  return { weekday, date: dateText };
}

const ETA_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ETA_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * 'Thu Aug 27 9:56 AM' from { date, minutes }. Port of etaText index.js:1841,
 * verbatim — built from parts via `Date.UTC(y, m-1, d)` read back with the
 * UTC getters, which sidesteps the local-timezone-shifts-the-date trap
 * without ever constructing a local Date from a bare yyyy-mm-dd string.
 */
export function etaText(finish) {
  if (!finish || !finish.date) return '';
  const [y, m, d] = String(finish.date).split('-').map(Number);
  if (!y || !m || !d) return '';
  const dow = ETA_DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const mins = Number(finish.minutes) || 0;
  const h24 = Math.floor(mins / 60);
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(mins % 60).padStart(2, '0');
  return `${dow} ${ETA_MON[m - 1]} ${d} ${h}:${mm} ${h24 >= 12 ? 'PM' : 'AM'}`;
}

/** HTML-escape & < > " ' — every string this page interpolates into markup goes through this. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
