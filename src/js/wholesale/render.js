/**
 * Wholesale order board — board rendering.
 *
 * Cards are built with DOM APIs rather than innerHTML: customer names, notes
 * and cultivar names are operator-entered free text, and this page will one day
 * ingest Shopify order data too. textContent removes the injection question
 * instead of answering it with an escaper.
 */

import { state, visibleOrders, fmtLbs, fmtUsd, statusLabel } from './state.js';
import { humanDate } from './queue.js';
import { t } from '../shared/i18n.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function lineRow(item) {
  const row = el('div', 'oc-line');
  row.append(
    el('span', 'cv', item.cultivarName || item.cultivarId),
    el('span', 'fm', item.form),
    el('span', 'qt', item.enteredUnit === 'kg'
      ? `${item.enteredQty} kg`
      : fmtLbs(item.qtyLbs)),
  );
  return row;
}

function card(order) {
  const node = el('button', `order-card s-${order.status}`);
  node.type = 'button';
  node.dataset.orderId = order.id;
  node.setAttribute('aria-label', `${order.id}, ${order.customerName || 'no customer'}, ${statusLabel(order.status)}`);

  const top = el('div', 'oc-top');
  top.append(el('span', 'oc-id', order.id));
  top.append(el('span', `pill s-${order.status}`, statusLabel(order.status)));
  node.append(top);

  const cust = el('div', 'oc-customer');
  cust.append(el('strong', null, order.customerName || '—'));
  if (order.paymentTerms) cust.append(document.createTextNode(order.paymentTerms));
  node.append(cust);

  if (order.items.length) {
    const lines = el('div', 'oc-lines');
    order.items.forEach(i => lines.append(lineRow(i)));
    node.append(lines);
  } else {
    node.append(el('div', 'oc-empty', t('no_lines')));
  }

  const foot = el('div', 'oc-foot');
  foot.append(el('span', 'lbs', fmtLbs(order.totalLbs)));
  foot.append(el('span', 'usd', fmtUsd(order.totalValue)));
  node.append(foot);

  // The promise date, and which cultivar is holding it up — the number worth
  // looking at is not the sum of the order's own hours.
  const sched = state.queue?.orders?.[order.id];
  if (sched) {
    const wrap = el('div', 'oc-eta');
    const line = el('div', 'oc-eta-date');
    line.append(document.createTextNode(`${t('est_finish')} `));
    line.append(el('b', null, humanDate(sched.finish.date)));
    if (sched.estimated) line.append(el('span', 'oc-soft', ` ${t('soft')}`));
    wrap.append(line);
    const heldName = state.cultivars.find(c => c.id === sched.heldBy)?.name || sched.heldBy;
    wrap.append(el('div', 'oc-eta-why', `${t('held_by')} ${heldName}`));
    node.append(wrap);
  }

  return node;
}

export function renderBoard() {
  const board = document.getElementById('board');
  board.textContent = '';

  const orders = visibleOrders();
  if (!orders.length) {
    const empty = el('div', 'empty-state');
    empty.append(el('i', 'ph-duotone ph-package'));
    empty.append(el('p', null, state.orders.length ? t('none_match') : t('no_orders')));
    board.append(empty);
    return;
  }

  orders.forEach(o => board.append(card(o)));
}

export function renderFilters() {
  document.querySelectorAll('.chip[data-filter]').forEach(chip => {
    const on = chip.dataset.filter === state.filter;
    chip.classList.toggle('active', on);
    chip.setAttribute('aria-pressed', String(on));
  });
}
