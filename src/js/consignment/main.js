/**
 * Consignment App — Main Module
 * Init, event listeners, auto-refresh, orchestration
 */

import * as api from './api.js?v=3';
import * as ui from './ui.js?v=3';

let partners = [];
let strains = [];
let selectedPartnerId = null;
let refreshInterval = null;
let lineItemCount = 0;

// ─── INIT ───────────────────────────────────────────────

async function init() {
  await Promise.all([loadPartners(), loadStrains(), loadActivity()]);
  setupEventListeners();
  setupAutoRefresh();
  setDefaultDates();
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

async function showPartnerDetail(partnerId) {
  try {
    selectedPartnerId = partnerId;
    const result = await api.getPartnerDetail(partnerId);
    ui.renderPartnerDetail(result.data, el('partner-detail'), () => {
      selectedPartnerId = null;
    });
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
}

// ─── FORM HANDLERS ──────────────────────────────────────

async function handleIntakeSubmit(e) {
  e.preventDefault();
  const lines = el('intake-lines')?.querySelectorAll('.line-item');
  if (!lines || lines.length === 0) {
    ui.showToast('Add at least one line item', 'error');
    return;
  }
  
  const items = Array.from(lines).map(row => ({
    strain: row.querySelector('.line-strain')?.value,
    type: row.querySelector('.toggle-option.active')?.dataset.value || 'tops',
    weight_lbs: parseFloat(row.querySelector('.line-weight')?.value),
    price_per_lb: parseFloat(row.querySelector('.line-price')?.value),
  }));
  
  try {
    await api.saveBatchIntake({
      partner_id: el('intake-partner').value,
      date: el('intake-date').value,
      items,
      notes: el('intake-notes')?.value || '',
    });
    ui.closeModal('intake-modal');
    // Clear lines for next use
    const container = el('intake-lines');
    if (container) container.innerHTML = '';
    lineItemCount = 0;
    ui.showToast(`${items.length} intake${items.length > 1 ? 's' : ''} recorded`);
    refreshAll();
  } catch (err) {
    ui.showToast(err.message || 'Failed to save intake', 'error');
  }
}

async function handleCountSubmit(e) {
  e.preventDefault();
  const type = el('count-modal')?.querySelector('.toggle-option.active')?.dataset.value || 'tops';
  try {
    const result = await api.saveInventoryCount({
      partner_id: el('count-partner').value,
      date: el('count-date').value,
      strain: el('count-strain').value,
      type,
      counted_lbs: parseFloat(el('count-weight').value),
      notes: el('count-notes')?.value || '',
    });
    ui.closeModal('count-modal');
    const data = result.data;
    if (data.sold_lbs > 0) {
      ui.showToast(`Count recorded — ${data.sold_lbs.toFixed(1)} lbs sold since last count`);
    } else {
      ui.showToast('Count recorded — inventory matches');
    }
    refreshAll();
  } catch (err) {
    ui.showToast(err.message || 'Failed to save count', 'error');
  }
}

async function handlePaymentSubmit(e) {
  e.preventDefault();
  try {
    await api.savePayment({
      partner_id: el('payment-partner').value,
      date: el('payment-date').value,
      amount: parseFloat(el('payment-amount').value),
      method: el('payment-method')?.value || 'check',
      reference_number: el('payment-ref')?.value || '',
      notes: el('payment-notes')?.value || '',
    });
    ui.closeModal('payment-modal');
    ui.showToast('Payment recorded');
    refreshAll();
  } catch (err) {
    ui.showToast(err.message || 'Failed to save payment', 'error');
  }
}

async function handlePartnerSubmit(e) {
  e.preventDefault();
  try {
    await api.savePartner({
      name: el('partner-name').value,
      contact_name: el('partner-contact')?.value || '',
      email: el('partner-email')?.value || '',
      phone: el('partner-phone')?.value || '',
      notes: el('partner-notes')?.value || '',
    });
    ui.closeModal('partner-modal');
    ui.showToast('Partner added');
    refreshAll();
  } catch (err) {
    ui.showToast(err.message || 'Failed to save partner', 'error');
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
  await Promise.all([loadPartners(), loadActivity(selectedPartnerId)]);
  if (selectedPartnerId) showPartnerDetail(selectedPartnerId);
}

function setupAutoRefresh() {
  refreshInterval = setInterval(refreshAll, 30000);
}

function toggleDarkMode() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeButton(next);
}

function updateThemeButton(theme) {
  const icon = el('themeIcon');
  const label = el('themeLabel');
  if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
  if (label) label.textContent = theme === 'dark' ? 'Light' : 'Dark';
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

// ─── START ──────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
