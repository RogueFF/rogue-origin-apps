/**
 * Command Center v2 - Main Controller
 * Real-time production monitoring with predictive analytics
 *
 * @module CommandCenterV2
 */

// ===== CONFIGURATION =====
const CONFIG = {
  API_URL: 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production',
  POLL_INTERVAL: 30000,
  TIMER_TICK: 1000,
  TIMER_RING_CIRCUMFERENCE: 534,
  HOUR_RING_CIRCUMFERENCE: 264,
  WORK_START_HOUR: 7,
  WORK_START_MINUTE: 0,
  WORK_END_HOUR: 16,
  WORK_END_MINUTE: 30,
  EFFECTIVE_WORK_HOURS: 7.5,
  THRESHOLDS: {
    ahead: 105,
    onTarget: 90,
    behind: 0
  },
  ALERT_THRESHOLDS: {
    rateDrop: 0.85,
    bagLag: 1.20,
    targetMiss: 0.90,
    lowCrew: 3
  },
  MAX_ALERTS: 10
};

// ===== STATE =====
const state = {
  scoreboard: null,
  timer: null,
  lastUpdate: null,
  connectionStatus: 'connecting', // 'live' | 'connecting' | 'offline'
  consecutiveFailures: 0,
  alerts: [],
  pollIntervalId: null,
  timerIntervalId: null,
  clockIntervalId: null,
  timerSeconds: 0,
  fetchLatency: 0
};

// ===== DOM ELEMENT REFERENCES =====
let el = {};

function cacheElements() {
  el = {
    // Header
    strainName:       document.getElementById('cc2-strainName'),
    clock:            document.getElementById('cc2-clock'),
    date:             document.getElementById('cc2-date'),
    connectionStatus: document.getElementById('cc2-connectionStatus'),
    refreshBtn:       document.getElementById('cc2-refreshBtn'),

    // Daily Goal
    dailyActual:      document.getElementById('cc2-dailyActual'),
    dailyTarget:      document.getElementById('cc2-dailyTarget'),
    dailyProgressFill:document.getElementById('cc2-dailyProgressFill'),
    timeMarker:       document.getElementById('cc2-timeMarker'),
    dailyPct:         document.getElementById('cc2-dailyPct'),
    hoursLogged:      document.getElementById('cc2-hoursLogged'),
    dailyDelta:       document.getElementById('cc2-dailyDelta'),

    // Current Pace
    currentPace:      document.getElementById('cc2-currentPace'),
    vsTargetPct:      document.getElementById('cc2-vsTargetPct'),
    avgPace:          document.getElementById('cc2-avgPace'),

    // Projected Finish
    finishTime:       document.getElementById('cc2-finishTime'),
    finishPeriod:     document.getElementById('cc2-finishPeriod'),
    finishDeltaText:  document.getElementById('cc2-finishDeltaText'),
    projectedTotal:   document.getElementById('cc2-projectedTotal'),

    // Last Hour
    lastHourLbs:      document.getElementById('cc2-lastHourLbs'),
    lastHourTarget:   document.getElementById('cc2-lastHourTarget'),
    lastHourRingProgress: document.getElementById('cc2-lastHourRingProgress'),
    lastHourPct:      document.getElementById('cc2-lastHourPct'),
    lastHourSlot:     document.getElementById('cc2-lastHourSlot'),
    lastHourTrimmers: document.getElementById('cc2-lastHourTrimmers'),
    lastHourBuckers:  document.getElementById('cc2-lastHourBuckers'),

    // Bag Timer
    timerRingProgress:document.getElementById('cc2-timerRingProgress'),
    timerValue:       document.getElementById('cc2-timerValue'),
    timerStatusLabel: document.getElementById('cc2-timerStatusLabel'),
    bagsToday:        document.getElementById('cc2-bagsToday'),
    avgCycleTime:     document.getElementById('cc2-avgCycleTime'),
    timerTrimmers:    document.getElementById('cc2-timerTrimmers'),
    timerGlow:        document.getElementById('cc2-timerGlow'),

    // Crew
    totalCrew:        document.getElementById('cc2-totalCrew'),
    line1Trimmers:    document.getElementById('cc2-line1Trimmers'),
    line1Buckers:     document.getElementById('cc2-line1Buckers'),
    line2Trimmers:    document.getElementById('cc2-line2Trimmers'),
    line2Buckers:     document.getElementById('cc2-line2Buckers'),
    targetRate:       document.getElementById('cc2-targetRate'),

    // Chart
    hourlyChart:      document.getElementById('cc2-hourlyChart'),

    // Alerts
    alertsBar:        document.getElementById('cc2-alertsBar'),
    alertsContent:    document.getElementById('cc2-alertsContent'),

    // Perf
    lastUpdateTime:   document.getElementById('cc2-lastUpdateTime'),
    latency:          document.getElementById('cc2-latency'),
    perfOverlay:      document.getElementById('cc2-perfOverlay')
  };
}


// ===== DATA FETCHING =====

async function fetchData() {
  const fetchStart = performance.now();
  setConnectionStatus('connecting');

  try {
    const response = await fetch(`${CONFIG.API_URL}?action=scoreboard`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const raw = await response.json();
    const data = raw.data || raw;

    state.fetchLatency = Math.round(performance.now() - fetchStart);
    state.scoreboard = data.scoreboard || null;
    state.timer = data.timer || null;
    state.lastUpdate = new Date();
    state.consecutiveFailures = 0;

    // Sync local timer counter with server value
    if (state.timer) {
      state.timerSeconds = state.timer.secondsSinceLastBag || 0;
    }

    setConnectionStatus('live');
    updateUI();
    checkAlerts();

  } catch (err) {
    console.error('[CC2] Fetch error:', err);
    state.consecutiveFailures++;
    if (state.consecutiveFailures >= 3) {
      setConnectionStatus('offline');
    } else {
      setConnectionStatus('connecting');
    }
    addAlert('danger', 'Connection Error', 'Unable to fetch production data. Retrying...');
    renderAlerts();
  }
}


// ===== CONNECTION STATUS =====

function setConnectionStatus(status) {
  state.connectionStatus = status;
  if (!el.connectionStatus) return;

  const dot = el.connectionStatus.querySelector('.status-dot') || el.connectionStatus;
  const label = el.connectionStatus.querySelector('.status-text') || el.connectionStatus;

  el.connectionStatus.className = 'cc2-connection-status';

  switch (status) {
    case 'live':
      el.connectionStatus.classList.add('live');
      if (label && label !== el.connectionStatus) label.textContent = 'LIVE';
      break;
    case 'connecting':
      el.connectionStatus.classList.add('connecting');
      if (label && label !== el.connectionStatus) label.textContent = 'CONNECTING';
      break;
    case 'offline':
      el.connectionStatus.classList.add('offline');
      if (label && label !== el.connectionStatus) label.textContent = 'OFFLINE';
      break;
  }
}


// ===== UI UPDATE ORCHESTRATOR =====

function updateUI() {
  if (!state.scoreboard) return;

  updateProductionOverview(state.scoreboard);
  updateCrewPerformance(state.scoreboard);
  updateBagTimer(state.timer);
  updatePredictiveAnalytics(state.scoreboard);
  updateLastHour(state.scoreboard);
  updateHourlyChart(state.scoreboard.hourlyData);
  updatePerfStats();
}


// ===== PRODUCTION OVERVIEW (Daily Goal) =====

function updateProductionOverview(sb) {
  const todayLbs = sb.todayLbs || 0;
  const todayTarget = sb.todayTarget || 1;
  const todayPct = sb.todayPercentage || Math.round((todayLbs / todayTarget) * 100);
  const delta = todayLbs - todayTarget;
  const hoursLogged = sb.hoursLogged || 0;

  if (el.dailyActual) el.dailyActual.textContent = todayLbs.toFixed(1);
  if (el.dailyTarget) el.dailyTarget.textContent = todayTarget.toFixed(1);
  if (el.dailyPct) el.dailyPct.textContent = `${todayPct.toFixed(0)}%`;
  if (el.hoursLogged) el.hoursLogged.textContent = `${hoursLogged.toFixed(1)}h logged`;

  // Delta display
  if (el.dailyDelta) {
    const sign = delta >= 0 ? '+' : '';
    el.dailyDelta.textContent = `${sign}${delta.toFixed(1)} lbs`;
    el.dailyDelta.className = 'cc2-delta';
    if (delta > 0) el.dailyDelta.classList.add('positive');
    else if (delta < 0) el.dailyDelta.classList.add('negative');
  }

  // Progress bar fill
  if (el.dailyProgressFill) {
    const fillPct = Math.min((todayLbs / todayTarget) * 100, 100);
    el.dailyProgressFill.style.width = `${fillPct}%`;

    // Color based on performance
    if (todayPct >= CONFIG.THRESHOLDS.ahead) {
      el.dailyProgressFill.setAttribute('data-status', 'ahead');
    } else if (todayPct >= CONFIG.THRESHOLDS.onTarget) {
      el.dailyProgressFill.setAttribute('data-status', 'on-target');
    } else {
      el.dailyProgressFill.setAttribute('data-status', 'behind');
    }
  }

  // Time marker on progress bar (position based on hours elapsed / total hours)
  if (el.timeMarker) {
    const dayProgress = (hoursLogged / CONFIG.EFFECTIVE_WORK_HOURS) * 100;
    el.timeMarker.style.left = `${Math.min(dayProgress, 100)}%`;
  }

  // Strain name
  if (el.strainName) {
    el.strainName.textContent = sb.strain || 'No Active Strain';
  }
}


// ===== LAST HOUR =====

function updateLastHour(sb) {
  const lastLbs = sb.lastHourLbs || 0;
  const lastTarget = sb.currentHourTarget || 1;
  const lastPct = Math.round((lastLbs / lastTarget) * 100);
  const trimmers = sb.currentHourTrimmers || 0;
  const buckers = sb.currentHourBuckers || 0;

  if (el.lastHourLbs) el.lastHourLbs.textContent = lastLbs.toFixed(1);
  if (el.lastHourTarget) el.lastHourTarget.textContent = lastTarget.toFixed(1);
  if (el.lastHourPct) el.lastHourPct.textContent = `${lastPct}%`;

  // Ring progress (SVG stroke-dashoffset)
  if (el.lastHourRingProgress) {
    const circumference = CONFIG.HOUR_RING_CIRCUMFERENCE;
    const pct = Math.min(lastLbs / lastTarget, 1);
    const offset = circumference * (1 - pct);
    el.lastHourRingProgress.style.strokeDashoffset = offset;

    // Color class
    if (lastPct >= CONFIG.THRESHOLDS.ahead) {
      el.lastHourRingProgress.setAttribute('class', 'ring-progress ahead');
    } else if (lastPct >= CONFIG.THRESHOLDS.onTarget) {
      el.lastHourRingProgress.setAttribute('class', 'ring-progress on-target');
    } else {
      el.lastHourRingProgress.setAttribute('class', 'ring-progress behind');
    }
  }

  // Current hour slot
  if (el.lastHourSlot) {
    const now = new Date();
    const h = now.getHours();
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
    el.lastHourSlot.textContent = `${hour12}:00 ${period}`;
  }

  if (el.lastHourTrimmers) el.lastHourTrimmers.textContent = trimmers;
  if (el.lastHourBuckers) el.lastHourBuckers.textContent = buckers;
}


// ===== BAG TIMER =====

function updateBagTimer(timer) {
  if (!timer) return;

  const targetSeconds = timer.targetSeconds || 300;
  const bagsToday = timer.bagsToday || 0;
  const avgSeconds = timer.avgSecondsToday || 0;

  // Use local counter (ticked every second) for smooth display
  const seconds = state.timerSeconds;
  const pct = seconds / targetSeconds;

  // Timer value display (MM:SS)
  if (el.timerValue) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    el.timerValue.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  }

  // Timer ring SVG
  if (el.timerRingProgress) {
    const circumference = CONFIG.TIMER_RING_CIRCUMFERENCE;
    const ringPct = Math.min(pct, 1);
    const offset = circumference * (1 - ringPct);
    el.timerRingProgress.style.strokeDashoffset = offset;

    // Color state: green < 85%, yellow 85-100%, red > 100%
    let colorClass = 'timer-ring-progress';
    if (pct >= 1.0) {
      colorClass += ' danger';
    } else if (pct >= 0.85) {
      colorClass += ' warning';
    }
    el.timerRingProgress.setAttribute('class', colorClass);
  }

  // Glow effect around timer
  if (el.timerGlow) {
    if (pct >= 1.0) {
      el.timerGlow.setAttribute('data-state', 'danger');
    } else if (pct >= 0.85) {
      el.timerGlow.setAttribute('data-state', 'warning');
    } else {
      el.timerGlow.setAttribute('data-state', 'ok');
    }
  }

  // Status label
  if (el.timerStatusLabel) {
    if (pct < 0.85) {
      el.timerStatusLabel.textContent = 'On Pace';
      el.timerStatusLabel.className = 'cc2-timer-status on-pace';
    } else if (pct < 1.0) {
      el.timerStatusLabel.textContent = 'Watch Pace';
      el.timerStatusLabel.className = 'cc2-timer-status at-risk';
    } else {
      el.timerStatusLabel.textContent = 'Over Target';
      el.timerStatusLabel.className = 'cc2-timer-status lagging';
    }
  }

  // Bags today
  if (el.bagsToday) el.bagsToday.textContent = bagsToday;

  // Average cycle time
  if (el.avgCycleTime) {
    if (avgSeconds > 0) {
      const am = Math.floor(avgSeconds / 60);
      const as = Math.round(avgSeconds % 60);
      el.avgCycleTime.textContent = `${am}:${as.toString().padStart(2, '0')}`;
    } else {
      el.avgCycleTime.textContent = '--:--';
    }
  }

  // Trimmers at time of last bag (use current trimmers from scoreboard)
  if (el.timerTrimmers && state.scoreboard) {
    el.timerTrimmers.textContent = state.scoreboard.currentHourTrimmers || 0;
  }
}


// ===== CREW PERFORMANCE =====

function updateCrewPerformance(sb) {
  const trimmers = sb.currentHourTrimmers || 0;
  const buckers = sb.currentHourBuckers || 0;
  const total = trimmers + buckers;
  const targetRate = sb.targetRate || 0;

  if (el.totalCrew) el.totalCrew.textContent = total;
  if (el.targetRate) el.targetRate.textContent = `${targetRate.toFixed(2)} lbs/hr`;

  // Line breakdown - API provides aggregate, split display
  // v2 shows total crew; line-level data may come from extended API
  if (el.line1Trimmers) el.line1Trimmers.textContent = trimmers;
  if (el.line1Buckers) el.line1Buckers.textContent = buckers;
  if (el.line2Trimmers) el.line2Trimmers.textContent = '0';
  if (el.line2Buckers) el.line2Buckers.textContent = '0';
}


// ===== PREDICTIVE ANALYTICS =====

function updatePredictiveAnalytics(sb) {
  const todayLbs = sb.todayLbs || 0;
  const todayTarget = sb.todayTarget || 1;
  const hoursLogged = sb.effectiveHours || sb.hoursLogged || 0;
  const hoursRemaining = Math.max(CONFIG.EFFECTIVE_WORK_HOURS - hoursLogged, 0);

  // Current pace (lbs/hr)
  const currentPace = hoursLogged > 0 ? todayLbs / hoursLogged : 0;
  const targetPace = CONFIG.EFFECTIVE_WORK_HOURS > 0 ? todayTarget / CONFIG.EFFECTIVE_WORK_HOURS : 0;
  const vsTargetPct = targetPace > 0 ? Math.round((currentPace / targetPace) * 100) : 0;

  if (el.currentPace) el.currentPace.textContent = `${currentPace.toFixed(1)}`;
  if (el.vsTargetPct) {
    el.vsTargetPct.textContent = `${vsTargetPct}%`;
    el.vsTargetPct.className = 'cc2-vs-target';
    if (vsTargetPct >= CONFIG.THRESHOLDS.ahead) el.vsTargetPct.classList.add('ahead');
    else if (vsTargetPct >= CONFIG.THRESHOLDS.onTarget) el.vsTargetPct.classList.add('on-target');
    else el.vsTargetPct.classList.add('behind');
  }

  // Average pace (avg % from API)
  if (el.avgPace) {
    el.avgPace.textContent = `${(sb.avgPercentage || 0).toFixed(0)}% avg`;
  }

  // Projected total
  const projectedTotal = todayLbs + (currentPace * hoursRemaining);
  if (el.projectedTotal) {
    el.projectedTotal.textContent = `${projectedTotal.toFixed(1)} lbs`;
  }

  // Projected finish time
  const lbsRemaining = Math.max(todayTarget - todayLbs, 0);
  const hoursToTarget = currentPace > 0 ? lbsRemaining / currentPace : Infinity;

  if (el.finishTime || el.finishPeriod) {
    if (todayLbs >= todayTarget) {
      // Target already met
      if (el.finishTime) el.finishTime.textContent = 'DONE';
      if (el.finishPeriod) el.finishPeriod.textContent = '';
      if (el.finishDeltaText) {
        el.finishDeltaText.textContent = 'Target met!';
        el.finishDeltaText.className = 'cc2-finish-delta positive';
      }
    } else if (currentPace > 0 && hoursToTarget < 24) {
      const now = new Date();
      const finishDate = new Date(now.getTime() + hoursToTarget * 3600000);
      const h = finishDate.getHours();
      const m = finishDate.getMinutes();
      const period = h >= 12 ? 'PM' : 'AM';
      const hour12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);

      if (el.finishTime) el.finishTime.textContent = `${hour12}:${m.toString().padStart(2, '0')}`;
      if (el.finishPeriod) el.finishPeriod.textContent = period;

      // Delta text: how far ahead/behind schedule
      if (el.finishDeltaText) {
        const workEnd = new Date(now);
        workEnd.setHours(CONFIG.WORK_END_HOUR, CONFIG.WORK_END_MINUTE, 0, 0);
        const diffMinutes = Math.round((workEnd - finishDate) / 60000);

        if (diffMinutes > 0) {
          el.finishDeltaText.textContent = `${diffMinutes}m early`;
          el.finishDeltaText.className = 'cc2-finish-delta positive';
        } else if (diffMinutes < 0) {
          el.finishDeltaText.textContent = `${Math.abs(diffMinutes)}m late`;
          el.finishDeltaText.className = 'cc2-finish-delta negative';
        } else {
          el.finishDeltaText.textContent = 'On time';
          el.finishDeltaText.className = 'cc2-finish-delta';
        }
      }
    } else {
      if (el.finishTime) el.finishTime.textContent = '--:--';
      if (el.finishPeriod) el.finishPeriod.textContent = '';
      if (el.finishDeltaText) {
        el.finishDeltaText.textContent = 'Insufficient data';
        el.finishDeltaText.className = 'cc2-finish-delta';
      }
    }
  }
}


// ===== HOURLY CHART =====

function updateHourlyChart(hourlyData) {
  if (!el.hourlyChart || !hourlyData || hourlyData.length === 0) return;

  // Find max value for scaling
  const allValues = hourlyData.flatMap(h => [h.lbs || 0, h.target || 0]);
  const maxVal = Math.max(...allValues, 1);

  const barsHTML = hourlyData.map(h => {
    const lbs = h.lbs || 0;
    const target = h.target || 0;
    const pct = target > 0 ? Math.round((lbs / target) * 100) : 0;
    const barHeight = Math.round((lbs / maxVal) * 100);
    const targetHeight = Math.round((target / maxVal) * 100);

    let statusClass = 'behind';
    if (pct >= CONFIG.THRESHOLDS.ahead) statusClass = 'ahead';
    else if (pct >= CONFIG.THRESHOLDS.onTarget) statusClass = 'on-target';

    // Format hour label
    const hourNum = h.hour || 0;
    const period = hourNum >= 12 ? 'p' : 'a';
    const hour12 = hourNum > 12 ? hourNum - 12 : (hourNum === 0 ? 12 : hourNum);

    return `
      <div class="cc2-chart-col">
        <div class="cc2-chart-bar-wrap">
          <div class="cc2-chart-target" style="height:${targetHeight}%"></div>
          <div class="cc2-chart-bar ${statusClass}" style="height:${barHeight}%">
            <span class="cc2-chart-val">${lbs.toFixed(1)}</span>
          </div>
        </div>
        <div class="cc2-chart-label">${hour12}${period}</div>
      </div>
    `;
  }).join('');

  el.hourlyChart.innerHTML = barsHTML;
}


// ===== ALERTS =====

function checkAlerts() {
  const sb = state.scoreboard;
  const timer = state.timer;
  if (!sb) return;

  // Rate drop: last hour < 85% of target
  if (sb.lastHourLbs && sb.currentHourTarget) {
    const pct = sb.lastHourLbs / sb.currentHourTarget;
    if (pct < CONFIG.ALERT_THRESHOLDS.rateDrop) {
      addAlert('warning', 'Rate Drop',
        `Last hour at ${(pct * 100).toFixed(0)}% of target`);
    }
  }

  // Bag lag: timer > 120% of target
  if (timer && timer.secondsSinceLastBag && timer.targetSeconds) {
    const ratio = timer.secondsSinceLastBag / timer.targetSeconds;
    if (ratio > CONFIG.ALERT_THRESHOLDS.bagLag) {
      addAlert('danger', 'Bag Lag',
        `${Math.floor(ratio * 100)}% over target time`);
    }
  }

  // Target miss: daily < 90% after 2+ hours
  if (sb.todayPercentage && (sb.effectiveHours || 0) > 2) {
    if (sb.todayPercentage < CONFIG.ALERT_THRESHOLDS.targetMiss * 100) {
      addAlert('warning', 'Target Risk',
        `Daily at ${sb.todayPercentage.toFixed(0)}% of target`);
    }
  }

  // Low crew: trimmers < 3
  if ((sb.currentHourTrimmers || 0) < CONFIG.ALERT_THRESHOLDS.lowCrew && (sb.todayLbs || 0) > 0) {
    addAlert('info', 'Low Crew',
      `Only ${sb.currentHourTrimmers} trimmer(s) active`);
  }

  renderAlerts();
}

function addAlert(severity, title, message) {
  // Dedup: update timestamp if same title exists
  const existing = state.alerts.find(a => a.title === title);
  if (existing) {
    existing.time = new Date();
    existing.message = message;
    return;
  }

  state.alerts.unshift({
    id: Date.now(),
    severity,
    title,
    message,
    time: new Date()
  });

  // Cap max alerts
  if (state.alerts.length > CONFIG.MAX_ALERTS) {
    state.alerts.pop();
  }
}

function renderAlerts() {
  if (!el.alertsContent) return;

  if (state.alerts.length === 0) {
    el.alertsContent.innerHTML = '<span class="cc2-alerts-clear">All systems nominal</span>';
    if (el.alertsBar) el.alertsBar.setAttribute('data-count', '0');
    return;
  }

  if (el.alertsBar) el.alertsBar.setAttribute('data-count', state.alerts.length);

  // Show latest alert in the bar (single-line ticker style)
  const latest = state.alerts[0];
  const timeStr = latest.time.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false
  });

  el.alertsContent.innerHTML = `
    <span class="cc2-alert-badge ${latest.severity}">${latest.severity.toUpperCase()}</span>
    <span class="cc2-alert-text">${latest.title}: ${latest.message}</span>
    <span class="cc2-alert-time">${timeStr}</span>
    ${state.alerts.length > 1 ? `<span class="cc2-alert-more">+${state.alerts.length - 1} more</span>` : ''}
  `;
}

function clearAllAlerts() {
  state.alerts = [];
  renderAlerts();
}


// ===== CLOCK =====

function updateClock() {
  const now = new Date();

  if (el.clock) {
    el.clock.textContent = now.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
  }

  if (el.date) {
    el.date.textContent = now.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric'
    });
  }
}


// ===== TIMER TICK =====

function timerTick() {
  // Increment local timer counter for smooth 1s updates between polls
  state.timerSeconds++;

  // Update timer display with local counter
  if (state.timer) {
    updateBagTimer(state.timer);
  }
}


// ===== PERF STATS =====

function updatePerfStats() {
  if (el.lastUpdateTime && state.lastUpdate) {
    el.lastUpdateTime.textContent = state.lastUpdate.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
  }

  if (el.latency) {
    el.latency.textContent = `${state.fetchLatency}ms`;
  }
}


// ===== FULLSCREEN =====

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(err => {
      console.error('[CC2] Fullscreen error:', err);
    });
  } else {
    document.exitFullscreen();
  }
}


// ===== POLLING & INTERVALS =====

function startPolling() {
  if (state.pollIntervalId) clearInterval(state.pollIntervalId);
  state.pollIntervalId = setInterval(fetchData, CONFIG.POLL_INTERVAL);
}

function startTimerTick() {
  if (state.timerIntervalId) clearInterval(state.timerIntervalId);
  state.timerIntervalId = setInterval(timerTick, CONFIG.TIMER_TICK);
}

function startClock() {
  if (state.clockIntervalId) clearInterval(state.clockIntervalId);
  updateClock();
  state.clockIntervalId = setInterval(updateClock, CONFIG.TIMER_TICK);
}


// ===== EVENT LISTENERS =====

function setupEventListeners() {
  if (el.refreshBtn) {
    el.refreshBtn.addEventListener('click', () => {
      el.refreshBtn.classList.add('spinning');
      fetchData().finally(() => {
        setTimeout(() => el.refreshBtn.classList.remove('spinning'), 500);
      });
    });
  }

  // Keyboard shortcut: F for fullscreen
  document.addEventListener('keydown', (e) => {
    if (e.key === 'f' && !e.ctrlKey && !e.metaKey && e.target.tagName !== 'INPUT') {
      toggleFullscreen();
    }
  });

  // Perf overlay toggle (click on latency or press P)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'p' && !e.ctrlKey && !e.metaKey && e.target.tagName !== 'INPUT') {
      if (el.perfOverlay) {
        el.perfOverlay.classList.toggle('visible');
      }
    }
  });

  // Visibility change: refresh when tab becomes visible again
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      fetchData();
    }
  });
}


// ===== INITIALIZATION =====

async function init() {
  console.log('[CC2] Command Center v2 initializing...');

  cacheElements();
  setupEventListeners();

  // Set initial clock before data loads
  updateClock();

  // Fetch initial data
  await fetchData();

  // Start intervals
  startPolling();
  startTimerTick();
  startClock();

  console.log('[CC2] Command Center v2 ready');
}

// Start on DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Export for ES6 module usage
export { init, fetchData, CONFIG, state };
