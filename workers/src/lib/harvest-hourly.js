/**
 * Pure logic for the harvest hourly SMS log — no D1, no fetch, so every rule
 * here is unit-tested. The handler (harvest-hourly-d1.js) only moves rows.
 * Design: wiki/operations/plans/2026-09-11-harvest-hourly-sms-bot-design.md
 */
import { parseSqliteUtc } from './pacific.js';

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

/** Coerce and range-check the six counts. Null stays null (unanswered). */
export function validateCounts(obj) {
  const values = {};
  const invalid = [];
  for (const f of COUNT_FIELDS) {
    const raw = obj?.[f];
    if (raw === null || raw === undefined || raw === '') { values[f] = null; continue; }
    const n = Number(raw);
    const [lo, hi] = LIMITS[f];
    if (!Number.isInteger(n) || n < lo || n > hi) { values[f] = null; invalid.push(f); continue; }
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
// "9am: ...", "9: ...", "1pm - ...", "13: ..."
const HOUR_RE = /^(\d{1,2})\s*(am|pm)?\s*[:\-]\s*(.+)$/is;

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
    else if (!ap && h < 6) h += 12;   // "1:" in a barn day is 1 PM; the barn is never open at 1 AM
    if (h >= 0 && h <= 23) {
      return { kind: 'answer', hour: String(h).padStart(2, '0') + ':00', text: m[3].trim() };
    }
  }
  return { kind: 'answer', hour: null, text: t };
}

export function hourEnd(hourStart) {
  const h = Number(hourStart.slice(0, 2)) + 1;
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

export function helpText(barn) {
  return `${BARN_LABELS[barn]}. Cada hora te pregunto: cortadores, waterspiders campo, choferes, ` +
    `colgadores, waterspiders granero, racks, notas. Responde con los numeros en ese orden. ` +
    `Ejemplo: 4 2 3 8 1 12 sin novedad. EMPEZAR / PARAR para el dia.`;
}

export function confirmText(row) {
  const r = row;
  let s = `Ok ${hourRange(r.hour_start)} ${BARN_SHORT[r.barn]}: C${r.cutters} WSc${r.cutter_water_spiders} ` +
    `Ch${r.drivers} Col${r.hangers} WSg${r.hanging_water_spiders} R${r.racks}`;
  if (r.notes) s += `. Nota: ${r.notes}`;
  return s;
}

export function askMissingText(row) {
  const names = missingFields(row).map(f => FIELD_ES[f]).join(', ');
  // A question reads as a phrase, not a label: "de 9 a 10", not "de 9-10".
  return `Falta: ${names}. Cuantos de ${hourRange(row.hour_start).replace('-', ' a ')}?`;
}

export function notUnderstoodText() {
  return 'No entendi. Manda los numeros en orden: cortadores, waterspiders campo, choferes, ' +
    'colgadores, waterspiders granero, racks. Ejemplo: 4 2 3 8 1 12 sin novedad';
}

/**
 * What the cron should do about the just-ended hour's row. Every action is
 * gated on status plus a timestamp, so a late or doubled tick is harmless.
 */
export function tickDecision(row, now) {
  if (!row) return { type: 'ask' };
  const t = now.getTime();
  if (row.status === 'pending' && row.asked_at &&
      t - parseSqliteUtc(row.asked_at).getTime() >= NUDGE_AFTER_MS) return { type: 'nudge' };
  if (row.status === 'nudged' && row.nudged_at &&
      t - parseSqliteUtc(row.nudged_at).getTime() >= MISSING_AFTER_MS) return { type: 'missing' };
  return null;
}

/** recentStatuses: the newest finalized (complete|missing) rows first. */
export function shouldAutoStop({ hourNow, recentStatuses }) {
  if (hourNow >= STOP_HOUR) return true;
  const last = recentStatuses.slice(0, MAX_MISSED_IN_A_ROW);
  return last.length === MAX_MISSED_IN_A_ROW && last.every(s => s === 'missing');
}
