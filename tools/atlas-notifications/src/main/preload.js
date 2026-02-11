const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atlas', {
  // Notifications
  getNotifications: () => ipcRenderer.invoke('get-notifications'),
  markRead: (id) => ipcRenderer.invoke('mark-read', id),
  markAllRead: () => ipcRenderer.invoke('mark-all-read'),
  clearAll: () => ipcRenderer.invoke('clear-all'),
  getUnreadCount: () => ipcRenderer.invoke('get-unread-count'),
  closePanel: () => ipcRenderer.invoke('close-panel'),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (settings) => ipcRenderer.invoke('set-settings', settings),

  // TTS
  getTtsConfig: () => ipcRenderer.invoke('get-tts-config'),
  setTtsConfig: (config) => ipcRenderer.invoke('set-tts-config', config),
  getVoices: () => ipcRenderer.invoke('get-voices'),

  // Alerts
  acknowledgeAlert: (id) => ipcRenderer.invoke('acknowledge-alert', id),

  // Status
  checkAtlasStatus: () => ipcRenderer.invoke('check-atlas-status'),

  // Legacy (kept for compatibility)
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (config) => ipcRenderer.invoke('set-config', config),

  // Events
  onNewNotification: (callback) => {
    ipcRenderer.on('new-notification', (_event, notif) => callback(notif));
  },
  onRefresh: (callback) => {
    ipcRenderer.on('refresh-notifications', (_event, notifs) => callback(notifs));
  },

  // Popup channels
  onShowPopup: (callback) => {
    ipcRenderer.once('show-popup', (_event, data) => callback(data));
  },
  onDismissPopup: (callback) => {
    ipcRenderer.on('dismiss-popup', () => callback());
  },
  popupClicked: (notifId) => ipcRenderer.send('popup-clicked', notifId),
  popupDismiss: () => ipcRenderer.send('popup-dismiss'),
  popupAcknowledge: (notifId) => ipcRenderer.send('popup-acknowledge', notifId)
});
