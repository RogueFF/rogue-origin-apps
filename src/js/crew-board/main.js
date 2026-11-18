/**
 * Crew board: everyone ranked by tops per hour, with a chip to switch views
 * (Koa 2026-11-17): "Por día" (one workday at a time, a chip per date, the last
 * workday by default) and "General" (all full days pooled). The top 5 get the big
 * rows; everyone else a compact row. Part days are listed, not ranked. The room
 * against the goal and the most improved sit beside it. For the barn TV and a QR
 * page. Read-only; refreshes itself every 5 minutes.
 * URL: ?view=overall|day&day=YYYY-MM-DD pins a view (e.g. on the TV).
 */
import { registerLabels, setLang, getLang, t } from '../shared/i18n.js';

const PROD_ROOT = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api';
const params = new URLSearchParams(location.search);
const apiParam = params.get('api') || '';
const ROOT = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api$/.test(apiParam) ? apiParam : PROD_ROOT;
const REFRESH_MS = 5 * 60 * 1000;
const TOP = 5;
const $ = (id) => document.getElementById(id);

registerLabels({
  es: {
    eyebrow: 'Celdas · tops por hora', title: 'Tablero del equipo', fullscreen: 'Pantalla completa',
    viewDay: 'Por día', viewAll: 'General',
    room: 'El equipo', roomOn: 'El equipo · {d}', roomAllTitle: 'El equipo · todos los días', gPerHour: 'lb de tops por hora', improved: 'Más mejorado',
    goal: 'Meta', goalKey: 'Meta: {lb} lb ({g} g) por hora', goalTick: 'Meta {lb}', overGoal: '¡El equipo está arriba de la meta!', toGoal: 'Faltan {lb} lb ({g} g) por hora para la meta',
    allDays: 'Todos los días: {lb} lb ({g} g) por hora', gHr: '{g} g por hora', nDays: '{n} días', oneDay: '1 día', dShort: '{n} d',
    impLine: 'De {lb1} lb ({g1} g) a {lb2} lb ({g2} g) por hora: +{ld} lb ({gd} g) en {n} días',
    noImp: 'Todavía nadie fuera de los 5. ¡Puede ser tú!', empty: 'Todavía no hay días completos.',
    part: 'Día parcial (sin lugar)', partOnly: 'Solo días parciales (sin lugar)', partH: '{h} h',
    loadFail: 'No se pudo cargar. Se intentará otra vez.', updated: 'Actualizado {t}',
    howDay: 'Por día = gramos de tops por hora de trabajo ese día (día completo). Día parcial: se muestra, sin lugar.',
    howAll: 'General = todos los días completos juntos: todos los gramos ÷ todas las horas.',
    howImp: 'Más mejorado = la mayor subida de su primer día completo al último día de trabajo, fuera de los mejores 5.',
  },
  en: {
    eyebrow: 'Cells · tops per hour', title: 'Crew board', fullscreen: 'Full screen',
    viewDay: 'Day by day', viewAll: 'Overall',
    room: 'The crew', roomOn: 'The crew · {d}', roomAllTitle: 'The crew · all days', gPerHour: 'lb of tops per hour', improved: 'Most improved',
    goal: 'Goal', goalKey: 'Goal: {lb} lb ({g} g) per hour', goalTick: 'Goal {lb}', overGoal: 'The crew is above the goal!', toGoal: '{lb} lb ({g} g) per hour to reach the goal',
    allDays: 'All days: {lb} lb ({g} g) per hour', gHr: '{g} g per hour', nDays: '{n} days', oneDay: '1 day', dShort: '{n} d',
    impLine: 'From {lb1} lb ({g1} g) to {lb2} lb ({g2} g) per hour: +{ld} lb ({gd} g) over {n} days',
    noImp: 'No one outside the top 5 yet. It could be you!', empty: 'No full days yet.',
    part: 'Part day (not ranked)', partOnly: 'Part days only (not ranked)', partH: '{h} h',
    loadFail: "Couldn't load. Trying again soon.", updated: 'Updated {t}',
    howDay: 'Day by day = grams of tops per working hour that day (full day). Part days are shown, not ranked.',
    howAll: 'Overall = all full days together: all grams ÷ all hours.',
    howImp: 'Most improved = the biggest rise from their first full day to the last workday, outside the top 5.',
  },
});
let stored = null;
try { stored = localStorage.getItem('ro-lang'); } catch { /* private mode */ }
const urlLang = params.get('lang');
setLang(urlLang === 'en' || urlLang === 'es' ? urlLang : stored === 'en' ? 'en' : 'es');
if (params.get('tv') === '1') document.documentElement.classList.add('tv');
try { if (window.matchMedia('(prefers-color-scheme: dark)').matches || params.get('tv') === '1') document.documentElement.setAttribute('data-theme', 'dark'); } catch { /* old browser */ }

const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k]);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lb2 = (x) => Number(x).toFixed(2);
const fmtDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(getLang() === 'es' ? 'es-MX' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' });

let data = null;
let failed = false;
let view = params.get('view') === 'overall' ? 'overall' : 'day';
let pickedDay = /^\d{4}-\d{2}-\d{2}$/.test(params.get('day') || '') ? params.get('day') : null;

function bigRow(p, goal, goalLb, max, extra) {
  return `<li class="cb-row"><span class="cb-rk r${p.rank}">${p.rank}</span>
    <div class="cb-who"><span class="cb-name">${esc(p.name)}</span>
      <span class="cb-bar"><i style="width:${Math.min(100, p.gph / max * 100)}%"></i>${goal ? `<s style="left:${Math.min(100, goal / max * 100)}%">${p.rank === 1 ? `<em>${esc(fill(t('goalTick'), { lb: lb2(goalLb) }))}</em>` : ''}</s>` : ''}</span>${extra ? `<span class="cb-days">${esc(extra)}</span>` : ''}</div>
    <div class="cb-val"><b>${lb2(p.lbHr)}</b><span>lb/h</span><small>${p.gph} g/h</small></div></li>`;
}
function smallRow(p, extra) {
  return `<li class="cb-srow"><span class="cb-srk">${p.rank}</span><span class="cb-sname">${esc(p.name)}${extra ? ` <small>${esc(extra)}</small>` : ''}</span>
    <span class="cb-sval"><b>${lb2(p.lbHr)}</b> lb/h <small>${p.gph} g</small></span></li>`;
}
const daysLabel = (n) => (n === 1 ? t('oneDay') : fill(t('nDays'), { n }));

function renderChips() {
  $('viewDay').classList.toggle('on', view === 'day');
  $('viewAll').classList.toggle('on', view === 'overall');
  $('viewDay').setAttribute('aria-pressed', String(view === 'day'));
  $('viewAll').setAttribute('aria-pressed', String(view === 'overall'));
  const days = data?.days || [];
  const box = $('dayChips');
  box.hidden = view !== 'day' || !days.length;
  box.innerHTML = days.map((d) => `<button type="button" class="cb-chip cb-dchip${d === pickedDay ? ' on' : ''}" data-day="${d}" aria-pressed="${d === pickedDay}">${esc(fmtDate(d))}</button>`).join('');
}

function render() {
  $('msg').hidden = true;
  if (failed && !data) { $('msg').textContent = t('loadFail'); $('msg').hidden = false; return; }
  if (!data) return;
  const days = data.days || [];
  if (!pickedDay || !days.includes(pickedDay)) pickedDay = data.day;
  renderChips();

  const dayData = view === 'day' && pickedDay ? data.byDay?.[pickedDay] : null;
  const ranked = view === 'day' ? (dayData?.ranked || []) : (data.overall?.ranked || []);
  const goal = view === 'day' ? dayData?.room?.goal?.gph ?? null : null;
  const goalLb = goal ? dayData.room.goal.lbHr : null;
  const max = Math.max(...ranked.map((p) => p.gph), goal || 0, 1) * 1.1;
  const extra = (p) => (view === 'overall' ? daysLabel(p.days) : '');
  $('top').innerHTML = ranked.length ? ranked.slice(0, TOP).map((p) => bigRow(p, goal, goalLb, max, extra(p))).join('') : `<li class="cb-sub">${esc(t('empty'))}</li>`;
  $('rest').innerHTML = ranked.slice(TOP).map((p) => smallRow(p, view === 'overall' ? fill(t('dShort'), { n: p.days }) : '')).join('');
  $('rest').hidden = ranked.length <= TOP;

  let partHtml = '';
  if (view === 'day' && dayData?.part?.length) {
    partHtml = `<span class="cb-k">${esc(t('part'))}</span><ul class="cb-part">${dayData.part.map((p) => `<li>${esc(p.name)} <small>${lb2(p.lbHr)} lb/h · ${esc(fill(t('partH'), { h: p.hours }))}</small></li>`).join('')}</ul>`;
  } else if (view === 'overall' && data.overall?.partOnly?.length) {
    partHtml = `<span class="cb-k">${esc(t('partOnly'))}</span><ul class="cb-part">${data.overall.partOnly.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;
  }
  // a day's part list sits under the ranking (the side column is full that view);
  // overall's short part-only list sits in the side column
  const pb = $('partBox');
  pb.innerHTML = partHtml;
  pb.hidden = !partHtml;
  pb.classList.toggle('inrank', view === 'day');
  if (view === 'day' && pb.parentElement !== $('rankCard')) $('rankCard').appendChild(pb);
  if (view !== 'day' && pb.parentElement !== $('side')) $('side').insertBefore(pb, $('side').lastElementChild);

  const gk = $('goalKey');
  gk.hidden = !goal;
  gk.innerHTML = goal ? `<i aria-hidden="true"></i><span>${esc(fill(t('goalKey'), { g: goal, lb: lb2(dayData.room.goal.lbHr) }))}</span>` : '';

  // the room: the picked day against its goal, or all days
  const r = view === 'day' ? dayData?.room : null;
  const all = data.roomAllDays;
  $('roomTitle').textContent = view === 'day' ? (pickedDay ? fill(t('roomOn'), { d: fmtDate(pickedDay) }) : t('room')) : t('roomAllTitle');
  const me = view === 'day' ? (r?.rate?.gph ?? null) : (all?.gph ?? null);
  const meLb = view === 'day' ? r?.rate?.lbHr : all?.lbHr;
  $('roomG').textContent = me !== null ? lb2(meLb) : '—';
  $('roomLb').textContent = me !== null ? fill(t('gHr'), { g: me }) + (goal ? ` · ${t('goal')} ${lb2(r.goal.lbHr)} lb (${goal} g)` : '') : '';
  const scale = Math.max(me || 0, goal || 0, 1) * 1.25;
  $('roomFill').style.width = `${me ? Math.min(100, me / scale * 100) : 0}%`;
  $('roomGoal').style.left = `${goal ? goal / scale * 100 : 0}%`;
  $('roomGoal').hidden = !goal;
  const st = $('roomStatus');
  if (goal && me !== null) {
    const up = me >= goal;
    st.className = `cb-status ${up ? 'up' : 'down'}`;
    st.textContent = up ? t('overGoal') : fill(t('toGoal'), { g: goal - me, lb: lb2(r.goal.lbHr - r.rate.lbHr) });
  } else { st.textContent = ''; st.className = 'cb-status'; }
  $('roomAll').textContent = view === 'day' && all ? fill(t('allDays'), { g: all.gph, lb: lb2(all.lbHr) }) : '';

  const m = data.mostImproved;
  $('impName').textContent = m ? m.name : '—';
  $('impLine').textContent = m ? fill(t('impLine'), { g1: m.from.gph, lb1: lb2(m.from.lbHr), g2: m.to.gph, lb2: lb2(m.to.lbHr), gd: m.rise.gph, ld: lb2(m.to.lbHr - m.from.lbHr), n: m.days }) : t('noImp');
  $('howRate').textContent = view === 'day' ? t('howDay') : t('howAll');
  $('updated').textContent = fill(t('updated'), { t: new Date().toLocaleTimeString(getLang() === 'es' ? 'es-MX' : 'en-US', { hour: 'numeric', minute: '2-digit' }) });
}

async function load() {
  try {
    const url = new URL(`${ROOT}/production`);
    url.searchParams.set('action', 'crewBoard');
    const res = await fetch(url, { cache: 'no-store', referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error(res.statusText);
    data = await res.json();
    failed = false;
  } catch {
    failed = true;          // keep showing the last good board on the TV
  }
  render();
}

function setView(v, d) {
  view = v;
  if (d) pickedDay = d;
  const u = new URL(location.href);
  u.searchParams.set('view', view === 'overall' ? 'overall' : 'day');
  if (view === 'day' && pickedDay) u.searchParams.set('day', pickedDay); else u.searchParams.delete('day');
  try { history.replaceState(null, '', u); } catch { /* file:// preview */ }
  render();
}
$('viewDay').addEventListener('click', () => setView('day'));
$('viewAll').addEventListener('click', () => setView('overall'));
$('dayChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-day]');
  if (b) setView('day', b.dataset.day);
});

const langLabel = () => { $('langToggle').innerHTML = getLang() === 'es' ? '<b>ES</b> · EN' : 'ES · <b>EN</b>'; };
langLabel();
$('langToggle').addEventListener('click', () => {
  setLang(getLang() === 'es' ? 'en' : 'es');
  try { localStorage.setItem('ro-lang', getLang()); } catch { /* private mode */ }
  langLabel();
  render();
});
$('fsBtn').addEventListener('click', () => {
  const el = document.documentElement;
  if (document.fullscreenElement) document.exitFullscreen?.();
  else el.requestFullscreen?.();
});
load();
setInterval(load, REFRESH_MS);
