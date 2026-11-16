/** Record a payment: pick the farm (if not given), see the balance, enter the payment. */
import { t } from '../../shared/i18n.js';
import { call, newKey } from '../api.js';
import { esc, money, num, todayLocal } from '../format.js';
import { errorCard, loading, toast } from '../ui.js';
import { submit } from '../save.js';
import { go } from '../nav.js';

const METHODS = ['check', 'cash', 'transfer'];

export function mount(root, { farmId }) {
  const s = {
    farms: null, error: null, farmId: farmId || null,
    amount: '', paidOn: todayLocal(), method: 'check', reference: '', note: '',
    key: newKey(), saving: false, saveError: '', saved: false,
  };
  const farm = () => s.farms && s.farms.find((f) => f.id === s.farmId);

  function render() {
    if (s.error) return errorCard(root, s.error, load);
    if (!s.farms) return loading(root);
    const f = farm();
    if (!f) {
      const live = s.farms.filter((x) => x.active);
      root.innerHTML = `<h2 class="cs-h2">${esc(t('recordPayment'))}</h2>
        <section class="cs-card cs-step"><div class="cs-stephead"><span class="cs-stepnum">1</span><h2 class="cs-h3">${esc(t('chooseFarm'))}</h2></div>
        ${live.length ? `<div class="cs-farmpick">${live.map((x) => `<button type="button" class="cs-btn big" data-farm="${x.id}">${esc(x.name)}</button>`).join('')}</div>` : `<p>${esc(t('noFarms'))}</p>`}</section>`;
      return;
    }
    const credit = f.balance < 0;
    const can = num(s.amount) > 0 && !s.saving;
    root.innerHTML = `<h2 class="cs-h2">${esc(t('recordPayment'))}</h2><div class="cs-stack">
      <section class="cs-card cs-banner st ${credit ? 'st-closed' : 'st-weighed'}">
        <h3 class="cs-h3">${esc(f.name)}</h3>
        <div class="cs-muted">${esc(t(credit ? 'creditToUs' : 'owed'))}</div>
        <div class="cs-big${credit ? ' cs-credit' : ''}">${money(f.balance)}</div>
        ${f.estimate ? `<span class="cs-chip est">${esc(t('estimate'))}</span>` : ''}
      </section>
      <section class="cs-card">
        <label class="cs-field"><span class="cs-label">${esc(t('amount'))}</span><input id="amount" class="cs-input cs-num" inputmode="decimal" autocomplete="off" value="${esc(s.amount)}"></label>
        <label class="cs-field"><span class="cs-label">${esc(t('date'))}</span><input id="paidOn" class="cs-input" type="date" value="${esc(s.paidOn)}"></label>
        <div class="cs-field"><span class="cs-label">${esc(t('method'))}</span><div class="cs-chips">
          ${METHODS.map((m) => `<button type="button" class="cs-chipbtn${s.method === m ? ' on' : ''}" data-method="${m}" aria-pressed="${s.method === m}">${esc(t(m))}</button>`).join('')}</div></div>
        <label class="cs-field"><span class="cs-label">${esc(t('reference'))}</span><input id="reference" class="cs-input" autocomplete="off" value="${esc(s.reference)}"></label>
        <label class="cs-field"><span class="cs-label">${esc(t('note'))}</span><input id="payNote" class="cs-input" autocomplete="off" value="${esc(s.note)}"></label>
        <p class="cs-error" id="saveError"${s.saveError ? '' : ' hidden'}>${esc(s.saveError)}</p>
        <div class="cs-row-btns"><a class="cs-btn ghost" href="#/">${esc(t('cancel'))}</a>
          <button type="button" class="cs-btn primary" id="saveBtn"${can ? '' : ' disabled'}>${esc(s.saving ? t('saving') : t('save'))}</button></div>
      </section></div>`;
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.farm) { s.farmId = Number(b.dataset.farm); return render(); }
    if (b.dataset.method) { s.method = b.dataset.method; return render(); }
    if (b.id === 'saveBtn') save();
  });
  root.addEventListener('input', (e) => {
    const map = { amount: 'amount', paidOn: 'paidOn', reference: 'reference', payNote: 'note' };
    const k = map[e.target.id];
    if (!k) return;
    s[k] = e.target.value;
    s.saveError = '';
    const btn = root.querySelector('#saveBtn');
    if (btn) btn.disabled = !(num(s.amount) > 0 && !s.saving);
  });

  async function save() {
    if (!(num(s.amount) > 0) || s.saving) return;
    s.saving = true; render();
    const body = { farm_id: s.farmId, farm_name: farm().name, amount: num(s.amount), paid_on: s.paidOn, method: s.method, reference: s.reference.trim(), note: s.note.trim(), client_key: s.key };
    try {
      const res = await submit('savePayment', body);
      s.saved = true;
      toast(res.held ? t('savedHeld') : t('saved'), res.held ? 'warn' : 'ok');
      go(res.held ? '#/' : `#/farm/${s.farmId}`);
    } catch (err) {
      s.saving = false;
      s.saveError = err.blocking ? t('holdFailed') : err.message;
      render();
    }
  }

  async function load() {
    s.error = null; s.farms = null; render();
    try { s.farms = await call('farms'); } catch (err) { s.error = err; }
    render();
  }
  load();
  return { rerender: render, dirty: () => !s.saved && !!String(s.amount).trim() };
}
