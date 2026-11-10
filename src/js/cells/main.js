/**
 * Cells board: what every cell's screen is doing, on any other computer
 * (Koa 2026-11-09: "once everything renders on the cell 1 tablet, id like to see
 * it pop up on other's computers"). For the bagging/fulfillment computer and the
 * office: one tile per cell with its order, live weight, progress and clock, and
 * a "ready for pickup" pop-up with a chime when a cell finishes a bag. The pop-up
 * clears by itself when the bag is lifted off the scale.
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
    title: 'Cells', rawLink: 'Raw hand-out', soundOn: '🔔 Tap to turn sound on', ready: 'Ready for pickup', waiting: 'waiting',
    idle: 'Idle', armed: 'Ready', running: 'Filling', paused: 'Paused', finished: 'Ready for pickup',
    down: 'Scale disconnected', offline: 'Tablet off', noOrder: 'No order picked', of: 'of',
    notrec: 'NOT RECORDING', noScreen: 'trimming, no cell screen open', tabletOff: 'trimming, tablet not reporting', noJob: 'trimming, no job started',
    retail: 'retail', notOnScreen: 'Not on a screen yet', loadFail: 'Can\'t reach the server. Retrying…',
    cellsLive: '{n} cell(s) on a screen', ago: '{m} min ago', justNow: 'just now', startsAt: 'starts on the first gram',
    qOz: '¼ oz', hOz: '½ oz', oz1: '1 oz', qLb: '¼ lb', hLb: '½ lb', lb1: '1 lb',
  },
  es: {
    title: 'Celdas', rawLink: 'Entrega de crudo', soundOn: '🔔 Toque para activar el sonido', ready: 'Listo para recoger', waiting: 'esperando',
    idle: 'Sin trabajo', armed: 'Lista', running: 'Llenando', paused: 'En pausa', finished: 'Listo para recoger',
    down: 'Báscula desconectada', offline: 'Tableta apagada', noOrder: 'Sin orden', of: 'de',
    notrec: 'NO SE GRABA', noScreen: 'recortando, sin pantalla abierta', tabletOff: 'recortando, la tableta no reporta', noJob: 'recortando, sin trabajo iniciado',
    retail: 'menudeo', notOnScreen: 'Todavía sin pantalla', loadFail: 'No hay conexión con el servidor. Reintentando…',
    cellsLive: '{n} celda(s) con pantalla', ago: 'hace {m} min', justNow: 'ahora', startsAt: 'empieza con el primer gramo',
    qOz: '¼ oz', hOz: '½ oz', oz1: '1 oz', qLb: '¼ lb', hLb: '½ lb', lb1: '1 lb',
  },
});
const tf = (key, vars) => t(key).replace(/\{(\w+)\}/g, (_, k) => vars[k]);

const params = new URLSearchParams(location.search);
const apiParam = params.get('api') || '';
const API = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(apiParam) ? apiParam : PROD_API;
if (API !== PROD_API) document.getElementById('rawLink').href = `rawout.html?api=${encodeURIComponent(API)}`;

const $ = id => document.getElementById(id);
const el = { pickups: $('pickups'), grid: $('grid'), quiet: $('quiet'), status: $('status'), sub: $('sub'), sound: $('soundBtn'), lang: $('langToggle') };

let cells = [];
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
  for (const [key, card] of pickupEls) if (!keep.has(key)) { card.remove(); pickupEls.delete(key); }
  // Chime for a bag that just finished; again every 2 min while any still waits.
  let fresh = false;
  for (const c of ready) {
    if (seenFinished.get(c.stationId) !== c.job.finishedAt) { seenFinished.set(c.stationId, c.job.finishedAt); fresh = true; }
  }
  for (const id of [...seenFinished.keys()]) if (!ready.some(c => c.stationId === id)) seenFinished.delete(id);
  if (fresh || (ready.length && Date.now() - lastChimeAt >= REMIND_MS)) chime();
  document.title = ready.length ? `(${ready.length}) ${t('title')} - Rogue Origin` : `${t('title')} - Rogue Origin`;
}

function tileFor(c) {
  let tile = tileEls.get(c.stationId);
  if (!tile) {
    tile = document.createElement('article');
    tile.innerHTML = `
      <div class="t-top"><div class="t-name"><span class="n"></span><small></small></div><span class="batt"></span><span class="pill"></span></div>
      <div class="t-order"><span class="o"></span><small></small></div>
      <div class="t-weight"><b></b><span></span></div>
      <div class="bar"><i></i></div>
      <div class="t-foot"><div class="t-clock"></div><div class="t-note"></div></div>`;
    tileEls.set(c.stationId, tile);
  }
  return tile;
}

function renderGrid() {
  const onScreen = cells.filter(c => c.job || c.scale);
  const quiet = cells.filter(c => !c.job && !c.scale);
  const keep = new Set();
  for (const c of onScreen) {
    keep.add(c.stationId);
    const st = statusOf(c) || 'offline';
    const j = c.job || {};
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
    tile.querySelector('.t-order .o').textContent = j.cultivar || j.bag ? (shortCultivar(j.cultivar) || '—') : (c.job ? t('noOrder') : '');
    tile.querySelector('.t-order small').textContent = j.bag ? ` · ${t(j.bag)}` : '';
    tile.querySelector('.t-weight b').textContent = shown == null ? '—' : fmtG(shown);
    tile.querySelector('.t-weight span').textContent = target ? `${t('of')} ${fmtTarget(target)}` : '';
    const bar = tile.querySelector('.bar i');
    bar.style.width = `${Math.min(100, Math.round(frac * 100))}%`;
    bar.classList.toggle('near', frac >= NEAR && frac < 1);
    bar.classList.toggle('over', frac > 1.02);
    tile.querySelector('.t-clock').textContent = clock == null ? '--:--' : fmtClock(clock);
    tile.querySelector('.t-note').textContent =
      st === 'paused' ? (j.pauseNote || '') :
      st === 'armed' ? t('startsAt') :
      st === 'finished' ? t('waiting') :
      st === 'notrec' ? `${t(c.notRecording.why)} · +${c.notRecording.riseG} g` : '';
    place(el.grid, tile, keep.size - 1);   // roster order
  }
  for (const [id, tile] of tileEls) if (!keep.has(id)) { tile.remove(); tileEls.delete(id); }
  el.quiet.textContent = quiet.length ? `${t('notOnScreen')}: ${quiet.map(c => cellNo(c.stationId)).join(', ')}` : '';
  el.sub.textContent = tf('cellsLive', { n: onScreen.length });
}

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
      el.status.textContent = '';
      render();
    } catch {
      el.status.textContent = t('loadFail');
    }
  }
  timer = setTimeout(poll, POLL_MS);
}
// Clocks tick between reads.
setInterval(() => { if (!document.hidden && cells.length) render(); }, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

el.lang.addEventListener('click', () => setLang(getLang() === 'es' ? 'en' : 'es'));
document.addEventListener('ro:langchange', () => { el.lang.textContent = getLang() === 'es' ? 'EN' : 'ES'; render(); });
el.sound.addEventListener('click', () => { unlock(); chime(); });
el.lang.textContent = getLang() === 'es' ? 'EN' : 'ES';
poll();
