const { app, BrowserWindow, ipcMain, dialog, Notification, screen } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const patcher = require('./services/patcher');
const express = require('express');
const bodyParser = require('body-parser');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const fs = require('fs');

// Enable live reload for development
if (!app.isPackaged) {
    try {
        require('electron-reload')(path.join(__dirname, '../'), {
            electron: require(path.join(__dirname, '../../node_modules/electron')),
            awaitWriteFinish: true,
        });
    } catch (e) {
        console.log('Error loading electron-reload:', e);
    }
}

// 1. Set AppUserModelId for Windows Notifications
// This removes "electron.app.Electron" from the notification title
const APP_ID = 'wxTip';
app.setAppUserModelId(APP_ID);

// Configure Auto Updater Logging
log.transports.file.level = 'info';
autoUpdater.logger = log;

let monitorProcess = null;
let mainWindow = null;
let popupWindow = null;
let popupCloseTimer = null;
const iconPath = path.join(__dirname, '../../assets/icon.png');
const configPath = path.join(__dirname, 'services/config.json');

// --- Configuration Management ---
let appConfig = {
    enableNativeNotification: true,
    enableCustomPopup: false
};

function loadConfig() {
    try {
        if (fs.existsSync(configPath)) {
            const data = fs.readFileSync(configPath, 'utf-8');
            appConfig = { ...appConfig, ...JSON.parse(data) };
        }
    } catch (e) {
        console.error('Failed to load config:', e);
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(configPath, JSON.stringify(appConfig, null, 4), 'utf-8');
    } catch (e) {
        console.error('Failed to save config:', e);
    }
}

loadConfig();

// --- Popup Window Logic ---
function createPopupWindow() {
    if (popupWindow && !popupWindow.isDestroyed()) {
        popupWindow.close();
    }

    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    
    popupWindow = new BrowserWindow({
        width: 360,
        height: 100,
        x: width - 380,
        y: 20,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        focusable: false,
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false
        }
    });

    popupWindow.once('ready-to-show', () => {
        popupWindow.show();
    });

    popupWindow.loadFile(path.join(__dirname, '../renderer/popup.html'));
    // popupWindow.webContents.openDevTools({ mode: 'detach' });

    popupWindow.on('closed', () => {
        popupWindow = null;
    });
}

function showCustomPopup(data) {
    console.log('[showCustomPopup] Sending data:', JSON.stringify(data));
    if (!popupWindow || popupWindow.isDestroyed()) {
        createPopupWindow();
        // Wait for load
        popupWindow.webContents.once('did-finish-load', () => {
            popupWindow.webContents.send('popup:update', data);
        });
    } else {
        popupWindow.webContents.send('popup:update', data);
    }

    // Reset Auto Close Timer
    if (popupCloseTimer) clearTimeout(popupCloseTimer);
    
    // Auto fade out after 5s
    popupCloseTimer = setTimeout(() => {
        if (popupWindow && !popupWindow.isDestroyed()) {
            popupWindow.webContents.send('popup:fadeout');
            // Close after animation
            setTimeout(() => {
                if (popupWindow && !popupWindow.isDestroyed()) {
                    popupWindow.close();
                }
            }, 300); // 0.2s animation + buffer
        }
    }, 5000);
}

ipcMain.on('popup:close', () => {
    if (popupWindow && !popupWindow.isDestroyed()) {
        popupWindow.close();
    }
});

// --- Message Filtering Logic ---
let messageBuffer = [];
let processTimer = null;
const DEBOUNCE_TIME = 300; // ms
const processedSignatures = new Set();

function handleIncomingMessage(msg) {
    // Basic Filtering
    if (msg.isSelf) {
        console.log(`[Filter] Ignored self message: ${msg.content}`);
        return; 
    }
    if (!msg.isUnread) {
        console.log(`[Filter] Ignored read/active message: ${msg.content}`);
        return; 
    }

    // Deduplication
    // Assuming msg has content and timestamp, or at least content
    // We create a signature to identify the message
    const signature = `${msg.id || ''}|${msg.content}|${msg.timestamp || ''}`;
    
    if (processedSignatures.has(signature)) {
        return; // Ignore duplicate
    }
    
    processedSignatures.add(signature);
    // Keep set size manageable
    if (processedSignatures.size > 1000) {
        const firstValue = processedSignatures.values().next().value;
        processedSignatures.delete(firstValue);
    }

    // Add to buffer
    messageBuffer.push(msg);

    // Debounce processing
    if (processTimer) clearTimeout(processTimer);
    processTimer = setTimeout(() => {
        processMessageQueue();
    }, DEBOUNCE_TIME);
}

function processMessageQueue() {
    if (messageBuffer.length === 0) return;

    // Requirement: "In all unread messages, only popup the latest one"
    // So we just take the last one in the buffer (assuming buffer is chronological, which it is from monitor)
    const latestMsg = messageBuffer[messageBuffer.length - 1];
    messageBuffer = []; // Clear buffer

    // Dispatch
    if (appConfig.enableCustomPopup) {
        showCustomPopup(latestMsg);
    } else if (appConfig.enableNativeNotification) {
        const notificationTitle = `${latestMsg.title} (${latestMsg.count})`;
        new Notification({
            icon: iconPath,
            title: notificationTitle, 
            body: latestMsg.content,
        }).show();
    }
}

// --- Express Notify Server (Internal) ---
const notifyApp = express();
const notifyPort = 5000;

notifyApp.use(bodyParser.json());

notifyApp.post('/notify', (req, res) => {
    const data = req.body;
    if (data && data.type === 'message') {
        // console.log(`[NotifyServer] Received: ${JSON.stringify(data)}`);
        
        // Forward to Renderer (Log View)
        if (mainWindow) {
            mainWindow.webContents.send('monitor:message', data);
        }
        
        // Handle Logic
        handleIncomingMessage(data);
        
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

ipcMain.handle('notification:show', (event, { title, body, type }) => {
    // type: 'native' | 'custom' | undefined (default logic)
    
    if (type === 'custom') {
        showCustomPopup({ content: body, timestamp: '测试' });
    } else if (type === 'native') {
        new Notification({ 
            title: title, 
            body, 
        }).show();
    } else {
        // Fallback or "Both" logic if previously intended, but here we separate them clearly.
        // If no type provided (legacy calls), we follow config
        if (appConfig.enableCustomPopup) {
            showCustomPopup({ content: body, timestamp: '测试' });
        } else {
            new Notification({ 
                title: title, 
                body, 
            }).show();
        }
    }
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

// Config IPC
ipcMain.handle('config:get-custom-popup', () => {
    return appConfig.enableCustomPopup;
});

ipcMain.handle('config:set-custom-popup', (event, enable) => {
    appConfig.enableCustomPopup = enable;
    saveConfig();
    return appConfig.enableCustomPopup;
});

ipcMain.handle('config:get-monitor', () => appConfig.enableMonitor);
