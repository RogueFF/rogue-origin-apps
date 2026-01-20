/**
 * Generic modal helpers
 * @module ui/modals
 */

/**
 * Open a modal by ID
 * @param {string} modalId - The modal element ID
 */
export function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('active');
    // Focus first input if present
    const firstInput = modal.querySelector('input:not([type="hidden"]), select, textarea');
    if (firstInput) {
      setTimeout(() => firstInput.focus(), 100);
    }
  }
}

/**
 * Close a modal by ID
 * @param {string} modalId - The modal element ID
 */
export function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
  }
}

/**
 * Clear/reset a form
 * @param {string} formId - The form element ID
 */
export function clearForm(formId) {
  const form = document.getElementById(formId);
  if (form) {
    form.reset();
  }
}

/**
 * Set modal title
 * @param {string} modalId - The modal element ID
 * @param {string} title - New title text
 */
export function setModalTitle(modalId, title) {
  const modal = document.getElementById(modalId);
  if (modal) {
    const titleEl = modal.querySelector('.modal-title');
    if (titleEl) {
      titleEl.textContent = title;
    }
  }
}

/**
 * Close modal when clicking overlay (outside modal content)
 * Call this once during initialization
 */
export function setupModalOverlayClose() {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('active');
      }
    });
  });
}

/**
 * Close modal on Escape key
 * Call this once during initialization
 */
export function setupModalEscapeClose() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const activeModal = document.querySelector('.modal-overlay.active');
      if (activeModal) {
        activeModal.classList.remove('active');
      }
    }
  });
}

/**
 * Set up all modal behaviors
 */
export function initModals() {
  setupModalOverlayClose();
  setupModalEscapeClose();
}
