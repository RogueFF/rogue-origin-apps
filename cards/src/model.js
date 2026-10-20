// Card models: API JSON → the plain object a card layout draws. Pure functions.
// This file starts with the helpers every card shares; the weekly, end-of-day
// and midday model builders are added below them.
//
// Missing values: parsers and helpers (here and in periods.js) return null for
// a value that is not there; only the display formatters (fmtInt, fmtMoney,
// fmt1, fmt2, cultivarShort) turn a missing value into "—".

import {
  weekRange, weekDates, lastCompleteWeek, rangeLabel, weekdayName, shortWeekday, monthDay, pacificDate, pacificClock,
  slotLabel, slotSpan, slotClock, slotMinutes, slotEnd,
} from './periods.js';
import { classifyNote, themes, translate, THEME_ORDER } from './notes.js';

const MINUS = '−';
const DASH = '—';

/**
 * True when cost figures are missing. The API strips every cost key for callers
 * without the password, so a day (or every day of a dashboard) without
 * `topsCostPerLb` means locked. The dashboard's own top-level `costsLocked`
 * flag is not trusted: the day keys are what the card can actually draw.
 */
export function costsLocked(dayOrDashboard) {
  if (!dayOrDashboard || typeof dayOrDashboard !== 'object') return true;
  if (Array.isArray(dayOrDashboard.daily)) {
    return dayOrDashboard.daily.length === 0 || dayOrDashboard.daily.every((day) => costsLocked(day));
  }
  return dayOrDashboard.topsCostPerLb === undefined;
}

/**
 * Change chip versus a prior period: `{ kind: 'good' | 'bad' | 'neutral', text }`,
 * e.g. "▲ +0.14 vs W41". `fmt` (required unless `pct`) formats the size of the
 * change; with `pct: true` the change is shown as a whole percent of the prior
 * value instead. A change that rounds to nothing on screen is neutral
 * ("= vs W41"). null when either value is missing, or when a percent change
 * has a zero base.
 */
export function deltaChip(value, prior, { fmt, upIsGood = true, vs, pct = false } = {}) {
  if (!pct && typeof fmt !== 'function') throw new Error('deltaChip needs a fmt function to format the change, or pct: true');
  if (!Number.isFinite(value) || !Number.isFinite(prior)) return null;
  let change;
  let magnitude;
  if (pct) {
    if (prior === 0) return null;
    change = Math.round(((value - prior) / Math.abs(prior)) * 100);
    magnitude = `${Math.abs(change)}%`;
  } else {
    change = value - prior;
    magnitude = fmt(Math.abs(change));
    if (magnitude === fmt(0)) change = 0;
  }
  const suffix = vs ? ` vs ${vs}` : '';
  if (change === 0) return { kind: 'neutral', text: `=${suffix}` };
  const up = change > 0;
  return {
    kind: up === Boolean(upIsGood) ? 'good' : 'bad',
    text: `${up ? '▲' : '▼'} ${up ? '+' : MINUS}${magnitude}${suffix}`,
  };
}

/** Band of a percent of target: 'good' at 100 or more, 'warn' from 90, else 'bad'; null when missing. */
export function pctKind(pct) {
  if (!Number.isFinite(pct)) return null;
  return pct >= 100 ? 'good' : pct >= 90 ? 'warn' : 'bad';
}

/** Percent-of-target chip, banded by pctKind on the rounded percent. null without a positive target. */
export function pctChip(value, target) {
  if (!Number.isFinite(value) || !Number.isFinite(target) || target <= 0) return null;
  const pct = Math.round((value / target) * 100);
  return { kind: pctKind(pct), text: `${pct}% target` };
}

/**
 * Crew-adjusted target for one `scoreboard.hourlyRates` row, the scoreboard's
 * own method (workers/src/handlers/production/scoreboard.js): effective
 * trimmers × that row's strain target rate × the slot multiplier. The rate is
 * per row because the strain can change mid-day (a blank strain grades at 0.85).
 */
export function hourTarget(row) {
  return crewHours(row) * (row?.target ?? 0);
}

/** Trimmer-hours one hourly row stands for: effective trimmers × the slot multiplier. */
function crewHours(row) {
  return (row?.effectiveTrimmers ?? row?.trimmers ?? 0) * (row?.multiplier ?? 1);
}

const intFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/**
 * Every number formatter has the same shape: "—" for a missing value, the
 * magnitude formatted by `body`, and a U+2212 minus in front only when the
 * text shown is not zero (so -0.004 prints "0.00", never "-0.00").
 */
const signed = (body) => (v) => {
  if (!Number.isFinite(v)) return DASH;
  const text = body(Math.abs(v));
  return v < 0 && /[1-9]/.test(text) ? MINUS + text : text;
};

/** 20530.26 → "20,530"; -20530.26 → "−20,530". */
export const fmtInt = signed((v) => intFormat.format(Math.round(v)));
/** 20530.26 → "$20,530"; -5 → "−$5". */
export const fmtMoney = signed((v) => `$${intFormat.format(Math.round(v))}`);
/** 5.58 → "5.6". */
export const fmt1 = signed((v) => v.toFixed(1));
/** 1.3399 → "1.34". */
export const fmt2 = signed((v) => v.toFixed(2));

/** "2026 - Sour Lifter / Sungrown" → "Sour Lifter '26". Empty → "—". */
export function cultivarShort(name) {
  const s = String(name ?? '').trim();
  const year = /^(\d{4})\s*-\s*/.exec(s);
  const rest = (year ? s.slice(year[0].length) : s).replace(/\s*\/[^/]*$/, '').trim();
  if (!rest) return DASH;
  return year ? `${rest} '${year[1].slice(2)}` : rest;
}

// ---------------------------------------------------------------------------
// Card builders. Each returns the shape a card layout draws:
//   { kind, costsLocked, eyebrow, title, sub, pill,
//     tiles: [{ label, value, unit, chips: [{ kind, text }] }] × 3,
//     chart: { title, legend, sub, cols: [{ label, rate, lbs, target, kind: 'bar' | 'off' | 'now' }] },
//     minis: [{ label, value, unit, sub }] × 3,
//     flags: [{ kind: 'bad' | 'warn' | 'good', tag: 'Act' | 'Watch' | 'Good', text }] (0–3, in that order),
//     foot: { left, right } }
// Locked costs turn every money value into 🔒 with no chips and a "locked" sub;
// nothing else on the card changes.

const LOCK = '🔒';
const LEGEND = 'target, crew-adjusted';
const FLAG_TAGS = { bad: 'Act', warn: 'Watch', good: 'Good' };
const SHIFT_HOURS = '8.5';
/** The line has dropped when its last hour is under this share of its peak trimmers. */
const CREW_DROP_RATIO = 0.7;
/** Buckers per trimmer: the band the card names, and the range it reads as fed (short below, idle above). */
const BUCKER_BAND = { lo: 0.65, hi: 0.85, label: '0.70–0.75' };
/** From 10:00 an empty supersack tracker is worth a Watch line. */
const SACKS_DUE_MINUTES = 600;
/** Noon: an hour under target that starts then or later leaves the morning whole. */
const MORNING_CUTOFF_MINUTES = 720;
/** A slot shorter than an hour (a half slot) is never the best hour. */
const FULL_HOUR_MINUTES = 60;
const CREW_CHANGE = /\[Crew change[^\]]*\]/gi;

/** Every card prints the instant it was generated, so a missing or invalid `generatedAt` is a caller bug. */
function checkGeneratedAt(generatedAt) {
  if (!(generatedAt instanceof Date) || Number.isNaN(generatedAt.getTime())) {
    throw new Error('card model needs generatedAt: the Date the card is generated, printed in its footer');
  }
}

/** Σ fn(item) over the items where it is a number, float dust trimmed so 86.4999… cannot round down. */
function sum(items, fn) {
  const total = items.reduce((t, item) => {
    const v = fn(item);
    return Number.isFinite(v) ? t + v : t;
  }, 0);
  return Math.round(total * 1e9) / 1e9;
}

const ratio = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : null);

/** Σ(value × weight) ÷ Σ weight over the items that carry the value; null when there is no weight. */
function weighted(items, valueOf, weightOf) {
  const carrying = items.filter((item) => Number.isFinite(valueOf(item)));
  return ratio(sum(carrying, (item) => valueOf(item) * weightOf(item)), sum(carrying, weightOf));
}

/** A 2-decimal figure at display precision, so a change chip is the difference of the numbers as shown. */
const shown2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
/** 27.514 → "$27.51". */
const perLb = (v) => (Number.isFinite(v) ? `$${fmt2(v)}` : DASH);

const dayRate = (day) => ratio(day.totalTops, day.trimmerHours);

/**
 * What a set of dashboard days adds up to. Every average is weighted, never a
 * mean of daily means: rate = Σ tops ÷ Σ trimmer hours over the days that
 * logged trimmer hours (both sums over the same days), $/lb tops =
 * Σ(topsCostPerLb × tops) ÷ Σ tops (smalls likewise), all-in = Σ labor ÷ Σ tops.
 */
function periodFigures(days) {
  const costed = days.filter((day) => !costsLocked(day));
  const rated = days.filter((day) => day.trimmerHours > 0);
  const labor = costed.length ? sum(costed, (d) => d.laborCost) : null;
  return {
    tops: sum(days, (d) => d.totalTops),
    smalls: sum(days, (d) => d.totalSmalls),
    rate: ratio(sum(rated, (d) => d.totalTops), sum(rated, (d) => d.trimmerHours)),
    topsCost: weighted(days, (d) => d.topsCostPerLb, (d) => d.totalTops),
    smallsCost: weighted(days, (d) => d.smallsCostPerLb, (d) => d.totalSmalls),
    labor,
    allIn: labor === null ? null : ratio(labor, sum(costed, (d) => d.totalTops)),
  };
}

/** The dashboard days on `dates` that logged tops, oldest first. None for the API's fallback shape. */
function workedDays(dashboard, dates) {
  if (dashboard?.fallback?.active) return [];
  const wanted = new Set(dates);
  return (dashboard?.daily ?? [])
    .filter((day) => wanted.has(day.date) && day.totalTops > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The main cultivar (most tops) as a short name, + N for the others that logged tops. */
function cultivarName(days) {
  const tops = new Map();
  for (const day of days) {
    const list = day.cultivars?.length ? day.cultivars : [{ cultivar: day.cultivar, tops: day.totalTops }];
    for (const { cultivar, tops: lbs } of list) {
      if (cultivar) tops.set(cultivar, (tops.get(cultivar) ?? 0) + (Number.isFinite(lbs) ? lbs : 0));
    }
  }
  const [main, ...others] = [...tops].sort((a, b) => b[1] - a[1]);
  const extra = others.filter(([, lbs]) => lbs > 0).length;
  return `${cultivarShort(main?.[0])}${extra ? ` +${extra}` : ''}`;
}

const tile = (label, value, unit, chips = []) => ({ label, value, unit, chips: chips.filter(Boolean) });
const mini = (label, value, unit, sub) => ({ label, value, unit, sub });

/** The Rate tile (lb per trimmer hour) with its one chip. */
const rateTile = (rate, chip) => tile('Rate', fmt2(rate), 'lb/hr', [chip]);

/** "$ per lb tops" with its change vs the prior period; 🔒 and no chip when costs are locked. */
function costTile(figures, prior, vs, locked) {
  if (locked) return tile('$ per lb tops', LOCK, '');
  return tile('$ per lb tops', perLb(figures.topsCost), '', [
    deltaChip(shown2(figures.topsCost), shown2(prior?.topsCost), { fmt: perLb, upIsGood: false, vs }),
  ]);
}

/** Supersacks opened, with the tracker's own raw pounds and tops (not the dashboard's). */
function sackMini(summary) {
  const periods = summary?.periods ?? [];
  if (!periods.length) return mini('Supersacks', DASH, '', 'tracker empty');
  const sacks = sum(periods, (p) => p.total_sacks);
  const topsPerSack = ratio(sum(periods, (p) => p.total_tops), sacks);
  return mini('Supersacks', fmtInt(sacks), 'opened', `${fmtInt(sum(periods, (p) => p.total_raw))} lb raw · ${fmt1(topsPerSack)} tops/sack`);
}

/** The mini row of a closed period (weekly, end of day): smalls + $/lb, supersacks, labor + all-in. */
function closeMinis(figures, sacks, locked) {
  return [
    mini('Smalls', fmtInt(figures.smalls), 'lb', locked ? 'locked' : `${perLb(figures.smallsCost)}/lb`),
    sackMini(sacks),
    locked ? mini('Labor', LOCK, '', 'locked') : mini('Labor', fmtMoney(figures.labor), '', `all-in ${perLb(figures.allIn)}/lb`),
  ];
}

/** A note without its crew-change markers, whitespace squashed, stray commas trimmed; '' when nothing is left. */
const noteText = (text) => String(text ?? '').replace(CREW_CHANGE, ' ').replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '');

/** The scoreboard's hourly rows sorted by slot start; an unreadable slot sorts last. */
function hourRows(scoreboard) {
  const start = (row) => slotMinutes(row.timeSlot)?.start ?? Number.MAX_SAFE_INTEGER;
  return [...(scoreboard?.hourlyRates ?? [])].sort((a, b) => start(a) - start(b));
}

/**
 * A day's floor notes for the weekly card, in hour order: one per hourly row of
 * the day's scoreboard. A day without a scoreboard falls back to the
 * dashboard's notes blob, which the API joins with bare commas (GROUP_CONCAT):
 * crew-change markers (which carry commas of their own) come out first, then
 * the rest splits on commas.
 */
function dayNotes(day, scoreboards) {
  const sb = scoreboards?.[day.date]?.scoreboard;
  const texts = sb ? hourRows(sb).map((row) => row.notes) : String(day.notes ?? '').replace(CREW_CHANGE, ' ').split(',');
  return texts.map(noteText).filter(Boolean);
}

/** A flag is one line on the card: at most this many characters (24 px Outfit across the flag row). */
const FLAG_TEXT_MAX = 72;
/** How far back from the cut a clause break (", " ": " "; ") is preferred over the last space. */
const CLAUSE_REACH = 24;

/**
 * Text cut to `max` characters with a trailing "…": at the last clause break in
 * the final CLAUSE_REACH characters of the window, else at the last space, else
 * hard. Trailing punctuation before the "…" is dropped. Shorter text is unchanged.
 */
export function capText(text, max = FLAG_TEXT_MAX) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  // The kept text is s.slice(0, cut) plus "…", so cut ≤ max - 1; s[max - 1] may be the space cut at.
  const room = s.slice(0, max);
  const clause = Math.max(...[', ', ': ', '; '].map((sep) => room.lastIndexOf(sep, max - 2)));
  const space = room.lastIndexOf(' ', max - 1);
  const cut = clause >= max - 1 - CLAUSE_REACH ? clause : space > 0 ? space : max - 1;
  return `${s.slice(0, cut).replace(/[\s,;:.·–—-]+$/u, '')}…`;
}

// Flag text can carry a translated floor note, so every flag is capped to one line.
const flag = (kind, text) => ({ kind, tag: FLAG_TAGS[kind], text: capText(text) });

/** At most three flags: Act first, then Watch, then Good. */
const pickFlags = (flags) => ['bad', 'warn', 'good'].flatMap((kind) => flags.filter((f) => f?.kind === kind)).slice(0, 3);

/** ['mold', 'worms', 'moisture'] → "Mold, worms and moisture". */
function themeList(names) {
  const text = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const span = (first, last) => (first === last ? first : `${first}–${last}`);

function foot(left, generatedAt) {
  const ymd = pacificDate(generatedAt);
  return { left, right: `generated ${shortWeekday(ymd)} ${monthDay(ymd)} · ${pacificClock(generatedAt)} PT` };
}

function crewRange(crews) {
  if (!crews.length) return `Line crew ${DASH}`;
  const lo = Math.min(...crews);
  const hi = Math.max(...crews);
  const avg = Math.round(crews.reduce((t, c) => t + c, 0) / crews.length);
  return `Line crew ${span(lo, hi)} · avg ${avg}`;
}

/**
 * Weekly flags: the latest Act note (with its weekday), one Watch line naming
 * the warn themes and the days they span, and a Good line: "Rate rose all
 * week" when every worked day's rate is at or above the day before (and the
 * week ends higher than it started), else the day with the most tops.
 */
function weeklyFlags(worked, scoreboards) {
  const notes = worked.flatMap((day) => dayNotes(day, scoreboards).map((text) => ({ day, text, flag: classifyNote(text) })));
  const bad = notes.filter((n) => n.flag?.kind === 'bad').at(-1);
  const warns = notes.filter((n) => n.flag?.kind === 'warn');
  const found = new Set(warns.flatMap((n) => themes(n.text)));
  const rates = worked.map(dayRate);
  const rose = worked.length > 1
    && rates.every((r, i) => Number.isFinite(r) && (i === 0 || r >= rates[i - 1]))
    && rates.at(-1) > rates[0];
  const best = worked.reduce((a, b) => (b.totalTops > a.totalTops ? b : a));
  const day = (note) => shortWeekday(note.day.date);
  return [
    bad ? flag('bad', `${day(bad)}: ${bad.flag.text}`) : null,
    warns.length
      ? flag('warn', `${themeList(THEME_ORDER.filter((t) => found.has(t)))} flagged ${span(day(warns[0]), day(warns.at(-1)))}`)
      : null,
    flag('good', rose
      ? 'Rate rose all week'
      : `Best day ${shortWeekday(best.date)}, ${fmtInt(best.totalTops)} lb at ${fmt2(dayRate(best))}`),
  ];
}

/**
 * Weekly card for ISO week `week` ("2026-W42"). `dashboard` and `prior` are
 * the dashboard JSON for this week and the week before, `scoreboards` the
 * scoreboard JSON of each worked day keyed by date (their todayTarget is the
 * day's target, their hourly rows carry the floor notes), `sacks` the week's
 * supersack summary. null when no day of the week logged tops.
 */
export function weeklyModel({ week, dashboard, prior, scoreboards, sacks, generatedAt }) {
  checkGeneratedAt(generatedAt);
  const { start, end, week: number } = weekRange(week);
  const dates = weekDates(week);
  const worked = workedDays(dashboard, dates);
  if (!worked.length) return null;
  const priorWeek = lastCompleteWeek(start);
  const priorDays = workedDays(prior, weekDates(priorWeek));
  const vs = `W${weekRange(priorWeek).week}`;
  const now = periodFigures(worked);
  const before = priorDays.length ? periodFigures(priorDays) : null;
  const locked = costsLocked({ daily: worked });
  const target = (ymd) => scoreboards?.[ymd]?.scoreboard?.todayTarget;
  const targeted = worked.filter((day) => Number.isFinite(target(day.date)));
  return {
    kind: 'weekly',
    costsLocked: locked,
    eyebrow: 'Rogue Origin · Weekly production',
    title: `Week ${number}`,
    sub: `${rangeLabel(start, end)} · ${cultivarName(worked)} · ${worked.length} ${worked.length === 1 ? 'day' : 'days'}`,
    pill: crewRange(worked.map((day) => day.totalCrew).filter(Number.isFinite)),
    tiles: [
      tile('Tops', fmtInt(now.tops), 'lb', [
        deltaChip(now.tops, before?.tops, { pct: true, upIsGood: true, vs }),
        pctChip(sum(targeted, (day) => day.totalTops), sum(targeted, (day) => target(day.date))),
      ]),
      rateTile(now.rate, deltaChip(shown2(now.rate), shown2(before?.rate), { fmt: fmt2, upIsGood: true, vs })),
      costTile(now, before, vs, locked),
    ],
    chart: {
      title: 'Tops by day',
      legend: LEGEND,
      sub: 'lb · rate under the day',
      cols: dates.map((ymd) => {
        const day = worked.find((d) => d.date === ymd);
        const label = shortWeekday(ymd);
        if (!day) return { label, rate: DASH, lbs: 0, target: 0, kind: 'off' };
        return { label, rate: fmt2(dayRate(day)), lbs: day.totalTops, target: target(ymd) ?? 0, kind: 'bar' };
      }),
    },
    minis: closeMinis(now, sacks, locked),
    flags: pickFlags(weeklyFlags(worked, scoreboards)),
    foot: foot('cards/weekly · dashboard allocation · $/lb tops', generatedAt),
  };
}

// --- Hourly cards (end of day, midday) -------------------------------------

/** The dashboard row for `date`; null for a missing day or the API's fallback shape. */
function dayRow(dashboard, date) {
  if (dashboard?.fallback?.active) return null;
  return (dashboard?.daily ?? []).find((day) => day.date === date) ?? null;
}

/** The latest day before `date` that logged tops (the prior day a card compares with), or null. */
function lastDayBefore(dashboard, date) {
  if (dashboard?.fallback?.active) return null;
  return (dashboard?.daily ?? [])
    .filter((day) => day.date < date && day.totalTops > 0)
    .reduce((latest, day) => (!latest || day.date > latest.date ? day : latest), null);
}

const hourCol = (row) => ({
  label: slotLabel(row.timeSlot) ?? DASH,
  rate: fmt2(row.rate),
  lbs: row.lbs,
  target: hourTarget(row),
  kind: 'bar',
});

/** "Tops by hour": a bar per logged row, then any extra columns (midday's "now"). */
function hourlyChart(rows, extra = []) {
  return { title: 'Tops by hour', legend: LEGEND, sub: 'lb · rate under the hour', cols: [...rows.map(hourCol), ...extra] };
}

const underTarget = (row) => row.lbs < hourTarget(row);

/** Minutes a slot spans; 0 when it has no readable end. */
function slotLength(row) {
  const slot = slotMinutes(row.timeSlot);
  return slot && slot.end !== null ? slot.end - slot.start : 0;
}

/** "▲ 113% of target" from the scoreboard's own percent, banded like pctChip. */
function targetChip(percent) {
  if (!Number.isFinite(percent)) return null;
  const pct = Math.round(percent);
  return { kind: pctKind(pct), text: `${pct >= 100 ? '▲' : '▼'} ${pct}% of target` };
}

/**
 * The latest Act note and the latest Watch note of the hourly rows (one note
 * per row), each led by its hour ("2 PM: …"), as [act, watch]. A Watch note
 * outranks the crew-drop line: the two share one Watch slot on the hourly cards.
 */
function noteFlags(rows) {
  const notes = rows.map((row) => ({ row, flag: classifyNote(noteText(row.notes)) }));
  return ['bad', 'warn'].map((kind) => {
    const note = notes.filter((n) => n.flag?.kind === kind).at(-1);
    return note ? flag(kind, `${slotClock(note.row.timeSlot) ?? DASH}: ${note.flag.text}`) : null;
  });
}

/**
 * Watch line for a line that ended under CREW_DROP_RATIO of its peak trimmers:
 * "Crew fell 8 → 3 trimmers after 12:30 PM: <reason>, 3 hours under target".
 * The drop row is the first of that final stretch under the ratio; the reason
 * is that row's own note, translated (unless it is a flag of its own); the
 * hours under target are counted from the drop row on. null while the last
 * row still holds the ratio.
 */
function crewDropFlag(rows) {
  const trimmers = rows.map((row) => row.trimmers ?? 0);
  const peak = Math.max(...trimmers);
  const floor = CREW_DROP_RATIO * peak;
  const last = trimmers.at(-1);
  if (!(last < floor)) return null;
  let from = rows.length - 1;
  while (from > 0 && trimmers[from - 1] < floor) from -= 1;
  const note = noteText(rows[from].notes);
  const reason = /\p{L}/u.test(note) && !classifyNote(note) ? `: ${translate(note)}` : '';
  const under = rows.slice(from).filter(underTarget).length;
  const hours = under ? `, ${under} ${under === 1 ? 'hour' : 'hours'} under target` : '';
  return flag('warn', `Crew fell ${peak} → ${last} trimmers after ${slotClock(rows[from].timeSlot) ?? DASH}${reason}${hours}`);
}

/** An hour worked by fewer than this share of the day's peak trimmers is never the best hour. */
const BEST_HOUR_CREW_SHARE = 0.5;

const peakTrimmers = (rows) => Math.max(0, ...rows.map((row) => row.trimmers ?? 0));

/**
 * The fastest full-hour row among `rows` worked by at least half of `peak`
 * trimmers (the day's peak: one trimmer at 2.77 is not the line's best hour);
 * null when none qualifies (a half slot is not an hour).
 */
function bestHour(rows, peak = peakTrimmers(rows)) {
  return rows
    .filter((row) => Number.isFinite(row.rate) && slotLength(row) >= FULL_HOUR_MINUTES)
    .filter((row) => (row.trimmers ?? 0) >= BEST_HOUR_CREW_SHARE * peak)
    .reduce((best, row) => (!best || row.rate > best.rate ? row : best), null);
}

/**
 * End-of-day card for `date`. `dashboard` is the dashboard JSON for date..date,
 * `priorDay` the dashboard of the previous weekday, `scoreboard` and `sacks`
 * that day's scoreboard JSON and supersack summary. null when the day has no
 * hourly rows or the dashboard is the API's fallback shape. Flags: Act, one
 * Watch (a warn note, else the crew drop), Good (the best full hour).
 */
export function eodModel({ date, dashboard, priorDay, scoreboard, sacks, generatedAt }) {
  checkGeneratedAt(generatedAt);
  const sb = scoreboard?.scoreboard;
  const rows = hourRows(sb);
  const day = dayRow(dashboard, date);
  if (!rows.length || !day) return null;
  const prior = lastDayBefore(priorDay, date);
  const vs = prior ? shortWeekday(prior.date) : undefined;
  const now = periodFigures([day]);
  const before = prior ? periodFigures([prior]) : null;
  const locked = costsLocked(day);
  const most = (key) => Math.max(...rows.map((row) => row[key] ?? 0));
  const [act, noteWatch] = noteFlags(rows);
  const best = bestHour(rows);
  return {
    kind: 'eod',
    costsLocked: locked,
    eyebrow: 'Rogue Origin · End of day',
    title: weekdayName(date),
    sub: `${monthDay(date)} · ${cultivarName([day])} · ${fmt1(sb.effectiveHours)} h logged`,
    pill: `Line crew peak ${fmtInt(day.totalCrew)} · ${most('trimmers')} T · ${most('buckers')} B`,
    tiles: [
      tile('Tops', fmtInt(now.tops), 'lb', [targetChip(sb.todayPercentage)]),
      rateTile(now.rate, deltaChip(shown2(now.rate), shown2(before?.rate), { fmt: fmt2, upIsGood: true, vs })),
      costTile(now, before, vs, locked),
    ],
    chart: hourlyChart(rows),
    minis: closeMinis(now, sacks, locked),
    flags: pickFlags([
      act,
      noteWatch ?? crewDropFlag(rows),
      best && flag('good', `Best hour ${slotSpan(best.timeSlot) ?? DASH} at ${fmt2(best.rate)}`),
    ]),
    foot: foot('cards/eod · dashboard allocation · $/lb tops', generatedAt),
  };
}

/** "▲ target 1.58": good when the rate so far (as shown) is at or above the target rate. */
function rateTargetChip(rate, target) {
  if (!Number.isFinite(rate) || !Number.isFinite(target)) return null;
  const up = shown2(rate) >= shown2(target);
  return { kind: up ? 'good' : 'bad', text: `${up ? '▲' : '▼'} target ${fmt2(target)}` };
}

/** Buckers per trimmer in the last hour against BUCKER_BAND: fed inside lo–hi, short below, idle above. */
function buckerMini(row) {
  const band = `band ${BUCKER_BAND.label}`;
  const perTrimmer = shown2(ratio(row.buckers, row.trimmers));
  if (perTrimmer === null) return mini('Buckers per trimmer', DASH, '', band);
  const word = perTrimmer < BUCKER_BAND.lo ? 'short' : perTrimmer > BUCKER_BAND.hi ? 'idle' : 'fed';
  return mini('Buckers per trimmer', fmt2(perTrimmer), '', `${band}, ${word}`);
}

/**
 * Good line for the day so far, naming the best full hour before the first
 * hour under target: "Every hour above target so far" when none is under;
 * "Morning above target every hour" when the first under-target hour starts at
 * noon or later; "First N hours above target" when it starts earlier, after at
 * least two hours above target. null otherwise.
 */
function middayGood(rows) {
  const firstUnder = rows.findIndex(underTarget);
  let lead;
  if (firstUnder === -1) lead = 'Every hour above target so far';
  else if (slotMinutes(rows[firstUnder].timeSlot)?.start >= MORNING_CUTOFF_MINUTES) lead = 'Morning above target every hour';
  else if (firstUnder >= 2) lead = `First ${firstUnder} hours above target`;
  else return null;
  const best = bestHour(firstUnder === -1 ? rows : rows.slice(0, firstUnder), peakTrimmers(rows));
  return best ? flag('good', `${lead}, best ${fmt2(best.rate)} at ${slotSpan(best.timeSlot) ?? DASH}`) : null;
}

/**
 * Midday card for `date` (today, so far). `scoreboard` is today's scoreboard
 * JSON, `dashboardToday` today's dashboard (cultivar and T-Zero count),
 * `priorDay` the previous weekday's dashboard, `sacks` today's supersack
 * summary. null while no hour is logged, or when today's dashboard is the
 * API's fallback shape. Flags: Act, two Watch lines (a warn note, else the
 * crew drop; then "no supersacks"), Good.
 */
export function middayModel({ date, scoreboard, dashboardToday, priorDay, sacks, generatedAt }) {
  checkGeneratedAt(generatedAt);
  const sb = scoreboard?.scoreboard;
  const rows = hourRows(sb);
  if (!rows.length || dashboardToday?.fallback?.active) return null;
  const today = dayRow(dashboardToday, date);
  const prior = lastDayBefore(priorDay, date);
  const last = rows.at(-1);
  const lastEnd = slotMinutes(last.timeSlot)?.end;
  const tops = sum(rows, (row) => row.lbs);
  const rate = ratio(tops, sum(rows, crewHours));
  const sackCount = sum(sacks?.periods ?? [], (p) => p.total_sacks);
  const tzero = dashboardToday?.today?.tzero;
  const [act, noteWatch] = noteFlags(rows);
  const currentStart = slotMinutes(sb.currentTimeSlot)?.start;
  const showNow = sb.currentHourTarget > 0 && Number.isFinite(currentStart) && Number.isFinite(lastEnd) && currentStart >= lastEnd;
  const now = showNow ? [{ label: slotLabel(sb.currentTimeSlot) ?? DASH, rate: DASH, lbs: 0, target: sb.currentHourTarget, kind: 'now' }] : [];
  return {
    kind: 'midday',
    costsLocked: costsLocked(today),
    eyebrow: 'Rogue Origin · Midday check',
    title: weekdayName(date),
    sub: `${monthDay(date)} · ${today ? cultivarName([today]) : cultivarShort(sb.strain)} · through ${slotEnd(last.timeSlot) ?? DASH}`,
    pill: `Line crew ${last.trimmers ?? 0} T · ${last.buckers ?? 0} B · ${Number.isFinite(tzero) ? tzero : 1} TZ`,
    tiles: [
      tile('Tops so far', fmtInt(tops), 'lb', [targetChip(sb.todayPercentage)]),
      rateTile(rate, rateTargetChip(rate, sb.targetRate)),
      tile('Projected end of day', fmtInt(sb.projectedTotal), 'lb', [
        prior ? { kind: 'neutral', text: `${shortWeekday(prior.date)} closed at ${fmtInt(prior.totalTops)}` } : null,
      ]),
    ],
    chart: hourlyChart(rows, now),
    minis: [
      mini('Smalls so far', fmtInt(sum(rows, (row) => row.smalls)), 'lb', ''),
      buckerMini(last),
      mini('Hours logged', fmt1(sb.effectiveHours), `of ${SHIFT_HOURS}`, `sacks logged: ${fmtInt(sackCount)}`),
    ],
    flags: pickFlags([
      act,
      noteWatch ?? crewDropFlag(rows),
      sackCount === 0 && lastEnd >= SACKS_DUE_MINUTES ? flag('warn', 'No supersacks logged on the tracker yet today') : null,
      middayGood(rows),
    ]),
    foot: foot('cards/midday · scoreboard target · $/lb at close', generatedAt),
  };
}
