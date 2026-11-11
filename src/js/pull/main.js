/**
 * Pull list: what raw to bring to which cell (Koa 2026-11-11: "a light 'what to
 * bring, where' pull list only: cell, cultivar, roughly how much, NOW/NEXT").
 * Reads the cells' NOW / NEXT from the order queue (cellQueue). No weigh entry:
 * the raw hand-out screen stays optional.
 *
 *   pull.html                                          the screen
 *   pull.html?api=http://localhost:8787/api/production local testing only
 */
import { registerLabels, setLang, getLang, t } from '../shared/i18n.js';
import { isDemo, demoApi, withDemo, showDemoBanner } from '../shared/demo.mjs';
import { pullRows } from './view.mjs';

const PROD_API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production';
const POLL_MS = 10000;

registerLabels({
  en: {
    title: 'Pull list', sub: 'Bring raw for each cell\'s NOW and NEXT. About this much; a little over is fine.',
    now: 'NOW', next: 'NEXT', free: 'Free: no order', nothingNext: 'Nothing next yet', sameAsNow: 'Same as NOW: what\'s at the cell may cover it',
    raw: '~{g} raw', queue: 'Bag/tag queue', loadFail: 'No connection to the server. Retrying…',
    notReady: 'Orders at cells are not set up on the server yet.', empty: 'No cells take orders yet.',
    qOz: '¼ oz', hOz: '½ oz', oz1: '1 oz', qLb: '¼ lb', hLb: '½ lb', lb1: '1 lb',
  },
  es: {
    title: 'Lista de surtido', sub: 'Lleve crudo para lo de AHORA y SIGUIENTE de cada celda. Más o menos esto; un poco de más está bien.',
    now: 'AHORA', next: 'SIGUIENTE', free: 'Libre: sin orden', nothingNext: 'Nada después todavía', sameAsNow: 'Igual que AHORA: lo que hay en la celda puede alcanzar',
    raw: '~{g} de crudo', queue: 'Cola de empaque', loadFail: 'No hay conexión con el servidor. Reintentando…',
    notReady: 'Las órdenes en celdas todavía no están listas en el servidor.', empty: 'Ninguna celda toma órdenes todavía.',
    qOz: '¼ oz', hOz: '½ oz', oz1: '1 oz', qLb: '¼ lb', hLb: '½ lb', lb1: '1 lb',
  },
});
const tf = (key, vars = {}) => t(key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

const params = new URLSearchParams(location.search);
const apiParam = params.get('api') || '';
const API = demoApi(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(apiParam) ? apiParam : PROD_API);   // ?demo=1: the practice database
if (API !== PROD_API) document.getElementById('queueLink').href = `bagtag.html?api=${encodeURIComponent(API)}`;
{ const a = document.getElementById('queueLink'); a.href = withDemo(a.getAttribute('href')); }
showDemoBanner();

const $ = id => document.getElementById(id);
const el = { lang: $('langToggle'), list: $('rows'), notice: $('notice') };
let cells = null;

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}
const grams = g => (g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${g} g`);

function slot(kind, j) {
  const d = node('div', `slot ${kind}${j ? '' : ' empty'}`);
  d.append(node('span', 'tag', t(kind)));
  if (!j) { d.append(node('span', 'what', kind === 'now' ? t('free') : t('nothingNext'))); return d; }
  d.append(node('b', 'cult', j.name));
  d.append(node('span', 'what', `${j.orderName || ''} · ${t(j.bag)} × ${j.bags}`));
  if (j.rawG) d.append(node('span', 'raw', tf('raw', { g: grams(j.rawG) })));
  if (j.sameAsNow) d.append(node('small', 'same', t('sameAsNow')));
  return d;
}

function render() {
  if (!cells) return;
  const rows = pullRows(cells);
  el.notice.hidden = true;
  if (!rows.length) { el.list.replaceChildren(node('p', 'empty', t('empty'))); return; }
  el.list.replaceChildren(...rows.map(r => {
    const row = node('article', 'row');
    row.dataset.cell = r.stationId;
    row.append(node('h2', 'cell', r.label), slot('now', r.now), slot('next', r.next));
    return row;
  }));
}

async function load() {
  try {
    const r = await fetch(`${API}?action=cellQueue`, { cache: 'no-store' });
    const d = await r.json().catch(() => null);
    if (!r.ok) { el.notice.textContent = d && d.code === 'NOT_READY' ? t('notReady') : t('loadFail'); el.notice.hidden = false; return; }
    cells = d.cells || [];
    render();
  } catch { el.notice.textContent = t('loadFail'); el.notice.hidden = false; }
}

el.lang.addEventListener('click', () => {
  setLang(getLang() === 'en' ? 'es' : 'en');
  el.lang.textContent = getLang() === 'en' ? 'ES' : 'EN';
  render();
});
el.lang.textContent = getLang() === 'en' ? 'ES' : 'EN';
load();
setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
