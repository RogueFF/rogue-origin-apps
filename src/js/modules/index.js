/**
 * Main Index Module
 * Entry point that imports all modules and sets up initialization
 */

// ===== CONFIGURATION IMPORTS =====
import {
  kpiDefinitions,
  widgetDefinitions,
  appUrls,
  brandColors,
  API_URL,
  workSchedule,
  DEFAULT_DAILY_TARGET
} from './config.js';

// ===== MEMORY IMPORTS =====
import { clearHistory } from './memory.js';

// ===== VOICE IMPORTS =====
import {
  toggleVoice,
  isVoiceActive,
  startListening,
  stopSpeaking
} from './voice.js';

// ===== STATE IMPORTS =====
import {
  getState,
  getData,
  getCompareData,
  getCurrentView,
  getCurrentRange,
  getCompareMode,
  getDailyTarget,
  getChart,
  getGrid,
  getTimer,
  getInterval,
  isEditMode,
  isSidebarCollapsed,
  isDarkMode,
  isSkeletonsShowing,
  getFetchController,
  getFlags,
  setData,
  setCompareData,
  setCurrentView,
  setCurrentRange,
  setCustomDates,
  setCompareMode,
  setDailyTarget,
  setEditMode,
  setSidebarCollapsed,
  setDarkMode,
  setSkeletonsShowing,
  setChart,
  setGrid,
  setTimer,
  clearTimer,
  setInterval_,
  clearInterval_,
  clearAllIntervals,
  setFetchController,
  setFlag,
  destroyChart,
  destroyAllCharts,
  destroyGrid,
  destroyAllGrids,
  cleanup,
  isAppsScript,
  debugState,
  getFallback
} from './state.js';

// ===== EVENT CLEANUP IMPORTS =====
import {
  registerEventListener,
  cleanupAllListeners as cleanupEventListeners,
  debugListeners,
  getListenerStats
} from './event-cleanup.js';

// ===== UTILITY IMPORTS =====
import {
  safeGetEl,
  safeGet,
  safeNumber,
  safeGetChartContext,
  getProductiveMinutesElapsed,
  getProductiveHoursElapsed,
  getTotalProductiveHours,
  formatDateInput,
  formatDateShort,
  formatTime,
  formatFullDate,
  formatLongDate,
  debounce,
  throttle,
  animateValue,
  getTimeGreeting,
  deepClone,
  isEmpty,
  generateId
} from './utils.js';

// ===== THEME IMPORTS =====
import {
  updateChartTheme,
  updateThemeUI,
  toggleTheme,
  initTheme,
  toggleDarkMode,
  THEME_COLORS
} from './theme.js';

// ===== SETTINGS IMPORTS =====
import {
  loadSettings,
  saveSettings,
  applyWidgetVisibility,
  resetLayout
} from './settings.js';

// ===== NAVIGATION IMPORTS =====
import {
  switchView,
  toggleSidebar,
  toggleMobileSidebar,
  closeMobileSidebar,
  openAppNewTab,
  initSidebarState,
  initViewportTracking,
  initMobileSidebar,
  getViewName
} from './navigation.js';

// ===== PWA INSTALL IMPORTS =====
import { initInstallPrompt } from './install-prompt.js';

// ===== API IMPORTS =====
import {
  loadData,
  loadCompareData,
  loadCompareDataFetch,
  refreshData,
  onError,
  setRenderCallback,
  setShowSkeletonsCallback,
  setShowToastCallback
} from './api.js';

// ===== GRID IMPORTS =====
import {
  initMuuriGrid,
  initMuuriKPI,
  debouncedMuuriLayout,
  debouncedKPILayout,
  safeMuuriOperation,
  cycleWidgetSize,
  toggleWidgetCollapse,
  hideWidget,
  showWidget,
  saveLayout,
  loadLayout,
  saveKPIOrder,
  loadKPIOrder,
  initWidgetResizeHandles,
  WIDGET_SIZES,
  STORAGE_KEYS
} from './grid.js';

// ===== CHART IMPORTS =====
import {
  initCharts,
  renderCharts,
  renderTrimmersChart,
  getChartColors,
  destroyChartIfExists
} from './charts.js';

// ===== PANEL IMPORTS =====
import {
  toggleSettings,
  openSettings,
  closeSettings,
  toggleAIChat,
  sendAIMessage,
  setToggleCallbacks,
  submitAIFeedback
} from './panels.js';

// ===== WIDGET IMPORTS =====
import {
  renderKPICards,
  renderKPIToggles,
  renderWidgetToggles,
  toggleKPI,
  toggleWidget,
  toggleKPIExpand,
  updateKPIValues,
  getExpandedKPI,
  resetExpandedKPI
} from './widgets.js';

// ===== DATE IMPORTS =====
import {
  toggleDatePicker,
  toggleCompareDropdown,
  setDateRange,
  applyCustomRange,
  setCompare,
  clearCompare,
  updateClock,
  updateWelcome,
  getCompareDateRanges,
  setDataCallbacks
} from './date.js';

// ===== STATUS IMPORTS =====
import {
  initStatusBar
} from './status.js';


// ===== SKELETON LOADING UI =====
function showSkeletons(show) {
  setSkeletonsShowing(show);

  if (!show) {
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        hideSkeletonsNow();
      });
    });
  } else {
    const kpiCards = document.querySelectorAll('.kpi-card');
    const widgetItems = document.querySelectorAll('.widget-item');

    kpiCards.forEach(function(card) {
      card.classList.add('loading');
    });

    widgetItems.forEach(function(widget) {
      widget.classList.add('loading');
    });
  }
}

// Separate function to actually hide skeletons after DOM paint
function hideSkeletonsNow() {
  const kpiCards = document.querySelectorAll('.kpi-card');
  const widgetItems = document.querySelectorAll('.widget-item');

  kpiCards.forEach(function(card) {
    card.classList.remove('loading');
    card.classList.add('loaded');
  });

  widgetItems.forEach(function(widget) {
    widget.classList.remove('loading');
    widget.classList.add('loaded');
  });

  // Skeleton hide changes card dimensions — tell Muuri to re-layout
  setTimeout(function() {
    const widgetGrid = getGrid('widgets');
    const kpiGrid = getGrid('kpi');
    if (widgetGrid && !widgetGrid._isDestroyed) {
      widgetGrid.refreshItems().layout();
    }
    if (kpiGrid && !kpiGrid._isDestroyed) {
      kpiGrid.refreshItems().layout();
    }
  }, 100);
}

// ===== TOAST NOTIFICATION SYSTEM =====
function showToast(message, type, duration) {
  type = type || 'info';
  duration = duration || 3000;

  // Create toast container if it doesn't exist
  let toastContainer = document.getElementById('toastContainer');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toastContainer';
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }

  // Create toast element
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  toastContainer.appendChild(toast);

  // Animate in
  requestAnimationFrame(function() {
    toast.classList.add('show');
  });

  // Remove after duration
  setTimeout(function() {
    toast.classList.remove('show');
    setTimeout(function() {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, duration);
}

// Toast convenience methods
showToast.error = function(message, duration) {
  showToast(message, 'error', duration || 5000);
};
showToast.success = function(message, duration) {
  showToast(message, 'success', duration || 2000);
};
showToast.info = function(message, duration) {
  showToast(message, 'info', duration || 3000);
};

// ===== RENDER ALL COMPONENTS =====
function renderAll() {
  const data = getData();
  if (!data) return;

  // Add updating class for smooth transitions
  document.querySelectorAll('.kpi-value, .hero-production-number, .hero-mini-kpi-value, .current-stat-value, .integration-stat-value').forEach(function(el) {
    el.classList.add('updating');
  });

  // Hide loading overlay now that we have data
  hideLoadingOverlay();

  // Render charts
  renderCharts();
  renderTrimmersChart();

  // Update KPI values
  const compareMode = getCompareMode();
  const compareData = getCompareData();

  if (data.today) {
    updateKPIValues(
      data.today,
      compareMode && compareData ? compareData.today : null,
      data.targets || null,
      data.rollingAverage || null,
      !!compareMode
    );
  }

  // Update hero section
  renderHeroSection(data);

  // Remove updating class after render
  requestAnimationFrame(function() {
    document.querySelectorAll('.updating').forEach(function(el) {
      el.classList.remove('updating');
    });
  });

  // Update bag timer widget
  const bagsTodayEl = document.getElementById('bagsToday');
  const bagsAvgTimeEl = document.getElementById('bagsAvgTime');
  const bagsVsTargetEl = document.getElementById('bagsVsTarget');
  if (data.bagTimer) {
    if (bagsTodayEl) bagsTodayEl.textContent = data.bagTimer.bagsToday;
    if (bagsAvgTimeEl) bagsAvgTimeEl.textContent = data.bagTimer.avgTime;
    if (bagsVsTargetEl) {
      bagsVsTargetEl.textContent = data.bagTimer.vsTarget;
      // Color code: green if faster than target, red if slower
      const avgMin = data.bagTimer.avgMinutes || 0;
      const targetMin = data.rolling && data.rolling.avgCycleMinutes7Day ? data.rolling.avgCycleMinutes7Day : 0;
      if (avgMin > 0 && targetMin > 0) {
        bagsVsTargetEl.style.color = avgMin <= targetMin ? 'var(--ro-green)' : 'var(--danger)';
      }
    }
  } else {
    if (bagsTodayEl) bagsTodayEl.textContent = '—';
    if (bagsAvgTimeEl) bagsAvgTimeEl.textContent = '—';
    if (bagsVsTargetEl) bagsVsTargetEl.textContent = '—';
  }

  // Update Last Hour widget from dashboard data (not separate scoreboard call)
  updateLastHourWidget(data);

  // Refresh grid layouts
  const widgetGrid = getGrid('widgets');
  const kpiGrid = getGrid('kpi');

  if (widgetGrid && !widgetGrid._isDestroyed) {
    debouncedMuuriLayout(widgetGrid, 100);
  }
  if (kpiGrid && !kpiGrid._isDestroyed) {
    debouncedKPILayout(100);
  }
}

// ===== LAST HOUR WIDGET =====
function updateLastHourWidget(data) {
  const currentStrainEl = document.getElementById('currentStrain');
  const currentTimeEl = document.getElementById('currentTime');
  const statusBadgeEl = document.getElementById('statusBadge');
  const currentTopsEl = document.getElementById('currentTops');
  const currentSmallsEl = document.getElementById('currentSmalls');
  const currentTrimmersEl = document.getElementById('currentTrimmers');
  const currentBuckersEl = document.getElementById('currentBuckers');
  const currentRateEl = document.getElementById('currentRate');
  const currentTotalEl = document.getElementById('currentTotal');

  if (!data || !data.hourly || data.hourly.length === 0) {
    // No hourly data - reset to defaults
    if (currentStrainEl) currentStrainEl.textContent = 'No Data';
    if (currentTimeEl) currentTimeEl.textContent = '—';
    if (currentTopsEl) currentTopsEl.textContent = '0';
    if (currentSmallsEl) currentSmallsEl.textContent = '0';
    if (currentTrimmersEl) currentTrimmersEl.textContent = '0';
    if (currentBuckersEl) currentBuckersEl.textContent = '0';
    if (currentRateEl) currentRateEl.textContent = '0.00';
    if (currentTotalEl) currentTotalEl.textContent = '0';
    return;
  }

  // Get the last hour with data (most recent hour)
  const hourlyData = data.hourly;
  let lastHour = null;

  // Find the last hour with production data
  for (let i = hourlyData.length - 1; i >= 0; i--) {
    if (hourlyData[i].lbs && hourlyData[i].lbs > 0) {
      lastHour = hourlyData[i];
      break;
    }
  }

  if (lastHour) {
    const lbs = lastHour.lbs || 0;
    const trimmers = lastHour.trimmers || 0;
    const timeSlot = lastHour.label || '—';
    const strain = (data.current && data.current.strain) || 'No Data';
    const rate = lastHour.rate || 0;

    if (currentStrainEl) currentStrainEl.textContent = strain;
    if (currentTimeEl) currentTimeEl.textContent = timeSlot;
    if (statusBadgeEl) statusBadgeEl.textContent = 'Last Hour';
    if (currentTopsEl) currentTopsEl.textContent = lbs.toFixed(1);
    if (currentSmallsEl) currentSmallsEl.textContent = (lastHour.smalls || 0).toFixed(1);
    if (currentTrimmersEl) currentTrimmersEl.textContent = trimmers;
    if (currentBuckersEl) currentBuckersEl.textContent = lastHour.buckers || 0;
    if (currentRateEl) currentRateEl.textContent = rate.toFixed(2);
    const smallsLbs = lastHour.smalls || 0;
    if (currentTotalEl) currentTotalEl.textContent = (lbs + smallsLbs).toFixed(1);
  } else {
    // No data - reset to defaults
    if (currentStrainEl) currentStrainEl.textContent = 'No Data';
    if (currentTimeEl) currentTimeEl.textContent = '—';
    if (currentTopsEl) currentTopsEl.textContent = '0';
    if (currentSmallsEl) currentSmallsEl.textContent = '0';
    if (currentTrimmersEl) currentTrimmersEl.textContent = '0';
    if (currentBuckersEl) currentBuckersEl.textContent = '0';
    if (currentRateEl) currentRateEl.textContent = '0.00';
    if (currentTotalEl) currentTotalEl.textContent = '0';
  }
}

// ===== HERO SECTION RENDERING =====
function renderHeroSection(data) {
  const t = data.totals || data.today || {};

  // Empty state: no production data
  const heroSection = document.getElementById('heroSection');
  const hasProduction = (t.totalTops || 0) > 0 || (t.totalLbs || 0) > 0;

  // Remove existing empty state if present
  const existingEmpty = heroSection ? heroSection.querySelector('.empty-state-production') : null;
  if (existingEmpty) existingEmpty.remove();

  if (!hasProduction && heroSection) {
    // Check if we should show empty state (no data at all, not just zeros from start of day)
    const hourly = data.hourly || [];
    const noHourlyData = hourly.length === 0 || hourly.every(function(h) { return !h.lbs || h.lbs === 0; });

    if (noHourlyData) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-state-production';
      emptyDiv.innerHTML = '<div class="empty-state-title">No production data today</div><div class="empty-state-sub">The line is quiet. Showing last working day data.</div>';
      const botanicalFrame = heroSection.querySelector('.hero-botanical-frame');
      if (botanicalFrame) botanicalFrame.appendChild(emptyDiv);
    }
  }

  // Production number (the star) - TOPS production
  const tops = t.totalTops || 0;
  const smalls = t.totalSmalls || 0;
  const totalProduction = t.totalLbs || 0;

  const elHeroProduction = document.getElementById('heroProductionNumber');
  if (elHeroProduction) {
    animateValue('heroProductionNumber', parseFloat(elHeroProduction.textContent) || 0, tops, 800);
  }

  // Current strain
  const strain = (data.current && data.current.strain) || '';
  const elHeroStrain = document.getElementById('heroStrain');
  if (elHeroStrain) elHeroStrain.textContent = strain;

  // Subtitle with totals
  const elHeroSubtitle = document.getElementById('heroSubtitle');
  if (elHeroSubtitle) {
    elHeroSubtitle.textContent = `Total: ${totalProduction.toFixed(1)} lbs (incl. ${smalls.toFixed(1)} lbs smalls)`;
  }

  // Time-aware production calculation
  const trimmers = t.trimmers || 0;
  const todayRate = t.avgRate || 0;
  const isHistorical = data.isHistorical || false;
  const fallback = getFallback();
  const dailyTarget = (data.targets && data.targets.totalTops) || getDailyTarget();

  let predictedTops = 0;
  if (isHistorical || (fallback && fallback.active)) {
    // Historical/fallback: day is complete, actual total IS the final number
    predictedTops = tops;
  } else {
    // Live: project end-of-day using backend or local calculation
    const productiveHoursElapsed = getProductiveHoursElapsed();
    const totalProductiveHours = (data.current && data.current.effectiveHours) || getTotalProductiveHours();
    const remainingHours = Math.max(0, totalProductiveHours - productiveHoursElapsed);
    const backendProjection = data.current && data.current.projectedTotal;
    const localProjection = tops + (trimmers * todayRate * remainingHours);
    predictedTops = backendProjection > 0 ? backendProjection : localProjection;
  }

  // Progress bar
  let progressPercent = 0;
  let progressStatus = '';

  if (isHistorical || (fallback && fallback.active)) {
    // Historical or fallback: measure against daily target (day is complete)
    if (dailyTarget > 0) {
      progressPercent = (tops / dailyTarget * 100);
    }
  } else {
    // Live: measure against expected production so far
    const expectedSoFar = (data.current && data.current.todayTarget) || dailyTarget || 0;
    if (expectedSoFar > 0) {
      progressPercent = (tops / expectedSoFar * 100);
    }
  }

  if (progressPercent >= 100) {
    progressStatus = 'ahead';
  } else if (progressPercent >= 90) {
    progressStatus = 'on-track';
  } else if (progressPercent > 0) {
    progressStatus = 'behind';
  }

  const elHeroProgressFill = document.getElementById('heroProgressFill');
  const elHeroProgressText = document.getElementById('heroProgressText');
  if (elHeroProgressFill) {
    elHeroProgressFill.style.width = `${Math.min(progressPercent, 100)}%`;
    elHeroProgressFill.className = `hero-progress-fill ${progressStatus}`;
  }
  if (elHeroProgressText) {
    if (isHistorical || (fallback && fallback.active)) {
      if (dailyTarget > 0) {
        elHeroProgressText.textContent = `${progressPercent.toFixed(0)}% of daily target (${dailyTarget.toFixed(0)} lbs)`;
      } else {
        elHeroProgressText.textContent = `Final: ${tops.toFixed(1)} lbs`;
      }
    } else if (progressPercent > 0) {
      const expectedSoFar = (data.current && data.current.todayTarget) || dailyTarget || 0;
      elHeroProgressText.textContent = `${progressPercent.toFixed(0)}% of expected (${expectedSoFar.toFixed(0)} lbs)`;
    } else {
      elHeroProgressText.textContent = 'Shift not started';
    }
  }

  // Mini KPIs
  const crew = (t.trimmers || 0) + (t.buckers || 0) + (t.qc || 0) + (t.tzero || 0);
  const elHeroCrewValue = document.getElementById('heroCrewValue');
  if (elHeroCrewValue) elHeroCrewValue.textContent = crew;

  const elHeroRateValue = document.getElementById('heroRateValue');
  if (elHeroRateValue) elHeroRateValue.textContent = todayRate.toFixed(2);

  const elHeroTargetValue = document.getElementById('heroTargetValue');
  const elTargetLabel = document.getElementById('targetLabel');
  if (elHeroTargetValue) {
    if (isHistorical) {
      // Historical: show actual final total, not a prediction
      elHeroTargetValue.textContent = tops > 0 ? `${tops.toFixed(0)} lbs` : '--';
      if (elTargetLabel) elTargetLabel.textContent = 'Final Tops';
    } else {
      elHeroTargetValue.textContent = predictedTops > 0 ? `${predictedTops.toFixed(0)} lbs` : '--';
      if (elTargetLabel) elTargetLabel.textContent = 'Predicted Tops';
    }
  }

  // Bags done
  const elHeroBagsValue = document.getElementById('heroBagsValue');
  const elHeroAvgCycleTime = document.getElementById('heroAvgCycleTime');
  if (elHeroBagsValue) {
    elHeroBagsValue.textContent = (data.bagTimer && data.bagTimer.bagsToday) || '--';
  }
  if (elHeroAvgCycleTime) {
    elHeroAvgCycleTime.textContent = (data.bagTimer && data.bagTimer.avgTime) ? `Avg: ${data.bagTimer.avgTime}` : 'Avg: --';
  }
}

// ===== TARGET INPUT INITIALIZATION =====
function initTargetInput() {
  const input = document.getElementById('targetInput');
  if (!input) return;

  input.value = getDailyTarget();

  input.addEventListener('change', function() {
    const newTarget = parseInt(this.value, 10) || DEFAULT_DAILY_TARGET;
    setDailyTarget(newTarget);
    saveSettings();

    // Re-render charts if data exists
    const data = getData();
    if (data) {
      renderCharts();
    }
  });
}

// ===== AUTO-REFRESH INTERVAL =====
function setupAutoRefresh() {
  // Clear existing interval if any (handled by setInterval_)
  // Set up auto-refresh every 30 seconds for today view
  const intervalId = setInterval(function() {
    const range = getCurrentRange();
    const compareMode = getCompareMode();
    const view = getCurrentView();

    if (range === 'today' && !compareMode && view === 'dashboard') {
      loadData();
    }
  }, 30000);

  // Register with state for proper cleanup
  setInterval_('autoRefresh', intervalId);
}

// ===== COMMAND PALETTE =====
const commandPaletteItems = [
  { label: 'Dashboard', action: () => switchView('dashboard'), icon: 'grid', shortcut: '' },
  { label: 'Supply Kanban', action: () => switchView('kanban'), icon: 'columns', shortcut: '' },
  { label: 'Scoreboard', action: () => switchView('scoreboard'), icon: 'chart', shortcut: '' },
  { label: 'Command Center', action: () => { window.location.href = 'command-center.html'; }, icon: 'terminal', shortcut: '' },
  { label: 'Command Center v2', action: () => { window.location.href = 'command-center-v2.html'; }, icon: 'terminal', shortcut: '' },
  { label: 'Barcode Printer', action: () => switchView('barcode'), icon: 'barcode', shortcut: '' },
  { label: 'SOP Manager', action: () => switchView('sop'), icon: 'clipboard', shortcut: '' },
  { label: 'Orders', action: () => switchView('orders'), icon: 'bag', shortcut: '' },
  { label: 'Consignment', action: () => { window.location.href = 'consignment.html'; }, icon: 'exchange', shortcut: '' },
  { label: 'Pool Inventory', action: () => { window.location.href = 'pool.html'; }, icon: 'layers', shortcut: '' },
  { label: 'Floor Manager', action: () => { window.location.href = 'hourly-entry.html'; }, icon: 'floor', shortcut: '' },
  { label: 'Scale Display', action: () => { window.location.href = 'scale-display.html'; }, icon: 'scale', shortcut: '' },
  { label: 'Refresh Data', action: () => { closeCommandPalette(); refreshData(); }, icon: 'refresh', shortcut: 'Ctrl+R' },
  { label: 'Toggle Theme', action: () => { closeCommandPalette(); toggleTheme(); }, icon: 'theme', shortcut: '' },
  { label: 'Open Settings', action: () => { closeCommandPalette(); openSettings(); }, icon: 'settings', shortcut: 'Ctrl+K' },
  { label: 'AI Assistant', action: () => { closeCommandPalette(); toggleAIChat(); }, icon: 'chat', shortcut: 'Ctrl+/' },
];

let commandPaletteActiveIndex = 0;

function openCommandPalette() {
  const overlay = document.getElementById('commandPalette');
  const input = document.getElementById('commandPaletteInput');
  if (!overlay) return;
  overlay.classList.add('open');
  if (input) {
    input.value = '';
    input.focus();
  }
  commandPaletteActiveIndex = 0;
  renderCommandPaletteResults('');
}

function closeCommandPalette() {
  const overlay = document.getElementById('commandPalette');
  if (overlay) overlay.classList.remove('open');
}

function renderCommandPaletteResults(query) {
  const container = document.getElementById('commandPaletteResults');
  if (!container) return;

  const filtered = query
    ? commandPaletteItems.filter(item => item.label.toLowerCase().includes(query.toLowerCase()))
    : commandPaletteItems;

  if (commandPaletteActiveIndex >= filtered.length) {
    commandPaletteActiveIndex = Math.max(0, filtered.length - 1);
  }

  container.innerHTML = filtered.map((item, i) => `
    <div class="command-palette-item${i === commandPaletteActiveIndex ? ' active' : ''}"
         role="option" data-index="${i}"
         onmouseenter="setCommandPaletteActive(${i})"
         onclick="executeCommandPaletteItem(${i})">
      <span class="cp-icon" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          ${getCommandPaletteIcon(item.icon)}
        </svg>
      </span>
      <span class="cp-label">${item.label}</span>
      ${item.shortcut ? `<span class="cp-shortcut">${item.shortcut}</span>` : ''}
    </div>
  `).join('');
}

function getCommandPaletteIcon(type) {
  const icons = {
    grid: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/>',
    columns: '<rect x="2" y="3" width="4.5" height="14" rx="1"/><rect x="7.75" y="3" width="4.5" height="14" rx="1"/><rect x="13.5" y="3" width="4.5" height="14" rx="1"/>',
    chart: '<path d="M4 16V10"/><path d="M8 16V7"/><path d="M12 16V4"/><path d="M16 16V9"/>',
    terminal: '<path d="M4 5h12"/><path d="M5 8l2 2-2 2"/><path d="M10 12h4"/><rect x="2" y="2" width="16" height="13" rx="2"/>',
    barcode: '<path d="M3 4v12"/><path d="M6 4v12"/><path d="M9 4v12"/><path d="M11 4v12"/><path d="M14 4v12"/><path d="M17 4v12"/>',
    clipboard: '<rect x="4" y="3" width="12" height="15" rx="2"/><path d="M7 2.5h6"/><path d="M7 9l2 2 4-4"/>',
    bag: '<path d="M4 6h12l-1 12H5z"/><path d="M7 6V4a3 3 0 0 1 6 0v2"/>',
    exchange: '<path d="M2 10h4l3-3 2 2 3-3h4"/><path d="M7 13l2 2 4-4"/>',
    layers: '<path d="M3 7l7-4 7 4v6l-7 4-7-4z"/><path d="M3 7l7 4 7-4"/><path d="M10 11v7"/>',
    floor: '<rect x="3" y="3" width="14" height="14" rx="1"/><path d="M3 8h14"/><path d="M8 8v9"/>',
    scale: '<path d="M10 3v14"/><path d="M4 6h12"/><path d="M3 11l1-5h4l1 5"/><path d="M11 11l1-5h4l1 5"/>',
    refresh: '<path d="M3 10a7 7 0 1 0 7-7 7.75 7.75 0 0 0-5.3 2.2L3 7"/><path d="M3 3v4h4"/>',
    theme: '<path d="M13.5 8.5a5.5 5.5 0 1 1-5-7 4.5 4.5 0 0 0 5 7z"/>',
    settings: '<circle cx="10" cy="10" r="3"/><path d="M10 2v2m0 12v2M2 10h2m12 0h2M4.2 4.2l1.4 1.4m8.8 8.8l1.4 1.4M15.8 4.2l-1.4 1.4M4.2 15.8l1.4-1.4"/>',
    chat: '<path d="M18 10.5a6.5 6.5 0 0 1-1 3.5l1 3.5-3.5-1a6.5 6.5 0 1 1 3.5-6z"/>',
  };
  return icons[type] || '';
}

function setCommandPaletteActive(index) {
  commandPaletteActiveIndex = index;
  const items = document.querySelectorAll('.command-palette-item');
  items.forEach((el, i) => {
    el.classList.toggle('active', i === index);
  });
}

function executeCommandPaletteItem(index) {
  const input = document.getElementById('commandPaletteInput');
  const query = input ? input.value : '';
  const filtered = query
    ? commandPaletteItems.filter(item => item.label.toLowerCase().includes(query.toLowerCase()))
    : commandPaletteItems;

  if (filtered[index]) {
    closeCommandPalette();
    filtered[index].action();
  }
}

function setupCommandPalette() {
  const input = document.getElementById('commandPaletteInput');
  if (!input) return;

  registerEventListener(input, 'input', function() {
    commandPaletteActiveIndex = 0;
    renderCommandPaletteResults(this.value);
  });

  registerEventListener(input, 'keydown', function(e) {
    const items = document.querySelectorAll('.command-palette-item');
    const count = items.length;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      commandPaletteActiveIndex = (commandPaletteActiveIndex + 1) % count;
      setCommandPaletteActive(commandPaletteActiveIndex);
      // Scroll active item into view
      if (items[commandPaletteActiveIndex]) {
        items[commandPaletteActiveIndex].scrollIntoView({ block: 'nearest' });
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      commandPaletteActiveIndex = (commandPaletteActiveIndex - 1 + count) % count;
      setCommandPaletteActive(commandPaletteActiveIndex);
      if (items[commandPaletteActiveIndex]) {
        items[commandPaletteActiveIndex].scrollIntoView({ block: 'nearest' });
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      executeCommandPaletteItem(commandPaletteActiveIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeCommandPalette();
    }
  });
}

// ===== FOCUS TRAP FOR SETTINGS PANEL =====
function setupSettingsFocusTrap() {
  const settingsPanel = document.getElementById('settingsPanel');
  if (!settingsPanel) return;

  registerEventListener(settingsPanel, 'keydown', function(e) {
    if (e.key !== 'Tab') return;
    if (!settingsPanel.classList.contains('open')) return;

    const focusableSelectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusableElements = settingsPanel.querySelectorAll(focusableSelectors);
    if (focusableElements.length === 0) return;

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];

    if (e.shiftKey) {
      // Shift+Tab: if focus is on first element, wrap to last
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      // Tab: if focus is on last element, wrap to first
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
}

// ===== KEYBOARD SHORTCUTS =====
function setupKeyboardShortcuts() {
  const keydownHandler = function(e) {
    // Don't trigger shortcuts when typing in inputs (except command palette)
    const isCommandPaletteInput = e.target.id === 'commandPaletteInput';
    if ((e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') && !isCommandPaletteInput) return;

    // '/' key opens command palette (only when not in an input)
    if (e.key === '/' && !isCommandPaletteInput && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      openCommandPalette();
      return;
    }

    // Ctrl/Cmd + R: Refresh data
    if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
      e.preventDefault();
      refreshData();
      return;
    }

    // Ctrl/Cmd + /: Toggle AI chat
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      toggleAIChat();
      return;
    }

    // Escape: Close overlays in priority order
    if (e.key === 'Escape') {
      const commandPalette = document.getElementById('commandPalette');
      const settingsPanel = document.getElementById('settingsPanel');
      const aiChatPanel = document.getElementById('aiChatPanel');

      if (commandPalette && commandPalette.classList.contains('open')) {
        closeCommandPalette();
      } else if (settingsPanel && settingsPanel.classList.contains('open')) {
        closeSettings();
        // Return focus to the settings trigger button
        const settingsBtn = document.querySelector('.header-btn[onclick*="openSettings"]');
        if (settingsBtn) settingsBtn.focus();
      } else if (aiChatPanel && aiChatPanel.classList.contains('open')) {
        toggleAIChat();
      }
      return;
    }

    // Ctrl/Cmd + K: Open settings
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      toggleSettings();
    }
  };

  // Register for cleanup
  registerEventListener(document, 'keydown', keydownHandler);
}

// ===== RESIZE HANDLER =====
function setupResizeHandler() {
  const resizeHandler = function() {
    // Use state timer for resize debouncing
    clearTimer('resize');
    const timerId = setTimeout(function() {
      // Only use Muuri on desktop (>= 600px)
      if (window.innerWidth >= 600) {
        const kpiGrid = getGrid('kpi');
        const widgetGrid = getGrid('widgets');

        // Use debounced layout for both grids to prevent thrashing
        if (kpiGrid) debouncedMuuriLayout(kpiGrid, 150);
        if (widgetGrid) debouncedMuuriLayout(widgetGrid, 150);
      } else {
        // Destroy Muuri on mobile to prevent positioning conflicts with CSS grid
        const kpiGrid = getGrid('kpi');
        const widgetGrid = getGrid('widgets');

        if (kpiGrid && !kpiGrid._isDestroyed) {
          try {
            kpiGrid.destroy();
            setGrid('kpi', null);
            // Remove muuri class so CSS grid takes over
            const kpiRow = document.querySelector('.kpi-row');
            if (kpiRow) kpiRow.classList.remove('muuri');
            console.debug('KPI Muuri destroyed for mobile view');
          } catch (e) {
            console.warn('Error destroying KPI Muuri:', e);
            setGrid('kpi', null);
            const kpiRow = document.querySelector('.kpi-row');
            if (kpiRow) kpiRow.classList.remove('muuri');
          }
        }

        if (widgetGrid && !widgetGrid._isDestroyed) {
          try {
            widgetGrid.destroy();
            setGrid('widgets', null);
            document.body.classList.remove('muuri-active');
            console.debug('Widget Muuri destroyed for mobile view');
          } catch (e) {
            console.warn('Error destroying widget Muuri:', e);
            setGrid('widgets', null);
            document.body.classList.remove('muuri-active');
          }
        }
      }
    }, 100);
    setTimer('resize', timerId);
  };

  // Register for cleanup
  registerEventListener(window, 'resize', resizeHandler);
}

// ===== DATE CHIP CLICK HANDLERS =====
function setupDateChipHandlers() {
  document.querySelectorAll('.date-chip').forEach(function(chip) {
    const clickHandler = function() {
      setDateRange(this.dataset.range);
    };
    // Register for cleanup
    registerEventListener(chip, 'click', clickHandler);
  });
}

// ===== DOCUMENT CLICK HANDLER FOR DROPDOWNS =====
function setupDocumentClickHandler() {
  const documentClickHandler = function(e) {
    const datePickerDropdown = document.getElementById('datePickerDropdown');
    const compareDropdown = document.getElementById('compareDropdown');

    if (!e.target.closest('.date-picker-wrapper') && datePickerDropdown) {
      datePickerDropdown.classList.remove('open');
    }

    if (!e.target.closest('.compare-selector') && compareDropdown) {
      compareDropdown.classList.remove('open');
    }
  };

  // Register for cleanup
  registerEventListener(document, 'click', documentClickHandler);
}

// ===== MAIN INITIALIZATION =====
async function init() {
  console.debug('Initializing Rogue Origin Dashboard...');

  // 1. Set up cleanup for page unload (registered for tracking)
  const beforeUnloadHandler = () => {
    cleanup();
    cleanupEventListeners(); // Clean up ALL registered listeners
  };
  registerEventListener(window, 'beforeunload', beforeUnloadHandler);

  // 2. Wire up cross-module callbacks
  setRenderCallback(renderAll);
  setShowSkeletonsCallback(showSkeletons);
  setShowToastCallback(showToast);
  setToggleCallbacks(renderWidgetToggles, renderKPIToggles);
  setDataCallbacks(loadData, loadCompareData);

  // 3. Load settings from localStorage
  loadSettings();

  // 4. Initialize theme system
  initTheme();

  // 5. Initialize sidebar state
  initSidebarState();

  // 5.1. Initialize mobile sidebar (backdrop + escape key)
  initMobileSidebar();

  // 5.5. Initialize viewport height tracking (iOS Safari fix)
  initViewportTracking();

  // 5.6. Initialize PWA install prompt
  initInstallPrompt();

  // 6. Initialize status bar
  initStatusBar(refreshData);

  // 7. Initialize target input
  initTargetInput();

  // 8. Render KPI cards
  renderKPICards();

  // 8. Render KPI toggles in settings
  renderKPIToggles();

  // 9. Render widget toggles in settings
  renderWidgetToggles();

  // 10. Initialize charts (lazy loads Chart.js when needed)
  await initCharts();

  // 11. Initialize Muuri grids (desktop only, lazy loads Muuri.js when needed)
  // Delay initialization to ensure DOM layout is complete and charts are rendered
  if (window.innerWidth >= 600) {
    setTimeout(async function() {
      console.debug('Initializing Muuri grids...');
      const kpiGrid = await initMuuriKPI();
      const widgetGrid = await initMuuriGrid();
      console.debug('Muuri initialization complete:', {
        kpiGrid: !!kpiGrid,
        widgetGrid: !!widgetGrid
      });
    }, 200);
  }

  // 12. Update clock and set interval (registered for cleanup)
  updateClock();
  const clockIntervalId = setInterval(updateClock, 1000);
  setInterval_('clock', clockIntervalId);

  // 13. Update welcome message
  updateWelcome();

  // 14. Set up date inputs with today's date
  const today = new Date();
  const endDateEl = document.getElementById('endDate');
  const startDateEl = document.getElementById('startDate');
  if (endDateEl) endDateEl.value = formatDateInput(today);
  if (startDateEl) startDateEl.value = formatDateInput(today);

  // 15. Set up click handlers for date chips
  setupDateChipHandlers();

  // 16. Set up document click to close dropdowns
  setupDocumentClickHandler();

  // 17. Load initial data
  loadData();

  // 18. Set up auto-refresh interval (30s for today view)
  setupAutoRefresh();

  // 18.5. Set up command palette
  setupCommandPalette();

  // 19. Set up keyboard shortcuts
  setupKeyboardShortcuts();

  // 19.5. Set up settings panel focus trap
  setupSettingsFocusTrap();

  // 20. Set up resize handler
  setupResizeHandler();

  // 21. Initialize widget resize handles
  initWidgetResizeHandles();


  // Note: Loading overlay is hidden by renderAll() when data arrives
  // or by the 8-second fallback timeout

  // Safety timeout: Force-hide skeletons after 10 seconds if they get stuck
  setTimeout(function() {
    if (isSkeletonsShowing()) {
      console.warn('Force-hiding stuck skeletons after timeout');
      hideSkeletonsNow();
      setSkeletonsShowing(false);
    }
  }, 10000);

  console.debug('Dashboard initialization complete');
}

/**
 * Hide the loading overlay with animation
 */
function hideLoadingOverlay() {
  const loadingOverlay = document.getElementById('loadingOverlay');
  if (loadingOverlay && !loadingOverlay.classList.contains('hidden')) {
    loadingOverlay.style.opacity = '0';
    loadingOverlay.style.visibility = 'hidden';
    loadingOverlay.classList.add('hidden');
    // Remove from DOM after transition
    setTimeout(function() {
      loadingOverlay.style.display = 'none';
    }, 300);
  }
}

// ===== SAFETY LAYOUT REFRESH ON FULL PAGE LOAD =====
window.addEventListener('load', function() {
  // Refresh Muuri layout at multiple intervals to catch late-settling DOM changes
  [200, 500, 1000, 2000].forEach(function(delay) {
    setTimeout(function() {
      var widgetGrid = getGrid('widgets');
      var kpiGrid = getGrid('kpi');
      if (widgetGrid && !widgetGrid._isDestroyed) {
        widgetGrid.refreshItems().layout();
      }
      if (kpiGrid && !kpiGrid._isDestroyed) {
        kpiGrid.refreshItems().layout();
      }
    }, delay);
  });
});

// ===== DOM CONTENT LOADED LISTENER =====
document.addEventListener('DOMContentLoaded', function() {
  try {
    init();
  } catch (e) {
    console.error('Dashboard initialization error:', e);
    // Still hide loading overlay on error
    hideLoadingOverlay();
  }
});

// ===== FALLBACK: Hide loading overlay after 8 seconds no matter what =====
// This handles cases where JS errors or caching issues prevent normal init
setTimeout(function() {
  hideLoadingOverlay();
}, 8000);

// Note: beforeunload listener is registered inside init() for proper tracking

// ===== GLOBAL EXPORTS FOR HTML ONCLICK HANDLERS =====
// Attach functions to window object for inline event handlers
window.toggleTheme = toggleTheme;
window.toggleDarkMode = toggleDarkMode;
window.toggleSidebar = toggleSidebar;
window.toggleMobileSidebar = toggleMobileSidebar;
window.toggleSettings = toggleSettings;
window.toggleAIChat = toggleAIChat;
window.switchView = switchView;
window.setDateRange = setDateRange;
window.refreshData = refreshData;
window.loadData = loadData;
window.toggleWidget = toggleWidget;
window.toggleKPI = toggleKPI;
window.resetLayout = resetLayout;
window.saveSettings = saveSettings;
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.sendAIMessage = sendAIMessage;
window.submitAIFeedback = submitAIFeedback;
window.clearAIHistory = clearHistory;
window.toggleVoice = toggleVoice;
window.isVoiceActive = isVoiceActive;
window.toggleDatePicker = toggleDatePicker;
window.toggleCompareDropdown = toggleCompareDropdown;
window.applyCustomRange = applyCustomRange;
window.setCompare = setCompare;
window.clearCompare = clearCompare;
window.cycleWidgetSize = cycleWidgetSize;
window.toggleWidgetCollapse = toggleWidgetCollapse;
window.hideWidget = hideWidget;
window.showWidget = showWidget;
window.openAppNewTab = openAppNewTab;
window.openCommandPalette = openCommandPalette;
window.closeCommandPalette = closeCommandPalette;
window.setCommandPaletteActive = setCommandPaletteActive;
window.executeCommandPaletteItem = executeCommandPaletteItem;


// ===== STUB FUNCTIONS FOR UNIMPLEMENTED FEATURES =====
// These are placeholders for features that need to be migrated/implemented
window.explicitSaveLayout = function() {
  saveLayout();
  showToast('Layout saved', 'success', 2000);
};

window.startTutorial = function() {
  console.debug('Tutorial not yet implemented in modular version');
  showToast('Tutorial coming soon', 'info', 2000);
};

window.startTutorialFromWelcome = function() {
  const modal = document.getElementById('welcomeModal');
  if (modal) modal.style.display = 'none';
  window.startTutorial();
};

window.dismissWelcome = function() {
  const modal = document.getElementById('welcomeModal');
  if (modal) modal.style.display = 'none';
  try {
    localStorage.setItem('rogueOrigin_welcomeDismissed', '1');
  } catch {
    // Ignore localStorage errors (private browsing, quota exceeded, etc.)
  }
};

window.showWidgetHelp = function(widgetId) {
  console.debug('Widget help not yet implemented:', widgetId);
  showToast('Help coming soon', 'info', 2000);
};

// AI Voice features
window.aiToggleVoiceMode = function() {
  const btn = document.getElementById('aiVoiceModeToggle');
  const enabled = toggleVoice();  // From voice.js

  if (btn) {
    if (enabled) {
      btn.classList.add('active');
      showToast('Voice mode enabled', 'success', 2000);
    } else {
      btn.classList.remove('active');
      stopSpeaking();  // Stop any current speech
      showToast('Voice mode disabled', 'info', 2000);
    }
  }
};

window.aiToggleVoice = async function() {
  const btn = document.getElementById('aiVoiceBtn');
  const statusDiv = document.getElementById('aiVoiceStatus');
  const input = document.getElementById('aiInput');

  try {
    // Show listening indicator
    if (btn) btn.classList.add('listening');
    if (statusDiv) {
      statusDiv.textContent = '🎤 Listening...';
      statusDiv.style.display = 'flex';
    }

    // Start listening
    const transcript = await startListening();  // From voice.js

    if (transcript) {
      if (input) input.value = transcript;
      sendAIMessage();  // Auto-send
    }

  } catch (error) {
    console.error('Voice input error:', error);
    showToast(error.message || 'Voice input failed', 'error', 3000);

  } finally {
    // Hide listening indicator
    if (btn) btn.classList.remove('listening');
    if (statusDiv) statusDiv.style.display = 'none';
  }
};

window.aiSendMessage = sendAIMessage;

window.aiAskQuestion = function(question) {
  const input = document.getElementById('aiInput');
  if (input) {
    input.value = question;
    sendAIMessage();
  }
};

// ===== MODULE EXPORTS =====
// Export everything for programmatic access

// Configuration
export {
  kpiDefinitions,
  widgetDefinitions,
  appUrls,
  brandColors,
  API_URL,
  workSchedule,
  DEFAULT_DAILY_TARGET
};

// State management
export {
  getState,
  getData,
  getCompareData,
  getCurrentView,
  getCurrentRange,
  getCompareMode,
  getDailyTarget,
  getChart,
  getGrid,
  getTimer,
  getInterval,
  isEditMode,
  isSidebarCollapsed,
  isDarkMode,
  isSkeletonsShowing,
  getFetchController,
  getFlags,
  setData,
  setCompareData,
  setCurrentView,
  setCurrentRange,
  setCustomDates,
  setCompareMode,
  setDailyTarget,
  setEditMode,
  setSidebarCollapsed,
  setDarkMode,
  setSkeletonsShowing,
  setChart,
  setGrid,
  setTimer,
  clearTimer,
  setInterval_,
  clearInterval_,
  clearAllIntervals,
  setFetchController,
  setFlag,
  destroyChart,
  destroyAllCharts,
  destroyGrid,
  destroyAllGrids,
  cleanup,
  isAppsScript,
  debugState
};

// Utilities
export {
  safeGetEl,
  safeGet,
  safeNumber,
  safeGetChartContext,
  getProductiveMinutesElapsed,
  getProductiveHoursElapsed,
  getTotalProductiveHours,
  formatDateInput,
  formatDateShort,
  formatTime,
  formatFullDate,
  formatLongDate,
  debounce,
  throttle,
  animateValue,
  getTimeGreeting,
  deepClone,
  isEmpty,
  generateId
};

// Theme
export {
  updateChartTheme,
  updateThemeUI,
  toggleTheme,
  initTheme,
  toggleDarkMode,
  THEME_COLORS
};

// Settings
export {
  loadSettings,
  saveSettings,
  applyWidgetVisibility,
  resetLayout
};

// Navigation
export {
  switchView,
  toggleSidebar,
  toggleMobileSidebar,
  closeMobileSidebar,
  openAppNewTab,
  initSidebarState,
  initMobileSidebar,
  getViewName
};

// API
export {
  loadData,
  loadCompareData,
  loadCompareDataFetch,
  refreshData,
  onError
};

// Grids
export {
  initMuuriGrid,
  initMuuriKPI,
  debouncedMuuriLayout,
  debouncedKPILayout,
  safeMuuriOperation,
  cycleWidgetSize,
  toggleWidgetCollapse,
  hideWidget,
  showWidget,
  saveLayout,
  loadLayout,
  saveKPIOrder,
  loadKPIOrder,
  initWidgetResizeHandles,
  WIDGET_SIZES,
  STORAGE_KEYS
};

// Charts
export {
  initCharts,
  renderCharts,
  renderTrimmersChart,
  getChartColors,
  destroyChartIfExists
};

// Panels
export {
  toggleSettings,
  openSettings,
  closeSettings,
  toggleAIChat,
  sendAIMessage
};

// Widgets
export {
  renderKPICards,
  renderKPIToggles,
  renderWidgetToggles,
  toggleKPI,
  toggleWidget,
  toggleKPIExpand,
  updateKPIValues,
  getExpandedKPI,
  resetExpandedKPI
};

// Date
export {
  toggleDatePicker,
  toggleCompareDropdown,
  setDateRange,
  applyCustomRange,
  setCompare,
  clearCompare,
  updateClock,
  updateWelcome,
  getCompareDateRanges
};

// Local functions
export {
  init,
  initTargetInput,
  setupAutoRefresh,
  setupKeyboardShortcuts,
  setupResizeHandler,
  setupDateChipHandlers,
  setupDocumentClickHandler,
  showSkeletons,
  hideSkeletonsNow,
  showToast,
  renderAll,
  openCommandPalette,
  closeCommandPalette,
  setupCommandPalette,
  setupSettingsFocusTrap
};


// Event cleanup functions
export {
  registerEventListener,
  cleanupEventListeners,
  debugListeners,
  getListenerStats
};
