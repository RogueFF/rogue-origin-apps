const { app, BrowserWindow, screen, Notification } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const { initTray, destroyTray, updateBadge } = require('./tray');
const { startPoller, stopPoller } = require('./notifications');

// ---------------------------------------------------------------------------
// Auto-updater
// ---------------------------------------------------------------------------

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('checking-for-update', () => {
  console.log('[updater] Checking for updates...');
});

autoUpdater.on('update-available', (info) => {
  console.log(`[updater] Update available: ${info.version}`);
});

autoUpdater.on('update-not-available', () => {
  console.log('[updater] App is up to date.');
});

autoUpdater.on('download-progress', (progress) => {
  console.log(`[updater] Download: ${Math.round(progress.percent)}%`);
});

autoUpdater.on('update-downloaded', (info) => {
  console.log(`[updater] Update downloaded: ${info.version}`);
  if (Notification.isSupported()) {
    new Notification({
      title: 'Nerve Update Ready',
      body: `Version ${info.version} will install when you quit.`,
    }).show();
  }
});

autoUpdater.on('error', (err) => {
  console.error('[updater] Error:', err.message);
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MC_URL = 'https://fern.tail2237bd.ts.net:3333';
const STORE_FILE = path.join(app.getPath('userData'), 'window-state.json');

// ---------------------------------------------------------------------------
// Window state persistence
// ---------------------------------------------------------------------------

function loadWindowState() {
  try {
    return JSON.parse(require('fs').readFileSync(STORE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  const isMaximized = win.isMaximized();
  try {
    require('fs').writeFileSync(STORE_FILE, JSON.stringify({ bounds, isMaximized }));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Main window
// ---------------------------------------------------------------------------

let mainWindow = null;

function createWindow() {
  const saved = loadWindowState();
  const defaults = { width: 1400, height: 900, x: undefined, y: undefined };
  const bounds = saved?.bounds || defaults;

  // Ensure window is within a visible display
  const displays = screen.getAllDisplays();
  const visible = displays.some((d) => {
    const db = d.bounds;
    return (
      bounds.x >= db.x &&
      bounds.y >= db.y &&
      bounds.x + bounds.width <= db.x + db.width + 100 &&
      bounds.y + bounds.height <= db.y + db.height + 100
    );
  });
  if (!visible) {
    bounds.x = undefined;
    bounds.y = undefined;
  }

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0a0a',
      symbolColor: '#f0ece4',
      height: 32,
    },
    backgroundColor: '#0a0a0a',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  if (saved?.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.loadURL(MC_URL);

  // Ignore certificate errors for Tailscale self-signed
  mainWindow.webContents.session.setCertificateVerifyProc((request, callback) => {
    if (request.hostname.endsWith('.ts.net')) {
      callback(0); // trust
    } else {
      callback(-3); // default verification
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Save state on move/resize
  mainWindow.on('resize', () => saveWindowState(mainWindow));
  mainWindow.on('move', () => saveWindowState(mainWindow));
  mainWindow.on('maximize', () => saveWindowState(mainWindow));
  mainWindow.on('unmaximize', () => saveWindowState(mainWindow));

  // Minimize to tray instead of closing
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  return mainWindow;
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

// Allow self-signed certs for Tailscale
app.commandLine.appendSwitch('ignore-certificate-errors-spki-list', '');

app.on('ready', () => {
  createWindow();
  initTray(showWindow, () => {
    app.isQuitting = true;
    app.quit();
  }, (newTheme) => {
    setTheme(newTheme);
  });

  // Check for updates
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('[updater] Check failed:', err.message);
  });

  // Start notification poller
  startPoller(mainWindow, (count) => {
    updateBadge(count);
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Set overlay badge on taskbar
      if (count > 0) {
        mainWindow.setOverlayIcon(null, `${count} unread`);
      } else {
        mainWindow.setOverlayIcon(null, '');
      }
    }
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopPoller();
  destroyTray();
  if (mainWindow && !mainWindow.isDestroyed()) {
    saveWindowState(mainWindow);
  }
});

app.on('window-all-closed', () => {
  // Don't quit on window close (tray keeps app alive)
});

app.on('activate', () => {
  showWindow();
});

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showWindow();
  });
}

module.exports = { showWindow };
