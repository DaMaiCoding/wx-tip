const { ipcMain, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const eventBus = require('./event_bus');

class MessageRecallModule {
    constructor() {
        this.config = null;
        this.recallHistoryPath = null;
    }

    /**
     * 初始化模块
     * @param {Object} config - 应用配置引用
     * @param {Object} context - 上下文环境 (recallHistoryPath)
     */
    init(config, context) {
        this.config = config;
        this.recallHistoryPath = context.recallHistoryPath;

        // 监听内部事件
        eventBus.on('message:recall', (data) => this.handleRecall(data));
        
        // 注册 IPC 处理
        this.registerIpcHandlers();

        console.log('[MessageRecallModule] Initialized');
    }

    updateConfig(newConfig) {
        this.config = newConfig;
    }

    registerIpcHandlers() {
        ipcMain.handle('recall:get-status', () => this.config.enableAntiRecall);
        
        ipcMain.handle('recall:toggle', (event, enable) => {
            this.config.enableAntiRecall = enable;
            eventBus.emit('config:updated', { key: 'enableAntiRecall', value: enable });
            return this.config.enableAntiRecall;
        });

        ipcMain.handle('recall:get-history', () => {
            return this.loadRecallHistory();
        });

        ipcMain.handle('recall:clear-history', () => {
            try {
                if (fs.existsSync(this.recallHistoryPath)) {
                    fs.writeFileSync(this.recallHistoryPath, JSON.stringify([], null, 2), 'utf8');
                }
                return true;
            } catch (err) {
                console.error('Failed to clear recall history:', err);
                return false;
            }
        });

        ipcMain.handle('recall:delete-item', (event, timestamp) => {
            try {
                const history = this.loadRecallHistory();
                const newHistory = history.filter(item => item.time !== timestamp);
                fs.writeFileSync(this.recallHistoryPath, JSON.stringify(newHistory, null, 2), 'utf8');
                return newHistory;
            } catch (err) {
                console.error('Failed to delete recall item:', err);
                return null;
            }
        });
    }

    handleRecall(msgData) {
        // Check if Anti-Recall is enabled
        if (!this.config.enableAntiRecall) {
            return;
        }

        // Add timestamp for UI if not present or invalid
        if (!msgData.time) {
            msgData.time = Date.now();
        }

        // Deduplication: Check if same content exists in history for this chat
        // This prevents repeated alerts when Monitor Service restarts and re-scans the same recall notice
        const history = this.loadRecallHistory();
        const isDuplicate = history.some(item => 
            item.title === msgData.title && 
            item.originalContent === msgData.originalContent
        );

        if (isDuplicate) {
            console.log(`[MessageRecall] Duplicate skipped: ${msgData.title} -> ${msgData.originalContent}`);
            return;
        }
        
        this.saveRecallHistory(msgData);
        // Broadcast to all windows
        BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send('recall-log', msgData);
        });

        // Trigger notification for the recalled message
        eventBus.emit('message:notify', msgData);
    }

    loadRecallHistory() {
        try {
            if (fs.existsSync(this.recallHistoryPath)) {
                return JSON.parse(fs.readFileSync(this.recallHistoryPath, 'utf-8'));
            }
        } catch (e) {
            console.error('Failed to load recall history:', e);
        }
        return [];
    }

    saveRecallHistory(newRecord) {
        try {
            const history = this.loadRecallHistory();
            history.unshift(newRecord); // Add to top
            // Limit history size (e.g. 100)
            if (history.length > 100) {
                history.length = 100;
            }
            fs.writeFileSync(this.recallHistoryPath, JSON.stringify(history, null, 2), 'utf-8');
            return history;
        } catch (e) {
            console.error('Failed to save recall history:', e);
            return [];
        }
    }
}

module.exports = new MessageRecallModule();
