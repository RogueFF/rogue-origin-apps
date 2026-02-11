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

// Card clicks (mark read + play audio)
list.addEventListener('click', async (e) => {
  // Audio play
  const audioEl = e.target.closest('.notif-audio');
  if (audioEl) {
    const url = audioEl.dataset.audio;
    if (url) playAudio(url, audioEl);
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
