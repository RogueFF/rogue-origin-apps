// Card models: API JSON → the plain object a card layout draws. Pure functions.
// This file starts with the helpers every card shares; the weekly, end-of-day
// and midday model builders are added below them.
//
// Missing values: parsers and helpers (here and in periods.js) return null for
// a value that is not there; only the display formatters (fmtInt, fmtMoney,
// fmt1, fmt2, cultivarShort) turn a missing value into "—".

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
  return (row?.effectiveTrimmers ?? row?.trimmers ?? 0) * (row?.target ?? 0) * (row?.multiplier ?? 1);
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
