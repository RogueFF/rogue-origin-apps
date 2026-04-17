/**
 * Shared toast/notification helper.
 * Self-contained: injects its own styles and container on first use.
 * Usable as ES6 module (import { showToast }) or via window.showToast global.
 */

const STYLE_ID = 'ro-toast-styles';
const CONTAINER_ID = 'ro-toast-container';

const CSS = `
.ro-toast-container {
  position: fixed;
  top: 1rem;
  right: 1rem;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  pointer-events: none;
}
.ro-toast {
  pointer-events: auto;
  min-width: 220px;
  max-width: 380px;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  font-family: var(--font-ui, system-ui, sans-serif);
  font-size: 0.9rem;
  color: #fff;
  background: var(--info, #62758d);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  opacity: 0;
  transform: translateX(12px);
  transition: opacity .25s ease, transform .25s ease;
}
.ro-toast.show { opacity: 1; transform: translateX(0); }
.ro-toast.success { background: var(--ro-green, #668971); }
.ro-toast.error, .ro-toast.danger { background: var(--danger, #c45c4a); }
.ro-toast.warning { background: var(--ro-gold, #e4aa4f); color: #2a1f0a; }
`;

function ensureInfrastructure() {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  let container = document.getElementById(CONTAINER_ID);
  if (!container) {
    container = document.createElement('div');
    container.id = CONTAINER_ID;
    container.className = 'ro-toast-container';
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message, type = 'info', duration = 3500) {
  const container = ensureInfrastructure();
  const toast = document.createElement('div');
  toast.className = `ro-toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

if (typeof window !== 'undefined') {
  window.showToast = showToast;
}
