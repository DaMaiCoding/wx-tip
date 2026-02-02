const { ipcRenderer } = require('electron');

const notification = document.getElementById('notification');
const msgContent = document.getElementById('msg-content');
const msgTime = document.getElementById('msg-time');
const closeBtn = document.getElementById('close-btn');

// Close Logic
closeBtn.addEventListener('click', () => {
    ipcRenderer.send('popup:close');
});

// Listen for content
ipcRenderer.on('popup:update', (event, data) => {
    msgContent.innerText = data.content || '新消息';
    msgTime.innerText = data.timestamp || '刚刚';
    
    // Play sound? (Optional, native sound might be enough)
});

// Auto close handled by main process or local timer?
// Let's rely on main process to close the window, but we can do a visual fade out.
ipcRenderer.on('popup:fadeout', () => {
    notification.classList.add('fade-out');
});
