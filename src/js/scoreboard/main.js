/**
 * Scoreboard Main Entry Point
 * Initializes all modules and sets up the application
 */
(function(window) {
  'use strict';

  // Module references
  var Config = window.ScoreboardConfig;
  var State = window.ScoreboardState;
  var DOM = window.ScoreboardDOM;
  var API = window.ScoreboardAPI;
  var I18n = window.ScoreboardI18n;
  var Timer = window.ScoreboardTimer;
  var Render = window.ScoreboardRender;
  var Chart = window.ScoreboardChart;
  var Cycle = window.ScoreboardCycle;
  var Scale = window.ScoreboardScale;

  /**
   * Update the clock display
   */
  function updateClock() {
    var now = new Date();
    var hours = now.getHours();
    var minutes = now.getMinutes();
    var ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    var timeStr = hours + ':' + String(minutes).padStart(2, '0') + ' ' + ampm;

    // Update both old and compact clock elements (backward compatibility)
    var clockEl = DOM ? DOM.get('clock') : document.getElementById('clock');
    var clockCompact = document.getElementById('clockCompact');
    if (clockEl) {
      clockEl.textContent = timeStr;
    }
    if (clockCompact) {
      clockCompact.textContent = timeStr;
    }

    // Update both old and compact date elements
    var dateEl = DOM ? DOM.get('date') : document.getElementById('date');
    var dateCompact = document.getElementById('dateCompact');
    if (dateEl || dateCompact) {
      var options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      var lang = (State && State.currentLang) || 'en';
      var dateStr = now.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', options);
      if (dateEl) dateEl.textContent = dateStr;
      if (dateCompact) dateCompact.textContent = dateStr;
    }
  }

  /**
   * Check for data updates (smart polling)
   * Only fetches full data when version changes
   */
  function checkForUpdates() {
    if (!API || !API.checkVersion) {
      // Fallback to regular load if version check not available
      loadData();
      return;
    }

    API.checkVersion(
      function(changed) {
        if (changed) {
          console.log('Data version changed, fetching fresh data...');
          loadData();
        }
      },
      function(error) {
        console.error('Version check failed, falling back to data load:', error);
        loadData();
      }
    );
  }

  /**
   * Load data from API and update state
   */
  function loadData() {
    if (!API) {
      console.error('ScoreboardAPI not available');
      return;
    }

    API.loadData(
      function(response) {
        // Update state with response data
        if (State) {
          if (response.scoreboard) {
            State.data = response.scoreboard;
          } else if (response && !response.scoreboard) {
            // Handle case where response is the scoreboard data directly
            State.data = response;
          }

          if (response.timer) {
            State.timerData = response.timer;

            // Check for new bag completion
            // API returns lastBagTime (not lastBagTimestamp)
            if (response.timer.lastBagTime) {
              var newTimestamp = new Date(response.timer.lastBagTime);
              if (!State.lastBagTimestamp ||
                  newTimestamp.getTime() !== State.lastBagTimestamp.getTime()) {
                State.lastBagTimestamp = newTimestamp;

                // Add to cycle history if we have cycle time data
                if (response.timer.lastCycleTimeSec && Cycle) {
                  var targetSec = (response.timer.targetSeconds) ||
                    ((Config && Config.timer && Config.timer.defaultTargetSeconds) || 300);
                  Cycle.addCycleToHistory(response.timer.lastCycleTimeSec, targetSec);
                }
              }
            }

            // Load cycle history from API if available
            if (response.timer.cycleHistory && Cycle) {
              var defaultTarget = (response.timer.targetSeconds) ||
                ((Config && Config.timer && Config.timer.defaultTargetSeconds) || 300);
              Cycle.loadCycleHistoryFromAPI(response.timer.cycleHistory, defaultTarget);
            }
          }

          // Sync pause state from server (cross-device sync)
          if (Timer && Timer.applyPauseState) {
            Timer.applyPauseState(response.pause);
          }
        }

        // Render the scoreboard
        if (Render && Render.renderScoreboard) {
          Render.renderScoreboard();
        }

        // Check if shift start should be locked
        if (window.ScoreboardShiftStart) {
          window.ScoreboardShiftStart.checkLockStatus();
          // Sync shift start from API (in case another device set it)
          window.ScoreboardShiftStart.syncShiftStart();
        }
      },
      function(error) {
        console.error('Failed to load data:', error);
      }
    );
  }

  /**
   * Load order queue data from API
   */
  function loadOrderQueue() {
    if (!API || !API.loadOrderQueue) {
      return;
    }

    API.loadOrderQueue(
      function(response) {
        // State is updated automatically by API.loadOrderQueue
        // Now render the order queue UI
        if (Render && Render.renderOrderQueue) {
          Render.renderOrderQueue();
        }
      },
      function(error) {
        console.error('Failed to load order queue:', error);
      }
    );
  }

  /**
   * Set the display language
   * @param {string} lang - Language code ('en' or 'es')
   */
  function setLanguage(lang) {
    if (I18n) {
      I18n.setLang(lang);
    }
    if (State) {
      State.currentLang = lang;
    }

    // Update language button states
    var btnEn = DOM ? DOM.get('btnEn') : document.getElementById('btnEn');
    var btnEs = DOM ? DOM.get('btnEs') : document.getElementById('btnEs');

    if (btnEn && btnEs) {
      btnEn.classList.toggle('active', lang === 'en');
      btnEs.classList.toggle('active', lang === 'es');
    }

    // Re-render with new language
    if (Render && Render.renderScoreboard) {
      Render.renderScoreboard();
    }

    // Update clock date format
    updateClock();
  }

  /**
   * Toggle help modal
   */
  function toggleHelp() {
    var modal = DOM ? DOM.get('helpModal') : document.getElementById('helpModal');
    if (modal) {
      modal.classList.toggle('visible');
    }
  }

  /**
   * Initialize the scoreboard application
   */
  function init() {
    console.log('Scoreboard initializing...');

    // Detect if running inside an iframe and add embed class
    try {
      if (window.self !== window.top) {
        document.body.classList.add('iframe-embed');
        console.log('Scoreboard running in iframe - embed mode enabled');
      }
    } catch (e) {
      // Cross-origin iframe - assume embedded
      document.body.classList.add('iframe-embed');
    }

    // Load cycle display mode from localStorage
    if (Cycle && Cycle.loadCycleMode) {
      Cycle.loadCycleMode();
    }

    // Load cycle history from localStorage
    if (Cycle && Cycle.loadLocalCycleHistory && State) {
      State.cycleHistory = Cycle.loadLocalCycleHistory();
    }

    // Initialize order queue visibility from localStorage
    initOrderQueueVisibility();

    // Initialize chart visibility from localStorage
    initChartVisibility();

    // Initialize AVG/BEST visibility from localStorage
    initAvgBestVisibility();

    // Initial clock update
    updateClock();

    // Get intervals from config or use defaults
    var clockInterval = (Config && Config.intervals && Config.intervals.clockRefresh) || 1000;
    var versionCheckInterval = (Config && Config.intervals && Config.intervals.versionCheck) || 5000; // Smart polling every 5s
    var timerInterval = (Config && Config.intervals && Config.intervals.timerRefresh) || 1000;

    // Register intervals using State's interval registry if available
    if (State && State.registerInterval) {
      State.registerInterval(updateClock, clockInterval);
      State.registerInterval(checkForUpdates, versionCheckInterval); // Smart polling
      if (Timer && Timer.renderTimer) {
        State.registerInterval(Timer.renderTimer, timerInterval);
      }
    } else {
      // Fallback to direct setInterval
      setInterval(updateClock, clockInterval);
      setInterval(checkForUpdates, versionCheckInterval); // Smart polling
      if (Timer && Timer.renderTimer) {
        setInterval(Timer.renderTimer, timerInterval);
      }
    }

    // Initial data load (always fetch on page load)
    loadData();

    // Initial order queue load
    loadOrderQueue();

    // Register order queue loading interval (less frequent since it changes rarely)
    var orderQueueInterval = (Config && Config.intervals && Config.intervals.orderQueueRefresh) || 30000; // 30 seconds
    if (State && State.registerInterval) {
      State.registerInterval(loadOrderQueue, orderQueueInterval);
    } else {
      setInterval(loadOrderQueue, orderQueueInterval);
    }

    // Initial cycle history render
    if (Cycle && Cycle.renderCycleHistory) {
      Cycle.renderCycleHistory();
    }

    // Initialize scale module (1-second polling for live weight)
    if (Scale && Scale.init) {
      Scale.init();
    }

    console.log('Scoreboard initialized successfully');
  }

  /**
   * Toggle date picker for historical view
   */
  function toggleDatePicker() {
    var datePicker = DOM ? DOM.get('historicalDatePicker') : document.getElementById('historicalDatePicker');
    if (datePicker) {
      datePicker.showPicker();
    }
  }

  /**
   * Load historical data for a specific date
   * @param {string} dateStr - Date string in YYYY-MM-DD format
   */
  function loadHistoricalDate(dateStr) {
    if (!dateStr || !API) return;

    console.log('Loading historical data for:', dateStr);

    // Update UI to show historical date banner
    var banner = DOM ? DOM.get('historicalDateBanner') : document.getElementById('historicalDateBanner');
    var dateDisplay = DOM ? DOM.get('historicalDateDisplay') : document.getElementById('historicalDateDisplay');
    var liveBtn = DOM ? DOM.get('historicalViewBtn') : document.getElementById('historicalViewBtn');

    if (banner && dateDisplay) {
      // Format date for display
      var date = new Date(dateStr + 'T12:00:00');
      var lang = (State && State.currentLang) || 'en';
      var options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      dateDisplay.textContent = date.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', options);
      banner.style.display = 'flex';
    }

    // Hide the live view button when viewing historical data
    if (liveBtn) {
      liveBtn.style.display = 'none';
    }

    // Store historical date in state
    if (State) {
      State.historicalDate = dateStr;
    }

    // Load data with date parameter
    if (API.loadData) {
      API.loadData(
        function(response) {
          // Update state with response data
          if (State) {
            if (response.scoreboard) {
              State.data = response.scoreboard;
            } else if (response && !response.scoreboard) {
              State.data = response;
            }

            if (response.timer) {
              State.timerData = response.timer;

              // Load cycle history from API if available
              if (response.timer.cycleHistory && Cycle) {
                var defaultTarget = (response.timer.targetSeconds) ||
                  ((Config && Config.timer && Config.timer.defaultTargetSeconds) || 300);
                Cycle.loadCycleHistoryFromAPI(response.timer.cycleHistory, defaultTarget);
              }
            }
          }

          // Render the scoreboard
          if (Render && Render.renderScoreboard) {
            Render.renderScoreboard();
          }
        },
        function(error) {
          console.error('Failed to load historical data:', error);
        },
        dateStr // Pass date as parameter
      );
    }
  }

  /**
   * Clear historical date and return to live view
   */
  function clearHistoricalDate() {
    console.log('Returning to live view');

    // Hide historical date banner
    var banner = DOM ? DOM.get('historicalDateBanner') : document.getElementById('historicalDateBanner');
    var liveBtn = DOM ? DOM.get('historicalViewBtn') : document.getElementById('historicalViewBtn');

    if (banner) {
      banner.style.display = 'none';
    }

    // Show the live view button again
    if (liveBtn) {
      liveBtn.style.display = 'flex';
    }

    // Clear historical date from state
    if (State) {
      State.historicalDate = null;
    }

    // Reload current data
    loadData();
  }

  /**
   * Toggle order queue visibility
   */
  function toggleOrderQueue() {
    var section = DOM ? DOM.get('orderQueueSection') : document.getElementById('orderQueueSection');
    var toggleBtn = DOM ? DOM.get('orderQueueToggleBtn') : document.getElementById('orderQueueToggleBtn');

    if (!section) return;

    // Get current state
    var isVisible = localStorage.getItem('orderQueueVisible') === 'true';

    // Toggle state
    var newState = !isVisible;
    localStorage.setItem('orderQueueVisible', newState.toString());

    // Update UI
    if (newState) {
      section.style.display = 'flex';
      if (toggleBtn) toggleBtn.classList.add('active');
    } else {
      section.style.display = 'none';
      if (toggleBtn) toggleBtn.classList.remove('active');
    }

    console.debug('Order queue toggled:', newState ? 'visible' : 'hidden');
  }

  /**
   * Initialize order queue visibility from localStorage
   */
  function initOrderQueueVisibility() {
    var section = DOM ? DOM.get('orderQueueSection') : document.getElementById('orderQueueSection');
    var toggleBtn = DOM ? DOM.get('orderQueueToggleBtn') : document.getElementById('orderQueueToggleBtn');

    if (!section) return;

    // Default to HIDDEN if not set (changed from true)
    var isVisible = localStorage.getItem('orderQueueVisible') === 'true';

    if (isVisible) {
      section.style.display = 'flex';
      if (toggleBtn) toggleBtn.classList.add('active');
    } else {
      section.style.display = 'none';
      if (toggleBtn) toggleBtn.classList.remove('active');
    }
  }

  /**
   * Toggle AVG/BEST stats visibility
   */
  function toggleAvgBest() {
    var container = DOM ? DOM.get('avgBestContainer') : document.getElementById('avgBestContainer');
    var divider = DOM ? DOM.get('avgBestDivider') : document.getElementById('avgBestDivider');

    if (!container) return;

    // Get current state
    var isHidden = localStorage.getItem('avgBestHidden') === 'true';

    // Toggle state
    var newState = !isHidden;
    localStorage.setItem('avgBestHidden', newState.toString());

    // Update UI
    if (newState) {
      container.classList.add('hidden');
      if (divider) divider.classList.add('hidden');
    } else {
      container.classList.remove('hidden');
      if (divider) divider.classList.remove('hidden');
    }

    console.debug('AVG/BEST toggled:', newState ? 'hidden' : 'visible');
  }

  /**
   * Initialize chart visibility from localStorage
   */
  function initChartVisibility() {
    var chartContainer = document.querySelector('.chart-container');
    if (!chartContainer) return;

    // Default to HIDDEN if not set (changed from true)
    var isVisible = localStorage.getItem('chartVisible') === 'true';

    if (isVisible) {
      chartContainer.classList.add('visible');
    } else {
      chartContainer.classList.remove('visible');
    }

    console.debug('Chart initialized:', isVisible ? 'visible' : 'hidden');
  }

  /**
   * Initialize AVG/BEST visibility from localStorage
   */
  function initAvgBestVisibility() {
    var container = DOM ? DOM.get('avgBestContainer') : document.getElementById('avgBestContainer');
    var divider = DOM ? DOM.get('avgBestDivider') : document.getElementById('avgBestDivider');

    if (!container) return;

    // Default to visible if not set
    var isHidden = localStorage.getItem('avgBestHidden') === 'true';

    if (isHidden) {
      container.classList.add('hidden');
      if (divider) divider.classList.add('hidden');
    } else {
      container.classList.remove('hidden');
      if (divider) divider.classList.remove('hidden');
    }
  }

  // Expose global functions needed by inline HTML handlers
  window.setLanguage = setLanguage;
  window.toggleHelp = toggleHelp;
  window.toggleDatePicker = toggleDatePicker;
  window.loadHistoricalDate = loadHistoricalDate;
  window.clearHistoricalDate = clearHistoricalDate;
  window.toggleOrderQueue = toggleOrderQueue;
  window.toggleAvgBest = toggleAvgBest;

  // Expose timer functions for pause button handlers
  if (Timer) {
    window.handlePauseClick = Timer.handlePauseClick;
    window.selectPauseReason = Timer.selectPauseReason;
    window.onCustomReasonInput = Timer.onCustomReasonInput;
    window.confirmPause = Timer.confirmPause;
    window.closePauseModal = Timer.closePauseModal;
  }

  // Expose cycle functions for mode navigation
  if (Cycle) {
    window.nextCycleMode = function() { Cycle.nextCycleMode(); };
    window.prevCycleMode = function() { Cycle.prevCycleMode(); };
    window.toggleCycleHistory = function() { Cycle.toggleCycleHistory(); };
  }

  // Initialize on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      init();
      // Attach all event listeners after initialization
      if (window.ScoreboardEvents) {
        window.ScoreboardEvents.attachEventListeners();
      }
    });
  } else {
    // DOM already loaded
    init();
    // Attach all event listeners after initialization
    if (window.ScoreboardEvents) {
      window.ScoreboardEvents.attachEventListeners();
    }
  }

})(window);
