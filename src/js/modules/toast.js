/**
 * Briefing Toast Module — Rich toast notifications for briefing system
 * Distinct from the simple showToast() utility; this handles multi-segment briefings
 * with controls, progress, and TTS integration.
 */

import TTS from './tts.js';

let activeToast = null;
let dismissTimer = null;

/**
 * Create the toast container if it doesn't exist
 */
function getContainer() {
  let container = document.getElementById('briefingToastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'briefingToastContainer';
    container.className = 'briefing-toast-container';
    document.body.appendChild(container);
  }
  return container;
}

/**
 * Format time as "7:00 AM"
 */
function formatTime(date) {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * Build the slot label
 */
function slotLabel(slot) {
  const labels = { morning: 'Morning Briefing', midday: 'Midday Update', evening: 'Evening Wrap' };
  return labels[slot] || 'Briefing';
}

/**
 * Show a briefing as a rich toast notification
 * @param {Object} briefing - { slot, timestamp, segments: [{ name, title, html, text, priority }] }
 * @returns {{ element, dismiss }}
 */
function show(briefing) {
  // Dismiss any existing briefing toast
  if (activeToast) dismiss();

  const container = getContainer();
  const segments = [...briefing.segments].sort((a, b) => (a.priority || 99) - (b.priority || 99));
  let currentIndex = 0;

  // Build toast element
  const toast = document.createElement('div');
  toast.className = 'briefing-toast';
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'polite');

  // Header
  const header = document.createElement('div');
  header.className = 'briefing-toast-header';

  const titleEl = document.createElement('div');
  titleEl.className = 'briefing-toast-title';
  titleEl.textContent = slotLabel(briefing.slot);

  const timeEl = document.createElement('div');
  timeEl.className = 'briefing-toast-time';
  timeEl.textContent = formatTime(briefing.timestamp);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'briefing-toast-close';
  closeBtn.setAttribute('aria-label', 'Dismiss briefing');
  closeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  closeBtn.onclick = () => dismiss();

  header.appendChild(titleEl);
  header.appendChild(timeEl);
  header.appendChild(closeBtn);

  // Progress dots (if multiple segments)
  let dotsEl = null;
  if (segments.length > 1) {
    dotsEl = document.createElement('div');
    dotsEl.className = 'briefing-toast-dots';
    for (let i = 0; i < segments.length; i++) {
      const dot = document.createElement('span');
      dot.className = 'briefing-toast-dot' + (i === 0 ? ' active' : '');
      dotsEl.appendChild(dot);
    }
  }

  // Body
  const body = document.createElement('div');
  body.className = 'briefing-toast-body';

  // Segment title
  const segTitle = document.createElement('div');
  segTitle.className = 'briefing-toast-seg-title';

  // Segment content
  const segContent = document.createElement('div');
  segContent.className = 'briefing-toast-seg-content';

  body.appendChild(segTitle);
  body.appendChild(segContent);

  // Controls
  const controls = document.createElement('div');
  controls.className = 'briefing-toast-controls';

  const muteBtn = document.createElement('button');
  muteBtn.className = 'briefing-toast-btn' + (TTS.muted ? '' : ' active');
  muteBtn.innerHTML = TTS.muted
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg> Muted'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg> Audio';
  muteBtn.onclick = () => {
    const nowMuted = TTS.toggle();
    muteBtn.className = 'briefing-toast-btn' + (nowMuted ? '' : ' active');
    muteBtn.innerHTML = nowMuted
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg> Muted'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg> Audio';
    resetDismissTimer();
  };

  const replayBtn = document.createElement('button');
  replayBtn.className = 'briefing-toast-btn';
  replayBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg> Replay';
  replayBtn.onclick = () => {
    TTS.stop();
    TTS.speak(briefing, (i) => showSegment(i));
    resetDismissTimer();
  };

  let skipBtn = null;
  if (segments.length > 1) {
    skipBtn = document.createElement('button');
    skipBtn.className = 'briefing-toast-btn';
    skipBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg> Next';
    skipBtn.onclick = () => {
      if (currentIndex < segments.length - 1) {
        TTS.stop();
        showSegment(currentIndex + 1);
        // Speak just the remaining segments
        const remaining = { ...briefing, segments: segments.slice(currentIndex + 1) };
        if (!TTS.muted) TTS.speak(remaining);
      }
      resetDismissTimer();
    };
  }

  controls.appendChild(muteBtn);
  controls.appendChild(replayBtn);
  if (skipBtn) controls.appendChild(skipBtn);

  // Assemble
  toast.appendChild(header);
  if (dotsEl) toast.appendChild(dotsEl);
  toast.appendChild(body);
  toast.appendChild(controls);

  container.appendChild(toast);

  // Show first segment
  function showSegment(index) {
    if (index < 0 || index >= segments.length) return;
    currentIndex = index;
    const seg = segments[index];
    segTitle.textContent = seg.title || seg.name;
    segContent.innerHTML = seg.html || seg.text || '';

    // Update dots
    if (dotsEl) {
      const dots = dotsEl.querySelectorAll('.briefing-toast-dot');
      dots.forEach((d, i) => {
        d.className = 'briefing-toast-dot' + (i === index ? ' active' : i < index ? ' done' : '');
      });
    }
  }

  showSegment(0);

  // Auto-dismiss timer
  function resetDismissTimer() {
    if (dismissTimer) clearTimeout(dismissTimer);
    const timeout = TTS.muted ? 15000 : 30000;
    dismissTimer = setTimeout(() => dismiss(), timeout);
  }
  resetDismissTimer();

  activeToast = { element: toast, dismiss };

  return activeToast;
}

/**
 * Dismiss the active briefing toast
 */
function dismiss() {
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  TTS.stop();

  if (activeToast && activeToast.element) {
    const el = activeToast.element;
    el.classList.add('dismissing');
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 300);
  }
  activeToast = null;
}

/**
 * Check if a briefing toast is currently active
 */
function isActive() {
  return !!activeToast;
}

const BriefingToast = { show, dismiss, isActive };
export default BriefingToast;
