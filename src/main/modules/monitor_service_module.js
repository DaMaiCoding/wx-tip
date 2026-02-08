const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { ipcMain } = require('electron');
const eventBus = require('./event_bus');

class MonitorServiceModule {
    constructor() {
        this.monitorProcess = null;
        this.config = null;
        this.context = null;
        this.isQuitting = false;
    }

    init(config, context) {
        this.config = config;
        this.context = context; // 需要 isPackaged, resourcesPath

        // 监听应用退出事件
        eventBus.on('app:quitting', () => {
            this.isQuitting = true;
            this.stopMonitor();
        });

        // 监听配置变更
        eventBus.on('config:updated', ({ key, value }) => {
            if (key === 'enableMonitor') {
                if (value) {
                    this.startMonitor();
                } else {
                    this.stopMonitor();
                }
            }
        });

        this.registerIpcHandlers();
        
        // 如果配置开启，则启动
        if (this.config.enableMonitor) {
            this.startMonitor();
        }

        console.log('[MonitorServiceModule] Initialized');
    }

    registerIpcHandlers() {
        ipcMain.handle('monitor:get-status', () => this.config.enableMonitor);
        
        ipcMain.handle('monitor:toggle', (event, enable) => {
            this.config.enableMonitor = enable;
            eventBus.emit('config:updated', { key: 'enableMonitor', value: enable });
            // startMonitor/stopMonitor 会通过 config:updated 事件触发，或者这里直接调用也可以
            // 这里已经在 eventBus 监听器里处理了，所以不需要显式调用
            return this.config.enableMonitor;
        });
    }

    getMonitorScriptPath() {
        if (this.context.isPackaged) {
            return path.join(this.context.resourcesPath, 'services', 'monitor.ps1');
        }
        return path.join(__dirname, '../services/monitor.ps1');
    }

    startMonitor() {
        if (this.monitorProcess) return;

        const monitorScript = this.getMonitorScriptPath();
        
        if (!fs.existsSync(monitorScript)) {
            console.error('Monitor script not found:', monitorScript);
            return;
        }

        console.log('Starting Monitor Service from:', monitorScript);
        this.monitorProcess = spawn('powershell.exe', [
            '-NoProfile', 
            '-ExecutionPolicy', 'Bypass', 
            '-File', monitorScript
        ], {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true
        });

        this.monitorProcess.stdout.on('data', (data) => {
            // 将原始 Buffer 数据发送给 Parser 模块处理
            eventBus.emit('monitor:output', data);
        });

        this.monitorProcess.stderr.on('data', (data) => {
            console.error('[Monitor Error]', data.toString('utf8'));
        });

        this.monitorProcess.on('exit', (code) => {
            console.log(`Monitor process exited with code ${code}`);
            this.monitorProcess = null;
            // Auto restart if unexpected exit and monitor is still enabled
            if (this.config.enableMonitor && !this.isQuitting) {
                setTimeout(() => this.startMonitor(), 5000);
            }
        });
    }

    stopMonitor() {
        if (this.monitorProcess) {
            console.log('Stopping Monitor Service...');
            try {
                if (process.platform === 'win32' && this.monitorProcess.pid) {
                    // Force kill process tree on Windows
                    execSync(`taskkill /pid ${this.monitorProcess.pid} /T /F`);
                }
            } catch (e) {
                // Ignore errors (e.g. process already dead)
                console.log('Monitor process already killed or error killing:', e.message);
            } finally {
                if (this.monitorProcess) {
                    this.monitorProcess.kill();
                    this.monitorProcess = null;
                }
            }
        }
    }
}

module.exports = new MonitorServiceModule();
