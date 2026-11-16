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
import { initOwner } from './owner.js';
import { setGo } from './nav.js';

const ROUTES = [
  [/^$/, home, []],
  [/^dropoff$/, dropoff, []],
  [/^weigh\/(\d+)\/(\d+)$/, weigh, ['dropoffId', 'lotId']],
  [/^screen\/(\d+)\/(\d+)$/, screen, ['dropoffId', 'lotId']],
  [/^farm\/(\d+)$/, farm, ['farmId']],
  [/^pay(?:\/(\d+))?$/, pay, ['farmId']],
];

const root = document.getElementById('view');
let current = null;
let currentHash = null;

function match(hash) {
  for (const [re, view, names] of ROUTES) {
    const m = re.exec(hash);
    if (m) return { view, params: Object.fromEntries(names.map((n, i) => [n, m[i + 1] ? Number(m[i + 1]) : null])) };
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
  root.innerHTML = '';
  window.scrollTo(0, 0);
  current = view.mount(root, params) || null;
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

window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', (e) => {
  if (current && current.dirty && current.dirty()) { e.preventDefault(); e.returnValue = ''; }
});

initOwner();
langLabel();
document.title = t('title');
document.documentElement.setAttribute('lang', getLang());
route();
