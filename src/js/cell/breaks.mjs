/**
 * The crew's breaks (Koa 2026-11-10: "We need to build the breaks in. 9:00 - 9:10,
 * 12:00 - 12:30, and 2:30 - 2:40"). Pacific wall clock, every working day; the
 * same schedule as the line (workers/src/lib/work-calendar.js). The 4:20 cleanup
 * is not a break: the cell screen pauses for it on its own (main.js, autoPause).
 *
 * A job running when a break starts stops its clock and starts again when the
 * break ends, so a bag's cycle time never holds a break.
 */
import { LINE_SLOTS } from './line.mjs';
import { EOD_HOLD_FROM } from '../scoreboard-v2/leaders-logic.js';
export const BREAKS = [
  { start: 9 * 60, end: 9 * 60 + 10, kind: 'break' },
  { start: 12 * 60, end: 12 * 60 + 30, kind: 'lunch' },
  { start: 14 * 60 + 30, end: 14 * 60 + 40, kind: 'break' },
];

// When a scale is meant to be off (Koa 2026-11-25: "shows as scale down however its
// 4:26, they start cleaning at 4:20" and "it should show it being down as something
// else when its supposed to be"). From the schedule the app already has: the shift
// starts with Hourly entry's first hour (line.mjs LINE_SLOTS), the breaks and lunch
// are BREAKS above, and cleanup is the scoreboard's EOD_HOLD_FROM (4:20).
export const SHIFT_START_MIN = LINE_SLOTS[0].start;
export const CLEANUP_MIN = EOD_HOLD_FROM;

/**
 * What the schedule says at `minutes` (Pacific): 'working', or why a scale is meant
 * to be off: 'notStarted' (before the shift), 'break', 'lunch', 'dayDone' (from cleanup).
 * A scale that stops posting is red "Scale down" only while 'working'.
 */
export function scheduleState(minutes) {
  if (minutes < SHIFT_START_MIN) return 'notStarted';
  if (minutes >= CLEANUP_MIN) return 'dayDone';
  const b = breakAt(minutes);
  if (b) return b.kind === 'lunch' ? 'lunch' : 'break';
  return 'working';
}
/** Inside working minutes: a scale that stops posting is a problem worth red. */
export const workingTime = (minutes) => scheduleState(minutes) === 'working';

/** The break `minutes` (Pacific minutes since midnight, may be fractional) falls in, or null. */
export function breakAt(minutes) {
  return BREAKS.find(b => minutes >= b.start && minutes < b.end) || null;
}

/** "9:00", "12:30", "2:40": the way the crew say it. */
export function clockOf(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`;
}

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
/** Pacific minutes since midnight at `ms`, with seconds as a fraction. */
export function pacificMinutes(ms) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute) + (Number(p.second) + (((ms % 1000) + 1000) % 1000) / 1000) / 60;
}

/**
 * Break time, in ms, inside [fromMs, toMs]. For a tablet that slept through a
 * break, or a page reopened after one: the clock leaves that time out too.
 */
export function breakMsBetween(fromMs, toMs) {
  let total = 0;
  let at = fromMs;
  // A few steps a day: one per break edge, one to midnight. Bounded anyway.
  for (let i = 0; at < toMs && i < 200; i++) {
    const m = pacificMinutes(at);
    const b = breakAt(m);
    if (b) {
      const until = Math.min(toMs, at + (b.end - m) * 60000);
      total += until - at;
      at = until;
      continue;
    }
    const next = BREAKS.find(x => x.start > m);
    const step = next ? (next.start - m) * 60000 : (24 * 60 - m) * 60000;
    at = Math.min(toMs, at + Math.max(step, 1000));
  }
  return Math.round(total);
}
