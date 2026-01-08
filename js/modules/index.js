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
  registerEventListener,
  cleanupEventListeners,
  destroyChart,
  destroyAllCharts,
  destroyGrid,
  destroyAllGrids,
  cleanup,
  isAppsScript,
  debugState
} from './state.js';

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
  getViewName
} from './navigation.js';

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
  setToggleCallbacks
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

// ===== SKELETON LOADING UI =====
function showSkeletons(show) {
  setSkeletonsShowing(show);
  const kpiCards = document.querySelectorAll('.kpi-card');
  const widgetCards = document.querySelectorAll('.widget-item');

  kpiCards.forEach(function(card) {
    if (show) {
      card.classList.add('loading');
    } else {
      card.classList.remove('loading');
    }
  });

  widgetCards.forEach(function(widget) {
    if (show) {
      widget.classList.add('loading');
    } else {
      widget.classList.remove('loading');
    }
  });
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
  toast.className = 'toast toast-' + type;
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

// ===== RENDER ALL COMPONENTS =====
function renderAll() {
  const data = getData();
  if (!data) return;

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

// ===== HERO SECTION RENDERING =====
function renderHeroSection(data) {
  const t = data.totals || data.today || {};

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
    elHeroSubtitle.textContent = 'Total: ' + totalProduction.toFixed(1) + ' lbs (incl. ' + smalls.toFixed(1) + ' lbs smalls)';
  }

  // Time-aware production calculation
  const trimmers = t.trimmers || 0;
  const todayRate = t.avgRate || 0;
  const productiveHoursElapsed = getProductiveHoursElapsed();
  const totalProductiveHours = getTotalProductiveHours();
  const remainingHours = Math.max(0, totalProductiveHours - productiveHoursElapsed);

  // Expected production from backend
  const expectedSoFar = (data.current && data.current.todayTarget) || (data.targets && data.targets.totalTops) || 0;

  // Predicted end-of-day total
  const predictedTops = tops + (trimmers * todayRate * remainingHours);

  // Progress bar
  let progressPercent = 0;
  let progressStatus = '';
  if (expectedSoFar > 0) {
    progressPercent = (tops / expectedSoFar * 100);
    if (progressPercent >= 100) {
      progressStatus = 'ahead';
    } else if (progressPercent >= 90) {
      progressStatus = 'on-track';
    } else {
      progressStatus = 'behind';
    }
  }

  const elHeroProgressFill = document.getElementById('heroProgressFill');
  const elHeroProgressText = document.getElementById('heroProgressText');
  if (elHeroProgressFill) {
    elHeroProgressFill.style.width = Math.min(progressPercent, 100) + '%';
    elHeroProgressFill.className = 'hero-progress-fill ' + progressStatus;
  }
  if (elHeroProgressText) {
    if (productiveHoursElapsed > 0 && expectedSoFar > 0) {
      elHeroProgressText.textContent = progressPercent.toFixed(0) + '% of expected (' + expectedSoFar.toFixed(0) + ' lbs)';
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
  if (elHeroTargetValue) {
    if (predictedTops > 0) {
      elHeroTargetValue.textContent = predictedTops.toFixed(0) + ' lbs';
    } else {
      elHeroTargetValue.textContent = '--';
    }
  }

  // Bags done
  const elHeroBagsValue = document.getElementById('heroBagsValue');
  const elHeroAvgCycleTime = document.getElementById('heroAvgCycleTime');
  if (elHeroBagsValue) {
    elHeroBagsValue.textContent = (data.bagTimer && data.bagTimer.bagsToday) || '--';
  }
  if (elHeroAvgCycleTime) {
    elHeroAvgCycleTime.textContent = (data.bagTimer && data.bagTimer.avgTime) ? 'Avg: ' + data.bagTimer.avgTime : 'Avg: --';
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

// ===== KEYBOARD SHORTCUTS =====
function setupKeyboardShortcuts() {
  const keydownHandler = function(e) {
    // Don't trigger shortcuts when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

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

    // Escape: Close panels
    if (e.key === 'Escape') {
      const settingsPanel = document.getElementById('settingsPanel');
      const aiChatPanel = document.getElementById('aiChatPanel');

      if (settingsPanel && settingsPanel.classList.contains('open')) {
        toggleSettings();
      } else if (aiChatPanel && aiChatPanel.classList.contains('open')) {
        toggleAIChat();
      }
      return;
    }

    // Ctrl/Cmd + K: Open settings
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      toggleSettings();
      return;
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
            console.log('KPI Muuri destroyed for mobile view');
          } catch (e) {
            console.warn('Error destroying KPI Muuri:', e);
            setGrid('kpi', null);
          }
        }

        if (widgetGrid && !widgetGrid._isDestroyed) {
          try {
            widgetGrid.destroy();
            setGrid('widgets', null);
            console.log('Widget Muuri destroyed for mobile view');
          } catch (e) {
            console.warn('Error destroying widget Muuri:', e);
            setGrid('widgets', null);
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
function init() {
  console.log('Initializing Rogue Origin Dashboard...');

  // 1. Set up cleanup for page unload (registered for tracking)
  registerEventListener(window, 'beforeunload', cleanup);

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

  // 6. Initialize target input
  initTargetInput();

  // 7. Render KPI cards
  renderKPICards();

  // 8. Render KPI toggles in settings
  renderKPIToggles();

  // 9. Render widget toggles in settings
  renderWidgetToggles();

  // 10. Initialize charts
  initCharts();

  // 11. Initialize Muuri grids (desktop only)
  if (window.innerWidth >= 600) {
    initMuuriKPI();
    initMuuriGrid();
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

  // 19. Set up keyboard shortcuts
  setupKeyboardShortcuts();

  // 20. Set up resize handler
  setupResizeHandler();

  // 21. Initialize widget resize handles
  initWidgetResizeHandles();

  // 22. Hide loading overlay
  const loadingOverlay = document.getElementById('loadingOverlay');
  if (loadingOverlay) {
    loadingOverlay.style.opacity = '0';
    loadingOverlay.style.visibility = 'hidden';
    // Remove from DOM after transition
    setTimeout(function() {
      loadingOverlay.style.display = 'none';
    }, 300);
  }

  console.log('Dashboard initialization complete');
}

// ===== DOM CONTENT LOADED LISTENER =====
document.addEventListener('DOMContentLoaded', init);

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

// ===== STUB FUNCTIONS FOR UNIMPLEMENTED FEATURES =====
// These are placeholders for features that need to be migrated/implemented
window.explicitSaveLayout = function() {
  saveLayout();
  showToast('Layout saved', 'success', 2000);
};

window.startTutorial = function() {
  console.log('Tutorial not yet implemented in modular version');
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
  } catch (e) {}
};

window.showWidgetHelp = function(widgetId) {
  console.log('Widget help not yet implemented:', widgetId);
  showToast('Help coming soon', 'info', 2000);
};

// AI Voice features (stubs - to be migrated from original dashboard.js)
window.aiToggleVoiceMode = function() {
  const btn = document.getElementById('aiVoiceModeToggle');
  if (btn) btn.classList.toggle('active');
};

window.aiToggleVoice = function() {
  console.log('Voice input not yet implemented');
  showToast('Voice input coming soon', 'info', 2000);
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
  registerEventListener,
  cleanupEventListeners,
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
  showToast,
  renderAll
};
