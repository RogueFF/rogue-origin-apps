const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atlas', {
  getNotifications: () => ipcRenderer.invoke('get-notifications'),
  markRead: (id) => ipcRenderer.invoke('mark-read', id),
  markAllRead: () => ipcRenderer.invoke('mark-all-read'),
  clearAll: () => ipcRenderer.invoke('clear-all'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (config) => ipcRenderer.invoke('set-config', config),
  checkAtlasStatus: () => ipcRenderer.invoke('check-atlas-status'),
  closePanel: () => ipcRenderer.invoke('close-panel'),
  getUnreadCount: () => ipcRenderer.invoke('get-unread-count'),
  onNewNotification: (callback) => {
    ipcRenderer.on('new-notification', (_event, notif) => callback(notif));
  },
  onRefresh: (callback) => {
    ipcRenderer.on('refresh-notifications', (_event, notifs) => callback(notifs));
  }
});
