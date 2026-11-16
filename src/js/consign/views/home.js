/**
 * Home: the two big actions, three work cards (weigh, screen, price) and a card per farm.
 */
import { t } from '../../shared/i18n.js';
import { call } from '../api.js';
import { esc, lbs, money, when, typeLabel } from '../format.js';
import { errorCard, loading } from '../ui.js';

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

export function mount(root) {
  let data = null;
  let error = null;

  const render = () => {
    if (error) return errorCard(root, error, load);
    if (!data) return loading(root);
    const { open, farms } = data;
    const live = farms.filter((f) => f.active);
    root.innerHTML = `
      <div class="cs-actions">
        <a class="cs-btn primary big" href="#/dropoff" id="newDropoffBtn">＋ ${esc(t('newDropoff'))}</a>
        <a class="cs-btn big" href="#/pay" id="payBtn">$ ${esc(t('recordPayment'))}</a>
        <button type="button" class="cs-btn big cs-owner-only" id="addFarmBtn">${esc(t('addFarm'))}</button>
      </div>
      <div id="heldBox"></div>
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
    document.dispatchEvent(new CustomEvent('consign:homerendered', { detail: { root } }));
  };

  async function load() {
    error = null; data = null; render();
    try {
      const [open, farms] = await Promise.all([call('open'), call('farms')]);
      data = { open, farms };
    } catch (e) { error = e; }
    render();
  }

  const onReload = () => load();
  document.addEventListener('consign:reload', onReload);
  load();
  return { rerender: render, unmount: () => document.removeEventListener('consign:reload', onReload) };
}
