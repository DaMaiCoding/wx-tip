const { ipcRenderer } = require('electron');

const notification = document.getElementById('notification');
const appName = document.getElementById('app-name');
const msgCount = document.getElementById('msg-count');
const msgContent = document.getElementById('msg-content');
const msgTime = document.getElementById('msg-time');
const closeBtn = document.getElementById('close-btn');

// Close Logic
closeBtn.addEventListener('click', () => {
    ipcRenderer.send('popup:close');
});

// Listen for content
ipcRenderer.on('popup:update', (event, data) => {
    appName.innerText = data.title || '微信';
    msgCount.innerText = data.count || 1;
    msgContent.innerText = data.content || '新消息';
    msgTime.innerText = data.timestamp || '刚刚';
});

// Auto close handled by main process or local timer?
// Let's rely on main process to close the window, but we can do a visual fade out.
ipcRenderer.on('popup:fadeout', () => {
    notification.classList.add('fade-out');
});
