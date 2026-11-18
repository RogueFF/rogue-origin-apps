/**
 * Crew Top 5 panel + TV rotation to the crew board (Koa 2026-11-17).
 * Rules and timings live in leaders-logic.js. This file only touches the DOM.
 *
 *   · reads the public GET /api/production?action=crewBoard every 5 min
 *   · a failed or empty read hides the panel and skips the rotation; the TV
 *     never shows an error
 *   · the rotation preloads crew-board.html?tv=1 in a hidden same-origin frame,
 *     shows it only once the board has rows, and removes it after the show
 */
import { registerLabels, getLang, t } from '../shared/i18n.js';
import {
  LABELS, REFRESH_MS, FETCH_TIMEOUT_MS, ROTATE_EVERY_MS, ROTATE_SHOW_MS, ROTATE_RETRY_MS,
  PRELOAD_MS, READY_TIMEOUT_MS, panelModel, pacificToday, fmtDay, fill, shouldRotate, localApi, crewBoardUrl,
} from './leaders-logic.js';

registerLabels(LABELS);

const PROD_API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api';
const params = new URLSearchParams(location.search);
const API = localApi(params.get('api')) || PROD_API;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let model = null;
let lastReply = null;   // kept so the day re-picks at midnight without a new fetch
let lastInput = 0;

// ---------- panel ----------
function render() {
  // the latest workday BEFORE today (Koa 2026-11-18: "based off of yesterdays numbers")
  model = lastReply ? panelModel(lastReply, pacificToday()) : null;
  const panel = $('leadersPanel');
  if (!panel) return;
  if (!model) { panel.hidden = true; return; }
  const lang = getLang();
  $('leadersTitle').textContent = t('ldrTitle');
  $('leadersDay').textContent = fmtDay(model.day, lang);
  const goal = $('leadersGoal');
  goal.hidden = !model.goal;
  goal.textContent = model.goal ? fill(t('ldrGoal'), { lb: model.goal.lb }) : '';
  $('leadersList').innerHTML = model.rows.map((r) => `
    <li class="ldr-card r${r.rank}${r.overGoal ? ' over' : ''}">
      <span class="ldr-rank" aria-hidden="true">${r.rank}</span>
      <span class="ldr-name">${esc(r.name)}</span>
      <span class="ldr-val">${r.lb}</span>
      <span class="ldr-g">${r.gph !== null ? esc(fill(t('ldrGrams'), { g: r.gph })) : ''}${r.overGoal ? `<em title="${esc(t('ldrOverGoal'))}">&#9650;</em>` : ''}</span>
    </li>`).join('');
  panel.hidden = false;
}

async function load() {
  try {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS) : null;
    const res = await fetch(`${API}/production?action=crewBoard`, { cache: 'no-store', referrerPolicy: 'no-referrer', signal: ctl?.signal });
    if (timer) clearTimeout(timer);
    if (!res.ok) throw new Error(String(res.status));
    lastReply = await res.json();
  } catch {
    lastReply = null;       // hide the panel; the rotation skips too
  }
  render();
}

// ---------- rotation (TV only) ----------
const BUSY = [
  'body.morning-report-active', '#pauseModal.visible', '#helpModal.visible', '.debug-panel.active',
  '#fabMenu.visible', '.timer-panel.fullscreen', '.cycle-celebration-overlay', '.modal-overlay[style*="flex"]',
  '.modal-overlay[style*="block"]',
];
const isBusy = () => BUSY.some((s) => document.querySelector(s)) || !!$('celebration')?.childElementCount
  || !!window.ScoreboardState?.historicalDate;

function flags() {
  let embedded = false;
  try { embedded = window.self !== window.top; } catch { embedded = true; }
  return {
    tvMode: document.documentElement.classList.contains('tv-mode'),
    rotateParam: params.get('rotate'),
    embedded: embedded || document.body.classList.contains('iframe-embed'),
    width: window.innerWidth,
    hidden: document.hidden,
    busy: isBusy(),
    hasLeaders: !!model,
    sinceInputMs: Date.now() - lastInput,
  };
}

let nextAt = Date.now() + ROTATE_EVERY_MS;
let phase = 'idle';          // idle → loading → showing → idle
let frameEl = null;
let phaseAt = 0;

function boardReady(frame) {
  try {
    const doc = frame.contentDocument;
    if (!doc || doc.readyState !== 'complete') return false;
    const msg = doc.getElementById('msg');
    if (msg && !msg.hidden) return false;                 // the board's own "couldn't load"
    return !!doc.querySelector('#top .cb-row');
  } catch { return false; }
}

function dropFrame() {
  const ov = $('leadersOverlay');
  if (ov) ov.classList.remove('on');
  document.documentElement.classList.remove('ldr-rotating');
  const f = frameEl;
  frameEl = null;
  if (f) setTimeout(() => f.remove(), 700);              // after the fade
  phase = 'idle';
}

function skip(retry) {
  dropFrame();
  nextAt = Date.now() + retry;
}

function tick() {
  const now = Date.now();
  const ov = $('leadersOverlay');
  if (!ov) return;
  if (phase === 'idle') {
    if (now < nextAt - PRELOAD_MS) return;
    if (!shouldRotate(flags())) { nextAt = now + ROTATE_RETRY_MS; return; }
    // undo the page zoom (TV Mode) so the board draws at its own size
    const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    ov.style.zoom = z > 0 && Math.abs(z - 1) > 0.001 ? String(1 / z) : '';
    frameEl = document.createElement('iframe');
    frameEl.className = 'ldr-frame';
    frameEl.title = t('ldrBoard');
    frameEl.setAttribute('tabindex', '-1');
    frameEl.src = crewBoardUrl(getLang(), params.get('api'), model?.day);
    ov.appendChild(frameEl);
    phase = 'loading';
    phaseAt = now;
    return;
  }
  if (phase === 'loading') {
    if (!shouldRotate(flags())) { skip(ROTATE_RETRY_MS); return; }
    const ready = boardReady(frameEl);
    if (!ready && now - phaseAt > READY_TIMEOUT_MS) { skip(ROTATE_EVERY_MS); return; }
    if (ready && now >= nextAt) {
      ov.classList.add('on');
      document.documentElement.classList.add('ldr-rotating');
      phase = 'showing';
      phaseAt = now;
    }
    return;
  }
  if (phase === 'showing') {
    // back early if the scoreboard has something to say (a bag, a modal) or the board broke
    if (now - phaseAt >= ROTATE_SHOW_MS || isBusy() || document.hidden || !boardReady(frameEl)) {
      skip(ROTATE_EVERY_MS);
    }
  }
}

function onInput() {
  lastInput = Date.now();
  if (phase !== 'idle') skip(ROTATE_EVERY_MS);            // a touch brings the scoreboard back
}

function init() {
  render();
  load();
  setInterval(load, REFRESH_MS);
  document.addEventListener('ro:langchange', render);
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => window.addEventListener(ev, onInput, { passive: true, capture: true }));
  setInterval(tick, 1000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
