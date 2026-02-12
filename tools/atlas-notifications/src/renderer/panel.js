// ─── Atlas Notifications Panel — Pass 5: Dual Theme ───────────────────────

let notifications = [];
let activeTab = 'all';
let audioPlayer = null;
let playingAudioId = null;
let missionControlCollapsed = false;
let atlasUptime = null;
let lastMessageTime = null;
let currentTheme = 'relay';

// ─── Ambient Sound State ────────────────────────────────────────────
let ambientCtx = null;
let ambientGain = null;
let ambientOsc = null;
let ambientNoise = null;
let ambientActive = false;

// ─── DOM References ─────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const list = $('#notification-list');
const emptyState = $('#empty-state');
const countEl = $('#notif-count');
const statusDot = $('#status-dot');
const statusText = $('#status-text');
const tabIndicator = $('#tab-indicator');

// ─── Theme Management ────────────────────────────────────────────────

async function initTheme() {
  try {
    currentTheme = await window.atlas.getTheme();
  } catch (e) {
    currentTheme = 'relay';
  }
  applyTheme(currentTheme);
}

function applyTheme(theme) {
  currentTheme = theme;
  document.body.dataset.theme = theme;

  // Update titlebar subtitle
  const sub = $('#titlebar-sub');
  if (sub) sub.textContent = theme === 'terrain' ? 'SURVEY' : 'RELAY';

  // Update mission control title
  const mcTitle = $('#mc-title');
  if (mcTitle) mcTitle.textContent = theme === 'terrain' ? 'BASE CAMP' : 'MISSION CONTROL';

  // Update widget titles that differ per theme
  $$('[data-relay-text]').forEach(el => {
    const attr = theme === 'terrain' ? 'data-terrain-text' : 'data-relay-text';
    el.textContent = el.getAttribute(attr) || el.textContent;
  });

  // Update empty state text
  const emptyTitle = $('#empty-title');
  const emptySub = $('#empty-sub');
  if (emptyTitle) emptyTitle.textContent = theme === 'terrain' ? 'No markers' : 'No signals';
  if (emptySub) emptySub.textContent = theme === 'terrain'
    ? 'Atlas Survey will capture field reports and alerts here'
    : 'Atlas Relay will intercept briefings and alerts here';

  // Update theme switcher buttons
  $$('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeChoice === theme);
  });

  // Particles only in relay
  if (theme === 'terrain') {
    const field = $('#particle-field');
    if (field) field.innerHTML = '';
  } else {
    generateParticles();
  }
}

// ─── Init ───────────────────────────────────────────────────────────

async function init() {
  audioPlayer = $('#audio-player');

  // Init theme first so rendering respects it
  await initTheme();

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

  // Generate particles (only if relay theme)
  if (currentTheme === 'relay') {
    generateParticles();
  }

  // Start ambient sound (panel is visible on init, relay only)
  if (currentTheme === 'relay') {
    startAmbientSound();
  }
}

// ─── Particle Dust Generation (Relay only) ──────────────────────────

function generateParticles() {
  const field = $('#particle-field');
  if (!field) return;

  // Clear any existing
  field.innerHTML = '';

  if (currentTheme !== 'relay') return;

  const count = 18;
  for (let i = 0; i < count; i++) {
    const particle = document.createElement('span');
    particle.className = 'particle';

    particle.style.left = Math.random() * 100 + '%';
    particle.style.bottom = -(Math.random() * 20) + '%';

    const duration = 15 + Math.random() * 15;
    particle.style.animationDuration = duration + 's';
    particle.style.animationDelay = -(Math.random() * duration) + 's';

    if (i % 5 === 0) particle.classList.add('p-lg');
    if (i % 7 === 0) particle.classList.add('p-bright');

    field.appendChild(particle);
  }
}

// ─── Ambient Sound — Ship Bridge Hum (Relay only) ───────────────────

async function startAmbientSound() {
  if (ambientActive) return;
  if (currentTheme !== 'relay') return;

  try {
    const settings = await window.atlas.getSettings();
    if (settings.soundEnabled === false) return;
  } catch (e) { /* default to enabled */ }

  try {
    if (!ambientCtx) {
      ambientCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ambientCtx.state === 'suspended') {
      await ambientCtx.resume();
    }

    ambientGain = ambientCtx.createGain();
    ambientGain.gain.setValueAtTime(0, ambientCtx.currentTime);
    ambientGain.gain.linearRampToValueAtTime(0.02, ambientCtx.currentTime + 1.0);
    ambientGain.connect(ambientCtx.destination);

    ambientOsc = ambientCtx.createOscillator();
    ambientOsc.type = 'sine';
    ambientOsc.frequency.setValueAtTime(55, ambientCtx.currentTime);
    const oscGain = ambientCtx.createGain();
    oscGain.gain.setValueAtTime(0.6, ambientCtx.currentTime);
    ambientOsc.connect(oscGain);
    oscGain.connect(ambientGain);
    ambientOsc.start();

    const bufferSize = ambientCtx.sampleRate * 2;
    const noiseBuffer = ambientCtx.createBuffer(1, bufferSize, ambientCtx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      noiseData[i] = Math.random() * 2 - 1;
    }

    ambientNoise = ambientCtx.createBufferSource();
    ambientNoise.buffer = noiseBuffer;
    ambientNoise.loop = true;

    const noiseFilter = ambientCtx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(200, ambientCtx.currentTime);
    noiseFilter.Q.setValueAtTime(1, ambientCtx.currentTime);

    const noiseGain = ambientCtx.createGain();
    noiseGain.gain.setValueAtTime(0.4, ambientCtx.currentTime);

    ambientNoise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ambientGain);
    ambientNoise.start();

    ambientActive = true;
  } catch (e) {
    // Silent fail
  }
}

function stopAmbientSound() {
  if (!ambientActive || !ambientCtx || !ambientGain) return;

  try {
    ambientGain.gain.linearRampToValueAtTime(0, ambientCtx.currentTime + 0.5);

    setTimeout(() => {
      try {
        if (ambientOsc) { ambientOsc.stop(); ambientOsc = null; }
        if (ambientNoise) { ambientNoise.stop(); ambientNoise = null; }
        ambientGain = null;
        ambientActive = false;
      } catch (e) { /* already stopped */ }
    }, 600);
  } catch (e) {
    ambientActive = false;
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

    const connText = $('#widget-conn-text');
    const widgetDot = $('#widget-dot');
    if (connText && widgetDot) {
      connText.textContent = result.online ? 'Online' : 'Offline';
      connText.style.color = result.online ? 'var(--holo-green)' : 'var(--signal-red)';
      widgetDot.className = 'widget-dot ' + (result.online ? 'online' : 'offline');
    }

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

    updateLastMessageDisplay();
    updateProductionHUD();
  } catch (e) {
    // Silent fail
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

  const html = filtered.map(n => renderCard(n, { panel: true, theme: currentTheme })).join('');

  const scrollTop = list.scrollTop;
  const particleField = $('#particle-field');
  const particleHtml = particleField ? particleField.outerHTML : '';
  const emptyEl = emptyState.outerHTML;
  list.innerHTML = particleHtml + emptyEl + html;
  list.scrollTop = scrollTop;
}

// ─── Audio ──────────────────────────────────────────────────────────

function playAudio(url, notifId) {
  if (!audioPlayer) return;

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
  $$('.btn-audio').forEach(btn => {
    const nid = btn.dataset.notifId;
    const isPlaying = playingAudioId === nid;
    btn.classList.toggle('playing', isPlaying);
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
    requestAnimationFrame(updateTabIndicator);
  });
});

// Close
$('#btn-close').addEventListener('click', () => {
  stopAmbientSound();
  window.atlas.closePanel();
});

// Clear all
$('#btn-clear').addEventListener('click', async () => {
  await window.atlas.clearAll();
  notifications = [];
  render();
});

// Card clicks
list.addEventListener('click', async (e) => {
  const audioBtn = e.target.closest('.btn-audio');
  if (audioBtn) {
    const url = audioBtn.dataset.audio;
    const nid = audioBtn.dataset.notifId;
    if (url) playAudio(url, nid);
    return;
  }

  const ackBtn = e.target.closest('.btn-acknowledge');
  if (ackBtn) {
    const id = ackBtn.dataset.ackId;
    await window.atlas.acknowledgeAlert(id);
    const notif = notifications.find(n => n.id === id);
    if (notif) {
      notif.acknowledged = true;
      notif.read = true;
    }
    ackBtn.textContent = currentTheme === 'terrain' ? '[ ACKNOWLEDGED ]' : '[ CONFIRMED ]';
    ackBtn.style.color = 'var(--holo-green)';
    ackBtn.style.borderColor = 'var(--holo-green)';
    setTimeout(() => render(), 400);
    return;
  }

  // Weather dropdown toggle
  const weatherSelect = e.target.closest('.weather-location-select');
  if (weatherSelect) {
    e.stopPropagation();
    const cardId = weatherSelect.dataset.cardId;
    const dropdown = list.querySelector(`.weather-dropdown[data-card-id="${cardId}"]`);
    if (dropdown) {
      dropdown.classList.toggle('open');
    }
    return;
  }

  // Weather dropdown item click
  const weatherItem = e.target.closest('.weather-dropdown-item');
  if (weatherItem) {
    e.stopPropagation();
    const location = weatherItem.dataset.location;
    const dropdown = weatherItem.closest('.weather-dropdown');
    const card = dropdown ? dropdown.closest('.weather-card') : null;
    
    if (card) {
      try {
        const locationsData = JSON.parse(card.dataset.locations);
        const locData = locationsData[location];
        
        if (locData) {
          // Update card data
          card.dataset.currentLocation = location;
          
          // Update displayed location name
          const locationName = card.querySelector('.weather-location-name');
          if (locationName) locationName.textContent = location;
          
          // Update weather data
          const tempEl = card.querySelector('.weather-temp-large');
          const condEl = card.querySelector('.weather-conditions');
          const statsRows = card.querySelectorAll('.weather-stat-row');
          
          if (tempEl) tempEl.textContent = locData.temp || '--°F';
          if (condEl) condEl.textContent = locData.conditions || 'Unknown';
          
          if (statsRows[0]) {
            const stats = statsRows[0].querySelectorAll('.weather-stat .holo-number');
            if (stats[0]) stats[0].textContent = locData.high || '--';
            if (stats[1]) stats[1].textContent = locData.low || '--';
            if (stats[2]) stats[2].textContent = locData.precip || '--';
          }
          
          if (statsRows[1]) {
            const windHumid = statsRows[1].querySelectorAll('.weather-stat');
            if (windHumid[0]) windHumid[0].innerHTML = `Wind: ${escapeHtml(locData.wind || '--')}`;
            if (windHumid[1]) windHumid[1].innerHTML = `Humidity: ${escapeHtml(locData.humidity || '--')}`;
          }
        }
      } catch (err) {
        console.warn('Failed to parse weather locations:', err);
      }
      
      // Close dropdown
      dropdown.classList.remove('open');
    }
    return;
  }

  const expandToggle = e.target.closest('.card-expand-toggle');
  const card = e.target.closest('.notif-card');
  if (card && card.classList.contains('card-collapsible')) {
    card.classList.toggle('expanded');
    return;
  }

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

// Close weather dropdowns when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.weather-location-select') && !e.target.closest('.weather-dropdown')) {
    $$('.weather-dropdown.open').forEach(dd => dd.classList.remove('open'));
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

// Theme switcher — instant preview
$$('.theme-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const theme = btn.dataset.themeChoice;
    applyTheme(theme);
    render(); // Re-render cards for new theme
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

// Voice loading
const elKeyInput = $('#set-elevenlabs-key');
if (elKeyInput) {
  elKeyInput.addEventListener('blur', () => loadVoices());
}

async function openSettings() {
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

  // Set theme switcher to current theme
  $$('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeChoice === currentTheme);
  });

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

    // Save theme preference
    await window.atlas.setTheme(currentTheme);
  } catch (e) { /* silent fail */ }

  closeSettings();
}

// ─── IPC Listeners ──────────────────────────────────────────────────

window.atlas.onNewNotification((notif) => {
  notifications.unshift(notif);
  lastMessageTime = Date.now();
  render();
  updateMissionControl();

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
