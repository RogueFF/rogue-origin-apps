const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atlas', {
  // Popup lifecycle
  onShowPopup: (callback) => ipcRenderer.on('show-popup', (_e, data) => callback(data)),
  onDismissPopup: (callback) => ipcRenderer.on('dismiss-popup', () => callback()),
  popupDismiss: () => ipcRenderer.send('popup:dismiss'),
  popupClicked: (id) => ipcRenderer.send('popup:clicked', id),
  popupAcknowledge: (id) => ipcRenderer.send('popup:acknowledge', id),

  // Settings
  getTheme: () => ipcRenderer.invoke('get-theme'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getTtsConfig: () => ipcRenderer.invoke('get-tts-config'),
});

// Also expose atlasDesktop for main window controls
contextBridge.exposeInMainWorld('atlasDesktop', {
  platform: process.platform,
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
});
