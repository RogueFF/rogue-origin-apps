const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');

let tray = null;
let showCallback = null;
let quitCallback = null;
let themeCallback = null;

function initTray(onShow, onQuit, onThemeChange) {
  showCallback = onShow;
  quitCallback = onQuit;
  themeCallback = onThemeChange;

  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) throw new Error('empty');
  } catch {
    // Fallback: create a simple 16x16 icon programmatically
    icon = createFallbackIcon();
  }

  tray = new Tray(icon);
  tray.setToolTip('Atlas Mission Control');

  updateContextMenu(0);

  tray.on('click', () => {
    if (showCallback) showCallback();
  });
}

function createFallbackIcon() {
  // 16x16 white diamond on transparent background
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4, 0); // RGBA

  // Draw a diamond shape
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.abs(x - 7.5);
      const cy = Math.abs(y - 7.5);
      if (cx + cy <= 6) {
        const idx = (y * size + x) * 4;
        canvas[idx] = 240;     // R
        canvas[idx + 1] = 236; // G
        canvas[idx + 2] = 228; // B
        canvas[idx + 3] = 255; // A
      }
    }
  }

  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

let currentTheme = 'relay';

function updateContextMenu(unreadCount) {
  if (!tray) return;

  const badge = unreadCount > 0 ? ` (${unreadCount})` : '';
  const menu = Menu.buildFromTemplate([
    {
      label: `Atlas Mission Control${badge}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Show',
      click: () => { if (showCallback) showCallback(); },
    },
    { type: 'separator' },
    {
      label: 'Theme',
      submenu: [
        {
          label: 'Relay (Hologram)',
          type: 'radio',
          checked: currentTheme === 'relay',
          click: () => { currentTheme = 'relay'; if (themeCallback) themeCallback('relay'); },
        },
        {
          label: 'Terrain (Topo)',
          type: 'radio',
          checked: currentTheme === 'terrain',
          click: () => { currentTheme = 'terrain'; if (themeCallback) themeCallback('terrain'); },
        },
      ],
    },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => { if (quitCallback) quitCallback(); },
    },
  ]);

  tray.setContextMenu(menu);

  // Update tooltip
  const tip = unreadCount > 0
    ? `Atlas MC — ${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}`
    : 'Atlas Mission Control';
  tray.setToolTip(tip);
}

function updateBadge(count) {
  updateContextMenu(count);
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = { initTray, destroyTray, updateBadge };
