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
import { classifyNote, themes, translate } from './notes.js';

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
const THEME_ORDER = ['mold', 'worms', 'moisture', 'leaf'];

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
 * mean of daily means: rate = Σ tops ÷ Σ trimmer hours, $/lb tops =
 * Σ(topsCostPerLb × tops) ÷ Σ tops (smalls likewise), all-in = Σ labor ÷ Σ tops.
 */
function periodFigures(days) {
  const costed = days.filter((day) => !costsLocked(day));
  const tops = sum(days, (d) => d.totalTops);
  const labor = costed.length ? sum(costed, (d) => d.laborCost) : null;
  return {
    tops,
    smalls: sum(days, (d) => d.totalSmalls),
    rate: ratio(tops, sum(days, (d) => d.trimmerHours)),
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

/** A notes blob → its single notes; the API joins them with newlines and crew-change markers. */
const notePieces = (text) => String(text ?? '').split(/\n|\[Crew change[^\]]*\]/i).filter((piece) => piece.trim());

const flag = (kind, text) => ({ kind, tag: FLAG_TAGS[kind], text });

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
function weeklyFlags(worked) {
  const notes = worked.flatMap((day) => notePieces(day.notes).map((text) => ({ day, text, flag: classifyNote(text) })));
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
 * day's target), `sacks` the week's supersack summary. null when no day of the
 * week logged tops.
 */
export function weeklyModel({ week, dashboard, prior, scoreboards, sacks, generatedAt }) {
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
      tile('Rate', fmt2(now.rate), 'lb/hr', [deltaChip(shown2(now.rate), shown2(before?.rate), { fmt: fmt2, upIsGood: true, vs })]),
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
    flags: pickFlags(weeklyFlags(worked)),
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

/** The scoreboard's hourly rows sorted by slot start; an unreadable slot sorts last. */
function hourRows(scoreboard) {
  const start = (row) => slotMinutes(row.timeSlot)?.start ?? Number.MAX_SAFE_INTEGER;
  return [...(scoreboard?.hourlyRates ?? [])].sort((a, b) => start(a) - start(b));
}

const hourCol = (row) => ({
  label: slotLabel(row.timeSlot) ?? DASH,
  rate: fmt2(row.rate),
  lbs: row.lbs,
  target: hourTarget(row),
  kind: 'bar',
});

/** "▲ 113% of target" from the scoreboard's own percent, banded like pctChip. */
function targetChip(percent) {
  if (!Number.isFinite(percent)) return null;
  const pct = Math.round(percent);
  return { kind: pctKind(pct), text: `${pct >= 100 ? '▲' : '▼'} ${pct}% of target` };
}

/** The latest Act note and the latest Watch note of the hourly rows, each led by its hour ("2 PM: …"). */
function noteFlags(rows) {
  const notes = rows.flatMap((row) => notePieces(row.notes).map((text) => ({ row, flag: classifyNote(text) })));
  return ['bad', 'warn'].map((kind) => {
    const note = notes.filter((n) => n.flag?.kind === kind).at(-1);
    return note ? flag(kind, `${slotClock(note.row.timeSlot) ?? DASH}: ${note.flag.text}`) : null;
  });
}

/**
 * The line ending under 70% of its peak trimmers: `{ peak, last, from }`, where
 * `from` is the index of the first row of that final stretch under 70%. null
 * while the last row still holds 70% of the peak.
 */
function crewDrop(rows) {
  const trimmers = rows.map((row) => row.trimmers ?? 0);
  const peak = Math.max(...trimmers);
  const floor = 0.7 * peak;
  if (!(trimmers.at(-1) < floor)) return null;
  let from = trimmers.length - 1;
  while (from > 0 && trimmers[from - 1] < floor) from -= 1;
  return { peak, last: trimmers.at(-1), from };
}

/** The fastest full-hour row (a half slot is not an hour), or the fastest row when none is a full hour. */
function bestHour(rows) {
  const minutes = (row) => {
    const slot = slotMinutes(row.timeSlot);
    return slot && slot.end !== null ? slot.end - slot.start : 0;
  };
  const timed = rows.filter((row) => Number.isFinite(row.rate));
  const hours = timed.filter((row) => minutes(row) >= 60);
  return (hours.length ? hours : timed).reduce((best, row) => (!best || row.rate > best.rate ? row : best), null);
}

/**
 * End-of-day card for `date`. `dashboard` is the dashboard JSON for date..date,
 * `priorDay` the dashboard of the previous weekday, `scoreboard` and `sacks`
 * that day's scoreboard JSON and supersack summary. null when the day has no
 * hourly rows or the dashboard is the API's fallback shape.
 */
export function eodModel({ date, dashboard, priorDay, scoreboard, sacks, generatedAt }) {
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
  const drop = crewDrop(rows);
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
      tile('Rate', fmt2(now.rate), 'lb/hr', [deltaChip(shown2(now.rate), shown2(before?.rate), { fmt: fmt2, upIsGood: true, vs })]),
      costTile(now, before, vs, locked),
    ],
    chart: { title: 'Tops by hour', legend: LEGEND, sub: 'lb · rate under the hour', cols: rows.map(hourCol) },
    minis: closeMinis(now, sacks, locked),
    flags: pickFlags([
      ...noteFlags(rows),
      drop && flag('warn', `Crew fell ${drop.peak} → ${drop.last} trimmers after ${slotClock(rows[drop.from].timeSlot) ?? DASH}`),
      best && flag('good', `Best hour ${slotSpan(best.timeSlot) ?? slotLabel(best.timeSlot) ?? DASH} at ${fmt2(best.rate)}`),
    ]),
    foot: foot('cards/eod · dashboard allocation · $/lb tops', generatedAt),
  };
}

const SHIFT_HOURS = '8.5';
const BUCKER_BAND = 'band 0.70–0.75';

/** "▲ target 1.58": good when the rate so far (as shown) is at or above the target rate. */
function rateTargetChip(rate, target) {
  if (!Number.isFinite(rate) || !Number.isFinite(target)) return null;
  const up = shown2(rate) >= shown2(target);
  return { kind: up ? 'good' : 'bad', text: `${up ? '▲' : '▼'} target ${fmt2(target)}` };
}

/** Buckers per trimmer in the last hour against the 0.70–0.75 band: fed from 0.65 to 0.85, short below, idle above. */
function buckerMini(row) {
  const perTrimmer = shown2(ratio(row.buckers, row.trimmers));
  if (perTrimmer === null) return mini('Buckers per trimmer', DASH, '', BUCKER_BAND);
  const word = perTrimmer < 0.65 ? 'short' : perTrimmer > 0.85 ? 'idle' : 'fed';
  return mini('Buckers per trimmer', fmt2(perTrimmer), '', `${BUCKER_BAND}, ${word}`);
}

/** The first floor note from row `from` on that is not a flag of its own, translated: why the crew moved. */
function crewNote(rows, from) {
  const note = rows.slice(from).flatMap((row) => notePieces(row.notes)).find((piece) => /\p{L}/u.test(piece) && !classifyNote(piece));
  return note ? translate(note) : null;
}

/** Good line for the day so far: every hour above target, or a morning of at least three hours above it. */
function middayGood(rows) {
  const firstUnder = rows.findIndex((row) => row.lbs < hourTarget(row));
  if (firstUnder !== -1 && firstUnder < 3) return null;
  const best = bestHour(firstUnder === -1 ? rows : rows.slice(0, firstUnder));
  if (!best) return null;
  const lead = firstUnder === -1 ? 'Every hour above target so far' : 'Morning above target every hour';
  return flag('good', `${lead}, best ${fmt2(best.rate)} at ${slotLabel(best.timeSlot) ?? DASH}`);
}

/**
 * Midday card for `date` (today, so far). `scoreboard` is today's scoreboard
 * JSON, `dashboardToday` today's dashboard (cultivar and T-Zero count),
 * `priorDay` the previous weekday's dashboard, `sacks` today's supersack
 * summary. null while no hour is logged.
 */
export function middayModel({ date, scoreboard, dashboardToday, priorDay, sacks, generatedAt }) {
  const sb = scoreboard?.scoreboard;
  const rows = hourRows(sb);
  if (!rows.length) return null;
  const today = dayRow(dashboardToday, date);
  const prior = lastDayBefore(priorDay, date);
  const last = rows.at(-1);
  const tops = sum(rows, (row) => row.lbs);
  const rate = ratio(tops, sum(rows, crewHours));
  const sackCount = sum(sacks?.periods ?? [], (p) => p.total_sacks);
  const under = rows.filter((row) => row.lbs < hourTarget(row)).length;
  const drop = crewDrop(rows);
  const why = drop && crewNote(rows, drop.from);
  const now = sb.currentHourTarget > 0
    ? { label: slotLabel(sb.currentTimeSlot) ?? DASH, rate: DASH, lbs: 0, target: sb.currentHourTarget, kind: 'now' }
    : null;
  return {
    kind: 'midday',
    costsLocked: costsLocked(today),
    eyebrow: 'Rogue Origin · Midday check',
    title: weekdayName(date),
    sub: `${monthDay(date)} · ${today ? cultivarName([today]) : cultivarShort(sb.strain)} · through ${slotEnd(last.timeSlot) ?? DASH}`,
    pill: `Line crew ${last.trimmers ?? 0} T · ${last.buckers ?? 0} B · ${dashboardToday?.today?.tzero || 1} TZ`,
    tiles: [
      tile('Tops so far', fmtInt(tops), 'lb', [targetChip(sb.todayPercentage)]),
      tile('Rate', fmt2(rate), 'lb/hr', [rateTargetChip(rate, sb.targetRate)]),
      tile('Projected end of day', fmtInt(sb.projectedTotal), 'lb', [
        prior ? { kind: 'neutral', text: `${shortWeekday(prior.date)} closed at ${fmtInt(prior.totalTops)}` } : null,
      ]),
    ],
    chart: { title: 'Tops by hour', legend: LEGEND, sub: 'lb · rate under the hour', cols: [...rows.map(hourCol), ...(now ? [now] : [])] },
    minis: [
      mini('Smalls so far', fmtInt(sum(rows, (row) => row.smalls)), 'lb', ''),
      buckerMini(last),
      mini('Hours logged', fmt1(sb.effectiveHours), `of ${SHIFT_HOURS}`, `sacks logged: ${fmtInt(sackCount)}`),
    ],
    flags: pickFlags([
      ...noteFlags(rows),
      drop && flag('warn', `Crew fell ${drop.peak} → ${drop.last} trimmers after ${slotLabel(rows[drop.from].timeSlot) ?? DASH}`
        + `${why ? `: ${why}` : ''}${under ? `, ${under} ${under === 1 ? 'hour' : 'hours'} under target` : ''}`),
      sackCount === 0 && slotMinutes(last.timeSlot)?.end >= 600 ? flag('warn', 'No supersacks logged on the tracker yet today') : null,
      middayGood(rows),
    ]),
    foot: foot('cards/midday · scoreboard target · $/lb at close', generatedAt),
  };
}
