/**
 * Cycle History Module
 * Manages bag cycle tracking with 5 visualization modes
 */
(function(window) {
  'use strict';

  var ScoreboardCycle = {
    // ========================================
    // Mode Management
    // ========================================

    /**
     * Load cycle display mode from localStorage
     */
    loadCycleMode: function() {
      var storageKey = (ScoreboardConfig && ScoreboardConfig.storage && ScoreboardConfig.storage.cycleDisplayMode) || 'cycleDisplayMode';
      var saved = localStorage.getItem(storageKey);
      if (saved !== null) {
        var mode = parseInt(saved, 10);
        var modes = (ScoreboardConfig && ScoreboardConfig.cycleModes) || [];
        if (mode >= 0 && mode < modes.length) {
          ScoreboardState.cycleDisplayMode = mode;
        }
      }
    },

    /**
     * Save cycle display mode to localStorage
     */
    saveCycleMode: function() {
      var storageKey = (ScoreboardConfig && ScoreboardConfig.storage && ScoreboardConfig.storage.cycleDisplayMode) || 'cycleDisplayMode';
      localStorage.setItem(
        storageKey,
        ScoreboardState.cycleDisplayMode.toString()
      );
    },

    /**
     * Cycle to next display mode
     */
    nextCycleMode: function() {
      var modes = (ScoreboardConfig && ScoreboardConfig.cycleModes) || ['Donut', 'Bars', 'Grid', 'Cards', 'List'];
      ScoreboardState.cycleDisplayMode =
        (ScoreboardState.cycleDisplayMode + 1) % modes.length;
      this.saveCycleMode();
      this.renderCycleHistory();
    },

    /**
     * Cycle to previous display mode
     */
    prevCycleMode: function() {
      var modes = (ScoreboardConfig && ScoreboardConfig.cycleModes) || ['Donut', 'Bars', 'Grid', 'Cards', 'List'];
      ScoreboardState.cycleDisplayMode =
        (ScoreboardState.cycleDisplayMode - 1 + modes.length) %
        modes.length;
      this.saveCycleMode();
      this.renderCycleHistory();
    },

    // ========================================
    // LocalStorage Management
    // ========================================

    /**
     * Load saved cycle history from localStorage
     * @returns {Array} Array of cycle objects
     */
    loadLocalCycleHistory: function() {
      try {
        var storageKey = (ScoreboardConfig && ScoreboardConfig.storage && ScoreboardConfig.storage.cycleHistory) || 'cycleHistory';
        var saved = localStorage.getItem(storageKey);
        if (saved) {
          var parsed = JSON.parse(saved);
          return Array.isArray(parsed) ? parsed : [];
        }
      } catch (e) {
        console.error('Error loading cycle history:', e);
      }
      return [];
    },

    /**
     * Save cycle history to localStorage
     * @param {Array} cycles - Array of cycle objects
     */
    saveLocalCycleHistory: function(cycles) {
      try {
        // Keep only last 50 cycles to avoid storage bloat
        var toSave = cycles.slice(-50);
        var storageKey = (ScoreboardConfig && ScoreboardConfig.storage && ScoreboardConfig.storage.cycleHistory) || 'cycleHistory';
        localStorage.setItem(
          storageKey,
          JSON.stringify(toSave)
        );
      } catch (e) {
        console.error('Error saving cycle history:', e);
      }
    },

    // ========================================
    // History Management
    // ========================================

    /**
     * Toggle cycle history panel visibility
     */
    toggleCycleHistory: function() {
      ScoreboardState.cycleHistoryCollapsed = !ScoreboardState.cycleHistoryCollapsed;

      var panel = ScoreboardDOM ? ScoreboardDOM.get('cycleHistoryPanel') : document.getElementById('cycleHistoryPanel');
      var btn = ScoreboardDOM ? ScoreboardDOM.get('cycleHistoryToggle') : document.getElementById('cycleHistoryToggle');

      if (panel && btn) {
        if (ScoreboardState.cycleHistoryCollapsed) {
          panel.classList.add('collapsed');
          btn.textContent = '▲';
          btn.title = 'Show Cycle History';
        } else {
          panel.classList.remove('collapsed');
          btn.textContent = '▼';
          btn.title = 'Hide Cycle History';
          this.renderCycleHistory();
        }
      }
    },

    /**
     * Add a new cycle to history
     * @param {number} cycleTimeSec - Cycle time in seconds
     * @param {number} targetSec - Target time in seconds
     */
    addCycleToHistory: function(cycleTimeSec, targetSec) {
      var cycle = {
        time: cycleTimeSec,
        target: targetSec,
        timestamp: Date.now(),
        isEarly: cycleTimeSec <= targetSec
      };

      ScoreboardState.cycleHistory.push(cycle);
      this.saveLocalCycleHistory(ScoreboardState.cycleHistory);

      // Trigger celebration if cycle was early
      if (cycle.isEarly) {
        this.triggerCelebration(true);
      }

      // Re-render if panel is visible
      if (!ScoreboardState.cycleHistoryCollapsed) {
        this.renderCycleHistory();
      }
    },

    /**
     * Load cycle history from API data
     * @param {Array} apiCycles - Cycles from API
     * @param {number} defaultTarget - Default target time in seconds
     */
    loadCycleHistoryFromAPI: function(apiCycles, defaultTarget) {
      if (!Array.isArray(apiCycles)) {
        return;
      }

      // Convert API cycles to internal format
      var converted = apiCycles.map(function(c) {
        var cycleTime = c.cycleTimeSec || c.time || 0;
        var target = c.targetSec || c.target || defaultTarget;
        return {
          time: cycleTime,
          target: target,
          timestamp: c.timestamp || Date.now(),
          isEarly: cycleTime <= target
        };
      });

      // Merge with local history, removing duplicates by timestamp
      var merged = ScoreboardState.cycleHistory.concat(converted);
      var uniqueMap = {};
      merged.forEach(function(cycle) {
        uniqueMap[cycle.timestamp] = cycle;
      });

      ScoreboardState.cycleHistory = Object.keys(uniqueMap)
        .map(function(ts) { return uniqueMap[ts]; })
        .sort(function(a, b) { return a.timestamp - b.timestamp; });

      this.saveLocalCycleHistory(ScoreboardState.cycleHistory);

      if (!ScoreboardState.cycleHistoryCollapsed) {
        this.renderCycleHistory();
      }
    },

    // ========================================
    // Rendering Dispatcher
    // ========================================

    /**
     * Render cycle history based on current display mode
     */
    renderCycleHistory: function() {
      var container = ScoreboardDOM ? ScoreboardDOM.get('cycleContent') : document.getElementById('cycleContent');
      if (!container) return;

      // Clear container
      container.innerHTML = '';

      if (ScoreboardState.cycleHistory.length === 0) {
        container.innerHTML = '<div class="cycle-empty">No cycles yet</div>';
        return;
      }

      // Update mode label
      var modeLabel = ScoreboardDOM ? ScoreboardDOM.get('cycleModeLabel') : document.getElementById('cycleModeLabel');
      var modes = (ScoreboardConfig && ScoreboardConfig.cycleModes) || ['Donut', 'Bars', 'Grid', 'Cards', 'List'];
      if (modeLabel) {
        modeLabel.textContent = modes[ScoreboardState.cycleDisplayMode];
      }

      // Dispatch to appropriate renderer
      switch (ScoreboardState.cycleDisplayMode) {
        case 0:
          this.renderCycleDonut(container);
          break;
        case 1:
          this.renderCycleSparkline(container);
          break;
        case 2:
          this.renderCycleChips(container);
          break;
        case 3:
          this.renderCycleCards(container);
          break;
        case 4:
          this.renderCycleList(container);
          break;
      }
    },

    // ========================================
    // Mode 0: Donut Chart
    // ========================================

    /**
     * Render donut chart showing early vs late cycles
     * @param {HTMLElement} container - Container element
     */
    renderCycleDonut: function(container) {
      var early = 0;
      var late = 0;

      ScoreboardState.cycleHistory.forEach(function(cycle) {
        if (cycle.isEarly) {
          early++;
        } else {
          late++;
        }
      });

      var total = early + late;
      var earlyPct = total > 0 ? (early / total * 100).toFixed(1) : 0;
      var latePct = total > 0 ? (late / total * 100).toFixed(1) : 0;

      // Create canvas for donut
      var canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 200;
      canvas.style.maxWidth = '100%';
      container.appendChild(canvas);

      var ctx = canvas.getContext('2d');
      var centerX = 100;
      var centerY = 100;
      var radius = 80;
      var lineWidth = 30;

      // Draw donut segments
      if (total > 0) {
        var earlyAngle = (early / total) * 2 * Math.PI;

        // Early segment (green)
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + earlyAngle);
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = '#4ade80';
        ctx.stroke();

        // Late segment (red)
        if (late > 0) {
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius, -Math.PI / 2 + earlyAngle, Math.PI * 1.5);
          ctx.lineWidth = lineWidth;
          ctx.strokeStyle = '#ef4444';
          ctx.stroke();
        }
      } else {
        // Empty state - gray circle
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = '#333';
        ctx.stroke();
      }

      // Center text
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 24px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(total.toString(), centerX, centerY);

      // Legend
      var legend = document.createElement('div');
      legend.className = 'cycle-donut-legend';
      legend.innerHTML =
        '<div class="cycle-legend-item">' +
        '<span class="cycle-legend-color" style="background:#4ade80"></span>' +
        '<span>Early: ' + early + ' (' + earlyPct + '%)</span>' +
        '</div>' +
        '<div class="cycle-legend-item">' +
        '<span class="cycle-legend-color" style="background:#ef4444"></span>' +
        '<span>Late: ' + late + ' (' + latePct + '%)</span>' +
        '</div>';
      container.appendChild(legend);
    },

    // ========================================
    // Mode 1: Sparkline Bar Chart
    // ========================================

    /**
     * Render sparkline bar chart of recent cycles
     * @param {HTMLElement} container - Container element
     */
    renderCycleSparkline: function(container) {
      // Show last 20 cycles
      var recent = ScoreboardState.cycleHistory.slice(-20);

      var wrapper = document.createElement('div');
      wrapper.className = 'cycle-sparkline';

      recent.forEach(function(cycle) {
        var bar = document.createElement('div');
        bar.className = 'cycle-sparkline-bar';

        var pct = Math.min(cycle.time / cycle.target * 100, 150);
        bar.style.height = pct + '%';
        bar.style.backgroundColor = cycle.isEarly ? '#4ade80' : '#ef4444';
        bar.title = ScoreboardTimer.formatTime(cycle.time) + ' (' +
                    (cycle.isEarly ? 'Early' : 'Late') + ')';

        wrapper.appendChild(bar);
      });

      container.appendChild(wrapper);

      // Stats below
      var stats = document.createElement('div');
      stats.className = 'cycle-sparkline-stats';

      var times = recent.map(function(c) { return c.time; });
      var avg = times.reduce(function(a, b) { return a + b; }, 0) / times.length;
      var min = Math.min.apply(null, times);
      var max = Math.max.apply(null, times);

      stats.innerHTML =
        '<div>Avg: ' + ScoreboardTimer.formatTime(Math.round(avg)) + '</div>' +
        '<div>Min: ' + ScoreboardTimer.formatTime(min) + '</div>' +
        '<div>Max: ' + ScoreboardTimer.formatTime(max) + '</div>';

      container.appendChild(stats);
    },

    // ========================================
    // Mode 2: Colored Chips Grid
    // ========================================

    /**
     * Render colored chips grid (compact view)
     * @param {HTMLElement} container - Container element
     */
    renderCycleChips: function(container) {
      var wrapper = document.createElement('div');
      wrapper.className = 'cycle-chips-grid';

      // Show last 50 cycles
      var recent = ScoreboardState.cycleHistory.slice(-50);

      recent.forEach(function(cycle) {
        var chip = document.createElement('div');
        chip.className = 'cycle-chip';
        chip.style.backgroundColor = cycle.isEarly ? '#4ade80' : '#ef4444';

        var delta = cycle.time - cycle.target;
        var deltaStr = (delta >= 0 ? '+' : '') + ScoreboardTimer.formatTime(Math.abs(delta));

        chip.title = ScoreboardTimer.formatTime(cycle.time) + ' (' + deltaStr + ')';
        chip.textContent = ScoreboardTimer.formatTime(cycle.time);

        wrapper.appendChild(chip);
      });

      container.appendChild(wrapper);
    },

    // ========================================
    // Mode 3: Horizontal Scroll Cards
    // ========================================

    /**
     * Render horizontal scrolling cards
     * @param {HTMLElement} container - Container element
     */
    renderCycleCards: function(container) {
      var wrapper = document.createElement('div');
      wrapper.className = 'cycle-cards-scroll';

      // Show last 10 cycles
      var recent = ScoreboardState.cycleHistory.slice(-10);

      recent.forEach(function(cycle, index) {
        var card = document.createElement('div');
        card.className = 'cycle-card';

        var delta = cycle.time - cycle.target;
        var deltaStr = (delta >= 0 ? '+' : '') + ScoreboardTimer.formatTime(Math.abs(delta));
        var deltaClass = cycle.isEarly ? 'cycle-card-delta-early' : 'cycle-card-delta-late';

        card.innerHTML =
          '<div class="cycle-card-number">#' + (recent.length - index) + '</div>' +
          '<div class="cycle-card-time">' + ScoreboardTimer.formatTime(cycle.time) + '</div>' +
          '<div class="cycle-card-target">Target: ' + ScoreboardTimer.formatTime(cycle.target) + '</div>' +
          '<div class="' + deltaClass + '">' + deltaStr + '</div>';

        wrapper.appendChild(card);
      });

      container.appendChild(wrapper);
    },

    // ========================================
    // Mode 4: Vertical List
    // ========================================

    /**
     * Render vertical list with detailed info
     * @param {HTMLElement} container - Container element
     */
    renderCycleList: function(container) {
      var list = document.createElement('div');
      list.className = 'cycle-list';

      // Show last 15 cycles, newest first
      var recent = ScoreboardState.cycleHistory.slice(-15).reverse();

      recent.forEach(function(cycle, index) {
        var item = document.createElement('div');
        item.className = 'cycle-list-item';

        var delta = cycle.time - cycle.target;
        var deltaStr = (delta >= 0 ? '+' : '') + ScoreboardTimer.formatTime(Math.abs(delta));
        var statusClass = cycle.isEarly ? 'cycle-list-status-early' : 'cycle-list-status-late';
        var statusText = cycle.isEarly ? 'Early' : 'Late';

        // Format timestamp
        var date = new Date(cycle.timestamp);
        var timeStr = date.getHours().toString().padStart(2, '0') + ':' +
                     date.getMinutes().toString().padStart(2, '0');

        item.innerHTML =
          '<div class="cycle-list-header">' +
          '<span class="cycle-list-number">#' + (ScoreboardState.cycleHistory.length - index) + '</span>' +
          '<span class="cycle-list-timestamp">' + timeStr + '</span>' +
          '</div>' +
          '<div class="cycle-list-body">' +
          '<div class="cycle-list-time">' + ScoreboardTimer.formatTime(cycle.time) + '</div>' +
          '<div class="' + statusClass + '">' + statusText + ' ' + deltaStr + '</div>' +
          '</div>';

        list.appendChild(item);
      });

      container.appendChild(list);
    },

    // ========================================
    // Celebration Effects
    // ========================================

    /**
     * Trigger celebration effects (confetti + text, no audio)
     * @param {boolean} isEarly - Whether cycle was early
     */
    triggerCelebration: function(isEarly) {
      if (!isEarly) return;

      // Confetti burst
      if (window.confetti) {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#4ade80', '#22c55e', '#16a34a', '#e4aa4f']
        });
      }

      // Show celebration text
      var overlay = document.createElement('div');
      overlay.className = 'cycle-celebration-overlay';
      overlay.innerHTML =
        '<div class="cycle-celebration-text">' +
        '<div class="cycle-celebration-emoji">🎉</div>' +
        '<div class="cycle-celebration-message">Excellent Cycle!</div>' +
        '</div>';

      document.body.appendChild(overlay);

      // Remove after animation
      setTimeout(function() {
        overlay.remove();
      }, 2000);
    }
  };

  // Expose to global scope
  window.ScoreboardCycle = ScoreboardCycle;

})(window);
