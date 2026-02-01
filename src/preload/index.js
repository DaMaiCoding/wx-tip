const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectFile: () => ipcRenderer.invoke('dialog:openFile'),
    autoDetectPath: () => ipcRenderer.invoke('patch:autodetect'),
    applyPatch: (filePath) => ipcRenderer.invoke('patch:apply', filePath),
    showNotification: (title, body) => ipcRenderer.invoke('notification:show', { title, body }),
    minimize: () => ipcRenderer.send('window:minimize'),
    close: () => ipcRenderer.send('window:close'),
    toggleMonitor: (enabled) => ipcRenderer.send('monitor:toggle', enabled),
    onMessage: (callback) => ipcRenderer.on('monitor:message', (event, msg) => callback(msg)),
    
    // Auto Launch
    toggleAutoLaunch: (enable) => ipcRenderer.invoke('app:toggle-auto-launch', enable),
    getAutoLaunch: () => ipcRenderer.invoke('app:get-auto-launch'),
    
    // Auto Update
    onUpdateAvailable: (callback) => ipcRenderer.on('update:available', () => callback()),
    onUpdateDownloaded: (callback) => ipcRenderer.on('update:downloaded', () => callback()),
    installUpdate: () => ipcRenderer.send('app:install-update')
});
