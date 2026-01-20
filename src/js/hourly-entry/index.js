/**
 * Hourly Production Entry App - Timeline View
 * Two-view architecture: Timeline (list) and Editor (full-screen)
 */

const API_URL = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production';

const TIME_SLOTS = [
  '7:00 AM – 8:00 AM',
  '8:00 AM – 9:00 AM',
  '9:00 AM – 10:00 AM',
  '10:00 AM – 11:00 AM',
  '11:00 AM – 12:00 PM',
  '12:30 PM – 1:00 PM',
  '1:00 PM – 2:00 PM',
  '2:00 PM – 3:00 PM',
  '3:00 PM – 4:00 PM',
  '4:00 PM – 4:30 PM',
];

const LABELS = {
  en: {
    title: 'Hourly Entry',
    today: 'Today',
    target: 'Target',
    hoursLogged: 'hrs logged',
    line1: 'Line 1',
    line2: 'Line 2',
    buckers: 'Buckers',
    trimmers: 'Trimmers',
    tzero: 'T-Zero',
    cultivar: 'Cultivar',
    tops: 'Tops (lbs)',
    smalls: 'Smalls (lbs)',
    qcNotes: 'QC Notes',
    saved: 'Saved',
    prev: 'Prev',
    next: 'Next',
  },
  es: {
    title: 'Entrada por Hora',
    today: 'Hoy',
    target: 'Meta',
    hoursLogged: 'hrs registradas',
    line1: 'Linea 1',
    line2: 'Linea 2',
    buckers: 'Buckers',
    trimmers: 'Podadores',
    tzero: 'T-Zero',
    cultivar: 'Cultivar',
    tops: 'Tops (lbs)',
    smalls: 'Smalls (lbs)',
    qcNotes: 'Notas QC',
    saved: 'Guardado',
    prev: 'Ant',
    next: 'Sig',
  },
};

// State
let currentLang = localStorage.getItem('lang') || 'en';
let currentDate = formatDateLocal(new Date());
let currentSlotIndex = -1;
let dayData = {};
let cultivarOptions = [];
let saveTimeout = null;
let targetRate = 0.9; // Default, will be updated from API

// DOM Elements
const timelineView = document.getElementById('timeline-view');
const editorView = document.getElementById('editor-view');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  initializeUI();
  await loadCultivars();
  await loadDayData(currentDate);
  highlightCurrentTimeSlot();
});

function initializeUI() {
  // Date picker
  const datePicker = document.getElementById('date-picker');
  datePicker.value = currentDate;
  datePicker.addEventListener('change', async (e) => {
    currentDate = e.target.value;
    await loadDayData(currentDate);
    renderTimeline();
  });

  // Today button
  document.getElementById('today-btn').addEventListener('click', async () => {
    currentDate = formatDateLocal(new Date());
    datePicker.value = currentDate;
    await loadDayData(currentDate);
    renderTimeline();
    highlightCurrentTimeSlot();
  });

  // Language toggle
  const langBtn = document.getElementById('lang-toggle');
  langBtn.textContent = currentLang === 'en' ? 'ES' : 'EN';
  langBtn.addEventListener('click', () => {
    currentLang = currentLang === 'en' ? 'es' : 'en';
    localStorage.setItem('lang', currentLang);
    langBtn.textContent = currentLang === 'en' ? 'ES' : 'EN';
    updateLabels();
  });

  // Back to timeline button
  document.getElementById('back-to-timeline').addEventListener('click', () => {
    showView('timeline');
  });

  // Prev/Next navigation
  document.getElementById('prev-slot').addEventListener('click', () => {
    if (currentSlotIndex > 0) {
      openEditor(currentSlotIndex - 1);
    }
  });

  document.getElementById('next-slot').addEventListener('click', () => {
    if (currentSlotIndex < TIME_SLOTS.length - 1) {
      openEditor(currentSlotIndex + 1);
    }
  });

  // Line 2 toggle
  document.getElementById('line2-toggle').addEventListener('click', () => {
    document.getElementById('line2-section').classList.toggle('expanded');
  });

  // Number input +/- buttons
  document.querySelectorAll('.number-input button').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const field = e.target.dataset.field;
      const input = document.getElementById(field);
      const currentVal = parseInt(input.value, 10) || 0;

      if (btn.classList.contains('increment')) {
        input.value = Math.min(currentVal + 1, 50);
      } else {
        input.value = Math.max(currentVal - 1, 0);
      }

      scheduleAutoSave();
    });
  });

  // Form inputs - auto-save on change
  document.querySelectorAll('#editor-view input, #editor-view select, #editor-view textarea').forEach((el) => {
    el.addEventListener('blur', () => scheduleAutoSave());
    el.addEventListener('change', () => scheduleAutoSave());
  });

  updateLabels();
  renderTimeline();
}

function showView(view) {
  if (view === 'timeline') {
    timelineView.classList.add('active');
    editorView.classList.remove('active');
    renderTimeline();
    updateTimelineSummary();
  } else {
    timelineView.classList.remove('active');
    editorView.classList.add('active');
  }
}

function renderTimeline() {
  const list = document.getElementById('timeline-list');
  list.innerHTML = '';

  const currentSlot = getCurrentTimeSlot();

  TIME_SLOTS.forEach((slot, index) => {
    const data = dayData[slot] || {};
    const totalLbs = (data.tops1 || 0) + (data.tops2 || 0);
    const hasData = totalLbs > 0 || data.trimmers1 > 0;
    const isCurrent = slot === currentSlot;

    const div = document.createElement('div');
    div.className = 'timeline-slot' + (hasData ? ' has-data' : '') + (isCurrent ? ' current' : '');
    div.innerHTML = `
      <span class="slot-time">${formatSlotShort(slot)}</span>
      <span class="slot-lbs ${hasData ? '' : 'empty'}">${hasData ? totalLbs.toFixed(1) + ' lbs' : '—'}</span>
      <span class="slot-status">${hasData ? '✓' : '○'}</span>
    `;
    div.addEventListener('click', () => openEditor(index));
    list.appendChild(div);
  });
}

function openEditor(slotIndex) {
  currentSlotIndex = slotIndex;
  const slot = TIME_SLOTS[slotIndex];

  // Update time label
  document.getElementById('editor-time-label').textContent = slot;

  // Populate form
  populateForm(slot);

  // Update nav buttons
  document.getElementById('prev-slot').disabled = slotIndex === 0;
  document.getElementById('next-slot').disabled = slotIndex === TIME_SLOTS.length - 1;

  // Update header summary
  updateEditorSummary();

  // Show editor
  showView('editor');
}

function populateForm(slot) {
  const data = dayData[slot] || {};

  document.getElementById('buckers1').value = data.buckers1 || 0;
  document.getElementById('trimmers1').value = data.trimmers1 || 0;
  document.getElementById('tzero1').value = data.tzero1 || 0;
  document.getElementById('cultivar1').value = data.cultivar1 || '';
  document.getElementById('tops1').value = data.tops1 || 0;
  document.getElementById('smalls1').value = data.smalls1 || 0;

  document.getElementById('buckers2').value = data.buckers2 || 0;
  document.getElementById('trimmers2').value = data.trimmers2 || 0;
  document.getElementById('tzero2').value = data.tzero2 || 0;
  document.getElementById('cultivar2').value = data.cultivar2 || '';
  document.getElementById('tops2').value = data.tops2 || 0;
  document.getElementById('smalls2').value = data.smalls2 || 0;

  document.getElementById('qc').value = data.qc || '';

  // Auto-expand Line 2 if it has data
  const line2Section = document.getElementById('line2-section');
  const hasLine2Data = data.trimmers2 > 0 || data.tops2 > 0;
  line2Section.classList.toggle('expanded', hasLine2Data);
}

function collectFormData() {
  const slot = TIME_SLOTS[currentSlotIndex];
  return {
    date: currentDate,
    timeSlot: slot,
    buckers1: parseInt(document.getElementById('buckers1').value, 10) || 0,
    trimmers1: parseInt(document.getElementById('trimmers1').value, 10) || 0,
    tzero1: parseInt(document.getElementById('tzero1').value, 10) || 0,
    cultivar1: document.getElementById('cultivar1').value,
    tops1: parseFloat(document.getElementById('tops1').value) || 0,
    smalls1: parseFloat(document.getElementById('smalls1').value) || 0,
    buckers2: parseInt(document.getElementById('buckers2').value, 10) || 0,
    trimmers2: parseInt(document.getElementById('trimmers2').value, 10) || 0,
    tzero2: parseInt(document.getElementById('tzero2').value, 10) || 0,
    cultivar2: document.getElementById('cultivar2').value,
    tops2: parseFloat(document.getElementById('tops2').value) || 0,
    smalls2: parseFloat(document.getElementById('smalls2').value) || 0,
    qc: document.getElementById('qc').value,
  };
}

function scheduleAutoSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => saveEntry(), 1000);
}

async function saveEntry() {
  if (currentSlotIndex < 0) return;

  const data = collectFormData();
  const indicator = document.getElementById('save-indicator');

  try {
    const response = await fetch(`${API_URL}?action=addProduction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Save failed');
    }

    // Update local data
    const slot = TIME_SLOTS[currentSlotIndex];
    dayData[slot] = data;

    // Show saved indicator
    indicator.classList.add('visible');
    setTimeout(() => indicator.classList.remove('visible'), 2000);

    // Update summaries
    updateEditorSummary();
  } catch (error) {
    console.error('Save error:', error);
  }
}

async function loadDayData(date) {
  showLoading(true);

  try {
    const response = await fetch(`${API_URL}?action=getProduction&date=${date}`);
    const result = await response.json();
    const data = result.data || result;

    dayData = {};
    if (data.production && Array.isArray(data.production)) {
      data.production.forEach((row) => {
        dayData[row.timeSlot] = row;
      });
    }

    // Get target rate if available
    if (data.targetRate) {
      targetRate = data.targetRate;
    }

    renderTimeline();
    updateTimelineSummary();
  } catch (error) {
    console.error('Load error:', error);
  } finally {
    showLoading(false);
  }
}

async function loadCultivars() {
  try {
    const response = await fetch(`${API_URL}?action=getCultivars`);
    const result = await response.json();
    const data = result.data || result;

    // Filter to only 2025 cultivars
    cultivarOptions = (data.cultivars || []).filter(c => c.startsWith('2025'));
    populateCultivarSelects();
  } catch (error) {
    console.error('Failed to load cultivars:', error);
  }
}

function populateCultivarSelects() {
  const selects = [document.getElementById('cultivar1'), document.getElementById('cultivar2')];

  selects.forEach((select) => {
    const currentValue = select.value;
    select.innerHTML = '<option value="">Select...</option>';

    cultivarOptions.forEach((cultivar) => {
      const option = document.createElement('option');
      option.value = cultivar;
      option.textContent = cultivar;
      select.appendChild(option);
    });

    select.value = currentValue;
  });
}

function updateTimelineSummary() {
  let totalTops = 0;
  let totalTarget = 0;
  let hoursLogged = 0;

  Object.values(dayData).forEach((row) => {
    const rowTops = (row.tops1 || 0) + (row.tops2 || 0);
    totalTops += rowTops;
    if (rowTops > 0 || row.trimmers1 > 0) {
      hoursLogged++;
      // Calculate target based on trimmers
      const trimmers = (row.trimmers1 || 0) + (row.trimmers2 || 0);
      const multiplier = getSlotMultiplier(row.timeSlot);
      totalTarget += trimmers * targetRate * multiplier;
    }
  });

  const percentage = totalTarget > 0 ? Math.round((totalTops / totalTarget) * 100) : 0;

  document.getElementById('timeline-total').textContent = `${totalTops.toFixed(1)} lbs`;
  document.getElementById('timeline-target').textContent = `${totalTarget.toFixed(1)} lbs`;
  document.getElementById('timeline-hours').textContent = hoursLogged;
  document.getElementById('timeline-progress').style.width = `${Math.min(percentage, 100)}%`;
}

function updateEditorSummary() {
  let totalTops = 0;
  let totalTarget = 0;

  Object.values(dayData).forEach((row) => {
    totalTops += (row.tops1 || 0) + (row.tops2 || 0);
    const trimmers = (row.trimmers1 || 0) + (row.trimmers2 || 0);
    const multiplier = getSlotMultiplier(row.timeSlot);
    totalTarget += trimmers * targetRate * multiplier;
  });

  const percentage = totalTarget > 0 ? Math.round((totalTops / totalTarget) * 100) : 0;

  document.getElementById('editor-total').textContent = `${totalTops.toFixed(1)} lbs`;
  document.getElementById('editor-percent').textContent = `${percentage}%`;
}

function getSlotMultiplier(slot) {
  // Half-hour slots get 0.5 multiplier, lunch slot gets 0.5
  if (slot === '4:00 PM – 4:30 PM' || slot === '12:30 PM – 1:00 PM') {
    return 0.5;
  }
  return 1;
}

function getCurrentTimeSlot() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  const slotTimes = [
    { slot: TIME_SLOTS[0], start: 7 * 60, end: 8 * 60 },
    { slot: TIME_SLOTS[1], start: 8 * 60, end: 9 * 60 },
    { slot: TIME_SLOTS[2], start: 9 * 60, end: 10 * 60 },
    { slot: TIME_SLOTS[3], start: 10 * 60, end: 11 * 60 },
    { slot: TIME_SLOTS[4], start: 11 * 60, end: 12 * 60 },
    { slot: TIME_SLOTS[5], start: 12 * 60 + 30, end: 13 * 60 },
    { slot: TIME_SLOTS[6], start: 13 * 60, end: 14 * 60 },
    { slot: TIME_SLOTS[7], start: 14 * 60, end: 15 * 60 },
    { slot: TIME_SLOTS[8], start: 15 * 60, end: 16 * 60 },
    { slot: TIME_SLOTS[9], start: 16 * 60, end: 16 * 60 + 30 },
  ];

  for (const st of slotTimes) {
    if (totalMinutes >= st.start && totalMinutes < st.end) {
      return st.slot;
    }
  }

  return null;
}

function highlightCurrentTimeSlot() {
  const currentSlot = getCurrentTimeSlot();
  if (!currentSlot) return;

  // Scroll to current slot in timeline
  setTimeout(() => {
    const slots = document.querySelectorAll('.timeline-slot');
    const currentEl = Array.from(slots).find(el => el.querySelector('.slot-time').textContent === formatSlotShort(currentSlot));
    if (currentEl) {
      currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 100);
}

function formatSlotShort(slot) {
  // "7:00 AM – 8:00 AM" -> "7-8 AM"
  const match = slot.match(/(\d+):00\s*(AM|PM)\s*[–-]\s*(\d+):(\d+)\s*(AM|PM)/i);
  if (match) {
    const startHour = match[1];
    const endHour = match[3];
    const endMin = match[4];
    const period = match[5];
    if (endMin === '00') {
      return `${startHour}-${endHour} ${period}`;
    }
    return `${startHour}-${endHour}:${endMin} ${period}`;
  }
  return slot;
}

function formatDateLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function updateLabels() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (LABELS[currentLang][key]) {
      el.textContent = LABELS[currentLang][key];
    }
  });
}

function showLoading(show) {
  document.getElementById('loading-overlay').classList.toggle('active', show);
}
