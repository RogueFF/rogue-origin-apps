/**
 * Consignment UI Module
 * Handles rendering partner cards, activity feed, modals, and partner detail
 */

import * as api from './api.js?v=6';

// ─── HELPERS ────────────────────────────────────────────

let refreshTimer = null;
function debouncedRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    document.dispatchEvent(new CustomEvent('refreshAll'));
  }, 300);
}

// ─── PARTNER CARDS ──────────────────────────────────────

export function renderPartnerCards(partners, container, onCardClick) {
  container.innerHTML = '';
  if (!partners || partners.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No partners yet. Add one to get started.</p></div>';
    return;
  }
  partners.forEach(p => {
    const balanceClass = p.balance_owed <= 0 ? 'low' : p.balance_owed > 1000 ? 'high' : 'medium';
    const inventoryDisplay = p.inventory_lbs > 0 ? p.inventory_lbs.toFixed(1) + ' lbs' : '0 lbs';
    const card = document.createElement('div');
    card.className = 'partner-card';
    card.dataset.partnerId = p.id;
    card.innerHTML = `
      <div class="card-top-row">
        <div class="partner-name">${esc(p.name)}</div>
        <i class="ph-duotone ph-caret-right card-expand-icon"></i>
      </div>
      <div class="card-hero-number">${inventoryDisplay}</div>
      <div class="card-hero-label">on hand</div>
      <div class="card-bottom-row">
        <span>${p.last_intake_date ? 'Last intake: ' + fmtDate(p.last_intake_date) : 'No intakes'}</span>
        <span class="card-balance ${balanceClass}">${p.balance_owed > 0 ? '$' + fmt(p.balance_owed) + ' owed' : 'Settled'}</span>
      </div>
    `;

    // Prefetch on hover
    card.addEventListener('mouseenter', () => {
      document.dispatchEvent(new CustomEvent('prefetchPartner', { detail: { partnerId: p.id } }));
    });

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
  
  // Group intakes by batch_id
  const batches = new Map();
  const processed = new Set();
  
  activities.forEach((a, idx) => {
    if (a.activity_type === 'intake' && a.batch_id) {
      if (!batches.has(a.batch_id)) {
        batches.set(a.batch_id, { items: [], date: a.date, partner_name: a.partner_name, price: a.price });
      }
      batches.get(a.batch_id).items.push({ strain: a.strain, type: a.type, weight_lbs: a.weight_lbs });
      processed.add(idx);
    }
  });
  
  // Render activities
  activities.forEach((a, idx) => {
    if (processed.has(idx)) return; // Skip - already part of a batch

    const item = document.createElement('div');
    item.className = 'activity-item';
    let detail = '';

    if (a.activity_type === 'intake') {
      // Check if this is the first item of a batch
      if (a.batch_id && batches.has(a.batch_id)) {
        const batch = batches.get(a.batch_id);
        batches.delete(a.batch_id); // Render once
        const lines = batch.items.map(i => `${i.weight_lbs} lbs ${esc(i.strain)} (${i.type})`).join('<br>');
        const totalWeight = batch.items.reduce((sum, i) => sum + i.weight_lbs, 0);
        detail = `<strong>${esc(batch.partner_name)}</strong> <span>— ${totalWeight} lbs total @ $${fmt(batch.price)}/lb</span><br><span style="font-size: 0.9em; opacity: 0.85;">${lines}</span>`;
      } else {
        // Single intake (no batch_id)
        detail = `<strong>${esc(a.partner_name)}</strong> <span>— ${a.weight_lbs} lbs ${esc(a.strain)} (${a.type}) @ $${fmt(a.price)}/lb</span>`;
      }
    } else if (a.activity_type === 'sale') {
      if (a.method === 'inventory_count') {
        detail = `<strong>${esc(a.partner_name)}</strong> <span>— Inventory count: ${a.weight_lbs} lbs ${esc(a.strain)} (${a.type}) sold</span>`;
      } else {
        detail = `<strong>${esc(a.partner_name)}</strong> <span>— Sold ${a.weight_lbs} lbs ${esc(a.strain)} (${a.type})${a.price ? ' @ $' + fmt(a.price) + '/lb' : ''}</span>`;
      }
    } else if (a.activity_type === 'payment') {
      detail = `<strong>${esc(a.partner_name)}</strong> <span>— $${fmt(a.amount)} via ${a.method || 'unknown'}</span>`;
    }

    item.innerHTML = `
      <div class="activity-dot ${a.activity_type}"></div>
      <span class="activity-detail">${detail}</span>
      <span class="activity-date">${fmtDate(a.date)}</span>
    `;
    container.appendChild(item);
  });
}

// ─── PARTNER DETAIL ─────────────────────────────────────

export function showDetailSkeleton(container) {
  container.innerHTML = `
    <div class="detail-header">
      <div>
        <div class="skeleton skeleton-text" style="width:140px;height:24px"></div>
        <div class="skeleton skeleton-text" style="width:90px;height:14px;margin-top:6px"></div>
      </div>
      <div class="detail-header-actions">
        <div class="skeleton skeleton-circle" style="width:32px;height:32px"></div>
        <div class="skeleton skeleton-circle" style="width:32px;height:32px"></div>
      </div>
    </div>
    <div class="detail-body">
      <div class="detail-stats">
        <div class="detail-stat"><div class="skeleton skeleton-text" style="width:60px;height:12px"></div><div class="skeleton skeleton-text" style="width:80px;height:24px;margin-top:8px"></div></div>
        <div class="detail-stat"><div class="skeleton skeleton-text" style="width:60px;height:12px"></div><div class="skeleton skeleton-text" style="width:80px;height:24px;margin-top:8px"></div></div>
        <div class="detail-stat"><div class="skeleton skeleton-text" style="width:60px;height:12px"></div><div class="skeleton skeleton-text" style="width:80px;height:24px;margin-top:8px"></div></div>
        <div class="detail-stat"><div class="skeleton skeleton-text" style="width:60px;height:12px"></div><div class="skeleton skeleton-text" style="width:80px;height:24px;margin-top:8px"></div></div>
      </div>
      <div class="detail-section">
        <div class="skeleton skeleton-text" style="width:150px;height:18px;margin-bottom:14px"></div>
        <div class="skeleton skeleton-block" style="height:120px"></div>
      </div>
      <div class="detail-section">
        <div class="skeleton skeleton-text" style="width:130px;height:18px;margin-bottom:14px"></div>
        <div class="skeleton skeleton-block" style="height:80px"></div>
      </div>
    </div>
  `;
  container.classList.add('active');
}

export function renderPartnerDetail(detail, container, onClose) {
  const d = detail;
  const totalIntakeLbs = d.intakes.reduce((s, i) => s + i.weight_lbs, 0);
  const totalSoldLbs = d.sales.reduce((s, i) => s + i.weight_lbs, 0);
  const onHandLbs = d.inventory.reduce((s, i) => s + i.on_hand_lbs, 0);
  
  container.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>${esc(d.partner.name)}</h2>
        ${d.partner.contact_name ? `<div class="detail-contact">${esc(d.partner.contact_name)}</div>` : ''}
      </div>
      <div class="detail-header-actions">
        <button class="delete-partner-btn" data-id="${d.partner.id}" title="Delete partner" aria-label="Delete partner">
          <i class="ph-duotone ph-trash"></i>
        </button>
        <button class="close-detail-btn" aria-label="Close">&times;</button>
      </div>
    </div>
    
    <div class="detail-body">
      <div class="detail-stats">
        <div class="detail-stat">
          <div class="stat-label">Balance Owed</div>
          <div class="stat-value ${d.balance_owed > 0 ? 'warning' : ''}">\$${fmt(d.balance_owed)}</div>
        </div>
        <div class="detail-stat">
          <div class="stat-label">Total Paid</div>
          <div class="stat-value positive">\$${fmt(d.total_paid)}</div>
        </div>
        <div class="detail-stat">
          <div class="stat-label">In Stock</div>
          <div class="stat-value">${onHandLbs.toFixed(1)} <small>lbs</small></div>
        </div>
        <div class="detail-stat">
          <div class="stat-label">Total Purchased</div>
          <div class="stat-value">${totalIntakeLbs.toFixed(1)} <small>lbs</small></div>
        </div>
      </div>
      
      ${d.balance_owed > 0 && onHandLbs > 0 ? `
        <div class="stock-vs-owed-bar">
          <div class="bar-label">
            <span><strong>${onHandLbs.toFixed(1)} lbs</strong> in stock</span>
            <span><strong>\$${fmt(d.balance_owed)}</strong> owed</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill bar-stock" style="width: ${Math.min(100, (onHandLbs / (onHandLbs + (d.balance_owed / 100))) * 100)}%"></div>
          </div>
          <div class="bar-hint">Physical inventory vs financial liability</div>
        </div>
      ` : ''}
      
      ${d.inventory.length > 0 ? `
        <div class="detail-section">
          <h3><i class="ph-duotone ph-package"></i> Current Inventory</h3>
          <div class="inv-table">
            <div class="inv-table-header">
              <span>Strain</span>
              <span>Type</span>
              <span>On Hand</span>
            </div>
            ${d.inventory.map(i => `
              <div class="inv-table-row">
                <span class="inv-strain">${esc(i.strain)}</span>
                <span class="inv-type type-${i.type}">${i.type}</span>
                <span class="inv-lbs">${i.on_hand_lbs.toFixed(1)} lbs</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
      
      <div class="detail-section">
        <h3><i class="ph-duotone ph-download-simple"></i> Recent Intakes</h3>
        ${d.intakes.length > 0 ? `
          <div class="history-table">
            ${d.intakes.slice(0, 10).map(i => `
              <div class="history-table-row">
                <div class="history-date">${fmtDate(i.date)}</div>
                <div class="history-main">
                  <span class="history-strain">${esc(i.strain)}</span>
                  <span class="history-type type-${i.type}">${i.type}</span>
                </div>
                <div class="history-numbers">
                  <span class="history-weight">${i.weight_lbs} lbs</span>
                  <span class="history-price">\$${fmt(i.price_per_lb)}/lb</span>
                </div>
                <button class="row-delete-btn delete-intake" data-id="${i.id}" title="Delete intake" aria-label="Delete">
                  <i class="ph-duotone ph-trash"></i>
                </button>
              </div>
            `).join('')}
          </div>
        ` : '<p class="empty-hint">No intakes recorded</p>'}
      </div>
      
      <div class="detail-section">
        <h3><i class="ph-duotone ph-tag"></i> Recent Sales</h3>
        ${d.sales.length > 0 ? `
          <div class="history-table">
            ${d.sales.slice(0, 10).map(s => `
              <div class="history-table-row">
                <div class="history-date">${fmtDate(s.date)}</div>
                <div class="history-main">
                  <span class="history-strain">${esc(s.strain)}</span>
                  <span class="history-type type-${s.type}">${s.type}</span>
                </div>
                <div class="history-numbers">
                  <span class="history-weight">${s.weight_lbs} lbs</span>
                  ${s.channel ? `<span class="history-channel">${esc(s.channel)}</span>` : ''}
                </div>
                <button class="row-delete-btn delete-sale" data-id="${s.id}" title="Delete sale" aria-label="Delete">
                  <i class="ph-duotone ph-trash"></i>
                </button>
              </div>
            `).join('')}
          </div>
        ` : '<p class="empty-hint">No sales recorded</p>'}
      </div>
      
      <div class="detail-section">
        <h3><i class="ph-duotone ph-money"></i> Recent Payments</h3>
        ${d.payments.length > 0 ? `
          <div class="history-table">
            ${d.payments.slice(0, 10).map(p => `
              <div class="history-table-row">
                <div class="history-date">${fmtDate(p.date)}</div>
                <div class="history-main">
                  <span class="history-amount">\$${fmt(p.amount)}</span>
                </div>
                <div class="history-numbers">
                  <span class="history-method">${esc(p.method || 'check')}</span>
                  ${p.reference_number ? `<span class="history-ref">#${esc(p.reference_number)}</span>` : ''}
                </div>
                <button class="row-delete-btn delete-payment" data-id="${p.id}" title="Delete payment" aria-label="Delete">
                  <i class="ph-duotone ph-trash"></i>
                </button>
              </div>
            `).join('')}
          </div>
        ` : '<p class="empty-hint">No payments recorded</p>'}
      </div>
    </div>
  `;
  container.classList.add('active');
  container.querySelector('.close-detail-btn').addEventListener('click', () => {
    container.classList.remove('active');
    if (onClose) onClose();
  });
  
  // Delete partner — optimistic: close panel immediately, delete in background
  const deletePartnerBtn = container.querySelector('.delete-partner-btn');
  if (deletePartnerBtn) {
    deletePartnerBtn.addEventListener('click', () => {
      if (!confirm(`Delete ${d.partner.name} and all their records?`)) return;
      // Optimistic: close panel immediately
      container.classList.remove('active');
      if (onClose) onClose();
      showToast(`Deleted ${d.partner.name}`);
      debouncedRefresh();
      // Background: actual delete
      api.deletePartner(d.partner.id).catch(err => {
        showToast('Failed to delete partner — refreshing', 'error');
        debouncedRefresh();
      });
    });
  }
  
  // Optimistic row delete helper
  function optimisticRowDelete(btn, apiFn, label) {
    const row = btn.closest('.history-table-row') || btn.closest('.inv-table-row');
    if (!row) return;
    // Optimistic: fade out and remove
    row.style.transition = 'opacity 0.2s, transform 0.2s';
    row.style.opacity = '0';
    row.style.transform = 'translateX(20px)';
    const parent = row.parentNode;
    const nextSibling = row.nextSibling;
    setTimeout(() => row.remove(), 200);
    // Background: actual delete
    apiFn(btn.dataset.id).then(() => {
      debouncedRefresh();
    }).catch(err => {
      // Restore row on failure
      row.style.opacity = '1';
      row.style.transform = 'translateX(0)';
      if (nextSibling) parent.insertBefore(row, nextSibling);
      else parent.appendChild(row);
      showToast(`Failed to delete ${label}`, 'error');
    });
  }

  // Delete intakes — optimistic
  container.querySelectorAll('.delete-intake').forEach(btn => {
    btn.addEventListener('click', () => optimisticRowDelete(btn, api.deleteIntake, 'intake'));
  });
  
  // Delete sales — optimistic
  container.querySelectorAll('.delete-sale').forEach(btn => {
    btn.addEventListener('click', () => optimisticRowDelete(btn, api.deleteSale, 'sale'));
  });
  
  // Delete payments — optimistic
  container.querySelectorAll('.delete-payment').forEach(btn => {
    btn.addEventListener('click', () => optimisticRowDelete(btn, api.deletePayment, 'payment'));
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
    // Clear intake line items
    if (modalId === 'intake-modal') {
      const lines = overlay.querySelector('#intake-lines');
      if (lines) lines.innerHTML = '';
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
