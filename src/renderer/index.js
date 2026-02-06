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
chkMonitor.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    console.log(`监听状态切换: ${enabled}`);
    window.electronAPI.toggleMonitor(enabled);

    // 互斥逻辑：关闭监听时，自动关闭自定义弹窗
    if (!enabled && chkCustomPopup.checked) {
        chkCustomPopup.checked = false;
        await window.electronAPI.setCustomPopupConfig(false);
    }
});

// Custom Popup Control
chkCustomPopup.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    console.log(`自定义弹窗切换: ${enabled}`);
    await window.electronAPI.setCustomPopupConfig(enabled);

    // 互斥/联动逻辑：开启自定义弹窗时，必须开启监听
    if (enabled && !chkMonitor.checked) {
        chkMonitor.checked = true;
        window.electronAPI.toggleMonitor(true);
    }
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
btnCheckUpdate.addEventListener('click', async () => {
    updateStatus.innerText = '正在检查更新...';
    updateStatus.className = '';
    btnCheckUpdate.disabled = true;
    
    try {
        await window.electronAPI.checkUpdate();
    } catch (error) {
        updateStatus.innerText = '检查更新出错';
        updateStatus.className = 'error';
        btnCheckUpdate.disabled = false;
    }
});

window.electronAPI.onCheckingForUpdate(() => {
    updateStatus.innerText = '正在检查更新...';
    updateStatus.className = '';
});

window.electronAPI.onUpdateAvailable((info) => {
    updateStatus.innerText = `发现新版本 v${info.version}，正在下载...`;
    updateStatus.className = 'success';
    btnCheckUpdate.disabled = true;
});

window.electronAPI.onDownloadProgress((progress) => {
    const percent = Math.round(progress.percent);
    updateStatus.innerText = `正在下载... ${percent}%`;
    // Optional: Add a visual progress bar if needed, but text is fine for now
});

window.electronAPI.onUpdateNotAvailable((info) => {
    updateStatus.innerText = `当前已是最新版本 (v${info.version || 'Unknown'})`;
    updateStatus.className = '';
    btnCheckUpdate.disabled = false;
});

window.electronAPI.onUpdateError((err) => {
    updateStatus.innerText = `更新出错: ${err}`;
    updateStatus.className = 'error';
    btnCheckUpdate.disabled = false;
});

window.electronAPI.onUpdateDownloaded((info) => {
    updateStatus.innerText = `v${info.version} 下载完成，准备安装...`;
    updateStatus.className = 'success';
    
    // Check if button already exists to avoid duplicates
    if (!document.getElementById('btn-install-update')) {
        const installBtn = document.createElement('button');
        installBtn.id = 'btn-install-update';
        installBtn.innerText = '立即安装重启';
        installBtn.className = 'primary-btn small-btn';
        installBtn.style.marginTop = '10px';
        installBtn.onclick = () => window.electronAPI.installUpdate();
        updateStatus.appendChild(document.createElement('br'));
        updateStatus.appendChild(installBtn);
    }
});
