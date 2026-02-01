const { app, BrowserWindow, ipcMain, dialog, Notification } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const patcher = require('./services/patcher');
const express = require('express');
const bodyParser = require('body-parser');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// 1. Set AppUserModelId for Windows Notifications
// This removes "electron.app.Electron" from the notification title
const APP_ID = 'wxTip';
app.setAppUserModelId(APP_ID);

// Configure Auto Updater Logging
log.transports.file.level = 'info';
autoUpdater.logger = log;

let monitorProcess = null;
let mainWindow = null;
const iconPath = path.join(__dirname, '../../assets/icon.png');

// --- Express Notify Server (Internal) ---
const notifyApp = express();
const notifyPort = 5000;

notifyApp.use(bodyParser.json());

notifyApp.post('/notify', (req, res) => {
    const data = req.body;
    if (data && data.type === 'message') {
        console.log(`[NotifyServer] Received: ${JSON.stringify(data)}`);
        
        // Forward to Renderer
        if (mainWindow) {
            mainWindow.webContents.send('monitor:message', data);
        }
        
        // Show System Notification
        new Notification({ 
            title: ' ', // Empty space to remove the title text
            body: data.content,
            // icon: iconPath // Removed
        }).show();
        
        res.status(200).json({ status: 'success' });
    } else {
        res.status(400).json({ status: 'error', message: 'Invalid payload' });
    }
});

function startNotifyServer() {
    notifyApp.listen(notifyPort, '127.0.0.1', () => {
        console.log(`[NotifyServer] Internal server running on port ${notifyPort}`);
    });
}
// ----------------------------------------

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        frame: false, 
        titleBarStyle: 'hidden',
        icon: iconPath,
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    ipcMain.on('window:minimize', () => mainWindow.minimize());
    ipcMain.on('window:close', () => mainWindow.close());
}

// Start PowerShell Monitor (sends to Internal Express Server)
function startMonitor() {
    if (monitorProcess) return;

    const scriptPath = path.join(__dirname, 'services', 'monitor.ps1');
    console.log(`Starting monitor: ${scriptPath}`);

    monitorProcess = spawn('powershell.exe', [
        '-NoProfile', 
        '-ExecutionPolicy', 'Bypass', 
        '-File', scriptPath
    ]);

    monitorProcess.stdout.on('data', (data) => {
        const str = data.toString().trim();
        if (str === 'MONITOR_STARTED') {
            console.log('[Monitor] Service started successfully');
            return;
        }

        try {
            const lines = str.split('\n');
            for (const line of lines) {
                if (line.trim().startsWith('{')) {
                    const msg = JSON.parse(line);
                    if (msg.type === 'message') {
                        // Simulate a POST request to our own internal server
                        forwardToInternalServer(msg);
                    }
                } else if (line.trim().length > 0) {
                     console.log(`[Monitor STDOUT] ${line}`);
                }
            }
        } catch (e) {}
    });

    monitorProcess.stderr.on('data', (data) => {
        console.error(`[Monitor STDERR] ${data}`);
    });

    monitorProcess.on('close', (code) => {
        console.log(`[Monitor] Process exited with code ${code}`);
        monitorProcess = null;
        if (mainWindow) mainWindow.webContents.send('monitor:status', false);
    });
}

function forwardToInternalServer(msg) {
    const http = require('http');
    const req = http.request({
        hostname: '127.0.0.1',
        port: notifyPort,
        path: '/notify',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    });
    req.write(JSON.stringify(msg));
    req.end();
}

function stopMonitor() {
    if (monitorProcess) {
        monitorProcess.kill();
        monitorProcess = null;
    }
}

// Auto Update Logic
function checkForUpdates() {
    if (app.isPackaged) {
        autoUpdater.checkForUpdatesAndNotify();
    }
}

autoUpdater.on('update-available', () => {
    if (mainWindow) mainWindow.webContents.send('update:available');
});

autoUpdater.on('update-downloaded', () => {
    if (mainWindow) mainWindow.webContents.send('update:downloaded');
});

// Auto Launch Logic
function setAutoLaunch(enable) {
    app.setLoginItemSettings({
        openAtLogin: enable,
        path: process.execPath,
        args: ['--hidden']
    });
}

app.whenReady().then(() => {
    startNotifyServer(); // Start internal Express server
    createWindow();
    checkForUpdates(); // Check for updates on startup

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    stopMonitor();
    if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers
ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile', 'openDirectory'], 
        filters: [
            { name: 'WeChat DLL', extensions: ['dll'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });
    return canceled ? null : filePaths[0];
});

ipcMain.handle('patch:autodetect', async () => {
    const installPath = await patcher.getInstallPathFromRegistry();
    if (!installPath) return null;
    const dllPath = await patcher.findDllInPath(installPath);
    return dllPath || installPath;
});

// Use Node.js Patcher directly (No Python)
ipcMain.handle('patch:apply', async (event, filePath) => {
    return await patcher.applyPatch(filePath);
});

ipcMain.handle('notification:show', (event, { title, body }) => {
    // Also update this one for manual test button
    new Notification({ 
        title: ' ', // Empty space to remove the title text
        body, 
        // icon: iconPath // Removed
    }).show();
    return 'Notification sent';
});

ipcMain.on('monitor:toggle', (event, enabled) => {
    if (enabled) {
        startMonitor();
    } else {
        stopMonitor();
    }
});

// Auto Launch IPC
ipcMain.handle('app:toggle-auto-launch', (event, enable) => {
    setAutoLaunch(enable);
    return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('app:get-auto-launch', () => {
    return app.getLoginItemSettings().openAtLogin;
});

// Update IPC
ipcMain.on('app:install-update', () => {
    autoUpdater.quitAndInstall();
});
