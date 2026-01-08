/**
 * ScoreboardRender.js
 * Main render orchestration for scoreboard UI updates
 * Dependencies: ScoreboardState, ScoreboardDOM, ScoreboardI18n, ScoreboardChart
 */
(function(window) {
  'use strict';

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
      document.getElementById('statusIcon').textContent = statusIcon;
      document.getElementById('statusText').textContent = t(statusKey);

      // Last hour card
      document.getElementById('lastHourLbs').textContent = lastHourLbs > 0 ? lastHourLbs.toFixed(1) : '—';
      document.getElementById('lastHourTarget').textContent = lastHourTarget > 0 ? lastHourTarget.toFixed(1) : '—';
      document.getElementById('lastHourTimeslot').textContent = lastTimeSlot;

      // Show lbs delta instead of percentage
      const lhp = document.getElementById('lastHourPct');
      if (lastHourTarget > 0) {
        const deltaAbs = Math.abs(lastHourDelta).toFixed(1);
        if (lastHourDelta >= 0.05) {
          lhp.textContent = `+${deltaAbs} lbs`;
          lhp.style.color = '#7a9d87';
        } else if (lastHourDelta <= -0.05) {
          lhp.textContent = `-${deltaAbs} lbs`;
          lhp.style.color = '#f87171';
        } else {
          lhp.textContent = `0 lbs`;
          lhp.style.color = '#e4aa4f';
        }
      } else {
        lhp.textContent = '—';
        lhp.style.color = 'rgba(255,255,255,0.5)';
      }

      // Current hour card
      const chc = document.getElementById('currentHourCard');
      if (currentHourTrimmers > 0) {
        chc.style.display = 'block';
        document.getElementById('currentHourTrimmers').textContent = currentHourTrimmers;
        document.getElementById('currentHourTimeslot').textContent = currentTimeSlot;
        document.getElementById('currentHourTargetLbs').textContent = currentHourTarget > 0 ? currentHourTarget.toFixed(1) : '—';
      } else {
        chc.style.display = 'none';
      }

      // Render the hourly chart
      if (window.ScoreboardChart) {
        window.ScoreboardChart.renderHourlyChart(data.hourlyRates, targetRate);
      }

      // Daily progress
      document.getElementById('dailyActual').textContent = todayLbs > 0 ? todayLbs.toFixed(1) : '—';
      document.getElementById('dailyTarget').textContent = todayTarget > 0 ? todayTarget.toFixed(1) : '—';

      const todayDelta = data.todayDelta || 0;
      const dde = document.getElementById('dailyDelta');
      if (todayTarget > 0) {
        const da = Math.abs(todayDelta).toFixed(1);
        if (todayDelta >= 0.1) {
          dde.textContent = `↑ ${t('upBy')} ${da}`;
          dde.className = 'daily-delta positive';
        } else if (todayDelta <= -0.1) {
          dde.textContent = `↓ ${t('downBy')} ${da}`;
          dde.className = 'daily-delta negative';
        } else {
          dde.textContent = '= On pace';
          dde.className = 'daily-delta neutral';
        }
      } else {
        dde.textContent = '—';
        dde.className = 'daily-delta neutral';
      }

      // Progress hours
      const effectiveHours = data.effectiveHours || hoursLogged;
      document.getElementById('progressHours').textContent = `${effectiveHours.toFixed(1)} ${t('hrs')}`;
      document.getElementById('progressFill').style.width = `${Math.min(100, todayPct || avgPct || 0)}%`;

      // Projection
      const projectedTotal = data.projectedTotal || 0;
      const dailyGoal = data.dailyGoal || 0;
      const projectedDelta = data.projectedDelta || 0;

      document.getElementById('projectionLabel').textContent = t('endOfDay');
      document.getElementById('projectionValue').textContent = projectedTotal > 0 ? projectedTotal.toFixed(1) : '—';
      document.getElementById('projectionGoal').textContent = dailyGoal > 0 ? `/ ${dailyGoal.toFixed(1)} ${t('lbsGoal')}` : '';

      const pde = document.getElementById('projectionDelta');
      if (dailyGoal > 0 && projectedTotal > 0) {
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
      } else {
        pde.textContent = '—';
        pde.className = 'projection-delta neutral';
      }

      // Comparison pills
      this.renderComparison('vsYesterday', data.vsYesterday);
      this.renderComparison('vs7Day', data.vs7Day);

      // Streak pill
      document.getElementById('streakPill').style.display = streak >= 2 ? 'flex' : 'none';
      document.getElementById('streakValue').textContent = streak;

      // Crew and rate info
      const displayTrimmers = currentHourTrimmers > 0 ? currentHourTrimmers : lastHourTrimmers;
      document.getElementById('crewCount').textContent = displayTrimmers > 0 ? displayTrimmers : '—';
      document.getElementById('targetRate').textContent = targetRate > 0 ? targetRate.toFixed(2) : '—';
      document.getElementById('strainName').textContent = strain || '—';

      // Performance deltas
      const avgEl = document.getElementById('avgPercentage');
      const bestEl = document.getElementById('bestHour');

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

      // Strain rate indicator
      const sri = document.getElementById('strainRateIndicator');
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
      const pill = document.getElementById(prefix + 'Pill');
      const ve = document.getElementById(prefix + 'Value');

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
