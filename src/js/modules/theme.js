/**
 * Theme Module (Dashboard)
 *
 * Thin adapter over `../shared/theme.js` (the canonical theme module).
 * Storage, persistence, and DOM application (data-theme attribute,
 * body.dark-mode class, `ro:themechange` event) all live in shared/theme.js.
 *
 * This module layers dashboard-specific concerns on top:
 *   - Chart.js default-color updates (updateChartTheme)
 *   - Theme toggle button icon/label swap (updateThemeUI)
 *   - Sync to the modules state store (isDarkMode/setDarkMode)
 *
 * A `ro:themechange` listener (wired below) keeps chart colors, the state
 * store, and the toggle button in sync whenever the theme flips — regardless
 * of who initiated the flip (header button, command palette, another tab).
 */

import { setDarkMode } from './state.js';
import {
  getTheme as sharedGetTheme,
  setTheme as sharedSetTheme,
  toggleTheme as sharedToggleTheme,
  initTheme as sharedInitTheme
} from '../shared/theme.js';

// SVG Icons for theme toggle
const MOON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8.5a5.5 5.5 0 1 1-5-7 4.5 4.5 0 0 0 5 7z"/></svg>';
const SUN_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="3"/><line x1="8" y1="1" x2="8" y2="3"/><line x1="8" y1="13" x2="8" y2="15"/><line x1="1" y1="8" x2="3" y2="8"/><line x1="13" y1="8" x2="15" y2="8"/><line x1="3.05" y1="3.05" x2="4.46" y2="4.46"/><line x1="11.54" y1="11.54" x2="12.95" y2="12.95"/><line x1="3.05" y1="12.95" x2="4.46" y2="11.54"/><line x1="11.54" y1="4.46" x2="12.95" y2="3.05"/></svg>';

// Theme color configurations used by Chart.js defaults
const THEME_COLORS = {
  dark: {
    text: 'rgba(255,255,255,0.4)',
    grid: 'rgba(255,255,255,0.06)',
    tooltipBg: '#1a1e1b',
    tooltipBorder: 'rgba(102,137,113,0.2)',
    tooltipTitle: 'rgba(255,255,255,0.88)',
    tooltipBody: 'rgba(255,255,255,0.6)'
  },
  light: {
    text: 'rgba(45,58,46,0.4)',
    grid: 'rgba(0,0,0,0.06)',
    tooltipBg: '#ffffff',
    tooltipBorder: 'rgba(0,0,0,0.1)',
    tooltipTitle: '#2d3a2e',
    tooltipBody: 'rgba(45,58,46,0.6)'
  }
};

/**
 * Update Chart.js default colors based on theme and re-render all active charts
 * @param {string} theme - 'dark' or 'light'
 */
export function updateChartTheme(theme) {
  // Check if Chart.js is available
  if (typeof Chart === 'undefined') {
    return;
  }

  const colors = THEME_COLORS[theme] || THEME_COLORS.dark;

  // Update Chart.js defaults
  Chart.defaults.color = colors.text;
  Chart.defaults.borderColor = colors.grid;

  // Update scale defaults
  if (Chart.defaults.scales) {
    if (Chart.defaults.scales.linear) {
      Chart.defaults.scales.linear.grid = Chart.defaults.scales.linear.grid || {};
      Chart.defaults.scales.linear.grid.color = colors.grid;
      Chart.defaults.scales.linear.ticks = Chart.defaults.scales.linear.ticks || {};
      Chart.defaults.scales.linear.ticks.color = colors.text;
    }
    if (Chart.defaults.scales.category) {
      Chart.defaults.scales.category.grid = Chart.defaults.scales.category.grid || {};
      Chart.defaults.scales.category.grid.color = colors.grid;
      Chart.defaults.scales.category.ticks = Chart.defaults.scales.category.ticks || {};
      Chart.defaults.scales.category.ticks.color = colors.text;
    }
  }

  // Update tooltip defaults
  if (Chart.defaults.plugins && Chart.defaults.plugins.tooltip) {
    Chart.defaults.plugins.tooltip.backgroundColor = colors.tooltipBg;
    Chart.defaults.plugins.tooltip.borderColor = colors.tooltipBorder;
    Chart.defaults.plugins.tooltip.titleColor = colors.tooltipTitle;
    Chart.defaults.plugins.tooltip.bodyColor = colors.tooltipBody;
  }

  // Re-render all active Chart.js instances so theme colors take effect
  Object.values(Chart.instances || {}).forEach(function(chart) {
    if (chart && typeof chart.update === 'function') {
      chart.update('none');
    }
  });
}

/**
 * Update theme toggle button icon and label.
 * @param {string} theme - 'dark' or 'light'
 */
function updateToggleButton(theme) {
  const themeIcon = document.getElementById('themeIcon');
  const themeLabel = document.getElementById('themeLabel');
  if (themeIcon) {
    themeIcon.innerHTML = theme === 'dark' ? MOON_SVG : SUN_SVG;
  }
  if (themeLabel) {
    themeLabel.textContent = theme === 'dark' ? 'Dark' : 'Light';
  }
}

/**
 * Update dashboard-specific theme UI pieces (button icon/label, mobile theme-color meta).
 * The core data-theme attribute + body.dark-mode class are handled by shared/theme.js.
 * @param {string} theme - 'dark' or 'light'
 */
export function updateThemeUI(theme) {
  updateToggleButton(theme);

  // Update meta theme-color for mobile browsers
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', theme === 'dark' ? '#0f1210' : '#668971');
  }
}

/**
 * Toggle between light and dark themes.
 * Persistence + DOM + event dispatch is handled by shared/theme.js.
 * The `ro:themechange` listener below handles chart + state + UI sync.
 * @returns {string} The new theme ('dark' or 'light')
 */
export function toggleTheme() {
  sharedToggleTheme();
  return sharedGetTheme();
}

/**
 * Legacy alias kept for backwards compatibility with older call sites.
 * @deprecated Use toggleTheme() instead
 */
export function toggleDarkMode() {
  return toggleTheme();
}

/**
 * Initialize dashboard theme. shared/theme.js auto-initializes on its own
 * script load, so this call is idempotent — we just make sure dashboard-
 * specific UI (state store, chart defaults, icon) is in sync with whatever
 * shared/theme.js resolved to.
 */
export function initTheme() {
  // shared/theme.js auto-initializes on its module load. If for some reason
  // that has not happened yet (e.g. a test harness imports this module
  // directly), kick it off with the page's default.
  if (!document.documentElement.getAttribute('data-theme')) {
    const pageDefault = document.documentElement.getAttribute('data-theme-default');
    sharedInitTheme(pageDefault === 'dark' ? 'dark' : 'light');
  }

  const theme = sharedGetTheme();

  // Re-apply via shared.setTheme so body.dark-mode class is forced back in
  // sync. loadSettings() in settings.js toggles this class from its own
  // (stale) localStorage store and can leave it disagreeing with the real
  // theme attribute; this re-apply is the authoritative reconciliation.
  sharedSetTheme(theme);

  // State store + dashboard-specific UI are then synced by the
  // ro:themechange listener below (fired by sharedSetTheme above).
  // Call them directly too as a safety net for this initial pass.
  setDarkMode(theme === 'dark');
  updateThemeUI(theme);
  updateChartTheme(theme);

  return theme;
}

// ===== ro:themechange LISTENER =====
// shared/theme.js dispatches this event whenever the theme changes. Wire
// dashboard-specific side-effects here so ANY code path (header button,
// command palette, programmatic setTheme, system dark-mode change) keeps
// chart colors + state store + toggle button in sync.
if (typeof document !== 'undefined') {
  document.addEventListener('ro:themechange', function(e) {
    const theme = (e && e.detail && e.detail.theme) || sharedGetTheme();
    setDarkMode(theme === 'dark');
    updateThemeUI(theme);
    updateChartTheme(theme);
  });
}

// Export theme colors for external use if needed
export { THEME_COLORS };
