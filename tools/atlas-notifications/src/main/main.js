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
    maxHistory: 50
  }
});

let tray = null;
let panel = null;
let apiServer = null;

// ─── Tray Icon ──────────────────────────────────────────────────────
function createTrayIcon() {
  // 16x16 gold leaf icon (PNG buffer)
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

  tray = new Tray(icon);
  tray.setToolTip('Atlas Notifications');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Panel', click: () => showPanel() },
    { type: 'separator' },
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
    backgroundColor: '#0f0f0f',
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

  // Show native toast
  if (Notification.isSupported()) {
    const toast = new Notification({
      title: notif.title,
      body: notif.body,
      icon: path.join(__dirname, '..', 'assets', 'icon.png'),
      urgency: notif.priority === 'high' ? 'critical' : 'normal',
      silent: notif.priority === 'low'
    });
    toast.on('click', () => showPanel());
    toast.show();
  }

  // Forward to panel if open
  if (panel && !panel.isDestroyed() && panel.isVisible()) {
    panel.webContents.send('new-notification', notif);
  }

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
    return true;
  });

  ipcMain.handle('mark-all-read', () => {
    const notifs = getNotifications();
    notifs.forEach(n => n.read = true);
    store.set('notifications', notifs);
    return true;
  });

  ipcMain.handle('clear-all', () => {
    store.set('notifications', []);
    return true;
  });

  ipcMain.handle('get-config', () => ({
    port: store.get('port'),
    autoStart: store.get('autoStart'),
    atlasHost: store.get('atlasHost')
  }));

  ipcMain.handle('set-config', (_, config) => {
    if (config.port) store.set('port', config.port);
    if (config.autoStart !== undefined) {
      store.set('autoStart', config.autoStart);
      app.setLoginItemSettings({ openAtLogin: config.autoStart });
    }
    if (config.atlasHost) store.set('atlasHost', config.atlasHost);
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
