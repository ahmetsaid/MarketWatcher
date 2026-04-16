const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadPortfolio: () => ipcRenderer.invoke('load-portfolio'),
  savePortfolio: (data) => ipcRenderer.invoke('save-portfolio', data),
  fetchQuotes: (symbols, chartRange) => ipcRenderer.invoke('fetch-quotes', symbols, chartRange),
  showNotification: (opts) => ipcRenderer.invoke('show-notification', opts),
  fetchDetails: (symbol) => ipcRenderer.invoke('fetch-details', symbol),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onForceRefresh: (cb) => ipcRenderer.on('force-refresh', cb),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (data) => ipcRenderer.invoke('save-settings', data),
});
