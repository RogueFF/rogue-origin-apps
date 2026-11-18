/**
 * Photo of a filled paper sheet.
 *   #/photo/dropoff(/<farm>)   dropoff sheet -> the dropoff form, prefilled
 *   #/photo/screen/<dropoff>   screening sheet -> a review of every lot on it
 * Nothing is saved here: the read opens a form that shows every number, and the
 * person presses Save there. A failed read offers "Enter by hand"; it is never held.
 */
import { t } from '../../shared/i18n.js';
import { call } from '../api.js';
import { esc } from '../format.js';
import { errorCard, loading } from '../ui.js';
import { readSheetPhoto } from '../photo.js';
import { screenableLots } from '../sheets.mjs';
import * as dropoffView from './dropoff.js';
import * as reviewView from './screen-review.js';

const SERVER_FAIL = 'Could not read the sheet. Enter the numbers by hand.';

export function mount(root, { kind, farmId, dropoffId, lotIds }) {
  const s = { phase: kind === 'screen' ? 'loading' : 'pick', detail: null, error: null, message: '', previewUrl: null };
  let inner = null;
  let alive = true;

  const handHref = () => {
    if (kind === 'dropoff') return '#/dropoff';
    return s.detail ? `#/farm/${s.detail.dropoff.farm_id}` : '#/';
  };
  const title = () => t(kind === 'dropoff' ? 'photoDropoff' : 'photoScreen');
  const subtitle = () => (s.detail ? `${s.detail.dropoff.farm_name}` : '');

  function dropPreview() {
    if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
    s.previewUrl = null;
  }

  function render() {
    if (inner) return inner.rerender && inner.rerender();
    if (s.phase === 'loading') return loading(root);
    if (s.phase === 'loadError') return errorCard(root, s.error, load);
    if (s.phase === 'empty') {
      root.innerHTML = `<section class="cs-card"><p>${esc(t('nothingToScreen'))}</p><a class="cs-btn" href="${handHref()}">${esc(t('cancel'))}</a></section>`;
      return;
    }
    const head = `<h2 class="cs-h2">${esc(title())}</h2>${subtitle() ? `<p class="cs-muted">${esc(subtitle())}</p>` : ''}`;
    if (s.phase === 'reading') {
      root.innerHTML = `${head}<section class="cs-card cs-reading" aria-busy="true">
        ${s.previewUrl ? `<img class="cs-photoprev" src="${s.previewUrl}" alt="">` : ''}
        <p class="cs-h3" id="readingMsg">${esc(t('reading'))}</p><p class="cs-muted">${esc(t('readingSlow'))}</p></section>`;
      return;
    }
    const failed = s.phase === 'failed'
      ? `<section class="cs-card st st-price" id="readFailed" role="alert"><p class="cs-error">${esc(s.message)}</p>
          <div class="cs-row-btns"><a class="cs-btn primary big" id="enterByHand" href="${handHref()}">${esc(t('enterByHand'))}</a></div></section>`
      : '';
    root.innerHTML = `${head}<div class="cs-stack">${failed}
      <section class="cs-card">
        <p>${esc(t('photoHint'))}</p>
        <div class="cs-photobtns">
          <label class="cs-btn primary big cs-filebtn">${esc(t(s.phase === 'failed' ? 'tryAnother' : 'takePhoto'))}
            <input type="file" accept="image/*" capture="environment" id="takePhoto" class="cs-fileinput"></label>
          <label class="cs-btn big cs-filebtn">${esc(t('choosePhoto'))}
            <input type="file" accept="image/*" id="choosePhoto" class="cs-fileinput"></label>
        </div>
        ${s.phase === 'failed' ? '' : `<div class="cs-row-btns"><a class="cs-btn ghost" id="enterByHand" href="${handHref()}">${esc(t('enterByHand'))}</a></div>`}
      </section></div>`;
    for (const id of ['takePhoto', 'choosePhoto']) {
      root.querySelector(`#${id}`).addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (file) read(file);
      });
    }
  }

  async function read(file) {
    dropPreview();
    s.previewUrl = URL.createObjectURL(file);
    s.phase = 'reading';
    render();
    let result = null;
    try {
      result = await readSheetPhoto(file, { kind, farmId, dropoffId, lotIds });
    } catch (err) {
      // The worker's one friendly failure is shown in the page language; anything else as the server said it.
      if (err.network) s.message = `${t('errOffline')} ${t('enterByHand')}.`;
      else if (err.message === SERVER_FAIL) s.message = t('readFailed');
      else s.message = err.message || t('errGeneric');
    } finally {
      dropPreview(); // the photo is not kept once the read is back
    }
    if (!alive) return;
    if (result && result.warnings.includes('wrong_sheet')) s.message = t('wrongSheet');
    else if (result && (result.warnings.includes('unreadable') || !result.rows.length)) s.message = t('nothingRead');
    else if (result) return openReview(result);
    s.phase = 'failed';
    render();
  }

  function openReview(result) {
    root.innerHTML = '';
    window.scrollTo(0, 0);
    // A farm that came from the photo (handwriting or a read code), not from the route, must be confirmed.
    if (kind === 'dropoff') inner = dropoffView.mount(root, { prefill: result, farmId: farmId || result.farm_id || null, farmCheck: !farmId && !!result.farm_id });
    else inner = reviewView.mount(root, { dropoffId, read: result, detail: s.detail });
  }

  async function load() {
    if (kind !== 'screen') return render();
    s.phase = 'loading'; render();
    try {
      s.detail = await call('dropoff', { dropoff_id: dropoffId });
      s.phase = screenableLots(s.detail.lots.filter((l) => !l.voided_at)).length ? 'pick' : 'empty';
    } catch (err) { s.error = err; s.phase = 'loadError'; }
    if (alive) render();
  }

  load();
  return {
    rerender: render,
    dirty: () => !!(inner && inner.dirty && inner.dirty()),
    unmount: () => { alive = false; dropPreview(); if (inner && inner.unmount) inner.unmount(); },
  };
}
