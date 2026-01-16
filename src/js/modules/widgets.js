/**
 * Widgets Module
 * Handles KPI and widget rendering/toggling
 */

import { kpiDefinitions, widgetDefinitions } from './config.js';
import { getGrid, getData } from './state.js';
import { saveSettings } from './settings.js';

// Track currently expanded KPI for accordion behavior
let expandedKPI = null;

/**
 * Render KPI cards to the #kpiRow container
 */
export function renderKPICards() {
  const container = document.getElementById('kpiRow');
  if (!container) {
    console.warn('KPI row container not found');
    return;
  }

  container.innerHTML = '';

  kpiDefinitions.forEach(kpi => {
    const card = document.createElement('div');
    card.className = `kpi-card ${kpi.color} loading`;
    card.dataset.kpi = kpi.id;
    card.dataset.hidden = !kpi.visible;
    card.style.cursor = 'pointer';

    card.onclick = () => toggleKPIExpand(kpi.id);

    card.innerHTML = `
      <div class="kpi-header">
        <div class="kpi-icon">${kpi.icon}</div>
        <span class="kpi-delta" id="delta_${kpi.id}"></span>
      </div>
      <div class="kpi-label">${kpi.label}</div>
      <div class="kpi-values">
        <span class="kpi-value" id="kpi_${kpi.id}">—</span>
        <span class="kpi-value-compare" id="kpiCmp_${kpi.id}"></span>
      </div>
      <div class="kpi-sub" id="kpiSub_${kpi.id}"></div>
      <div class="kpi-expanded-content" id="kpiExpanded_${kpi.id}">
        <div class="kpi-expanded-row">
          <div class="kpi-expanded-label">7-Day Rolling Avg</div>
          <div class="kpi-expanded-value" id="kpiRolling_${kpi.id}">—</div>
        </div>
        <div class="kpi-expanded-row">
          <div class="kpi-expanded-label">Crew-Normalized</div>
          <div class="kpi-expanded-value" id="kpiNormalized_${kpi.id}">—</div>
        </div>
        <div class="kpi-expanded-sparkline" id="kpiSparkline_${kpi.id}"></div>
        <div class="kpi-expanded-notes" id="kpiNotes_${kpi.id}"></div>
      </div>
      <div class="skeleton-content">
        <div class="skeleton skeleton-value"></div>
        <div class="skeleton skeleton-bar"></div>
      </div>
    `;

    container.appendChild(card);
  });
}

/**
 * Render KPI toggle switches in settings panel
 */
export function renderKPIToggles() {
  const container = document.getElementById('kpiToggles');
  if (!container) return;

  container.innerHTML = '';

  kpiDefinitions.forEach(kpi => {
    const toggle = document.createElement('div');
    toggle.className = 'widget-toggle';
    toggle.innerHTML = `
      <div class="widget-toggle-info">
        <div class="widget-toggle-icon ${kpi.color}">${kpi.icon}</div>
        <span class="widget-toggle-name">${kpi.label}</span>
      </div>
      <label class="toggle-switch">
        <input type="checkbox" ${kpi.visible ? 'checked' : ''} data-kpi-toggle="${kpi.id}">
        <span class="toggle-slider"></span>
      </label>
    `;

    // Add event listener
    const checkbox = toggle.querySelector('input[type="checkbox"]');
    if (checkbox) {
      checkbox.addEventListener('change', () => {
        toggleKPI(kpi.id, checkbox.checked);
      });
    }

    container.appendChild(toggle);
  });
}

/**
 * Render widget toggle switches in settings panel
 */
export function renderWidgetToggles() {
  const container = document.getElementById('widgetToggles');
  if (!container) return;

  container.innerHTML = '';

  widgetDefinitions.forEach(widget => {
    // Check actual widget visibility in DOM
    const widgetElement = document.querySelector(`[data-widget-id="widget-${widget.id}"]`);
    let isVisible = true; // Default to visible

    if (widgetElement) {
      // Widget is visible if it doesn't have the muuri-item-hidden class
      isVisible = !widgetElement.classList.contains('muuri-item-hidden');
    }

    const toggle = document.createElement('div');
    toggle.className = 'widget-toggle';
    toggle.innerHTML = `
      <div class="widget-toggle-info">
        <div class="widget-toggle-icon ${widget.color}"><i class="${widget.icon}"></i></div>
        <span class="widget-toggle-name">${widget.label}</span>
      </div>
      <label class="toggle-switch">
        <input type="checkbox" ${isVisible ? 'checked' : ''} data-widget-toggle="${widget.id}">
        <span class="toggle-slider"></span>
      </label>
    `;

    // Add event listener
    const checkbox = toggle.querySelector('input[type="checkbox"]');
    if (checkbox) {
      checkbox.addEventListener('change', () => {
        toggleWidget(widget.id, checkbox.checked);
      });
    }

    container.appendChild(toggle);
  });
}

/**
 * Toggle KPI card visibility
 * @param {string} id - KPI identifier
 * @param {boolean} visible - Whether the KPI should be visible
 */
export function toggleKPI(id, visible) {
  // Update definition visible state
  const kpi = kpiDefinitions.find(k => k.id === id);
  if (kpi) {
    kpi.visible = visible;
  }

  // Find the card element
  const card = document.querySelector(`.kpi-card[data-kpi="${id}"]`);
  if (!card) return;

  // Update data-hidden attribute
  card.dataset.hidden = !visible;

  // Use Muuri show/hide if available
  const muuriKPI = getGrid('kpi');
  if (muuriKPI && !muuriKPI._isDestroyed) {
    const items = muuriKPI.getItems();
    const targetItem = items.find(item => item.getElement() === card);

    if (targetItem) {
      if (visible) {
        // Show the card
        muuriKPI.show([targetItem], {
          instant: false,
          onFinish: () => {
            muuriKPI.refreshItems();
            muuriKPI.layout(true);
          }
        });
      } else {
        // Hide the card
        muuriKPI.hide([targetItem], {
          instant: false,
          onFinish: () => {
            muuriKPI.refreshItems();
            muuriKPI.layout(true);
          }
        });
      }
    }
  }

  saveSettings();
}

/**
 * Toggle widget visibility
 * @param {string} id - Widget identifier
 * @param {boolean} visible - Whether the widget should be visible
 */
export function toggleWidget(id, visible) {
  // Update definition visible state
  const widget = widgetDefinitions.find(w => w.id === id);
  if (widget) {
    widget.visible = visible;
  }

  const widgetId = `widget-${id}`;
  const muuriGrid = getGrid('widgets');

  if (muuriGrid && !muuriGrid._isDestroyed) {
    const widgetElement = document.querySelector(`[data-widget-id="${widgetId}"]`);
    if (widgetElement) {
      const items = muuriGrid.getItems();
      const targetItem = items.find(item => item.getElement() === widgetElement);

      if (targetItem) {
        if (visible) {
          muuriGrid.show([targetItem], {
            instant: false,
            onFinish: () => {
              muuriGrid.refreshItems();
              muuriGrid.layout(true);
            }
          });
        } else {
          muuriGrid.hide([targetItem], {
            instant: false,
            onFinish: () => {
              muuriGrid.refreshItems();
              muuriGrid.layout(true);
            }
          });
        }
      }
    }
  } else {
    // Fallback for non-Muuri mode
    const widgetElement = document.getElementById(widgetId);
    if (widgetElement) {
      if (visible) {
        widgetElement.classList.remove('hidden');
        widgetElement.style.display = '';
      } else {
        widgetElement.classList.add('hidden');
        widgetElement.style.display = 'none';
      }
    }
  }

  saveSettings();
}

/**
 * Toggle KPI card expansion (accordion behavior)
 * @param {string} id - KPI identifier
 */
export function toggleKPIExpand(id) {
  const card = document.querySelector(`.kpi-card[data-kpi="${id}"]`);
  if (!card) return;

  // Accordion behavior - close currently expanded card
  if (expandedKPI && expandedKPI !== id) {
    const prevCard = document.querySelector(`.kpi-card[data-kpi="${expandedKPI}"]`);
    if (prevCard) {
      prevCard.classList.remove('expanded');
    }
  }

  // Toggle current card
  const isExpanding = !card.classList.contains('expanded');
  card.classList.toggle('expanded');
  expandedKPI = isExpanding ? id : null;

  // Populate content if expanding
  if (isExpanding) {
    populateKPIExpandedContent(id);
  }

  // Refresh Muuri layout
  const muuriKPI = getGrid('kpi');
  if (muuriKPI && !muuriKPI._isDestroyed) {
    setTimeout(() => {
      muuriKPI.refreshItems();
      muuriKPI.layout(true);
    }, 50);
  }
}

/**
 * Populate expanded content for a KPI card
 * @param {string} id - KPI identifier
 */
function populateKPIExpandedContent(id) {
  const data = getData();
  if (!data) return;

  const kpi = kpiDefinitions.find(k => k.id === id);
  if (!kpi) return;

  // Get elements
  const rollingEl = document.getElementById(`kpiRolling_${id}`);
  const normalizedEl = document.getElementById(`kpiNormalized_${id}`);
  const notesEl = document.getElementById(`kpiNotes_${id}`);

  // Populate with placeholder data - actual implementation would use real data
  if (rollingEl) {
    rollingEl.textContent = '—';
  }
  if (normalizedEl) {
    normalizedEl.textContent = '—';
  }
  if (notesEl) {
    notesEl.textContent = '';
  }
}

/**
 * Update KPI values from data
 * @param {Object} totals - Current period totals
 * @param {Object} prevTotals - Previous period totals for comparison
 * @param {Object} targets - Target values for KPIs
 * @param {Object} rolling - Rolling average values
 * @param {boolean} compareMode - Whether comparison mode is active
 */
export function updateKPIValues(totals, prevTotals, targets, rolling, compareMode) {
  if (!totals) return;

  // Helper to format values based on format type
  const formatValue = (value, format) => {
    if (value == null || isNaN(value)) return '—';

    switch (format) {
      case 'lbs':
        return value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      case 'rate':
        return value.toFixed(2);
      case 'num':
        return Math.round(value).toLocaleString();
      case 'hrs':
        return value.toFixed(1);
      case 'dollar':
        return `$${value.toFixed(2)}`;
      default:
        return String(value);
    }
  };

  // Helper to set KPI value and comparison
  const setKPI = (id, val, prevVal, format, invertDelta = false, target = null, rollingAvg = null) => {
    const el = document.getElementById(`kpi_${id}`);
    const cmpEl = document.getElementById(`kpiCmp_${id}`);
    const deltaEl = document.getElementById(`delta_${id}`);
    const card = document.querySelector(`.kpi-card[data-kpi="${id}"]`);

    if (!el) return;

    // Set main value
    el.textContent = formatValue(val, format);

    // Remove loading state
    if (card) {
      card.classList.remove('loading');
    }

    // Set comparison value and delta
    if (prevVal != null && compareMode && cmpEl && deltaEl) {
      cmpEl.textContent = `vs ${formatValue(prevVal, format)}`;

      const pct = prevVal !== 0 ? ((val - prevVal) / prevVal * 100) : 0;
      const isUp = invertDelta ? pct < 0 : pct > 0;

      if (Math.abs(pct) < 1) {
        deltaEl.className = 'kpi-delta neutral';
        deltaEl.textContent = '~0%';
      } else if (isUp) {
        deltaEl.className = 'kpi-delta up';
        deltaEl.textContent = `+${Math.abs(pct).toFixed(0)}%`;
      } else {
        deltaEl.className = 'kpi-delta down';
        deltaEl.textContent = `-${Math.abs(pct).toFixed(0)}%`;
      }
    }

    // Apply state-based styling
    if (card) {
      card.classList.remove('state-ahead', 'state-behind');
      if (val != null && val !== 0) {
        if (target != null && val >= target) {
          card.classList.add('state-ahead');
        } else if (rollingAvg != null && val < rollingAvg * 0.9) {
          card.classList.add('state-behind');
        }
      }
    }
  };

  // Set values for each KPI
  const t = totals;
  const p = prevTotals;
  const r = rolling || {};
  const tgt = targets || {};

  setKPI('totalTops', t.totalTops, p?.totalTops, 'lbs', false, tgt.totalTops, r.totalTops);
  setKPI('totalSmalls', t.totalSmalls, p?.totalSmalls, 'lbs', false, tgt.totalSmalls, r.totalSmalls);
  setKPI('avgRate', t.avgRate, p?.avgRate, 'rate', false, tgt.avgRate, r.avgRate);
  setKPI('crew', t.trimmers, p?.trimmers, 'num');
  setKPI('operatorHours', t.totalOperatorHours, p?.totalOperatorHours, 'hrs', false, null, r.operatorHours);
  setKPI('costPerLb', t.costPerLb, p?.costPerLb, 'dollar', true, tgt.costPerLb, r.costPerLb);
  setKPI('totalLbs', t.totalLbs, p?.totalLbs, 'lbs', false, null, r.totalLbs);
  setKPI('maxRate', t.maxRate, p?.maxRate, 'rate');
  setKPI('trimmerHours', t.totalTrimmerHours, p?.totalTrimmerHours, 'hrs');
  setKPI('laborCost', t.totalLaborCost, p?.totalLaborCost, 'dollar', true);

  // Refresh Muuri KPI layout
  const muuriKPI = getGrid('kpi');
  if (muuriKPI && !muuriKPI._isDestroyed) {
    setTimeout(() => {
      muuriKPI.refreshItems();
      muuriKPI.layout(true);
    }, 50);
  }
}

/**
 * Get the currently expanded KPI id
 * @returns {string|null} The currently expanded KPI id or null
 */
export function getExpandedKPI() {
  return expandedKPI;
}

/**
 * Reset expanded KPI state
 */
export function resetExpandedKPI() {
  if (expandedKPI) {
    const card = document.querySelector(`.kpi-card[data-kpi="${expandedKPI}"]`);
    if (card) {
      card.classList.remove('expanded');
    }
    expandedKPI = null;
  }
}
