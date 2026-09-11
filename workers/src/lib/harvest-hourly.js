/**
 * Pure logic for the harvest hourly SMS log — no D1, no fetch, so every rule
 * here is unit-tested. The handler (harvest-hourly-d1.js) only moves rows.
 * Design: wiki/operations/plans/2026-09-11-harvest-hourly-sms-bot-design.md
 */
import { parseSqliteUtc, pacificParts, justEndedHour } from './pacific.js';

export const COUNT_FIELDS = [
  'cutters', 'cutter_water_spiders', 'drivers', 'hangers', 'hanging_water_spiders', 'racks',
];

export const LIMITS = {
  cutters: [0, 50], cutter_water_spiders: [0, 50], drivers: [0, 50],
  hangers: [0, 50], hanging_water_spiders: [0, 50], racks: [0, 200],
};

/** Spanish names, accent-free on purpose: accents push an SMS into 70-char segments. */
export const FIELD_ES = {
  cutters: 'cortadores', cutter_water_spiders: 'waterspiders campo', drivers: 'choferes',
  hangers: 'colgadores', hanging_water_spiders: 'waterspiders granero', racks: 'racks',
};

export const BARN_LABELS = { upper: 'Granero Arriba', bottom: 'Granero Abajo' };
const BARN_SHORT = { upper: 'Arriba', bottom: 'Abajo' };

export const NUDGE_AFTER_MS = 15 * 60 * 1000;
export const MISSING_AFTER_MS = 15 * 60 * 1000;
export const STOP_HOUR = 20;            // Pacific: no texts at or after 8 PM
export const MAX_MISSED_IN_A_ROW = 3;

/** Digits only — no sign, no decimal point, no exponent, no 0x. */
const INT_STRING_RE = /^\s*\d+\s*$/;

/**
 * Coerce and range-check the six counts. Null stays null (unanswered).
 *
 * Deliberately stricter than Number(): bare Number() turns true into 1, [4]
 * into 4, and '1e1' into 10. A crew count comes from a model reading an SMS,
 * so anything that is not plainly an integer is a parse failure, not a value.
 */
export function validateCounts(obj) {
  const values = {};
  const invalid = [];
  for (const f of COUNT_FIELDS) {
    const raw = obj?.[f];
    if (raw === null || raw === undefined || raw === '') { values[f] = null; continue; }
    let n = null;
    if (typeof raw === 'number' && Number.isInteger(raw)) n = raw;
    else if (typeof raw === 'string' && INT_STRING_RE.test(raw)) n = Number(raw);
    const [lo, hi] = LIMITS[f];
    if (n === null || n < lo || n > hi) { values[f] = null; invalid.push(f); continue; }
    values[f] = n;
  }
  return { values, invalid };
}

export function missingFields(row) {
  return COUNT_FIELDS.filter(f => row?.[f] === null || row?.[f] === undefined);
}

const START_RE = /^(empezar|start|comenzar|iniciar)$/i;
const STOP_RE = /^(parar|stop|terminar)$/i;
const HELP_RE = /^(ayuda|help)$/i;
// "9am: ...", "9: ...", "1pm - ...", "13: ...". The separator is deliberately
// narrow: a colon only when it is NOT part of a clock time ("10:30 se paro la
// maquina" is a note, not an hour prefix), and a dash only with whitespace on
// both sides, so "4-2-3-8-1-12" and "9-10 4 2 3 8 1 12" stay whole answers.
const HOUR_RE = /^(\d{1,2})\s*(am|pm)?(?:\s*:(?!\d)|\s+-\s+)\s*(.+)$/is;

// A bare hour below this is PM: "1:" in a barn day is 1 PM, since the barn is
// never open at 1 AM. At or above it the hour stands as written ("9:" is 9 AM).
const BARE_HOUR_PM_BELOW = 6;

/** What an inbound text is: a command, or an answer (optionally for a named hour). */
export function classifyInbound(text) {
  const t = String(text ?? '').trim();
  if (START_RE.test(t)) return { kind: 'start' };
  if (STOP_RE.test(t)) return { kind: 'stop' };
  if (HELP_RE.test(t)) return { kind: 'help' };
  const m = t.match(HOUR_RE);
  if (m) {
    let h = Number(m[1]);
    const ap = (m[2] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    else if (ap === 'am' && h === 12) h = 0;
    else if (!ap && h < BARE_HOUR_PM_BELOW) h += 12;
    if (h >= 0 && h <= 23) {
      return { kind: 'answer', hour: String(h).padStart(2, '0') + ':00', text: m[3].trim() };
    }
  }
  return { kind: 'answer', hour: null, text: t };
}

export function hourEnd(hourStart) {
  const h = (Number(hourStart.slice(0, 2)) + 1) % 24;   // 23:00 ends at 00:00, not 24:00
  return String(h).padStart(2, '0') + ':00';
}

/** '9-10' — 12-hour clock without am/pm, which is how the crew says it. */
export function hourRange(hourStart) {
  const h = Number(hourStart.slice(0, 2));
  const twelve = (x) => ((x + 11) % 12) + 1;
  return `${twelve(h)}-${twelve(h + 1)}`;
}

export function promptText(barn, hourStart) {
  return `${hourEnd(hourStart)} ${BARN_LABELS[barn]}. Responde en un mensaje: ` +
    `cortadores, waterspiders campo, choferes, colgadores, waterspiders granero, racks, notas.`;
}

export function reminderText(barn, hourStart) {
  return `Recordatorio ${BARN_LABELS[barn]}: faltan los numeros de ${hourRange(hourStart)}. ` +
    `Ejemplo: 4 2 3 8 1 12 sin novedad`;
}

/** The one text allowed to run to two GSM segments — it is sent on request only. */
export function helpText(barn) {
  return `${BARN_LABELS[barn]}. Cada hora te pregunto: cortadores, waterspiders campo, choferes, ` +
    `colgadores, waterspiders granero, racks, notas. Responde con los numeros en ese orden. ` +
    `Ejemplo: 4 2 3 8 1 12 sin novedad. EMPEZAR / PARAR para el dia.`;
}

/** Precondition: `row` is complete — all six counts non-null (missingFields is empty). */
export function confirmText(row) {
  const r = row;
  let s = `Ok ${hourRange(r.hour_start)} ${BARN_SHORT[r.barn]}: C${r.cutters} WSc${r.cutter_water_spiders} ` +
    `Ch${r.drivers} Col${r.hangers} WSg${r.hanging_water_spiders} R${r.racks}`;
  if (r.notes) s += `. Nota: ${r.notes}`;
  return s;
}

/** Precondition: `row` has at least one null count — otherwise there is nothing to ask for. */
export function askMissingText(row) {
  const names = missingFields(row).map(f => FIELD_ES[f]).join(', ');
  // A question reads as a phrase, not a label: "de 9 a 10", not "de 9-10".
  return `Falta: ${names}. Cuantos de ${hourRange(row.hour_start).replace('-', ' a ')}?`;
}

/**
 * "Sin novedad" is how the crew says "nothing to report". Stored as a note it
 * would put noise in every confirmation text and every day summary, so it
 * normalizes to null — the same as an empty reply.
 */
const NO_NEWS = new Set([
  'sin novedad', 'sin novedades', 'nada', 'todo bien', 'ok', 'nothing', 'none', 'no notes',
]);

/** The note the foreman actually meant to leave, or null. */
export function normalizeNotes(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const bare = t.replace(/[.!]+$/, '').trim().toLowerCase();
  return NO_NEWS.has(bare) ? null : t;
}

export function notUnderstoodText() {
  return 'No entendi. Manda los numeros en orden: cortadores, waterspiders campo, choferes, ' +
    'colgadores, waterspiders granero, racks. Ejemplo: 4 2 3 8 1 12 sin novedad';
}

/**
 * Milliseconds since a SQLite UTC timestamp, or Infinity when it is missing or
 * unparseable. Infinity means "overdue": a row whose clock we cannot read must
 * still move forward, and the write that moves it stamps a fresh timestamp.
 */
function msSince(ts, t) {
  if (!ts) return Infinity;
  const ms = parseSqliteUtc(ts).getTime();
  return Number.isNaN(ms) ? Infinity : t - ms;
}

/**
 * Was the just-ended hour already over when the foreman texted EMPEZAR? If so
 * there is nothing to ask about — he was not working it.
 */
function endedBeforeActivation(now, activeSince) {
  const je = justEndedHour(now);
  if (!je) return false;
  const parts = pacificParts(parseSqliteUtc(activeSince));
  return parts.day === je.harvest_date &&
    Number(je.hour_start.slice(0, 2)) + 1 <= parts.hour + parts.minute / 60;
}

/**
 * What the cron should do about the just-ended hour's row. Every action is
 * gated on status plus a timestamp, so a late or doubled tick is harmless.
 *
 * @param activeSince SQLite UTC string, or null — when the foreman started the
 *   day. An hour that ended before that is never asked about.
 */
export function tickDecision(row, now, { activeSince } = {}) {
  if (!row) {
    if (activeSince && endedBeforeActivation(now, activeSince)) return null;
    return { type: 'ask' };
  }
  const t = now.getTime();
  if (row.status === 'pending' && msSince(row.asked_at, t) >= NUDGE_AFTER_MS) return { type: 'nudge' };
  if (row.status === 'nudged' && msSince(row.nudged_at, t) >= MISSING_AFTER_MS) return { type: 'missing' };
  return null;
}

/**
 * @param recent the newest finalized (complete|missing) rows first, as
 *   `{ status, asked_at }`. Rows asked before the current `activeSince` are
 *   ignored: a foreman who texts EMPEZAR again after an auto-stop must not be
 *   stopped a second time by the same three missed hours.
 */
export function shouldAutoStop({ hourNow, recent = [], activeSince = null }) {
  if (hourNow >= STOP_HOUR) return true;
  const sinceStart = activeSince
    ? recent.filter(r => r.asked_at && r.asked_at >= activeSince)
    : recent;
  const last = sinceStart.slice(0, MAX_MISSED_IN_A_ROW);
  return last.length === MAX_MISSED_IN_A_ROW && last.every(r => r.status === 'missing');
}
