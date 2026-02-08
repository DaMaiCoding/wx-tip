const { app, BrowserWindow, ipcMain, Notification, screen, Tray, Menu, shell, nativeImage, nativeTheme, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const express = require('express');
const bodyParser = require('body-parser');
const messageNotificationModule = require('./modules/message_notification_module');
const messageRecallModule = require('./modules/message_recall_module');
const monitorServiceModule = require('./modules/monitor_service_module');
const messageParserModule = require('./modules/message_parser_module');
const eventBus = require('./modules/event_bus');

// Enable live reload for development
if (!app.isPackaged) {
    try {
        require('electron-reload')(path.join(__dirname, '../'), {
            electron: require(path.join(__dirname, '../../node_modules/electron')),
            awaitWriteFinish: true,
            ignored: [
                /config\.json/,
                /recall_history\.json/,
                /monitor\.log/,
                /.*\.log/,
                /.*\.csv/
            ]
        });
    } catch (e) {
        console.log('Error loading electron-reload:', e);
    }
}

// Set App Name if provided via env
if (process.env.PRODUCT_NAME) {
    app.name = process.env.PRODUCT_NAME;
}

// 1. Set AppUserModelId for Windows Notifications
const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR);
const APP_ID = process.env.APP_ID || (app.isPackaged ? (isPortable ? 'wxtip' : 'com.wxtip.app') : 'com.wxtip.app.dev');
app.setAppUserModelId(APP_ID);

let mainWindow = null;
let popupWindow = null;
let popupCloseTimer = null;
let tray = null;
let isQuitting = false;

const iconPath = process.env.APP_ICON_PNG || (app.isPackaged 
    ? path.join(process.resourcesPath, 'assets/icon.png')
    : path.join(__dirname, '../../assets/icon.png'));
const iconIcoPath = process.env.APP_ICON_ICO || (app.isPackaged 
    ? path.join(process.resourcesPath, 'assets/icon.ico')
    : path.join(__dirname, '../../assets/icon.ico'));

console.log(`[IconPath] Check: ${iconIcoPath}, Exists: ${fs.existsSync(iconIcoPath)}`);

const appIcon = nativeImage.createFromPath(process.platform === 'win32' ? iconIcoPath : iconPath);
if (appIcon.isEmpty()) {
    console.error('[Icon] Failed to load icon from path:', process.platform === 'win32' ? iconIcoPath : iconPath);
} else {
    console.log('[Icon] Successfully loaded native image');
}

const trayIconPath = process.platform === 'win32' ? iconIcoPath : iconPath;
const configPath = app.isPackaged 
    ? path.join(process.resourcesPath, 'data', 'config.json')
    : path.join(__dirname, 'data/config.json');
const recallHistoryPath = app.isPackaged
    ? path.join(process.resourcesPath, 'data', 'recall_history.json')
    : path.join(__dirname, 'data/recall_history.json');


// --- Shortcut Management ---
function ensureShortcut() {
    if (process.platform !== 'win32') return;
    
    // Skip shortcut creation in development to avoid polluting system cache
    if (!app.isPackaged) return;

    const shortcutName = 'wxTip.lnk';
    const shortcutPath = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', shortcutName);
    const targetPath = process.execPath;
    const shortcutIcon = fs.existsSync(iconIcoPath) ? iconIcoPath : iconPath;

    try {
        shell.writeShortcutLink(shortcutPath, 'create', {
            target: targetPath,
            cwd: path.dirname(targetPath),
            appUserModelId: APP_ID,
            icon: shortcutIcon,
            description: 'wxTip - WeChat Notification Enhancer',
            args: ''
        });
    } catch (e) {
        console.error(`[Shortcut] Exception creating shortcut: ${e.message}`);
    }
}

// --- Configuration Management ---
let appConfig = {
    enableNativeNotification: true,
    enableCustomPopup: false,
    enableMonitor: false,
    enableAntiRecall: false,
    theme: 'system' // system, light, dark
};

function loadConfig() {
    try {
        if (fs.existsSync(configPath)) {
            const data = fs.readFileSync(configPath, 'utf-8');
            appConfig = { ...appConfig, ...JSON.parse(data) };
        }
        // Apply theme on load
        nativeTheme.themeSource = appConfig.theme;
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

// --- Modules Initialization ---
const moduleContext = {
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
    appIcon: appIcon,
    iconPath: iconPath,
    iconIcoPath: iconIcoPath,
    recallHistoryPath: recallHistoryPath
};

messageNotificationModule.init(appConfig, moduleContext);
messageRecallModule.init(appConfig, moduleContext);
monitorServiceModule.init(appConfig, moduleContext);
messageParserModule.init(appConfig, moduleContext);

// Listen for config updates from modules
eventBus.on('config:updated', ({ key, value }) => {
    appConfig[key] = value;
    saveConfig();
    
    // Sync config across modules
    messageNotificationModule.updateConfig(appConfig);
    messageRecallModule.updateConfig(appConfig);
    // MonitorServiceModule 已经监听了 config:updated，不需要显式调用 updateConfig
    messageParserModule.config = appConfig; // Parser 可能也需要最新配置
});



let notifyServer = null;
const notifySockets = new Set();
const NOTIFY_PORT = 19088;

function startNotifyServer() {
    if (notifyServer) return;

    const serverApp = express();
    serverApp.use(bodyParser.json());

    serverApp.post('/notify', (req, res) => {
        const msgData = req.body;
        console.log('[NotifyServer] Received:', msgData);
        
        // 使用 MessageParser 处理收到的消息（与 monitor 输出走相同流程）
        messageParserModule.processParsedMessage(msgData);
        res.status(200).send('OK');
    });

    notifyServer = serverApp.listen(NOTIFY_PORT, '127.0.0.1', () => {
        console.log(`Notify Server running on port ${NOTIFY_PORT}`);
    });

    notifyServer.on('connection', (socket) => {
        notifySockets.add(socket);
        socket.on('close', () => {
            notifySockets.delete(socket);
        });
    });
}

// --- System Tray Logic ---
function createTray() {
    if (tray) return;

    tray = new Tray(appIcon);

    const contextMenu = Menu.buildFromTemplate([
        {
            label: '显示主窗口',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    if (process.platform === 'win32') {
                        mainWindow.setIcon(appIcon);
                    }
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
                if (process.platform === 'win32') {
                    mainWindow.setIcon(appIcon);
                }
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





function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        frame: false, 
        titleBarStyle: 'hidden',
        skipTaskbar: false,
        showInTaskbar: true,
        show: false,
        icon: appIcon,
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    mainWindow.once('ready-to-show', () => {
        const isHidden = process.argv.includes('--hidden') || 
                         (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAsHidden);
        
        // Force update icon
        if (process.platform === 'win32') {
            mainWindow.setIcon(appIcon);
            
            // Double insurance: update again after a short delay
            setTimeout(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.setIcon(appIcon);
                    // Remove any overlay icon just in case
                    mainWindow.setOverlayIcon(null, '');
                }
            }, 500);
        }
        
        if (!isHidden) {
            mainWindow.show();
        }
    });

    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    createTray();

    ipcMain.on('window:minimize', () => mainWindow.minimize());
    ipcMain.on('window:close', () => mainWindow.hide());
    ipcMain.on('app:quit', () => {
        isQuitting = true;
        app.quit();
    });
}

// Auto Launch Logic
function setAutoLaunch(enable) {
    app.setLoginItemSettings({
        openAtLogin: enable,
        path: process.execPath,
        args: ['--hidden'],
        openAsHidden: enable
    });
}

app.whenReady().then(() => {
    ensureShortcut();
    createWindow();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    startNotifyServer();

    // MonitorServiceModule 内部会根据配置启动，这里不需要显式调用
});

app.on('window-all-closed', function () {
    // MonitorServiceModule 会监听 app:quitting 或自行管理，但这里如果是 quit 应用，
    // 会触发 will-quit，MonitorServiceModule 应该在那里清理，或者这里手动 emit 一个事件
    if (process.platform !== 'darwin') {
        isQuitting = true;
        destroyTray();
        app.quit();
    }
});

app.on('before-quit', () => {
    isQuitting = true;
});

app.on('will-quit', () => {
    eventBus.emit('app:quitting');
    if (notifyServer) {
        console.log('Stopping Notify Server...');
        
        // Force close all existing connections
        for (const socket of notifySockets) {
            socket.destroy();
        }
        notifySockets.clear();

        notifyServer.close();
        notifyServer = null;
    }
});

// IPC Handlers


ipcMain.handle('app:toggle-auto-launch', (event, enable) => {
    setAutoLaunch(enable);
    return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('app:get-auto-launch', () => {
    return app.getLoginItemSettings().openAtLogin;
});

// New IPC: Get App Version
ipcMain.handle('app:get-version', () => {
    // 修复开发环境下版本号获取不正确的问题
    if (!app.isPackaged) {
        try {
            const pkgPath = path.join(__dirname, '../../package.json');
            if (fs.existsSync(pkgPath)) {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
                return pkg.version;
            }
        } catch (error) {
            console.error('Failed to read version from package.json:', error);
        }
    }
    return app.getVersion();
});





ipcMain.handle('app:set-theme', (event, theme) => {
    appConfig.theme = theme;
    nativeTheme.themeSource = theme;
    saveConfig();
    return true;
});

ipcMain.handle('app:get-theme', () => {
    return appConfig.theme;
});


