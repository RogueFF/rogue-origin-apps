/**
 * Consignment lot ledger, staff page. Hash router over views.
 * Design: docs/plans/2026-11-16-consignment-lot-ledger-design.md section 9.
 *
 * Routes:
 *   #/                         home
 *   #/dropoff                  new dropoff
 *   #/weigh/<dropoff>/<lot>    set a late weight
 *   #/screen/<dropoff>/<lot>   screening run
 *   #/farm/<farm>              farm page
 *   #/pay or #/pay/<farm>      record a payment
 *   #/print/dropoff(/<farm>)   print a dropoff sheet (blank, or for one farm)
 *   #/print/screen/<dropoff>   print a screening sheet
 *   #/photo/dropoff(/<farm>)   photo of a dropoff sheet -> prefilled dropoff form
 *   #/photo/screen/<dropoff>(/<lot>.<lot>...)   photo of a screening sheet -> review of every lot
 *                              (the sheet's QR carries the printed lot ids, so rows keep their lots
 *                              even if a lot is weighed or closed between printing and the photo)
 * Weigh and screen carry the dropoff id because the API reads lots through their dropoff.
 */
import './labels.js';
import { t, getLang, toggleLang } from '../shared/i18n.js';
import * as home from './views/home.js';
import * as dropoff from './views/dropoff.js';
import * as weigh from './views/weigh.js';
import * as screen from './views/screen.js';
import * as farm from './views/farm.js';
import * as pay from './views/pay.js';
import * as print from './views/print.js';
import * as photo from './views/photo.js';
import { initOwner } from './owner.js';
import { setGo } from './nav.js';
import { queue, flush } from './held.js';
import { toast } from './ui.js';

const ROUTES = [
  [/^$/, home, []],
  [/^dropoff$/, dropoff, []],
  [/^weigh\/(\d+)\/(\d+)$/, weigh, ['dropoffId', 'lotId']],
  [/^screen\/(\d+)\/(\d+)$/, screen, ['dropoffId', 'lotId']],
  [/^farm\/(\d+)$/, farm, ['farmId']],
  [/^pay(?:\/(\d+))?$/, pay, ['farmId']],
  [/^print\/dropoff(?:\/(\d+))?$/, print, ['farmId'], { kind: 'dropoff' }],
  [/^print\/screen\/(\d+)$/, print, ['dropoffId'], { kind: 'screen' }],
  [/^photo\/dropoff(?:\/(\d+))?$/, photo, ['farmId'], { kind: 'dropoff' }],
  [/^photo\/screen\/(\d+)(?:\/(\d+(?:\.\d+)*))?$/, photo, ['dropoffId', 'lotIds'], { kind: 'screen' }],
];

const root = document.getElementById('view');
let current = null;
let currentHash = null;

function match(hash) {
  for (const [re, view, names, extra] of ROUTES) {
    const m = re.exec(hash);
    if (!m) continue;
    const val = (n, raw) => {
      if (!raw) return null;
      return n === 'lotIds' ? raw.split('.').map(Number) : Number(raw);
    };
    return { view, params: { ...extra, ...Object.fromEntries(names.map((n, i) => [n, val(n, m[i + 1])])) } };
  }
  return { view: home, params: {} };
}

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  if (hash === currentHash) return;
  if (current && current.dirty && current.dirty() && !window.confirm(t('leaveConfirm'))) {
    history.replaceState(null, '', `#/${currentHash}`);
    return;
  }
  currentHash = hash;
  if (current && current.unmount) current.unmount();
  const { view, params } = match(hash);
  // Each view gets its own element. Views listen on the element they are given, so the
  // listeners of a view left behind go away with its element instead of piling up on #view
  // (a left review's Save all used to fire again from the next screen).
  root.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'cs-viewbody';
  root.appendChild(el);
  window.scrollTo(0, 0);
  current = view.mount(el, params) || null;
}

/** Views call go() (nav.js) to move on without the dirty prompt, after a save. */
setGo((hash) => {
  if (current && current.unmount) current.unmount();
  current = null;
  currentHash = null;
  if (location.hash === hash) route();
  else location.hash = hash;
});

const $ = (id) => document.getElementById(id);
const langLabel = () => { $('langToggle').innerHTML = getLang() === 'es' ? '<b>ES</b> · EN' : 'ES · <b>EN</b>'; };
$('langToggle').addEventListener('click', () => { toggleLang(); });
$('homeBtn').addEventListener('click', () => { location.hash = '#/'; });

document.addEventListener('ro:langchange', () => {
  langLabel();
  document.title = t('title');
  if (current && current.rerender) current.rerender();
});

// ---------- held entries (no signal) ----------
function heldChip() {
  const n = queue.list().length;
  const chip = $('heldChip');
  chip.hidden = n === 0;
  chip.textContent = `${n} ${t('held')}`;
  chip.title = t('heldSend');
  chip.setAttribute('aria-label', `${n} ${t('held')}. ${t('heldSend')}`);
}
async function sendHeld() {
  if (!queue.list().length) return;
  const r = await flush();
  if (r.rejected.length) toast(`${t('notSaved')}: ${r.rejected.map((x) => x.error).join('; ')}`, 'err');
  else if (r.sent && !r.left) toast(t('saved'));
  if (r.sent || r.rejected.length) document.dispatchEvent(new CustomEvent('consign:reload'));
}
document.addEventListener('consign:held', heldChip);
document.addEventListener('ro:langchange', heldChip);
$('heldChip').addEventListener('click', sendHeld);
window.addEventListener('online', sendHeld);

window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', (e) => {
  if (current && current.dirty && current.dirty()) { e.preventDefault(); e.returnValue = ''; }
});

initOwner();
langLabel();
document.title = t('title');
document.documentElement.setAttribute('lang', getLang());
route();
heldChip();
sendHeld();
