/**
 * Scoreboard v3 — the pace layer.
 *
 * v3 is v2's page with the v2 modules left untouched. This module runs after
 * them and draws the comparisons the crew actually needs, on top of the
 * elements v2 already renders:
 *
 *   - the day bar cut into hours, with a plan tick that moves with the clock,
 *     the gap hatched, and a hollow end-of-day marker;
 *   - the current-hour column: pounds so far against a hairline that climbs;
 *   - the bag dial: time and weight as two arcs on one ring, the gap shaded;
 *   - the rate needle.
 *
 * It reads ScoreboardState (written by main.js / timer.js / scale.js) and the
 * two ring offsets those modules already set, and never writes to the API.
 */
import { registerLabels, t } from '../shared/i18n.js';
import {
  BAG_LBS,
  daySegments,
  planNowFraction,
  hourExpectedNow,
  hourSoFarLbs,
  realizedRate,
  needleAngle,
  arcFractionFromOffset,
  wedgePath,
  slotBounds,
} from './pace-math.js';

const TIMER_CIRC = 2 * Math.PI * 103; // timer ring r=103, what timer.js divides by
const SCALE_CIRC = 597;               // scale ring carries pathLength="597" so scale.js's math holds

registerLabels({
  en: {
    v3PlanNow: 'plan now',
    v3EndOfDay: 'end of day',
    v3SoFar: 'lbs so far',
    v3Now: 'now',
    v3RateToday: 'Rate today · lbs / trimmer / hr',
    v3Time: 'time',
    v3Weight: 'weight',
    v3Gap: 'gap',
  },
  es: {
    v3PlanNow: 'plan ahora',
    v3EndOfDay: 'fin del día',
    v3SoFar: 'lbs hasta ahora',
    v3Now: 'ahora',
    v3RateToday: 'Ritmo hoy · lbs / podador / hr',
    v3Time: 'tiempo',
    v3Weight: 'peso',
    v3Gap: 'brecha',
  },
});

const $ = (id) => document.getElementById(id);
const pct = (f) => `${(Math.max(0, Math.min(1, f)) * 100).toFixed(2)}%`;

function state() {
  return window.ScoreboardState || {};
}

function nowMinutes(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

function localMinutesToday(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const now = new Date();
  if (d.toDateString() !== now.toDateString()) return null;
  return d.getHours() * 60 + d.getMinutes();
}

let segSignature = '';

function renderDayBar(data, shiftEnded) {
  const bar = $('progressFill');
  const segs = $('v3Segs');
  if (!bar || !segs || !data) return;
  const goal = data.dailyGoal || 0;
  if (!(goal > 0)) return;

  const todayLbs = data.todayLbs || 0;
  const fill = Math.min(1, todayLbs / goal);
  bar.style.width = pct(fill);

  // One goal on the board: the hero's "/ goal" is the day goal, not the target so far.
  const dt = $('dailyTarget');
  if (dt) dt.textContent = goal.toFixed(1);

  const segments = daySegments({
    hourlyRates: data.hourlyRates || [],
    currentSlot: data.currentTimeSlot || '',
    currentHourTarget: data.currentHourTarget || 0,
    dailyGoal: goal,
  });
  const sig = segments.map((s) => s.frac1.toFixed(4)).join(',');
  if (sig !== segSignature) {
    segSignature = sig;
    segs.innerHTML = segments.slice(0, -1).map((s) => `<div class="v3-seg" style="left:${pct(s.frac1)}"></div>`).join('');
  }

  const plan = planNowFraction({
    todayTarget: data.todayTarget || 0,
    currentHourTarget: data.currentHourTarget || 0,
    currentSlot: data.currentTimeSlot || '',
    nowMin: nowMinutes(),
    dailyGoal: goal,
    shiftEnded,
  });
  const planEl = $('v3Plan');
  const planLbl = $('v3PlanLbl');
  const gap = $('v3Gap');
  if (planEl) planEl.style.left = pct(plan);
  if (planLbl) { planLbl.style.left = pct(plan); planLbl.textContent = t('v3PlanNow'); }
  if (gap) {
    const lo = Math.min(fill, plan);
    const hi = Math.max(fill, plan);
    gap.style.left = pct(lo);
    gap.style.width = pct(hi - lo);
    gap.classList.toggle('ahead', fill > plan);
    gap.style.display = hi - lo < 0.002 ? 'none' : '';
  }

  const projected = data.projectedTotal || 0;
  const proj = $('v3Proj');
  const projLbl = $('v3ProjLbl');
  const showProj = !shiftEnded && projected > 0 && todayLbs > 0;
  if (proj) {
    proj.style.display = showProj ? '' : 'none';
    proj.style.left = pct(Math.min(1, projected / goal));
  }
  if (projLbl) {
    projLbl.style.display = showProj ? '' : 'none';
    projLbl.style.left = pct(Math.min(1, projected / goal));
    projLbl.textContent = t('v3EndOfDay');
  }

  const a0 = $('v3Axis0');
  const a1 = $('v3Axis1');
  const first = segments[0] && slotBounds(segments[0].label);
  const last = segments[9] && slotBounds(segments[9].label);
  if (a0 && first) a0.textContent = fmtClock(first.start);
  if (a1 && last) a1.textContent = fmtClock(last.end);
}

function fmtClock(min) {
  const h24 = Math.floor(min / 60);
  const m = Math.round(min % 60);
  const h = ((h24 + 11) % 12) + 1;
  return `${h}${m ? ':' + String(m).padStart(2, '0') : ''} ${h24 < 12 ? 'AM' : 'PM'}`;
}

function renderHourColumn(data, timer) {
  const col = $('v3HourCol');
  if (!col || !data) return;
  const target = data.currentHourTarget || 0;
  const slot = data.currentTimeSlot || '';
  if (!(target > 0) || !slot) { col.style.visibility = 'hidden'; return; }
  col.style.visibility = '';

  const s = state();
  const bagMinutes = ((timer && timer.cycleHistory) || [])
    .map((c) => localMinutesToday(c.timestamp))
    .filter((m) => m !== null);
  const lastBag = timer && timer.lastBagTime ? localMinutesToday(timer.lastBagTime) : null;
  if (lastBag !== null && !bagMinutes.includes(lastBag)) bagMinutes.push(lastBag);
  const scale = s.scaleData || null;
  const soFar = hourSoFarLbs({
    bagMinutes,
    bagLbs: BAG_LBS[(timer && timer.lastBagSize) || (scale && scale.bagMode) || '5kg'] || 10,
    scaleGrams: scale ? (scale.weight || 0) * 1000 : 0,
    scaleStale: !scale || scale.isStale !== false,
    currentSlot: slot,
    bagStartMin: lastBag,
    nowMin: nowMinutes(),
  });
  const expected = hourExpectedNow({ currentHourTarget: target, currentSlot: slot, nowMin: nowMinutes() });

  const fillF = Math.min(1, soFar / target);
  const nowF = Math.min(1, expected / target);
  const fill = $('v3HourFill');
  const now = $('v3HourNow');
  const gap = $('v3HourGap');
  const soFarEl = $('v3HourSoFar');
  const soFarLbl = $('v3HourSoFarLbl');
  const nowLbl = $('v3HourNowLbl');
  if (fill) fill.style.height = pct(fillF);
  if (now) now.style.bottom = pct(nowF);
  if (gap) {
    const lo = Math.min(fillF, nowF);
    const hi = Math.max(fillF, nowF);
    gap.style.bottom = pct(lo);
    gap.style.height = pct(hi - lo);
    gap.classList.toggle('ahead', fillF > nowF);
    gap.style.display = hi - lo < 0.01 ? 'none' : '';
  }
  if (soFarEl) soFarEl.textContent = `~${soFar.toFixed(1)}`;
  if (soFarLbl) soFarLbl.textContent = t('v3SoFar');
  if (nowLbl) nowLbl.textContent = t('v3Now');
}

function renderDial() {
  const wedge = $('v3Wedge');
  const timerRing = $('timerRing');
  const scaleRing = $('scaleRing');
  if (!wedge || !timerRing || !scaleRing) return;
  const scale = state().scaleData || null;
  const stale = !scale || scale.isStale !== false;
  const timeF = arcFractionFromOffset(timerRing.style.strokeDashoffset, TIMER_CIRC);
  const weightF = arcFractionFromOffset(scaleRing.style.strokeDashoffset, SCALE_CIRC);
  const paused = document.body.classList.contains('timer-neutral');
  if (stale || paused || !(timeF > 0)) { wedge.setAttribute('d', ''); return; }
  wedge.setAttribute('d', wedgePath(120, 120, 100, 83, weightF, timeF));
  wedge.classList.toggle('ahead', weightF >= timeF);
  wedge.classList.toggle('behind', weightF < timeF);
  const lt = $('v3LegendTime'); if (lt) lt.textContent = t('v3Time');
  const lw = $('v3LegendWeight'); if (lw) lw.textContent = t('v3Weight');
  const lg = $('v3LegendGap'); if (lg) lg.textContent = t('v3Gap');
}

function renderNeedle(data) {
  const needle = $('v3Needle');
  const val = $('v3RateVal');
  const lbl = $('v3RateLbl');
  if (!needle || !data) return;
  const rate = realizedRate(data.hourlyRates || []);
  const target = data.targetRate || 0;
  needle.setAttribute('transform', `rotate(${needleAngle(rate, target).toFixed(1)} 60 60)`);
  if (val) val.textContent = rate > 0 ? rate.toFixed(2) : '—';
  if (lbl) lbl.textContent = t('v3RateToday');
}

function quietChartLabels() {
  // v2 nests its chart options under `data`, so the datalabels plugin runs on
  // its defaults and prints a value over every bar. The bars and the target
  // hairline say it; the numbers are noise from 20 ft.
  // Write to the raw config (chart.options is Chart.js's resolver proxy and
  // rejects a plain object) and let update() re-resolve it.
  const chart = state().hourlyChart;
  if (!chart || !chart.config || chart._v3quiet) return;
  const cfg = chart.config;
  cfg.options = cfg.options || {};
  cfg.options.plugins = cfg.options.plugins || {};
  cfg.options.plugins.datalabels = { display: false };
  chart._v3quiet = true;
  try { chart.update('none'); } catch { /* chart mid-render; next tick */ }
}

function update() {
  const s = state();
  const data = s.data || null;
  const timer = s.timerData || null;
  const shiftEnded = document.body.classList.contains('shift-ended');
  try { renderDayBar(data, shiftEnded); } catch (e) { console.warn('[v3] day bar', e); }
  try { renderHourColumn(data, timer); } catch (e) { console.warn('[v3] hour column', e); }
  try { renderDial(); } catch (e) { console.warn('[v3] dial', e); }
  try { renderNeedle(data); } catch (e) { console.warn('[v3] needle', e); }
  try { quietChartLabels(); } catch (e) { console.warn('[v3] chart', e); }
}

// Run right after every v2 render, and once a second for the clock-driven marks.
const R = window.ScoreboardRender;
if (R && typeof R.renderScoreboard === 'function') {
  const orig = R.renderScoreboard;
  R.renderScoreboard = function wrappedRender(...args) {
    const out = orig.apply(this, args);
    update();
    return out;
  };
}
document.addEventListener('ro:langchange', update);
setInterval(update, 1000);
update();

export { update };
