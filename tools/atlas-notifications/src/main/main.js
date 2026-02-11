const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { createApiServer } = require('./api-server');

// Safe IPC send — guards against destroyed windows / broken pipes
function safeSend(win, channel, ...args) {
  try {
    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  } catch (e) {
    // Window destroyed mid-send — ignore
  }
}

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

// Persistence
const store = new Store({
  defaults: {
    port: 9400,
    autoStart: true,
    atlasHost: '100.64.0.1', // Tailscale IP — configurable
    notifications: [],
    maxHistory: 50,
    soundEnabled: true
  }
});

let tray = null;
let panel = null;
let apiServer = null;
let trayIconNormal = null;
let trayIconBadge = null;

// ─── Popup State ────────────────────────────────────────────────────

const activePopups = [];  // { win, notifId, slot, height, dismissing }
const MAX_POPUPS = 5;
const POPUP_WIDTH = 380;
const POPUP_GAP = 6;
const POPUP_MARGIN_RIGHT = 12;
const POPUP_MARGIN_BOTTOM = 12;
const POPUP_PADDING = 16; // body padding (8px each side) for shadow room

// Heights per notification type (content height)
const POPUP_HEIGHTS = {
  toast: 120,
  briefing: 180,
  alert: 150,
  'production-card': 300
};

// ─── Tray Icon ──────────────────────────────────────────────────────
function buildTrayIcons() {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  trayIconNormal = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

  // Create badge icon — draw a gold dot overlay on the tray icon
  trayIconBadge = createBadgeIcon(trayIconNormal);
}

function createBadgeIcon(baseIcon) {
  const size = { width: 16, height: 16 };
  const base = baseIcon.resize(size);
  const bitmap = base.toBitmap();
  const buf = Buffer.from(bitmap);

  // Draw a 5x5 gold dot at position (11,11) in BGRA format
  const dotColor = { b: 79, g: 170, r: 228, a: 255 }; // Gold #e4aa4f in BGRA
  for (let dy = 0; dy < 5; dy++) {
    for (let dx = 0; dx < 5; dx++) {
      const px = 11 + dx;
      const py = 11 + dy;
      const cx = dx - 2, cy = dy - 2;
      if (cx * cx + cy * cy > 6) continue;
      if (px < 16 && py < 16) {
        const offset = (py * 16 + px) * 4;
        buf[offset] = dotColor.b;
        buf[offset + 1] = dotColor.g;
        buf[offset + 2] = dotColor.r;
        buf[offset + 3] = dotColor.a;
      }
    }
  }

  return nativeImage.createFromBitmap(buf, size);
}

function updateTrayBadge() {
  if (!tray || !trayIconNormal || !trayIconBadge) return;
  const notifs = getNotifications();
  const unread = notifs.filter(n => !n.read).length;
  tray.setImage(unread > 0 ? trayIconBadge : trayIconNormal);
  tray.setToolTip(unread > 0 ? `Atlas — ${unread} unread` : 'Atlas Notifications');
}

function createTrayIcon() {
  buildTrayIcons();
  tray = new Tray(trayIconNormal);
  tray.setToolTip('Atlas Notifications');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Panel', click: () => showPanel() },
    { type: 'separator' },
    {
      label: 'Notification Sound',
      type: 'checkbox',
      checked: store.get('soundEnabled'),
      click: (item) => {
        store.set('soundEnabled', item.checked);
      }
    },
    {
      label: 'Auto-start with Windows',
      type: 'checkbox',
      checked: store.get('autoStart'),
      click: (item) => {
        store.set('autoStart', item.checked);
        app.setLoginItemSettings({ openAtLogin: item.checked });
      }
    },
    {
      label: `API Port: ${store.get('port')}`,
      enabled: false
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => showPanel());

  updateTrayBadge();
}

// ─── Briefing Panel Window ──────────────────────────────────────────
function createPanel() {
  panel = new BrowserWindow({
    width: 420,
    height: 620,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: false,
    backgroundColor: '#060807',
    webPreferences: {
      preload: path.join(__dirname, '..', 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  panel.loadFile(path.join(__dirname, '..', 'renderer', 'panel.html'));

  panel.on('blur', () => {
    if (panel && !panel.isDestroyed()) panel.hide();
  });

  panel.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      panel.hide();
    }
  });
}

function showPanel() {
  if (!panel || panel.isDestroyed()) createPanel();

  // Position near tray (bottom-right on Windows)
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;
  panel.setPosition(sw - 430, sh - 630);

  panel.show();
  panel.focus();
  safeSend(panel, 'refresh-notifications', getNotifications());
}

// ─── Popup Management ───────────────────────────────────────────────

function createPopup(notif) {
  // Enforce max popups — force-dismiss oldest if exceeded
  while (activePopups.length >= MAX_POPUPS) {
    forceDestroyPopup(activePopups[0]);
  }

  const height = POPUP_HEIGHTS[notif.type] || POPUP_HEIGHTS.toast;
  const totalHeight = height + POPUP_PADDING;

  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;

  const slot = findNextSlot(totalHeight);

  const win = new BrowserWindow({
    width: POPUP_WIDTH,
    height: totalHeight,
    x: sw - POPUP_WIDTH - POPUP_MARGIN_RIGHT,
    y: sh - slot.bottom,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'popup.html'));

  const entry = { win, notifId: notif.id, height: totalHeight, bottom: slot.bottom, dismissing: false };
  activePopups.push(entry);

  win.webContents.once('did-finish-load', () => {
    safeSend(win, 'show-popup', { notification: notif });
    win.showInactive();
  });

  win.on('closed', () => {
    const idx = activePopups.findIndex(p => p.win === win);
    if (idx !== -1) activePopups.splice(idx, 1);
    repositionPopups();
  });
}

function findNextSlot(height) {
  let bottom = POPUP_MARGIN_BOTTOM + height;
  for (const popup of activePopups) {
    bottom += popup.height + POPUP_GAP;
  }
  return { bottom };
}

function forceDestroyPopup(entry) {
  // Synchronously remove from array and destroy — used for eviction
  const idx = activePopups.indexOf(entry);
  if (idx !== -1) activePopups.splice(idx, 1);
  if (!entry.win.isDestroyed()) entry.win.destroy();
}

function dismissPopup(win) {
  if (!win || win.isDestroyed()) return;
  const entry = activePopups.find(p => p.win === win);
  if (!entry || entry.dismissing) return;
  entry.dismissing = true;

  safeSend(win, 'dismiss-popup');

  setTimeout(() => {
    if (!win.isDestroyed()) win.destroy();
  }, 300);
}

function repositionPopups() {
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;

  let currentBottom = POPUP_MARGIN_BOTTOM;

  for (const popup of activePopups) {
    currentBottom += popup.height;
    popup.bottom = currentBottom;

    if (!popup.win.isDestroyed()) {
      const x = sw - POPUP_WIDTH - POPUP_MARGIN_RIGHT;
      const y = sh - currentBottom;
      popup.win.setPosition(x, y, true);
    }

    currentBottom += POPUP_GAP;
  }
}

// ─── Notification Management ────────────────────────────────────────
function getNotifications() {
  return store.get('notifications') || [];
}

function addNotification(payload) {
  const notif = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type: payload.type || 'toast',
    title: payload.title || 'Atlas',
    body: payload.body || '',
    audio_url: payload.audio_url || null,
    tts: payload.tts || false,
    priority: payload.priority || 'normal',
    data: payload.data || {},
    timestamp: new Date().toISOString(),
    read: false
  };

  const history = getNotifications();
  history.unshift(notif);
  const max = store.get('maxHistory') || 50;
  store.set('notifications', history.slice(0, max));

  return notif;
}

function handleIncomingNotification(payload) {
  const notif = addNotification(payload);

  // Show rich popup notification
  createPopup(notif);

  // Forward to panel if open
  if (panel && !panel.isDestroyed() && panel.isVisible()) {
    safeSend(panel, 'new-notification', notif);
  }

  // Update tray badge
  updateTrayBadge();

  return notif;
}

// ─── IPC Handlers ───────────────────────────────────────────────────
function setupIPC() {
  ipcMain.handle('get-notifications', () => getNotifications());

  ipcMain.handle('mark-read', (_, id) => {
    const notifs = getNotifications();
    const n = notifs.find(n => n.id === id);
    if (n) n.read = true;
    store.set('notifications', notifs);
    updateTrayBadge();
    return true;
  });

  ipcMain.handle('mark-all-read', () => {
    const notifs = getNotifications();
    notifs.forEach(n => n.read = true);
    store.set('notifications', notifs);
    updateTrayBadge();
    return true;
  });

  ipcMain.handle('clear-all', () => {
    store.set('notifications', []);
    updateTrayBadge();
    return true;
  });

  ipcMain.handle('get-config', () => ({
    port: store.get('port'),
    autoStart: store.get('autoStart'),
    atlasHost: store.get('atlasHost'),
    soundEnabled: store.get('soundEnabled')
  }));

  ipcMain.handle('set-config', (_, config) => {
    if (config.port) store.set('port', config.port);
    if (config.autoStart !== undefined) {
      store.set('autoStart', config.autoStart);
      app.setLoginItemSettings({ openAtLogin: config.autoStart });
    }
    if (config.atlasHost) store.set('atlasHost', config.atlasHost);
    if (config.soundEnabled !== undefined) store.set('soundEnabled', config.soundEnabled);
    return true;
  });

  ipcMain.handle('check-atlas-status', async () => {
    const host = store.get('atlasHost');
    try {
      const { exec } = require('child_process');
      return new Promise((resolve) => {
        exec(`ping -n 1 -w 2000 ${host}`, (err) => {
          resolve({ online: !err, host });
        });
      });
    } catch {
      return { online: false, host };
    }
  });

  ipcMain.handle('close-panel', () => {
    if (panel && !panel.isDestroyed()) panel.hide();
  });

  ipcMain.handle('get-unread-count', () => {
    const notifs = getNotifications();
    return notifs.filter(n => !n.read).length;
  });

  // ─── Settings ───────────────────────────────────────────────────
  ipcMain.handle('get-settings', () => ({
    atlasHost: store.get('atlasHost'),
    port: store.get('port'),
    apiToken: store.get('apiToken', ''),
    soundEnabled: store.get('soundEnabled'),
    autoStart: store.get('autoStart')
  }));

  ipcMain.handle('set-settings', (_, settings) => {
    Object.entries(settings).forEach(([k, v]) => store.set(k, v));
    if (settings.autoStart !== undefined) {
      app.setLoginItemSettings({ openAtLogin: settings.autoStart });
    }
    return true;
  });

  // ─── TTS Config ─────────────────────────────────────────────────
  ipcMain.handle('get-tts-config', () => ({
    elevenLabsKey: store.get('elevenLabsKey', ''),
    elevenLabsVoice: store.get('elevenLabsVoice', ''),
    ttsEnabled: store.get('ttsEnabled', true),
    ttsVolume: store.get('ttsVolume', 0.8)
  }));

  ipcMain.handle('set-tts-config', (_, config) => {
    Object.entries(config).forEach(([k, v]) => store.set(k, v));
    return true;
  });

  ipcMain.handle('get-voices', async () => {
    const key = store.get('elevenLabsKey', '');
    if (!key) return [];
    try {
      const resp = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': key }
      });
      const data = await resp.json();
      return data.voices || [];
    } catch {
      return [];
    }
  });

  // ─── Acknowledge Alert ──────────────────────────────────────────
  ipcMain.handle('acknowledge-alert', (_, id) => {
    const notifs = store.get('notifications', []);
    const idx = notifs.findIndex(n => n.id === id);
    if (idx >= 0) {
      notifs[idx].acknowledged = true;
      notifs[idx].read = true;
      store.set('notifications', notifs);
      updateTrayBadge();
    }
    return true;
  });

  // ─── Popup IPC ──────────────────────────────────────────────────

  ipcMain.on('popup-clicked', (event, notifId) => {
    showPanel();

    const notifs = getNotifications();
    const n = notifs.find(n => n.id === notifId);
    if (n) {
      n.read = true;
      store.set('notifications', notifs);
      updateTrayBadge();
    }

    const popup = activePopups.find(p => p.notifId === notifId);
    if (popup) dismissPopup(popup.win);
  });

  ipcMain.on('popup-dismiss', (event) => {
    const popup = activePopups.find(p =>
      !p.win.isDestroyed() && p.win.webContents === event.sender
    );
    if (popup && !popup.win.isDestroyed() && !popup.dismissing) {
      popup.win.destroy();
    }
  });

  ipcMain.on('popup-acknowledge', (event, notifId) => {
    const notifs = getNotifications();
    const n = notifs.find(n => n.id === notifId);
    if (n) {
      n.read = true;
      if (n.data) n.data.acknowledged = true;
      n.acknowledged = true;
      store.set('notifications', notifs);
      updateTrayBadge();
    }

    if (panel && !panel.isDestroyed() && panel.isVisible()) {
      safeSend(panel, 'refresh-notifications', getNotifications());
    }
  });
}

// ─── App Lifecycle ──────────────────────────────────────────────────
app.on('ready', () => {
  app.setLoginItemSettings({ openAtLogin: store.get('autoStart') });

  createTrayIcon();
  createPanel();
  setupIPC();

  const port = store.get('port');
  apiServer = createApiServer(port, handleIncomingNotification);

  console.log(`Atlas Notifications running — API on port ${port}`);
});

app.on('window-all-closed', (e) => {
  e.preventDefault?.();
});

app.on('second-instance', () => {
  showPanel();
});

app.on('before-quit', () => {
  app.isQuitting = true;

  for (const popup of [...activePopups]) {
    if (!popup.win.isDestroyed()) popup.win.destroy();
  }
  activePopups.length = 0;
});
