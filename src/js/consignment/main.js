/**
 * Consignment App — Main Module
 * Init, event listeners, auto-refresh, orchestration
 */

import * as api from './api.js?v=6';
import * as ui from './ui.js?v=10';

let partners = [];
let strains = [];
let selectedPartnerId = null;
let refreshInterval = null;
let lineItemCount = 0;

// Prefetch cache
const detailCache = new Map();
let prefetchTimer = null;

// Smart refresh
let lastUserAction = Date.now();
const REFRESH_INTERVAL = 30000;
const MIN_REFRESH_GAP = 5000; // Don't refresh if user acted < 5s ago

// ─── INIT ───────────────────────────────────────────────

async function init() {
  await Promise.all([loadPartners(), loadStrains(), loadActivity()]);
  setupEventListeners();
  initCommandPalette();
  setupAutoRefresh();
  setDefaultDates();
  loadStrainBreakdowns();
}

async function loadPartners() {
  try {
    const result = await api.getPartners();
    partners = result.data || [];
    ui.renderPartnerCards(partners, el('partner-cards'), showPartnerDetail);
    // Update partner dropdowns in modals
    document.querySelectorAll('.partner-select').forEach(sel => {
      ui.populatePartnerDropdown(partners, sel);
    });
  } catch (err) {
    console.error('Failed to load partners:', err);
  }
}

async function loadStrains() {
  try {
    const result = await api.getStrains();
    strains = result.data || [];
    document.querySelectorAll('.strain-select').forEach(sel => {
      ui.populateStrainDropdown(strains, sel);
    });
  } catch (err) {
    console.error('Failed to load strains:', err);
  }
}

async function loadActivity(partnerId) {
  try {
    const filters = { limit: 50 };
    if (partnerId) filters.partner_id = partnerId;
    const result = await api.getActivity(filters);
    ui.renderActivityFeed(result.data || [], el('activity-feed'));
  } catch (err) {
    console.error('Failed to load activity:', err);
  }
}

function prefetchPartnerDetail(partnerId) {
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => {
    if (!detailCache.has(partnerId)) {
      api.getPartnerDetail(partnerId).then(result => {
        detailCache.set(partnerId, { data: result.data, ts: Date.now() });
      }).catch(() => {}); // silent fail on prefetch
    }
  }, 150); // slight delay to avoid prefetching on fast mouse passes
}

async function showPartnerDetail(partnerId) {
  try {
    selectedPartnerId = partnerId;
    // Check cache first (valid for 10 seconds)
    const cached = detailCache.get(partnerId);
    if (cached && (Date.now() - cached.ts) < 10000) {
      ui.renderPartnerDetail(cached.data, el('partner-detail'), () => { selectedPartnerId = null; });
      // Refresh in background for freshness
      api.getPartnerDetail(partnerId).then(result => {
        detailCache.set(partnerId, { data: result.data, ts: Date.now() });
      }).catch(() => {});
      return;
    }
    // Show skeleton while loading
    ui.showDetailSkeleton(el('partner-detail'));
    const result = await api.getPartnerDetail(partnerId);
    detailCache.set(partnerId, { data: result.data, ts: Date.now() });
    ui.renderPartnerDetail(result.data, el('partner-detail'), () => { selectedPartnerId = null; });
  } catch (err) {
    console.error('Failed to load partner detail:', err);
    ui.showToast('Failed to load partner details', 'error');
  }
}

// ─── LINE ITEM MANAGEMENT ───────────────────────────────

function addIntakeLine() {
  const container = el('intake-lines');
  if (!container) return;
  lineItemCount++;
  const lineId = lineItemCount;
  const row = document.createElement('div');
  row.className = 'line-item';
  row.dataset.lineId = lineId;
  row.innerHTML = `
    <div class="li-col-strain">
      <select class="strain-select line-strain" data-line="${lineId}" required></select>
    </div>
    <div class="li-col-type">
      <div class="toggle-group toggle-compact">
        <button type="button" class="toggle-option active" data-value="tops">T</button>
        <button type="button" class="toggle-option" data-value="smalls">S</button>
      </div>
    </div>
    <div class="li-col-weight">
      <input type="number" class="line-weight" step="0.1" min="0.1" required placeholder="0.0">
    </div>
    <div class="li-col-price">
      <input type="number" class="line-price" step="0.01" min="0.01" required placeholder="0.00">
    </div>
    <div class="li-col-remove">
      ${container.children.length > 0 ? '<button type="button" class="remove-line-btn" aria-label="Remove line"><i class="ph-duotone ph-x-circle"></i></button>' : ''}
    </div>
  `;
  container.appendChild(row);
  
  // Populate the strain select for this line
  const strainSel = row.querySelector('.line-strain');
  if (strainSel) ui.populateStrainDropdown(strains, strainSel);
  
  // Toggle click for this line
  row.querySelectorAll('.toggle-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.toggle-group');
      group.querySelectorAll('.toggle-option').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  
  // Remove button
  const removeBtn = row.querySelector('.remove-line-btn');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => row.remove());
  }
  
  // Price auto-fill when strain changes
  strainSel?.addEventListener('change', () => {
    const partnerId = el('intake-partner')?.value;
    const type = row.querySelector('.toggle-option.active')?.dataset.value || 'tops';
    const priceInput = row.querySelector('.line-price');
    if (partnerId && strainSel.value) {
      ui.autoFillPrice(partnerId, strainSel.value, type, priceInput);
    }
  });
}

// ─── EVENT LISTENERS ────────────────────────────────────

function setupEventListeners() {
  // Quick action buttons
  el('btn-new-intake')?.addEventListener('click', () => {
    const container = el('intake-lines');
    if (container && container.children.length === 0) {
      addIntakeLine();
    }
    ui.openModal('intake-modal');
  });
  el('btn-inventory-count')?.addEventListener('click', () => ui.openModal('count-modal'));
  el('btn-record-payment')?.addEventListener('click', () => ui.openModal('payment-modal'));
  el('btn-add-partner')?.addEventListener('click', () => ui.openModal('partner-modal'));

  // Modal close buttons
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal-overlay');
      if (modal) ui.closeModal(modal.id);
    });
  });

  // Modal overlay click to close
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) ui.closeModal(overlay.id);
    });
  });

  // Escape key closes modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') ui.closeAllModals();
  });

  // Form submissions
  el('intake-form')?.addEventListener('submit', handleIntakeSubmit);
  el('count-form')?.addEventListener('submit', handleCountSubmit);
  el('payment-form')?.addEventListener('submit', handlePaymentSubmit);
  el('partner-form')?.addEventListener('submit', handlePartnerSubmit);

  // Toggle switches (tops/smalls)
  document.querySelectorAll('.toggle-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.toggle-group');
      group.querySelectorAll('.toggle-option').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Add line button
  el('btn-add-line')?.addEventListener('click', addIntakeLine);

  // Count form: show expected inventory
  const countPartner = el('count-partner');
  const countStrain = el('count-strain');
  if (countPartner && countStrain) {
    const updateExpected = async () => {
      const type = el('count-modal')?.querySelector('.toggle-option.active')?.dataset.value || 'tops';
      const display = el('count-expected-display');
      const valueEl = el('count-expected-value');
      const diffEl = el('count-diff');
      if (!countPartner.value || !countStrain.value) {
        if (display) display.style.display = 'none';
        return;
      }
      try {
        const result = await api.getInventory(countPartner.value);
        const match = (result.data || []).find(i => i.strain === countStrain.value && i.type === type);
        const expected = match ? match.on_hand_lbs : 0;
        if (display) display.style.display = 'block';
        if (valueEl) valueEl.textContent = expected.toFixed(1) + ' lbs';
      } catch {
        if (display) display.style.display = 'none';
      }
    };
    countPartner.addEventListener('change', updateExpected);
    countStrain.addEventListener('change', updateExpected);
    
    // Also update toggle click for count modal
    el('count-modal')?.querySelectorAll('.toggle-option').forEach(btn => {
      btn.addEventListener('click', updateExpected);
    });
  }

  // Activity filter
  el('activity-filter')?.addEventListener('change', (e) => {
    loadActivity(e.target.value || null);
  });

  // Refresh button
  el('btn-refresh')?.addEventListener('click', refreshAll);

  // Dark mode toggle
  el('btn-dark-mode')?.addEventListener('click', toggleDarkMode);

  // Quick intake from partner card
  document.addEventListener('quickIntake', (e) => {
    const { partnerId } = e.detail;
    const container = el('intake-lines');
    if (container && container.children.length === 0) {
      addIntakeLine();
    }
    ui.openModal('intake-modal');
    // Pre-select the partner
    const partnerSelect = el('intake-partner');
    if (partnerSelect) {
      partnerSelect.value = partnerId;
    }
  });
  
  // Refresh all from delete actions
  document.addEventListener('refreshAll', () => refreshAll());
  
  // Prefetch partner detail on hover
  document.addEventListener('prefetchPartner', (e) => prefetchPartnerDetail(e.detail.partnerId));
  
  // Offline queue notifications
  document.addEventListener('offlineQueued', (e) => {
    ui.showToast(`Saved offline (${e.detail.count} pending)`, 'warning');
  });
}

// ─── FORM HANDLERS ──────────────────────────────────────

async function handleIntakeSubmit(e) {
  e.preventDefault();
  const lines = el('intake-lines')?.querySelectorAll('.line-item');
  if (!lines || lines.length === 0) {
    ui.showToast('Add at least one line item', 'error');
    return;
  }
  
  const partnerId = el('intake-partner').value;
  const date = el('intake-date').value;
  const items = Array.from(lines).map(row => ({
    strain: row.querySelector('.line-strain')?.value,
    type: row.querySelector('.toggle-option.active')?.dataset.value || 'tops',
    weight_lbs: parseFloat(row.querySelector('.line-weight')?.value),
    price_per_lb: parseFloat(row.querySelector('.line-price')?.value),
  }));
  const notes = el('intake-notes')?.value || '';
  
  // Optimistic: close modal immediately
  ui.closeModal('intake-modal');
  const container = el('intake-lines');
  if (container) container.innerHTML = '';
  lineItemCount = 0;
  ui.showToast(`${items.length} intake${items.length > 1 ? 's' : ''} recorded`);
  trackUserAction();
  
  // Background: actual save
  try {
    await api.saveBatchIntake({ partner_id: partnerId, date, items, notes });
    detailCache.delete(parseInt(partnerId));
    refreshAll();
  } catch (err) {
    ui.showToast(err.message || 'Failed to save intake — please retry', 'error');
    refreshAll();
  }
}

async function handleCountSubmit(e) {
  e.preventDefault();
  const type = el('count-modal')?.querySelector('.toggle-option.active')?.dataset.value || 'tops';
  const data = {
    partner_id: el('count-partner').value,
    date: el('count-date').value,
    strain: el('count-strain').value,
    type,
    counted_lbs: parseFloat(el('count-weight').value),
    notes: el('count-notes')?.value || '',
  };
  
  ui.closeModal('count-modal');
  ui.showToast('Count recorded');
  trackUserAction();
  
  try {
    const result = await api.saveInventoryCount(data);
    const d = result.data;
    if (d.sold_lbs > 0) {
      ui.showToast(`${d.sold_lbs.toFixed(1)} lbs sold since last count`);
    }
    detailCache.delete(parseInt(data.partner_id));
    refreshAll();
  } catch (err) {
    ui.showToast(err.message || 'Failed to save count — please retry', 'error');
    refreshAll();
  }
}

async function handlePaymentSubmit(e) {
  e.preventDefault();
  const partnerId = el('payment-partner').value;
  const data = {
    partner_id: partnerId,
    date: el('payment-date').value,
    amount: parseFloat(el('payment-amount').value),
    method: el('payment-method')?.value || 'check',
    reference_number: el('payment-ref')?.value || '',
    notes: el('payment-notes')?.value || '',
  };
  
  // Optimistic: close immediately
  ui.closeModal('payment-modal');
  ui.showToast('Payment recorded');
  trackUserAction();
  
  // Background save
  try {
    await api.savePayment(data);
    detailCache.delete(parseInt(partnerId));
    refreshAll();
  } catch (err) {
    ui.showToast(err.message || 'Failed to save payment — please retry', 'error');
    refreshAll();
  }
}

async function handlePartnerSubmit(e) {
  e.preventDefault();
  const name = el('partner-name').value;
  const data = {
    name,
    contact_name: el('partner-contact')?.value || '',
    email: el('partner-email')?.value || '',
    phone: el('partner-phone')?.value || '',
    notes: el('partner-notes')?.value || '',
  };
  
  ui.closeModal('partner-modal');
  ui.showToast(`${name} added`);
  trackUserAction();
  
  try {
    await api.savePartner(data);
    refreshAll();
  } catch (err) {
    ui.showToast(err.message || 'Failed to save partner — please retry', 'error');
    refreshAll();
  }
}

// ─── HELPERS ────────────────────────────────────────────

function el(id) { return document.getElementById(id); }

function setDefaultDates() {
  const today = new Date().toISOString().split('T')[0];
  document.querySelectorAll('input[type="date"]').forEach(input => {
    if (!input.value) input.value = today;
  });
}

async function refreshAll() {
  detailCache.clear();
  trackUserAction();
  await Promise.all([loadPartners(), loadActivity(selectedPartnerId)]);
  if (selectedPartnerId) showPartnerDetail(selectedPartnerId);
}

function setupAutoRefresh() {
  // Clear old interval if any
  if (refreshInterval) clearInterval(refreshInterval);
  
  refreshInterval = setInterval(() => {
    // Skip if tab is hidden
    if (document.hidden) return;
    // Skip if user just did something
    if (Date.now() - lastUserAction < MIN_REFRESH_GAP) return;
    refreshAll();
  }, REFRESH_INTERVAL);
  
  // Refresh when tab becomes visible (if stale)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (Date.now() - lastUserAction > REFRESH_INTERVAL)) {
      refreshAll();
    }
  });
}

function trackUserAction() {
  lastUserAction = Date.now();
}

function toggleDarkMode() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeButton(next);
}

const MOON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8.5a5.5 5.5 0 1 1-5-7 4.5 4.5 0 0 0 5 7z"/></svg>';
const SUN_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="3"/><line x1="8" y1="1" x2="8" y2="3"/><line x1="8" y1="13" x2="8" y2="15"/><line x1="1" y1="8" x2="3" y2="8"/><line x1="13" y1="8" x2="15" y2="8"/><line x1="3.05" y1="3.05" x2="4.46" y2="4.46"/><line x1="11.54" y1="11.54" x2="12.95" y2="12.95"/><line x1="3.05" y1="12.95" x2="4.46" y2="11.54"/><line x1="11.54" y1="4.46" x2="12.95" y2="3.05"/></svg>';

function updateThemeButton(theme) {
  const icon = el('themeIcon');
  const label = el('themeLabel');
  if (icon) icon.innerHTML = theme === 'dark' ? MOON_SVG : SUN_SVG;
  if (label) label.textContent = theme === 'dark' ? 'Dark' : 'Light';
}

function updateClock() {
  const clockEl = el('clock');
  const dateEl = el('dateDisplay');
  if (!clockEl || !dateEl) return;

  const now = new Date();
  const time = now.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  });
  const date = now.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    year: 'numeric'
  });

  clockEl.textContent = time;
  dateEl.textContent = date;
  
  // Show header time once clock is initialized
  const headerTime = document.querySelector('.header-time');
  if (headerTime) headerTime.style.display = 'block';
}

// Load saved theme and initialize theme button
const savedTheme = localStorage.getItem('theme');
if (savedTheme) {
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeButton(savedTheme);
}

// Start clock
setInterval(updateClock, 1000);
updateClock();

// Expose toggleTheme to global scope for inline onclick handler
window.toggleTheme = toggleDarkMode;

// ─── COMMAND PALETTE ────────────────────────────────────

function initCommandPalette() {
  const overlay = el('command-palette');
  const input = el('cmd-input');
  if (!overlay || !input) return;

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      overlay.classList.add('active');
      input.value = '';
      input.focus();
    }
    if (e.key === 'Escape' && overlay.classList.contains('active')) {
      overlay.classList.remove('active');
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('active');
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const raw = input.value.trim().toLowerCase();
      if (!raw) return;
      overlay.classList.remove('active');
      parseCommand(raw);
    }
  });
}

function parseCommand(raw) {
  const parts = raw.split(/\s+/);
  const cmd = parts[0];

  if (cmd === 'intake') {
    const container = el('intake-lines');
    if (container && container.children.length === 0) addIntakeLine();
    ui.openModal('intake-modal');
    setTimeout(() => {
      const partnerSelect = el('intake-partner');
      if (partnerSelect && parts[1]) {
        const match = Array.from(partnerSelect.options).find(o =>
          o.textContent.toLowerCase().includes(parts[1])
        );
        if (match) partnerSelect.value = match.value;
      }
    }, 100);
  } else if (cmd === 'pay' || cmd === 'payment') {
    ui.openModal('payment-modal');
    setTimeout(() => {
      const partnerSelect = el('payment-partner');
      if (partnerSelect && parts[1]) {
        const match = Array.from(partnerSelect.options).find(o =>
          o.textContent.toLowerCase().includes(parts[1])
        );
        if (match) partnerSelect.value = match.value;
      }
      if (parts[2]) {
        const amountInput = el('payment-amount');
        if (amountInput) amountInput.value = parts[2];
      }
      if (parts[3]) {
        const methodSelect = el('payment-method');
        if (methodSelect) {
          const m = parts[3];
          if (m === 'check' || m === 'cash' || m === 'transfer') methodSelect.value = m;
        }
      }
    }, 100);
  } else if (cmd === 'count') {
    ui.openModal('count-modal');
    setTimeout(() => {
      const partnerSelect = el('count-partner');
      if (partnerSelect && parts[1]) {
        const match = Array.from(partnerSelect.options).find(o =>
          o.textContent.toLowerCase().includes(parts[1])
        );
        if (match) {
          partnerSelect.value = match.value;
          partnerSelect.dispatchEvent(new Event('change'));
        }
      }
    }, 100);
  } else if (cmd === 'partner' || cmd === 'add') {
    ui.openModal('partner-modal');
    if (parts.length > 1) {
      setTimeout(() => {
        const nameInput = el('partner-name');
        if (nameInput) nameInput.value = parts.slice(1).join(' ');
      }, 100);
    }
  }
}

// ─── STRAIN BREAKDOWN ──────────────────────────────────

function loadStrainBreakdowns() {
  partners.filter(p => p.inventory_lbs > 0).forEach(async (p) => {
    try {
      const result = await api.getPartnerDetail(p.id);
      const detail = result.data || result;
      const strainEl = document.getElementById('strains-' + p.id);
      if (strainEl && detail.inventory && detail.inventory.length > 0) {
        strainEl.textContent = detail.inventory
          .filter(i => i.on_hand_lbs > 0)
          .map(i => i.strain + ' ' + i.type + ' ' + i.on_hand_lbs.toFixed(0))
          .join(' · ');
      }
    } catch(e) { /* silent fail */ }
  });
}

// ─── START ──────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
