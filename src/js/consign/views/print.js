/**
 * Print a paper sheet: a reduced preview on screen and one big Print button.
 *   #/print/dropoff            blank dropoff sheet (any farm)
 *   #/print/dropoff/<farm>     that farm's priced cultivars pre-printed
 *   #/print/screen/<dropoff>   screening rows for that dropoff's open lots
 * The sheet is put in #printArea while this view is open, so the browser's own Print works too.
 */
import { t } from '../../shared/i18n.js';
import { call } from '../api.js';
import { esc, when } from '../format.js';
import { errorCard, loading } from '../ui.js';
import { dropoffSheet, screenSheet, screenableLots, sheetCode } from '../sheets.mjs';

const PAGE_PX = 816; // 8.5 in at 96 px per inch

/** The QR goes back to this page's photo screen. Query strings (e.g. ?api=) are left off on purpose. */
const photoUrl = (hash) => `${location.origin}${location.pathname}#/${hash}`;

export function qrSvg(text) {
  try {
    if (typeof window.qrcode === 'function') {
      const q = window.qrcode(0, 'M');
      q.addData(text);
      q.make();
      return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    }
  } catch { /* fall through: the printed code line still identifies the sheet */ }
  return '';
}

export function mount(root, { kind, farmId, dropoffId }) {
  const s = { html: null, titleKey: '', titleName: null, back: '#/', error: null, empty: false };
  let printedIds = '';
  const photoHash = () => (kind === 'screen' ? `photo/screen/${dropoffId}${printedIds ? `/${printedIds}` : ''}` : `photo/dropoff${farmId ? `/${farmId}` : ''}`);
  const title = () => `${t(s.titleKey)}: ${s.titleName == null ? t('blankSheet') : s.titleName}`;
  const area = document.getElementById('printArea');

  function fit() {
    const pv = root.querySelector('#sheetPreview');
    const paper = root.querySelector('.sh-paper');
    if (pv && paper) paper.style.zoom = String(Math.min(1, pv.clientWidth / PAGE_PX));
  }

  function render() {
    if (s.error) return errorCard(root, s.error, load);
    if (!s.html && !s.empty) return loading(root);
    if (s.empty) {
      root.innerHTML = `<section class="cs-card"><p>${esc(t('nothingToScreen'))}</p><a class="cs-btn" href="${s.back}">${esc(t('cancel'))}</a></section>`;
      return;
    }
    root.innerHTML = `<div class="cs-stack">
      <section class="cs-card">
        <h2 class="cs-h3">${esc(title())}</h2>
        <p class="cs-muted">${esc(t('printHint'))}</p>
        <div class="cs-row-btns"><a class="cs-btn ghost" href="${s.back}">${esc(t('cancel'))}</a>
          <a class="cs-btn" id="photoAfterPrint" href="#/${photoHash()}">${esc(t('photoSheet'))}</a>
          <button type="button" class="cs-btn primary big" id="printBtn">${esc(t('printBtn'))}</button></div>
      </section>
      <div class="sh-preview" id="sheetPreview" aria-label="${esc(title())}"><div class="sh-paper">${s.html}</div></div>
    </div>`;
    root.querySelector('#printBtn').addEventListener('click', () => window.print());
    fit();
  }

  async function load() {
    s.error = null; s.html = null; s.empty = false; render();
    try {
      if (kind === 'dropoff') {
        let farm = null;
        let cultivars = [];
        if (farmId) {
          const d = await call('farm', { farm_id: farmId });
          farm = d.farm;
          cultivars = [...new Set(d.price_points.map((p) => p.cultivar))].sort((a, b) => a.localeCompare(b));
          s.back = `#/farm/${farmId}`;
        }
        s.titleKey = 'printDropoffSheet'; s.titleName = farm ? farm.name : null;
        s.html = dropoffSheet({
          farm, cultivars,
          qrSvg: qrSvg(photoUrl(farmId ? `photo/dropoff/${farmId}` : 'photo/dropoff')),
          code: sheetCode('dropoff', farmId),
        });
      } else {
        const d = await call('dropoff', { dropoff_id: dropoffId });
        s.back = `#/farm/${d.dropoff.farm_id}`;
        s.titleKey = 'printScreenSheet'; s.titleName = d.dropoff.farm_name;
        const lots = d.lots.filter((l) => !l.voided_at);
        if (!screenableLots(lots).length) { s.empty = true; return render(); }
        // The QR carries the printed lots, in order, so the reader numbers rows the same way.
        printedIds = screenableLots(lots).map((l) => l.id).join('.');
        s.html = screenSheet({
          dropoff: { farm_name: d.dropoff.farm_name, date: when(d.dropoff.dropped_at, { time: false }), dropped_by: d.dropoff.dropped_by },
          lots,
          qrSvg: qrSvg(photoUrl(photoHash())),
          code: sheetCode('screen', dropoffId),
        });
      }
      if (area) area.innerHTML = s.html;
    } catch (err) { s.error = err; }
    render();
  }

  window.addEventListener('resize', fit);
  load();
  return {
    rerender: render,
    unmount: () => { window.removeEventListener('resize', fit); if (area) area.innerHTML = ''; },
  };
}
