/**
 * Ops Hub v3 — entry point. Owns state, fetching, timers, and the chrome
 * (range chips, theme, collapse, clock). Section rendering lives in sections.js.
 */
import '../shared/theme.js';
import { PT, greeting, clockTime, esc } from './format.js';
import { resolveRange, todayISO } from './range.js';
import * as api from './api.js';
import {
  renderNow, renderShift, renderPipe, renderWatch, renderTrend, renderCultivars, renderCost, renderDaily, dailyCsv, workedDays, periodTotals,
} from './sections.js';
import { initChat } from './chat.js';
import { hasKey } from './auth.js';

const LIVE_MS = 30_000;
const SIDE_MS = 5 * 60_000;
const RETRY_MS = 15_000;
const COLLAPSE_KEY = 'hub-collapsed';
const RANGE_KEY = 'hub-range';

const state = {
  rangeKey: 'today',
  custom: null,
  range: resolveRange('today'),
  data: null,
  trend: null,
  prev: null,
  score: null,
  morning: null,
  pipe: { queue: null, coverage: null, tops: null },
  watch: { complaints: null, reorders: null, cart: null, qa: null },
  updatedAt: null,
  lastError: null,
  loading: false,
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- chrome

function setStatus(kind, text) {
  const dot = $('statusDot');
  dot.className = `pulse-dot ${kind}`;
  $('statusText').textContent = text;
  $('railDot').className = `pulse-dot ${kind}`;
  $('railText').textContent = text;
}

function tickClock() {
  const now = new Date();
  $('clock').textContent = now.toLocaleTimeString('en-US', { timeZone: PT, hour: 'numeric', minute: '2-digit' });
  $('greetWord').textContent = greeting(now);
  $('greetDate').textContent = now.toLocaleDateString('en-US', { timeZone: PT, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function loadCollapsed() {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]')); } catch { return new Set(); }
}
function initCollapse() {
  const collapsed = loadCollapsed();
  document.querySelectorAll('.sec').forEach((sec) => {
    const btn = sec.querySelector('.icon-btn.collapse');
    if (!btn) return;
    const apply = (on) => { sec.classList.toggle('collapsed', on); btn.setAttribute('aria-expanded', String(!on)); };
    apply(collapsed.has(sec.id));
    btn.addEventListener('click', () => {
      const on = !sec.classList.contains('collapsed');
      apply(on);
      if (on) collapsed.add(sec.id); else collapsed.delete(sec.id);
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
      if (!on) renderCharts();
    });
  });
}

function initRangeChips() {
  const chips = document.querySelectorAll('.chip[data-range]');
  const custom = $('customRange');
  const start = $('customStart');
  const end = $('customEnd');
  const today = todayISO();
  start.max = today; end.max = today;

  const select = (key, save = true) => {
    chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.range === key)));
    custom.classList.toggle('open', key === 'custom');
    if (key === 'custom') {
      if (!start.value) start.value = state.custom?.start || today;
      if (!end.value) end.value = state.custom?.end || today;
      if (!state.custom) { start.focus(); return; }
    }
    state.rangeKey = key;
    state.range = resolveRange(key, state.custom);
    if (save) localStorage.setItem(RANGE_KEY, JSON.stringify({ key, custom: state.custom }));
    loadProduction();
  };

  chips.forEach((c) => c.addEventListener('click', () => select(c.dataset.range)));
  $('customApply').addEventListener('click', () => {
    if (!start.value || !end.value) return;
    state.custom = { start: start.value, end: end.value };
    select('custom');
  });

  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(RANGE_KEY) || 'null'); } catch { /* ignore */ }
  if (saved?.key && saved.key !== 'custom') select(saved.key, false);
  else if (saved?.key === 'custom' && saved.custom) { state.custom = saved.custom; start.value = saved.custom.start; end.value = saved.custom.end; select('custom', false); }
  else select('today', false);
}

function initNav() {
  const btn = $('menuBtn');
  btn.addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open');
    btn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    if (document.body.classList.contains('nav-open') && !e.target.closest('.rail') && !e.target.closest('#menuBtn')) {
      document.body.classList.remove('nav-open');
    }
  });
}

function initTheme() {
  const btn = $('themeBtn');
  const paint = () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    btn.querySelector('.sun').classList.toggle('hidden', !dark);
    btn.querySelector('.moon').classList.toggle('hidden', dark);
    btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  };
  btn.addEventListener('click', () => window.toggleTheme());
  document.addEventListener('ro:themechange', () => { paint(); renderCharts(); });
  paint();
}

// ---------------------------------------------------------------- loading

function markStale(on) {
  state.loading = on;
  // Dimming says "what you are looking at is about to be replaced". On a cold
  // load there is nothing on screen to be stale, so dimming the empty shell just
  // reads as the page washing out between the loader and the first response.
  const dim = on && Boolean(state.data);
  document.body.dataset.loading = dim ? '1' : '';
  document.querySelectorAll('.sec-body').forEach((b) => b.classList.toggle('stale', dim));
}

let retryTimer = null;

async function loadProduction() {
  const range = state.range;
  markStale(true);
  setStatus('idle', 'Loading…');
  clearTimeout(retryTimer);

  // The worker filters `daily` to the requested range, so a single-day range
  // comes back with one day. The trend charts want the 30-day window, which is
  // what an unfiltered call returns (with today's live figures on the end).
  const r = await api.settle({
    data: range.live ? api.getDashboard() : api.getDashboard(range.start, range.end),
    trend: range.days === 1 && !range.live ? api.getDashboard() : Promise.resolve(null),
    prev: range.prev.pickLast ? Promise.resolve(null) : api.getDashboard(range.prev.start, range.prev.end),
    score: range.live ? api.getScoreboard() : Promise.resolve(null),
    morning: range.live ? api.getMorningReport() : Promise.resolve(null),
  });

  // The range may have changed while we waited; drop stale responses.
  if (state.range !== range) return;

  if (r.data && range.prev.pickLast) {
    // Compare a single day against the last worked day before it, taken from
    // the 30-day window we already have.
    const window = (r.trend || r.data).daily || [];
    r.prev = { daily: window.filter((d) => d.date < range.start) };
  }

  if (!r.data) {
    state.lastError = r.errors.data;
    markStale(false);
    setStatus('off', 'Offline · retrying');
    retryTimer = setTimeout(loadProduction, RETRY_MS);
    if (!state.data) $('nowBody').innerHTML = `<div class="card"><div class="empty">Could not load production data.<br><span class="err">${esc(r.errors.data || '')}</span></div></div>`;
    return;
  }

  state.data = r.data;
  state.trend = r.trend || r.data;
  state.prev = r.prev;
  state.score = r.score;
  state.morning = r.morning;
  state.updatedAt = new Date();
  state.lastError = null;

  renderProduction();
  markStale(false);
  setStatus(range.live ? 'live' : 'idle', `${range.live ? 'Live' : range.label} · ${clockTime(state.updatedAt.toISOString())}`);
}

function renderProduction() {
  renderNow(state);
  renderShift(state);
  renderTrend(state);
  renderCultivars(state);
  renderCost(state);
  renderDaily(state);
}

function renderCharts() {
  if (!state.data) return;
  renderShift(state);
  renderTrend(state);
}

async function loadSide() {
  const r = await api.settle({
    queue: api.getQueueBrief(),
    coverage: api.getCoverage(),
    tops: api.getTopsRemaining(),
    complaints: api.getComplaintStats(),
    reorders: api.getReorderRequests(),
    cart: api.getCart(),
    qa: api.getSupersackQA(),
  });
  state.pipe = { queue: r.queue, coverage: r.coverage, tops: r.tops };
  state.watch = { complaints: r.complaints, reorders: r.reorders, cart: r.cart, qa: r.qa };
  renderPipe(state.pipe);
  renderWatch(state.watch);
}

function refreshAll() {
  loadProduction();
  loadSide();
}

// ---------------------------------------------------------------- timers

function initTimers() {
  setInterval(() => {
    if (document.hidden || !state.range.live || state.loading) return;
    loadProduction();
  }, LIVE_MS);
  setInterval(() => { if (!document.hidden) loadSide(); }, SIDE_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const age = state.updatedAt ? Date.now() - state.updatedAt.getTime() : Infinity;
    if (age > LIVE_MS) refreshAll();
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderCharts, 150);
  });
}

// ---------------------------------------------------------------- chat context

function chatContext() {
  const d = state.data;
  if (!d) return {};
  const t = periodTotals(workedDays(d.daily));
  return {
    range: state.range.label,
    today: d.today,
    current: d.current,
    targets: d.targets,
    bagTimer: state.score?.timer || d.bagTimer,
    periodTotals: { tops: t.tops, smalls: t.smalls, lbs: t.lbs, rate: t.rate, days: t.days, laborCost: t.laborCost },
    queue: state.pipe.queue?.headline || null,
    watch: {
      openComplaints: state.watch.complaints?.open ?? null,
      openReorderRequests: state.watch.reorders?.count ?? null,
      cartItems: state.watch.cart?.count ?? null,
    },
  };
}

// ---------------------------------------------------------------- boot

function boot() {
  tickClock();
  setInterval(tickClock, 1000);
  initNav();
  initTheme();
  initCollapse();
  initTimers();
  $('refreshBtn').addEventListener('click', refreshAll);
  $('csvBtn').addEventListener('click', () => {
    if (!state.data) return;
    const blob = new Blob([dailyCsv(state)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rogue-origin-daily-${state.range.start}-to-${state.range.end}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  const chat = initChat(chatContext);
  window.addEventListener('storage', (e) => { if (e.key === 'ro_api_password') chat.refreshLock(); });
  initRangeChips(); // triggers the first loadProduction()
  loadSide();
  if (!hasKey()) chat.refreshLock();
  $('loader').classList.add('hidden');
}

boot();
