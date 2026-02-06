/**
 * Command Center - Real-Time Production Monitoring
 * Premium dashboard with live metrics, predictions, and alerts
 */

(function() {
  'use strict';

  // ===== STATE =====
  const state = {
    data: null,
    alerts: [],
    lastUpdate: null,
    shiftStart: null,
    polling: null
  };

  // ===== CONFIG =====
  const CONFIG = {
    API_URL: 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production',
    POLL_INTERVAL: 5000,
    ALERT_THRESHOLDS: {
      rateDrop: 0.85,
      bagLag: 1.2,
      targetMiss: 0.90
    }
  };

  // ===== DOM ELEMENTS =====
  const elements = {
    headerTime: document.getElementById('headerTime'),
    headerDate: document.getElementById('headerDate'),
    systemStatus: document.getElementById('systemStatus'),
    lastUpdate: document.getElementById('lastUpdate'),
    
    // Production Overview
    currentHourLbs: document.getElementById('currentHourLbs'),
    currentHourProgress: document.getElementById('currentHourProgress'),
    currentHourPct: document.getElementById('currentHourPct'),
    currentHourTarget: document.getElementById('currentHourTarget'),
    todayLbs: document.getElementById('todayLbs'),
    todayDelta: document.getElementById('todayDelta'),
    todayTarget: document.getElementById('todayTarget'),
    targetPct: document.getElementById('targetPct'),
    hoursLogged: document.getElementById('hoursLogged'),
    effectiveHours: document.getElementById('effectiveHours'),
    avgPerformance: document.getElementById('avgPerformance'),
    bestPerformance: document.getElementById('bestPerformance'),
    
    // Crew Performance
    trimmerCount: document.getElementById('trimmerCount'),
    trimmerRate: document.getElementById('trimmerRate'),
    buckerCount: document.getElementById('buckerCount'),
    buckerRate: document.getElementById('buckerRate'),
    rateMeterFill: document.getElementById('rateMeterFill'),
    currentRate: document.getElementById('currentRate'),
    targetRate: document.getElementById('targetRate'),
    strainName: document.getElementById('strainName'),
    strainRate: document.getElementById('strainRate'),
    
    // Bag Timer
    timerRing: document.getElementById('timerRing'),
    timerValue: document.getElementById('timerValue'),
    timerLabel: document.getElementById('timerLabel'),
    targetTime: document.getElementById('targetTime'),
    bagsToday: document.getElementById('bagsToday'),
    avgBagTime: document.getElementById('avgBagTime'),
    timerStatus: document.getElementById('timerStatus'),
    
    // Predictive Analytics
    projectedTotal: document.getElementById('projectedTotal'),
    projectedDelta: document.getElementById('projectedDelta'),
    finishTime: document.getElementById('finishTime'),
    currentPace: document.getElementById('currentPace'),
    requiredPace: document.getElementById('requiredPace'),
    dayProgress: document.getElementById('dayProgress'),
    targetMarker: document.getElementById('targetMarker'),
    timeRemaining: document.getElementById('timeRemaining'),
    
    // Alerts
    alertsList: document.getElementById('alertsList'),
    clearAlerts: document.getElementById('clearAlerts'),
    
    // Buttons
    fullscreenBtn: document.getElementById('fullscreenBtn')
  };

  // ===== INITIALIZATION =====
  function init() {
    console.log('[Command Center] Initializing...');
    
    setupEventListeners();
    updateClock();
    setInterval(updateClock, 1000);
    
    fetchData();
    startPolling();
    
    console.log('[Command Center] Ready');
  }

  // ===== EVENT LISTENERS =====
  function setupEventListeners() {
    elements.fullscreenBtn?.addEventListener('click', toggleFullscreen);
    elements.clearAlerts?.addEventListener('click', clearAllAlerts);
  }

  // ===== CLOCK =====
  function updateClock() {
    const now = new Date();
    
    const timeStr = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    
    const dateStr = now.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    
    if (elements.headerTime) elements.headerTime.textContent = timeStr;
    if (elements.headerDate) elements.headerDate.textContent = dateStr;
  }

  // ===== DATA FETCHING =====
  async function fetchData() {
    try {
      const response = await fetch(`${CONFIG.API_URL}?action=scoreboard`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const data = await response.json();
      state.data = data;
      state.lastUpdate = new Date();
      
      updateUI(data);
      checkAlerts(data);
      
    } catch (error) {
      console.error('[Command Center] Fetch error:', error);
      showSystemError();
    }
  }

  function startPolling() {
    if (state.polling) clearInterval(state.polling);
    state.polling = setInterval(fetchData, CONFIG.POLL_INTERVAL);
  }

  // ===== UI UPDATES =====
  function updateUI(data) {
    updateProductionOverview(data.scoreboard);
    updateCrewPerformance(data.scoreboard);
    updateBagTimer(data.timer);
    updatePredictiveAnalytics(data.scoreboard, data.timer);
    updateLastUpdateTime();
  }

  function updateProductionOverview(scoreboard) {
    // Current Hour
    const currentLbs = scoreboard.lastHourLbs || 0;
    const currentTarget = scoreboard.currentHourTarget || 1;
    const currentPct = Math.round((currentLbs / currentTarget) * 100);
    
    if (elements.currentHourLbs) {
      elements.currentHourLbs.textContent = currentLbs.toFixed(1);
    }
    
    if (elements.currentHourProgress) {
      const progressPct = Math.min(currentPct, 100);
      elements.currentHourProgress.style.width = `${progressPct}%`;
      
      if (currentPct >= 105) {
        elements.currentHourProgress.style.background = 'linear-gradient(90deg, var(--cc-green), var(--cc-green))';
      } else if (currentPct >= 90) {
        elements.currentHourProgress.style.background = 'linear-gradient(90deg, var(--cc-green), var(--cc-gold))';
      } else {
        elements.currentHourProgress.style.background = 'linear-gradient(90deg, var(--cc-red), var(--cc-gold))';
      }
    }
    
    if (elements.currentHourPct) {
      elements.currentHourPct.textContent = `${currentPct}%`;
    }
    
    if (elements.currentHourTarget) {
      elements.currentHourTarget.textContent = currentTarget.toFixed(1);
    }
    
    // Today's Total
    const todayLbs = scoreboard.todayLbs || 0;
    const todayTarget = scoreboard.todayTarget || 1;
    const todayPct = scoreboard.todayPercentage || 0;
    const delta = todayLbs - todayTarget;
    
    if (elements.todayLbs) {
      elements.todayLbs.textContent = `${todayLbs.toFixed(1)} lbs`;
    }
    
    if (elements.todayDelta) {
      const sign = delta >= 0 ? '+' : '';
      elements.todayDelta.textContent = `${sign}${delta.toFixed(1)} lbs`;
      elements.todayDelta.className = 'metric-delta';
      if (delta > 0) elements.todayDelta.classList.add('positive');
      if (delta < 0) elements.todayDelta.classList.add('negative');
    }
    
    if (elements.todayTarget) {
      elements.todayTarget.textContent = `${todayTarget.toFixed(1)} lbs`;
    }
    
    if (elements.targetPct) {
      elements.targetPct.textContent = `${todayPct.toFixed(1)}%`;
    }
    
    // Hours
    if (elements.hoursLogged) {
      elements.hoursLogged.textContent = (scoreboard.hoursLogged || 0).toFixed(1);
    }
    
    if (elements.effectiveHours) {
      elements.effectiveHours.textContent = `${(scoreboard.effectiveHours || 0).toFixed(1)} effective`;
    }
    
    // Performance
    if (elements.avgPerformance) {
      elements.avgPerformance.textContent = `${(scoreboard.avgPercentage || 0).toFixed(0)}%`;
    }
    
    if (elements.bestPerformance) {
      elements.bestPerformance.textContent = `Best: ${(scoreboard.bestPercentage || 0).toFixed(0)}%`;
    }
  }

  function updateCrewPerformance(scoreboard) {
    const trimmers = scoreboard.currentHourTrimmers || 0;
    const buckers = scoreboard.currentHourBuckers || 0;
    const targetRate = scoreboard.targetRate || 1;
    const currentRate = trimmers > 0 ? (scoreboard.lastHourLbs || 0) / trimmers : 0;
    
    // Crew counts
    if (elements.trimmerCount) {
      elements.trimmerCount.textContent = trimmers;
    }
    
    if (elements.trimmerRate) {
      elements.trimmerRate.textContent = currentRate.toFixed(1);
    }
    
    if (elements.buckerCount) {
      elements.buckerCount.textContent = buckers;
    }
    
    if (elements.buckerRate) {
      const ratio = trimmers > 0 ? (buckers / trimmers).toFixed(2) : '0.00';
      elements.buckerRate.textContent = ratio;
    }
    
    // Rate meter
    if (elements.rateMeterFill && elements.currentRate && elements.targetRate) {
      const ratePct = Math.min((currentRate / targetRate) * 100, 150);
      elements.rateMeterFill.style.width = `${ratePct}%`;
      
      elements.currentRate.textContent = `${currentRate.toFixed(2)} lbs/trimmer/hr`;
      elements.targetRate.textContent = targetRate.toFixed(2);
    }
    
    // Strain info
    if (elements.strainName) {
      elements.strainName.textContent = scoreboard.strain || 'Unknown Strain';
    }
    
    if (elements.strainRate) {
      elements.strainRate.textContent = targetRate.toFixed(2);
    }
  }

  function updateBagTimer(timer) {
    const secondsSince = timer.secondsSinceLastBag || 0;
    const targetSeconds = timer.targetSeconds || 300;
    const bagsToday = timer.bagsToday || 0;
    const avgSeconds = timer.avgSecondsToday || 0;
    
    // Timer display
    if (elements.timerValue) {
      const minutes = Math.floor(secondsSince / 60);
      const seconds = secondsSince % 60;
      elements.timerValue.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      
      const pct = secondsSince / targetSeconds;
      if (pct < 0.85) {
        elements.timerValue.className = 'timer-value';
      } else if (pct < 1.0) {
        elements.timerValue.className = 'timer-value warning';
      } else {
        elements.timerValue.className = 'timer-value danger';
      }
    }
    
    // Timer ring
    if (elements.timerRing) {
      const circumference = 534;
      const pct = Math.min(secondsSince / targetSeconds, 1);
      const offset = circumference * (1 - pct);
      elements.timerRing.style.strokeDashoffset = offset;
      
      if (pct < 0.85) {
        elements.timerRing.setAttribute('class', 'timer-ring-progress');
      } else if (pct < 1.0) {
        elements.timerRing.setAttribute('class', 'timer-ring-progress warning');
      } else {
        elements.timerRing.setAttribute('class', 'timer-ring-progress danger');
      }
    }
    
    // Stats
    if (elements.targetTime) {
      const targetMin = Math.floor(targetSeconds / 60);
      const targetSec = targetSeconds % 60;
      elements.targetTime.textContent = `${targetMin}:${targetSec.toString().padStart(2, '0')}`;
    }
    
    if (elements.bagsToday) {
      elements.bagsToday.textContent = bagsToday;
    }
    
    if (elements.avgBagTime) {
      const avgMin = Math.floor(avgSeconds / 60);
      const avgSec = avgSeconds % 60;
      elements.avgBagTime.textContent = avgSeconds > 0 
        ? `${avgMin}:${avgSec.toString().padStart(2, '0')}`
        : '--:--';
    }
    
    // Status
    if (elements.timerStatus) {
      const pct = secondsSince / targetSeconds;
      let statusClass = '';
      let statusText = '';
      
      if (pct < 0.85) {
        statusClass = 'on-pace';
        statusText = 'On pace - excellent timing';
      } else if (pct < 1.0) {
        statusClass = 'at-risk';
        statusText = 'Approaching target - watch pace';
      } else {
        statusClass = 'lagging';
        statusText = 'Over target - bag completion needed';
      }
      
      elements.timerStatus.className = `cc-timer-status ${statusClass}`;
      elements.timerStatus.querySelector('.timer-status-text').textContent = statusText;
    }
  }

  function updatePredictiveAnalytics(scoreboard, timer) {
    const todayLbs = scoreboard.todayLbs || 0;
    const todayTarget = scoreboard.todayTarget || 1;
    const hoursLogged = scoreboard.effectiveHours || 0;
    const trimmers = scoreboard.currentHourTrimmers || 1;
    const targetRate = scoreboard.targetRate || 1;
    
    // Calculate projections
    const workdayHours = 8;
    const hoursRemaining = Math.max(workdayHours - hoursLogged, 0);
    const currentPace = hoursLogged > 0 ? todayLbs / hoursLogged : 0;
    const projectedTotal = todayLbs + (currentPace * hoursRemaining);
    const projectedDelta = projectedTotal - todayTarget;
    
    // Projected total
    if (elements.projectedTotal) {
      elements.projectedTotal.textContent = `${projectedTotal.toFixed(1)} lbs`;
    }
    
    if (elements.projectedDelta) {
      const sign = projectedDelta >= 0 ? '+' : '';
      elements.projectedDelta.textContent = `${sign}${projectedDelta.toFixed(1)} lbs vs target`;
      elements.projectedDelta.className = 'prediction-delta';
      if (projectedDelta > 0) elements.projectedDelta.classList.add('positive');
      if (projectedDelta < 0) elements.projectedDelta.classList.add('negative');
    }
    
    // Finish time
    if (elements.finishTime) {
      const now = new Date();
      const hoursToTarget = (todayTarget - todayLbs) / (currentPace || 1);
      const finishDate = new Date(now.getTime() + (hoursToTarget * 60 * 60 * 1000));
      
      if (currentPace > 0 && hoursToTarget > 0 && hoursToTarget < 24) {
        elements.finishTime.textContent = finishDate.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
      } else if (todayLbs >= todayTarget) {
        elements.finishTime.textContent = 'Target met!';
      } else {
        elements.finishTime.textContent = 'Calculating...';
      }
    }
    
    // Paces
    if (elements.currentPace) {
      elements.currentPace.textContent = `${currentPace.toFixed(1)} lbs/hr`;
    }
    
    if (elements.requiredPace) {
      const lbsNeeded = Math.max(todayTarget - todayLbs, 0);
      const requiredPace = hoursRemaining > 0 ? lbsNeeded / hoursRemaining : 0;
      elements.requiredPace.textContent = `${requiredPace.toFixed(1)} lbs/hr`;
    }
    
    // Timeline
    if (elements.dayProgress) {
      const dayPct = (hoursLogged / workdayHours) * 100;
      elements.dayProgress.style.width = `${Math.min(dayPct, 100)}%`;
    }
    
    if (elements.targetMarker) {
      const targetHours = todayTarget / (targetRate * trimmers);
      const targetPct = Math.min((targetHours / workdayHours) * 100, 100);
      elements.targetMarker.style.left = `${targetPct}%`;
    }
    
    if (elements.timeRemaining) {
      const hoursRem = Math.floor(hoursRemaining);
      const minsRem = Math.round((hoursRemaining - hoursRem) * 60);
      elements.timeRemaining.textContent = `${hoursRem}h ${minsRem}m remaining`;
    }
  }

  function updateLastUpdateTime() {
    if (elements.lastUpdate && state.lastUpdate) {
      const timeStr = state.lastUpdate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      elements.lastUpdate.textContent = `Updated ${timeStr}`;
    }
  }

  // ===== ALERTS =====
  function checkAlerts(data) {
    const scoreboard = data.scoreboard;
    const timer = data.timer;
    
    // Rate drop alert
    if (scoreboard.lastHourLbs && scoreboard.lastHourTarget) {
      const pct = scoreboard.lastHourLbs / scoreboard.lastHourTarget;
      if (pct < CONFIG.ALERT_THRESHOLDS.rateDrop) {
        addAlert('warning', 'Rate Drop Detected', 
          `Last hour was ${(pct * 100).toFixed(0)}% of target. Crew may need support.`);
      }
    }
    
    // Bag lag alert
    if (timer.secondsSinceLastBag && timer.targetSeconds) {
      const ratio = timer.secondsSinceLastBag / timer.targetSeconds;
      if (ratio > CONFIG.ALERT_THRESHOLDS.bagLag) {
        addAlert('danger', 'Bag Timer Alert', 
          `${Math.floor(ratio * 100)}% over target time. Check for bottlenecks.`);
      }
    }
    
    // Target miss risk
    if (scoreboard.todayPercentage && scoreboard.effectiveHours > 2) {
      if (scoreboard.todayPercentage < (CONFIG.ALERT_THRESHOLDS.targetMiss * 100)) {
        addAlert('warning', 'Target Risk', 
          `Currently at ${scoreboard.todayPercentage.toFixed(0)}% of daily target.`);
      }
    }
    
    // Low crew alert
    if (scoreboard.currentHourTrimmers < 3 && scoreboard.todayLbs > 0) {
      addAlert('info', 'Low Crew Count', 
        `Only ${scoreboard.currentHourTrimmers} trimmer(s) active.`);
    }
    
    renderAlerts();
  }

  function addAlert(severity, title, message) {
    const existingAlert = state.alerts.find(a => a.title === title);
    if (existingAlert) {
      existingAlert.time = new Date();
      return;
    }
    
    state.alerts.push({
      id: Date.now(),
      severity,
      title,
      message,
      time: new Date()
    });
    
    if (state.alerts.length > 10) {
      state.alerts.shift();
    }
  }

  function renderAlerts() {
    if (!elements.alertsList) return;
    
    if (state.alerts.length === 0) {
      elements.alertsList.innerHTML = `
        <div class="cc-no-alerts">
          <i class="ph-duotone ph-check-circle"></i>
          <p>All systems nominal</p>
        </div>
      `;
      if (elements.clearAlerts) {
        elements.clearAlerts.style.display = 'none';
      }
      return;
    }
    
    if (elements.clearAlerts) {
      elements.clearAlerts.style.display = 'block';
    }
    
    const alertsHTML = state.alerts.map(alert => {
      const timeStr = alert.time.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      
      const iconMap = {
        danger: 'warning',
        warning: 'warning-circle',
        info: 'info'
      };
      
      return `
        <div class="cc-alert ${alert.severity}">
          <div class="alert-icon">
            <i class="ph-duotone ph-${iconMap[alert.severity]}"></i>
          </div>
          <div class="alert-content">
            <div class="alert-title">${alert.title}</div>
            <div class="alert-message">${alert.message}</div>
          </div>
          <div class="alert-time">${timeStr}</div>
        </div>
      `;
    }).join('');
    
    elements.alertsList.innerHTML = alertsHTML;
  }

  function clearAllAlerts() {
    state.alerts = [];
    renderAlerts();
  }

  // ===== UTILITIES =====
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error('Fullscreen error:', err);
      });
      document.body.classList.add('fullscreen');
    } else {
      document.exitFullscreen();
      document.body.classList.remove('fullscreen');
    }
  }

  function showSystemError() {
    if (elements.systemStatus) {
      const statusDot = elements.systemStatus.querySelector('.status-dot');
      const statusText = elements.systemStatus.querySelector('span');
      
      statusDot.style.background = 'var(--cc-red)';
      statusText.textContent = 'ERROR';
      
      elements.systemStatus.style.background = 'var(--cc-red-dim)';
      elements.systemStatus.style.borderColor = 'var(--cc-red)';
      elements.systemStatus.style.color = 'var(--cc-red)';
    }
    
    addAlert('danger', 'System Error', 'Unable to fetch production data. Retrying...');
    renderAlerts();
  }

  // ===== START =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
