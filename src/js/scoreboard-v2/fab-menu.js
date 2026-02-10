/**
 * FAB Menu System
 * Floating Action Button with expandable menu panel
 */
(function(window) {
  'use strict';

  var DOM = window.ScoreboardDOM;
  var I18n = window.ScoreboardI18n;

  // Module state
  var state = {
    isOpen: false,
    tvFadeTimer: null,
    idleTimer: null
  };

  // DOM elements (cached)
  var elements = {
    fabButton: null,
    fabMenu: null,
    fabBackdrop: null,
    fabStartDay: null,
    fabPastData: null,
    fabMorningReport: null,
    fabOrderQueue: null,
    fabChart: null,
    fabHelp: null,
    orderQueueIndicator: null,
    chartIndicator: null
  };

  /**
   * Initialize FAB menu system
   */
  function init() {
    // Cache DOM elements
    elements.fabButton = document.getElementById('fabButton');
    elements.fabMenu = document.getElementById('fabMenu');
    elements.fabBackdrop = document.getElementById('fabBackdrop');
    elements.fabStartDay = document.getElementById('fabStartDay');
    elements.fabPastData = document.getElementById('fabPastData');
    elements.fabMorningReport = document.getElementById('fabMorningReport');
    elements.fabOrderQueue = document.getElementById('fabOrderQueue');
    elements.fabChart = document.getElementById('fabChart');
    elements.fabHelp = document.getElementById('fabHelp');
    elements.orderQueueIndicator = document.getElementById('orderQueueIndicator');
    elements.chartIndicator = document.getElementById('chartIndicator');

    // Attach event listeners
    if (elements.fabButton) {
      elements.fabButton.addEventListener('click', toggleMenu);
    }

    if (elements.fabBackdrop) {
      elements.fabBackdrop.addEventListener('click', closeMenu);
    }

    // Wire up menu item actions
    if (elements.fabStartDay) {
      elements.fabStartDay.addEventListener('click', handleStartDay);
    }

    if (elements.fabPastData) {
      elements.fabPastData.addEventListener('click', handlePastData);
    }

    if (elements.fabMorningReport) {
      elements.fabMorningReport.addEventListener('click', handleMorningReport);
    }

    if (elements.fabOrderQueue) {
      elements.fabOrderQueue.addEventListener('click', handleOrderQueue);
    }

    if (elements.fabChart) {
      elements.fabChart.addEventListener('click', handleChartToggle);
    }

    if (elements.fabHelp) {
      elements.fabHelp.addEventListener('click', handleHelp);
    }

    // Keyboard navigation
    document.addEventListener('keydown', handleKeyboard);

    // Start TV fade timer if on TV screen
    if (isTVMode()) {
      startTVFadeTimer();
    }

    // Start idle pulse animation
    startIdleTimer();

    // Update order queue indicator on init
    updateOrderQueueIndicator();

    // Update chart indicator on init
    updateChartIndicator();

    // Check if Start Day should be visible
    checkStartDayVisibility();

    console.log('[FAB Menu] Initialized');
  }

  /**
   * Toggle menu open/close
   */
  function toggleMenu() {
    if (state.isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  /**
   * Open menu
   */
  function openMenu() {
    if (!elements.fabMenu || !elements.fabBackdrop) return;

    state.isOpen = true;
    elements.fabMenu.classList.add('visible');
    elements.fabBackdrop.classList.add('visible');
    elements.fabButton.setAttribute('aria-expanded', 'true');
    elements.fabButton.classList.remove('idle');

    // Clear TV fade timer when menu is open
    clearTVFadeTimer();

    // Remove TV fade class
    elements.fabButton.classList.remove('tv-fade');

    // Focus first visible menu item
    setTimeout(function() {
      var firstItem = elements.fabMenu.querySelector('.fab-menu-item:not([style*="display: none"])');
      if (firstItem) {
        firstItem.focus();
      }
    }, 100);

    console.log('[FAB Menu] Opened');
  }

  /**
   * Handle keyboard navigation
   */
  function handleKeyboard(e) {
    // Escape key closes menu
    if (e.key === 'Escape' && state.isOpen) {
      e.preventDefault();
      closeMenu();
      if (elements.fabButton) {
        elements.fabButton.focus();
      }
      return;
    }

    // Enter/Space on FAB button toggles menu
    if ((e.key === 'Enter' || e.key === ' ') && document.activeElement === elements.fabButton) {
      e.preventDefault();
      toggleMenu();
      return;
    }

    // Arrow navigation within menu
    if (state.isOpen && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();

      var visibleItems = Array.from(elements.fabMenu.querySelectorAll('.fab-menu-item'))
        .filter(function(item) {
          return item.style.display !== 'none' && item.offsetParent !== null;
        });

      if (visibleItems.length === 0) return;

      var currentIndex = visibleItems.indexOf(document.activeElement);
      var nextIndex;

      if (e.key === 'ArrowDown') {
        nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % visibleItems.length;
      } else {
        nextIndex = currentIndex <= 0 ? visibleItems.length - 1 : currentIndex - 1;
      }

      visibleItems[nextIndex].focus();
    }
  }

  /**
   * Close menu
   */
  function closeMenu() {
    if (!elements.fabMenu || !elements.fabBackdrop) return;

    state.isOpen = false;
    elements.fabMenu.classList.remove('visible');
    elements.fabBackdrop.classList.remove('visible');
    elements.fabButton.setAttribute('aria-expanded', 'false');

    // Restart TV fade timer after menu closes
    if (isTVMode()) {
      startTVFadeTimer();
    }

    // Restart idle pulse
    startIdleTimer();

    console.log('[FAB Menu] Closed');
  }

  /**
   * Handle Start Day click
   */
  function handleStartDay() {
    closeMenu();
    // Trigger existing Start Day button (will be hidden)
    var startDayBtn = document.getElementById('startDayBtn');
    if (startDayBtn) {
      startDayBtn.click();
    }
  }

  /**
   * Handle Past Data click
   */
  function handlePastData() {
    closeMenu();
    // Trigger existing historical view button
    if (window.toggleDatePicker) {
      window.toggleDatePicker();
    }
  }

  /**
   * Handle Morning Report click
   */
  function handleMorningReport() {
    closeMenu();
    // Trigger existing morning report button
    var mrBtn = document.getElementById('morningReportBtn');
    if (mrBtn) {
      mrBtn.click();
    }
  }

  /**
   * Handle Order Queue toggle
   */
  function handleOrderQueue() {
    closeMenu();
    // Trigger existing order queue toggle
    if (window.toggleOrderQueue) {
      window.toggleOrderQueue();
    }
    // Update indicator after toggle
    setTimeout(updateOrderQueueIndicator, 100);
  }

  /**
   * Handle Help click
   */
  function handleHelp() {
    closeMenu();
    // Trigger existing help button
    if (window.toggleHelp) {
      window.toggleHelp();
    }
  }

  /**
   * Update order queue indicator (ON/OFF)
   */
  function updateOrderQueueIndicator() {
    if (!elements.orderQueueIndicator) return;

    var isVisible = localStorage.getItem('orderQueueVisible') === 'true';
    elements.orderQueueIndicator.textContent = isVisible ? 'ON' : 'OFF';
    elements.orderQueueIndicator.classList.toggle('on', isVisible);
  }

  /**
   * Handle Hourly Chart toggle
   */
  function handleChartToggle() {
    closeMenu();

    // Toggle chart visibility
    var chartContainer = document.querySelector('.chart-container');
    if (!chartContainer) return;

    var isVisible = chartContainer.classList.contains('visible');

    if (isVisible) {
      chartContainer.classList.remove('visible');
      localStorage.setItem('chartVisible', 'false');
    } else {
      chartContainer.classList.add('visible');
      localStorage.setItem('chartVisible', 'true');
    }

    // Update indicator after toggle
    setTimeout(updateChartIndicator, 100);
  }

  /**
   * Update chart indicator (ON/OFF)
   */
  function updateChartIndicator() {
    if (!elements.chartIndicator) return;

    var isHidden = localStorage.getItem('chartVisible') === 'false';
    elements.chartIndicator.textContent = isHidden ? 'OFF' : 'ON';
    elements.chartIndicator.classList.toggle('on', !isHidden);
  }

  /**
   * Check if Start Day button should be visible
   */
  function checkStartDayVisibility() {
    if (!elements.fabStartDay) return;

    // Show Start Day if shift start is not set (same logic as existing button)
    var shiftStart = localStorage.getItem('shiftStartTime');
    var today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
    var shiftStartDate = localStorage.getItem('shiftStartDate');

    var shouldShow = !shiftStart || shiftStartDate !== today;
    elements.fabStartDay.style.display = shouldShow ? 'flex' : 'none';
  }

  /**
   * Check if we're in TV mode (≥1920px)
   */
  function isTVMode() {
    return window.innerWidth >= 1920;
  }

  /**
   * Start TV auto-fade timer (10 seconds idle)
   */
  function startTVFadeTimer() {
    clearTVFadeTimer();

    if (!isTVMode() || !elements.fabButton) return;

    state.tvFadeTimer = setTimeout(function() {
      if (!state.isOpen) {
        elements.fabButton.classList.add('tv-fade');
      }
    }, 10000); // 10 seconds
  }

  /**
   * Clear TV fade timer
   */
  function clearTVFadeTimer() {
    if (state.tvFadeTimer) {
      clearTimeout(state.tvFadeTimer);
      state.tvFadeTimer = null;
    }
  }

  /**
   * Start idle pulse animation timer
   */
  function startIdleTimer() {
    clearIdleTimer();

    if (!elements.fabButton) return;

    state.idleTimer = setTimeout(function() {
      if (!state.isOpen) {
        elements.fabButton.classList.add('idle');
      }
    }, 3000); // 3 seconds idle before pulse
  }

  /**
   * Clear idle timer
   */
  function clearIdleTimer() {
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = null;
    }
  }

  /**
   * Public API
   */
  var ScoreboardFABMenu = {
    init: init,
    openMenu: openMenu,
    closeMenu: closeMenu,
    updateOrderQueueIndicator: updateOrderQueueIndicator,
    updateChartIndicator: updateChartIndicator,
    checkStartDayVisibility: checkStartDayVisibility
  };

  // Export to global scope
  window.ScoreboardFABMenu = ScoreboardFABMenu;

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window);
