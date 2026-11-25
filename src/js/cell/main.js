/**
 * Line trimmer scale screen (Koa 2026-11-24). The cells are over: the room is
 * back on buckers -> T-Zero -> trimmers, and every trimmer seat keeps a scale
 * and this screen.
 *
 *   cell.html?station=table3     the station is the seat (one manifest serves every seat)
 *
 *   · The trimmer taps their name when they sit down (the crew list Mis números
 *     uses). Moving seats means tapping again; the name holds for the day.
 *   · The cultivar is automatic: Hourly entry's line 1 cultivar for the current
 *     hour (lineState). A change mid-basket waits for the next basket.
 *   · A batch is one clock hour of the line (Koa 2026-11-24: "1 hour batch, not
 *     a 1lb batch"). The ring fills with the hour. At the hour mark: the chime,
 *     "ready for pickup" on the Cells board; basket A goes aside, B goes on, TARE,
 *     and the next batch starts by itself. A basket lifted early counts with its weight.
 *   · Tops per hour are measured, not counted: every gram is credited to the clock
 *     hour it was read in, per person and cultivar (line.mjs, seat.mjs), and sent
 *     to the Worker as absolute totals (lineScaleSave) for Hourly entry and Mis números.
 *
 * Reads ?action=scaleWeight (GET, no token) every second, every 2 s while the scale is disconnected,
 * every 5 s while the page is hidden. The basket and the hour totals live in this
 * tablet's localStorage (ro-line:<station>), so a reload loses nothing.
 */
import { registerLabels, setLang, getLang, t } from '../shared/i18n.js';
import { LIFT_G } from './lift.mjs';
import { breakAt, breakMsBetween, clockOf, pacificMinutes } from './breaks.mjs';
import { shortCultivar } from './queue.mjs';
import {
  G_PER_LB, hourGoalG, slotAt, lineCultivarAt, applyLineCultivar, personToday, createTally, tickMinutes, paceLbHr, batchOver, slotEnd, workingMinute,
} from './line.mjs';
import { createSeat, elapsedMs } from './seat.mjs';

const PROD_API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production';
// A batch is an hour, so nothing needs the cells' 250 ms: every seat is busy all
// day on the line, and 8 seats at 250 ms would be ~1.1M Worker reads a day. The
// lift and TARE rules (lift.mjs) hold at 1 s (tests/line-seat.test.mjs runs them there).
const JOB_MS = 1000;     // a batch is armed or running
const IDLE_MS = 1000;
const DOWN_MS = 2000;    // scale disconnected
const SLOW_MS = 5000;    // page hidden
const LINE_MS = 15000;   // Hourly entry's cultivar and this seat's name, read this often
const RATE_MS = 5 * 60000; // the line's lb per trimmer-hour (the hour's goal), read this often
const SEND_MS = 60000;   // the hour totals go to the Worker at least this often while they change
const RING_LEN = 597;
const CHIME_AGAIN_MS = 60000;   // the hour is done and no swap yet: chime again this often
const SWAP_DONE_MS = 4000;      // "Keep trimming" shows this long after the swap
const BASKET_OFF_G = -50;       // reading this low: the full basket is off the pan (an empty basket weighs ~168 g)

registerLabels({
  en: {
    waiting: 'Waiting for scale', live: 'Scale live', stale: 'No scale signal', disconnected: 'Scale disconnected',
    seat: 'Seat', awake: 'Screen stays on', battery: 'Scale node battery',
    tapName: 'Tap your name', notYou: 'Not you? Tap here', changeName: 'Change', whoTitle: 'Who is at this seat?',
    searchName: 'Type your name', leaveSeat: 'Nobody: leave the seat empty', cancel: 'Cancel', noCrew: 'No names yet. Tell the lead.',
    notListed: 'Not on the list? Tell the lead.',
    cultivar: 'Cultivar', fromHourly: 'from Hourly entry', waitHourly: 'Waiting for Hourly entry',
    newCvNext: 'New cultivar next batch: {c}',
    goalOf: 'of {lb} lb goal this hour', thisHourLb: 'this hour', onScale: 'On the scale', hourEnds: 'Batch ends',
    endsAt: '{t} · {m} min left', batchDone: 'Batch done',
    thisHour: 'This hour', today: 'Today at this seat', pace: 'Pace',
    baskets: '{n} batches', basket1: '1 batch', lbHr: 'lb/hr',
    holdReset: 'Hold to reset', holdHint: 'Keep holding to reset', confirmReset: 'A batch is running. Reset it? Its timer clears; the tops already counted stay.',
    bannerFull: 'Hour done! Set the basket aside for pickup. Put the empty basket on and press TARE.',
    bannerSwap: 'New basket on? Press TARE on the scale.',
    bannerOff: 'Basket off the scale: put the empty basket on, then TARE',
    bannerTare: 'Put the empty basket on and press TARE on the scale',
    bannerTared: 'Scale TARE pressed mid-batch: {g} kept. Tell the lead.',
    bannerName: 'Tap your name so your tops count for you',
    bannerReady: 'Ready: start trimming',
    bannerBreak: 'Break until {to}: the clock is stopped. It starts again by itself.',
    bannerLunch: 'Lunch until {to}: the clock is stopped. It starts again by itself.',
    breakNote: 'Break {from}–{to}', lunchNote: 'Lunch {from}–{to}',
    swapTitle: 'Hour done: swap baskets', swapTitleFull: 'Basket full (1 lb): swap baskets', swap1: 'Lift the full basket off and set it aside',
    swap2: 'Put the empty basket on the scale', swap3: 'Press TARE on the scale', swapDone: 'Done! Keep trimming',
    swapHeld: 'In the full basket: {lb} lb',
  },
  es: {
    waiting: 'Esperando la báscula', live: 'Báscula en vivo', stale: 'Sin señal de la báscula', disconnected: 'Báscula desconectada',
    seat: 'Puesto', awake: 'Pantalla encendida', battery: 'Batería del nodo de la báscula',
    tapName: 'Toque su nombre', notYou: '¿No es usted? Toque aquí', changeName: 'Cambiar', whoTitle: '¿Quién está en este puesto?',
    searchName: 'Escriba su nombre', leaveSeat: 'Nadie: dejar el puesto vacío', cancel: 'Cancelar', noCrew: 'Todavía no hay nombres. Avise al líder.',
    notListed: '¿No está en la lista? Avise al líder.',
    cultivar: 'Variedad', fromHourly: 'de la entrada por hora', waitHourly: 'Esperando la entrada por hora',
    newCvNext: 'Variedad nueva en el siguiente lote: {c}',
    goalOf: 'de {lb} lb de meta esta hora', thisHourLb: 'esta hora', onScale: 'En la báscula', hourEnds: 'El lote termina',
    endsAt: '{t} · faltan {m} min', batchDone: 'Lote terminado',
    thisHour: 'Esta hora', today: 'Hoy en este puesto', pace: 'Ritmo',
    baskets: '{n} lotes', basket1: '1 lote', lbHr: 'lb/h',
    holdReset: 'Mantenga para reiniciar', holdHint: 'Siga presionando para reiniciar', confirmReset: 'Hay un lote en curso. ¿Reiniciarlo? Su tiempo se borra; los tops ya contados se quedan.',
    bannerFull: '¡Hora terminada! Ponga la canasta aparte para recoger. Ponga la canasta vacía y presione TARA.',
    bannerSwap: '¿Canasta nueva? Presione TARA en la báscula.',
    bannerOff: 'Canasta fuera de la báscula: ponga la canasta vacía y luego TARA',
    bannerTare: 'Ponga la canasta vacía y presione TARA en la báscula',
    bannerTared: 'TARA de la báscula a mitad del lote: se guardaron {g}. Avise al líder.',
    bannerName: 'Toque su nombre para que sus tops cuenten para usted',
    bannerReady: 'Listo: empiece a trimear',
    bannerBreak: 'Descanso hasta las {to}: el reloj está parado. Sigue solo.',
    bannerLunch: 'Almuerzo hasta las {to}: el reloj está parado. Sigue solo.',
    breakNote: 'Descanso {from}–{to}', lunchNote: 'Almuerzo {from}–{to}',
    swapTitle: 'Hora terminada: cambie de canasta', swapTitleFull: 'Canasta llena (1 lb): cambie de canasta', swap1: 'Quite la canasta llena y póngala aparte',
    swap2: 'Ponga la canasta vacía en la báscula', swap3: 'Presione TARA en la báscula', swapDone: '¡Listo! Siga trimeando',
    swapHeld: 'En la canasta llena: {lb} lb',
  },
});

const params = new URLSearchParams(location.search);
// The home-screen app opens cell.html with no ?station=, so the tablet remembers its seat.
const STATION_KEY = 'ro-cell:station';
const clean = v => String(v || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 32);
function rememberedStation() { try { return localStorage.getItem(STATION_KEY); } catch { return null; } }
const station = clean(params.get('station')) || clean(rememberedStation()) || 'table1';
try { localStorage.setItem(STATION_KEY, station); } catch { /* private mode */ }
// Local testing only: ?api=http://localhost:8799/api/production. Never another host.
const apiParam = params.get('api') || '';
const API = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(apiParam) ? apiParam : PROD_API;
// A new key: the old cell screen's state (orders, continuous, changeovers) never loads into this one.
const KEY = `ro-line:${station}`;

const $ = id => document.getElementById(id);
const el = {
  name: $('seatName'), batt: $('batt'), dot: $('liveDot'), liveText: $('liveText'), lang: $('langToggle'), banner: $('banner'),
  whoBtn: $('whoBtn'), whoName: $('whoName'), whoHint: $('whoHint'),
  cv: $('cvName'), cvSub: $('cvSub'), cvNext: $('cvNext'),
  ring: $('ringFill'), net: $('netValue'), targetText: $('targetText'), toGo: $('toGo'), pct: $('pct'),
  dayLb: $('dayLb'), dayBaskets: $('dayBaskets'), pace: $('paceLb'),
  reset: $('resetBtn'), swap: $('swapGuide'), swapTitle: $('swapTitle'), swapSteps: $('swapSteps'), swapHeld: $('swapHeld'), swapDone: $('swapDone'),
  dialog: $('nameDialog'), search: $('nameSearch'), names: $('nameList'), leave: $('leaveSeat'), cancel: $('nameCancel'),
};

function pacificDate(ms = Date.now()) {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}
function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
const state = {
  phase: 'idle', cultivar: '', nextCultivar: '', person: null, seatSynced: false,
  bankedG: 0, basketG: 0, tareFlagG: 0, startedAt: null, finishedMs: null, finishedNetG: null, lastMs: null,
  pausedMs: 0, pausedAt: null, pauseNote: '', pauseLog: [], breakKey: '', breakPause: false, breakEndsAt: null, tickAt: null,
  basketBack: false, tally: null, ...load(),
};
if (!['idle', 'armed', 'running', 'finished'].includes(state.phase)) state.phase = 'idle';
let tally = createTally(state.tally, pacificDate());
state.tally = tally.data;
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: still works for this visit */ } }

let gross = null;       // grams, latest reading
let battery = null;
let live = false;
let timer = null;
let serverStale = false;
let staleAfterMs = 45000;
let failingSince = null;
const disconnected = () => serverStale || (failingSince !== null && Date.now() - failingSince >= staleAfterMs);
let lineHours = [];     // Hourly entry's line 1 cultivars by hour (lineState)
let lineCv = state.cultivar || '';
let crew = [];          // [{ id, name }] for the name tap
let lineRate = null;    // lb per trimmer-hour for the cultivar on the line (getProduction targetRate)

const me = () => personToday(state, pacificDate());
const myId = () => me()?.id || 0;
const slotOf = at => slotAt(pacificMinutes(at));

const seat = createSeat({
  state, tally: { credit: (...a) => tally.credit(...a), pickup: (...a) => tally.pickup(...a) },
  slotOf, hourOver: (at, key) => batchOver(pacificMinutes(at), key), personId: myId, lineCultivar: () => lineCv,
  on: {
    // The hour is done: the swap guide takes the screen (renderSwap) until the swap.
    finish: (reason) => { state.swap = { liftSeen: false, doneAt: null, heldG: net(), reason }; lastChimeAt = Date.now(); chime(); },
    pickup: ({ g, cultivar, cycleMs, personId }) => {
      if (state.swap && !state.swap.doneAt) state.swap.doneAt = Date.now();
      mark('pickup', g / 1000, { cultivar: cultivar || null, cycleS: cycleMs ? cycleMs / 1000 : null, personId: personId || null });
      setTimeout(sendHours, 1500);   // the hour's total right after a pickup
    },
  },
});

const fmtG = g => `${g.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} g`;
const fmtLb = g => (Math.max(0, g) / G_PER_LB).toFixed(2);
const net = () => (gross === null ? 0 : seat.net(gross));

// ---- Render
function render() {
  el.name.textContent = `${t('seat')} ${station.replace(/^\D+/, '') || station}`;
  renderWho();
  renderCultivar();
  const now = Date.now();
  // The circle (Koa 2026-11-24): this hour's tops toward this trimmer's goal for
  // the hour, green once it's met. First thing in the morning: empty, "0.00 lb of
  // 1.10 lb goal". Without a rate yet it fills toward 1 lb.
  const slot = slotOf(now);
  const hourG = tally.hourG(slot, myId());
  const goalG = hourGoalG(lineRate, slot);
  const fullG = goalG || G_PER_LB;
  const frac = Math.min(1, hourG / fullG);
  el.net.textContent = `${fmtLb(hourG)} lb`;
  el.targetText.textContent = goalG ? t('goalOf').replace('{lb}', fmtLb(goalG)) : t('thisHourLb');
  el.toGo.textContent = gross === null ? '—' : fmtG(gross);   // the scale's own number, for TARE checks
  const key = state.batchSlot || slot;
  const done = state.phase === 'finished';
  const end = slotEnd(key);
  const left = end === null ? null : Math.max(0, Math.ceil(end - pacificMinutes(now)));
  el.pct.textContent = done ? t('batchDone') : end === null ? '—' : t('endsAt').replace('{t}', clockOf(end)).replace('{m}', left);
  el.ring.setAttribute('stroke-dashoffset', String(RING_LEN * (1 - frac)));
  el.ring.classList.toggle('full', hourG >= fullG);
  el.dot.className = `live-dot ${live ? 'live' : 'stale'}`;
  el.liveText.textContent = disconnected() ? t('disconnected') : gross === null ? t('waiting') : live ? t('live') : t('stale');
  renderBattery();
  renderBanner();
  renderTiles();
  renderSwap();
}

// ---- The swap guide (Koa 2026-11-24: "make sure everything is very easy and
// stream-lined for the trimmer"). At the hour mark it covers the screen with the
// three steps and ticks each one off as the scale sees it; the swap closes the
// batch and it says "Keep trimming" and gets out of the way.
function swapStep(now) {
  const s = state.swap;
  if (!s) return 0;
  if (s.doneAt) return now - s.doneAt < SWAP_DONE_MS ? 4 : 0;
  if (state.phase !== 'finished') return 0;
  if (gross !== null && gross <= BASKET_OFF_G) s.liftSeen = true;
  if (!s.liftSeen) return 1;
  return gross !== null && gross <= BASKET_OFF_G ? 2 : 3;
}
function renderSwap() {
  const now = Date.now();
  const step = swapStep(now);
  if (!step && state.swap && (state.swap.doneAt || state.phase !== 'finished')) { state.swap = null; save(); }
  el.swap.hidden = !step;
  if (!step) return;
  el.swapDone.hidden = step !== 4;
  el.swapSteps.hidden = step === 4;
  el.swapHeld.hidden = step === 4;
  el.swapTitle.textContent = t(state.swap.reason === 'full' ? 'swapTitleFull' : 'swapTitle');
  el.swapHeld.textContent = t('swapHeld').replace('{lb}', fmtLb(state.swap.heldG || state.finishedNetG || 0));
  [...el.swapSteps.children].forEach((li, i) => {
    li.className = i + 1 < step ? 'done' : i + 1 === step ? 'now' : '';
    li.querySelector('.txt').textContent = t(`swap${i + 1}`);
  });
}

function renderWho() {
  const p = me();
  el.whoBtn.classList.toggle('missing', !p);
  el.whoName.textContent = p ? p.name : t('tapName');
  el.whoHint.textContent = p ? t('notYou') : '';
  el.whoHint.hidden = !p;
}

function renderCultivar() {
  el.cv.textContent = state.cultivar ? shortCultivar(state.cultivar) : t('waitHourly');
  el.cv.classList.toggle('none', !state.cultivar);
  el.cvSub.textContent = state.cultivar ? t('fromHourly') : '';
  el.cvNext.hidden = !state.nextCultivar;
  el.cvNext.textContent = t('newCvNext').replace('{c}', shortCultivar(state.nextCultivar));
}

function renderTiles() {
  const id = myId();
  el.dayLb.textContent = `${fmtLb(tally.dayG(id))} lb`;
  const picks = tally.picks(id);
  el.dayBaskets.textContent = picks === 1 ? t('basket1') : t('baskets').replace('{n}', picks);
  const pace = id ? paceLbHr(tally.dayG(id), tally.dayMin(id)) : null;
  el.pace.textContent = pace === null ? '—' : `${pace.toFixed(2)} ${t('lbHr')}`;
}

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
  const now = Date.now();
  const b = breakAt(pacificMinutes(now));
  let kind = null;
  if (disconnected() || gross === null || swapStep(now)) kind = null;   // the dot says it; the swap guide says the rest
  else if (seat.swapPending(now)) kind = 'swap';
  else if (state.phase === 'finished') kind = 'full';
  else if (live && (state.phase === 'running' || seat.lifted) && gross < -LIFT_G) kind = 'off';
  else if (b) kind = 'break';
  else if (state.phase === 'running' && state.tareFlagG > 0) kind = 'tared';
  else if (state.phase === 'idle') kind = 'tare';
  else if (!me()) kind = 'name';
  else if (state.phase === 'armed' && net() < 1) kind = 'ready';   // tared, name in, nothing trimmed yet
  el.banner.hidden = !kind;
  if (!kind) return;
  if (kind === 'break') {
    el.banner.className = 'banner break';
    el.banner.textContent = t(b.kind === 'lunch' ? 'bannerLunch' : 'bannerBreak').replace('{to}', clockOf(b.end));
    return;
  }
  el.banner.className = `banner ${kind}`;
  el.banner.textContent = t({ swap: 'bannerSwap', full: 'bannerFull', off: 'bannerOff', tared: 'bannerTared', tare: 'bannerTare', name: 'bannerName', ready: 'bannerReady' }[kind])
    .replace('{g}', fmtG(state.tareFlagG || 0));
}

// ---- Finish chime. Browsers only allow sound after a tap; any tap unlocks it.
let audio = null;
let lastChimeAt = 0;
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
  } catch { /* no sound is never a reason to stop */ }
}

// ---- The scale
async function poll() {
  clearTimeout(timer);
  // Hidden: no fetch, but a slow retry stays alive (a page loaded hidden may never get visibilitychange).
  if (document.hidden) { timer = setTimeout(poll, SLOW_MS); return; }
  await read();
  if (live && gross !== null) { if (seat.reading(Date.now(), gross)) save(); }
  render();
  const delay = disconnected() ? DOWN_MS : !live ? IDLE_MS
    : (state.phase === 'armed' || state.phase === 'running') ? JOB_MS : IDLE_MS;
  timer = setTimeout(poll, delay);
}
async function read() {
  try {
    const r = await fetch(`${API}?action=scaleWeight&stationId=${encodeURIComponent(station)}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const d = await r.json();
    failingSince = null;
    if (d && d.staleAfterS > 0) staleAfterMs = d.staleAfterS * 1000;
    if (d && d.updatedAt) {
      gross = Number(d.weight) * 1000;   // the API's weight is always kg
      battery = d.battery || null;
      live = !d.isStale;
      serverStale = !!d.isStale;
    } else {
      live = false;
      serverStale = true;
    }
  } catch {
    live = false;
    if (failingSince === null) failingSince = Date.now();
  }
}

// ---- The Worker: marks, the hour totals, the seat
async function postJson(action, body) {
  const r = await fetch(`${API}?action=${action}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}
// Pickup marks keep the record of every basket (and feed the Cells board). Best effort, one retry.
async function mark(kind, kg, job = {}) {
  const body = { stationId: station, kind, kg: Math.max(0, Math.round(kg * 100000) / 100000), ...job };
  try { await postJson('scaleMark', body); } catch { setTimeout(() => postJson('scaleMark', body).catch(() => {}), 10000); }
}
let sending = false;
async function sendHours() {
  if (sending) return;
  const { rows, keys } = tally.takeDirty();
  if (!rows.length) return;
  sending = true;
  save();
  try {
    for (let i = 0; i < rows.length; i += 50) await postJson('lineScaleSave', { stationId: station, date: tally.data.day, rows: rows.slice(i, i + 50) });
  } catch {
    tally.markDirty(keys);   // the next send carries them
  } finally { sending = false; save(); }
}
async function seedHours() {
  if (!tally.empty) return;
  try {
    const d = await (await fetch(`${API}?action=lineScaleSeat&stationId=${encodeURIComponent(station)}&date=${tally.data.day}`, { cache: 'no-store' })).json();
    const rows = (d.data || d).rows || [];
    if (tally.empty && rows.length) { tally.seed(rows); save(); render(); }
  } catch { /* starts from 0 here; the Worker keeps its own totals until this seat sends */ }
}
async function loadCrew() {
  try {
    const d = await (await fetch(`${API}?action=lineCrew`, { cache: 'no-store' })).json();
    crew = (d.data || d).people || [];
  } catch { /* the dialog says to tell the lead */ }
  if (!el.dialog.hidden) renderNames();
}
async function syncSeat() {
  const sent = me()?.id || 0;
  try {
    await postJson('lineSeat', { stationId: station, personId: sent });
    if ((me()?.id || 0) === sent) { state.seatSynced = !!sent; save(); }
  } catch { state.seatSynced = false; save(); }
}
// The line's lb per trimmer-hour for the cultivar on the line: the same target
// Hourly entry gives each hour (getProduction targetRate). Public, read-only.
async function loadRate() {
  try {
    const r = await fetch(`${API}?action=getProduction&date=${pacificDate()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const d = await r.json();
    const rate = Number((d.data || d).targetRate);
    if (rate > 0) { lineRate = rate; render(); }
  } catch { /* keeps the last rate; with none the circle fills toward 1 lb */ }
}

async function loadLine() {
  try {
    const r = await fetch(`${API}?action=lineState&stationId=${encodeURIComponent(station)}`, { cache: 'no-store' });
    if (!r.ok) return;
    const d = await r.json();
    const s = d.data || d;
    lineHours = s.hours || [];
    // The name went to another seat (or the lead cleared it): this seat is empty now.
    const p = me();
    if (p && state.seatSynced && (!s.seat || s.seat.personId !== p.id)) { state.person = null; state.seatSynced = false; }
    else if (p && !state.seatSynced) syncSeat();
  } catch { return; }
  lineCv = lineCultivarAt(lineHours, pacificMinutes(Date.now()));
  applyLineCultivar(state, lineCv);
  save();
  render();
}

// ---- Name tap
function renderNames() {
  const q = el.search.value.trim().toLowerCase();
  el.names.innerHTML = '';
  const list = crew.filter(p => !q || p.name.toLowerCase().includes(q));
  if (!crew.length) {
    const p = document.createElement('p'); p.className = 'muted'; p.textContent = t('noCrew'); el.names.append(p);
    return;
  }
  for (const p of list) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn name-btn'; b.textContent = p.name;
    if (me()?.id === p.id) b.classList.add('on');
    b.addEventListener('click', () => pickName(p));
    el.names.append(b);
  }
}
function openNames() {
  el.search.value = '';
  renderNames();
  el.dialog.hidden = false;
  loadCrew();
}
function pickName(p) {
  el.dialog.hidden = true;
  state.person = p ? { id: p.id, name: p.name, day: pacificDate() } : null;
  state.seatSynced = false;
  // On a tared empty basket the first basket is ready with no other tap.
  if (p && live && gross !== null) seat.start(gross);
  save(); render();
  syncSeat();
  sendHours();   // the old name's totals go before the new name's start
}
el.whoBtn.addEventListener('click', openNames);
el.search.addEventListener('input', renderNames);
el.leave.addEventListener('click', () => pickName(null));
el.cancel.addEventListener('click', () => { el.dialog.hidden = true; });

// ---- Hold to reset: the basket goes back to idle. The tops already counted stay.
const HOLD_RESET_MS = 1200;
let holdTimer = null;
let hintTimer = null;
const holdLabel = () => el.reset.querySelector('[data-i18n]');
function resetBasket() {
  if (state.phase === 'running' && !window.confirm(t('confirmReset'))) return;
  seat.reset();
  save(); render();
}
function holdStart(e) {
  if (e.button > 0) return;
  e.preventDefault();
  try { el.reset.setPointerCapture(e.pointerId); } catch { /* old browser */ }
  el.reset.classList.add('holding');
  holdTimer = setTimeout(() => { holdTimer = null; el.reset.classList.remove('holding'); resetBasket(); }, HOLD_RESET_MS);
}
function holdEnd() {
  const early = holdTimer !== null;
  clearTimeout(holdTimer); holdTimer = null;
  el.reset.classList.remove('holding');
  if (early) {
    holdLabel().textContent = t('holdHint');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { holdLabel().textContent = t('holdReset'); }, 2000);
  }
}
el.reset.addEventListener('pointerdown', holdStart);
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => el.reset.addEventListener(ev, holdEnd));
el.reset.addEventListener('contextmenu', e => e.preventDefault());
el.lang.addEventListener('click', () => setLang(getLang() === 'es' ? 'en' : 'es'));
document.addEventListener('ro:langchange', () => { el.lang.textContent = getLang() === 'es' ? 'EN' : 'ES'; if (!el.dialog.hidden) renderNames(); render(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) sendHours();
  else { poll(); keepAwake(); loadLine(); }
});

// ---- Screen on (Samsung's Stay awake only works while charging)
let wakeLock = null;
async function keepAwake() {
  if (!('wakeLock' in navigator) || document.hidden || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    $('awake').hidden = false;
    wakeLock.addEventListener('release', () => { wakeLock = null; $('awake').hidden = true; });
  } catch { wakeLock = null; }
}
document.addEventListener('pointerdown', () => { keepAwake(); unlockAudio(); });
keepAwake();

// ---- Breaks (breaks.mjs): a running basket's clock stops for a break and starts again after it.
function pauseBasket(note, endsAt) {
  if (state.phase !== 'running' || !state.startedAt || state.pausedAt) return;
  state.pausedAt = Date.now(); state.pauseNote = note; state.breakPause = true; state.breakEndsAt = endsAt; save();
}
function resumeBasket() {
  if (!state.pausedAt) return;
  const now = Date.now();
  const end = state.breakEndsAt ? Math.min(now, state.breakEndsAt) : now;
  state.pausedMs = (state.pausedMs || 0) + Math.max(0, end - state.pausedAt) + (end < now ? breakMsBetween(end, now) : 0);
  state.pausedAt = null; state.pauseNote = ''; state.breakPause = false; state.breakEndsAt = null; save();
}
const breakText = (b, key) => t(key).replace('{from}', clockOf(b.start)).replace('{to}', clockOf(b.end));
function autoBreak() {
  const now = Date.now();
  const m = pacificMinutes(now);
  const b = breakAt(m);
  if (state.pausedAt) { if (!b || now >= state.breakEndsAt) resumeBasket(); return; }
  if (!b || state.phase !== 'running' || !state.startedAt) return;
  const key = `${pacificDate(now)}:${b.start}`;
  if (state.breakKey === key) return;
  state.breakKey = key;
  pauseBasket(breakText(b, b.kind === 'lunch' ? 'lunchNote' : 'breakNote'), Math.round(now + (b.end - m) * 60000));
}
// A tablet that slept, or a page reopened, leaves the break time in the gap out of the clock too.
function catchUpBreaks() {
  const now = Date.now();
  const from = state.tickAt || now;
  const running = state.phase === 'running' && !!state.startedAt && !state.pausedAt;
  if (running && now - from > 5000) state.pausedMs = (state.pausedMs || 0) + breakMsBetween(Math.max(from, state.startedAt), now);
  state.tickAt = now;
}
// A basket running while the scale is disconnected holds its clock.
let lastTickAt = Date.now();
function holdWhileDisconnected(now) {
  if (state.phase === 'running' && state.startedAt && !state.pausedAt && disconnected()) state.pausedMs = (state.pausedMs || 0) + (now - lastTickAt);
}

// ---- Minutes seated (pace on Mis números): only with a name, only working minutes.
let minuteTickAt = Date.now();   // not saved: time the page was closed is never counted
function countMinutes(now) {
  const id = myId();
  const min = id ? tickMinutes(minuteTickAt, now, pacificMinutes, breakAt) : 0;
  minuteTickAt = now;
  if (min > 0) tally.addMin(slotOf(now), id, state.cultivar, min);
}

// A new Pacific day: send what is left of yesterday, then start a fresh tally.
async function rollDay() {
  const day = pacificDate();
  if (tally.data.day === day) return;
  await sendHours();
  tally = createTally(null, day);
  state.tally = tally.data;
  personToday(state, day);
  freshBasketDay();
  save(); render();
}

// A new day starts clean: yesterday's batch (finished at 4:30, or left running)
// and its swap guide never carry into the morning. The morning is: tap your
// name, empty basket on, TARE, "Ready: start trimming". Yesterday's tops were
// already credited to yesterday's hours.
function freshBasketDay() {
  const day = pacificDate();
  if (state.basketDay === day) return;
  if (state.basketDay) { seat.reset(); state.swap = null; state.nextCultivar = ''; }
  state.basketDay = day;
}

// Report the basket to the Cells board (cells.html): a finished basket shows
// "ready for pickup" there. Sent on change and every 30 s.
const REPORT_EVERY_MS = 30000;
let lastReportKey = '';
let lastReportAt = 0;
function reportBasket(force = false) {
  const running = state.phase === 'running' && !!state.startedAt;
  const held = running && disconnected();
  const elapsed = running ? elapsedMs(state, Date.now()) : state.phase === 'finished' ? state.finishedMs : null;
  const snap = {
    stationId: station, phase: state.phase, cultivar: state.cultivar || null, bag: null, targetG: null,
    elapsedMs: elapsed == null ? null : Math.max(0, Math.round(elapsed)),
    paused: !!state.pausedAt || held, pauseNote: state.pausedAt ? state.pauseNote : held ? 'Scale disconnected' : null,
    finishedNetG: state.phase === 'finished' ? (state.finishedNetG ?? null) : null,
  };
  const ticking = snap.phase === 'running' && !snap.paused;
  const k = JSON.stringify({ ...snap, elapsedMs: ticking || snap.elapsedMs == null ? null : Math.floor(snap.elapsedMs / 1000) });
  if (!force && k === lastReportKey && Date.now() - lastReportAt < REPORT_EVERY_MS) return;
  lastReportKey = k; lastReportAt = Date.now();
  postJson('setCellState', snap).catch(() => { lastReportKey = ''; });
}

let lastSlot = slotOf(Date.now());
let lastSendAt = Date.now();
setInterval(() => {
  const now = Date.now();
  rollDay();
  catchUpBreaks();
  holdWhileDisconnected(now);
  lastTickAt = now;
  autoBreak();
  countMinutes(now);
  // The hour mark sends the hour that just ended; otherwise once a minute while it changes.
  const slot = slotOf(now);
  if (slot !== lastSlot || now - lastSendAt >= SEND_MS) { lastSlot = slot; lastSendAt = now; sendHours(); }
  save();
  renderTiles(); renderSwap();
  // The hour is done and the basket hasn't been swapped: chime again every minute.
  // Working minutes only: a 4:30 batch nobody swapped never chimes into the night, nor through lunch.
  if (state.phase === 'finished' && now - lastChimeAt >= CHIME_AGAIN_MS && workingMinute(pacificMinutes(now), breakAt)) { lastChimeAt = now; chime(); }
  if (!document.hidden) reportBasket();
}, 1000);
setInterval(() => { if (!document.hidden) loadLine(); }, LINE_MS);
setInterval(() => { if (!document.hidden) loadRate(); }, RATE_MS);

// A tablet left open keeps running the code it loaded: every few minutes, reload
// onto the current build while no basket is running. Everything lives in localStorage.
const BUILD = new URL(import.meta.url).searchParams.get('h');
const BUILD_CHECK_MS = 3 * 60 * 1000;
async function checkBuild() {
  // On the line a seat is running all day, so a running batch may reload too (it
  // lives in localStorage), but never mid-lift, mid-swap or with the swap guide up.
  const now = Date.now();
  if (!BUILD || document.hidden || state.phase === 'finished' || seat.lifted || seat.swapPending(now) || seat.provisional || !el.dialog.hidden) return;
  try {
    const r = await fetch(`${location.pathname}?build=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const m = (await r.text()).match(/js\/cell\/main\.js\?h=([0-9a-f]+)/);
    if (m && m[1] !== BUILD) { await sendHours(); location.reload(); }
  } catch { /* offline: try again next time */ }
}
setInterval(checkBuild, BUILD_CHECK_MS);

el.lang.textContent = getLang() === 'es' ? 'EN' : 'ES';
personToday(state, pacificDate());
freshBasketDay();
save();
reportBasket(true);
render();
poll();
loadLine();
loadRate();
loadCrew();
seedHours();
if (me() && !state.seatSynced) syncSeat();
// No name yet: ask right away (Koa 2026-11-24: tap your name when you sit down).
if (!me()) openNames();
