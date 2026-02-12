// ─── Atlas Notifications Panel — Hologram Glitch Pass 3 ─────────────────

let notifications = [];
let activeTab = 'all';
let audioPlayer = null;
let playingAudioId = null;
let missionControlCollapsed = false;
let atlasUptime = null;
let lastMessageTime = null;

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
  setInterval(updateLastMessageDisplay, 30000);
  updateTabIndicator();

  // Audio ended handler
  if (audioPlayer) {
    audioPlayer.addEventListener('ended', () => {
      playingAudioId = null;
      renderAudioButtons();
    });
  }
}

// ─── Mission Control Widget Management ──────────────────────────────

$('#mc-header').addEventListener('click', () => {
  missionControlCollapsed = !missionControlCollapsed;
  $('#mission-control').classList.toggle('collapsed', missionControlCollapsed);
});

async function updateMissionControl() {
  try {
    const result = await window.atlas.checkAtlasStatus();

    // Atlas Status widget — connection
    const connText = $('#widget-conn-text');
    const widgetDot = $('#widget-dot');
    if (connText && widgetDot) {
      connText.textContent = result.online ? 'Online' : 'Offline';
      connText.style.color = result.online ? 'var(--holo-green)' : 'var(--signal-red)';
      widgetDot.className = 'widget-dot ' + (result.online ? 'online' : 'offline');
    }

    // Uptime tracking
    const uptimeEl = $('#widget-uptime');
    if (uptimeEl) {
      if (result.online) {
        if (!atlasUptime) atlasUptime = Date.now();
        const uptime = Math.floor((Date.now() - atlasUptime) / 1000);
        uptimeEl.textContent = formatUptime(uptime);
      } else {
        atlasUptime = null;
        uptimeEl.textContent = '\u2014';
      }
    }

    // Last message time
    updateLastMessageDisplay();

    // Production HUD — pull from latest production-card notification
    updateProductionHUD();
  } catch (e) {
    // Silent fail — widget just shows stale data
  }
}

function updateProductionHUD() {
  const prodNotif = notifications.find(n => n.type === 'production-card');
  if (!prodNotif || !prodNotif.data) return;

  const d = prodNotif.data;
  const lbsEl = $('#hud-lbs');
  const rateEl = $('#hud-rate');
  const paceEl = $('#hud-pace');

  if (lbsEl && d.dailyTotal != null) {
    lbsEl.textContent = d.dailyTotal.toFixed(1);
  }
  if (rateEl && d.rate != null) {
    rateEl.textContent = d.rate.toFixed(2);
  }
  if (paceEl && d.paceStatus) {
    const pace = d.paceStatus;
    const paceClass = pace === 'ahead' ? 'ahead' : pace === 'behind' ? 'behind' : 'on-pace';
    const paceLabel = pace === 'ahead' ? 'AHEAD' : pace === 'behind' ? 'BEHIND' : 'ON PACE';
    paceEl.textContent = paceLabel;
    paceEl.className = 'hud-pace ' + paceClass;
  }
}

function updateLastMessageDisplay() {
  const lastMsgEl = $('#widget-lastmsg');
  if (!lastMsgEl) return;

  if (lastMessageTime) {
    const diff = Date.now() - lastMessageTime;
    if (diff < 60000) {
      lastMsgEl.textContent = 'just now';
    } else if (diff < 3600000) {
      lastMsgEl.textContent = `${Math.floor(diff / 60000)}m ago`;
    } else {
      const d = new Date(lastMessageTime);
      lastMsgEl.textContent = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }
  } else if (notifications.length > 0) {
    // Use most recent notification timestamp
    const latest = notifications[0];
    if (latest.timestamp) {
      lastMessageTime = new Date(latest.timestamp).getTime();
      updateLastMessageDisplay();
    }
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
  countEl.textContent = `${total} notification${total !== 1 ? 's' : ''}${unread ? ` \u00B7 ${unread} unread` : ''}`;

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
    const labelEl = btn.querySelector('.btn-audio-label');
    if (isPlaying) {
      btn.innerHTML = `${renderSoundWave()} <span class="btn-audio-label">Playing</span>`;
    } else {
      btn.innerHTML = `${typeof SVG_ICONS !== 'undefined' ? SVG_ICONS.speaker : ''} <span class="btn-audio-label">Replay</span>`;
    }
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
    // Flash the button before re-render
    ackBtn.textContent = '[ CONFIRMED ]';
    ackBtn.style.color = 'var(--holo-green)';
    ackBtn.style.borderColor = 'var(--holo-green)';
    setTimeout(() => render(), 400);
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
  lastMessageTime = Date.now();
  render();
  updateMissionControl();

  // Auto-play audio for briefings
  if (notif.audio_url && notif.type === 'briefing') {
    setTimeout(() => playAudio(notif.audio_url, notif.id), 500);
  }
});

window.atlas.onRefresh((notifs) => {
  notifications = notifs;
  render();
  updateMissionControl();
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

// ─── Boot ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
