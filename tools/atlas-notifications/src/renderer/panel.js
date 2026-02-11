// ─── Atlas Notifications Panel ─────────────────────────────────────

let notifications = [];
let activeTab = 'all';
let audioPlayer = null;

// ─── DOM References ─────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const list = $('#notification-list');
const emptyState = $('#empty-state');
const countEl = $('#notif-count');
const statusDot = $('#status-dot');
const statusText = $('#status-text');

// ─── Init ───────────────────────────────────────────────────────────

async function init() {
  audioPlayer = $('#audio-player');
  notifications = await window.atlas.getNotifications();
  render();
  checkStatus();
  setInterval(checkStatus, 30000);
}

// ─── Render ─────────────────────────────────────────────────────────

function render() {
  const filtered = activeTab === 'all'
    ? notifications
    : notifications.filter(n => n.type === activeTab);

  const unread = notifications.filter(n => !n.read).length;
  const total = filtered.length;
  countEl.textContent = `${total} notification${total !== 1 ? 's' : ''}${unread ? ` · ${unread} unread` : ''}`;

  if (filtered.length === 0) {
    emptyState.style.display = 'flex';
    // Remove all cards but keep empty state
    list.querySelectorAll('.notif-card').forEach(el => el.remove());
    return;
  }

  emptyState.style.display = 'none';

  const html = filtered.map(n => {
    const time = formatTime(n.timestamp);
    const classes = [
      'notif-card',
      n.read ? '' : 'unread',
      n.priority === 'high' ? 'priority-high' : ''
    ].filter(Boolean).join(' ');

    // Production card — render rich mini-dashboard
    if (n.type === 'production-card' && n.data) {
      return renderProductionCard(n, classes, time);
    }

    // Standard notification card
    const audioBtn = n.audio_url
      ? `<div class="notif-audio" data-audio="${escapeHtml(n.audio_url)}">
           <span class="audio-icon">▶</span> Play briefing audio
         </div>`
      : '';

    return `
      <div class="${classes}" data-id="${n.id}">
        <div class="notif-header">
          <span class="notif-type ${n.type}">${n.type}</span>
          <span class="notif-time">${time}</span>
        </div>
        <div class="notif-title">${escapeHtml(n.title)}</div>
        <div class="notif-body">${escapeHtml(n.body)}</div>
        ${audioBtn}
      </div>
    `;
  }).join('');

  // Preserve scroll position
  const scrollTop = list.scrollTop;
  list.innerHTML = html;
  list.scrollTop = scrollTop;
}

// ─── Production Card Renderer ───────────────────────────────────────

function renderProductionCard(n, classes, time) {
  const d = n.data;
  const pace = d.paceStatus || 'on-pace';
  const paceLabel = pace === 'ahead' ? 'Ahead of Pace'
    : pace === 'behind' ? 'Behind Pace'
    : 'On Pace';
  const paceClass = pace === 'ahead' ? 'ahead'
    : pace === 'behind' ? 'behind'
    : 'on-pace';

  // Clamp progress bar at 100% visual width but show real percentage in label
  const pct = d.percentOfTarget || 0;
  const barWidth = Math.min(pct, 100);

  // Build hourly chart
  const chartHtml = renderHourlyChart(d.hourly, d.targetRate);

  // Build stats grid
  const stats = [
    { label: 'Trimmers', value: d.trimmers || '—', unit: '' },
    { label: 'Rate', value: d.rate ? d.rate.toFixed(2) : '—', unit: ' lbs/hr' },
    { label: 'Bags', value: d.bags || '—', unit: '' },
    { label: 'Avg Cycle', value: d.avgCycle || '—', unit: '' }
  ];

  const statsHtml = stats.map(s =>
    `<div class="prod-stat">
      <div class="prod-stat-label">${s.label}</div>
      <div class="prod-stat-value">${s.value}<span class="unit">${s.unit}</span></div>
    </div>`
  ).join('');

  // Best hour
  const bestHourHtml = d.bestHour
    ? `<div class="prod-best-hour">
        <span class="prod-best-hour-label">Best Hour: ${escapeHtml(d.bestHour.label)}</span>
        <span class="prod-best-hour-value">${d.bestHour.rate.toFixed(2)} lbs/hr</span>
      </div>`
    : '';

  return `
    <div class="${classes}" data-id="${n.id}">
      <div class="notif-header">
        <span class="notif-type production-card">production</span>
        <span class="notif-time">${time}</span>
      </div>
      <div class="prod-card collapsed" data-prod-card="${n.id}">
        <div class="prod-hero">
          <span class="prod-hero-number">${d.dailyTotal != null ? d.dailyTotal.toFixed(1) : '—'}</span>
          <span class="prod-hero-unit">lbs today</span>
        </div>
        ${d.strain ? `<div class="prod-hero-strain">${escapeHtml(d.strain)}</div>` : ''}

        <span class="prod-status ${paceClass}">${paceLabel}</span>

        <div class="prod-progress">
          <div class="prod-progress-bar">
            <div class="prod-progress-fill ${paceClass}" style="width: ${barWidth}%"></div>
          </div>
          <div class="prod-progress-labels">
            <span class="prod-progress-label">Target: ${d.dailyTarget != null ? d.dailyTarget.toFixed(1) : '—'} lbs</span>
            <span class="prod-progress-pct ${paceClass}">${pct}%</span>
          </div>
        </div>

        <div class="prod-stats">
          ${statsHtml}
        </div>

        <div class="prod-chart">
          <div class="prod-chart-title">Hourly Performance</div>
          ${chartHtml}
        </div>

        ${bestHourHtml}

        <div class="prod-expand-hint">tap to expand</div>
      </div>
    </div>
  `;
}

// ─── Hourly Mini Bar Chart ──────────────────────────────────────────

function renderHourlyChart(hourly, targetRate) {
  if (!hourly || hourly.length === 0) {
    return '<div style="font-size:10px;color:var(--text-muted);text-align:center;padding:8px 0;">No hourly data</div>';
  }

  // Find max value for scaling
  const maxVal = Math.max(...hourly.map(h => Math.max(h.actual || 0, h.target || targetRate || 0)));
  if (maxVal === 0) return '';

  // Target line position (as percentage from bottom)
  const targetVal = hourly[0]?.target || targetRate || 0;
  const targetPct = (targetVal / maxVal) * 100;

  const barsHtml = hourly.map(h => {
    const actual = h.actual || 0;
    const heightPct = (actual / maxVal) * 100;
    const isAbove = actual >= (h.target || targetRate || 0);
    const barClass = isAbove ? 'above-target' : 'below-target';

    return `
      <div class="prod-chart-bar-group">
        <div class="prod-chart-bar actual ${barClass}" style="height: ${heightPct}%"
             title="${h.hour}: ${actual.toFixed(2)} lbs/hr"></div>
        <span class="prod-chart-bar-label">${h.hour}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="prod-chart-bars" style="position: relative;">
      <div class="prod-chart-target-line" style="bottom: ${targetPct}%"></div>
      ${barsHtml}
    </div>
  `;
}

// ─── Event Listeners ────────────────────────────────────────────────

// Tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeTab = tab.dataset.tab;
    render();
  });
});

// Close
$('#btn-close').addEventListener('click', () => window.atlas.closePanel());

// Mark all read
$('#btn-mark-all').addEventListener('click', async () => {
  await window.atlas.markAllRead();
  notifications.forEach(n => n.read = true);
  render();
});

// Clear all
$('#btn-clear').addEventListener('click', async () => {
  await window.atlas.clearAll();
  notifications = [];
  render();
});

// Card clicks (mark read + play audio + expand production cards)
list.addEventListener('click', async (e) => {
  // Audio play
  const audioEl = e.target.closest('.notif-audio');
  if (audioEl) {
    const url = audioEl.dataset.audio;
    if (url) playAudio(url, audioEl);
    return;
  }

  // Production card expand/collapse
  const prodCard = e.target.closest('.prod-card');
  if (prodCard) {
    prodCard.classList.toggle('collapsed');
    prodCard.classList.toggle('expanded');
  }

  // Mark read
  const card = e.target.closest('.notif-card');
  if (card) {
    const id = card.dataset.id;
    const notif = notifications.find(n => n.id === id);
    if (notif && !notif.read) {
      await window.atlas.markRead(id);
      notif.read = true;
      card.classList.remove('unread');
      render();
    }
  }
});

// ─── Audio ──────────────────────────────────────────────────────────

function playAudio(url, buttonEl) {
  if (!audioPlayer) return;

  // Toggle if same URL
  if (audioPlayer.src === url && !audioPlayer.paused) {
    audioPlayer.pause();
    buttonEl.querySelector('.audio-icon').textContent = '▶';
    return;
  }

  // Reset all icons
  list.querySelectorAll('.notif-audio .audio-icon').forEach(el => el.textContent = '▶');

  audioPlayer.src = url;
  audioPlayer.play().then(() => {
    buttonEl.querySelector('.audio-icon').textContent = '⏸';
  }).catch(() => {
    buttonEl.querySelector('.audio-icon').textContent = '⚠';
  });

  audioPlayer.onended = () => {
    buttonEl.querySelector('.audio-icon').textContent = '▶';
  };
}

// ─── IPC Listeners ──────────────────────────────────────────────────

window.atlas.onNewNotification((notif) => {
  notifications.unshift(notif);
  render();

  // Auto-play audio for briefings
  if (notif.audio_url && notif.type === 'briefing') {
    setTimeout(() => playAudio(notif.audio_url, list.querySelector(`[data-id="${notif.id}"] .notif-audio`)), 500);
  }
});

window.atlas.onRefresh((notifs) => {
  notifications = notifs;
  render();
});

// ─── Status Check ───────────────────────────────────────────────────

async function checkStatus() {
  try {
    const result = await window.atlas.checkAtlasStatus();
    statusDot.className = 'status-dot ' + (result.online ? 'online' : 'offline');
    statusText.textContent = result.online ? 'Connected' : 'Offline';
  } catch {
    statusDot.className = 'status-dot offline';
    statusText.textContent = 'Error';
  }
}

// ─── Utilities ──────────────────────────────────────────────────────

function formatTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;

  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Boot ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
