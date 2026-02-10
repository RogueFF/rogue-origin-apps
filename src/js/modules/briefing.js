/**
 * Briefing Engine Module
 * Orchestrates content modules, scheduling, and presentation
 * Smart-speaker-style briefings with toast + TTS
 */

import TTS from './tts.js';
import BriefingToast from './toast.js';
import OperationsModule from './briefing-modules/operations.js';
import WeatherModule from './briefing-modules/weather.js';

// ===== BRIEFING ENGINE =====

const modules = {};

/**
 * Register a content module
 */
function register(name, mod) {
  modules[name] = mod;
}

/**
 * Generate briefing for a time slot
 * @param {'morning'|'midday'|'evening'} slot
 * @returns {Object} { slot, timestamp, segments[] }
 */
async function generate(slot) {
  const segments = [];

  for (const [name, mod] of Object.entries(modules)) {
    if (mod.slots.includes(slot)) {
      try {
        const segment = await mod.generate(slot);
        if (segment) {
          segments.push({ name, ...segment });
        }
      } catch (e) {
        console.warn('Briefing module error:', name, e);
      }
    }
  }

  return { slot, timestamp: new Date(), segments };
}

/**
 * Present a briefing (show toast + speak via TTS)
 */
async function present(briefing) {
  if (!briefing || !briefing.segments || briefing.segments.length === 0) {
    console.debug('Briefing: no segments to present');
    return;
  }

  // Show toast UI
  const toast = BriefingToast.show(briefing);

  // Speak if not muted
  if (!TTS.muted) {
    await TTS.speak(briefing, (segIndex) => {
      // Toast could sync segment display to TTS progress here
    });
  }
}

/**
 * Trigger briefing for a specific slot
 */
async function triggerBriefing(slot) {
  console.log(`Briefing: triggering ${slot} briefing`);
  const briefing = await generate(slot);
  await present(briefing);
}

/**
 * Determine current appropriate slot based on time
 */
function getCurrentSlot() {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const minutes = h * 60 + m;

  // morning: 7:00, midday: 12:00, evening: 16:30
  if (minutes >= 16 * 60 + 30) return 'evening';
  if (minutes >= 12 * 60) return 'midday';
  return 'morning';
}

// ===== SCHEDULER =====

const SCHEDULE = {
  morning: { hour: 7, minute: 0 },
  midday: { hour: 12, minute: 0 },
  evening: { hour: 16, minute: 30 }
};

let lastBriefing = {};
let schedulerInterval = null;
let enabled = true;

try {
  enabled = localStorage.getItem('briefing-enabled') !== 'false';
} catch { /* ignore */ }

/**
 * Check if it's time for a scheduled briefing
 */
function checkSchedule() {
  if (!enabled) return;

  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const today = now.toDateString();

  for (const [slot, time] of Object.entries(SCHEDULE)) {
    if (h === time.hour && m === time.minute && lastBriefing[slot] !== today) {
      lastBriefing[slot] = today;
      triggerBriefing(slot);
    }
  }
}

/**
 * Start the scheduler (checks every 60s)
 */
function startScheduler() {
  if (schedulerInterval) return;
  schedulerInterval = setInterval(checkSchedule, 60000);
  // Also check immediately
  checkSchedule();
}

/**
 * Stop the scheduler
 */
function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

/**
 * Enable/disable briefings
 */
function setEnabled(val) {
  enabled = !!val;
  try {
    localStorage.setItem('briefing-enabled', enabled);
  } catch { /* ignore */ }

  if (enabled) {
    startScheduler();
  } else {
    stopScheduler();
  }
}

function isEnabled() {
  return enabled;
}

/**
 * Get the schedule config (for settings display)
 */
function getSchedule() {
  return { ...SCHEDULE };
}

// ===== INITIALIZATION =====

/**
 * Initialize the briefing system
 * - Registers built-in modules
 * - Starts the scheduler
 * - Pre-loads TTS voices
 */
function init() {
  // Register built-in modules
  register('operations', OperationsModule);
  register('weather', WeatherModule);

  // Init TTS (preload voices)
  TTS.init();

  // Start scheduler if enabled
  if (enabled) {
    startScheduler();
  }

  console.log('Briefing system initialized', { enabled, muted: TTS.muted });
}

// ===== EXPORTS =====

const BriefingEngine = {
  init,
  register,
  generate,
  present,
  triggerBriefing,
  getCurrentSlot,
  startScheduler,
  stopScheduler,
  setEnabled,
  isEnabled,
  getSchedule,
  get muted() { return TTS.muted; },
  toggleMute() { return TTS.toggle(); }
};

export default BriefingEngine;
