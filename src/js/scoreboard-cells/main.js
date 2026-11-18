/**
 * Cells scoreboard controller: fetch, run cellsModel, draw. Rules live in
 * cells-logic.js. The crew Top 5 and the TV rotation come from
 * ../scoreboard-v2/leaders.js, loaded by the page as-is.
 *
 * A failed read keeps the last good board on the wall (a TV never shows an
 * error); the stale-data dot in the header says when it's old.
 */
import { registerLabels, setLang, getLang, t } from '../shared/i18n.js';
import { LABELS, REFRESH_LIVE_MS, REFRESH_HOURLY_MS, cellsModel, goalFrom, pacificNow, fill } from './cells-logic.js';

registerLabels(LABELS);

const PROD_API = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api';
const params = new URLSearchParams(location.search);
const apiParam = params.get('api') || '';
const API = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api$/.test(apiParam) ? apiParam : PROD_API;
const DAY = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : null;   // a past day, for a look back
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lb1 = (x) => (x === null || x === undefined ? '—' : Number(x).toFixed(1));

const data = { hourly: null, board: null, crew: null, serverOffset: 0, okAt: 0 };

async function getJson(action, extra = {}) {
  const u = new URL(`${API}/production`);
  u.searchParams.set('action', action);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetch(u, { cache: 'no-store', referrerPolicy: 'no-referrer', signal: ctl.signal });
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } finally { clearTimeout(timer); }
}

const nowMs = () => Date.now() + data.serverOffset;
const dayShown = () => DAY || pacificNow(nowMs()).day;

async function loadLive() {
  try {
    const b = await getJson('cellBoard');
    if (typeof b.serverNow === 'number') data.serverOffset = b.serverNow - Date.now();
    data.board = b; data.okAt = Date.now();
  } catch { /* keep the last good board */ }
  render();
}
async function loadHourly() {
  try { data.hourly = await getJson('cellHourly', { date: dayShown() }); data.okAt = Date.now(); } catch { /* keep the last */ }
  render();
}
async function loadCrew() {
  try { data.crew = await getJson('crewBoard'); } catch { /* keep the last */ }
  render();
}

function fmtDay(iso) {
  if (!iso) return '';
  return new Date(`${iso}T12:00:00`).toLocaleDateString(getLang() === 'es' ? 'es-MX' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function render() {
  if (!data.hourly) return;
  const goal = goalFrom(data.crew);
  // a look back at a past day uses no live screens (they're today's)
  const m = cellsModel({ hourly: data.hourly, board: DAY ? null : data.board, goal, nowMs: nowMs(), day: dayShown() });
  const lang = getLang();

  // header
  const n = m.cells.filter((c) => c.state !== 'idle' || c.lb > 0).length;
  $('cellsCount').textContent = n === 0 ? t('clNone') : n === 1 ? t('clOne') : fill(t('clRunning'), { n });
  $('cellsCultivars').textContent = m.cultivars.join(' / ') || '—';
  const statusKey = { ahead: 'clAhead', 'on-target': 'clOnPace', behind: 'clBehind', nogoal: 'clNoGoal', idle: 'clWaiting' }[m.hero.status];
  $('statusText').textContent = t(statusKey);
  document.body.classList.remove('ahead', 'on-target', 'behind', 'idle');
  document.body.classList.add(m.hero.status === 'nogoal' ? 'idle' : m.hero.status);
  $('staleDot').hidden = Date.now() - data.okAt < 3 * REFRESH_HOURLY_MS;

  // hero
  $('heroLb').textContent = lb1(m.hero.lb);
  const d = $('heroDelta');
  if (m.hero.delta === null) { d.textContent = '—'; d.className = 'daily-delta neutral'; }
  else {
    const a = Math.abs(m.hero.delta).toFixed(1);
    d.textContent = m.hero.delta >= 0.05 ? `↑ +${a} lbs` : m.hero.delta <= -0.05 ? `↓ -${a} lbs` : '= 0.0 lbs';
    d.className = `daily-delta ${m.hero.delta >= 0.05 ? 'positive' : m.hero.delta <= -0.05 ? 'negative' : 'neutral'}`;
  }
  $('heroGoal').textContent = m.hero.goalSoFar !== null ? lb1(m.hero.goalSoFar) : '—';
  $('heroGoalUnit').textContent = `${t('clSoFar')} · ${fill(t('clCells'), { n: m.cells.length })}`;
  $('heroFill').style.width = `${m.progress}%`;
  $('heroHours').textContent = `${lb1(m.cellHours)} ${t('clCellHrs').toLowerCase()}`;

  // end of day
  const eod = $('eodCard');
  eod.hidden = !m.eod || !m.isToday;
  if (m.eod) {
    $('eodLabel').textContent = t('clEod');
    $('eodValue').textContent = lb1(m.eod.projected);
    $('eodGoal').textContent = m.eod.goal !== null ? fill(t('clEodGoal'), { g: lb1(m.eod.goal) }) : '';
    const ed = $('eodDelta');
    if (m.eod.delta === null) { ed.textContent = ''; ed.className = 'projection-delta neutral'; }
    else {
      const a = Math.abs(m.eod.delta).toFixed(1);
      ed.textContent = m.eod.delta >= 0.5 ? `= +${a} lbs` : m.eod.delta <= -0.5 ? `= -${a} lbs` : '= 0.0 lbs';
      ed.className = `projection-delta ${m.eod.delta >= 0.5 ? 'positive' : m.eod.delta <= -0.5 ? 'negative' : 'neutral'}`;
    }
  }

  // cells
  $('cellsKey').textContent = t('clCellsKey');
  const grid = $('cellGrid');
  grid.dataset.count = m.cells.length > 12 ? 'many' : m.cells.length > 8 ? 'some' : 'few';
  grid.innerHTML = m.cells.length ? m.cells.map((c) => {
    const rounds = c.rounds === null ? '' : c.rounds === 1 ? t('clRound1') : fill(t('clRounds'), { n: c.rounds });
    const flag = c.flag ? `<div class="cell-flag">${esc(fill(t(c.flag.key), { m: c.flag.m ?? '' }))}</div>` : '';
    const bar = c.bar !== null && !c.flag ? `<div class="cell-bar${c.overGoal ? ' over' : ''}"><b style="width:${c.bar}%"></b></div>` : '';
    return `<div class="cell ${c.state}">
      <div class="cell-top"><span class="cell-no">${esc(c.no)}</span><span class="cell-cv">${esc(c.cultivar || '—')}</span></div>
      <div class="cell-row"><span class="cell-lb">${lb1(c.lb)}<i>lb</i></span><span class="cell-rd">${esc(rounds)}</span></div>
      ${flag}${bar}</div>`;
  }).join('') : `<div class="cells-empty">${esc(t('clNone'))}</div>`;

  // right: pickups + quality
  $('pickTitle').textContent = m.waiting.length ? t('clPickups') : t('clNoPickups');
  $('pickCount').textContent = String(m.waiting.length);
  $('pickCount').classList.toggle('zero', !m.waiting.length);
  $('pickList').textContent = m.waiting.slice(0, 4).map((w) => `${w.label}${w.min !== null ? ` · ${w.min} min` : ''}`).join('  ·  ');
  $('qualTitle').textContent = t('clQuality');
  $('qualPass').textContent = String(m.quality.pass);
  $('qualRedo').textContent = String(m.quality.redo);
  $('qualPassK').textContent = t('clPass');
  $('qualRedoK').textContent = t('clRedo');
  $('qualCard').classList.toggle('stop', m.quality.stop > 0);
  $('qualStop').hidden = !(m.quality.stop > 0);
  $('qualStop').textContent = t('clStop');

  // bottom: chart + rounds
  $('chartTitle').textContent = t('clChart');
  drawChart(m);
  $('roundsTitle').textContent = t('clRoundsToday');
  $('roundsN').textContent = String(m.roundsToday);
  $('roundsK').textContent = t('clRoundsK');
  $('pickupsN').textContent = String(m.waiting.length);
  $('pickupsK').textContent = t('clPickupsK');
  $('cellHrsN').textContent = lb1(m.cellHours);
  $('cellHrsK').textContent = t('clCellHrs');
  $('goalNote').textContent = goal ? fill(t('clGoalFrom'), { lb: goal.lbHr.toFixed(2), d: fmtDay(goal.day) }) : '';
  $('date').textContent = new Date(`${m.day}T12:00:00`).toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function drawChart(m) {
  const box = $('cellChart');
  if (!m.chart.length) { box.innerHTML = ''; return; }
  const max = Math.max(...m.chart.map((h) => h.rate), m.goal || 0, 0.1) * 1.15;
  const goalLine = m.goal ? `<div class="cc-goal" style="bottom:${(m.goal / max) * 100}%"></div>` : '';
  box.innerHTML = `<div class="cc-bars">${goalLine}${m.chart.map((h) => {
    const over = m.goal && h.rate >= m.goal;
    return `<div class="cc-bar${over ? ' over' : ''}${h.done ? '' : ' live'}"><span>${h.rate.toFixed(2)}</span><i style="height:${(h.rate / max) * 100}%"></i></div>`;
  }).join('')}</div><div class="cc-labels">${m.chart.map((h) => `<span>${esc(h.label)}</span>`).join('')}</div>`;
}

function tick() {
  const d = new Date(nowMs());
  $('clock').textContent = d.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
}

function langButton() { $('langBtn').innerHTML = getLang() === 'es' ? '<b>ES</b> · EN' : 'ES · <b>EN</b>'; }
$('langBtn').addEventListener('click', () => { setLang(getLang() === 'es' ? 'en' : 'es'); langButton(); render(); });
document.addEventListener('ro:langchange', () => { langButton(); render(); });
langButton();

tick(); setInterval(tick, 15000);
loadHourly(); loadLive(); loadCrew();
setInterval(loadLive, REFRESH_LIVE_MS);
setInterval(loadHourly, REFRESH_HOURLY_MS);
setInterval(loadCrew, 5 * 60 * 1000);
setInterval(render, 60 * 1000);   // the hour boundaries move even when nothing new arrives
