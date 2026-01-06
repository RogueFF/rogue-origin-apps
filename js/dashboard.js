// KPI Definitions with Phosphor duotone icons
var kpiDefinitions = [
  { id: 'totalTops', label: 'Total Tops', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><ellipse cx="12" cy="11" rx="5" ry="7" stroke="currentColor" stroke-width="2"/><path d="M8 8C8 8 9 6 12 6C15 6 16 8 16 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M7 11C7 11 8.5 9 12 9C15.5 9 17 11 17 11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 14C8 14 9.5 12 12 12C14.5 12 16 14 16 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 18V21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="7.5" cy="9" r="0.8" fill="currentColor"/><circle cx="16.5" cy="9" r="0.8" fill="currentColor"/><circle cx="7" cy="12" r="0.8" fill="currentColor"/><circle cx="17" cy="12" r="0.8" fill="currentColor"/><circle cx="8" cy="15" r="0.8" fill="currentColor"/><circle cx="16" cy="15" r="0.8" fill="currentColor"/></svg>', color: 'gold', default: true, format: 'lbs' },
  { id: 'totalSmalls', label: 'Total Smalls', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><ellipse cx="12" cy="9" rx="3" ry="4" stroke="currentColor" stroke-width="2"/><path d="M10 7C10 7 10.5 6 12 6C13.5 6 14 7 14 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10 10C10 10 10.5 9 12 9C13.5 9 14 10 14 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="8" r="0.6" fill="currentColor"/><circle cx="14" cy="8" r="0.6" fill="currentColor"/><circle cx="10" cy="10.5" r="0.6" fill="currentColor"/><circle cx="14" cy="10.5" r="0.6" fill="currentColor"/><path d="M12 13L12 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 16L10 17M12 16L14 17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>', color: 'sungrown', default: true, format: 'lbs' },
  { id: 'avgRate', label: 'Lbs/Trimmer/Hr', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 3V21H21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 17C7 17 9 14 12 12C15 10 17 7 17 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 7C17 7 19 5 21 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="7" cy="17" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="17" cy="7" r="1.5" fill="currentColor"/></svg>', color: 'green', default: true, format: 'rate' },
  { id: 'crew', label: 'Current Crew', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="7" r="3" stroke="currentColor" stroke-width="2"/><path d="M8 21V19C8 17.9391 8.42143 16.9217 9.17157 16.1716C9.92172 15.4214 10.9391 15 12 15C13.0609 15 14.0783 15.4214 14.8284 16.1716C15.5786 16.9217 16 17.9391 16 19V21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="5" cy="9" r="2" stroke="currentColor" stroke-width="2"/><circle cx="19" cy="9" r="2" stroke="currentColor" stroke-width="2"/><path d="M12 3L13 2M12 3L11 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>', color: 'greenhouse', default: true, format: 'num' },
  { id: 'operatorHours', label: 'Operator Hours', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 5V7M19 12H17M12 19V17M5 12H7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 12V7M12 12L16 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>', color: 'indoor', default: true, format: 'hrs' },
  { id: 'costPerLb', label: 'Cost/Lb', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 6v12M15 9h-4.5a2.5 2.5 0 0 0 0 5h3a2.5 2.5 0 0 1 0 5H9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>', color: 'gold', default: true, format: 'dollar' },
  { id: 'totalLbs', label: 'Total Lbs', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 21H19M12 21V8M4 8C4 8 8 7 12 8C16 9 20 8 20 8M4 8V11C4 12 5 13 7 13C9 13 10 12 10 11V8M14 8V11C14 12 15 13 17 13C19 13 20 12 20 11V8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="5" r="2" stroke="currentColor" stroke-width="2"/></svg>', color: 'green', default: false, format: 'lbs' },
  { id: 'maxRate', label: 'Best Rate', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="6" stroke="currentColor" stroke-width="2"/><path d="M12 8C12 8 10 9.5 10 12C10 9.5 8 8 8 8M12 8C12 8 14 9.5 14 12C14 9.5 16 8 16 8M12 12V15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>', color: 'gold', default: false, format: 'rate' },
  { id: 'trimmerHours', label: 'Trimmer Hours', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="6" cy="6" r="3" stroke="currentColor" stroke-width="2"/><circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="2"/><path d="M8.5 8L20 14M8.5 16L20 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16 12C16 12 14.5 10.5 14.5 8.5M16 12C16 12 17.5 10.5 17.5 8.5M16 12V14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>', color: 'greenhouse', default: false, format: 'hrs' },
  { id: 'laborCost', label: 'Total Labor', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 6v12M15 9h-4.5a2.5 2.5 0 0 0 0 5h3a2.5 2.5 0 0 1 0 5H9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>', color: 'sungrown', default: false, format: 'dollar' }
];

// Widget Definitions
// Widget Definitions with Phosphor duotone icons
var widgetDefinitions = [
  { id: 'kanban', label: 'Supply Kanban', icon: 'ph-duotone ph-package', color: 'green', default: true },
  { id: 'scoreboard', label: 'Live Scoreboard', icon: 'ph-duotone ph-gauge', color: 'gold', default: true },
  { id: 'bags', label: '5KG Bag Timer', icon: 'ph-duotone ph-timer', color: 'sungrown', default: true },
  { id: 'sop', label: 'SOP Manager', icon: 'ph-duotone ph-book-open-text', color: 'indoor', default: true },
  { id: 'current', label: 'Current Production', icon: 'ph-duotone ph-pulse', color: 'green', default: true },
  { id: 'hourlyChart', label: 'Hourly Chart', icon: 'ph-duotone ph-chart-bar', color: 'indoor', default: true },
  { id: 'rateChart', label: 'Rate Chart', icon: 'ph-duotone ph-trend-up', color: 'indoor', default: true },
  { id: 'dailyChart', label: 'Daily Chart', icon: 'ph-duotone ph-chart-bar-horizontal', color: 'indoor', default: true },
  { id: 'dailyRateChart', label: 'Daily Rate Chart', icon: 'ph-duotone ph-chart-line-up', color: 'indoor', default: true },
  { id: 'trimmersChart', label: 'Trimmers on Line', icon: 'ph-duotone ph-users', color: 'greenhouse', default: true },
  { id: 'productivity', label: 'Productivity Sparkline', icon: 'ph-duotone ph-lightning', color: 'green', default: true },
  { id: 'strains', label: 'Strain Breakdown', icon: 'ph-duotone ph-leaf', color: 'greenhouse', default: true },
  { id: 'performance', label: 'Performance Table', icon: 'ph-duotone ph-list-checks', color: 'indoor', default: true },
  { id: 'cost', label: 'Cost Analysis', icon: 'ph-duotone ph-currency-dollar', color: 'gold', default: true },
  { id: 'period', label: 'Period Summary', icon: 'ph-duotone ph-calendar', color: 'sungrown', default: true }
];

var appUrls = {
  kanban: 'https://rogueff.github.io/rogue-origin-apps/kanban.html',
  scoreboard: 'https://rogueff.github.io/rogue-origin-apps/scoreboard.html',
  barcode: 'https://rogueff.github.io/rogue-origin-apps/barcode.html',
  sop: 'https://rogueff.github.io/rogue-origin-apps/sop-manager.html',
  orders: 'https://rogueff.github.io/rogue-origin-apps/orders.html'
};

var brandColors = { green: '#668971', greenLight: 'rgba(102,137,113,0.2)', gold: '#e4aa4f', sungrown: '#bf8e4e', indoor: '#62758d', indoorLight: 'rgba(98,117,141,0.3)' };
var hourlyChart, rateChart, dailyChart, dailyRateChart, trimmersChart;
var data = null, compareData = null;
var currentRange = 'today', customStartDate = null, customEndDate = null;
var compareMode = null;
var editMode = false, kpiSortable, widgetSortable;
var currentView = 'dashboard';
var sidebarCollapsed = false;
var darkMode = false;
var dailyTarget = 200; // Daily production target in lbs

// AbortController for cancelling in-flight fetch requests when user changes date range quickly
// This prevents stale data from overwriting current data (race condition fix)
var currentFetchController = null;

// Debounce timer for Muuri layout operations to prevent excessive reflows
var muuriLayoutDebounceTimer = null;

// Debounce timer for widget collapse animation to prevent layout thrashing
var collapseLayoutDebounceTimer = null;

// Event listener cleanup registry for preventing memory leaks
var eventCleanupRegistry = [];

// Register an event listener for cleanup
function registerEventListener(element, event, handler, options) {
  if (!element) return null;
  element.addEventListener(event, handler, options);
  eventCleanupRegistry.push({ element: element, event: event, handler: handler, options: options });
  return handler;
}

// Cleanup all registered event listeners (call on page unload or view switch)
function cleanupEventListeners() {
  eventCleanupRegistry.forEach(function(entry) {
    if (entry.element) {
      entry.element.removeEventListener(entry.event, entry.handler, entry.options);
    }
  });
  eventCleanupRegistry = [];
}

// Debounce timer for KPI Muuri layout operations (separate from widget grid)
var muuriKPILayoutDebounceTimer = null;

// Flags to track initialization state and prevent race conditions
var chartsInitialized = false;
var dataLoaded = false;
var muuriKPIReady = false;
var muuriGridReady = false;

// API Configuration for GitHub Pages
var API_URL = 'https://script.google.com/macros/s/AKfycbxDAHSFl9cedGS49L3Lf5ztqy-SSToYigyA30ZtsdpmWNAR9H61X_Mm48JOOTGqqr-Z/exec';

// Safe DOM element getter with warning for debugging
function safeGetEl(id) {
  var el = document.getElementById(id);
  if (!el) console.warn('Element not found: ' + id);
  return el;
}

// Safe property accessor - safely access nested object properties
function safeGet(obj, path, defaultValue) {
  if (!obj || typeof path !== 'string') return defaultValue;
  var keys = path.split('.');
  var result = obj;
  for (var i = 0; i < keys.length; i++) {
    if (result == null || typeof result !== 'object') return defaultValue;
    result = result[keys[i]];
  }
  return result !== undefined ? result : defaultValue;
}

// Safe number formatter - ensures number is valid before formatting
function safeNumber(value, decimals, defaultValue) {
  if (typeof value !== 'number' || isNaN(value) || !isFinite(value)) {
    return defaultValue !== undefined ? defaultValue : '—';
  }
  return decimals !== undefined ? value.toFixed(decimals) : value;
}

// Safe chart context getter with warning for debugging
function safeGetChartContext(canvasId) {
  var canvas = document.getElementById(canvasId);
  if (!canvas) {
    console.warn('Canvas element not found: ' + canvasId);
    return null;
  }
  var ctx = canvas.getContext('2d');
  if (!ctx) {
    console.warn('Could not get 2d context for: ' + canvasId);
    return null;
  }
  return ctx;
}


// Work schedule configuration
// Day: 7:00 AM - 4:30 PM (9.5 hours)
// Breaks: 9:00 AM (10min), 12:00 PM (30min lunch), 2:30 PM (10min), 4:20 PM (10min cleanup)
// Total break time: 60 min = 1 hour
// Total productive time: 8.5 hours
var workSchedule = {
  startHour: 7, startMin: 0,   // 7:00 AM
  endHour: 16, endMin: 30,     // 4:30 PM
  breaks: [
    { hour: 9, min: 0, duration: 10 },    // 9:00 AM - 10 min
    { hour: 12, min: 0, duration: 30 },   // 12:00 PM - 30 min lunch
    { hour: 14, min: 30, duration: 10 },  // 2:30 PM - 10 min
    { hour: 16, min: 20, duration: 10 }   // 4:20 PM - 10 min cleanup
  ],
  totalProductiveMinutes: 8.5 * 60  // 510 minutes
};

// Calculate productive minutes elapsed based on current time and break schedule
function getProductiveMinutesElapsed() {
  var now = new Date();
  var currentHour = now.getHours();
  var currentMin = now.getMinutes();

  // Convert current time to minutes since midnight
  var currentTimeInMin = currentHour * 60 + currentMin;
  var startTimeInMin = workSchedule.startHour * 60 + workSchedule.startMin;
  var endTimeInMin = workSchedule.endHour * 60 + workSchedule.endMin;

  // Before work starts
  if (currentTimeInMin < startTimeInMin) return 0;

  // After work ends
  if (currentTimeInMin >= endTimeInMin) return workSchedule.totalProductiveMinutes;

  // Calculate raw minutes elapsed since start
  var rawMinutesElapsed = currentTimeInMin - startTimeInMin;

  // Subtract break time that has passed
  var breakMinutesPassed = 0;
  workSchedule.breaks.forEach(function(b) {
    var breakStartInMin = b.hour * 60 + b.min;
    var breakEndInMin = breakStartInMin + b.duration;

    if (currentTimeInMin >= breakEndInMin) {
      // Break is fully over
      breakMinutesPassed += b.duration;
    } else if (currentTimeInMin > breakStartInMin) {
      // Currently in break
      breakMinutesPassed += (currentTimeInMin - breakStartInMin);
    }
  });

  return Math.max(0, rawMinutesElapsed - breakMinutesPassed);
}

function getProductiveHoursElapsed() {
  return getProductiveMinutesElapsed() / 60;
}

function getTotalProductiveHours() {
  return workSchedule.totalProductiveMinutes / 60; // 8.5 hours
}


// Detect environment: Apps Script or GitHub Pages
var isAppsScript = typeof google !== 'undefined' && google.script && google.script.run;

// Chart.js Botanical Styling
Chart.defaults.font.family = getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'Outfit, Inter, system-ui, sans-serif';
Chart.defaults.font.size = 12;
Chart.defaults.borderColor = 'rgba(102, 137, 113, 0.1)';
Chart.defaults.plugins.tooltip = {
  backgroundColor: 'rgba(26, 31, 22, 0.95)',
  titleColor: '#f5f2ed',
  bodyColor: '#a8b5a9',
  borderColor: 'rgba(228, 170, 79, 0.3)',
  borderWidth: 1,
  cornerRadius: 8,
  padding: 12,
  titleFont: { family: getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim(), size: 14, weight: '400' },
  bodyFont: { family: getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim(), size: 12 },
  displayColors: true,
  boxWidth: 8,
  boxHeight: 8,
  boxPadding: 6
};
Chart.defaults.animation = {
  duration: 1200,
  easing: 'easeOutQuart',
  delay: function(context) {
    var delay = 0;
    if (context.type === 'data' && context.mode === 'default') {
      // Stagger each data point by 50ms
      delay = context.dataIndex * 50;
    }
    return delay;
  }
};

// Cleanup event listeners and intervals on page unload to prevent memory leaks
window.addEventListener('beforeunload', function() {
  cleanupEventListeners();
  // Clear any pending timers
  if (muuriLayoutDebounceTimer) clearTimeout(muuriLayoutDebounceTimer);
  if (collapseLayoutDebounceTimer) clearTimeout(collapseLayoutDebounceTimer);
  // Cancel any in-flight fetch requests
  if (currentFetchController) currentFetchController.abort();
});

document.addEventListener('DOMContentLoaded', function() {
  loadSettings();
  initTheme(); // Initialize theme system
  initTargetInput();
  renderKPICards();
  renderKPIToggles();
  renderWidgetToggles();
  initCharts();
  initSortable();
  updateClock();
  setInterval(updateClock, 1000);
  updateWelcome();
  
  var today = new Date();
  var endDateEl = document.getElementById('endDate');
  var startDateEl = document.getElementById('startDate');
  if (endDateEl) endDateEl.value = formatDateInput(today);
  if (startDateEl) startDateEl.value = formatDateInput(today);
  
  document.querySelectorAll('.date-chip').forEach(function(c) {
    c.addEventListener('click', function() { setDateRange(this.dataset.range); });
  });
  
  document.addEventListener('click', function(e) {
    var datePickerDropdown = document.getElementById('datePickerDropdown');
    var compareDropdown = document.getElementById('compareDropdown');
    if (!e.target.closest('.date-picker-wrapper') && datePickerDropdown) datePickerDropdown.classList.remove('open');
    if (!e.target.closest('.compare-selector') && compareDropdown) compareDropdown.classList.remove('open');
  });

  loadData();
  setInterval(function() { if (currentRange === 'today' && !compareMode && currentView === 'dashboard') loadData(); }, 30000);

  // Keyboard shortcuts
  document.addEventListener('keydown', function(e) {
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
      var settingsPanel = document.getElementById('settingsPanel');
      var aiChatPanel = document.getElementById('aiChatPanel');

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
  });

  // Refresh Muuri layout on window resize (desktop only)
  // Uses debounced layout to prevent layout thrashing during rapid resize
  var resizeTimeout;
  window.addEventListener('resize', function() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(function() {
      // Only use Muuri on desktop (>= 600px)
      if (window.innerWidth >= 600) {
        // Use debounced layout for both grids to prevent thrashing
        debouncedMuuriLayout(muuriKPI, 150);
        debouncedMuuriLayout(muuriGrid, 150);
      } else {
        // Destroy Muuri on mobile to prevent positioning conflicts with CSS grid
        // Guard against already-destroyed grids (race condition fix)
        if (muuriKPI && !muuriKPI._isDestroyed) {
          try {
            muuriKPI.destroy();
            muuriKPI = null;
            console.log('KPI Muuri destroyed for mobile view');
          } catch(e) {
            console.warn('Error destroying KPI Muuri:', e);
            muuriKPI = null;
          }
        }
        if (muuriGrid && !muuriGrid._isDestroyed) {
          try {
            muuriGrid.destroy();
            muuriGrid = null;
            console.log('Widget Muuri destroyed for mobile view');
          } catch(e) {
            console.warn('Error destroying widget Muuri:', e);
            muuriGrid = null;
          }
        }
      }
    }, 100);
  });
});

function initTargetInput() {
  var input = document.getElementById('targetInput');
  if (!input) return;
  input.value = dailyTarget;
  input.addEventListener('change', function() {
    dailyTarget = parseInt(this.value) || 200;
    saveSettings();
    if (data) renderCharts();
  });
}


// Sidebar toggle
function toggleSidebar() {
  sidebarCollapsed = !sidebarCollapsed;
  var sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.toggle('collapsed', sidebarCollapsed);
  document.body.classList.toggle('sidebar-collapsed', sidebarCollapsed);
  saveSettings();
}


function toggleMobileSidebar() {
  var sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.toggle('mobile-open');
}


// ===== THEME TOGGLE SYSTEM =====
function toggleTheme() {
  const root = document.documentElement;
  const currentTheme = root.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

  // Set theme attribute
  root.setAttribute('data-theme', newTheme);

  // Update UI
  updateThemeUI(newTheme);

  // Save to localStorage
  localStorage.setItem('theme', newTheme);

  // Update charts with new theme colors
  updateChartTheme(newTheme);

  // Re-render charts if data exists
  if (data) renderCharts();
  if (data) renderTrimmersChart();
}


function updateThemeUI(theme) {
  var icon = document.getElementById('themeIcon');
  var label = document.getElementById('themeLabel');

  if (theme === 'dark') {
    if (icon) icon.textContent = '☀️';
    if (label) label.textContent = 'Light';
  } else {
    if (icon) icon.textContent = '🌙';
    if (label) label.textContent = 'Dark';
  }
}


function updateChartTheme(theme) {
  // Update chart.js default colors based on theme
  if (typeof Chart !== 'undefined') {
    // Botanical color palette
    Chart.defaults.color = theme === 'dark' ? '#a8b5a9' : '#5a6b5f';
    Chart.defaults.borderColor = theme === 'dark' ? 'rgba(168, 181, 169, 0.1)' : 'rgba(102, 137, 113, 0.08)';

    // Update tooltip colors for theme
    Chart.defaults.plugins.tooltip.backgroundColor = theme === 'dark' ? 'rgba(26, 31, 22, 0.95)' : 'rgba(255, 255, 255, 0.95)';
    Chart.defaults.plugins.tooltip.titleColor = theme === 'dark' ? '#f5f2ed' : '#1a1f16';
    Chart.defaults.plugins.tooltip.bodyColor = theme === 'dark' ? '#a8b5a9' : '#5a6b5f';
    Chart.defaults.plugins.tooltip.borderColor = theme === 'dark' ? 'rgba(228, 170, 79, 0.3)' : 'rgba(228, 170, 79, 0.5)';
  }
}


function initTheme() {
  // Load theme from localStorage or default to light
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeUI(savedTheme);
  updateChartTheme(savedTheme);
}


// Legacy support: keep toggleDarkMode for backwards compatibility
function toggleDarkMode() {
  toggleTheme();
}


// View switching
function switchView(view) {
  currentView = view;

  // Update nav items
  document.querySelectorAll('.nav-item[data-view]').forEach(function(item) {
    item.classList.toggle('active', item.dataset.view === view);
  });

  // Show/hide views (with null checks)
  var dashboardView = document.getElementById('dashboardView');
  var kanbanView = document.getElementById('kanbanView');
  var scoreboardView = document.getElementById('scoreboardView');
  var barcodeView = document.getElementById('barcodeView');
  var sopView = document.getElementById('sopView');
  var ordersView = document.getElementById('ordersView');
  var dashboardControls = document.getElementById('dashboardControls');

  if (dashboardView) dashboardView.classList.toggle('active', view === 'dashboard');
  if (kanbanView) kanbanView.classList.toggle('active', view === 'kanban');
  if (scoreboardView) scoreboardView.classList.toggle('active', view === 'scoreboard');
  if (barcodeView) barcodeView.classList.toggle('active', view === 'barcode');
  if (sopView) sopView.classList.toggle('active', view === 'sop');
  if (ordersView) ordersView.classList.toggle('active', view === 'orders');

  // Show/hide dashboard controls
  if (dashboardControls) dashboardControls.style.display = view === 'dashboard' ? 'flex' : 'none';

  // Hide AI chat when viewing iframe apps (they have their own UI elements)
  var aiWidget = document.querySelector('.ai-chat-widget');
  if (aiWidget) {
    aiWidget.style.display = (view === 'dashboard' || view === 'orders') ? 'block' : 'none';
    // Also close the chat panel if open
    if (view !== 'dashboard' && view !== 'orders') {
      var panel = document.querySelector('.ai-chat-panel');
      if (panel) panel.classList.remove('open');
    }
  }

  // Update page title
  var titles = { dashboard: 'Operations Dashboard', kanban: 'Supply Kanban', scoreboard: 'Scoreboard / Bag Timer', barcode: 'Barcode Printer', sop: 'SOP Manager', orders: 'Order Management' };
  // pageTitle removed - using header logo instead
  document.title = 'Rogue Origin - ' + (titles[view] || 'Operations Hub');

  // Lazy load iframes
  if (view !== 'dashboard') {
    var frameId = view + 'Frame';
    var frame = document.getElementById(frameId);
    if (frame && !frame.src && frame.dataset.src) {
      frame.src = frame.dataset.src;
    }
  }

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('mobile-open');
}


function openAppNewTab(app) {
  window.open(appUrls[app], '_blank');
}


// Settings
function loadSettings() {
  try {
    var s = JSON.parse(localStorage.getItem('roHubSettingsV2') || '{}');
    kpiDefinitions.forEach(function(k) {
      k.visible = s.kpiVisibility && s.kpiVisibility[k.id] !== undefined ? s.kpiVisibility[k.id] : k.default;
    });
    if (s.kpiOrder) {
      kpiDefinitions.sort(function(a,b) {
        var ai = s.kpiOrder.indexOf(a.id), bi = s.kpiOrder.indexOf(b.id);
        return (ai===-1?999:ai)-(bi===-1?999:bi);
      });
    }
    widgetDefinitions.forEach(function(w) {
      w.visible = s.widgetVisibility && s.widgetVisibility[w.id] !== undefined ? s.widgetVisibility[w.id] : w.default;
    });
    if (s.sidebarCollapsed) {
      sidebarCollapsed = true;
      var sidebarEl = document.getElementById('sidebar');
      if (sidebarEl) sidebarEl.classList.add('collapsed');
      document.body.classList.add('sidebar-collapsed');
    }
    if (s.darkMode !== undefined) {
      darkMode = s.darkMode;
    }
    if (s.dailyTarget !== undefined) {
      dailyTarget = s.dailyTarget;
    }
  } catch(e) {
    kpiDefinitions.forEach(function(k) { k.visible = k.default; });
    widgetDefinitions.forEach(function(w) { w.visible = w.default; });
  }
  applyWidgetVisibility();
}


function applyDarkMode() {
  document.body.classList.toggle('dark-mode', darkMode);
  updateDarkModeUI();
}


function saveSettings() {
  var s = { kpiVisibility: {}, kpiOrder: [], widgetVisibility: {}, sidebarCollapsed: sidebarCollapsed, darkMode: darkMode, dailyTarget: dailyTarget };
  kpiDefinitions.forEach(function(k) {
    s.kpiVisibility[k.id] = k.visible;
    s.kpiOrder.push(k.id);
  });
  widgetDefinitions.forEach(function(w) {
    s.widgetVisibility[w.id] = w.visible;
  });
  localStorage.setItem('roHubSettingsV2', JSON.stringify(s));
}


// resetLayout() moved to line 3435 - consolidated version

function applyWidgetVisibility() {
  widgetDefinitions.forEach(function(w) {
    var el = document.getElementById('widget-' + w.id);
    if (el) el.dataset.hidden = !w.visible;
  });
}


function renderKPICards() {
  var c = document.getElementById('kpiRow');
  if (!c) {
    console.warn('KPI row container not found');
    return;
  }
  c.innerHTML = '';
  kpiDefinitions.forEach(function(k) {
    var card = document.createElement('div');
    card.className = 'kpi-card ' + k.color + ' loading';
    card.dataset.kpi = k.id;
    card.dataset.hidden = !k.visible;
    card.style.cursor = 'pointer';
    card.onclick = function() { toggleKPIExpand(k.id); };
    card.innerHTML = '<div class="kpi-header"><div class="kpi-icon">' + k.icon + '</div><span class="kpi-delta" id="delta_' + k.id + '"></span></div>' +
      '<div class="kpi-label">' + k.label + '</div>' +
      '<div class="kpi-values"><span class="kpi-value" id="kpi_' + k.id + '">—</span><span class="kpi-value-compare" id="kpiCmp_' + k.id + '"></span></div>' +
      '<div class="kpi-sub" id="kpiSub_' + k.id + '"></div>' +
      '<div class="kpi-expanded-content" id="kpiExpanded_' + k.id + '">' +
        '<div class="kpi-expanded-row"><div class="kpi-expanded-label">7-Day Rolling Avg</div><div class="kpi-expanded-value" id="kpiRolling_' + k.id + '">—</div></div>' +
        '<div class="kpi-expanded-row"><div class="kpi-expanded-label">Crew-Normalized</div><div class="kpi-expanded-value" id="kpiNormalized_' + k.id + '">—</div></div>' +
        '<div class="kpi-expanded-sparkline" id="kpiSparkline_' + k.id + '"></div>' +
        '<div class="kpi-expanded-notes" id="kpiNotes_' + k.id + '"></div>' +
      '</div>' +
      '<div class="skeleton-content"><div class="skeleton skeleton-value"></div><div class="skeleton skeleton-bar"></div></div>';
    c.appendChild(card);
  });
}


function renderKPIToggles() {
  var c = document.getElementById('kpiToggles');
  if (!c) return;
  c.innerHTML = '';
  kpiDefinitions.forEach(function(k) {
    var t = document.createElement('div');
    t.className = 'widget-toggle';
    t.innerHTML = '<div class="widget-toggle-info"><div class="widget-toggle-icon ' + k.color + '">' + k.icon + '</div><span class="widget-toggle-name">' + k.label + '</span></div><label class="toggle-switch"><input type="checkbox" ' + (k.visible ? 'checked' : '') + ' onchange="toggleKPI(\'' + k.id + '\', this.checked)"><span class="toggle-slider"></span></label>';
    c.appendChild(t);
  });
}


function renderWidgetToggles() {
  var c = document.getElementById('widgetToggles');
  if (!c) return;
  c.innerHTML = '';
  widgetDefinitions.forEach(function(w) {
    // Check actual widget visibility in DOM
    var widgetElement = document.querySelector('[data-widget-id="widget-' + w.id + '"]');
    var isVisible = true; // Default to visible

    if (widgetElement) {
      // Widget is visible if it doesn't have the muuri-item-hidden class
      isVisible = !widgetElement.classList.contains('muuri-item-hidden');
    }

    var t = document.createElement('div');
    t.className = 'widget-toggle';
    t.innerHTML = '<div class="widget-toggle-info"><div class="widget-toggle-icon ' + w.color + '"><i class="' + w.icon + '"></i></div><span class="widget-toggle-name">' + w.label + '</span></div><label class="toggle-switch"><input type="checkbox" ' + (isVisible ? 'checked' : '') + ' onchange="toggleWidget(\'' + w.id + '\', this.checked)"><span class="toggle-slider"></span></label>';
    c.appendChild(t);
  });
}


function toggleKPI(id, v) {
  var k = kpiDefinitions.find(function(x) { return x.id === id; });
  if (k) k.visible = v;

  var card = document.querySelector('.kpi-card[data-kpi="' + id + '"]');
  if (!card) return;

  // Update data attribute
  card.dataset.hidden = !v;

  // Use Muuri show/hide if available (desktop only)
  if (muuriKPI) { // MARKER1
    var items = muuriKPI.getItems();
    var targetItem = items.find(function(item) {
      return item.getElement() === card;
    });

    if (targetItem) {
      if (v) {
        // Show the card
        muuriKPI.show([targetItem], {instant: false, onFinish: function() {
          muuriKPI.refreshItems();
          muuriKPI.layout(true);
        }});
      } else {
        // Hide the card
        muuriKPI.hide([targetItem], {instant: false, onFinish: function() {
          muuriKPI.refreshItems();
          muuriKPI.layout(true);
        }});
      }
    }
  }

  saveSettings();
}


function toggleWidget(id, v) {
  var w = widgetDefinitions.find(function(x) { return x.id === id; });
  if (w) w.visible = v;

  // Use Muuri show/hide functions
  var widgetId = 'widget-' + id;
  if (v) {
    showWidget(widgetId);
  } else {
    hideWidget(widgetId);
  }
}


// ===== MUURI GRID SYSTEM =====
var muuriGrid = null;
var muuriKPI = null;

// Debounced Muuri layout function to prevent excessive reflows
// Consolidates multiple setTimeout calls (150ms -> 50ms -> 100ms) into single layout pass
function debouncedMuuriLayout(grid, delay) {
  if (!grid) return;
  delay = delay || 200;
  
  clearTimeout(muuriLayoutDebounceTimer);
  muuriLayoutDebounceTimer = setTimeout(function() {
    // Guard against destroyed grid (can happen during rapid mobile resize)
    if (!grid || grid._isDestroyed) {
      console.log('Muuri grid was destroyed, skipping layout');
      return;
    }
    grid.refreshItems();
    grid.layout(true);
  }, delay);
}

// Debounced KPI Muuri layout function - uses separate timer to avoid conflicts with widget grid
// This fixes race conditions where KPI and widget grids compete for the same debounce timer
function debouncedKPILayout(delay) {
  if (!muuriKPI) return;
  delay = delay || 100;

  clearTimeout(muuriKPILayoutDebounceTimer);
  muuriKPILayoutDebounceTimer = setTimeout(function() {
    // Guard against destroyed grid (can happen during rapid mobile resize)
    if (!muuriKPI || muuriKPI._isDestroyed) {
      console.log('KPI Muuri grid was destroyed, skipping layout');
      return;
    }
    muuriKPI.refreshItems();
    muuriKPI.layout(true);
  }, delay);
}

// Safe Muuri operation wrapper - guards against race conditions when grid is destroyed
function safeMuuriOperation(grid, operation) {
  if (!grid || grid._isDestroyed) {
    console.log('Muuri grid unavailable or destroyed, skipping operation');
    return false;
  }
  try {
    operation(grid);
    return true;
  } catch (e) {
    console.warn('Muuri operation failed:', e);
    return false;
  }
}


function initMuuriGrid() {
  var container = document.getElementById('widgetsContainer');
  if (!container || typeof Muuri === 'undefined') {
    console.warn('Muuri not available or container not found');
    return;
  }

  // Apply initial size classes from data-size attributes BEFORE Muuri init
  // This ensures widgets have correct dimensions when Muuri calculates layout
  var widgetItems = container.querySelectorAll('.widget-item');
  widgetItems.forEach(function(item) {
    var size = item.dataset.size;
    if (size && !item.classList.contains('size-' + size)) {
      item.classList.add('size-' + size);
    }
  });

  muuriGrid = new Muuri(container, {
    dragEnabled: true,
    dragHandle: '.widget-header',
    dragSortPredicate: {
      threshold: 50,
      action: 'move',
      migrateAction: 'move'
    },
    dragSortHeuristics: {
      sortInterval: 50,        // Sort every 50ms during drag
      minDragDistance: 10,
      minBounceBackAngle: 1
    },
    layout: {
      fillGaps: true,          // Fill gaps in the grid
      horizontal: false,       // Vertical flow (top to bottom)
      alignRight: false,       // Align left
      alignBottom: false,      // Align top
      rounding: true          // Round positions to avoid subpixels
    },
    layoutDuration: 300,
    layoutEasing: 'ease-out',
    dragStartPredicate: {
      distance: 10,            // Require 10px movement before drag starts (allows clicks)
      delay: 100               // 100ms delay allows clicks to register
    },
    dragRelease: {
      duration: 300,
      easing: 'ease-out'
    },
    dragPlaceholder: {
      enabled: true,
      duration: 300,
      easing: 'ease-out',
      createElement: null
    }
  });

  // Save layout on drag end
  muuriGrid.on('dragEnd', function() {
    saveLayout();
  });

  // Initial layout after DOM is ready and content may be loading
  // Use requestAnimationFrame to wait for browser paint instead of arbitrary timeout
  muuriGridReady = true;
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      // Double RAF ensures DOM has been painted before calculating layout
      if (muuriGrid && !muuriGrid._isDestroyed) {
        muuriGrid.refreshItems();
        muuriGrid.layout(true);
        loadLayout();
      }
    });
  });
}


function cycleWidgetSize(btn) {
  var item = btn.closest('.widget-item');
  if (!item) return;

  var sizes = ['small', 'medium', 'large', 'xl', 'full'];
  var current = item.dataset.size || 'medium';
  var currentIndex = sizes.indexOf(current);
  var nextIndex = (currentIndex + 1) % sizes.length;
  var newSize = sizes[nextIndex];

  // Remove all size classes
  sizes.forEach(function(s) { item.classList.remove('size-' + s); });

  // Add new size class
  item.classList.add('size-' + newSize);
  item.dataset.size = newSize;

  // Wait for browser to repaint before calculating new layout
  if (muuriGrid) {
    requestAnimationFrame(function() {
      // Refresh ALL items to recalculate dimensions after repaint
      muuriGrid.refreshItems();
      muuriGrid.layout(true); // Force synchronous layout

      // Double-check layout after another frame
      requestAnimationFrame(function() {
        muuriGrid.refreshItems();
        muuriGrid.layout(true);
        saveLayout();
      });
    });
  }
}


// Initialize resize handles
function initWidgetResizeHandles() {
  // First, add resize handle divs to all widget cards that don't have them
  var widgetCards = document.querySelectorAll('.widget-card');
  widgetCards.forEach(function(card) {
    if (!card.querySelector('.widget-resize-handle')) {
      var handle = document.createElement('div');
      handle.className = 'widget-resize-handle';
      card.appendChild(handle);
    }
  });

  var resizeHandles = document.querySelectorAll('.widget-resize-handle');

  resizeHandles.forEach(function(handle) {
    handle.addEventListener('mousedown', function(e) {
      e.stopPropagation(); // Prevent dragging widget
      e.preventDefault();

      var item = handle.closest('.widget-item');
      if (!item) return;

      var startX = e.clientX;
      var startWidth = item.offsetWidth;
      var container = document.querySelector('.widgets-grid');
      var containerWidth = container ? container.offsetWidth : window.innerWidth;

      // Disable Muuri drag during resize
      if (muuriGrid) {
        muuriGrid.getItems().forEach(function(muuri) {
          if (muuri.getElement() === item) {
            muuri._drag._startPredicate.delay = 99999;
          }
        });
      }

      function onMouseMove(e) {
        var deltaX = e.clientX - startX;
        var newWidth = startWidth + deltaX;
        var widthPercent = (newWidth / containerWidth) * 100;

        // Map width percentage to size classes
        var newSize;
        if (widthPercent < 29) newSize = 'small';        // 25%
        else if (widthPercent < 37) newSize = 'medium';  // 33%
        else if (widthPercent < 58) newSize = 'large';   // 50%
        else if (widthPercent < 75) newSize = 'xl';      // 66%
        else newSize = 'full';                            // 100%

        // Only update if size changed
        if (item.dataset.size !== newSize) {
          var sizes = ['small', 'medium', 'large', 'xl', 'full'];
          sizes.forEach(function(s) { item.classList.remove('size-' + s); });
          item.classList.add('size-' + newSize);
          item.dataset.size = newSize;

          if (muuriGrid) {
            muuriGrid.refreshItems();
            muuriGrid.layout(true);
          }
        }
      }

      function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        // Re-enable Muuri drag
        if (muuriGrid) {
          muuriGrid.getItems().forEach(function(muuri) {
            if (muuri.getElement() === item) {
              muuri._drag._startPredicate.delay = 0;
            }
          });
        }

        saveLayout();
      }

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  });
}


function toggleWidgetCollapse(btn) {
  var widget = btn.closest('.widget-card');
  if (!widget) return;

  var isCollapsed = widget.classList.toggle('collapsed');

  // Swap SVG icon between minus (collapse) and plus (expand)
  if (isCollapsed) {
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  } else {
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 12h14" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  // Debounce layout to wait for CSS animation to complete before calculating new sizes
  // This prevents layout thrashing when rapidly toggling collapse state
  // Animation typically takes 300ms, so wait 350ms before recalculating layout
  clearTimeout(collapseLayoutDebounceTimer);
  collapseLayoutDebounceTimer = setTimeout(function() {
    debouncedMuuriLayout(muuriGrid, 50);
    saveLayout();
  }, 350);
}


function hideWidget(widgetId) {
  // Guard against race condition: muuriGrid may be destroyed on mobile resize
  if (!muuriGrid || muuriGrid._isDestroyed) {
    console.log('hideWidget: Muuri grid unavailable or destroyed');
    return;
  }

  var element = document.querySelector('[data-widget-id="' + widgetId + '"]');
  if (!element) {
    console.warn('hideWidget: Element not found for widgetId:', widgetId);
    return;
  }

  // Find the Muuri item that corresponds to this element
  var items = muuriGrid.getItems();
  var targetItem = items.find(function(item) {
    return item.getElement() === element;
  });

  if (!targetItem) {
    console.warn('hideWidget: Muuri item not found for widgetId:', widgetId);
    return;
  }

  // Hide the widget with animation
  muuriGrid.hide([targetItem], {instant: false, onFinish: function() {
    // Use debounced layout to prevent thrashing with multiple hide/show operations
    // Also guards against destroyed grid in callback
    debouncedMuuriLayout(muuriGrid, 100);

    // Save layout after hide animation completes
    saveLayout();
  }});
}


function showWidget(widgetId) {
  // Guard against race condition: muuriGrid may be destroyed on mobile resize
  if (!muuriGrid || muuriGrid._isDestroyed) {
    console.log('showWidget: Muuri grid unavailable or destroyed');
    return;
  }

  var element = document.querySelector('[data-widget-id="' + widgetId + '"]');
  if (!element) {
    console.warn('showWidget: Element not found for widgetId:', widgetId);
    return;
  }

  // Find the Muuri item that corresponds to this element
  var items = muuriGrid.getItems();
  var targetItem = items.find(function(item) {
    return item.getElement() === element;
  });

  if (!targetItem) {
    console.warn('showWidget: Muuri item not found for widgetId:', widgetId);
    return;
  }

  // Show the widget with animation
  muuriGrid.show([targetItem], {instant: false, onFinish: function() {
    // Use debounced layout to prevent thrashing with multiple hide/show operations
    // Also guards against destroyed grid in callback
    debouncedMuuriLayout(muuriGrid, 100);

    // Save layout after show animation completes
    saveLayout();
  }});
}


function saveLayout() {
  if (!muuriGrid) return;

  var layout = {
    theme: document.documentElement.getAttribute('data-theme'),
    widgets: []
  };

  muuriGrid.getItems().forEach(function(item, index) {
    var el = item.getElement();
    var widget = el.querySelector('.widget-card');

    // Check if item is visible (not hidden by Muuri)
    var isVisible = !el.classList.contains('muuri-item-hidden');

    layout.widgets.push({
      id: el.dataset.widgetId,
      visible: isVisible,
      position: index,
      size: el.dataset.size || 'medium',
      collapsed: widget ? widget.classList.contains('collapsed') : false
    });
  });

  localStorage.setItem('dashboardLayout', JSON.stringify(layout));
}


function setDefaultWidgetVisibility() {
  // Default visible widgets (only the essentials)
  var defaultVisible = [
    'widget-current',      // Current production card
    'widget-hourlyChart',  // Hourly production chart
    'widget-scoreboard'    // Scoreboard integration
  ];

  var itemsToHide = [];
  muuriGrid.getItems().forEach(function(item) {
    var el = item.getElement();
    var widgetId = el.dataset.widgetId;

    if (!defaultVisible.includes(widgetId)) {
      itemsToHide.push(item);
    }
  });

  if (itemsToHide.length > 0) {
    muuriGrid.hide(itemsToHide, {instant: true});
  }

  // Force refresh and layout
  muuriGrid.refreshItems();
  muuriGrid.layout(true); // Force synchronous layout
}


function loadLayout() {
  if (!muuriGrid) return;

  try {
    var saved = localStorage.getItem('dashboardLayout');
    if (!saved) {
      // No saved layout - set default visibility (only show key widgets)
      setDefaultWidgetVisibility();
      return;
    }

    var layout = JSON.parse(saved);

    // Restore theme
    if (layout.theme) {
      document.documentElement.setAttribute('data-theme', layout.theme);
      updateThemeUI(layout.theme);
    }

    // Restore widget order, sizes, collapsed states
    if (layout.widgets && layout.widgets.length > 0) {
      // Sort items by saved position
      var sortedItems = [];
      layout.widgets.forEach(function(w) {
        var item = muuriGrid.getItems().find(function(i) {
          return i.getElement().dataset.widgetId === w.id;
        });
        if (item) {
          var el = item.getElement();

          // Restore size
          if (w.size) {
            ['small', 'medium', 'large', 'xl', 'full'].forEach(function(s) {
              el.classList.remove('size-' + s);
            });
            el.classList.add('size-' + w.size);
            el.dataset.size = w.size;
          }

          // Restore collapsed state
          var widget = el.querySelector('.widget-card');
          var collapseBtn = el.querySelector('.widget-collapse');
          if (widget && collapseBtn) {
            if (w.collapsed) {
              widget.classList.add('collapsed');
              collapseBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            } else {
              widget.classList.remove('collapsed');
              collapseBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 12h14" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            }
          }

          sortedItems.push(item);
        }
      });

      // Apply order
      if (sortedItems.length > 0) {
        muuriGrid.sort(sortedItems, {layout: false});
      }

      // Hide widgets that should be hidden
      var itemsToHide = [];
      layout.widgets.forEach(function(w) {
        if (!w.visible) {
          var item = muuriGrid.getItems().find(function(i) {
            return i.getElement().dataset.widgetId === w.id;
          });
          if (item) itemsToHide.push(item);
        }
      });
      if (itemsToHide.length > 0) {
        muuriGrid.hide(itemsToHide, {instant: true});
      }

      // Refresh and layout - force synchronous layout
      muuriGrid.refreshItems();
      muuriGrid.layout(true);
    }
  } catch(e) {
    console.error('Error loading layout:', e);
  }
}


function resetLayout() {
  // Clear all layout-related localStorage keys
  localStorage.removeItem('dashboardLayout');
  localStorage.removeItem('roHubSettingsV2');
  localStorage.removeItem('roHubWidgetOrder');
  localStorage.removeItem('kpiOrder');
  
  // Clean up Muuri instances before reload to prevent memory leaks
  if (muuriGrid && !muuriGrid._isDestroyed) {
    try { muuriGrid.destroy(); } catch(e) { console.warn('Error destroying muuriGrid:', e); }
    muuriGrid = null;
  }
  if (muuriKPI && !muuriKPI._isDestroyed) {
    try { muuriKPI.destroy(); } catch(e) { console.warn('Error destroying muuriKPI:', e); }
    muuriKPI = null;
  }
  
  showToast('Layout reset to default', 'success');
  setTimeout(function() { location.reload(); }, 800);
}


function explicitSaveLayout() {
  saveLayout();
  showToast('Layout saved successfully', 'success');
}


// Initialize Muuri for both KPI cards and widgets
function initSortable() {
  initMuuriGrid();
  initMuuriKPI();
  initWidgetResizeHandles(); // Initialize corner resize handles
}


function initMuuriKPI() {
  var container = document.getElementById('kpiRow');
  if (!container || typeof Muuri === 'undefined') {
    console.warn('Muuri not available for KPI or container not found');
    return;
  }

  // Skip Muuri on mobile - use static CSS grid instead (prevents overlaps)
  if (window.innerWidth < 600) {
    console.log('Mobile detected - using static CSS grid for KPI cards');
    return;
  }

  // Don't reinitialize if already exists
  if (muuriKPI) { // MARKER1
    muuriKPI.refreshItems();
    muuriKPI.layout(true);
    return;
  }

  muuriKPI = new Muuri(container, {
    dragEnabled: true,
    dragSortPredicate: {
      threshold: 50,
      action: 'move',
      migrateAction: 'move'
    },
    dragSortHeuristics: {
      sortInterval: 50,        // Sort every 50ms during drag
      minDragDistance: 10,
      minBounceBackAngle: 1
    },
    layout: {
      fillGaps: true,          // Fill gaps in the grid
      horizontal: false,       // Vertical flow (top to bottom)
      alignRight: false,       // Align left
      alignBottom: false,      // Align top
      rounding: true           // Round positions to avoid subpixels
    },
    layoutDuration: 300,
    layoutEasing: 'ease-out',
    layoutOnResize: true,      // Re-layout on window resize
    dragStartPredicate: {
      distance: 10,            // Require 10px movement before drag starts (allows clicks)
      delay: 100               // 100ms delay allows clicks to register
    },
    dragRelease: {
      duration: 300,
      easing: 'ease-out'
    },
    dragPlaceholder: {
      enabled: true,
      duration: 300,
      easing: 'ease-out',
      createElement: null
    }
  });

  // Refresh layout during drag for smooth repositioning
  muuriKPI.on('dragStart', function() {
    muuriKPI.refreshItems();
  });

  muuriKPI.on('move', function() {
    muuriKPI.refreshItems();
  });

  // Save order and ensure clean layout on drag end
  muuriKPI.on('dragEnd', function() {
    muuriKPI.refreshItems();
    muuriKPI.layout(true);
    saveKPIOrder();
  });

  // Additional layout refresh after drag release completes
  muuriKPI.on('layoutEnd', function() {
    muuriKPI.refreshItems();
  });

  // Initial layout - use requestAnimationFrame to wait for browser paint
  // This replaces arbitrary 500ms timeout with condition-based waiting
  muuriKPIReady = true;
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      // Double RAF ensures DOM has been painted
      if (muuriKPI && !muuriKPI._isDestroyed) {
        muuriKPI.refreshItems();
        muuriKPI.layout(true);
        loadKPIOrder();
      }
    });
  });
}


function saveKPIOrder() {
  if (!muuriKPI) return;

  var order = muuriKPI.getItems().map(function(item) {
    return item.getElement().dataset.kpi;
  });

  localStorage.setItem('kpiOrder', JSON.stringify(order));
}


function loadKPIOrder() {
  if (!muuriKPI) return;

  try {
    var saved = localStorage.getItem('kpiOrder');
    if (!saved) return;

    var order = JSON.parse(saved);
    var sortedItems = [];

    order.forEach(function(kpiId) {
      var item = muuriKPI.getItems().find(function(i) {
        return i.getElement().dataset.kpi === kpiId;
      });
      if (item) sortedItems.push(item);
    });

    if (sortedItems.length > 0) {
      muuriKPI.sort(sortedItems, {layout: true});
    }
  } catch(e) {
    console.error('Error loading KPI order:', e);
  }
}


function restoreWidgetOrder() {
  // Handled by loadLayout() in Muuri system
}


function toggleEditMode() {
  editMode = !editMode;
  var editModeBtn = document.getElementById('editModeBtn');
  var kpiRow = document.getElementById('kpiRow');
  var widgetsContainer = document.getElementById('widgetsContainer');
  if (editModeBtn) editModeBtn.classList.toggle('active', editMode);
  if (kpiRow) kpiRow.classList.toggle('edit-mode', editMode);
  if (widgetsContainer) widgetsContainer.classList.toggle('edit-mode', editMode);

  // Muuri drag is always enabled, no need to toggle
}


// Date & Compare functions
function toggleDatePicker() {
  var dropdown = document.getElementById('datePickerDropdown');
  var trigger = document.getElementById('datePickerTrigger');
  if (!dropdown) return;
  dropdown.classList.toggle('open');
  var isOpen = dropdown.classList.contains('open');
  if (trigger) trigger.setAttribute('aria-expanded', isOpen);
}

function toggleCompareDropdown() {
  var dropdown = document.getElementById('compareDropdown');
  var trigger = document.getElementById('compareBtn');
  if (!dropdown) return;
  dropdown.classList.toggle('open');
  var isOpen = dropdown.classList.contains('open');
  if (trigger) trigger.setAttribute('aria-expanded', isOpen);
}


function setDateRange(range) {
  currentRange = range;
  document.querySelectorAll('.date-chip').forEach(function(c) { c.classList.toggle('active', c.dataset.range === range); });
  var today = new Date(), start, end, label;
  if (range === 'today') { start = end = formatDateInput(today); label = 'Today'; }
  else if (range === 'yesterday') { var y = new Date(today); y.setDate(y.getDate()-1); start = end = formatDateInput(y); label = 'Yesterday'; }
  else if (range === 'week') { var w = new Date(today); w.setDate(w.getDate()-6); start = formatDateInput(w); end = formatDateInput(today); label = 'Last 7 Days'; }
  else if (range === 'month') { var m = new Date(today); m.setDate(m.getDate()-29); start = formatDateInput(m); end = formatDateInput(today); label = 'Last 30 Days'; }
  var startDateEl = document.getElementById('startDate');
  var endDateEl = document.getElementById('endDate');
  var datePickerLabel = document.getElementById('datePickerLabel');
  if (startDateEl) startDateEl.value = start;
  if (endDateEl) endDateEl.value = end;
  if (datePickerLabel) datePickerLabel.textContent = label;
  customStartDate = start; customEndDate = end;
  var datePickerDropdownEl = document.getElementById('datePickerDropdown');
  if (datePickerDropdownEl) datePickerDropdownEl.classList.remove('open');
  // Keep old data visible until new data arrives - removed data = null reset
  if (compareMode) loadCompareData(); else loadData();
}


function applyCustomRange() {
  currentRange = 'custom';
  document.querySelectorAll('.date-chip').forEach(function(c) { c.classList.remove('active'); });
  customStartDate = document.getElementById('startDate').value;
  customEndDate = document.getElementById('endDate').value;
  if (!customStartDate || !customEndDate) { alert('Select both dates'); return; }
  var datePickerLabelEl = document.getElementById('datePickerLabel');
  var datePickerDropdownEl = document.getElementById('datePickerDropdown');
  if (datePickerLabelEl) datePickerLabelEl.textContent = formatDateShort(customStartDate) + ' - ' + formatDateShort(customEndDate);
  if (datePickerDropdownEl) datePickerDropdownEl.classList.remove('open');
  // Keep old data visible until new data arrives - removed data = null reset
  if (compareMode) loadCompareData(); else loadData();
}


function setCompare(mode) {
  compareMode = mode;
  var compareDropdownEl = document.getElementById('compareDropdown');
  var compareBtnEl = document.getElementById('compareBtn');
  if (compareDropdownEl) compareDropdownEl.classList.remove('open');
  if (compareBtnEl) compareBtnEl.classList.add('active');
  document.body.classList.add('compare-mode');
  var today = new Date(), currentLabel, prevLabel;
  if (mode === 'yesterday') { currentLabel = 'Today'; prevLabel = 'Yesterday'; customStartDate = customEndDate = formatDateInput(today); }
  else if (mode === 'lastWeek') { var ws = new Date(today); ws.setDate(today.getDate()-today.getDay()); currentLabel = 'This Week'; prevLabel = 'Last Week'; customStartDate = formatDateInput(ws); customEndDate = formatDateInput(today); }
  else if (mode === 'lastMonth') { var ms = new Date(today.getFullYear(), today.getMonth(), 1); currentLabel = 'This Month'; prevLabel = 'Last Month'; customStartDate = formatDateInput(ms); customEndDate = formatDateInput(today); }
  var compareCurrentEl = document.getElementById('compareCurrent');
  var comparePreviousEl = document.getElementById('comparePrevious');
  var compareBannerEl = document.getElementById('compareBanner');
  var datePickerLabelEl2 = document.getElementById('datePickerLabel');
  if (compareCurrentEl) compareCurrentEl.textContent = currentLabel;
  if (comparePreviousEl) comparePreviousEl.textContent = prevLabel;
  if (compareBannerEl) compareBannerEl.classList.add('active');
  if (datePickerLabelEl2) datePickerLabelEl2.textContent = currentLabel + ' vs ' + prevLabel;
  // Keep old data visible until new data arrives - removed data = null reset
  loadCompareData();
}


function clearCompare() {
  compareMode = null; compareData = null;
  var compareBtnEl = document.getElementById('compareBtn');
  var compareBannerEl = document.getElementById('compareBanner');
  var datePickerLabelEl = document.getElementById('datePickerLabel');
  if (compareBtnEl) compareBtnEl.classList.remove('active');
  document.body.classList.remove('compare-mode');
  if (compareBannerEl) compareBannerEl.classList.remove('active');
  if (datePickerLabelEl) datePickerLabelEl.textContent = currentRange === 'today' ? 'Today' : formatDateShort(customStartDate) + ' - ' + formatDateShort(customEndDate);
  loadData(); renderCharts();
}


function loadCompareData() {
  // Only show skeletons on initial load (no existing data)
  if (!data) {
    showSkeletons(true);
  }
  var today = new Date();
  var cs, ce, ps, pe;
  if (compareMode === 'yesterday') {
    cs = ce = formatDateInput(today);
    var y = new Date(today); y.setDate(y.getDate()-1);
    ps = pe = formatDateInput(y);
  } else if (compareMode === 'lastWeek') {
    var ws = new Date(today); ws.setDate(today.getDate()-today.getDay());
    cs = formatDateInput(ws); ce = formatDateInput(today);
    var pws = new Date(ws); pws.setDate(pws.getDate()-7);
    var pwe = new Date(pws); pwe.setDate(pwe.getDate()+6);
    ps = formatDateInput(pws); pe = formatDateInput(pwe);
  } else if (compareMode === 'lastMonth') {
    var ms = new Date(today.getFullYear(), today.getMonth(), 1);
    cs = formatDateInput(ms); ce = formatDateInput(today);
    var pms = new Date(today.getFullYear(), today.getMonth()-1, 1);
    var pme = new Date(today.getFullYear(), today.getMonth(), 0);
    ps = formatDateInput(pms); pe = formatDateInput(pme);
  }
  
  if (isAppsScript) {
    // Apps Script mode
    google.script.run.withSuccessHandler(function(r) {
    google.script.run.withSuccessHandler(function(pr) {
      document.getElementById('loadingOverlay').classList.add('hidden');
      showSkeletons(false);
      
      // Only re-render if data actually changed
      var newDataStr = JSON.stringify(r) + JSON.stringify(pr);
      var oldDataStr = (data ? JSON.stringify(data) : '') + (compareData ? JSON.stringify(compareData) : '');
      
      if (newDataStr !== oldDataStr) {
        data = r;
        compareData = pr;
        renderAll();
      }
    }).withFailureHandler(onError).getProductionDashboardData(ps, pe);
  }).withFailureHandler(onError).getProductionDashboardData(cs, ce);
  } else {
    // GitHub Pages mode - use fetch helper
    loadCompareDataFetch(cs, ce, ps, pe);
  }
}


function loadCompareDataFetch(cs, ce, ps, pe) {
  // Cancel any in-flight fetch requests to prevent stale data from overwriting current data
  // This fixes race conditions when user rapidly changes compare mode
  if (currentFetchController) {
    currentFetchController.abort();
  }
  currentFetchController = new AbortController();
  var signal = currentFetchController.signal;

  Promise.all([
    fetch(API_URL + '?action=dashboard&start=' + encodeURIComponent(cs) + '&end=' + encodeURIComponent(ce), { signal: signal }).then(function(r) { return r.json(); }),
    fetch(API_URL + '?action=dashboard&start=' + encodeURIComponent(ps) + '&end=' + encodeURIComponent(pe), { signal: signal }).then(function(r) { return r.json(); })
  ]).then(function(results) {
    document.getElementById('loadingOverlay').classList.add('hidden');
    showSkeletons(false);
    
    var currentResult = results[0].success ? results[0].data : null;
    var prevResult = results[1].success ? results[1].data : null;
    
    var newDataStr = JSON.stringify(currentResult) + JSON.stringify(prevResult);
    var oldDataStr = (data ? JSON.stringify(data) : '') + (compareData ? JSON.stringify(compareData) : '');
    
    if (newDataStr !== oldDataStr) {
      data = currentResult;
      compareData = prevResult;
      renderAll();
    }
  }).catch(function(error) {
    // Ignore AbortError - this is expected when request is cancelled
    if (error.name === 'AbortError') {
      console.log('Compare fetch aborted - newer request in progress');
      return;
    }
    onError(error);
  });
}

// Utility functions
function formatDateInput(d) { 
  var year = d.getFullYear();
  var month = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function formatDateShort(s) { 
  var parts = s.split('-');
  var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); 
}

function updateClock() {
  var n = new Date();
  var clockEl = document.getElementById('clock');
  var dateDisplayEl = document.getElementById('dateDisplay');
  if (clockEl) clockEl.textContent = (n.getHours()%12||12) + ':' + n.getMinutes().toString().padStart(2,'0') + ' ' + (n.getHours()>=12?'PM':'AM');
  if (dateDisplayEl) dateDisplayEl.textContent = n.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}


// Welcome greeting based on time of day
function updateWelcome() {
  var h = new Date().getHours();
  var greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  var welcomeGreetingEl = document.getElementById('welcomeGreeting');
  var welcomeDateEl = document.getElementById('welcomeDate');
  if (welcomeGreetingEl) welcomeGreetingEl.textContent = greeting;
  var opts = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
  if (welcomeDateEl) welcomeDateEl.textContent = new Date().toLocaleDateString('en-US', opts);
}


// Animate number values
function animateValue(id, start, end, duration) {
  var el = document.getElementById(id);
  if (!el) return;
  el.classList.add('animate-value');
  var startTime = null;
  var isDecimal = String(end).includes('.') || end % 1 !== 0;
  function step(timestamp) {
    if (!startTime) startTime = timestamp;
    var progress = Math.min((timestamp - startTime) / duration, 1);
    var current = start + (end - start) * progress;
    el.textContent = isDecimal ? current.toFixed(2) : Math.floor(current);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}


// ===== SETTINGS PANEL =====
function toggleSettings() {
  var panel = document.getElementById('settingsPanel');
  var aiChat = document.getElementById('aiChatPanel');

  // Close AI chat if open
  if (aiChat && aiChat.classList.contains('open')) {
    aiChat.classList.remove('open');
  }

  // Refresh widget toggles to reflect current visibility
  renderWidgetToggles();
  renderKPIToggles();

  // Toggle settings
  if (panel) {
    panel.classList.toggle('open');
  }
}


function openSettings() {
  // Refresh widget toggles to reflect current visibility
  renderWidgetToggles();
  renderKPIToggles();

  var panel = document.getElementById('settingsPanel');
  if (panel) panel.classList.add('open');
}


function closeSettings() {
  var panel = document.getElementById('settingsPanel');
  if (panel) panel.classList.remove('open');
}


// ===== AI CHAT PANEL =====
function toggleAIChat() {
  var panel = document.getElementById('aiChatPanel');
  var settings = document.getElementById('settingsPanel');

  // Close settings if open
  if (settings && settings.classList.contains('open')) {
    settings.classList.remove('open');
  }

  // Toggle AI chat
  if (panel) {
    panel.classList.toggle('open');

    // Auto-focus input when opening
    if (panel.classList.contains('open')) {
      var input = document.getElementById('aiInput');
      if (input) setTimeout(function() { input.focus(); }, 300);
    }
  }
}


function sendAIMessage() {
  var input = document.getElementById('aiInput');
  var messagesContainer = document.getElementById('aiMessages');
  if (!input || !messagesContainer) return;

  var message = input.value.trim();
  if (!message) return;

  // Add user message
  var userMsg = document.createElement('div');
  userMsg.className = 'ai-message user';
  userMsg.textContent = message;
  messagesContainer.appendChild(userMsg);

  // Clear input
  input.value = '';

  // Show typing indicator
  var typingDiv = document.createElement('div');
  typingDiv.className = 'ai-typing';
  typingDiv.innerHTML = '<span></span><span></span><span></span>';
  messagesContainer.appendChild(typingDiv);

  // Scroll to bottom
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  // Send to backend
  var requestData = {
    message: message,
    context: {
      date: new Date().toISOString(),
      data: data || {}
    }
  };

  // Call API (Apps Script or Web App)
  if (isAppsScript) {
    google.script.run
      .withSuccessHandler(function(response) {
        typingDiv.remove();
        var assistantMsg = document.createElement('div');
        assistantMsg.className = 'ai-message assistant';
        assistantMsg.textContent = response.message || response;
        messagesContainer.appendChild(assistantMsg);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      })
      .withFailureHandler(function(error) {
        typingDiv.remove();
        var errorMsg = document.createElement('div');
        errorMsg.className = 'ai-message assistant';
        errorMsg.textContent = 'Sorry, I\'m having trouble connecting right now. Please try again.';
        messagesContainer.appendChild(errorMsg);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      })
      .handleChatRequest(requestData);
  } else {
    fetch(API_URL + '?action=chat', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(requestData)
    })
    .then(function(r) { return r.json(); })
    .then(function(response) {
      typingDiv.remove();
      var assistantMsg = document.createElement('div');
      assistantMsg.className = 'ai-message assistant';
      assistantMsg.textContent = response.message || 'I received your message!';
      messagesContainer.appendChild(assistantMsg);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    })
    .catch(function(error) {
      typingDiv.remove();
      var errorMsg = document.createElement('div');
      errorMsg.className = 'ai-message assistant';
      errorMsg.textContent = 'Sorry, I\'m having trouble connecting right now. Please try again.';
      messagesContainer.appendChild(errorMsg);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });
  }
}


// Charts
// Cleanup existing chart instances to prevent memory leaks
function destroyChartIfExists(chartInstance) {
  if (chartInstance && typeof chartInstance.destroy === 'function') {
    chartInstance.destroy();
  }
  return null;
}

function initCharts() {
  // Destroy any existing charts first to prevent memory leaks
  hourlyChart = destroyChartIfExists(hourlyChart);
  rateChart = destroyChartIfExists(rateChart);
  dailyChart = destroyChartIfExists(dailyChart);
  dailyRateChart = destroyChartIfExists(dailyRateChart);
  trimmersChart = destroyChartIfExists(trimmersChart);

  // Register datalabels plugin
  Chart.register(ChartDataLabels);

  // Get chart colors based on current theme
  function getChartColors() {
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    return {
      grid: theme === 'dark' ? 'rgba(168, 181, 169, 0.08)' : 'rgba(102, 137, 113, 0.06)',
      text: theme === 'dark' ? '#a8b5a9' : '#5a6b5f',
      labelBg: theme === 'dark' ? '#252b22' : '#fff',
      // Botanical color gradients
      greenGradient: ['#668971', '#8ba896'],
      goldGradient: ['#e4aa4f', '#f0cb60']
    };
  }

  // Botanical grid configuration (hemp fiber dashed lines)
  var botanicalGrid = {
    color: function() { return getChartColors().grid; },
    borderDash: [3, 3],
    lineWidth: 1,
    drawBorder: false,
    drawTicks: false
  };

  // Botanical scale configuration
  var botanicalScale = {
    grid: botanicalGrid,
    ticks: {
      font: { size: 11, family: 'JetBrains Mono, monospace' },
      color: function() { return getChartColors().text; },
      padding: 8
    }
  };
  
  // Common datalabels config for bar charts
  var barDataLabels = {
    display: function(ctx) { return ctx.dataset.data[ctx.dataIndex] > 0; },
    color: '#fff',
    font: { weight: 'bold', size: 11 },
    anchor: 'center',
    align: 'center',
    formatter: function(value) { return value > 0 ? value.toFixed(1) : ''; }
  };
  
  // Common legend config
  var legendConfig = { display: true, position: 'top', align: 'end', labels: { boxWidth: 12, boxHeight: 12, padding: 12, font: { size: 12, weight: '500' }, usePointStyle: true, pointStyle: 'circle' } };
  
  // Target line dataset (for daily production)
  var targetLineDataset = {
    label: 'Target',
    data: [],
    borderColor: '#c45c4a',
    borderDash: [8, 4],
    borderWidth: 2,
    type: 'line',
    fill: false,
    pointRadius: 0,
    order: 0,
    datalabels: { display: false }
  };
  
  var hourlyCtx = safeGetChartContext('hourlyChart');
  if (hourlyCtx) {
    hourlyChart = new Chart(hourlyCtx, {
    type: 'bar',
    data: { labels: [], datasets: [
      { label: 'Tops', data: [], backgroundColor: brandColors.green, borderRadius: 4, borderWidth: 0 },
      { label: 'Smalls', data: [], backgroundColor: brandColors.sungrown, borderRadius: 4, borderWidth: 0 }
    ] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: legendConfig, datalabels: barDataLabels },
      scales: {
        x: { grid: { display: false }, ticks: botanicalScale.ticks },
        y: Object.assign({ beginAtZero: true }, botanicalScale)
      }
    }
  });

  var rateCtx = safeGetChartContext('rateChart');
  if (rateCtx) rateChart = new Chart(rateCtx, {
    type: 'line',
    data: { labels: [], datasets: [
      {
        label: 'Rate',
        data: [],
        borderColor: brandColors.green,
        backgroundColor: brandColors.greenLight,
        fill: true,
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: brandColors.green,
        pointBorderColor: '#fff',
        pointBorderWidth: 2
      },
      {
        label: 'Prev',
        data: [],
        borderColor: brandColors.indoor,
        borderDash: [5, 5],
        backgroundColor: 'transparent',
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0,
        hidden: true
      }
    ] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, datalabels: { display: false } },
      scales: {
        y: Object.assign({ beginAtZero: true }, botanicalScale),
        x: { grid: { display: false }, ticks: botanicalScale.ticks }
      }
    }
  });
  
  var dailyCtx = safeGetChartContext('dailyChart');
  if (dailyCtx) dailyChart = new Chart(dailyCtx, {
    type: 'bar',
    data: { labels: [], datasets: [
      { label: 'Tops', data: [], backgroundColor: brandColors.green, borderRadius: 4, borderWidth: 0 },
      { label: 'Smalls', data: [], backgroundColor: brandColors.sungrown, borderRadius: 4, borderWidth: 0 },
      {
        label: 'Target (' + dailyTarget + ' lbs)',
        data: [],
        borderColor: '#c45c4a',
        borderDash: [8, 4],
        borderWidth: 2,
        type: 'line',
        fill: false,
        pointRadius: 0,
        order: 0,
        tension: 0.4,
        datalabels: { display: false }
      }
    ] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: legendConfig, datalabels: barDataLabels },
      scales: {
        x: { grid: { display: false }, ticks: botanicalScale.ticks },
        y: Object.assign({ beginAtZero: true }, botanicalScale)
      }
    }
  });
  
  var dailyRateCtx = safeGetChartContext('dailyRateChart');
  if (dailyRateCtx) dailyRateChart = new Chart(dailyRateCtx, {
    type: 'line',
    data: { labels: [], datasets: [
      {
        label: 'Rate',
        data: [],
        borderColor: brandColors.green,
        backgroundColor: brandColors.greenLight,
        fill: true,
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: brandColors.green,
        pointBorderColor: '#fff',
        pointBorderWidth: 2
      },
      {
        label: '7d MA',
        data: [],
        borderColor: brandColors.gold,
        borderDash: [5, 5],
        fill: false,
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: brandColors.gold,
        pointBorderColor: '#fff',
        pointBorderWidth: 2
      }
    ] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: legendConfig, datalabels: { display: false } },
      scales: {
        y: Object.assign({ beginAtZero: true }, botanicalScale),
        x: { grid: { display: false }, ticks: botanicalScale.ticks }
      }
    }
  });
  
  // Trimmers on Line chart
  var trimmersCtx = safeGetChartContext('trimmersChart');
  if (trimmersCtx) trimmersChart = new Chart(trimmersCtx, {
    type: 'bar',
    data: { labels: [], datasets: [
      { label: 'Trimmers', data: [], backgroundColor: brandColors.green, borderRadius: 4, borderWidth: 0, order: 2 },
      {
        label: 'Average',
        data: [],
        borderColor: brandColors.gold,
        borderDash: [6, 4],
        borderWidth: 2,
        type: 'line',
        fill: false,
        pointRadius: 0,
        order: 1,
        tension: 0.4
      }
    ] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: legendConfig,
        datalabels: {
          display: function(ctx) { return ctx.datasetIndex === 0 && ctx.dataset.data[ctx.dataIndex] > 0; },
          color: '#fff',
          font: { weight: 'bold', size: 11 },
          anchor: 'center',
          align: 'center',
          formatter: function(value) { return value > 0 ? Math.round(value) : ''; }
        }
      },
      scales: {
        y: Object.assign({
          beginAtZero: true,
          title: { display: true, text: 'Trimmers', font: { size: 10, family: 'JetBrains Mono, monospace' } }
        }, botanicalScale),
        x: { grid: { display: false }, ticks: botanicalScale.ticks }
      }
    }
    });
  }

  // Mark charts as initialized - prevents race conditions with data loading
  chartsInitialized = true;
}


// Data loading
function loadData() {
  var s = customStartDate || document.getElementById('startDate').value;
  var e = customEndDate || document.getElementById('endDate').value;
  // Only show skeletons on initial load (no existing data)
  if (!data) {
    showSkeletons(true);
  }

  // Cancel any in-flight fetch requests to prevent stale data from overwriting current data
  // This fixes race conditions when user rapidly changes date range
  if (currentFetchController) {
    currentFetchController.abort();
  }
  currentFetchController = new AbortController();
  var signal = currentFetchController.signal;

  if (isAppsScript) {
    // Apps Script mode - no AbortController support, but requests are less likely to overlap
    google.script.run.withSuccessHandler(onDataLoaded).withFailureHandler(onError).getProductionDashboardData(s, e);
  } else {
    // GitHub Pages mode - use API with AbortController signal
    fetch(API_URL + '?action=dashboard&start=' + encodeURIComponent(s) + '&end=' + encodeURIComponent(e), { signal: signal })
      .then(function(response) { return response.json(); })
      .then(function(result) {
        if (result.success && result.data) {
          onDataLoaded(result.data);
        } else {
          onError(result.error || 'Unknown error');
        }
      })
      .catch(function(error) {
        // Ignore AbortError - this is expected when request is cancelled
        if (error.name === 'AbortError') {
          console.log('Fetch aborted - newer request in progress');
          return;
        }
        onError(error);
      });
  }
}


function refreshData() {
  // Add subtle visual feedback
  var heroNumber = document.getElementById('heroProductionNumber');
  if (heroNumber) {
    heroNumber.style.transition = 'transform 0.3s, text-shadow 0.3s';
    heroNumber.style.transform = 'scale(1.05)';
    heroNumber.style.textShadow = '0 0 60px rgba(228, 170, 79, 0.6), 0 0 100px rgba(228, 170, 79, 0.3)';

    setTimeout(function() {
      heroNumber.style.transform = 'scale(1)';
      heroNumber.style.textShadow = '0 0 40px rgba(228, 170, 79, 0.4), 0 0 80px rgba(228, 170, 79, 0.2)';
    }, 300);
  }

  if (compareMode) loadCompareData(); else loadData();
}


function onDataLoaded(r) {
  var loadingOverlay = document.getElementById('loadingOverlay');
  if (loadingOverlay) loadingOverlay.classList.add('hidden');
  showSkeletons(false);

  // Only re-render if data actually changed
  var newDataStr = JSON.stringify(r);
  var oldDataStr = data ? JSON.stringify(data) : '';
  var isFirstLoad = !oldDataStr;

  if (newDataStr !== oldDataStr) {
    data = r;
    renderAll();

    // Show subtle update notification (only on auto-refresh, not initial load)
    if (oldDataStr) {
      showToast('Data updated', 'success', 2000);
    }

    // Show welcome modal on first load (if tutorial not completed)
    if (isFirstLoad) {
      setTimeout(function() {
        var tutorialCompleted = localStorage.getItem('tutorialCompleted');
        if (!tutorialCompleted) {
          showWelcomeModal();
        }
      }, 1000);
    }
  }
}


function onError(e) {
  console.error(e);
  var loadingOverlay = document.getElementById('loadingOverlay');
  if (loadingOverlay) loadingOverlay.classList.add('hidden');
  showSkeletons(false);
  showToast('Error loading data: ' + (e.message || e), 'error');
}


// Toast notification system
function showToast(message, type, duration) {
  type = type || 'info';
  duration = duration || 4000;
  var container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  var toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(function() {
    toast.classList.add('hiding');
    setTimeout(function() { toast.remove(); }, 300);
  }, duration);
}


function showSkeletons(show) {
  // KPI cards
  document.querySelectorAll('.kpi-card').forEach(function(card) {
    if (show) card.classList.add('loading');
    else card.classList.remove('loading');
  });

  // Refresh Muuri KPI layout after removing loading state
  // Use debounced layout to prevent race conditions with data rendering
  if (!show) {
    debouncedKPILayout(100);
  }
  // Chart containers
  document.querySelectorAll('.chart-container').forEach(function(c) {
    if (show) {
      c.style.opacity = '0.4';
    } else {
      c.style.opacity = '1';
    }
  });
  // Current production stats
  document.querySelectorAll('.current-stat-value').forEach(function(v) {
    if (show) {
      v.dataset.originalText = v.textContent;
      v.innerHTML = '<span class="skeleton" style="display:inline-block;width:50px;height:24px;border-radius:4px"></span>';
    } else if (v.dataset.originalText) {
      v.textContent = v.dataset.originalText;
    }
  });
  // Integration stat values
  document.querySelectorAll('.integration-stat-value').forEach(function(v) {
    if (show) {
      v.dataset.originalText = v.textContent;
      v.innerHTML = '<span class="skeleton" style="display:inline-block;width:30px;height:14px;border-radius:3px"></span>';
    } else if (v.dataset.originalText) {
      v.textContent = v.dataset.originalText;
    }
  });
  // Strain list
  var strainList = document.getElementById('strainList');
  if (strainList && show) {
    strainList.innerHTML = '<div class="skeleton" style="height:24px;margin-bottom:6px"></div><div class="skeleton" style="height:24px;margin-bottom:6px"></div><div class="skeleton" style="height:24px;margin-bottom:6px"></div><div class="skeleton" style="height:24px"></div>';
  }
  // Tables
  ['perfTable', 'costTable', 'periodTable'].forEach(function(id) {
    var tbl = document.getElementById(id);
    if (tbl && show) {
      tbl.innerHTML = '<div class="skeleton" style="height:20px;margin-bottom:8px"></div><div class="skeleton" style="height:20px;margin-bottom:8px"></div><div class="skeleton" style="height:20px"></div>';
    }
  });
}


function renderAll() {
  // Wrap each render call in try-catch to prevent cascading failures
  var renderFunctions = [
    { name: 'renderDateDisplay', fn: renderDateDisplay },
    { name: 'renderHero', fn: renderHero },
    { name: 'renderKPIs', fn: renderKPIs },
    { name: 'renderCurrentProduction', fn: renderCurrentProduction },
    { name: 'renderCharts', fn: renderCharts },
    { name: 'renderTrimmersChart', fn: renderTrimmersChart },
    { name: 'renderSparkline', fn: renderSparkline },
    { name: 'renderStrainList', fn: renderStrainList },
    { name: 'renderTables', fn: renderTables },
    { name: 'renderIntegrationWidgets', fn: renderIntegrationWidgets }
  ];

  renderFunctions.forEach(function(item) {
    try {
      item.fn();
    } catch (e) {
      console.error('Error in ' + item.name + ':', e);
    }
  });

  // Refresh Muuri layout after content is rendered
  // Use debounced layout to consolidate multiple setTimeout calls into single pass
  // This prevents layout thrashing when multiple render functions trigger layouts
  debouncedMuuriLayout(muuriGrid, 250);
}


function renderDateDisplay() {
  if (!data || !data.dateRange) return;
  var d = document.getElementById('dateRangeDisplay'), s = data.dateRange.start, e = data.dateRange.end;
  if (compareMode) {
    d.innerHTML = 'Comparing <strong>' + document.getElementById('compareCurrent').textContent + '</strong> vs <strong>' + document.getElementById('comparePrevious').textContent + '</strong>';
  } else if (s === e) {
    d.innerHTML = 'Showing data for <strong>' + formatDateShort(s) + '</strong>';
  } else {
    d.innerHTML = 'Showing <strong>' + formatDateShort(s) + '</strong> to <strong>' + formatDateShort(e) + '</strong>';
  }
}


// Count-up animation utility
function animateCountUp(element, targetValue, decimals, duration) {
  if (!element) return;
  decimals = decimals || 0;
  duration = duration || 1200;

  var startValue = 0;
  var startTime = null;

  function step(timestamp) {
    if (!startTime) startTime = timestamp;
    var progress = Math.min((timestamp - startTime) / duration, 1);

    // Ease-out cubic for smooth deceleration
    var easeProgress = 1 - Math.pow(1 - progress, 3);
    var currentValue = startValue + (targetValue - startValue) * easeProgress;

    element.textContent = currentValue.toFixed(decimals);

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      element.textContent = targetValue.toFixed(decimals);
    }
  }

  requestAnimationFrame(step);
}


function renderHero() {
  if (!data || !data.today) return;
  var t = data.today;

  // Get DOM elements with null checks
  var elHeroProduction = document.getElementById('heroProductionNumber');
  var elHeroSubtitle = document.getElementById('heroSubtitle');
  var elHeroProgressFill = document.getElementById('heroProgressFill');
  var elHeroProgressText = document.getElementById('heroProgressText');
  var elHeroCrewValue = document.getElementById('heroCrewValue');
  var elHeroRateValue = document.getElementById('heroRateValue');
  var elHeroTargetValue = document.getElementById('heroTargetValue');
  var elHeroBagsValue = document.getElementById('heroBagsValue');
  var elHeroStrain = document.getElementById('heroStrain');

  // Production number (the star) - TOPS production (primary focus)
  var tops = t.totalTops || 0;
  var smalls = t.totalSmalls || 0;
  var totalProduction = t.totalLbs || 0;
  if (elHeroProduction) animateCountUp(elHeroProduction, tops, 1, 1200);

  // Current strain (from data.current which has the last hour's data)
  var strain = (data.current && data.current.strain) || '';
  if (elHeroStrain) elHeroStrain.textContent = strain;


  // Subtitle with total and smalls breakdown
  if (elHeroSubtitle) elHeroSubtitle.textContent = 'Total: ' + totalProduction.toFixed(1) + ' lbs (incl. ' + smalls.toFixed(1) + ' lbs smalls)';

  // Time-aware production prediction
  // Uses current trimmer count and historical target rate for prediction
  var trimmers = t.trimmers || 0;
  var todayRate = t.avgRate || 0;
  // Use historical target rate for prediction (more reliable than today's partial data)
  var targetRate = (data.targets && data.targets.avgRate) || 1.0;
  var predictedRate = targetRate;

  // Calculate time-aware expectations
  var productiveHoursElapsed = getProductiveHoursElapsed();
  var totalProductiveHours = getTotalProductiveHours(); // 8.5 hours

  // Expected production so far (based on current time and trimmer count)
  var expectedSoFar = trimmers * predictedRate * productiveHoursElapsed;

  // Predicted end-of-day total (based on current trimmer count)
  var predictedTops = trimmers * predictedRate * totalProductiveHours;

  // Progress bar: compare actual vs expected for current time (time-aware)
  var progressPercent = 0;
  var progressStatus = '';
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
  var crew = (t.trimmers || 0) + (t.buckers || 0) + (t.qc || 0) + (t.tzero || 0);
  if (elHeroCrewValue) elHeroCrewValue.textContent = crew;

  if (elHeroRateValue) elHeroRateValue.textContent = rate.toFixed(2);

  // Display predicted tops outcome (using already calculated predictedTops from above)
  if (elHeroTargetValue) {
    if (predictedTops > 0) {
      elHeroTargetValue.textContent = predictedTops.toFixed(0) + ' lbs';
    } else {
      elHeroTargetValue.textContent = '--';
    }
  }

  // Bags done (if available from timer data)
  if (elHeroBagsValue) elHeroBagsValue.textContent = (data.bagTimer && data.bagTimer.bagsToday) || '--';
}


function renderKPIs() {
  if (!data || !data.today) return;
  var t = data.today, p = compareData && compareData.today ? compareData.today : null;
  var rolling = data.rollingAverage || {};
  var targets = data.targets || {};

  setKPI('totalTops', t.totalTops, p ? p.totalTops : null, 'lbs', false, targets.totalTops, rolling.totalTops);
  setKPI('totalSmalls', t.totalSmalls, p ? p.totalSmalls : null, 'lbs', false, null, rolling.totalSmalls);
  setKPI('avgRate', t.avgRate, p ? p.avgRate : null, 'rate', false, targets.avgRate, rolling.avgRate);
  // Calculate total crew including all roles
  var totalCrew = (t.trimmers||0) + (t.buckers||0) + (t.qc||0) + (t.tzero||0);
  var prevTotalCrew = p ? (p.trimmers||0) + (p.buckers||0) + (p.qc||0) + (p.tzero||0) : null;
  setKPI('crew', totalCrew, prevTotalCrew, 'num');

  // Build breakdown subtitle with all available roles
  var breakdown = [];
  if (t.trimmers > 0) breakdown.push(t.trimmers + ' Trim');
  if (t.buckers > 0) breakdown.push(t.buckers + ' Buck');
  if (t.qc > 0) breakdown.push(t.qc + ' QC');
  if (t.tzero > 0) breakdown.push(t.tzero + ' T0');
  var kpiSubCrew = document.getElementById('kpiSub_crew');
  if (kpiSubCrew) kpiSubCrew.textContent = breakdown.length > 0 ? breakdown.join(' + ') : 'No crew data';
  setKPI('operatorHours', t.totalOperatorHours, p ? p.totalOperatorHours : null, 'hrs', false, null, rolling.operatorHours);
  setKPI('costPerLb', t.costPerLb, p ? p.costPerLb : null, 'dollar', true, targets.costPerLb, rolling.costPerLb);
  setKPI('totalLbs', t.totalLbs, p ? p.totalLbs : null, 'lbs', false, null, rolling.totalLbs);
  setKPI('maxRate', t.maxRate, p ? p.maxRate : null, 'rate');
  setKPI('trimmerHours', t.totalTrimmerHours, p ? p.totalTrimmerHours : null, 'hrs');
  setKPI('laborCost', t.totalLaborCost, p ? p.totalLaborCost : null, 'dollar', true);

  // Refresh Muuri KPI layout after data is populated
  // Use debounced layout to prevent thrashing when multiple KPIs are set rapidly
  debouncedKPILayout(50);
}


function setKPI(id, val, prevVal, fmt, invertDelta, target, rollingAvg) {
  var el = document.getElementById('kpi_'+id), cmpEl = document.getElementById('kpiCmp_'+id), deltaEl = document.getElementById('delta_'+id);
  if (!el) return;
  el.innerHTML = formatValue(val, fmt);
  if (prevVal !== null && compareMode) {
    cmpEl.textContent = 'vs ' + formatValuePlain(prevVal, fmt);
    var pct = prevVal !== 0 ? ((val-prevVal)/prevVal*100) : 0;
    var isUp = invertDelta ? pct < 0 : pct > 0;
    if (Math.abs(pct) < 1) { deltaEl.className = 'kpi-delta neutral'; deltaEl.textContent = '~0%'; }
    else if (isUp) { deltaEl.className = 'kpi-delta up'; deltaEl.textContent = '↑'+Math.abs(pct).toFixed(0)+'%'; }
    else { deltaEl.className = 'kpi-delta down'; deltaEl.textContent = '↓'+Math.abs(pct).toFixed(0)+'%'; }
  }

  // Apply state-based visual emphasis
  applyKPIState(id, val, target, rollingAvg);
}


function applyKPIState(id, val, target, rollingAvg) {
  var card = document.querySelector('.kpi-card[data-kpi="'+id+'"]');
  if (!card) return;

  // Remove existing state classes
  card.classList.remove('state-ahead', 'state-behind');

  // Only apply states if we have data
  if (val == null || val === 0) return;

  // Ahead of target - gold glow (higher priority)
  if (target != null && val >= target) {
    card.classList.add('state-ahead');
  }
  // Behind rolling average by 10%+ - subtle desaturation
  else if (rollingAvg != null && val < rollingAvg * 0.9) {
    card.classList.add('state-behind');
  }
}


// KPI Click-to-Expand Functions
var expandedKPI = null;

function toggleKPIExpand(kpiId) {
  var card = document.querySelector('.kpi-card[data-kpi="'+kpiId+'"]');
  if (!card) return;

  // Accordion behavior - close currently expanded card
  if (expandedKPI && expandedKPI !== kpiId) {
    var prevCard = document.querySelector('.kpi-card[data-kpi="'+expandedKPI+'"]');
    if (prevCard) prevCard.classList.remove('expanded');
  }

  // Toggle current card
  var isExpanding = !card.classList.contains('expanded');
  card.classList.toggle('expanded');
  expandedKPI = isExpanding ? kpiId : null;

  // Populate content if expanding
  if (isExpanding) {
    populateKPIExpandedContent(kpiId);
  }

  // Refresh Muuri layout - use debounced call to prevent thrashing during rapid expand/collapse
  debouncedKPILayout(50);
}


function populateKPIExpandedContent(kpiId) {
  if (!data) return;

  var rolling = data.rollingAverage || {};
  var t = data.today || {};
  var history = data.kpiHistory || {};

  // Get rolling average for this KPI
  var rollingVal = rolling[kpiId];
  var rollingEl = document.getElementById('kpiRolling_' + kpiId);
  if (rollingEl && rollingVal != null) {
    var kpiDef = kpiDefinitions.find(function(k) { return k.id === kpiId; });
    rollingEl.textContent = formatValuePlain(rollingVal, kpiDef ? kpiDef.format : 'num');
  }

  // Crew-normalized (placeholder for now)
  var normalizedEl = document.getElementById('kpiNormalized_' + kpiId);
  if (normalizedEl) {
    if (kpiId === 'avgRate') {
      normalizedEl.textContent = t.avgRate ? t.avgRate.toFixed(2) + ' lbs/trimmer/hr' : '—';
    } else if (kpiId === 'totalTops' && t.trimmers > 0) {
      normalizedEl.textContent = (t.totalTops / t.trimmers).toFixed(1) + ' lbs/trimmer';
    } else {
      normalizedEl.textContent = 'N/A';
    }
  }

  // Render sparkline if history available
  var sparklineEl = document.getElementById('kpiSparkline_' + kpiId);
  var kpiHistoryData = history[kpiId] || (data.daily ? data.daily.map(function(d) { return d[kpiId] || d.totalTops || 0; }) : []);
  if (sparklineEl && kpiHistoryData.length > 0) {
    renderKPISparkline(sparklineEl, kpiHistoryData.slice(-7));
  }

  // Notes (anomalies or context)
  var notesEl = document.getElementById('kpiNotes_' + kpiId);
  if (notesEl) {
    var anomalies = data.anomalies || {};
    notesEl.textContent = anomalies[kpiId] || '';
  }
}


function renderKPISparkline(el, history) {
  if (!history || history.length === 0) {
    el.innerHTML = '<div style="text-align: center; color: var(--text-muted); font-size: 11px; padding-top: 12px;">No history data</div>';
    return;
  }

  var max = Math.max.apply(null, history);
  var min = Math.min.apply(null, history);
  var range = max - min || 1;
  var width = el.clientWidth || 160;
  var chartHeight = 40;
  var barWidth = width / history.length;
  var padding = 2;

  // Caption at top
  var caption = '<div style="text-align: center; font-size: 10px; color: var(--text-muted); margin-bottom: 4px; font-weight: 600; letter-spacing: 0.5px;">' +
    (lang === 'en' ? 'LAST 7 DAYS' : 'ÚLTIMOS 7 DÍAS') +
  '</div>';

  // Create bars with tooltips
  var bars = history.map(function(val, i) {
    var barHeight = ((val - min) / range) * (chartHeight - 4);
    var x = i * barWidth + padding;

    // Calculate days ago for label
    var daysAgo = history.length - 1 - i;
    var dayLabel = daysAgo === 0 ? (lang === 'en' ? 'Today' : 'Hoy') : daysAgo + 'd';

    // Format value for tooltip
    var formattedVal = val.toFixed(1);

    return '<div style="position: absolute; left: '+x+'px; bottom: 18px; width: '+(barWidth - padding * 2)+'px; height: '+barHeight+'px; background: var(--gold); border-radius: 2px; opacity: 0.8; cursor: pointer; transition: all 0.2s;" ' +
      'title="'+dayLabel+': '+formattedVal+'" ' +
      'onmouseover="this.style.opacity=\'1\'; this.style.transform=\'scaleY(1.1)\'; this.style.background=\'var(--gold)\';" ' +
      'onmouseout="this.style.opacity=\'0.8\'; this.style.transform=\'scaleY(1)\'; this.style.background=\'var(--gold)\';">' +
    '</div>';
  }).join('');

  // Day labels at bottom
  var labels = history.map(function(val, i) {
    var daysAgo = history.length - 1 - i;
    var dayLabel = daysAgo === 0 ? (lang === 'en' ? 'Today' : 'Hoy') : daysAgo + 'd';
    var x = i * barWidth + padding;

    return '<div style="position: absolute; left: '+x+'px; bottom: 0; width: '+(barWidth - padding * 2)+'px; text-align: center; font-size: 9px; color: var(--text-muted); font-family: var(--font-mono);">'+dayLabel+'</div>';
  }).join('');

  el.innerHTML = caption + '<div style="position: relative; width: 100%; height: '+(chartHeight + 18)+'px;">' + bars + labels + '</div>';
}


// ========================================
// TUTORIAL/ONBOARDING SYSTEM
// ========================================

var tutorialState = {
  active: false,
  currentStep: 0,
  steps: [
    {
      target: '.hero-section',
      title: { en: 'Daily Progress', es: 'Progreso Diario' },
      content: { en: 'This shows your real-time production status, crew count, efficiency rate, and progress toward daily targets.', es: 'Esto muestra tu estado de producción en tiempo real, cantidad de equipo, tasa de eficiencia y progreso hacia los objetivos diarios.' },
      icon: '📊'
    },
    {
      target: '#kpiRow',
      title: { en: 'KPI Cards - Try It!', es: 'Tarjetas KPI - ¡Pruébalo!' },
      content: { en: 'Click any KPI card now to see detailed metrics, 7-day rolling averages, and sparkline trends. Go ahead, try it!', es: 'Haz clic en cualquier tarjeta KPI ahora para ver métricas detalladas, promedios móviles de 7 días y tendencias. ¡Adelante, pruébalo!' },
      icon: '📈',
      interactive: true
    },
    {
      target: '#widgetsContainer',
      title: { en: 'Interactive Widgets', es: 'Widgets Interactivos' },
      content: { en: 'Drag widgets to rearrange, click the resize button (⤢) to change size, collapse (−) to minimize, or hide (×) to remove from view.', es: 'Arrastra widgets para reorganizar, haz clic en el botón de redimensionar (⤢) para cambiar el tamaño, colapsar (−) para minimizar, u ocultar (×) para quitar de la vista.' },
      icon: '🧩'
    },
    {
      target: 'button[onclick="openSettings()"]',
      title: { en: 'Settings - Try It!', es: 'Configuración - ¡Pruébalo!' },
      content: { en: 'Click this button to customize your dashboard, toggle widgets on/off, and save your layout preferences. Try opening it!', es: '¡Haz clic en este botón para personalizar tu panel, activar/desactivar widgets y guardar tus preferencias de diseño. ¡Intenta abrirlo!' },
      icon: '⚙️',
      interactive: true
    },
    {
      target: '.ai-chat-fab',
      title: { en: 'AI Assistant - Try It!', es: 'Asistente IA - ¡Pruébalo!' },
      content: { en: 'Ask your AI assistant about production status, bag counts, crew efficiency, and more. Click to start chatting!', es: 'Pregúntale a tu asistente de IA sobre el estado de producción, conteo de bolsas, eficiencia del equipo y más. ¡Haz clic para comenzar a chatear!' },
      icon: '🌿',
      interactive: true
    }
  ]
};

var lang = 'en'; // Default language

// Bilingual widget help content
var widgetHelpContent = {
  en: {
    'current': { title: 'Current Production', description: 'Shows the most recent completed hour of production with strain, crew, and rate details.' },
    'hourly-chart': { title: 'Hourly Production', description: 'Visualizes tops vs smalls production by hour throughout the day.' },
    'rate-chart': { title: 'Efficiency Trend', description: 'Tracks lbs/trimmer/hr rate over time to monitor crew efficiency.' },
    'daily-chart': { title: 'Daily Production', description: 'Multi-day view showing total production trends over the selected period.' },
    'daily-rate-chart': { title: 'Daily Efficiency', description: 'Daily rate trends with 7-day moving average for smoothing.' },
    'trimmers-chart': { title: 'Trimmers on Line', description: 'Shows crew size by hour to analyze staffing levels.' },
    'sparkline': { title: 'Trimmer Productivity', description: 'Quick stats for last hour, best hour, and average rate across all trimmers.' },
    'strain-breakdown': { title: 'Strain Breakdown', description: 'Pie chart showing production distribution across different cannabis strains.' },
    'performance-table': { title: 'Performance Table', description: 'Detailed tabular view of production metrics with sorting capabilities.' },
    'cost-analysis': { title: 'Cost Analysis', description: 'Breakdown of labor costs per pound and per hour.' },
    'period-summary': { title: 'Period Summary', description: 'Aggregated statistics for the selected date range.' },
    'kanban': { title: 'Supply Kanban', description: 'Track inventory status for supplies and materials.' },
    'scoreboard': { title: 'Live Scoreboard', description: 'Real-time production status display for floor TV screens.' },
    'timer': { title: '5KG Bag Timer', description: 'Track bag completion times and compare against targets.' },
    'sop': { title: 'SOP Manager', description: 'Access and manage Standard Operating Procedures.' }
  },
  es: {
    'current': { title: 'Producción Actual', description: 'Muestra la hora más reciente completada de producción con detalles de cepa, equipo y tasa.' },
    'hourly-chart': { title: 'Producción Por Hora', description: 'Visualiza la producción de tops vs smalls por hora durante el día.' },
    'rate-chart': { title: 'Tendencia de Eficiencia', description: 'Rastrea la tasa lbs/podador/hr a lo largo del tiempo para monitorear la eficiencia del equipo.' },
    'daily-chart': { title: 'Producción Diaria', description: 'Vista de varios días mostrando tendencias de producción total durante el período seleccionado.' },
    'daily-rate-chart': { title: 'Eficiencia Diaria', description: 'Tendencias de tasa diaria con promedio móvil de 7 días para suavizar.' },
    'trimmers-chart': { title: 'Podadores en Línea', description: 'Muestra el tamaño del equipo por hora para analizar niveles de personal.' },
    'sparkline': { title: 'Productividad del Podador', description: 'Estadísticas rápidas para última hora, mejor hora y tasa promedio en todos los podadores.' },
    'strain-breakdown': { title: 'Desglose de Cepas', description: 'Gráfico circular mostrando la distribución de producción entre diferentes cepas de cannabis.' },
    'performance-table': { title: 'Tabla de Rendimiento', description: 'Vista tabular detallada de métricas de producción con capacidades de ordenación.' },
    'cost-analysis': { title: 'Análisis de Costos', description: 'Desglose de costos laborales por libra y por hora.' },
    'period-summary': { title: 'Resumen del Período', description: 'Estadísticas agregadas para el rango de fechas seleccionado.' },
    'kanban': { title: 'Kanban de Suministros', description: 'Rastrea el estado del inventario de suministros y materiales.' },
    'scoreboard': { title: 'Marcador en Vivo', description: 'Visualización del estado de producción en tiempo real para pantallas de TV del piso.' },
    'timer': { title: 'Temporizador de Bolsas 5KG', description: 'Rastrea tiempos de finalización de bolsas y compara con objetivos.' },
    'sop': { title: 'Gestor de SOP', description: 'Accede y gestiona Procedimientos Operativos Estándar.' }
  }
};

function startTutorial() {
  tutorialState.active = true;
  tutorialState.currentStep = 0;
  document.body.classList.add('tutorial-active');
  showTutorialStep(0);
}


function endTutorial() {
  tutorialState.active = false;
  document.body.classList.remove('tutorial-active');
  var highlighted = document.querySelector('.tutorial-highlight');
  if (highlighted) highlighted.classList.remove('tutorial-highlight');
  var tooltip = document.querySelector('.tutorial-tooltip');
  if (tooltip) tooltip.remove();
  localStorage.setItem('tutorialCompleted', 'true');
}


function nextTutorialStep() {
  if (tutorialState.currentStep < tutorialState.steps.length - 1) {
    tutorialState.currentStep++;
    showTutorialStep(tutorialState.currentStep);
  } else {
    endTutorial();
    showToast('Tutorial complete!', 'success');
  }
}


function prevTutorialStep() {
  if (tutorialState.currentStep > 0) {
    tutorialState.currentStep--;
    showTutorialStep(tutorialState.currentStep);
  }
}


function showTutorialStep(stepIndex) {
  var step = tutorialState.steps[stepIndex];
  if (!step) return;

  // Remove previous highlight
  var prevHighlight = document.querySelector('.tutorial-highlight');
  if (prevHighlight) prevHighlight.classList.remove('tutorial-highlight');

  // Highlight target element
  var targetEl = document.querySelector(step.target);
  if (targetEl) {
    targetEl.classList.add('tutorial-highlight');
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Create tooltip
  var existingTooltip = document.querySelector('.tutorial-tooltip');
  if (existingTooltip) existingTooltip.remove();

  var tooltip = document.createElement('div');
  tooltip.className = 'tutorial-tooltip';

  // Add interactive hint if step is interactive
  var interactiveHint = '';
  if (step.interactive) {
    interactiveHint = '<div class="tutorial-interactive-hint">' +
      '<span style="display: inline-block; width: 8px; height: 8px; background: var(--gold); border-radius: 50%; margin-right: 6px; animation: pulse 1s infinite;"></span>' +
      (lang === 'en' ? 'Click the highlighted element to try it!' : '¡Haz clic en el elemento resaltado para probarlo!') +
    '</div>';
  }

  tooltip.innerHTML =
    '<div class="tutorial-tooltip-header">' +
      '<div class="tutorial-tooltip-icon">' + step.icon + '</div>' +
      '<div class="tutorial-tooltip-title">' + step.title[lang] + '</div>' +
      '<div class="tutorial-tooltip-step">' + (stepIndex + 1) + '/' + tutorialState.steps.length + '</div>' +
    '</div>' +
    '<div class="tutorial-tooltip-content">' + step.content[lang] + '</div>' +
    interactiveHint +
    '<div class="tutorial-tooltip-actions">' +
      '<button class="tutorial-btn tutorial-btn-secondary" onclick="endTutorial()">Skip</button>' +
      '<div style="display: flex; gap: 8px;">' +
        (stepIndex > 0 ? '<button class="tutorial-btn tutorial-btn-secondary" onclick="prevTutorialStep()">Back</button>' : '') +
        '<button class="tutorial-btn tutorial-btn-primary" onclick="nextTutorialStep()">' + (stepIndex < tutorialState.steps.length - 1 ? 'Next' : 'Finish') + '</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(tooltip);

  // Position tooltip
  if (targetEl) {
    var rect = targetEl.getBoundingClientRect();
    var tooltipRect = tooltip.getBoundingClientRect();
    var top = rect.bottom + 16;
    var left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);

    // Keep tooltip on screen
    if (left < 16) left = 16;
    if (left + tooltipRect.width > window.innerWidth - 16) left = window.innerWidth - tooltipRect.width - 16;
    if (top + tooltipRect.height > window.innerHeight - 16) top = rect.top - tooltipRect.height - 16;

    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
  }
}


// Widget Help System
function showWidgetHelp(widgetId) {
  var helpContent = widgetHelpContent[lang][widgetId];
  if (!helpContent) return;

  var widget = document.getElementById('widget-' + widgetId);
  if (!widget) return;

  // Remove existing popup
  var existingPopup = document.querySelector('.widget-help-popup');
  if (existingPopup) existingPopup.remove();

  var popup = document.createElement('div');
  popup.className = 'widget-help-popup';
  popup.innerHTML =
    '<div class="widget-help-popup-title">' + helpContent.title + '</div>' +
    '<div class="widget-help-popup-content">' + helpContent.description + '</div>';

  widget.querySelector('.widget-header').appendChild(popup);

  // Close on click outside
  setTimeout(function() {
    function closePopup(e) {
      if (!popup.contains(e.target) && !e.target.classList.contains('widget-help')) {
        popup.remove();
        document.removeEventListener('click', closePopup);
      }
    }
    document.addEventListener('click', closePopup);
  }, 100);
}


// Welcome Modal Functions
function showWelcomeModal() {
  var modal = document.getElementById('welcomeModal');
  if (modal) {
    modal.classList.add('active');
  }
}


function dismissWelcome() {
  var modal = document.getElementById('welcomeModal');
  if (modal) {
    modal.classList.remove('active');
  }
  localStorage.setItem('tutorialCompleted', 'true');
}


function startTutorialFromWelcome() {
  var modal = document.getElementById('welcomeModal');
  if (modal) {
    modal.classList.remove('active');
  }
  setTimeout(function() {
    startTutorial();
  }, 300);
}


function formatValue(v, fmt) {
  if (fmt==='lbs') return (v||0).toFixed(1)+' <span class="kpi-unit">lbs</span>';
  if (fmt==='rate') return (v||0).toFixed(2);
  if (fmt==='hrs') return (v||0).toFixed(1)+' <span class="kpi-unit">hrs</span>';
  if (fmt==='dollar') return '$'+(v||0).toFixed(2);
  if (fmt==='num') return (v||0).toString();
  return v;
}


function formatValuePlain(v, fmt) {
  if (fmt==='lbs') return (v||0).toFixed(1);
  if (fmt==='rate') return (v||0).toFixed(2);
  if (fmt==='hrs') return (v||0).toFixed(1);
  if (fmt==='dollar') return '$'+(v||0).toFixed(2);
  if (fmt==='num') return (v||0).toString();
  return v;
}


function renderCurrentProduction() {
  // Prioritize lastCompleted (previous hour) since data is entered at end of each hour
  // Fallback to last hourly entry if lastCompleted is not available (historical data or no completed hours yet)
  var d = data ? data.lastCompleted : null;
  var isHistorical = false;

  if (!d && data && data.hourly && data.hourly.length > 0) {
    // Find the last hourly entry with production data
    for (var i = data.hourly.length - 1; i >= 0; i--) {
      var h = data.hourly[i];
      if (h.tops > 0 || h.smalls > 0) {
        d = {
          strain: h.strain || (data.current && data.current.strain) || (data.today && data.today.strain) || (data.strains && data.strains.length > 0 && data.strains[0].name) || 'Unknown',
          timeSlot: h.label || '',
          tops: h.tops || 0,
          smalls: h.smalls || 0,
          trimmers: h.trimmers || 0,
          buckers: h.buckers || 0,
          rate: h.rate || 0
        };
        isHistorical = true;
        break;
      }
    }
  }

  // Get all DOM elements with null checks
  var elStrain = document.getElementById('currentStrain');
  var elTime = document.getElementById('currentTime');
  var elStatusBadge = document.getElementById('statusBadge');
  var elTops = document.getElementById('currentTops');
  var elSmalls = document.getElementById('currentSmalls');
  var elTrimmers = document.getElementById('currentTrimmers');
  var elBuckers = document.getElementById('currentBuckers');
  var elRate = document.getElementById('currentRate');
  var elTotal = document.getElementById('currentTotal');

  if (!d) {
    if (elStrain) elStrain.textContent = 'No Data';
    if (elTime) elTime.textContent = '—';
    if (elStatusBadge) {
      elStatusBadge.className = 'status-badge idle';
      elStatusBadge.textContent = 'No Data';
    }
    if (elTops) elTops.textContent = '0';
    if (elSmalls) elSmalls.textContent = '0';
    if (elTrimmers) elTrimmers.textContent = '0';
    if (elBuckers) elBuckers.textContent = '0';
    if (elRate) elRate.textContent = '0.00';
    if (elTotal) elTotal.textContent = '0';
    return;
  }
  if (elStrain) elStrain.textContent = d.strain || 'Unknown';
  if (elTime) elTime.textContent = d.timeSlot || '';
  if (elTops) elTops.textContent = (d.tops||0).toFixed(1);
  if (elSmalls) elSmalls.textContent = (d.smalls||0).toFixed(1);
  if (elTrimmers) elTrimmers.textContent = d.trimmers||0;
  if (elBuckers) elBuckers.textContent = d.buckers||0;
  if (elRate) elRate.textContent = (d.rate||0).toFixed(2);
  if (elTotal) elTotal.textContent = ((d.tops||0) + (d.smalls||0)).toFixed(1);
  if (elStatusBadge) {
    elStatusBadge.className = 'status-badge ' + (isHistorical ? 'historical' : 'completed');
    elStatusBadge.textContent = isHistorical ? 'Last Entry' : 'Last Hour';
  }
}


function renderCharts() {
  // Guard against race condition: data may arrive before charts are initialized
  if (!data || !chartsInitialized) return;

  // Chart colors are set via Chart.defaults in updateChartTheme()
  // No need to manually update each chart's options here as it can cause stack overflow
  
  try {
    if (data.hourly && data.hourly.length > 0 && hourlyChart) {
      hourlyChart.data.labels = data.hourly.map(function(h){return h.label;});
      hourlyChart.data.datasets[0].data = data.hourly.map(function(h){return h.tops;});
      hourlyChart.data.datasets[1].data = data.hourly.map(function(h){return h.smalls;});
      hourlyChart.update();
    }
  } catch(e) { console.error('Hourly chart error:', e); }
  
  try {
    if (data.hourly && data.hourly.length > 0 && rateChart) {
      rateChart.data.labels = data.hourly.map(function(h){return h.label;});
      rateChart.data.datasets[0].data = data.hourly.map(function(h){return h.rate;});
      if (compareMode && compareData && compareData.hourly) {
        rateChart.data.datasets[1].data = compareData.hourly.map(function(h){return h.rate;});
        rateChart.data.datasets[1].hidden = false;
      } else {
        rateChart.data.datasets[1].hidden = true;
      }
      rateChart.update('none');
    }
  } catch(e) { console.error('Rate chart error:', e); }
  
  try {
    if (data.daily && data.daily.length > 0 && dailyChart) {
      dailyChart.data.labels = data.daily.map(function(d){return d.label;});
      dailyChart.data.datasets[0].data = data.daily.map(function(d){return d.totalTops;});
      dailyChart.data.datasets[1].data = data.daily.map(function(d){return d.totalSmalls;});
      // Daily target line
      if (dailyChart.data.datasets[2]) {
        dailyChart.data.datasets[2].data = data.daily.map(function(){return dailyTarget;});
        dailyChart.data.datasets[2].label = 'Target (' + dailyTarget + ' lbs)';
      }
      dailyChart.update('none');
    }
  } catch(e) { console.error('Daily chart error:', e); }
  
  try {
    renderEfficiencyChart();
  } catch(e) { console.error('Efficiency chart error:', e); }
}


// Adaptive Efficiency Chart - switches between hourly/daily based on date range
function renderEfficiencyChart() {
  if (!data || !dailyRateChart) return;
  
  var numDays = data.daily ? data.daily.length : 0;
  var titleEl = document.getElementById('efficiencyChartTitle');
  var subtitleEl = document.getElementById('efficiencyChartSubtitle');
  
  // Determine chart mode based on date range
  if (numDays <= 1) {
    // SINGLE DAY: Show hourly efficiency (lbs/trimmer per hour)
    titleEl.textContent = 'Hourly Efficiency';
    subtitleEl.textContent = 'lbs/trimmer by hour';
    
    if (!data.hourly || data.hourly.length === 0) {
      dailyRateChart.data.labels = [];
      dailyRateChart.data.datasets[0].data = [];
      dailyRateChart.data.datasets[1].data = [];
      dailyRateChart.update('none');
      return;
    }
    
    var labels = data.hourly.map(function(h) { return h.label; });
    var rates = data.hourly.map(function(h) { return h.rate || 0; });
    
    // Calculate average for reference line
    var validRates = rates.filter(function(r) { return r > 0; });
    var avgRate = validRates.length > 0 ? validRates.reduce(function(a, b) { return a + b; }, 0) / validRates.length : 0;
    var avgLine = rates.map(function() { return avgRate; });
    
    dailyRateChart.data.labels = labels;
    dailyRateChart.data.datasets[0].data = rates;
    dailyRateChart.data.datasets[0].label = 'Rate';
    dailyRateChart.data.datasets[1].data = avgLine;
    dailyRateChart.data.datasets[1].label = 'Avg (' + avgRate.toFixed(2) + ')';
    dailyRateChart.update('none');
    
  } else if (numDays < 7) {
    // 2-6 DAYS: Show daily efficiency without MA (not enough data for meaningful MA)
    titleEl.textContent = 'Daily Efficiency';
    subtitleEl.textContent = 'lbs/trimmer by day';
    
    var rates = data.daily.map(function(d) { return d.avgRate; });
    
    // Calculate average for reference line
    var validRates = rates.filter(function(r) { return r > 0; });
    var avgRate = validRates.length > 0 ? validRates.reduce(function(a, b) { return a + b; }, 0) / validRates.length : 0;
    var avgLine = rates.map(function() { return avgRate; });
    
    dailyRateChart.data.labels = data.daily.map(function(d) { return d.label; });
    dailyRateChart.data.datasets[0].data = rates;
    dailyRateChart.data.datasets[0].label = 'Rate';
    dailyRateChart.data.datasets[1].data = avgLine;
    dailyRateChart.data.datasets[1].label = 'Avg (' + avgRate.toFixed(2) + ')';
    dailyRateChart.update('none');
    
  } else {
    // 7+ DAYS: Show daily efficiency with 7-day moving average
    titleEl.textContent = 'Daily Efficiency';
    subtitleEl.textContent = 'With 7-day MA';
    
    var rates = data.daily.map(function(d) { return d.avgRate; });
    
    dailyRateChart.data.labels = data.daily.map(function(d) { return d.label; });
    dailyRateChart.data.datasets[0].data = rates;
    dailyRateChart.data.datasets[0].label = 'Rate';
    dailyRateChart.data.datasets[1].data = calcMA(rates, 7);
    dailyRateChart.data.datasets[1].label = '7d MA';
    dailyRateChart.update('none');
  }
}


function calcMA(arr, p) {
  var r = [];
  for (var i=0; i<arr.length; i++) {
    if (i<p-1) r.push(null);
    else { var s=0; for (var j=i-p+1; j<=i; j++) s+=arr[j]; r.push(s/p); }
  }
  return r;
}


function renderTrimmersChart() {
  // Guard against race condition: data may arrive before charts are initialized
  if (!data || !trimmersChart) return;
  
  var labels = [];
  var trimmerData = [];
  var isMultiDay = data.daily && data.daily.length > 1;
  var subtitleEl = document.getElementById('trimmersChartSubtitle');
  
  if (isMultiDay && data.daily && data.daily.length > 0) {
    // Multi-day view: show average trimmers per day
    if (subtitleEl) subtitleEl.textContent = 'By Day (Avg)';
    labels = data.daily.map(function(d) { return d.label; });
    trimmerData = data.daily.map(function(d) { 
      // Use avgTrimmers if available, otherwise calculate
      return d.avgTrimmers || (d.hoursWorked > 0 ? d.trimmerHours / d.hoursWorked : 0); 
    });
  } else if (data.hourly && data.hourly.length > 0) {
    // Single day view: show trimmers by hour
    if (subtitleEl) subtitleEl.textContent = 'By Hour';
    labels = data.hourly.map(function(h) { return h.label; });
    trimmerData = data.hourly.map(function(h) { return h.trimmers || 0; });
  } else {
    return;
  }
  
  // Calculate average for dotted line
  var validData = trimmerData.filter(function(t) { return t > 0; });
  var avg = validData.length > 0 ? validData.reduce(function(a, b) { return a + b; }, 0) / validData.length : 0;
  var avgLine = trimmerData.map(function() { return avg; });
  
  trimmersChart.data.labels = labels;
  trimmersChart.data.datasets[0].data = trimmerData;
  trimmersChart.data.datasets[1].data = avgLine;
  trimmersChart.update('none');
}


function renderSparkline() {
  if (!data || !data.today) return;
  document.getElementById('sparkCurrent').textContent = data.today.currentRate > 0 ? data.today.currentRate.toFixed(2) : '—';
  document.getElementById('sparkBest').textContent = data.today.maxRate > 0 ? data.today.maxRate.toFixed(2) : '—';
  document.getElementById('sparkAvg').textContent = data.today.avgRate > 0 ? data.today.avgRate.toFixed(2) : '—';
  var c = document.getElementById('sparklineBars');
  c.innerHTML = '';
  if (!data.hourly) return;
  var rates = data.hourly.filter(function(h){return h.rate>0;}).map(function(h){return h.rate;});
  if (rates.length===0) return;
  var max = Math.max.apply(null, rates), min = Math.min.apply(null, rates), avg = data.today.avgRate, rng = max-min||1;
  data.hourly.forEach(function(h) {
    if (!h.rate || h.rate<=0) return;
    var b = document.createElement('div');
    b.className = 'spark-bar';
    b.style.height = (20+((h.rate-min)/rng)*50)+'%';
    if (h.rate===max) b.classList.add('best');
    else if (h.rate>=avg*1.05) b.classList.add('good');
    else if (h.rate<avg*0.85) b.classList.add('below');
    else b.classList.add('avg');
    b.title = h.label+': '+h.rate.toFixed(2);
    c.appendChild(b);
  });
}


function renderStrainList() {
  var c = document.getElementById('strainList');
  if (!data || !data.strains || data.strains.length===0) {
    c.innerHTML = '<div style="color:#8a9a8e;text-align:center;padding:16px;">No strains</div>';
    return;
  }
  c.innerHTML = data.strains.map(function(s) {
    return '<div class="strain-item"><span class="strain-name">'+s.name+'</span><div class="strain-stats"><span class="strain-tops">'+s.tops.toFixed(1)+'</span><span class="strain-smalls">'+s.smalls.toFixed(1)+'</span></div></div>';
  }).join('');
}


function renderTables() {
  var t = data && data.today ? data.today : {}, p = compareData && compareData.today ? compareData.today : null, w = data && data.weekly ? data.weekly : {};
  var perfTableEl = document.getElementById('perfTable');
  var costTableEl = document.getElementById('costTable');
  var periodLabelEl = document.getElementById('periodLabel');
  var periodTableEl = document.getElementById('periodTable');
  if (perfTableEl) perfTableEl.innerHTML = perfRow('Hours Logged', t.hoursWorked, p?p.hoursWorked:null, 'hrs') + perfRow('Trimmer Hrs', t.totalTrimmerHours, p?p.totalTrimmerHours:null, 'num') + perfRow('Lbs/Hour', t.lbsPerHour, p?p.lbsPerHour:null, 'rate');
  if (costTableEl) costTableEl.innerHTML = perfRow('Cost/Top', t.avgCostPerTop, p?p.avgCostPerTop:null, '$') + perfRow('Cost/Small', t.avgCostPerSmall, p?p.avgCostPerSmall:null, '$') + perfRow('Cost/Lb', t.costPerLb, p?p.costPerLb:null, '$');
  if (periodLabelEl) periodLabelEl.textContent = (w.totalDays||0)+' day summary';
  if (periodTableEl) periodTableEl.innerHTML = perfRow('Total Tops', w.totalTops, null, 'lbs') + perfRow('Total Smalls', w.totalSmalls, null, 'lbs') + perfRow('Best Rate', w.bestRate, null, 'rate');
}


function perfRow(label, val, prev, fmt) {
  var v = val||0;
  var display;
  if (fmt==='hrs') display = v+' hrs';
  else if (fmt==='rate') display = v.toFixed(2);
  else if (fmt==='num') display = v.toFixed(1);
  else if (fmt==='$') display = '$'+v.toFixed(2);
  else if (fmt==='lbs') display = v.toFixed(1)+' lbs';
  else display = v;
  var prevHtml = '';
  if (prev !== null && compareMode) {
    var pv = prev||0;
    var pDisplay = fmt==='$' ? '$'+pv.toFixed(2) : pv.toFixed(fmt==='rate'?2:1);
    prevHtml = '<span class="perf-prev">('+pDisplay+')</span>';
  }
  return '<div class="perf-row"><span class="perf-label">'+label+'</span><div class="perf-compare"><span class="perf-value">'+display+'</span>'+prevHtml+'</div></div>';
}


function renderIntegrationWidgets() {
  // Scoreboard data from production
  var scoreboardStatusEl = document.getElementById('scoreboardStatus');
  var scoreboardLbsEl = document.getElementById('scoreboardLbs');
  var scoreboardTargetEl = document.getElementById('scoreboardTarget');
  if (data && data.today) {
    if (scoreboardStatusEl) {
      scoreboardStatusEl.textContent = data.current ? 'Active' : 'Idle';
      scoreboardStatusEl.className = 'integration-stat-value ' + (data.current ? 'good' : '');
    }
    if (scoreboardLbsEl) scoreboardLbsEl.textContent = data.today.totalLbs.toFixed(1);
    var target = data.today.trimmers * 1.5 * data.today.hoursWorked;
    var pct = target > 0 ? ((data.today.totalTops / target) * 100).toFixed(0) + '%' : '—';
    if (scoreboardTargetEl) {
      scoreboardTargetEl.textContent = pct;
      scoreboardTargetEl.className = 'integration-stat-value ' + (data.today.totalTops >= target ? 'good' : '');
    }
  } else {
    if (scoreboardStatusEl) scoreboardStatusEl.textContent = '—';
    if (scoreboardLbsEl) scoreboardLbsEl.textContent = '—';
    if (scoreboardTargetEl) scoreboardTargetEl.textContent = '—';
  }

  // Kanban data from backend
  var kanbanTotalEl = document.getElementById('kanbanTotal');
  var kanbanReorderEl = document.getElementById('kanbanReorder');
  var kanbanInStockEl = document.getElementById('kanbanInStock');
  if (data && data.kanban) {
    if (kanbanTotalEl) kanbanTotalEl.textContent = data.kanban.total;
    if (kanbanReorderEl) {
      kanbanReorderEl.textContent = data.kanban.needReorder;
      kanbanReorderEl.className = 'integration-stat-value ' + (data.kanban.needReorder > 0 ? 'alert' : 'good');
    }
    if (kanbanInStockEl) {
      kanbanInStockEl.textContent = data.kanban.inStock;
      kanbanInStockEl.className = 'integration-stat-value good';
    }
  } else {
    if (kanbanTotalEl) kanbanTotalEl.textContent = '—';
    if (kanbanReorderEl) kanbanReorderEl.textContent = '—';
    if (kanbanInStockEl) kanbanInStockEl.textContent = '—';
  }
  
  // Bag Timer data from backend
  var bagsTodayEl = document.getElementById('bagsToday');
  var bagsAvgTimeEl = document.getElementById('bagsAvgTime');
  var bagsVsTargetEl = document.getElementById('bagsVsTarget');
  if (data && data.bagTimer) {
    if (bagsTodayEl) bagsTodayEl.textContent = data.bagTimer.bagsToday;
    if (bagsAvgTimeEl) bagsAvgTimeEl.textContent = data.bagTimer.avgTime;
    if (bagsVsTargetEl) {
      bagsVsTargetEl.textContent = data.bagTimer.vsTarget;
      var avgMin = data.bagTimer.avgMinutes || 0;
      bagsVsTargetEl.className = 'integration-stat-value ' + (avgMin > 0 && avgMin <= 45 ? 'good' : (avgMin > 45 ? 'alert' : ''));
    }
  } else {
    if (bagsTodayEl) bagsTodayEl.textContent = '—';
    if (bagsAvgTimeEl) bagsAvgTimeEl.textContent = '—';
    if (bagsVsTargetEl) bagsVsTargetEl.textContent = '—';
  }
}


// ===== ACCESSIBILITY ENHANCEMENTS =====
// Focus trap for modal dialogs
function initFocusTrap(modalId) {
  var modal = document.getElementById(modalId);
  if (!modal) return;

  var focusableElements = modal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );

  if (focusableElements.length === 0) return;

  var firstFocusable = focusableElements[0];
  var lastFocusable = focusableElements[focusableElements.length - 1];

  modal.addEventListener('keydown', function(e) {
    if (e.key !== 'Tab') return;

    if (e.shiftKey) {
      if (document.activeElement === firstFocusable) {
        lastFocusable.focus();
        e.preventDefault();
      }
    } else {
      if (document.activeElement === lastFocusable) {
        firstFocusable.focus();
        e.preventDefault();
      }
    }
  });
}


// Initialize focus traps for modals
function initAccessibility() {
  initFocusTrap('settingsPanel');
  initFocusTrap('welcomeModal');
  initFocusTrap('aiChatPanel');

  // Add keyboard support for clickable widget cards
  document.querySelectorAll('.widget-card[onclick]').forEach(function(card) {
    if (!card.hasAttribute('tabindex')) {
      card.setAttribute('tabindex', '0');
      card.setAttribute('role', 'button');
    }
    card.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        card.click();
      }
    });
  });

  // Ensure mobile sidebar updates aria-expanded
  var mobileSidebar = document.getElementById('sidebar');
  if (mobileSidebar) {
    var observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.attributeName === 'class') {
          var btn = document.querySelector('.mobile-menu-btn');
          if (btn) {
            btn.setAttribute('aria-expanded', mobileSidebar.classList.contains('mobile-open'));
          }
        }
      });
    });
    observer.observe(mobileSidebar, { attributes: true });
  }
}


// Call accessibility init after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAccessibility);
} else {
  initAccessibility();
}

