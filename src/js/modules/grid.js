/**
 * Grid Module
 * Muuri grid functionality for drag-drop widgets and KPI cards
 */

import {
  getGrid,
  setGrid,
  getTimer as _getTimer,
  setTimer,
  clearTimer,
  setFlag
} from './state.js';
import { loadMuuri } from './lazy-loader.js';

// Widget size cycle order
const WIDGET_SIZES = ['small', 'medium', 'large', 'xl', 'full'];

// Storage keys
const STORAGE_KEYS = {
  widgetLayout: 'rogueOrigin_widgetLayout',
  widgetSizes: 'rogueOrigin_widgetSizes',
  widgetCollapsed: 'rogueOrigin_widgetCollapsed',
  widgetHidden: 'rogueOrigin_widgetHidden',
  kpiOrder: 'rogueOrigin_kpiOrder'
};

/**
 * Initialize Muuri grid for widgets
 * Lazy loads Muuri library if not already loaded
 * @returns {Promise<Muuri|null>} The grid instance or null if initialization fails
 */
export async function initMuuriGrid() {
  // Lazy load Muuri library
  await loadMuuri();

  const container = document.querySelector('.widgets-container');
  if (!container) {
    console.warn('Widget grid container not found');
    return null;
  }

  // Destroy existing grid if present
  const existingGrid = getGrid('widgets');
  if (existingGrid && !existingGrid._isDestroyed) {
    try {
      existingGrid.destroy();
    } catch (e) {
      console.warn('Error destroying existing widget grid:', e);
    }
  }

  // Check if Muuri is available
  if (typeof Muuri === 'undefined') {
    console.warn('Muuri library not loaded');
    return null;
  }

  // Clean up any orphaned Muuri items before initializing
  const widgetItems = container.querySelectorAll('.widget-item');
  widgetItems.forEach(function(item) {
    if (item._muuri) {
      delete item._muuri;
    }
    if (item._muuriItem) {
      delete item._muuriItem;
    }
  });

  try {
    const grid = new Muuri('.widgets-container', {
      items: '.widget-item',
      dragEnabled: true,
      dragHandle: '.widget-header',
      fillGaps: true,
      layoutDuration: 300,
      dragStartPredicate: {
        distance: 10,
        delay: 100
      },
      dragSort: true,
      dragSortHeuristics: {
        sortInterval: 100,
        minDragDistance: 10,
        minBounceBackAngle: 1
      },
      dragRelease: {
        duration: 300,
        easing: 'ease-out'
      },
      dragPlaceholder: {
        enabled: true,
        createElement: function(item) {
          const el = item.getElement().cloneNode(true);
          el.style.opacity = '0.3';
          return el;
        }
      },
      layoutOnInit: true,
      layoutOnResize: 150
    });

    console.log('Muuri grid initialized with', grid.getItems().length, 'items');

    // Save layout on drag end
    grid.on('dragEnd', function() {
      saveLayout();
    });

    // Set grid in state
    setGrid('widgets', grid);
    setFlag('muuriGridReady', true);

    // Add muuri-active class to body for CSS fallback detection
    document.body.classList.add('muuri-active');

    // Load saved layout after a short delay to ensure grid is ready
    setTimeout(function() {
      loadLayout();
    }, 100);

    return grid;
  } catch (e) {
    console.error('Error initializing Muuri widget grid:', e);
    console.error('Error details:', e.message, e.stack);
    return null;
  }
}

/**
 * Initialize Muuri grid for KPI cards
 * Lazy loads Muuri library if not already loaded
 * @returns {Promise<Muuri|null>} The grid instance or null if initialization fails
 */
export async function initMuuriKPI() {
  // Lazy load Muuri library
  await loadMuuri();

  const container = document.querySelector('.kpi-row');
  if (!container) {
    console.warn('KPI grid container not found');
    return null;
  }

  // Destroy existing grid if present
  const existingGrid = getGrid('kpi');
  if (existingGrid && !existingGrid._isDestroyed) {
    try {
      existingGrid.destroy();
    } catch (e) {
      console.warn('Error destroying existing KPI grid:', e);
    }
  }

  // Check if Muuri is available
  if (typeof Muuri === 'undefined') {
    console.warn('Muuri library not loaded');
    return null;
  }

  // Clean up any orphaned Muuri items before initializing
  const kpiItems = container.querySelectorAll('.kpi-grid-item');
  kpiItems.forEach(function(item) {
    if (item._muuri) {
      delete item._muuri;
    }
    if (item._muuriItem) {
      delete item._muuriItem;
    }
  });

  try {
    const grid = new Muuri('.kpi-row', {
      items: '.kpi-grid-item',
      dragEnabled: true,
      dragHandle: '.kpi-card',
      fillGaps: true,
      layoutDuration: 200,
      dragStartPredicate: {
        distance: 10,
        delay: 100
      },
      dragSort: true,
      dragRelease: {
        duration: 200,
        easing: 'ease-out'
      },
      layoutOnInit: true,
      layoutOnResize: 150
    });

    console.log('Muuri KPI grid initialized with', grid.getItems().length, 'items');

    // Save order on drag end
    grid.on('dragEnd', function() {
      saveKPIOrder();
    });

    // Set grid in state
    setGrid('kpi', grid);
    setFlag('muuriKPIReady', true);

    // Add muuri class to kpi-row so CSS switches from grid to block layout
    container.classList.add('muuri');

    // Load saved order after a short delay
    setTimeout(function() {
      loadKPIOrder();
    }, 100);

    return grid;
  } catch (e) {
    console.error('Error initializing Muuri KPI grid:', e);
    console.error('Error details:', e.message, e.stack);
    return null;
  }
}

/**
 * Debounced layout refresh for widget grid
 * @param {Muuri} grid - The grid instance
 * @param {number} delay - Delay in milliseconds
 */
export function debouncedMuuriLayout(grid, delay = 100) {
  if (!grid || grid._isDestroyed) return;

  clearTimer('muuriLayout');

  const timerId = setTimeout(function() {
    requestAnimationFrame(function() {
      if (grid && !grid._isDestroyed) {
        try {
          grid.refreshItems().layout();
        } catch (e) {
          console.warn('Error during debounced layout:', e);
        }
      }
    });
  }, delay);

  setTimer('muuriLayout', timerId);
}

/**
 * Debounced layout refresh for KPI grid
 * @param {number} delay - Delay in milliseconds
 */
export function debouncedKPILayout(delay = 100) {
  const grid = getGrid('kpi');
  if (!grid || grid._isDestroyed) return;

  clearTimer('muuriKPILayout');

  const timerId = setTimeout(function() {
    requestAnimationFrame(function() {
      if (grid && !grid._isDestroyed) {
        try {
          grid.refreshItems().layout();
        } catch (e) {
          console.warn('Error during debounced KPI layout:', e);
        }
      }
    });
  }, delay);

  setTimer('muuriKPILayout', timerId);
}

/**
 * Safe wrapper for grid operations
 * @param {Muuri} grid - The grid instance
 * @param {Function} operation - The operation to perform
 * @returns {*} Result of the operation or null on failure
 */
export function safeMuuriOperation(grid, operation) {
  if (!grid || grid._isDestroyed) {
    console.warn('Cannot perform operation on destroyed or null grid');
    return null;
  }

  try {
    return operation(grid);
  } catch (e) {
    console.error('Error during Muuri operation:', e);
    return null;
  }
}

/**
 * Cycle through widget sizes
 * @param {HTMLElement} btn - The resize button element
 */
export function cycleWidgetSize(btn) {
  if (!btn) return;

  const widget = btn.closest('.widget-item');
  if (!widget) return;

  // Find current size
  let currentIndex = -1;
  for (let i = 0; i < WIDGET_SIZES.length; i++) {
    if (widget.classList.contains(`widget-${WIDGET_SIZES[i]}`)) {
      currentIndex = i;
      break;
    }
  }

  // Default to medium if no size found
  if (currentIndex === -1) currentIndex = 1;

  // Remove current size class
  WIDGET_SIZES.forEach(function(size) {
    widget.classList.remove(`widget-${size}`);
  });

  // Apply next size
  const nextIndex = (currentIndex + 1) % WIDGET_SIZES.length;
  widget.classList.add(`widget-${WIDGET_SIZES[nextIndex]}`);

  // Update button title
  btn.title = `Size: ${WIDGET_SIZES[nextIndex]}`;

  // Refresh grid layout
  const grid = getGrid('widgets');
  if (grid) {
    debouncedMuuriLayout(grid, 50);
  }

  // Save state
  saveWidgetSizes();
}

/**
 * Toggle widget collapse/expand
 * @param {HTMLElement} btn - The collapse button element
 */
export function toggleWidgetCollapse(btn) {
  if (!btn) return;

  const widget = btn.closest('.widget-item');
  if (!widget) return;

  const icon = btn.querySelector('i');

  widget.classList.toggle('collapsed');

  // Update icon
  if (icon) {
    if (widget.classList.contains('collapsed')) {
      icon.className = icon.className.replace('ph-caret-up', 'ph-caret-down');
    } else {
      icon.className = icon.className.replace('ph-caret-down', 'ph-caret-up');
    }
  }

  // Trigger layout after transition
  const grid = getGrid('widgets');
  if (grid) {
    clearTimer('collapseLayout');
    const timerId = setTimeout(function() {
      debouncedMuuriLayout(grid, 50);
    }, 300);
    setTimer('collapseLayout', timerId);
  }

  // Save collapsed state
  saveCollapsedState();
}

/**
 * Hide a widget
 * @param {string} widgetId - The widget ID to hide
 */
export function hideWidget(widgetId) {
  const widget = document.querySelector(`[data-widget-id="${widgetId}"]`);
  if (!widget) return;

  const grid = getGrid('widgets');
  if (grid && !grid._isDestroyed) {
    const item = grid.getItems().find(function(i) {
      return i.getElement() === widget;
    });

    if (item) {
      grid.hide([item], {
        onFinish: function() {
          widget.style.display = 'none';
          saveHiddenWidgets();
          debouncedMuuriLayout(grid, 50);
        }
      });
    }
  } else {
    widget.style.display = 'none';
    saveHiddenWidgets();
  }
}

/**
 * Show a hidden widget
 * @param {string} widgetId - The widget ID to show
 */
export function showWidget(widgetId) {
  const widget = document.querySelector(`[data-widget-id="${widgetId}"]`);
  if (!widget) return;

  widget.style.display = '';

  const grid = getGrid('widgets');
  if (grid && !grid._isDestroyed) {
    const item = grid.getItems().find(function(i) {
      return i.getElement() === widget;
    });

    if (item) {
      grid.show([item], {
        onFinish: function() {
          debouncedMuuriLayout(grid, 50);
        }
      });
    } else {
      // Item may need to be added back
      debouncedMuuriLayout(grid, 50);
    }
  }

  saveHiddenWidgets();
}

/**
 * Save widget layout order to localStorage
 */
export function saveLayout() {
  const grid = getGrid('widgets');
  if (!grid || grid._isDestroyed) return;

  try {
    const items = grid.getItems();
    const order = items.map(function(item) {
      const el = item.getElement();
      return el.getAttribute('data-widget-id');
    }).filter(Boolean);

    localStorage.setItem(STORAGE_KEYS.widgetLayout, JSON.stringify(order));
  } catch (e) {
    console.warn('Error saving widget layout:', e);
  }
}

/**
 * Load widget layout order from localStorage
 */
export function loadLayout() {
  const grid = getGrid('widgets');
  if (!grid || grid._isDestroyed) return;

  try {
    const saved = localStorage.getItem(STORAGE_KEYS.widgetLayout);
    if (!saved) return;

    const order = JSON.parse(saved);
    if (!Array.isArray(order) || order.length === 0) return;

    const items = grid.getItems();
    const sortedItems = [];

    // Sort items according to saved order
    order.forEach(function(widgetId) {
      const item = items.find(function(i) {
        return i.getElement().getAttribute('data-widget-id') === widgetId;
      });
      if (item) sortedItems.push(item);
    });

    // Add any items not in saved order at the end
    items.forEach(function(item) {
      if (sortedItems.indexOf(item) === -1) {
        sortedItems.push(item);
      }
    });

    // Apply sort
    if (sortedItems.length > 0) {
      grid.sort(sortedItems, { layout: 'instant' });
    }

    // Load other saved states
    loadWidgetSizes();
    loadCollapsedState();
    loadHiddenWidgets();
  } catch (e) {
    console.warn('Error loading widget layout:', e);
  }
}

/**
 * Save widget sizes to localStorage
 */
function saveWidgetSizes() {
  try {
    const widgets = document.querySelectorAll('.widget-item');
    const sizes = {};

    widgets.forEach(function(widget) {
      const id = widget.getAttribute('data-widget-id');
      if (!id) return;

      for (let i = 0; i < WIDGET_SIZES.length; i++) {
        if (widget.classList.contains(`widget-${WIDGET_SIZES[i]}`)) {
          sizes[id] = WIDGET_SIZES[i];
          break;
        }
      }
    });

    localStorage.setItem(STORAGE_KEYS.widgetSizes, JSON.stringify(sizes));
  } catch (e) {
    console.warn('Error saving widget sizes:', e);
  }
}

/**
 * Load widget sizes from localStorage
 */
function loadWidgetSizes() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.widgetSizes);
    if (!saved) return;

    const sizes = JSON.parse(saved);
    if (!sizes || typeof sizes !== 'object') return;

    Object.keys(sizes).forEach(function(id) {
      const widget = document.querySelector(`[data-widget-id="${id}"]`);
      if (!widget) return;

      // Remove all size classes
      WIDGET_SIZES.forEach(function(size) {
        widget.classList.remove(`widget-${size}`);
      });

      // Add saved size class
      widget.classList.add(`widget-${sizes[id]}`);
    });
  } catch (e) {
    console.warn('Error loading widget sizes:', e);
  }
}

/**
 * Save collapsed state to localStorage
 */
function saveCollapsedState() {
  try {
    const widgets = document.querySelectorAll('.widget-item.collapsed');
    const collapsed = Array.from(widgets).map(function(w) {
      return w.getAttribute('data-widget-id');
    }).filter(Boolean);

    localStorage.setItem(STORAGE_KEYS.widgetCollapsed, JSON.stringify(collapsed));
  } catch (e) {
    console.warn('Error saving collapsed state:', e);
  }
}

/**
 * Load collapsed state from localStorage
 */
function loadCollapsedState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.widgetCollapsed);
    if (!saved) return;

    const collapsed = JSON.parse(saved);
    if (!Array.isArray(collapsed)) return;

    collapsed.forEach(function(id) {
      const widget = document.querySelector(`[data-widget-id="${id}"]`);
      if (!widget) return;

      widget.classList.add('collapsed');

      // Update collapse button icon
      const icon = widget.querySelector('.widget-collapse i');
      if (icon) {
        icon.className = icon.className.replace('ph-caret-up', 'ph-caret-down');
      }
    });
  } catch (e) {
    console.warn('Error loading collapsed state:', e);
  }
}

/**
 * Save hidden widgets to localStorage
 */
function saveHiddenWidgets() {
  try {
    const widgets = document.querySelectorAll('.widget-item');
    const hidden = Array.from(widgets)
      .filter(function(w) {
        return w.style.display === 'none';
      })
      .map(function(w) {
        return w.getAttribute('data-widget-id');
      })
      .filter(Boolean);

    localStorage.setItem(STORAGE_KEYS.widgetHidden, JSON.stringify(hidden));
  } catch (e) {
    console.warn('Error saving hidden widgets:', e);
  }
}

/**
 * Load hidden widgets from localStorage
 */
function loadHiddenWidgets() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.widgetHidden);
    if (!saved) return;

    const hidden = JSON.parse(saved);
    if (!Array.isArray(hidden)) return;

    const grid = getGrid('widgets');

    hidden.forEach(function(id) {
      const widget = document.querySelector(`[data-widget-id="${id}"]`);
      if (!widget) return;

      widget.style.display = 'none';

      if (grid && !grid._isDestroyed) {
        const item = grid.getItems().find(function(i) {
          return i.getElement() === widget;
        });
        if (item) {
          grid.hide([item], { instant: true });
        }
      }
    });
  } catch (e) {
    console.warn('Error loading hidden widgets:', e);
  }
}

/**
 * Save KPI card order to localStorage
 */
export function saveKPIOrder() {
  const grid = getGrid('kpi');
  if (!grid || grid._isDestroyed) return;

  try {
    const items = grid.getItems();
    const order = items.map(function(item) {
      const el = item.getElement();
      const card = el.querySelector('.kpi-card');
      return card ? card.getAttribute('data-kpi') : null;
    }).filter(Boolean);

    localStorage.setItem(STORAGE_KEYS.kpiOrder, JSON.stringify(order));
  } catch (e) {
    console.warn('Error saving KPI order:', e);
  }
}

/**
 * Load KPI card order from localStorage
 */
export function loadKPIOrder() {
  const grid = getGrid('kpi');
  if (!grid || grid._isDestroyed) return;

  try {
    const saved = localStorage.getItem(STORAGE_KEYS.kpiOrder);
    if (!saved) return;

    const order = JSON.parse(saved);
    if (!Array.isArray(order) || order.length === 0) return;

    const items = grid.getItems();
    const sortedItems = [];

    // Sort items according to saved order
    order.forEach(function(kpiId) {
      const item = items.find(function(i) {
        const card = i.getElement().querySelector('.kpi-card');
        return card && card.getAttribute('data-kpi') === kpiId;
      });
      if (item) sortedItems.push(item);
    });

    // Add any items not in saved order at the end
    items.forEach(function(item) {
      if (sortedItems.indexOf(item) === -1) {
        sortedItems.push(item);
      }
    });

    // Apply sort
    if (sortedItems.length > 0) {
      grid.sort(sortedItems, { layout: 'instant' });
    }
  } catch (e) {
    console.warn('Error loading KPI order:', e);
  }
}

/**
 * Initialize widget resize drag handles
 */
export function initWidgetResizeHandles() {
  const widgets = document.querySelectorAll('.widget-item');

  widgets.forEach(function(widget) {
    // Check if handle already exists
    if (widget.querySelector('.widget-resize-handle')) return;

    const handle = document.createElement('div');
    handle.className = 'widget-resize-handle';
    handle.innerHTML = '<i class="ph-duotone ph-corners-out"></i>';

    let startX, startY, startWidth, startHeight;
    let isResizing = false;

    handle.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopPropagation();

      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startWidth = widget.offsetWidth;
      startHeight = widget.offsetHeight;

      document.body.style.cursor = 'nwse-resize';
      widget.style.transition = 'none';

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) {
      if (!isResizing) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      // Calculate new dimensions
      const newWidth = Math.max(200, startWidth + deltaX);
      const newHeight = Math.max(150, startHeight + deltaY);

      widget.style.width = `${newWidth}px`;
      widget.style.height = `${newHeight}px`;
    }

    function onMouseUp() {
      if (!isResizing) return;

      isResizing = false;
      document.body.style.cursor = '';
      widget.style.transition = '';

      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      // Refresh grid layout
      const grid = getGrid('widgets');
      if (grid) {
        requestAnimationFrame(function() {
          debouncedMuuriLayout(grid, 50);
        });
      }
    }

    widget.appendChild(handle);
  });
}

// Export all public functions
export {
  WIDGET_SIZES,
  STORAGE_KEYS
};
