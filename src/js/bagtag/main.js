/**
 * Bag/tag queue (design doc §2e, slice 1; Koa 2026-11-10: "Approve, start slice 1").
 * Today's open Shopify orders, first in first out with rush first, and where each
 * line goes: a cell (2026 Sungrown Tops), bagging (pool stock), pack (finished
 * goods), wholesale (stays on the wholesale queue) or ask (a custom line).
 *
 * Read-only in this slice: bag/tag still prints and assigns the way it does now.
 * The page shows order number, cultivar, form and bag size only; the Worker never
 * stores a buyer field, so there is none to show.
 *
 *   bagtag.html                                          the screen
 *   bagtag.html?api=http://localhost:8787/api/production local testing only
 */
import { registerLabels, setLang, getLang, t } from '../shared/i18n.js';
import { ageText, lineText, splitLists, routeCounts, syncAgeMin, whyText } from './view.mjs';

const PROD_API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production';
const POLL_MS = 30000;

registerLabels({
  en: {
    title: 'Bag/tag queue', board: 'Cells board', refresh: 'Refresh', toStart: 'To start', inCells: 'In cells', ready: 'Ready to check',
    readOnly: 'Read-only for now: print and assign the way you do today. This screen shows the order, oldest first, rush on top.',
    notConfigured: 'Shopify is not connected yet. The queue fills in once the Shopify app is set up.',
    empty: 'No open orders. Everything is out.', loadFail: 'No connection to the server. Retrying…',
    notReady: 'The order queue is not set up on the server yet.',
    synced: 'Synced {m} min ago', syncedNow: 'Synced just now', neverSynced: 'Not synced yet', syncErr: 'Last Shopify sync failed: {e}',
    tooSoon: 'Just synced. Try again in a few seconds.', refreshing: 'Checking Shopify…',
    rush: 'RUSH', carried: 'Carried over', changed: 'Changed in Shopify', waiting: 'waiting {a}',
    rCell: 'Cell', rBagging: 'Bagging', rPack: 'Pack', rWholesale: 'Wholesale', rAsk: 'Ask',
    countLine: '{n} orders · {r} rush', doneToday: '{n} fulfilled today',
  },
  es: {
    title: 'Cola de empaque', board: 'Tablero de celdas', refresh: 'Actualizar', toStart: 'Por empezar', inCells: 'En celdas', ready: 'Listo para revisar',
    readOnly: 'Solo lectura por ahora: imprima y asigne como hoy. Esta pantalla muestra el orden, el más viejo primero, urgentes arriba.',
    notConfigured: 'Shopify todavía no está conectado. La cola se llena cuando la app de Shopify esté lista.',
    empty: 'No hay órdenes abiertas. Todo salió.', loadFail: 'No hay conexión con el servidor. Reintentando…',
    notReady: 'La cola de órdenes todavía no está lista en el servidor.',
    synced: 'Sincronizado hace {m} min', syncedNow: 'Sincronizado ahora', neverSynced: 'Sin sincronizar', syncErr: 'Falló la última sincronización con Shopify: {e}',
    tooSoon: 'Se acaba de sincronizar. Intente en unos segundos.', refreshing: 'Revisando Shopify…',
    rush: 'URGENTE', carried: 'De ayer', changed: 'Cambió en Shopify', waiting: 'esperando {a}',
    rCell: 'Celda', rBagging: 'Empaque', rPack: 'Empacar', rWholesale: 'Mayoreo', rAsk: 'Preguntar',
    countLine: '{n} órdenes · {r} urgentes', doneToday: '{n} completadas hoy',
  },
});
const tf = (key, vars = {}) => t(key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
const ROUTE_KEY = { cell: 'rCell', bagging: 'rBagging', pack: 'rPack', wholesale: 'rWholesale', ask: 'rAsk' };

const params = new URLSearchParams(location.search);
const apiParam = params.get('api') || '';
const API = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(apiParam) ? apiParam : PROD_API;

const $ = id => document.getElementById(id);
const el = {
  lang: $('langToggle'), refresh: $('refreshBtn'), sync: $('syncLine'), notice: $('notice'), info: $('info'),
  counts: $('counts'), toStart: $('toStart'), inCells: $('inCells'), ready: $('ready'),
  inCellsSec: $('inCellsSec'), readySec: $('readySec'), boardLink: $('boardLink'),
};
if (API !== PROD_API) el.boardLink.href = `cells.html?api=${encodeURIComponent(API)}`;

let last = null;
let skew = 0;   // server clock - this clock

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

function card(o, now) {
  const c = node('article', `order${o.rush ? ' rush' : ''}`);
  c.dataset.order = o.name;
  const head = node('div', 'order-head');
  head.append(node('span', 'fifo', String(o.fifo)), node('b', 'name', o.name));
  if (o.rush) { const r = node('span', 'badge rush', t('rush')); if (o.rushWhy) r.title = o.rushWhy; head.append(r); }
  if (o.carriedOver) head.append(node('span', 'badge carried', t('carried')));
  if (o.changedInShopify) head.append(node('span', 'badge changed', t('changed')));
  head.append(node('span', 'age', tf('waiting', { a: ageText(o.placedAt, now) })));
  c.append(head);
  const ul = node('ul', 'lines');
  for (const l of o.lines) {
    const li = node('li', `line r-${l.route}`);
    li.append(node('span', `route r-${l.route}`, t(ROUTE_KEY[l.route] || 'rAsk')), node('span', 'what', lineText(l)));
    if (l.why) li.append(node('small', 'why', whyText(l.why, getLang())));
    ul.append(li);
  }
  c.append(ul);
  return c;
}

function fill(container, orders, now) {
  container.replaceChildren(...orders.map(o => card(o, now)));
}

function render() {
  if (!last) return;
  const now = Date.now() + skew;
  const { toStart, inCells, ready } = splitLists(last.orders);
  el.notice.hidden = true;
  el.info.textContent = last.configured ? t('readOnly') : t('notConfigured');
  el.info.className = `notice ${last.configured ? 'ok' : 'warn'}`;
  const age = syncAgeMin(last.sync, now);
  el.sync.textContent = last.sync && last.sync.lastError
    ? tf('syncErr', { e: last.sync.lastError })
    : age === null ? t('neverSynced') : age < 1 ? t('syncedNow') : tf('synced', { m: age });
  el.sync.classList.toggle('bad', !!(last.sync && last.sync.lastError));
  const rc = routeCounts(toStart);
  el.counts.replaceChildren(
    node('span', 'count', tf('countLine', { n: toStart.length, r: toStart.filter(o => o.rush).length })),
    ...Object.entries(rc).filter(([, n]) => n).map(([r, n]) => node('span', `route r-${r}`, `${t(ROUTE_KEY[r])} ${n}`)),
    node('span', 'count muted', tf('doneToday', { n: last.fulfilledToday || 0 })),
  );
  if (!toStart.length) el.toStart.replaceChildren(node('p', 'empty', last.configured ? t('empty') : ''));
  else fill(el.toStart, toStart, now);
  el.inCellsSec.hidden = !inCells.length;
  el.readySec.hidden = !ready.length;
  fill(el.inCells, inCells, now);
  fill(el.ready, ready, now);
}

function showNotice(msg) {
  el.notice.textContent = msg;
  el.notice.hidden = false;
}

async function take(res) {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    showNotice(body && body.code === 'NOT_READY' ? t('notReady') : t('loadFail'));
    return;
  }
  last = body;
  if (body && body.serverNow) skew = body.serverNow - Date.now();
  render();
  return body;
}

async function load() {
  try { await take(await fetch(`${API}?action=orderQueue`, { cache: 'no-store' })); } catch { showNotice(t('loadFail')); }
}

async function refresh() {
  el.refresh.disabled = true;
  el.sync.textContent = t('refreshing');
  try {
    const body = await take(await fetch(`${API}?action=orderSync`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}',
    }));
    if (body && body.refresh && body.refresh.skipped === 'too-soon') el.sync.textContent = t('tooSoon');
  } catch { showNotice(t('loadFail')); }
  el.refresh.disabled = false;
}

el.refresh.addEventListener('click', refresh);
el.lang.addEventListener('click', () => {
  setLang(getLang() === 'en' ? 'es' : 'en');
  el.lang.textContent = getLang() === 'en' ? 'ES' : 'EN';
  render();
});
el.lang.textContent = getLang() === 'en' ? 'ES' : 'EN';

load();
setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
setInterval(render, 60000);   // ages tick between polls
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
