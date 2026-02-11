const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { createApiServer } = require('./api-server');

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

// ─── Tray Icon ──────────────────────────────────────────────────────
function buildTrayIcons() {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  trayIconNormal = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

  // Create badge icon — draw a gold dot overlay on the tray icon
  // We'll composite a small dot onto the icon for the badge variant
  trayIconBadge = createBadgeIcon(trayIconNormal);
}

function createBadgeIcon(baseIcon) {
  // Create a 16x16 canvas with a red notification dot in bottom-right
  // Since we can't use canvas in main process without dependencies,
  // we'll use a simple NativeImage overlay approach
  const size = { width: 16, height: 16 };
  const base = baseIcon.resize(size);
  const bitmap = base.toBitmap();
  const buf = Buffer.from(bitmap);

  // Draw a 5x5 red dot at position (11,11) in BGRA format
  const dotColor = { b: 79, g: 170, r: 228, a: 255 }; // Gold #e4aa4f in BGRA
  for (let dy = 0; dy < 5; dy++) {
    for (let dx = 0; dx < 5; dx++) {
      const px = 11 + dx;
      const py = 11 + dy;
      // Circular dot — skip corners
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
  const { screen } = require('electron');
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;
  panel.setPosition(sw - 430, sh - 630);

  panel.show();
  panel.focus();
  panel.webContents.send('refresh-notifications', getNotifications());
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

  // Show native toast for toast/alert/production-card types (not briefings — those go to panel only)
  if (Notification.isSupported() && notif.type !== 'briefing') {
    const toastTitle = notif.title;
    let toastBody = notif.body;

    // For production cards, create a summary toast
    if (notif.type === 'production-card' && notif.data) {
      const d = notif.data;
      const status = d.paceStatus === 'ahead' ? 'Ahead' : d.paceStatus === 'behind' ? 'Behind' : 'On Pace';
      toastBody = `${d.dailyTotal} lbs (${d.percentOfTarget}% of target) — ${status}`;
    }

    const toast = new Notification({
      title: toastTitle,
      body: toastBody,
      icon: path.join(__dirname, '..', 'assets', 'icon.png'),
      urgency: notif.priority === 'high' ? 'critical' : 'normal',
      silent: !store.get('soundEnabled')
    });
    toast.on('click', () => showPanel());
    toast.show();

    // Auto-dismiss toast after 8 seconds
    setTimeout(() => {
      toast.close();
    }, 8000);
  }

  // Forward to panel if open
  if (panel && !panel.isDestroyed() && panel.isVisible()) {
    panel.webContents.send('new-notification', notif);
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
}

// ─── App Lifecycle ──────────────────────────────────────────────────
app.on('ready', () => {
  // Set auto-start
  app.setLoginItemSettings({ openAtLogin: store.get('autoStart') });

  createTrayIcon();
  createPanel();
  setupIPC();

  // Start API server
  const port = store.get('port');
  apiServer = createApiServer(port, handleIncomingNotification);

  console.log(`Atlas Notifications running — API on port ${port}`);
});

app.on('window-all-closed', (e) => {
  // Don't quit on window close — keep tray running
  e.preventDefault?.();
});

app.on('second-instance', () => {
  showPanel();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
