const fs = require('fs');
const path = require('path');
const eventBus = require('./event_bus');

class MessageParserModule {
    constructor() {
        this.config = null;
        this.filteredCsvPathNode = null;
    }

    init(config, context) {
        this.config = config;
        
        // 确定 CSV 过滤日志路径
        const configPath = context.isPackaged 
            ? path.join(context.resourcesPath, 'data', 'config.json')
            : path.join(__dirname, '../data/config.json');
        this.filteredCsvPathNode = path.join(path.dirname(configPath), 'filtered_out.csv');

        // 监听 Monitor 原始输出
        eventBus.on('monitor:output', (data) => this.handleOutput(data));
        
        console.log('[MessageParserModule] Initialized');
    }

    handleOutput(data) {
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
                    this.processParsedMessage(msg);
                } catch (e) {
                    console.log('[Monitor Log]', line);
                }
            } else {
                console.log('[Monitor Log]', line);
            }
        });
    }

    processParsedMessage(msgData) {
        if (!msgData || !msgData.title) return;

        // Filter logic: 过滤未读且非撤回消息
        if (msgData.isUnread === false && msgData.type !== 'recall') {
            this.appendToFilteredCsv('Node Filter: isUnread=false', msgData);
            return;
        }

        // 发送已解析和清洗的消息
        // 根据消息类型分发到具体的业务模块
        if (msgData.type === 'recall') {
            eventBus.emit('message:recall', msgData);
        } else {
            eventBus.emit('message:notify', msgData);
        }
    }

    appendToFilteredCsv(reason, content) {
        const ts = new Date().toISOString();
        const line = `${ts},${reason},${JSON.stringify(content)}\n`;
        try {
            if (!fs.existsSync(this.filteredCsvPathNode)) {
                fs.writeFileSync(this.filteredCsvPathNode, 'Timestamp,Reason,Content\n', 'utf8');
            }
            fs.appendFileSync(this.filteredCsvPathNode, line, 'utf8');
        } catch (e) { console.error('CSV Write Error:', e); }
    }
}

module.exports = new MessageParserModule();
