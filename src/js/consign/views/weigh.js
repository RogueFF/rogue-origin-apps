/** Set a late intake weight on one lot, then offer the next unweighed lot in the same dropoff. */
import { t } from '../../shared/i18n.js';
import { call } from '../api.js';
import { esc, lbs, num, when, typeLabel, termLabel, statusChip } from '../format.js';
import { errorCard, loading, toast } from '../ui.js';
import { submit, actor } from '../save.js';
import { go } from '../nav.js';

export function mount(root, { dropoffId, lotId }) {
  const s = { data: null, error: null, value: '', saving: false, saveError: '', done: false };
  const lot = () => s.data && s.data.lots.find((l) => l.id === lotId);
  const nextLots = () => (s.data ? s.data.lots.filter((l) => l.id !== lotId && !l.voided_at && l.intake_lbs == null) : []);

  function render() {
    if (s.error) return errorCard(root, s.error, load);
    if (!s.data) return loading(root);
    const l = lot();
    if (!l) { root.innerHTML = `<p class="cs-error">${esc(t('notFound'))}</p>`; return; }
    const head = `<section class="cs-card st st-dropped">
      <div class="cs-cardhead"><h2 class="cs-h3">${esc(t('weigh'))}: ${esc(l.cultivar)} ${esc(typeLabel(l.type))}</h2>${statusChip(l.money.status)}</div>
      <p><b>${esc(s.data.dropoff.farm_name)}</b> · ${esc(when(s.data.dropoff.dropped_at))} · ${esc(termLabel(l.term))}</p>
    </section>`;
    if (s.done) {
      const next = nextLots();
      root.innerHTML = `<div class="cs-stack">${head}
        <section class="cs-card st st-closed"><p class="cs-h3">${esc(t('saved'))}: ${lbs(s.value)} ${esc(t('lbs'))}</p>
        <div class="cs-stack" style="margin-top:12px">
          ${next.length
            ? next.map((n) => `<a class="cs-btn primary big" href="#/weigh/${dropoffId}/${n.id}">${esc(t('nextLot'))} ${esc(n.cultivar)} ${esc(typeLabel(n.type))} ›</a>`).join('')
            : `<p>${esc(t('allWeighed'))}</p>`}
          <a class="cs-btn big" href="#/">${esc(t('home'))}</a>
        </div></section></div>`;
      return;
    }
    const can = num(s.value) > 0 && !s.saving;
    root.innerHTML = `<div class="cs-stack">${head}
      <section class="cs-card">
        <label class="cs-field"><span class="cs-label">${esc(t('intakeWeight'))} (${esc(t('lbs'))})</span>
          <input id="weight" class="cs-input cs-num" inputmode="decimal" autocomplete="off" value="${esc(s.value || (l.intake_lbs ?? ''))}"></label>
        <p class="cs-error" id="saveError"${s.saveError ? '' : ' hidden'}>${esc(s.saveError)}</p>
        <div class="cs-row-btns"><a class="cs-btn ghost" href="#/">${esc(t('cancel'))}</a>
          <button type="button" class="cs-btn primary" id="saveBtn"${can ? '' : ' disabled'}>${esc(s.saving ? t('saving') : t('save'))}</button></div>
      </section></div>`;
    const inp = root.querySelector('#weight');
    inp.addEventListener('input', () => { s.value = inp.value; s.saveError = ''; root.querySelector('#saveBtn').disabled = !(num(s.value) > 0); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    root.querySelector('#saveBtn').addEventListener('click', save);
    inp.focus();
  }

  async function save() {
    const w = num(s.value);
    if (!(w > 0) || s.saving) return;
    s.saving = true; render();
    try {
      const res = await submit('setWeight', { lot_id: lotId, intake_lbs: w, actor: actor(), lot_label: `${s.data.dropoff.farm_name} · ${lot().cultivar} ${lot().type}` });
      if (res.held) { toast(t('savedHeld'), 'warn'); return go('#/'); }
      toast(t('saved'));
      s.data.lots = s.data.lots.map((l) => (l.id === lotId ? res.data.lot : l));
      s.done = true;
    } catch (err) {
      s.saveError = err.blocking ? t('holdFailed') : err.message;
    }
    s.saving = false;
    render();
  }

  async function load() {
    s.error = null; s.data = null; render();
    try { s.data = await call('dropoff', { dropoff_id: dropoffId }); } catch (err) { s.error = err; }
    render();
  }
  load();
  return { rerender: render, dirty: () => !s.done && !!String(s.value).trim() };
}
