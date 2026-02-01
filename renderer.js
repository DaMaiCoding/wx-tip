const btnSelect = document.getElementById('btn-select');
const btnPatch = document.getElementById('btn-patch');
const filePathDisplay = document.getElementById('file-path');
const patchStatus = document.getElementById('patch-status');
const btnTestNotify = document.getElementById('btn-test-notify');
const chkMonitor = document.getElementById('chk-monitor');
const btnMinimize = document.getElementById('btn-minimize');
const btnClose = document.getElementById('btn-close');

let selectedFilePath = null;

// Window Controls
btnMinimize.addEventListener('click', () => {
    window.electronAPI.minimize();
});

btnClose.addEventListener('click', () => {
    window.electronAPI.close();
});

// File Selection
btnSelect.addEventListener('click', async () => {
    const filePath = await window.electronAPI.selectFile();
    if (filePath) {
        selectedFilePath = filePath;
        filePathDisplay.innerText = filePath;
        btnPatch.disabled = false;
        patchStatus.innerText = '';
    }
});

// Apply Patch
btnPatch.addEventListener('click', async () => {
    if (!selectedFilePath) return;

    patchStatus.innerText = '正在应用补丁...';
    patchStatus.className = '';

    const result = await window.electronAPI.applyPatch(selectedFilePath);
    
    patchStatus.innerText = result.message;
    patchStatus.className = result.success ? 'success' : 'error';
});

// Notification Test
btnTestNotify.addEventListener('click', () => {
    window.electronAPI.showNotification('微信', '这是一条测试通知消息。');
});

// Simulated Monitor
let monitorInterval = null;

chkMonitor.addEventListener('change', (e) => {
    if (e.target.checked) {
        console.log('监听已开启');
        // Simulate checking for messages
        monitorInterval = setInterval(() => {
            // Randomly trigger a notification for demo purposes
            if (Math.random() > 0.9) {
                 window.electronAPI.showNotification('微信', '收到一条新消息 (模拟)');
            }
        }, 5000);
    } else {
        console.log('监听已停止');
        if (monitorInterval) clearInterval(monitorInterval);
    }
});
