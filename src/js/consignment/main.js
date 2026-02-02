/**
 * Consignment App — Main Module
 * Init, event listeners, auto-refresh, orchestration
 */

import * as api from './api.js';
import * as ui from './ui.js';

let partners = [];
let strains = [];
let selectedPartnerId = null;
let refreshInterval = null;

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

// ─── EVENT LISTENERS ────────────────────────────────────

function setupEventListeners() {
  // Quick action buttons
  el('btn-new-intake')?.addEventListener('click', () => ui.openModal('intake-modal'));
  el('btn-record-sale')?.addEventListener('click', () => ui.openModal('sale-modal'));
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
  el('sale-form')?.addEventListener('submit', handleSaleSubmit);
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

  // Price auto-fill on intake form
  const intakePartner = el('intake-partner');
  const intakeStrain = el('intake-strain');
  const intakePrice = el('intake-price');
  if (intakePartner && intakeStrain && intakePrice) {
    const triggerAutoFill = () => {
      const type = el('intake-modal')?.querySelector('.toggle-option.active')?.dataset.value || 'tops';
      ui.autoFillPrice(intakePartner.value, intakeStrain.value, type, intakePrice);
    };
    intakePartner.addEventListener('change', triggerAutoFill);
    intakeStrain.addEventListener('change', triggerAutoFill);
  }

  // Sale form: show available inventory
  const salePartner = el('sale-partner');
  const saleStrain = el('sale-strain');
  if (salePartner && saleStrain) {
    const updateAvailable = async () => {
      const type = el('sale-modal')?.querySelector('.toggle-option.active')?.dataset.value || 'tops';
      const hint = el('sale-available');
      if (!salePartner.value || !saleStrain.value) {
        if (hint) hint.textContent = '';
        return;
      }
      try {
        const result = await api.getInventory(salePartner.value);
        const match = (result.data || []).find(i => i.strain === saleStrain.value && i.type === type);
        if (hint) hint.textContent = match ? `${match.on_hand_lbs.toFixed(1)} lbs available` : 'No inventory';
      } catch {
        if (hint) hint.textContent = '';
      }
    };
    salePartner.addEventListener('change', updateAvailable);
    saleStrain.addEventListener('change', updateAvailable);
  }

  // Activity filter
  el('activity-filter')?.addEventListener('change', (e) => {
    loadActivity(e.target.value || null);
  });

  // Refresh button
  el('btn-refresh')?.addEventListener('click', refreshAll);

  // Dark mode toggle
  el('btn-dark-mode')?.addEventListener('click', toggleDarkMode);
}

// ─── FORM HANDLERS ──────────────────────────────────────

async function handleIntakeSubmit(e) {
  e.preventDefault();
  const type = el('intake-modal')?.querySelector('.toggle-option.active')?.dataset.value || 'tops';
  try {
    await api.saveIntake({
      partner_id: el('intake-partner').value,
      date: el('intake-date').value,
      strain: el('intake-strain').value,
      type,
      weight_lbs: parseFloat(el('intake-weight').value),
      price_per_lb: parseFloat(el('intake-price').value),
      notes: el('intake-notes')?.value || '',
    });
    ui.closeModal('intake-modal');
    ui.showToast('Intake recorded');
    refreshAll();
  } catch (err) {
    ui.showToast(err.message || 'Failed to save intake', 'error');
  }
}

async function handleSaleSubmit(e) {
  e.preventDefault();
  const type = el('sale-modal')?.querySelector('.toggle-option.active')?.dataset.value || 'tops';
  try {
    await api.saveSale({
      partner_id: el('sale-partner').value,
      date: el('sale-date').value,
      strain: el('sale-strain').value,
      type,
      weight_lbs: parseFloat(el('sale-weight').value),
      sale_price_per_lb: el('sale-price')?.value ? parseFloat(el('sale-price').value) : null,
      channel: el('sale-channel')?.value || 'retail',
      notes: el('sale-notes')?.value || '',
    });
    ui.closeModal('sale-modal');
    ui.showToast('Sale recorded');
    refreshAll();
  } catch (err) {
    ui.showToast(err.message || 'Failed to save sale', 'error');
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
  const btn = el('btn-dark-mode');
  if (btn) btn.textContent = next === 'dark' ? 'Light' : 'Dark';
}

// Load saved theme
const savedTheme = localStorage.getItem('theme');
if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

// ─── START ──────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
