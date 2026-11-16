/** Formatting helpers for the consignment page. */
import { t, getLang } from '../shared/i18n.js';

const locale = () => (getLang() === 'es' ? 'es-US' : 'en-US');

/** HTML-escape anything that came from a person or the server. */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Label with {n}-style placeholders filled in. */
export const tf = (key, vars = {}) => t(key).replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));

/** Pounds, up to two decimals; an em dash for "no weight". */
export function lbs(n) {
  if (n == null || n === '' || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString(locale(), { maximumFractionDigits: 2 });
}

/** Dollars, always positive. The caller words a negative balance as a credit. */
export function money(n) {
  return Math.abs(Number(n) || 0).toLocaleString(locale(), { style: 'currency', currency: 'USD' });
}

/** SQLite UTC ("2026-11-16 18:00:00", no zone) shown as local date and time. */
export function when(ts, { time = true } = {}) {
  if (!ts) return '';
  const s = String(ts);
  const d = new Date(/T|Z$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return s;
  const opts = time ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', year: 'numeric' };
  return d.toLocaleString(locale(), opts);
}

/** A plain YYYY-MM-DD day ("2026-11-16") shown without shifting it a day. */
export function day(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) return ymd || '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Today on this device's calendar, YYYY-MM-DD (not UTC, which rolls over in the afternoon). */
export function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const STATUS_KEYS = { dropped: 'statusDropped', weighed: 'statusWeighed', screening: 'statusScreening', closed: 'statusClosed', voided: 'statusVoided' };
export const statusLabel = (status) => t(STATUS_KEYS[status] || 'statusDropped');

/** Status chip: colour AND word, never colour alone. */
export const statusChip = (status) => `<span class="cs-chip st-${esc(status)}">${esc(statusLabel(status))}</span>`;

export const termLabel = (term) => t(term === 'sold' ? 'termSold' : 'termDropoff');
export const typeLabel = (type) => t(type === 'smalls' ? 'smalls' : 'tops');

/**
 * Screening add-up check. Same rule as the server: workers/src/lib/consign-ledger.js
 * (screenTolerance + checkRun). Keep the two in step.
 */
export function runCheck(pulled, outputs) {
  const p = Number(pulled) || 0;
  const sum = outputs.reduce((a, v) => a + (Number(v) || 0), 0);
  const diff = Math.round((p - sum) * 100) / 100;
  const tolerance = Math.round(Math.max(0.5, 0.01 * p) * 100) / 100;
  return { ok: p > 0 && Math.abs(diff) <= tolerance, diff, tolerance };
}

/** Parse a typed number; '' and junk are null. */
export function num(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
