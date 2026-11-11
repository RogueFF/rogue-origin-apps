/**
 * Pure helpers for the bag/tag queue (bagtag.html, design doc §2e slice 1).
 * No DOM, so they're unit-tested in tests/bagtag-view.test.mjs.
 */

export const BAG_LABELS = {
  qOz: '¼ oz', hOz: '½ oz', oz1: '1 oz', qLb: '¼ lb', hLb: '½ lb', lb1: '1 lb',
  lb10: '10 lb', kg1: '1 kg', kg5: '5 kg', pallet: 'pallet',
};
export const ROUTES = ['cell', 'bagging', 'pack', 'wholesale', 'ask'];

export function bagLabel(key) {
  return BAG_LABELS[key] || '';
}

/** "12 min", "3 h", "2 d": how long an order has waited. */
export function ageText(placedAt, nowMs) {
  const min = Math.max(0, Math.floor((nowMs - Date.parse(placedAt)) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/** "Sour Lifter · Tops · 1 oz × 4", with only what the line has. */
export function lineText(l) {
  const form = l.form ? l.form[0].toUpperCase() + l.form.slice(1) : '';
  const name = l.cultivar || l.title || '';
  const size = bagLabel(l.bag);
  const qty = l.qtyOpen ?? l.qty;
  return [name, form, size ? `${size} × ${qty}` : `× ${qty}`].filter(Boolean).join(' · ');
}

/**
 * The queue's three lists (slice 2):
 *   To start        not confirmed yet: bag/tag's one click is still due
 *   In cells        confirmed and at a cell, or every basket at the pickup spot
 *   Ready to check  collected from the spot (or pool-only orders once confirmed)
 */
export function splitLists(orders = []) {
  const collected = o => !!o.collectedAt;
  const ready = orders.filter(o => collected(o) && (o.state === 'ready' || o.state === 'checked'));
  const rest = orders.filter(o => !ready.includes(o));
  const inCells = rest.filter(o => o.state === 'ready' || (o.confirmedAt && (o.state === 'assigned' || o.state === 'trimming')));
  const toStart = rest.filter(o => !inCells.includes(o));
  return { toStart, inCells, ready };
}

/** "Cell 13 · NOW · same cultivar: no changeover" / "Waiting · Cell 13 frees a slot in ~25 min" parts. */
export function cellLine(o) {
  const c = o.cell;
  if (!c) return o.cellLines ? { kind: 'none' } : { kind: 'bagOnly' };
  if (c.waiting) return { kind: 'waiting', label: c.label, inMin: c.inMin };
  return { kind: 'at', label: c.label, slot: c.slot, why: c.why, done: c.done, baskets: c.baskets };
}

/** Counts per route over the To start list, for the header chips. */
export function routeCounts(orders = []) {
  const out = Object.fromEntries(ROUTES.map(r => [r, 0]));
  for (const o of orders) for (const l of o.lines || []) if (out[l.route] !== undefined) out[l.route] += 1;
  return out;
}

/** The Worker's route reasons (lib/order-route.js) in Spanish; anything unknown stays as sent. */
const WHY_ES = [
  [/^2026 Sungrown Tops: trimmed at a cell$/, 'Tops Sungrown 2026: se poda en una celda'],
  [/^Smalls: bagged from the pool$/, 'Smalls: se embolsa del inventario'],
  [/^Trim: bagged from the pool$/, 'Trim: se embolsa del inventario'],
  [/^Finished goods: straight to packing$/, 'Producto terminado: directo a empacar'],
  [/^Not flower: straight to packing$/, 'No es flor: directo a empacar'],
  [/^Custom line: pick where it goes$/, 'Línea personalizada: elija a dónde va'],
  [/^No flower type on this line: pick where it goes$/, 'Sin tipo de flor: elija a dónde va'],
  [/^No bag size on this line: pick where it goes$/, 'Sin tamaño de bolsa: elija a dónde va'],
  [/^Wholesale order: stays on the wholesale queue$/, 'Orden de mayoreo: se queda en la cola de mayoreo'],
  [/^Tagged prebagged$/, 'Marcado como ya embolsado'],
  [/^(\d{4}) crop: already trimmed$/, 'Cosecha $1: ya podada'],
  [/^Mids \/ mystery: already trimmed$/, 'Mids / misterio: ya podada'],
  [/^Greenhouse: already in inventory$/, 'Invernadero: ya en inventario'],
  [/^Bigger than one cell fill: from the 5 kg rounds$/, 'Más que una celda: de las rondas de 5 kg'],
  [/^No 2026 retail tag: older stock, already trimmed$/, 'Sin etiqueta 2026: inventario viejo, ya podado'],
];
export function whyText(why, lang) {
  if (!why || lang !== 'es') return why || '';
  for (const [re, es] of WHY_ES) if (re.test(why)) return why.replace(re, es);
  return why;
}

/** "Synced 3 min ago" source: minutes since the last good sync, or null. */
export function syncAgeMin(sync, nowMs) {
  if (!sync || !sync.lastOkAt) return null;
  const at = Date.parse(String(sync.lastOkAt).replace(' ', 'T') + 'Z');
  return Number.isFinite(at) ? Math.max(0, Math.floor((nowMs - at) / 60000)) : null;
}
