/**
 * Consignment UI Module
 * Handles rendering partner cards, activity feed, modals, and partner detail
 */

import * as api from './api.js';

// ─── PARTNER CARDS ──────────────────────────────────────

export function renderPartnerCards(partners, container, onCardClick) {
  container.innerHTML = '';
  if (!partners || partners.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No partners yet. Add one to get started.</p></div>';
    return;
  }
  partners.forEach(p => {
    const balanceClass = p.balance_owed <= 0 ? 'low' : p.balance_owed > 1000 ? 'high' : 'medium';
    const card = document.createElement('div');
    card.className = 'partner-card';
    card.dataset.partnerId = p.id;
    card.innerHTML = `
      <div class="partner-name">${esc(p.name)}</div>
      <div class="balance ${balanceClass}">$${fmt(p.balance_owed)}</div>
      <div class="card-label">Balance Owed</div>
      <div class="meta">
        <span>${p.inventory_lbs > 0 ? p.inventory_lbs.toFixed(1) + ' lbs on hand' : 'No inventory'}</span>
        <span>${p.last_intake_date ? 'Last intake: ' + fmtDate(p.last_intake_date) : 'No intakes'}</span>
      </div>
    `;
    card.addEventListener('click', () => onCardClick(p.id));
    container.appendChild(card);
  });
}

// ─── ACTIVITY FEED ──────────────────────────────────────

export function renderActivityFeed(activities, container) {
  container.innerHTML = '';
  if (!activities || activities.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No activity yet.</p></div>';
    return;
  }
  activities.forEach(a => {
    const item = document.createElement('div');
    item.className = 'activity-item';
    let detail = '';
    if (a.activity_type === 'intake') {
      detail = `<strong>${esc(a.partner_name)}</strong> — ${a.weight_lbs} lbs ${esc(a.strain)} (${a.type}) @ $${fmt(a.price)}/lb`;
    } else if (a.activity_type === 'sale') {
      if (a.method === 'inventory_count') {
        detail = `<strong>${esc(a.partner_name)}</strong> — Inventory count: ${a.weight_lbs} lbs ${esc(a.strain)} (${a.type}) sold`;
      } else {
        detail = `<strong>${esc(a.partner_name)}</strong> — Sold ${a.weight_lbs} lbs ${esc(a.strain)} (${a.type})${a.price ? ' @ $' + fmt(a.price) + '/lb' : ''}`;
      }
    } else if (a.activity_type === 'payment') {
      detail = `<strong>${esc(a.partner_name)}</strong> — $${fmt(a.amount)} via ${a.method || 'unknown'}`;
    }
    item.innerHTML = `
      <span class="activity-badge ${a.activity_type}">${a.activity_type}</span>
      <span class="activity-detail">${detail}</span>
      <span class="activity-date">${fmtDate(a.date)}</span>
    `;
    container.appendChild(item);
  });
}

// ─── PARTNER DETAIL ─────────────────────────────────────

export function renderPartnerDetail(detail, container, onClose) {
  const d = detail;
  container.innerHTML = `
    <div class="detail-header">
      <h2>${esc(d.partner.name)}</h2>
      <button class="close-detail-btn" aria-label="Close detail">&times;</button>
    </div>
    <div class="detail-stats">
      <div class="detail-stat">
        <div class="stat-value">$${fmt(d.balance_owed)}</div>
        <div class="stat-label">Balance Owed</div>
      </div>
      <div class="detail-stat">
        <div class="stat-value">$${fmt(d.total_paid)}</div>
        <div class="stat-label">Total Paid</div>
      </div>
      <div class="detail-stat">
        <div class="stat-value">${d.inventory.reduce((s, i) => s + i.on_hand_lbs, 0).toFixed(1)}</div>
        <div class="stat-label">Lbs On Hand</div>
      </div>
    </div>
    ${d.inventory.length > 0 ? `
      <div class="detail-section">
        <h3>Inventory</h3>
        ${d.inventory.map(i => `<div class="inv-row"><span>${esc(i.strain)} (${i.type})</span><span class="inv-lbs">${i.on_hand_lbs.toFixed(1)} lbs</span></div>`).join('')}
      </div>
    ` : ''}
    <div class="detail-section">
      <h3>Recent Intakes</h3>
      ${d.intakes.slice(0, 10).map(i => `<div class="history-row"><span>${fmtDate(i.date)}</span><span>${i.weight_lbs} lbs ${esc(i.strain)} (${i.type})</span><span>$${fmt(i.price_per_lb)}/lb</span></div>`).join('') || '<p class="muted">None</p>'}
    </div>
    <div class="detail-section">
      <h3>Recent Sales</h3>
      ${d.sales.slice(0, 10).map(s => `<div class="history-row"><span>${fmtDate(s.date)}</span><span>${s.weight_lbs} lbs ${esc(s.strain)} (${s.type})</span><span>${s.channel || ''}</span></div>`).join('') || '<p class="muted">None</p>'}
    </div>
    <div class="detail-section">
      <h3>Recent Payments</h3>
      ${d.payments.slice(0, 10).map(p => `<div class="history-row"><span>${fmtDate(p.date)}</span><span>$${fmt(p.amount)}</span><span>${p.method || ''} ${p.reference_number ? '#' + p.reference_number : ''}</span></div>`).join('') || '<p class="muted">None</p>'}
    </div>
  `;
  container.classList.add('active');
  container.querySelector('.close-detail-btn').addEventListener('click', () => {
    container.classList.remove('active');
    if (onClose) onClose();
  });
}

// ─── MODALS ─────────────────────────────────────────────

export function openModal(modalId) {
  const overlay = document.getElementById(modalId);
  if (overlay) {
    overlay.classList.add('active');
    const firstInput = overlay.querySelector('input, select');
    if (firstInput) firstInput.focus();
  }
}

export function closeModal(modalId) {
  const overlay = document.getElementById(modalId);
  if (overlay) {
    overlay.classList.remove('active');
    const form = overlay.querySelector('form');
    if (form) form.reset();
    // Reset toggle to tops
    const activeToggle = overlay.querySelector('.toggle-option.active');
    if (activeToggle) {
      overlay.querySelectorAll('.toggle-option').forEach(t => t.classList.remove('active'));
      const topsBtn = overlay.querySelector('[data-value="tops"]');
      if (topsBtn) topsBtn.classList.add('active');
    }
  }
}

export function closeAllModals() {
  document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
}

// ─── DROPDOWNS ──────────────────────────────────────────

export function populateStrainDropdown(strains, selectEl) {
  selectEl.innerHTML = '<option value="">Select strain...</option>';
  strains.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.name;
    opt.textContent = s.name;
    selectEl.appendChild(opt);
  });
}

export function populatePartnerDropdown(partners, selectEl) {
  selectEl.innerHTML = '<option value="">Select partner...</option>';
  partners.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    selectEl.appendChild(opt);
  });
}

// ─── PRICE AUTO-FILL ────────────────────────────────────

export async function autoFillPrice(partnerId, strain, type, priceInput) {
  if (!partnerId || !strain || !type) return;
  const price = await api.getLastPrice(partnerId, strain, type);
  if (price && priceInput) {
    priceInput.value = price;
    priceInput.classList.add('auto-filled');
    setTimeout(() => priceInput.classList.remove('auto-filled'), 2000);
  }
}

// ─── TOAST ──────────────────────────────────────────────

export function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── HELPERS ────────────────────────────────────────────

function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function fmt(num) {
  if (num == null || isNaN(num)) return '0.00';
  return Number(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}
