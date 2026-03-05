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
    ui.showDetailSkeleton(el('partner-detail'));

    const [detailResult, reconResult] = await Promise.all([
      api.getPartnerDetail(partnerId),
      api.getReconciliation(partnerId),
    ]);

    const detail = detailResult.data;
    detail.reconciliation = reconResult.data;

    detailCache.set(partnerId, { data: detail, ts: Date.now() });
    ui.renderPartnerDetail(detail, el('partner-detail'), () => { selectedPartnerId = null; });
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
      // Auto-fill price based on grade
      const priceInput = row.querySelector('.line-price');
      const type = btn.dataset.value;
      if (priceInput && !priceInput.dataset.userEdited) {
        priceInput.value = type === 'tops' ? '150' : '50';
      }
    });
  });

  // Set initial price default for tops
  const priceInput = row.querySelector('.line-price');
  if (priceInput) {
    priceInput.value = '150';
    priceInput.addEventListener('input', () => { priceInput.dataset.userEdited = 'true'; });
  }

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

  // Count form: load inventory when partner changes
  const countPartner = el('count-partner');
  if (countPartner) {
    countPartner.addEventListener('change', loadCountInventory);
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

  // Handle "add new strain" in any strain dropdown
  document.addEventListener('change', async (e) => {
    if (!e.target.classList.contains('strain-select') && !e.target.classList.contains('line-strain')) return;
    if (e.target.value !== '__add_new__') return;

    const name = prompt('New strain name:');
    if (!name || !name.trim()) {
      e.target.value = '';
      return;
    }

    try {
      await api.saveStrain(name.trim());
      const result = await api.getStrains();
      strains = result.data || [];
      document.querySelectorAll('.strain-select, .line-strain').forEach(sel => {
        const currentVal = sel === e.target ? name.trim() : sel.value;
        ui.populateStrainDropdown(strains, sel);
        if (currentVal) sel.value = currentVal;
      });
      e.target.value = name.trim();
      ui.showToast(`Added "${name.trim()}"`);
    } catch (err) {
      ui.showToast('Failed to add strain', 'error');
      e.target.value = '';
    }
  });
}

// ─── BATCH COUNT ────────────────────────────────────────

async function loadCountInventory() {
  const partnerId = el('count-partner')?.value;
  const linesWrapper = el('count-lines-wrapper');
  const linesContainer = el('count-lines');
  const loading = el('count-inventory-loading');
  const submitBtn = el('count-submit-btn');

  if (!partnerId) {
    if (linesWrapper) linesWrapper.style.display = 'none';
    if (loading) { loading.style.display = 'block'; loading.innerHTML = '<p>Select a partner to load their inventory...</p>'; }
    if (submitBtn) submitBtn.disabled = true;
    return;
  }

  if (loading) { loading.style.display = 'block'; loading.innerHTML = '<p>Loading inventory...</p>'; }
  if (linesWrapper) linesWrapper.style.display = 'none';

  try {
    const result = await api.getInventory(partnerId);
    const inventory = result.data || [];

    if (inventory.length === 0) {
      if (loading) { loading.style.display = 'block'; loading.innerHTML = '<p>No inventory on hand for this partner.</p>'; }
      if (submitBtn) submitBtn.disabled = true;
      return;
    }

    if (loading) loading.style.display = 'none';
    if (linesWrapper) linesWrapper.style.display = 'block';
    if (submitBtn) submitBtn.disabled = false;

    linesContainer.innerHTML = inventory.map(inv => `
      <div class="line-item count-line" data-strain="${inv.strain}" data-type="${inv.type}">
        <div class="li-col-strain">
          <span class="count-strain-name">${inv.strain}</span>
        </div>
        <div class="li-col-type">
          <span class="inv-type type-${inv.type}">${inv.type}</span>
        </div>
        <div class="li-col-weight">
          <span class="count-expected">${inv.on_hand_lbs.toFixed(1)}</span>
        </div>
        <div class="li-col-price">
          <input type="number" class="count-actual" step="0.1" min="0" value="" placeholder="${inv.on_hand_lbs.toFixed(1)}">
        </div>
        <div class="li-col-remove">
          <span class="count-diff">--</span>
        </div>
      </div>
    `).join('');

    linesContainer.querySelectorAll('.count-actual').forEach(input => {
      input.addEventListener('input', updateCountSummary);
    });
  } catch (err) {
    if (loading) { loading.style.display = 'block'; loading.innerHTML = '<p>Failed to load inventory.</p>'; }
  }
}

function updateCountSummary() {
  const lines = el('count-lines')?.querySelectorAll('.count-line') || [];
  let totalSold = 0;
  let totalRevenue = 0;

  lines.forEach(line => {
    const expected = parseFloat(line.querySelector('.count-expected').textContent) || 0;
    const actualInput = line.querySelector('.count-actual');
    const diffEl = line.querySelector('.count-diff');
    const actual = actualInput.value !== '' ? parseFloat(actualInput.value) : null;

    if (actual !== null) {
      const sold = Math.max(0, expected - actual);
      diffEl.textContent = sold > 0 ? `-${sold.toFixed(1)}` : '0';
      diffEl.className = 'count-diff' + (sold > 0 ? ' count-diff-sold' : '');
      const type = line.dataset.type;
      const price = type === 'tops' ? 150 : 50;
      totalSold += sold;
      totalRevenue += sold * price;
    } else {
      diffEl.textContent = '--';
      diffEl.className = 'count-diff';
    }
  });

  const summary = el('count-summary');
  if (summary) {
    summary.style.display = totalSold > 0 ? 'block' : 'none';
    el('count-total-sold').textContent = totalSold.toFixed(1) + ' lbs';
    el('count-total-revenue').textContent = '$' + totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2 });
  }
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
  const partnerId = el('count-partner').value;
  const date = el('count-date').value;
  const notes = el('count-notes')?.value || '';
  const lines = el('count-lines')?.querySelectorAll('.count-line') || [];

  const items = [];
  lines.forEach(line => {
    const actualInput = line.querySelector('.count-actual');
    if (actualInput.value !== '') {
      items.push({
        strain: line.dataset.strain,
        type: line.dataset.type,
        counted_lbs: parseFloat(actualInput.value),
      });
    }
  });

  if (items.length === 0) {
    ui.showToast('Enter at least one actual weight', 'error');
    return;
  }

  ui.closeModal('count-modal');
  ui.showToast(`Counting ${items.length} items...`);
  trackUserAction();

  try {
    const result = await api.saveBatchCount({ partner_id: partnerId, date, items, notes });
    const data = result.data;
    if (data?.summary) {
      ui.showToast(`${data.summary.total_sold_lbs.toFixed(1)} lbs sold — $${data.summary.total_revenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    }
    detailCache.delete(parseInt(partnerId));
    refreshAll();
  } catch (err) {
    ui.showToast(err.message || 'Failed to save count', 'error');
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
      const result = await api.getInventory(p.id);
      const inventory = result.data || [];
      const strainEl = document.getElementById('strains-' + p.id);
      if (!strainEl || inventory.length === 0) return;

      const topsLbs = inventory.filter(i => i.type === 'tops').reduce((s, i) => s + i.on_hand_lbs, 0);
      const smallsLbs = inventory.filter(i => i.type === 'smalls').reduce((s, i) => s + i.on_hand_lbs, 0);

      let summary = [];
      if (topsLbs > 0) summary.push(`${topsLbs.toFixed(1)} tops`);
      if (smallsLbs > 0) summary.push(`${smallsLbs.toFixed(1)} smalls`);

      const strainNames = inventory
        .filter(i => i.on_hand_lbs > 0)
        .map(i => i.strain)
        .filter((v, idx, arr) => arr.indexOf(v) === idx);

      strainEl.innerHTML = `
        <div class="card-grade-split">${summary.join(' · ')}</div>
        <div class="card-strain-list">${strainNames.join(' · ')}</div>
      `;
    } catch(e) { /* silent fail */ }
  });
}

// ─── START ──────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
