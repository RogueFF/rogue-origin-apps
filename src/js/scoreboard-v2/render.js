/**
 * ScoreboardRender.js
 * Main render orchestration for scoreboard UI updates
 * Dependencies: ScoreboardState, ScoreboardDOM, shared/i18n (window.t), ScoreboardChart
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
      const t = typeof window.t === 'function' ? window.t : function(key) { return key; };

      // Apply shift adjustment if exists (use raw API target, don't compound).
      // Today's late-start adjustment must not follow us into a historical day —
      // both the scale factor and the cached raw target belong to today only.
      const viewingHistorical = !!(window.ScoreboardState && window.ScoreboardState.historicalDate);
      if (window.ScoreboardState && window.ScoreboardState.shiftAdjustment && !viewingHistorical) {
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
      const lastHourEffTrimmers = data.lastHourEffectiveTrimmers || lastHourTrimmers;
      const lastTimeSlot = data.lastTimeSlot || '—';
      const currentHourTrimmers = data.currentHourTrimmers || 0;
      const currentHourEffTrimmers = data.currentHourEffectiveTrimmers || currentHourTrimmers;
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

      // Detect shift-ended state: production happened but no current hour and no active timer
      const _projTotal = data.projectedTotal || 0;
      const shiftEnded = todayLbs > 0 && currentHourTrimmers === 0 && !currentTimeSlot &&
        hoursLogged > 0 && (_projTotal <= 0 || Math.abs(_projTotal - todayLbs) < 0.5);
      document.body.classList.toggle('shift-ended', shiftEnded);

      // Update status classes without overriding timer background
      document.body.classList.remove('ahead', 'on-target', 'behind', 'idle');
      document.body.classList.add(status);

      // Update status display — override to COMPLETE when shift ended
      if (shiftEnded) {
        statusIcon = '✓';
        statusKey = 'shiftComplete';
      }
      var _el = safeGetEl('statusIcon'); if (_el) _el.textContent = statusIcon;
      var _el = safeGetEl('statusText'); if (_el) _el.textContent = shiftEnded ? t('shiftEnded') : t(statusKey);

      // Last hour card
      var _el = safeGetEl('lastHourLbs'); if (_el) _el.textContent = lastHourLbs > 0 ? lastHourLbs.toFixed(1) : '—';
      var _el = safeGetEl('lastHourTarget'); if (_el) _el.textContent = lastHourTarget > 0 ? lastHourTarget.toFixed(1) : '—';
      var _el = safeGetEl('lastHourTimeslot'); if (_el) _el.textContent = lastTimeSlot;

      // Show lbs delta instead of percentage
      const lhp = safeGetEl('lastHourPct');
      if (lhp && lastHourTarget > 0) {
        const deltaAbs = Math.abs(lastHourDelta).toFixed(1);
        lhp.className = '';
        if (lastHourDelta >= 0.05) {
          lhp.textContent = `+${deltaAbs} lbs`;
          lhp.classList.add('text-green');
        } else if (lastHourDelta <= -0.05) {
          lhp.textContent = `-${deltaAbs} lbs`;
          lhp.classList.add('text-red');
        } else {
          // On pace - use i18n translation
          lhp.textContent = typeof window.t === 'function' ? window.t('onPace') : 'On pace';
          lhp.classList.add('text-gold');
        }
      } else if (lhp) {
        lhp.textContent = '—';
        lhp.className = 'text-muted';
      }

      // Effective indicator on last hour
      var _el = safeGetEl('lastHourEffective'); if (_el) {
        if (lastHourTrimmers > 0 && Math.abs(lastHourEffTrimmers - lastHourTrimmers) > 0.05) {
          _el.textContent = `(eff: ${lastHourEffTrimmers.toFixed(1)} trimmers)`;
          _el.style.display = 'block';
        } else {
          _el.style.display = 'none';
        }
      }

      // Current hour card
      const chc = safeGetEl('currentHourCard');
      if (chc && currentHourTrimmers > 0) {
        chc.style.display = 'block';
        var _el = safeGetEl('currentHourTrimmers'); if (_el) _el.textContent = currentHourTrimmers;
        var _el = safeGetEl('currentHourTimeslot'); if (_el) _el.textContent = currentTimeSlot;
        var _el = safeGetEl('currentHourTargetLbs'); if (_el) _el.textContent = currentHourTarget > 0 ? currentHourTarget.toFixed(1) : '—';
        // Effective indicator on current hour
        var _el = safeGetEl('currentHourEffective'); if (_el) {
          if (Math.abs(currentHourEffTrimmers - currentHourTrimmers) > 0.05) {
            _el.textContent = `(eff: ${currentHourEffTrimmers.toFixed(1)} trimmers)`;
            _el.style.display = 'block';
          } else {
            _el.style.display = 'none';
          }
        }
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

      // The API does not send todayDelta. Falling back to 0 painted a neutral
      // "= 0.0 lbs" — reading as dead-on target — whenever the crew was ahead
      // or behind. Derive it from the same two numbers shown above it.
      const todayDelta = (typeof data.todayDelta === 'number' && isFinite(data.todayDelta))
        ? data.todayDelta
        : (todayLbs - todayTarget);
      const dde = safeGetEl('dailyDelta');
      if (dde && todayTarget > 0) {
        const da = Math.abs(todayDelta).toFixed(1);
        if (shiftEnded && Math.abs(todayDelta) >= 0.05) {
          // Shift complete — show final result
          dde.textContent = `COMPLETE · ${todayDelta > 0 ? '+' : '-'}${da} lbs`;
          dde.className = `daily-delta ${todayDelta > 0 ? 'positive' : 'negative'}`;
        } else if (shiftEnded) {
          dde.textContent = t('shiftEnded');
          dde.className = 'daily-delta positive';
        } else if (todayDelta >= 0.05) {
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

      // Smalls display
      const todaySmalls = data.todaySmalls || 0;
      const smallsEl = safeGetEl('smallsDisplay');
      const smallsValEl = safeGetEl('smallsValue');
      if (smallsEl && smallsValEl) {
        if (todaySmalls > 0) {
          smallsEl.style.display = 'flex';
          smallsValEl.textContent = todaySmalls.toFixed(1);
        } else {
          smallsEl.style.display = 'none';
        }
      }

      // Projection
      const projectedTotal = data.projectedTotal || 0;
      const dailyGoal = data.dailyGoal || 0;
      // Same story as todayDelta — not in the payload, derive it locally.
      const projectedDelta = (typeof data.projectedDelta === 'number' && isFinite(data.projectedDelta))
        ? data.projectedDelta
        : (projectedTotal - dailyGoal);

      var _el = safeGetEl('projectionLabel');
      if (_el) _el.textContent = shiftEnded ? t('finalTotal') : t('endOfDay');
      var _el = safeGetEl('projectionValue');
      if (_el) _el.textContent = shiftEnded ? todayLbs.toFixed(1) : (projectedTotal > 0 ? projectedTotal.toFixed(1) : '—');
      var _el = safeGetEl('projectionGoal');
      if (_el) _el.textContent = dailyGoal > 0 ? `/ ${dailyGoal.toFixed(1)} ${t('lbsGoal')}` : '';

      const pde = safeGetEl('projectionDelta');
      if (pde && dailyGoal > 0 && (projectedTotal > 0 || shiftEnded)) {
        const finalDelta = shiftEnded ? (todayLbs - dailyGoal) : projectedDelta;
        const pda = Math.abs(finalDelta).toFixed(1);
        if (finalDelta >= 0.5) {
          pde.textContent = `= +${pda} lbs`;
          pde.className = 'projection-delta positive';
        } else if (finalDelta <= -0.5) {
          pde.textContent = `= -${pda} lbs`;
          pde.className = 'projection-delta negative';
        } else {
          pde.textContent = shiftEnded ? '✓ On target' : `= 0.0 lbs`;
          pde.className = shiftEnded ? 'projection-delta positive' : 'projection-delta neutral';
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
      const displayEffTrimmers = currentHourTrimmers > 0 ? currentHourEffTrimmers : lastHourEffTrimmers;
      var _el = safeGetEl('crewCount'); if (_el) _el.textContent = displayTrimmers > 0 ? displayTrimmers : '—';

      // Crew change toast — detect trimmer count changes between renders
      var _state = window.ScoreboardState;
      if (_state && displayTrimmers > 0) {
        if (_state._prevTrimmers !== undefined && _state._prevTrimmers !== displayTrimmers) {
          var toastMsg = 'Crew: ' + _state._prevTrimmers + ' → ' + displayTrimmers;
          if (Math.abs(displayEffTrimmers - displayTrimmers) > 0.05) {
            toastMsg += ' (eff: ' + displayEffTrimmers.toFixed(1) + ')';
          }
          var toastEl = document.getElementById('crewToast');
          if (toastEl) {
            toastEl.textContent = toastMsg;
            toastEl.classList.add('visible');
            clearTimeout(_state._crewToastTimer);
            _state._crewToastTimer = setTimeout(function() {
              toastEl.classList.remove('visible');
            }, 3000);
          }
        }
        _state._prevTrimmers = displayTrimmers;
      }

      // Show effective trimmer indicator when weighted avg differs from raw
      var _el = safeGetEl('crewEffective'); if (_el) {
        if (displayTrimmers > 0 && Math.abs(displayEffTrimmers - displayTrimmers) > 0.05) {
          _el.textContent = `eff: ${displayEffTrimmers.toFixed(1)}`;
          _el.style.display = 'inline';
        } else {
          _el.style.display = 'none';
        }
      }
      var _el = safeGetEl('targetRate'); if (_el) _el.textContent = targetRate > 0 ? targetRate.toFixed(2) : '—';
      var _el = safeGetEl('strainName'); if (_el) _el.textContent = strain || '—';

      // Update translatable labels
      var _el = safeGetEl('lastHourHeader'); if (_el) _el.textContent = t('lastHour');
      var _el = safeGetEl('currentHourHeader'); if (_el) _el.innerHTML = '<i class="ph-duotone ph-timer" style="margin-right:6px"></i> ' + t('currentHour');
      var _el = safeGetEl('trimmersLabel'); if (_el) _el.textContent = t('trimmersLabel');
      var _el = safeGetEl('trimmersSmallLabel'); if (_el) _el.textContent = t('trimmers');
      var _el = safeGetEl('targetRateLabel'); if (_el) _el.textContent = t('targetRate');
      var _el = safeGetEl('streakLabel'); if (_el) _el.textContent = t('hrStreak');
      var _el = safeGetEl('bagsTodayLabel'); if (_el) _el.textContent = t('bagsToday');

      // Performance deltas
      const avgEl = safeGetEl('avgPercentage');
      const bestEl = safeGetEl('bestHour');

      if (avgEl) {
        avgEl.className = '';
        if (data.avgDelta !== undefined && data.avgDelta !== 0) {
          avgEl.textContent = (data.avgDelta >= 0 ? '+' : '') + data.avgDelta.toFixed(1);
          avgEl.classList.add(data.avgDelta >= 0.05 ? 'text-green' : data.avgDelta <= -0.05 ? 'text-red' : 'text-gold');
        } else if (data.avgDelta === 0) {
          avgEl.textContent = '0';
          avgEl.classList.add('text-gold');
        } else {
          avgEl.textContent = '—';
        }
      }

      if (bestEl) {
        bestEl.className = '';
        if (data.bestDelta !== undefined && data.bestDelta !== 0) {
          bestEl.textContent = (data.bestDelta >= 0 ? '+' : '') + data.bestDelta.toFixed(1);
          bestEl.classList.add(data.bestDelta >= 0.05 ? 'text-green' : data.bestDelta <= -0.05 ? 'text-red' : 'text-gold');
        } else if (data.bestDelta === 0) {
          bestEl.textContent = '0';
          bestEl.classList.add('text-gold');
        } else {
          bestEl.textContent = '—';
        }
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

      // Shift summary card — populate when shift ended
      if (shiftEnded) {
        const summaryEl = safeGetEl('shiftSummary');
        if (summaryEl) {
          summaryEl.style.display = 'flex';

          var _el = safeGetEl('summaryTotalLbs');
          if (_el) _el.textContent = todayLbs.toFixed(1);

          var _el = safeGetEl('summaryPctTarget');
          if (_el) {
            const pct = todayTarget > 0 ? Math.round((todayLbs / todayTarget) * 100) : 0;
            _el.textContent = pct + '%';
            _el.style.color = pct >= 100 ? 'var(--green)' : pct >= 90 ? 'var(--yellow)' : 'var(--red)';
          }

          // Best hour from hourly rates
          var _el = safeGetEl('summaryBestHour');
          if (_el && data.hourlyRates && data.hourlyRates.length > 0) {
            const best = data.hourlyRates.reduce(function(a, b) { return (b.rate || 0) > (a.rate || 0) ? b : a; });
            _el.textContent = best.rate ? best.rate.toFixed(2) : '—';
          }

          // Bags — read from timer state or DOM
          var _el = safeGetEl('summaryBags');
          if (_el) {
            const bagsEl = safeGetEl('bagsToday');
            _el.textContent = bagsEl ? bagsEl.textContent : '—';
          }

          // Avg cycle — read from DOM
          var _el = safeGetEl('summaryAvgCycle');
          if (_el) {
            const avgEl = safeGetEl('avgToday');
            _el.textContent = avgEl ? avgEl.textContent : '—';
          }

          // Hours worked
          var _el = safeGetEl('summaryHours');
          if (_el) _el.textContent = effectiveHours.toFixed(1);
        }
      } else {
        const summaryEl = safeGetEl('shiftSummary');
        if (summaryEl) summaryEl.style.display = 'none';
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
    }
  };

  // Export to global scope
  window.ScoreboardRender = ScoreboardRender;

})(window);
