/**
 * The crew's breaks (Koa 2026-11-10: "We need to build the breaks in. 9:00 - 9:10,
 * 12:00 - 12:30, and 2:30 - 2:40"). Pacific wall clock, every working day; the
 * same schedule as the line (workers/src/lib/work-calendar.js). The 4:20 cleanup
 * is not a break: the cell screen pauses for it on its own (main.js, autoPause).
 *
 * A job running when a break starts stops its clock and starts again when the
 * break ends, so a bag's cycle time never holds a break.
 */
export const BREAKS = [
  { start: 9 * 60, end: 9 * 60 + 10, kind: 'break' },
  { start: 12 * 60, end: 12 * 60 + 30, kind: 'lunch' },
  { start: 14 * 60 + 30, end: 14 * 60 + 40, kind: 'break' },
];

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
