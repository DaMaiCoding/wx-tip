const btnSelect = document.getElementById('btn-select');
const btnPatch = document.getElementById('btn-patch');
const filePathDisplay = document.getElementById('file-path');
const patchStatus = document.getElementById('patch-status');
const btnTestNotify = document.getElementById('btn-test-notify');
const chkMonitor = document.getElementById('chk-monitor');

let selectedFilePath = null;

btnSelect.addEventListener('click', async () => {
    const filePath = await window.electronAPI.selectFile();
    if (filePath) {
        selectedFilePath = filePath;
        filePathDisplay.innerText = filePath;
        btnPatch.disabled = false;
        patchStatus.innerText = '';
    }
});

btnPatch.addEventListener('click', async () => {
    if (!selectedFilePath) return;

    patchStatus.innerText = 'Applying patch...';
    patchStatus.className = '';

    const result = await window.electronAPI.applyPatch(selectedFilePath);
    
    patchStatus.innerText = result.message;
    patchStatus.className = result.success ? 'success' : 'error';
});

btnTestNotify.addEventListener('click', () => {
    window.electronAPI.showNotification('WeChat', 'This is a test notification.');
});

// Simulated Monitor
let monitorInterval = null;

chkMonitor.addEventListener('change', (e) => {
    if (e.target.checked) {
        console.log('Monitor started');
        // Simulate checking for messages
        monitorInterval = setInterval(() => {
            // Randomly trigger a notification for demo purposes
            if (Math.random() > 0.9) {
                 window.electronAPI.showNotification('WeChat', 'New message detected (Simulated)');
            }
        }, 5000);
    } else {
        console.log('Monitor stopped');
        if (monitorInterval) clearInterval(monitorInterval);
    }
});
