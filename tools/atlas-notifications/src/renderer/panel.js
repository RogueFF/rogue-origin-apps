// ─── Atlas Notifications Panel — Command Bridge ─────────────────────

let notifications = [];
let activeTab = 'all';
let audioPlayer = null;
let playingAudioId = null;
let missionControlCollapsed = false;
let atlasUptime = null;

// ─── DOM References ─────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const list = $('#notification-list');
const emptyState = $('#empty-state');
const countEl = $('#notif-count');
const statusDot = $('#status-dot');
const statusText = $('#status-text');
const tabIndicator = $('#tab-indicator');

// ─── Init ───────────────────────────────────────────────────────────

async function init() {
  audioPlayer = $('#audio-player');
  notifications = await window.atlas.getNotifications();
  render();
  checkStatus();
  updateMissionControl();
  setInterval(checkStatus, 30000);
  setInterval(updateMissionControl, 10000);
  updateTabIndicator();

  // Audio ended handler
  audioPlayer.addEventListener('ended', () => {
    playingAudioId = null;
    renderAudioButtons();
  });
}

// ─── Mission Control Widget Management ──────────────────────────────

$('#mc-header').addEventListener('click', () => {
  missionControlCollapsed = !missionControlCollapsed;
  $('#mission-control').classList.toggle('collapsed', missionControlCollapsed);
});

async function updateMissionControl() {
  const result = await window.atlas.checkAtlasStatus();
  
  // Connection widget
  const connEl = $('#widget-connection');
  if (connEl) {
    connEl.textContent = result.online ? 'Online' : 'Offline';
    connEl.style.color = result.online ? 'var(--green)' : 'var(--red)';
  }

  // Uptime widget
  const uptimeEl = $('#widget-uptime');
  if (uptimeEl && result.online) {
    if (!atlasUptime) atlasUptime = Date.now();
    const uptime = Math.floor((Date.now() - atlasUptime) / 1000);
    uptimeEl.textContent = formatUptime(uptime);
  } else if (uptimeEl) {
    atlasUptime = null;
    uptimeEl.textContent = '—';
  }
}

function formatUptime(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return `${seconds}s`;
}

// ─── Tab Indicator ──────────────────────────────────────────────────

function updateTabIndicator() {
  const activeEl = $('.tab.active');
  if (!activeEl || !tabIndicator) return;
  const tabsRect = $('#tabs').getBoundingClientRect();
  const rect = activeEl.getBoundingClientRect();
  tabIndicator.style.left = (rect.left - tabsRect.left) + 'px';
  tabIndicator.style.width = rect.width + 'px';
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
    list.querySelectorAll('.notif-card').forEach(el => el.remove());
    return;
  }

  emptyState.style.display = 'none';

  const html = filtered.map(n => renderCard(n)).join('');

  const scrollTop = list.scrollTop;
  // Keep empty state in DOM but hidden
  const emptyEl = emptyState.outerHTML;
  list.innerHTML = emptyEl + html;
  list.scrollTop = scrollTop;
}

// ─── Card Router ────────────────────────────────────────────────────

function renderCard(n) {
  switch (n.type) {
    case 'briefing': return renderBriefingCard(n);
    case 'alert': return renderAlertCard(n);
    case 'production-card': return renderProductionCard(n);
    default: return renderToastCard(n);
  }
}

// ─── Toast Card ─────────────────────────────────────────────────────

function renderToastCard(n) {
  const time = formatTime(n.timestamp);
  const unread = n.read ? '' : ' unread';
  return `
    <div class="notif-card card-enter${unread}" data-id="${n.id}" data-type="toast">
      <div class="notif-header">
        <div class="notif-header-left">
          <span class="notif-title">${escapeHtml(n.title)}</span>
        </div>
        <span class="notif-time">${time}</span>
      </div>
      <div class="notif-body">${escapeHtml(n.body)}</div>
    </div>
  `;
}

// ─── Briefing Card ──────────────────────────────────────────────────

function renderBriefingCard(n) {
  const time = formatTime(n.timestamp);
  const unread = n.read ? '' : ' unread';

  // Parse segments from data or body
  let segmentsHtml = '';
  if (n.data && n.data.segments && n.data.segments.length > 0) {
    segmentsHtml = `<div class="briefing-segments">
      ${n.data.segments.map(seg => `
        <div class="briefing-segment">
          <div class="briefing-segment-header">
            <span class="briefing-segment-icon">${seg.icon || '\uD83D\uDCCC'}</span>
            <span class="briefing-segment-label">${escapeHtml(seg.label || seg.category || 'Update')}</span>
          </div>
          <div class="briefing-segment-text">${escapeHtml(seg.text || seg.summary || '')}</div>
        </div>
      `).join('')}
    </div>`;
  } else if (n.body) {
    segmentsHtml = `<div class="notif-body">${escapeHtml(n.body)}</div>`;
  }

  // Audio controls
  const isPlaying = playingAudioId === n.id;
  const audioHtml = n.audio_url ? `
    <div class="briefing-audio-controls">
      <button class="btn-audio${isPlaying ? ' playing' : ''}" data-audio="${escapeHtml(n.audio_url)}" data-notif-id="${n.id}">
        ${isPlaying ? renderSoundWave() : '\uD83D\uDD0A'} ${isPlaying ? 'Playing' : 'Replay'}
      </button>
    </div>
  ` : '';

  return `
    <div class="notif-card card-enter${unread}" data-id="${n.id}" data-type="briefing">
      <div class="notif-header">
        <div class="notif-header-left">
          <span class="notif-title">${escapeHtml(n.title)}</span>
        </div>
        <span class="notif-time">${time}</span>
      </div>
      ${segmentsHtml}
      ${audioHtml}
    </div>
  `;
}

function renderSoundWave() {
  return `<span class="sound-wave"><span class="bar"></span><span class="bar"></span><span class="bar"></span><span class="bar"></span></span>`;
}

// ─── Alert Card ─────────────────────────────────────────────────────

function renderAlertCard(n) {
  const time = formatTime(n.timestamp);
  const unread = n.read ? '' : ' unread';
  const acked = n.acknowledged ? ' acknowledged' : '';
  const ackBtn = n.acknowledged ? '' : `
    <div class="alert-footer">
      <button class="btn-acknowledge" data-ack-id="${n.id}">Acknowledge</button>
    </div>
  `;

  return `
    <div class="notif-card card-enter${unread}${acked}" data-id="${n.id}" data-type="alert">
      <div class="notif-header">
        <div class="notif-header-left">
          <span class="notif-icon">\u26A0\uFE0F</span>
          <span class="notif-title">${escapeHtml(n.title)}</span>
        </div>
        <span class="notif-time">${time}</span>
      </div>
      <div class="notif-body">${escapeHtml(n.body)}</div>
      ${ackBtn}
    </div>
  `;
}

// ─── Production Card with SVG Gauges ────────────────────────────────

function renderProductionCard(n) {
  const time = formatTime(n.timestamp);
  const unread = n.read ? '' : ' unread';
  const d = n.data || {};
  const pace = d.paceStatus || 'on-pace';
  const paceClass = pace === 'ahead' ? 'ahead' : pace === 'behind' ? 'behind' : 'on-pace';
  const paceLabel = pace === 'ahead' ? 'ahead' : pace === 'behind' ? 'behind' : 'on pace';
  const pct = d.percentOfTarget || 0;

  // Stats with circular gauges
  const lbs = d.dailyTotal != null ? d.dailyTotal.toFixed(1) : '—';
  const target = pct || 0;
  const crew = d.trimmers || d.crew || 0;
  const rate = d.rate ? d.rate.toFixed(2) : 0;

  // Color based on pace
  const gaugeColor = paceClass === 'ahead' ? 'green' : paceClass === 'behind' ? 'red' : 'gold';

  // Sparkline from hourly data
  let sparkHtml = '';
  if (d.hourly && d.hourly.length > 0) {
    const maxVal = Math.max(...d.hourly.map(h => h.actual || 0), 1);
    sparkHtml = `<div class="prod-sparkline">
      ${d.hourly.map(h => {
        const height = Math.max(((h.actual || 0) / maxVal) * 100, 5);
        const barPace = (h.actual || 0) >= (h.target || d.targetRate || 0) ? 'ahead' : 'behind';
        return `<div class="prod-sparkline-bar ${barPace}" style="height:${height}%"></div>`;
      }).join('')}
    </div>`;
  }

  return `
    <div class="notif-card card-enter${unread} pace-${paceClass}" data-id="${n.id}" data-type="production-card">
      <div class="notif-header">
        <div class="notif-header-left">
          <span class="notif-title">Hourly Production</span>
        </div>
        <span class="notif-time">${time}</span>
      </div>
      <div class="prod-stats-grid">
        ${renderGaugeStat(lbs, 'lbs', gaugeColor, Math.min(target, 100))}
        ${renderGaugeStat(target + '%', 'target', gaugeColor, target)}
        ${renderGaugeStat(crew, 'crew', gaugeColor, Math.min((crew / 10) * 100, 100))}
        ${renderGaugeStat(rate, 'rate', gaugeColor, Math.min((rate / 5) * 100, 100))}
      </div>
      ${sparkHtml}
      <div class="prod-pace">
        <span class="prod-pace-text ${paceClass}">${paceLabel}</span>
        <span class="prod-pace-pct ${paceClass}">${pct}%</span>
      </div>
    </div>
  `;
}

function renderGaugeStat(value, label, color, percent) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return `
    <div class="prod-stat">
      <svg class="prod-gauge" viewBox="0 0 60 60">
        <circle class="prod-gauge-bg" cx="30" cy="30" r="${radius}"></circle>
        <circle class="prod-gauge-fill ${color}" cx="30" cy="30" r="${radius}"
          stroke-dasharray="${circumference}"
          stroke-dashoffset="${offset}"></circle>
        <text class="prod-gauge-value" x="30" y="35" text-anchor="middle">${value}</text>
      </svg>
      <div class="prod-stat-label">${label}</div>
    </div>
  `;
}

// ─── Audio ──────────────────────────────────────────────────────────

function playAudio(url, notifId) {
  if (!audioPlayer) return;

  // Toggle if same
  if (playingAudioId === notifId && !audioPlayer.paused) {
    audioPlayer.pause();
    playingAudioId = null;
    renderAudioButtons();
    return;
  }

  audioPlayer.src = url;
  audioPlayer.play().then(() => {
    playingAudioId = notifId;
    renderAudioButtons();
  }).catch(() => {
    playingAudioId = null;
    renderAudioButtons();
  });
}

function renderAudioButtons() {
  // Re-render just the audio button states without full re-render
  $$('.btn-audio').forEach(btn => {
    const nid = btn.dataset.notifId;
    const isPlaying = playingAudioId === nid;
    btn.classList.toggle('playing', isPlaying);
    btn.innerHTML = isPlaying ? `${renderSoundWave()} Playing` : '\uD83D\uDD0A Replay';
  });
}

// ─── Event Listeners ────────────────────────────────────────────────

// Tabs
$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeTab = tab.dataset.tab;
    render();
    // Defer indicator update to next frame so layout has settled
    requestAnimationFrame(updateTabIndicator);
  });
});

// Close
$('#btn-close').addEventListener('click', () => window.atlas.closePanel());

// Clear all
$('#btn-clear').addEventListener('click', async () => {
  await window.atlas.clearAll();
  notifications = [];
  render();
});

// Card clicks
list.addEventListener('click', async (e) => {
  // Audio play
  const audioBtn = e.target.closest('.btn-audio');
  if (audioBtn) {
    const url = audioBtn.dataset.audio;
    const nid = audioBtn.dataset.notifId;
    if (url) playAudio(url, nid);
    return;
  }

  // Acknowledge alert
  const ackBtn = e.target.closest('.btn-acknowledge');
  if (ackBtn) {
    const id = ackBtn.dataset.ackId;
    await window.atlas.acknowledgeAlert(id);
    const notif = notifications.find(n => n.id === id);
    if (notif) {
      notif.acknowledged = true;
      notif.read = true;
    }
    render();
    return;
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

// ─── Settings Panel ─────────────────────────────────────────────────

const settingsOverlay = $('#settings-overlay');

$('#btn-settings').addEventListener('click', () => openSettings());
$('#settings-back').addEventListener('click', () => closeSettings());
$('#btn-save-settings').addEventListener('click', () => saveSettings());

// Toggle switches
$$('.settings-toggle').forEach(toggle => {
  toggle.addEventListener('click', () => {
    const isOn = toggle.dataset.on === 'true';
    toggle.dataset.on = isOn ? 'false' : 'true';
  });
});

// Volume slider
const volumeSlider = $('#set-volume');
const volumeValue = $('#set-volume-value');
if (volumeSlider) {
  volumeSlider.addEventListener('input', () => {
    volumeValue.textContent = volumeSlider.value + '%';
  });
}

// Voice loading on ElevenLabs key blur
const elKeyInput = $('#set-elevenlabs-key');
if (elKeyInput) {
  elKeyInput.addEventListener('blur', () => loadVoices());
}

async function openSettings() {
  // Load current values
  try {
    const settings = await window.atlas.getSettings();
    $('#set-host').value = settings.atlasHost || '';
    $('#set-port').value = settings.port || 9400;
    $('#set-token').value = settings.apiToken || '';
    $('#set-sound').dataset.on = settings.soundEnabled !== false ? 'true' : 'false';
    $('#set-autostart').dataset.on = settings.autoStart !== false ? 'true' : 'false';
  } catch (e) { /* use defaults */ }

  try {
    const tts = await window.atlas.getTtsConfig();
    $('#set-elevenlabs-key').value = tts.elevenLabsKey || '';
    $('#set-tts-enabled').dataset.on = tts.ttsEnabled !== false ? 'true' : 'false';
    const vol = Math.round((tts.ttsVolume || 0.8) * 100);
    $('#set-volume').value = vol;
    $('#set-volume-value').textContent = vol + '%';

    if (tts.elevenLabsKey) {
      loadVoices(tts.elevenLabsVoice);
    }
  } catch (e) { /* use defaults */ }

  settingsOverlay.classList.add('open');
}

function closeSettings() {
  settingsOverlay.classList.remove('open');
}

async function loadVoices(selectedId) {
  const select = $('#set-voice');
  try {
    const voices = await window.atlas.getVoices();
    select.innerHTML = '<option value="">Select voice...</option>';
    voices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.voice_id;
      opt.textContent = v.name;
      if (v.voice_id === selectedId) opt.selected = true;
      select.appendChild(opt);
    });
  } catch (e) {
    select.innerHTML = '<option value="">No voices found</option>';
  }
}

async function saveSettings() {
  try {
    await window.atlas.setSettings({
      atlasHost: $('#set-host').value,
      port: parseInt($('#set-port').value) || 9400,
      apiToken: $('#set-token').value,
      soundEnabled: $('#set-sound').dataset.on === 'true',
      autoStart: $('#set-autostart').dataset.on === 'true'
    });

    await window.atlas.setTtsConfig({
      elevenLabsKey: $('#set-elevenlabs-key').value,
      elevenLabsVoice: $('#set-voice').value,
      ttsEnabled: $('#set-tts-enabled').dataset.on === 'true',
      ttsVolume: parseInt($('#set-volume').value) / 100
    });
  } catch (e) { /* silent fail */ }

  closeSettings();
}

// ─── IPC Listeners ──────────────────────────────────────────────────

window.atlas.onNewNotification((notif) => {
  notifications.unshift(notif);
  render();

  // Auto-play audio for briefings
  if (notif.audio_url && notif.type === 'briefing') {
    setTimeout(() => playAudio(notif.audio_url, notif.id), 500);
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
    statusText.textContent = result.online ? 'connected' : 'offline';
  } catch {
    statusDot.className = 'status-dot offline';
    statusText.textContent = 'error';
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
