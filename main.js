const { app, BrowserWindow, ipcMain, dialog, Notification } = require('electron');
const path = require('path');
const patcher = require('./lib/patcher');

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        frame: false, // Remove the native window frame
        titleBarStyle: 'hidden', // Hide the title bar content
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadFile('index.html');

    // Window control handlers
    ipcMain.on('window:minimize', () => {
        mainWindow.minimize();
    });

    ipcMain.on('window:close', () => {
        mainWindow.close();
    });
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers

// 1. Select File
ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            { name: 'WeChat DLL', extensions: ['dll'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });
    if (canceled) {
        return null;
    } else {
        return filePaths[0];
    }
});

// 2. Apply Patch
ipcMain.handle('patch:apply', async (event, filePath) => {
    return await patcher.applyPatch(filePath);
});

// 3. Send Notification
ipcMain.handle('notification:show', (event, { title, body }) => {
    new Notification({ title, body }).show();
    return 'Notification sent';
});
