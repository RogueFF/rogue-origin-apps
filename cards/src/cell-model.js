// "Cell 1 · Phase 1" card: one cell's day from the API's cellDay read, against
// Phase 1's exit test (Koa 2026-11-11, "fully automatic": no paper, no photo).
// Wiki cell-conversion.md, "Phase 1 run plan": 5 shift days from Thu 11/12 with
// no NOT RECORDING gaps, and verified tops/sack above break-even.
import { fmt1, fmt2, cultivarShort } from './model.js';
import { pacificDate, pacificClock, monthDay, shortWeekday, weekdayName, addDaysYmd, slotLabel } from './periods.js';

const DASH = '—';
/** 12-hour Pacific clock, as the floor reads it: "11:00 AM". */
const clock12 = (ms) => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });

/** Phase 1 starts Thu 2026-11-12 and runs 5 shift days (Mon–Fri). */
export const PHASE_START = '2026-11-12';
export const PHASE_DAYS = 5;

/**
 * Break-even as tops per 35 lb sack (wiki cell-conversion.md, "Break-even, as
 * tops per sack", 2026-11-10; physical numbers only, the prices stay out).
 * at: matches the line at the higher tops price; both: at the lower price too.
 * Other cultivars use Sour Lifter's until they are measured.
 */
export const BREAK_EVEN = {
  'Sour Lifter': { at: 6.4, both: 6.8 },
  Lifter: { at: 8.8, both: 9.1 },
};

export function breakEvenFor(cultivar) {
  const name = String(cultivar || '');
  if (/sour lifter/i.test(name)) return { key: 'Sour Lifter', ...BREAK_EVEN['Sour Lifter'], measured: true };
  if (/lifter/i.test(name)) return { key: 'Lifter', ...BREAK_EVEN.Lifter, measured: true };
  return { key: 'Sour Lifter', ...BREAK_EVEN['Sour Lifter'], measured: false };
}

/** Weekday dates (Mon–Fri) from `start`, `n` of them. */
export function shiftDays(start, n) {
  const out = [];
  for (let d = start; out.length < n; d = addDaysYmd(d, 1)) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d);
  }
  return out;
}

/** The strip's 5 days: Phase 1's while `date` is in it, else the 5 shift days ending at `date`. */
export function stripDates(date) {
  const phase = shiftDays(PHASE_START, PHASE_DAYS);
  if (phase.includes(date)) return phase;
  const out = [];
  for (let d = date; out.length < PHASE_DAYS; d = addDaysYmd(d, -1)) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) out.unshift(d);
  }
  return out;
}

/** The day's cultivar: the sacks the cell used (by lb), else its jobs. */
export function dayCultivar(day) {
  const weight = new Map();
  for (const s of day.sacks?.list || []) if (s.cultivar) weight.set(s.cultivar, (weight.get(s.cultivar) || 0) + s.lbs);
  if (!weight.size) for (const j of day.jobs || []) if (j.cultivar) weight.set(j.cultivar, (weight.get(j.cultivar) || 0) + 1);
  return [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const gapsOf = (day) => ({
  offline: day.gaps?.offline?.count ?? 0,
  notRec: day.gaps?.notRecording?.count ?? 0,
  minutes: (day.gaps?.offline?.minutes ?? 0) + (day.gaps?.notRecording?.minutes ?? 0),
});

/**
 * The day against the exit test.
 * yield: 'both' (at or over the lower-price break-even), 'at' (between: the
 * higher price only), 'under', or 'none' (no EOD weigh, so no verified figure).
 * pass: no recording gaps and yield 'both' or 'at'.
 */
export function verdict(day) {
  const be = breakEvenFor(dayCultivar(day));
  const tps = day.yield?.topsPerSack ?? null;
  const y = tps === null ? 'none' : tps >= be.both ? 'both' : tps >= be.at ? 'at' : 'under';
  const g = gapsOf(day);
  const clean = g.offline === 0 && g.notRec === 0;
  return { be, tps, yield: y, clean, gaps: g, pass: clean && (y === 'both' || y === 'at') };
}

const mmss = (s) => (s === null || s === undefined ? DASH : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const lb2 = (v) => (v === null || v === undefined ? DASH : fmt2(v));

function yieldChip(v) {
  const be = `${fmt1(v.be.at)}–${fmt1(v.be.both)}`;
  if (v.yield === 'none') return { kind: 'warn', text: 'no EOD weigh' };
  if (v.yield === 'both') return { kind: 'good', text: `▲ ${be}` };
  if (v.yield === 'at') return { kind: 'warn', text: `▲ ${fmt1(v.be.at)}, ▼ ${fmt1(v.be.both)}` };
  return { kind: 'bad', text: `▼ ${be}` };
}

function stripItem(date, day) {
  const label = `${shortWeekday(date)} ${monthDay(date).replace(/^\w+ /, '')}`;
  if (!day) return { label, value: DASH, sub: 'to come', kind: 'neutral' };
  const v = verdict(day);
  return {
    label,
    value: v.tps === null ? DASH : fmt1(v.tps),
    sub: `${v.gaps.minutes} gap min`,
    kind: v.pass ? (v.yield === 'both' ? 'good' : 'warn') : v.yield === 'none' && v.clean ? 'warn' : 'bad',
  };
}

/** Phase so far: verified tops/sack over the days with a weigh (sum of tops over sum of raw used). */
export function phaseSoFar(days) {
  const weighed = days.filter((d) => d && d.yield?.usedLb > 0);
  const tops = weighed.reduce((a, d) => a + d.tops.lb, 0);
  const used = weighed.reduce((a, d) => a + d.yield.usedLb, 0);
  const sackLbs = weighed[0]?.yield?.sackLbs ?? 35;
  return { days: weighed.length, topsPerSack: used > 0 ? Math.round((tops * sackLbs / used) * 100) / 100 : null };
}

/**
 * The card for `date`. `day` is cellDay's JSON for it; `strip` is [{date, day}]
 * for the 5 strip days (day null when not run yet). null (no card) when the cell
 * recorded nothing that day.
 */
export function cellModel({ date, day, strip = [], generatedAt }) {
  if (!day || (!(day.tops?.lb > 0) && !(day.jobs || []).length)) return null;
  const v = verdict(day);
  const cultivar = dayCultivar(day);
  const phase = shiftDays(PHASE_START, PHASE_DAYS);
  const dayNo = phase.indexOf(date) + 1;
  const final = (day.tops.hourly || []).every((h) => h.final);
  const pill = v.yield === 'none' ? 'NOT YET: weigh the leftovers'
    : v.pass ? (v.yield === 'both' ? 'EXIT TEST: PASS' : 'PASS at the higher price') : 'EXIT TEST: MISS';
  const ch = day.changeovers || {};
  const so = phaseSoFar(strip.map((s) => s.day));
  const flags = [];
  // Every gap on one line (two at most when it wraps), oldest first.
  const eps = [...(day.gaps?.offline?.episodes || []), ...(day.gaps?.notRecording?.episodes || [])].sort((a, b) => a.fromMs - b.fromMs);
  if (eps.length) {
    flags.push({ kind: 'bad', tag: 'Gap', text: eps.map((e) => `${e.kind === 'offline' ? 'Scale offline' : 'NOT RECORDING'} ${clock12(e.fromMs)}, ${e.minutes} min${e.toMs === null ? ' (open)' : ''}`).join(' · ') });
  }
  if (day.quality?.stop) flags.push({ kind: 'bad', tag: 'Stop', text: `${day.quality.stop} batch(es) scored 1 on mold or insects` });
  if (!v.be.measured) flags.push({ kind: 'warn', tag: 'Note', text: `${cultivar ? cultivarShort(cultivar) : 'This cultivar'} has no break-even yet: Sour Lifter's is used` });
  if (v.pass && !flags.some((f) => f.kind === 'bad')) flags.unshift({ kind: 'good', tag: 'Good', text: 'No recording gaps, and verified tops/sack above break-even' });

  return {
    kind: 'cell',
    costsLocked: true,
    eyebrow: `${day.label} · Phase 1${dayNo ? ` · Day ${dayNo} of ${PHASE_DAYS}` : ''}`,
    title: weekdayName(date),
    sub: `${monthDay(date)} · ${cultivarShort(cultivar) || DASH} · ${fmt1(day.tops.workedH)} h${final ? '' : ' so far'}`,
    pill,
    tiles: [
      { label: 'Tops', value: lb2(day.tops.lb), unit: 'lb', chips: [
        { kind: 'neutral', text: `${lb2(day.tops.perHour)}/hr` },
        { kind: 'neutral', text: `${(day.jobs || []).length} jobs` },
      ] },
      { label: 'Verified tops / sack', value: v.tps === null ? DASH : fmt2(v.tps), unit: '', chips: [
        yieldChip(v),
        day.yield?.toteLb != null ? { kind: 'neutral', text: `tote ${fmt1(day.yield.toteLb)}` } : null,
      ].filter(Boolean) },
      { label: 'Recording gaps', value: String(v.gaps.minutes), unit: 'min', chips: [
        { kind: v.gaps.offline ? 'bad' : 'good', text: `off ${v.gaps.offline}` },
        { kind: v.gaps.notRec ? 'bad' : 'good', text: `n/r ${v.gaps.notRec}` },
      ] },
    ],
    chart: {
      title: 'Tops by hour',
      legend: '',
      sub: `${fmt1(day.tops.workedH)} h worked`,
      cols: (day.tops.hourly || []).map((h) => ({
        kind: 'done', label: slotLabel(h.slot), rate: h.source === 'typed' ? 'typed' : '', lbs: h.lb, cap: fmt2(h.lb), target: 0,
      })),
    },
    minis: [
      { label: 'Changeover', value: mmss(ch.medianS), unit: 'median', sub: ch.count ? `max ${mmss(ch.maxS)} · ${ch.count}` : 'none timed' },
      { label: 'Quality redos', value: String(day.quality?.redo ?? 0), unit: '', sub: `${day.quality?.batches ?? 0} batches` },
      { label: 'Raw used', value: lb2(day.yield?.usedLb), unit: 'lb', sub: `${day.yield?.eodRawLb == null ? DASH : fmt1(day.yield.eodRawLb)} lb left` },
      { label: 'Battery', value: day.battery ? String(day.battery.pct) : DASH, unit: day.battery ? '%' : '', sub: day.battery?.from === 'eod' ? 'at EOD weigh' : 'latest' },
    ],
    // The 5 days, then the phase so far (tops over raw used, every weighed day).
    strip: strip.length ? [...strip.map((s) => stripItem(s.date, s.day)), {
      label: 'So far',
      value: so.topsPerSack === null ? DASH : fmt1(so.topsPerSack),
      sub: `${so.days} day${so.days === 1 ? '' : 's'}`,
      kind: so.topsPerSack === null ? 'neutral' : so.topsPerSack >= v.be.both ? 'good' : so.topsPerSack >= v.be.at ? 'warn' : 'bad',
    }] : [],
    // One line: the strip takes the room a second would need. Gaps first.
    flags: flags.slice(0, 1),
    foot: {
      left: 'cards/cell · cellDay · tops/sack per 35 lb',
      right: `generated ${shortWeekday(pacificDate(generatedAt))} ${monthDay(pacificDate(generatedAt))} · ${pacificClock(generatedAt)} PT`,
    },
  };
}
