/**
 * Home: the two big actions, three work cards (weigh, screen, price) and a card per farm.
 */
import { t } from '../../shared/i18n.js';
import { call } from '../api.js';
import { esc, lbs, money, when, typeLabel } from '../format.js';
import { errorCard, loading, dialog } from '../ui.js';
import { queue, rejectedList, clearRejected, retryRejected } from '../held.js';

const lotLine = (l) => `<b>${esc(l.farm_name)}</b> · ${esc(l.cultivar)} · ${esc(typeLabel(l.type))}`;

function workCard({ key, st, rows, row }) {
  return `<section class="cs-card st st-${st}" data-card="${key}">
    <div class="cs-cardhead"><h3 class="cs-h3">${esc(t(key))}</h3><span class="cs-count">${rows.length}</span></div>
    ${rows.length ? `<ul class="cs-list">${rows.map(row).join('')}</ul>` : `<p class="cs-muted">${esc(t('nothingWaiting'))}</p>`}
  </section>`;
}

function farmCard(f) {
  const credit = f.balance < 0;
  return `<a class="cs-card cs-farm" href="#/farm/${f.id}" data-farm="${f.id}">
    <div class="cs-cardhead"><h3 class="cs-h3">${esc(f.name)}</h3>${f.estimate ? `<span class="cs-chip est">${esc(t('estimate'))}</span>` : ''}</div>
    <div class="cs-muted">${esc(t(credit ? 'creditToUs' : 'owed'))}</div>
    <div class="cs-big${credit ? ' cs-credit' : ''}">${money(f.balance)}</div>
    ${f.needs_price ? `<span class="cs-chip noprice">${esc(t('needsPrice'))}</span>` : ''}
  </a>`;
}

const ACTION_KEYS = { saveDropoff: 'newDropoff', setWeight: 'weigh', saveScreenRun: 'screening', saveSold: 'addSold', savePayment: 'recordPayment' };
const w = (n) => (n == null || n === '' ? '—' : `${lbs(n)} ${t('lbs')}`);

/** What the entry was, in enough detail to re-enter it by hand. */
function entryWhat(e) {
  const b = e.body || {};
  switch (e.action) {
    case 'saveDropoff': return `${b.farm_name || ''}: ${(b.lines || []).map((l) => `${l.cultivar} ${typeLabel(l.type)} ${w(l.intake_lbs)}`).join(', ')}`;
    case 'setWeight': return `${b.lot_label || ''}: ${w(b.intake_lbs)}`;
    case 'saveScreenRun': return `${b.lot_label || ''}: ${t('pulled')} ${w(b.pulled_lbs)} · ${t('final')} ${w(b.final_lbs)} · ${t('toSmalls')} ${w(b.to_smalls_lbs)} · ${t('biomass')} ${w(b.biomass_lbs)} · ${t('mold')} ${w(b.mold_lbs)}`;
    case 'saveSold': return `${b.lot_label || ''}: ${w(b.lbs)}`;
    case 'savePayment': return `${b.farm_name || ''}: ${money(b.amount)} ${b.method ? t(b.method) : ''} ${b.reference ? `#${b.reference}` : ''}`;
    default: return '';
  }
}
const entryLine = (e) => `<li class="cs-tap static"><b>${esc(t(ACTION_KEYS[e.action] || 'save'))}</b><span>${esc(entryWhat(e))}</span><span class="cs-muted">${esc(new Date(e.held_at).toLocaleString())}</span>${e.error ? `<span class="cs-error">${esc(e.error)}</span>` : ''}</li>`;

/** Held entries waiting for a signal, and any the server refused on resend. */
function heldBox() {
  const held = queue.list();
  const rejected = rejectedList();
  let html = '';
  if (held.length) {
    html += `<section class="cs-card st st-dropped" style="margin-bottom:16px"><div class="cs-cardhead"><h3 class="cs-h3">${esc(t('heldSend'))}</h3><span class="cs-count">${held.length}</span></div>
      <ul class="cs-list">${held.map(entryLine).join('')}</ul>
      <div class="cs-row-btns"><button type="button" class="cs-btn primary" id="sendHeldBtn">${esc(t('heldSend'))}</button></div></section>`;
  }
  if (rejected.length) {
    html += `<section class="cs-card st st-price" style="margin-bottom:16px"><div class="cs-cardhead"><h3 class="cs-h3">${esc(t('notSaved'))}</h3><span class="cs-count">${rejected.length}</span></div>
      <ul class="cs-list">${rejected.map(entryLine).join('')}</ul>
      <div class="cs-row-btns"><button type="button" class="cs-btn danger" id="dismissRejected">${esc(t('dismiss'))}</button>
        <button type="button" class="cs-btn primary" id="retryRejected">${esc(t('retry'))}</button></div></section>`;
  }
  return html;
}

export function mount(root) {
  let data = null;
  let error = null;

  const render = () => {
    if (error) {
      // No signal: still show what is held on this device.
      root.innerHTML = `<div id="heldBox">${heldBox()}</div><div id="errWrap"></div>`;
      errorCard(root.querySelector('#errWrap'), error, load);
      return wireHeld();
    }
    if (!data) return loading(root);
    const { open, farms } = data;
    const live = farms.filter((f) => f.active);
    root.innerHTML = `
      <div class="cs-actions">
        <a class="cs-btn primary big" href="#/dropoff" id="newDropoffBtn">＋ ${esc(t('newDropoff'))}</a>
        <a class="cs-btn big" href="#/photo/dropoff" id="photoSheetBtn">📷 ${esc(t('photoSheet'))}</a>
        <a class="cs-btn big" href="#/pay" id="payBtn">$ ${esc(t('recordPayment'))}</a>
        <a class="cs-btn big" href="#/print/dropoff" id="printSheetBtn">🖨 ${esc(t('printDropoffSheet'))}</a>
        <button type="button" class="cs-btn big cs-owner-only" id="addFarmBtn">${esc(t('addFarm'))}</button>
      </div>
      <div id="heldBox">${heldBox()}</div>
      <div class="cs-grid2">
        ${workCard({ key: 'toWeigh', st: 'dropped', rows: open.to_weigh, row: (l) => `<li><a class="cs-tap" href="#/weigh/${l.dropoff_id}/${l.id}">${lotLine(l)}<span class="cs-muted">${esc(when(l.dropped_at))}</span><span class="cs-right">${esc(t('weigh'))} ›</span></a></li>` })}
        ${workCard({ key: 'toScreen', st: 'weighed', rows: open.to_screen, row: (l) => `<li><a class="cs-tap" href="#/screen/${l.dropoff_id}/${l.id}">${lotLine(l)}<span class="cs-muted">${esc(when(l.dropped_at))}</span>${l.money.status === 'screening' ? `<span class="cs-chip st-screening">${lbs(l.money.remainder_lbs)} ${esc(t('lbLeft'))}</span>` : ''}<span class="cs-right">${lbs(l.money.intake_lbs)} ${esc(t('lbs'))}</span></a></li>` })}
        ${workCard({ key: 'needsPrice', st: 'price', rows: open.needs_price, row: (l) => `<li><a class="cs-tap owner-link" href="#/farm/${l.farm_id}" data-staff-static>${lotLine(l)}<span class="cs-muted">${esc(when(l.dropped_at))}</span></a></li>` })}
      </div>
      <h2 class="cs-h2">${esc(t('farms'))}</h2>
      ${live.length ? `<div class="cs-grid2">${live.map(farmCard).join('')}</div>` : `<p class="cs-muted">${esc(t('noFarms'))}</p>`}
    `;
    // Needs-a-price rows are only links in owner mode; staff cannot set a price.
    root.querySelectorAll('[data-staff-static]').forEach((a) => {
      a.addEventListener('click', (e) => { if (document.body.dataset.owner !== '1') e.preventDefault(); });
    });
    root.querySelector('#addFarmBtn').addEventListener('click', () => document.dispatchEvent(new CustomEvent('consign:addfarm')));
    wireHeld();
  };

  async function load() {
    error = null; data = null; render();
    try {
      const [open, farms] = await Promise.all([call('open'), call('farms')]);
      data = { open, farms };
    } catch (e) { error = e; }
    render();
  }

  function wireHeld() {
    const send = root.querySelector('#sendHeldBtn');
    if (send) send.addEventListener('click', () => document.getElementById('heldChip').click());
    const dis = root.querySelector('#dismissRejected');
    if (dis) {
      dis.addEventListener('click', async () => {
        const ok = await dialog({ title: t('dismiss'), fields: [{ name: 'sure', label: t('dismissConfirm'), type: 'checkbox', value: false }], okLabel: t('dismiss'), danger: true });
        if (ok && ok.sure) clearRejected();
      });
    }
    const retry = root.querySelector('#retryRejected');
    if (retry) retry.addEventListener('click', async () => { await retryRejected(); document.dispatchEvent(new CustomEvent('consign:reload')); });
  }
  function refreshHeld() {
    const box = root.querySelector('#heldBox');
    if (!box) return;
    box.innerHTML = heldBox();
    wireHeld();
  }

  const onReload = () => load();
  document.addEventListener('consign:reload', onReload);
  document.addEventListener('consign:held', refreshHeld);
  load();
  return {
    rerender: render,
    unmount: () => { document.removeEventListener('consign:reload', onReload); document.removeEventListener('consign:held', refreshHeld); },
  };
}
