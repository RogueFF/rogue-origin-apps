const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE = 'https://mission-control-api.roguefamilyfarms.workers.dev';
const POLL_INTERVAL = 15_000;
const TOAST_WIDTH = 420;
const TOAST_HEIGHT = 200;
const TOAST_GAP = 8;
const MAX_VISIBLE = 3;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let pollTimer = null;
let seenIds = new Set();
let activeToasts = []; // { win, id }
let mainWindow = null;
let onBadgeUpdate = null;
let theme = 'relay';

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
// Toast positioning
// ---------------------------------------------------------------------------

function getToastPosition(index) {
  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const x = workArea.x + workArea.width - TOAST_WIDTH - 16;
  const y = workArea.y + workArea.height - (TOAST_HEIGHT + TOAST_GAP) * (index + 1);
  return { x, y };
}

function repositionToasts() {
  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const x = workArea.x + workArea.width - TOAST_WIDTH - 16;
  let bottomY = workArea.y + workArea.height;

  activeToasts.forEach((t) => {
    if (t.win && !t.win.isDestroyed()) {
      const h = t.win.getBounds().height;
      bottomY -= h + TOAST_GAP;
      t.win.setPosition(x, bottomY, false);
    }
  });
}

function removeToast(id) {
  const idx = activeToasts.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const toast = activeToasts[idx];
  if (toast.win && !toast.win.isDestroyed()) {
    toast.win.close();
  }
  activeToasts.splice(idx, 1);
  repositionToasts();
}

// ---------------------------------------------------------------------------
// Show toast using popup BrowserWindow + IPC
// ---------------------------------------------------------------------------

function showToast(notification) {
  // Cap at MAX_VISIBLE
  while (activeToasts.length >= MAX_VISIBLE) {
    const oldest = activeToasts[activeToasts.length - 1];
    removeToast(oldest.id);
  }

  const index = activeToasts.length;
  const pos = getToastPosition(index);

  const win = new BrowserWindow({
    width: TOAST_WIDTH,
    height: TOAST_HEIGHT,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the toast.html page
  win.loadFile(path.join(__dirname, 'toast.html'));

  win.once('ready-to-show', () => {
    win.showInactive();

    // Send notification data to the popup renderer via IPC
    const notifData = {
      ...notification,
      timestamp: notification.created_at || new Date().toISOString(),
    };
    win.webContents.send('show-popup', { notification: notifData });

    // Auto-resize to content height after render
    setTimeout(() => {
      if (!win.isDestroyed()) {
        win.webContents.executeJavaScript('document.body.scrollHeight').then((h) => {
          if (!win.isDestroyed() && h > 0) {
            win.setBounds({ width: TOAST_WIDTH, height: Math.min(h + 4, 400) });
            repositionToasts();
          }
        }).catch(() => {});
      }
    }, 300);
  });

  win.on('closed', () => {
    const idx = activeToasts.findIndex((t) => t.id === notification.id);
    if (idx !== -1) {
      activeToasts.splice(idx, 1);
      repositionToasts();
    }
  });

  activeToasts.unshift({ win, id: notification.id });
  repositionToasts();
}

// ---------------------------------------------------------------------------
// Mark read
// ---------------------------------------------------------------------------

async function markRead(id) {
  try {
    await patchJSON(`${API_BASE}/api/notifications/${id}`, { read: 1 });
  } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// IPC handlers (registered once from main)
// ---------------------------------------------------------------------------

function registerIPC() {
  // Popup dismissed (auto-dismiss or ghost trail complete)
  ipcMain.on('popup:dismiss', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      const toast = activeToasts.find((t) => t.win === win);
      if (toast) {
        markRead(toast.id);
        removeToast(toast.id);
      } else {
        win.close();
      }
    }
  });

  // Popup clicked (user wants to focus main window)
  ipcMain.on('popup:clicked', (event, id) => {
    markRead(id);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      removeToast(id);
    }
  });

  // Alert acknowledged
  ipcMain.on('popup:acknowledge', (_event, id) => {
    markRead(id);
  });

  // Theme
  ipcMain.handle('get-theme', () => theme);

  // Settings
  ipcMain.handle('get-settings', () => ({
    soundEnabled: true,
  }));

  // TTS config (no keys configured — gracefully falls back)
  ipcMain.handle('get-tts-config', () => ({
    ttsEnabled: false,
    elevenLabsKey: '',
    elevenLabsVoice: '',
    ttsVolume: 0.8,
  }));
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

  // Register IPC handlers
  registerIPC();

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
    removeToast(t.id);
  }
}

function setTheme(newTheme) {
  theme = newTheme;
}

module.exports = { startPoller, stopPoller, setTheme };
