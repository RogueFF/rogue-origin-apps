/**
 * Navigation Module
 * Handles view switching, sidebar functionality, and app navigation
 */

import { appUrls } from './config.js';
import {
  getCurrentView,
  setCurrentView,
  isSidebarCollapsed,
  setSidebarCollapsed
} from './state.js';
import { registerEventListener, cleanupAllListeners } from './event-cleanup.js';

/**
 * Safe DOM element getter
 * @param {string} id - Element ID
 * @returns {HTMLElement|null}
 */
function safeGetEl(id) {
  return document.getElementById(id);
}

/**
 * Switch between different views (dashboard, kanban, scoreboard, barcode, sop, orders)
 * @param {string} view - The view to switch to
 */
export function switchView(view) {
  // Update state
  setCurrentView(view);

  // Update nav item active states
  const navItems = document.querySelectorAll('.nav-item[data-view]');
  navItems.forEach(function(item) {
    if (item.dataset.view === view) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Hide all views
  const dashboardView = safeGetEl('dashboardView');
  const kanbanView = safeGetEl('kanbanView');
  const scoreboardView = safeGetEl('scoreboardView');
  const barcodeView = safeGetEl('barcodeView');
  const sopView = safeGetEl('sopView');
  const ordersView = safeGetEl('ordersView');

  if (dashboardView) dashboardView.classList.remove('active');
  if (kanbanView) kanbanView.classList.remove('active');
  if (scoreboardView) scoreboardView.classList.remove('active');
  if (barcodeView) barcodeView.classList.remove('active');
  if (sopView) sopView.classList.remove('active');
  if (ordersView) ordersView.classList.remove('active');

  // Show/hide dashboard controls
  const dashboardControls = safeGetEl('dashboardControls');
  if (dashboardControls) {
    dashboardControls.style.display = view === 'dashboard' ? '' : 'none';
  }

  // Hide AI chat widget on iframe views (not dashboard)
  const aiChatWidget = safeGetEl('aiChatWidget');
  if (aiChatWidget) {
    aiChatWidget.style.display = view === 'dashboard' ? '' : 'none';
  }

  // Show the selected view and update document title
  let viewEl = null;
  let title = 'Rogue Origin - Operations Hub';

  switch (view) {
    case 'dashboard':
      viewEl = dashboardView;
      title = 'Rogue Origin - Operations Hub';
      break;
    case 'kanban':
      viewEl = kanbanView;
      title = 'Rogue Origin - Supply Kanban';
      break;
    case 'scoreboard':
      viewEl = scoreboardView;
      title = 'Rogue Origin - Scoreboard';
      break;
    case 'barcode':
      viewEl = barcodeView;
      title = 'Rogue Origin - Barcode Printer';
      break;
    case 'sop':
      viewEl = sopView;
      title = 'Rogue Origin - SOP Manager';
      break;
    case 'orders':
      viewEl = ordersView;
      title = 'Rogue Origin - Orders';
      break;
    default:
      viewEl = dashboardView;
      title = 'Rogue Origin - Operations Hub';
  }

  if (viewEl) {
    viewEl.classList.add('active');

    // Lazy load iframe src from data-src if not already loaded
    const iframe = viewEl.querySelector('iframe.app-iframe');
    if (iframe && iframe.dataset.src && !iframe.src) {
      iframe.src = iframe.dataset.src;
    }
  }

  // Update document title
  document.title = title;

  // Close mobile sidebar when switching views
  closeMobileSidebar();
}

/**
 * Toggle sidebar collapsed/expanded state
 */
export function toggleSidebar() {
  const sidebar = safeGetEl('sidebar');
  if (!sidebar) return;

  const collapsed = !isSidebarCollapsed();
  setSidebarCollapsed(collapsed);

  if (collapsed) {
    sidebar.classList.add('collapsed');
    document.body.classList.add('sidebar-collapsed');
  } else {
    sidebar.classList.remove('collapsed');
    document.body.classList.remove('sidebar-collapsed');
  }

  // Update toggle label if exists
  const toggleLabel = sidebar.querySelector('.sidebar-toggle-label');
  if (toggleLabel) {
    toggleLabel.textContent = collapsed ? 'Expand' : 'Collapse';
  }

  // Save preference to localStorage
  try {
    localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
  } catch {
    // localStorage not available
  }
}

/**
 * Toggle mobile sidebar visibility
 */
export function toggleMobileSidebar() {
  const isOpen = document.body.classList.contains('sidebar-open');
  if (isOpen) {
    closeMobileSidebar();
  } else {
    openMobileSidebar();
  }
}

/**
 * Open mobile sidebar
 */
function openMobileSidebar() {
  document.body.classList.add('sidebar-open');
  const btn = document.querySelector('.mobile-menu-btn');
  if (btn) btn.setAttribute('aria-expanded', 'true');
}

/**
 * Close mobile sidebar
 */
export function closeMobileSidebar() {
  document.body.classList.remove('sidebar-open');
  const btn = document.querySelector('.mobile-menu-btn');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

/**
 * Initialize mobile sidebar: backdrop click + Escape key
 */
export function initMobileSidebar() {
  const backdrop = safeGetEl('sidebarBackdrop');
  if (backdrop) {
    backdrop.addEventListener('click', closeMobileSidebar);
  }
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && document.body.classList.contains('sidebar-open')) {
      closeMobileSidebar();
    }
  });
}

/**
 * Open app URL in a new tab
 * @param {string} app - The app key (kanban, scoreboard, barcode, sop, orders)
 */
export function openAppNewTab(app) {
  const url = appUrls[app];
  if (url) {
    window.open(url, '_blank');
  }
}

/**
 * Initialize sidebar state from localStorage
 */
export function initSidebarState() {
  try {
    const saved = localStorage.getItem('sidebarCollapsed');
    if (saved === '1') {
      const sidebar = safeGetEl('sidebar');
      if (sidebar) {
        sidebar.classList.add('collapsed');
        document.body.classList.add('sidebar-collapsed');
        setSidebarCollapsed(true);

        const toggleLabel = sidebar.querySelector('.sidebar-toggle-label');
        if (toggleLabel) {
          toggleLabel.textContent = 'Expand';
        }
      }
    }
  } catch {
    // localStorage not available
  }
}

/**
 * Get current view name
 * @returns {string} Current view name
 */
export function getViewName() {
  return getCurrentView();
}

/**
 * Update CSS custom property for viewport height (iOS Safari fix)
 * This handles the dynamic address bar that changes available viewport height
 */
function updateViewportHeight() {
  const vh = window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${vh}px`);
}

/**
 * Initialize viewport height tracking
 * Call this on page load
 */
export function initViewportTracking() {
  // Set initial value
  updateViewportHeight();

  // Update on resize (when iOS address bar hides/shows)
  // Use registerEventListener for proper cleanup
  registerEventListener(window, 'resize', updateViewportHeight);

  // Update on orientation change
  const orientationHandler = () => {
    // Delay to ensure dimensions are updated
    setTimeout(updateViewportHeight, 100);
  };
  registerEventListener(window, 'orientationchange', orientationHandler);
}

/**
 * Cleanup all navigation-related event listeners
 * Call this when destroying the module or navigating away
 */
export function cleanupNavigation() {
  cleanupAllListeners();
  console.debug('[Navigation] Cleanup complete');
}
