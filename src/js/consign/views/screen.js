/**
 * Screening run on one lot: before number on top, outputs below, and a live
 * "adds up / off by X lb" bar that uses the server's own rule (format.runCheck).
 */
import { t } from '../../shared/i18n.js';
import { call, newKey } from '../api.js';
import { esc, lbs, num, when, typeLabel, termLabel, statusChip, runCheck } from '../format.js';
import { errorCard, loading, toast, dialog } from '../ui.js';
import { submit, actor } from '../save.js';
import { go } from '../nav.js';

export function mount(root, { dropoffId, lotId }) {
  const s = {
    data: null, error: null, key: newKey(), whole: true, finishes: true, pulled: '',
    out: { final: '', toSmalls: '', biomass: '', mold: '' }, note: '', saving: false, saveError: '', saved: false, touched: false,
  };
  const lot = () => s.data && s.data.lots.find((l) => l.id === lotId);
  const fields = (l) => (l.type === 'smalls'
    ? [['final', 'finalSmalls'], ['biomass', 'biomass'], ['mold', 'mold']]
    : [['final', 'finalTops'], ['toSmalls', 'toSmalls'], ['biomass', 'biomass'], ['mold', 'mold']]);
  const check = (l) => runCheck(s.pulled, fields(l).map(([k]) => s.out[k]));

  function checkBar(l) {
    const c = check(l);
    if (c.ok) return `<div class="cs-checkbar good" id="checkBar">✓ ${esc(t('addsUp'))}</div>`;
    return `<div class="cs-checkbar bad" id="checkBar">✕ ${esc(t('offBy'))} ${lbs(Math.abs(c.diff))} ${esc(t('lbs'))} (${esc(t('allowed'))} ${lbs(c.tolerance)} ${esc(t('lbs'))})</div>`;
  }

  function runsHtml(l) {
    const runs = l.runs || [];
    if (!runs.length) return '';
    return `<section class="cs-card"><h3 class="cs-h3">${esc(t('runs'))}</h3><ul class="cs-list" style="margin-top:8px">
      ${runs.map((r) => `<li class="cs-tap static${r.voided_at ? ' cs-voidedrow' : ''}">
        <span>${esc(when(r.run_at))}</span>
        <span class="cs-after">${esc(t('pulled'))} <b>${lbs(r.pulled_lbs)}</b> · ${esc(t(l.type === 'smalls' ? 'finalSmalls' : 'finalTops'))} <b>${lbs(r.final_lbs)}</b>${l.type === 'tops' ? ` · ${esc(t('toSmalls'))} <b>${lbs(r.to_smalls_lbs)}</b>` : ''} · ${esc(t('biomass'))} <b>${lbs(r.biomass_lbs)}</b> · ${esc(t('mold'))} <b>${lbs(r.mold_lbs)}</b></span>
        ${r.voided_at ? `<span class="cs-chip st-voided">${esc(t('voided'))}</span>` : `<button type="button" class="cs-btn small danger cs-right" data-voidrun="${r.id}">${esc(t('void'))}</button>`}
      </li>`).join('')}</ul></section>`;
  }

  function render() {
    if (s.error) return errorCard(root, s.error, load);
    if (!s.data) return loading(root);
    const l = lot();
    if (!l) { root.innerHTML = `<p class="cs-error">${esc(t('notFound'))}</p>`; return; }
    const m = l.money;
    const head = `<section class="cs-card st st-${m.status}">
      <div class="cs-cardhead"><h2 class="cs-h3">${esc(t('screening'))}: ${esc(l.cultivar)} ${esc(typeLabel(l.type))}</h2>${statusChip(m.status)}</div>
      <p><b>${esc(s.data.dropoff.farm_name)}</b> · ${esc(when(s.data.dropoff.dropped_at))} · ${esc(termLabel(l.term))}</p>
      <div class="cs-band">
        <div class="st-weighed"><div class="cs-label">${esc(t('before'))}</div><div class="cs-big" id="beforeLbs">${lbs(m.intake_lbs)}</div><div>${esc(t('lbs'))}</div></div>
        <div class="st-screening"><div class="cs-label">${esc(t('leftToScreen'))}</div><div class="cs-big" id="leftLbs">${lbs(m.remainder_lbs)}</div><div>${esc(t('lbs'))}</div></div>
      </div>
    </section>`;
    let body;
    if (m.intake_lbs == null) {
      body = `<section class="cs-card"><p>${esc(t('weighFirst'))}</p><a class="cs-btn primary" href="#/weigh/${dropoffId}/${l.id}">${esc(t('weigh'))} ›</a></section>`;
    } else if (l.closed_at) {
      body = `<section class="cs-card st st-closed"><p class="cs-h3">${esc(t('lotClosed'))}</p></section>`;
    } else {
      if (s.whole && !s.touched) s.pulled = String(m.remainder_lbs);
      const c = check(l);
      body = `<section class="cs-card">
        <div class="cs-crowhead"><label class="cs-check"><input type="checkbox" id="wholeLot"${s.whole ? ' checked' : ''}> <span>${esc(t('wholeLot'))}</span></label></div>
        <label class="cs-field"><span class="cs-label">${esc(t('pulled'))} (${esc(t('lbs'))})</span>
          <input id="pulled" class="cs-input cs-num" inputmode="decimal" autocomplete="off" value="${esc(s.pulled)}"></label>
        <div class="cs-outs">${fields(l).map(([k, label]) => `<label class="cs-field"><span class="cs-label">${esc(t(label))} (${esc(t('lbs'))})</span>
          <input class="cs-input cs-num" inputmode="decimal" autocomplete="off" data-out="${k}" value="${esc(s.out[k])}"></label>`).join('')}</div>
        <div id="checkWrap">${checkBar(l)}</div>
        <label class="cs-check" style="margin-top:12px"><input type="checkbox" id="finishes"${s.finishes ? ' checked' : ''}> <span>${esc(t('finishesLot'))}</span></label>
        <label class="cs-field"><span class="cs-label">${esc(t('note'))}</span><input class="cs-input" id="runNote" value="${esc(s.note)}" autocomplete="off"></label>
        <p class="cs-error" id="saveError"${s.saveError ? '' : ' hidden'}>${esc(s.saveError)}</p>
        <div class="cs-row-btns"><a class="cs-btn ghost" href="#/">${esc(t('cancel'))}</a>
          <button type="button" class="cs-btn primary" id="saveBtn"${c.ok && !s.saving ? '' : ' disabled'}>${esc(s.saving ? t('saving') : t('save'))}</button></div>
      </section>`;
    }
    root.innerHTML = `<div class="cs-stack">${head}${body}${runsHtml(l)}</div>`;
  }

  function refreshCheck() {
    const l = lot();
    const wrap = root.querySelector('#checkWrap');
    if (!wrap) return;
    wrap.innerHTML = checkBar(l);
    root.querySelector('#saveBtn').disabled = !(check(l).ok && !s.saving);
  }

  root.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'pulled') { s.pulled = el.value; s.touched = true; } else if (el.dataset.out) { s.out[el.dataset.out] = el.value; s.touched = true; } else if (el.id === 'runNote') { s.note = el.value; return; } else return;
    s.saveError = '';
    const err = root.querySelector('#saveError'); if (err) err.hidden = true;
    refreshCheck();
  });

  root.addEventListener('change', (e) => {
    const el = e.target;
    if (el.id === 'wholeLot') {
      s.whole = el.checked;
      s.finishes = el.checked;
      // Part of a lot: clear the box so the pounds pulled are typed, not assumed.
      s.pulled = el.checked ? String(lot().money.remainder_lbs) : '';
      s.touched = !el.checked;
      render();
      if (!el.checked) root.querySelector('#pulled').focus();
    } else if (el.id === 'finishes') s.finishes = el.checked;
  });

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'saveBtn') return save();
    if (b.dataset.voidrun) {
      const v = await dialog({ title: `${t('void')}: ${t('screening')}`, fields: [{ name: 'reason', label: t('voidReason'), required: true }], okLabel: t('void'), danger: true });
      if (!v) return;
      try {
        await call('voidRow', { table: 'run', id: Number(b.dataset.voidrun), reason: v.reason, actor: actor() });
        toast(t('saved'));
        s.touched = false;
        load();
      } catch (err) { toast(err.network ? t('errOffline') : err.message, 'err'); }
    }
  });

  async function save() {
    const l = lot();
    if (!check(l).ok || s.saving) return;
    s.saving = true; refreshCheck();
    root.querySelector('#saveBtn').textContent = t('saving');
    const body = {
      lot_id: l.id, pulled_lbs: num(s.pulled), final_lbs: num(s.out.final) || 0, to_smalls_lbs: num(s.out.toSmalls) || 0,
      biomass_lbs: num(s.out.biomass) || 0, mold_lbs: num(s.out.mold) || 0,
      finishes_lot: !!s.finishes, note: s.note.trim(), client_key: s.key, actor: actor(),
    };
    try {
      const res = await submit('saveScreenRun', body);
      s.saved = true;
      toast(res.held ? t('savedHeld') : t('saved'), res.held ? 'warn' : 'ok');
      go('#/');
    } catch (err) {
      s.saving = false;
      s.saveError = err.blocking ? t('holdFailed') : err.message;
      render();
    }
  }

  async function load() {
    s.error = null; s.data = null; render();
    try { s.data = await call('dropoff', { dropoff_id: dropoffId }); } catch (err) { s.error = err; }
    render();
  }
  load();
  return { rerender: render, dirty: () => !s.saved && s.touched };
}
