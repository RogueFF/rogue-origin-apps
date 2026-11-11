/**
 * Bag/tag queue (design doc §2e). Today's open Shopify orders, first in first out
 * with rush first, and where each line goes: a cell (2026 Sungrown Tops), bagging
 * (pool stock), pack (finished goods), wholesale (stays on the wholesale queue) or
 * ask (a custom line: bag/tag picks).
 *
 * Slice 2 (Koa 2026-11-11: "automatic order assignment"): the Worker puts every
 * order on a cell by itself and keeps each cell's NOW and NEXT filled. Bag/tag
 * doesn't pick the cell; its one click is Confirm (slice 4 adds the printing to
 * it). It can still move an order, hold it, tap Basket done for a cell with no
 * scale, and tap Collected when it takes the baskets from a cell's pickup spot.
 *
 * The page shows order number, cultivar, form and bag size only; the Worker never
 * stores a buyer field, so there is none to show.
 *
 *   bagtag.html                                          the screen
 *   bagtag.html?api=http://localhost:8787/api/production local testing only
 */
import { registerLabels, setLang, getLang, t } from '../shared/i18n.js';
import { ageText, lineText, splitLists, routeCounts, syncAgeMin, whyText, cellLine } from './view.mjs';

const PROD_API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production';
const POLL_MS = 15000;

registerLabels({
  en: {
    title: 'Bag/tag queue', board: 'Cells board', pull: 'Pull list', refresh: 'Refresh', toStart: 'To start', inCells: 'In cells', ready: 'Ready to check',
    info: 'Orders go to a cell by themselves. Confirm each one when its papers are out (oldest first, rush on top).',
    notConfigured: 'Shopify is not connected yet. The queue fills in once the Shopify app is set up.',
    empty: 'No open orders. Everything is out.', loadFail: 'No connection to the server. Retrying…',
    notReady: 'The order queue is not set up on the server yet.',
    synced: 'Synced {m} min ago', syncedNow: 'Synced just now', neverSynced: 'Not synced yet', syncErr: 'Last Shopify sync failed: {e}',
    tooSoon: 'Just synced. Try again in a few seconds.', refreshing: 'Checking Shopify…',
    rush: 'RUSH', carried: 'Carried over', changed: 'Changed in Shopify', waiting: 'waiting {a}',
    rCell: 'Cell', rBagging: 'Bagging', rPack: 'Pack', rWholesale: 'Wholesale', rAsk: 'Ask',
    countLine: '{n} to start · {r} rush', doneToday: '{n} fulfilled today',
    atCell: '{cell} · {slot}', slotNOW: 'NOW', slotNEXT: 'NEXT', baskets: '{d} of {b} baskets done',
    waitingCell: 'Waiting for a cell · {cell} frees a slot in ~{m} min', noCell: 'Waiting for a cell',
    bagOnly: 'No cell work: pull from the pools', confirm: 'Confirm', confirmed: 'Confirmed',
    move: 'Move to…', hold: 'Hold', release: 'Release', held: 'ON HOLD',
    basketDone: 'Basket done', collected: 'Collected', atSpot: 'At {cell}\'s pickup spot',
    pickRoute: 'Where does it go?', toBagging: 'Bagging', toPack: 'Pack',
    readyCheck: 'Collected · check-weigh comes next', now: 'NOW', next: 'NEXT', spot: '{n} at spot', free: 'free', cells: 'Cells',
    whySame: 'same cultivar: no changeover', whyMixed: 'already running one of its cultivars', whyFree: 'cell is free',
    whySoonest: 'frees up soonest', whyMoved: 'moved by bag/tag', failed: 'That didn\'t save: {e}',
  },
  es: {
    title: 'Cola de empaque', board: 'Tablero de celdas', pull: 'Lista de surtido', refresh: 'Actualizar', toStart: 'Por empezar', inCells: 'En celdas', ready: 'Listo para revisar',
    info: 'Las órdenes van solas a una celda. Confirme cada una cuando salgan sus papeles (la más vieja primero, urgentes arriba).',
    notConfigured: 'Shopify todavía no está conectado. La cola se llena cuando la app de Shopify esté lista.',
    empty: 'No hay órdenes abiertas. Todo salió.', loadFail: 'No hay conexión con el servidor. Reintentando…',
    notReady: 'La cola de órdenes todavía no está lista en el servidor.',
    synced: 'Sincronizado hace {m} min', syncedNow: 'Sincronizado ahora', neverSynced: 'Sin sincronizar', syncErr: 'Falló la última sincronización con Shopify: {e}',
    tooSoon: 'Se acaba de sincronizar. Intente en unos segundos.', refreshing: 'Revisando Shopify…',
    rush: 'URGENTE', carried: 'De ayer', changed: 'Cambió en Shopify', waiting: 'esperando {a}',
    rCell: 'Celda', rBagging: 'Empaque', rPack: 'Empacar', rWholesale: 'Mayoreo', rAsk: 'Preguntar',
    countLine: '{n} por empezar · {r} urgentes', doneToday: '{n} completadas hoy',
    atCell: '{cell} · {slot}', slotNOW: 'AHORA', slotNEXT: 'SIGUIENTE', baskets: '{d} de {b} canastas listas',
    waitingCell: 'Esperando celda · {cell} libera un lugar en ~{m} min', noCell: 'Esperando celda',
    bagOnly: 'Sin trabajo de celda: sacar del inventario', confirm: 'Confirmar', confirmed: 'Confirmada',
    move: 'Mover a…', hold: 'Pausar', release: 'Soltar', held: 'EN PAUSA',
    basketDone: 'Canasta lista', collected: 'Recogida', atSpot: 'En el lugar de recogida de {cell}',
    pickRoute: '¿A dónde va?', toBagging: 'Empaque', toPack: 'Empacar',
    readyCheck: 'Recogida · sigue pesar y revisar', now: 'AHORA', next: 'SIGUIENTE', spot: '{n} en recogida', free: 'libre', cells: 'Celdas',
    whySame: 'misma variedad: sin cambio', whyMixed: 'ya trabaja una de sus variedades', whyFree: 'la celda está libre',
    whySoonest: 'se libera primero', whyMoved: 'movida por empaque', failed: 'No se guardó: {e}',
  },
});
const tf = (key, vars = {}) => t(key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
const ROUTE_KEY = { cell: 'rCell', bagging: 'rBagging', pack: 'rPack', wholesale: 'rWholesale', ask: 'rAsk' };
const WHY_KEY = {
  'same cultivar: no changeover': 'whySame', 'already running one of its cultivars': 'whyMixed',
  'cell is free': 'whyFree', 'frees up soonest': 'whySoonest', 'moved by bag/tag': 'whyMoved',
};

const params = new URLSearchParams(location.search);
const apiParam = params.get('api') || '';
const API = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(apiParam) ? apiParam : PROD_API;

const $ = id => document.getElementById(id);
const el = {
  lang: $('langToggle'), refresh: $('refreshBtn'), sync: $('syncLine'), notice: $('notice'), info: $('info'),
  counts: $('counts'), toStart: $('toStart'), inCells: $('inCells'), ready: $('ready'), cells: $('cellStrip'),
  inCellsSec: $('inCellsSec'), readySec: $('readySec'), boardLink: $('boardLink'), pullLink: $('pullLink'),
};
if (API !== PROD_API) {
  el.boardLink.href = `cells.html?api=${encodeURIComponent(API)}`;
  el.pullLink.href = `pull.html?api=${encodeURIComponent(API)}`;
}

let last = null;
let cellsNow = [];   // cellQueue: every order-taking cell's NOW / NEXT / pickup spot
let skew = 0;        // server clock - this clock
let busy = false;

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}
function button(cls, text, onClick) {
  const b = node('button', `btn ${cls}`, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

async function post(action, body) {
  if (busy) return;
  busy = true;
  try {
    const r = await fetch(`${API}?action=${action}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => null);
    if (!r.ok) showNotice(tf('failed', { e: (d && (d.error || d.message)) || r.status }));
  } catch { showNotice(t('loadFail')); }
  busy = false;
  await load();
}
const act = (orderId, op, extra = {}) => post('orderAction', { orderId, op, ...extra });

function cellInfo(o) {
  const c = cellLine(o);
  const p = node('p', `cell-line k-${c.kind}`);
  if (c.kind === 'bagOnly') p.textContent = t('bagOnly');
  else if (c.kind === 'none') p.textContent = t('noCell');
  else if (c.kind === 'waiting') p.textContent = tf('waitingCell', { cell: c.label, m: c.inMin ?? '?' });
  else {
    p.append(node('b', null, tf('atCell', { cell: c.label, slot: c.slot ? t(`slot${c.slot}`) : '' })));
    if (c.why) p.append(node('span', 'why', ` · ${WHY_KEY[c.why] ? t(WHY_KEY[c.why]) : c.why}`));
    if (c.baskets) p.append(node('span', 'prog', ` · ${tf('baskets', { d: c.done, b: c.baskets })}`));
  }
  return p;
}

function actions(o, list) {
  const row = node('div', 'actions');
  if (list === 'toStart') {
    if (o.state === 'hold') {
      row.append(button('ghost', t('release'), () => act(o.id, 'release')));
      return row;
    }
    row.append(button('primary', t('confirm'), () => act(o.id, 'confirm')));
    if (o.cell && !o.cell.waiting && !o.cell.started && cellsNow.length > 1) row.append(moveSelect(o));
    row.append(button('ghost', t('hold'), () => act(o.id, 'hold')));
  } else if (list === 'inCells') {
    if (o.state === 'ready') {
      row.append(node('span', 'spot', tf('atSpot', { cell: o.cell ? o.cell.label : '' })));
      row.append(button('primary', t('collected'), () => act(o.id, 'collected')));
    } else if (o.cell && !o.cell.scale && o.cell.nowJobId) {
      row.append(button('ghost', t('basketDone'), () => post('jobDone', { jobId: o.cell.nowJobId })));
    }
  }
  return row;
}

function moveSelect(o) {
  const s = node('select', 'move');
  s.append(node('option', null, t('move')));
  s.firstChild.value = '';
  for (const c of cellsNow) {
    if (c.stationId === o.cell.stationId) continue;
    const opt = node('option', null, c.label);
    opt.value = c.stationId;
    s.append(opt);
  }
  s.addEventListener('change', () => { if (s.value) act(o.id, 'move', { stationId: s.value }); });
  return s;
}

function card(o, now, list) {
  const c = node('article', `order${o.rush ? ' rush' : ''}${o.state === 'hold' ? ' held' : ''}`);
  c.dataset.order = o.name;
  const head = node('div', 'order-head');
  head.append(node('span', 'fifo', String(o.fifo)), node('b', 'name', o.name));
  if (o.rush) { const r = node('span', 'badge rush', t('rush')); if (o.rushWhy) r.title = o.rushWhy; head.append(r); }
  if (o.state === 'hold') head.append(node('span', 'badge held', t('held')));
  if (o.carriedOver) head.append(node('span', 'badge carried', t('carried')));
  if (o.changedInShopify) head.append(node('span', 'badge changed', t('changed')));
  if (o.confirmedAt) head.append(node('span', 'badge ok', t('confirmed')));
  head.append(node('span', 'age', tf('waiting', { a: ageText(o.placedAt, now) })));
  c.append(head);
  const ul = node('ul', 'lines');
  for (const l of o.lines) {
    const li = node('li', `line r-${l.route}`);
    li.append(node('span', `route r-${l.route}`, t(ROUTE_KEY[l.route] || 'rAsk')), node('span', 'what', lineText(l)));
    if (l.why) li.append(node('small', 'why', whyText(l.why, getLang())));
    if (l.route === 'ask' && list === 'toStart') {
      const pick = node('div', 'pick');
      pick.append(node('small', null, t('pickRoute')),
        button('ghost', t('toBagging'), () => act(o.id, 'route', { lineId: l.id, route: 'bagging' })),
        button('ghost', t('toPack'), () => act(o.id, 'route', { lineId: l.id, route: 'pack' })));
      li.append(pick);
    }
    ul.append(li);
  }
  c.append(ul);
  if (list !== 'ready') c.append(cellInfo(o));
  else c.append(node('p', 'cell-line', t('readyCheck')));
  const a = actions(o, list);
  if (a.childNodes.length) c.append(a);
  return c;
}

function fill(container, orders, now, list) {
  container.replaceChildren(...orders.map(o => card(o, now, list)));
}

function renderCells() {
  el.cells.replaceChildren(...cellsNow.filter(c => c.takesOrders || c.now).map(c => {
    const d = node('div', 'cell-chip');
    d.append(node('b', null, c.label));
    d.append(node('span', null, `${t('now')} ${c.now ? c.now.orderName : t('free')}`));
    d.append(node('span', 'muted', `${t('next')} ${c.nextOrder ? c.nextOrder.orderName : '—'}`));
    const n = c.atSpot.reduce((s, x) => s + x.baskets, 0);
    if (n) d.append(node('span', 'spot', tf('spot', { n })));
    return d;
  }));
}

function render() {
  if (!last) return;
  const now = Date.now() + skew;
  const { toStart, inCells, ready } = splitLists(last.orders);
  el.notice.hidden = true;
  el.info.textContent = last.configured ? t('info') : t('notConfigured');
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
  renderCells();
  if (!toStart.length) el.toStart.replaceChildren(node('p', 'empty', last.configured ? t('empty') : ''));
  else fill(el.toStart, toStart, now, 'toStart');
  el.inCellsSec.hidden = !inCells.length;
  el.readySec.hidden = !ready.length;
  fill(el.inCells, inCells, now, 'inCells');
  fill(el.ready, ready, now, 'ready');
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

async function loadCells() {
  try {
    const r = await fetch(`${API}?action=cellQueue`, { cache: 'no-store' });
    if (r.ok) cellsNow = (await r.json()).cells || [];
  } catch { /* the queue still shows */ }
}

async function load() {
  try {
    const [q] = await Promise.all([fetch(`${API}?action=orderQueue`, { cache: 'no-store' }), loadCells()]);
    await take(q);
  } catch { showNotice(t('loadFail')); }
}

async function refresh() {
  el.refresh.disabled = true;
  el.sync.textContent = t('refreshing');
  try {
    const body = await take(await fetch(`${API}?action=orderSync`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}',
    }));
    await loadCells();
    render();
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
setInterval(() => { if (!document.hidden && !busy) load(); }, POLL_MS);
setInterval(render, 60000);   // ages tick between polls
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
