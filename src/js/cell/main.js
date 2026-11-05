/**
 * Cell table screen: live net weight toward a target, a job timer, and the
 * working / next order typed in by hand for the pilot.
 *
 *   cell.html?station=table1
 *
 * Reads ?action=scaleWeight (GET, no token) once a second while the page is
 * visible and the scale is live, every 5 s while it is stale. Tare, target,
 * orders and the timer live in this tablet's localStorage, per station, until
 * the cell job records (cell_chunks) exist on the Worker.
 */
import { registerLabels, setLang, getLang, t } from '../shared/i18n.js';

const PROD_API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production';
const FAST_MS = 1000;
const SLOW_MS = 5000;
const NEAR = 0.9;
// Fill weight standards, NET with the bag tared (wiki operations/fill-weight-standards.md,
// Koa 2026-11-05). Every size sits a little over label on purpose. 10 lb and 5 kg are
// never filled at a cell: several cells' jobs go to bagging, which checks them and
// fills the big bag.
const PRESETS = [
  { key: 'qOz', g: 7.5 }, { key: 'hOz', g: 15.0 }, { key: 'oz1', g: 30.0 },
  { key: 'qLb', g: 115.0 }, { key: 'hLb', g: 230.0 }, { key: 'lb1', g: 460.0 },
];

registerLabels({
  en: {
    waiting: 'Waiting for scale', live: 'Scale live', stale: 'No scale signal',
    workingOn: 'Working on', workingPlaceholder: 'Order · cultivar · weight',
    nextOrder: 'Next order', nextPlaceholder: 'Next order · cultivar · weight',
    of: 'of', toGo: 'To go', done: 'Done', tare: 'Tare', target: 'Target',
    customG: 'Custom (g)', liveCycle: 'Live cycle time', notStarted: 'Not started',
    start: 'Start', finish: 'Done', finished: 'Finished in', pace: 'g/min', eta: 'finish in',
    pilotNote: 'Pilot: orders are typed here until the order board is connected. The scale weight is live.',
    qOz: '¼ oz', hOz: '½ oz', oz1: '1 oz', qLb: '¼ lb', hLb: '½ lb', lb1: '1 lb', cell: 'Cell',
    netHint: 'net · bag tared',
  },
  es: {
    waiting: 'Esperando la báscula', live: 'Báscula en vivo', stale: 'Sin señal de la báscula',
    workingOn: 'Trabajando en', workingPlaceholder: 'Orden · variedad · peso',
    nextOrder: 'Siguiente orden', nextPlaceholder: 'Siguiente orden · variedad · peso',
    of: 'de', toGo: 'Faltan', done: 'Hecho', tare: 'Tara', target: 'Meta',
    customG: 'Otra (g)', liveCycle: 'Tiempo de ciclo', notStarted: 'Sin empezar',
    start: 'Empezar', finish: 'Terminar', finished: 'Terminado en', pace: 'g/min', eta: 'termina en',
    pilotNote: 'Prueba: las órdenes se escriben aquí hasta conectar el tablero de órdenes. El peso de la báscula es en vivo.',
    qOz: '¼ oz', hOz: '½ oz', oz1: '1 oz', qLb: '¼ lb', hLb: '½ lb', lb1: '1 lb', cell: 'Celda',
    netHint: 'neto · bolsa en tara',
  },
});

const params = new URLSearchParams(location.search);
const station = (params.get('station') || 'table1').replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'table1';
// Local testing only: ?api=http://localhost:8799/api/production. Never another host.
const apiParam = params.get('api') || '';
const API = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(apiParam) ? apiParam : PROD_API;
const KEY = `ro-cell:${station}`;

const $ = id => document.getElementById(id);
const el = {
  name: $('cellName'), dot: $('liveDot'), liveText: $('liveText'), lang: $('langToggle'),
  working: $('workingInput'), next: $('nextInput'),
  ring: $('ringFill'), net: $('netValue'), targetText: $('targetText'), toGo: $('toGo'), pct: $('pct'),
  tare: $('tareBtn'), presets: $('presets'), custom: $('customTarget'),
  cycle: $('cycleTime'), cycleSub: $('cycleSub'), start: $('startBtn'), done: $('doneBtn'),
};
const RING_LEN = 597;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
const state = { working: '', next: '', targetG: 460.0, tareG: 0, startedAt: null, finishedMs: null, ...load() };
let gross = null;       // grams, latest reading
let live = false;
let timer = null;

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: still works for this visit */ }
}

const fmtG = g => `${g.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} g`;
function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
const net = () => (gross === null ? 0 : Math.max(0, gross - state.tareG));
const fmtTarget = g => `${g.toLocaleString('en-US', { maximumFractionDigits: 2 })} g`;

function renderPresets() {
  el.presets.innerHTML = '';
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.className = 'btn chip' + (Math.abs(p.g - state.targetG) < 0.01 ? ' on' : '');
    b.textContent = t(p.key);
    b.addEventListener('click', () => { state.targetG = p.g; el.custom.value = ''; save(); renderPresets(); render(); });
    el.presets.appendChild(b);
  }
}

function render() {
  el.name.textContent = `${t('cell')} ${station.replace(/^\D+/, '') || station}`;
  const n = net();
  const frac = state.targetG > 0 ? n / state.targetG : 0;
  el.net.textContent = gross === null ? '—' : fmtG(n);
  el.targetText.textContent = `${fmtTarget(state.targetG)} ${t('netHint')}`;
  el.toGo.textContent = gross === null ? '—' : fmtG(Math.max(0, state.targetG - n));
  el.pct.textContent = `${Math.min(999, Math.round(frac * 100))}%`;
  el.ring.setAttribute('stroke-dashoffset', String(RING_LEN * (1 - Math.min(1, frac))));
  el.ring.classList.toggle('near', frac >= NEAR && frac < 1);
  el.ring.classList.toggle('over', frac > 1.02);

  el.dot.className = `live-dot ${gross === null ? 'stale' : live ? 'live' : 'stale'}`;
  el.liveText.textContent = gross === null ? t('waiting') : live ? t('live') : t('stale');
  renderCycle();
}

function renderCycle() {
  el.cycleSub.className = 'sub';
  if (state.finishedMs !== null) {
    el.cycle.textContent = fmtClock(state.finishedMs);
    el.cycleSub.textContent = t('finished');
    return;
  }
  if (!state.startedAt) {
    el.cycle.textContent = '--:--';
    el.cycleSub.textContent = t('notStarted');
    return;
  }
  const elapsed = Date.now() - state.startedAt;
  el.cycle.textContent = fmtClock(elapsed);
  const mins = elapsed / 60000;
  const n = net();
  if (mins > 0.5 && n > 0) {
    const rate = n / mins;
    const left = Math.max(0, state.targetG - n) / rate;
    el.cycleSub.textContent = `${rate.toFixed(1)} ${t('pace')} · ${t('eta')} ${fmtClock(left * 60000)}`;
  } else {
    el.cycleSub.textContent = '';
  }
}

async function poll() {
  clearTimeout(timer);
  // Hidden (screen off, tab in the background): don't fetch, but keep a slow
  // retry alive. A page that loaded while hidden may never get a visibilitychange,
  // and would otherwise sit on "Waiting for scale" until someone reloads it.
  if (document.hidden) { timer = setTimeout(poll, SLOW_MS); return; }
  try {
    const r = await fetch(`${API}?action=scaleWeight&stationId=${encodeURIComponent(station)}`, { cache: 'no-store' });
    const d = await r.json();
    if (d && d.updatedAt) {
      gross = Number(d.weight) * 1000; // the API's weight is always kg; unit is only a tag
      // A still scale only posts every 30 s, so give unregistered stations
      // (3 s server stale time) the table's 45 s before showing no signal.
      const age = Date.now() - Date.parse(d.updatedAt);
      live = !d.isStale || age < 45000;
    } else {
      live = false;
    }
  } catch {
    live = false;
  }
  render();
  timer = setTimeout(poll, live ? FAST_MS : SLOW_MS);
}

el.working.value = state.working;
el.next.value = state.next;
el.working.addEventListener('input', () => { state.working = el.working.value; save(); });
el.next.addEventListener('input', () => { state.next = el.next.value; save(); });
el.tare.addEventListener('click', () => { if (gross !== null) { state.tareG = gross; save(); render(); } });
el.custom.addEventListener('change', () => {
  const v = parseFloat(el.custom.value);
  if (v > 0) { state.targetG = v; save(); renderPresets(); render(); }
});
el.start.addEventListener('click', () => {
  state.startedAt = Date.now(); state.finishedMs = null;
  if (gross !== null) state.tareG = gross;
  save(); render();
});
el.done.addEventListener('click', () => {
  if (!state.startedAt) return;
  state.finishedMs = Date.now() - state.startedAt;
  state.startedAt = null;
  // The next order moves up; the lead types the one after it.
  state.working = state.next; state.next = '';
  el.working.value = state.working; el.next.value = '';
  save(); render();
});
el.lang.addEventListener('click', () => setLang(getLang() === 'es' ? 'en' : 'es'));
document.addEventListener('ro:langchange', () => { el.lang.textContent = getLang() === 'es' ? 'EN' : 'ES'; renderPresets(); render(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
setInterval(renderCycle, 1000);

el.lang.textContent = getLang() === 'es' ? 'EN' : 'ES';
renderPresets();
render();
poll();
