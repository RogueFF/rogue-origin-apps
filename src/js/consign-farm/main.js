/**
 * The partner farm's own page (stage 4). Read-only.
 * Plan: docs/plans/2026-11-16-consignment-lot-ledger-stage4.md, task 7.
 *
 * Opened by consign-farm.html#k=<link>. The link stays in the URL fragment on purpose:
 * the fragment is never sent to GitHub Pages or in a referrer, and keeping it in the URL
 * means "Add to Home Screen" saves the full link. It is never stripped and never stored.
 * The PIN is asked for each time the page opens and is kept in memory only.
 *
 * Screens: loading | bad (no/dead link) | setpin | pin | locked | page
 */
import './labels.js';
import { t, getLang, setLang, toggleLang } from '../shared/i18n.js';
import { esc, tf } from '../consign/format.js';
import { farmCall } from './api.js';
import { pageHtml } from './view.js';

const readLink = () => {
  const m = /(?:^#|&)k=([A-Za-z0-9_-]{43})(?:&|$)/.exec(location.hash || '');
  return m ? m[1] : null;
};
let LINK = readLink();

const root = document.getElementById('view');
const s = { screen: 'loading', data: null, msg: '', msgKind: '', minutes: 0, busy: false, langPicked: false };
let pin = null; // memory only

const $ = (id) => document.getElementById(id);

function langLabel() {
  $('langToggle').innerHTML = getLang() === 'es' ? '<b>ES</b> · EN' : 'ES · <b>EN</b>';
}

function msgHtml() {
  if (!s.msg) return '<p class="cf-msg" id="msg" role="alert" hidden></p>';
  return `<p class="cf-msg ${s.msgKind}" id="msg" role="alert">${esc(s.msg)}</p>`;
}

const pinInput = (id, label) => `<label class="cf-field" for="${id}"><span class="cf-label">${esc(label)}</span>
  <input id="${id}" class="cf-pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" enterkeyhint="go"></label>`;

function render() {
  document.title = s.screen === 'page' && s.data ? `${s.data.farm.name} · ${t('brand')}` : `${t('pageTitle')} · ${t('brand')}`;
  let html = '';
  switch (s.screen) {
    case 'loading':
      html = `<p class="cf-muted cf-loading">${esc(t('loading'))}</p>`;
      break;
    case 'bad':
      html = `<section class="cf-card cf-gate is-bad" id="badLink"><h2 class="cf-h2">${esc(t('notActive'))}</h2><p>${esc(t('notActiveHelp'))}</p></section>`;
      break;
    case 'neterr':
      html = `<section class="cf-card cf-gate" id="netErr"><p>${esc(s.msg || t('noSignal'))}</p>
        <div class="cf-btns"><button type="button" class="cf-btn primary" id="retryBtn">${esc(t('tryAgain'))}</button></div></section>`;
      break;
    case 'setpin':
      html = `<form class="cf-card cf-gate" id="setPinForm" novalidate>
        <h2 class="cf-h2">${esc(t('setPinTitle'))}</h2>
        <p>${esc(t('setPinHelp'))}</p>
        ${pinInput('pin1', t('pinNew'))}
        ${pinInput('pin2', t('pinAgain'))}
        ${msgHtml()}
        <div class="cf-btns"><button type="submit" class="cf-btn primary" id="setPinBtn"${s.busy ? ' disabled' : ''}>${esc(t('pinSave'))}</button></div>
      </form>`;
      break;
    case 'pin':
      html = `<form class="cf-card cf-gate" id="pinForm" novalidate>
        <h2 class="cf-h2">${esc(t('pinTitle'))}</h2>
        <p>${esc(t('pinHelp'))}</p>
        ${pinInput('pin1', t('pin'))}
        ${msgHtml()}
        <div class="cf-btns"><button type="submit" class="cf-btn primary" id="pinBtn"${s.busy ? ' disabled' : ''}>${esc(t('open'))}</button></div>
        <p class="cf-muted">${esc(t('forgotPin'))}</p>
      </form>`;
      break;
    case 'locked':
      html = `<section class="cf-card cf-gate is-locked" id="lockedCard">
        <h2 class="cf-h2">${esc(t('lockedTitle'))}</h2>
        <p id="lockedMsg">${esc(s.minutes === 1 ? t('lockedOne') : tf('locked', { n: s.minutes }))}</p>
        <div class="cf-btns"><button type="button" class="cf-btn primary" id="retryBtn">${esc(t('tryAgain'))}</button></div>
        <p class="cf-muted">${esc(t('forgotPin'))}</p>
      </section>`;
      break;
    case 'page':
      html = pageHtml(s.data);
      break;
    default:
      html = '';
  }
  root.innerHTML = html;
  const first = root.querySelector('#pin1');
  if (first) first.focus();
}

function setMsg(msg, kind = 'err') { s.msg = msg; s.msgKind = kind; }

/** Turn a refusal into the right screen. */
function onError(err, screenIfWrong) {
  s.busy = false;
  if (err.network) { setMsg(t('noSignal')); s.screen = screenIfWrong || 'neterr'; return render(); }
  if (err.code === 'UNAUTHORIZED') { pin = null; s.screen = 'bad'; return render(); }
  if (err.code === 'RATE_LIMITED') { pin = null; s.screen = 'locked'; s.minutes = Number(err.details.minutes_left) || 15; return render(); }
  if (err.code === 'VALIDATION_ERROR' && err.details && err.details.tries_left != null) {
    pin = null;
    const n = Number(err.details.tries_left);
    setMsg(n === 1 ? t('wrongPinOne') : tf('wrongPin', { n }));
    s.screen = 'pin';
    return render();
  }
  if (err.code === 'VALIDATION_ERROR' && err.details && err.details.needs_pin) { setMsg(''); s.screen = 'setpin'; return render(); }
  if (err.code === 'VALIDATION_ERROR' && /already set/i.test(err.message)) { setMsg(t('pinAlreadySet'), 'info'); s.screen = 'pin'; return render(); }
  setMsg(t('errGeneric'));
  s.screen = screenIfWrong || 'neterr';
  return render();
}

function showPage(data) {
  s.data = data;
  s.busy = false;
  setMsg('');
  if (!s.langPicked && data.farm.lang && data.farm.lang !== getLang()) setLang(data.farm.lang);
  s.screen = 'page';
  render();
  window.scrollTo(0, 0);
}

async function start() {
  if (!LINK) { s.screen = 'bad'; return render(); }
  s.screen = 'loading';
  setMsg('');
  render();
  try {
    const st = await farmCall('status', { token: LINK });
    if (!s.langPicked && st.lang && st.lang !== getLang()) setLang(st.lang);
    if (st.locked) { s.screen = 'locked'; s.minutes = st.minutes_left; } else s.screen = st.needs_pin ? 'setpin' : 'pin';
    render();
  } catch (err) { onError(err); }
}

const fourDigits = (v) => /^[0-9]{4}$/.test(v);

root.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (s.busy) return;
  const p1 = ($('pin1') && $('pin1').value.trim()) || '';
  if (e.target.id === 'setPinForm') {
    const p2 = ($('pin2') && $('pin2').value.trim()) || '';
    if (!fourDigits(p1)) { setMsg(t('pinFour')); return render(); }
    if (p1 !== p2) { setMsg(t('pinMismatch')); return render(); }
    s.busy = true;
    render();
    try { const v = await farmCall('setPin', { token: LINK, pin: p1 }); pin = p1; showPage(v); } catch (err) { onError(err, 'setpin'); }
    return;
  }
  if (e.target.id === 'pinForm') {
    if (!fourDigits(p1)) { setMsg(t('pinFour')); return render(); }
    s.busy = true;
    render();
    try { const v = await farmCall('view', { token: LINK, pin: p1 }); pin = p1; showPage(v); } catch (err) { onError(err, 'pin'); }
  }
});

root.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'retryBtn') return start();
  if (b.id === 'closeBtn') { pin = null; s.data = null; return start(); }
  if (b.id === 'refreshBtn') {
    if (!pin) return start();
    b.disabled = true;
    try { showPage(await farmCall('view', { token: LINK, pin })); } catch (err) { onError(err, 'pin'); }
  }
});

// Only digits in the PIN boxes.
root.addEventListener('input', (e) => {
  if (e.target.classList && e.target.classList.contains('cf-pin')) {
    const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 4);
    if (v !== e.target.value) e.target.value = v;
  }
});

$('langToggle').addEventListener('click', () => { s.langPicked = true; toggleLang(); });
document.addEventListener('ro:langchange', () => {
  langLabel();
  // Keep what was typed in the PIN boxes across a language switch.
  const typed = ['pin1', 'pin2'].map((id) => ($(id) ? $(id).value : ''));
  render();
  ['pin1', 'pin2'].forEach((id, i) => { if ($(id)) $(id).value = typed[i]; });
});

// A different link pasted into the same tab: start over with it (and forget the PIN).
window.addEventListener('hashchange', () => { const next = readLink(); if (next !== LINK) { LINK = next; pin = null; s.data = null; start(); } });

langLabel();
start();
