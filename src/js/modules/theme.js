/**
 * Theme Module
 * Handles dark/light theme toggling and Chart.js theme integration
 */

import { isDarkMode, setDarkMode } from './state.js';

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

  const colors = THEME_COLORS[theme] || THEME_COLORS.light;

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
 * Update theme UI elements
 * @param {string} theme - 'dark' or 'light'
 */
export function updateThemeUI(theme) {
  // Set data-theme attribute on document root
  document.documentElement.setAttribute('data-theme', theme);

  // Update theme toggle button if it exists
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    const icon = themeToggle.querySelector('i');
    if (icon) {
      icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }
  }

  // Update any theme toggle text if present
  const themeText = document.querySelector('.theme-toggle-text');
  if (themeText) {
    themeText.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
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
 * Initialize theme based on saved preference or system preference
 */
export function initTheme() {
  // Check localStorage first
  const savedTheme = localStorage.getItem('theme');

  let theme;
  if (savedTheme) {
    theme = savedTheme;
  } else {
    // Fall back to system preference
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    theme = prefersDark ? 'dark' : 'light';
  }

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
