const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectFile: () => ipcRenderer.invoke('dialog:openFile'),
    autoDetectPath: () => ipcRenderer.invoke('patch:autodetect'),
    applyPatch: (filePath) => ipcRenderer.invoke('patch:apply', filePath),
    showNotification: (title, body, type) => ipcRenderer.invoke('notification:show', { title, body, type }),
    minimize: () => ipcRenderer.send('window:minimize'),
    close: () => ipcRenderer.send('window:close'),
    toggleMonitor: (enabled) => ipcRenderer.send('monitor:toggle', enabled),
    onMessage: (callback) => ipcRenderer.on('monitor:message', (event, msg) => callback(msg)),
    
    // Auto Launch
    toggleAutoLaunch: (enable) => ipcRenderer.invoke('app:toggle-auto-launch', enable),
    getAutoLaunch: () => ipcRenderer.invoke('app:get-auto-launch'),
    // Custom Popup Config
    getCustomPopupConfig: () => ipcRenderer.invoke('config:get-custom-popup'),
    setCustomPopupConfig: (enable) => ipcRenderer.invoke('config:set-custom-popup', enable),
    getMonitorConfig: () => ipcRenderer.invoke('config:get-monitor'),

    // Auto Update
    checkUpdate: () => ipcRenderer.invoke('app:check-update'),
    onUpdateAvailable: (callback) => ipcRenderer.on('update:available', (event, info) => callback(info)),
    onDownloadProgress: (callback) => ipcRenderer.on('update:download-progress', (event, progress) => callback(progress)),
    onUpdateNotAvailable: (callback) => ipcRenderer.on('update:not-available', (event, info) => callback(info)),
    onUpdateDownloaded: (callback) => ipcRenderer.on('update:downloaded', (event, info) => callback(info)),
    onUpdateError: (callback) => ipcRenderer.on('update:error', (event, error) => callback(error)),
    onCheckingForUpdate: (callback) => ipcRenderer.on('update:checking', () => callback()),
    installUpdate: () => ipcRenderer.send('app:install-update')
});
