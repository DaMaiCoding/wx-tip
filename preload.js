const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectFile: () => ipcRenderer.invoke('dialog:openFile'),
    applyPatch: (filePath) => ipcRenderer.invoke('patch:apply', filePath),
    showNotification: (title, body) => ipcRenderer.invoke('notification:show', { title, body })
});
