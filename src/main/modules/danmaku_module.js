const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const eventBus = require('./event_bus');

class DanmakuModule {
    constructor() {
        this.window = null;
        this.config = null;
        this.context = null;
    }

    init(config, context) {
        this.config = config;
        this.context = context;

        // Ensure config defaults
        if (typeof this.config.enableDanmaku === 'undefined') {
            this.config.enableDanmaku = false;
        }

        // Listen for notifications
        eventBus.on('message:notify', (data) => this.handleNotification(data));
        
        this.registerIpcHandlers();
        
        if (this.config.enableDanmaku) {
            this.createWindow();
        }
        
        console.log('[DanmakuModule] Initialized');
    }

    updateConfig(newConfig) {
        const oldEnable = this.config.enableDanmaku;
        this.config = newConfig;
        
        if (this.config.enableDanmaku !== oldEnable) {
            if (this.config.enableDanmaku) {
                this.createWindow();
            } else {
                this.closeWindow();
            }
        }
    }

    registerIpcHandlers() {
        ipcMain.handle('danmaku:toggle', (event, enable) => {
            this.config.enableDanmaku = enable;
            eventBus.emit('config:updated', { key: 'enableDanmaku', value: enable });
            
            if (enable) {
                this.createWindow();
            } else {
                this.closeWindow();
            }
            return true;
        });

        ipcMain.handle('danmaku:get-status', () => {
            return this.config.enableDanmaku;
        });
    }

    createWindow() {
        if (this.window && !this.window.isDestroyed()) return;

        const { width, height } = screen.getPrimaryDisplay().workAreaSize;

        this.window = new BrowserWindow({
            width: width,
            height: height,
            x: 0,
            y: 0,
            frame: false,
            transparent: true,
            alwaysOnTop: true,
            resizable: false,
            skipTaskbar: true,
            focusable: false,
            hasShadow: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                webSecurity: false
            }
        });

        // Make window click-through
        this.window.setIgnoreMouseEvents(true, { forward: true });
        
        this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

        // Load the danmaku html
        // path is relative to this file: src/main/modules/
        // danmaku.html is in src/renderer/
        const htmlPath = path.join(__dirname, '../../renderer/danmaku.html');
        this.window.loadFile(htmlPath);

        this.window.on('closed', () => {
            this.window = null;
        });
        
        // Open DevTools for debugging (optional, comment out for prod)
        // this.window.webContents.openDevTools({ mode: 'detach' });
    }

    closeWindow() {
        if (this.window && !this.window.isDestroyed()) {
            this.window.close();
        }
    }

    handleNotification(data) {
        if (!this.config.enableDanmaku) return;
        
        if (!this.window || this.window.isDestroyed()) {
            this.createWindow();
            this.window.webContents.once('did-finish-load', () => {
                this.window.webContents.send('danmaku:new', data);
            });
        } else {
            this.window.webContents.send('danmaku:new', data);
        }
    }
}

module.exports = new DanmakuModule();
