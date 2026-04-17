/**
 * Shared toast/notification helper.
 * Self-contained: injects its own styles and container on first use.
 * Usable as ES6 module (import { showToast }) or via window.showToast global.
 *
 * API:
 *   showToast(message, type = 'info', duration = 3500, options = {})
 *     type:      'success' | 'error' | 'danger' | 'warning' | 'info'
 *     options:
 *       closable: boolean  (default: true) – render an X button
 *       icon:     string   (optional) – override Phosphor icon class
 *
 * Also exposes `showMessage` as an alias for legacy callers (e.g. barcode.html).
 */

const STYLE_ID = 'ro-toast-styles';
const CONTAINER_ID = 'ro-toast-container';

const DEFAULT_ICONS = {
  success: 'ph ph-check-circle',
  error: 'ph ph-x-circle',
  danger: 'ph ph-x-circle',
  warning: 'ph ph-warning-circle',
  info: 'ph ph-info',
};

const CSS = `
.ro-toast-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  gap: 12px;
  pointer-events: none;
  max-width: calc(100vw - 40px);
}
.ro-toast {
  pointer-events: auto;
  font-family: var(--font-ui, system-ui, -apple-system, sans-serif);
  background: var(--bg-card, #ffffff);
  color: var(--text, #1a1a1a);
  border: 1px solid var(--border-light, rgba(102, 137, 113, 0.15));
  border-left: 4px solid var(--info, #62758d);
  border-radius: 8px;
  padding: 14px 18px;
  min-width: 260px;
  max-width: 480px;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  opacity: 0;
  transform: translateX(20px);
  transition: opacity .25s ease, transform .25s ease;
}
.ro-toast.show { opacity: 1; transform: translateX(0); }
.ro-toast.removing { opacity: 0; transform: translateX(20px); }

.ro-toast.success { border-left-color: var(--ro-green, #668971); }
.ro-toast.error,
.ro-toast.danger  { border-left-color: var(--danger, #c45c4a); }
.ro-toast.warning { border-left-color: var(--ro-gold, #e4aa4f); }
.ro-toast.info    { border-left-color: var(--info, #62758d); }

.ro-toast-icon {
  font-size: 20px;
  line-height: 1;
  flex-shrink: 0;
  color: var(--info, #62758d);
}
.ro-toast.success .ro-toast-icon { color: var(--ro-green, #668971); }
.ro-toast.error   .ro-toast-icon,
.ro-toast.danger  .ro-toast-icon { color: var(--danger, #c45c4a); }
.ro-toast.warning .ro-toast-icon { color: var(--ro-gold, #e4aa4f); }
.ro-toast.info    .ro-toast-icon { color: var(--info, #62758d); }

.ro-toast-message {
  flex: 1;
  font-size: 14px;
  line-height: 1.45;
  word-break: break-word;
}

.ro-toast-close {
  background: none;
  border: none;
  color: var(--text-muted, rgba(0, 0, 0, 0.45));
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  font-size: 16px;
  line-height: 1;
  transition: background-color .15s ease, color .15s ease;
}
.ro-toast-close:hover {
  background: rgba(102, 137, 113, 0.12);
  color: var(--text, #1a1a1a);
}

[data-theme="dark"] .ro-toast {
  background: var(--bg-card, #1e2421);
  color: var(--text, rgba(255, 255, 255, 0.9));
  border-color: rgba(255, 255, 255, 0.08);
}
[data-theme="dark"] .ro-toast-close {
  color: rgba(255, 255, 255, 0.5);
}
[data-theme="dark"] .ro-toast-close:hover {
  color: rgba(255, 255, 255, 0.95);
  background: rgba(255, 255, 255, 0.08);
}

@media (max-width: 600px) {
  .ro-toast-container {
    top: 12px;
    right: 12px;
    left: 12px;
    max-width: none;
  }
  .ro-toast { min-width: 0; max-width: none; }
}
`;

function ensureInfrastructure() {
  if (typeof document === 'undefined') return null;
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
    container.setAttribute('role', 'region');
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-label', 'Notifications');
    document.body.appendChild(container);
  }
  return container;
}

function resolveIcon(type, override) {
  if (override) return override;
  return DEFAULT_ICONS[type] || DEFAULT_ICONS.info;
}

export function showToast(message, type = 'info', duration = 3500, options = {}) {
  const container = ensureInfrastructure();
  if (!container) return null;

  const { closable = true, icon } = options || {};
  const iconClass = resolveIcon(type, icon);

  const toast = document.createElement('div');
  toast.className = `ro-toast ${type}`;
  toast.setAttribute('role', type === 'error' || type === 'danger' ? 'alert' : 'status');

  const iconEl = document.createElement('i');
  iconEl.className = `${iconClass} ro-toast-icon`;
  iconEl.setAttribute('aria-hidden', 'true');
  toast.appendChild(iconEl);

  const msg = document.createElement('div');
  msg.className = 'ro-toast-message';
  msg.textContent = message;
  toast.appendChild(msg);

  let dismissTimer = null;
  const dismiss = () => {
    if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
    toast.classList.add('removing');
    toast.classList.remove('show');
    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, 300);
  };

  if (closable) {
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ro-toast-close';
    closeBtn.setAttribute('aria-label', 'Dismiss notification');
    closeBtn.innerHTML = '<i class="ph ph-x" aria-hidden="true"></i>';
    closeBtn.addEventListener('click', dismiss);
    toast.appendChild(closeBtn);
  }

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));

  if (duration && duration > 0) {
    dismissTimer = setTimeout(dismiss, duration);
  }

  return toast;
}

// Legacy alias for pages that called showMessage(text, type) (e.g. barcode.html).
export function showMessage(message, type = 'info', duration = 3500, options = {}) {
  return showToast(message, type, duration, options);
}

if (typeof window !== 'undefined') {
  window.showToast = showToast;
  if (typeof window.showMessage !== 'function') {
    window.showMessage = showMessage;
  }
}
