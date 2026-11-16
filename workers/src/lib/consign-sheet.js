/**
 * Turn a model's read of a paper sheet into bounded, safe data. Pure, never throws.
 * The model's reply is untrusted: only what this file builds goes downstream.
 * Plan: docs/plans/2026-11-16-consignment-lot-ledger-stage2.md Task 1.
 */

const MAX_LBS = 5000;
const MAX_ROWS = 30;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** Trim, strip control characters, cap. Non-strings become ''. */
export function cleanText(v, max = 300) {
  if (typeof v !== 'string') return '';
  return v.replace(CONTROL, '').trim().slice(0, max).trim();
}

const NUMERIC = /^\s*(\d+(?:[.,]\d+)?)\s*$/;
const WITH_UNIT = /^\s*(\d+(?:[.,]\d+)?)\s*(?:lb|lbs|#)\.?\s*$/i;

/**
 * One handwritten weight box -> { value, unsure }.
 * Empty (null, undefined, '') is not unsure: the box was left blank.
 * opts.zero: accept 0 (screening outputs; a dropoff weight must be > 0).
 */
export function parseWeight(raw, modelUnsure = false, opts = {}) {
  const said = modelUnsure === true;
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) return { value: null, unsure: said };
  let n = NaN;
  let clean = true;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string') {
    const m = raw.match(NUMERIC) || raw.match(WITH_UNIT);
    if (m) { n = Number(m[1].replace(',', '.')); clean = NUMERIC.test(raw); }
  }
  const min = opts.zero ? n >= 0 : n > 0;
  if (!Number.isFinite(n) || !min || n > MAX_LBS) return { value: null, unsure: true };
  return { value: Math.round(n * 10) / 10, unsure: said || !clean };
}

/** A box from the model: { value, unsure, check } or a bare value. */
const readBox = (b, opts) => (isObj(b) ? parseWeight(b.value, b.unsure, opts) : parseWeight(b, false, opts));
const boxWritten = (b) => {
  if (!isObj(b)) return b != null && b !== '';
  return (b.value != null && b.value !== '') || b.check === true;
};

const lower = (s) => String(s).trim().toLowerCase();
const empty = (kind, warnings) => ({ kind, farm_id: null, farm_from: null, dropped_by: '', note: '', date: null, rows: [], warnings });

function sheetCode(raw) {
  const c = typeof raw.code === 'string' ? raw.code.trim().toUpperCase() : '';
  const drop = c.match(/^DROP(?:-F(\d+))?$/);
  if (drop) return { kind: 'dropoff', farm: drop[1] ? Number(drop[1]) : null };
  const scr = c.match(/^SCREEN-D(\d+)$/);
  if (scr) return { kind: 'screen', dropoff: Number(scr[1]) };
  return null;
}

function dropoffRows(raw, ctx) {
  const known = new Map((ctx.cultivars || []).filter((c) => typeof c === 'string').map((c) => [lower(c), c]));
  const out = [];
  for (const r of raw.rows) {
    if (out.length >= MAX_ROWS) break;
    if (!isObj(r)) continue;
    const name = cleanText(r.cultivar, 60);
    const match = name ? known.get(lower(name)) : undefined;
    const t = readBox(r.tops);
    const s = readBox(r.smalls);
    // Final (after) weight, filled only when the lot was checked at dropoff. 0 is a real final.
    const tf = readBox(r.tops_final, { zero: true });
    const sf = readBox(r.smalls_final, { zero: true });
    const tops = { value: t.value, unsure: t.unsure, on: t.value != null || boxWritten(r.tops) || boxWritten(r.tops_final) };
    const smalls = { value: s.value, unsure: s.unsure, on: s.value != null || boxWritten(r.smalls) || boxWritten(r.smalls_final) };
    if (!name && !tops.on && !smalls.on) continue;
    out.push({
      cultivar: match || name,
      cultivar_known: !!match && r.cultivar_unsure !== true,
      tops,
      tops_final: { value: tf.value, unsure: tf.unsure },
      smalls,
      smalls_final: { value: sf.value, unsure: sf.unsure },
      note: cleanText(r.note),
    });
  }
  return out;
}

/** { id, from }: from 'name' (handwriting, the person must confirm it) or 'code' (printed). */
function farmFor(raw, ctx, code) {
  const farms = (ctx.farms || []).filter((f) => isObj(f));
  const name = cleanText(raw.farm, 120);
  if (name) {
    const hit = farms.find((f) => typeof f.name === 'string' && lower(f.name) === lower(name));
    if (hit) return { id: hit.id, from: 'name' };
  }
  if (code && code.kind === 'dropoff' && code.farm != null) {
    const hit = farms.find((f) => Number(f.id) === code.farm);
    if (hit) return { id: hit.id, from: 'code' };
  }
  return { id: null, from: null };
}

const SCREEN_FIELDS = ['pulled', 'final', 'to_smalls', 'biomass', 'mold'];

/** "L10" / "10" -> 10; anything else -> null. */
const parseRef = (v) => {
  const m = typeof v === 'string' ? v.trim().match(/^L?\s*(\d{1,9})$/i) : null;
  return m ? Number(m[1]) : null;
};

function screenRows(raw, ctx, warn) {
  const lots = (ctx.lots || []).filter((l) => isObj(l));
  // Every lot of the dropoff (open or not): the printed lot reference on a row ("L10") is
  // matched here first, so rows keep their lots even when the order changed since printing.
  const refLots = (ctx.refLots || []).filter((l) => isObj(l));
  const used = new Set();
  const out = [];
  for (const r of raw.rows) {
    if (out.length >= MAX_ROWS) break;
    if (!isObj(r)) continue;
    const cult = cleanText(r.cultivar, 60);
    const type = r.type === 'tops' || r.type === 'smalls' ? r.type : null;
    let lot = null;
    const fitsRow = (l) => (!cult || lower(cult) === lower(l.cultivar)) && (!type || type === l.type);
    const ref = parseRef(r.lot_ref);
    const byRef = ref == null ? null : refLots.find((l) => l.id === ref);
    if (byRef && fitsRow(byRef)) lot = byRef;
    if (!lot && Number.isInteger(r.index) && r.index >= 1 && r.index <= lots.length) {
      const byIndex = lots[r.index - 1];
      const fits = (!cult || lower(cult) === lower(byIndex.cultivar)) && (!type || type === byIndex.type);
      if (fits) lot = byIndex;
    }
    if (!lot && cult && type) {
      lot = lots.find((l) => !used.has(l.id) && lower(l.cultivar) === lower(cult) && l.type === type) || null;
    }
    if (!lot) { warn('unknown_row'); continue; }
    if (used.has(lot.id)) { warn('duplicate_row'); continue; }
    if (lot.open === false) { warn('lot_changed'); continue; } // printed, but weighed-over, closed or voided since

    const row = { lot_id: lot.id };
    for (const f of SCREEN_FIELDS) row[f] = readBox(r[f], { zero: f !== 'pulled' });
    if (lot.type === 'smalls') row.to_smalls = { value: 0, unsure: false };
    const fin = isObj(r.finished) ? r.finished : { value: r.finished };
    const finBool = typeof fin.value === 'boolean';
    row.finishes = { value: finBool ? fin.value : false, unsure: fin.unsure === true || (fin.value != null && !finBool) };
    const counts = (f) => !(f === 'to_smalls' && lot.type === 'smalls');
    // An unreadable box counts: the lot must show up for the person, every box marked Check.
    const anything = SCREEN_FIELDS.some((f) => counts(f) && (boxWritten(r[f]) || (isObj(r[f]) && r[f].unsure === true))) || row.finishes.value;
    if (!anything) continue;
    used.add(lot.id);
    out.push(row);
  }
  return out;
}

/**
 * normalizeSheetRead(kind, raw, ctx) -> { kind, farm_id, farm_from, dropped_by, note, date, rows, warnings }
 *   kind: 'dropoff' | 'screen'
 *   raw:  whatever JSON.parse gave back from the model (may be anything)
 *   ctx:  { farms: [{id, name}], cultivars: [string], lots: [{id, cultivar, type, intake_lbs, remainder_lbs, open?}],
 *           refLots?: [{id, cultivar, type, open}] (every lot of the dropoff, for the printed "L<id>" reference),
 *           dropoff_id?, farm_id? }  (dropoff_id / farm_id: the sheet the photo was opened for)
 */
export function normalizeSheetRead(kind, raw, ctx) {
  const k = kind === 'screen' ? 'screen' : kind === 'dropoff' ? 'dropoff' : String(kind).slice(0, 20);
  const c = isObj(ctx) ? ctx : {};
  if ((k !== 'dropoff' && k !== 'screen') || !isObj(raw) || !Array.isArray(raw.rows)) return empty(k, ['unreadable']);

  const warnings = [];
  const warn = (w) => { if (!warnings.includes(w)) warnings.push(w); };
  const code = sheetCode(raw);
  const wrong = code && (code.kind !== k
    || (k === 'screen' && c.dropoff_id != null && code.dropoff !== Number(c.dropoff_id))
    || (k === 'dropoff' && c.farm_id != null && code.farm != null && code.farm !== Number(c.farm_id)));
  if (wrong) return empty(k, ['wrong_sheet']);

  const date = typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date.trim()) ? raw.date.trim() : null;
  if (k === 'dropoff') {
    const farm = farmFor(raw, c, code);
    return {
      kind: k,
      farm_id: farm.id,
      farm_from: farm.from,
      dropped_by: cleanText(raw.dropped_by),
      note: cleanText(raw.note),
      date,
      rows: dropoffRows(raw, c),
      warnings,
    };
  }
  const rows = screenRows(raw, c, warn);
  return { kind: k, farm_id: null, farm_from: null, dropped_by: '', note: '', date, rows, warnings };
}
