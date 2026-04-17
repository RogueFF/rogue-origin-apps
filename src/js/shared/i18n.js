/**
 * Shared i18n helper.
 * Unifies language storage on localStorage key "ro-lang" (values: "en" | "es").
 * Pages register their labels once; the module walks [data-i18n] and
 * [data-i18n-placeholder] on setLang and emits ro:langchange for custom needs.
 */

const KEY = 'ro-lang';
const LEGACY_KEYS = ['barcodeLang', 'kanbanLang', 'sopAppLang', 'lang', 'language'];

let labels = { en: {}, es: {} };
let currentLang = null;

function readStored() {
  const v = localStorage.getItem(KEY);
  if (v === 'en' || v === 'es') return v;
  for (const k of LEGACY_KEYS) {
    const legacy = localStorage.getItem(k);
    if (legacy === 'en' || legacy === 'es') {
      localStorage.setItem(KEY, legacy);
      localStorage.removeItem(k);
      return legacy;
    }
  }
  return null;
}

export function registerLabels(newLabels) {
  labels = {
    en: { ...labels.en, ...(newLabels.en || {}) },
    es: { ...labels.es, ...(newLabels.es || {}) },
  };
  applyDOM();
}

export function t(key) {
  return labels[currentLang]?.[key] ?? labels.en?.[key] ?? key;
}

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  const next = lang === 'es' ? 'es' : 'en';
  currentLang = next;
  localStorage.setItem(KEY, next);
  document.documentElement.setAttribute('lang', next);
  applyDOM();
  document.dispatchEvent(new CustomEvent('ro:langchange', { detail: { lang: next } }));
}

export function toggleLang() {
  setLang(currentLang === 'en' ? 'es' : 'en');
}

function applyDOM() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
}

currentLang = readStored() || 'en';

if (typeof window !== 'undefined') {
  window.t = t;
  window.setLang = setLang;
  window.toggleLang = toggleLang;
  window.getLang = getLang;
  window.registerLabels = registerLabels;
}
