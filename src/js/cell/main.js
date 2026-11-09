/**
 * Cell table screen: live net weight toward a target, a job timer that runs
 * itself off the scale, and the working / next order typed in by hand for the pilot.
 *
 *   cell.html?station=table1
 *
 * Reads ?action=scaleWeight (GET, no token) once a second while the page is
 * visible and the scale is live, every 5 s while it is stale. Target,
 * orders and the timer live in this tablet's localStorage, per station, until
 * the cell job records (cell_chunks) exist on the Worker.
 */
import { registerLabels, setLang, getLang, t } from '../shared/i18n.js';

const PROD_API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production';
const FAST_MS = 1000;
const SLOW_MS = 5000;
const NEAR = 0.9;
// The job timer runs itself off the scale (Koa 2026-11-05: "couldn't it be automatic?"):
//   Start (or the scale's own TARE with the basket on) -> armed; the first START_G
//   of product starts the clock; reaching the
//   target and settling (stable flag, or HOLD_MS at/over target) stops it; lifting
//   the container off (net under half the target) closes the job, moves the next
//   order up and waits for the next Start.
const START_G = 1.0;     // two steps of the 0.5 g bench scale, so last-digit noise can't start it
const HOLD_MS = 3000;
// Fail-safes (Koa 2026-11-05: "make everything fool-proof"):
// Tare happens on the scale itself (Koa 2026-11-09): with the basket on, the crew
// press the scale's TARE, and the scale then sends NET weight. The screen shows
// exactly the number the scale shows (grams, 2 decimals), with no offset of its own.
// An empty tared basket reads about 0; a lifted basket reads negative.
const ON_SCALE_G = 2.0;  // more than this on an idle, untared scale -> "Tare on the scale, then tap Start"
const ZERO_G = 0.5;      // the scale's TARE reads 0.00: "about 0"
const LIFT_G = 1.0;      // below -1 g mid-job: the basket is off the scale
// Pauses (Koa 2026-11-05): a running job pauses itself at 4:20 pm Pacific (cleanup),
// and the Pause button only works with a note saying why. Paused time is left out
// of the cycle time.
const AUTO_PAUSE_MIN = 16 * 60 + 20;
const NOTE_MIN_CHARS = 3;
const REASONS = ['rScale', 'rWait', 'rEquip', 'rHelp'];
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
    of: 'of', toGo: 'To go', done: 'Done', startJob: 'Start', target: 'Target',
    customG: 'Custom (g)', liveCycle: 'Live cycle time', tareToStart: 'Tare on the scale, then tap Start',
    armed: 'Starts when product goes in', finished: 'Finished in', pace: 'g/min', eta: 'finish in',
    liftOff: 'lift it off for the next one', lastJob: 'Last job', awake: 'Screen stays on',
    holdReset: 'Hold to reset', holdHint: 'Keep holding to reset', confirmReset: 'A job is running. Reset it? The timer and the tare clear.',
    bannerTared: 'Scale TARE pressed mid-job: {g} kept. Tell the lead.',
    bannerTare: 'Tare on the scale, then tap Start', bannerOff: 'Container off the scale: put it back',
    bannerSignal: 'No scale signal: tell the lead', confirmRetare: 'A job is running. Start over from zero?',
    pause: 'Pause', resume: 'Resume', pauseTitle: 'Why are you pausing?', pauseOk: 'Pause job', cancel: 'Cancel',
    notePlaceholder: 'Write what happened', noteRequired: 'Write why first', paused: 'Paused',
    bannerPaused: 'Paused: tap Resume to keep going', autoNote: 'Cleanup 4:20',
    rScale: 'Scale problem', rWait: 'Waiting for product', rEquip: 'Equipment problem', rHelp: 'Need help',
    pilotNote: 'Pilot: orders are typed here until the order board is connected. The scale weight is live.',
    qOz: '¼ oz', hOz: '½ oz', oz1: '1 oz', qLb: '¼ lb', hLb: '½ lb', lb1: '1 lb', cell: 'Cell',
    netHint: 'net · container tared',
  },
  es: {
    waiting: 'Esperando la báscula', live: 'Báscula en vivo', stale: 'Sin señal de la báscula',
    workingOn: 'Trabajando en', workingPlaceholder: 'Orden · variedad · peso',
    nextOrder: 'Siguiente orden', nextPlaceholder: 'Siguiente orden · variedad · peso',
    of: 'de', toGo: 'Faltan', done: 'Hecho', startJob: 'Empezar', target: 'Meta',
    customG: 'Otra (g)', liveCycle: 'Tiempo de ciclo', tareToStart: 'Haga TARA en la báscula y toque Empezar',
    armed: 'Empieza al poner producto', finished: 'Terminado en', pace: 'g/min', eta: 'termina en',
    liftOff: 'quítelo para el siguiente', lastJob: 'Último trabajo', awake: 'Pantalla encendida',
    holdReset: 'Mantenga para reiniciar', holdHint: 'Siga presionando para reiniciar', confirmReset: 'Hay un trabajo en curso. ¿Reiniciarlo? El tiempo y la tara se borran.',
    bannerTared: 'TARA de la báscula a mitad del trabajo: se guardaron {g}. Avise al líder.',
    bannerTare: 'Haga TARA en la báscula y toque Empezar', bannerOff: 'El contenedor no está en la báscula: regréselo',
    bannerSignal: 'Sin señal de la báscula: avise al líder', confirmRetare: 'Hay un trabajo en curso. ¿Empezar de cero?',
    pause: 'Pausar', resume: 'Continuar', pauseTitle: '¿Por qué pausa?', pauseOk: 'Pausar trabajo', cancel: 'Cancelar',
    notePlaceholder: 'Escriba qué pasó', noteRequired: 'Escriba primero por qué', paused: 'En pausa',
    bannerPaused: 'En pausa: toque Continuar para seguir', autoNote: 'Limpieza 4:20',
    rScale: 'Problema con la báscula', rWait: 'Esperando producto', rEquip: 'Problema de equipo', rHelp: 'Necesito ayuda',
    pilotNote: 'Prueba: las órdenes se escriben aquí hasta conectar el tablero de órdenes. El peso de la báscula es en vivo.',
    qOz: '¼ oz', hOz: '½ oz', oz1: '1 oz', qLb: '¼ lb', hLb: '½ lb', lb1: '1 lb', cell: 'Celda',
    netHint: 'neto · contenedor en tara',
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

const $ = id => document.getElementById(id);
const el = {
  name: $('cellName'), dot: $('liveDot'), liveText: $('liveText'), lang: $('langToggle'),
  working: $('workingInput'), next: $('nextInput'),
  ring: $('ringFill'), net: $('netValue'), targetText: $('targetText'), toGo: $('toGo'), pct: $('pct'),
  tare: $('tareBtn'), presets: $('presets'), custom: $('customTarget'),
  cycle: $('cycleTime'), cycleSub: $('cycleSub'), banner: $('banner'),
  pauseBtn: $('pauseBtn'), resumeBtn: $('resumeBtn'), dialog: $('pauseDialog'), chips: $('pauseChips'),
  note: $('pauseNote'), noteErr: $('pauseError'), pauseOk: $('pauseOk'), pauseCancel: $('pauseCancel'),
};
const RING_LEN = 597;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
// phase: idle (needs a tare) -> armed -> running -> finished -> idle
const state = { working: '', next: '', targetG: 460.0, bankedG: 0, tareFlagG: 0, phase: 'idle', startedAt: null, finishedMs: null, lastMs: null,
  pausedMs: 0, pausedAt: null, pauseNote: '', pauseLog: [], autoPausedOn: '', ...load() };
if (!['idle', 'armed', 'running', 'finished'].includes(state.phase)) state.phase = 'idle';
let gross = null;       // grams, latest reading
let stable = null;      // the scale's settled flag, when it sends one
let overSince = null;   // when net first reached the target this job
let prevReading = null; // the reading before this one, to spot a scale TARE (a straight drop to 0)
let wentNegative = false; // a lift (negative) since the reading was last up
let tareCandidate = null;  // { from, since }: a drop to 0 waiting to prove it is a TARE
const TARE_HOLD_MS = 1800;
let live = false;
let timer = null;

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
function clearPauses() { state.pausedMs = 0; state.pausedAt = null; state.pauseNote = ''; state.pauseLog = []; }
function pacificNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
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
  el.net.textContent = gross === null ? '—' : fmtG(gross); // the scale's own number, nothing added
  el.targetText.textContent = `${fmtTarget(state.targetG)} ${t('netHint')}`;
  el.toGo.textContent = gross === null ? '—' : fmtG(Math.max(0, state.targetG - n));
  el.pct.textContent = `${Math.min(999, Math.round(frac * 100))}%`;
  el.ring.setAttribute('stroke-dashoffset', String(RING_LEN * (1 - Math.min(1, frac))));
  el.ring.classList.toggle('near', frac >= NEAR && frac < 1);
  el.ring.classList.toggle('over', frac > 1.02);

  el.dot.className = `live-dot ${gross === null ? 'stale' : live ? 'live' : 'stale'}`;
  el.liveText.textContent = gross === null ? t('waiting') : live ? t('live') : t('stale');
  renderBanner();
  renderCycle();
}

// One banner at a time, most urgent first.
function renderBanner() {
  let kind = null;
  if (!live && gross !== null) kind = 'signal';
  else if (live && state.phase === 'running' && gross < -LIFT_G) kind = 'off';
  else if (state.phase === 'running' && state.pausedAt) kind = 'paused';
  else if (state.phase === 'running' && state.tareFlagG > 0) kind = 'tared';
  else if (live && state.phase === 'idle' && gross > ON_SCALE_G) kind = 'tare';
  el.banner.hidden = !kind;
  if (!kind) return;
  el.banner.className = `banner ${kind}`;
  el.banner.textContent = t({ signal: 'bannerSignal', off: 'bannerOff', tare: 'bannerTare', paused: 'bannerPaused', tared: 'bannerTared' }[kind])
    .replace('{g}', fmtG(state.tareFlagG || 0));
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
  // A drop to about 0 with no lift between is someone pressing the scale's TARE.
  // The scale sends no settle flag and a basket being lifted passes through 0 on
  // its way negative, so the 0 must hold TARE_HOLD_MS (two polls) before it counts.
  const now = Date.now();
  if (gross < -LIFT_G) { wentNegative = true; tareCandidate = null; }
  else if (gross > ON_SCALE_G) wentNegative = false;
  if (!tareCandidate && prevReading !== null && prevReading > ON_SCALE_G && Math.abs(gross) <= ZERO_G && !wentNegative) {
    tareCandidate = { from: prevReading, since: now };
  } else if (tareCandidate && Math.abs(gross) > ZERO_G && now - tareCandidate.since < TARE_HOLD_MS) {
    tareCandidate = null;                       // didn't hold at 0: passing through
  }
  prevReading = gross;
  const confirmed = tareCandidate && Math.abs(gross) <= ZERO_G && now - tareCandidate.since >= TARE_HOLD_MS;
  if (confirmed) {
    const before = tareCandidate.from;
    tareCandidate = null;
    if (state.phase === 'idle') {
      // Basket on, scale tared: the job is ready, same as tapping Start.
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
  const n = net();
  if (state.phase === 'running' && state.pausedAt) return; // a paused job waits for Resume
  if (state.phase === 'armed' && n >= START_G) {
    state.phase = 'running'; state.startedAt = Date.now(); state.finishedMs = null; overSince = null; clearPauses();
  } else if (state.phase === 'running') {
    if (n >= state.targetG) {
      if (overSince === null) overSince = Date.now();
      if (stable === true || Date.now() - overSince >= HOLD_MS) {
        state.phase = 'finished'; state.finishedMs = elapsedMs(); state.startedAt = null; state.finishedNetG = n; state.panAtFinishG = gross;
        chime();
      }
    } else {
      overSince = null;
    }
  } else if (state.phase === 'finished' && gross < (state.panAtFinishG ?? state.targetG) / 2) {
    // The pan lost over half of what it held at the finish (a mid-job TARE may have
    // banked part of the job off the pan): the basket was lifted for pickup.
    // Container lifted off: the job is closed, the next order moves up.
    state.phase = 'idle'; state.lastMs = state.finishedMs; state.finishedMs = null; state.bankedG = 0; state.tareFlagG = 0;
    mark('pickup', (state.finishedNetG || 0) / 1000);
    state.working = state.next; state.next = '';
    el.working.value = state.working; el.next.value = '';
  } else {
    return;
  }
  save();
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
  if (live) step();
  render();
  timer = setTimeout(poll, live ? FAST_MS : SLOW_MS);
}

// One fresh reading from the Worker into gross / stable / live.
async function read() {
  try {
    const r = await fetch(`${API}?action=scaleWeight&stationId=${encodeURIComponent(station)}`, { cache: 'no-store' });
    const d = await r.json();
    if (d && d.updatedAt) {
      gross = Number(d.weight) * 1000; // the API's weight is always kg; unit is only a tag
      stable = d.stable === undefined ? null : d.stable;
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
}

el.working.value = state.working;
el.next.value = state.next;
el.working.addEventListener('input', () => { state.working = el.working.value; save(); });
el.next.addEventListener('input', () => { state.next = el.next.value; save(); });
// The Worker only sees gross weight (basket included). Tare and pickup marks let
// it tell a pickup from a basket shaken out when it works out hourly tops
// (lib/cell-auto.js). Best effort, one retry: the job here never waits on it.
async function mark(kind, kg) {
  const send = () => fetch(`${API}?action=scaleMark`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ stationId: station, kind, kg: Math.max(0, Math.round(kg * 100000) / 100000) }),
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
  // Start needs a tared scale: an untared basket would count as tops.
  if (Math.abs(gross) > ON_SCALE_G) { el.banner.hidden = false; el.banner.className = 'banner tare'; el.banner.textContent = t('bannerTare'); return; }
  state.phase = 'armed'; state.startedAt = null; state.finishedMs = null; overSince = null;
  state.bankedG = 0; state.tareFlagG = 0; clearPauses();
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
  state.phase = 'idle'; state.bankedG = 0; state.tareFlagG = 0; state.startedAt = null; state.finishedMs = null; overSince = null; clearPauses();
  save(); render();
}
function holdStart(e) {
  e.preventDefault();
  el.resetBtn.classList.add('holding');
  holdTimer = setTimeout(() => { holdEnd(); resetJob(); }, HOLD_RESET_MS);
}
function holdEnd() {
  clearTimeout(holdTimer); holdTimer = null;
  el.resetBtn.classList.remove('holding');
}
el.resetBtn.addEventListener('pointerdown', holdStart);
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => el.resetBtn.addEventListener(ev, holdEnd));
el.resetBtn.addEventListener('click', () => { if (!holdTimer) el.cycleSub.textContent = t('holdHint'); });
el.custom.addEventListener('change', () => {
  const v = parseFloat(el.custom.value);
  if (v > 0) { state.targetG = v; save(); renderPresets(); render(); }
});
el.lang.addEventListener('click', () => setLang(getLang() === 'es' ? 'en' : 'es'));
document.addEventListener('ro:langchange', () => { el.lang.textContent = getLang() === 'es' ? 'EN' : 'ES'; renderPresets(); render(); });
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
document.addEventListener('pointerdown', keepAwake);
keepAwake();
function pauseJob(note) {
  if (state.phase !== 'running' || !state.startedAt || state.pausedAt) return;
  state.pausedAt = Date.now(); state.pauseNote = note; save(); render();
}
function resumeJob() {
  if (!state.pausedAt) return;
  const ms = Date.now() - state.pausedAt;
  state.pausedMs = (state.pausedMs || 0) + ms;
  (state.pauseLog = state.pauseLog || []).push({ note: state.pauseNote, ms, at: new Date(state.pausedAt).toISOString() });
  state.pausedAt = null; state.pauseNote = ''; save(); render();
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

setInterval(() => { autoPause(); renderCycle(); }, 1000);

el.lang.textContent = getLang() === 'es' ? 'EN' : 'ES';
renderPresets();
render();
poll();
