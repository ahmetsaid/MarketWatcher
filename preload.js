const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadPortfolio: () => ipcRenderer.invoke('load-portfolio'),
  savePortfolio: (data) => ipcRenderer.invoke('save-portfolio', data),
  fetchQuotes: (symbols, chartRange) => ipcRenderer.invoke('fetch-quotes', symbols, chartRange),
  showNotification: (opts) => ipcRenderer.invoke('show-notification', opts),
  fetchDetails: (symbol) => ipcRenderer.invoke('fetch-details', symbol),
  fetchOptionsForDate: (symbol, timestamp) => ipcRenderer.invoke('fetch-options-for-date', symbol, timestamp),
  fetchOptionQuote: (args) => ipcRenderer.invoke('fetch-option-quote', args),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onForceRefresh: (cb) => ipcRenderer.on('force-refresh', cb),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (data) => ipcRenderer.invoke('save-settings', data),
  openRollWindow: () => ipcRenderer.invoke('open-roll-window'),
  loadRolls: () => ipcRenderer.invoke('load-rolls'),
  saveRolls: (data) => ipcRenderer.invoke('save-rolls', data),
  rollSetAlwaysOnTop: (v) => ipcRenderer.invoke('roll-set-always-on-top', v),
  rollWindowControl: (action) => ipcRenderer.invoke('roll-window-control', action),
});
