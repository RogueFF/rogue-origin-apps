/**
 * Scoreboard Events Module
 * Centralizes all event listener registration
 * Replaces inline onclick/onchange/oninput handlers with proper addEventListener calls
 */
(function(window) {
  'use strict';

  /**
   * Attach all event listeners
   * Called from main.js after DOM is ready
   */
  function attachEventListeners() {
    // Helper to get element by ID
    const el = (id) => document.getElementById(id);

    // Morning Report
    const morningReportBtn = el('morningReportBtn');
    if (morningReportBtn) {
      morningReportBtn.addEventListener('click', toggleMorningReport);
    }

    const mrBackBtn = document.querySelector('.mr-back-btn');
    if (mrBackBtn) {
      mrBackBtn.addEventListener('click', toggleMorningReport);
    }

    // Historical Date Controls
    const historicalBannerClose = document.querySelector('.historical-banner-close');
    if (historicalBannerClose) {
      historicalBannerClose.addEventListener('click', clearHistoricalDate);
    }

    const historicalDatePicker = el('historicalDatePicker');
    if (historicalDatePicker) {
      historicalDatePicker.addEventListener('change', function() {
        loadHistoricalDate(this.value);
      });
    }

    const historicalViewBtn = el('historicalViewBtn');
    if (historicalViewBtn) {
      historicalViewBtn.addEventListener('click', toggleDatePicker);
    }

    // Shift Start Controls
    const startDayBtn = el('startDayBtn');
    if (startDayBtn) {
      startDayBtn.addEventListener('click', startDayNow);
    }

    const startedBadge = el('startedBadge');
    if (startedBadge) {
      startedBadge.addEventListener('click', editStartTime);
    }

    const cancelStartBtn = document.querySelector('.btn-secondary');
    if (cancelStartBtn && cancelStartBtn.textContent.includes('Cancel')) {
      cancelStartBtn.addEventListener('click', cancelStartTime);
    }

    const confirmStartBtn = document.querySelector('.btn-primary');
    if (confirmStartBtn && confirmStartBtn.textContent.includes('Confirm')) {
      confirmStartBtn.addEventListener('click', confirmStartTime);
    }

    // Language Toggle (old hidden button + FAB menu button)
    function handleLangToggle() {
      const currentLang = window.ScoreboardState?.currentLang || 'en';
      const newLang = currentLang === 'en' ? 'es' : 'en';
      setLanguage(newLang);

      // Update all language indicator elements
      const langToggleText = el('langToggleText');
      if (langToggleText) langToggleText.textContent = newLang.toUpperCase();
      const langIndicator = el('langIndicator');
      if (langIndicator) langIndicator.textContent = newLang.toUpperCase();
    }

    const langToggleBtn = el('langToggleBtn');
    if (langToggleBtn) {
      langToggleBtn.addEventListener('click', handleLangToggle);
    }

    const fabLangToggle = el('fabLangToggle');
    if (fabLangToggle) {
      fabLangToggle.addEventListener('click', handleLangToggle);
    }

    // TV Mode Toggle
    const tvModeToggleBtn = el('tvModeToggleBtn');
    if (tvModeToggleBtn) {
      // Set initial state from localStorage
      const isTvMode = localStorage.getItem('tvMode') === 'true';
      if (isTvMode) {
        tvModeToggleBtn.classList.add('active');
      }
      
      tvModeToggleBtn.addEventListener('click', function() {
        const currentMode = localStorage.getItem('tvMode') === 'true';
        const newMode = !currentMode;
        
        // Save to localStorage
        localStorage.setItem('tvMode', newMode.toString());
        
        // Toggle class on html element
        if (newMode) {
          document.documentElement.classList.add('tv-mode');
          tvModeToggleBtn.classList.add('active');
        } else {
          document.documentElement.classList.remove('tv-mode');
          tvModeToggleBtn.classList.remove('active');
        }
        
        console.log('TV Mode:', newMode ? 'ON' : 'OFF');
      });
    }

    // Help Modal
    const helpBtn = document.querySelector('.help-btn');
    if (helpBtn) {
      helpBtn.addEventListener('click', toggleHelp);
    }

    const helpClose = document.querySelector('.help-close');
    if (helpClose) {
      helpClose.addEventListener('click', toggleHelp);
    }

    const helpModal = el('helpModal');
    if (helpModal) {
      helpModal.addEventListener('click', function(event) {
        if (event.target === this) {
          toggleHelp();
        }
      });
    }

    // Order Queue
    const orderQueueToggleBtn = el('orderQueueToggleBtn');
    if (orderQueueToggleBtn) {
      orderQueueToggleBtn.addEventListener('click', toggleOrderQueue);
    }

    const currentOrderPill = el('currentOrderPill');
    if (currentOrderPill) {
      currentOrderPill.addEventListener('click', function() {
        if (window.ScoreboardRender && window.ScoreboardRender.toggleOrderExpand) {
          window.ScoreboardRender.toggleOrderExpand('current');
        }
      });
    }

    const nextOrderPill = el('nextOrderPill');
    if (nextOrderPill) {
      nextOrderPill.addEventListener('click', function() {
        if (window.ScoreboardRender && window.ScoreboardRender.toggleOrderExpand) {
          window.ScoreboardRender.toggleOrderExpand('next');
        }
      });
    }

    // Chart Smalls Toggle
    const chartSmallsToggle = el('chartSmallsToggle');
    if (chartSmallsToggle) {
      chartSmallsToggle.addEventListener('click', function() {
        if (window.ScoreboardChart && window.ScoreboardChart.toggleSmalls) {
          window.ScoreboardChart.toggleSmalls();
        }
      });
    }

    // AVG/BEST Toggle
    const avgBestContainer = el('avgBestContainer');
    if (avgBestContainer) {
      avgBestContainer.addEventListener('click', toggleAvgBest);
    }

    const avgBestToggle = el('avgBestToggle');
    if (avgBestToggle) {
      avgBestToggle.addEventListener('click', toggleAvgBest);
    }

    // Timer Controls
    const fullscreenToggle = el('fullscreenToggle');
    if (fullscreenToggle) {
      fullscreenToggle.addEventListener('click', toggleTimerFullscreen);
    }

    const manualBtn = el('manualBtn');
    if (manualBtn) {
      manualBtn.addEventListener('click', function() {
        if (window.logManualEntry) window.logManualEntry();
      });
    }

    const pauseBtn = el('pauseBtn');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', handlePauseClick);
    }

    // Cycle History Controls — use event delegation for reliability
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('.cycle-nav-btn');
      if (btn) {
        var navBtns = document.querySelectorAll('.cycle-nav-btn');
        if (btn === navBtns[0] && window.prevCycleMode) window.prevCycleMode();
        if (btn === navBtns[1] && window.nextCycleMode) window.nextCycleMode();
        return;
      }
      var toggle = e.target.closest('#cycleToggle, .cycle-history-toggle');
      if (toggle && window.toggleCycleHistory) {
        window.toggleCycleHistory();
      }
    });

    // Pause Modal
    const pauseReasonBtns = document.querySelectorAll('.pause-reason-btn');
    pauseReasonBtns.forEach(function(btn) {
      const reasonText = btn.textContent.replace(/^[^\s]+\s+/, ''); // Remove emoji
      btn.addEventListener('click', function() {
        selectPauseReason(this, reasonText);
      });
    });

    const pauseCustomReason = el('pauseCustomReason');
    if (pauseCustomReason) {
      pauseCustomReason.addEventListener('input', onCustomReasonInput);
    }

    const pauseModalCancelBtn = document.querySelector('.pause-modal-btn.cancel');
    if (pauseModalCancelBtn) {
      pauseModalCancelBtn.addEventListener('click', closePauseModal);
    }

    const pauseConfirmBtn = el('pauseConfirmBtn');
    if (pauseConfirmBtn) {
      pauseConfirmBtn.addEventListener('click', confirmPause);
    }

    // Debug Panel (if exists)
    const debugClose = document.querySelector('.debug-close');
    if (debugClose) {
      debugClose.addEventListener('click', toggleDebug);
    }

    const debugBtns = document.querySelectorAll('.debug-buttons button');
    debugBtns.forEach(function(btn) {
      const text = btn.textContent;

      // State buttons
      if (text.includes('Green')) {
        btn.addEventListener('click', function() { setDebugState('green'); });
      } else if (text.includes('Yellow')) {
        btn.addEventListener('click', function() { setDebugState('yellow'); });
      } else if (text.includes('Red')) {
        btn.addEventListener('click', function() { setDebugState('red'); });
      } else if (text.includes('Neutral')) {
        btn.addEventListener('click', function() { setDebugState('neutral'); });
      }

      // Time simulation buttons
      else if (text.includes('Just Started')) {
        btn.addEventListener('click', function() { simulateTime(0); });
      } else if (text.includes('50%')) {
        btn.addEventListener('click', function() { simulateTime(50); });
      } else if (text.includes('85%')) {
        btn.addEventListener('click', function() { simulateTime(85); });
      } else if (text.includes('110%')) {
        btn.addEventListener('click', function() { simulateTime(110); });
      }

      // Break simulation buttons
      else if (text.includes('Working')) {
        btn.addEventListener('click', function() { simulateBreak(false); });
      } else if (text.includes('On Break')) {
        btn.addEventListener('click', function() { simulateBreak(true); });
      }

      // Celebration test buttons
      else if (text.includes('Early')) {
        btn.addEventListener('click', function() { addCycleToHistory(240, 300); });
      } else if (text.includes('On Time')) {
        btn.addEventListener('click', function() { addCycleToHistory(295, 300); });
      } else if (text.includes('Overtime')) {
        btn.addEventListener('click', function() { addCycleToHistory(360, 300); });
      } else if (text.includes('Test Sound')) {
        btn.addEventListener('click', playMariachi);
      }
    });

    const debugResetBtn = document.querySelector('.debug-reset');
    if (debugResetBtn) {
      debugResetBtn.addEventListener('click', resetDebug);
    }

    console.log('[Events] All event listeners attached');
  }

  // Expose public API
  window.ScoreboardEvents = {
    attachEventListeners: attachEventListeners
  };

})(window);
