/**
 * Widgets Module
 * Handles KPI and widget rendering/toggling
 */

import { kpiDefinitions, widgetDefinitions } from './config.js';
import { getGrid, getData } from './state.js';
import { saveSettings } from './settings.js';
import { apiGet } from '../shared/api.js';

// Track currently expanded KPI for accordion behavior
let expandedKPI = null;

/**
 * Render KPI cards to the #kpiRow container
 */
export function renderKPICards() {
  try {
    const container = document.getElementById('kpiRow');
    if (!container) {
      console.warn('KPI row container not found');
      return;
    }

    container.innerHTML = '';

    kpiDefinitions.forEach(kpi => {
    // Create wrapper element for Muuri grid (required for proper positioning)
    const wrapper = document.createElement('div');
    wrapper.className = 'kpi-grid-item';
    wrapper.dataset.kpi = kpi.id;
    wrapper.dataset.hidden = !kpi.visible;

    const card = document.createElement('div');
    card.className = `kpi-card ${kpi.color} loading`;
    card.dataset.kpi = kpi.id;
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

    wrapper.appendChild(card);
    container.appendChild(wrapper);
  });
  } catch (error) {
    console.error('Error rendering KPI cards:', error);
  }
}

/**
 * Render KPI toggle switches in settings panel
 */
export function renderKPIToggles() {
  try {
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
  } catch (error) {
    console.error('Error rendering KPI toggles:', error);
  }
}

/**
 * Render widget toggle switches in settings panel
 */
export function renderWidgetToggles() {
  try {
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
  } catch (error) {
    console.error('Error rendering widget toggles:', error);
  }
}

/**
 * Toggle KPI card visibility
 * @param {string} id - KPI identifier
 * @param {boolean} visible - Whether the KPI should be visible
 */
export function toggleKPI(id, visible) {
  try {
    // Update definition visible state
    const kpi = kpiDefinitions.find(k => k.id === id);
    if (kpi) {
      kpi.visible = visible;
    }

    // Find the wrapper element (Muuri operates on the wrapper, not the card)
    const wrapper = document.querySelector(`.kpi-grid-item[data-kpi="${id}"]`);
    if (!wrapper) return;

  // Update data-hidden attribute on wrapper
  wrapper.dataset.hidden = !visible;

  // Use Muuri show/hide if available
  const muuriKPI = getGrid('kpi');
  if (muuriKPI && !muuriKPI._isDestroyed) {
    const items = muuriKPI.getItems();
    const targetItem = items.find(item => item.getElement() === wrapper);

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
  } catch (error) {
    console.error('Error toggling KPI:', error);
  }
}

/**
 * Toggle widget visibility
 * @param {string} id - Widget identifier
 * @param {boolean} visible - Whether the widget should be visible
 */
export function toggleWidget(id, visible) {
  try {
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
  } catch (error) {
    console.error('Error toggling widget:', error);
  }
}

/**
 * Toggle KPI card expansion (accordion behavior)
 * @param {string} id - KPI identifier
 */
export function toggleKPIExpand(id) {
  try {
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
      // Re-check grid validity - it could be destroyed during the 50ms delay
      if (muuriKPI && !muuriKPI._isDestroyed) {
        muuriKPI.refreshItems();
        muuriKPI.layout(true);
      }
    }, 50);
  }
  } catch (error) {
    console.error('Error toggling KPI expand:', error);
  }
}

/**
 * Populate expanded content for a KPI card
 * @param {string} id - KPI identifier
 */
function populateKPIExpandedContent(id) {
  try {
    const data = getData();
    if (!data) return;

    const kpi = kpiDefinitions.find(k => k.id === id);
    if (!kpi) return;

    // Get elements with null checks
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
  } catch (error) {
    console.error('Error populating KPI expanded content:', error);
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
  try {
    if (!totals) {
      console.warn('updateKPIValues: No totals data provided');
      return;
    }

    // Helper to format values based on format type
    const formatValue = (value, format) => {
      try {
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
      } catch (error) {
        console.warn('Error formatting value:', error);
        return '—';
      }
    };

  // Helper to set KPI value and comparison
  const setKPI = (id, val, prevVal, format, invertDelta = false, target = null, rollingAvg = null) => {
    try {
      const el = document.getElementById(`kpi_${id}`);
      const cmpEl = document.getElementById(`kpiCmp_${id}`);
      const deltaEl = document.getElementById(`delta_${id}`);
      const card = document.querySelector(`.kpi-card[data-kpi="${id}"]`);

      if (!el) {
        console.warn(`KPI element not found: kpi_${id}`);
        return;
      }

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
    } catch (error) {
      console.error(`Error setting KPI ${id}:`, error);
    }
  };

  // Set values for each KPI
  const t = totals;
  const p = prevTotals;
  const r = rolling || {};
  const tgt = targets || {};

  // Multi-day ranges carry a rolled-up totals object. Say so on the cards, and
  // relabel the headcount card — "current trimmers" means nothing over a range.
  const isAggregate = !!t.isAggregate;
  const crewLabelEl = document.querySelector('.kpi-card[data-kpi="crew"] .kpi-label');
  if (crewLabelEl) {
    crewLabelEl.textContent = isAggregate ? 'Avg Daily Crew' : 'Current Trimmers';
  }
  kpiDefinitions.forEach(kpi => {
    const subEl = document.getElementById(`kpiSub_${kpi.id}`);
    if (subEl) subEl.textContent = isAggregate ? `${t.days} days` : '';
  });

  // `targets` and `rollingAverage` are per-day and do not scale with the
  // requested range, so cumulative cards need them multiplied by the day count
  // before the ahead/behind styling means anything. Rate and cost/lb cards are
  // already per-unit and compare directly.
  const perDay = (value) => {
    if (typeof value !== 'number' || !isFinite(value)) return null;
    return isAggregate ? value * t.days : value;
  };

  setKPI('totalTops', t.totalTops, p?.totalTops, 'lbs', false, perDay(tgt.totalTops), perDay(r.totalTops));
  setKPI('totalSmalls', t.totalSmalls, p?.totalSmalls, 'lbs', false, perDay(tgt.totalSmalls), perDay(r.totalSmalls));
  setKPI('avgRate', t.avgRate, p?.avgRate, 'rate', false, tgt.avgRate, r.avgRate);
  setKPI('crew', t.trimmers, p?.trimmers, 'num');
  setKPI('operatorHours', t.operatorHours, p?.operatorHours, 'hrs', false, null, perDay(r.operatorHours));
  setKPI('costPerLb', t.costPerLb, p?.costPerLb, 'dollar', true, tgt.costPerLb, r.costPerLb);
  setKPI('topsCostPerLb', t.topsCostPerLb, p?.topsCostPerLb, 'dollar', true, null, r.topsCostPerLb);
  setKPI('smallsCostPerLb', t.smallsCostPerLb, p?.smallsCostPerLb, 'dollar', true, null, r.smallsCostPerLb);
  setKPI('totalLbs', t.totalLbs, p?.totalLbs, 'lbs', false, null, perDay(r.totalLbs));
  setKPI('maxRate', t.maxRate, p?.maxRate, 'rate');
  setKPI('trimmerHours', t.trimmerHours, p?.trimmerHours, 'hrs');
  setKPI('laborCost', t.laborCost, p?.laborCost, 'dollar', true);

  // Refresh Muuri KPI layout
  try {
    const muuriKPI = getGrid('kpi');
    if (muuriKPI && !muuriKPI._isDestroyed) {
      setTimeout(() => {
        // Re-check grid validity - it could be destroyed during the 50ms delay
        if (muuriKPI && !muuriKPI._isDestroyed) {
          muuriKPI.refreshItems();
          muuriKPI.layout(true);
        }
      }, 50);
    }
  } catch (error) {
    console.error('Error refreshing Muuri KPI layout:', error);
  }
  } catch (error) {
    console.error('Error in updateKPIValues:', error);
    // Don't crash the app - show error but continue
  }
}

// ==================== DATA PANELS ====================
//
// Strain Breakdown, Performance, Cost Analysis and Period Summary. All four
// read the SAME period totals the KPI row uses, plus `daily[]` — the only
// payload array that scales with the selected range. `hourly`, `current`,
// `bagTimer`, `targets`, `rollingAverage` and `strainSnapshot` are all
// today-scoped or fixed, so a panel fed from them would show identical
// numbers under every range label.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Strip the year prefix and grow-type suffix that every cultivar name carries. */
const shortCultivar = (name) => String(name || 'Unknown')
  .replace(/^\d{4}\s*-\s*/, '')
  .replace(/\s*\/\s*(Sungrown|Greenhouse|Indoor)\s*$/i, '')
  .trim() || 'Unknown';

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
const lbs = (v) => num(v).toFixed(1);
const money = (v) => `$${num(v).toFixed(2)}`;

/** Build a `.perf-row` label/value pair. Values are pre-formatted strings. */
const perfRow = (label, value) =>
  `<div class="perf-row"><span class="perf-label">${esc(label)}</span>` +
  `<span class="perf-value">${esc(value)}</span></div>`;

function setPanel(id, html, emptyMessage) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = html || `<div class="strain-list-empty">${esc(emptyMessage)}</div>`;
}

/**
 * Strain Breakdown — cultivar split for the selected range.
 *
 * Built from `daily[].cultivars` rather than `strainSnapshot`: the snapshot is
 * a fixed top-5 that comes back byte-identical for a 1-day and a 30-day
 * request, so it would misreport every range but one.
 */
function renderStrainBreakdown(daily, periodTops) {
  const totals = new Map();
  daily.forEach((day) => {
    (Array.isArray(day.cultivars) ? day.cultivars : []).forEach((c) => {
      const key = shortCultivar(c.cultivar);
      const acc = totals.get(key) || { tops: 0, smalls: 0 };
      acc.tops += num(c.tops);
      acc.smalls += num(c.smalls);
      totals.set(key, acc);
    });
  });

  const rows = [...totals.entries()]
    .map(([name, v]) => ({ name, ...v }))
    // A cultivar that has been started but not yet weighed contributes a
    // 0.0 / 0.0 row that reads as broken; the hero already names what is running.
    .filter((r) => r.tops > 0 || r.smalls > 0)
    .sort((a, b) => b.tops - a.tops);

  // Per-cultivar figures do not always reconstitute the day total. Show the
  // remainder rather than letting the breakdown quietly lose pounds.
  const attributed = rows.reduce((sum, r) => sum + r.tops, 0);
  const unattributed = num(periodTops) - attributed;
  if (unattributed >= 0.1) rows.push({ name: 'Unattributed', tops: unattributed, smalls: 0 });

  setPanel('strainList', rows.map((r) =>
    `<div class="strain-item"><span class="strain-name" title="${esc(r.name)}">${esc(r.name)}</span>` +
    `<span class="strain-stats"><span class="strain-tops">${lbs(r.tops)}</span>` +
    `<span class="strain-smalls">${lbs(r.smalls)}</span></span></div>`
  ).join(''), 'No cultivar data');
}

/**
 * Length of an hourly slot in hours, parsed from its "7:02 AM – 8:00 AM" label.
 *
 * Slots are not all 60 minutes — the shift opens on a partial hour and lunch
 * splits one in half. The API's hourly `target` is a flat per-trimmer rate that
 * does NOT account for this, so a 30-minute slot would otherwise be judged
 * against a full hour of expected output and always read as a failure.
 *
 * @returns {number} Duration in hours, or 1 when the label cannot be parsed
 */
function slotHours(label) {
  const m = String(label || '').match(
    /(\d{1,2}):(\d{2})\s*(AM|PM)?\s*[–-]\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i
  );
  if (!m) return 1;
  const to24 = (h, ampm) => {
    let hour = parseInt(h, 10) % 12;
    if (/PM/i.test(ampm || '')) hour += 12;
    return hour;
  };
  // A missing meridiem on the start time inherits the end's.
  const start = to24(m[1], m[3] || m[6]) * 60 + parseInt(m[2], 10);
  const end = to24(m[4], m[6] || m[3]) * 60 + parseInt(m[5], 10);
  const mins = end - start;
  return mins > 0 && mins <= 720 ? mins / 60 : 1;
}

/**
 * Performance — how the period's units performed against target.
 *
 * Single day: per-hour, from `hourly` (which is always today's hours).
 * Multi-day: per-day, from `daily`. Labels switch with the branch.
 *
 * Best and weakest are picked by attainment, not raw pounds, so a short slot
 * is not mistaken for a bad one.
 */
function renderPerformance(data, daily, totals, dayTarget) {
  const hourly = Array.isArray(data.hourly) ? data.hourly : [];
  // A requested date with no production comes back as the last working day with
  // an empty `hourly`. Fall through to the daily row there, so this panel agrees
  // with the other three instead of claiming the line never ran.
  const byHour = daily.length <= 1 && hourly.length > 0;
  const unitLabel = byHour ? 'hour' : 'day';
  const multiDay = !byHour;

  const units = byHour
    ? hourly.map((h) => {
      const hours = slotHours(h.label);
      return {
        name: h.label,
        lbs: num(h.tops || h.lbs),
        // Per-trimmer rate → pounds expected from this crew over this slot.
        target: num(h.target) * num(h.trimmers) * hours,
        hours
      };
    })
    : daily.map((d) => ({
      name: d.label || d.date,
      lbs: num(d.totalTops),
      target: num(dayTarget),
      hours: 1
    }));

  const worked = units.filter((u) => u.lbs > 0);
  if (!worked.length) return setPanel('perfTable', '', 'No production yet');

  const score = (u) => (u.target > 0 ? u.lbs / u.target : u.lbs);
  const best = worked.reduce((a, b) => (score(b) > score(a) ? b : a));
  const weakest = worked.reduce((a, b) => (score(b) < score(a) ? b : a));
  const atTarget = worked.filter((u) => u.target > 0 && u.lbs >= u.target).length;
  const withTarget = worked.filter((u) => u.target > 0).length;
  const periodTarget = multiDay ? num(dayTarget) * daily.length : num(dayTarget);
  const attainment = periodTarget > 0 ? (num(totals.totalTops) / periodTarget) * 100 : null;
  const unitsElapsed = worked.reduce((sum, u) => sum + u.hours, 0) || worked.length;

  // Hourly labels are ranges ("7:02 AM – 8:00 AM") and read better trimmed to
  // their start. Daily labels are ISO dates — the pattern must not touch those.
  const shortName = (n) => String(n || '')
    .replace(/\s*[–-]\s*\d{1,2}:\d{2}\s*(AM|PM)?\s*$/i, '').trim() || '—';

  setPanel('perfTable', [
    perfRow(multiDay ? 'Days worked' : 'Hours logged', multiDay
      ? String(worked.length)
      : unitsElapsed.toFixed(1)),
    perfRow(`Best ${unitLabel}`, `${lbs(best.lbs)} lbs · ${shortName(best.name)}`),
    worked.length > 1 ? perfRow(`Weakest ${unitLabel}`, `${lbs(weakest.lbs)} lbs · ${shortName(weakest.name)}`) : '',
    // Qualified as "tops" — Period Summary shows an avg/day over combined lbs,
    // and two rows labelled "Avg per day" with different numbers is a bug report.
    perfRow(`Avg tops/${unitLabel}`, `${lbs(num(totals.totalTops) / unitsElapsed)} lbs`),
    withTarget ? perfRow(`${multiDay ? 'Days' : 'Hours'} at target`, `${atTarget} of ${withTarget}`) : '',
    attainment != null ? perfRow('Attainment', `${attainment.toFixed(0)}% of ${lbs(periodTarget)} lbs`) : ''
  ].join(''), 'No production yet');
}

/**
 * Cost Analysis — where the labor went. Deliberately carries the two figures
 * the KPI row does not: cost per operator hour, and the tops/smalls dollar
 * split that the blended rate hides.
 */
function renderCostAnalysis(totals) {
  const labor = num(totals.laborCost);
  if (labor <= 0) return setPanel('costTable', '', 'No labor recorded');

  const opHours = num(totals.operatorHours);
  const topsDollars = num(totals.topsCostPerLb) * num(totals.totalTops);
  const smallsDollars = num(totals.smallsCostPerLb) * num(totals.totalSmalls);

  setPanel('costTable', [
    perfRow('Total labor', money(labor)),
    opHours > 0 ? perfRow('Per operator hour', money(labor / opHours)) : '',
    perfRow('Blended cost/lb', money(totals.costPerLb)),
    perfRow('Tops cost/lb', money(totals.topsCostPerLb)),
    perfRow('Smalls cost/lb', money(totals.smallsCostPerLb)),
    topsDollars > 0 || smallsDollars > 0
      ? perfRow('Tops / smalls split', `${money(topsDollars)} · ${money(smallsDollars)}`)
      : ''
  ].join(''), 'No labor recorded');
}

/**
 * Period Summary — the span and volume of whatever range is selected.
 */
function renderPeriodSummary(daily, totals, fallbackActive) {
  if (!daily.length) return setPanel('periodTable', '', 'No data for this period');

  const first = daily[0].date || daily[0].label;
  const last = daily[daily.length - 1].date || daily[daily.length - 1].label;
  const span = daily.length > 1 ? `${first} → ${last}` : String(first || '—');
  const days = daily.length;

  setPanel('periodTable', [
    perfRow(days > 1 ? 'Period' : 'Date', span),
    // The requested range had no production and the API substituted the last
    // working day; without this the dates above look like a rendering bug.
    fallbackActive ? perfRow('Source', 'Last working day') : '',
    perfRow('Days worked', String(days)),
    perfRow('Total tops', `${lbs(totals.totalTops)} lbs`),
    perfRow('Total smalls', `${lbs(totals.totalSmalls)} lbs`),
    perfRow('Combined', `${lbs(totals.totalLbs)} lbs`),
    days > 1 ? perfRow('Avg combined/day', `${lbs(num(totals.totalLbs) / days)} lbs`) : '',
    perfRow('Lbs/trimmer/hr', num(totals.avgRate).toFixed(2))
  ].join(''), 'No data for this period');
}

/**
 * Populate the four data panels. Called alongside updateKPIValues so both read
 * the same period totals — a second source of truth for the same numbers is
 * how the dashboard came to disagree with its own chart in the first place.
 *
 * @param {Object} data - Full dashboard payload
 * @param {Object} totals - Period totals from getPeriodTotals()
 */
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * 'Mon 11:41 AM' from the queue's { date, minutes }.
 *
 * Built from the parts rather than parsed — `new Date('2026-08-24')` is UTC
 * midnight, which reads as the day before anywhere west of Greenwich, and this
 * whole board is Pacific.
 */
function readyAt(finish) {
  if (!finish || !finish.date) return '';
  const [y, m, d] = String(finish.date).split('-').map(Number);
  const dow = DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const mins = num(finish.minutes);
  const h24 = Math.floor(mins / 60);
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${dow} ${h}:${String(mins % 60).padStart(2, '0')} ${h24 >= 12 ? 'PM' : 'AM'}`;
}

const queueLbs = (n) => (Math.round(num(n) * 10) / 10).toLocaleString('en-US');

function queueRow(b, isFront) {
  const pct = Math.max(0, Math.min(1, num(b.pct)));
  const title = b.nickname
    ? `${escapeHtml(b.nickname)}${b.orderRef ? ` · ${escapeHtml(b.orderRef)}` : ''}`
    : escapeHtml(b.orderRef || b.orderId || 'order');

  return `
    <div class="queue-row${isFront ? ' front' : ''}" role="listitem">
      <div class="queue-row-head">
        <span class="queue-row-title">${isFront ? '<span class="queue-marker" aria-hidden="true">▶</span> ' : ''}${title}</span>
        <span class="queue-row-pct">${Math.round(pct * 100)}%</span>
      </div>
      <div class="queue-row-cultivar">${escapeHtml(b.cultivarName || '—')}${b.form ? ` · ${escapeHtml(b.form)}` : ''}</div>
      <div class="queue-bar" role="img" aria-label="${Math.round(pct * 100)} percent trimmed">
        <div class="queue-bar-fill" style="width:${(pct * 100).toFixed(1)}%"></div>
      </div>
      <div class="queue-row-foot">
        <span>${queueLbs(b.doneLbs)}/${queueLbs(b.totalLbs)} lb</span>
        <span>${b.finish ? `ready ${readyAt(b.finish)}` : ''}</span>
      </div>
    </div>`;
}

/**
 * The production queue widget.
 *
 * Reads `/api/wholesale`, which is NOT the payload the rest of the dashboard
 * runs on — so it fetches for itself and swallows its own failures. A wholesale
 * outage must render an error inside this one card, never take down the
 * dashboard refresh that called it.
 */
export async function renderQueueWidget() {
  const body = document.getElementById('queueWidgetBody');
  if (!body) return;

  let brief;
  try {
    brief = await apiGet('wholesale', 'getQueueBrief');
  } catch (error) {
    console.error('Queue widget failed to load:', error);
    body.innerHTML = '<div class="queue-empty">Queue unavailable</div>';
    return;
  }

  const rows = Array.isArray(brief?.blocks) ? brief.blocks : [];
  if (!rows.length) {
    body.innerHTML = '<div class="queue-empty">Queue is clear — nothing scheduled</div>';
    return;
  }

  // `blocksTotal` is the uncapped count from the server. Counting `rows` here
  // would always report the cap and the overflow line would never appear.
  const hidden = num(brief.blocksTotal) - rows.length;
  const more = hidden > 0
    ? `<div class="queue-more">+${hidden} more on the board</div>`
    : '';

  body.innerHTML = rows.map((b, i) => queueRow(b, i === 0)).join('') + more;
}

export function updateDataWidgets(data, totals) {
  try {
    if (!data || !totals) return;
    const daily = Array.isArray(data.daily) ? data.daily : [];
    const dayTarget = (data.targets && num(data.targets.totalTops)) || 0;

    const fallbackActive = !!(data.fallback && data.fallback.active);

    renderStrainBreakdown(daily, totals.totalTops);
    renderPerformance(data, daily, totals, dayTarget);
    renderCostAnalysis(totals);
    renderPeriodSummary(daily, totals, fallbackActive);
  } catch (error) {
    console.error('Error updating data widgets:', error);
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
