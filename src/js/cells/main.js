/**
 * Cells board: what every cell's screen is doing, on any other computer
 * (Koa 2026-11-09: "once everything renders on the cell 1 tablet, id like to see
 * it pop up on other's computers"). For the bagging/fulfillment computer and the
 * office: one tile per cell with its order, live weight, progress and clock, and
 * a "ready for pickup" pop-up with a chime when a cell finishes a bag.
 *
 * Two weight-matched baskets per cell (Koa 2026-11-11): at the chime the trimmer
 * moves the full basket to the pickup spot beside the cell and sets the empty one
 * on, which closes the job. The pop-up then turns into "waiting at pickup spot"
 * and stays until bag/tag taps Collected (?action=collectPickup, migration 0060),
 * with a short Undo for a wrong tap.
 *
 *   cells.html                      all cells
 *   cells.html?api=http://localhost:8799/api/production   local testing only
 *
 * Reads ?action=cellBoard every 2 s while visible. The cell tablets report their
 * jobs (setCellState); the weights come from the scales. Clocks tick from the
 * Worker's time, so a computer with a wrong clock still shows the right time.
 */
import { registerLabels, setLang, getLang, t } from '../shared/i18n.js';

const PROD_API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production';
const POLL_MS = 2000;
const REMIND_MS = 120000;   // a bag still waiting: chime again every 2 min
const NEAR = 0.9;

const BATT_LOW_PCT = 20;   // red on the tile; Koa gets a Telegram under 15%

registerLabels({
  en: {
    title: 'Cells', rawLink: 'Raw hand-out', queueLink: 'Bag/tag queue', pullLink: 'Pull list', soundOn: '🔔 Tap to turn sound on', ready: 'Ready for pickup', waiting: 'waiting',
    idle: 'Idle', armed: 'Ready', running: 'Filling', paused: 'Paused', finished: 'Ready for pickup',
    down: 'Scale disconnected', offline: 'Tablet off', noOrder: 'No order picked', of: 'of',
    notrec: 'NOT RECORDING', noScreen: 'trimming, no cell screen open', tabletOff: 'trimming, tablet not reporting', noJob: 'trimming, no job started',
    atSpot: 'At pickup spot', collected: 'Collected ✓', undo: 'Undo', collectedMsg: 'Collected: {cell}', spotCount: '🧺 {n} at pickup spot',
    collectFail: 'Could not mark it collected. Try again.',
    retail: 'retail', notOnScreen: 'Not on a screen yet', loadFail: 'Can\'t reach the server. Retrying…',
    cellsLive: '{n} cell(s) on a screen', ago: '{m} min ago', justNow: 'just now', startsAt: 'starts on the first gram',
    qOz: '¼ oz', hOz: '½ oz', oz1: '1 oz', qLb: '¼ lb', hLb: '½ lb', lb1: '1 lb', cont: 'Continuous', roundN: 'round {n}',
    qNow: 'NOW', qNext: 'NEXT', orderReady: 'Order ready', atSpotOf: 'at {cell}’s pickup spot · {n} basket(s)',
  },
  es: {
    title: 'Celdas', rawLink: 'Entrega de crudo', queueLink: 'Cola de empaque', pullLink: 'Lista de surtido', soundOn: '🔔 Toque para activar el sonido', ready: 'Listo para recoger', waiting: 'esperando',
    idle: 'Sin trabajo', armed: 'Lista', running: 'Llenando', paused: 'En pausa', finished: 'Listo para recoger',
    down: 'Báscula desconectada', offline: 'Tableta apagada', noOrder: 'Sin orden', of: 'de',
    notrec: 'NO SE GRABA', noScreen: 'recortando, sin pantalla abierta', tabletOff: 'recortando, la tableta no reporta', noJob: 'recortando, sin trabajo iniciado',
    atSpot: 'En el punto de recogida', collected: 'Recogido ✓', undo: 'Deshacer', collectedMsg: 'Recogido: {cell}', spotCount: '🧺 {n} en el punto de recogida',
    collectFail: 'No se pudo marcar como recogido. Intente otra vez.',
    retail: 'menudeo', notOnScreen: 'Todavía sin pantalla', loadFail: 'No hay conexión con el servidor. Reintentando…',
    cellsLive: '{n} celda(s) con pantalla', ago: 'hace {m} min', justNow: 'ahora', startsAt: 'empieza con el primer gramo',
    qOz: '¼ oz', hOz: '½ oz', oz1: '1 oz', qLb: '¼ lb', hLb: '½ lb', lb1: '1 lb', cont: 'Continuo', roundN: 'ronda {n}',
    qNow: 'AHORA', qNext: 'SIGUIENTE', orderReady: 'Orden lista', atSpotOf: 'en el lugar de recogida de {cell} · {n} canasta(s)',
  },
});
const tf = (key, vars) => t(key).replace(/\{(\w+)\}/g, (_, k) => vars[k]);

const params = new URLSearchParams(location.search);
const apiParam = params.get('api') || '';
const API = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(apiParam) ? apiParam : PROD_API;
if (API !== PROD_API) document.getElementById('rawLink').href = `rawout.html?api=${encodeURIComponent(API)}`;
if (API !== PROD_API) document.getElementById('queueLink').href = `bagtag.html?api=${encodeURIComponent(API)}`;
if (API !== PROD_API) document.getElementById('pullLink').href = `pull.html?api=${encodeURIComponent(API)}`;

const $ = id => document.getElementById(id);
const el = { pickups: $('pickups'), grid: $('grid'), quiet: $('quiet'), status: $('status'), sub: $('sub'), sound: $('soundBtn'), lang: $('langToggle') };

let cells = [];
let waiting = [];            // pickups at the pickup spot, not yet collected
const collecting = new Set();     // ids tapped Collected here, hidden until the server agrees
let undoBar = null, undoTimer = null;
// Orders at the cells (order flow slice 2, cellQueue): NOW / NEXT and baskets at each pickup spot.
const queues = new Map();   // stationId -> { now, next, nextOrder, atSpot }
const jobOrder = new Map(); // jobId -> { orderId, orderName, orderReady }: a waiting basket's order
const seenOrderReady = new Set();
let offsetMs = 0;            // Worker clock minus this computer's clock
const seenFinished = new Map();   // stationId -> finishedAt already chimed for
let lastChimeAt = 0;
const workerNow = () => Date.now() + offsetMs;

const fmtG = g => `${Number(g).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} g`;
const fmtTarget = g => `${Number(g).toLocaleString('en-US', { maximumFractionDigits: 2 })} g`;
function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
// "2026 - Sour Lifter / Sungrown" -> "Sour Lifter · Sungrown"
const shortCultivar = c => String(c || '').replace(/^\d{4}\s*-\s*/, '').replace(/\s*\/\s*/g, ' · ');
const cellNo = id => id.replace(/^\D+/, '');

// ---- sound: browsers need one tap first ----
let audio = null;
function unlock() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    el.sound.hidden = audio.state !== 'suspended' ? true : el.sound.hidden;
  } catch { audio = null; }
}
function chime() {
  if (!audio || audio.state !== 'running') return;
  try {
    const now = audio.currentTime;
    [[784, 0], [1047, 0.16], [1319, 0.32]].forEach(([hz, at]) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine'; o.frequency.value = hz;
      g.gain.setValueAtTime(0.0001, now + at);
      g.gain.exponentialRampToValueAtTime(0.5, now + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.5);
      o.connect(g).connect(audio.destination);
      o.start(now + at); o.stop(now + at + 0.55);
    });
    lastChimeAt = Date.now();
  } catch { /* no sound: the pop-up still shows */ }
}
document.addEventListener('pointerdown', () => { unlock(); if (audio && audio.state === 'running') el.sound.hidden = true; });

// ---- what each tile shows ----
function statusOf(c) {
  // Trimming with no job recorded (Worker, lib/untracked.js) outranks everything.
  if (c.notRecording) return 'notrec';
  const j = c.job;
  if (!j) return null;                                   // never on a screen
  if (!j.tabletOnline) return 'offline';
  if (c.scale && !c.scale.live && j.phase !== 'finished') return 'down';
  if (j.phase === 'running' && j.paused) return 'paused';
  return j.phase;                                        // idle, armed, running, finished
}
function clockOf(j) {
  if (!j) return null;
  if (j.clockStart != null) return workerNow() - j.clockStart;
  return j.clockMs;
}

// Elements are kept per cell and updated in place, so the pop-up doesn't
// replay its entrance and the bars don't restart on every tick.
// Put a node at a position, moving it only when it's out of place: moving a
// node restarts its animations.
function place(parent, node, i) {
  if (parent.children[i] !== node) parent.insertBefore(node, parent.children[i] || null);
}
const pickupEls = new Map();   // `${stationId}|${finishedAt}` -> card
const tileEls = new Map();     // stationId -> tile

function renderPickups() {
  const ready = cells.filter(c => statusOf(c) === 'finished').sort((a, b) => a.job.finishedAt - b.job.finishedAt);
  const keep = new Set();
  for (const c of ready) {
    const j = c.job;
    const key = `${c.stationId}|${j.finishedAt}`;
    keep.add(key);
    let card = pickupEls.get(key);
    if (!card) {
      card = document.createElement('div');
      card.className = 'pickup';
      card.innerHTML = '<div class="p-cell"></div><div class="p-what"><span class="w"></span><small></small></div><div class="p-tag"><span class="r"></span><small></small></div>';
      pickupEls.set(key, card);
    }
    card.querySelector('.p-cell').textContent = c.label;
    card.querySelector('.p-what .w').textContent = `${j.bag ? t(j.bag) : ''}${j.bag && j.cultivar ? ' · ' : ''}${shortCultivar(j.cultivar)}`;
    card.querySelector('.p-what small').textContent = `${j.finishedNetG != null ? fmtG(j.finishedNetG) : ''}${j.clockMs != null ? ` · ${fmtClock(j.clockMs)}` : ''}`;
    card.querySelector('.p-tag .r').textContent = t('ready');
    const mins = Math.floor((workerNow() - j.finishedAt) / 60000);
    card.querySelector('.p-tag small').textContent = mins < 1 ? t('justNow') : tf('ago', { m: mins });
    place(el.pickups, card, keep.size - 1);   // oldest first
  }
  // Then every basket waiting at the pickup spot, oldest first.
  const spot = waiting.filter(w => !collecting.has(w.id));
  for (const w of spot) {
    const key = `w|${w.id}`;
    keep.add(key);
    let card = pickupEls.get(key);
    if (!card) {
      card = document.createElement('div');
      card.className = 'pickup spot';
      card.innerHTML = '<div class="p-cell"></div><div class="p-what"><span class="w"></span><small></small></div><div class="p-tag"><span class="r"></span><small></small></div><button type="button" class="collect"></button>';
      card.querySelector('.collect').addEventListener('click', () => collect(w.id, w.label));
      pickupEls.set(key, card);
    }
    card.querySelector('.p-cell').textContent = w.label;
    // A basket of a queued order carries the order number; the last one says the order is ready (slice 2).
    const o = w.jobId ? jobOrder.get(w.jobId) : null;
    card.classList.toggle('order-ready', !!(o && o.orderReady));
    card.querySelector('.p-what .w').textContent = `${o && o.orderName ? `${o.orderName} · ` : ''}${w.bag ? t(w.bag) : ''}${w.bag && w.cultivar ? ' · ' : ''}${shortCultivar(w.cultivar)}`;
    card.querySelector('.p-what small').textContent = `${fmtG(w.g)}${w.cycleS ? ` · ${fmtClock(w.cycleS * 1000)}` : ''}`;
    card.querySelector('.p-tag .r').textContent = o && o.orderReady ? t('orderReady') : t('atSpot');
    const mins = Math.floor((workerNow() - w.at) / 60000);
    card.querySelector('.p-tag small').textContent = mins < 1 ? t('justNow') : tf('ago', { m: mins });
    card.querySelector('.collect').textContent = t('collected');
    place(el.pickups, card, keep.size - 1);
  }
  // Chime for a bag that just finished; again every 2 min while any still waits.
  let fresh = false;
  for (const c of ready) {
    if (seenFinished.get(c.stationId) !== c.job.finishedAt) { seenFinished.set(c.stationId, c.job.finishedAt); fresh = true; }
  }
  for (const id of [...seenFinished.keys()]) if (!ready.some(c => c.stationId === id)) seenFinished.delete(id);
  // A cell with no scale has no pickup marks, so its finished order gets one card here (slice 2):
  // bag/tag tapped Basket done for each basket. Scale cells use the basket cards above.
  const noScale = id => { const c = cells.find(x => x.stationId === id); return !(c && c.scale); };
  const orderReady = [...queues.values()].filter(q => noScale(q.stationId))
    .flatMap(q => (q.atSpot || []).filter(s => s.orderReady).map(s => ({ ...s, label: q.label })));
  for (const s of orderReady) {
    const key = `order|${s.orderId}`;
    keep.add(key);
    let card = pickupEls.get(key);
    if (!card) {
      card = document.createElement('div');
      card.className = 'pickup spot order-ready';
      card.innerHTML = '<div class="p-cell"></div><div class="p-what"><span class="w"></span><small></small></div><div class="p-tag"><span class="r"></span><small></small></div><button type="button" class="collect"></button>';
      card.querySelector('.collect').addEventListener('click', () => collectOrder(s.orderId));
      pickupEls.set(key, card);
    }
    card.querySelector('.p-cell').textContent = s.label;
    card.querySelector('.p-what .w').textContent = s.orderName || '';
    card.querySelector('.p-what small').textContent = tf('atSpotOf', { cell: s.label, n: s.baskets });
    card.querySelector('.p-tag .r').textContent = t('orderReady');
    card.querySelector('.collect').textContent = t('collected');
    const since = Date.parse(String(s.since).replace(' ', 'T') + 'Z');
    const mins = Number.isFinite(since) ? Math.floor((workerNow() - since) / 60000) : 0;
    card.querySelector('.p-tag small').textContent = mins < 1 ? t('justNow') : tf('ago', { m: mins });
    place(el.pickups, card, keep.size - 1);
    if (!seenOrderReady.has(s.orderId)) { seenOrderReady.add(s.orderId); fresh = true; }
  }
  for (const [key, card] of pickupEls) if (!keep.has(key)) { card.remove(); pickupEls.delete(key); }
  const count = ready.length + spot.length + orderReady.length;
  if (fresh || (count && Date.now() - lastChimeAt >= REMIND_MS)) chime();
  document.title = count ? `(${count}) ${t('title')} - Rogue Origin` : `${t('title')} - Rogue Origin`;
}

// A whole order from a cell with no scale (order flow slice 2): the same Collected as bag/tag's.
async function collectOrder(orderId) {
  try {
    const r = await fetch(`${API}?action=orderAction`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ orderId, op: 'collected' }) });
    if (!r.ok && r.status !== 409) throw new Error(String(r.status));
  } catch { el.status.textContent = t('collectFail'); }
  pollQueues(true);
}

async function postCollect(id, undo) {
  const r = await fetch(`${API}?action=collectPickup`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ id, undo }) });
  if (!r.ok && r.status !== 409) throw new Error(String(r.status));
}
// Bag/tag took the basket off the spot. It goes at once; Undo for a wrong tap.
async function collect(id, cellLabel) {
  collecting.add(id);
  render();
  try {
    await postCollect(id, false);
  } catch {
    collecting.delete(id);
    el.status.textContent = t('collectFail');
    render();
    return;
  }
  showUndo(id, cellLabel);
}
function showUndo(id, cellLabel) {
  if (!undoBar) {
    undoBar = document.createElement('div');
    undoBar.className = 'undo-bar';
    undoBar.innerHTML = '<span></span><button type="button" class="btn"></button>';
    document.body.appendChild(undoBar);
  }
  undoBar.querySelector('span').textContent = tf('collectedMsg', { cell: cellLabel });
  const btn = undoBar.querySelector('button');
  btn.textContent = t('undo');
  btn.onclick = async () => {
    undoBar.hidden = true;
    try { await postCollect(id, true); collecting.delete(id); } catch { el.status.textContent = t('collectFail'); }
    poll();
  };
  undoBar.hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { undoBar.hidden = true; }, 10000);
}

function tileFor(c) {
  let tile = tileEls.get(c.stationId);
  if (!tile) {
    tile = document.createElement('article');
    tile.innerHTML = `
      <div class="t-top"><div class="t-name"><span class="n"></span><small></small></div><span class="batt"></span><span class="pill"></span></div>
      <div class="t-order"><span class="o"></span><small></small></div>
      <div class="t-queue"></div>
      <div class="t-weight"><b></b><span></span></div>
      <div class="bar"><i></i></div>
      <div class="t-foot"><div class="t-clock"></div><div class="t-note"></div></div>`;
    tileEls.set(c.stationId, tile);
  }
  return tile;
}

function renderGrid() {
  const hasQueue = c => { const q = queues.get(c.stationId); return !!(q && (q.now || (q.atSpot || []).length)); };
  const onScreen = cells.filter(c => c.job || c.scale || hasQueue(c));
  const quiet = cells.filter(c => !c.job && !c.scale && !hasQueue(c));
  const keep = new Set();
  for (const c of onScreen) {
    keep.add(c.stationId);
    // A cell with no tablet (no scale, or none open) still has an order from the queue:
    // show what it's on and its target. A cell with no scale has no tablet to be off,
    // so its state comes from the queue too (practice mode showed this, 2026-11-11).
    const qn = (queues.get(c.stationId) || {}).now || null;
    const tabletJob = c.job && c.job.tabletOnline && c.job.phase !== 'idle' ? c.job : null;
    let st = statusOf(c) || 'offline';
    if (qn && !c.scale && !tabletJob) st = qn.started ? 'running' : 'armed';
    const j = tabletJob || (qn ? { cultivar: qn.cultivar, bag: qn.bag, targetG: qn.targetG } : (c.job || {}));
    const tile = tileFor(c);
    tile.className = `tile ${st}`;
    const target = j.targetG || null;
    const weight = c.scale && c.scale.weightG != null ? c.scale.weightG : null;
    const shown = st === 'finished' && j.finishedNetG != null ? j.finishedNetG : weight;
    const frac = target && shown != null ? Math.max(0, shown) / target : 0;
    const clock = clockOf(c.job);
    tile.querySelector('.t-name .n').textContent = c.label;
    tile.querySelector('.t-name small').textContent = c.lane === 'retail' ? t('retail') : '';
    tile.querySelector('.pill').textContent = t(st);
    // Scale node battery (lib/battery.js), when the node sends it; red when low.
    const b = c.scale && c.scale.live ? c.scale.battery : null;
    const batt = tile.querySelector('.batt');
    batt.textContent = b && b.pct != null ? `🔋 ${b.pct}%` : '';
    batt.classList.toggle('low', !!b && b.pct < BATT_LOW_PCT);
    // Continuous (wholesale rounds, no target): "Continuous · cultivar · round N",
    // N from the round marks the Worker counted today (cell-board.js).
    const cont = j.bag === 'cont';
    tile.querySelector('.t-order .o').textContent = cont ? `${t('cont')} · ${shortCultivar(j.cultivar) || '—'}`
      : j.cultivar || j.bag ? (shortCultivar(j.cultivar) || '—') : (c.job ? t('noOrder') : '');
    tile.querySelector('.t-order small').textContent = cont ? ` · ${tf('roundN', { n: (j.rounds || 0) + 1 })}` : j.bag ? ` · ${t(j.bag)}` : '';
    tile.querySelector('.t-weight b').textContent = shown == null ? '—' : fmtG(shown);
    tile.querySelector('.t-weight span').textContent = target ? `${t('of')} ${fmtTarget(target)}` : '';
    const bar = tile.querySelector('.bar i');
    bar.style.width = `${Math.min(100, Math.round(frac * 100))}%`;
    bar.classList.toggle('near', frac >= NEAR && frac < 1);
    bar.classList.toggle('over', frac > 1.02);
    const q = queues.get(c.stationId);
    // The baskets at the spot are counted by the tile's own 🧺 line (#166).
    tile.querySelector('.t-queue').textContent = q && q.now
      ? [`${t('qNow')} ${q.now.orderName}`, q.nextOrder ? `${t('qNext')} ${q.nextOrder.orderName}` : ''].filter(Boolean).join(' · ')
      : '';
    tile.querySelector('.t-clock').textContent = clock == null ? '--:--' : fmtClock(clock);
    tile.querySelector('.t-note').textContent =
      st === 'paused' ? (j.pauseNote || '') :
      st === 'armed' ? t('startsAt') :
      st === 'finished' ? t('waiting') :
      st === 'notrec' ? `${t(c.notRecording.why)} · +${c.notRecording.riseG} g` :
      spotFor(c.stationId) ? tf('spotCount', { n: spotFor(c.stationId) }) : '';
    place(el.grid, tile, keep.size - 1);   // roster order
  }
  for (const [id, tile] of tileEls) if (!keep.has(id)) { tile.remove(); tileEls.delete(id); }
  el.quiet.textContent = quiet.length ? `${t('notOnScreen')}: ${quiet.map(c => cellNo(c.stationId)).join(', ')}` : '';
  el.sub.textContent = tf('cellsLive', { n: onScreen.length });
}

const spotFor = id => waiting.filter(w => w.stationId === id && !collecting.has(w.id)).length;
function render() { renderPickups(); renderGrid(); }

let timer = null;
async function poll() {
  clearTimeout(timer);
  if (!document.hidden) {
    try {
      const r = await fetch(`${API}?action=cellBoard`, { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      const body = d.data || d;
      offsetMs = body.serverNow - Date.now();
      cells = body.cells || [];
      waiting = body.waiting || [];
      // Once the server no longer lists a collected basket, stop hiding it here.
      for (const id of [...collecting]) if (!waiting.some(w => w.id === id)) collecting.delete(id);
      el.status.textContent = '';
      render();
    } catch {
      el.status.textContent = t('loadFail');
    }
  }
  timer = setTimeout(poll, POLL_MS);
}
// Orders at the cells: a lighter read, every QUEUE_MS. Before migration 0061 it 503s and the board is as before.
const QUEUE_MS = 5000;
async function pollQueues(once = false) {
  if (!document.hidden) {
    try {
      const r = await fetch(`${API}?action=cellQueue`, { cache: 'no-store' });
      if (r.ok) {
        queues.clear();
        jobOrder.clear();
        for (const q of (await r.json()).cells || []) {
          queues.set(q.stationId, q);
          for (const s of q.atSpot || []) for (const id of s.jobIds || []) jobOrder.set(id, { orderId: s.orderId, orderName: s.orderName, orderReady: s.orderReady });
        }
        for (const id of [...seenOrderReady]) if (![...queues.values()].some(q => (q.atSpot || []).some(s => s.orderId === id && s.orderReady))) seenOrderReady.delete(id);
        if (cells.length) render();
      }
    } catch { /* the board still shows the cells */ }
  }
  if (!once) setTimeout(pollQueues, QUEUE_MS);
}
// Clocks tick between reads.
setInterval(() => { if (!document.hidden && cells.length) render(); }, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

el.lang.addEventListener('click', () => setLang(getLang() === 'es' ? 'en' : 'es'));
document.addEventListener('ro:langchange', () => { el.lang.textContent = getLang() === 'es' ? 'EN' : 'ES'; render(); });
el.sound.addEventListener('click', () => { unlock(); chime(); });
el.lang.textContent = getLang() === 'es' ? 'EN' : 'ES';
poll();
pollQueues();
