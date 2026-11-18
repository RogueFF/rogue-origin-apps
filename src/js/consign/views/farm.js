/**
 * Farm page: banner, dropoffs with each lot's step. Owner mode adds the money (balance,
 * paid to date, price points, the Estimate tag, payments, Record payment), farm edit,
 * the farm's page link, price points and lot terms, and an Edit button on every saved thing
 * (farm-edit.js). Staff replies carry no money, and this page draws none outside owner mode,
 * whatever came back; nor any Edit button.
 */
import { t } from '../../shared/i18n.js';
import { call, newKey } from '../api.js';
import { esc, lbs, money, num, when, day, typeLabel, termLabel, statusChip, todayLocal } from '../format.js';
import { errorCard, loading, toast, dialog, moreHtml, keepOpen } from '../ui.js';
import { submit, actor } from '../save.js';
import { farmDialog, priceDialog, lotTermsDialog, isOwner } from '../owner.js';
import { accessCardHtml, onAccessClick } from './farm-access.js';
import { editPriceDialog, editDropoffDialog, editLotDialog, editRunDialog, editSoldDialog, editPaymentDialog } from './farm-edit.js';

export function mount(root, { farmId }) {
  // shown: a farm link just created. Memory only, shown once, gone when this view goes.
  const s = { data: null, error: null, shown: null };
  const allLots = () => (s.data ? s.data.dropoffs.flatMap((d) => d.lots) : []);

  /** Money on this page: owner mode, and a reply that carries it. */
  const showMoney = () => isOwner() && !!s.data.totals && typeof s.data.totals.balance === 'number';
  /** An Edit button, owner mode only. what: price|dropoff|lot|run|sold|payment, then ids. */
  const editBtn = (what, cls = '') => (isOwner()
    ? `<button type="button" class="cs-btn small cs-edit${cls ? ` ${cls}` : ''}" data-edit="${esc(what)}">${esc(t('edit'))}</button>` : '');

  function banner() {
    if (!showMoney()) {
      const noPrice = allLots().some((l) => l.money && l.money.needs_price);
      return `<section class="cs-card cs-banner st st-weighed">
        <h2 class="cs-h2" style="margin:0">${esc(s.data.farm.name)}</h2>
        ${noPrice ? `<div class="cs-chips" style="justify-content:center"><span class="cs-chip noprice">${esc(t('needsPrice'))}</span></div>` : ''}
        <div class="cs-row-btns" style="justify-content:center">
          <a class="cs-btn primary" href="#/dropoff">${esc(t('newDropoff'))}</a>
          <button type="button" class="cs-btn cs-owner-only" id="editFarm">${esc(t('editFarm'))}</button>
        </div>
      </section>`;
    }
    const tt = s.data.totals;
    const credit = tt.balance < 0;
    return `<section class="cs-card cs-banner st ${credit ? 'st-closed' : 'st-weighed'}">
      <h2 class="cs-h2" style="margin:0">${esc(s.data.farm.name)}</h2>
      <div class="cs-muted">${esc(t(credit ? 'creditToUs' : 'owed'))}</div>
      <div class="cs-big${credit ? ' cs-credit' : ''}" id="balance">${money(tt.balance)}</div>
      <div class="cs-chips" style="justify-content:center">${tt.estimate ? `<span class="cs-chip est">${esc(t('estimate'))}</span>` : ''}${tt.needs_price ? `<span class="cs-chip noprice">${esc(t('needsPrice'))}</span>` : ''}</div>
      <p class="cs-muted">${esc(t('paidToDate'))}: ${money(tt.paid)}</p>
      <div class="cs-row-btns" style="justify-content:center">
        <a class="cs-btn primary" href="#/pay/${s.data.farm.id}">${esc(t('recordPayment'))}</a>
        <button type="button" class="cs-btn cs-owner-only" id="editFarm">${esc(t('editFarm'))}</button>
      </div>
    </section>`;
  }

  /** One row per cultivar: name, then tops and smalls, each price its own Edit button. */
  function prices() {
    if (!showMoney()) return '';
    const by = {};
    for (const p of s.data.price_points) (by[p.cultivar] ||= {})[p.type] = p;
    const names = Object.keys(by).sort((a, b) => a.localeCompare(b));
    const cell = (c, ty) => {
      const p = by[c][ty];
      if (!p) return `<span class="cs-ppcell empty"><span class="cs-pptype">${esc(t(ty))}</span> <b>—</b></span>`;
      return `<button type="button" class="cs-ppcell cs-edit" data-edit="price|${p.id}" data-pp="${p.id}" aria-label="${esc(t('edit'))}: ${esc(c)} ${esc(t(ty))}">
        <span class="cs-pptype">${esc(t(ty))}</span> <b>${money(p.price_per_lb)}</b> <span class="cs-ppedit">${esc(t('edit'))}</span></button>`;
    };
    return `<section class="cs-card"><div class="cs-crowhead"><h3 class="cs-h3">${esc(t('pricePoints'))}</h3>
      <button type="button" class="cs-btn small cs-owner-only" id="addPrice">${esc(t('addPricePoint'))}</button></div>
      ${names.length ? `<ul class="cs-pplist">${names.map((c) => `<li class="cs-pprow"><b class="cs-ppname">${esc(c)}</b>${cell(c, 'tops')}${cell(c, 'smalls')}</li>`).join('')}</ul>`
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
        ${showMoney() && l.term === 'dropoff' && m.pulled_lbs > 0 ? `<span class="cs-chip">${esc(t(Number(l.absorb_loss) === 1 ? 'paidOnDropoffLbs' : 'paidOnFinalLbs'))}</span>` : ''}
        ${m.needs_price ? `<span class="cs-chip noprice">${esc(t('noPrice'))}</span>` : ''}${showMoney() && m.estimate && m.owed > 0 ? `<span class="cs-chip est">${esc(t('estimate'))}</span>` : ''}</div>
      ${after}${sold}${l.note ? `<div class="cs-muted">${esc(t('note'))}: ${esc(l.note)}${Number(l.note_visible) === 1 ? ` <span class="cs-chip">${esc(t('farmSeesNote'))}</span>` : ''}</div>` : ''}
      <div class="cs-lotbtns">${lotMain(d, l)}${lotMore(l)}</div>
    </div>`;
  }

  /** The lot's one main step as a button: Weigh, else Screen, else none (finished). */
  function lotMain(d, l) {
    const st = l.money.status;
    if (st === 'dropped') return `<a class="cs-btn small" href="#/weigh/${d.id}/${l.id}">${esc(t('weigh'))}</a>`;
    if (st === 'weighed' || st === 'screening') return `<a class="cs-btn small" href="#/screen/${d.id}/${l.id}">${esc(t('screen'))}</a>`;
    return '';
  }

  /** Everything else on a lot, in one More: sold pounds, Edit, term / price, Void, and (owner) its runs and sold entries. */
  function lotMore(l) {
    const m = l.money;
    return moreHtml(`lot|${l.id}`, `<div class="cs-lotbtns">
        ${l.term === 'sold' && m.intake_lbs != null ? `<button type="button" class="cs-btn small" data-sold="${l.id}">${esc(t('addSold'))}</button>` : ''}
        ${editBtn(`lot|${l.id}`)}
        <button type="button" class="cs-btn small cs-owner-only" data-terms="${l.id}">${esc(t('editPrice'))}</button>
        <button type="button" class="cs-btn small danger" data-void="lot|${l.id}">${esc(t('void'))}</button>
      </div>
      ${entriesHtml(l)}`);
  }

  /** Owner mode: each live screening run and sold entry of a lot, with its own Edit. */
  function entriesHtml(l) {
    if (!isOwner()) return '';
    const runs = (l.runs || []).filter((r) => !r.voided_at);
    const sold = (l.sold || []).filter((x) => !x.voided_at);
    if (!runs.length && !sold.length) return '';
    const fin = t(l.type === 'smalls' ? 'finalSmalls' : 'finalTops');
    return `<ul class="cs-list cs-entries">
      ${runs.map((r) => `<li class="cs-tap static cs-entry" data-run="${r.id}"><span class="cs-entryhead"><b>${esc(t('runEntry'))}</b> <span class="cs-muted">${esc(when(r.run_at))}</span></span>
        <span class="cs-after">${esc(t('pulled'))} <b>${lbs(r.pulled_lbs)}</b> · ${esc(fin)} <b>${lbs(r.final_lbs)}</b>${l.type === 'tops' ? ` · ${esc(t('toSmalls'))} <b>${lbs(r.to_smalls_lbs)}</b>` : ''} · ${esc(t('biomass'))} <b>${lbs(r.biomass_lbs)}</b> · ${esc(t('mold'))} <b>${lbs(r.mold_lbs)}</b></span>
        ${editBtn(`run|${l.id}|${r.id}`, 'cs-right')}</li>`).join('')}
      ${sold.map((x) => `<li class="cs-tap static cs-entry" data-soldrow="${x.id}"><span class="cs-entryhead"><b>${esc(t('sold'))}</b> <span class="cs-muted">${esc(day(x.sold_on))}</span></span>
        <span class="cs-after"><b>${lbs(x.lbs)}</b> ${esc(t('lbs'))}${x.kind === 'smalls' ? ` · ${esc(t('toSmalls'))}` : ''}${x.note ? ` · ${esc(x.note)}` : ''}</span>
        ${editBtn(`sold|${l.id}|${x.id}`, 'cs-right')}</li>`).join('')}
    </ul>`;
  }

  /** Who received it and the note, as one quiet labelled line. */
  const dropMeta = (d) => {
    const bits = [];
    if (d.dropped_by) bits.push(`${esc(t('receivedBy'))}: ${esc(d.dropped_by)}`);
    if (d.note) bits.push(`${esc(t('note'))}: ${esc(d.note)}`);
    return bits.length ? `<p class="cs-muted cs-dropmeta">${bits.join(' · ')}</p>` : '';
  };

  function dropoffs() {
    const ds = s.data.dropoffs;
    const screenable = (d) => d.lots.some((l) => l.money.status === 'weighed' || l.money.status === 'screening');
    return `<h2 class="cs-h2">${esc(t('dropoffs'))}</h2>
      ${ds.length ? `<div class="cs-stack">${ds.map((d) => `<section class="cs-card" data-dropoff="${d.id}">
        <div class="cs-cardhead"><h3 class="cs-h3">${esc(when(d.dropped_at))}</h3>
          ${moreHtml(`dropoff|${d.id}`, `${screenable(d) ? `<a class="cs-btn small" href="#/print/screen/${d.id}" data-printscreen="${d.id}">${esc(t('printScreenSheet'))}</a>
            <a class="cs-btn small" href="#/photo/screen/${d.id}" data-photoscreen="${d.id}">${esc(t('photoSheet'))}</a>` : ''}${editBtn(`dropoff|${d.id}`)}<button type="button" class="cs-btn small danger" data-void="dropoff|${d.id}">${esc(t('void'))}</button>`, { cls: 'cs-headmore' })}</div>
        ${dropMeta(d)}
        ${d.lots.map((l) => lotHtml(d, l)).join('')}
      </section>`).join('')}</div>` : `<p class="cs-muted">${esc(t('noDropoffs'))}</p>`}`;
  }

  function payments() {
    if (!showMoney() || !Array.isArray(s.data.payments)) return '';
    const ps = s.data.payments;
    return `<section class="cs-card"><h3 class="cs-h3">${esc(t('payments'))}</h3>
      ${ps.length ? `<ul class="cs-list" style="margin-top:8px">${ps.map((p) => `<li class="cs-tap static">
        <span>${esc(day(p.paid_on))}</span><b>${money(p.amount)}</b>
        <span class="cs-muted">${esc(p.method ? t(p.method) : '')}${p.reference ? ` #${esc(p.reference)}` : ''}${p.note ? ` · ${esc(p.note)}` : ''}</span>
        <span class="cs-headbtns cs-right">${editBtn(`payment|${p.id}`)}<button type="button" class="cs-btn small danger" data-void="payment|${p.id}">${esc(t('void'))}</button></span></li>`).join('')}</ul>`
      : `<p class="cs-muted">${esc(t('noPayments'))}</p>`}</section>`;
  }

  function render() {
    if (s.error) return errorCard(root, s.error, load);
    if (!s.data) return loading(root);
    keepOpen(root, () => { root.innerHTML = `<div class="cs-stack">${banner()}${isOwner() && 'access' in s.data ? accessCardHtml(s.data.access, s.shown) : ''}${prices()}${dropoffs()}${payments()}</div>`; });
  }

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !s.data) return;
    if (await onAccessClick(b, { farmId, setShown: (v) => { s.shown = v; }, reload: load, rerender: render })) return;
    if (b.id === 'editFarm') return farmDialog(s.data.farm);
    if (b.id === 'addPrice') return priceDialog(s.data.farm);
    if (b.dataset.terms) return lotTermsDialog(allLots().find((l) => l.id === Number(b.dataset.terms)));
    if (b.dataset.edit) return onEdit(b.dataset.edit);
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

  /** An Edit button: find the row it is on and open its dialog. */
  function onEdit(spec) {
    if (!isOwner()) return null;
    const [what, a, c] = spec.split('|');
    const id = Number(a);
    const lot = () => allLots().find((l) => l.id === id);
    if (what === 'price') { const p = s.data.price_points.find((x) => x.id === id); return p && editPriceDialog(p); }
    if (what === 'dropoff') { const d = s.data.dropoffs.find((x) => x.id === id); return d && editDropoffDialog(d); }
    if (what === 'lot') { const l = lot(); return l && editLotDialog(l); }
    if (what === 'run') { const l = lot(); const r = l && l.runs.find((x) => x.id === Number(c)); return r && editRunDialog(l, r); }
    if (what === 'sold') { const l = lot(); const x = l && l.sold.find((y) => y.id === Number(c)); return x && editSoldDialog(l, x); }
    if (what === 'payment') { const p = (s.data.payments || []).find((x) => x.id === id); return p && editPaymentDialog(p); }
    return null;
  }

  async function load() {
    s.error = null;
    if (!s.data) render();
    try { s.data = await call('farm', { farm_id: farmId }); } catch (err) { s.error = err; }
    render();
  }
  const onReload = () => load();
  document.addEventListener('consign:reload', onReload);
  load();
  return { rerender: render, unmount: () => { s.shown = null; document.removeEventListener('consign:reload', onReload); } };
}
