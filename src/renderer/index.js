const btnSelect = document.getElementById('btn-select');
const btnAutoDetect = document.getElementById('btn-auto');
const btnPatch = document.getElementById('btn-patch');
const filePathDisplay = document.getElementById('file-path');
const patchStatus = document.getElementById('patch-status');
const btnTestNotify = document.getElementById('btn-test-notify');
const btnTestNative = document.getElementById('btn-test-native');
const btnTestCustom = document.getElementById('btn-test-custom');
const chkMonitor = document.getElementById('chk-monitor');
const chkCustomPopup = document.getElementById('chk-custom-popup');
const btnMinimize = document.getElementById('btn-minimize');
const btnClose = document.getElementById('btn-close');

// System Settings Elements
const chkAutoLaunch = document.getElementById('chk-autolaunch');
const btnCheckUpdate = document.getElementById('btn-check-update');
const updateStatus = document.getElementById('update-status');

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

// Auto Detect
btnAutoDetect.addEventListener('click', async () => {
    const path = await window.electronAPI.autoDetectPath();
    if (path) {
        selectedFilePath = path;
        filePathDisplay.innerText = path;
        btnPatch.disabled = false;
        patchStatus.innerText = '已自动定位到安装路径';
        patchStatus.className = 'success';
    } else {
        patchStatus.innerText = '未在注册表中找到微信安装路径，请手动选择。';
        patchStatus.className = 'error';
    }
});

// Apply Patch
btnPatch.addEventListener('click', async () => {
    if (!selectedFilePath) return;

    patchStatus.innerText = '正在分析并应用补丁...';
    patchStatus.className = '';

    const result = await window.electronAPI.applyPatch(selectedFilePath);
    
    patchStatus.innerText = result.message;
    patchStatus.className = result.success ? 'success' : 'error';
});

// Notification Test
btnTestNative.addEventListener('click', () => {
    console.log('点击了测试原生弹窗');
    window.electronAPI.showNotification('微信', '这是原生通知测试。', 'native');
});

btnTestCustom.addEventListener('click', () => {
    console.log('点击了测试自定义弹窗');
    window.electronAPI.showNotification('微信', '这是自定义弹窗测试。', 'custom');
});

// Real Monitor Control
chkMonitor.addEventListener('change', (e) => {
    const enabled = e.target.checked;
    console.log(`监听状态切换: ${enabled}`);
    window.electronAPI.toggleMonitor(enabled);
});

// Custom Popup Control
chkCustomPopup.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    console.log(`自定义弹窗切换: ${enabled}`);
    await window.electronAPI.setCustomPopupConfig(enabled);
});

// Listen for messages
window.electronAPI.onMessage((msg) => {
    console.log('收到新消息:', msg);
});

// --- System Settings Logic ---

// Auto Launch
chkAutoLaunch.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    const isSet = await window.electronAPI.toggleAutoLaunch(enabled);
    console.log(`Auto Launch set to: ${isSet}`);
});

// Initialize Auto Launch State
(async () => {
    const isAutoLaunch = await window.electronAPI.getAutoLaunch();
    chkAutoLaunch.checked = isAutoLaunch;

    const isCustomPopup = await window.electronAPI.getCustomPopupConfig();
    chkCustomPopup.checked = isCustomPopup;

    const isMonitor = await window.electronAPI.getMonitorConfig();
    chkMonitor.checked = isMonitor;
})();

// Auto Update
btnCheckUpdate.addEventListener('click', () => {
    // In dev mode this might not work as expected without electron-builder configuration
    updateStatus.innerText = '正在检查更新...';
    updateStatus.className = '';
    // Trigger update check via IPC if needed, or rely on auto-updater events
    // For now, we assume auto-updater runs on main process start/interval
    // But we can trigger it manually via restart in a real app, 
    // here we just simulate the check visually if no event comes immediately.
    setTimeout(() => {
        if (updateStatus.innerText === '正在检查更新...') {
             updateStatus.innerText = '暂无更新 (开发模式)';
        }
    }, 2000);
});

window.electronAPI.onUpdateAvailable(() => {
    updateStatus.innerText = '发现新版本，正在下载...';
    updateStatus.className = 'success';
});

window.electronAPI.onUpdateDownloaded(() => {
    updateStatus.innerText = '下载完成，重启安装...';
    const installBtn = document.createElement('button');
    installBtn.innerText = '立即安装';
    installBtn.className = 'primary-btn small-btn';
    installBtn.style.marginTop = '10px';
    installBtn.onclick = () => window.electronAPI.installUpdate();
    updateStatus.appendChild(document.createElement('br'));
    updateStatus.appendChild(installBtn);
});
