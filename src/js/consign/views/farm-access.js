/**
 * "Farm's page" card on the staff farm view, owner mode only (stage 4).
 * Create, replace or turn off the farm's private link. After create the link is shown
 * once, with Copy and a QR code. It lives in this view's memory only: never stored in
 * the browser, gone when the owner leaves the page. The server keeps only its hash.
 */
import { t } from '../../shared/i18n.js';
import { esc, tf, when } from '../format.js';
import { dialog, toast } from '../ui.js';
import { ownerCall } from '../owner.js';
import { qrSvg } from './print.js';

/** The farm's page, next to this one, with the link in the fragment (never sent to a server). */
export const farmLinkUrl = (link) => `${location.origin}${location.pathname.replace(/[^/]*$/, 'consign-farm.html')}#k=${link}`;

/** none | off | autooff | locked | waiting | inuse */
export function accessState(access) {
  if (!access) return 'none';
  if (!access.active) return access.auto_off ? 'autooff' : 'off';
  if (access.locked) return 'locked';
  return access.pin_set ? 'inuse' : 'waiting';
}

const STATE = {
  none: { label: 'farmPageNone', st: 'st-voided' },
  off: { label: 'farmPageOff', st: 'st-voided' },
  autooff: { label: 'farmPageAutoOff', st: 'st-price' },
  locked: { label: 'farmPageLocked', st: 'st-price' },
  waiting: { label: 'farmPageWaiting', st: 'st-weighed' },
  inuse: { label: 'farmPageInUse', st: 'st-closed' },
};

/** Card HTML. shown: the link just created, or null. */
export function accessCardHtml(access, shown) {
  const state = accessState(access);
  const live = state === 'locked' || state === 'waiting' || state === 'inuse';
  const line = state === 'inuse' ? tf('farmPageInUse', { when: when(access.last_seen_at) }) : t(STATE[state].label);
  const linkBox = shown ? `<div class="cs-linkbox" id="farmLinkBox">
      <p class="cs-linkonce"><b>${esc(t('linkShownOnce'))}</b></p>
      <label class="cs-field" for="farmLink"><span class="cs-label">${esc(t('farmLink'))}</span>
        <input id="farmLink" class="cs-input cs-linktext" type="text" readonly value="${esc(farmLinkUrl(shown))}" autocomplete="off" spellcheck="false"></label>
      <div class="cs-qrbox" aria-hidden="true">${qrSvg(farmLinkUrl(shown))}</div>
      <div class="cs-row-btns">
        <button type="button" class="cs-btn primary" id="copyLink">${esc(t('copy'))}</button>
        <button type="button" class="cs-btn ghost" id="hideLink">${esc(t('hideLink'))}</button>
      </div>
    </div>` : '';
  return `<section class="cs-card st ${STATE[state].st} cs-owner-only cs-access" id="farmAccess" data-state="${state}">
    <h3 class="cs-h3">${esc(t('farmPage'))}</h3>
    <p class="cs-access-line" id="farmAccessLine"><b>${esc(line)}</b></p>
    ${access && live && access.issued_at ? `<p class="cs-muted">${esc(tf('farmPageIssued', { when: when(access.issued_at) }))}</p>` : ''}
    <p class="cs-muted">${esc(t('farmPageAbout'))}</p>
    ${linkBox}
    <div class="cs-row-btns">
      ${live
    ? `<button type="button" class="cs-btn" id="newLink">${esc(t('newLink'))}</button>
         <button type="button" class="cs-btn danger" id="turnOffLink">${esc(t('turnOff'))}</button>`
    : `<button type="button" class="cs-btn primary" id="createLink">${esc(t('createLink'))}</button>`}
    </div>
  </section>`;
}

const showErr = (err) => { if (!err.owner) toast(err.network ? t('errOffline') : err.message, 'err'); };

/**
 * Click handling for the card. Returns true when the click was the card's.
 * ctx: { farmId, setShown(link|null), reload() }
 */
export async function onAccessClick(b, ctx) {
  if (b.id === 'createLink' || b.id === 'newLink') {
    if (b.id === 'newLink') {
      const ok = await dialog({ title: t('newLink'), message: t('newLinkConfirm'), okLabel: t('newLink'), danger: true });
      if (!ok) return true;
    }
    try {
      const { token } = await ownerCall('issueFarmAccess', { farm_id: ctx.farmId });
      ctx.setShown(token);
      ctx.reload();
    } catch (err) {
      // No answer: the link may have been made and lost. Making another is always safe.
      if (err.network) { toast(t('linkMaybeLost'), 'err'); ctx.reload(); } else showErr(err);
    }
    return true;
  }
  if (b.id === 'turnOffLink') {
    const ok = await dialog({ title: t('turnOff'), message: t('turnOffConfirm'), okLabel: t('turnOff'), danger: true });
    if (!ok) return true;
    try {
      await ownerCall('revokeFarmAccess', { farm_id: ctx.farmId });
      ctx.setShown(null);
      toast(t('saved'));
      ctx.reload();
    } catch (err) { showErr(err); }
    return true;
  }
  if (b.id === 'copyLink') {
    const input = document.getElementById('farmLink');
    try {
      await navigator.clipboard.writeText(input.value);
      toast(t('copied'));
    } catch {
      input.select();
      toast(t('copyFailed'), 'warn');
    }
    return true;
  }
  if (b.id === 'hideLink') {
    ctx.setShown(null);
    ctx.rerender();
    return true;
  }
  return false;
}
