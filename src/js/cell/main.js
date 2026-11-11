/**
 * Cell table screen: live net weight toward a target, a job timer that runs
 * itself off the scale, and the order picked from two dropdowns: cultivar and
 * bag size. Made-to-order retail trial (Koa 2026-11-09): the target is the bag
 * size's fill standard, set automatically; there is no next order for now.
 *
 *   cell.html?station=table1
 *
 * Reads ?action=scaleWeight (GET, no token) every 250 ms while a job is armed
 * or running, every second otherwise, every 2 s while the scale is disconnected,
 * and every 5 s while the page is hidden (Koa 2026-11-09: follow the scale closer). The order and the
 * timer live in this tablet's localStorage, per station. Each pickup (finished or not) posts
 * a pickup mark carrying its cultivar, bag size and working time (migration 0052),
 * so the Worker keeps a record of what every job was.
 *
 * Orders at the cells (order flow slice 2, Koa 2026-11-11: "automatic order
 * assignment"): when the Worker has assigned this cell orders (cellQueue), the
 * NOW job is the order, shown as a card with NEXT under it, and the dropdowns step
 * aside. The pickup mark carries the job's id, which closes it on the Worker, and
 * NEXT moves up with no taps. With nothing assigned, the dropdowns work as before
 * (wholesale batches, or a day the queue is down).
 */
import { registerLabels, setLang, getLang, t } from '../shared/i18n.js';
import { buildCultivarOptions } from '../hourly-entry/cultivar-options.mjs';
import { enhanceSelect } from '../shared/select-search.js';
import { createLiftWatch, createZeroWatch, EMPTY_G, BASKET_MIN_G } from './lift.mjs';
import { applyQueue, shortCultivar } from './queue.mjs';
import { breakAt, breakMsBetween, clockOf, pacificMinutes } from './breaks.mjs';
import { createEod } from './eod.mjs';

const PROD_API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production';
// Reads cost one Worker request each, so the fast rate is kept to the moments
// that need it. A read takes ~0.23 s, so 250 ms means a fresh number about
// every half second during a job.
const JOB_MS = 250;      // a job is armed or running
const IDLE_MS = 1000;    // waiting for the next job, or finished
const DOWN_MS = 2000;    // scale disconnected: keep checking for it to come back
const SLOW_MS = 5000;    // page hidden
// Scale disconnected: no fresh post from the scale for the station's stale
// time (scale_stations.stale_after_s, 45 s while the node's heartbeat is 30 s).
// No alarm on the tablet (Koa 2026-11-09: the alert goes to Koa on Telegram,
// lib/scale-watch.js on the Worker); the screen only shows it in the status dot,
// holds a running job's clock, and starts nothing until the scale is back.
const NEAR = 0.9;
// The job timer runs itself off the scale (Koa 2026-11-05: "couldn't it be automatic?"):
//   Start (or the scale's own TARE with the basket on) -> armed; the first START_G
//   of product starts the clock; reaching the
//   target and settling (stable flag, or HOLD_MS at/over target) stops it. A basket
//   lifted off and set back down about empty is a pickup, before or after the
//   target (Koa 2026-11-10: the bagger's cart takes tops on rounds): the job is
//   recorded and the next one is armed on the same basket. Set back with weight
//   in it is a shake: the job carries on (lift.mjs). The order stays picked.
const START_G = 1.0;     // two steps of the 0.5 g bench scale, so last-digit noise can't start it
const HOLD_MS = 3000;
// Fail-safes (Koa 2026-11-05: "make everything fool-proof"):
// Tare happens on the scale itself (Koa 2026-11-09): with the basket on, the crew
// press the scale's TARE, and the scale then sends NET weight. The screen shows
// exactly the number the scale shows (grams, 2 decimals), with no offset of its own.
// An empty tared basket reads about 0; a lifted basket reads negative.
const ON_SCALE_G = 2.0;  // more than this on an idle, untared scale -> "Tare on the scale, then tap Start"
const LIFT_G = 1.0;      // below -1 g mid-job: the basket is off the scale
// Pauses (Koa 2026-11-05): a running job pauses itself at 4:20 pm Pacific (cleanup),
// and the Pause button only works with a note saying why. Paused time is left out
// of the cycle time. Breaks (Koa 2026-11-10, breaks.mjs: 9:00-9:10, 12:00-12:30,
// 2:30-2:40) stop a running job's clock and start it again at the break's end,
// with no tap; break time a sleeping tablet missed is left out too.
const AUTO_PAUSE_MIN = 16 * 60 + 20;
const NOTE_MIN_CHARS = 3;
const REASONS = ['rScale', 'rWait', 'rEquip', 'rHelp'];
// Fill weight standards, NET with the bag tared (wiki operations/fill-weight-standards.md,
// Koa 2026-11-05). Every size sits a little over label on purpose. 10 lb and 5 kg are
// never filled at a cell: several cells' jobs go to bagging, which checks them and
// fills the big bag. The bag size picked for the order sets the target; there is
// no other way to set it (Koa 2026-11-09).
// One order per job (Koa 2026-11-10): every pickup clears the cultivar and bag
// size, so each job is entered fresh. Flip to false once orders are assigned to
// cells automatically; the order then carries over to the next job again.
const ORDER_PER_JOB = true;
const PRESETS = [
  { key: 'qOz', g: 7.5 }, { key: 'hOz', g: 15.0 }, { key: 'oz1', g: 30.0 },
  { key: 'qLb', g: 115.0 }, { key: 'hLb', g: 230.0 }, { key: 'lb1', g: 460.0 },
];

registerLabels({
  en: {
    waiting: 'Waiting for scale', live: 'Scale live', stale: 'No scale signal',
    cultivar: 'Cultivar', bagSize: 'Bag size', chooseCultivar: 'Choose the cultivar',
    bannerOrder: 'Choose the cultivar and bag size for this order', chooseBag: 'Choose the bag size',
    notRecording: 'NOT RECORDING', orderLocked: 'Locked during the job. To change it: Hold to reset.',
    of: 'of', toGo: 'To go', done: 'Done', startJob: 'Start', liveCycle: 'Live cycle time', tareToStart: 'Tare on the scale, then tap Start',
    armed: 'Starts when product goes in', finished: 'Finished in', pace: 'g/min', eta: 'finish in',
    liftOff: 'leave it for pickup', lastJob: 'Last job', awake: 'Screen stays on', battery: 'Scale node battery',
    holdReset: 'Hold to reset', holdHint: 'Keep holding to reset', confirmReset: 'A job is running. Reset it? The timer and the tare clear.',
    bannerTared: 'Scale TARE pressed mid-job: {g} kept. Tell the lead.',
    bannerTare: 'Empty basket on, TARE on the scale, then tap Start', bannerOff: 'Container off the scale: put it back',
    bannerSignal: 'Scale disconnected: tell the lead', disconnected: 'Scale disconnected', searchCultivar: 'Type to search', clockHeld: 'Clock held until the scale is back',
    confirmRetare: 'A job is running. Start over from zero?',
    pause: 'Pause', resume: 'Resume', pauseTitle: 'Why are you pausing?', pauseOk: 'Pause job', cancel: 'Cancel',
    notePlaceholder: 'Write what happened', noteRequired: 'Write why first', paused: 'Paused',
    bannerPaused: 'Paused: tap Resume to keep going', autoNote: 'Cleanup 4:20',
    breakNote: 'Break {from}–{to}', lunchNote: 'Lunch {from}–{to}',
    bannerBreak: 'Break until {to}: the clock is stopped. It starts again by itself.',
    bannerLunch: 'Lunch until {to}: the clock is stopped. It starts again by itself.',
    rScale: 'Scale problem', rWait: 'Waiting for product', rEquip: 'Equipment problem', rHelp: 'Need help',
    pilotNote: 'Pick the cultivar and the bag size this order goes into. The bag size sets the target for the basket. The scale weight is live.',
    qOz: '¼ oz', hOz: '½ oz', oz1: '1 oz', qLb: '¼ lb', hLb: '½ lb', lb1: '1 lb', cell: 'Cell',
    netHint: 'net · container tared',
    nowLabel: 'NOW', nextLabel: 'NEXT', basketOf: 'basket {n} of {m}', nothingNext: 'Nothing next yet',
    newCultivar: 'New cultivar', changedShopify: 'Changed in Shopify: ask bag/tag', rushTag: 'RUSH',
  },
  es: {
    waiting: 'Esperando la báscula', live: 'Báscula en vivo', stale: 'Sin señal de la báscula',
    cultivar: 'Variedad', bagSize: 'Tamaño de bolsa', chooseCultivar: 'Elija la variedad',
    bannerOrder: 'Elija la variedad y el tamaño de bolsa de esta orden', chooseBag: 'Elija el tamaño de bolsa',
    notRecording: 'NO SE ESTÁ GRABANDO', orderLocked: 'Bloqueado durante el trabajo. Para cambiarlo: Mantenga para reiniciar.',
    of: 'de', toGo: 'Faltan', done: 'Hecho', startJob: 'Empezar', liveCycle: 'Tiempo de ciclo', tareToStart: 'Haga TARA en la báscula y toque Empezar',
    armed: 'Empieza al poner producto', finished: 'Terminado en', pace: 'g/min', eta: 'termina en',
    liftOff: 'déjela para recoger', lastJob: 'Último trabajo', awake: 'Pantalla encendida', battery: 'Batería del nodo de la báscula',
    holdReset: 'Mantenga para reiniciar', holdHint: 'Siga presionando para reiniciar', confirmReset: 'Hay un trabajo en curso. ¿Reiniciarlo? El tiempo y la tara se borran.',
    bannerTared: 'TARA de la báscula a mitad del trabajo: se guardaron {g}. Avise al líder.',
    bannerTare: 'Canasta vacía, TARA en la báscula y toque Empezar', bannerOff: 'El contenedor no está en la báscula: regréselo',
    bannerSignal: 'Báscula desconectada: avise al líder', disconnected: 'Báscula desconectada', searchCultivar: 'Escriba para buscar', clockHeld: 'Reloj detenido hasta que vuelva la báscula',
    confirmRetare: 'Hay un trabajo en curso. ¿Empezar de cero?',
    pause: 'Pausar', resume: 'Continuar', pauseTitle: '¿Por qué pausa?', pauseOk: 'Pausar trabajo', cancel: 'Cancelar',
    notePlaceholder: 'Escriba qué pasó', noteRequired: 'Escriba primero por qué', paused: 'En pausa',
    bannerPaused: 'En pausa: toque Continuar para seguir', autoNote: 'Limpieza 4:20',
    breakNote: 'Descanso {from}–{to}', lunchNote: 'Almuerzo {from}–{to}',
    bannerBreak: 'Descanso hasta las {to}: el reloj está parado. Sigue solo.',
    bannerLunch: 'Almuerzo hasta las {to}: el reloj está parado. Sigue solo.',
    rScale: 'Problema con la báscula', rWait: 'Esperando producto', rEquip: 'Problema de equipo', rHelp: 'Necesito ayuda',
    pilotNote: 'Elija la variedad y el tamaño de bolsa donde va esta orden. El tamaño de bolsa fija la meta de la canasta. El peso de la báscula es en vivo.',
    qOz: '¼ oz', hOz: '½ oz', oz1: '1 oz', qLb: '¼ lb', hLb: '½ lb', lb1: '1 lb', cell: 'Celda',
    netHint: 'neto · contenedor en tara',
    nowLabel: 'AHORA', nextLabel: 'SIGUIENTE', basketOf: 'canasta {n} de {m}', nothingNext: 'Nada después todavía',
    newCultivar: 'Variedad nueva', changedShopify: 'Cambió en Shopify: pregunte a empaque', rushTag: 'URGENTE',
  },
});

const params = new URLSearchParams(location.search);
// The home-screen app opens cell.html with no ?station=, so the tablet remembers
// the station it was last opened for (one manifest serves table1..table8).
const STATION_KEY = 'ro-cell:station';
const clean = v => String(v || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 32);
function rememberedStation() { try { return localStorage.getItem(STATION_KEY); } catch { return null; } }
const station = clean(params.get('station')) || clean(rememberedStation()) || 'table1';
try { localStorage.setItem(STATION_KEY, station); } catch { /* private mode: falls back to the link each time */ }
// Local testing only: ?api=http://localhost:8799/api/production. Never another host.
const apiParam = params.get('api') || '';
const API = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(apiParam) ? apiParam : PROD_API;
const KEY = `ro-cell:${station}`;
const API_ROOT = API.replace(/\/production$/, '');

const $ = id => document.getElementById(id);
const el = {
  name: $('cellName'), batt: $('batt'), orderLock: $('orderLock'), dot: $('liveDot'), liveText: $('liveText'), lang: $('langToggle'),
  cultivar: $('cultivarSelect'), bag: $('bagSelect'), orderPick: $('orderPick'), queueCards: $('queueCards'),
  nowOrder: $('nowOrder'), nowWhat: $('nowWhat'), nowMeta: $('nowMeta'), nextOrder: $('nextOrder'), nextWhat: $('nextWhat'), nextMeta: $('nextMeta'),
  ring: $('ringFill'), net: $('netValue'), targetText: $('targetText'), toGo: $('toGo'), pct: $('pct'),
  tare: $('tareBtn'),
  cycle: $('cycleTime'), cycleSub: $('cycleSub'), banner: $('banner'),
  pauseBtn: $('pauseBtn'), resumeBtn: $('resumeBtn'), dialog: $('pauseDialog'), chips: $('pauseChips'),
  note: $('pauseNote'), noteErr: $('pauseError'), pauseOk: $('pauseOk'), pauseCancel: $('pauseCancel'),
};
const RING_LEN = 597;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
// phase: idle (needs a tare) -> armed -> running -> finished -> idle
const state = { cultivar: '', bag: '', targetG: 0, bankedG: 0, tareFlagG: 0, phase: 'idle', startedAt: null, finishedMs: null, lastMs: null,
  pausedMs: 0, pausedAt: null, pauseNote: '', pauseLog: [], autoPausedOn: '',
  breakKey: '', breakPause: false, breakEndsAt: null, tickAt: null, ...load() };
if (!['idle', 'armed', 'running', 'finished'].includes(state.phase)) state.phase = 'idle';
// The target is always the picked bag size's fill standard.
const bagOf = key => PRESETS.find(p => p.key === key);
if (state.bag && !bagOf(state.bag)) state.bag = '';
// A queued order's basket keeps its own target (bags x fill, slice 2).
state.targetG = state.jobId && state.jobTargetG > 0 && state.bag ? state.jobTargetG : state.bag ? bagOf(state.bag).g : 0;
// A job needs both halves of its order: no cultivar or no bag size, nothing records.
const hasOrder = () => !!state.cultivar && !!bagOf(state.bag);
delete state.working; delete state.next;   // the old typed order fields
let cultivars = [];
let gross = null;       // grams, latest reading
let stable = null;      // the scale's settled flag, when it sends one
let battery = null;     // the scale node's battery { pct, mv, rssi } (firmware v6.5+), or null
let overSince = null;   // when net first reached the target this job
const watch = createLiftWatch(); // basket lifts: pickup or shake (lift.mjs)
const zero = createZeroWatch();  // drops to about 0: the scale's TARE, or an un-tared lift (lift.mjs)
let tareAt = null;               // when the last empty-basket TARE was taken (undone if it was a lift)
let live = false;
let timer = null;
// Disconnected: the Worker says the scale's last post is older than its stale
// time, or this tablet couldn't reach the Worker for that long.
let serverStale = false;
let staleAfterMs = 45000;
let failingSince = null;
const disconnected = () => serverStale || (failingSince !== null && Date.now() - failingSince >= staleAfterMs);

// End of day weighs (eod.mjs, Phase 1 scorecard): while the lead's panel is open
// the scale belongs to it. No job starts, no lift or pickup is read, and once it
// closes both watches start fresh so nothing is read off the weighs coming off.
const eod = createEod({
  api: API, station,
  isBusy: () => state.phase === 'running' || state.phase === 'finished',
  onOpen: () => { if (state.phase === 'armed') { state.phase = 'idle'; save(); } render(); },
  onClose: () => { watch.reset(); zero.reset(); tareAt = null; overSince = null; render(); },
});

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: still works for this visit */ }
}

const fmtG = g => `${g.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} g`;
function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
// Progress on the job: what is on the pan now, plus anything banked by a mid-job TARE.
const net = () => (gross === null ? 0 : Math.max(0, gross) + (state.bankedG || 0));
// Working time on the job: wall time minus every pause, including one in progress.
const elapsedMs = () => Date.now() - state.startedAt - (state.pausedMs || 0) - (state.pausedAt ? Date.now() - state.pausedAt : 0);
function clearPauses() {
  state.pausedMs = 0; state.pausedAt = null; state.pauseNote = ''; state.pauseLog = [];
  state.breakPause = false; state.breakEndsAt = null;
}
function pacificNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
const fmtTarget = g => `${g.toLocaleString('en-US', { maximumFractionDigits: 2 })} g`;

// The order: cultivar (the Shopify 2026 list, Sungrown only: cells run 2026 Sungrown tops) and bag size.
function renderOrder() {
  const opts = [...cultivars];
  if (state.cultivar && !opts.includes(state.cultivar)) opts.unshift(state.cultivar);
  el.cultivar.innerHTML = '';
  const first = document.createElement('option');
  first.value = ''; first.textContent = t('chooseCultivar');
  el.cultivar.appendChild(first);
  for (const c of opts) { const o = document.createElement('option'); o.value = c; o.textContent = c; el.cultivar.appendChild(o); }
  el.cultivar.value = state.cultivar || '';
  el.cultivar.classList.toggle('missing', !state.cultivar);
  el.bag.innerHTML = '';
  const none = document.createElement('option');
  none.value = ''; none.textContent = t('chooseBag');
  el.bag.appendChild(none);
  for (const p of PRESETS) {
    const o = document.createElement('option');
    o.value = p.key; o.textContent = `${t(p.key)} · ${fmtTarget(p.g)}`;
    el.bag.appendChild(o);
  }
  el.bag.value = state.bag || '';
  el.bag.classList.toggle('missing', !state.bag);
}
async function loadCultivars() {
  let history = [];
  try { history = (await (await fetch(`${API}?action=getCultivars`, { cache: 'no-store' })).json()).cultivars || []; } catch { /* stays short */ }
  let variants = [];
  try {
    const r = await fetch(`${API_ROOT}/pool?action=get_supersack_variants`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    const v = await r.json();
    variants = (v.data || v).variants || [];
  } catch { /* history only */ }
  cultivars = buildCultivarOptions(history, variants, { sungrownOnly: true });
  renderOrder();
}

function render() {
  el.name.textContent = `${t('cell')} ${station.replace(/^\D+/, '') || station}`;
  const n = net();
  const frac = state.targetG > 0 ? n / state.targetG : 0;
  el.net.textContent = gross === null ? '—' : fmtG(gross); // the scale's own number, nothing added
  el.targetText.textContent = state.targetG > 0 ? `${fmtTarget(state.targetG)} ${t('netHint')}` : '—';
  el.toGo.textContent = gross === null || !(state.targetG > 0) ? '—' : fmtG(Math.max(0, state.targetG - n));
  el.pct.textContent = `${Math.min(999, Math.round(frac * 100))}%`;
  el.ring.setAttribute('stroke-dashoffset', String(RING_LEN * (1 - Math.min(1, frac))));
  el.ring.classList.toggle('near', frac >= NEAR && frac < 1);
  el.ring.classList.toggle('over', frac > 1.02);

  el.dot.className = `live-dot ${live ? 'live' : 'stale'}`;
  el.liveText.textContent = disconnected() ? t('disconnected') : gross === null ? t('waiting') : live ? t('live') : t('stale');
  renderBattery();
  renderBanner();
  renderCycle();
  renderLock();
}

// The order can't change under a running or finished job (Koa 2026-11-10: hard
// restrictions): what it was recorded as is what was picked at Start. Idle or
// armed (nothing trimmed yet) it stays open, so the next order can be set after
// a pickup. A wrong pick mid-job means Hold to reset.
function renderLock() {
  const locked = orderLocked();
  if (el.cultivar.disabled !== locked) el.cultivar.disabled = locked;
  if (el.bag.disabled !== locked) el.bag.disabled = locked;
  el.orderLock.hidden = !locked;
}

// Scale node battery, beside the live dot. Red under BATT_LOW_PCT: charge it at
// the end of the shift (Koa gets a Telegram under 15%).
const BATT_LOW_PCT = 20;
function renderBattery() {
  const b = live ? battery : null;
  el.batt.hidden = !b || b.pct == null;
  if (el.batt.hidden) return;
  el.batt.textContent = `🔋 ${b.pct}%`;
  el.batt.title = `${t('battery')} ${(b.mv / 1000).toFixed(2)} V${b.rssi != null ? ` · Wi-Fi ${b.rssi} dBm` : ''}`;
  el.batt.classList.toggle('low', b.pct < BATT_LOW_PCT);
}

// One banner at a time, most urgent first.
function renderBanner() {
  let kind = null;
  if (disconnected()) kind = null;   // the dot says it; Koa gets the Telegram
  else if (live && state.phase === 'running' && gross < -LIFT_G) kind = 'off';
  else if (state.phase === 'running' && state.pausedAt && state.breakPause) kind = 'break';
  else if (state.phase === 'running' && state.pausedAt) kind = 'paused';
  else if ((state.phase === 'idle' || state.phase === 'armed') && breakAt(pacificMinutes(Date.now()))) kind = 'break';
  else if (state.phase === 'running' && state.tareFlagG > 0) kind = 'tared';
  else if ((state.phase === 'idle' || state.phase === 'armed') && !hasOrder()) kind = 'order';
  else if (live && state.phase === 'idle' && gross > ON_SCALE_G) kind = 'tare';
  el.banner.hidden = !kind;
  if (!kind) return;
  if (kind === 'break') {
    const b = breakAt(pacificMinutes(Date.now()));
    el.banner.className = 'banner break';
    el.banner.textContent = b ? t(b.kind === 'lunch' ? 'bannerLunch' : 'bannerBreak').replace('{to}', clockOf(b.end)) : state.pauseNote;
    return;
  }
  const text = t({ signal: 'bannerSignal', off: 'bannerOff', tare: 'bannerTare', paused: 'bannerPaused', tared: 'bannerTared', order: 'bannerOrder' }[kind])
    .replace('{g}', fmtG(state.tareFlagG || 0));
  // No job, no cultivar: whatever goes in the basket now is not recorded. Red,
  // pulsing, headed NOT RECORDING (Koa 2026-11-10: hard restrictions).
  if (kind === 'order' || kind === 'tare') {
    el.banner.className = 'banner notrec';
    el.banner.innerHTML = '';
    const b = document.createElement('b'); b.textContent = t('notRecording');
    el.banner.append(b, text);
    return;
  }
  el.banner.className = `banner ${kind}`;
  el.banner.textContent = text;
}

// Finish chime. Browsers only allow sound after a tap, so the Start tap unlocks it.
let audio = null;
function unlockAudio() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { audio = null; }
}
function chime() {
  if (!audio) return;
  try {
    const now = audio.currentTime;
    [[880, 0], [1320, 0.18]].forEach(([hz, at]) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine'; o.frequency.value = hz;
      g.gain.setValueAtTime(0.0001, now + at);
      g.gain.exponentialRampToValueAtTime(0.5, now + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.45);
      o.connect(g).connect(audio.destination);
      o.start(now + at); o.stop(now + at + 0.5);
    });
  } catch { /* no sound is never a reason to stop the job */ }
}

// Move the job along from the latest reading. Called after every poll.
function step() {
  if (gross === null) return;
  // A drop to about 0 with no lift between: someone pressing the scale's TARE,
  // or a basket lifted off a scale nobody tared (it reads 0, not negative).
  // zero (lift.mjs) waits for what comes back before it calls a loaded zero a TARE.
  const now = Date.now();
  const loaded = before => (state.phase === 'running' || state.phase === 'finished') && before + (state.bankedG || 0) > EMPTY_G;
  const z = zero.reading(now, gross, loaded);
  const lift = watch.reading(now, gross, net());
  if (z && z.kind === 'undoTare') {
    // The basket came back: that "TARE" was an un-tared lift of an empty basket.
    // Undo what it did (an armed or just-started job); the screen asks for a TARE again.
    if ((state.phase === 'armed' || state.phase === 'running') && tareAt !== null && (!state.startedAt || state.startedAt >= tareAt)) {
      state.phase = 'idle'; state.startedAt = null; state.finishedMs = null; overSince = null;
      state.bankedG = 0; state.tareFlagG = 0; clearPauses();
    }
    tareAt = null;
    save();
    return;
  }
  if (z && z.kind === 'pickup') {
    // A loaded basket off and the reading back about empty with no negative seen
    // (lift.mjs): the full basket went to the pickup spot and the matched empty
    // one went on. A pickup of what the job held, same as the lift rule.
    if (onLift({ kind: 'pickup', g: z.before + (state.bankedG || 0) })) { save(); return; }
  }
  if (z && z.kind === 'tare') {
    const before = z.before;
    tareAt = now;
    // A TARE right after a basket came back heavy: a new basket went on, so the
    // lift before it was a pickup (same rule as the Worker's hourly tops).
    const swap = watch.tare(now);
    if (swap && (state.phase === 'running' || state.phase === 'finished')) { closeJob(swap.g); save(); return; }
    if (state.phase === 'idle' && hasOrder()) {
      // Basket on, scale tared, order picked: the job is ready, same as tapping Start.
      state.phase = 'armed'; state.startedAt = null; state.finishedMs = null; overSince = null;
      state.bankedG = 0; state.tareFlagG = 0; clearPauses(); save();
      return;
    }
    if (state.phase === 'running') {
      // TARE pressed mid-job with tops in the basket: keep what was there, and say so.
      state.bankedG = (state.bankedG || 0) + before;
      state.tareFlagG = (state.tareFlagG || 0) + before;
      save();
    }
  }
  if (lift && onLift(lift)) { save(); return; }
  // Basket off the pan, or still coming down: nothing starts or finishes on it.
  if (watch.lifted) return;
  // Just after an empty-basket TARE, a basket-sized reading may be that basket
  // coming back (an un-tared lift): it never starts or finishes a job.
  if (zero.provisional && gross >= BASKET_MIN_G) return;
  if (state.phase === 'idle' && state.basketBack) { armIfReady(); if (state.phase === 'armed') { save(); return; } }
  const n = net();
  if (state.phase === 'running' && state.pausedAt) return; // a paused job waits for Resume
  if (state.phase === 'armed' && n >= START_G) {
    state.phase = 'running'; state.startedAt = Date.now(); state.finishedMs = null; overSince = null; clearPauses();
  } else if (state.phase === 'running') {
    if (n >= state.targetG) {
      if (overSince === null) overSince = Date.now();
      if (stable === true || Date.now() - overSince >= HOLD_MS) {
        state.phase = 'finished'; state.finishedMs = elapsedMs(); state.startedAt = null; state.finishedNetG = n;
        chime();
      }
    } else {
      overSince = null;
    }
  } else {
    return;
  }
  save();
}

// A lift settled (lift.mjs). Returns true when it changed the job.
//   Pickup, before or after the chime: the job closes with what the basket held,
//   and the next one is ready on the same basket (Koa 2026-11-10: the bagger's
//   cart takes tops on rounds, so a pickup before the target is normal).
//   Shake: the job carries on with what came back. After the chime, a basket
//   that shook out below the target goes back to running on the same clock.
function onLift(ev) {
  if (ev.kind === 'pickup') {
    if (state.phase !== 'running' && state.phase !== 'finished') return false;
    closeJob(ev.g);
    return true;
  }
  if (state.phase !== 'finished') return false;
  if (ev.backNet >= state.targetG) { state.finishedNetG = ev.backNet; return true; }
  state.phase = 'running';
  state.startedAt = Date.now() - (state.finishedMs || 0) - (state.pausedMs || 0);
  state.finishedMs = null; state.finishedNetG = null; overSince = null;
  return true;
}

// The pickup mark is the job's record: what it was, what the basket held and
// how long it took.
function closeJob(g) {
  const ms = state.phase === 'finished' ? state.finishedMs : state.startedAt ? elapsedMs() : null;
  // jobId: the queue job this basket was for (order flow slice 2); null when picked by hand.
  const jobId = state.jobId || null;
  const sent = mark('pickup', g / 1000, { cultivar: state.cultivar || null, bag: state.bag, cycleS: ms ? ms / 1000 : null, jobId });
  // The Worker closes the job and moves NEXT up; ask for the new NOW once it has.
  if (jobId) { closedJobs.set(jobId, Date.now()); state.jobId = null; sent.then(loadQueue); }
  state.lastMs = ms; state.finishedMs = null; state.finishedNetG = null; state.startedAt = null; overSince = null;
  state.tareFlagG = 0; clearPauses();
  // Every order is entered fresh (Koa 2026-11-10: "All orders for now need to be
  // re-inputted. shouldn't matter once auto assign is working"): the pickup
  // clears the order, and the next job records only once one is picked.
  if (ORDER_PER_JOB) { state.cultivar = ''; state.bag = ''; state.targetG = 0; renderOrder(); }
  // The basket is back on the tared scale, so once the order is there the next
  // job is ready with no Start tap. Crumbs in it (under 2 g) aren't the next job's tops.
  state.basketBack = true;
  state.bankedG = 0;
  state.phase = 'idle';
  armIfReady();
}

// After a pickup the basket is back about empty on the tared scale, so a fresh
// order is all the next job needs: picking it arms the job, no TARE or Start.
// At the start of the shift (no pickup yet) it's still TARE then Start.
function armIfReady() {
  if (!state.basketBack || state.phase !== 'idle' || !hasOrder() || !live || gross === null || Math.abs(gross) > ON_SCALE_G) return;
  state.phase = 'armed'; state.startedAt = null; state.finishedMs = null; overSince = null;
  state.bankedG = -Math.max(0, gross); state.tareFlagG = 0; state.basketBack = false; clearPauses();
}

function renderCycle() {
  el.cycleSub.className = 'sub';
  const running = state.phase === 'running' && !!state.startedAt;
  el.pauseBtn.hidden = !running || !!state.pausedAt;
  el.resumeBtn.hidden = !running || !state.pausedAt;
  if (state.phase === 'finished' && state.finishedMs !== null) {
    el.cycle.textContent = fmtClock(state.finishedMs);
    el.cycleSub.textContent = `${t('finished')} · ${t('liftOff')}`;
    return;
  }
  if (state.phase !== 'running' || !state.startedAt) {
    el.cycle.textContent = '--:--';
    const hint = state.phase === 'armed' ? t('armed') : t('tareToStart');
    // The finished time stays readable after the container leaves the scale.
    el.cycleSub.textContent = state.lastMs ? `${hint} · ${t('lastJob')} ${fmtClock(state.lastMs)}` : hint;
    return;
  }
  const elapsed = elapsedMs();
  el.cycle.textContent = fmtClock(elapsed);
  if (state.pausedAt) {
    el.cycleSub.textContent = `${t('paused')}: ${state.pauseNote}`;
    return;
  }
  if (disconnected()) { el.cycleSub.textContent = t('clockHeld'); return; }
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
  await read();
  if (eod.isOpen) eod.reading(live ? gross : null, stable);
  else if (live) step();   // disconnected: no job starts, nothing is logged
  render();
  const delay = disconnected() ? DOWN_MS : !live ? IDLE_MS
    : (state.phase === 'armed' || state.phase === 'running') ? JOB_MS : IDLE_MS;
  timer = setTimeout(poll, delay);
}

// One fresh reading from the Worker into gross / stable / live.
async function read() {
  try {
    const r = await fetch(`${API}?action=scaleWeight&stationId=${encodeURIComponent(station)}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));   // a Worker error is not the scale's fault
    const d = await r.json();
    failingSince = null;
    if (d && d.staleAfterS > 0) staleAfterMs = d.staleAfterS * 1000;
    if (d && d.updatedAt) {
      gross = Number(d.weight) * 1000; // the API's weight is always kg; unit is only a tag
      stable = d.stable === undefined ? null : d.stable;
      battery = d.battery || null;
      // The Worker judges staleness against the station's own stale time
      // (scale_stations.stale_after_s), with its own clock, not the tablet's.
      live = !d.isStale;
      serverStale = !!d.isStale;
    } else {
      live = false;
      serverStale = true;   // the scale has never posted
    }
  } catch {
    live = false;
    if (failingSince === null) failingSince = Date.now();
  }
}

function orderLocked() { return state.phase === 'running' || state.phase === 'finished'; }
el.cultivar.addEventListener('change', () => {
  if (orderLocked()) { renderOrder(); return; }   // locked: put the picker back
  state.cultivar = el.cultivar.value; armIfReady(); save(); renderOrder(); render();
});
// Picking a bag size sets the target. Only while no job is running (renderLock).
el.bag.addEventListener('change', () => {
  const p = bagOf(el.bag.value);
  if (orderLocked()) { renderOrder(); return; }
  state.bag = p ? p.key : ''; state.targetG = p ? p.g : 0; overSince = null;
  armIfReady(); save(); renderOrder(); render();
});
// The Worker only sees gross weight (basket included). Tare and pickup marks let
// it tell a pickup from a basket shaken out when it works out hourly tops
// (lib/cell-auto.js). Best effort, one retry: the job here never waits on it.
async function mark(kind, kg, job = {}) {
  const send = () => fetch(`${API}?action=scaleMark`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ stationId: station, kind, kg: Math.max(0, Math.round(kg * 100000) / 100000), ...job }),
  });
  try { const r = await send(); if (!r.ok && r.status >= 500) throw new Error(); } catch {
    setTimeout(() => send().catch(() => {}), 10000);
  }
}

// Tare arms the timer for a new job (and re-arms it mid-job if pressed again).
el.tare.addEventListener('click', async () => {
  unlockAudio();
  // A stray tap mid-job would wipe the timer: ask first.
  if (state.phase === 'running' && !window.confirm(t('confirmRetare'))) return;
  // Tare on a reading taken now, not the last poll (up to 5 s old), so a container
  // set down a moment ago is what gets zeroed. No live scale, no tare.
  await read();
  if (gross === null || !live) { render(); return; }
  // Every job needs its order: no cultivar or bag size, no start.
  if (!state.cultivar) { render(); el.cultivar.focus(); return; }
  if (!bagOf(state.bag)) { render(); el.bag.focus(); return; }
  // Start needs a tared scale: an untared basket would count as tops.
  if (Math.abs(gross) > ON_SCALE_G) { el.banner.hidden = false; el.banner.className = 'banner tare'; el.banner.textContent = t('bannerTare'); return; }
  state.phase = 'armed'; state.startedAt = null; state.finishedMs = null; overSince = null;
  state.bankedG = 0; state.tareFlagG = 0; state.basketBack = false; clearPauses();
  save(); render();
});

// Reset puts this job back to idle: timer, pauses and tare clear. Press and hold,
// so a stray tap can't do it; a running job also asks. Hour counts the Worker
// already logged are never touched.
const HOLD_RESET_MS = 1200;
el.resetBtn = $('resetBtn');
let holdTimer = null;
function resetJob() {
  if (state.phase === 'running' && !window.confirm(t('confirmReset'))) return;
  state.phase = 'idle'; state.bankedG = 0; state.tareFlagG = 0; state.startedAt = null; state.finishedMs = null; overSince = null;
  state.basketBack = false; clearPauses();
  save(); render();
}
// On a tablet the hold used to break (Koa 2026-11-09: "wonky and hard to get it
// to fill the bar all the way"): a finger that slid a little turned the press
// into a scroll (pointercancel), drifting off the button ended it (pointerleave),
// and Android's long-press menu cut in. Now the button keeps the pointer
// (setPointerCapture) wherever the finger drifts, the CSS turns off scrolling,
// selection and the long-press callout on it, and only lifting the finger ends
// the hold.
const holdLabel = () => el.resetBtn.querySelector('[data-i18n]');
let hintTimer = null;
function holdStart(e) {
  if (e.button > 0) return;
  e.preventDefault();
  try { el.resetBtn.setPointerCapture(e.pointerId); } catch { /* old browser: still works without */ }
  el.resetBtn.classList.add('holding');
  holdTimer = setTimeout(() => { holdTimer = null; el.resetBtn.classList.remove('holding'); resetJob(); }, HOLD_RESET_MS);
}
function holdEnd() {
  const early = holdTimer !== null;
  clearTimeout(holdTimer); holdTimer = null;
  el.resetBtn.classList.remove('holding');
  // Let go too soon: say so on the button itself for 2 s.
  if (early) {
    holdLabel().textContent = t('holdHint');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { holdLabel().textContent = t('holdReset'); }, 2000);
  }
}
el.resetBtn.addEventListener('pointerdown', holdStart);
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => el.resetBtn.addEventListener(ev, holdEnd));
el.resetBtn.addEventListener('contextmenu', e => e.preventDefault());
el.lang.addEventListener('click', () => setLang(getLang() === 'es' ? 'en' : 'es'));
document.addEventListener('ro:langchange', () => { el.lang.textContent = getLang() === 'es' ? 'EN' : 'ES'; renderOrder(); render(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { poll(); keepAwake(); } });

// Keep the tablet's screen on while the page is up, on battery too (Samsung's
// Stay awake only works while charging). The lock drops whenever the page is
// hidden, so it is asked for again each time the page comes back, and on any
// tap in case the browser wanted a gesture first. Unsupported: fails quietly.
let wakeLock = null;
async function keepAwake() {
  if (!('wakeLock' in navigator) || document.hidden || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    $('awake').hidden = false;
    wakeLock.addEventListener('release', () => { wakeLock = null; $('awake').hidden = true; });
  } catch { wakeLock = null; }
}
// Any tap turns sound on (browsers block it until one), so the finish chime
// works without the Start button.
document.addEventListener('pointerdown', () => { keepAwake(); unlockAudio(); });
keepAwake();
// endsAt: set for a break pause, the moment the break ends.
function pauseJob(note, endsAt = null) {
  if (state.phase !== 'running' || !state.startedAt || state.pausedAt) return;
  state.pausedAt = Date.now(); state.pauseNote = note;
  state.breakPause = endsAt !== null; state.breakEndsAt = endsAt; save(); render();
}
function resumeJob() {
  if (!state.pausedAt) return;
  const now = Date.now();
  // A break pause counts only to the break's end, even if the tablet slept past
  // it; any later break inside that gap is left out as well.
  const end = state.breakPause && state.breakEndsAt ? Math.min(now, state.breakEndsAt) : now;
  const ms = Math.max(0, end - state.pausedAt);
  state.pausedMs = (state.pausedMs || 0) + ms + (end < now ? breakMsBetween(end, now) : 0);
  (state.pauseLog = state.pauseLog || []).push({ note: state.pauseNote, ms, at: new Date(state.pausedAt).toISOString() });
  state.pausedAt = null; state.pauseNote = ''; state.breakPause = false; state.breakEndsAt = null; save(); render();
}

// Pause needs a reason: tap one, or write it.
function openPause() {
  el.chips.innerHTML = '';
  for (const key of REASONS) {
    const b = document.createElement('button');
    b.className = 'btn chip'; b.textContent = t(key);
    b.addEventListener('click', () => { el.note.value = t(key); el.noteErr.hidden = true; });
    el.chips.appendChild(b);
  }
  el.note.value = ''; el.noteErr.hidden = true; el.dialog.hidden = false; el.note.focus();
}
el.pauseBtn.addEventListener('click', openPause);
el.pauseCancel.addEventListener('click', () => { el.dialog.hidden = true; });
el.note.addEventListener('input', () => { el.noteErr.hidden = true; });
el.pauseOk.addEventListener('click', () => {
  const note = el.note.value.trim();
  if (note.length < NOTE_MIN_CHARS) { el.noteErr.hidden = false; el.note.focus(); return; }
  el.dialog.hidden = true;
  pauseJob(note);
});
el.resumeBtn.addEventListener('click', resumeJob);

// 4:20 pm Pacific: a job still running pauses itself for cleanup, once a day.
function autoPause() {
  const now = pacificNow();
  if (now.minutes >= AUTO_PAUSE_MIN && state.autoPausedOn !== now.day && state.phase === 'running' && !state.pausedAt) {
    state.autoPausedOn = now.day;
    pauseJob(t('autoNote'));
  }
}

// Breaks (breaks.mjs): a running job stops its clock when a break starts and
// starts again when it ends, with no tap. Resume during a break keeps the job
// running for the rest of that break; a pause the crew made themselves is theirs.
const breakText = (b, key) => t(key).replace('{from}', clockOf(b.start)).replace('{to}', clockOf(b.end));
function autoBreak() {
  const now = Date.now();
  const m = pacificMinutes(now);
  const b = breakAt(m);
  if (state.pausedAt && state.breakPause) {
    if (!b || now >= state.breakEndsAt) resumeJob();
    return;
  }
  if (!b || state.phase !== 'running' || !state.startedAt || state.pausedAt) return;
  const key = `${pacificNow().day}:${b.start}`;
  if (state.breakKey === key) return;
  state.breakKey = key;
  pauseJob(breakText(b, b.kind === 'lunch' ? 'lunchNote' : 'breakNote'), Math.round(now + (b.end - m) * 60000));
}
// A tablet that slept, or a page reopened, misses those ticks: the break time
// inside the gap is left out of the clock all the same.
function catchUpBreaks() {
  const now = Date.now();
  const from = state.tickAt || now;
  const running = state.phase === 'running' && !!state.startedAt && !state.pausedAt;
  if (running && now - from > 5000) state.pausedMs = (state.pausedMs || 0) + breakMsBetween(Math.max(from, state.startedAt), now);
  state.tickAt = now;
  if (running) save();
}

// A job running while the scale is disconnected holds its clock: the time is
// added to the paused time, so the saved cycle time leaves the outage out. It
// carries on by itself when posts resume, with no Resume tap.
let lastTickAt = Date.now();
function holdWhileDisconnected() {
  const now = Date.now();
  if (state.phase === 'running' && state.startedAt && !state.pausedAt && disconnected()) {
    state.pausedMs = (state.pausedMs || 0) + (now - lastTickAt);
    save();
  }
  lastTickAt = now;
}
// Report the job to the Worker so other computers see it on the Cells board
// (Koa 2026-11-09; cells.html, setCellState). Sent when anything on the job
// changes, and every 30 s anyway so the board can tell a tablet that's off.
// Best effort: the next change or heartbeat repairs a lost one.
const REPORT_EVERY_MS = 30000;
let lastReportKey = '';
let lastReportAt = 0;
function jobSnapshot() {
  const running = state.phase === 'running' && !!state.startedAt;
  const held = running && disconnected();
  const elapsed = running ? elapsedMs() : state.phase === 'finished' ? state.finishedMs : null;
  return {
    stationId: station, phase: state.phase, cultivar: state.cultivar || null, bag: state.bag || null, targetG: state.targetG || null,
    jobId: state.jobId || null,
    elapsedMs: elapsed == null ? null : Math.max(0, Math.round(elapsed)),
    paused: !!state.pausedAt || held,
    pauseNote: state.pausedAt ? state.pauseNote : held ? 'Scale disconnected' : null,
    finishedNetG: state.phase === 'finished' ? (state.finishedNetG ?? null) : null,
  };
}
function reportJob(force = false) {
  const snap = jobSnapshot();
  // A ticking clock isn't a change: the board ticks it from the start time.
  const ticking = snap.phase === 'running' && !snap.paused;
  const key = JSON.stringify({ ...snap, elapsedMs: ticking || snap.elapsedMs == null ? null : Math.floor(snap.elapsedMs / 1000) });
  if (!force && key === lastReportKey && Date.now() - lastReportAt < REPORT_EVERY_MS) return;
  lastReportKey = key; lastReportAt = Date.now();
  fetch(`${API}?action=setCellState`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(snap) })
    .catch(() => { lastReportKey = ''; });   // retry on the next tick
}
setInterval(() => { catchUpBreaks(); holdWhileDisconnected(); autoBreak(); autoPause(); renderCycle(); if (!document.hidden) reportJob(); }, 1000);

// A tablet left open keeps running the code it loaded (Koa 2026-11-10: Cell 1
// read "Tablet off" all morning while trimming). Every few minutes, ask Pages
// which build is current and reload onto it while no job is running. The order
// and timer live in localStorage, so a reload loses nothing.
const BUILD = new URL(import.meta.url).searchParams.get('h');
const BUILD_CHECK_MS = 3 * 60 * 1000;
async function checkBuild() {
  if (!BUILD || document.hidden || orderLocked() || watch.lifted) return;
  try {
    const r = await fetch(`${location.pathname}?build=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const m = (await r.text()).match(/js\/cell\/main\.js\?h=([0-9a-f]+)/);
    if (m && m[1] !== BUILD) location.reload();
  } catch { /* offline: try again next time */ }
}
setInterval(checkBuild, BUILD_CHECK_MS);

// Orders assigned to this cell (order flow slice 2): NOW is the order, NEXT is shown
// under it. Read every QUEUE_MS, and right after a pickup.
const QUEUE_MS = 5000;
// Jobs this tablet closed with a pickup -> when. If the Worker still shows one as
// NOW after LOST_PICKUP_MS, the pickup mark never landed: close it with jobDone
// (not a second pickup mark, which would count the tops twice in the hourly log).
const LOST_PICKUP_MS = 30000;
const closedJobs = new Map();
const jobDoneSent = new Set();
let queue = { now: null, next: null };
async function loadQueue() {
  try {
    const r = await fetch(`${API}?action=cellQueue&stationId=${encodeURIComponent(station)}`, { cache: 'no-store' });
    if (!r.ok) return;   // before migration 0061 (503) the screen works as it always has
    const d = await r.json();
    queue = { now: (d.cell && d.cell.now) || null, next: (d.cell && d.cell.next) || null };
  } catch { return; }
  const stuck = queue.now && closedJobs.has(queue.now.id) ? queue.now.id : null;
  if (stuck && Date.now() - closedJobs.get(stuck) > LOST_PICKUP_MS && !jobDoneSent.has(stuck)) {
    jobDoneSent.add(stuck);
    fetch(`${API}?action=jobDone`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ jobId: stuck }) })
      .then(() => loadQueue()).catch(() => jobDoneSent.delete(stuck));
  }
  for (const [id, at] of closedJobs) if (id !== stuck && Date.now() - at > 10 * 60000) { closedJobs.delete(id); jobDoneSent.delete(id); }
  const changed = applyQueue(state, queue.now, { locked: orderLocked(), closed: new Set(closedJobs.keys()), bagOk: k => !!bagOf(k) });
  if (changed) { overSince = null; armIfReady(); save(); renderOrder(); render(); }
  renderQueue();
}
function jobLine(j) {
  return `${shortCultivar(j.cultivar)} · ${t(j.bag)} × ${j.bags}`;
}
function renderQueue() {
  const now = state.jobId && queue.now && queue.now.id === state.jobId ? queue.now : null;
  el.queueCards.hidden = !now;
  el.orderPick.hidden = !!now;
  if (!now) return;
  el.nowOrder.textContent = now.orderName || '';
  el.nowWhat.textContent = jobLine(now);
  el.nowMeta.textContent = [
    now.baskets > 1 ? t('basketOf').replace('{n}', now.basketNo).replace('{m}', now.baskets) : '',
    now.rush ? t('rushTag') : '', now.changedInShopify ? t('changedShopify') : '',
  ].filter(Boolean).join(' · ');
  const next = queue.next;
  el.nextOrder.textContent = next ? next.orderName || '' : '';
  el.nextWhat.textContent = next ? jobLine(next) : t('nothingNext');
  el.nextMeta.textContent = next && next.cultivar !== now.cultivar ? t('newCultivar') : '';
}
setInterval(() => { if (!document.hidden) loadQueue(); }, QUEUE_MS);

el.lang.textContent = getLang() === 'es' ? 'EN' : 'ES';
eod.bindHold($('eodBtn'));
eod.resume();
save();
reportJob(true);
enhanceSelect(el.cultivar, { placeholder: () => t('searchCultivar') });
renderOrder();
render();
poll();
loadCultivars();
loadQueue();
