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
  $('f-customer').value = order?.customerId || '';
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

    row.append(cultivar, form, qty, unit, price, del);

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

export async function deleteOrder() {
  if (!state.editing) return false;
  if (!confirm(`${t('confirm_delete')} ${state.editing.id}?`)) return false;
  if (!await ensureUnlocked()) return false;
  try {
    await api.post('deleteOrder', { id: state.editing.id });
    showToast(`${state.editing.id} ${t('deleted')}`, 'success');
    closeEditor();
    return true;
  } catch (e) {
    $('form-error').textContent = String(e.message || e);
    return false;
  }
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

export function openCustomerModal() {
  $('c-name').value = '';
  $('c-company').value = '';
  $('c-city').value = '';
  $('c-state').value = '';
  $('c-error').textContent = '';
  $('customer-modal').hidden = false;
  $('c-name').focus();
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
      name: name || company,
      company,
      city: $('c-city').value.trim(),
      state: $('c-state').value.trim(),
    });
    showToast(`${company || name} ${t('saved')}`, 'success');
    closeCustomerModal();
    return res.id;
  } catch (e) {
    $('c-error').textContent = String(e.message || e);
    return null;
  }
}

export { STATUSES, statusLabel };
