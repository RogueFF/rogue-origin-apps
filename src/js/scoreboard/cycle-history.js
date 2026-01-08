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
      // API returns cycleTime (not cycleTimeSec or time)
      var converted = apiCycles.map(function(c) {
        var cycleTime = c.cycleTime || c.cycleTimeSec || c.time || 0;
        var target = c.target || c.targetSec || defaultTarget;
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
      var recent = ScoreboardState.cycleHistory.slice(-3);

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

      // Create wrapper matching CSS structure
      var wrapper = document.createElement('div');
      wrapper.className = 'cycle-donut';

      // Donut ring with canvas
      var ring = document.createElement('div');
      ring.className = 'cycle-donut-ring';

      var canvas = document.createElement('canvas');
      canvas.width = 90;
      canvas.height = 90;
      ring.appendChild(canvas);

      // Center overlay
      var center = document.createElement('div');
      center.className = 'cycle-donut-center';
      center.innerHTML = '<div class="cycle-donut-count">' + total + '</div>' +
                         '<div class="cycle-donut-label">bags</div>';
      ring.appendChild(center);
      wrapper.appendChild(ring);

      // Draw donut
      var ctx = canvas.getContext('2d');
      var centerX = 45;
      var centerY = 45;
      var radius = 35;
      var lineWidth = 12;

      if (total > 0) {
        var earlyAngle = (early / total) * 2 * Math.PI;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + earlyAngle);
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = '#22c55e';
        ctx.stroke();

        if (late > 0) {
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius, -Math.PI / 2 + earlyAngle, Math.PI * 1.5);
          ctx.lineWidth = lineWidth;
          ctx.strokeStyle = '#ef4444';
          ctx.stroke();
        }
      } else {
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = '#333';
        ctx.stroke();
      }

      // Stats section
      var stats = document.createElement('div');
      stats.className = 'cycle-donut-stats';
      stats.innerHTML =
        '<div class="cycle-donut-stat">' +
          '<span class="cycle-donut-stat-label"><span class="cycle-donut-stat-dot" style="background:#22c55e"></span>Early</span>' +
          '<span class="cycle-donut-stat-value" style="color:#4ade80">' + early + '</span>' +
        '</div>' +
        '<div class="cycle-donut-stat">' +
          '<span class="cycle-donut-stat-label"><span class="cycle-donut-stat-dot" style="background:#ef4444"></span>Late</span>' +
          '<span class="cycle-donut-stat-value" style="color:#f87171">' + late + '</span>' +
        '</div>';

      // Latest cycles preview
      if (recent.length > 0) {
        var latest = document.createElement('div');
        latest.className = 'cycle-donut-latest';
        latest.innerHTML = '<div class="cycle-donut-latest-label">Latest</div>';
        var items = document.createElement('div');
        items.className = 'cycle-donut-latest-items';
        recent.reverse().forEach(function(c, i) {
          var bg = c.isEarly ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)';
          var color = c.isEarly ? '#4ade80' : '#f87171';
          items.innerHTML += '<div class="cycle-donut-latest-item" style="background:' + bg + '">' +
            '<div class="cycle-donut-latest-time" style="color:' + color + '">' + ScoreboardTimer.formatTime(c.time) + '</div>' +
            '<div class="cycle-donut-latest-num">#' + (total - i) + '</div></div>';
        });
        latest.appendChild(items);
        stats.appendChild(latest);
      }

      wrapper.appendChild(stats);
      container.appendChild(wrapper);
    },

    // ========================================
    // Mode 1: Sparkline Bar Chart
    // ========================================

    /**
     * Render sparkline bar chart of recent cycles
     * @param {HTMLElement} container - Container element
     */
    renderCycleSparkline: function(container) {
      var recent = ScoreboardState.cycleHistory.slice(-20);
      var times = recent.map(function(c) { return c.time; });
      var maxTime = Math.max.apply(null, times.concat([recent[0] ? recent[0].target : 300]));

      var wrapper = document.createElement('div');
      wrapper.className = 'cycle-sparkline';

      var barsContainer = document.createElement('div');
      barsContainer.className = 'cycle-sparkline-bars';

      // Add target line at 100%
      var targetLine = document.createElement('div');
      targetLine.className = 'cycle-sparkline-target';
      var targetPct = recent[0] ? (recent[0].target / maxTime * 100) : 100;
      targetLine.style.bottom = targetPct + '%';
      barsContainer.appendChild(targetLine);

      recent.forEach(function(cycle) {
        var bar = document.createElement('div');
        var statusClass = cycle.isEarly ? 'early' : 'overtime';
        bar.className = 'cycle-sparkline-bar ' + statusClass;

        var pct = Math.min(cycle.time / maxTime * 100, 100);
        bar.style.height = pct + '%';

        // Tooltip
        var tooltip = document.createElement('div');
        tooltip.className = 'cycle-sparkline-tooltip';
        tooltip.textContent = ScoreboardTimer.formatTime(cycle.time);
        bar.appendChild(tooltip);

        barsContainer.appendChild(bar);
      });

      wrapper.appendChild(barsContainer);

      // Labels below
      var labels = document.createElement('div');
      labels.className = 'cycle-sparkline-labels';
      var avg = times.length > 0 ? times.reduce(function(a, b) { return a + b; }, 0) / times.length : 0;
      labels.innerHTML =
        '<span>Avg: ' + ScoreboardTimer.formatTime(Math.round(avg)) + '</span>' +
        '<span>Target: ' + ScoreboardTimer.formatTime(recent[0] ? recent[0].target : 0) + '</span>';

      wrapper.appendChild(labels);
      container.appendChild(wrapper);
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
      wrapper.className = 'cycle-chips';

      var recent = ScoreboardState.cycleHistory.slice(-30);
      var earlyCount = 0, lateCount = 0;

      recent.forEach(function(cycle) {
        var chip = document.createElement('div');
        var statusClass = cycle.isEarly ? 'early' : 'overtime';
        chip.className = 'cycle-chip ' + statusClass;

        if (cycle.isEarly) earlyCount++; else lateCount++;

        var delta = cycle.time - cycle.target;
        var deltaStr = (delta >= 0 ? '+' : '-') + ScoreboardTimer.formatTime(Math.abs(delta));

        // Tooltip
        var tooltip = document.createElement('div');
        tooltip.className = 'cycle-chip-tooltip';
        tooltip.textContent = ScoreboardTimer.formatTime(cycle.time) + ' (' + deltaStr + ')';
        chip.appendChild(tooltip);

        // Chip content (short time)
        var mins = Math.floor(cycle.time / 60);
        chip.appendChild(document.createTextNode(mins + 'm'));

        wrapper.appendChild(chip);
      });

      container.appendChild(wrapper);

      // Legend
      var legend = document.createElement('div');
      legend.className = 'cycle-chips-legend';
      legend.innerHTML =
        '<div class="cycle-chips-legend-item"><span class="cycle-chips-legend-dot" style="background:#22c55e"></span>' + earlyCount + ' early</div>' +
        '<div class="cycle-chips-legend-item"><span class="cycle-chips-legend-dot" style="background:#ef4444"></span>' + lateCount + ' late</div>';
      container.appendChild(legend);
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
      wrapper.className = 'cycle-cards';

      var recent = ScoreboardState.cycleHistory.slice(-10).reverse();
      var total = ScoreboardState.cycleHistory.length;

      recent.forEach(function(cycle, index) {
        var statusClass = cycle.isEarly ? 'early' : 'overtime';
        var card = document.createElement('div');
        card.className = 'cycle-card ' + statusClass;

        var delta = cycle.time - cycle.target;
        var deltaStr = (delta >= 0 ? '+' : '-') + ScoreboardTimer.formatTime(Math.abs(delta));

        // Format timestamp
        var date = new Date(cycle.timestamp);
        var timeStr = date.getHours().toString().padStart(2, '0') + ':' +
                     date.getMinutes().toString().padStart(2, '0');

        card.innerHTML =
          '<div class="cycle-card-num">#' + (total - index) + '</div>' +
          '<div class="cycle-card-time">' + ScoreboardTimer.formatTime(cycle.time) + '</div>' +
          '<div class="cycle-card-delta">' + deltaStr + '</div>' +
          '<div class="cycle-card-meta">' + timeStr + '</div>';

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

      var recent = ScoreboardState.cycleHistory.slice(-10).reverse();
      var total = ScoreboardState.cycleHistory.length;

      recent.forEach(function(cycle, index) {
        var statusClass = cycle.isEarly ? 'early' : 'overtime';
        var item = document.createElement('div');
        item.className = 'cycle-item ' + statusClass;

        var delta = cycle.time - cycle.target;
        var deltaStr = (delta >= 0 ? '+' : '-') + ScoreboardTimer.formatTime(Math.abs(delta));
        var deltaClass = cycle.isEarly ? 'early' : 'overtime';

        item.innerHTML =
          '<span class="cycle-item-num">#' + (total - index) + '</span>' +
          '<span class="cycle-item-time">' + ScoreboardTimer.formatTime(cycle.time) + '</span>' +
          '<span class="cycle-item-delta ' + deltaClass + '">' + deltaStr + '</span>';

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
