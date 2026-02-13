/**
 * ScoreboardRender.js
 * Main render orchestration for scoreboard UI updates
 * Dependencies: ScoreboardState, ScoreboardDOM, ScoreboardI18n, ScoreboardChart
 */
(function(window) {
  'use strict';

  /**
   * Safely get a DOM element by ID. Returns null (no throw) if missing.
   * @param {string} id - Element ID
   * @returns {HTMLElement|null}
   */
  function safeGetEl(id) {
    var el = document.getElementById(id);
    if (!el) {
      console.debug('[render] Missing element: #' + id);
    }
    return el;
  }


  var ScoreboardRender = {
    /**
     * Main render function - updates all scoreboard UI elements
     * Uses ScoreboardState.data for all metrics
     */
    renderScoreboard: function() {
      const data = window.ScoreboardState ? window.ScoreboardState.data : null;
      if (!data) return;

      const currentLang = (window.ScoreboardState && window.ScoreboardState.currentLang) || 'en';
      const t = window.ScoreboardI18n ? window.ScoreboardI18n.t : function(key) { return key; };

      // Apply shift adjustment if exists (use raw API target, don't compound)
      if (window.ScoreboardState && window.ScoreboardState.shiftAdjustment) {
        var adjustment = window.ScoreboardState.shiftAdjustment;
        data.dailyGoal = adjustment.adjustedDailyGoal || data.dailyGoal;
        // Don't override effectiveHours — API value tracks actual hours worked
        // adjustment.availableHours is total available hours, not hours worked

        // Apply scale factor to the ORIGINAL target, not the already-scaled one
        var scaleFactor = adjustment.scaleFactor || 1;
        var rawTarget = window.ScoreboardState._rawTodayTarget;
        if (rawTarget === undefined || rawTarget === null) {
          // First time: store the raw API value before scaling
          rawTarget = data.todayTarget || 0;
          window.ScoreboardState._rawTodayTarget = rawTarget;
        }
        data.todayTarget = rawTarget * scaleFactor;
      }

      // Extract data values
      const lastHourLbs = data.lastHourLbs || 0;
      const lastHourTarget = data.lastHourTarget || 0;
      const lastHourTrimmers = data.lastHourTrimmers || 0;
      const lastTimeSlot = data.lastTimeSlot || '—';
      const currentHourTrimmers = data.currentHourTrimmers || 0;
      const currentHourTarget = data.currentHourTarget || 0;
      const currentTimeSlot = data.currentTimeSlot || '';
      const targetRate = data.targetRate || 0;
      const strain = data.strain || '—';
      const todayLbs = data.todayLbs || 0;
      const todayTarget = data.todayTarget || 0;
      const todayPct = data.todayPercentage || 0;
      const hoursLogged = data.hoursLogged || 0;
      const avgPct = data.avgPercentage || 0;
      const bestPct = data.bestPercentage || 0;
      const streak = data.streak || 0;
      const lastHourPct = lastHourTarget > 0 ? (lastHourLbs / lastHourTarget) * 100 : 0;
      const lastHourDelta = lastHourLbs - lastHourTarget;
      const statusPct = todayPct > 0 ? todayPct : avgPct;

      // Determine status
      let status = 'idle';
      let statusIcon = '⏸';
      let statusKey = 'waiting';
      if (todayLbs > 0 || lastHourLbs > 0) {
        if (statusPct >= 105) {
          status = 'ahead';
          statusIcon = '🔥';
          statusKey = 'aheadOfTarget';
        } else if (statusPct >= 90) {
          status = 'on-target';
          statusIcon = '✓';
          statusKey = 'onTarget';
        } else if (statusPct > 0) {
          status = 'behind';
          statusIcon = '⚠';
          statusKey = 'behindTarget';
        }
      }

      // Update status classes without overriding timer background
      document.body.classList.remove('ahead', 'on-target', 'behind', 'idle');
      document.body.classList.add(status);

      // Update status display
      var _el = safeGetEl('statusIcon'); if (_el) _el.textContent = statusIcon;
      var _el = safeGetEl('statusText'); if (_el) _el.textContent = t(statusKey);

      // Last hour card
      var _el = safeGetEl('lastHourLbs'); if (_el) _el.textContent = lastHourLbs > 0 ? lastHourLbs.toFixed(1) : '—';
      var _el = safeGetEl('lastHourTarget'); if (_el) _el.textContent = lastHourTarget > 0 ? lastHourTarget.toFixed(1) : '—';
      var _el = safeGetEl('lastHourTimeslot'); if (_el) _el.textContent = lastTimeSlot;

      // Show lbs delta instead of percentage
      const lhp = safeGetEl('lastHourPct');
      if (lhp && lastHourTarget > 0) {
        const deltaAbs = Math.abs(lastHourDelta).toFixed(1);
        if (lastHourDelta >= 0.05) {
          lhp.textContent = `+${deltaAbs} lbs`;
          lhp.style.color = '#7a9d87';
        } else if (lastHourDelta <= -0.05) {
          lhp.textContent = `-${deltaAbs} lbs`;
          lhp.style.color = '#f87171';
        } else {
          // On pace - use i18n translation
          var I18n = window.ScoreboardI18n;
          lhp.textContent = I18n ? I18n.t('onPace') : 'On pace';
          lhp.style.color = '#e4aa4f';
        }
      } else {
        lhp.textContent = '—';
        lhp.style.color = 'rgba(255,255,255,0.5)';
      }

      // Current hour card
      const chc = safeGetEl('currentHourCard');
      if (chc && currentHourTrimmers > 0) {
        chc.style.display = 'block';
        var _el = safeGetEl('currentHourTrimmers'); if (_el) _el.textContent = currentHourTrimmers;
        var _el = safeGetEl('currentHourTimeslot'); if (_el) _el.textContent = currentTimeSlot;
        var _el = safeGetEl('currentHourTargetLbs'); if (_el) _el.textContent = currentHourTarget > 0 ? currentHourTarget.toFixed(1) : '—';
      } else {
        if (chc) chc.style.display = 'none';
      }

      // Render the hourly chart
      if (window.ScoreboardChart) {
        window.ScoreboardChart.renderHourlyChart(data.hourlyRates, targetRate);
      }

      // Daily progress
      var _el = safeGetEl('dailyActual'); if (_el) _el.textContent = todayLbs > 0 ? todayLbs.toFixed(1) : '—';
      var _el = safeGetEl('dailyTarget'); if (_el) _el.textContent = todayTarget > 0 ? todayTarget.toFixed(1) : '—';

      const todayDelta = data.todayDelta || 0;
      const dde = safeGetEl('dailyDelta');
      if (dde && todayTarget > 0) {
        const da = Math.abs(todayDelta).toFixed(1);
        if (todayDelta >= 0.05) {
          dde.textContent = `↑ +${da} lbs`;
          dde.className = 'daily-delta positive';
        } else if (todayDelta <= -0.05) {
          dde.textContent = `↓ -${da} lbs`;
          dde.className = 'daily-delta negative';
        } else {
          dde.textContent = `= 0.0 lbs`;
          dde.className = 'daily-delta neutral';
        }
      } else if (dde) {
        dde.textContent = '—';
        dde.className = 'daily-delta neutral';
      }

      // Progress hours
      const effectiveHours = data.effectiveHours || hoursLogged;
      var _el = safeGetEl('progressHours'); if (_el) _el.textContent = `${effectiveHours.toFixed(1)} ${t('hrs')}`;
      var _el = safeGetEl('progressFill'); if (_el) _el.style.width = `${Math.min(100, todayPct || avgPct || 0)}%`;

      // Projection
      const projectedTotal = data.projectedTotal || 0;
      const dailyGoal = data.dailyGoal || 0;
      const projectedDelta = data.projectedDelta || 0;

      var _el = safeGetEl('projectionLabel'); if (_el) _el.textContent = t('endOfDay');
      var _el = safeGetEl('projectionValue'); if (_el) _el.textContent = projectedTotal > 0 ? projectedTotal.toFixed(1) : '—';
      var _el = safeGetEl('projectionGoal'); if (_el) _el.textContent = dailyGoal > 0 ? `/ ${dailyGoal.toFixed(1)} ${t('lbsGoal')}` : '';

      const pde = safeGetEl('projectionDelta');
      if (pde && dailyGoal > 0 && projectedTotal > 0) {
        const pda = Math.abs(projectedDelta).toFixed(1);
        if (projectedDelta >= 0.5) {
          pde.textContent = `↑ +${pda}`;
          pde.className = 'projection-delta positive';
        } else if (projectedDelta <= -0.5) {
          pde.textContent = `↓ -${pda}`;
          pde.className = 'projection-delta negative';
        } else {
          pde.textContent = '= On pace';
          pde.className = 'projection-delta neutral';
        }
      } else if (pde) {
        pde.textContent = '—';
        pde.className = 'projection-delta neutral';
      }

      // Comparison pills
      this.renderComparison('vsYesterday', data.vsYesterday);
      this.renderComparison('vs7Day', data.vs7Day);

      // Streak pill
      var _el = safeGetEl('streakPill'); if (_el) _el.style.display = streak >= 2 ? 'flex' : 'none';
      var _el = safeGetEl('streakValue'); if (_el) _el.textContent = streak;

      // Crew and rate info
      const displayTrimmers = currentHourTrimmers > 0 ? currentHourTrimmers : lastHourTrimmers;
      var _el = safeGetEl('crewCount'); if (_el) _el.textContent = displayTrimmers > 0 ? displayTrimmers : '—';
      var _el = safeGetEl('targetRate'); if (_el) _el.textContent = targetRate > 0 ? targetRate.toFixed(2) : '—';
      var _el = safeGetEl('strainName'); if (_el) _el.textContent = strain || '—';

      // Performance deltas
      const avgEl = safeGetEl('avgPercentage');
      const bestEl = safeGetEl('bestHour');

      if (data.avgDelta !== undefined && data.avgDelta !== 0) {
        avgEl.textContent = (data.avgDelta >= 0 ? '+' : '') + data.avgDelta.toFixed(1);
        avgEl.style.color = data.avgDelta >= 0.05 ? '#7a9d87' : data.avgDelta <= -0.05 ? '#f87171' : '#e4aa4f';
      } else if (data.avgDelta === 0) {
        avgEl.textContent = '0';
        avgEl.style.color = '#e4aa4f';
      } else {
        avgEl.textContent = '—';
        avgEl.style.color = 'rgba(255,255,255,0.9)';
      }

      if (data.bestDelta !== undefined && data.bestDelta !== 0) {
        bestEl.textContent = (data.bestDelta >= 0 ? '+' : '') + data.bestDelta.toFixed(1);
        bestEl.style.color = data.bestDelta >= 0.05 ? '#7a9d87' : data.bestDelta <= -0.05 ? '#f87171' : '#e4aa4f';
      } else if (data.bestDelta === 0) {
        bestEl.textContent = '0';
        bestEl.style.color = '#e4aa4f';
      } else {
        bestEl.textContent = '—';
        bestEl.style.color = 'rgba(255,255,255,0.9)';
      }

      // Momentum arrow — compare current cycle rate vs rolling average
      const momentumEl = safeGetEl('momentumArrow');
      if (momentumEl) {
        const cycles = window.ScoreboardState ? window.ScoreboardState.cycleHistory : [];
        const completedCycles = cycles.filter(function(c) { return c.time > 0 && c.target > 0; });
        if (completedCycles.length >= 2) {
          const avgTime = completedCycles.reduce(function(sum, c) { return sum + c.time; }, 0) / completedCycles.length;
          const lastCycle = completedCycles[completedCycles.length - 1];
          // Lower time = faster = accelerating
          if (lastCycle.time < avgTime * 0.95) {
            momentumEl.textContent = '\u2197'; // ↗ accelerating
          } else if (lastCycle.time > avgTime * 1.05) {
            momentumEl.textContent = '\u2198'; // ↘ decelerating
          } else {
            momentumEl.textContent = '\u2192'; // → steady
          }
          // Inherit ambient color
          momentumEl.style.color = '';
        } else {
          momentumEl.textContent = '';
        }
      }

      // Race mode — behind target overlay
      const dailyPct = todayPct || avgPct || 0;
      if (dailyPct > 0 && dailyPct < 90 && (todayLbs > 0 || lastHourLbs > 0)) {
        document.body.classList.add('race-mode');
      } else {
        document.body.classList.remove('race-mode');
      }

      // Strain rate indicator
      const sri = safeGetEl('strainRateIndicator');
      if (data.usingStrainRate) {
        sri.innerHTML = `<span style="font-size:12px;color:rgba(122,157,135,0.9)">${t('strainRate')}</span>`;
      } else if (strain && strain !== '—') {
        sri.innerHTML = `<span style="font-size:12px;color:rgba(228,170,79,0.9)">${t('fallbackRate')}</span>`;
      } else {
        sri.innerHTML = '';
      }
    },

    /**
     * Update comparison pills (vsYesterday, vs7Day)
     * @param {String} prefix - Element ID prefix ('vsYesterday' or 'vs7Day')
     * @param {Number} value - Percentage comparison value
     */
    renderComparison: function(prefix, value) {
      const pill = safeGetEl(prefix + 'Pill');
      const ve = safeGetEl(prefix + 'Value');

      if (value === null || value === undefined) {
        pill.style.display = 'none';
        return;
      }

      pill.style.display = 'flex';
      const r = Math.round(value);
      ve.textContent = `${r >= 0 ? '+' : ''}${r}%`;
      ve.classList.remove('positive', 'negative', 'neutral');
      ve.classList.add(r > 2 ? 'positive' : r < -2 ? 'negative' : 'neutral');
    },

    /**
     * Render order queue section
     * Shows all items from current shipment and next order in queue
     */
    renderOrderQueue: function() {
      const orderQueue = window.ScoreboardState ? window.ScoreboardState.orderQueue : null;
      const section = safeGetEl('orderQueueSection');

      if (!section) return;

      // Hide section if no order data
      // Support both new format (currentItems[]) and old format (current)
      const hasCurrentItems = orderQueue && orderQueue.currentItems && orderQueue.currentItems.length > 0;
      const hasLegacyCurrent = orderQueue && orderQueue.current && !hasCurrentItems;
      const hasNext = orderQueue && orderQueue.next;

      if (!hasCurrentItems && !hasLegacyCurrent && !hasNext) {
        section.style.display = 'none';
        return;
      }

      // Respect user's toggle preference
      const isVisible = localStorage.getItem('orderQueueVisible') === 'true';
      if (!isVisible) {
        section.style.display = 'none';
        return;
      }

      section.style.display = 'flex';

      // Render all current items from the same shipment
      if (hasCurrentItems) {
        this.renderCurrentItems(orderQueue.currentItems);
      } else if (hasLegacyCurrent) {
        // Fallback: wrap single current item in array for backwards compatibility
        this.renderCurrentItems([orderQueue.current]);
      } else {
        var _el = safeGetEl('currentOrderPill'); if (_el) _el.style.display = 'none';
      }

      // Render next order pill (from different shipment)
      if (hasNext) {
        this.renderOrderPill('next', orderQueue.next);
      } else {
        var _el = safeGetEl('nextOrderPill'); if (_el) _el.style.display = 'none';
      }
    },

    /**
     * Render multiple current items from the same shipment
     * @param {Array} currentItems - Array of order items from the current shipment
     */
    renderCurrentItems: function(currentItems) {
      const pill = safeGetEl('currentOrderPill');
      const summary = safeGetEl('currentOrderSummary');
      const detail = safeGetEl('currentOrderDetail');
      const t = window.ScoreboardI18n ? window.ScoreboardI18n.t : function(key) { return key; };

      if (!pill || !summary) return;

      pill.style.display = 'flex';

      // Simple header: just customer name
      summary.textContent = currentItems[0].customer;

      // Hide the default progress bar container - we'll use our custom breakdown
      const progressContainer = safeGetEl('currentProgressBarContainer');
      if (progressContainer) {
        progressContainer.style.display = 'none';
      }

      // Calculate totals
      let totalCompleted = 0;
      let totalQuantity = 0;
      for (let i = 0; i < currentItems.length; i++) {
        totalCompleted += (currentItems[i].completedKg || 0);
        totalQuantity += currentItems[i].quantityKg;
      }
      const totalRemaining = totalQuantity - totalCompleted;

      // Create streamlined breakdown focused on what's LEFT to do
      let breakdownContainer = safeGetEl('currentItemsBreakdown');
      if (!breakdownContainer) {
        breakdownContainer = document.createElement('div');
        breakdownContainer.id = 'currentItemsBreakdown';
        progressContainer.parentNode.insertBefore(breakdownContainer, progressContainer.nextSibling);
      }

      // Build clean task-list style breakdown
      let breakdownHTML = '<div style="display: flex; flex-direction: column; gap: 6px; margin-top: 4px;">';

      for (let i = 0; i < currentItems.length; i++) {
        const item = currentItems[i];
        const completed = item.completedKg || 0;
        const remaining = item.quantityKg - completed;
        const percent = item.quantityKg > 0 ? (completed / item.quantityKg) * 100 : 0;
        const isComplete = percent >= 100;

        // Status icon and color
        const icon = isComplete ? '✓' : '○';
        const iconColor = isComplete ? '#7a9d87' : '#e4aa4f';
        const textStyle = isComplete ? 'text-decoration: line-through; opacity: 0.6;' : '';

        // Mini progress bar
        const barWidth = Math.min(100, percent);
        const barColor = isComplete ? '#7a9d87' : '#e4aa4f';

        breakdownHTML += '<div style="display: flex; align-items: center; gap: 10px; font-size: 14px;">';
        breakdownHTML += '<span style="color: ' + iconColor + '; font-size: 16px;">' + icon + '</span>';
        breakdownHTML += '<span style="flex: 1; color: #fff; ' + textStyle + '">' + item.strain + '</span>';

        if (isComplete) {
          breakdownHTML += '<span style="color: #7a9d87; font-weight: 500;">' + completed + '/' + item.quantityKg + ' Done!</span>';
        } else {
          breakdownHTML += '<span style="color: #e4aa4f; font-weight: 600;">' + completed + '/' + item.quantityKg + ' <span style="opacity: 0.8;">' + remaining + 'kg left</span></span>';
        }
        breakdownHTML += '</div>';

        // Mini progress bar for each item
        breakdownHTML += '<div style="height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; margin: -2px 0 2px 26px;">';
        breakdownHTML += '<div style="height: 100%; width: ' + barWidth + '%; background: ' + barColor + '; border-radius: 2px;"></div>';
        breakdownHTML += '</div>';
      }

      // Total remaining footer
      breakdownHTML += '<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; font-size: 13px;">';
      breakdownHTML += '<span style="color: rgba(255,255,255,0.7);">Total remaining:</span>';
      breakdownHTML += '<span style="color: #e4aa4f; font-weight: 600;">' + totalRemaining + 'kg</span>';
      breakdownHTML += '</div>';

      breakdownHTML += '</div>';
      breakdownContainer.innerHTML = breakdownHTML;

      // Build expanded detail with individual item progress
      if (detail) {
        let detailHTML = '<div class="order-detail-section">';
        detailHTML += '<div class="order-detail-row"><span class="order-detail-label">' + t('order') + ':</span> <span class="order-detail-value">' + currentItems[0].masterOrderId + '</span></div>';
        detailHTML += '<div class="order-detail-row"><span class="order-detail-label">' + t('shipment') + ':</span> <span class="order-detail-value">' + currentItems[0].shipmentId + '</span></div>';
        detailHTML += '<div class="order-detail-row"><span class="order-detail-label">' + t('customer') + ':</span> <span class="order-detail-value">' + currentItems[0].customer + '</span></div>';
        detailHTML += '<div class="order-detail-row"><span class="order-detail-label">' + t('dueDate') + ':</span> <span class="order-detail-value">' + (currentItems[0].dueDate || '—') + '</span></div>';

        // Show individual strain progress
        detailHTML += '<div class="order-detail-divider"></div>';
        detailHTML += '<div class="order-detail-row"><span class="order-detail-label">Items:</span></div>';
        for (let i = 0; i < currentItems.length; i++) {
          const item = currentItems[i];
          const pct = Math.round(item.percentComplete || 0);
          detailHTML += '<div class="order-detail-row"><span class="order-detail-value">• ' + item.strain + ': ' + (item.completedKg || 0) + '/' + item.quantityKg + 'kg (' + pct + '%)</span></div>';
        }

        detailHTML += '</div>';
        detail.innerHTML = detailHTML;
      }
    },

    /**
     * Render individual order pill
     * @param {string} type - 'current' or 'next'
     * @param {Object} orderData - Order data object
     */
    renderOrderPill: function(type, orderData) {
      const pill = safeGetEl(type + 'OrderPill');
      const summary = safeGetEl(type + 'OrderSummary');
      const detail = safeGetEl(type + 'OrderDetail');
      const t = window.ScoreboardI18n ? window.ScoreboardI18n.t : function(key) { return key; };

      if (!pill || !summary) return;

      pill.style.display = 'flex';

      // Build summary text: "Cherry Wine Tops (30kg) • Acme Corp"
      const summaryText = `${orderData.strain} ${orderData.type} (${orderData.quantityKg}kg) • ${orderData.customer}`;
      summary.textContent = summaryText;

      // Render progress bar for current order only
      if (type === 'current' && orderData.completedKg !== undefined) {
        const progressContainer = safeGetEl('currentProgressBarContainer');
        const progressFill = safeGetEl('currentProgressFill');
        const progressText = safeGetEl('currentProgressText');

        if (progressContainer && progressFill && progressText) {
          progressContainer.style.display = 'flex';
          const percent = orderData.percentComplete || 0;
          progressFill.style.width = percent + '%';
          progressText.textContent = `${orderData.completedKg || 0} / ${orderData.quantityKg} kg (${Math.round(percent)}%)`;
        }
      }

      // Build expanded detail content
      if (detail) {
        let detailHTML = '';

        detailHTML += '<div class="order-detail-section">';
        detailHTML += `<div class="order-detail-row"><span class="order-detail-label">${t('order')}:</span> <span class="order-detail-value">${orderData.masterOrderId}</span></div>`;
        detailHTML += `<div class="order-detail-row"><span class="order-detail-label">${t('shipment')}:</span> <span class="order-detail-value">${orderData.shipmentId}</span></div>`;
        detailHTML += `<div class="order-detail-row"><span class="order-detail-label">${t('customer')}:</span> <span class="order-detail-value">${orderData.customer}</span></div>`;
        detailHTML += `<div class="order-detail-row"><span class="order-detail-label">${t('dueDate')}:</span> <span class="order-detail-value">${orderData.dueDate || '—'}</span></div>`;

        if (type === 'current' && orderData.estimatedHoursRemaining !== undefined) {
          detailHTML += `<div class="order-detail-row"><span class="order-detail-label">${t('estCompletion')}:</span> <span class="order-detail-value">~${orderData.estimatedHoursRemaining} hours</span></div>`;
        }

        if (orderData.fullOrderContext) {
          detailHTML += '<div class="order-detail-divider"></div>';
          detailHTML += `<div class="order-detail-row"><span class="order-detail-label">${t('fullOrder')}:</span></div>`;
          detailHTML += `<div class="order-detail-row"><span class="order-detail-value">• Total: ${orderData.fullOrderContext.totalKg}kg (${orderData.fullOrderContext.totalShipments} shipments)</span></div>`;
          detailHTML += `<div class="order-detail-row"><span class="order-detail-value">• Completed: ${orderData.fullOrderContext.totalCompletedKg}kg</span></div>`;
        }

        detailHTML += '</div>';

        detail.innerHTML = detailHTML;
      }
    },

    /**
     * Toggle order pill expand/collapse
     * @param {string} type - 'current' or 'next'
     */
    toggleOrderExpand: function(type) {
      const state = window.ScoreboardState;
      if (!state) return;

      const pill = safeGetEl(type + 'OrderPill');
      const detail = safeGetEl(type + 'OrderDetail');

      if (!pill || !detail) return;

      if (state.expandedOrder === type) {
        // Collapse
        pill.classList.remove('expanded');
        detail.style.display = 'none';
        state.expandedOrder = null;
      } else {
        // Collapse any other expanded pills
        const allPills = document.querySelectorAll('.order-pill');
        allPills.forEach(function(p) {
          p.classList.remove('expanded');
        });
        const allDetails = document.querySelectorAll('.order-detail');
        allDetails.forEach(function(d) {
          d.style.display = 'none';
        });

        // Expand this pill
        pill.classList.add('expanded');
        detail.style.display = 'block';
        state.expandedOrder = type;
      }
    }
  };

  // Export to global scope
  window.ScoreboardRender = ScoreboardRender;

})(window);
