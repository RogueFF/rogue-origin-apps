// ============================================
// Pool Inventory Standalone App
// ============================================

// Configuration
const POOL_API_URL = 'https://script.google.com/macros/s/AKfycbxvLdXrC24ztTKkcZcGV_Mpx_001jglf99c3H18HBWX9KpyjoZ4f22He3pyXDT2zDB_jw/exec';

// Bilingual Labels
const LABELS = {
  en: {
    smalls: 'Smalls',
    tops: 'Tops',
    strain: 'Strain',
    selectStrain: 'Select strain...',
    currentPool: 'Current Pool:',
    updatePool: 'Update Pool',
    add: 'Add',
    subtract: 'Subtract',
    set: 'Set',
    optionalNote: 'Optional note...',
    previous: 'Previous:',
    current: 'Current:',
    newValue: 'New:',
    preview: 'Preview:',
    adding: 'Adding:',
    subtracting: 'Subtracting:',
    setting: 'Setting to:',
    recentChanges: 'Recent Changes',
    noChangesYet: 'No changes yet',
    updating: 'Updating...',
    added: 'Added:',
    subtracted: 'Subtracted:',
    changed: 'Changed:',
  },
  es: {
    smalls: 'Smalls',
    tops: 'Tops',
    strain: 'Cepa',
    selectStrain: 'Seleccionar cepa...',
    currentPool: 'Pool Actual:',
    updatePool: 'Actualizar Pool',
    add: 'Agregar',
    subtract: 'Restar',
    set: 'Establecer',
    optionalNote: 'Nota opcional...',
    previous: 'Anterior:',
    current: 'Actual:',
    newValue: 'Nuevo:',
    preview: 'Vista Previa:',
    adding: 'Agregando:',
    subtracting: 'Restando:',
    setting: 'Estableciendo a:',
    recentChanges: 'Cambios Recientes',
    noChangesYet: 'Sin cambios aún',
    updating: 'Actualizando...',
    added: 'Agregado:',
    subtracted: 'Restado:',
    changed: 'Cambiado:',
  },
};

// State
let currentLang = localStorage.getItem('lang') || 'en';
let poolProducts = [];
let currentPoolType = 'smalls';
let currentOperation = 'add';
let currentUnit = 'grams';
let poolDataTimestamp = null;
let customDropdownScannerStrains = [];
const STALE_DATA_THRESHOLD = 5 * 60 * 1000; // 5 minutes

// Cache for pool products by type
const poolCache = {
  smalls: { data: null, timestamp: null },
  tops: { data: null, timestamp: null }
};
const CACHE_DURATION = 2 * 60 * 1000; // 2 minutes cache

// Event listeners registry (for cleanup)
const eventListeners = [];

function registerListener(element, event, handler) {
  if (!element) return;
  element.addEventListener(event, handler);
  eventListeners.push({ element, event, handler });
}

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  // Set initial pool type attribute for styling on body
  document.body.setAttribute('data-pool-type', currentPoolType);

  // Initialize language toggle
  initLanguageToggle();

  // Apply initial labels
  updateLabels();

  // Preload all pool types for instant switching
  await preloadAllPoolTypes();

  // Initialize all components
  initPoolTypeToggle();
  populateScannerStrainSelect();
  initOperationButtons();
  initUnitToggle();
  initPoolAmountInput();
  initRefreshPoolButton();
  initPoolUpdateButton();
  initRecentChanges();
});

// ============================================
// Language Support
// ============================================

function initLanguageToggle() {
  const langBtn = document.getElementById('lang-toggle');
  if (!langBtn) return;

  langBtn.textContent = currentLang === 'en' ? 'ES' : 'EN';

  registerListener(langBtn, 'click', () => {
    currentLang = currentLang === 'en' ? 'es' : 'en';
    localStorage.setItem('lang', currentLang);
    langBtn.textContent = currentLang === 'en' ? 'ES' : 'EN';
    updateLabels();
  });
}

function updateLabels() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (LABELS[currentLang][key]) {
      el.textContent = LABELS[currentLang][key];
    }
  });

  // Update placeholders
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.dataset.i18nPlaceholder;
    if (LABELS[currentLang][key]) {
      el.placeholder = LABELS[currentLang][key];
    }
  });

  // Update dropdown placeholder if no selection
  const dropdown = document.getElementById('scanner-strain-dropdown');
  const hiddenInput = document.getElementById('scanner-strain');
  const valueDisplay = dropdown?.querySelector('.custom-select-value');
  if (valueDisplay && !hiddenInput?.value) {
    valueDisplay.textContent = LABELS[currentLang].selectStrain || 'Select strain...';
  }
}

// ============================================
// Pool Product Loading & Caching
// ============================================

async function loadPoolProducts(force = false) {
  const cache = poolCache[currentPoolType];
  const now = Date.now();

  // Use cache if available and not expired (unless force refresh)
  if (!force && cache.data && cache.timestamp && (now - cache.timestamp < CACHE_DURATION)) {
    poolProducts = cache.data;
    poolDataTimestamp = cache.timestamp;
    return;
  }

  try {
    const response = await fetch(`${POOL_API_URL}?action=list_products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        poolType: currentPoolType
      })
    });

    const result = await response.json();
    poolProducts = result.products || [];

    // Update cache
    poolCache[currentPoolType] = {
      data: poolProducts,
      timestamp: now
    };

    // Set timestamp for stale data detection
    poolDataTimestamp = now;
  } catch (error) {
    console.error('Failed to load pool products:', error);
    poolProducts = [];
  }
}

async function preloadAllPoolTypes() {
  const types = ['smalls', 'tops'];
  const originalType = currentPoolType;

  for (const type of types) {
    if (type !== originalType) {
      currentPoolType = type;
      await loadPoolProducts();
    }
  }

  // Restore original type
  currentPoolType = originalType;
  await loadPoolProducts();
}

// ============================================
// Pool Type Toggle (Smalls/Tops)
// ============================================

function initPoolTypeToggle() {
  const toggleBtns = document.querySelectorAll('.pool-type-btn');

  toggleBtns.forEach((btn) => {
    registerListener(btn, 'click', async () => {
      // Update active state
      toggleBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      // Update current pool type
      currentPoolType = btn.dataset.poolType;

      // Update body data attribute for styling
      document.body.setAttribute('data-pool-type', currentPoolType);

      // Reload products for new pool type
      await loadPoolProducts();
      populateScannerStrainSelect();

      // Update current pool display
      updateCurrentPoolDisplay();
    });
  });
}

// ============================================
// Product Title Cleaning
// ============================================

function cleanProductTitle(title) {
  return title
    .replace(/^New!\s*/i, '')  // Remove "New!" prefix
    .replace(/\s*hemp flower\s*/gi, '')  // Remove "hemp flower"
    .replace(/\s+/g, ' ')  // Normalize whitespace
    .trim();
}

// ============================================
// Custom Dropdown for Strain Selection
// ============================================

function populateScannerStrainSelect() {
  const dropdown = document.getElementById('scanner-strain-dropdown');
  const hiddenInput = document.getElementById('scanner-strain');
  if (!dropdown || !hiddenInput) return;

  // Clean and sort products by title
  const sortedProducts = [...poolProducts]
    .map(p => ({ ...p, displayTitle: cleanProductTitle(p.title) }))
    .sort((a, b) => a.displayTitle.localeCompare(b.displayTitle));

  // Store products for dropdown
  customDropdownScannerStrains = sortedProducts;

  // Save current value
  const currentValue = hiddenInput.value;

  // Render options
  renderScannerDropdownOptions(dropdown, sortedProducts, currentValue);

  // Initialize dropdown if not already done
  if (!dropdown.dataset.initialized) {
    initScannerCustomDropdown(dropdown);
    dropdown.dataset.initialized = 'true';
  }

  // Restore selection if it still exists
  if (currentValue && sortedProducts.find(p => p.id === currentValue)) {
    const product = sortedProducts.find(p => p.id === currentValue);
    selectScannerDropdownValue(dropdown, currentValue, product.displayTitle);
  }
}

function renderScannerDropdownOptions(dropdown, products, selectedValue, filter = '') {
  const optionsContainer = dropdown.querySelector('.custom-select-options');
  if (!optionsContainer) return;

  const filterLower = filter.toLowerCase();
  const filtered = filter
    ? products.filter((p) => (p.displayTitle || p.title).toLowerCase().includes(filterLower))
    : products;

  if (filtered.length === 0) {
    optionsContainer.innerHTML = `<div class="custom-select-no-results">No strains found</div>`;
    return;
  }

  optionsContainer.innerHTML = filtered
    .map(
      (product) => {
        const displayName = product.displayTitle || product.title;
        const poolValue = parseFloat(product.poolValue) || 0;

        // Show in lbs if >= 1lb (453.592g), otherwise show in grams
        let weightDisplay;
        if (poolValue >= 453.592) {
          const poolLbs = poolValue / 453.592;
          weightDisplay = `${poolLbs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}lbs`;
        } else {
          weightDisplay = `${poolValue.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}g`;
        }

        return `
      <div class="custom-select-option${product.id === selectedValue ? ' selected' : ''}"
           data-value="${product.id}"
           data-pool-value="${product.poolValue}"
           data-title="${displayName}"
           role="option"
           aria-selected="${product.id === selectedValue}">
        <span class="option-name">${displayName}</span>
        <span class="option-weight">${weightDisplay}</span>
      </div>
    `;
      }
    )
    .join('');
}

function initScannerCustomDropdown(dropdown) {
  const trigger = dropdown.querySelector('.custom-select-trigger');
  const menu = dropdown.querySelector('.custom-select-menu');
  const searchInput = dropdown.querySelector('.custom-select-search-input');
  const optionsContainer = dropdown.querySelector('.custom-select-options');
  const valueDisplay = dropdown.querySelector('.custom-select-value');
  const hiddenInput = dropdown.querySelector('input[type="hidden"]');

  // Toggle dropdown on trigger click
  registerListener(trigger, 'click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains('open');
    closeAllCustomDropdowns();
    if (!isOpen) {
      dropdown.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      searchInput.value = '';
      searchInput.focus();
      renderScannerDropdownOptions(dropdown, customDropdownScannerStrains, hiddenInput.value);
    }
  });

  // Search input with debounce for better performance
  let searchTimeout;
  registerListener(searchInput, 'input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      renderScannerDropdownOptions(dropdown, customDropdownScannerStrains, hiddenInput.value, searchInput.value);
    }, 150); // 150ms debounce for search
  });

  // Prevent menu clicks from closing
  registerListener(menu, 'click', (e) => {
    e.stopPropagation();
  });

  // Handle option selection
  registerListener(optionsContainer, 'click', (e) => {
    const option = e.target.closest('.custom-select-option');
    if (!option) return;

    const value = option.dataset.value;
    const title = option.dataset.title;
    selectScannerDropdownValue(dropdown, value, title);
    closeAllCustomDropdowns();
  });

  // Close on outside click
  registerListener(document, 'click', () => {
    if (dropdown.classList.contains('open')) {
      closeAllCustomDropdowns();
    }
  });

  // Close on Escape
  registerListener(document, 'keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllCustomDropdowns();
    }
  });
}

function selectScannerDropdownValue(dropdown, value, title) {
  const valueDisplay = dropdown.querySelector('.custom-select-value');
  const hiddenInput = dropdown.querySelector('input[type="hidden"]');

  hiddenInput.value = value;
  valueDisplay.textContent = title || LABELS[currentLang].selectStrain || 'Select strain...';
  valueDisplay.classList.toggle('placeholder', !value);
  dropdown.classList.toggle('has-selection', !!value);

  // Update current pool display
  updateCurrentPoolDisplay();

  // Dispatch change event on hidden input
  hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
}

function closeAllCustomDropdowns() {
  document.querySelectorAll('.custom-select.open').forEach((dropdown) => {
    dropdown.classList.remove('open');
    const trigger = dropdown.querySelector('.custom-select-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  });
}

// ============================================
// Current Pool Display
// ============================================

function updateCurrentPoolDisplay() {
  const hiddenInput = document.getElementById('scanner-strain');
  const poolValueGramsEl = document.getElementById('current-pool-value-grams');
  const poolValueLbsEl = document.getElementById('current-pool-value-lbs');

  if (!hiddenInput || !poolValueGramsEl || !poolValueLbsEl) return;

  const productId = hiddenInput.value;
  const product = poolProducts.find(p => p.id === productId);

  if (product && product.poolValue !== undefined) {
    const grams = parseFloat(product.poolValue);
    const lbs = grams / 453.592; // Convert grams to pounds

    poolValueGramsEl.textContent = grams.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    poolValueLbsEl.textContent = lbs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Check for stale data
    checkStaleData();
  } else {
    poolValueGramsEl.textContent = '--';
    poolValueLbsEl.textContent = '--';
  }

  // Update preview if amount is entered
  updatePoolPreview();
}

function checkStaleData() {
  const staleIndicator = document.getElementById('pool-stale-indicator');
  if (!staleIndicator) return;

  if (poolDataTimestamp) {
    const elapsed = Date.now() - poolDataTimestamp;
    if (elapsed > STALE_DATA_THRESHOLD) {
      staleIndicator.style.display = 'block';
      staleIndicator.title = `Data is ${Math.floor(elapsed / 60000)} minutes old. Click refresh to update.`;
    } else {
      staleIndicator.style.display = 'none';
    }
  }
}

// ============================================
// Operation Buttons (Add/Subtract/Set)
// ============================================

function initOperationButtons() {
  const operationBtns = document.querySelectorAll('.operation-btn');

  operationBtns.forEach((btn) => {
    registerListener(btn, 'click', () => {
      // Update active state
      operationBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      // Update current operation
      currentOperation = btn.dataset.operation;

      // Update preview
      updatePoolPreview();
    });
  });
}

// ============================================
// Unit Toggle (grams/lbs)
// ============================================

function initUnitToggle() {
  const unitBtns = document.querySelectorAll('.unit-btn');

  unitBtns.forEach((btn) => {
    registerListener(btn, 'click', () => {
      // Update active state
      unitBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      // Update current unit
      currentUnit = btn.dataset.unit;

      // Update preview
      updatePoolPreview();
    });
  });
}

// ============================================
// Pool Amount Input
// ============================================

function initPoolAmountInput() {
  const amountInput = document.getElementById('pool-amount');
  if (!amountInput) return;

  // Debounce preview calculation for smoother performance
  let previewTimeout;
  registerListener(amountInput, 'input', () => {
    clearTimeout(previewTimeout);
    previewTimeout = setTimeout(() => {
      updatePoolPreview();
    }, 100); // 100ms debounce
  });
}

// ============================================
// Pool Preview Calculation
// ============================================

function updatePoolPreview() {
  const previewDiv = document.getElementById('pool-preview');
  const hiddenInput = document.getElementById('scanner-strain');
  const amountInput = document.getElementById('pool-amount');
  const poolValueGramsEl = document.getElementById('current-pool-value-grams');
  const operationLabel = document.getElementById('preview-operation-label');
  const previewCurrent = document.getElementById('preview-current');
  const previewChange = document.getElementById('preview-change');
  const previewNew = document.getElementById('preview-new');

  if (!previewDiv || !amountInput || !poolValueGramsEl) return;

  const amount = parseFloat(amountInput.value) || 0;
  const currentValueGrams = parseFloat(poolValueGramsEl.textContent.replace(/,/g, '')) || 0;

  if (amount > 0 && hiddenInput.value) {
    // Convert amount to grams if needed
    let amountGrams = amount;
    if (currentUnit === 'lbs') {
      amountGrams = amount * 453.592;
    }

    // Calculate new value
    let newValue;
    if (currentOperation === 'add') {
      newValue = currentValueGrams + amountGrams;
      operationLabel.textContent = LABELS[currentLang].adding || 'Adding:';
      previewChange.textContent = `+${amountGrams.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}g`;
    } else if (currentOperation === 'subtract') {
      newValue = Math.max(0, currentValueGrams - amountGrams);
      operationLabel.textContent = LABELS[currentLang].subtracting || 'Subtracting:';
      previewChange.textContent = `-${amountGrams.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}g`;
    } else { // set
      newValue = amountGrams;
      operationLabel.textContent = LABELS[currentLang].setting || 'Setting to:';
      previewChange.textContent = `${amountGrams.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}g`;
    }

    previewCurrent.textContent = `${currentValueGrams.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}g`;
    previewNew.textContent = `${newValue.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}g`;
    previewDiv.style.display = 'block';
  } else {
    previewDiv.style.display = 'none';
  }
}

// ============================================
// Refresh Pool Button
// ============================================

function initRefreshPoolButton() {
  const refreshBtn = document.getElementById('refresh-pool-btn');
  if (!refreshBtn) return;

  registerListener(refreshBtn, 'click', async () => {
    // Show loading state
    refreshBtn.style.opacity = '0.5';
    refreshBtn.style.pointerEvents = 'none';

    try {
      // Force reload pool products (bypass cache)
      await loadPoolProducts(true);

      // Repopulate dropdown
      populateScannerStrainSelect();

      // Update display
      updateCurrentPoolDisplay();

      // Hide stale indicator
      const staleIndicator = document.getElementById('pool-stale-indicator');
      if (staleIndicator) {
        staleIndicator.style.display = 'none';
      }
    } catch (error) {
      console.error('Failed to refresh pool data:', error);
    } finally {
      // Restore button state
      refreshBtn.style.opacity = '1';
      refreshBtn.style.pointerEvents = 'auto';
    }
  });
}

// ============================================
// Pool Update Button
// ============================================

function initPoolUpdateButton() {
  const updateBtn = document.getElementById('update-pool-btn');
  if (!updateBtn) return;

  registerListener(updateBtn, 'click', async () => {
    const strainSelect = document.getElementById('scanner-strain');
    const amountInput = document.getElementById('pool-amount');
    const noteInput = document.getElementById('pool-note');

    const productId = strainSelect?.value;
    const amount = parseFloat(amountInput?.value) || 0;
    const note = noteInput?.value.trim() || '';

    // Validation
    if (!productId) {
      // Focus on dropdown trigger
      const dropdown = document.getElementById('scanner-strain-dropdown');
      dropdown?.querySelector('.custom-select-trigger')?.focus();
      return;
    }

    if (amount <= 0) {
      amountInput?.focus();
      return;
    }

    // Convert amount to grams if needed
    let amountGrams = amount;
    if (currentUnit === 'lbs') {
      amountGrams = amount * 453.592;
    }

    // Get current pool value for optimistic update
    const poolValueGramsEl = document.getElementById('current-pool-value-grams');
    const poolValueLbsEl = document.getElementById('current-pool-value-lbs');
    const currentValue = parseFloat(poolValueGramsEl.textContent.replace(/,/g, '')) || 0;

    // Calculate optimistic new value
    let optimisticNewValue;
    if (currentOperation === 'add') {
      optimisticNewValue = currentValue + amountGrams;
    } else if (currentOperation === 'subtract') {
      optimisticNewValue = Math.max(0, currentValue - amountGrams);
    } else {
      optimisticNewValue = amountGrams;
    }

    // Update UI instantly (optimistic) - both grams and lbs
    poolValueGramsEl.textContent = optimisticNewValue.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    poolValueLbsEl.textContent = (optimisticNewValue / 453.592).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Update cached product data
    const product = poolProducts.find(p => p.id === productId);
    if (product) {
      product.poolValue = optimisticNewValue;
    }

    // Show optimistic result immediately
    displayUpdateResult({
      previousValue: currentValue,
      changeAmount: currentOperation === 'subtract' ? -amountGrams : amountGrams,
      newValue: optimisticNewValue,
      operation: currentOperation
    });

    // Clear inputs immediately
    amountInput.value = '';
    noteInput.value = '';

    // Hide preview
    const previewDiv = document.getElementById('pool-preview');
    if (previewDiv) previewDiv.style.display = 'none';

    // Call Pool API to update pool (in background)
    try {
      updateBtn.disabled = true;
      updateBtn.textContent = LABELS[currentLang].updating || 'Updating...';

      const response = await fetch(`${POOL_API_URL}?action=update_pool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          operation: currentOperation,
          amount: amountGrams,
          note,
          poolType: currentPoolType
        })
      });

      const result = await response.json();

      if (result.success) {
        // Update with actual server value (in case it differs)
        const actualNewValue = result.newValue || result.data?.newValue || optimisticNewValue;
        poolValueGramsEl.textContent = actualNewValue.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        poolValueLbsEl.textContent = (actualNewValue / 453.592).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        // Update cached product with actual value
        if (product) {
          product.poolValue = actualNewValue;
        }

        // Update cache with new value
        if (poolCache[currentPoolType].data) {
          poolCache[currentPoolType].timestamp = Date.now();
        }

        // Update result display with actual values
        displayUpdateResult({
          previousValue: result.previousValue || result.data?.previousValue || currentValue,
          changeAmount: result.changeAmount || result.data?.changeAmount || (currentOperation === 'subtract' ? -amountGrams : amountGrams),
          newValue: actualNewValue,
          operation: currentOperation
        });

        // Reload recent changes (background, non-blocking)
        loadRecentChanges();

        // Reset button
        setTimeout(() => {
          updateBtn.textContent = LABELS[currentLang].updatePool || 'Update Pool';
          updateBtn.disabled = false;
        }, 1500);
      } else {
        throw new Error(result.error || 'Failed to update pool');
      }
    } catch (error) {
      console.error('Pool update error:', error);

      // Revert optimistic update on error
      poolValueGramsEl.textContent = currentValue.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      poolValueLbsEl.textContent = (currentValue / 453.592).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (product) {
        product.poolValue = currentValue;
      }

      updateBtn.textContent = '✗ Error';
      setTimeout(() => {
        updateBtn.textContent = LABELS[currentLang].updatePool || 'Update Pool';
        updateBtn.disabled = false;
      }, 2000);
    }
  });
}

// ============================================
// Update Result Display
// ============================================

function displayUpdateResult(result) {
  const resultEl = document.getElementById('pool-update-result');
  const previousEl = document.getElementById('result-previous');
  const changeEl = document.getElementById('result-change');
  const changeLabelEl = document.getElementById('result-change-label');
  const newEl = document.getElementById('result-new');

  if (!resultEl) return;

  // Set values
  previousEl.textContent = `${result.previousValue.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}g`;
  newEl.textContent = `${result.newValue.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}g`;

  // Set change with appropriate label and sign
  const changeAmount = result.changeAmount;
  const changeSign = result.operation === 'subtract' ? '-' : '+';
  changeEl.textContent = `${changeSign}${Math.abs(changeAmount).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}g`;

  // Update change label based on operation
  if (result.operation === 'add') {
    changeLabelEl.textContent = LABELS[currentLang].added || 'Added:';
  } else if (result.operation === 'subtract') {
    changeLabelEl.textContent = LABELS[currentLang].subtracted || 'Subtracted:';
  } else {
    changeLabelEl.textContent = LABELS[currentLang].changed || 'Changed:';
  }

  // Show result
  resultEl.style.display = 'block';

  // Hide after 5 seconds
  setTimeout(() => {
    resultEl.style.display = 'none';
  }, 5000);
}

// ============================================
// Recent Changes
// ============================================

function initRecentChanges() {
  const refreshBtn = document.getElementById('refresh-history-btn');
  if (refreshBtn) {
    registerListener(refreshBtn, 'click', () => loadRecentChanges());
  }

  // Load initial changes
  loadRecentChanges();
}

async function loadRecentChanges() {
  const listEl = document.getElementById('recent-changes-list');
  if (!listEl) return;

  try {
    const response = await fetch(`${POOL_API_URL}?action=get_recent_changes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        count: 10
      })
    });

    const result = await response.json();
    const entries = result.entries || [];

    if (entries.length === 0) {
      listEl.innerHTML = `<div class="no-changes">${LABELS[currentLang].noChangesYet || 'No changes yet'}</div>`;
      return;
    }

    // Build HTML for entries
    listEl.innerHTML = entries.map((entry) => {
      const timestamp = new Date(entry.timestamp).toLocaleString();
      const actionClass = entry.action === 'add' ? 'add' : entry.action === 'subtract' ? 'subtract' : 'set';
      const actionLabel = entry.action === 'add' ? '+' : entry.action === 'subtract' ? '-' : '=';

      return `
        <div class="change-entry">
          <div class="change-entry-header">
            <span class="change-entry-product">${escapeHtml(entry.productTitle)}</span>
            <span class="change-entry-timestamp">${timestamp}</span>
          </div>
          <div class="change-entry-details">
            <span class="change-entry-action ${actionClass}">${actionLabel}${entry.changeAmount}g</span>
            <span>→</span>
            <span>${entry.newValue}g</span>
          </div>
          ${entry.note ? `<div class="change-entry-note">${escapeHtml(entry.note)}</div>` : ''}
        </div>
      `;
    }).join('');

  } catch (error) {
    console.error('Failed to load recent changes:', error);
    listEl.innerHTML = `<div class="no-changes">Error loading changes</div>`;
  }
}

// ============================================
// Utility Functions
// ============================================

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
