/**
 * The shared frame every app screen mounts: the apps rail, the topbar around
 * the screen's own controls, the phone menu, the theme button, the Pacific
 * clock, and the connection status shown in both the topbar pill and the rail.
 *
 * A page keeps its own topbar controls in its markup, wrapped in
 * `.topbar-slot` elements, and hands them over:
 *
 *   mountShell({ start: [$('topbarStart')], end: [$('topbarEnd')] });
 *
 * Slots are `display: contents`, so their children lay out as direct flex
 * items of the topbar, in this order:
 *   menu · start · spacer · status · clock · theme · end
 */
import { toggleTheme } from '../js/shared/theme.js';
import { currentApp, railHtml } from './nav.js';

const PT = 'America/Los_Angeles';
const LOGO = new URL('../assets/ro-logo-horizontal.png', import.meta.url).pathname;

const MENU_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>';
const SUN_ICON = '<svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M19.1 4.9l-1.4 1.4M4.9 19.1l1.4-1.4"/></svg>';
const MOON_ICON = '<svg class="moon hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

/** Paint the connection state in the topbar pill and the rail foot. kind: live | idle | off. */
export function setStatus(kind, text) {
  for (const [dotId, textId] of [['statusDot', 'statusText'], ['railDot', 'railText']]) {
    const dot = document.getElementById(dotId);
    const label = document.getElementById(textId);
    if (dot) dot.className = `pulse-dot ${kind}`;
    if (label) label.textContent = text;
  }
}

function initMenu(rail, btn) {
  btn.addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open');
    btn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    if (document.body.classList.contains('nav-open') && !rail.contains(e.target) && !btn.contains(e.target)) {
      document.body.classList.remove('nav-open');
      btn.setAttribute('aria-expanded', 'false');
    }
  });
}

function initTheme(btn) {
  const paint = () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    btn.querySelector('.sun').classList.toggle('hidden', !dark);
    btn.querySelector('.moon').classList.toggle('hidden', dark);
    btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  };
  btn.addEventListener('click', () => toggleTheme());
  document.addEventListener('ro:themechange', paint);
  paint();
}

function initClock(el) {
  const tick = () => {
    el.textContent = new Date().toLocaleTimeString('en-US', { timeZone: PT, hour: 'numeric', minute: '2-digit' });
  };
  tick();
  setInterval(tick, 1000);
}

/**
 * Build the rail and topbar around the page's <main>. Call once, before the
 * page reads or writes status. Returns the status setter for convenience.
 */
export function mountShell({ brand = 'Ops Hub', start = [], end = [] } = {}) {
  const main = document.querySelector('main');

  const rail = document.createElement('aside');
  rail.className = 'rail';
  rail.id = 'rail';
  rail.setAttribute('aria-label', 'Apps');
  rail.innerHTML = railHtml(currentApp(location.pathname)?.id, { brand, logo: LOGO });
  document.body.insertBefore(rail, main);

  const bar = document.createElement('div');
  bar.className = 'topbar';
  bar.innerHTML = `<button class="menu-btn" id="menuBtn" aria-label="Open apps menu" aria-expanded="false" aria-controls="rail">${MENU_ICON}</button>`
    + '<div class="tb-spacer"></div>'
    + '<span class="status-pill" aria-live="polite"><span class="pulse-dot idle" id="statusDot"></span><span id="statusText">Connecting…</span></span>'
    + '<span class="clock" id="clock">--:--</span>'
    + `<button class="tb-btn" id="themeBtn" aria-label="Switch theme">${SUN_ICON}${MOON_ICON}</button>`;
  const spacer = bar.querySelector('.tb-spacer');
  for (const el of start) if (el) bar.insertBefore(el, spacer);
  for (const el of end) if (el) bar.append(el);
  main.prepend(bar);

  initMenu(rail, bar.querySelector('#menuBtn'));
  initTheme(bar.querySelector('#themeBtn'));
  initClock(bar.querySelector('#clock'));
  return { setStatus };
}
