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
    floorManager: 'Floor Manager',
    today: 'Today',
    target: 'Target',
    hoursLogged: 'hrs logged',
    crew: 'Crew',
    production: 'Production',
    line1: 'Line 1',
    line2: 'Line 2',
    buckers: 'Buckers',
    trimmers: 'Trimmers',
    tzero: 'T-Zero',
    qcperson: 'QC',
    cultivar: 'Cultivar',
    tops: 'Tops (lbs)',
    smalls: 'Smalls (lbs)',
    qcNotes: 'QC Notes',
    saved: 'Saved',
    prev: 'Prev',
    next: 'Next',
    saveFailed: 'Save failed',
    tapToRetry: 'Tap to retry',
    saving: 'Saving',
    // Step guide labels
    stepCrewTitle: 'Enter Crew',
    stepCrewHint: 'Start of hour: who\'s working?',
    stepProductionTitle: 'Enter Production',
    stepProductionHint: 'End of hour: how much was trimmed?',
    stepCompleteTitle: 'All Done',
    stepCompleteHint: 'This hour is complete',
    stepCelebrateTitle: 'Target Met!',
    stepCelebrateHint: 'Great work this hour!',
    stepMissedTitle: 'Below Target',
    stepMissedHint: 'Add a note explaining why',
    // Shift start labels
    startDay: 'Start Day',
    started: 'Started',
    setStartTime: 'Set Start Time',
    startTimeSet: 'Start time set',
    // Dashboard card labels
    hourlyEntry: 'Hourly Entry',
    barcodePrinter: 'Barcode Printer',
    bagTimer: 'Bag Timer',
    strain: 'Strain',
    selectStrain: 'Select strain...',
    print5kg: '5kg',
    print10lbTops: '10lb Tops',
    print10lbSmalls: '10lb Smalls',
    bagsToday: 'Bags Today',
    status: 'Status',
    onTrack: 'On Track',
    behind: 'Behind',
    onBreak: 'On Break',
    waiting: 'Waiting',
  },
  es: {
    title: 'Entrada por Hora',
    floorManager: 'Gerente de Piso',
    today: 'Hoy',
    target: 'Meta',
    hoursLogged: 'hrs registradas',
    crew: 'Equipo',
    production: 'Producción',
    line1: 'Linea 1',
    line2: 'Linea 2',
    buckers: 'Buckers',
    trimmers: 'Podadores',
    tzero: 'T-Zero',
    qcperson: 'QC',
    cultivar: 'Cultivar',
    tops: 'Tops (lbs)',
    smalls: 'Smalls (lbs)',
    qcNotes: 'Notas QC',
    saved: 'Guardado',
    prev: 'Ant',
    next: 'Sig',
    saveFailed: 'Error al guardar',
    tapToRetry: 'Toca para reintentar',
    saving: 'Guardando',
    // Step guide labels
    stepCrewTitle: 'Ingresar Equipo',
    stepCrewHint: 'Inicio de hora: quién trabaja?',
    stepProductionTitle: 'Ingresar Producción',
    stepProductionHint: 'Fin de hora: cuánto se podó?',
    stepCompleteTitle: 'Completado',
    stepCompleteHint: 'Esta hora está completa',
    stepCelebrateTitle: '¡Meta Cumplida!',
    stepCelebrateHint: '¡Buen trabajo esta hora!',
    stepMissedTitle: 'Bajo la Meta',
    stepMissedHint: 'Agrega una nota explicando por qué',
    // Shift start labels
    startDay: 'Iniciar Día',
    started: 'Iniciado',
    setStartTime: 'Establecer Hora de Inicio',
    startTimeSet: 'Hora de inicio establecida',
    // Dashboard card labels
    hourlyEntry: 'Entrada por Hora',
    barcodePrinter: 'Impresora de Códigos',
    bagTimer: 'Temporizador',
    strain: 'Cepa',
    selectStrain: 'Seleccionar cepa...',
    print5kg: '5kg',
    print10lbTops: '10lb Tops',
    print10lbSmalls: '10lb Smalls',
    bagsToday: 'Bolsas Hoy',
    status: 'Estado',
    onTrack: 'A Tiempo',
    behind: 'Atrasado',
    onBreak: 'En Descanso',
    waiting: 'Esperando',
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
let originalCrewData = null; // Track original crew for modification detection
let pendingSaveData = null; // Track failed save for retry
let isSaving = false; // Prevent concurrent saves
let shiftStartTime = null; // Shared shift start time (syncs with scoreboard)

// Crew fields to track for modifications
const CREW_FIELDS = ['buckers1', 'trimmers1', 'tzero1', 'qcperson', 'cultivar1', 'buckers2', 'trimmers2', 'tzero2', 'cultivar2'];

// Field order for Enter key navigation (Line 1 → QC → Line 1 production → Line 2 if expanded)
const FIELD_ORDER = [
  'buckers1', 'trimmers1', 'tzero1',  // Line 1 crew
  'qcperson',                          // QC
  'cultivar1',                         // Line 1 cultivar
  'tops1', 'smalls1',                  // Line 1 production
  'buckers2', 'trimmers2', 'tzero2',  // Line 2 crew (if expanded)
  'cultivar2',                         // Line 2 cultivar
  'tops2', 'smalls2',                  // Line 2 production
  'qcNotes',                           // QC notes
];

// Event listener registry for cleanup (prevents memory leaks)
const listenerRegistry = [];

function registerListener(element, event, handler, options) {
  if (!element) return;
  element.addEventListener(event, handler, options);
  listenerRegistry.push({ element, event, handler, options });
}

function cleanupListeners() {
  listenerRegistry.forEach(({ element, event, handler, options }) => {
    element.removeEventListener(event, handler, options);
  });
  listenerRegistry.length = 0;
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  cleanupListeners();
  if (saveTimeout) clearTimeout(saveTimeout);
});

// ===================
// SHIFT START (shared with scoreboard)
// ===================

// Slot start times in minutes from midnight
const SLOT_START_MINUTES = {
  '7:00 AM – 8:00 AM': 7 * 60,
  '8:00 AM – 9:00 AM': 8 * 60,
  '9:00 AM – 10:00 AM': 9 * 60,
  '10:00 AM – 11:00 AM': 10 * 60,
  '11:00 AM – 12:00 PM': 11 * 60,
  '12:30 PM – 1:00 PM': 12 * 60 + 30,
  '1:00 PM – 2:00 PM': 13 * 60,
  '2:00 PM – 3:00 PM': 14 * 60,
  '3:00 PM – 4:00 PM': 15 * 60,
  '4:00 PM – 4:30 PM': 16 * 60,
};

/**
 * Load shift start from localStorage and sync with API
 * Uses same keys as scoreboard for cross-page sync
 */
async function loadShiftStart() {
  const today = new Date().toDateString();
  const savedDate = localStorage.getItem('shiftStartDate');

  // Reset if different day
  if (savedDate !== today) {
    localStorage.removeItem('manualShiftStart');
    localStorage.removeItem('shiftStartLocked');
    localStorage.setItem('shiftStartDate', today);
    shiftStartTime = null;
  } else {
    // Load from localStorage first for instant UI
    const savedStart = localStorage.getItem('manualShiftStart');
    if (savedStart) {
      shiftStartTime = new Date(savedStart);
    }
  }

  // Sync with API (may have been set from scoreboard)
  try {
    const response = await fetch(`${API_URL}?action=getShiftStart`);
    const result = await response.json();
    const data = result.data || result;

    if (data.success && data.shiftAdjustment) {
      const apiStartTime = new Date(data.shiftAdjustment.manualStartTime);

      // Check if API time is for today
      if (apiStartTime.toDateString() === today) {
        // Use API time (more authoritative, may be from scoreboard)
        shiftStartTime = apiStartTime;
        localStorage.setItem('manualShiftStart', apiStartTime.toISOString());
      }
    }
  } catch (error) {
    console.error('Failed to load shift start from API:', error);
  }

  updateShiftStartUI();
}

/**
 * Set shift start time and sync to API
 * @param {Date|null} time - Start time (null = use current time)
 */
async function setShiftStart(time = null) {
  const startTime = time || new Date();

  // Save locally first for instant feedback
  shiftStartTime = startTime;
  localStorage.setItem('manualShiftStart', startTime.toISOString());
  localStorage.setItem('shiftStartDate', new Date().toDateString());

  updateShiftStartUI();
  renderTimeline();

  // Sync to API (so scoreboard sees it)
  try {
    const response = await fetch(`${API_URL}?action=setShiftStart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        time: time ? startTime.toISOString() : null, // null = server time
      }),
    });

    const result = await response.json();
    const data = result.data || result;

    if (data.success && data.shiftAdjustment) {
      // Update with server-confirmed time
      const serverTime = new Date(data.shiftAdjustment.manualStartTime);
      shiftStartTime = serverTime;
      localStorage.setItem('manualShiftStart', serverTime.toISOString());
      updateShiftStartUI();
    }
  } catch (error) {
    console.error('Failed to save shift start to API:', error);
  }
}

/**
 * Update the shift start UI elements
 */
function updateShiftStartUI() {
  const startBtn = document.getElementById('start-day-btn');
  const startBadge = document.getElementById('start-time-badge');
  const startTimeDisplay = document.getElementById('start-time-display');

  if (shiftStartTime) {
    // Show badge with time
    if (startBtn) startBtn.style.display = 'none';
    if (startBadge) startBadge.style.display = 'flex';

    if (startTimeDisplay) {
      let hours = shiftStartTime.getHours();
      const minutes = String(shiftStartTime.getMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12 || 12;
      startTimeDisplay.textContent = `${hours}:${minutes} ${ampm}`;
    }
  } else {
    // Show start button
    if (startBtn) startBtn.style.display = 'flex';
    if (startBadge) startBadge.style.display = 'none';
  }
}

/**
 * Check if a time slot should be visible based on shift start
 * @param {string} slot - Time slot string
 * @returns {boolean} - True if slot should be shown
 */
function isSlotVisible(slot) {
  if (!shiftStartTime) return true; // No start time set, show all

  const slotStartMinutes = SLOT_START_MINUTES[slot];
  if (slotStartMinutes === undefined) return true;

  const shiftStartMinutes = shiftStartTime.getHours() * 60 + shiftStartTime.getMinutes();

  // Show slot if it starts at or after shift start
  // We add some tolerance - if shift starts within 15 min of slot start, show the slot
  return slotStartMinutes >= shiftStartMinutes - 15;
}

// DOM Elements
const timelineView = document.getElementById('timeline-view');
const editorView = document.getElementById('editor-view');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  initializeUI();
  await loadShiftStart();  // Load shared shift start (syncs with scoreboard)
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

  // Start Day button
  const startDayBtn = document.getElementById('start-day-btn');
  if (startDayBtn) {
    startDayBtn.addEventListener('click', () => setShiftStart());
  }

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

  // Form inputs - auto-save on change and Enter key navigation
  document.querySelectorAll('#editor-view input, #editor-view select, #editor-view textarea').forEach((el) => {
    el.addEventListener('blur', () => scheduleAutoSave());
    el.addEventListener('change', () => scheduleAutoSave());

    // Enter key: save immediately and move to next field
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && el.tagName !== 'TEXTAREA') {
        e.preventDefault();
        handleEnterKey(el.id);
      }
    });
  });

  // Retry button for failed saves
  document.getElementById('retry-save').addEventListener('click', retrySave);

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
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', currentLang === 'es' ? 'Horas del día' : 'Time slots');

  const currentSlot = getCurrentTimeSlot();

  // Filter visible slots based on shift start (for today only)
  const isToday = currentDate === formatDateLocal(new Date());
  const visibleSlots = isToday
    ? TIME_SLOTS.filter(slot => isSlotVisible(slot))
    : TIME_SLOTS;

  visibleSlots.forEach((slot) => {
    const index = TIME_SLOTS.indexOf(slot);
    const data = dayData[slot] || {};
    const totalLbs = (data.tops1 || 0) + (data.tops2 || 0);
    const hasData = totalLbs > 0 || data.trimmers1 > 0;
    const isCurrent = slot === currentSlot;

    const div = document.createElement('div');
    div.className = 'timeline-slot' + (hasData ? ' has-data' : '') + (isCurrent ? ' current' : '');
    div.setAttribute('role', 'listitem');
    div.setAttribute('tabindex', '0');
    div.setAttribute('aria-label', `${slot}, ${hasData
      ? (currentLang === 'es' ? `${totalLbs.toFixed(1)} libras registradas` : `${totalLbs.toFixed(1)} lbs logged`)
      : (currentLang === 'es' ? 'sin datos' : 'no data')}`);

    // Status text for colorblind accessibility
    const statusText = hasData
      ? (currentLang === 'es' ? 'Completo' : 'Done')
      : (currentLang === 'es' ? 'Pendiente' : 'Empty');

    div.innerHTML = `
      <span class="slot-time">${formatSlotShort(slot)}</span>
      <span class="slot-lbs ${hasData ? '' : 'empty'}">${hasData ? totalLbs.toFixed(1) + ' lbs' : '—'}</span>
      <span class="slot-status" aria-hidden="true">${hasData ? '✓' : '○'}</span>
      <span class="slot-status-text visually-hidden">${statusText}</span>
    `;

    // Click handler
    div.addEventListener('click', () => openEditor(index));

    // Keyboard handler
    div.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openEditor(index);
      } else if (e.key === 'ArrowDown' && index < TIME_SLOTS.length - 1) {
        e.preventDefault();
        div.nextElementSibling?.focus();
      } else if (e.key === 'ArrowUp' && index > 0) {
        e.preventDefault();
        div.previousElementSibling?.focus();
      }
    });

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
  document.getElementById('tzero1').value = data.tzero1 ?? 1;  // Default to 1
  document.getElementById('cultivar1').value = data.cultivar1 || '';
  document.getElementById('tops1').value = data.tops1 || 0;
  document.getElementById('smalls1').value = data.smalls1 || 0;

  document.getElementById('buckers2').value = data.buckers2 || 0;
  document.getElementById('trimmers2').value = data.trimmers2 || 0;
  document.getElementById('tzero2').value = data.tzero2 ?? 1;  // Default to 1
  document.getElementById('cultivar2').value = data.cultivar2 || '';
  document.getElementById('tops2').value = data.tops2 || 0;
  document.getElementById('smalls2').value = data.smalls2 || 0;

  document.getElementById('qcperson').value = data.qcperson ?? 1;  // Default to 1
  document.getElementById('qcNotes').value = data.qcNotes || '';

  // Store original crew data for modification tracking
  originalCrewData = {
    buckers1: data.buckers1 || 0,
    trimmers1: data.trimmers1 || 0,
    tzero1: data.tzero1 ?? 1,
    qcperson: data.qcperson ?? 1,
    cultivar1: data.cultivar1 || '',
    buckers2: data.buckers2 || 0,
    trimmers2: data.trimmers2 || 0,
    tzero2: data.tzero2 ?? 1,
    cultivar2: data.cultivar2 || '',
    // Track if production data existed when we loaded
    hadProduction: (data.tops1 || 0) + (data.tops2 || 0) > 0,
  };

  // Reset modified badge
  updateCrewModifiedBadge();

  // Auto-expand Line 2 if it has data
  const line2Section = document.getElementById('line2-section');
  const hasLine2Data = data.trimmers2 > 0 || data.tops2 > 0;
  line2Section.classList.toggle('expanded', hasLine2Data);

  // Update step guide to show current state
  updateStepGuide();
}

function getCurrentCrewData() {
  return {
    buckers1: parseInt(document.getElementById('buckers1').value, 10) || 0,
    trimmers1: parseInt(document.getElementById('trimmers1').value, 10) || 0,
    tzero1: parseInt(document.getElementById('tzero1').value, 10) || 0,
    qcperson: parseInt(document.getElementById('qcperson').value, 10) || 0,
    cultivar1: document.getElementById('cultivar1').value,
    buckers2: parseInt(document.getElementById('buckers2').value, 10) || 0,
    trimmers2: parseInt(document.getElementById('trimmers2').value, 10) || 0,
    tzero2: parseInt(document.getElementById('tzero2').value, 10) || 0,
    cultivar2: document.getElementById('cultivar2').value,
  };
}

function isCrewModified() {
  if (!originalCrewData) return false;

  const current = getCurrentCrewData();

  for (const field of CREW_FIELDS) {
    if (current[field] !== originalCrewData[field]) {
      return true;
    }
  }
  return false;
}

function getCrewChanges() {
  if (!originalCrewData) return [];

  const current = getCurrentCrewData();
  const changes = [];

  const fieldLabels = {
    buckers1: 'Buckers L1',
    trimmers1: 'Trimmers L1',
    tzero1: 'T-Zero L1',
    qcperson: 'QC',
    cultivar1: 'Cultivar L1',
    buckers2: 'Buckers L2',
    trimmers2: 'Trimmers L2',
    tzero2: 'T-Zero L2',
    cultivar2: 'Cultivar L2',
  };

  for (const field of CREW_FIELDS) {
    if (current[field] !== originalCrewData[field]) {
      changes.push(`${fieldLabels[field]}: ${originalCrewData[field]} → ${current[field]}`);
    }
  }

  return changes;
}

function updateCrewModifiedBadge() {
  const badge = document.getElementById('crew-modified-badge');
  if (badge) {
    const modified = isCrewModified();
    badge.style.display = modified ? 'inline-block' : 'none';
  }
}

function updateStepGuide() {
  const stepGuide = document.getElementById('step-guide');
  const stepIcon = document.getElementById('step-icon');
  const stepTitle = document.getElementById('step-title');
  const stepHint = document.getElementById('step-hint');
  const crewSection = document.querySelector('.crew-section');
  const productionSection = document.querySelector('.production-section');
  const qcNotesSection = document.querySelector('.editor-section:has(#qcNotes)');
  const qcNotesField = document.getElementById('qcNotes');

  if (!stepGuide) return;

  // Check current state
  const trimmers1 = parseInt(document.getElementById('trimmers1').value, 10) || 0;
  const trimmers2 = parseInt(document.getElementById('trimmers2').value, 10) || 0;
  const totalTrimmers = trimmers1 + trimmers2;
  const hasCrew = totalTrimmers > 0;

  const tops1 = parseFloat(document.getElementById('tops1').value) || 0;
  const tops2 = parseFloat(document.getElementById('tops2').value) || 0;
  const totalTops = tops1 + tops2;  // Only tops count toward target (smalls are byproduct)
  const hasProduction = totalTops > 0;

  // Calculate hourly target
  const slot = TIME_SLOTS[currentSlotIndex];
  const multiplier = getSlotMultiplier(slot);
  const hourlyTarget = totalTrimmers * targetRate * multiplier;
  const metTarget = totalTops >= hourlyTarget;

  // Check if reason provided for missed target
  const qcNotes = qcNotesField?.value?.trim() || '';
  const hasReason = qcNotes.length > 0;

  // Reset classes
  stepGuide.classList.remove('step-production', 'step-complete', 'step-celebrate', 'step-missed');
  crewSection?.classList.remove('needs-attention', 'completed');
  productionSection?.classList.remove('needs-attention', 'completed');
  qcNotesSection?.classList.remove('needs-attention', 'completed');

  const labels = LABELS[currentLang];

  if (!hasCrew) {
    // Step 1: Enter Crew
    stepIcon.textContent = '1';
    stepTitle.textContent = labels.stepCrewTitle;
    stepHint.textContent = labels.stepCrewHint;
    crewSection?.classList.add('needs-attention');
  } else if (!hasProduction) {
    // Step 2: Enter Production
    stepGuide.classList.add('step-production');
    stepIcon.textContent = '2';
    stepTitle.textContent = labels.stepProductionTitle;
    stepHint.textContent = labels.stepProductionHint;
    crewSection?.classList.add('completed');
    productionSection?.classList.add('needs-attention');
  } else if (metTarget) {
    // Target met - celebrate!
    stepGuide.classList.add('step-celebrate');
    stepIcon.textContent = '🎉';
    stepTitle.textContent = labels.stepCelebrateTitle;
    stepHint.textContent = `${totalTops.toFixed(1)} / ${hourlyTarget.toFixed(1)} lbs`;
    crewSection?.classList.add('completed');
    productionSection?.classList.add('completed');
  } else if (!hasReason) {
    // Target missed, need reason
    stepGuide.classList.add('step-missed');
    stepIcon.textContent = '!';
    stepTitle.textContent = labels.stepMissedTitle;
    stepHint.textContent = `${totalTops.toFixed(1)} / ${hourlyTarget.toFixed(1)} lbs — ${labels.stepMissedHint}`;
    crewSection?.classList.add('completed');
    productionSection?.classList.add('completed');
    qcNotesSection?.classList.add('needs-attention');
  } else {
    // Target missed but reason provided
    stepGuide.classList.add('step-complete');
    stepIcon.textContent = '✓';
    stepTitle.textContent = labels.stepCompleteTitle;
    stepHint.textContent = `${totalTops.toFixed(1)} / ${hourlyTarget.toFixed(1)} lbs`;
    crewSection?.classList.add('completed');
    productionSection?.classList.add('completed');
    qcNotesSection?.classList.add('completed');
  }
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
    qcperson: parseInt(document.getElementById('qcperson').value, 10) || 0,
    qcNotes: document.getElementById('qcNotes').value,
  };
}

function scheduleAutoSave() {
  if (saveTimeout) clearTimeout(saveTimeout);

  // Update UI state immediately
  updateCrewModifiedBadge();
  updateStepGuide();

  saveTimeout = setTimeout(() => saveEntry(), 1000);
}

function handleEnterKey(currentFieldId) {
  // Save immediately (cancel pending auto-save and save now)
  if (saveTimeout) clearTimeout(saveTimeout);
  saveEntry();

  // Find current position in field order
  const currentIndex = FIELD_ORDER.indexOf(currentFieldId);
  if (currentIndex === -1) return;

  // Check if Line 2 is expanded
  const line2Expanded = document.getElementById('line2-section')?.classList.contains('expanded');

  // Find next field
  for (let i = currentIndex + 1; i < FIELD_ORDER.length; i++) {
    const nextFieldId = FIELD_ORDER[i];

    // Skip Line 2 fields if not expanded
    if (!line2Expanded && ['buckers2', 'trimmers2', 'tzero2', 'cultivar2', 'tops2', 'smalls2'].includes(nextFieldId)) {
      continue;
    }

    const nextField = document.getElementById(nextFieldId);
    if (nextField) {
      nextField.focus();
      // Select all text for number inputs for easy overwriting
      if (nextField.type === 'number' || nextField.type === 'text') {
        nextField.select();
      }
      return;
    }
  }

  // If we're at the last field, move to next time slot
  if (currentSlotIndex < TIME_SLOTS.length - 1) {
    openEditor(currentSlotIndex + 1);
    // Focus first field in new slot
    setTimeout(() => {
      const firstField = document.getElementById('buckers1');
      if (firstField) {
        firstField.focus();
        firstField.select();
      }
    }, 100);
  }
}

async function saveEntry(retryData = null) {
  if (currentSlotIndex < 0 && !retryData) return;
  if (isSaving) return;

  isSaving = true;
  const data = retryData || collectFormData();

  // Check if crew was modified and production already existed
  const crewModified = !retryData && isCrewModified();
  const hadProduction = originalCrewData?.hadProduction || false;

  // If crew changed mid-hour (after production was entered), record it
  if (crewModified && hadProduction) {
    const changes = getCrewChanges();
    if (changes.length > 0) {
      const timestamp = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const changeNote = `[Crew change ${timestamp}: ${changes.join(', ')}]`;

      // Append to QC Notes if not already recorded
      if (!data.qcNotes.includes(changeNote)) {
        data.qcNotes = data.qcNotes
          ? `${data.qcNotes}\n${changeNote}`
          : changeNote;
        document.getElementById('qcNotes').value = data.qcNotes;
      }
    }
  }

  // Show saving state
  showSaveIndicator('saving');

  try {
    const response = await fetch(`${API_URL}?action=addProduction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message || 'Save failed');
    }

    // Update local data
    const slot = data.timeSlot;
    dayData[slot] = data;
    pendingSaveData = null; // Clear any pending retry

    // Update original crew data after successful save (so subsequent changes are tracked from new baseline)
    if (crewModified) {
      originalCrewData = {
        ...getCurrentCrewData(),
        hadProduction: (data.tops1 || 0) + (data.tops2 || 0) > 0,
      };
      updateCrewModifiedBadge();
    }

    // Show success indicator
    showSaveIndicator('success');
    setTimeout(() => hideSaveIndicator(), 2000);

    // Update summaries
    updateEditorSummary();
  } catch (error) {
    console.error('Save error:', error);
    pendingSaveData = data; // Store for retry
    showSaveIndicator('error');
  } finally {
    isSaving = false;
  }
}

function showSaveIndicator(state) {
  const indicator = document.getElementById('save-indicator');
  indicator.classList.remove('success', 'error', 'saving');
  indicator.classList.add('visible', state);
}

function hideSaveIndicator() {
  const indicator = document.getElementById('save-indicator');
  indicator.classList.remove('visible', 'success', 'error', 'saving');
}

function retrySave() {
  if (pendingSaveData) {
    saveEntry(pendingSaveData);
  }
}

async function loadDayData(date) {
  showLoading(true);

  try {
    const response = await fetch(`${API_URL}?action=getProduction&date=${date}`);
    const result = await response.json();
    const data = result.data || result;

    dayData = {};

    // Handle D1 format: production array
    if (data.production && Array.isArray(data.production)) {
      data.production.forEach((row) => {
        dayData[row.timeSlot] = row;
      });
    }
    // Handle Sheets format: slots object
    else if (data.slots && typeof data.slots === 'object') {
      dayData = data.slots;
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
  // Base multiplier: half-hour slots get 0.5, full hours get 1.0
  let baseMultiplier = 1;
  if (slot === '4:00 PM – 4:30 PM' || slot === '12:30 PM – 1:00 PM') {
    baseMultiplier = 0.5;
  }

  // Adjust for shift start time (only affects today)
  const isToday = currentDate === formatDateLocal(new Date());
  if (!isToday || !shiftStartTime) {
    return baseMultiplier;
  }

  const slotStartMinutes = SLOT_START_MINUTES[slot];
  if (slotStartMinutes === undefined) return baseMultiplier;

  // Calculate slot end time (in minutes)
  const slotDuration = baseMultiplier === 0.5 ? 30 : 60;
  const slotEndMinutes = slotStartMinutes + slotDuration;

  const shiftStartMinutes = shiftStartTime.getHours() * 60 + shiftStartTime.getMinutes();

  // If shift starts after slot ends, multiplier is 0 (slot hidden anyway)
  if (shiftStartMinutes >= slotEndMinutes) {
    return 0;
  }

  // If shift starts before slot begins, use full multiplier
  if (shiftStartMinutes <= slotStartMinutes) {
    return baseMultiplier;
  }

  // Partial slot: calculate fraction of slot that's worked
  const minutesWorked = slotEndMinutes - shiftStartMinutes;
  const fractionWorked = minutesWorked / slotDuration;

  return baseMultiplier * fractionWorked;
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

// ===================
// TUTORIAL SYSTEM
// ===================

const TUTORIAL_STEPS = [
  {
    id: 'welcome',
    target: null, // No spotlight, centered modal
    title: { en: 'Welcome to Hourly Entry! 👋', es: '¡Bienvenido a Entrada por Hora! 👋' },
    text: {
      en: 'This app helps you track production data hour by hour. Let\'s walk through how it works.',
      es: 'Esta app te ayuda a registrar datos de producción hora por hora. Veamos cómo funciona.',
    },
    showLanguageChoice: true, // Show EN/ES buttons on this step
  },
  {
    id: 'timeline',
    target: 'timeline-list',
    title: { en: 'Timeline View', es: 'Vista de Línea de Tiempo' },
    text: {
      en: 'Each row is one hour of the workday. Tap any hour to enter or edit data. Hours with data show a ✓ checkmark.',
      es: 'Cada fila es una hora del día. Toca cualquier hora para ingresar o editar datos. Las horas con datos muestran ✓.',
    },
  },
  {
    id: 'progress',
    target: 'progress-summary',
    title: { en: 'Daily Progress', es: 'Progreso Diario' },
    text: {
      en: 'Track your total production against the daily target. The progress bar fills as you enter data.',
      es: 'Sigue tu producción total contra la meta diaria. La barra de progreso se llena al ingresar datos.',
    },
  },
  {
    id: 'datepicker',
    target: 'date-picker',
    title: { en: 'Date Selection', es: 'Selección de Fecha' },
    text: {
      en: 'Use the date picker to view or edit past days. The "Today" button returns you to the current day.',
      es: 'Usa el selector de fecha para ver o editar días pasados. El botón "Hoy" te regresa al día actual.',
    },
  },
  {
    id: 'start-day',
    target: 'start-day-btn',
    title: { en: 'Start Day Button', es: 'Botón Iniciar Día' },
    text: {
      en: 'Tap "Start Day" when work begins. If you start late (meetings, etc.), early hours will be hidden and targets adjust automatically.\n\nExample: Start at 8:30 AM → the 7-8 AM slot is hidden, and 8-9 AM gets a reduced target.',
      es: 'Toca "Iniciar Día" cuando comience el trabajo. Si empiezas tarde (juntas, etc.), las horas tempranas se ocultan y las metas se ajustan.\n\nEjemplo: Empezar a las 8:30 AM → la hora 7-8 se oculta, y 8-9 AM tiene meta reducida.',
    },
  },
  {
    id: 'editor-intro',
    target: null,
    title: { en: 'Entering Data', es: 'Ingresando Datos' },
    text: {
      en: 'Tap any hour in the timeline to open it. There are TWO things to enter each hour:\n\n1️⃣ CREW — at the START of the hour\n2️⃣ PRODUCTION — at the END of the hour\n\nLet\'s go to the first empty hour now!',
      es: 'Toca cualquier hora en la línea de tiempo para abrirla. Hay DOS cosas que ingresar cada hora:\n\n1️⃣ EQUIPO — al INICIO de la hora\n2️⃣ PRODUCCIÓN — al FINAL de la hora\n\n¡Vamos a la primera hora vacía!',
    },
    action: 'openFirstEmpty',
  },
  {
    id: 'crew-section',
    target: 'crew-section',
    title: { en: '1️⃣ Crew Entry', es: '1️⃣ Entrada de Equipo' },
    text: {
      en: 'At the START of each hour, enter how many people are working:\n• Buckers — removing buds from stems\n• Trimmers — trimming the buds\n• T-Zero — operating the machine\n• QC — quality control person',
      es: 'Al INICIO de cada hora, ingresa cuántas personas trabajan:\n• Buckers — quitando cogollos de tallos\n• Podadores — podando los cogollos\n• T-Zero — operando la máquina\n• QC — persona de control de calidad',
    },
  },
  {
    id: 'production-section',
    target: 'production-section',
    title: { en: '2️⃣ Production Entry', es: '2️⃣ Entrada de Producción' },
    text: {
      en: 'At the END of each hour, weigh and enter production:\n• Tops — premium flower (counts toward target)\n• Smalls — smaller buds (byproduct, doesn\'t count toward target)',
      es: 'Al FINAL de cada hora, pesa e ingresa producción:\n• Tops — flor premium (cuenta para la meta)\n• Smalls — cogollos pequeños (subproducto, no cuenta)',
    },
  },
  {
    id: 'step-guide',
    target: 'step-guide',
    title: { en: 'The Step Guide', es: 'La Guía de Pasos' },
    text: {
      en: 'This banner tells you what to do next:\n🟢 Green — Enter crew (start of hour)\n🟡 Gold — Enter production (end of hour)\n🎉 Celebration — Target met!\n🔴 Red — Target missed, add a note why',
      es: 'Este banner te dice qué hacer:\n🟢 Verde — Ingresar equipo (inicio de hora)\n🟡 Dorado — Ingresar producción (fin de hora)\n🎉 Celebración — ¡Meta cumplida!\n🔴 Rojo — Meta no alcanzada, agrega nota',
    },
  },
  {
    id: 'done',
    target: null,
    title: { en: 'You\'re Ready! ✨', es: '¡Estás Listo! ✨' },
    text: {
      en: 'Data saves automatically as you type. Use Prev/Next buttons to move between hours.\n\nTap "Got It" to start entering data!',
      es: 'Los datos se guardan automáticamente. Usa los botones Ant/Sig para moverte entre horas.\n\n¡Toca "Entendido" para comenzar!',
    },
    nextLabel: { en: 'Got It!', es: '¡Entendido!' },
  },
];

const TUTORIAL_LABELS = {
  en: { skip: 'Skip', back: 'Back', next: 'Next' },
  es: { skip: 'Saltar', back: 'Atrás', next: 'Siguiente' },
};

let tutorialStep = 0;

function initTutorial() {
  // Check if tutorial already completed
  if (localStorage.getItem('hourlyEntry_tutorialComplete') === 'true') {
    showInlineTooltips();
    return;
  }

  // Start tutorial
  showTutorial();
}

// Tutorial event handlers (stored for cleanup)
let tutorialHandlers = null;

function showTutorial() {
  const overlay = document.getElementById('tutorial-overlay');
  overlay.classList.add('active');
  tutorialStep = 0;
  renderTutorialStep();

  // Store handlers for cleanup
  tutorialHandlers = {
    skip: closeTutorial,
    prev: prevTutorialStep,
    next: nextTutorialStep,
  };

  // Event listeners (using registry for cleanup)
  registerListener(document.getElementById('tutorial-skip'), 'click', tutorialHandlers.skip);
  registerListener(document.getElementById('tutorial-prev'), 'click', tutorialHandlers.prev);
  registerListener(document.getElementById('tutorial-next'), 'click', tutorialHandlers.next);
}

function renderTutorialStep() {
  const step = TUTORIAL_STEPS[tutorialStep];
  const labels = TUTORIAL_LABELS[currentLang];

  // Update step dots
  const dotsContainer = document.getElementById('tutorial-steps');
  dotsContainer.innerHTML = TUTORIAL_STEPS.map((_, i) => {
    let cls = 'tutorial-step-dot';
    if (i < tutorialStep) cls += ' completed';
    if (i === tutorialStep) cls += ' active';
    return `<div class="${cls}"></div>`;
  }).join('');

  // Update content
  document.getElementById('tutorial-title').textContent = step.title[currentLang];
  document.getElementById('tutorial-text').textContent = step.text[currentLang];

  // Show/hide language choice buttons
  const textEl = document.getElementById('tutorial-text');
  let langChoiceEl = document.getElementById('tutorial-lang-choice');

  if (step.showLanguageChoice) {
    if (!langChoiceEl) {
      // Create language choice buttons
      langChoiceEl = document.createElement('div');
      langChoiceEl.id = 'tutorial-lang-choice';
      langChoiceEl.className = 'tutorial-lang-choice';
      langChoiceEl.innerHTML = `
        <span class="lang-choice-label">Choose language / Elige idioma:</span>
        <div class="lang-choice-buttons">
          <button type="button" class="lang-choice-btn" data-lang="en">English</button>
          <button type="button" class="lang-choice-btn" data-lang="es">Español</button>
        </div>
      `;
      textEl.after(langChoiceEl);

      // Add click handlers
      langChoiceEl.querySelectorAll('.lang-choice-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const newLang = btn.dataset.lang;
          currentLang = newLang;
          localStorage.setItem('lang', newLang);
          document.getElementById('lang-toggle').textContent = newLang === 'en' ? 'ES' : 'EN';
          updateLabels();
          renderTutorialStep(); // Re-render with new language
        });
      });
    }
    // Update active state
    langChoiceEl.querySelectorAll('.lang-choice-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === currentLang);
    });
    langChoiceEl.style.display = 'block';
  } else if (langChoiceEl) {
    langChoiceEl.style.display = 'none';
  }

  // Update buttons
  document.getElementById('tutorial-prev').disabled = tutorialStep === 0;
  document.getElementById('tutorial-prev').textContent = labels.back;
  document.getElementById('tutorial-skip').textContent = labels.skip;

  const nextBtn = document.getElementById('tutorial-next');
  if (step.nextLabel) {
    nextBtn.textContent = step.nextLabel[currentLang];
  } else {
    nextBtn.textContent = labels.next;
  }

  // Position spotlight and card
  positionTutorialElements(step);
}

function positionTutorialElements(step) {
  const spotlight = document.getElementById('tutorial-spotlight');
  const card = document.getElementById('tutorial-card');
  const backdrop = document.querySelector('.tutorial-backdrop');

  if (step.target) {
    // Find target element
    let targetEl;
    if (step.target === 'progress-summary') {
      targetEl = document.querySelector('.progress-summary');
    } else if (step.target === 'date-picker') {
      targetEl = document.getElementById('date-picker');
    } else if (step.target === 'crew-section') {
      targetEl = document.querySelector('.crew-section');
    } else if (step.target === 'production-section') {
      targetEl = document.querySelector('.production-section');
    } else if (step.target === 'step-guide') {
      targetEl = document.getElementById('step-guide');
    } else {
      targetEl = document.getElementById(step.target) || document.querySelector(`.${step.target}`);
    }

    if (targetEl) {
      const rect = targetEl.getBoundingClientRect();
      const padding = 8;

      // Position spotlight
      spotlight.style.display = 'block';
      spotlight.style.top = `${rect.top - padding}px`;
      spotlight.style.left = `${rect.left - padding}px`;
      spotlight.style.width = `${rect.width + padding * 2}px`;
      spotlight.style.height = `${rect.height + padding * 2}px`;
      spotlight.classList.add('active');
      backdrop.style.display = 'none';

      // Position card below or above target
      const cardHeight = 280;
      const spaceBelow = window.innerHeight - rect.bottom;

      if (spaceBelow > cardHeight + 20) {
        card.style.top = `${rect.bottom + 16}px`;
        card.style.bottom = 'auto';
      } else {
        card.style.top = 'auto';
        card.style.bottom = `${window.innerHeight - rect.top + 16}px`;
      }
      card.style.left = '50%';
      card.style.transform = 'translateX(-50%)';
    }
  } else {
    // No target - center everything
    spotlight.style.display = 'none';
    spotlight.classList.remove('active');
    backdrop.style.display = 'block';

    card.style.top = '50%';
    card.style.left = '50%';
    card.style.transform = 'translate(-50%, -50%)';
    card.style.bottom = 'auto';
  }
}

function nextTutorialStep() {
  const currentStep = TUTORIAL_STEPS[tutorialStep];

  // Handle special actions
  if (currentStep.action === 'openFirstEmpty') {
    // Find first empty hour or current hour
    const firstEmptyIndex = findFirstEmptySlot();
    if (firstEmptyIndex >= 0) {
      openEditor(firstEmptyIndex);
    }
  }

  if (tutorialStep < TUTORIAL_STEPS.length - 1) {
    tutorialStep++;
    renderTutorialStep();
  } else {
    closeTutorial();
  }
}

function findFirstEmptySlot() {
  // Find the first slot without production data
  for (let i = 0; i < TIME_SLOTS.length; i++) {
    const slot = TIME_SLOTS[i];
    const data = dayData[slot] || {};
    const hasProduction = (data.tops1 || 0) + (data.tops2 || 0) > 0;
    if (!hasProduction) {
      return i;
    }
  }
  // If all slots have data, return current time slot or first
  const currentSlot = getCurrentTimeSlot();
  const currentIndex = TIME_SLOTS.indexOf(currentSlot);
  return currentIndex >= 0 ? currentIndex : 0;
}

function prevTutorialStep() {
  if (tutorialStep > 0) {
    tutorialStep--;
    renderTutorialStep();
  }
}

function closeTutorial() {
  const overlay = document.getElementById('tutorial-overlay');
  overlay.classList.remove('active');

  // Mark as complete
  localStorage.setItem('hourlyEntry_tutorialComplete', 'true');

  // Show inline tooltips
  showInlineTooltips();
}

// Track if tooltip listener is already added
let tooltipListenerAdded = false;

function showInlineTooltips() {
  // Check if tooltips already dismissed
  if (localStorage.getItem('hourlyEntry_tooltipsDismissed') === 'true') {
    return;
  }

  // Show timeline tooltip after a delay
  setTimeout(() => {
    const timelineTooltip = document.getElementById('tooltip-timeline');
    const timelineList = document.getElementById('timeline-list');

    if (timelineTooltip && timelineList) {
      const rect = timelineList.getBoundingClientRect();
      timelineTooltip.style.top = `${rect.top + 10}px`;
      timelineTooltip.style.left = `${rect.left + 20}px`;
      timelineTooltip.classList.add('visible');

      // Close button (only add listener once)
      if (!tooltipListenerAdded) {
        const closeBtn = timelineTooltip.querySelector('.tooltip-close');
        const closeHandler = () => {
          timelineTooltip.classList.remove('visible');
          localStorage.setItem('hourlyEntry_tooltipsDismissed', 'true');
        };
        registerListener(closeBtn, 'click', closeHandler);
        tooltipListenerAdded = true;
      }

      // Auto-hide after 8 seconds
      setTimeout(() => timelineTooltip.classList.remove('visible'), 8000);
    }
  }, 1000);
}

// Add tooltip labels to LABELS
LABELS.en.tipTimeline = 'Tap any hour to edit';
LABELS.en.tipCrew = 'Enter at START of hour';
LABELS.en.tipProduction = 'Enter at END of hour';
LABELS.en.skip = 'Skip';
LABELS.en.back = 'Back';

LABELS.es.tipTimeline = 'Toca cualquier hora para editar';
LABELS.es.tipCrew = 'Ingresar al INICIO de la hora';
LABELS.es.tipProduction = 'Ingresar al FINAL de la hora';
LABELS.es.skip = 'Saltar';
LABELS.es.back = 'Atrás';

// Initialize tutorial after data loads
setTimeout(() => initTutorial(), 500);

// ===================
// BARCODE PRINTER
// ===================

const BARCODE_API_URL = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/barcode';
let barcodeProducts = []; // Products loaded from barcode API

/**
 * Initialize barcode card functionality
 * Called after cultivars are loaded
 */
async function initBarcodeCard() {
  await loadBarcodeProducts();
  populateBarcodeStrainSelect();
  initBarcodePrintButtons();
}

/**
 * Load products from barcode API
 */
async function loadBarcodeProducts() {
  try {
    const response = await fetch(`${BARCODE_API_URL}?action=products`);
    const result = await response.json();
    const data = result.data || result;
    barcodeProducts = data.products || [];
  } catch (error) {
    console.error('Failed to load barcode products:', error);
    barcodeProducts = [];
  }
}

/**
 * Populate the barcode strain dropdown with cultivars that have products
 */
function populateBarcodeStrainSelect() {
  const select = document.getElementById('barcode-strain');
  if (!select) return;

  // Get unique cultivars from products (extract cultivar name from header)
  const cultivarsWithProducts = new Set();
  barcodeProducts.forEach((p) => {
    // Header format: "Cultivar Name - Tops 5KG" or similar
    const match = p.header.match(/^(.+?)\s*-\s*(Tops|Smalls)/i);
    if (match) {
      cultivarsWithProducts.add(match[1].trim());
    }
  });

  const currentValue = select.value;
  select.innerHTML = `<option value="">${LABELS[currentLang].selectStrain}</option>`;

  // Sort cultivars alphabetically
  const sortedCultivars = Array.from(cultivarsWithProducts).sort();
  sortedCultivars.forEach((cultivar) => {
    const option = document.createElement('option');
    option.value = cultivar;
    option.textContent = cultivar;
    select.appendChild(option);
  });

  select.value = currentValue;
}

/**
 * Initialize barcode print button click handlers
 */
function initBarcodePrintButtons() {
  const buttons = document.querySelectorAll('.barcode-btn');
  buttons.forEach((btn) => {
    registerListener(btn, 'click', () => {
      const strainSelect = document.getElementById('barcode-strain');
      const strain = strainSelect?.value;

      if (!strain) {
        strainSelect?.focus();
        return;
      }

      const bagType = btn.dataset.type;
      printBarcodeLabel(strain, bagType);
    });
  });
}

/**
 * Find product matching strain and bag type
 * @param {string} strain - Cultivar name
 * @param {string} bagType - '5kg', '10lb-tops', or '10lb-smalls'
 * @returns {Object|null} - Product object or null if not found
 */
function findBarcodeProduct(strain, bagType) {
  // Map bag type to size and type
  let targetSize, targetType;
  if (bagType === '5kg') {
    targetSize = '5KG';
    targetType = 'Tops'; // 5kg bags are typically tops
  } else if (bagType === '10lb-tops') {
    targetSize = '10 LB';
    targetType = 'Tops';
  } else {
    targetSize = '10 LB';
    targetType = 'Smalls';
  }

  // Find matching product
  return barcodeProducts.find((p) => {
    const header = p.header.toUpperCase();
    const strainUpper = strain.toUpperCase();
    return header.includes(strainUpper) &&
           header.includes(targetType.toUpperCase()) &&
           header.includes(targetSize);
  });
}

/**
 * Print a barcode label for the given strain and bag type
 * @param {string} strain - Cultivar name
 * @param {string} bagType - '5kg', '10lb-tops', or '10lb-smalls'
 */
function printBarcodeLabel(strain, bagType) {
  // Find the product in the database
  const product = findBarcodeProduct(strain, bagType);

  if (!product) {
    // Product not found - show alert
    const sizeLabel = bagType === '5kg' ? '5KG' : '10 LB';
    const typeLabel = bagType === '10lb-smalls' ? 'Smalls' : 'Tops';
    alert(`No barcode found for ${strain} - ${typeLabel} ${sizeLabel}.\n\nPlease add this product in the Barcode Manager app.`);
    return;
  }

  // Use the existing barcode from the database
  const barcode = product.barcode;
  const labelText = product.header;

  // Generate barcode URL using TEC-IT
  const barcodeUrl = 'https://barcode.tec-it.com/barcode.ashx?data=' + encodeURIComponent(barcode) +
    '&code=Code128&dpi=203&modulewidth=fit&height=35&hidetext=1';

  // Create or reuse print iframe
  let iframe = document.getElementById('barcode-print-frame');
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = 'barcode-print-frame';
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:none;';
    document.body.appendChild(iframe);
  }

  // Build print document
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write('<!DOCTYPE html><html><head><style>');
  doc.write('@page { size: 1.65in 0.5in; margin: 0 0.15in !important; }');
  doc.write('@media print { html, body { width: 1.35in !important; height: 0.5in !important; margin: 0 !important; padding: 0 !important; overflow: hidden; } }');
  doc.write('body { margin: 0; padding: 0; font-family: Arial; }');
  doc.write('.label { width: 1.35in; height: 0.5in; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1px; }');
  doc.write('.name { font-size: 6pt; font-weight: bold; margin-bottom: 1px; }');
  doc.write('img { max-width: 1.3in; height: 0.25in; }');
  doc.write('.code { font-size: 5pt; margin-top: 1px; }');
  doc.write('</style></head><body>');
  doc.write('<div class="label">');
  doc.write('<div class="name">' + escapeHtml(labelText) + '</div>');
  doc.write('<img src="' + barcodeUrl + '" alt="barcode">');
  doc.write('<div class="code">' + escapeHtml(barcode) + '</div>');
  doc.write('</div></body></html>');
  doc.close();

  // Wait for barcode image to load then print
  const img = doc.querySelector('img');
  img.onload = function () {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
  };

  // Fallback if image already cached
  if (img.complete) {
    setTimeout(function () {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    }, 100);
  }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===================
// BAG TIMER
// ===================

let bagTimerInterval = null;
let lastBagTimestamp = null;
let timerTargetSeconds = 90 * 60; // Default 90 min target

/**
 * Initialize bag timer card
 */
function initBagTimer() {
  loadBagTimerData();
  // Poll every 30 seconds for timer updates
  bagTimerInterval = setInterval(loadBagTimerData, 30000);
  // Update countdown every second
  setInterval(updateBagTimerCountdown, 1000);
}

/**
 * Load bag timer data from scoreboard API
 */
async function loadBagTimerData() {
  try {
    const response = await fetch(`${API_URL}?action=scoreboard`);
    const result = await response.json();
    const data = result.data || result;

    const timer = data.timer || {};

    // Update bags today count
    const bagsToday = document.getElementById('bags-today');
    if (bagsToday) {
      bagsToday.textContent = timer.bagsToday || 0;
    }

    // Store last bag timestamp for countdown
    if (timer.lastBagTime) {
      lastBagTimestamp = new Date(timer.lastBagTime);
    } else {
      lastBagTimestamp = null;
    }

    // Store target seconds
    if (timer.targetSeconds) {
      timerTargetSeconds = timer.targetSeconds;
    }

    // Update status indicator
    updateTimerStatus(timer);

  } catch (error) {
    console.error('Failed to load bag timer data:', error);
  }
}

/**
 * Update the countdown timer display
 */
function updateBagTimerCountdown() {
  const timerValue = document.getElementById('bag-timer-value');
  if (!timerValue) return;

  if (!lastBagTimestamp) {
    timerValue.textContent = '--:--';
    return;
  }

  const now = new Date();
  const elapsedMs = now - lastBagTimestamp;
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;

  // Format as MM:SS or H:MM:SS if over an hour
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    timerValue.textContent = `${hours}:${String(mins).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  } else {
    timerValue.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  // Update color based on target
  const targetMinutes = Math.floor(timerTargetSeconds / 60);
  if (minutes > targetMinutes * 1.2) {
    timerValue.style.color = 'var(--error)';
  } else if (minutes > targetMinutes) {
    timerValue.style.color = 'var(--gold)';
  } else {
    timerValue.style.color = 'var(--text-primary)';
  }
}

/**
 * Update the status indicator based on timer data
 * @param {Object} timer - Timer data from API
 */
function updateTimerStatus(timer) {
  const statusEl = document.getElementById('timer-status');
  if (!statusEl) return;

  // Remove all status classes
  statusEl.classList.remove('on-track', 'behind', 'on-break');

  // Check if on break (scoreboard provides pause state)
  if (timer.isPaused || timer.onBreak) {
    statusEl.textContent = LABELS[currentLang].onBreak;
    statusEl.classList.add('on-break');
    return;
  }

  // No bags yet today
  if (!timer.bagsToday || timer.bagsToday === 0) {
    statusEl.textContent = LABELS[currentLang].waiting;
    return;
  }

  // Check if current cycle is on track
  const avgSeconds = timer.avgSecondsToday || 0;
  const targetSeconds = timer.targetSeconds || timerTargetSeconds;

  if (avgSeconds > 0 && avgSeconds <= targetSeconds) {
    statusEl.textContent = LABELS[currentLang].onTrack;
    statusEl.classList.add('on-track');
  } else if (avgSeconds > targetSeconds) {
    statusEl.textContent = LABELS[currentLang].behind;
    statusEl.classList.add('behind');
  } else {
    statusEl.textContent = '--';
  }
}

// Cleanup bag timer on page unload
window.addEventListener('beforeunload', () => {
  if (bagTimerInterval) clearInterval(bagTimerInterval);
});

// Initialize barcode and timer after cultivars load
const originalLoadCultivars = loadCultivars;
loadCultivars = async function () {
  await originalLoadCultivars();
  initBarcodeCard();
  initBagTimer();
};
