/**
 * Scale Display - Local UI
 * Updates circular progress ring based on weight from local API
 */

// i18n
const labels = {
  en: {
    target: 'Target',
    connected: 'Connected',
    disconnected: 'Disconnected',
    connecting: 'Connecting...',
  },
  es: {
    target: 'Meta',
    connected: 'Conectado',
    disconnected: 'Desconectado',
    connecting: 'Conectando...',
  },
};

let lang = localStorage.getItem('scale-lang') || 'en';

// DOM elements
const weightEl = document.getElementById('weight');
const ringProgress = document.getElementById('ring-progress');
const statusEl = document.getElementById('status');
const statusText = statusEl.querySelector('.status-text');
const checkmark = document.getElementById('checkmark');
const targetWeightEl = document.getElementById('target-weight');
const langToggle = document.getElementById('lang-toggle');

// Ring math
const RING_CIRCUMFERENCE = 2 * Math.PI * 90; // radius = 90

// State
let lastWeight = -1;
let showCheckmark = false;
let checkmarkTimeout = null;

// Update language
function updateLang() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (labels[lang][key]) {
      el.textContent = labels[lang][key];
    }
  });
  langToggle.textContent = lang === 'en' ? 'ES' : 'EN';
  localStorage.setItem('scale-lang', lang);
}

// Toggle language
langToggle.addEventListener('click', () => {
  lang = lang === 'en' ? 'es' : 'en';
  updateLang();
});

// Update display based on weight data
function updateDisplay(data) {
  const { weight, targetWeight, percentComplete, isConnected } = data;

  // Update status
  if (isConnected) {
    statusEl.classList.add('connected');
    statusText.textContent = labels[lang].connected;
  } else {
    statusEl.classList.remove('connected');
    statusText.textContent = labels[lang].disconnected;
  }

  // Update weight value
  weightEl.textContent = weight.toFixed(2);
  targetWeightEl.textContent = targetWeight.toFixed(2);

  // Calculate ring offset (0 = full, circumference = empty)
  const offset = RING_CIRCUMFERENCE * (1 - percentComplete / 100);
  ringProgress.style.strokeDashoffset = offset;

  // Color states based on percentage
  const isNearTarget = percentComplete >= 90 && percentComplete < 100;
  const isAtTarget = percentComplete >= 100;

  // Update ring color
  ringProgress.classList.toggle('near-target', isNearTarget);
  ringProgress.classList.toggle('at-target', isAtTarget);

  // Update weight color
  weightEl.classList.toggle('near-target', isNearTarget);
  weightEl.classList.toggle('at-target', isAtTarget);

  // Show checkmark briefly when reaching target
  if (isAtTarget && !showCheckmark && lastWeight < targetWeight) {
    showCheckmark = true;
    checkmark.classList.add('visible');

    // Hide checkmark after 2 seconds
    clearTimeout(checkmarkTimeout);
    checkmarkTimeout = setTimeout(() => {
      checkmark.classList.remove('visible');
    }, 2000);
  }

  // Reset checkmark flag when weight drops (bag removed)
  if (weight < targetWeight * 0.5) {
    showCheckmark = false;
  }

  lastWeight = weight;
}

// Fetch weight from local server
async function fetchWeight() {
  try {
    const response = await fetch('/api/weight');
    const data = await response.json();
    updateDisplay(data);
  } catch (error) {
    // Server not responding
    statusEl.classList.remove('connected');
    statusText.textContent = labels[lang].disconnected;
  }
}

// Poll every 100ms for smooth updates
setInterval(fetchWeight, 100);

// Initial fetch
fetchWeight();
updateLang();

// Fullscreen on F11 or double-click
document.addEventListener('keydown', (e) => {
  if (e.key === 'F11') {
    e.preventDefault();
    document.body.classList.toggle('fullscreen');
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }
});

document.addEventListener('dblclick', () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen();
  }
});
