/**
 * The farm's page: large, distinct cards in a fixed order.
 * Where we stand -> Your prices -> Your dropoffs -> Payments -> On hand and sold (sold lots only).
 * Renders only what /api/consign-farm returns (farmView, allowlisted server side).
 */
import { t } from '../shared/i18n.js';
import { esc, lbs, money, day, when, statusChip, typeLabel, termLabel } from '../consign/format.js';

const tag = (key, cls = '') => `<span class="cf-tag ${cls}">${esc(t(key))}</span>`;

function stand(v) {
  const tt = v.totals;
  const credit = tt.balance < 0;
  const zero = tt.balance === 0;
  const head = zero ? t('allSquare') : t(credit ? 'creditToRo' : 'weOweYou');
  return `<section class="cf-card cf-stand ${credit ? 'is-credit' : zero ? 'is-zero' : 'is-owed'}" id="stand" aria-labelledby="standH">
    <h2 class="cf-h2" id="standH">${esc(t('standTitle'))}</h2>
    <p class="cf-standlabel" id="standLabel">${esc(head)}</p>
    ${zero ? '' : `<p class="cf-big" id="balance">${money(tt.balance)}</p>`}
    ${tt.estimate ? `<p class="cf-est">${tag('estimate', 'est')} <span>${esc(t('estimateHelp'))}</span></p>` : ''}
    <dl class="cf-facts">
      <div><dt>${esc(t('owedToDate'))}</dt><dd>${money(tt.owed)}</dd></div>
      <div><dt>${esc(t('paidToDate'))}</dt><dd>${money(tt.paid)}</dd></div>
      <div><dt>${esc(t('lastPayment'))}</dt><dd id="lastPayment">${tt.last_payment_on ? esc(day(tt.last_payment_on)) : esc(t('noPaymentYet'))}</dd></div>
    </dl>
  </section>`;
}

function prices(v) {
  // One row per cultivar, matched without case (as the server picks prices).
  const by = new Map();
  for (const p of v.price_points) {
    const k = p.cultivar.toLowerCase();
    if (!by.has(k)) by.set(k, { name: p.cultivar, pr: {} });
    by.get(k).pr[p.type] = p.price_per_lb;
  }
  const rows = [...by.values()].map(({ name: c, pr }) => `<li class="cf-price">
      <b class="cf-name">${esc(c)}</b>
      <span class="cf-pp">${['tops', 'smalls'].filter((ty) => pr[ty] != null).map((ty) => `<span>${esc(typeLabel(ty))} <b>${money(pr[ty])}</b> ${esc(t('perLb'))}</span>`).join('')}</span>
    </li>`).join('');
  return `<section class="cf-card" id="prices" aria-labelledby="pricesH">
    <h2 class="cf-h2" id="pricesH">${esc(t('pricesTitle'))}</h2>
    ${rows ? `<p class="cf-muted">${esc(t('pricesHelp'))}</p><ul class="cf-list cf-prices">${rows}</ul>` : `<p class="cf-muted">${esc(t('noPrices'))}</p>`}
  </section>`;
}

function lotHtml(l) {
  const screened = l.final_lbs != null;
  const outs = screened ? [
    [l.type === 'smalls' ? 'finalSmalls' : 'finalTops', l.final_lbs],
    ...(l.type === 'tops' ? [['toSmalls', l.to_smalls_lbs]] : []),
    ['biomass', l.biomass_lbs],
    ['mold', l.mold_lbs],
  ] : [];
  return `<li class="cf-lot st-${esc(l.status)}" data-lot="${l.id}">
    <div class="cf-lothead">
      <b class="cf-name">${esc(l.cultivar)} ${esc(typeLabel(l.type))}</b>
      ${statusChip(l.status)}
    </div>
    <p class="cf-lotin">${l.intake_lbs == null ? esc(t('notWeighedYet')) : `<b>${lbs(l.intake_lbs)}</b> ${esc(t('lbIn'))}`}
      · ${l.needs_price ? `<span class="cf-noprice">${esc(t('priceToCome'))}</span>` : `${money(l.price_per_lb)} ${esc(t('perLb'))}`}
      · <span class="cf-muted">${esc(termLabel(l.term))}</span></p>
    ${screened ? `<div class="cf-after"><span class="cf-afterh">${esc(t('after'))}</span>
      <dl class="cf-outs">${outs.map(([k, n]) => `<div><dt>${esc(t(k))}</dt><dd>${lbs(n)} ${esc(t('lbs'))}</dd></div>`).join('')}</dl></div>` : ''}
    ${l.term === 'sold' ? `<p class="cf-soldline">${esc(t('soldSoFar'))} <b>${lbs(l.sold_lbs)} ${esc(t('lbs'))}</b> · ${esc(t('onHand'))} <b>${lbs(l.on_hand_lbs)} ${esc(t('lbs'))}</b></p>` : ''}
    <p class="cf-lotowed">${esc(t('owedLot'))}: <b>${money(l.owed)}</b>${l.estimate ? ` ${tag('estimate', 'est')}` : ''}</p>
    ${l.note ? `<p class="cf-note">${esc(t('note'))}: ${esc(l.note)}</p>` : ''}
  </li>`;
}

function dropoffs(v) {
  const ds = v.dropoffs;
  return `<section class="cf-card" id="dropoffs" aria-labelledby="dropH">
    <h2 class="cf-h2" id="dropH">${esc(t('dropoffsTitle'))}</h2>
    ${ds.length ? ds.map((d) => `<article class="cf-drop" data-dropoff="${d.id}">
      <h3 class="cf-h3">${esc(t('droppedOff'))} ${esc(when(d.dropped_at, { time: false }))}</h3>
      <ul class="cf-list">${d.lots.map(lotHtml).join('')}</ul>
    </article>`).join('') : `<p class="cf-muted">${esc(t('noDropoffs'))}</p>`}
  </section>`;
}

function payments(v) {
  const ps = v.payments;
  return `<section class="cf-card" id="payments" aria-labelledby="payH">
    <h2 class="cf-h2" id="payH">${esc(t('paymentsTitle'))}</h2>
    ${ps.length ? `<ul class="cf-list">${ps.map((p) => `<li class="cf-pay">
      <span class="cf-payday">${esc(day(p.paid_on))}</span>
      <b class="cf-payamt">${money(p.amount)}</b>
      <span class="cf-muted">${p.method ? esc(t(p.method)) : ''}${p.reference ? ` · ${esc(t('refNo'))} ${esc(p.reference)}` : ''}</span>
    </li>`).join('')}</ul>` : `<p class="cf-muted">${esc(t('noPayments'))}</p>`}
  </section>`;
}

function soldCard(v) {
  const lots = v.dropoffs.flatMap((d) => d.lots).filter((l) => l.term === 'sold');
  if (!lots.length) return '';
  const onHand = lots.reduce((a, l) => a + (Number(l.on_hand_lbs) || 0), 0);
  const sold = lots.reduce((a, l) => a + (Number(l.sold_lbs) || 0), 0);
  return `<section class="cf-card" id="sold" aria-labelledby="soldH">
    <h2 class="cf-h2" id="soldH">${esc(t('soldTitle'))}</h2>
    <p class="cf-muted">${esc(t('soldHelp'))}</p>
    <dl class="cf-facts">
      <div><dt>${esc(t('onHand'))}</dt><dd>${lbs(Math.round(onHand * 100) / 100)} ${esc(t('lbs'))}</dd></div>
      <div><dt>${esc(t('soldSoFar'))}</dt><dd>${lbs(Math.round(sold * 100) / 100)} ${esc(t('lbs'))}</dd></div>
    </dl>
    <ul class="cf-list">${lots.map((l) => `<li class="cf-price"><b class="cf-name">${esc(l.cultivar)} ${esc(typeLabel(l.type))}</b>
      <span class="cf-pp"><span>${esc(t('onHand'))} <b>${lbs(l.on_hand_lbs)}</b></span><span>${esc(t('soldSoFar'))} <b>${lbs(l.sold_lbs)}</b> ${esc(t('lbs'))}</span></span></li>`).join('')}</ul>
  </section>`;
}

export function pageHtml(v, notice = '') {
  return `<div class="cf-stack">
    <h1 class="cf-farm" id="farmName">${esc(v.farm.name)}</h1>
    ${notice ? `<p class="cf-msg err" id="pageMsg" role="alert">${esc(notice)}</p>` : ''}
    ${stand(v)}${prices(v)}${dropoffs(v)}${payments(v)}${soldCard(v)}
    <p class="cf-muted cf-foot">${esc(t('footer'))}</p>
    <div class="cf-btns">
      <button type="button" class="cf-btn" id="refreshBtn">${esc(t('refresh'))}</button>
      <button type="button" class="cf-btn ghost" id="closeBtn">${esc(t('lockPage'))}</button>
    </div>
  </div>`;
}

