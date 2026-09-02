/**
 * Date ranges for the hub. All dates are YYYY-MM-DD in Pacific time,
 * which is the plant's day and what the worker filters on.
 */
import { PT } from './format.js';

export function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PT, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000) + 1;
}

export const RANGE_KEYS = ['today', 'yesterday', '7d', '30d', 'custom'];

/**
 * @returns {{key,start,end,days,label,live,prev:{start,end,label}}}
 */
export function resolveRange(key, custom = null) {
  const today = todayISO();
  const single = (day, label, live) => ({
    key, start: day, end: day, days: 1, label, live,
    // Compare a single day against the last worked day before it: fetch the
    // preceding week and let the caller pick the most recent day with output.
    prev: { start: addDays(day, -7), end: addDays(day, -1), label: 'last worked day', pickLast: true },
  });

  switch (key) {
    case 'yesterday':
      return single(addDays(today, -1), 'Yesterday', false);
    case '7d':
    case '30d': {
      const n = key === '7d' ? 7 : 30;
      const start = addDays(today, -(n - 1));
      return {
        key, start, end: today, days: n, label: `Last ${n} days`, live: false,
        prev: { start: addDays(start, -n), end: addDays(start, -1), label: `previous ${n} days` },
      };
    }
    case 'custom': {
      let { start, end } = custom || {};
      if (!start || !end) return resolveRange('today');
      if (start > end) [start, end] = [end, start];
      if (end > today) end = today;
      const n = daysBetween(start, end);
      if (n === 1) return { ...single(start, start, start === today), key: 'custom' };
      return {
        key, start, end, days: n, label: `${start} → ${end}`, live: false,
        prev: { start: addDays(start, -n), end: addDays(start, -1), label: `previous ${n} days` },
      };
    }
    case 'today':
    default:
      return single(today, 'Today', true);
  }
}
