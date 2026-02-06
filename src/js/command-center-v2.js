/**
 * Command Center v2 - Main Controller
 * Modern Data Observatory
 * Real-time production monitoring with refined UI
 */

// ===== CONFIGURATION =====
const CONFIG = {
  API_URL: 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production',
  POLL_INTERVAL: 30000, // 30 seconds
  TIMER_TICK: 1000, // 1 second
  MAX_RETRIES: 3,
  
  THRESHOLDS: {
    ahead: 105,
    onTrack: 90,
    behind: 0
  },
  
  WORK_SCHEDULE: {
    startHour: 7,
    endHour: 16,
    endMinute: 30,
    effectiveHours: 7.5
  },
  
  ALERT_THRESHOLDS: {
    rateDrop: 0.85,
    bagLag: 1.2,
    targetMiss: 0.90,
    lowCrew: 3
  }
};

// ===== STATE MANAGEMENT =====
const state = {
  scoreboard: null,
  timer: null,
  lastUpdate: null,
  isConnected: false,
  alerts: [],
  consecutiveFailures: 0,
  intervals: {
    poll: null,
    timer: null,
    clock: null
  }
};

// ===== DOM ELEMENTS =====
const elements = {
  // Header
  liveClock: document.getElementById('liveClock'),
  dateDisplay: document.getElementById('dateDisplay'),
  strainName: document.getElementById('strainName'),
  connectionStatus: document.getElementById('connectionStatus'),
  refreshBtn: document.getElementById('refreshBtn'),
  
  // Daily Progress
  dailyActual: document.getElementById('dailyActual'),
  dailyTarget: document.getElementById('dailyTarget'),
  dailyProgress: document.getElementById('dailyProgress'),
  dailyPercentage: document.getElementById('dailyPercentage'),
  dailyStatusBadge: document.getElementById('dailyStatusBadge'),
  timeMarker: document.getElementById('timeMarker'),
  hoursLogged: document.getElementById('hoursLogged'),
  avgPerformance: document.getElementById('avgPerformance'),
  
  // Current Pace
  currentPace: document.getElementById('currentPace'),
  vsTarget: document.getElementById('vsTarget'),
  avgPaceValue: document.getElementById('avgPaceValue'),
  
  // Projected Finish
  finishTime: document.getElementById('finishTime'),
  finishPeriod: document.getElementById('finishPeriod'),
  finishDelta: document.getElementById('finishDelta'),
  finishDeltaText: document.getElementById('finishDeltaText'),
  projectedTotal: document.getElementById('projectedTotal'),
  
  // Last Hour
  lastHourLbs: document.getElementById('lastHourLbs'),
  lastHourTarget: document.getElementById('lastHourTarget'),
  lastHourPercent: document.getElementById('lastHourPercent'),
  hourTimeSlot: document.getElementById('hourTimeSlot'),
  lastHourTrimmers: document.getElementById('lastHourTrimmers'),
  lastHourBuckers: document.getElementById('lastHourBuckers'),
  hourRingFill: document.getElementById('hourRingFill'),
  
  // Bag Timer
  timerValue: document.getElementById('timerValue'),
  timerLabel: document.getElementById('timerLabel'),
  timerProgress: document.getElementById('timerProgress'),
  bagsToday: document.getElementById('bagsToday'),
  avgCycleTime: document.getElementById('avgCycleTime'),
  currentTrimmers: document.getElementById('currentTrimmers'),
  
  // Crew
  totalCrew: document.getElementById('totalCrew'),
  line1Trimmers: document.getElementById('line1Trimmers'),
  line1Buckers: document.getElementById('line1Buckers'),
  line2Trimmers: document.getElementById('line2Trimmers'),
  line2Buckers: document.getElementById('line2Buckers'),
  targetRate: document.getElementById('targetRate'),
  
  // Chart
  hourlyChart: document.getElementById('hourlyChart'),
  
  // Alerts
  alertsContent: document.getElementById('alertsContent'),
  clearAlertsBtn: document.getElementById('clearAlertsBtn'),
  
  // Debug
  debugOverlay: document.getElementById('debugOverlay'),
  debugLastUpdate: document.getElementById('debugLastUpdate'),
  debugLatency: document.getElementById('debugLatency'),
  debugRender: document.getElementById('debugRender')
};

// ===== INITIALIZATION =====
async function init() {
  console.log('🔭 Command Center v2 initializing...');
  
  // Initial data fetch
  await fetchData();
  
  // Start intervals
  startIntervals();
  
  // Event listeners
  setupEventListeners();
  
  // Keyboard shortcuts
  setupKeyboardShortcuts();
  
  console.log('✅ Command Center v2 ready');
}

function setupEventListeners() {
  if (elements.refreshBtn) {
    elements.refreshBtn.addEventListener('click', () => {
      fetchData();
      elements.refreshBtn.style.transform = 'rotate(360deg)';
      setTimeout(() => {
        elements.refreshBtn.style.transform = '';
      }, 600);
    });
  }
  
  if (elements.clearAlertsBtn) {
    elements.clearAlertsBtn.addEventListener('click', clearAllAlerts);
  }
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+P: Toggle debug overlay
    if (e.ctrlKey && e.shiftKey && e.key === 'P') {
      e.preventDefault();
      const overlay = elements.debugOverlay;
      if (overlay) {
        overlay.hidden = !overlay.hidden;
        overlay.setAttribute('aria-hidden', overlay.hidden);
      }
    }
    
    // Ctrl+R: Refresh data
    if (e.ctrlKey && e.key === 'r') {
      e.preventDefault();
      fetchData();
    }
  });
}

// ===== INTERVALS =====
function startIntervals() {
  // Clock update every second
  updateClock();
  state.intervals.clock = setInterval(updateClock, 1000);
  
  // Data polling
  state.intervals.poll = setInterval(fetchData, CONFIG.POLL_INTERVAL);
  
  // Timer tick for bag timer
  state.intervals.timer = setInterval(updateTimerDisplay, CONFIG.TIMER_TICK);
}

// ===== CLOCK =====
function updateClock() {
  const now = new Date();
  
  if (elements.liveClock) {
    const timeStr = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    elements.liveClock.textContent = timeStr;
    elements.liveClock.setAttribute('datetime', now.toISOString());
  }
  
  if (elements.dateDisplay) {
    const dateStr = now.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
    elements.dateDisplay.textContent = dateStr;
  }
}

// ===== DATA FETCHING =====
async function fetchData() {
  const startTime = performance.now();
  
  try {
    const response = await fetch(`${CONFIG.API_URL}?action=scoreboard`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    const latency = Math.round(performance.now() - startTime);
    
    // Update state
    state.scoreboard = data.scoreboard;
    state.timer = data.timer;
    state.lastUpdate = new Date();
    state.isConnected = true;
    state.consecutiveFailures = 0;
    
    // Update connection status
    updateConnectionStatus('live');
    
    // Update UI
    const renderStart = performance.now();
    updateUI();
    const renderTime = Math.round(performance.now() - renderStart);
    
    // Check for alerts
    checkAlerts();
    
    // Update debug info
    updateDebugInfo(latency, renderTime);
    
  } catch (error) {
    console.error('[Command Center v2] Fetch error:', error);
    state.consecutiveFailures++;
    
    if (state.consecutiveFailures >= CONFIG.MAX_RETRIES) {
      state.isConnected = false;
      updateConnectionStatus('offline');
      addAlert('danger', 'Connection Lost', 'Unable to fetch production data. Retrying...');
    } else {
      updateConnectionStatus('connecting');
    }
  }
}

function updateConnectionStatus(status) {
  if (!elements.connectionStatus) return;
  
  elements.connectionStatus.setAttribute('data-status', status);
  
  const statusText = elements.connectionStatus.querySelector('.status-text');
  if (statusText) {
    const labels = {
      live: 'Live',
      connecting: 'Connecting',
      offline: 'Offline'
    };
    statusText.textContent = labels[status] || status;
  }
}

function updateDebugInfo(latency, renderTime) {
  if (elements.debugLastUpdate) {
    elements.debugLastUpdate.textContent = state.lastUpdate.toLocaleTimeString();
  }
  if (elements.debugLatency) {
    elements.debugLatency.textContent = `${latency}ms`;
  }
  if (elements.debugRender) {
    elements.debugRender.textContent = `${renderTime}ms`;
  }
}

// ===== UI UPDATES =====
function updateUI() {
  if (!state.scoreboard) return;
  
  updateDailyProgress();
  updateCurrentPace();
  updateProjectedFinish();
  updateLastHour();
  updateBagTimer();
  updateCrewBreakdown();
  updateHourlyChart();
}

function updateDailyProgress() {
  const s = state.scoreboard;
  
  // Values
  if (elements.dailyActual) {
    elements.dailyActual.textContent = (s.todayLbs || 0).toFixed(1);
  }
  if (elements.dailyTarget) {
    elements.dailyTarget.textContent = (s.todayTarget || 0).toFixed(1);
  }
  
  // Percentage and progress bar
  const percentage = s.todayPercentage || 0;
  if (elements.dailyPercentage) {
    elements.dailyPercentage.textContent = `${Math.round(percentage)}%`;
  }
  if (elements.dailyProgress) {
    elements.dailyProgress.style.setProperty('--progress', `${Math.min(percentage, 100)}%`);
  }
  
  // Status badge
  let status = 'on-track';
  let statusText = 'On Track';
  if (percentage >= CONFIG.THRESHOLDS.ahead) {
    status = 'ahead';
    statusText = 'Ahead';
  } else if (percentage < CONFIG.THRESHOLDS.onTrack) {
    status = 'behind';
    statusText = 'Behind';
  }
  
  if (elements.dailyStatusBadge) {
    elements.dailyStatusBadge.setAttribute('data-status', status);
    const badgeText = elements.dailyStatusBadge.querySelector('.badge-text');
    if (badgeText) {
      badgeText.textContent = statusText;
    }
  }
  
  // Time marker (expected progress based on time)
  const now = new Date();
  const hours = now.getHours() + now.getMinutes() / 60;
  const effectiveHours = CONFIG.WORK_SCHEDULE.effectiveHours;
  const startHour = CONFIG.WORK_SCHEDULE.startHour;
  const endHour = CONFIG.WORK_SCHEDULE.endHour + CONFIG.WORK_SCHEDULE.endMinute / 60;
  
  const elapsedHours = Math.max(0, hours - startHour);
  const totalWorkHours = endHour - startHour;
  const expectedProgress = Math.min((elapsedHours / totalWorkHours) * 100, 100);
  
  if (elements.timeMarker) {
    elements.timeMarker.style.setProperty('--position', `${expectedProgress}%`);
  }
  
  // Footer stats
  if (elements.hoursLogged) {
    elements.hoursLogged.textContent = `${(s.hoursLogged || 0).toFixed(1)} hrs`;
  }
  if (elements.avgPerformance) {
    elements.avgPerformance.textContent = `${Math.round(s.avgPercentage || 0)}%`;
  }
  
  // Strain name
  if (elements.strainName) {
    elements.strainName.textContent = s.strain || 'Unknown Strain';
  }
}

function updateCurrentPace() {
  const s = state.scoreboard;
  const hoursLogged = s.effectiveHours || s.hoursLogged || 1;
  const pace = hoursLogged > 0 ? (s.todayLbs || 0) / hoursLogged : 0;
  
  if (elements.currentPace) {
    elements.currentPace.textContent = pace.toFixed(1);
  }
  
  // vs Target
  const targetPace = (s.targetRate || 1) * (s.currentHourTrimmers || 1);
  const vsTargetPct = targetPace > 0 ? (pace / targetPace) * 100 : 0;
  
  if (elements.vsTarget) {
    elements.vsTarget.textContent = `${Math.round(vsTargetPct)}%`;
    let trend = 'neutral';
    if (vsTargetPct >= 105) trend = 'ahead';
    else if (vsTargetPct < 90) trend = 'behind';
    elements.vsTarget.setAttribute('data-trend', trend);
  }
  
  // Average pace
  if (elements.avgPaceValue) {
    elements.avgPaceValue.textContent = `${pace.toFixed(1)} lbs/hr`;
  }
}

function updateProjectedFinish() {
  const s = state.scoreboard;
  const hoursLogged = s.effectiveHours || s.hoursLogged || 0;
  const pace = hoursLogged > 0 ? (s.todayLbs || 0) / hoursLogged : 0;
  const remaining = Math.max((s.todayTarget || 0) - (s.todayLbs || 0), 0);
  const hoursToFinish = pace > 0 ? remaining / pace : 0;
  
  const now = new Date();
  const finishDate = new Date(now.getTime() + (hoursToFinish * 60 * 60 * 1000));
  
  if (elements.finishTime && elements.finishPeriod) {
    if (pace > 0 && remaining > 0 && hoursToFinish < 24) {
      const hours = finishDate.getHours();
      const minutes = finishDate.getMinutes();
      const period = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      
      elements.finishTime.textContent = `${displayHours}:${minutes.toString().padStart(2, '0')}`;
      elements.finishPeriod.textContent = period;
    } else if (remaining <= 0) {
      elements.finishTime.textContent = 'Complete';
      elements.finishPeriod.textContent = '✓';
    } else {
      elements.finishTime.textContent = '--:--';
      elements.finishPeriod.textContent = 'PM';
    }
  }
  
  // Finish delta
  const targetEndTime = new Date();
  targetEndTime.setHours(CONFIG.WORK_SCHEDULE.endHour, CONFIG.WORK_SCHEDULE.endMinute, 0);
  const deltaMinutes = Math.round((finishDate - targetEndTime) / 60000);
  
  if (elements.finishDelta && elements.finishDeltaText) {
    let trend = 'neutral';
    let text = 'On schedule';
    
    if (remaining <= 0) {
      trend = 'early';
      text = 'Target met';
    } else if (deltaMinutes < -30) {
      trend = 'early';
      text = `${Math.abs(deltaMinutes)} min early`;
    } else if (deltaMinutes > 30) {
      trend = 'late';
      text = `${deltaMinutes} min late`;
    }
    
    elements.finishDelta.setAttribute('data-trend', trend);
    elements.finishDeltaText.textContent = text;
  }
  
  // Projected total
  if (elements.projectedTotal) {
    const workdayHours = CONFIG.WORK_SCHEDULE.endHour - CONFIG.WORK_SCHEDULE.startHour;
    const hoursRemaining = Math.max(workdayHours - hoursLogged, 0);
    const projected = (s.todayLbs || 0) + (pace * hoursRemaining);
    elements.projectedTotal.textContent = `${projected.toFixed(1)} lbs`;
  }
}

function updateLastHour() {
  const s = state.scoreboard;
  const lastHourLbs = s.lastHourLbs || 0;
  const lastHourTarget = s.currentHourTarget || 1;
  const percentage = (lastHourLbs / lastHourTarget) * 100;
  
  if (elements.lastHourLbs) {
    elements.lastHourLbs.textContent = lastHourLbs.toFixed(1);
  }
  if (elements.lastHourTarget) {
    elements.lastHourTarget.textContent = lastHourTarget.toFixed(1);
  }
  if (elements.lastHourPercent) {
    elements.lastHourPercent.textContent = `${Math.round(percentage)}%`;
  }
  
  // Ring chart
  if (elements.hourRingFill) {
    const circumference = 327; // 2 * PI * 52
    const offset = circumference - (Math.min(percentage, 100) / 100) * circumference;
    elements.hourRingFill.style.strokeDashoffset = offset;
    
    let status = 'neutral';
    if (percentage >= 105) status = 'ahead';
    else if (percentage < 90) status = 'behind';
    elements.hourRingFill.setAttribute('data-status', status);
  }
  
  // Time slot
  if (elements.hourTimeSlot) {
    const now = new Date();
    const currentHour = now.getHours();
    const prevHour = currentHour - 1;
    elements.hourTimeSlot.textContent = `${prevHour.toString().padStart(2, '0')}:00 - ${currentHour.toString().padStart(2, '0')}:00`;
  }
  
  // Crew
  if (elements.lastHourTrimmers) {
    elements.lastHourTrimmers.textContent = s.currentHourTrimmers || 0;
  }
  if (elements.lastHourBuckers) {
    elements.lastHourBuckers.textContent = s.currentHourBuckers || 0;
  }
}

function updateBagTimer() {
  // This is called every second by the timer interval
  if (!state.timer) return;
  
  const secondsSince = state.timer.secondsSinceLastBag || 0;
  const targetSeconds = state.timer.targetSeconds || 300;
  const ratio = secondsSince / targetSeconds;
  
  // Timer value
  if (elements.timerValue) {
    const minutes = Math.floor(secondsSince / 60);
    const seconds = secondsSince % 60;
    elements.timerValue.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    let status = 'green';
    if (ratio >= 1.0) status = 'red';
    else if (ratio >= 0.85) status = 'yellow';
    elements.timerValue.setAttribute('data-status', status);
  }
  
  // Timer label
  if (elements.timerLabel) {
    const label = ratio >= 1.0 ? 'over target' : 'elapsed';
    elements.timerLabel.textContent = label;
  }
  
  // Progress ring
  if (elements.timerProgress) {
    const circumference = 534; // 2 * PI * 85
    const progress = Math.min(ratio, 1);
    const offset = circumference - (progress * circumference);
    elements.timerProgress.style.strokeDashoffset = offset;
    
    let status = 'green';
    if (ratio >= 1.0) status = 'red';
    else if (ratio >= 0.85) status = 'yellow';
    elements.timerProgress.setAttribute('data-status', status);
  }
  
  // Stats
  if (elements.bagsToday) {
    elements.bagsToday.textContent = state.timer.bagsToday || 0;
  }
  
  if (elements.avgCycleTime) {
    const avgSeconds = state.timer.avgSecondsToday || 0;
    if (avgSeconds > 0) {
      const minutes = Math.floor(avgSeconds / 60);
      const seconds = avgSeconds % 60;
      elements.avgCycleTime.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    } else {
      elements.avgCycleTime.textContent = '--:--';
    }
  }
  
  if (elements.currentTrimmers && state.scoreboard) {
    elements.currentTrimmers.textContent = state.scoreboard.currentHourTrimmers || 0;
  }
  
  // Update timer state every tick if data exists
  if (state.timer) {
    state.timer.secondsSinceLastBag = (state.timer.secondsSinceLastBag || 0) + 1;
  }
}

function updateTimerDisplay() {
  // Just update the visual display
  if (!state.timer) return;
  updateBagTimer();
}

function updateCrewBreakdown() {
  const s = state.scoreboard;
  
  // Total crew
  const total = (s.currentHourTrimmers || 0) + (s.currentHourBuckers || 0);
  if (elements.totalCrew) {
    elements.totalCrew.textContent = total;
  }
  
  // Line 1 (assuming current hour is Line 1 for now)
  if (elements.line1Trimmers) {
    elements.line1Trimmers.textContent = s.currentHourTrimmers || 0;
  }
  if (elements.line1Buckers) {
    elements.line1Buckers.textContent = s.currentHourBuckers || 0;
  }
  
  // Line 2 (placeholder - would need separate API data)
  if (elements.line2Trimmers) {
    elements.line2Trimmers.textContent = 0;
  }
  if (elements.line2Buckers) {
    elements.line2Buckers.textContent = 0;
  }
  
  // Target rate
  if (elements.targetRate) {
    elements.targetRate.textContent = (s.targetRate || 0).toFixed(2);
  }
}

function updateHourlyChart() {
  if (!elements.hourlyChart || !state.scoreboard) return;
  
  // For now, create a simple placeholder chart
  // In production, this would use actual hourly data from API
  const hours = state.scoreboard.hoursLogged || 0;
  
  if (hours === 0) {
    elements.hourlyChart.innerHTML = `
      <div class="chart-loading">
        <i class="ph ph-chart-line"></i>
        <span>No hourly data yet...</span>
      </div>
    `;
    return;
  }
  
  // Placeholder chart bars (would be replaced with real data)
  const numBars = Math.min(Math.ceil(hours), 10);
  const targetRate = state.scoreboard.targetRate || 1;
  const trimmers = state.scoreboard.currentHourTrimmers || 1;
  const targetPerHour = targetRate * trimmers;
  
  const bars = [];
  for (let i = 0; i < numBars; i++) {
    // Simulated data (in real implementation, would come from API)
    const actual = targetPerHour * (0.85 + Math.random() * 0.3);
    const percentage = (actual / targetPerHour) * 100;
    const height = Math.min((actual / targetPerHour) * 120, 120);
    
    let status = 'neutral';
    if (percentage >= 105) status = 'ahead';
    else if (percentage < 90) status = 'behind';
    
    const hour = CONFIG.WORK_SCHEDULE.startHour + i;
    
    bars.push(`
      <div class="chart-bar">
        <div class="bar-fill" data-status="${status}" style="height: ${height}px;">
          <div class="bar-target-line" style="bottom: ${(targetPerHour / targetPerHour) * height}px;"></div>
        </div>
        <span class="bar-label">${hour}:00</span>
      </div>
    `);
  }
  
  elements.hourlyChart.innerHTML = bars.join('');
}

// ===== ALERTS SYSTEM =====
function checkAlerts() {
  if (!state.scoreboard || !state.timer) return;
  
  const s = state.scoreboard;
  const t = state.timer;
  
  // Rate drop alert
  if (s.lastHourLbs && s.currentHourTarget) {
    const ratio = s.lastHourLbs / s.currentHourTarget;
    if (ratio < CONFIG.ALERT_THRESHOLDS.rateDrop) {
      addAlert('warning', 'Performance Dip', 
        `Last hour at ${Math.round(ratio * 100)}% of target. Check crew support needs.`);
    }
  }
  
  // Bag lag alert
  if (t.secondsSinceLastBag && t.targetSeconds) {
    const ratio = t.secondsSinceLastBag / t.targetSeconds;
    if (ratio > CONFIG.ALERT_THRESHOLDS.bagLag) {
      addAlert('danger', 'Bag Timer Alert', 
        `${Math.round(ratio * 100)}% over target time. Check for bottlenecks.`);
    }
  }
  
  // Target miss risk
  if (s.todayPercentage && s.effectiveHours > 2) {
    const targetPct = CONFIG.ALERT_THRESHOLDS.targetMiss * 100;
    if (s.todayPercentage < targetPct) {
      addAlert('warning', 'Target Risk', 
        `Currently at ${Math.round(s.todayPercentage)}% of daily target.`);
    }
  }
  
  // Low crew alert
  if (s.currentHourTrimmers < CONFIG.ALERT_THRESHOLDS.lowCrew && s.todayLbs > 0) {
    addAlert('info', 'Low Crew Count', 
      `Only ${s.currentHourTrimmers} trimmer(s) currently active.`);
  }
  
  renderAlerts();
}

function addAlert(severity, title, message) {
  // Check for duplicate
  const exists = state.alerts.some(a => a.title === title && a.message === message);
  if (exists) {
    // Update time on existing alert
    const alert = state.alerts.find(a => a.title === title);
    if (alert) alert.time = new Date();
    return;
  }
  
  state.alerts.push({
    id: Date.now(),
    severity,
    title,
    message,
    time: new Date()
  });
  
  // Keep only last 10 alerts
  if (state.alerts.length > 10) {
    state.alerts.shift();
  }
}

function renderAlerts() {
  if (!elements.alertsContent) return;
  
  if (state.alerts.length === 0) {
    elements.alertsContent.innerHTML = `
      <div class="alert-item info">
        <div class="alert-icon"><i class="ph ph-check-circle"></i></div>
        <div class="alert-text">
          <span class="alert-title">All Systems Operational</span>
          <span class="alert-message">No alerts at this time.</span>
        </div>
        <span class="alert-time">--:--</span>
      </div>
    `;
    if (elements.clearAlertsBtn) {
      elements.clearAlertsBtn.style.display = 'none';
    }
    return;
  }
  
  if (elements.clearAlertsBtn) {
    elements.clearAlertsBtn.style.display = 'block';
  }
  
  const iconMap = {
    danger: 'warning',
    warning: 'warning-circle',
    info: 'info',
    success: 'check-circle'
  };
  
  const alertsHTML = state.alerts.map(alert => {
    const timeStr = alert.time.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    
    return `
      <div class="alert-item ${alert.severity}">
        <div class="alert-icon"><i class="ph ph-${iconMap[alert.severity]}"></i></div>
        <div class="alert-text">
          <span class="alert-title">${alert.title}</span>
          <span class="alert-message">${alert.message}</span>
        </div>
        <span class="alert-time">${timeStr}</span>
      </div>
    `;
  }).join('');
  
  elements.alertsContent.innerHTML = alertsHTML;
}

function clearAllAlerts() {
  state.alerts = [];
  renderAlerts();
}

// ===== INITIALIZATION =====
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Export for debugging
window.CommandCenter = {
  state,
  fetchData,
  updateUI,
  addAlert,
  clearAllAlerts
};
