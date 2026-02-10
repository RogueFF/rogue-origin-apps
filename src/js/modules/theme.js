/**
 * Theme Module
 * Handles dark/light theme toggling and Chart.js theme integration
 */

import { isDarkMode, setDarkMode } from './state.js';

// SVG Icons for theme toggle
const MOON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8.5a5.5 5.5 0 1 1-5-7 4.5 4.5 0 0 0 5 7z"/></svg>';
const SUN_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="3"/><line x1="8" y1="1" x2="8" y2="3"/><line x1="8" y1="13" x2="8" y2="15"/><line x1="1" y1="8" x2="3" y2="8"/><line x1="13" y1="8" x2="15" y2="8"/><line x1="3.05" y1="3.05" x2="4.46" y2="4.46"/><line x1="11.54" y1="11.54" x2="12.95" y2="12.95"/><line x1="3.05" y1="12.95" x2="4.46" y2="11.54"/><line x1="11.54" y1="4.46" x2="12.95" y2="3.05"/></svg>';

// Theme color configurations
const THEME_COLORS = {
  dark: {
    text: '#a8b5a9',
    grid: 'rgba(168, 181, 169, 0.1)',
    tooltipBg: 'rgba(26, 31, 22, 0.95)'
  },
  light: {
    text: '#5a6b5f',
    grid: 'rgba(102, 137, 113, 0.08)',
    tooltipBg: 'rgba(255, 255, 255, 0.95)'
  }
};

/**
 * Update Chart.js default colors based on theme
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
    Chart.defaults.plugins.tooltip.titleColor = colors.text;
    Chart.defaults.plugins.tooltip.bodyColor = colors.text;
  }
}

/**
 * Update theme toggle button icon and label
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
 * Update theme UI elements
 * @param {string} theme - 'dark' or 'light'
 */
export function updateThemeUI(theme) {
  // Set data-theme attribute on document root
  document.documentElement.setAttribute('data-theme', theme);

  // Update toggle button icon/label
  updateToggleButton(theme);

  // Update meta theme-color for mobile browsers
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', theme === 'dark' ? '#0f1210' : '#668971');
  }
}

/**
 * Toggle between light and dark themes
 * @returns {string} The new theme ('dark' or 'light')
 */
export function toggleTheme() {
  const currentlyDark = isDarkMode();
  const newTheme = currentlyDark ? 'light' : 'dark';

  // Update state
  setDarkMode(!currentlyDark);

  // Update UI
  updateThemeUI(newTheme);

  // Update Chart.js colors
  updateChartTheme(newTheme);

  // Persist to localStorage
  localStorage.setItem('theme', newTheme);

  return newTheme;
}

/**
 * Initialize theme based on saved preference, defaulting to dark
 */
export function initTheme() {
  // Check localStorage first
  const savedTheme = localStorage.getItem('theme');

  // Default to dark if no preference saved
  const theme = savedTheme || 'dark';

  // Update state
  setDarkMode(theme === 'dark');

  // Apply theme
  updateThemeUI(theme);
  updateChartTheme(theme);

  // Listen for system theme changes (only if no saved preference)
  if (!savedTheme && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
      // Only auto-switch if user hasn't set a preference
      if (!localStorage.getItem('theme')) {
        const newTheme = e.matches ? 'dark' : 'light';
        setDarkMode(e.matches);
        updateThemeUI(newTheme);
        updateChartTheme(newTheme);
      }
    });
  }

  return theme;
}

/**
 * Legacy alias for toggleTheme
 * @deprecated Use toggleTheme() instead
 */
export function toggleDarkMode() {
  return toggleTheme();
}

// Export theme colors for external use if needed
export { THEME_COLORS };
