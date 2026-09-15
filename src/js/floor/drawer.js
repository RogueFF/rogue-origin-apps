/**
 * The off-canvas drawer: two tools that don't belong in the hour itself —
 * the pool inventory scanner and a read view of the order queue board.
 *
 * Neither tab talks to the network until the drawer is opened for the first
 * time (ensureInventoryInit / the queue board only renders on open or
 * setBrief). A floor manager who never opens the drawer costs this page
 * zero extra requests.
 *
 * Ports the pool-side of index.js:2932-3900 (products, cache, type/op/unit
 * toggles, preview, update, quick-add, recent changes) onto the v3 drawer
 * markup, plus the drawer chrome itself (open/close/tabs), which legacy
 * didn't have in this shape.
 *
 * `els` is id-keyed (main.js builds it): drawerBtn, drawer, scrim,
 * drawerClose, drawerTabs, drawerInventory, drawerQueue, poolTypeSeg,
 * poolProduct, poolRefresh, poolGrams, poolLbs, poolStale, poolOpSeg,
 * poolAmount, poolUnitSeg, poolNote, poolPreview, previewCurrent,
 * previewOpLabel, previewChange, previewNew, poolUpdate, poolResult,
 * resultPrev, resultChangeLabel, resultChange, resultNew, quickAdd10lb,
 * quickAdd5kg, recentRefresh, recentList, queueBoard, drawerMeta.
 *
 * This module wires the `#drawerBtn` click itself (it's the only sane owner
 * of open/close state) — main.js must NOT attach its own listener there, or
 * every click opens the drawer and immediately closes it again.
 */
import { esc } from './format.js';
import { showToast } from '../shared/toast.js';
import { renderQueueBoard } from './queue.js';

const CACHE_DURATION_MS = 2 * 60 * 1000; // pool product list: 2-minute cache per type
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // pool product list: flag as stale past 5 minutes
const GRAMS_PER_LB = 453.592;

const OP_LABEL = { add: 'adding', subtract: 'subtracting', set: 'setting' };
const CHANGE_LABEL = { add: 'added', subtract: 'subtracted', set: 'changed' };

/** Strip the "New!" prefix and the redundant "hemp flower" suffix legacy's
 * product titles carry, leaving just the cultivar name. Port of
 * cleanProductTitle index.js:3125. */
function cleanProductTitle(title) {
  return String(title || '')
    .replace(/^New!\s*/i, '')
    .replace(/\s*hemp flower\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Spreadsheet formula errors (`#ERROR!`, `#N/A`, …) sometimes land in the
 * note column upstream; never show or resend one as if it were a note. */
function isJunkNote(note) {
  return /^#(ERROR|REF|NAME|VALUE|DIV\/0|NULL|N\/A)!?$/i.test(note);
}

/** Grams, one decimal, comma-grouped — matches the DOM contract's
 * placeholder content ("17,327"), which format.js's plain num() doesn't do. */
function fmtG(v) {
  return (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Pounds, two decimals, comma-grouped. */
function fmtLbs(v) {
  return (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function initDrawer({ els, api, t }) {
  const controller = new AbortController();
  const { signal } = controller;

  let isOpen = false;
  let activeTab = 'inventory';
  let lastBrief = null;

  let inventoryInitialized = false;
  const poolCache = { smalls: { data: null, timestamp: 0 }, tops: { data: null, timestamp: 0 } };
  let currentPoolType = 'smalls';
  let currentOperation = 'add';
  let currentUnit = 'grams';
  let poolProducts = [];
  let poolDataTimestamp = null;
  let previewTimer = null;
  let resultHideTimer = null;
  let recentEntries = []; // null means the last fetch errored, [] means empty

  // ---- pool: data --------------------------------------------------------

  async function loadPoolProducts(poolType, { force = false } = {}) {
    const cache = poolCache[poolType];
    const now = Date.now();
    if (!force && cache.data && now - cache.timestamp < CACHE_DURATION_MS) return cache;
    try {
      const { products } = await api.listPoolProducts(poolType);
      poolCache[poolType] = { data: products || [], timestamp: now };
    } catch (err) {
      console.error('Failed to load pool products:', err);
      if (!cache.data) poolCache[poolType] = { data: [], timestamp: now };
    }
    return poolCache[poolType];
  }

  async function switchPoolType(type, { force = false } = {}) {
    const entry = await loadPoolProducts(type, { force });
    if (type !== currentPoolType) return; // a later switch already won
    poolProducts = entry.data || [];
    poolDataTimestamp = entry.timestamp;
    populateProductSelect();
    renderPoolNow();
  }

  async function ensureInventoryInit() {
    if (inventoryInitialized) return;
    inventoryInitialized = true;
    // The static page ships placeholder figures so the layout can be judged
    // without data; the pool proxy takes a few seconds, and a stale number in
    // that gap reads as a real one. Show the empty state first.
    populateProductSelect();
    renderPoolNow();
    // Preload both types so the pool-type toggle is instant once loaded once.
    await Promise.all(['smalls', 'tops'].map((type) => loadPoolProducts(type)));
    await switchPoolType(currentPoolType, { force: false });
    loadRecentChanges();
  }

  function currentProduct() {
    return poolProducts.find((p) => p.id === els.poolProduct.value);
  }

  function toGrams(amount) {
    return currentUnit === 'lbs' ? amount * GRAMS_PER_LB : amount;
  }

  // ---- pool: rendering ----------------------------------------------------

  function populateProductSelect() {
    const select = els.poolProduct;
    const current = select.value;
    const sorted = poolProducts
      .map((p) => ({ ...p, displayTitle: cleanProductTitle(p.title) }))
      .sort((a, b) => a.displayTitle.localeCompare(b.displayTitle));
    select.innerHTML = '<option value="">…</option>'
      + sorted.map((p) => `<option value="${esc(p.id)}">${esc(p.displayTitle)}</option>`).join('');
    if (current && sorted.some((p) => p.id === current)) select.value = current;
  }

  function renderStale() {
    if (!poolDataTimestamp) { els.poolStale.hidden = true; return; }
    const elapsed = Date.now() - poolDataTimestamp;
    if (elapsed <= STALE_THRESHOLD_MS) { els.poolStale.hidden = true; return; }
    els.poolStale.hidden = false;
    // Taste call: no i18n key exists for this tooltip (labels.js is A's
    // file, not this module's), so it stays a terse, English-only glyph +
    // title rather than inventing a key outside this module's ownership.
    els.poolStale.textContent = '!';
    els.poolStale.title = `Data is ${Math.floor(elapsed / 60000)} min old — refresh to update.`;
  }

  function renderPoolNow() {
    const product = currentProduct();
    if (product && product.poolValue !== undefined) {
      const grams = Number(product.poolValue) || 0;
      els.poolGrams.textContent = fmtG(grams);
      els.poolLbs.textContent = fmtLbs(grams / GRAMS_PER_LB);
    } else {
      els.poolGrams.textContent = '--';
      els.poolLbs.textContent = '--';
    }
    renderStale();
    updatePreview();
  }

  function updatePreview() {
    const amount = parseFloat(els.poolAmount.value) || 0;
    const product = currentProduct();
    if (amount <= 0 || !product) { els.poolPreview.hidden = true; return; }

    const currentGrams = Number(product.poolValue) || 0;
    const amountGrams = toGrams(amount);
    let newValue;
    let changeText;
    if (currentOperation === 'add') {
      newValue = currentGrams + amountGrams;
      changeText = `+${fmtG(amountGrams)}g`;
    } else if (currentOperation === 'subtract') {
      newValue = Math.max(0, currentGrams - amountGrams);
      changeText = `-${fmtG(amountGrams)}g`;
    } else {
      newValue = amountGrams;
      changeText = `${fmtG(amountGrams)}g`;
    }

    els.previewOpLabel.textContent = t(OP_LABEL[currentOperation]);
    els.previewCurrent.textContent = `${fmtG(currentGrams)}g`;
    els.previewChange.textContent = changeText;
    els.previewNew.textContent = `${fmtG(newValue)}g`;
    els.poolPreview.hidden = false;
  }

  function displayResult({ previousValue, changeAmount, newValue, operation }) {
    els.resultPrev.textContent = `${fmtG(previousValue)}g`;
    els.resultNew.textContent = `${fmtG(newValue)}g`;
    const sign = operation === 'subtract' ? '-' : '+';
    els.resultChange.textContent = `${sign}${fmtG(Math.abs(changeAmount))}g`;
    els.resultChangeLabel.textContent = t(CHANGE_LABEL[operation] || 'changed');
    els.poolResult.hidden = false;
    clearTimeout(resultHideTimer);
    resultHideTimer = setTimeout(() => { els.poolResult.hidden = true; }, 5000);
  }

  function renderRecent() {
    if (recentEntries === null) {
      els.recentList.innerHTML = `<div class="empty">${esc(t('errorLoading'))}</div>`;
      return;
    }
    if (!recentEntries.length) {
      els.recentList.innerHTML = `<div class="empty">${esc(t('noChangesYet'))}</div>`;
      return;
    }
    els.recentList.innerHTML = recentEntries.map(renderRecentEntry).join('');
  }

  function renderRecentEntry(entry) {
    const amt = Number(entry.changeAmount) || 0;
    const sign = amt < 0 ? '-' : entry.action === 'set' ? '=' : '+';
    const time = entry.timestamp
      ? new Date(entry.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : '';
    const note = entry.note && !isJunkNote(entry.note) ? esc(entry.note) : '';
    return `<div class="change">
      <span>${esc(entry.productTitle || '')}</span>
      <span class="num">${sign}${Math.abs(amt).toLocaleString('en-US', { maximumFractionDigits: 1 })}g</span>
      <span>&rarr;</span>
      <span class="num">${(Number(entry.newValue) || 0).toLocaleString('en-US', { maximumFractionDigits: 1 })}g</span>
      <span class="muted">${esc(time)}${note ? ` · ${note}` : ''}</span>
    </div>`;
  }

  async function loadRecentChanges() {
    try {
      const { entries } = await api.getRecentPoolChanges(10);
      recentEntries = entries || [];
    } catch (err) {
      console.error('Failed to load recent changes:', err);
      recentEntries = null;
    }
    renderRecent();
  }

  // ---- pool: writes ---------------------------------------------------

  async function applyPoolWrite({ productId, operation, amountGrams, note }, onSettled) {
    const product = poolProducts.find((p) => p.id === productId);
    const currentValue = product ? Number(product.poolValue) || 0 : 0;
    let optimisticNewValue;
    if (operation === 'add') optimisticNewValue = currentValue + amountGrams;
    else if (operation === 'subtract') optimisticNewValue = Math.max(0, currentValue - amountGrams);
    else optimisticNewValue = amountGrams;

    if (product) product.poolValue = optimisticNewValue;
    renderPoolNow();
    displayResult({
      previousValue: currentValue,
      changeAmount: operation === 'subtract' ? -amountGrams : amountGrams,
      newValue: optimisticNewValue,
      operation,
    });

    try {
      const result = await api.updatePool({ productId, operation, amount: amountGrams, note, poolType: currentPoolType });
      // Read from both `result` and `result.data` — updatePool's response
      // shape is inconsistently (un)wrapped server-side; see api.js.
      const data = result?.data || {};
      const actualNewValue = result?.newValue ?? data.newValue ?? optimisticNewValue;
      if (product) product.poolValue = actualNewValue;
      renderPoolNow();
      displayResult({
        previousValue: result?.previousValue ?? data.previousValue ?? currentValue,
        changeAmount: result?.changeAmount ?? data.changeAmount ?? (operation === 'subtract' ? -amountGrams : amountGrams),
        newValue: actualNewValue,
        operation,
      });
      poolCache[currentPoolType].timestamp = Date.now();
      loadRecentChanges();
      onSettled?.(true);
    } catch (err) {
      console.error('Pool update failed:', err);
      if (product) product.poolValue = currentValue;
      renderPoolNow();
      // Taste call: legacy flashed the button text with a "✗ Error"
      // glyph; the phase 1 spec routes drawer errors to the shared toast
      // channel instead (no emoji/dingbats, and it survives the button
      // being re-labelled a moment later).
      showToast(err?.message || t('errorLoading'), 'error');
      onSettled?.(false);
    }
  }

  async function onUpdateClick() {
    const productId = els.poolProduct.value;
    if (!productId) { els.poolProduct.focus(); return; }
    const amount = parseFloat(els.poolAmount.value) || 0;
    if (amount <= 0) { els.poolAmount.focus(); return; }
    let note = els.poolNote.value.trim();
    if (isJunkNote(note)) note = '';

    const amountGrams = toGrams(amount);
    els.poolAmount.value = '';
    els.poolNote.value = '';
    els.poolPreview.hidden = true;

    els.poolUpdate.disabled = true;
    els.poolUpdate.textContent = t('updating');
    await applyPoolWrite({ productId, operation: currentOperation, amountGrams, note }, () => {
      els.poolUpdate.disabled = false;
      els.poolUpdate.textContent = t('updatePool');
    });
  }

  async function onQuickAdd(amountGrams, noteKey, btn) {
    const productId = els.poolProduct.value;
    if (!productId) { els.poolProduct.focus(); return; }
    btn.disabled = true;
    await applyPoolWrite({ productId, operation: 'add', amountGrams, note: t(noteKey) }, () => {
      btn.disabled = false;
    });
  }

  // ---- pool: wiring ----------------------------------------------------

  function syncSeg(seg, datasetKey, value) {
    seg.querySelectorAll('button').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset[datasetKey] === value));
    });
  }

  els.poolTypeSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-pool]');
    if (!btn || btn.dataset.pool === currentPoolType) return;
    currentPoolType = btn.dataset.pool;
    syncSeg(els.poolTypeSeg, 'pool', currentPoolType);
    switchPoolType(currentPoolType);
  }, { signal });

  els.poolRefresh.addEventListener('click', () => switchPoolType(currentPoolType, { force: true }), { signal });
  els.poolProduct.addEventListener('change', renderPoolNow, { signal });

  els.poolOpSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-op]');
    if (!btn) return;
    currentOperation = btn.dataset.op;
    syncSeg(els.poolOpSeg, 'op', currentOperation);
    updatePreview();
  }, { signal });

  els.poolUnitSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-unit]');
    if (!btn) return;
    currentUnit = btn.dataset.unit;
    syncSeg(els.poolUnitSeg, 'unit', currentUnit);
    updatePreview();
  }, { signal });

  els.poolAmount.addEventListener('input', () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 100);
  }, { signal });

  els.poolUpdate.addEventListener('click', onUpdateClick, { signal });
  els.quickAdd10lb.addEventListener('click', () => onQuickAdd(10 * GRAMS_PER_LB, 'quickAddNote10lb', els.quickAdd10lb), { signal });
  els.quickAdd5kg.addEventListener('click', () => onQuickAdd(5000, 'quickAddNote5kg', els.quickAdd5kg), { signal });
  els.recentRefresh.addEventListener('click', () => loadRecentChanges(), { signal });

  // ---- queue tab ---------------------------------------------------------

  async function refreshBriefLocally() {
    // initDrawer has no onChanged hook back to main.js, so a successful
    // credit edit refetches the brief itself here (same as legacy's
    // loadQueueBrief() inside wireCreditFields) rather than waiting on
    // main's next 5s poll — the number the manager just typed should not
    // sit stale on screen for up to 5 seconds.
    try {
      lastBrief = await api.getQueueBrief();
    } catch (err) {
      console.error('Could not refresh queue brief:', err);
      return;
    }
    renderDrawerMeta();
    if (activeTab === 'queue') renderBoard();
  }

  function renderBoard() {
    renderQueueBoard(els.queueBoard, lastBrief, { t, api, onChanged: refreshBriefLocally });
  }

  function renderDrawerMeta() {
    els.drawerMeta.textContent = lastBrief ? `${Number(lastBrief.blocksTotal) || 0} ${t('open')}` : '';
  }

  function setBrief(brief) {
    lastBrief = brief || null;
    renderDrawerMeta();
    if (activeTab === 'queue') renderBoard();
  }

  // ---- tabs + open/close --------------------------------------------------

  function switchTab(tab) {
    activeTab = tab === 'queue' ? 'queue' : 'inventory';
    els.drawerTabs.querySelectorAll('button[data-tab]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.tab === activeTab));
    });
    els.drawerInventory.hidden = activeTab !== 'inventory';
    els.drawerQueue.hidden = activeTab !== 'queue';
    if (activeTab === 'inventory') ensureInventoryInit();
    else renderBoard();
  }

  function open(tab) {
    switchTab(tab || activeTab);
    isOpen = true;
    els.drawer.classList.add('open');
    els.drawer.setAttribute('aria-hidden', 'false');
    els.scrim.classList.add('on');
    els.drawerBtn.setAttribute('aria-expanded', 'true');
    els.drawerClose.focus();
  }

  function close() {
    isOpen = false;
    els.drawer.classList.remove('open');
    els.drawer.setAttribute('aria-hidden', 'true');
    els.scrim.classList.remove('on');
    els.drawerBtn.setAttribute('aria-expanded', 'false');
    els.drawerBtn.focus();
  }

  function toggle() {
    if (isOpen) close(); else open();
  }

  els.drawerBtn.addEventListener('click', toggle, { signal });
  els.drawerClose.addEventListener('click', close, { signal });
  els.scrim.addEventListener('click', close, { signal });
  els.drawerTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (btn) switchTab(btn.dataset.tab);
  }, { signal });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) close();
  }, { signal });

  function refreshLabels() {
    if (activeTab === 'queue') renderBoard();
    renderRecent();
    renderStale();
    renderDrawerMeta();
  }

  function destroy() {
    controller.abort();
    clearTimeout(previewTimer);
    clearTimeout(resultHideTimer);
  }

  return { open, close, toggle, setBrief, refreshLabels, destroy };
}
