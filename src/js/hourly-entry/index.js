/**
 * Hourly Production Entry App - Timeline View
 * Two-view architecture: Timeline (list) and Editor (full-screen)
 */

const API_URL = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production';

// Default time slots (will be dynamically updated based on shift start)
let TIME_SLOTS = [
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

/**
 * Update TIME_SLOTS dynamically based on shift start time
 * If shift starts before 8:00 AM, first slot becomes "X:XX AM - 8:00 AM"
 */
function updateTimeSlots(shiftStart) {
  // Reset to defaults first
  TIME_SLOTS = [
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

  // Reset SLOT_START_MINUTES to defaults
  SLOT_START_MINUTES = {
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

  if (!shiftStart) return;

  const hours = shiftStart.getHours();
  const minutes = shiftStart.getMinutes();

  // If shift starts before 8:00 AM, replace first slot
  if (hours < 8) {
    const minutesPadded = String(minutes).padStart(2, '0');
    const timeStr = `${hours}:${minutesPadded} AM`;
    const newFirstSlot = `${timeStr} – 8:00 AM`;

    // Remove old first slot from mapping
    delete SLOT_START_MINUTES['7:00 AM – 8:00 AM'];

    // Update TIME_SLOTS and add new mapping
    TIME_SLOTS[0] = newFirstSlot;
    SLOT_START_MINUTES[newFirstSlot] = hours * 60 + minutes;
  }
}

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
    hourlyTarget: 'Hourly Target',
    dayView: 'Day',
    copyPrev: 'Copy Prev',
    copied: 'Copied!',
    noPrevData: 'No previous data',
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
    printer: 'Printer',
    scanner: 'Scanner',
    inventory: 'Inventory',
    poolSmalls: 'Pool (Smalls)',
    addToPool: '+ Add to Pool',
    scanToInventory: 'Scan to Inventory',
    lastScanned: 'Last scanned:',
    currentPool: 'Current Pool',
    updatePool: 'Update Pool',
    add: 'Add',
    subtract: 'Subtract',
    set: 'Set',
    optionalNote: 'Optional note...',
    previous: 'Previous',
    current: 'Current',
    newValue: 'New',
    preview: 'Preview',
    adding: 'Adding',
    subtracting: 'Subtracting',
    setting: 'Setting to',
    recentChanges: 'Recent Changes',
    noChangesYet: 'No changes yet',
    updating: 'Updating...',
    added: 'Added:',
    subtracted: 'Subtracted:',
    changed: 'Changed:',
    bagsToday: 'Bags Today',
    avgToday: 'Avg Today',
    vsTarget: 'vs Target',
    remaining: 'remaining',
    elapsed: 'elapsed',
    status: 'Status',
    onTrack: 'On Track',
    behind: 'Behind',
    onBreak: 'On Break',
    waiting: 'Waiting',
    liveScale: 'Live Scale',
    scaleOf: 'of',
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
    hourlyTarget: 'Meta por Hora',
    dayView: 'Día',
    copyPrev: 'Copiar Ant',
    copied: '¡Copiado!',
    noPrevData: 'Sin datos previos',
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
    printer: 'Impresora',
    scanner: 'Escáner',
    inventory: 'Inventario',
    poolSmalls: 'Pool (Smalls)',
    addToPool: '+ Agregar al Pool',
    scanToInventory: 'Escanear a Inventario',
    lastScanned: 'Último escaneado:',
    currentPool: 'Pool Actual',
    updatePool: 'Actualizar Pool',
    add: 'Agregar',
    subtract: 'Restar',
    set: 'Establecer',
    optionalNote: 'Nota opcional...',
    previous: 'Anterior',
    current: 'Actual',
    newValue: 'Nuevo',
    preview: 'Vista Previa',
    adding: 'Agregando',
    subtracting: 'Restando',
    setting: 'Estableciendo a',
    recentChanges: 'Cambios Recientes',
    noChangesYet: 'Sin cambios aún',
    updating: 'Actualizando...',
    added: 'Agregado:',
    subtracted: 'Restado:',
    changed: 'Cambiado:',
    bagsToday: 'Bolsas Hoy',
    avgToday: 'Prom Hoy',
    vsTarget: 'vs Meta',
    remaining: 'restante',
    elapsed: 'transcurrido',
    status: 'Estado',
    onTrack: 'A Tiempo',
    behind: 'Atrasado',
    onBreak: 'En Descanso',
    waiting: 'Esperando',
    liveScale: 'Báscula en Vivo',
    scaleOf: 'de',
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
let isOpeningTimePicker = false; // Track when we're programmatically opening the picker
let lastTimePickerValue = null; // Track last value to detect real changes
let crewChangeLog = []; // Track crew changes within current hour: [{minutesMark, trimmers1, trimmers2}]

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
  // Clear bag timer and scale intervals to prevent memory leaks
  if (bagTimerInterval) clearInterval(bagTimerInterval);
  if (bagTimerTickInterval) clearInterval(bagTimerTickInterval);
  if (scaleInterval) clearInterval(scaleInterval);
});

// ===================
// DATE FORMATTING
// ===================

function getDaySuffix(day) {
  if (day >= 11 && day <= 13) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

function formatDateDisplay(dateStr) {
  const date = new Date(dateStr + 'T12:00:00'); // Avoid timezone issues
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  const day = date.getDate();
  const suffix = getDaySuffix(day);
  return `${months[date.getMonth()]}, ${day}${suffix}`;
}

function updateDateDisplay(dateStr) {
  const display = document.getElementById('date-display');
  if (display) {
    display.textContent = formatDateDisplay(dateStr);
  }
}

// ===================
// SHIFT START (shared with scoreboard)
// ===================

// Slot start times in minutes from midnight (will be dynamically updated)
let SLOT_START_MINUTES = {
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

  updateTimeSlots(shiftStartTime);
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

  // Ensure we're viewing today and refresh data
  const today = formatDateLocal(new Date());
  if (currentDate !== today) {
    currentDate = today;
    const datePicker = document.getElementById('date-picker');
    if (datePicker) datePicker.value = today;
    updateDateDisplay(today);
  }

  // Refresh data from API to get fresh entries
  await loadDayData(currentDate);

  updateTimeSlots(shiftStartTime);
  updateShiftStartUI();
  renderTimeline();
  highlightCurrentTimeSlot();

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
      updateTimeSlots(shiftStartTime);
      updateShiftStartUI();
      renderTimeline();
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

// DOM Elements (in-card views)
const timelineContent = document.getElementById('timeline-content');
const editorContent = document.getElementById('editor-content');
const editorHeaderInline = document.getElementById('editor-header-inline');
const cardTitle = document.querySelector('.card-hourly .card-title');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  initializeUI();
  await loadShiftStart();  // Load shared shift start (syncs with scoreboard)
  await loadCultivars();
  await loadDayData(currentDate);
  highlightCurrentTimeSlot();
});

function initializeUI() {
  // Date picker with formatted display
  const datePicker = document.getElementById('date-picker');
  const dateDisplay = document.getElementById('date-display');
  datePicker.value = currentDate;
  updateDateDisplay(currentDate);

  // Click on display opens the date picker
  if (dateDisplay) {
    dateDisplay.addEventListener('click', () => datePicker.showPicker());
  }

  datePicker.addEventListener('change', async (e) => {
    currentDate = e.target.value;
    updateDateDisplay(currentDate);
    await loadDayData(currentDate);
    renderTimeline();
  });

  // Today button
  document.getElementById('today-btn').addEventListener('click', async () => {
    currentDate = formatDateLocal(new Date());
    datePicker.value = currentDate;
    updateDateDisplay(currentDate);
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

  // Start time badge (click to edit) - Toggle dropdown
  const startTimeBadge = document.getElementById('start-time-badge');
  const timePickerDropdown = document.getElementById('time-picker-dropdown');

  if (startTimeBadge && timePickerDropdown) {
    const customTimeInput = document.getElementById('custom-time-input');
    const setCustomTimeBtn = document.getElementById('set-custom-time');

    // Toggle dropdown on click
    startTimeBadge.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = timePickerDropdown.style.display === 'block';

      if (!isVisible) {
        // Pre-populate with current start time when opening
        if (shiftStartTime && customTimeInput) {
          const hours = String(shiftStartTime.getHours()).padStart(2, '0');
          const minutes = String(shiftStartTime.getMinutes()).padStart(2, '0');
          customTimeInput.value = `${hours}:${minutes}`;
        }
        timePickerDropdown.style.display = 'block';
        // Auto-focus the input
        setTimeout(() => customTimeInput?.focus(), 100);
      } else {
        timePickerDropdown.style.display = 'none';
      }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!timePickerDropdown.contains(e.target) && !startTimeBadge.contains(e.target)) {
        timePickerDropdown.style.display = 'none';
      }
    });

    // Set time button
    if (setCustomTimeBtn && customTimeInput) {
      setCustomTimeBtn.addEventListener('click', () => {
        const timeValue = customTimeInput.value; // "HH:MM" format
        if (timeValue) {
          const [hours, minutes] = timeValue.split(':').map(Number);
          const startTime = new Date();
          startTime.setHours(hours, minutes, 0, 0);
          setShiftStart(startTime);
          timePickerDropdown.style.display = 'none';
        }
      });

      // Also allow Enter key
      customTimeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          setCustomTimeBtn.click();
        }
      });
    }
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

  // Copy crew from previous hour
  const copyCrewBtn = document.getElementById('copy-crew-btn');
  if (copyCrewBtn) {
    copyCrewBtn.addEventListener('click', copyCrewFromPrevious);
  }

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
  document.querySelectorAll('#editor-content input, #editor-content select, #editor-content textarea').forEach((el) => {
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
    // Show timeline, hide editor (within card)
    timelineContent.classList.add('active');
    editorContent.classList.remove('active');
    editorHeaderInline.style.display = 'none';
    if (cardTitle) cardTitle.style.display = '';
    renderTimeline();
    updateTimelineSummary();
  } else {
    // Show editor, hide timeline (within card)
    timelineContent.classList.remove('active');
    editorContent.classList.add('active');
    editorHeaderInline.style.display = 'flex';
    if (cardTitle) cardTitle.style.display = 'none';
  }
}

function renderTimeline() {
  const list = document.getElementById('timeline-list');
  list.innerHTML = '';
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', currentLang === 'es' ? 'Horas del día' : 'Time slots');

  const currentSlot = getCurrentTimeSlot();

  // Split into morning (0-4) and afternoon (5-9) for two-column layout
  const morningSlots = TIME_SLOTS.slice(0, 5);  // 7-8 through 11-12
  const afternoonSlots = TIME_SLOTS.slice(5);    // 12:30-1 through 4-4:30

  // Render in pairs: morning left, afternoon right (row by row)
  for (let row = 0; row < 5; row++) {
    const morningSlot = morningSlots[row];
    const afternoonSlot = afternoonSlots[row];

    // Filter by shift start (for today only)
    const isToday = currentDate === formatDateLocal(new Date());

    // Render morning slot
    if (!isToday || isSlotVisible(morningSlot)) {
      list.appendChild(createSlotElement(morningSlot, currentSlot));
    } else {
      // Add placeholder to maintain grid alignment
      const placeholder = document.createElement('div');
      placeholder.className = 'timeline-slot-placeholder';
      list.appendChild(placeholder);
    }

    // Render afternoon slot
    if (!isToday || isSlotVisible(afternoonSlot)) {
      list.appendChild(createSlotElement(afternoonSlot, currentSlot));
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'timeline-slot-placeholder';
      list.appendChild(placeholder);
    }
  }
}

function createSlotElement(slot, currentSlot) {
  const index = TIME_SLOTS.indexOf(slot);
  const data = dayData[slot] || {};
  const totalTops = (data.tops1 || 0) + (data.tops2 || 0);
  const totalSmalls = (data.smalls1 || 0) + (data.smalls2 || 0);
  const totalTrimmers = (data.trimmers1 || 0) + (data.trimmers2 || 0);
  const hasData = totalTops > 0 || data.trimmers1 > 0;
  const isCurrent = slot === currentSlot;

  // Get cultivar (prefer Line 1, fallback to Line 2)
  const cultivar = data.cultivar1 || data.cultivar2 || '';
  // Shorten cultivar name (remove year prefix if present)
  const cultivarShort = cultivar.replace(/^\d{4}\s*/, '');

  // Calculate hourly target using effective trimmers (accounts for mid-hour crew changes)
  const multiplier = getSlotMultiplier(slot);
  const effective = getEffectiveTrimmers(slot, data);
  const effectiveTotal = effective.effectiveTrimmers1 + effective.effectiveTrimmers2;
  const hourlyTarget = effectiveTotal * targetRate * multiplier;
  const metTarget = totalTops >= hourlyTarget;

  const div = document.createElement('div');
  div.className = 'timeline-slot' + (hasData ? ' has-data' : '') + (isCurrent ? ' current' : '');
  div.setAttribute('role', 'listitem');
  div.setAttribute('tabindex', '0');
  div.setAttribute('aria-label', `${slot}, ${cultivarShort || (currentLang === 'es' ? 'sin cultivar' : 'no cultivar')}, ${hasData
    ? (currentLang === 'es' ? `${totalTops.toFixed(1)} libras` : `${totalTops.toFixed(1)} lbs`)
    : (currentLang === 'es' ? 'sin datos' : 'no data')}`);

  // Status indicator
  const statusIcon = hasData ? '✓' : '○';
  const statusText = hasData
    ? (currentLang === 'es' ? 'Completo' : 'Done')
    : (currentLang === 'es' ? 'Pendiente' : 'Empty');

  // Smalls display (only show if > 0)
  const smallsDisplay = totalSmalls > 0
    ? ` <span class="slot-smalls">+${totalSmalls.toFixed(1)}sm</span>`
    : '';

  // Target display (only show if we have trimmers/target)
  const targetDisplay = hourlyTarget > 0
    ? `<span class="slot-target ${metTarget ? 'met' : 'missed'}">/ ${hourlyTarget.toFixed(1)}</span>`
    : '';

  div.innerHTML = `
    <div class="slot-row">
      <span class="slot-time">${formatSlotShort(slot)}</span>
      <span class="slot-status" aria-hidden="true">${statusIcon}</span>
    </div>
    <span class="slot-cultivar">${cultivarShort || '—'}</span>
    <div class="slot-row">
      <span class="slot-lbs ${hasData ? '' : 'empty'}">${hasData ? totalTops.toFixed(1) + ' lbs' : '—'}</span>${smallsDisplay}
      ${targetDisplay}
      <span class="slot-status-text visually-hidden">${statusText}</span>
    </div>
  `;

  // Click handler
  div.addEventListener('click', () => openEditor(index));

  // Keyboard handler (adjusted for grid navigation)
  div.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openEditor(index);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = div.nextElementSibling;
      if (next && !next.classList.contains('timeline-slot-placeholder')) next.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = div.previousElementSibling;
      if (prev && !prev.classList.contains('timeline-slot-placeholder')) prev.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      // Skip 2 elements to get to next row same column
      let target = div.nextElementSibling?.nextElementSibling;
      if (target && !target.classList.contains('timeline-slot-placeholder')) target.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      let target = div.previousElementSibling?.previousElementSibling;
      if (target && !target.classList.contains('timeline-slot-placeholder')) target.focus();
    }
  });

  return div;
}

function openEditor(slotIndex) {
  currentSlotIndex = slotIndex;
  const slot = TIME_SLOTS[slotIndex];

  // Update time label (inline header)
  document.getElementById('editor-time-label-inline').textContent = formatSlotShort(slot);

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

  // Initialize crew change log with current crew as the baseline entry
  const initialTrimmers1 = data.trimmers1 || 0;
  const initialTrimmers2 = data.trimmers2 || 0;
  const slotStartMin = SLOT_START_MINUTES[slot];
  crewChangeLog = (initialTrimmers1 > 0 || initialTrimmers2 > 0)
    ? [{ minutesMark: slotStartMin || getCurrentMinutes(), trimmers1: initialTrimmers1, trimmers2: initialTrimmers2 }]
    : [];

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

function copyCrewFromPrevious() {
  const labels = LABELS[currentLang];
  const copyBtn = document.getElementById('copy-crew-btn');
  const copyLabel = copyBtn?.querySelector('.copy-label');

  // Can't copy if we're at the first slot
  if (currentSlotIndex === 0) {
    if (copyLabel) copyLabel.textContent = labels.noPrevData;
    setTimeout(() => {
      if (copyLabel) copyLabel.textContent = labels.copyPrev;
    }, 1500);
    return;
  }

  // Get previous slot's data
  const prevSlot = TIME_SLOTS[currentSlotIndex - 1];
  const prevData = dayData[prevSlot];

  if (!prevData || (!prevData.trimmers1 && !prevData.trimmers2)) {
    if (copyLabel) copyLabel.textContent = labels.noPrevData;
    setTimeout(() => {
      if (copyLabel) copyLabel.textContent = labels.copyPrev;
    }, 1500);
    return;
  }

  // Copy crew fields
  document.getElementById('buckers1').value = prevData.buckers1 || 0;
  document.getElementById('trimmers1').value = prevData.trimmers1 || 0;
  document.getElementById('tzero1').value = prevData.tzero1 || 0;
  document.getElementById('qcperson').value = prevData.qcperson || 0;
  document.getElementById('cultivar1').value = prevData.cultivar1 || '';

  // Copy Line 2 if it has data
  if (prevData.trimmers2 > 0) {
    document.getElementById('buckers2').value = prevData.buckers2 || 0;
    document.getElementById('trimmers2').value = prevData.trimmers2 || 0;
    document.getElementById('tzero2').value = prevData.tzero2 || 0;
    document.getElementById('cultivar2').value = prevData.cultivar2 || '';
    document.getElementById('line2-section').classList.add('expanded');
  }

  // Visual feedback
  copyBtn?.classList.add('copied');
  if (copyLabel) copyLabel.textContent = labels.copied;
  setTimeout(() => {
    copyBtn?.classList.remove('copied');
    if (copyLabel) copyLabel.textContent = labels.copyPrev;
  }, 1500);

  // Trigger save and update UI
  scheduleAutoSave();
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

/**
 * Get current time as minutes from midnight
 */
function getCurrentMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * Record a crew change in the log for the current slot.
 * Called when trimmer count changes during an active hour.
 */
function recordCrewChange() {
  const trimmers1 = parseInt(document.getElementById('trimmers1').value, 10) || 0;
  const trimmers2 = parseInt(document.getElementById('trimmers2').value, 10) || 0;
  const minutesMark = getCurrentMinutes();

  // Only record if trimmers actually changed from the last log entry
  const lastEntry = crewChangeLog[crewChangeLog.length - 1];
  if (lastEntry && lastEntry.trimmers1 === trimmers1 && lastEntry.trimmers2 === trimmers2) {
    return; // No trimmer change
  }

  crewChangeLog.push({ minutesMark, trimmers1, trimmers2 });
}

/**
 * Calculate time-weighted effective trimmers for a slot.
 * If crew changed mid-hour, this returns the weighted average.
 * For slots with no crew changes (or loaded from saved data), returns raw trimmers.
 *
 * @param {string} slot - Time slot string
 * @param {object} [savedData] - Optional saved data from dayData (for timeline/summary use)
 * @returns {{ effectiveTrimmers1: number, effectiveTrimmers2: number }}
 */
function getEffectiveTrimmers(slot, savedData = null) {
  // If savedData has pre-computed effective trimmers from the API, use those
  if (savedData && savedData.effectiveTrimmers1 != null) {
    return {
      effectiveTrimmers1: savedData.effectiveTrimmers1,
      effectiveTrimmers2: savedData.effectiveTrimmers2 || 0,
    };
  }

  // For the currently-open editor slot with active crew changes
  const isCurrentEditorSlot = slot === TIME_SLOTS[currentSlotIndex];
  if (isCurrentEditorSlot && crewChangeLog.length > 1) {
    const slotStartMinutes = SLOT_START_MINUTES[slot];
    if (slotStartMinutes === undefined) {
      const t1 = parseInt(document.getElementById('trimmers1').value, 10) || 0;
      const t2 = parseInt(document.getElementById('trimmers2').value, 10) || 0;
      return { effectiveTrimmers1: t1, effectiveTrimmers2: t2 };
    }

    const baseMultiplier = (slot === '4:00 PM – 4:30 PM' || slot === '12:30 PM – 1:00 PM') ? 0.5 : 1;
    const slotDuration = baseMultiplier === 0.5 ? 30 : 60;
    const slotEndMinutes = slotStartMinutes + slotDuration;
    const nowMinutes = getCurrentMinutes();
    // Use current time or slot end, whichever is earlier
    const endMark = Math.min(nowMinutes, slotEndMinutes);

    let weightedSum1 = 0, weightedSum2 = 0, totalDuration = 0;

    for (let i = 0; i < crewChangeLog.length; i++) {
      const entry = crewChangeLog[i];
      const segStart = Math.max(entry.minutesMark, slotStartMinutes);
      const segEnd = (i + 1 < crewChangeLog.length)
        ? Math.min(crewChangeLog[i + 1].minutesMark, endMark)
        : endMark;
      const duration = Math.max(0, segEnd - segStart);

      weightedSum1 += entry.trimmers1 * duration;
      weightedSum2 += entry.trimmers2 * duration;
      totalDuration += duration;
    }

    if (totalDuration > 0) {
      return {
        effectiveTrimmers1: Math.round(weightedSum1 / totalDuration * 10) / 10,
        effectiveTrimmers2: Math.round(weightedSum2 / totalDuration * 10) / 10,
      };
    }
  }

  // Default: use raw trimmer values from form or saved data
  if (isCurrentEditorSlot) {
    const t1 = parseInt(document.getElementById('trimmers1').value, 10) || 0;
    const t2 = parseInt(document.getElementById('trimmers2').value, 10) || 0;
    return { effectiveTrimmers1: t1, effectiveTrimmers2: t2 };
  }

  // From saved data (no effective trimmers stored)
  if (savedData) {
    return {
      effectiveTrimmers1: savedData.trimmers1 || 0,
      effectiveTrimmers2: savedData.trimmers2 || 0,
    };
  }

  return { effectiveTrimmers1: 0, effectiveTrimmers2: 0 };
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

  // Calculate hourly target using effective (weighted) trimmers if crew changed mid-hour
  const slot = TIME_SLOTS[currentSlotIndex];
  const multiplier = getSlotMultiplier(slot);
  const effective = getEffectiveTrimmers(slot);
  const effectiveTotal = effective.effectiveTrimmers1 + effective.effectiveTrimmers2;
  const hourlyTarget = effectiveTotal * targetRate * multiplier;
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
    crewSection?.classList.add('needs-attention');
  } else if (!hasProduction) {
    // Step 2: Enter Production
    stepGuide.classList.add('step-production');
    stepIcon.textContent = '2';
    stepTitle.textContent = labels.stepProductionTitle;
    crewSection?.classList.add('completed');
    productionSection?.classList.add('needs-attention');
  } else if (metTarget) {
    // Target met - celebrate!
    stepGuide.classList.add('step-celebrate');
    stepIcon.textContent = '🎉';
    stepTitle.textContent = `${labels.stepCelebrateTitle} ${totalTops.toFixed(1)}lbs`;
    crewSection?.classList.add('completed');
    productionSection?.classList.add('completed');
  } else if (!hasReason) {
    // Target missed, need reason
    stepGuide.classList.add('step-missed');
    stepIcon.textContent = '!';
    stepTitle.textContent = `${labels.stepMissedTitle} ${totalTops.toFixed(1)}/${hourlyTarget.toFixed(1)}`;
    crewSection?.classList.add('completed');
    productionSection?.classList.add('completed');
    qcNotesSection?.classList.add('needs-attention');
  } else {
    // Target missed but reason provided
    stepGuide.classList.add('step-complete');
    stepIcon.textContent = '✓';
    stepTitle.textContent = `${labels.stepCompleteTitle} ${totalTops.toFixed(1)}lbs`;
    crewSection?.classList.add('completed');
    productionSection?.classList.add('completed');
    qcNotesSection?.classList.add('completed');
  }

  // Update hourly target display
  const hourlyTargetEl = document.getElementById('hourly-target-value');
  if (hourlyTargetEl) {
    hourlyTargetEl.textContent = hourlyTarget > 0 ? `${hourlyTarget.toFixed(1)} lbs` : '-- lbs';
  }
}

function collectFormData() {
  const slot = TIME_SLOTS[currentSlotIndex];

  // Calculate effective trimmers (weighted average if crew changed mid-hour)
  const effective = getEffectiveTrimmers(slot);

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
    effectiveTrimmers1: effective.effectiveTrimmers1,
    effectiveTrimmers2: effective.effectiveTrimmers2,
  };
}

function scheduleAutoSave() {
  if (saveTimeout) clearTimeout(saveTimeout);

  // Record crew change if trimmers changed (for weighted goal calculation)
  recordCrewChange();

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

      // Reset crew change log with current crew as new baseline
      const currentTrimmers1 = parseInt(document.getElementById('trimmers1').value, 10) || 0;
      const currentTrimmers2 = parseInt(document.getElementById('trimmers2').value, 10) || 0;
      crewChangeLog = [{ minutesMark: getCurrentMinutes(), trimmers1: currentTrimmers1, trimmers2: currentTrimmers2 }];
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

  // For today, exclude current hour from target (data entered at END of hour)
  const isToday = currentDate === formatDateLocal(new Date());
  const currentSlot = isToday ? getCurrentTimeSlot() : null;

  Object.entries(dayData).forEach(([slot, row]) => {
    const rowTops = (row.tops1 || 0) + (row.tops2 || 0);
    totalTops += rowTops;
    if (rowTops > 0 || row.trimmers1 > 0) {
      hoursLogged++;
      // Skip current hour for target calculation (still being worked on)
      if (slot === currentSlot) {
        return; // Don't add to target - hour not complete
      }
      // Calculate target using effective trimmers (accounts for mid-hour crew changes)
      const slotKey = row.timeSlot || slot;
      const effective = getEffectiveTrimmers(slotKey, row);
      const effectiveTotal = effective.effectiveTrimmers1 + effective.effectiveTrimmers2;
      const multiplier = getSlotMultiplier(slotKey);
      totalTarget += effectiveTotal * targetRate * multiplier;
    }
  });

  const percentage = totalTarget > 0 ? Math.round((totalTops / totalTarget) * 100) : 0;

  document.getElementById('timeline-total').textContent = `${totalTops.toFixed(1)} lbs`;
  document.getElementById('timeline-target').textContent = `${totalTarget.toFixed(1)} lbs`;
  document.getElementById('timeline-hours').textContent = hoursLogged;
  document.getElementById('timeline-progress').style.width = `${Math.min(percentage, 100)}%`;
}

function updateEditorSummary() {
  // Editor summary elements removed in in-card layout
  // The timeline summary already shows daily totals
  // This function is kept for backward compatibility but does nothing
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
    id: 'navigation-arrows',
    target: 'editor-nav-inline',
    title: { en: 'Hour Navigation', es: 'Navegación por Hora' },
    text: {
      en: 'Use the arrow buttons ← → to quickly move between hours without going back to the timeline.\n\n← Previous hour\n→ Next hour\n\nThis makes it fast to enter data for multiple hours in a row!',
      es: 'Usa los botones de flecha ← → para moverte rápido entre horas sin volver a la línea de tiempo.\n\n← Hora anterior\n→ Hora siguiente\n\n¡Esto hace rápido ingresar datos de varias horas seguidas!',
    },
  },
  {
    id: 'done',
    target: null,
    title: { en: 'You\'re Ready! ✨', es: '¡Estás Listo! ✨' },
    text: {
      en: 'Data saves automatically as you type. Use the arrow buttons to move between hours, or tap the ← back button to return to the timeline.\n\nTap "Got It" to start entering data!',
      es: 'Los datos se guardan automáticamente. Usa las flechas para moverte entre horas, o toca ← para volver a la línea de tiempo.\n\n¡Toca "Entendido" para comenzar!',
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
    } else if (step.target === 'start-day-btn') {
      // Start day button or the time badge if already started
      targetEl = document.getElementById('start-day-btn');
      if (targetEl && targetEl.style.display === 'none') {
        targetEl = document.getElementById('start-time-badge');
      }
    } else if (step.target === 'editor-nav-inline') {
      targetEl = document.querySelector('.editor-nav-inline');
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
const POOL_API_URL = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/pool';

let barcodeProducts = []; // Products loaded from barcode API
let poolProducts = []; // Products loaded from Pool API
let currentPoolType = 'smalls'; // Current pool type selection (smalls or tops)
let currentOperation = 'add'; // Current operation selection (add, subtract, set)
let currentUnit = 'grams'; // Current unit for input (grams or lbs)
let poolDataTimestamp = null; // Timestamp of last pool data load
let customDropdownScannerStrains = []; // Products for scanner dropdown
const STALE_DATA_THRESHOLD = 5 * 60 * 1000; // 5 minutes

/**
 * Initialize barcode card functionality
 * Called after cultivars are loaded
 */
async function initBarcodeCard() {
  await loadBarcodeProducts();
  populateBarcodeStrainSelect();
  initBarcodePrintButtons();
  initBarcodeTabs();
  initScannerTab();
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
 * Custom dropdown state
 */
let customDropdownCultivars = [];

/**
 * Populate the barcode strain dropdown with cultivars that have products
 */
function populateBarcodeStrainSelect() {
  const dropdown = document.getElementById('barcode-strain-dropdown');
  const hiddenInput = document.getElementById('barcode-strain');
  if (!dropdown || !hiddenInput) return;

  // Get unique cultivars from products (extract cultivar name from header)
  const cultivarsWithProducts = new Set();
  barcodeProducts.forEach((p) => {
    // Header format: "Cultivar Name Tops 5KG" or "Cultivar Name - Tops 5KG"
    const match = p.header.match(/^(.+?)\s+(?:-\s*)?(Tops|Smalls)/i);
    if (match) {
      cultivarsWithProducts.add(match[1].trim());
    }
  });

  // Sort cultivars alphabetically
  customDropdownCultivars = Array.from(cultivarsWithProducts).sort();

  // Render options
  renderCustomDropdownOptions(dropdown, customDropdownCultivars, hiddenInput.value);

  // Initialize dropdown behavior if not already done
  if (!dropdown.dataset.initialized) {
    initCustomDropdown(dropdown);
    dropdown.dataset.initialized = 'true';
  }
}

/**
 * Render custom dropdown options
 */
function renderCustomDropdownOptions(dropdown, cultivars, selectedValue, filter = '') {
  const optionsContainer = dropdown.querySelector('.custom-select-options');
  if (!optionsContainer) return;

  const filterLower = filter.toLowerCase();
  const filtered = filter
    ? cultivars.filter((c) => c.toLowerCase().includes(filterLower))
    : cultivars;

  if (filtered.length === 0) {
    optionsContainer.innerHTML = `<div class="custom-select-no-results">No strains found</div>`;
    return;
  }

  optionsContainer.innerHTML = filtered
    .map(
      (cultivar) => `
      <div class="custom-select-option${cultivar === selectedValue ? ' selected' : ''}" 
           data-value="${cultivar}" 
           role="option"
           aria-selected="${cultivar === selectedValue}">
        ${cultivar}
      </div>
    `
    )
    .join('');
}

/**
 * Initialize custom dropdown behavior
 */
function initCustomDropdown(dropdown) {
  const trigger = dropdown.querySelector('.custom-select-trigger');
  const menu = dropdown.querySelector('.custom-select-menu');
  const searchInput = dropdown.querySelector('.custom-select-search-input');
  const optionsContainer = dropdown.querySelector('.custom-select-options');
  const valueDisplay = dropdown.querySelector('.custom-select-value');
  const hiddenInput = dropdown.querySelector('input[type="hidden"]');

  // Toggle dropdown on trigger click
  registerListener(trigger, 'click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains('open');
    closeAllCustomDropdowns();
    if (!isOpen) {
      dropdown.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      searchInput.value = '';
      renderCustomDropdownOptions(dropdown, customDropdownCultivars, hiddenInput.value);
      setTimeout(() => searchInput.focus(), 50);
    }
  });

  // Filter on search input
  registerListener(searchInput, 'input', () => {
    renderCustomDropdownOptions(dropdown, customDropdownCultivars, hiddenInput.value, searchInput.value);
  });

  // Prevent menu clicks from closing
  registerListener(menu, 'click', (e) => {
    e.stopPropagation();
  });

  // Handle option selection
  registerListener(optionsContainer, 'click', (e) => {
    const option = e.target.closest('.custom-select-option');
    if (!option) return;

    const value = option.dataset.value;
    selectCustomDropdownValue(dropdown, value);
    closeAllCustomDropdowns();
  });

  // Close on outside click
  registerListener(document, 'click', () => {
    closeAllCustomDropdowns();
  });

  // Close on escape
  registerListener(document, 'keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllCustomDropdowns();
    }
  });
}

/**
 * Select a value in the custom dropdown
 */
function selectCustomDropdownValue(dropdown, value) {
  const valueDisplay = dropdown.querySelector('.custom-select-value');
  const hiddenInput = dropdown.querySelector('input[type="hidden"]');

  hiddenInput.value = value;
  valueDisplay.textContent = value || LABELS[currentLang].selectStrain || 'Select strain...';
  valueDisplay.classList.toggle('placeholder', !value);
  dropdown.classList.toggle('has-selection', !!value);

  // Dispatch change event on hidden input
  hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Close all custom dropdowns
 */
function closeAllCustomDropdowns() {
  document.querySelectorAll('.custom-select.open').forEach((dropdown) => {
    dropdown.classList.remove('open');
    const trigger = dropdown.querySelector('.custom-select-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  });
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

  // Generate barcode URL using TEC-IT (optimized for 1" x 0.5" labels)
  const barcodeUrl = 'https://barcode.tec-it.com/barcode.ashx?data=' + encodeURIComponent(barcode) +
    '&code=Code128&dpi=203&modulewidth=fit&height=30&hidetext=1';

  // Create or reuse print iframe
  let iframe = document.getElementById('barcode-print-frame');
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = 'barcode-print-frame';
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:none;';
    document.body.appendChild(iframe);
  }

  // Build print document - 1" x 0.5" label layout (fills the label)
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write('<!DOCTYPE html><html><head><style>');
  doc.write('@page { size: 1in 0.5in; margin: 0 !important; }');
  doc.write('@media print { html, body { width: 1in !important; height: 0.5in !important; margin: 0 !important; padding: 0 !important; overflow: hidden; } }');
  doc.write('body { margin: 0; padding: 0; font-family: Arial, sans-serif; }');
  doc.write('.label { width: 1in; height: 0.5in; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0; box-sizing: border-box; }');
  doc.write('.name { font-size: 7pt; font-weight: bold; margin-bottom: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 0.95in; }');
  doc.write('img { width: 0.95in; height: 0.28in; }');
  doc.write('.code { font-size: 6pt; margin-top: 1px; font-family: monospace; }');
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
 * Initialize barcode tab switching
 */
function initBarcodeTabs() {
  const tabs = document.querySelectorAll('.barcode-tab');
  const contents = document.querySelectorAll('.barcode-tab-content');

  tabs.forEach((tab) => {
    registerListener(tab, 'click', () => {
      const targetTab = tab.dataset.tab;

      // Update active tab
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      // Show/hide content
      contents.forEach((content) => {
        if (content.id === `tab-${targetTab}`) {
          content.classList.remove('hidden');
        } else {
          content.classList.add('hidden');
        }
      });
    });
  });
}

/**
 * Initialize scanner tab functionality
 */
async function initScannerTab() {
  // Set initial pool type attribute for styling
  const scannerTab = document.getElementById('tab-scanner');
  if (scannerTab) {
    scannerTab.setAttribute('data-pool-type', currentPoolType);
  }

  await loadPoolProducts();
  initPoolTypeToggle();
  populateScannerStrainSelect();
  initOperationButtons();
  initUnitToggle();
  initPoolAmountInput();
  initRefreshPoolButton();
  initPoolUpdateButton();
  initRecentChanges();
}

/**
 * Load pool products from Pool Inventory API
 */
async function loadPoolProducts() {
  try {
    const response = await fetch(`${POOL_API_URL}?action=list_products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        poolType: currentPoolType
      })
    });

    const result = await response.json();
    poolProducts = result.products || [];

    // Set timestamp for stale data detection
    poolDataTimestamp = Date.now();
  } catch (error) {
    console.error('Failed to load pool products:', error);
    poolProducts = [];
  }
}

/**
 * Initialize pool type toggle buttons (Smalls/Tops)
 */
function initPoolTypeToggle() {
  const toggleBtns = document.querySelectorAll('.pool-type-btn');

  toggleBtns.forEach((btn) => {
    registerListener(btn, 'click', async () => {
      // Update active state
      toggleBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      // Update current pool type
      currentPoolType = btn.dataset.poolType;

      // Update scanner tab data attribute for styling
      const scannerTab = document.getElementById('tab-scanner');
      if (scannerTab) {
        scannerTab.setAttribute('data-pool-type', currentPoolType);
      }

      // Reload products for new pool type
      await loadPoolProducts();
      populateScannerStrainSelect();

      // Update current pool display
      updateCurrentPoolDisplay();
    });
  });
}

/**
 * Clean product title to show only cultivar name
 */
function cleanProductTitle(title) {
  return title
    .replace(/^New!\s*/i, '')  // Remove "New!" prefix
    .replace(/\s*hemp flower\s*/gi, '')  // Remove "hemp flower"
    .replace(/\s+/g, ' ')  // Normalize whitespace
    .trim();
}

/**
 * Populate the scanner strain dropdown with products from Pool API
 */
function populateScannerStrainSelect() {
  const dropdown = document.getElementById('scanner-strain-dropdown');
  const hiddenInput = document.getElementById('scanner-strain');
  if (!dropdown || !hiddenInput) return;

  // Clean and sort products by title
  const sortedProducts = [...poolProducts]
    .map(p => ({ ...p, displayTitle: cleanProductTitle(p.title) }))
    .sort((a, b) => a.displayTitle.localeCompare(b.displayTitle));

  // Store products for dropdown
  customDropdownScannerStrains = sortedProducts;

  // Save current value
  const currentValue = hiddenInput.value;

  // Render options
  renderScannerDropdownOptions(dropdown, sortedProducts, currentValue);

  // Initialize dropdown if not already done
  if (!dropdown.dataset.initialized) {
    initScannerCustomDropdown(dropdown);
    dropdown.dataset.initialized = 'true';
  }

  // Restore selection if it still exists
  if (currentValue && sortedProducts.find(p => p.id === currentValue)) {
    const product = sortedProducts.find(p => p.id === currentValue);
    selectScannerDropdownValue(dropdown, currentValue, product.displayTitle);
  }
}

/**
 * Render scanner dropdown options
 */
function renderScannerDropdownOptions(dropdown, products, selectedValue, filter = '') {
  const optionsContainer = dropdown.querySelector('.custom-select-options');
  if (!optionsContainer) return;

  const filterLower = filter.toLowerCase();
  const filtered = filter
    ? products.filter((p) => (p.displayTitle || p.title).toLowerCase().includes(filterLower))
    : products;

  if (filtered.length === 0) {
    optionsContainer.innerHTML = `<div class="custom-select-no-results">No strains found</div>`;
    return;
  }

  optionsContainer.innerHTML = filtered
    .map(
      (product) => {
        const displayName = product.displayTitle || product.title;
        const poolValue = parseFloat(product.poolValue) || 0;

        // Show in lbs if >= 1lb (453.592g), otherwise show in grams
        let weightDisplay;
        if (poolValue >= 453.592) {
          const poolLbs = poolValue / 453.592;
          weightDisplay = `${poolLbs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}lbs`;
        } else {
          weightDisplay = `${poolValue.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}g`;
        }

        return `
      <div class="custom-select-option${product.id === selectedValue ? ' selected' : ''}"
           data-value="${product.id}"
           data-pool-value="${product.poolValue}"
           data-title="${displayName}"
           role="option"
           aria-selected="${product.id === selectedValue}">
        <span class="option-name">${displayName}</span>
        <span class="option-weight">${weightDisplay}</span>
      </div>
    `;
      }
    )
    .join('');
}

/**
 * Initialize scanner custom dropdown behavior
 */
function initScannerCustomDropdown(dropdown) {
  const trigger = dropdown.querySelector('.custom-select-trigger');
  const menu = dropdown.querySelector('.custom-select-menu');
  const searchInput = dropdown.querySelector('.custom-select-search-input');
  const optionsContainer = dropdown.querySelector('.custom-select-options');
  const valueDisplay = dropdown.querySelector('.custom-select-value');
  const hiddenInput = dropdown.querySelector('input[type="hidden"]');

  // Toggle dropdown on trigger click
  registerListener(trigger, 'click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains('open');
    closeAllCustomDropdowns();
    if (!isOpen) {
      dropdown.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      searchInput.value = '';
      searchInput.focus();
      renderScannerDropdownOptions(dropdown, customDropdownScannerStrains, hiddenInput.value);
    }
  });

  // Search input
  registerListener(searchInput, 'input', () => {
    renderScannerDropdownOptions(dropdown, customDropdownScannerStrains, hiddenInput.value, searchInput.value);
  });

  // Prevent menu clicks from closing
  registerListener(menu, 'click', (e) => {
    e.stopPropagation();
  });

  // Handle option selection
  registerListener(optionsContainer, 'click', (e) => {
    const option = e.target.closest('.custom-select-option');
    if (!option) return;

    const value = option.dataset.value;
    const title = option.dataset.title;
    selectScannerDropdownValue(dropdown, value, title);
    closeAllCustomDropdowns();
  });

  // Close on outside click
  registerListener(document, 'click', () => {
    if (dropdown.classList.contains('open')) {
      closeAllCustomDropdowns();
    }
  });

  // Close on Escape
  registerListener(document, 'keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllCustomDropdowns();
    }
  });
}

/**
 * Select a value in the scanner custom dropdown
 */
function selectScannerDropdownValue(dropdown, value, title) {
  const valueDisplay = dropdown.querySelector('.custom-select-value');
  const hiddenInput = dropdown.querySelector('input[type="hidden"]');

  hiddenInput.value = value;
  valueDisplay.textContent = title || LABELS[currentLang].selectStrain || 'Select strain...';
  valueDisplay.classList.toggle('placeholder', !value);
  dropdown.classList.toggle('has-selection', !!value);

  // Update current pool display
  updateCurrentPoolDisplay();

  // Dispatch change event on hidden input
  hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Update the current pool value display with both grams and pounds
 */
function updateCurrentPoolDisplay() {
  const hiddenInput = document.getElementById('scanner-strain');
  const poolValueGramsEl = document.getElementById('current-pool-value-grams');
  const poolValueLbsEl = document.getElementById('current-pool-value-lbs');

  if (!hiddenInput || !poolValueGramsEl || !poolValueLbsEl) return;

  const productId = hiddenInput.value;
  const product = poolProducts.find(p => p.id === productId);

  if (product && product.poolValue !== undefined) {
    const grams = parseFloat(product.poolValue);
    const lbs = grams / 453.592; // Convert grams to pounds

    poolValueGramsEl.textContent = grams.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    poolValueLbsEl.textContent = lbs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Check for stale data
    checkStaleData();
  } else {
    poolValueGramsEl.textContent = '--';
    poolValueLbsEl.textContent = '--';
  }

  // Update preview if amount is entered
  updatePoolPreview();
}

/**
 * Check if pool data is stale and show indicator
 */
function checkStaleData() {
  const staleIndicator = document.getElementById('pool-stale-indicator');
  if (!staleIndicator) return;

  if (poolDataTimestamp) {
    const elapsed = Date.now() - poolDataTimestamp;
    if (elapsed > STALE_DATA_THRESHOLD) {
      staleIndicator.style.display = 'block';
      staleIndicator.title = `Data is ${Math.floor(elapsed / 60000)} minutes old. Click refresh to update.`;
    } else {
      staleIndicator.style.display = 'none';
    }
  }
}

/**
 * Update pool preview calculation
 */
function updatePoolPreview() {
  const previewDiv = document.getElementById('pool-preview');
  const hiddenInput = document.getElementById('scanner-strain');
  const amountInput = document.getElementById('pool-amount');
  const poolValueGramsEl = document.getElementById('current-pool-value-grams');
  const operationLabel = document.getElementById('preview-operation-label');
  const previewCurrent = document.getElementById('preview-current');
  const previewChange = document.getElementById('preview-change');
  const previewNew = document.getElementById('preview-new');

  if (!previewDiv || !amountInput || !poolValueGramsEl) return;

  const amount = parseFloat(amountInput.value) || 0;
  const currentValueGrams = parseFloat(poolValueGramsEl.textContent.replace(/,/g, '')) || 0;

  if (amount > 0 && hiddenInput.value) {
    // Convert amount to grams if needed
    let amountGrams = amount;
    if (currentUnit === 'lbs') {
      amountGrams = amount * 453.592;
    }

    // Calculate new value
    let newValue;
    if (currentOperation === 'add') {
      newValue = currentValueGrams + amountGrams;
      operationLabel.textContent = LABELS[currentLang].adding || 'Adding:';
      previewChange.textContent = `+${amountGrams.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}g`;
    } else if (currentOperation === 'subtract') {
      newValue = Math.max(0, currentValueGrams - amountGrams);
      operationLabel.textContent = LABELS[currentLang].subtracting || 'Subtracting:';
      previewChange.textContent = `-${amountGrams.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}g`;
    } else { // set
      newValue = amountGrams;
      operationLabel.textContent = LABELS[currentLang].setting || 'Setting to:';
      previewChange.textContent = `${amountGrams.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}g`;
    }

    previewCurrent.textContent = `${currentValueGrams.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}g`;
    previewNew.textContent = `${newValue.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}g`;
    previewDiv.style.display = 'block';
  } else {
    previewDiv.style.display = 'none';
  }
}

/**
 * Initialize unit toggle buttons (grams/lbs)
 */
function initUnitToggle() {
  const unitBtns = document.querySelectorAll('.unit-btn');

  unitBtns.forEach((btn) => {
    registerListener(btn, 'click', () => {
      // Update active state
      unitBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      // Update current unit
      currentUnit = btn.dataset.unit;

      // Update preview
      updatePoolPreview();
    });
  });
}

/**
 * Initialize pool amount input listener for live preview
 */
function initPoolAmountInput() {
  const amountInput = document.getElementById('pool-amount');
  if (!amountInput) return;

  registerListener(amountInput, 'input', () => {
    updatePoolPreview();
  });
}

/**
 * Initialize refresh pool button
 */
function initRefreshPoolButton() {
  const refreshBtn = document.getElementById('refresh-pool-btn');
  if (!refreshBtn) return;

  registerListener(refreshBtn, 'click', async () => {
    // Show loading state
    refreshBtn.style.opacity = '0.5';
    refreshBtn.style.pointerEvents = 'none';

    try {
      // Reload pool products
      await loadPoolProducts();

      // Repopulate dropdown
      populateScannerStrainSelect();

      // Update display
      updateCurrentPoolDisplay();

      // Hide stale indicator
      const staleIndicator = document.getElementById('pool-stale-indicator');
      if (staleIndicator) {
        staleIndicator.style.display = 'none';
      }
    } catch (error) {
      console.error('Failed to refresh pool data:', error);
    } finally {
      // Restore button state
      refreshBtn.style.opacity = '1';
      refreshBtn.style.pointerEvents = 'auto';
    }
  });
}

/**
 * Initialize operation buttons (Add/Subtract/Set)
 */
function initOperationButtons() {
  const operationBtns = document.querySelectorAll('.operation-btn');

  operationBtns.forEach((btn) => {
    registerListener(btn, 'click', () => {
      // Update active state
      operationBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      // Update current operation
      currentOperation = btn.dataset.operation;

      // Update preview
      updatePoolPreview();
    });
  });
}

/**
 * Initialize pool update button
 */
function initPoolUpdateButton() {
  const updateBtn = document.getElementById('update-pool-btn');
  if (!updateBtn) return;

  registerListener(updateBtn, 'click', async () => {
    const strainSelect = document.getElementById('scanner-strain');
    const amountInput = document.getElementById('pool-amount');
    const noteInput = document.getElementById('pool-note');

    const productId = strainSelect?.value;
    const amount = parseFloat(amountInput?.value) || 0;
    const note = noteInput?.value.trim() || '';

    // Validation
    if (!productId) {
      // Focus on dropdown trigger
      const dropdown = document.getElementById('scanner-strain-dropdown');
      dropdown?.querySelector('.custom-select-trigger')?.focus();
      return;
    }

    if (amount <= 0) {
      amountInput?.focus();
      return;
    }

    // Convert amount to grams if needed
    let amountGrams = amount;
    if (currentUnit === 'lbs') {
      amountGrams = amount * 453.592;
    }

    // Get current pool value for optimistic update
    const poolValueGramsEl = document.getElementById('current-pool-value-grams');
    const poolValueLbsEl = document.getElementById('current-pool-value-lbs');
    const currentValue = parseFloat(poolValueGramsEl.textContent.replace(/,/g, '')) || 0;

    // Calculate optimistic new value
    let optimisticNewValue;
    if (currentOperation === 'add') {
      optimisticNewValue = currentValue + amountGrams;
    } else if (currentOperation === 'subtract') {
      optimisticNewValue = Math.max(0, currentValue - amountGrams);
    } else {
      optimisticNewValue = amountGrams;
    }

    // Update UI instantly (optimistic) - both grams and lbs
    poolValueGramsEl.textContent = optimisticNewValue.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    poolValueLbsEl.textContent = (optimisticNewValue / 453.592).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Update cached product data
    const product = poolProducts.find(p => p.id === productId);
    if (product) {
      product.poolValue = optimisticNewValue;
    }

    // Show optimistic result immediately
    displayUpdateResult({
      previousValue: currentValue,
      changeAmount: currentOperation === 'subtract' ? -amountGrams : amountGrams,
      newValue: optimisticNewValue,
      operation: currentOperation
    });

    // Clear inputs immediately
    amountInput.value = '';
    noteInput.value = '';

    // Hide preview
    const previewDiv = document.getElementById('pool-preview');
    if (previewDiv) previewDiv.style.display = 'none';

    // Call Pool API to update pool (in background)
    try {
      updateBtn.disabled = true;
      updateBtn.textContent = LABELS[currentLang].updating || 'Updating...';

      const response = await fetch(`${POOL_API_URL}?action=update_pool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          operation: currentOperation,
          amount: amountGrams,
          note,
          poolType: currentPoolType
        })
      });

      const result = await response.json();

      if (result.success) {
        // Update with actual server value (in case it differs)
        const actualNewValue = result.newValue || result.data?.newValue || optimisticNewValue;
        poolValueGramsEl.textContent = actualNewValue.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        poolValueLbsEl.textContent = (actualNewValue / 453.592).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        // Update cached product with actual value
        if (product) {
          product.poolValue = actualNewValue;
        }

        // Update result display with actual values
        displayUpdateResult({
          previousValue: result.previousValue || result.data?.previousValue || currentValue,
          changeAmount: result.changeAmount || result.data?.changeAmount || (currentOperation === 'subtract' ? -amountGrams : amountGrams),
          newValue: actualNewValue,
          operation: currentOperation
        });

        // Reload recent changes (background, non-blocking)
        loadRecentChanges();

        // Reset button
        setTimeout(() => {
          updateBtn.textContent = LABELS[currentLang].updatePool || 'Update Pool';
          updateBtn.disabled = false;
        }, 1500);
      } else {
        throw new Error(result.error || 'Failed to update pool');
      }
    } catch (error) {
      console.error('Pool update error:', error);

      // Revert optimistic update on error
      poolValueEl.textContent = currentValue.toLocaleString('en-US', { minimumFractionDigits: 1 });
      if (product) {
        product.poolValue = currentValue;
      }

      updateBtn.textContent = '✗ Error';
      setTimeout(() => {
        updateBtn.textContent = LABELS[currentLang].updatePool || 'Update Pool';
        updateBtn.disabled = false;
      }, 2000);
    }
  });
}

/**
 * Display pool update result
 */
function displayUpdateResult(result) {
  const resultEl = document.getElementById('pool-update-result');
  const previousEl = document.getElementById('result-previous');
  const changeEl = document.getElementById('result-change');
  const changeLabelEl = document.getElementById('result-change-label');
  const newEl = document.getElementById('result-new');

  if (!resultEl) return;

  // Set values
  previousEl.textContent = `${result.previousValue}g`;
  newEl.textContent = `${result.newValue}g`;

  // Set change with appropriate label and sign
  const changeAmount = result.changeAmount;
  const changeSign = result.operation === 'subtract' ? '-' : '+';
  changeEl.textContent = `${changeSign}${Math.abs(changeAmount)}g`;

  // Update change label based on operation
  if (result.operation === 'add') {
    changeLabelEl.textContent = LABELS[currentLang].added || 'Added:';
  } else if (result.operation === 'subtract') {
    changeLabelEl.textContent = LABELS[currentLang].subtracted || 'Subtracted:';
  } else {
    changeLabelEl.textContent = LABELS[currentLang].changed || 'Changed:';
  }

  // Show result
  resultEl.style.display = 'block';

  // Hide after 5 seconds
  setTimeout(() => {
    resultEl.style.display = 'none';
  }, 5000);
}

/**
 * Initialize recent changes section
 */
function initRecentChanges() {
  const refreshBtn = document.getElementById('refresh-history-btn');
  if (refreshBtn) {
    registerListener(refreshBtn, 'click', () => loadRecentChanges());
  }

  // Load initial changes
  loadRecentChanges();
}

/**
 * Load recent changes from Pool API
 */
async function loadRecentChanges() {
  const listEl = document.getElementById('recent-changes-list');
  if (!listEl) return;

  try {
    const response = await fetch(`${POOL_API_URL}?action=get_recent_changes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        count: 10
      })
    });

    const result = await response.json();
    const entries = result.entries || [];

    if (entries.length === 0) {
      listEl.innerHTML = `<div class="no-changes">${LABELS[currentLang].noChangesYet || 'No changes yet'}</div>`;
      return;
    }

    // Build HTML for entries
    listEl.innerHTML = entries.map((entry) => {
      const timestamp = new Date(entry.timestamp).toLocaleString();
      const actionClass = entry.action === 'add' ? 'add' : entry.action === 'subtract' ? 'subtract' : 'set';
      const actionLabel = entry.action === 'add' ? '+' : entry.action === 'subtract' ? '-' : '=';

      return `
        <div class="change-entry">
          <div class="change-entry-header">
            <span class="change-entry-product">${escapeHtml(entry.productTitle)}</span>
            <span class="change-entry-timestamp">${timestamp}</span>
          </div>
          <div class="change-entry-details">
            <span class="change-entry-action ${actionClass}">${actionLabel}${entry.changeAmount}g</span>
            <span>→</span>
            <span>${entry.newValue}g</span>
          </div>
          ${entry.note ? `<div class="change-entry-note">${escapeHtml(entry.note)}</div>` : ''}
        </div>
      `;
    }).join('');

  } catch (error) {
    console.error('Failed to load recent changes:', error);
    listEl.innerHTML = `<div class="no-changes">Error loading changes</div>`;
  }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===================
// BAG TIMER (Scoreboard-style circular progress)
// ===================

let bagTimerInterval = null;
let bagTimerTickInterval = null;
let scaleInterval = null;
let lastBagTimestamp = null;
let timerTargetSeconds = 90 * 60; // Default 90 min target
let timerAvgSeconds = 0;
let timerIsPaused = false;
let timerPauseReason = '';
let timerPauseStartTime = null; // When pause started (for freezing timer)
let timerBagsToday = 0;
let lastKnownVersion = null; // For smart polling
let manualShiftStart = null; // Manual shift start time (synced from server)

// SVG constants (matching scoreboard)
const RING_CIRCUMFERENCE = 2 * Math.PI * 95; // 597

// ===================
// SCALE WEIGHT (Live scale circle above bag timer)
// ===================

/**
 * Initialize scale polling (called from initBagTimer)
 */
function initScale() {
  loadScaleData(); // Initial load
  scaleInterval = setInterval(loadScaleData, 1000); // 1-second polling
}

/**
 * Fetch scale weight from API and render
 */
async function loadScaleData() {
  try {
    const response = await fetch(`${API_URL}?action=scaleWeight`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    const data = result.data || result;
    renderScale(data);
  } catch (error) {
    // Show stale state on error
    renderScale(null);
  }
}

/**
 * Render scale weight display (circular ring)
 * @param {Object|null} scaleData - Scale data from API
 */
function renderScale(scaleData) {
  const statusDot = document.getElementById('scaleStatusDot');
  const weightEl = document.getElementById('scaleWeight');
  const scaleLabel = document.getElementById('scaleWeightLabel');
  const scaleRing = document.getElementById('scaleRing');

  if (!scaleData) {
    if (statusDot) {
      statusDot.classList.remove('connected');
      statusDot.classList.add('stale');
    }
    if (weightEl) {
      weightEl.textContent = '—';
      weightEl.className = 'scale-value stale';
    }
    if (scaleLabel) {
      const ofLabel = LABELS[currentLang]?.scaleOf || 'of';
      scaleLabel.textContent = `${ofLabel} 5.0 kg`;
    }
    if (scaleRing) {
      scaleRing.style.strokeDashoffset = RING_CIRCUMFERENCE;
      scaleRing.setAttribute('class', 'scale-ring-progress stale');
    }
    return;
  }

  const weight = scaleData.weight || 0;
  const targetWeight = scaleData.targetWeight || 5.0;
  const percent = scaleData.percentComplete || 0;
  const isStale = scaleData.isStale !== false;

  // Determine color state
  let colorClass = 'filling';
  if (isStale) {
    colorClass = 'stale';
  } else if (percent >= 100) {
    colorClass = 'at-target';
  } else if (percent >= 90) {
    colorClass = 'near-target';
  }

  // Update status dot
  if (statusDot) {
    statusDot.classList.toggle('connected', !isStale);
    statusDot.classList.toggle('stale', isStale);
  }

  // Update weight value
  if (weightEl) {
    weightEl.textContent = isStale ? '—' : weight.toFixed(2) + ' kg';
    weightEl.className = 'scale-value ' + colorClass;
  }

  // Update label
  if (scaleLabel) {
    const ofLabel = LABELS[currentLang]?.scaleOf || 'of';
    scaleLabel.textContent = `${ofLabel} ${targetWeight.toFixed(1)} kg`;
  }

  // Update circular ring progress
  if (scaleRing) {
    const progress = isStale ? 0 : Math.min(1, percent / 100);
    const offset = RING_CIRCUMFERENCE * (1 - progress);
    scaleRing.style.strokeDashoffset = offset;
    scaleRing.setAttribute('class', 'scale-ring-progress ' + colorClass);
  }
}

// Break schedule (PST) - must match scoreboard config
const TIMER_BREAKS = [
  [9, 0, 9, 10],      // 9:00-9:10 AM morning break
  [12, 0, 12, 30],    // 12:00-12:30 PM lunch
  [14, 30, 14, 40],   // 2:30-2:40 PM afternoon break
  [16, 20, 16, 30],   // 4:20-4:30 PM cleanup
];

// Workday boundaries
const WORKDAY_START_MINUTES = 7 * 60;  // 7:00 AM
const WORKDAY_END_MINUTES = 16 * 60 + 30;  // 4:30 PM

/**
 * Get today's shift start time
 * Checks localStorage first (shared with scoreboard), falls back to 7 AM
 * @returns {Date} Today at shift start time
 */
function getShiftStartTime() {
  // Check localStorage for manual shift start (shared with scoreboard)
  const savedStart = localStorage.getItem('manualShiftStart');
  const savedDate = localStorage.getItem('shiftStartDate');
  const today = new Date().toDateString();

  if (savedStart && savedDate === today) {
    const startTime = new Date(savedStart);
    if (startTime.toDateString() === today) {
      return startTime;
    }
  }

  // Default: 7:00 AM today
  const defaultStart = new Date();
  defaultStart.setHours(7, 0, 0, 0);
  return defaultStart;
}

/**
 * Check if currently on break or outside work hours
 * @returns {Object} { onBreak: boolean, afterHours: boolean }
 */
function isOnBreakOrAfterHours() {
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  // Before workday
  if (nowMins < WORKDAY_START_MINUTES) {
    return { onBreak: true, afterHours: true };
  }

  // After workday
  if (nowMins >= WORKDAY_END_MINUTES) {
    return { onBreak: true, afterHours: true };
  }

  // Check scheduled breaks
  for (const brk of TIMER_BREAKS) {
    const bStart = brk[0] * 60 + brk[1];
    const bEnd = brk[2] * 60 + brk[3];
    if (nowMins >= bStart && nowMins < bEnd) {
      return { onBreak: true, afterHours: false };
    }
  }

  return { onBreak: false, afterHours: false };
}

/**
 * Get shift end time for a given date
 * @param {Date} date - The date to get shift end for
 * @returns {Date} Shift end time (4:30 PM)
 */
function getShiftEndTime(date) {
  const shiftEnd = new Date(date);
  shiftEnd.setHours(16, 30, 0, 0); // 4:30 PM
  return shiftEnd;
}

/**
 * Calculate working seconds from a previous day's timestamp, carrying over to today
 * Used when a bag was not finished before shift ended yesterday
 * @param {Date} startTime - The timestamp from a previous day
 * @returns {number} Total working seconds (yesterday's remainder + today's elapsed)
 */
function getWorkingSecondsCarryOver(startTime) {
  if (!startTime) return 0;

  const now = new Date();
  const startDate = new Date(startTime);

  // Get yesterday's shift end
  const yesterdayShiftEnd = getShiftEndTime(startDate);

  // Calculate working seconds from lastBag to end of that day's shift
  // (only if lastBag was before shift end)
  let yesterdayRemaining = 0;
  if (startTime < yesterdayShiftEnd) {
    // Time from lastBag to shift end, excluding any breaks in between
    const startMins = startDate.getHours() * 60 + startDate.getMinutes();
    const endMins = WORKDAY_END_MINUTES;

    yesterdayRemaining = (endMins - startMins) * 60;

    // Subtract breaks that occurred between lastBag and shift end
    for (const brk of TIMER_BREAKS) {
      const bStart = brk[0] * 60 + brk[1];
      const bEnd = brk[2] * 60 + brk[3];

      if (startMins < bEnd && endMins > bStart) {
        const overlapStart = Math.max(startMins, bStart);
        const overlapEnd = Math.min(endMins, bEnd);
        if (overlapEnd > overlapStart) {
          yesterdayRemaining -= (overlapEnd - overlapStart) * 60;
        }
      }
    }
  }

  // Add today's working seconds from shift start to now
  const todayShiftStart = new Date(now);
  todayShiftStart.setHours(Math.floor(WORKDAY_START_MINUTES / 60), WORKDAY_START_MINUTES % 60, 0, 0);
  const todayElapsed = getWorkingSecondsSinceInternal(todayShiftStart);

  return Math.max(0, yesterdayRemaining + todayElapsed);
}

/**
 * Internal helper: Calculate working seconds since startTime (same day only)
 * @param {Date} startTime - The start time
 * @returns {number} Working seconds elapsed
 */
function getWorkingSecondsSinceInternal(startTime) {
  if (!startTime) return 0;

  const now = new Date();

  // If different day, return 0
  if (startTime.toDateString() !== now.toDateString()) {
    return 0;
  }

  const nowMins = now.getHours() * 60 + now.getMinutes();

  // Check if we're currently ON a break
  let currentlyOnBreak = false;
  let currentBreakStart = 0;

  for (const brk of TIMER_BREAKS) {
    const bStart = brk[0] * 60 + brk[1];
    const bEnd = brk[2] * 60 + brk[3];
    if (nowMins >= bStart && nowMins < bEnd) {
      currentlyOnBreak = true;
      currentBreakStart = bStart;
      break;
    }
  }

  // If currently on break, calculate elapsed time up to break start
  let endTime;
  if (currentlyOnBreak) {
    endTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
      Math.floor(currentBreakStart / 60), currentBreakStart % 60, 0);
  } else {
    endTime = now;
  }

  let totalSecs = Math.floor((endTime - startTime) / 1000);
  const startMins = startTime.getHours() * 60 + startTime.getMinutes();
  const endMins = endTime.getHours() * 60 + endTime.getMinutes();

  // Subtract time spent on COMPLETED breaks (not current break)
  for (const brk of TIMER_BREAKS) {
    const bStart = brk[0] * 60 + brk[1];
    const bEnd = brk[2] * 60 + brk[3];

    // Skip the current break (already handled above)
    if (currentlyOnBreak && bStart === currentBreakStart) {
      continue;
    }

    // If timer span includes this break, subtract it
    if (startMins < bEnd && endMins > bStart) {
      const overlapStart = Math.max(startMins, bStart);
      const overlapEnd = Math.min(endMins, bEnd);
      if (overlapEnd > overlapStart) {
        totalSecs -= (overlapEnd - overlapStart) * 60;
      }
    }
  }

  return Math.max(0, totalSecs);
}

/**
 * Calculate working seconds since startTime, excluding breaks
 * Handles both same-day and carryover (previous day) scenarios
 * This matches the scoreboard's getWorkingSecondsSince() function
 * @param {Date} startTime - The start time
 * @returns {number} Working seconds elapsed
 */
function getWorkingSecondsSince(startTime) {
  if (!startTime) return 0;

  const now = new Date();

  // Check if lastBag is from a previous day (carryover scenario)
  if (startTime.toDateString() !== now.toDateString()) {
    // Use carryover calculation for bags started yesterday
    return getWorkingSecondsCarryOver(startTime);
  }

  const nowMins = now.getHours() * 60 + now.getMinutes();

  // Check if we're currently ON a break
  let currentlyOnBreak = false;
  let currentBreakStart = 0;

  for (const brk of TIMER_BREAKS) {
    const bStart = brk[0] * 60 + brk[1];
    const bEnd = brk[2] * 60 + brk[3];
    if (nowMins >= bStart && nowMins < bEnd) {
      currentlyOnBreak = true;
      currentBreakStart = bStart;
      break;
    }
  }

  // If currently on break, calculate elapsed time up to break start
  let endTime;
  if (currentlyOnBreak) {
    endTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
      Math.floor(currentBreakStart / 60), currentBreakStart % 60, 0);
  } else {
    endTime = now;
  }

  let totalSecs = Math.floor((endTime - startTime) / 1000);
  const startMins = startTime.getHours() * 60 + startTime.getMinutes();
  const endMins = endTime.getHours() * 60 + endTime.getMinutes();

  // Subtract time spent on COMPLETED breaks (not current break)
  for (const brk of TIMER_BREAKS) {
    const bStart = brk[0] * 60 + brk[1];
    const bEnd = brk[2] * 60 + brk[3];

    // Skip the current break (already handled above)
    if (currentlyOnBreak && bStart === currentBreakStart) {
      continue;
    }

    // If timer span includes this break, subtract it
    if (startMins < bEnd && endMins > bStart) {
      const overlapStart = Math.max(startMins, bStart);
      const overlapEnd = Math.min(endMins, bEnd);
      if (overlapEnd > overlapStart) {
        totalSecs -= (overlapEnd - overlapStart) * 60;
      }
    }
  }

  return Math.max(0, totalSecs);
}

/**
 * Initialize bag timer card
 */
function initBagTimer() {
  loadBagTimerData(); // Initial full load
  // Smart polling: check version every 5 seconds, only fetch data if changed
  bagTimerInterval = setInterval(checkBagTimerVersion, 3000);
  // Update countdown every second
  bagTimerTickInterval = setInterval(updateBagTimerTick, 1000);
  // Start scale polling
  initScale();
}

/**
 * Smart polling: Check version endpoint first, only fetch full data if changed
 * This reduces API calls by ~90% when data is static (matches scoreboard pattern)
 */
async function checkBagTimerVersion() {
  try {
    const response = await fetch(`${API_URL}?action=version`);
    if (!response.ok) {
      // Version endpoint failed, fall back to full fetch
      loadBagTimerData();
      return;
    }

    const result = await response.json();
    const data = result.data || result;
    const currentVersion = data.version;

    // First check or version changed - fetch full data
    if (lastKnownVersion === null || currentVersion !== lastKnownVersion) {
      lastKnownVersion = currentVersion;
      loadBagTimerData();
    }
    // Version same - no need to fetch, data hasn't changed
  } catch (error) {
    console.error('Version check failed, falling back to data load:', error);
    // On error, try full load as fallback
    loadBagTimerData();
  }
}

/**
 * Load bag timer data from scoreboard API
 */
async function loadBagTimerData() {
  try {
    const response = await fetch(`${API_URL}?action=scoreboard`);

    // Handle rate limiting gracefully
    if (response.status === 429) {
      console.warn('Rate limited, will retry on next interval');
      return; // Don't update UI, keep current data
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    const data = result.data || result;

    const timer = data.timer || {};

    // Store bags today count
    timerBagsToday = timer.bagsToday || 0;
    const bagsTodayEl = document.getElementById('bags-today');
    if (bagsTodayEl) {
      bagsTodayEl.textContent = timerBagsToday;
    }

    // Store last bag timestamp for countdown
    if (timer.lastBagTime) {
      lastBagTimestamp = new Date(timer.lastBagTime);
    } else {
      lastBagTimestamp = null;
    }

    // Store target and avg seconds (use explicit check - 0 is valid, not falsy default)
    timerTargetSeconds = typeof timer.targetSeconds === 'number' ? timer.targetSeconds : 90 * 60;
    timerAvgSeconds = timer.avgSecondsToday || 0;

    // Update target time and trimmers display
    const targetTimeEl = document.getElementById('timer-target-time');
    const trimmersEl = document.getElementById('timer-trimmers');
    if (targetTimeEl) {
      targetTimeEl.textContent = timerTargetSeconds > 0 ? formatTimeMMSS(timerTargetSeconds) : '--:--';
    }
    if (trimmersEl) {
      trimmersEl.textContent = timer.currentTrimmers || 0;
    }

    // Sync pause state from server (cross-device sync - matches scoreboard)
    const pauseData = data.pause;
    if (pauseData && pauseData.isPaused) {
      timerIsPaused = true;
      timerPauseReason = pauseData.pauseReason || 'Unknown';
      timerPauseStartTime = pauseData.pauseStartTime ? new Date(pauseData.pauseStartTime) : new Date();
    } else {
      timerIsPaused = false;
      timerPauseReason = '';
      timerPauseStartTime = null;
    }

    // Update Avg Today stat
    updateAvgTodayStat(timerAvgSeconds);

    // Update vs Target stat
    updateVsTargetStat(timerAvgSeconds, timerTargetSeconds);

    // Initial render
    updateBagTimerTick();

  } catch (error) {
    console.error('Failed to load bag timer data:', error);
  }
}

/**
 * Update timer tick (called every second)
 * Uses break-adjusted time calculation to match scoreboard
 */
function updateBagTimerTick() {
  const timerValue = document.getElementById('bag-timer-value');
  const timerLabel = document.getElementById('timerLabel');
  const timerRing = document.getElementById('timerRing');

  if (!timerValue) return;

  // Check break/after hours status (matches scoreboard logic)
  const breakStatus = isOnBreakOrAfterHours();

  // If manually paused (synced from server), show paused state
  if (timerIsPaused) {
    setTimerColor('yellow');
    // Show frozen time during pause (subtract pause duration to freeze at pause start)
    if (lastBagTimestamp) {
      let elapsedSeconds = getWorkingSecondsSince(lastBagTimestamp);
      // Subtract time since pause started to freeze the timer
      if (timerPauseStartTime) {
        const pauseDuration = Math.floor((new Date() - timerPauseStartTime) / 1000);
        elapsedSeconds = Math.max(0, elapsedSeconds - pauseDuration);
      }
      const remainingSeconds = Math.max(0, timerTargetSeconds - elapsedSeconds);
      timerValue.textContent = formatTimeMMSS(remainingSeconds);
      setRingProgress(Math.min(1, elapsedSeconds / timerTargetSeconds));
    } else {
      timerValue.textContent = '--:--';
    }
    timerLabel.textContent = currentLang === 'es' ? 'PAUSADO' : 'PAUSED';
    return;
  }

  // If on break or after hours, show break state
  if (breakStatus.onBreak) {
    setTimerColor('yellow');
    if (breakStatus.afterHours) {
      timerValue.textContent = '--:--';
      timerLabel.textContent = currentLang === 'es' ? 'Turno terminado' : 'Shift ended';
    } else {
      // During break, show frozen time (time remaining when break started)
      if (lastBagTimestamp) {
        const elapsedSeconds = getWorkingSecondsSince(lastBagTimestamp);
        const remainingSeconds = Math.max(0, timerTargetSeconds - elapsedSeconds);
        timerValue.textContent = formatTimeMMSS(remainingSeconds);
      } else {
        timerValue.textContent = '--:--';
      }
      timerLabel.textContent = LABELS[currentLang].onBreak;
    }
    // Keep ring at current position during break
    if (lastBagTimestamp) {
      const elapsedSeconds = getWorkingSecondsSince(lastBagTimestamp);
      setRingProgress(Math.min(1, elapsedSeconds / timerTargetSeconds));
    }
    return;
  }

  // Calculate elapsed seconds - use lastBagTimestamp if available, otherwise shift start
  let elapsedSeconds = 0;
  const referenceTime = lastBagTimestamp || getShiftStartTime();

  // Check if reference is from today or previous day
  const isToday = referenceTime.toDateString() === new Date().toDateString();
  const isPreviousDay = !isToday && referenceTime < new Date();

  if (isToday) {
    elapsedSeconds = getWorkingSecondsSinceInternal(referenceTime);
  } else if (isPreviousDay) {
    // Carryover from previous day
    elapsedSeconds = getWorkingSecondsCarryOver(referenceTime);
  } else {
    // Future date or invalid - use shift start
    elapsedSeconds = getWorkingSecondsSinceInternal(getShiftStartTime());
  }

  // Determine if we have a valid target
  const hasTarget = timerTargetSeconds > 0;

  // Calculate remaining time (only meaningful if we have a target)
  const remainingSeconds = hasTarget ? timerTargetSeconds - elapsedSeconds : 0;
  const isOvertime = hasTarget && remainingSeconds < 0;

  // Determine color based on state (matches scoreboard)
  let color = 'green';
  if (isOvertime) {
    color = 'red';
  }

  setTimerColor(color);

  // Format display based on whether we have a target
  if (hasTarget) {
    if (!isOvertime) {
      // Show remaining time
      timerValue.textContent = formatTimeMMSS(remainingSeconds);
      timerLabel.textContent = LABELS[currentLang].remaining;
    } else {
      // Overtime - show how much over
      timerValue.textContent = '+' + formatTimeMMSS(Math.abs(remainingSeconds));
      timerLabel.textContent = currentLang === 'es' ? 'excedido' : 'overtime';
    }
  } else {
    // No target - show elapsed time since shift start or last bag
    timerValue.textContent = formatTimeMMSS(elapsedSeconds);
    timerLabel.textContent = currentLang === 'es' ? 'transcurrido' : 'elapsed';
  }

  // Update ring progress
  // When no target, show minimal progress; when overtime, show full ring
  let progress = 0;
  if (hasTarget) {
    progress = isOvertime ? 1 : Math.min(1, elapsedSeconds / timerTargetSeconds);
  }
  setRingProgress(progress);
}

/**
 * Format seconds as M:SS (matches scoreboard format - no hour conversion)
 */
function formatTimeMMSS(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Set timer color (green, yellow, red)
 */
function setTimerColor(color) {
  const timerValue = document.getElementById('bag-timer-value');
  const timerRing = document.getElementById('timerRing');
  const timerCard = document.querySelector('.card-timer');

  if (timerValue) {
    timerValue.classList.remove('green', 'yellow', 'red');
    timerValue.classList.add(color);
  }

  if (timerRing) {
    timerRing.classList.remove('green', 'yellow', 'red');
    timerRing.classList.add(color);
  }

  // Update card background gradient
  if (timerCard) {
    timerCard.classList.remove('timer-green', 'timer-yellow', 'timer-red', 'timer-neutral');
    timerCard.classList.add(`timer-${color}`);
  }
}

/**
 * Set ring progress (0 to 1)
 */
function setRingProgress(progress) {
  const timerRing = document.getElementById('timerRing');
  if (!timerRing) return;

  // Progress ring fills from 0 to full
  const offset = RING_CIRCUMFERENCE * (1 - progress);
  timerRing.style.strokeDashoffset = offset;
}

/**
 * Update Avg Today stat
 */
function updateAvgTodayStat(avgSeconds) {
  const avgEl = document.getElementById('avg-today');
  if (!avgEl) return;

  if (avgSeconds > 0) {
    const minutes = Math.floor(avgSeconds / 60);
    const secs = avgSeconds % 60;
    avgEl.textContent = `${minutes}:${String(secs).padStart(2, '0')}`;
  } else {
    avgEl.textContent = '--:--';
  }
}

/**
 * Update vs Target stat
 */
function updateVsTargetStat(avgSeconds, targetSeconds) {
  const vsEl = document.getElementById('vs-target');
  if (!vsEl) return;

  // Remove existing classes
  vsEl.classList.remove('on-track', 'behind');

  if (avgSeconds <= 0) {
    vsEl.textContent = '—';
    return;
  }

  const diffSeconds = avgSeconds - targetSeconds;
  const diffMinutes = Math.abs(Math.floor(diffSeconds / 60));

  if (diffSeconds <= 0) {
    // Ahead or on target
    vsEl.textContent = diffMinutes > 0 ? `-${diffMinutes}m` : '✓';
    vsEl.classList.add('on-track');
  } else {
    // Behind
    vsEl.textContent = `+${diffMinutes}m`;
    vsEl.classList.add('behind');
  }
}

// Cleanup bag timer and scale on page unload
window.addEventListener('beforeunload', () => {
  if (bagTimerInterval) clearInterval(bagTimerInterval);
  if (bagTimerTickInterval) clearInterval(bagTimerTickInterval);
  if (scaleInterval) clearInterval(scaleInterval);
});

// Initialize barcode and timer after cultivars load
const originalLoadCultivars = loadCultivars;
loadCultivars = async function () {
  await originalLoadCultivars();
  initBarcodeCard();
  initBagTimer();
};
