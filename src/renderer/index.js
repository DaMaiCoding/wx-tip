const btnTestNative = document.getElementById('btn-test-native');
const btnTestCustom = document.getElementById('btn-test-custom');
const btnMinimize = document.getElementById('btn-minimize');
const btnClose = document.getElementById('btn-close');

// System Settings Elements
const chkAutoLaunch = document.getElementById('chk-autolaunch');
const chkMonitor = document.getElementById('chk-monitor');
const chkCustomPopup = document.getElementById('chk-custom-popup');
const appVersionEl = document.getElementById('app-version');

// Window Controls
btnMinimize.addEventListener('click', () => {
    window.electronAPI.minimize();
});

btnClose.addEventListener('click', () => {
    window.electronAPI.close();
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

// Auto Launch
chkAutoLaunch.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    const isSet = await window.electronAPI.toggleAutoLaunch(enabled);
    console.log(`Auto Launch set to: ${isSet}`);
});

// Monitor
chkMonitor.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    const isSet = await window.electronAPI.toggleMonitor(enabled);
    console.log(`Monitor set to: ${isSet}`);
});

// Custom Popup
chkCustomPopup.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    const isSet = await window.electronAPI.toggleCustomPopup(enabled);
    console.log(`Custom Popup set to: ${isSet}`);
});

// Initialize
(async () => {
    // Auto Launch State
    const isAutoLaunch = await window.electronAPI.getAutoLaunch();
    chkAutoLaunch.checked = isAutoLaunch;

    // Monitor State
    const isMonitor = await window.electronAPI.getMonitorStatus();
    chkMonitor.checked = isMonitor;

    // Custom Popup State
    const isCustomPopup = await window.electronAPI.getCustomPopupStatus();
    chkCustomPopup.checked = isCustomPopup;

    // App Version
    const version = await window.electronAPI.getAppVersion();
    if (appVersionEl) {
        appVersionEl.innerText = version;
    }
})();
