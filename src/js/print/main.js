/**
 * The order's papers in one tab (order flow slice 4, design doc §2e; Koa
 * 2026-11-11: "1 click printing"). Bag/tag's Print + confirm opens this tab:
 *   1. each cultivar's COA prints on its own (the print dialog opens by itself,
 *      one per COA; a missing COA is a warning, never a block);
 *   2. one button opens the order in Shopify admin for Shopify's own packing slip
 *      (More actions -> Print packing slips). The staff browser is signed in to
 *      Shopify; no buyer field ever comes through our Worker.
 * Silent printing with no dialogs at all is slice 6 (the print agent).
 *
 *   print.html?order=N                                        from bag/tag
 *   print.html?order=N&api=http://localhost:8787/api/production local testing only
 */
import { registerLabels, setLang, getLang, t } from '../shared/i18n.js';
import { lineText } from '../bagtag/view.mjs';

const PROD_API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production';
const FRAME_MS = 5000;

registerLabels({
  en: {
    papers: 'Papers', slip: 'Packing slip', slipBtn: 'Open in Shopify to print the packing slip', slipHint: 'In Shopify: More actions → Print packing slips.',
    noSlip: 'Shopify is not connected: print the packing slip from Shopify by hand.', coas: 'COAs', printCoa: 'Print COA', printAll: 'Print all COAs again',
    missing: 'No COA for {c}. Print it from Drive.', ambiguous: '{c} has more than one COA: pick one.', printing: 'Printing…', printed: 'Sent to print',
    notFound: 'This COA is not in the store yet: print it from Drive.', loadFail: 'No connection to the server.', lines: 'In this order', done: 'Done: close this tab',
    openCoa: 'Open the COA to print it',
  },
  es: {
    papers: 'Papeles', slip: 'Lista de empaque', slipBtn: 'Abrir en Shopify para imprimir la lista de empaque', slipHint: 'En Shopify: More actions → Print packing slips.',
    noSlip: 'Shopify no está conectado: imprima la lista de empaque desde Shopify a mano.', coas: 'COAs', printCoa: 'Imprimir COA', printAll: 'Imprimir todos los COA otra vez',
    missing: 'No hay COA para {c}. Imprímalo desde Drive.', ambiguous: '{c} tiene más de un COA: elija uno.', printing: 'Imprimiendo…', printed: 'Enviado a imprimir',
    notFound: 'Este COA todavía no está guardado: imprímalo desde Drive.', loadFail: 'No hay conexión con el servidor.', lines: 'En esta orden', done: 'Listo: cierre esta pestaña',
    openCoa: 'Abra el COA para imprimirlo',
  },
});
const tf = (key, vars = {}) => t(key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

const params = new URLSearchParams(location.search);
const apiParam = params.get('api') || '';
const API = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(apiParam) ? apiParam : PROD_API;
const orderId = Number(params.get('order'));

const $ = id => document.getElementById(id);
const el = { title: $('title'), lines: $('lines'), slip: $('slip'), coas: $('coas'), notice: $('notice'), lang: $('langToggle'), all: $('printAll') };
let data = null;

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

/** Print one COA: fetched as a blob so the hidden frame is same-origin and can print. */
async function printCoa(file, status) {
  status.textContent = t('printing');
  try {
    const r = await fetch(`${API}?action=coaPdf&file=${encodeURIComponent(file)}`);
    if (!r.ok) { status.textContent = t('notFound'); status.className = 'status bad'; return false; }
    const url = URL.createObjectURL(await r.blob());
    // A browser with no built-in PDF viewer never loads the frame: after FRAME_MS,
    // hand over a link instead of hanging on "Printing…".
    const printed = await new Promise((resolve) => {
      const frame = document.createElement('iframe');
      frame.className = 'print-frame';
      const giveUp = setTimeout(() => resolve(false), FRAME_MS);
      frame.onload = () => {
        clearTimeout(giveUp);
        setTimeout(() => {
          try { frame.contentWindow.focus(); frame.contentWindow.print(); resolve(true); } catch { resolve(false); }
        }, 300);
      };
      frame.src = url;
      document.body.appendChild(frame);
    });
    if (printed) {
      status.textContent = t('printed');
      status.className = 'status ok';
      return true;
    }
    const a = node('a', 'open-coa', t('openCoa'));
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    status.replaceChildren(a);
    status.className = 'status';
    return false;
  } catch {
    status.textContent = t('loadFail');
    status.className = 'status bad';
    return false;
  }
}

function render() {
  if (!data) return;
  el.title.textContent = `${data.order.name} · ${t('papers')}`;
  el.lines.replaceChildren(...data.lines.map(l => node('li', null, lineText(l))));
  el.slip.replaceChildren();
  if (data.slipUrl) {
    const a = node('a', 'btn primary', t('slipBtn'));
    a.href = data.slipUrl; a.target = '_blank'; a.rel = 'noopener';
    el.slip.append(a, node('p', 'hint', t('slipHint')));
  } else {
    el.slip.append(node('p', 'warn', t('noSlip')));
  }
  el.coas.replaceChildren(...data.coas.map(c => {
    const row = node('div', 'coa');
    row.append(node('b', null, c.cultivar));
    const status = node('span', 'status');
    if (c.file) {
      const b = node('button', 'btn', t('printCoa'));
      b.type = 'button';
      b.addEventListener('click', () => printCoa(c.file, status));
      row.append(b, status);
      row.dataset.file = c.file;
    } else if (c.ambiguous) {
      row.append(node('span', 'warn', tf('ambiguous', { c: c.cultivar })));
      for (const f of c.ambiguous) {
        const b = node('button', 'btn ghost', f);
        b.type = 'button';
        b.addEventListener('click', () => printCoa(f, status));
        row.append(b);
      }
      row.append(status);
    } else {
      row.classList.add('missing');
      row.append(node('span', 'warn', tf('missing', { c: c.cultivar })));
    }
    return row;
  }));
  el.all.hidden = !data.coas.some(c => c.file);
}

async function printAll() {
  for (const row of el.coas.querySelectorAll('.coa[data-file]')) {
    await printCoa(row.dataset.file, row.querySelector('.status'));
  }
}

async function load() {
  if (!(orderId > 0)) { el.notice.textContent = 'order?'; el.notice.hidden = false; return; }
  try {
    const r = await fetch(`${API}?action=orderPrint&orderId=${orderId}`, { cache: 'no-store' });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d) { el.notice.textContent = (d && d.error) || t('loadFail'); el.notice.hidden = false; return; }
    data = d;
    document.title = `${d.order.name} - ${t('papers')}`;
    render();
    // One click from bag/tag: the COAs print by themselves, then the Shopify slip is one button away.
    if (params.get('auto') === '1') printAll();
  } catch { el.notice.textContent = t('loadFail'); el.notice.hidden = false; }
}

el.all.addEventListener('click', printAll);
el.lang.addEventListener('click', () => { setLang(getLang() === 'en' ? 'es' : 'en'); el.lang.textContent = getLang() === 'en' ? 'ES' : 'EN'; render(); });
el.lang.textContent = getLang() === 'en' ? 'ES' : 'EN';
load();
