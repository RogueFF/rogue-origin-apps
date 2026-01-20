/**
 * Hourly Production Entry App
 * Mobile-friendly interface for entering hourly production data
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
    line1: 'Line 1',
    line2: 'Line 2',
    buckers: 'Buckers',
    trimmers: 'Trimmers',
    tzero: 'T-Zero',
    cultivar: 'Cultivar',
    tops: 'Tops (lbs)',
    smalls: 'Smalls (lbs)',
    qcNotes: 'QC Notes',
    save: 'Save',
    saved: 'Saved',
    saving: 'Saving...',
    daySummary: 'Day Summary',
    totalTops: 'Total Tops',
    totalSmalls: 'Total Smalls',
    trimmerHours: 'Trimmer Hours',
    avgRate: 'Avg Rate',
    loading: 'Loading...',
    error: 'Error',
    saveError: 'Failed to save. Please try again.',
  },
  es: {
    title: 'Entrada por Hora',
    today: 'Hoy',
    line1: 'Linea 1',
    line2: 'Linea 2',
    buckers: 'Buckers',
    trimmers: 'Podadores',
    tzero: 'T-Zero',
    cultivar: 'Cultivar',
    tops: 'Tops (lbs)',
    smalls: 'Smalls (lbs)',
    qcNotes: 'Notas QC',
    save: 'Guardar',
    saved: 'Guardado',
    saving: 'Guardando...',
    daySummary: 'Resumen del Dia',
    totalTops: 'Total Tops',
    totalSmalls: 'Total Smalls',
    trimmerHours: 'Horas Podadores',
    avgRate: 'Promedio',
    loading: 'Cargando...',
    error: 'Error',
    saveError: 'Error al guardar. Intente de nuevo.',
  },
};

// State
let currentLang = localStorage.getItem('lang') || 'en';
let currentDate = formatDateLocal(new Date());
let currentSlot = '';
let dayData = {};
let cultivarOptions = [];
let saveTimeout = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  initializeUI();
  await loadCultivars();
  await loadDayData(currentDate);
  selectCurrentTimeSlot();
});

function initializeUI() {
  // Date picker
  const datePicker = document.getElementById('date-picker');
  datePicker.value = currentDate;
  datePicker.addEventListener('change', async (e) => {
    currentDate = e.target.value;
    await loadDayData(currentDate);
  });

  // Today button
  document.getElementById('today-btn').addEventListener('click', async () => {
    currentDate = formatDateLocal(new Date());
    datePicker.value = currentDate;
    await loadDayData(currentDate);
    selectCurrentTimeSlot();
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

  // Time slots nav
  renderTimeSlots();

  // Line 2 toggle
  const line2Toggle = document.getElementById('line2-toggle');
  const line2Section = line2Toggle.closest('.line-section');
  line2Toggle.addEventListener('click', () => {
    line2Section.classList.toggle('expanded');
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

  // Form inputs - auto-save on blur
  document.querySelectorAll('#entry-form input, #entry-form select, #entry-form textarea').forEach((el) => {
    el.addEventListener('blur', () => scheduleAutoSave());
    el.addEventListener('change', () => scheduleAutoSave());
  });

  // Form submit
  document.getElementById('entry-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveEntry();
  });

  updateLabels();
}

function renderTimeSlots() {
  const nav = document.getElementById('time-slots-nav');
  nav.innerHTML = '';

  TIME_SLOTS.forEach((slot) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'time-slot-tab';
    tab.textContent = formatSlotShort(slot);
    tab.dataset.slot = slot;
    tab.addEventListener('click', () => selectSlot(slot));
    nav.appendChild(tab);
  });
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

function selectCurrentTimeSlot() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  // Find the slot that matches current time
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

  let targetSlot = TIME_SLOTS[0];

  for (const st of slotTimes) {
    if (totalMinutes >= st.start && totalMinutes < st.end) {
      targetSlot = st.slot;
      break;
    } else if (totalMinutes < st.start) {
      // Before this slot, select previous
      break;
    }
    targetSlot = st.slot;
  }

  selectSlot(targetSlot);
}

function selectSlot(slot) {
  currentSlot = slot;

  // Update tabs
  document.querySelectorAll('.time-slot-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.slot === slot);
  });

  // Scroll to active tab
  const activeTab = document.querySelector('.time-slot-tab.active');
  if (activeTab) {
    activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  // Update label
  document.getElementById('current-slot-label').textContent = slot;

  // Populate form with existing data
  populateForm(slot);
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
  const line2Section = document.getElementById('line2-toggle').closest('.line-section');
  const hasLine2Data = data.trimmers2 > 0 || data.tops2 > 0;
  line2Section.classList.toggle('expanded', hasLine2Data);
}

function collectFormData() {
  return {
    date: currentDate,
    timeSlot: currentSlot,
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
  // Debounce - save 1 second after last change
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => saveEntry(true), 1000);
}

async function saveEntry(silent = false) {
  if (!currentSlot) return;

  const data = collectFormData();
  const saveBtn = document.getElementById('save-btn');
  const indicator = document.getElementById('save-indicator');

  if (!silent) {
    saveBtn.disabled = true;
    saveBtn.textContent = t('saving');
  }

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
    dayData[currentSlot] = data;
    updateSlotIndicators();
    updateSummary();

    // Show saved indicator
    indicator.textContent = t('saved');
    indicator.classList.remove('hidden');
    setTimeout(() => indicator.classList.add('hidden'), 2000);
  } catch (error) {
    console.error('Save error:', error);
    if (!silent) {
      alert(t('saveError'));
    }
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = t('save');
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

    updateSlotIndicators();
    updateSummary();

    if (currentSlot) {
      populateForm(currentSlot);
    }
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

    // Add "Other" option for custom entry
    const otherOption = document.createElement('option');
    otherOption.value = '__custom__';
    otherOption.textContent = '+ Add Custom...';
    select.appendChild(otherOption);

    select.value = currentValue;
  });
}

function updateSlotIndicators() {
  document.querySelectorAll('.time-slot-tab').forEach((tab) => {
    const slot = tab.dataset.slot;
    const data = dayData[slot];
    const hasData = data && (data.tops1 > 0 || data.tops2 > 0 || data.trimmers1 > 0);
    tab.classList.toggle('has-data', hasData);
  });
}

function updateSummary() {
  let totalTops = 0;
  let totalSmalls = 0;
  let totalTrimmerHours = 0;

  Object.values(dayData).forEach((row) => {
    totalTops += (row.tops1 || 0) + (row.tops2 || 0);
    totalSmalls += (row.smalls1 || 0) + (row.smalls2 || 0);
    totalTrimmerHours += (row.trimmers1 || 0) + (row.trimmers2 || 0);
  });

  const avgRate = totalTrimmerHours > 0 ? (totalTops / totalTrimmerHours).toFixed(2) : '--';

  document.getElementById('total-tops').textContent = `${totalTops.toFixed(1)} lbs`;
  document.getElementById('total-smalls').textContent = `${totalSmalls.toFixed(1)} lbs`;
  document.getElementById('trimmer-hours').textContent = totalTrimmerHours;
  document.getElementById('avg-rate').textContent = avgRate !== '--' ? `${avgRate} lbs/hr` : '-- lbs/hr';
}

function updateLabels() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (LABELS[currentLang][key]) {
      el.textContent = LABELS[currentLang][key];
    }
  });
}

function t(key) {
  return LABELS[currentLang][key] || key;
}

function formatDateLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function showLoading(show) {
  document.getElementById('loading-overlay').classList.toggle('active', show);
}
