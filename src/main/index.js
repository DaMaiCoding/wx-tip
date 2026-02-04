const { app, BrowserWindow, ipcMain, dialog, Notification, screen, Tray, Menu, shell } = require('electron');
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
const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR);
const APP_ID = app.isPackaged ? (isPortable ? 'wxtip' : 'com.wxtip.app') : 'wxtip';
app.setAppUserModelId(APP_ID);

// Configure Auto Updater Logging
log.transports.file.level = 'info';
autoUpdater.logger = log;

let monitorProcess = null;
let mainWindow = null;
let popupWindow = null;
let popupCloseTimer = null;
let tray = null;
let isQuitting = false;
const iconPath = app.isPackaged 
    ? path.join(process.resourcesPath, 'assets/icon.png')
    : path.join(__dirname, '../../assets/icon.png');
const iconIcoPath = app.isPackaged 
    ? path.join(process.resourcesPath, 'assets/icon.ico')
    : path.join(__dirname, '../../assets/icon.ico');
const trayIconPath = process.platform === 'win32' ? iconIcoPath : iconPath;
const configPath = app.isPackaged 
    ? path.join(process.resourcesPath, 'services', 'config.json')
    : path.join(__dirname, 'services/config.json');

// --- Shortcut Management (Fix for Notification Icon) ---
function ensureShortcut() {
    if (process.platform !== 'win32') return;

    const shortcutName = app.isPackaged ? 'wxTip.lnk' : 'wxTip (Dev).lnk';
    const shortcutPath = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', shortcutName);
    
    // In dev, process.execPath is electron.exe
    // In prod, it is the app executable
    const targetPath = process.execPath;
    
    // Check if we need to update or create
    // For simplicity, we overwrite it to ensure latest AUMID and Icon
    // Use .ico for shortcut if available
    const shortcutIcon = fs.existsSync(iconIcoPath) ? iconIcoPath : iconPath;

    try {
        const res = shell.writeShortcutLink(shortcutPath, 'create', {
            target: targetPath,
            cwd: app.isPackaged ? path.dirname(targetPath) : process.cwd(),
            appUserModelId: APP_ID,
            icon: shortcutIcon,
            description: 'wxTip - WeChat Notification Enhancer',
            args: app.isPackaged ? '' : 'src/main/index.js' // In dev, pass the entry script
        });
        
        if (res) {
            console.log(`[Shortcut] Successfully updated shortcut at: ${shortcutPath}`);
            console.log(`[Shortcut] AUMID: ${APP_ID}`);
            console.log(`[Shortcut] Icon: ${shortcutIcon}`);
        } else {
            console.error('[Shortcut] Failed to write shortcut link');
        }
    } catch (e) {
        console.error(`[Shortcut] Exception creating shortcut: ${e.message}`);
    }
}

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

// --- System Tray Logic ---
function createTray() {
    if (tray) {
        return;
    }

    tray = new Tray(trayIconPath);

    const contextMenu = Menu.buildFromTemplate([
        {
            label: '显示主窗口',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        {
            label: '退出',
            click: () => {
                app.quit();
            }
        }
    ]);

    tray.setToolTip('wxTip - 微信消息提醒');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
                mainWindow.focus();
            }
        }
    });
}

function destroyTray() {
    if (tray) {
        tray.destroy();
        tray = null;
    }
}

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
        icon: process.platform === 'win32' ? iconIcoPath : iconPath,
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
        showNativeNotification(notificationTitle, latestMsg.content);
    }
}

function showNativeNotification(title, body) {
    const notifyOpts = {
        title: title, 
        body: body,
    };
    // Prefer .ico for Windows Notifications if available, as requested
    if (process.platform === 'win32' && fs.existsSync(iconIcoPath)) {
        notifyOpts.icon = iconIcoPath;
    } else if (fs.existsSync(iconPath)) {
        notifyOpts.icon = iconPath;
    }
    new Notification(notifyOpts).show();
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

let notifyServerReady = false;

function startNotifyServer() {
    return new Promise((resolve, reject) => {
        try {
            const server = notifyApp.listen(notifyPort, '127.0.0.1', () => {
                console.log(`[NotifyServer] Internal server running on port ${notifyPort}`);
                notifyServerReady = true;
                resolve();
            });

            server.on('error', (error) => {
                console.error(`[NotifyServer] Failed to start: ${error.message}`);
                notifyServerReady = false;
                reject(error);
            });
        } catch (error) {
            console.error(`[NotifyServer] Exception: ${error.message}`);
            reject(error);
        }
    });
}
// ----------------------------------------

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        frame: false, 
        titleBarStyle: 'hidden',
        skipTaskbar: false,
        showInTaskbar: true,
        icon: process.platform === 'win32' ? iconIcoPath : iconPath,
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    createTray();

    ipcMain.on('window:minimize', () => mainWindow.minimize());
    ipcMain.on('window:close', () => mainWindow.hide());
}

// Start PowerShell Monitor (sends to Internal Express Server)
function startMonitor() {
    if (monitorProcess) {
        console.log('[Monitor] Already running, skipping start');
        return;
    }

    // Determine correct script path for both development and packaged environments
    const scriptPath = app.isPackaged 
        ? path.join(process.resourcesPath, 'services', 'monitor.ps1')
        : path.join(__dirname, 'services', 'monitor.ps1');

    console.log(`[Monitor] Starting monitor from: ${scriptPath}`);
    console.log(`[Monitor] Packaged: ${app.isPackaged}, ResourcesPath: ${app.isPackaged ? process.resourcesPath : 'N/A'}`);

    // Verify script exists before spawning
    if (!fs.existsSync(scriptPath)) {
        console.error(`[Monitor] FATAL: Script not found at ${scriptPath}`);
        if (mainWindow) {
            mainWindow.webContents.send('monitor:error', `Script not found: ${scriptPath}`);
        }
        return;
    }

    const monitorArgs = [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', scriptPath
    ];

    console.log(`[Monitor] Spawning: powershell.exe ${monitorArgs.join(' ')}`);

    try {
        monitorProcess = spawn('powershell.exe', monitorArgs, {
            windowsHide: true
        });
    } catch (error) {
        console.error(`[Monitor] Failed to spawn process: ${error.message}`);
        return;
    }

    monitorProcess.stdout.on('data', (data) => {
        const str = data.toString().trim();
        if (str === 'MONITOR_STARTED') {
            console.log('[Monitor] Service started successfully');
            if (mainWindow) {
                mainWindow.webContents.send('monitor:status', true);
            }
            return;
        }

        try {
            const lines = str.split('\n');
            for (const line of lines) {
                if (line.trim().startsWith('{')) {
                    const msg = JSON.parse(line);
                    if (msg.type === 'message') {
                        forwardToInternalServer(msg);
                    }
                } else if (line.trim().length > 0) {
                    console.log(`[Monitor STDOUT] ${line}`);
                }
            }
        } catch (e) {
            // Ignore JSON parse errors for non-JSON lines
        }
    });

    monitorProcess.stderr.on('data', (data) => {
        const errorMsg = data.toString().trim();
        console.error(`[Monitor STDERR] ${errorMsg}`);
        if (mainWindow) {
            mainWindow.webContents.send('monitor:stderr', errorMsg);
        }
    });

    monitorProcess.on('error', (error) => {
        console.error(`[Monitor] Process error: ${error.message}`);
        if (mainWindow) {
            mainWindow.webContents.send('monitor:error', error.message);
        }
    });

    monitorProcess.on('close', (code) => {
        const exitMsg = `[Monitor] Process exited with code ${code}`;
        console.log(exitMsg);
        monitorProcess = null;
        if (mainWindow) {
            mainWindow.webContents.send('monitor:status', false);
            mainWindow.webContents.send('monitor:closed', { code });
        }
    });
}

function forwardToInternalServer(msg) {
    if (!notifyServerReady) {
        console.warn('[Monitor] Notify server not ready, dropping message');
        return;
    }

    const http = require('http');
    const postData = JSON.stringify(msg);

    const req = http.request({
        hostname: '127.0.0.1',
        port: notifyPort,
        path: '/notify',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 1000
    });

    req.on('error', (error) => {
        console.error(`[Monitor] Forward error: ${error.message}`);
    });

    req.on('timeout', () => {
        req.destroy();
        console.error('[Monitor] Forward timeout');
    });

    req.write(postData);
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

app.whenReady().then(async () => {
    // Ensure shortcut exists for correct Notification Icon
    ensureShortcut();

    try {
        await startNotifyServer();
    } catch (error) {
        console.error('[App] Failed to start notify server, monitor may not work:', error.message);
    }

    createWindow();
    checkForUpdates();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    stopMonitor();
    if (process.platform !== 'darwin') {
        isQuitting = true;
        destroyTray();
        app.quit();
    }
});

app.on('before-quit', () => {
    isQuitting = true;
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
        showNativeNotification(title, body);
    } else {
        // Fallback or "Both" logic if previously intended, but here we separate them clearly.
        // If no type provided (legacy calls), we follow config
        if (appConfig.enableCustomPopup) {
            showCustomPopup({ content: body, timestamp: '测试' });
        } else {
            showNativeNotification(title, body);
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
