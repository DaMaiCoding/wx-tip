const { ipcRenderer } = require('electron');

const notification = document.getElementById('notification');
const appName = document.getElementById('app-name');
const msgCount = document.getElementById('msg-count');
const msgContent = document.getElementById('msg-content');
const msgIcon = document.getElementById('msg-icon');
const msgText = document.getElementById('msg-text');
const msgTime = document.getElementById('msg-time');
const closeBtn = document.getElementById('close-btn');

const MESSAGE_ICONS = {
    image: '🖼️',
    sticker: '😊',
    video: '🎬',
    voice: '🎤',
    file: '📎',
    link: '🔗',
    location: '📍',
    text: ''
};

const MESSAGE_LABELS = {
    image: '[图片]',
    sticker: '[表情]',
    video: '[视频]',
    voice: '[语音]',
    file: '[文件]',
    link: '[链接]',
    location: '[位置]',
    text: ''
};

closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    ipcRenderer.send('popup:close');
});

notification.addEventListener('click', () => {
    ipcRenderer.send('popup:click');
});

ipcRenderer.on('popup:update', (event, data) => {
    console.log('[Popup] Received data:', JSON.stringify(data));
    
    appName.innerText = data.title || '微信';
    msgCount.innerText = data.count || 1;
    msgTime.innerText = data.timestamp || '刚刚';
    
    const messageType = data.messageType || 'text';
    const content = data.content || '新消息';
    
    const icon = MESSAGE_ICONS[messageType] || '';
    const label = MESSAGE_LABELS[messageType] || '';
    
    if (icon) {
        msgIcon.innerText = icon;
        msgIcon.style.display = 'inline';
        msgText.innerText = content;
    } else {
        msgIcon.style.display = 'none';
        msgText.innerText = content;
    }
    
    const hasEmojiInContent = /[\u{1F300}-\u{1F9FF}]/u.test(content);
    if (hasEmojiInContent) {
        msgText.style.fontFamily = "'Noto Color Emoji', 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";
    } else {
        msgText.style.fontFamily = "";
    }
});

ipcRenderer.on('popup:fadeout', () => {
    notification.classList.add('fade-out');
});
