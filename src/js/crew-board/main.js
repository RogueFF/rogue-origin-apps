/**
 * Crew board: top 5 by tops per hour over all full days, the room against the
 * goal, and the most improved. For the barn TV and a QR page. Read-only; refreshes
 * itself every 5 minutes. Names only who the API names (top 5 + most improved).
 */
import { registerLabels, setLang, getLang, t } from '../shared/i18n.js';

const PROD_ROOT = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api';
const params = new URLSearchParams(location.search);
const apiParam = params.get('api') || '';
const ROOT = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api$/.test(apiParam) ? apiParam : PROD_ROOT;
const REFRESH_MS = 5 * 60 * 1000;
const $ = (id) => document.getElementById(id);

registerLabels({
  es: {
    eyebrow: 'Celdas · todos los días completos', title: 'Los mejores 5', fullscreen: 'Pantalla completa',
    room: 'El equipo', roomOn: 'El equipo · {d}', gPerHour: 'g de tops por hora', improved: 'Más mejorado',
    goal: 'Meta', overGoal: '¡El equipo está arriba de la meta!', toGoal: 'Faltan {g} g ({lb} lb) por hora para la meta',
    allDays: 'Todos los días: {g} g ({lb} lb) por hora', days: '{n} días', lbHr: '{lb} lb por hora',
    impLine: 'De {g1} g ({lb1} lb) a {g2} g ({lb2} lb) por hora: +{gd} g en {n} días',
    noImp: 'Todavía nadie fuera de los 5. ¡Puede ser tú!', empty: 'Todavía no hay suficientes días. Se necesitan 2 días completos.',
    loadFail: 'No se pudo cargar. Se intentará otra vez.', updated: 'Actualizado {t}',
    howRate: 'Velocidad = gramos de tops por hora de trabajo, sumando todos los días completos de cada persona (mínimo 2 días).',
    howImp: 'Más mejorado = la mayor subida del primer día completo al último, fuera de los mejores 5.',
  },
  en: {
    eyebrow: 'Cells · all full days', title: 'Top 5', fullscreen: 'Full screen',
    room: 'The crew', roomOn: 'The crew · {d}', gPerHour: 'g of tops per hour', improved: 'Most improved',
    goal: 'Goal', overGoal: 'The crew is above the goal!', toGoal: '{g} g ({lb} lb) per hour to reach the goal',
    allDays: 'All days: {g} g ({lb} lb) per hour', days: '{n} days', lbHr: '{lb} lb per hour',
    impLine: 'From {g1} g ({lb1} lb) to {g2} g ({lb2} lb) per hour: +{gd} g over {n} days',
    noImp: 'No one outside the top 5 yet. It could be you!', empty: 'Not enough days yet. It takes 2 full days.',
    loadFail: "Couldn't load. Trying again soon.", updated: 'Updated {t}',
    howRate: "Speed = grams of tops per working hour, adding up each person's full days (at least 2 days).",
    howImp: 'Most improved = the biggest rise from first full day to latest, outside the top 5.',
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

function render() {
  $('msg').hidden = true;
  if (failed && !data) { $('msg').textContent = t('loadFail'); $('msg').hidden = false; return; }
  if (!data) return;
  const goal = data.room?.goal?.gph ?? null;
  const topMax = Math.max(...data.top.map((p) => p.gph), goal || 0, 1) * 1.1;
  $('top').innerHTML = data.top.length ? data.top.map((p) => `
    <li class="cb-row"><span class="cb-rk r${p.rank}">${p.rank}</span>
      <div class="cb-who"><span class="cb-name">${esc(p.name)}</span>
        <span class="cb-bar"><i style="width:${Math.min(100, p.gph / topMax * 100)}%"></i>${goal ? `<s style="left:${goal / topMax * 100}%"></s>` : ''}</span></div>
      <div class="cb-val"><b>${p.gph}</b><span>g/h</span><small>${lb2(p.lbHr)} lb/h · ${fill(t('days'), { n: p.days })}</small></div></li>`).join('')
    : `<li class="cb-sub">${esc(t('empty'))}</li>`;

  const r = data.room;
  $('roomTitle').textContent = r ? fill(t('roomOn'), { d: fmtDate(r.date) }) : t('room');
  const me = r?.rate?.gph ?? null;
  $('roomG').textContent = me ?? '—';
  $('roomLb').textContent = r?.rate ? fill(t('lbHr'), { lb: lb2(r.rate.lbHr) }) + (goal ? ` · ${t('goal')} ${goal} g (${lb2(r.goal.lbHr)} lb)` : '') : '';
  const scale = Math.max(me || 0, goal || 0, 1) * 1.25;
  $('roomFill').style.width = `${me ? Math.min(100, me / scale * 100) : 0}%`;
  $('roomGoal').style.left = `${goal ? goal / scale * 100 : 0}%`;
  $('roomGoal').hidden = !goal;
  const st = $('roomStatus');
  if (goal && me !== null) {
    const up = me >= goal;
    st.className = `cb-status ${up ? 'up' : 'down'}`;
    st.textContent = up ? t('overGoal') : fill(t('toGoal'), { g: goal - me, lb: lb2(r.goal.lbHr - r.rate.lbHr) });
  } else { st.textContent = ''; }
  $('roomAll').textContent = data.roomAllDays ? fill(t('allDays'), { g: data.roomAllDays.gph, lb: lb2(data.roomAllDays.lbHr) }) : '';

  const m = data.mostImproved;
  $('impName').textContent = m ? m.name : '—';
  $('impLine').textContent = m ? fill(t('impLine'), { g1: m.from.gph, lb1: lb2(m.from.lbHr), g2: m.to.gph, lb2: lb2(m.to.lbHr), gd: m.rise.gph, n: m.days }) : t('noImp');
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

$('langToggle').textContent = getLang() === 'es' ? 'EN' : 'ES';
$('langToggle').addEventListener('click', () => {
  setLang(getLang() === 'es' ? 'en' : 'es');
  $('langToggle').textContent = getLang() === 'es' ? 'EN' : 'ES';
  render();
});
$('fsBtn').addEventListener('click', () => {
  const el = document.documentElement;
  if (document.fullscreenElement) document.exitFullscreen?.();
  else el.requestFullscreen?.();
});
load();
setInterval(load, REFRESH_MS);
