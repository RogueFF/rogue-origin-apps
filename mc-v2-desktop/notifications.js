const { BrowserWindow, screen } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE = 'https://mission-control-api.roguefamilyfarms.workers.dev';
const POLL_INTERVAL = 15_000; // 15s
const TOAST_WIDTH = 360;
const TOAST_HEIGHT = 120;
const TOAST_GAP = 8;
const MAX_VISIBLE = 3;
const DISMISS_NORMAL = 6_000;
const DISMISS_HIGH = 12_000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let pollTimer = null;
let seenIds = new Set();
let activeToasts = []; // { win, id, timer }
let mainWindow = null;
let onBadgeUpdate = null;

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: 10_000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function patchJSON(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      timeout: 10_000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve({}); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(JSON.stringify(body));
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Toast windows
// ---------------------------------------------------------------------------

function getToastPosition(index) {
  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const x = workArea.x + workArea.width - TOAST_WIDTH - 16;
  const y = workArea.y + workArea.height - (TOAST_HEIGHT + TOAST_GAP) * (index + 1);
  return { x, y };
}

function repositionToasts() {
  activeToasts.forEach((t, i) => {
    if (t.win && !t.win.isDestroyed()) {
      const pos = getToastPosition(i);
      t.win.setPosition(pos.x, pos.y, false);
    }
  });
}

function dismissToast(id) {
  const idx = activeToasts.findIndex((t) => t.id === id);
  if (idx === -1) return;

  const toast = activeToasts[idx];
  if (toast.timer) clearTimeout(toast.timer);
  if (toast.win && !toast.win.isDestroyed()) {
    toast.win.close();
  }
  activeToasts.splice(idx, 1);
  repositionToasts();
}

function showToast(notification) {
  // Cap at MAX_VISIBLE — dismiss oldest if full
  while (activeToasts.length >= MAX_VISIBLE) {
    const oldest = activeToasts[activeToasts.length - 1];
    dismissToast(oldest.id);
  }

  const index = activeToasts.length;
  const pos = getToastPosition(index);

  const win = new BrowserWindow({
    width: TOAST_WIDTH,
    height: TOAST_HEIGHT,
    x: pos.x + TOAST_WIDTH, // Start offscreen right for slide-in
    y: pos.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Build toast HTML inline with notification data
  const priorityColor = notification.priority === 'high' ? '#ff3344'
    : notification.priority === 'low' ? '#00ff88' : '#00f0ff';

  const escapedTitle = escapeHtml(notification.title || '');
  const escapedBody = escapeHtml(notification.body || '');

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@600;700&family=Manrope:wght@400;500&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body {
  background: transparent;
  overflow: hidden;
  -webkit-app-region: no-drag;
}
.toast {
  width: ${TOAST_WIDTH - 16}px;
  margin: 4px 8px;
  background: rgba(10, 10, 10, 0.85);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(255,255,255,0.08);
  border-left: 3px solid ${priorityColor};
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.4), inset 0 0.5px 0 rgba(255,255,255,0.08);
  padding: 12px 14px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
  transform: translateX(${TOAST_WIDTH}px);
  animation: slideIn 300ms ease-out forwards;
}
@keyframes slideIn {
  to { transform: translateX(0); }
}
.icon { font-size: 16px; flex-shrink: 0; padding-top: 1px; }
.content { flex: 1; min-width: 0; }
.title {
  font-family: 'Outfit', sans-serif;
  font-size: 13px;
  font-weight: 700;
  color: #f0ece4;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.body {
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 400;
  color: rgba(240,236,228,0.6);
  line-height: 1.3;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.close {
  background: none;
  border: none;
  color: rgba(240,236,228,0.4);
  font-size: 14px;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
  flex-shrink: 0;
  transition: color 150ms;
}
.close:hover { color: #f0ece4; }
</style>
</head>
<body>
<div class="toast" id="toast">
  <span class="icon">${notification.type === 'alert' ? '⚠' : notification.type === 'production-card' ? '📊' : '🔔'}</span>
  <div class="content">
    <div class="title">${escapedTitle}</div>
    ${escapedBody ? `<div class="body">${escapedBody}</div>` : ''}
  </div>
  <button class="close" id="closeBtn">✕</button>
</div>
<script>
  document.getElementById('toast').addEventListener('click', (e) => {
    if (e.target.id === 'closeBtn') return;
    window.close();
    // Main process handles mark-read + focus
  });
  document.getElementById('closeBtn').addEventListener('click', () => {
    window.close();
  });
</script>
</body>
</html>`;

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  win.once('ready-to-show', () => {
    win.showInactive();
    // Animate to final position
    setTimeout(() => {
      if (!win.isDestroyed()) {
        win.setPosition(pos.x, pos.y, true);
      }
    }, 50);
  });

  const dismissTime = notification.priority === 'high' ? DISMISS_HIGH : DISMISS_NORMAL;
  const timer = setTimeout(() => dismissToast(notification.id), dismissTime);

  // On close (by click or dismiss), mark as read
  win.on('closed', () => {
    markRead(notification.id);
    const idx = activeToasts.findIndex((t) => t.id === notification.id);
    if (idx !== -1) {
      if (activeToasts[idx].timer) clearTimeout(activeToasts[idx].timer);
      activeToasts.splice(idx, 1);
      repositionToasts();
    }
  });

  activeToasts.unshift({ win, id: notification.id, timer });
  repositionToasts();
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function markRead(id) {
  try {
    await patchJSON(`${API_BASE}/api/notifications/${id}`, { read: 1 });
  } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Poller
// ---------------------------------------------------------------------------

async function poll() {
  try {
    const data = await fetchJSON(`${API_BASE}/api/notifications?unread=true&limit=10`);
    if (!data.success) return;

    const unreadCount = data.unreadCount || 0;
    if (onBadgeUpdate) onBadgeUpdate(unreadCount);

    // Find new unseen notifications
    const newNotifications = (data.notifications || []).filter((n) => !seenIds.has(n.id));

    // Show toasts for new ones (newest first, limited)
    const toShow = newNotifications.slice(0, MAX_VISIBLE);
    for (const n of toShow) {
      seenIds.add(n.id);
      showToast(n);
    }

    // Mark remaining new ones as seen (don't toast old ones)
    for (const n of newNotifications) {
      seenIds.add(n.id);
    }
  } catch (e) {
    // Silent — network may be down
  }
}

function startPoller(win, badgeCallback) {
  mainWindow = win;
  onBadgeUpdate = badgeCallback;

  // Initial poll
  setTimeout(poll, 2000);

  // Recurring
  pollTimer = setInterval(poll, POLL_INTERVAL);
}

function stopPoller() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  // Dismiss all active toasts
  for (const t of [...activeToasts]) {
    dismissToast(t.id);
  }
}

module.exports = { startPoller, stopPoller };
