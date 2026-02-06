const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    showNotification: (title, body, type) => ipcRenderer.invoke('notification:show', { title, body, type }),
    minimize: () => ipcRenderer.send('window:minimize'),
    close: () => ipcRenderer.send('window:close'),
    quitApp: () => ipcRenderer.send('app:quit'),
    
    // Auto Launch
    toggleAutoLaunch: (enable) => ipcRenderer.invoke('app:toggle-auto-launch', enable),
    getAutoLaunch: () => ipcRenderer.invoke('app:get-auto-launch'),

    // App Version
    getAppVersion: () => ipcRenderer.invoke('app:get-version'),

    // Monitor
    toggleMonitor: (enable) => ipcRenderer.invoke('monitor:toggle', enable),
    getMonitorStatus: () => ipcRenderer.invoke('monitor:get-status'),

    // Custom Popup
    toggleCustomPopup: (enable) => ipcRenderer.invoke('popup:toggle', enable),
    getCustomPopupStatus: () => ipcRenderer.invoke('popup:get-status'),

    // Theme
    setTheme: (theme) => ipcRenderer.invoke('app:set-theme', theme),
    getTheme: () => ipcRenderer.invoke('app:get-theme')
});
