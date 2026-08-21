/**
 * Wholesale — the completed-orders list.
 *
 * The queue is the page, and orders are reached from the runs that feed them.
 * But a finished order has left the queue, so without this it would be
 * unreachable. Deliberately a compact list rather than cards: this is an
 * archive to look something up in, not a working surface.
 *
 * Built with DOM APIs, not innerHTML — nicknames and cultivar names are
 * operator-entered free text, and this page ingests Shopify data.
 */

import { state, fmtLbs, fmtUsd, statusLabel } from './state.js';
import { t } from '../shared/i18n.js';

/**
 * Statuses the queue schedules. Everything else lands in this list.
 *
 * Defined as the COMPLEMENT of the queue rather than as a fixed list of finished
 * statuses, deliberately: any status that is neither scheduled nor listed here
 * would leave its orders unreachable, since the queue is now the only other
 * route to an order. Spelling it this way makes that impossible — a row carrying
 * a status this build has not heard of shows up here rather than vanishing.
 *
 * Must stay in step with SCHEDULABLE in workers/src/handlers/wholesale-d1.js.
 */
const QUEUED = ['in_queue', 'in_production'];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function offQueueOrders() {
  return state.orders.filter(o => !QUEUED.includes(o.status));
}

function row(order) {
  const node = el('button', 'done-row');
  node.type = 'button';
  node.dataset.orderId = order.id;

  node.append(el('span', 'dr-id', order.shopifyOrderName || order.id));
  node.append(el('span', `dr-status s-${order.status}`, statusLabel(order.status)));
  node.append(el('span', 'dr-customer', order.nickname || '—'));
  node.append(el('span', 'dr-cultivars',
    order.items.map(i => i.cultivarName || i.cultivarId).join(', ') || t('no_lines')));
  node.append(el('span', 'dr-lbs', fmtLbs(order.totalLbs)));
  node.append(el('span', 'dr-usd',
    order.totalValue > 0
      ? fmtUsd(order.totalValue)
      : (order.source === 'shopify' ? t('imported') : '')));
  return node;
}

export function renderOffQueue() {
  const list = document.getElementById('done-list');
  const count = document.getElementById('done-count');
  const orders = offQueueOrders();

  count.textContent = orders.length ? String(orders.length) : '';
  list.textContent = '';

  if (!orders.length) {
    list.append(el('p', 'done-empty', t('none_off_queue')));
    return;
  }
  orders.forEach(o => list.append(row(o)));
}
