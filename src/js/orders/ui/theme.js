/**
 * Theme management (dark/light mode)
 * @module ui/theme
 */

const THEME_STORAGE_KEY = 'theme';
const DEFAULT_THEME = 'light';

/**
 * Initialize theme from localStorage or default
 */
export function initTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME;
  applyTheme(savedTheme);
}

/**
 * Toggle between light and dark theme
 */
export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const newTheme = current === 'light' ? 'dark' : 'light';
  applyTheme(newTheme);
  localStorage.setItem(THEME_STORAGE_KEY, newTheme);
}

/**
 * Apply a specific theme
 * @param {string} theme - 'light' or 'dark'
 */
export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeIcon(theme);
}

/**
 * Update the theme toggle icon
 * @param {string} theme
 */
function updateThemeIcon(theme) {
  const icon = document.getElementById('theme-icon');
  if (icon) {
    icon.className = theme === 'light' ? 'ph ph-moon' : 'ph ph-sun';
  }
}

/**
 * Get current theme
 * @returns {string} 'light' or 'dark'
 */
export function getCurrentTheme() {
  return document.documentElement.getAttribute('data-theme') || DEFAULT_THEME;
}
