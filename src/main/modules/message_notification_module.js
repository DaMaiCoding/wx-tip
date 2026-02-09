const { Notification, BrowserWindow, screen, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const eventBus = require('./event_bus');

class MessageNotificationModule {
    constructor() {
        this.popupWindow = null;
        this.popupCloseTimer = null;
        this.config = null;
        this.context = null;
    }

    /**
     * 初始化模块
     * @param {Object} config - 应用配置引用
     * @param {Object} context - 上下文环境 (resourcesPath, isPackaged, appIcon, iconPath, iconIcoPath)
     */
    init(config, context) {
        this.config = config;
        this.context = context;

        // 监听内部事件
        eventBus.on('message:notify', (data) => this.handleNotification(data));
        
        // 注册 IPC 处理
        this.registerIpcHandlers();

        console.log('[MessageNotificationModule] Initialized');
    }

    updateConfig(newConfig) {
        this.config = newConfig;
    }

    registerIpcHandlers() {
        ipcMain.handle('notification:show', (event, { title, body, type }) => {
            if (type === 'custom') {
                this.showCustomPopup({ title, content: body, timestamp: '测试' });
            } else if (type === 'native') {
                this.showNativeNotification(title, body);
            } else {
                if (this.config.enableCustomPopup) {
                    this.showCustomPopup({ title, content: body, timestamp: '测试' });
                } else {
                    this.showNativeNotification(title, body);
                }
            }
            return 'Notification sent';
        });

        ipcMain.handle('popup:toggle', (event, enable) => {
            this.config.enableCustomPopup = enable;
            eventBus.emit('config:updated', { key: 'enableCustomPopup', value: enable });
            return true;
        });

        ipcMain.handle('popup:get-status', () => {
            return this.config.enableCustomPopup;
        });

        ipcMain.on('popup:close', () => {
            if (this.popupWindow && !this.popupWindow.isDestroyed()) {
                this.popupWindow.close();
            }
        });

        ipcMain.on('popup:click', () => {
            this.activateWeChatWindow();
        });
    }

    handleNotification(msgData) {
        const title = msgData.title;
        const body = msgData.content || '[收到新消息]';
        const msgType = msgData.messageType || 'text';

        if (this.config.enableCustomPopup) {
            this.showCustomPopup({
                title: title,
                content: body,
                timestamp: msgData.timestamp,
                messageType: msgType,
                count: msgData.count
            });
        } else if (this.config.enableNativeNotification) {
            this.showNativeNotification(title, body);
        }
    }

    showNativeNotification(title, body) {
        const notifyOpts = {
            title: title, 
            body: body,
        };
        if (process.platform === 'win32' && fs.existsSync(this.context.iconIcoPath)) {
            notifyOpts.icon = this.context.iconIcoPath;
        } else if (fs.existsSync(this.context.iconPath)) {
            notifyOpts.icon = this.context.iconPath;
        }
        new Notification(notifyOpts).show();
    }

    createPopupWindow() {
        if (this.popupWindow && !this.popupWindow.isDestroyed()) {
            this.popupWindow.close();
        }

        const { width, height } = screen.getPrimaryDisplay().workAreaSize;
        
        this.popupWindow = new BrowserWindow({
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
            icon: this.context.appIcon,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                webSecurity: false
            }
        });

        this.popupWindow.once('ready-to-show', () => {
            this.popupWindow.show();
        });

        // 注意路径层级变化：src/main/modules -> src/renderer
        const popupHtmlPath = path.join(__dirname, '../../renderer/popup.html');
        this.popupWindow.loadFile(popupHtmlPath);

        this.popupWindow.on('closed', () => {
            this.popupWindow = null;
        });
    }

    showCustomPopup(data) {
        if (!this.popupWindow || this.popupWindow.isDestroyed()) {
            this.createPopupWindow();
            this.popupWindow.webContents.once('did-finish-load', () => {
                this.popupWindow.webContents.send('popup:update', data);
            });
        } else {
            this.popupWindow.webContents.send('popup:update', data);
        }

        if (this.popupCloseTimer) clearTimeout(this.popupCloseTimer);
        
        this.popupCloseTimer = setTimeout(() => {
            if (this.popupWindow && !this.popupWindow.isDestroyed()) {
                this.popupWindow.webContents.send('popup:fadeout');
                setTimeout(() => {
                    if (this.popupWindow && !this.popupWindow.isDestroyed()) {
                        this.popupWindow.close();
                    }
                }, 300);
            }
        }, 5000);
    }

    activateWeChatWindow() {
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

        if (this.popupWindow && !this.popupWindow.isDestroyed()) {
            this.popupWindow.close();
        }
    }

    destroy() {
        if (this.popupWindow && !this.popupWindow.isDestroyed()) {
            this.popupWindow.close();
        }
        // 清理 IPC 监听器 (如果需要)
    }
}

module.exports = new MessageNotificationModule();
