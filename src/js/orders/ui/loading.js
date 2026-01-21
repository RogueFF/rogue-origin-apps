/**
 * Loading state management for UI elements
 * @module ui/loading
 */

// Track original button states for restoration
const buttonStates = new Map();

/**
 * Set button to loading state
 * @param {string|HTMLElement} buttonOrId - Button element or ID
 * @param {string} loadingText - Text to show while loading (default: 'Loading...')
 * @returns {function} Restore function to call when done
 */
export function setButtonLoading(buttonOrId, loadingText = 'Loading...') {
  const button = typeof buttonOrId === 'string'
    ? document.getElementById(buttonOrId)
    : buttonOrId;

  if (!button) return () => {};

  // Save original state
  const originalState = {
    text: button.innerHTML,
    disabled: button.disabled,
    width: button.style.minWidth
  };
  buttonStates.set(button, originalState);

  // Set loading state
  button.style.minWidth = `${button.offsetWidth}px`; // Prevent width change
  button.disabled = true;
  button.innerHTML = `<i class="ph ph-spinner-gap ph-spin"></i> ${loadingText}`;
  button.classList.add('loading');

  // Return restore function
  return () => restoreButton(button);
}

/**
 * Restore button to original state
 * @param {HTMLElement} button
 */
export function restoreButton(button) {
  const originalState = buttonStates.get(button);
  if (!originalState) return;

  button.innerHTML = originalState.text;
  button.disabled = originalState.disabled;
  button.style.minWidth = originalState.width;
  button.classList.remove('loading');

  buttonStates.delete(button);
}

/**
 * Execute an async function with button loading state
 * @param {string|HTMLElement} buttonOrId - Button element or ID
 * @param {function} asyncFn - Async function to execute
 * @param {string} loadingText - Loading text
 * @returns {Promise<*>} Result of asyncFn
 */
export async function withButtonLoading(buttonOrId, asyncFn, loadingText = 'Saving...') {
  const restore = setButtonLoading(buttonOrId, loadingText);
  try {
    return await asyncFn();
  } finally {
    restore();
  }
}

/**
 * Show skeleton loader in a container
 * @param {string|HTMLElement} containerOrId
 * @param {number} rows - Number of skeleton rows
 */
export function showSkeleton(containerOrId, rows = 3) {
  const container = typeof containerOrId === 'string'
    ? document.getElementById(containerOrId)
    : containerOrId;

  if (!container) return;

  const skeletons = Array(rows).fill(0).map(() => `
    <div class="skeleton-item">
      <div class="skeleton-line" style="width: 60%"></div>
      <div class="skeleton-line" style="width: 80%"></div>
      <div class="skeleton-line" style="width: 40%"></div>
    </div>
  `).join('');

  container.innerHTML = `<div class="skeleton-loader">${skeletons}</div>`;
}

/**
 * Show loading spinner in a container
 * @param {string|HTMLElement} containerOrId
 * @param {string} message - Loading message
 */
export function showLoadingSpinner(containerOrId, message = 'Loading...') {
  const container = typeof containerOrId === 'string'
    ? document.getElementById(containerOrId)
    : containerOrId;

  if (!container) return;

  container.innerHTML = `
    <div class="loading-spinner">
      <i class="ph ph-spinner-gap ph-spin"></i>
      <span>${message}</span>
    </div>
  `;
}

/**
 * Add loading overlay to an element
 * @param {string|HTMLElement} elementOrId
 * @returns {function} Remove function
 */
export function addLoadingOverlay(elementOrId) {
  const element = typeof elementOrId === 'string'
    ? document.getElementById(elementOrId)
    : elementOrId;

  if (!element) return () => {};

  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'loading-overlay';
  overlay.innerHTML = '<i class="ph ph-spinner-gap ph-spin"></i>';

  // Position relative if needed
  const position = getComputedStyle(element).position;
  if (position === 'static') {
    element.style.position = 'relative';
  }

  element.appendChild(overlay);

  // Return remove function
  return () => {
    overlay.remove();
    if (position === 'static') {
      element.style.position = '';
    }
  };
}

/**
 * Disable form while loading
 * @param {string|HTMLElement} formOrId
 * @returns {function} Enable function
 */
export function disableForm(formOrId) {
  const form = typeof formOrId === 'string'
    ? document.getElementById(formOrId)
    : formOrId;

  if (!form) return () => {};

  const inputs = form.querySelectorAll('input, select, textarea, button');
  const originalStates = [];

  inputs.forEach(input => {
    originalStates.push({ element: input, disabled: input.disabled });
    input.disabled = true;
  });

  return () => {
    originalStates.forEach(({ element, disabled }) => {
      element.disabled = disabled;
    });
  };
}
