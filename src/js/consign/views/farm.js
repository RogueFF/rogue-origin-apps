/**
 * Farm page: balance banner, price points (locked for staff), dropoffs with each
 * lot's step, payments. Owner mode adds farm edit, price points and lot terms.
 */
import { t } from '../../shared/i18n.js';
import { call, newKey } from '../api.js';
import { esc, lbs, money, num, when, day, typeLabel, termLabel, statusChip, todayLocal } from '../format.js';
import { errorCard, loading, toast, dialog } from '../ui.js';
import { submit, actor } from '../save.js';
import { farmDialog, priceDialog, lotTermsDialog } from '../owner.js';

export function mount(root, { farmId }) {
  const s = { data: null, error: null };
  const allLots = () => (s.data ? s.data.dropoffs.flatMap((d) => d.lots) : []);

  function banner() {
    const tt = s.data.totals;
    const credit = tt.balance < 0;
    return `<section class="cs-card cs-banner st ${credit ? 'st-closed' : 'st-weighed'}">
      <h2 class="cs-h2" style="margin:0">${esc(s.data.farm.name)}</h2>
      <div class="cs-muted">${esc(t(credit ? 'creditToUs' : 'owed'))}</div>
      <div class="cs-big${credit ? ' cs-credit' : ''}" id="balance">${money(tt.balance)}</div>
      <div class="cs-chips" style="justify-content:center">${tt.estimate ? `<span class="cs-chip est">${esc(t('estimate'))}</span>` : ''}${tt.needs_price ? `<span class="cs-chip noprice">${esc(t('needsPrice'))}</span>` : ''}</div>
      <p class="cs-muted">${esc(t('paidToDate'))}: ${money(tt.paid)}</p>
      <div class="cs-row-btns" style="justify-content:center">
        <a class="cs-btn primary" href="#/pay/${s.data.farm.id}">$ ${esc(t('recordPayment'))}</a>
        <button type="button" class="cs-btn cs-owner-only" id="editFarm">${esc(t('editFarm'))}</button>
      </div>
    </section>`;
  }

  function prices() {
    const by = {};
    for (const p of s.data.price_points) (by[p.cultivar] ||= {})[p.type] = p;
    const names = Object.keys(by).sort((a, b) => a.localeCompare(b));
    return `<section class="cs-card"><div class="cs-crowhead"><h3 class="cs-h3">${esc(t('pricePoints'))}</h3>
      <button type="button" class="cs-btn small cs-owner-only" id="addPrice">＋ ${esc(t('addPricePoint'))}</button></div>
      ${names.length ? `<div class="cs-prices">${names.map((c) => `<div class="cs-tap static"><b>${esc(c)}</b>
        <span class="cs-after">${['tops', 'smalls'].map((ty) => `${esc(t(ty))} <b>${by[c][ty] ? money(by[c][ty].price_per_lb) : '—'}</b>`).join(' · ')}</span></div>`).join('')}</div>`
      : `<p class="cs-muted">${esc(t('noPricePoints'))}</p>`}
    </section>`;
  }

  function lotHtml(d, l) {
    const m = l.money;
    const after = m.pulled_lbs > 0
      ? `<div class="cs-after">${esc(t(l.type === 'smalls' ? 'finalSmalls' : 'finalTops'))} <b>${lbs(m.final_lbs)}</b>${l.type === 'tops' ? ` · ${esc(t('toSmalls'))} <b>${lbs(m.to_smalls_lbs)}</b>` : ''} · ${esc(t('biomass'))} <b>${lbs(m.biomass_lbs)}</b> · ${esc(t('mold'))} <b>${lbs(m.mold_lbs)}</b>${m.remainder_lbs > 0 ? ` · ${esc(t('leftToScreen'))} <b>${lbs(m.remainder_lbs)}</b>` : ''}</div>` : '';
    const sold = l.term === 'sold'
      ? `<div class="cs-after">${esc(t('onHand'))} <b>${lbs(m.on_hand_lbs)}</b> · ${esc(t('sold'))} <b>${lbs(m.sold_main_lbs + m.sold_smalls_lbs)}</b> ${esc(t('lbs'))}</div>` : '';
    return `<div class="cs-lot st-${m.status}" data-lot="${l.id}">
      <div class="cs-lothead">${statusChip(m.status)}<b>${esc(l.cultivar)} ${esc(typeLabel(l.type))}</b>
        <span>${m.intake_lbs == null ? `<span class="cs-muted">${esc(t('notWeighedYet'))}</span>` : `${lbs(m.intake_lbs)} ${esc(t('lbs'))}`}</span>
        <span class="cs-muted">${esc(termLabel(l.term))}</span>
        ${m.needs_price ? `<span class="cs-chip noprice">${esc(t('noPrice'))}</span>` : ''}${m.estimate && m.owed > 0 ? `<span class="cs-chip est">${esc(t('estimate'))}</span>` : ''}</div>
      ${after}${sold}${l.note ? `<div class="cs-muted">${esc(t('note'))}: ${esc(l.note)}</div>` : ''}
      <div class="cs-lotbtns">
        ${m.status === 'dropped' ? `<a class="cs-btn small" href="#/weigh/${d.id}/${l.id}">${esc(t('weigh'))}</a>` : ''}
        ${m.status === 'weighed' || m.status === 'screening' ? `<a class="cs-btn small" href="#/screen/${d.id}/${l.id}">${esc(t('screen'))}</a>` : ''}
        ${l.term === 'sold' && m.intake_lbs != null ? `<button type="button" class="cs-btn small" data-sold="${l.id}">＋ ${esc(t('addSold'))}</button>` : ''}
        <button type="button" class="cs-btn small cs-owner-only" data-terms="${l.id}">${esc(t('editPrice'))}</button>
        <button type="button" class="cs-btn small danger" data-void="lot|${l.id}">${esc(t('void'))}</button>
      </div>
    </div>`;
  }

  function dropoffs() {
    const ds = s.data.dropoffs;
    return `<h2 class="cs-h2">${esc(t('dropoffs'))}</h2>
      ${ds.length ? `<div class="cs-stack">${ds.map((d) => `<section class="cs-card" data-dropoff="${d.id}">
        <div class="cs-cardhead"><h3 class="cs-h3">${esc(when(d.dropped_at))}</h3>
          <button type="button" class="cs-btn small danger" data-void="dropoff|${d.id}">${esc(t('void'))}</button></div>
        ${d.lots.some((l) => l.money.status === 'weighed' || l.money.status === 'screening') ? `<div class="cs-row-btns"><a class="cs-btn small" href="#/print/screen/${d.id}" data-printscreen="${d.id}">🖨 ${esc(t('printScreenSheet'))}</a></div>` : ''}
        ${d.dropped_by || d.note ? `<p class="cs-muted">${esc(d.dropped_by || '')}${d.dropped_by && d.note ? ' · ' : ''}${esc(d.note || '')}</p>` : ''}
        ${d.lots.map((l) => lotHtml(d, l)).join('')}
      </section>`).join('')}</div>` : `<p class="cs-muted">${esc(t('noDropoffs'))}</p>`}`;
  }

  function payments() {
    const ps = s.data.payments;
    return `<section class="cs-card"><h3 class="cs-h3">${esc(t('payments'))}</h3>
      ${ps.length ? `<ul class="cs-list" style="margin-top:8px">${ps.map((p) => `<li class="cs-tap static">
        <span>${esc(day(p.paid_on))}</span><b>${money(p.amount)}</b>
        <span class="cs-muted">${esc(p.method ? t(p.method) : '')}${p.reference ? ` #${esc(p.reference)}` : ''}${p.note ? ` · ${esc(p.note)}` : ''}</span>
        <button type="button" class="cs-btn small danger cs-right" data-void="payment|${p.id}">${esc(t('void'))}</button></li>`).join('')}</ul>`
      : `<p class="cs-muted">${esc(t('noPayments'))}</p>`}</section>`;
  }

  function render() {
    if (s.error) return errorCard(root, s.error, load);
    if (!s.data) return loading(root);
    root.innerHTML = `<div class="cs-stack">${banner()}${prices()}${dropoffs()}${payments()}</div>`;
  }

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !s.data) return;
    if (b.id === 'editFarm') return farmDialog(s.data.farm);
    if (b.id === 'addPrice') return priceDialog(s.data.farm);
    if (b.dataset.terms) return lotTermsDialog(allLots().find((l) => l.id === Number(b.dataset.terms)));
    if (b.dataset.void) {
      const [table, id] = b.dataset.void.split('|');
      const v = await dialog({ title: t('void'), fields: [{ name: 'reason', label: t('voidReason'), required: true }], okLabel: t('void'), danger: true });
      if (!v) return;
      try {
        await call('voidRow', { table, id: Number(id), reason: v.reason, actor: actor() });
        toast(t('saved'));
        load();
      } catch (err) { toast(err.network ? t('errOffline') : err.message, 'err'); }
      return;
    }
    if (b.dataset.sold) {
      const lot = allLots().find((l) => l.id === Number(b.dataset.sold));
      const kinds = [{ value: 'main', label: `${t('soldMain')} (${t(lot.type)})` }];
      if (lot.type === 'tops' && lot.money.to_smalls_lbs > 0) kinds.push({ value: 'smalls', label: t('toSmalls') });
      const v = await dialog({
        title: `${t('addSold')}: ${lot.cultivar} ${t(lot.type)}`,
        fields: [
          { name: 'lbs', label: `${t('sold')} (${t('lbs')})`, type: 'number', required: true },
          { name: 'kind', label: t('soldKind'), type: 'select', value: 'main', options: kinds },
          { name: 'sold_on', label: t('date'), type: 'date', value: todayLocal(), required: true },
          { name: 'note', label: t('note') },
        ],
        okLabel: t('save'),
      });
      if (!v) return;
      try {
        const res = await submit('saveSold', { lot_id: lot.id, lot_label: `${s.data.farm.name} · ${lot.cultivar} ${lot.type}`, lbs: num(v.lbs), kind: v.kind, sold_on: v.sold_on, note: v.note, client_key: newKey() });
        toast(res.held ? t('savedHeld') : t('saved'), res.held ? 'warn' : 'ok');
        if (!res.held) load();
      } catch (err) { toast(err.blocking ? t('holdFailed') : err.message, 'err'); }
    }
  });

  async function load() {
    s.error = null;
    if (!s.data) render();
    try { s.data = await call('farm', { farm_id: farmId }); } catch (err) { s.error = err; }
    render();
  }
  const onReload = () => load();
  document.addEventListener('consign:reload', onReload);
  load();
  return { rerender: render, unmount: () => document.removeEventListener('consign:reload', onReload) };
}
