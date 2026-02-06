const { app, BrowserWindow, ipcMain, Notification, screen, Tray, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const express = require('express');
const bodyParser = require('body-parser');

// Enable live reload for development
if (!app.isPackaged) {
    try {
        require('electron-reload')(path.join(__dirname, '../'), {
            electron: require(path.join(__dirname, '../../node_modules/electron')),
            awaitWriteFinish: true,
            ignored: /config\.json/
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
const APP_ID = process.env.APP_ID || (app.isPackaged ? (isPortable ? 'wxtip' : 'com.wxtip.app') : 'wxtip');
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
const trayIconPath = process.platform === 'win32' ? iconIcoPath : iconPath;
const configPath = app.isPackaged 
    ? path.join(process.resourcesPath, 'services', 'config.json')
    : path.join(__dirname, 'services/config.json');

// --- Shortcut Management ---
function ensureShortcut() {
    if (process.platform !== 'win32') return;

    const shortcutName = app.isPackaged ? 'wxTip.lnk' : 'wxTip (Dev).lnk';
    const shortcutPath = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', shortcutName);
    const targetPath = process.execPath;
    const shortcutIcon = fs.existsSync(iconIcoPath) ? iconIcoPath : iconPath;

    try {
        shell.writeShortcutLink(shortcutPath, 'create', {
            target: targetPath,
            cwd: app.isPackaged ? path.dirname(targetPath) : process.cwd(),
            appUserModelId: APP_ID,
            icon: shortcutIcon,
            description: 'wxTip - WeChat Notification Enhancer',
            args: app.isPackaged ? '' : 'src/main/index.js'
        });
    } catch (e) {
        console.error(`[Shortcut] Exception creating shortcut: ${e.message}`);
    }
}

// --- Configuration Management ---
let appConfig = {
    enableNativeNotification: true,
    enableCustomPopup: false,
    enableMonitor: false
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

// --- Monitor Service Logic ---
let monitorProcess = null;
let notifyServer = null;
const NOTIFY_PORT = 19088;

function startMonitor() {
    if (monitorProcess) return;

    const monitorScript = app.isPackaged 
        ? path.join(process.resourcesPath, 'services', 'monitor.ps1')
        : path.join(__dirname, 'services/monitor.ps1');
    
    if (!fs.existsSync(monitorScript)) {
        console.error('Monitor script not found:', monitorScript);
        return;
    }

    console.log('Starting Monitor Service from:', monitorScript);
    monitorProcess = spawn('powershell.exe', [
        '-NoProfile', 
        '-ExecutionPolicy', 'Bypass', 
        '-File', monitorScript
    ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
    });

    monitorProcess.stdout.on('data', (data) => {
        const output = data.toString('utf8');
        // console.log('[Monitor Raw]', output); 
        
        // Handle potentially multiple lines or split JSON
        const lines = output.split(/\r?\n/);
        lines.forEach(line => {
            line = line.trim();
            if (!line) return;
            
            // Try parsing JSON
            if (line.startsWith('{') && line.endsWith('}')) {
                try {
                    const msg = JSON.parse(line);
                    console.log('[Monitor JSON]', msg);
                    handleIncomingMessage(msg);
                } catch (e) {
                    console.log('[Monitor Log]', line);
                }
            } else {
                console.log('[Monitor Log]', line);
            }
        });
    });

    monitorProcess.stderr.on('data', (data) => {
        console.error('[Monitor Error]', data.toString('utf8'));
    });

    monitorProcess.on('exit', (code) => {
        console.log(`Monitor process exited with code ${code}`);
        monitorProcess = null;
        // Auto restart if unexpected exit and monitor is still enabled
        if (appConfig.enableMonitor && !isQuitting) {
            setTimeout(startMonitor, 5000);
        }
    });
}

function stopMonitor() {
    if (monitorProcess) {
        console.log('Stopping Monitor Service...');
        try {
            if (process.platform === 'win32' && monitorProcess.pid) {
                // Force kill process tree on Windows
                execSync(`taskkill /pid ${monitorProcess.pid} /T /F`);
            }
        } catch (e) {
            // Ignore errors (e.g. process already dead)
            console.log('Monitor process already killed or error killing:', e.message);
        } finally {
            if (monitorProcess) {
                monitorProcess.kill();
                monitorProcess = null;
            }
        }
    }
}

function handleIncomingMessage(msgData) {
    if (!msgData || !msgData.title) return;

    // Filter logic
    if (msgData.isUnread === false) return;

    const title = msgData.title;
    const body = msgData.content || '[收到新消息]';
    const msgType = msgData.messageType || 'text';

    if (appConfig.enableCustomPopup) {
        showCustomPopup({
            title: title,
            content: body,
            timestamp: msgData.timestamp,
            messageType: msgType,
            count: msgData.count
        });
    } else if (appConfig.enableNativeNotification) {
        showNativeNotification(title, body);
    }
}

function startNotifyServer() {
    if (notifyServer) return;

    const serverApp = express();
    serverApp.use(bodyParser.json());

    serverApp.post('/notify', (req, res) => {
        const msgData = req.body;
        console.log('[NotifyServer] Received:', msgData);
        
        handleIncomingMessage(msgData);
        res.status(200).send('OK');
    });

    notifyServer = serverApp.listen(NOTIFY_PORT, '127.0.0.1', () => {
        console.log(`Notify Server running on port ${NOTIFY_PORT}`);
    });
}

// --- System Tray Logic ---
function createTray() {
    if (tray) return;

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

    popupWindow.on('closed', () => {
        popupWindow = null;
    });
}

function showCustomPopup(data) {
    if (!popupWindow || popupWindow.isDestroyed()) {
        createPopupWindow();
        popupWindow.webContents.once('did-finish-load', () => {
            popupWindow.webContents.send('popup:update', data);
        });
    } else {
        popupWindow.webContents.send('popup:update', data);
    }

    if (popupCloseTimer) clearTimeout(popupCloseTimer);
    
    popupCloseTimer = setTimeout(() => {
        if (popupWindow && !popupWindow.isDestroyed()) {
            popupWindow.webContents.send('popup:fadeout');
            setTimeout(() => {
                if (popupWindow && !popupWindow.isDestroyed()) {
                    popupWindow.close();
                }
            }, 300);
        }
    }, 5000);
}

ipcMain.on('popup:close', () => {
    if (popupWindow && !popupWindow.isDestroyed()) {
        popupWindow.close();
    }
});

ipcMain.on('popup:click', () => {
    // Activate WeChat Window
    const script = `
    $code = @"
    using System;
    using System.Runtime.InteropServices;
    public class User32 {
        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")]
        public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr hWnd);
    }
"@
    Add-Type -TypeDefinition $code -Language CSharp -ErrorAction SilentlyContinue
    
    $proc = Get-Process -Name "WeChat", "Weixin" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($proc) {
        $hwnd = $proc.MainWindowHandle
        if ($hwnd -eq 0) {
             # Window handle is 0, likely minimized to tray. Restarting executable usually wakes it up.
             if ($proc.Path) {
                 Start-Process $proc.Path
             }
        } else {
            # SW_RESTORE = 9
            if ([User32]::IsIconic($hwnd)) {
                [User32]::ShowWindowAsync($hwnd, 9)
            } else {
                 # SW_SHOW = 5, just to be sure
                 [User32]::ShowWindowAsync($hwnd, 5)
            }
            [User32]::SetForegroundWindow($hwnd)
        }
    }
    `;
    spawn('powershell.exe', ['-Command', script], {
        windowsHide: true,
        stdio: 'ignore'
    });

    if (popupWindow && !popupWindow.isDestroyed()) {
        popupWindow.close();
    }
});

function showNativeNotification(title, body) {
    const notifyOpts = {
        title: title, 
        body: body,
    };
    if (process.platform === 'win32' && fs.existsSync(iconIcoPath)) {
        notifyOpts.icon = iconIcoPath;
    } else if (fs.existsSync(iconPath)) {
        notifyOpts.icon = iconPath;
    }
    new Notification(notifyOpts).show();
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
        icon: process.platform === 'win32' ? iconIcoPath : iconPath,
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
        if (!isHidden) {
            mainWindow.show();
        }
        if (process.platform === 'win32' && iconIcoPath) {
            mainWindow.setIcon(iconIcoPath);
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
    if (appConfig.enableMonitor) {
        startMonitor();
    }
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

app.on('will-quit', () => {
    stopMonitor();
    if (notifyServer) {
        console.log('Stopping Notify Server...');
        notifyServer.close();
        notifyServer = null;
    }
});

// IPC Handlers
ipcMain.handle('notification:show', (event, { title, body, type }) => {
    if (type === 'custom') {
        showCustomPopup({ content: body, timestamp: '测试' });
    } else if (type === 'native') {
        showNativeNotification(title, body);
    } else {
        if (appConfig.enableCustomPopup) {
            showCustomPopup({ content: body, timestamp: '测试' });
        } else {
            showNativeNotification(title, body);
        }
    }
    return 'Notification sent';
});

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

ipcMain.handle('monitor:toggle', (event, enable) => {
    appConfig.enableMonitor = enable;
    saveConfig();
    
    if (enable) {
        startMonitor();
    } else {
        stopMonitor();
    }
    return true;
});

ipcMain.handle('monitor:get-status', () => {
    return appConfig.enableMonitor;
});

ipcMain.handle('popup:toggle', (event, enable) => {
    appConfig.enableCustomPopup = enable;
    saveConfig();
    return true;
});

ipcMain.handle('popup:get-status', () => {
    return appConfig.enableCustomPopup;
});
