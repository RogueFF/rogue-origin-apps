/**
 * Utils Module
 * Safe helper functions for DOM, data access, and formatting
 */

import { workSchedule } from './config.js';

// Safe DOM element getter with warning for debugging
export function safeGetEl(id) {
  const el = document.getElementById(id);
  if (!el) console.warn(`Element not found: ${id}`);
  return el;
}

// Safe property accessor - safely access nested object properties
export function safeGet(obj, path, defaultValue) {
  if (!obj || typeof path !== 'string') return defaultValue;
  const keys = path.split('.');
  let result = obj;
  for (let i = 0; i < keys.length; i++) {
    if (result == null || typeof result !== 'object') return defaultValue;
    result = result[keys[i]];
  }
  return result !== undefined ? result : defaultValue;
}

// Safe number formatter - ensures number is valid before formatting
export function safeNumber(value, decimals, defaultValue) {
  if (typeof value !== 'number' || isNaN(value) || !isFinite(value)) {
    return defaultValue !== undefined ? defaultValue : '—';
  }
  return decimals !== undefined ? value.toFixed(decimals) : value;
}

// Safe chart context getter with warning for debugging
export function safeGetChartContext(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) {
    console.warn(`Canvas element not found: ${canvasId}`);
    return null;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    console.warn(`Could not get 2d context for: ${canvasId}`);
    return null;
  }
  return ctx;
}

// Calculate productive minutes elapsed based on current time and break schedule
export function getProductiveMinutesElapsed() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMin = now.getMinutes();

  // Convert current time to minutes since midnight
  const currentTimeInMin = currentHour * 60 + currentMin;
  const startTimeInMin = workSchedule.startHour * 60 + workSchedule.startMin;
  const endTimeInMin = workSchedule.endHour * 60 + workSchedule.endMin;

  // Before work starts
  if (currentTimeInMin < startTimeInMin) return 0;

  // After work ends
  if (currentTimeInMin >= endTimeInMin) return workSchedule.totalProductiveMinutes;

  // Calculate raw minutes elapsed since start
  const rawMinutesElapsed = currentTimeInMin - startTimeInMin;

  // Subtract break time that has passed
  let breakMinutesPassed = 0;
  workSchedule.breaks.forEach(function(b) {
    const breakStartInMin = b.hour * 60 + b.min;
    const breakEndInMin = breakStartInMin + b.duration;

    if (currentTimeInMin >= breakEndInMin) {
      // Break is fully over
      breakMinutesPassed += b.duration;
    } else if (currentTimeInMin > breakStartInMin) {
      // Currently in break
      breakMinutesPassed += (currentTimeInMin - breakStartInMin);
    }
  });

  return Math.max(0, rawMinutesElapsed - breakMinutesPassed);
}

export function getProductiveHoursElapsed() {
  return getProductiveMinutesElapsed() / 60;
}

export function getTotalProductiveHours() {
  return workSchedule.totalProductiveMinutes / 60; // 8.5 hours
}

// Format date for input fields (YYYY-MM-DD)
export function formatDateInput(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Format date for display (short format)
export function formatDateShort(s) {
  const parts = s.split('-');
  const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Format time for clock display
export function formatTime(date) {
  const hours = date.getHours() % 12 || 12;
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = date.getHours() >= 12 ? 'PM' : 'AM';
  return `${hours}:${minutes} ${ampm}`;
}

// Format full date for display
export function formatFullDate(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

// Format long date with year
export function formatLongDate(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

// Debounce function
export function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Throttle function
export function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// Animate number values
export function animateValue(id, start, end, duration) {
  const el = document.getElementById(id);
  if (!el) return;

  el.classList.add('animate-value');
  let startTime = null;
  const isDecimal = String(end).includes('.') || end % 1 !== 0;

  function step(timestamp) {
    if (!startTime) startTime = timestamp;
    const progress = Math.min((timestamp - startTime) / duration, 1);
    const current = start + (end - start) * progress;
    el.textContent = isDecimal ? current.toFixed(2) : Math.floor(current);
    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

// Get greeting based on time of day
export function getTimeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// Deep clone object
export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Check if object is empty
export function isEmpty(obj) {
  return obj == null || (typeof obj === 'object' && Object.keys(obj).length === 0);
}

// Generate unique ID
export function generateId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).substr(2, 9)}`;
}
