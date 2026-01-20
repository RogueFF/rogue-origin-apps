/**
 * Toast notification system
 * @module ui/toast
 */

/**
 * Show a toast notification
 * @param {string} message - Message to display
 * @param {string} type - Type: 'success', 'error', 'warning', 'info'
 */
export function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) {
    console.warn('Toast container not found');
    return;
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  // Icon based on type
  const icons = {
    success: 'ph-check-circle',
    error: 'ph-x-circle',
    warning: 'ph-warning-circle',
    info: 'ph-info'
  };
  const iconClass = icons[type] || icons.info;

  toast.innerHTML = `
    <i class="ph ${iconClass} toast-icon"></i>
    <div class="toast-message">${escapeHtml(message)}</div>
    <button class="toast-close" onclick="this.parentElement.remove()">
      <i class="ph ph-x"></i>
    </button>
  `;

  container.appendChild(toast);

  // Auto remove after 4 seconds
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => {
      if (toast.parentElement) {
        toast.remove();
      }
    }, 300);
  }, 4000);
}

/**
 * Show success toast
 * @param {string} message
 */
export function showSuccess(message) {
  showToast(message, 'success');
}

/**
 * Show error toast
 * @param {string} message
 */
export function showError(message) {
  showToast(message, 'error');
}

/**
 * Show warning toast
 * @param {string} message
 */
export function showWarning(message) {
  showToast(message, 'warning');
}

/**
 * Show info toast
 * @param {string} message
 */
export function showInfo(message) {
  showToast(message, 'info');
}

/**
 * Escape HTML to prevent XSS
 * @private
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
