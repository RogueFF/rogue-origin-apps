/**
 * Mis números: one trimmer's own numbers, opened from their QR card (?t=token).
 * Shows grams of tops per hour (what the crew weighs), the day's goal, their
 * place among the full-day cells, hour by hour, and their days. Read-only.
 */
import { registerLabels, setLang, getLang, t } from '../shared/i18n.js';

const PROD_ROOT = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api';
const params = new URLSearchParams(location.search);
const apiParam = params.get('api') || '';
const ROOT = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api$/.test(apiParam) ? apiParam : PROD_ROOT;
const G = 453.59237;
const $ = (id) => document.getElementById(id);

registerLabels({
  es: {
    eyebrow: 'Mis números', speed: 'Tu velocidad', gPerHour: 'g de tops por hora', rank: 'Tu lugar', dayTotal: 'Tops del día',
    byHour: 'Hora por hora', byHourSub: 'Gramos de tops por hora de trabajo. La línea es la meta.', myDays: 'Tus días',
    privacy: 'Solo tú ves esta página. Guarda tu tarjeta; si la pierdes, pide una nueva.',
    noCard: 'Escanea el código QR de tu tarjeta para ver tus números.', badCard: 'Esta tarjeta no funciona. Pide una nueva a tu líder.',
    noDays: 'Todavía no hay números para ti. Aparecen al día siguiente de trabajar.', loadFail: 'No se pudo cargar. Revisa tu conexión e intenta otra vez.',
    goal: 'Meta', overGoal: '¡Arriba de la meta!', toGoal: 'Te faltan {g} g por hora para la meta', of: 'de', partDay: 'Día parcial',
    partDaySub: 'Sin lugar: no trabajaste el día completo en tu celda', top3: '¡Top 3 del día!', cell: 'Celda', hours: 'h',
    best: 'Tu mejor día: {d}, {g} g por hora', lbHr: '{lb} lb por hora', notTrimming: '—', today: 'Hoy',
  },
  en: {
    eyebrow: 'My numbers', speed: 'Your speed', gPerHour: 'g of tops per hour', rank: 'Your place', dayTotal: 'Tops for the day',
    byHour: 'Hour by hour', byHourSub: 'Grams of tops per working hour. The line is the goal.', myDays: 'Your days',
    privacy: 'Only you see this page. Keep your card; if you lose it, ask for a new one.',
    noCard: 'Scan the QR code on your card to see your numbers.', badCard: "This card doesn't work. Ask your lead for a new one.",
    noDays: 'No numbers for you yet. They show up the day after you work.', loadFail: "Couldn't load. Check your connection and try again.",
    goal: 'Goal', overGoal: 'Above the goal!', toGoal: '{g} g per hour to reach the goal', of: 'of', partDay: 'Part day',
    partDaySub: "No place: you didn't work the full day at your cell", top3: 'Top 3 of the day!', cell: 'Cell', hours: 'h',
    best: 'Your best day: {d}, {g} g per hour', lbHr: '{lb} lb per hour', notTrimming: '—', today: 'Today',
  },
});
let stored = null;
try { stored = localStorage.getItem('ro-lang'); } catch { /* private mode */ }
setLang(stored === 'en' ? 'en' : 'es');

const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const gph = (lbHr) => (lbHr === null || lbHr === undefined ? null : Math.round(lbHr * G));
function fmtShort(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(getLang() === 'es' ? 'es-MX' : 'en-US', { month: 'short', day: 'numeric' });
}
function fmtDate(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(getLang() === 'es' ? 'es-MX' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

let data = null;
let sel = 0;

function message(key) {
  $('msg').textContent = t(key);
  $('msg').hidden = false;
  $('content').hidden = true;
}

function render() {
  if (!data) return;
  $('who').textContent = data.name;
  if (!data.days.length) { message('noDays'); return; }
  $('msg').hidden = true;
  $('content').hidden = false;
  const d = data.days[sel];
  const goal = gph(d.target);
  const me = gph(d.rate);
  const scale = Math.max(me || 0, goal || 0, 1) * 1.25;

  $('days').innerHTML = data.days.map((x, i) =>
    `<button type="button" data-i="${i}" aria-pressed="${i === sel}">${esc(fmtDate(x.date))}</button>`).join('');

  $('rateG').textContent = me ?? '—';
  $('rateLb').textContent = d.rate !== null ? fill(t('lbHr'), { lb: d.rate.toFixed(2) }) + (goal ? ` · ${t('goal')} ${goal} g` : '') : '';
  $('meterFill').style.width = `${me ? Math.min(100, me / scale * 100) : 0}%`;
  $('meterGoal').style.left = `${goal ? goal / scale * 100 : 0}%`;
  $('meterGoal').hidden = !goal;
  const st = $('status');
  if (goal && me !== null) {
    const up = me >= goal;
    st.className = `mn-status ${up ? 'up' : 'down'}`;
    st.textContent = up ? t('overGoal') : fill(t('toGoal'), { g: goal - me });
  } else { st.textContent = ''; }

  const rankCard = $('rank').closest('.mn-rank');
  if (d.fullDay && d.rank) {
    $('rank').classList.remove('txt');
    $('rank').innerHTML = `#${d.rank}<small>${esc(t('of'))} ${d.of}</small>`;
    $('rankSub').textContent = d.rank <= 3 ? t('top3') : '';
    rankCard.classList.toggle('top', d.rank <= 3);
  } else {
    $('rank').classList.add('txt');
    $('rank').textContent = t('partDay');
    $('rankSub').textContent = t('partDaySub');
    rankCard.classList.remove('top');
  }
  $('topsG').textContent = d.topsG.toLocaleString();
  $('daySub').textContent = [d.cell ? `${t('cell')} ${d.cell}` : null, `${d.hours} ${t('hours')}`, d.cultivar].filter(Boolean).join(' · ');

  const hmax = Math.max(...d.hourly.map((h) => gph(h.rate) || 0), goal || 0, 1) * 1.15;
  $('hours').innerHTML = d.hourly.map((h) => {
    const v = gph(h.rate);
    const off = !h.min;
    return `<div class="mn-row${off ? ' off' : ''}"><span class="t">${esc(h.slot)}</span><span class="b"><i style="width:${v ? Math.min(100, v / hmax * 100) : 0}%"></i>${goal ? `<s style="left:${goal / hmax * 100}%"></s>` : ''}</span><span class="v">${off ? t('notTrimming') : v}</span></div>`;
  }).join('');

  const tmax = Math.max(...data.days.map((x) => gph(x.rate) || 0), ...data.days.map((x) => gph(x.target) || 0), 1) * 1.15;
  $('trend').innerHTML = data.days.map((x, i) => {
    const v = gph(x.rate);
    const g2 = gph(x.target);
    return `<div class="mn-row${i === sel ? ' sel' : ''}"><span class="t">${esc(fmtShort(x.date))}</span><span class="b"><i style="width:${v ? Math.min(100, v / tmax * 100) : 0}%"></i>${g2 ? `<s style="left:${g2 / tmax * 100}%"></s>` : ''}</span><span class="v">${v ?? '—'}</span></div>`;
  }).join('');
  $('best').textContent = data.best ? fill(t('best'), { d: fmtDate(data.best.date), g: gph(data.best.rate) }) : '';
}

$('days').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-i]');
  if (!b) return;
  sel = Number(b.dataset.i);
  render();
});
$('langToggle').addEventListener('click', () => {
  setLang(getLang() === 'es' ? 'en' : 'es');
  $('langToggle').textContent = getLang() === 'es' ? 'EN' : 'ES';
  if (data) render(); else if (!$('msg').hidden) $('msg').textContent = t($('msg').dataset.key || 'noCard');
});
$('langToggle').textContent = getLang() === 'es' ? 'EN' : 'ES';
try {
  const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (dark) document.documentElement.setAttribute('data-theme', 'dark');
} catch { /* old browser */ }

async function load() {
  const token = params.get('t') || '';
  if (!token) { $('msg').dataset.key = 'noCard'; message('noCard'); $('who').textContent = t('eyebrow'); return; }
  try {
    const url = new URL(`${ROOT}/production`);
    url.searchParams.set('action', 'myNumbers');
    url.searchParams.set('t', token);
    const res = await fetch(url, { cache: 'no-store', referrerPolicy: 'no-referrer' });
    if (res.status === 404) { $('msg').dataset.key = 'badCard'; message('badCard'); $('who').textContent = t('eyebrow'); return; }
    if (!res.ok) throw new Error(res.statusText);
    data = await res.json();
    render();
  } catch {
    $('msg').dataset.key = 'loadFail';
    message('loadFail');
  }
}
load();
