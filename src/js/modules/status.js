/**
 * Status Module
 * Connection status bar and error state management
 * Provides subtle feedback about data freshness and connection issues
 */

import {
  isConnecting,
  getConnectionError,
  getLastSuccessfulFetch,
  setConnecting,
  setConnectionError,
  setLastSuccessfulFetch,
  incrementRetryCount,
  resetRetryCount,
  getRetryCount
} from './state.js';

// Status bar element reference
let statusBar = null;
let statusText = null;
let statusIcon = null;
let retryButton = null;
let autoHideTimer = null;

// Callback for retry action
let onRetryCallback = null;

/**
 * Initialize the status bar
 * @param {Function} retryCallback - Function to call when retry is clicked
 */
export function initStatusBar(retryCallback) {
  statusBar = document.getElementById('connectionStatus');
  statusText = document.getElementById('connectionStatusText');
  statusIcon = document.getElementById('connectionStatusIcon');
  retryButton = document.getElementById('connectionRetryBtn');
  onRetryCallback = retryCallback;

  if (retryButton && retryCallback) {
    retryButton.addEventListener('click', function(e) {
      e.preventDefault();
      if (onRetryCallback) {
        onRetryCallback();
      }
    });
  }
}

/**
 * Show connecting state
 */
export function showConnecting() {
  setConnecting(true);
  setConnectionError(null);

  if (statusBar) {
    clearAutoHide();
    statusBar.className = 'connection-status connecting';
    statusBar.classList.add('visible');
  }
  if (statusIcon) {
    statusIcon.innerHTML = '<i class="ph-duotone ph-circle-notch ph-spin"></i>';
  }
  if (statusText) {
    statusText.textContent = 'Connecting to server...';
  }
  if (retryButton) {
    retryButton.style.display = 'none';
  }
}

/**
 * Show connected/success state
 * @param {boolean} autoHide - Whether to auto-hide after delay (default: true)
 */
export function showConnected(autoHide = true) {
  setConnecting(false);
  setConnectionError(null);
  setLastSuccessfulFetch(new Date());
  resetRetryCount();

  if (statusBar) {
    statusBar.className = 'connection-status connected';
    statusBar.classList.add('visible');
  }
  if (statusIcon) {
    statusIcon.innerHTML = '<i class="ph-duotone ph-check-circle"></i>';
  }
  if (statusText) {
    const time = formatTime(new Date());
    statusText.textContent = `Last updated: ${time}`;
  }
  if (retryButton) {
    retryButton.textContent = 'Refresh';
    retryButton.style.display = 'inline-flex';
  }

  // Auto-hide after 3 seconds
  if (autoHide) {
    scheduleAutoHide(3000);
  }
}

/**
 * Show error state
 * @param {string} message - Error message to display
 */
export function showError(message) {
  setConnecting(false);
  setConnectionError(message || 'Connection failed');

  if (statusBar) {
    clearAutoHide();
    statusBar.className = 'connection-status error';
    statusBar.classList.add('visible');
  }
  if (statusIcon) {
    statusIcon.innerHTML = '<i class="ph-duotone ph-warning-circle"></i>';
  }
  if (statusText) {
    const lastFetch = getLastSuccessfulFetch();
    if (lastFetch) {
      const time = formatTime(lastFetch);
      statusText.textContent = `Connection issue • Last data: ${time}`;
    } else {
      statusText.textContent = 'Connection failed';
    }
  }
  if (retryButton) {
    retryButton.textContent = 'Retry';
    retryButton.style.display = 'inline-flex';
  }
}

/**
 * Show retrying state
 */
export function showRetrying() {
  const count = incrementRetryCount();

  if (statusBar) {
    clearAutoHide();
    statusBar.className = 'connection-status connecting';
    statusBar.classList.add('visible');
  }
  if (statusIcon) {
    statusIcon.innerHTML = '<i class="ph-duotone ph-circle-notch ph-spin"></i>';
  }
  if (statusText) {
    statusText.textContent = `Retrying... (attempt ${count})`;
  }
  if (retryButton) {
    retryButton.style.display = 'none';
  }
}

/**
 * Hide the status bar
 */
export function hideStatus() {
  if (statusBar) {
    statusBar.classList.remove('visible');
  }
}

/**
 * Schedule auto-hide of status bar
 * @param {number} delay - Delay in milliseconds
 */
function scheduleAutoHide(delay) {
  clearAutoHide();
  autoHideTimer = setTimeout(function() {
    if (statusBar && !getConnectionError()) {
      statusBar.classList.remove('visible');
    }
  }, delay);
}

/**
 * Clear auto-hide timer
 */
function clearAutoHide() {
  if (autoHideTimer) {
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }
}

/**
 * Format time for display
 * @param {Date} date - Date to format
 * @returns {string} Formatted time string
 */
function formatTime(date) {
  if (!date) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Check if we should auto-retry
 * @returns {boolean} Whether auto-retry should happen
 */
export function shouldAutoRetry() {
  return getRetryCount() < 1; // Only retry once automatically
}

/**
 * Get formatted last update time
 * @returns {string|null} Formatted time or null
 */
export function getFormattedLastUpdate() {
  const lastFetch = getLastSuccessfulFetch();
  return lastFetch ? formatTime(lastFetch) : null;
}
