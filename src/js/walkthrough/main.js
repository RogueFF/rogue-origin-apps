/**
 * Floor walkthrough (demo.html; Koa 2026-11-11: "I don't want them trimming live
 * orders, I was just talking about seeing how it would look/flow digitally").
 *
 * One page, every station side by side, a mock day playing at 1x / 10x / 60x:
 * bag/tag queue -> the stand-in auto-assign -> each cell's NOW / NEXT with the
 * chime, the basket swap and the pickup spot -> the water spider's pull list ->
 * Collected -> shipped in Shopify. Everything runs in this browser tab
 * (walkthrough/sim.mjs): no Worker, no database, no network, and fetch is
 * guarded so a call to the live system throws (walkthrough/guard.mjs).
 */
import { guardFetch } from './guard.mjs';
import { createSim, tally } from './sim.mjs';
import { generateDay, parseShopifyExport, replayDay } from '../demo/orders.mjs';
import { rawFor, shortName } from '../pull/view.mjs';
import { bagLabel } from '../bagtag/view.mjs';
import { registerLabels, setLang, getLang, t } from '../shared/i18n.js';

window.fetch = guardFetch(window.fetch.bind(window));

const FRAME_MS = 250;
registerLabels({
  en: {
    title: 'Floor walkthrough', badge: 'DEMO · a mock day, nothing live', play: 'Play', pause: 'Pause', newDay: 'New day',
    day: 'Day', variation: 'Variation', csv: 'Replay a Shopify export (CSV)', bagtag: 'Bag/tag', cells: 'Cells', spider: 'Water spider: pull list',
    feed: 'What just happened', toStart: 'To start', inCells: 'In cells', atSpot: 'At a pickup spot', toShip: 'Collected: weigh, box, ship', shipped: 'Shipped',
    toArrive: 'still to arrive', now: 'NOW', next: 'NEXT', free: 'Free', spot: 'Pickup spot', trimming: 'Trimming', full: 'FULL · chime', swap: 'Swap',
    idle: 'Waiting for an order', basket: 'basket {n} of {m}', raw: '~{g} raw', same: 'same cultivar: may be at the cell',
    stand: 'Who goes where: the stand-in auto-assign (first free cell; same cultivar only breaks a tie). On the floor this is Nathan\'s scheduler.',
    rush: 'RUSH', loaded: '{n} mock orders ({c} with cell work, {r} rush).', csvRead: '{n} orders read from the export.', fail: 'Couldn\'t read that: {e}',
    none: 'nothing here',
  },
  es: {
    title: 'Recorrido del piso', badge: 'DEMO · un día de prueba, nada en vivo', play: 'Reproducir', pause: 'Pausar', newDay: 'Nuevo día',
    day: 'Día', variation: 'Variación', csv: 'Repetir una exportación de Shopify (CSV)', bagtag: 'Empaque', cells: 'Celdas', spider: 'Water spider: lista de surtido',
    feed: 'Lo que acaba de pasar', toStart: 'Por empezar', inCells: 'En celdas', atSpot: 'En recogida', toShip: 'Recogidas: pesar, empacar, enviar', shipped: 'Enviadas',
    toArrive: 'por llegar', now: 'AHORA', next: 'SIGUIENTE', free: 'Libre', spot: 'Recogida', trimming: 'Recortando', full: 'LLENA · campana', swap: 'Cambio',
    idle: 'Esperando una orden', basket: 'canasta {n} de {m}', raw: '~{g} de crudo', same: 'misma variedad: puede estar en la celda',
    stand: 'Quién va a dónde: el asignador de prueba (primera celda libre; la variedad solo desempata). En el piso lo hará el programador de Nathan.',
    rush: 'URGENTE', loaded: '{n} órdenes de prueba ({c} con trabajo de celda, {r} urgentes).', csvRead: '{n} órdenes leídas de la exportación.', fail: 'No se pudo leer: {e}',
    none: 'nada aquí',
  },
});
const tf = (k, v = {}) => t(k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');
const $ = id => document.getElementById(id);

let sim = null;
let speed = 10;
let playing = true;
let lastReal = performance.now();
let exported = [];

const clock = ms => new Date(ms).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' });
const grams = g => (g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${Math.round(g)} g`);
function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

function load(day) {
  sim = createSim(day);
  const withCell = day.orders.filter(o => o.lines.some(l => l.options && l.options['Flower Type'] === 'Tops')).length;
  $('msg').textContent = tf('loaded', { n: day.orders.length, c: withCell, r: day.orders.filter(o => o.rush).length });
  render();
}

function orderRow(o) {
  const r = node('div', `o${o.rush ? ' rush' : ''}`);
  r.append(node('b', null, o.name));
  if (o.rush) r.append(node('span', 'tag rush', t('rush')));
  const cellLines = o.lines.filter(l => l.route === 'cell');
  r.append(node('span', 'what', o.lines.map(l => `${shortName(l.cultivar)} ${bagLabel(l.bag)} ×${l.qty}`).join(', ')));
  if (o.cell) r.append(node('span', 'tag at-cell', o.cell.replace('table', 'Cell ')));
  else if (!cellLines.length) r.append(node('span', 'tag pool', 'pool'));
  return r;
}

function list(title, orders, cls) {
  const box = node('div', `list ${cls || ''}`);
  box.append(node('h3', null, `${title} · ${orders.length}`));
  if (!orders.length) box.append(node('p', 'none', t('none')));
  for (const o of orders.slice(0, 8)) box.append(orderRow(o));
  if (orders.length > 8) box.append(node('p', 'none', `+${orders.length - 8}`));
  return box;
}

function renderBagtag(s) {
  const by = f => s.orders.filter(f);
  $('bagtag').replaceChildren(
    list(t('toStart'), by(o => ['queued', 'assigned', 'trimming'].includes(o.state) && !o.confirmedAt)),
    list(t('inCells'), by(o => ['queued', 'assigned', 'trimming'].includes(o.state) && o.confirmedAt)),
    list(t('atSpot'), by(o => o.state === 'ready' && !o.collectedAt), 'spot'),
    list(t('toShip'), by(o => o.state === 'ready' && o.collectedAt), 'ship'),
  );
}

function renderCells(s) {
  $('cells').replaceChildren(...s.cells.map(c => {
    const j = c.jobs[0];
    const card = node('article', `cell ${c.phase}${c.chimeAt && s.simMs - c.chimeAt < 60000 ? ' chime' : ''}`);
    const head = node('div', 'head');
    head.append(node('b', null, c.label), node('span', 'phase', j ? t(c.phase === 'full' ? 'full' : c.phase === 'swap' ? 'swap' : 'trimming') : t('free')));
    card.append(head);
    const now = node('div', 'now');
    if (j) {
      const frac = Math.min(1, c.grams / j.targetG);
      now.append(node('span', 'lbl', t('now')), node('b', 'ord', j.orderName),
        node('span', 'cult', `${shortName(j.cultivar)} · ${bagLabel(j.bag)} × ${j.bags}`),
        node('span', 'sub', j.baskets > 1 ? tf('basket', { n: j.basketNo, m: j.baskets }) : ''));
      const bar = node('div', 'bar'); const fill = node('i'); fill.style.width = `${Math.round(frac * 100)}%`; bar.append(fill);
      now.append(bar, node('span', 'g', `${grams(c.grams)} / ${grams(j.targetG)}`));
    } else now.append(node('span', 'idle', t('idle')));
    card.append(now);
    const n = c.jobs[1];
    card.append(node('div', 'next', n ? `${t('next')}: ${n.orderName} · ${shortName(n.cultivar)} ${bagLabel(n.bag)} × ${n.bags}` : `${t('next')}: —`));
    const spot = node('div', 'spotrow');
    spot.append(node('span', 'lbl', `🧺 ${t('spot')}`));
    for (const b of c.spot) spot.append(node('span', 'basket', `${b.orderName} ${bagLabel(b.bag)}×${b.bags}`));
    card.append(spot);
    return card;
  }));
}

function renderSpider(s) {
  $('spider').replaceChildren(...s.cells.map(c => {
    const r = node('div', 'pull');
    r.append(node('b', null, c.label));
    for (const [k, j] of [['now', c.jobs[0]], ['next', c.jobs[1]]]) {
      const p = node('span', `p ${k}`);
      if (!j) p.textContent = `${t(k)}: —`;
      else {
        const same = k === 'next' && c.jobs[0] && c.jobs[0].cultivar === j.cultivar;
        p.textContent = `${t(k)}: ${shortName(j.cultivar)} ${tf('raw', { g: grams(rawFor(j) || 0) })}${same ? ` (${t('same')})` : ''}`;
      }
      r.append(p);
    }
    return r;
  }));
}

function render() {
  if (!sim) return;
  const s = sim.state;
  $('clock').textContent = clock(s.simMs);
  const k = tally(s);
  $('tally').textContent = `${k.toArrive} ${t('toArrive')} · ${t('shipped')} ${k.shipped}`;
  renderBagtag(s);
  renderCells(s);
  renderSpider(s);
  $('feed').replaceChildren(...s.events.slice(0, 14).map(e => {
    const li = node('li');
    li.append(node('time', null, new Date(e.at).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' })), document.createTextNode(` ${e.text}`));
    return li;
  }));
  $('play').textContent = playing ? t('pause') : t('play');
  for (const b of document.querySelectorAll('.speed button')) b.classList.toggle('on', Number(b.dataset.v) === speed);
}

function frame() {
  const nowReal = performance.now();
  const dt = Math.min(nowReal - lastReal, 1000);
  lastReal = nowReal;
  if (sim && playing) sim.step(dt * speed);
  render();
}

function labels() {
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  render();
}

const todayPacific = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
$('day').value = todayPacific();
$('newDay').addEventListener('click', () => load(generateDay({ day: $('day').value, seed: Number($('seed').value) || 1 })));
$('play').addEventListener('click', () => { playing = !playing; render(); });
for (const b of document.querySelectorAll('.speed button')) b.addEventListener('click', () => { speed = Number(b.dataset.v); render(); });
$('csv').addEventListener('change', async () => {
  const f = $('csv').files[0];
  if (!f) return;
  try {
    exported = parseShopifyExport(await f.text());
    $('msg').textContent = tf('csvRead', { n: exported.length });
    load(replayDay(exported, $('day').value));
  } catch (e) { $('msg').textContent = tf('fail', { e: e.message }); }
});
$('langToggle').addEventListener('click', () => { setLang(getLang() === 'en' ? 'es' : 'en'); $('langToggle').textContent = getLang() === 'en' ? 'ES' : 'EN'; labels(); });
$('langToggle').textContent = getLang() === 'en' ? 'ES' : 'EN';
labels();
load(generateDay({ day: $('day').value, seed: 1 }));
setInterval(frame, FRAME_MS);
