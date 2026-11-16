/**
 * The two printable consignment sheets, as HTML strings. Pure, no DOM (node tests import it).
 * Letter, portrait, black on white, English with the Spanish under it. No prices, ever.
 * Plan: docs/plans/2026-11-16-consignment-lot-ledger-stage2.md "The two sheets".
 */
import { esc } from './escape.mjs';

export const DROPOFF_ROWS = 12;
export const SCREEN_ROWS = 10;

/** Short code printed under the QR; the photo reader picks it up too. */
export function sheetCode(kind, id) {
  if (kind === 'screen') return `SCREEN-D${id}`;
  return id ? `DROP-F${id}` : 'DROP';
}

/**
 * Lots a screening sheet prints a row for, in printed order: weighed, not closed, not voided.
 * Same rule as screenable() in workers/src/handlers/consign-d1.js (readSheet), which numbers
 * the rows for the model. Keep the two in step.
 */
export const screenableLots = (lots) => (lots || [])
  .filter((l) => l.money && (l.money.status === 'weighed' || l.money.status === 'screening'))
  .sort((a, b) => a.id - b.id);

const lb = (n) => (n == null || !Number.isFinite(Number(n)) ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));
/** English on top, Spanish below in smaller type. */
const bi = (en, es) => `<span class="sh-en">${esc(en)}</span><span class="sh-es">${esc(es)}</span>`;

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out.length ? out : [[]];
}

function head({ title, fields, qrSvg, code, page, total }) {
  return `<header class="sh-head">
    <div class="sh-headl">
      <h1 class="sh-title">${title}</h1>
      <div class="sh-fields">${fields.map(([label, value]) => `<div class="sh-field"><div class="sh-flabel">${label}</div><div class="sh-fvalue">${esc(value || '')}</div></div>`).join('')}</div>
    </div>
    <div class="sh-qr"><div class="sh-qrimg">${qrSvg || ''}</div><div class="sh-code">${esc(code)}</div><div class="sh-pageno">${page} / ${total}</div></div>
  </header>`;
}

/** Sheet A. farm may be null (blank sheet); cultivars are pre-printed in the first rows. */
export function dropoffSheet({ farm, cultivars = [], qrSvg, code }) {
  const groups = chunk(cultivars, DROPOFF_ROWS);
  const total = groups.length;
  return groups.map((names, p) => {
    const rows = Array.from({ length: DROPOFF_ROWS }, (_, i) => `<tr class="sh-row"><td class="sh-name">${names[i] ? esc(names[i]) : ''}</td><td class="sh-box" data-box="tops"></td><td class="sh-box" data-box="tops_final"></td><td class="sh-box" data-box="smalls"></td><td class="sh-box" data-box="smalls_final"></td><td class="sh-box sh-wide"></td></tr>`).join('');
    const last = p === total - 1;
    return `<section class="sh-page sh-a">
      ${head({
        title: bi('Dropoff sheet', 'Hoja de entrega'),
        fields: [[bi('Farm', 'Granja'), farm ? farm.name : ''], [bi('Date', 'Fecha'), ''], [bi('Dropped by', 'Entregado por'), '']],
        qrSvg, code, page: p + 1, total,
      })}
      <table class="sh-table">
        <colgroup><col style="width:24%"><col style="width:14%"><col style="width:14%"><col style="width:14%"><col style="width:14%"><col style="width:20%"></colgroup>
        <thead><tr><th>${bi('Cultivar', 'Variedad')}</th><th>${bi('Tops lb', 'Libras de tops')}</th><th>${bi('Tops final', 'Final de tops')}</th><th>${bi('Smalls lb', 'Libras de smalls')}</th><th>${bi('Smalls final', 'Final de smalls')}</th><th>${bi('Note', 'Nota')}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${last ? `<div class="sh-note"><div class="sh-flabel">${bi('Dropoff note', 'Nota de la entrega')}</div><div class="sh-line"></div><div class="sh-line"></div></div>` : ''}
      <p class="sh-help">${bi(
        'Write the pounds. Put a ✓ in the box if it came in but was not weighed. Leave the box empty if it did not come in. Cross out a row that was not brought. Fill Final only if it was checked at dropoff; leave it empty if it will be screened later.',
        'Escriba las libras. Ponga ✓ en la casilla si llegó pero no se pesó. Déjela vacía si no llegó. Tache la fila que no se trajo. Llene Final solo si se revisó en la entrega; déjelo vacío si se va a cribar después.',
      )}</p>
    </section>`;
  }).join('');
}

/** Sheet B. lots: every lot of the dropoff (from the dropoff action); this picks and orders them. */
export function screenSheet({ dropoff, lots = [], qrSvg, code }) {
  const rows = screenableLots(lots);
  const weighFirst = (lots || []).filter((l) => l.money && l.money.status === 'dropped');
  const groups = chunk(rows, SCREEN_ROWS);
  const total = groups.length;
  let idx = 0;
  // Two lots with the same cultivar and type (a dropoff/sold split) look alike: print the term.
  const twin = (l) => rows.filter((x) => x.cultivar.toLowerCase() === l.cultivar.toLowerCase() && x.type === l.type).length > 1;
  return groups.map((group, p) => {
    const body = group.map((l) => {
      idx += 1;
      const smalls = l.type === 'smalls';
      const term = twin(l) ? `<span class="sh-left">${l.term === 'sold' ? bi('sold', 'vendido') : bi('dropoff', 'entrega')}</span>` : '';
      const partly = l.money.status === 'screening';
      return `<tr class="sh-row" data-lot="${esc(l.id)}">
        <td class="sh-idx">${idx}</td>
        <td class="sh-name">${esc(l.cultivar)}<span class="sh-ref">L${esc(l.id)}</span></td>
        <td class="sh-type">${smalls ? 'smalls' : 'tops'}${term}</td>
        <td class="sh-before">${lb(l.money.remainder_lbs)}${partly ? `<span class="sh-left">${bi('left to screen', 'queda')}</span>` : ''}</td>
        <td class="sh-box" data-box="pulled"></td>
        <td class="sh-box" data-box="final"></td>
        ${smalls ? '<td class="sh-na" aria-label="not used"></td>' : '<td class="sh-box" data-box="to_smalls"></td>'}
        <td class="sh-box" data-box="biomass"></td>
        <td class="sh-box" data-box="mold"></td>
        <td class="sh-tick"><span class="sh-tickbox"></span></td>
      </tr>`;
    }).join('');
    const last = p === total - 1;
    return `<section class="sh-page sh-b">
      ${head({
        title: bi('Screening sheet', 'Hoja de cribado'),
        fields: [[bi('Farm', 'Granja'), dropoff.farm_name], [bi('Dropoff date', 'Fecha de entrega'), dropoff.date], [bi('Dropped by', 'Entregado por'), dropoff.dropped_by]],
        qrSvg, code, page: p + 1, total,
      })}
      <table class="sh-table sh-screen">
        <colgroup><col style="width:4%"><col style="width:16%"><col style="width:8%"><col style="width:10%"><col style="width:10%"><col style="width:10%"><col style="width:10%"><col style="width:10%"><col style="width:10%"><col style="width:12%"></colgroup>
        <thead><tr><th>#</th><th>${bi('Cultivar', 'Variedad')}</th><th>${bi('Type', 'Tipo')}</th><th>${bi('Before lb', 'Antes lb')}</th>
          <th>${bi('Pulled', 'Sacado')}</th><th>${bi('Final', 'Final')}</th><th>${bi('To smalls', 'A smalls')}</th><th>${bi('Biomass', 'Biomasa')}</th><th>${bi('Mold', 'Moho')}</th><th>${bi('Finished', 'Terminado')}</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
      ${last && weighFirst.length ? `<div class="sh-weighfirst"><div class="sh-flabel">${bi('Weigh first (not on this sheet)', 'Pesar primero (no va en esta hoja)')}</div>
        <ul>${weighFirst.map((l) => `<li>${esc(l.cultivar)} ${l.type === 'smalls' ? 'smalls' : 'tops'}</li>`).join('')}</ul></div>` : ''}
      <p class="sh-help">${bi(
        'Pounds pulled must equal final + to smalls + biomass + mold. Write 0 for none. Tick Finished when the lot is all screened.',
        'Lo sacado debe ser igual a final + a smalls + biomasa + moho. Escriba 0 si no hay. Marque Terminado cuando se cribó todo el lote.',
      )}</p>
    </section>`;
  }).join('');
}
