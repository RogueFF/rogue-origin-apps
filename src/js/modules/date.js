/**
 * Date Module
 * Handles date range selection and comparison functionality
 */

import {
  formatDateInput,
  formatDateShort,
  formatTime,
  formatFullDate,
  getTimeGreeting
} from './utils.js';

import {
  setCurrentRange,
  setCustomDates,
  setCompareMode,
  getCurrentRange,
  getCompareMode,
  setCompareData
} from './state.js';

// Callback functions for data loading (set by main app)
let loadDataCallback = null;
let loadCompareDataCallback = null;

/**
 * Set callback functions for data loading
 * @param {Function} loadData - Function to load regular data
 * @param {Function} loadCompareData - Function to load comparison data
 */
export function setDataCallbacks(loadData, loadCompareData) {
  loadDataCallback = loadData;
  loadCompareDataCallback = loadCompareData;
}

/**
 * Toggle date picker dropdown visibility
 */
export function toggleDatePicker() {
  const dropdown = document.getElementById('datePickerDropdown');
  const trigger = document.getElementById('datePickerTrigger');
  if (!dropdown) return;

  dropdown.classList.toggle('open');
  const isOpen = dropdown.classList.contains('open');
  if (trigger) trigger.setAttribute('aria-expanded', isOpen);
}

/**
 * Toggle compare dropdown visibility
 */
export function toggleCompareDropdown() {
  const dropdown = document.getElementById('compareDropdown');
  const trigger = document.getElementById('compareBtn');
  if (!dropdown) return;

  dropdown.classList.toggle('open');
  const isOpen = dropdown.classList.contains('open');
  if (trigger) trigger.setAttribute('aria-expanded', isOpen);
}

/**
 * Set date range and update UI
 * @param {string} range - Range type: 'today', 'yesterday', 'week', 'month'
 */
export function setDateRange(range) {
  setCurrentRange(range);

  // Toggle active class on date chips
  document.querySelectorAll('.date-chip').forEach(function(chip) {
    chip.classList.toggle('active', chip.dataset.range === range);
  });

  const today = new Date();
  let start, end, label;

  if (range === 'today') {
    start = end = formatDateInput(today);
    label = 'Today';
  } else if (range === 'yesterday') {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    start = end = formatDateInput(yesterday);
    label = 'Yesterday';
  } else if (range === 'week') {
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - 6);
    start = formatDateInput(weekStart);
    end = formatDateInput(today);
    label = 'Last 7 Days';
  } else if (range === 'month') {
    const monthStart = new Date(today);
    monthStart.setDate(monthStart.getDate() - 29);
    start = formatDateInput(monthStart);
    end = formatDateInput(today);
    label = 'Last 30 Days';
  }

  // Update date inputs
  const startDateEl = document.getElementById('startDate');
  const endDateEl = document.getElementById('endDate');
  const datePickerLabel = document.getElementById('datePickerLabel');

  if (startDateEl) startDateEl.value = start;
  if (endDateEl) endDateEl.value = end;
  if (datePickerLabel) datePickerLabel.textContent = label;

  // Update custom dates in state
  setCustomDates(start, end);

  // Close dropdown
  const datePickerDropdown = document.getElementById('datePickerDropdown');
  if (datePickerDropdown) datePickerDropdown.classList.remove('open');

  // Load data
  const compareMode = getCompareMode();
  if (compareMode && loadCompareDataCallback) {
    loadCompareDataCallback();
  } else if (loadDataCallback) {
    loadDataCallback();
  }
}

/**
 * Apply custom date range from input fields
 */
export function applyCustomRange() {
  setCurrentRange('custom');

  // Remove active class from all date chips
  document.querySelectorAll('.date-chip').forEach(function(chip) {
    chip.classList.remove('active');
  });

  const startDateEl = document.getElementById('startDate');
  const endDateEl = document.getElementById('endDate');
  const customStart = startDateEl ? startDateEl.value : null;
  const customEnd = endDateEl ? endDateEl.value : null;

  if (!customStart || !customEnd) {
    alert('Select both dates');
    return;
  }

  setCustomDates(customStart, customEnd);

  // Update label
  const datePickerLabel = document.getElementById('datePickerLabel');
  if (datePickerLabel) {
    datePickerLabel.textContent = `${formatDateShort(customStart)} - ${formatDateShort(customEnd)}`;
  }

  // Close dropdown
  const datePickerDropdown = document.getElementById('datePickerDropdown');
  if (datePickerDropdown) datePickerDropdown.classList.remove('open');

  // Load data
  const compareMode = getCompareMode();
  if (compareMode && loadCompareDataCallback) {
    loadCompareDataCallback();
  } else if (loadDataCallback) {
    loadDataCallback();
  }
}

/**
 * Set compare mode and calculate comparison periods
 * @param {string} mode - Compare mode: 'yesterday', 'lastWeek', 'lastMonth'
 */
export function setCompare(mode) {
  setCompareMode(mode);

  // Close compare dropdown
  const compareDropdown = document.getElementById('compareDropdown');
  if (compareDropdown) compareDropdown.classList.remove('open');

  // Add active class to compare button
  const compareBtn = document.getElementById('compareBtn');
  if (compareBtn) compareBtn.classList.add('active');

  // Add compare-mode class to body
  document.body.classList.add('compare-mode');

  const today = new Date();
  let currentLabel, prevLabel, customStart, customEnd;

  if (mode === 'yesterday') {
    currentLabel = 'Today';
    prevLabel = 'Yesterday';
    customStart = customEnd = formatDateInput(today);
  } else if (mode === 'lastWeek') {
    // Start of this week (Sunday)
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    currentLabel = 'This Week';
    prevLabel = 'Last Week';
    customStart = formatDateInput(weekStart);
    customEnd = formatDateInput(today);
  } else if (mode === 'lastMonth') {
    // Start of this month
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    currentLabel = 'This Month';
    prevLabel = 'Last Month';
    customStart = formatDateInput(monthStart);
    customEnd = formatDateInput(today);
  }

  // Update custom dates in state
  setCustomDates(customStart, customEnd);

  // Update compare banner labels
  const compareCurrentEl = document.getElementById('compareCurrent');
  const comparePreviousEl = document.getElementById('comparePrevious');
  const compareBanner = document.getElementById('compareBanner');
  const datePickerLabel = document.getElementById('datePickerLabel');

  if (compareCurrentEl) compareCurrentEl.textContent = currentLabel;
  if (comparePreviousEl) comparePreviousEl.textContent = prevLabel;

  // Show compare banner
  if (compareBanner) compareBanner.classList.add('active');

  // Update date picker label
  if (datePickerLabel) {
    datePickerLabel.textContent = `${currentLabel} vs ${prevLabel}`;
  }

  // Load compare data
  if (loadCompareDataCallback) {
    loadCompareDataCallback();
  }
}

/**
 * Clear comparison mode and return to normal view
 */
export function clearCompare() {
  setCompareMode(null);
  setCompareData(null);

  // Remove active class from compare button
  const compareBtn = document.getElementById('compareBtn');
  if (compareBtn) compareBtn.classList.remove('active');

  // Remove compare-mode class from body
  document.body.classList.remove('compare-mode');

  // Hide compare banner
  const compareBanner = document.getElementById('compareBanner');
  if (compareBanner) compareBanner.classList.remove('active');

  // Update date picker label
  const datePickerLabel = document.getElementById('datePickerLabel');
  const currentRange = getCurrentRange();

  if (datePickerLabel) {
    if (currentRange === 'today') {
      datePickerLabel.textContent = 'Today';
    } else if (currentRange === 'yesterday') {
      datePickerLabel.textContent = 'Yesterday';
    } else if (currentRange === 'week') {
      datePickerLabel.textContent = 'Last 7 Days';
    } else if (currentRange === 'month') {
      datePickerLabel.textContent = 'Last 30 Days';
    } else {
      // Custom range - get dates from inputs
      const startDateEl = document.getElementById('startDate');
      const endDateEl = document.getElementById('endDate');
      if (startDateEl && endDateEl && startDateEl.value && endDateEl.value) {
        datePickerLabel.textContent = `${formatDateShort(startDateEl.value)} - ${formatDateShort(endDateEl.value)}`;
      }
    }
  }

  // Load regular data
  if (loadDataCallback) {
    loadDataCallback();
  }
}

/**
 * Update clock display
 */
export function updateClock() {
  const now = new Date();
  const clockEl = document.getElementById('clock');
  const dateDisplayEl = document.getElementById('dateDisplay');

  if (clockEl) {
    clockEl.textContent = formatTime(now);
  }

  if (dateDisplayEl) {
    dateDisplayEl.textContent = formatFullDate(now);
  }
}

/**
 * Update welcome greeting based on time of day
 */
export function updateWelcome() {
  const greeting = getTimeGreeting();
  const welcomeGreetingEl = document.getElementById('welcomeGreeting');
  const welcomeDateEl = document.getElementById('welcomeDate');

  if (welcomeGreetingEl) {
    welcomeGreetingEl.textContent = greeting;
  }

  if (welcomeDateEl) {
    const opts = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
    welcomeDateEl.textContent = new Date().toLocaleDateString('en-US', opts);
  }
}

/**
 * Calculate comparison date ranges based on mode
 * @param {string} mode - Compare mode: 'yesterday', 'lastWeek', 'lastMonth'
 * @returns {Object} Object with currentStart, currentEnd, previousStart, previousEnd
 */
export function getCompareDateRanges(mode) {
  const today = new Date();
  let cs, ce, ps, pe;

  if (mode === 'yesterday') {
    cs = ce = formatDateInput(today);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    ps = pe = formatDateInput(yesterday);
  } else if (mode === 'lastWeek') {
    // Current week (Sunday to today)
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    cs = formatDateInput(weekStart);
    ce = formatDateInput(today);

    // Previous week
    const prevWeekStart = new Date(weekStart);
    prevWeekStart.setDate(prevWeekStart.getDate() - 7);
    const prevWeekEnd = new Date(prevWeekStart);
    prevWeekEnd.setDate(prevWeekEnd.getDate() + 6);
    ps = formatDateInput(prevWeekStart);
    pe = formatDateInput(prevWeekEnd);
  } else if (mode === 'lastMonth') {
    // Current month
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    cs = formatDateInput(monthStart);
    ce = formatDateInput(today);

    // Previous month
    const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const prevMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
    ps = formatDateInput(prevMonthStart);
    pe = formatDateInput(prevMonthEnd);
  }

  return {
    currentStart: cs,
    currentEnd: ce,
    previousStart: ps,
    previousEnd: pe
  };
}
