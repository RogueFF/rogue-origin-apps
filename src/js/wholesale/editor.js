/**
 * Wholesale order board — the order editor.
 *
 * One modal covers create and edit; the only difference is whether an id rides
 * along on save. Line items are always submitted as a complete set, matching
 * the replace-all contract in the saveOrder handler.
 */

import { state, api, STATUSES, toLbs, fmtLbs, fmtUsd, statusLabel, option, LB_PER_KG } from './state.js';
import { t } from '../shared/i18n.js';
import { showToast } from '../shared/toast.js';
import { ensureUnlocked } from './auth.js';

/** Set by index.js — rebuilds the status picker for the order being opened. */
let buildStatus = () => {};
export function onBuildStatus(fn) { buildStatus = fn; }

const $ = (id) => document.getElementById(id);

function blankLine() {
  return { cultivarId: '', form: 'tops', qty: '', unit: 'lb', unitPrice: '' };
}

let lines = [];

// ─── OPEN / CLOSE ──────────────────────────────────────

export function openEditor(order) {
  state.editing = order || null;

  $('modal-title').textContent = order ? order.id : t('new_order');
  buildStatus(order?.status);
  $('f-ref').value = order?.shopifyOrderName || '';
  $('f-customer').value = order?.customerId || '';
  // Setting .value in script does not fire `change`, so the edit affordance has
  // to be synced here or it stays disabled on an order that has a customer.
  $('btn-edit-customer').disabled = !$('f-customer').value;
  $('f-status').value = order?.status || 'in_queue';
  $('f-date').value = order?.orderDate || new Date().toISOString().slice(0, 10);
  $('f-terms').value = order?.paymentTerms || '';
  $('f-notes').value = order?.notes || '';
  $('form-error').textContent = '';

  lines = order?.items?.length
    ? order.items.map(i => ({
        cultivarId: i.cultivarId,
        form: i.form,
        qty: String(i.enteredQty),
        unit: i.enteredUnit,
        unitPrice: i.unitPrice ? String(i.unitPrice) : '',
      }))
    : [blankLine()];

  $('btn-delete').hidden = !order;
  renderLines();
  $('modal').hidden = false;
  $('f-customer').focus();
}

export function closeEditor() {
  $('modal').hidden = true;
  state.editing = null;
}

// ─── LINE ITEMS ────────────────────────────────────────

export function addLine() {
  lines.push(blankLine());
  renderLines();
  // Focus the cultivar picker on the row just added — this form is used to key
  // in several lines at a sitting, and reaching for the mouse each time is friction.
  const lastRow = $('line-rows').querySelector('.line-row:last-of-type');
  lastRow?.querySelector('select')?.focus();
}

function renderLines() {
  const wrap = $('line-rows');
  wrap.textContent = '';

  lines.forEach((line, idx) => {
    const row = document.createElement('div');
    row.className = 'line-row';

    // TRIM ORDER. The position of a line in this list is the order the floor
    // runs it in — `sort_order` is written as the index on save, and the
    // scheduler sequences a block's passes by it. That has been true since the
    // restructure, but nothing here could change a position: the only way to
    // put a strain first was to delete every line and retype them in order.
    const rank = document.createElement('div');
    rank.className = 'line-rank';

    const move = (from, to) => {
      lines.splice(to, 0, lines.splice(from, 1)[0]);
      renderLines();
      // Keep the keyboard on the control that was just used, at its new home.
      const rows = $('line-rows').querySelectorAll('.line-row');
      rows[to]?.querySelector(from > to ? '.line-up' : '.line-down')?.focus();
    };

    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'line-move line-up';
    up.textContent = '↑';
    up.disabled = idx === 0;
    up.setAttribute('aria-label', `${t('move_up')} ${idx + 1}`);
    up.onclick = () => move(idx, idx - 1);

    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'line-move line-down';
    down.textContent = '↓';
    down.disabled = idx === lines.length - 1;
    down.setAttribute('aria-label', `${t('move_down')} ${idx + 1}`);
    down.onclick = () => move(idx, idx + 1);

    const num = document.createElement('span');
    num.className = 'line-num';
    num.textContent = String(idx + 1);

    rank.append(up, num, down);

    const cultivar = document.createElement('select');
    cultivar.setAttribute('aria-label', t('cultivar'));
    cultivar.append(option(t('pick_cultivar'), ''));
    state.cultivars.forEach(c => {
      cultivar.append(option(c.name, c.id, c.id === line.cultivarId));
    });
    cultivar.onchange = (e) => { line.cultivarId = e.target.value; };

    const form = document.createElement('select');
    form.setAttribute('aria-label', t('form'));
    ['tops', 'smalls'].forEach(f => {
      form.append(option(t(f), f, f === line.form));
    });
    form.onchange = (e) => { line.form = e.target.value; };

    const qty = document.createElement('input');
    qty.type = 'number';
    qty.min = '0';
    qty.step = 'any';
    qty.value = line.qty;
    qty.setAttribute('aria-label', t('quantity'));
    qty.oninput = (e) => { line.qty = e.target.value; updateConv(row, line); refreshTotals(); };

    const unit = document.createElement('select');
    unit.setAttribute('aria-label', t('unit'));
    ['lb', 'kg'].forEach(u => {
      unit.append(option(u, u, u === line.unit));
    });
    unit.onchange = (e) => { line.unit = e.target.value; updateConv(row, line); refreshTotals(); };

    const price = document.createElement('input');
    price.type = 'number';
    price.min = '0';
    price.step = 'any';
    price.value = line.unitPrice;
    price.setAttribute('aria-label', t('unit_price'));
    price.oninput = (e) => { line.unitPrice = e.target.value; refreshTotals(); };

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'line-del';
    del.textContent = '×';
    del.setAttribute('aria-label', t('remove_line'));
    del.onclick = () => {
      lines.splice(idx, 1);
      if (!lines.length) lines.push(blankLine());
      renderLines();
    };

    row.append(rank, cultivar, form, qty, unit, price, del);

    updateConv(row, line);
    wrap.append(row);
  });

  refreshTotals();
}

/**
 * Show, update or remove the "100 kg = 220.5 lb stored" hint on a row.
 *
 * Mutating the one node in place rather than re-rendering the row matters: a
 * full re-render on every keystroke would destroy the input the operator is
 * typing into and drop the caret.
 */
function updateConv(row, line) {
  const show = line.unit === 'kg' && Number(line.qty) > 0;
  let conv = row.querySelector('.line-conv');

  if (!show) {
    conv?.remove();
    return;
  }
  if (!conv) {
    conv = document.createElement('div');
    conv.className = 'line-conv';
    row.append(conv);
  }
  conv.textContent = `${line.qty} kg = ${fmtLbs(Number(line.qty) * LB_PER_KG)} stored`;
}

function refreshTotals() {
  let lbs = 0;
  let value = 0;
  for (const l of lines) {
    const qty = Number(l.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    lbs += toLbs(qty, l.unit);
    value += qty * (Number(l.unitPrice) || 0);
  }
  $('total-lbs').textContent = fmtLbs(lbs);
  $('total-usd').textContent = fmtUsd(value);
}

// ─── SAVE / DELETE ─────────────────────────────────────

export async function saveOrder() {
  const err = $('form-error');
  err.textContent = '';

  const customerId = $('f-customer').value;
  if (!customerId) { err.textContent = t('err_customer'); return; }

  // Drop rows the operator started and abandoned; validate whatever is left.
  const filled = lines.filter(l => l.cultivarId || l.qty);
  for (const [i, l] of filled.entries()) {
    if (!l.cultivarId) { err.textContent = `${t('line')} ${i + 1}: ${t('err_cultivar')}`; return; }
    if (!(Number(l.qty) > 0)) { err.textContent = `${t('line')} ${i + 1}: ${t('err_qty')}`; return; }
  }

  const payload = {
    id: state.editing?.id,
    customerId,
    shopifyOrderName: $('f-ref').value.trim(),
    status: $('f-status').value,
    orderDate: $('f-date').value,
    paymentTerms: $('f-terms').value,
    notes: $('f-notes').value,
    items: filled.map(l => ({
      cultivarId: l.cultivarId,
      form: l.form,
      qty: Number(l.qty),
      unit: l.unit,
      unitPrice: Number(l.unitPrice) || 0,
    })),
  };

  // Reads are public; writes are not. Ask for the password at the moment it is
  // needed rather than gating the whole board behind a login.
  if (!await ensureUnlocked()) return false;

  const btn = $('btn-save');
  btn.disabled = true;
  try {
    const res = await api.post('saveOrder', payload);
    showToast(`${res.id} ${t('saved')}`, 'success');
    closeEditor();
    return true;
  } catch (e) {
    // Surface the server's line-numbered message rather than a generic failure —
    // it already says which line and why.
    err.textContent = String(e.message || e).replace(/^wholesale\/saveOrder:\s*/, '');
    return false;
  } finally {
    btn.disabled = false;
  }
}

/**
 * Delete an order, from the editor or straight from its card on the queue.
 *
 * Defaults to whatever the editor has open, which is how the modal's Delete
 * calls it. Passing an order lets the queue delete one without opening it —
 * and in that case there is no form to write a failure into, so the error goes
 * to a toast instead of a field nobody is looking at.
 */
export async function deleteOrder(order = state.editing) {
  if (!order) return false;
  if (!confirm(`${t('confirm_delete')} ${order.id}?`)) return false;
  if (!await ensureUnlocked()) return false;
  const inEditor = state.editing?.id === order.id;
  try {
    await api.post('deleteOrder', { id: order.id });
    showToast(`${order.id} ${t('deleted')}`, 'success');
    if (inEditor) closeEditor();
    return true;
  } catch (e) {
    const msg = String(e.message || e);
    if (inEditor) $('form-error').textContent = msg;
    else showToast(msg, 'error');
    return false;
  }
}

/**
 * Rewrite part of an order without opening the editor.
 *
 * `saveOrder` replaces the whole item set, so every quick edit on a card has to
 * send the complete list with one thing changed — send a subset and the rest of
 * the order is deleted. Rebuilding from `order.items` keeps each line's ENTERED
 * quantity and unit rather than its canonical pounds: a line typed as 100 kg
 * must go back as 100 kg, or a round-trip through this quietly restates it as
 * 220.462 lb.
 */
export async function patchOrder(order, overrides = {}) {
  if (!await ensureUnlocked()) return false;
  const items = overrides.items || order.items;
  try {
    await api.post('saveOrder', {
      id: order.id,
      customerId: order.customerId,
      status: order.status,
      orderDate: order.orderDate,
      paymentTerms: order.paymentTerms,
      notes: order.notes,
      shopifyOrderName: overrides.shopifyOrderName ?? order.shopifyOrderName ?? '',
      items: items.map(i => ({
        cultivarId: i.cultivarId,
        form: i.form,
        qty: Number(i.enteredQty ?? i.qtyLbs),
        unit: i.enteredUnit || 'lb',
        unitPrice: Number(i.unitPrice) || 0,
      })),
    });
    return true;
  } catch (e) {
    showToast(String(e.message || e), 'error');
    return false;
  }
}

/**
 * The order's lines grouped by cultivar, in the order the floor runs them.
 *
 * This is the same grouping `orderBlocks` does on the server, reproduced here so
 * the card's reorder arrows move a whole PASS. Tops and smalls of one cultivar
 * come off a single lot, so moving one without the other would be asking the
 * floor to run the same lot twice.
 */
export function passGroups(order) {
  const groups = new Map();
  for (const item of order.items) {
    if (!groups.has(item.cultivarId)) groups.set(item.cultivarId, []);
    groups.get(item.cultivarId).push(item);
  }
  return [...groups.values()];
}

// ─── CUSTOMERS ─────────────────────────────────────────

export function fillCustomerSelect() {
  const sel = $('f-customer');
  const current = sel.value;
  sel.textContent = '';
  sel.append(option(t('pick_customer'), ''));
  state.customers.forEach(c => {
    const label = c.company || c.name;
    sel.append(option(label, c.id, c.id === current));
  });
}

/**
 * The customer being edited, or null when creating one.
 *
 * `saveCustomer` and `deleteCustomer` have always existed on the API — the
 * latter even refuses politely when the customer still has orders — but nothing
 * on the page could reach either. A customer could be created and then never
 * corrected or removed, which is how a buyer called "test" ends up attached to
 * real orders.
 */
let editingCustomer = null;

export function openCustomerModal(customer = null) {
  editingCustomer = customer;
  $('c-name').value = customer?.name || '';
  $('c-company').value = customer?.company || '';
  $('c-city').value = customer?.city || '';
  $('c-state').value = customer?.state || '';
  $('c-error').textContent = '';
  $('c-title').textContent = customer
    ? (customer.company || customer.name)
    : t('new_customer');
  // Nothing to delete when the record does not exist yet.
  $('c-delete').hidden = !customer;
  $('customer-modal').hidden = false;
  $('c-name').focus();
}

/** The customer currently chosen in the order editor, or null. */
export function selectedCustomer() {
  const id = $('f-customer').value;
  return state.customers.find(c => c.id === id) || null;
}

/**
 * Delete the customer being edited.
 *
 * The refusal path matters more than the happy one: orders.customer_id is a
 * hard foreign key, so the server refuses while any order still points here and
 * says how many. That message is the useful part, so it is shown in the form
 * rather than swallowed into a toast that disappears.
 */
export async function deleteCustomer() {
  if (!editingCustomer) return false;
  const label = editingCustomer.company || editingCustomer.name;
  if (!confirm(`${t('confirm_delete_customer')} ${label}?`)) return false;
  if (!await ensureUnlocked()) return false;
  try {
    await api.post('deleteCustomer', { id: editingCustomer.id });
    showToast(`${label} ${t('deleted')}`, 'success');
    closeCustomerModal();
    return true;
  } catch (e) {
    $('c-error').textContent = String(e.message || e);
    return false;
  }
}

export function closeCustomerModal() {
  $('customer-modal').hidden = true;
}

export async function saveCustomer() {
  const name = $('c-name').value.trim();
  const company = $('c-company').value.trim();
  if (!name && !company) { $('c-error').textContent = t('err_cust_name'); return null; }
  if (!await ensureUnlocked()) return null;
  try {
    const res = await api.post('saveCustomer', {
      // Sending the id is what turns this into an update; without it the server
      // inserts a second customer with the corrected details and the orders stay
      // pointed at the old one.
      id: editingCustomer?.id,
      name: name || company,
      company,
      city: $('c-city').value.trim(),
      state: $('c-state').value.trim(),
    });
    showToast(`${company || name} ${t('saved')}`, 'success');
    const id = editingCustomer?.id || res.id;
    closeCustomerModal();
    return id;
  } catch (e) {
    $('c-error').textContent = String(e.message || e);
    return null;
  }
}

export { STATUSES, statusLabel };
