/**
 * Cycle History Module
 * Manages bag cycle tracking with 5 visualization modes
 */
(function(window) {
  'use strict';

  const ScoreboardCycle = {
    // ========================================
    // Mode Management
    // ========================================

    /**
     * Load cycle display mode from localStorage
     */
    loadCycleMode: function() {
      const storageKey = (ScoreboardConfig && ScoreboardConfig.storage && ScoreboardConfig.storage.cycleDisplayMode) || 'cycleDisplayMode';
      const saved = localStorage.getItem(storageKey);
      if (saved !== null) {
        const mode = parseInt(saved, 10);
        const modes = (ScoreboardConfig && ScoreboardConfig.cycleModes) || [];
        if (mode >= 0 && mode < modes.length) {
          ScoreboardState.cycleDisplayMode = mode;
        }
      }
    },

    /**
     * Save cycle display mode to localStorage
     */
    saveCycleMode: function() {
      const storageKey = (ScoreboardConfig && ScoreboardConfig.storage && ScoreboardConfig.storage.cycleDisplayMode) || 'cycleDisplayMode';
      localStorage.setItem(
        storageKey,
        ScoreboardState.cycleDisplayMode.toString()
      );
    },

    /**
     * Cycle to next display mode
     */
    nextCycleMode: function() {
      const modes = (ScoreboardConfig && ScoreboardConfig.cycleModes) || ['Donut', 'Bars', 'Grid', 'Cards', 'List'];
      ScoreboardState.cycleDisplayMode =
        (ScoreboardState.cycleDisplayMode + 1) % modes.length;
      this.saveCycleMode();
      this.renderCycleHistory();
    },

    /**
     * Cycle to previous display mode
     */
    prevCycleMode: function() {
      const modes = (ScoreboardConfig && ScoreboardConfig.cycleModes) || ['Donut', 'Bars', 'Grid', 'Cards', 'List'];
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
        const storageKey = (ScoreboardConfig && ScoreboardConfig.storage && ScoreboardConfig.storage.cycleHistory) || 'cycleHistory';
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
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
        const toSave = cycles.slice(-50);
        const storageKey = (ScoreboardConfig && ScoreboardConfig.storage && ScoreboardConfig.storage.cycleHistory) || 'cycleHistory';
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

      const panel = ScoreboardDOM ? ScoreboardDOM.get('cycleHistoryPanel') : document.getElementById('cycleHistoryPanel');
      const btn = ScoreboardDOM ? ScoreboardDOM.get('cycleHistoryToggle') : document.getElementById('cycleHistoryToggle');

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
      const cycle = {
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
      // API is the single source of truth - no localStorage merge
      const converted = apiCycles.map(function(c) {
        const cycleTime = c.cycleTime || c.cycleTimeSec || c.time || 0;
        const target = c.target || c.targetSec || defaultTarget;
        return {
          time: cycleTime,
          target: target,
          timestamp: c.timestamp || Date.now(),
          isEarly: cycleTime <= target,
          isCarryover: c.isCarryover || false
        };
      });

      // Use API data directly (sorted by timestamp)
      ScoreboardState.cycleHistory = converted.sort(function(a, b) {
        return new Date(a.timestamp) - new Date(b.timestamp);
      });

      // Always render - renderCycleHistory handles auto-expand/collapse
      this.renderCycleHistory();
    },

    // ========================================
    // Rendering Dispatcher
    // ========================================

    /**
     * Render cycle history based on current display mode
     */
    renderCycleHistory: function() {
      const container = ScoreboardDOM ? ScoreboardDOM.get('cycleContent') : document.getElementById('cycleContent');
      if (!container) return;

      // Clear container
      container.innerHTML = '';

      if (ScoreboardState.cycleHistory.length === 0) {
        container.innerHTML = '<div class="cycle-empty">No cycles yet</div>';
        // Auto-collapse when empty
        if (!ScoreboardState.cycleHistoryCollapsed) {
          this.toggleCycleHistory();
        }
        return;
      } else {
        // Auto-expand when cycles exist and currently collapsed
        if (ScoreboardState.cycleHistoryCollapsed) {
          this.toggleCycleHistory();
        }
      }

      // Calculate quick stats
      const total = ScoreboardState.cycleHistory.length;
      const early = ScoreboardState.cycleHistory.filter(function(c) { return c.isEarly; }).length;
      const successRate = total > 0 ? Math.round((early / total) * 100) : 0;
      const avgTime = total > 0
        ? Math.round(ScoreboardState.cycleHistory.reduce(function(sum, c) { return sum + c.time; }, 0) / total)
        : 0;

      // Calculate velocity trend (last 3 vs previous 3)
      let trendArrow = '';
      let trendColor = '';
      if (total >= 6) {
        const recent3 = ScoreboardState.cycleHistory.slice(-3);
        const previous3 = ScoreboardState.cycleHistory.slice(-6, -3);
        const recentAvg = recent3.reduce(function(sum, c) { return sum + c.time; }, 0) / 3;
        const previousAvg = previous3.reduce(function(sum, c) { return sum + c.time; }, 0) / 3;

        if (recentAvg < previousAvg - 30) {
          trendArrow = ' ↓'; // Getting faster
          trendColor = '#4ade80';
        } else if (recentAvg > previousAvg + 30) {
          trendArrow = ' ↑'; // Getting slower
          trendColor = '#f87171';
        } else {
          trendArrow = ' →'; // Stable
          trendColor = '#facc15';
        }
      }

      // Render stats bar
      const statsBar = document.createElement('div');
      statsBar.className = 'cycle-stats-bar';
      statsBar.innerHTML =
        '<div class="cycle-stat">' +
          `<div class="cycle-stat-value">${total}</div>` +
          '<div class="cycle-stat-label">Bags</div>' +
        '</div>' +
        '<div class="cycle-stat">' +
          `<div class="cycle-stat-value">${ScoreboardTimer.formatTime(avgTime)}` +
          (trendArrow ? `<span style="color:${trendColor};font-size:14px">${trendArrow}</span>` : '') +
          '</div>' +
          '<div class="cycle-stat-label">Avg</div>' +
        '</div>' +
        '<div class="cycle-stat">' +
          `<div class="cycle-stat-value" style="color: ${successRate >= 60 ? '#4ade80' : '#f87171'}">${successRate}%</div>` +
          '<div class="cycle-stat-label">Early</div>' +
        '</div>';
      container.appendChild(statsBar);

      // Update mode label
      const modeLabel = ScoreboardDOM ? ScoreboardDOM.get('cycleModeLabel') : document.getElementById('cycleModeLabel');
      const modes = (ScoreboardConfig && ScoreboardConfig.cycleModes) || ['Donut', 'Bars', 'Grid', 'Cards', 'List'];
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
      let early = 0;
      let late = 0;
      const recent = ScoreboardState.cycleHistory.slice(-3);

      ScoreboardState.cycleHistory.forEach(function(cycle) {
        if (cycle.isEarly) {
          early++;
        } else {
          late++;
        }
      });

      const total = early + late;
      const earlyPct = total > 0 ? (early / total * 100).toFixed(1) : 0;
      const latePct = total > 0 ? (late / total * 100).toFixed(1) : 0;

      // Create wrapper matching CSS structure
      const wrapper = document.createElement('div');
      wrapper.className = 'cycle-donut';

      // Donut ring with canvas
      const ring = document.createElement('div');
      ring.className = 'cycle-donut-ring';

      const canvas = document.createElement('canvas');
      canvas.width = 90;
      canvas.height = 90;
      ring.appendChild(canvas);

      // Center overlay
      const center = document.createElement('div');
      center.className = 'cycle-donut-center';
      center.innerHTML = `<div class="cycle-donut-count">${total}</div>` +
                         `<div class="cycle-donut-label">bags</div>`;
      ring.appendChild(center);
      wrapper.appendChild(ring);

      // Draw donut
      const ctx = canvas.getContext('2d');
      const centerX = 45;
      const centerY = 45;
      const radius = 35;
      const lineWidth = 12;

      if (total > 0) {
        const earlyAngle = (early / total) * 2 * Math.PI;
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
      const stats = document.createElement('div');
      stats.className = 'cycle-donut-stats';
      stats.innerHTML =
        `<div class="cycle-donut-stat">` +
          `<span class="cycle-donut-stat-label"><span class="cycle-donut-stat-dot" style="background:#22c55e"></span>Early</span>` +
          `<span class="cycle-donut-stat-value" style="color:#4ade80">${early}</span>` +
        `</div>` +
        `<div class="cycle-donut-stat">` +
          `<span class="cycle-donut-stat-label"><span class="cycle-donut-stat-dot" style="background:#ef4444"></span>Late</span>` +
          `<span class="cycle-donut-stat-value" style="color:#f87171">${late}</span>` +
        `</div>`;

      // Latest cycles preview
      if (recent.length > 0) {
        const latest = document.createElement('div');
        latest.className = 'cycle-donut-latest';
        latest.innerHTML = '<div class="cycle-donut-latest-label">Latest</div>';
        const items = document.createElement('div');
        items.className = 'cycle-donut-latest-items';
        recent.reverse().forEach(function(c, i) {
          const bg = c.isEarly ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)';
          const color = c.isEarly ? '#4ade80' : '#f87171';
          const carryoverSymbol = c.isCarryover ? ' ⟲' : '';
          items.innerHTML += `<div class="cycle-donut-latest-item" style="background:${bg}">` +
            `<div class="cycle-donut-latest-time" style="color:${color}">${ScoreboardTimer.formatTime(c.time)}${carryoverSymbol}</div>` +
            `<div class="cycle-donut-latest-num">#${total - i}</div></div>`;
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
      const recent = ScoreboardState.cycleHistory.slice(-20);
      const times = recent.map(function(c) { return c.time; });
      const maxTime = Math.max.apply(null, times.concat([recent[0] ? recent[0].target : 300]));

      const wrapper = document.createElement('div');
      wrapper.className = 'cycle-sparkline';

      const barsContainer = document.createElement('div');
      barsContainer.className = 'cycle-sparkline-bars';

      // Add target line at 100%
      const targetLine = document.createElement('div');
      targetLine.className = 'cycle-sparkline-target';
      const targetPct = recent[0] ? (recent[0].target / maxTime * 100) : 100;
      targetLine.style.bottom = `${targetPct}%`;
      barsContainer.appendChild(targetLine);

      recent.forEach(function(cycle) {
        const bar = document.createElement('div');
        var statusClass;
        if (cycle.time <= cycle.target) {
          statusClass = 'early';
        } else if (cycle.time <= cycle.target * 1.15) {
          statusClass = 'on-time';
        } else {
          statusClass = 'overtime';
        }
        bar.className = `cycle-sparkline-bar ${statusClass}`;

        const pct = Math.min(cycle.time / maxTime * 100, 100);
        bar.style.height = `${pct}%`;

        // Tooltip
        const tooltip = document.createElement('div');
        tooltip.className = 'cycle-sparkline-tooltip';
        tooltip.textContent = ScoreboardTimer.formatTime(cycle.time);
        bar.appendChild(tooltip);

        barsContainer.appendChild(bar);
      });

      wrapper.appendChild(barsContainer);

      // Labels below
      const labels = document.createElement('div');
      labels.className = 'cycle-sparkline-labels';
      const avg = times.length > 0 ? times.reduce(function(a, b) { return a + b; }, 0) / times.length : 0;
      labels.innerHTML =
        `<span>Avg: ${ScoreboardTimer.formatTime(Math.round(avg))}</span>` +
        `<span>Target: ${ScoreboardTimer.formatTime(recent[0] ? recent[0].target : 0)}</span>`;

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
      const wrapper = document.createElement('div');
      wrapper.className = 'cycle-chips';

      const recent = ScoreboardState.cycleHistory.slice(-30);
      let earlyCount = 0, lateCount = 0;

      recent.forEach(function(cycle) {
        const chip = document.createElement('div');
        const statusClass = cycle.isEarly ? 'early' : 'overtime';
        chip.className = `cycle-chip ${statusClass}`;

        if (cycle.isEarly) earlyCount++; else lateCount++;

        const delta = cycle.time - cycle.target;
        const deltaStr = (delta >= 0 ? '+' : '-') + ScoreboardTimer.formatTime(Math.abs(delta));
        const carryoverSymbol = cycle.isCarryover ? ' ⟲' : '';

        // Tooltip
        const tooltip = document.createElement('div');
        tooltip.className = 'cycle-chip-tooltip';
        tooltip.textContent = `${ScoreboardTimer.formatTime(cycle.time)}${carryoverSymbol} (${deltaStr})`;
        chip.appendChild(tooltip);

        // Chip content (short time)
        const mins = Math.floor(cycle.time / 60);
        chip.appendChild(document.createTextNode(`${mins}m`));

        wrapper.appendChild(chip);
      });

      container.appendChild(wrapper);

      // Legend
      const legend = document.createElement('div');
      legend.className = 'cycle-chips-legend';
      legend.innerHTML =
        `<div class="cycle-chips-legend-item"><span class="cycle-chips-legend-dot" style="background:#22c55e"></span>${earlyCount} early</div>` +
        `<div class="cycle-chips-legend-item"><span class="cycle-chips-legend-dot" style="background:#ef4444"></span>${lateCount} late</div>`;
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
      const wrapper = document.createElement('div');
      wrapper.className = 'cycle-cards';

      const recent = ScoreboardState.cycleHistory.slice(-10).reverse();
      const total = ScoreboardState.cycleHistory.length;

      recent.forEach(function(cycle, index) {
        const statusClass = cycle.isEarly ? 'early' : 'overtime';
        const card = document.createElement('div');
        card.className = `cycle-card ${statusClass}`;

        const delta = cycle.time - cycle.target;
        const deltaStr = (delta >= 0 ? '+' : '-') + ScoreboardTimer.formatTime(Math.abs(delta));

        // Carryover badge (prominent)
        const carryoverBadge = cycle.isCarryover ? '<span class="carryover-badge">⟲</span>' : '';

        // Trimmer count badge
        const trimmerBadge = cycle.trimmers ? `<span class="cycle-card-trimmers">${cycle.trimmers}T</span>` : '';

        // Format timestamp in 12-hour AM/PM format
        const date = new Date(cycle.timestamp);
        let hours = date.getHours();
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        const timeStr = `${hours}:${minutes} ${ampm}`;

        // Progress bar (actual vs target)
        const progressPct = cycle.target > 0 ? Math.min((cycle.time / cycle.target) * 100, 100) : 0;

        card.innerHTML =
          `<div class="cycle-card-num">#${total - index}${trimmerBadge}</div>` +
          `<div class="cycle-card-time">${ScoreboardTimer.formatTime(cycle.time)}${carryoverBadge}</div>` +
          `<div class="cycle-card-delta">${deltaStr}</div>` +
          `<div class="cycle-card-meta">${timeStr}</div>` +
          `<div class="cycle-card-progress"><div class="cycle-card-progress-bar" style="width: ${progressPct}%"></div></div>`;

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
      const list = document.createElement('div');
      list.className = 'cycle-list';

      const recent = ScoreboardState.cycleHistory.slice(-10).reverse();
      const total = ScoreboardState.cycleHistory.length;

      recent.forEach(function(cycle, index) {
        const statusClass = cycle.isEarly ? 'early' : 'overtime';
        const item = document.createElement('div');
        item.className = `cycle-item ${statusClass}`;

        const delta = cycle.time - cycle.target;
        const deltaStr = (delta >= 0 ? '+' : '-') + ScoreboardTimer.formatTime(Math.abs(delta));
        const deltaClass = cycle.isEarly ? 'early' : 'overtime';

        // Carryover badge (prominent)
        const carryoverBadge = cycle.isCarryover ? ' <span class="carryover-badge">⟲</span>' : '';

        // Trimmer count
        const trimmerInfo = cycle.trimmers ? ` <span style="opacity:0.5">(${cycle.trimmers}T)</span>` : '';

        // Format timestamp in 12-hour AM/PM format
        const date = new Date(cycle.timestamp);
        let hours = date.getHours();
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12;
        const timeStr = `${hours}:${minutes} ${ampm}`;

        item.innerHTML =
          `<span class="cycle-item-num">#${total - index}${trimmerInfo}</span>` +
          `<span class="cycle-item-time">${ScoreboardTimer.formatTime(cycle.time)}${carryoverBadge}</span>` +
          `<span class="cycle-item-delta ${deltaClass}">${deltaStr}</span>` +
          `<span class="cycle-item-completed">${timeStr}</span>`;

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
      const overlay = document.createElement('div');
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
