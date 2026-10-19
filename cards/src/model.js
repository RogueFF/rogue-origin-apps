// Card models: API JSON → the plain object a card layout draws. Pure functions.
// This file starts with the helpers every card shares; the weekly, end-of-day
// and midday model builders are added below them.

const MINUS = '−';

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
 * e.g. "▲ +0.14 vs W41". `fmt` formats the size of the change; with `pct: true`
 * the change is shown as a whole percent of the prior value instead. A change
 * that rounds to nothing on screen is neutral ("= vs W41"). null when either
 * value is missing, or when a percent change has a zero base.
 */
export function deltaChip(value, prior, { fmt = String, upIsGood = true, vs, pct = false } = {}) {
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

/** Percent-of-target chip: ≥100 good, 90–99 warn, below 90 bad. null without a positive target. */
export function pctChip(value, target) {
  if (!Number.isFinite(value) || !Number.isFinite(target) || target <= 0) return null;
  const pct = Math.round((value / target) * 100);
  return { kind: pct >= 100 ? 'good' : pct >= 90 ? 'warn' : 'bad', text: `${pct}% target` };
}

/** Crew-adjusted target for one hourly slot, the scoreboard's method: trimmers × rate × multiplier. */
export function hourTarget(slot, rate) {
  return (slot?.trimmers ?? 0) * rate * (slot?.multiplier ?? 1);
}

const intFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const DASH = '—';

/** 20530.26 → "20,530". */
export const fmtInt = (v) => (Number.isFinite(v) ? intFormat.format(Math.round(v) + 0) : DASH);
/** 20530.26 → "$20,530". */
export const fmtMoney = (v) => (Number.isFinite(v) ? '$' + fmtInt(v) : DASH);
/** 5.58 → "5.6". */
export const fmt1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : DASH);
/** 1.3399 → "1.34". */
export const fmt2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : DASH);

/** "2026 - Sour Lifter / Sungrown" → "Sour Lifter '26". Empty → "—". */
export function cultivarShort(name) {
  const s = String(name ?? '').trim();
  const year = /^(\d{4})\s*-\s*/.exec(s);
  const rest = (year ? s.slice(year[0].length) : s).replace(/\s*\/[^/]*$/, '').trim();
  if (!rest) return DASH;
  return year ? `${rest} '${year[1].slice(2)}` : rest;
}
