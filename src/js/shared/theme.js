/**
 * Shared theme helper.
 * Unifies theme storage on localStorage key "ro-theme" (values: "dark" | "light").
 * Applies both data-theme attribute and body.dark-mode class so pages on either
 * CSS convention work. Migrates legacy keys on first run.
 */

const KEY = 'ro-theme';
// Note: index.html still uses its own modules/theme.js with key "theme";
// that key is NOT migrated so both storages coexist until that module is unified.
const LEGACY_KEYS = ['sopDarkMode', 'darkMode', 'kanbanDarkMode', 'barcodeDarkMode'];

function readStored() {
  const current = localStorage.getItem(KEY);
  if (current === 'dark' || current === 'light') return current;

  for (const k of LEGACY_KEYS) {
    const v = localStorage.getItem(k);
    if (v == null) continue;
    const migrated = v === 'dark' || v === 'true' ? 'dark' : 'light';
    localStorage.setItem(KEY, migrated);
    localStorage.removeItem(k);
    return migrated;
  }
  return null;
}

function apply(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.body.classList.toggle('dark-mode', theme === 'dark');
  document.dispatchEvent(new CustomEvent('ro:themechange', { detail: { theme } }));
}

export function getTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function setTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  apply(next);
  localStorage.setItem(KEY, next);
}

export function toggleTheme() {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

export function initTheme(defaultTheme = 'light') {
  const stored = readStored();
  apply(stored || defaultTheme);
}

if (typeof window !== 'undefined') {
  window.toggleTheme = toggleTheme;
  window.toggleDarkMode = toggleTheme;
  window.setTheme = setTheme;
  const pageDefault = document.documentElement.getAttribute('data-theme-default');
  initTheme(pageDefault === 'dark' ? 'dark' : 'light');
}
