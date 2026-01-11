/**
 * Settings Module
 * Handles user settings persistence and application
 */

import { kpiDefinitions, widgetDefinitions, DEFAULT_DAILY_TARGET } from './config.js';
import { setSidebarCollapsed, setDarkMode, setDailyTarget } from './state.js';

// LocalStorage key for settings
const STORAGE_KEY = 'roHubSettingsV2';

// Default settings structure
function getDefaultSettings() {
  return {
    kpiVisibility: Object.fromEntries(
      kpiDefinitions.map(kpi => [kpi.id, kpi.default])
    ),
    kpiOrder: kpiDefinitions.map(kpi => kpi.id),
    widgetVisibility: Object.fromEntries(
      widgetDefinitions.map(widget => [widget.id, widget.default])
    ),
    sidebarCollapsed: false,
    darkMode: false,
    dailyTarget: DEFAULT_DAILY_TARGET
  };
}

/**
 * Load settings from localStorage and apply to application
 * @returns {Object} The loaded settings object
 */
export function loadSettings() {
  const defaults = getDefaultSettings();
  let settings;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      settings = JSON.parse(stored);
      // Merge with defaults to handle new KPIs/widgets added after settings were saved
      settings = {
        ...defaults,
        ...settings,
        kpiVisibility: { ...defaults.kpiVisibility, ...settings.kpiVisibility },
        widgetVisibility: { ...defaults.widgetVisibility, ...settings.widgetVisibility }
      };
    } else {
      settings = defaults;
    }
  } catch (e) {
    console.warn('Failed to load settings from localStorage:', e);
    settings = defaults;
  }

  // Apply visibility to KPI definitions
  kpiDefinitions.forEach(kpi => {
    kpi.visible = settings.kpiVisibility[kpi.id] !== false;
  });

  // Sort KPI definitions by saved order
  if (settings.kpiOrder && settings.kpiOrder.length > 0) {
    const orderMap = new Map(settings.kpiOrder.map((id, index) => [id, index]));
    kpiDefinitions.sort((a, b) => {
      const aOrder = orderMap.has(a.id) ? orderMap.get(a.id) : Infinity;
      const bOrder = orderMap.has(b.id) ? orderMap.get(b.id) : Infinity;
      return aOrder - bOrder;
    });
  }

  // Apply visibility to widget definitions
  widgetDefinitions.forEach(widget => {
    widget.visible = settings.widgetVisibility[widget.id] !== false;
  });

  // Apply sidebar collapsed state
  setSidebarCollapsed(settings.sidebarCollapsed || false);

  // Apply dark mode
  setDarkMode(settings.darkMode || false);
  if (settings.darkMode) {
    document.body.classList.add('dark-mode');
  } else {
    document.body.classList.remove('dark-mode');
  }

  // Apply daily target
  setDailyTarget(settings.dailyTarget || DEFAULT_DAILY_TARGET);

  return settings;
}

/**
 * Save current settings to localStorage
 */
export function saveSettings() {
  const settings = {
    kpiVisibility: Object.fromEntries(
      kpiDefinitions.map(kpi => [kpi.id, kpi.visible !== false])
    ),
    kpiOrder: kpiDefinitions.map(kpi => kpi.id),
    widgetVisibility: Object.fromEntries(
      widgetDefinitions.map(widget => [widget.id, widget.visible !== false])
    ),
    sidebarCollapsed: document.body.classList.contains('sidebar-collapsed'),
    darkMode: document.body.classList.contains('dark-mode'),
    dailyTarget: parseInt(document.getElementById('dailyTarget')?.value, 10) || DEFAULT_DAILY_TARGET
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('Failed to save settings to localStorage:', e);
  }
}

/**
 * Apply widget visibility state to DOM elements
 */
export function applyWidgetVisibility() {
  widgetDefinitions.forEach(widget => {
    const el = document.getElementById(`widget-${widget.id}`);
    if (el) {
      if (widget.visible === false) {
        el.classList.add('hidden');
        el.style.display = 'none';
      } else {
        el.classList.remove('hidden');
        el.style.display = '';
      }
    }
  });
}

/**
 * Reset all settings to defaults
 */
export function resetLayout() {
  // Reset KPI definitions to defaults
  kpiDefinitions.forEach((kpi, _index) => {
    kpi.visible = kpi.default;
  });

  // Reset widget definitions to defaults
  widgetDefinitions.forEach(widget => {
    widget.visible = widget.default;
  });

  // Clear stored settings
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to remove settings from localStorage:', e);
  }

  // Re-apply defaults
  const defaults = getDefaultSettings();

  // Reset sidebar
  setSidebarCollapsed(false);
  document.body.classList.remove('sidebar-collapsed');

  // Reset dark mode
  setDarkMode(false);
  document.body.classList.remove('dark-mode');

  // Reset daily target
  setDailyTarget(DEFAULT_DAILY_TARGET);
  const targetInput = document.getElementById('dailyTarget');
  if (targetInput) {
    targetInput.value = DEFAULT_DAILY_TARGET;
  }

  // Apply widget visibility
  applyWidgetVisibility();

  // Save the reset state
  saveSettings();

  return defaults;
}
