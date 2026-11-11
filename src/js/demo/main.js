/**
 * Practice / demo controls (demo.html?demo=1; Koa 2026-11-11: "build our side out
 * using mock data from the last 90 days"). Load a day (generated from the 90-day
 * shape, or replayed from a Shopify order export), pick a speed, and this tab
 * drives the practice floor: every second it asks the Worker to move the sim on
 * (demoTick). Open the floor screens from the links; they show DEMO at the top.
 * Everything runs on the separate practice database: nothing here touches live data.
 */
import { registerLabels, setLang, getLang, t } from '../shared/i18n.js';
import { isDemo, demoApi, withDemo, showDemoBanner } from '../shared/demo.mjs';
import { generateDay, parseShopifyExport, replayDay } from './orders.mjs';

const PROD_API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production';
const TICK_MS = 1000;

registerLabels({
  en: {
    title: 'Practice floor', intro: 'Mock orders run through the real screens on a separate practice database. Live data is never touched. Keep this tab open: it drives the practice floor.',
    load: '1. Load a day', day: 'Day', seed: 'Variation', generate: 'Make a day from the 90-day shape', csv: 'Or replay a real day from a Shopify order export (CSV)',
    replay: 'Replay that day', run: '2. Run it', speed: 'Speed', pause: 'Pause', resume: 'Resume', auto: 'Auto bag/tag (confirm, collect, ship by itself)',
    screens: '3. Open the screens', bagtag: 'Bag/tag queue', board: 'Cells board', pull: 'Pull list', cell: 'Cell {n} screen',
    clock: 'Sim clock', toArrive: 'still to arrive', loaded: 'Loaded {n} orders ({c} with cell work, {r} rush).', notDemo: 'Open this page with ?demo=1.',
    notReady: 'Practice mode is not set up on the server yet (the practice database).', fail: 'That didn\'t work: {e}', csvRead: '{n} orders read from the export ({d} days).',
    cellNote: 'On a cell screen, tap Start once; after the first basket the screen follows the practice scale by itself.',
    states: { queued: 'waiting', assigned: 'at a cell', trimming: 'trimming', ready: 'ready', checked: 'checked', fulfilled: 'shipped', hold: 'on hold', cancelled: 'cancelled' },
  },
  es: {
    title: 'Piso de práctica', intro: 'Órdenes de prueba pasan por las pantallas reales en una base de datos de práctica aparte. Los datos en vivo no se tocan. Deje esta pestaña abierta: mueve el piso de práctica.',
    load: '1. Cargar un día', day: 'Día', seed: 'Variación', generate: 'Crear un día con la forma de 90 días', csv: 'O repetir un día real desde una exportación de órdenes de Shopify (CSV)',
    replay: 'Repetir ese día', run: '2. Correrlo', speed: 'Velocidad', pause: 'Pausar', resume: 'Seguir', auto: 'Empaque automático (confirma, recoge y envía solo)',
    screens: '3. Abrir las pantallas', bagtag: 'Cola de empaque', board: 'Tablero de celdas', pull: 'Lista de surtido', cell: 'Pantalla de celda {n}',
    clock: 'Reloj de práctica', toArrive: 'por llegar', loaded: 'Se cargaron {n} órdenes ({c} con trabajo de celda, {r} urgentes).', notDemo: 'Abra esta página con ?demo=1.',
    notReady: 'El modo de práctica todavía no está listo en el servidor (la base de datos de práctica).', fail: 'No funcionó: {e}', csvRead: '{n} órdenes leídas de la exportación ({d} días).',
    cellNote: 'En una pantalla de celda, toque Empezar una vez; después de la primera canasta la pantalla sigue sola a la báscula de práctica.',
    states: { queued: 'esperando', assigned: 'en celda', trimming: 'recortando', ready: 'listas', checked: 'revisada', fulfilled: 'enviada', hold: 'en pausa', cancelled: 'cancelada' },
  },
});
const tf = (key, vars = {}) => t(key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
const params = new URLSearchParams(location.search);
const apiParam = params.get('api') || '';
const API = demoApi(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(apiParam) ? apiParam : PROD_API);
const $ = id => document.getElementById(id);
let state = null;
let exported = [];
let ticking = null;

const todayPacific = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const simTime = ms => new Date(ms).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' });

async function post(action, body) {
  const r = await fetch(`${API}?action=${action}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body || {}) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.code === 'NOT_READY' ? t('notReady') : (d.error || r.status));
  return d;
}

function say(msg, bad = false) { $('msg').textContent = msg; $('msg').className = `msg${bad ? ' bad' : ''}`; }

async function load(day) {
  const cellLines = day.orders.filter(o => o.lines.some(l => l.options && l.options['Flower Type'] === 'Tops')).length;
  try {
    await post('demoLoad', { ...day, speed: Number($('speed').dataset.v || 10), auto: $('auto').checked });
    say(tf('loaded', { n: day.orders.length, c: cellLines, r: day.orders.filter(o => o.rush).length }));
    start();
  } catch (e) { say(tf('fail', { e: e.message }), true); }
}

// One tick at a time: the next one is scheduled only when the last has answered, so a
// slow tick on the real database never overlaps the next (the Worker also refuses overlaps).
function start() {
  if (ticking) return;
  ticking = true;
  const loop = async () => { await tick(); setTimeout(loop, TICK_MS); };
  loop();
}

async function tick() {
  try {
    const d = await post('demoTick', {});
    const s = await (await fetch(`${API}?action=demoState`, { cache: 'no-store' })).json();
    state = { ...s, clock: d.clock };
    render();
  } catch (e) { say(tf('fail', { e: e.message }), true); }
}

function render() {
  if (!state || !state.clock) return;
  const c = state.clock;
  $('clock').textContent = simTime(c.simMs);
  $('pauseBtn').textContent = c.paused ? t('resume') : t('pause');
  for (const b of document.querySelectorAll('.speed .btn')) b.classList.toggle('on', Number(b.dataset.v) === c.speed);
  $('auto').checked = !!c.auto;
  const states = t('states');
  $('counts').replaceChildren(...Object.entries(state.counts || {}).map(([k, n]) => {
    const s = document.createElement('span'); s.className = `count s-${k}`; s.textContent = `${(states && states[k]) || k} ${n}`; return s;
  }), Object.assign(document.createElement('span'), { className: 'count', textContent: `${state.toArrive} ${t('toArrive')}` }));
}

function labels() {
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  for (const el of document.querySelectorAll('[data-cell]')) el.textContent = tf('cell', { n: el.dataset.cell });
  render();
}

// --- wiring ---
$('day').value = todayPacific();
$('genBtn').addEventListener('click', () => load(generateDay({ day: $('day').value, seed: Number($('seed').value) || 1 })));
$('csv').addEventListener('change', async () => {
  const f = $('csv').files[0];
  if (!f) return;
  try {
    exported = parseShopifyExport(await f.text());
    const days = new Set(exported.map(o => new Date(o.createdAt).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })));
    say(tf('csvRead', { n: exported.length, d: days.size }));
    $('replayBtn').disabled = !exported.length;
  } catch (e) { say(tf('fail', { e: e.message }), true); }
});
$('replayBtn').addEventListener('click', () => load(replayDay(exported, $('day').value)));
for (const b of document.querySelectorAll('.speed .btn')) {
  b.addEventListener('click', async () => {
    $('speed').dataset.v = b.dataset.v;
    try { await post('demoControl', { speed: Number(b.dataset.v) }); start(); } catch (e) { say(tf('fail', { e: e.message }), true); }
  });
}
$('pauseBtn').addEventListener('click', async () => {
  try { await post('demoControl', { paused: !(state && state.clock && state.clock.paused) }); tick(); } catch (e) { say(tf('fail', { e: e.message }), true); }
});
$('auto').addEventListener('change', async () => { try { await post('demoControl', { auto: $('auto').checked }); } catch { /* takes effect on load */ } });
for (const a of document.querySelectorAll('a[data-href]')) a.href = withDemo(a.dataset.href);
$('langToggle').addEventListener('click', () => { setLang(getLang() === 'en' ? 'es' : 'en'); $('langToggle').textContent = getLang() === 'en' ? 'ES' : 'EN'; labels(); });
$('langToggle').textContent = getLang() === 'en' ? 'ES' : 'EN';
showDemoBanner();
labels();
if (!isDemo()) { say(t('notDemo'), true); for (const b of document.querySelectorAll('button')) if (b.id !== 'langToggle') b.disabled = true; }
else {
  // Already running (another tab, or a reload): pick it up.
  fetch(`${API}?action=demoState`, { cache: 'no-store' }).then(r => r.json()).then(s => { if (s.loaded) { state = s; render(); start(); } }).catch(() => {});
}
